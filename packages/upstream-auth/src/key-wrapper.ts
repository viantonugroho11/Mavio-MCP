import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { request } from "undici";
import { MavioError } from "@mavio/core";
import type { KekProvider } from "./keyring.js";

/**
 * KeyWrapper wraps and unwraps a per-row Data Encryption Key (DEK). Two ship-
 * day implementations:
 *   - LocalKeyWrapper — AES-256-GCM using a KEK held in this process
 *     (EnvKekProvider). Fast, no network dependency, key rotation via
 *     MAVIO_VAULT_KEYRING.
 *   - VaultTransitKeyWrapper — HashiCorp Vault Transit backend. Keys never
 *     leave Vault; wrap/unwrap happen remotely. Rotation via Vault CLI.
 *
 * Interface is async because KMS-backed wrappers must round-trip a network
 * call per DEK operation. Local wrap is trivially fast but conforms to the
 * async signature so the Vault class code path is identical.
 */
export interface KeyWrapper {
  /** Key id the wrapper considers primary for new writes. */
  primaryKeyId(): Promise<string>;
  /** Wrap a raw DEK. Returns which key was used + the wrapped material. */
  wrap(dek: Buffer): Promise<{ keyId: string; wrappedDek: Buffer }>;
  /** Unwrap a DEK previously wrapped under keyId. */
  unwrap(keyId: string, wrappedDek: Buffer): Promise<Buffer>;
  /** List every keyId the wrapper knows about (for status endpoints). */
  listKeyIds(): Promise<string[]>;
}

const ALG = "aes-256-gcm";
const IV_LEN = 12;

/**
 * Local AES-256-GCM wrapper. Key material lives in-process via KekProvider.
 * Wrapped output layout: `[iv:12 | tag:16 | ciphertext:...]` so a single bytea
 * column can hold everything.
 */
export class LocalKeyWrapper implements KeyWrapper {
  constructor(private readonly kek: KekProvider) {}

  async primaryKeyId(): Promise<string> {
    return this.kek.primary.keyId;
  }

  async wrap(dek: Buffer): Promise<{ keyId: string; wrappedDek: Buffer }> {
    const primary = this.kek.primary;
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALG, primary.material, iv);
    const body = Buffer.concat([cipher.update(dek), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { keyId: primary.keyId, wrappedDek: Buffer.concat([iv, tag, body]) };
  }

  async unwrap(keyId: string, wrappedDek: Buffer): Promise<Buffer> {
    const kek = this.kek.get(keyId);
    if (!kek) {
      throw new MavioError(
        `no local KEK for keyId ${keyId} — was it retired prematurely?`,
        "VAULT_UNKNOWN_KEY",
      );
    }
    if (wrappedDek.length < IV_LEN + 16) {
      throw new MavioError("wrappedDek too short", "VAULT_CORRUPT");
    }
    const iv = wrappedDek.subarray(0, IV_LEN);
    const tag = wrappedDek.subarray(IV_LEN, IV_LEN + 16);
    const body = wrappedDek.subarray(IV_LEN + 16);
    const decipher = createDecipheriv(ALG, kek.material, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(body), decipher.final()]);
    } catch {
      throw new MavioError(`DEK unwrap failed for keyId ${keyId}`, "VAULT_UNWRAP_FAIL");
    }
  }

  async listKeyIds(): Promise<string[]> {
    return this.kek.list().map((e) => e.keyId);
  }
}

export interface VaultTransitConfig {
  /** Base URL of the Vault server, e.g. https://vault.example:8200. */
  endpoint: string;
  /** Vault token with `encrypt`/`decrypt` capabilities on the transit key. */
  token: string;
  /** Transit mount path. Defaults to `transit`. */
  mount?: string;
  /** Named encryption key inside the transit mount. */
  keyName: string;
  /**
   * The specific key version to consider "primary" for stamping on new rows.
   * When null, uses `latest`. Vault's decrypt path auto-handles version-
   * embedded ciphertext regardless, so this only affects the primaryKeyId()
   * value written to the row's key_id column.
   */
  primaryVersion?: number;
  /** Optional namespace header (Vault Enterprise). */
  namespace?: string;
  /** Request timeout ms. Default 3000. */
  timeoutMs?: number;
}

/**
 * HashiCorp Vault Transit KEK backend. Wraps DEKs via `/v1/<mount>/encrypt/<key>`
 * and unwraps via `/v1/<mount>/decrypt/<key>`. The wrappedDek stored on the
 * row is the raw Vault ciphertext string (e.g. `vault:v3:...`) — Vault embeds
 * the key version, so unwrap always knows which key to use.
 *
 * key_id column format: `vault-transit:<keyName>:v<version>` so ADR-019's
 * per-key row counting still works and retire logic can be scoped per version.
 */
export class VaultTransitKeyWrapper implements KeyWrapper {
  private readonly mount: string;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: VaultTransitConfig) {
    this.mount = cfg.mount ?? "transit";
    this.timeoutMs = cfg.timeoutMs ?? 3000;
  }

  async primaryKeyId(): Promise<string> {
    const version = this.cfg.primaryVersion ?? (await this.latestVersion());
    return `vault-transit:${this.cfg.keyName}:v${version}`;
  }

  async wrap(dek: Buffer): Promise<{ keyId: string; wrappedDek: Buffer }> {
    const body = { plaintext: dek.toString("base64") };
    if (this.cfg.primaryVersion !== undefined) {
      (body as { key_version?: number }).key_version = this.cfg.primaryVersion;
    }
    const payload = await this.post<{ data?: { ciphertext?: string; key_version?: number } }>(
      `/v1/${this.mount}/encrypt/${this.cfg.keyName}`,
      body,
    );
    const ct = payload.data?.ciphertext;
    if (!ct) throw new MavioError("vault-transit encrypt returned no ciphertext", "VAULT_WRAP_FAIL");
    const version = payload.data?.key_version ?? this.cfg.primaryVersion ?? 0;
    return {
      keyId: `vault-transit:${this.cfg.keyName}:v${version}`,
      wrappedDek: Buffer.from(ct, "utf8"),
    };
  }

  async unwrap(keyId: string, wrappedDek: Buffer): Promise<Buffer> {
    if (!keyId.startsWith("vault-transit:")) {
      throw new MavioError(
        `keyId ${keyId} not from vault-transit — mismatched wrapper`,
        "VAULT_UNKNOWN_KEY",
      );
    }
    const ciphertext = wrappedDek.toString("utf8");
    const payload = await this.post<{ data?: { plaintext?: string } }>(
      `/v1/${this.mount}/decrypt/${this.cfg.keyName}`,
      { ciphertext },
    );
    const pt = payload.data?.plaintext;
    if (!pt) throw new MavioError("vault-transit decrypt returned no plaintext", "VAULT_UNWRAP_FAIL");
    return Buffer.from(pt, "base64");
  }

  async listKeyIds(): Promise<string[]> {
    // Vault exposes /v1/<mount>/keys/<name> with min/latest_version. We list
    // every extant version so status endpoints can show them all.
    const payload = await this.get<{
      data?: {
        latest_version?: number;
        min_decryption_version?: number;
        keys?: Record<string, unknown>;
      };
    }>(`/v1/${this.mount}/keys/${this.cfg.keyName}`);
    const latest = payload.data?.latest_version ?? 1;
    const min = payload.data?.min_decryption_version ?? 1;
    const out: string[] = [];
    for (let v = min; v <= latest; v++) out.push(`vault-transit:${this.cfg.keyName}:v${v}`);
    return out;
  }

  private async latestVersion(): Promise<number> {
    const payload = await this.get<{ data?: { latest_version?: number } }>(
      `/v1/${this.mount}/keys/${this.cfg.keyName}`,
    );
    return payload.data?.latest_version ?? 1;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "x-vault-token": this.cfg.token };
    if (this.cfg.namespace) h["x-vault-namespace"] = this.cfg.namespace;
    return h;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await request(`${this.cfg.endpoint}${path}`, {
        method: "POST",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.statusCode >= 400) {
        const detail = await res.body.text().catch(() => "");
        throw new MavioError(
          `vault-transit ${path} ${res.statusCode}: ${detail.slice(0, 200)}`,
          "VAULT_TRANSIT_HTTP",
        );
      }
      return (await res.body.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await request(`${this.cfg.endpoint}${path}`, {
        method: "GET",
        headers: this.headers(),
        signal: controller.signal,
      });
      if (res.statusCode >= 400) {
        throw new MavioError(
          `vault-transit ${path} ${res.statusCode}`,
          "VAULT_TRANSIT_HTTP",
        );
      }
      return (await res.body.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
