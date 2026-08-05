import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { MavioError } from "@mavio/core";
import type { KekProvider } from "./keyring.js";
import { LocalKeyWrapper, type KeyWrapper } from "./key-wrapper.js";

/**
 * Envelope encryption per ADR-019:
 *   1. Generate a random 32-byte DEK per encrypt() call.
 *   2. Encrypt plaintext with AES-256-GCM using the DEK.
 *   3. Ask the KeyWrapper to wrap the DEK — local AES-256-GCM (LocalKeyWrapper)
 *      or a remote KMS (VaultTransitKeyWrapper, KMS plugins).
 *   4. Persist { keyId, wrappedDek, iv, authTag, ciphertext } together.
 *
 * Decrypt path routes wrap/unwrap through the KeyWrapper. Old keys stay
 * unwrappable until they're retired from the wrapper.
 */

export interface Envelope {
  keyId: string;
  wrappedDek: Buffer;
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
}

const ALG = "aes-256-gcm";
const IV_LEN = 12;

export class Vault {
  private readonly wrapper: KeyWrapper;

  constructor(source: KeyWrapper | KekProvider) {
    this.wrapper = isKekProvider(source) ? new LocalKeyWrapper(source) : source;
  }

  async encrypt(plaintext: Buffer | string): Promise<Envelope> {
    const dek = randomBytes(32);
    const { keyId, wrappedDek } = await this.wrapper.wrap(dek);

    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALG, dek, iv);
    const body = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, "utf8");
    const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return { keyId, wrappedDek, iv, authTag, ciphertext };
  }

  async decrypt(env: Envelope): Promise<Buffer> {
    const dek = await this.wrapper.unwrap(env.keyId, env.wrappedDek);
    const decipher = createDecipheriv(ALG, dek, env.iv);
    decipher.setAuthTag(env.authTag);
    try {
      return Buffer.concat([decipher.update(env.ciphertext), decipher.final()]);
    } catch {
      throw new MavioError(
        `payload decrypt failed under keyId ${env.keyId}`,
        "VAULT_DECRYPT_FAIL",
      );
    }
  }

  /**
   * Re-wrap an existing envelope under the wrapper's current primary. No-op
   * when env.keyId already matches — cheap for hot paths that touch already-
   * fresh rows.
   */
  async rewrap(env: Envelope): Promise<Envelope> {
    const primary = await this.wrapper.primaryKeyId();
    if (env.keyId === primary) return env;
    const plaintext = await this.decrypt(env);
    return this.encrypt(plaintext);
  }

  async primaryKeyId(): Promise<string> {
    return this.wrapper.primaryKeyId();
  }

  async listKeyIds(): Promise<string[]> {
    return this.wrapper.listKeyIds();
  }
}

function isKekProvider(x: unknown): x is KekProvider {
  return (
    typeof x === "object" &&
    x !== null &&
    "primary" in x &&
    "get" in x &&
    "list" in x &&
    "rotate" in x
  );
}
