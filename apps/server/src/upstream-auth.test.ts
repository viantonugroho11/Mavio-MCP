import { describe, expect, it } from "vitest";
import type { ServerDescriptor } from "@mavio/core";
import { applyInjection } from "./upstream-auth.module.js";

const base = (transport: ServerDescriptor["transport"]): ServerDescriptor => ({
  id: "s",
  workspaceId: "w",
  projectId: "p",
  name: "s",
  sourceType: "native",
  transport,
});

describe("applyInjection", () => {
  it("overlays env onto stdio without dropping existing", () => {
    const d = base({ type: "stdio", command: "node", env: { FOO: "1" } });
    const out = applyInjection(d, { env: { BAR: "2", FOO: "override" } });
    expect(out.transport.type).toBe("stdio");
    expect((out.transport as { env: Record<string, string> }).env).toEqual({
      FOO: "override",
      BAR: "2",
    });
    // Original untouched
    expect((d.transport as { env: Record<string, string> }).env).toEqual({ FOO: "1" });
  });

  it("overlays headers onto http", () => {
    const d = base({ type: "http", baseUrl: "http://x", headers: { "x-existing": "y" } });
    const out = applyInjection(d, { headers: { authorization: "Bearer T" } });
    expect((out.transport as { headers: Record<string, string> }).headers).toEqual({
      "x-existing": "y",
      authorization: "Bearer T",
    });
  });

  it("overlays headers onto sse / ws / graphql", () => {
    for (const t of [
      { type: "sse" as const, url: "http://x" },
      { type: "ws" as const, url: "ws://x" },
      { type: "graphql" as const, endpoint: "http://x" },
    ]) {
      const d = base(t);
      const out = applyInjection(d, { headers: { authorization: "Bearer T" } });
      expect((out.transport as { headers?: Record<string, string> }).headers?.authorization).toBe(
        "Bearer T",
      );
    }
  });

  it("leaves sql transport untouched", () => {
    const d = base({ type: "sql", dialect: "postgres", dsn: "postgres://x" });
    const out = applyInjection(d, { headers: { authorization: "T" }, env: { X: "1" } });
    expect(out.transport).toEqual(d.transport);
  });

  it("returns a new descriptor object (immutability)", () => {
    const d = base({ type: "stdio", command: "x" });
    const out = applyInjection(d, { env: { A: "1" } });
    expect(out).not.toBe(d);
    expect(out.transport).not.toBe(d.transport);
  });
});
