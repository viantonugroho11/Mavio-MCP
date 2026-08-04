import { describe, expect, it } from "vitest";
import type { ServerCapabilities, ToolDefinition } from "@mavio/core";
import { diffCapabilities } from "./diff.js";

const tool = (name: string, description = "d"): ToolDefinition => ({
  name,
  description,
  inputSchema: { type: "object", properties: {} },
});

const caps = (tools: ToolDefinition[]): ServerCapabilities => ({ tools });

describe("diffCapabilities", () => {
  it("detects additions", () => {
    const d = diffCapabilities(caps([tool("a")]), caps([tool("a"), tool("b")]));
    expect(d.added.map((c) => c.name)).toEqual(["b"]);
    expect(d.removed).toEqual([]);
    expect(d.unchanged).toBe(1);
  });

  it("detects removals", () => {
    const d = diffCapabilities(caps([tool("a"), tool("b")]), caps([tool("a")]));
    expect(d.removed.map((c) => c.name)).toEqual(["b"]);
    expect(d.added).toEqual([]);
  });

  it("detects description-only changes", () => {
    const d = diffCapabilities(caps([tool("a", "old")]), caps([tool("a", "new")]));
    expect(d.changed.map((c) => c.name)).toEqual(["a"]);
    expect(d.unchanged).toBe(0);
  });

  it("counts unchanged", () => {
    const d = diffCapabilities(caps([tool("a"), tool("b")]), caps([tool("a"), tool("b")]));
    expect(d.unchanged).toBe(2);
    expect(d.changed).toEqual([]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("handles empty capabilities", () => {
    const d = diffCapabilities(caps([]), caps([tool("a")]));
    expect(d.added.map((c) => c.name)).toEqual(["a"]);
  });
});
