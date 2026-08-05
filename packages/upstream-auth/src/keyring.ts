import { MavioError } from "@mavio/core";

/**
 * Ordered keyring of Key-Encryption-Keys (KEKs) per ADR-019.
 *
 * The first entry is PRIMARY — new writes wrap the per-row DEK with this key.
 * Later entries are decrypt-only — kept until every ciphertext referencing them
 * has been re-wrapped via lazy rewrap on next touch.
 *
 * Environment format:
 *   MAVIO_VAULT_KEYRING="v3:<base64>,v2:<base64>,v1:<base64>"
 *
 * Each key material must decode to exactly 32 bytes (AES-256).
 */

export interface KekEntry {
  keyId: string;
  material: Buffer;
}

export interface KekProvider {
  readonly primary: KekEntry;
  get(keyId: string): KekEntry | undefined;
  list(): KekEntry[];
  /** Prepend a new primary; existing keys become decrypt-only. */
  rotate(next: KekEntry): void;
  /** Remove a KEK; caller must verify no rows reference it. */
  retire(keyId: string): void;
}

export class EnvKekProvider implements KekProvider {
  private entries: KekEntry[];

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const raw = env.MAVIO_VAULT_KEYRING;
    if (!raw || raw.trim() === "") {
      if (env.NODE_ENV === "production") {
        throw new MavioError(
          "MAVIO_VAULT_KEYRING is required in production",
          "VAULT_KEYRING_MISSING",
        );
      }
      // Dev-only ephemeral key so tests / local runs are self-contained.
      // NEVER used when NODE_ENV=production because of the guard above.
      const material = Buffer.alloc(32, 0x00);
      this.entries = [{ keyId: "dev-ephemeral", material }];
      return;
    }
    this.entries = parseKeyring(raw);
    if (this.entries.length === 0) {
      throw new MavioError("MAVIO_VAULT_KEYRING parsed to no keys", "VAULT_KEYRING_EMPTY");
    }
  }

  get primary(): KekEntry {
    return this.entries[0]!;
  }

  get(keyId: string): KekEntry | undefined {
    return this.entries.find((e) => e.keyId === keyId);
  }

  list(): KekEntry[] {
    return [...this.entries];
  }

  rotate(next: KekEntry): void {
    if (this.entries.some((e) => e.keyId === next.keyId)) {
      throw new MavioError(`key id already present: ${next.keyId}`, "VAULT_KEYRING_DUP");
    }
    this.entries.unshift(next);
  }

  retire(keyId: string): void {
    const idx = this.entries.findIndex((e) => e.keyId === keyId);
    if (idx < 0) throw new MavioError(`key id not found: ${keyId}`, "VAULT_KEYRING_MISS");
    if (idx === 0 && this.entries.length > 1) {
      throw new MavioError(
        `cannot retire primary key ${keyId} — rotate first`,
        "VAULT_KEYRING_PRIMARY",
      );
    }
    this.entries.splice(idx, 1);
  }
}

function parseKeyring(raw: string): KekEntry[] {
  const entries: KekEntry[] = [];
  const seen = new Set<string>();
  for (const chunk of raw.split(",")) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(":");
    if (sep < 0) {
      throw new MavioError(
        `bad keyring entry (missing "keyId:material"): ${trimmed}`,
        "VAULT_KEYRING_FORMAT",
      );
    }
    const keyId = trimmed.slice(0, sep).trim();
    const b64 = trimmed.slice(sep + 1).trim();
    if (!keyId) {
      throw new MavioError("empty keyId in keyring", "VAULT_KEYRING_FORMAT");
    }
    if (seen.has(keyId)) {
      throw new MavioError(`duplicate keyId in keyring: ${keyId}`, "VAULT_KEYRING_DUP");
    }
    let material: Buffer;
    try {
      material = Buffer.from(b64, "base64");
    } catch {
      throw new MavioError(`bad base64 for ${keyId}`, "VAULT_KEYRING_FORMAT");
    }
    if (material.length !== 32) {
      throw new MavioError(
        `key ${keyId}: expected 32 bytes (AES-256), got ${material.length}`,
        "VAULT_KEYRING_LEN",
      );
    }
    seen.add(keyId);
    entries.push({ keyId, material });
  }
  return entries;
}
