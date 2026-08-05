import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { MavioError } from "@mavio/core";
import type { KekProvider } from "./keyring.js";

/**
 * Envelope encryption per ADR-019:
 *   1. Generate a random 32-byte DEK per encrypt() call.
 *   2. Encrypt plaintext with AES-256-GCM using the DEK.
 *   3. Wrap the DEK with the primary KEK using AES-256-GCM.
 *   4. Persist { keyId, wrappedDek, iv, authTag, ciphertext } together.
 *
 * Decrypt path selects the KEK by row-recorded keyId, unwraps the DEK,
 * then decrypts the payload. Old KEKs remain valid until retire().
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
  constructor(private readonly kek: KekProvider) {}

  encrypt(plaintext: Buffer | string): Envelope {
    const primary = this.kek.primary;
    const dek = randomBytes(32);

    // Wrap the DEK under the primary KEK. IV and tag prepended into wrappedDek.
    const wrapIv = randomBytes(IV_LEN);
    const wrapCipher = createCipheriv(ALG, primary.material, wrapIv);
    const wrappedDekBody = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
    const wrapTag = wrapCipher.getAuthTag();
    const wrappedDek = Buffer.concat([wrapIv, wrapTag, wrappedDekBody]);

    // Encrypt payload under DEK.
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALG, dek, iv);
    const body = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, "utf8");
    const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return { keyId: primary.keyId, wrappedDek, iv, authTag, ciphertext };
  }

  decrypt(env: Envelope): Buffer {
    const kek = this.kek.get(env.keyId);
    if (!kek) {
      throw new MavioError(
        `no KEK for keyId ${env.keyId} — was it retired prematurely?`,
        "VAULT_UNKNOWN_KEY",
      );
    }
    if (env.wrappedDek.length < IV_LEN + 16) {
      throw new MavioError("wrappedDek too short", "VAULT_CORRUPT");
    }
    const wrapIv = env.wrappedDek.subarray(0, IV_LEN);
    const wrapTag = env.wrappedDek.subarray(IV_LEN, IV_LEN + 16);
    const wrapBody = env.wrappedDek.subarray(IV_LEN + 16);

    const unwrap = createDecipheriv(ALG, kek.material, wrapIv);
    unwrap.setAuthTag(wrapTag);
    let dek: Buffer;
    try {
      dek = Buffer.concat([unwrap.update(wrapBody), unwrap.final()]);
    } catch {
      throw new MavioError(`DEK unwrap failed for keyId ${env.keyId}`, "VAULT_UNWRAP_FAIL");
    }

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
   * Re-wrap an existing envelope under the current primary key. Cheap when
   * env.keyId === primary.keyId (no-op returns the same envelope).
   */
  rewrap(env: Envelope): Envelope {
    if (env.keyId === this.kek.primary.keyId) return env;
    const plaintext = this.decrypt(env);
    return this.encrypt(plaintext);
  }
}
