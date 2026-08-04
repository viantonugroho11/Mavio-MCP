import { describe, expect, it } from "vitest";
import { bearerHeaderFromAuth, resolveSecretRef } from "./index.js";

describe("resolveSecretRef", () => {
  it("resolves secret://NAME from env", () => {
    expect(resolveSecretRef("secret://MY_TOKEN", { MY_TOKEN: "abc" })).toBe("abc");
  });
  it("upper-cases the ref name", () => {
    expect(resolveSecretRef("secret://my_token", { MY_TOKEN: "abc" })).toBe("abc");
  });
  it("returns undefined for missing env", () => {
    expect(resolveSecretRef("secret://MISSING", {})).toBeUndefined();
  });
  it("returns undefined for undefined input", () => {
    expect(resolveSecretRef(undefined, {})).toBeUndefined();
  });
});

describe("bearerHeaderFromAuth", () => {
  it("emits Authorization Bearer header when secret resolves", () => {
    const h = bearerHeaderFromAuth({ type: "bearer", secretRef: "secret://T" }, { T: "xyz" });
    expect(h).toEqual({ authorization: "Bearer xyz" });
  });
  it("returns empty when secret missing", () => {
    expect(bearerHeaderFromAuth({ type: "bearer", secretRef: "secret://T" }, {})).toEqual({});
  });
  it("returns empty for none / undefined auth", () => {
    expect(bearerHeaderFromAuth(undefined)).toEqual({});
    expect(bearerHeaderFromAuth({ type: "none" })).toEqual({});
  });
});
