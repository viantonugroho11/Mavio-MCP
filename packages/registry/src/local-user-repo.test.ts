import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./local-user-repo.js";

describe("local user password hashing", () => {
  it("verifies the password it hashed", async () => {
    const stored = await hashPassword("correct horse");
    expect(stored).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(await verifyPassword("correct horse", stored)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse");
    expect(await verifyPassword("battery staple", stored)).toBe(false);
  });

  it("uses a fresh salt per hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects malformed stored hashes", async () => {
    for (const bad of ["", "scrypt", "scrypt:abc", "scrypt::ff", "scrypt:ab:", "bcrypt:ab:cd", "scrypt:ab:cd:ef"]) {
      expect(await verifyPassword("x", bad)).toBe(false);
    }
  });
});
