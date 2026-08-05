import { describe, expect, it, afterEach } from "vitest";
import { EnvKekProvider } from "./keyring.js";
import { Vault } from "./vault.js";

const b64 = (n: number, fill: number): string => Buffer.alloc(n, fill).toString("base64");

afterEach(() => {
  delete process.env.MAVIO_VAULT_KEYRING;
  delete process.env.NODE_ENV;
});

describe("EnvKekProvider", () => {
  it("boots dev ephemeral when unset outside production", () => {
    const p = new EnvKekProvider({} as NodeJS.ProcessEnv);
    expect(p.primary.keyId).toBe("dev-ephemeral");
    expect(p.primary.material.length).toBe(32);
  });

  it("refuses empty keyring in production", () => {
    expect(() => new EnvKekProvider({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(
      /required in production/,
    );
  });

  it("parses ordered keyring with primary first", () => {
    const p = new EnvKekProvider({
      MAVIO_VAULT_KEYRING: `v3:${b64(32, 0x33)},v2:${b64(32, 0x22)},v1:${b64(32, 0x11)}`,
    } as NodeJS.ProcessEnv);
    expect(p.primary.keyId).toBe("v3");
    expect(p.list().map((e) => e.keyId)).toEqual(["v3", "v2", "v1"]);
    expect(p.get("v2")?.material[0]).toBe(0x22);
  });

  it("rejects duplicate ids", () => {
    expect(
      () =>
        new EnvKekProvider({
          MAVIO_VAULT_KEYRING: `v1:${b64(32, 0x11)},v1:${b64(32, 0x22)}`,
        } as NodeJS.ProcessEnv),
    ).toThrow(/duplicate keyId/);
  });

  it("rejects non-32-byte key material", () => {
    expect(
      () =>
        new EnvKekProvider({
          MAVIO_VAULT_KEYRING: `bad:${b64(16, 0x11)}`,
        } as NodeJS.ProcessEnv),
    ).toThrow(/expected 32 bytes/);
  });

  it("rotate prepends new primary; retire drops non-primary", () => {
    const p = new EnvKekProvider({
      MAVIO_VAULT_KEYRING: `v1:${b64(32, 0x11)}`,
    } as NodeJS.ProcessEnv);
    p.rotate({ keyId: "v2", material: Buffer.alloc(32, 0x22) });
    expect(p.primary.keyId).toBe("v2");
    p.retire("v1");
    expect(p.list().map((e) => e.keyId)).toEqual(["v2"]);
  });

  it("refuses retire of primary when other keys exist", () => {
    const p = new EnvKekProvider({
      MAVIO_VAULT_KEYRING: `v2:${b64(32, 0x22)},v1:${b64(32, 0x11)}`,
    } as NodeJS.ProcessEnv);
    expect(() => p.retire("v2")).toThrow(/rotate first/);
  });
});

describe("Vault", () => {
  const kek = new EnvKekProvider({
    MAVIO_VAULT_KEYRING: `v2:${b64(32, 0x22)},v1:${b64(32, 0x11)}`,
  } as NodeJS.ProcessEnv);

  it("round-trips plaintext under primary key", async () => {
    const v = new Vault(kek);
    const env = await v.encrypt("xoxp-alice-secret");
    expect(env.keyId).toBe("v2");
    expect((await v.decrypt(env)).toString("utf8")).toBe("xoxp-alice-secret");
  });

  it("decrypts a legacy row under an older key", async () => {
    const legacy = new EnvKekProvider({
      MAVIO_VAULT_KEYRING: `v1:${b64(32, 0x11)}`,
    } as NodeJS.ProcessEnv);
    const legacyVault = new Vault(legacy);
    const env = await legacyVault.encrypt("old-token");

    const both = new Vault(
      new EnvKekProvider({
        MAVIO_VAULT_KEYRING: `v2:${b64(32, 0x22)},v1:${b64(32, 0x11)}`,
      } as NodeJS.ProcessEnv),
    );
    expect((await both.decrypt(env)).toString("utf8")).toBe("old-token");
  });

  it("rewrap re-encrypts under current primary", async () => {
    const legacy = new EnvKekProvider({
      MAVIO_VAULT_KEYRING: `v1:${b64(32, 0x11)}`,
    } as NodeJS.ProcessEnv);
    const legacyEnv = await new Vault(legacy).encrypt("payload");
    expect(legacyEnv.keyId).toBe("v1");

    const rotated = new Vault(kek);
    const rewrapped = await rotated.rewrap(legacyEnv);
    expect(rewrapped.keyId).toBe("v2");
    expect((await rotated.decrypt(rewrapped)).toString("utf8")).toBe("payload");
  });

  it("throws on unknown keyId (retired prematurely)", async () => {
    const v = new Vault(kek);
    const env = await v.encrypt("x");
    const orphan = { ...env, keyId: "vX" };
    await expect(v.decrypt(orphan)).rejects.toThrow(/no local KEK for keyId vX/);
  });

  it("throws on tampered ciphertext", async () => {
    const v = new Vault(kek);
    const env = await v.encrypt("secret");
    env.ciphertext[0] = env.ciphertext[0]! ^ 0xff;
    await expect(v.decrypt(env)).rejects.toThrow(/decrypt failed/);
  });

  it("throws on tampered wrappedDek", async () => {
    const v = new Vault(kek);
    const env = await v.encrypt("secret");
    env.wrappedDek[env.wrappedDek.length - 1] =
      env.wrappedDek[env.wrappedDek.length - 1]! ^ 0xff;
    await expect(v.decrypt(env)).rejects.toThrow(/unwrap failed/);
  });
});
