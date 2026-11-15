import { describe, it, expect } from "vitest";
import type { ToolDefinition } from "@mavio/core";
import { annotationsForEffect, resolveToolEffect } from "./tool-effect.js";

const tool = (over: Partial<ToolDefinition> = {}): ToolDefinition => ({
  name: "t",
  inputSchema: { type: "object" },
  ...over,
});

describe("resolveToolEffect", () => {
  it("defaults to destructive with no signal", () => {
    expect(resolveToolEffect(tool(), undefined)).toBe("destructive");
  });

  it("reads upstream MCP annotations", () => {
    expect(resolveToolEffect(tool({ annotations: { readOnlyHint: true } }), undefined)).toBe("read");
    expect(resolveToolEffect(tool({ annotations: { readOnlyHint: false, destructiveHint: false } }), undefined)).toBe("write");
    expect(resolveToolEffect(tool({ annotations: { destructiveHint: true } }), undefined)).toBe("destructive");
  });

  it("treats readOnlyHint:false without destructiveHint as destructive (MCP default)", () => {
    expect(resolveToolEffect(tool({ annotations: { readOnlyHint: false } }), undefined)).toBe("destructive");
  });

  it("infers read from importer metadata", () => {
    const http = (method: string) => tool({ inputSchema: { "x-mavio-http": { method, path: "/x" } } });
    expect(resolveToolEffect(http("get"), undefined)).toBe("read");
    expect(resolveToolEffect(http("HEAD"), undefined)).toBe("read");
    expect(resolveToolEffect(http("POST"), undefined)).toBe("destructive");
    expect(resolveToolEffect(tool({ inputSchema: { "x-mavio-sql": { kind: "select" } } }), undefined)).toBe("read");
    expect(resolveToolEffect(tool({ inputSchema: { "x-mavio-graphql": { operation: "query" } } }), undefined)).toBe("read");
    expect(resolveToolEffect(tool({ inputSchema: { "x-mavio-graphql": { operation: "mutation" } } }), undefined)).toBe("destructive");
  });

  it("admin override wins over annotations and inference", () => {
    const t = tool({ annotations: { readOnlyHint: true }, inputSchema: { "x-mavio-http": { method: "GET" } } });
    expect(resolveToolEffect(t, { toolEffects: { t: "destructive" } })).toBe("destructive");
  });

  it("ignores invalid override values", () => {
    expect(resolveToolEffect(tool({ annotations: { readOnlyHint: true } }), { toolEffects: { t: "safe" } })).toBe("read");
  });
});

describe("annotationsForEffect", () => {
  it("sets hints to match the effect and keeps other upstream fields", () => {
    expect(annotationsForEffect("read", { title: "List", idempotentHint: true })).toEqual({
      title: "List",
      idempotentHint: true,
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(annotationsForEffect("write", undefined)).toEqual({ readOnlyHint: false, destructiveHint: false });
    expect(annotationsForEffect("destructive", undefined)).toEqual({ readOnlyHint: false, destructiveHint: true });
  });
});
