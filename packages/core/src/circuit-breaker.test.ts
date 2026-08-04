import { describe, expect, it } from "vitest";
import { CircuitBreaker, CircuitOpenError } from "./index.js";

describe("CircuitBreaker", () => {
  it("stays closed while failures are under threshold", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetMs: 1000 });
    for (let i = 0; i < 2; i++) {
      await expect(cb.execute("srv", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    }
    expect(cb.snapshot("srv")).toBe("closed");
  });

  it("opens after threshold and short-circuits with CircuitOpenError", async () => {
    let now = 1000;
    const cb = new CircuitBreaker({ failureThreshold: 2, resetMs: 5000, now: () => now });
    for (let i = 0; i < 2; i++) {
      await expect(cb.execute("srv", async () => { throw new Error("x"); })).rejects.toThrow();
    }
    expect(cb.snapshot("srv")).toBe("open");
    await expect(cb.execute("srv", async () => "ok")).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("transitions open → half_open after resetMs and closes on success", async () => {
    let now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, resetMs: 100, halfOpenMaxCalls: 1, now: () => now });
    await expect(cb.execute("srv", async () => { throw new Error("f"); })).rejects.toThrow();
    expect(cb.snapshot("srv")).toBe("open");
    now = 200;
    const result = await cb.execute("srv", async () => "ok");
    expect(result).toBe("ok");
    expect(cb.snapshot("srv")).toBe("closed");
  });

  it("re-opens if half_open call fails", async () => {
    let now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, resetMs: 50, now: () => now });
    await expect(cb.execute("srv", async () => { throw new Error("f"); })).rejects.toThrow();
    now = 100;
    await expect(cb.execute("srv", async () => { throw new Error("f2"); })).rejects.toThrow("f2");
    expect(cb.snapshot("srv")).toBe("open");
  });

  it("keys are independent", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetMs: 1000 });
    await expect(cb.execute("a", async () => { throw new Error(); })).rejects.toThrow();
    expect(cb.snapshot("a")).toBe("open");
    expect(cb.snapshot("b")).toBe("closed");
  });
});
