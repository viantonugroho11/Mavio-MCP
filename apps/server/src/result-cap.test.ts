import { describe, it, expect } from "vitest";
import { capResultText, DEFAULT_MAX_RESULT_CHARS } from "./result-cap.js";

describe("capResultText", () => {
  it("returns text unchanged at or under the cap", () => {
    const text = "x".repeat(100);
    expect(capResultText(text, 100)).toEqual({ text, truncated: false, totalChars: 100 });
  });

  it("cuts past the cap and appends a notice with sizes", () => {
    const text = "a".repeat(150);
    const r = capResultText(text, 100);
    expect(r.truncated).toBe(true);
    expect(r.totalChars).toBe(150);
    expect(r.text.startsWith("a".repeat(100) + "\n…[result truncated: 150 chars total, showing first 100.")).toBe(true);
    expect(r.text).toContain("limit/fields/pagination");
  });

  it("leaves truncated JSON unparseable", () => {
    const json = JSON.stringify({ items: Array.from({ length: 50 }, (_, i) => ({ id: i, name: `item-${i}` })) });
    const r = capResultText(json, 200);
    expect(r.truncated).toBe(true);
    expect(() => JSON.parse(r.text)).toThrow();
  });

  it("does not split a surrogate pair at the boundary", () => {
    const text = "ab" + "😀" + "cd"; // 😀 occupies indexes 2-3
    const r = capResultText(text, 3);
    expect(r.text.startsWith("ab\n")).toBe(true);
    expect(r.text).toContain("showing first 2.");
  });

  it("defaults to 60,000 chars", () => {
    expect(DEFAULT_MAX_RESULT_CHARS).toBe(60_000);
  });
});
