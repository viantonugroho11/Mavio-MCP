import { describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { csrfProtection, isTrustedOrigin } from "./csrf.middleware.js";

function mkReq(opts: {
  method?: string;
  cookie?: string;
  origin?: string;
  referer?: string;
}): Request {
  return {
    method: opts.method ?? "POST",
    headers: {
      cookie: opts.cookie,
      origin: opts.origin,
      referer: opts.referer,
    },
  } as unknown as Request;
}

function mkRes(): Response & { _status?: number; _body?: unknown } {
  const res = {
    status: vi.fn(function (this: Response & { _status?: number }, code: number) {
      this._status = code;
      return this;
    }),
    json: vi.fn(function (this: Response & { _body?: unknown }, body: unknown) {
      this._body = body;
      return this;
    }),
  } as unknown as Response & { _status?: number; _body?: unknown };
  return res;
}

describe("csrfProtection middleware", () => {
  it("allows safe methods (GET) unconditionally", () => {
    const next = vi.fn();
    csrfProtection()(mkReq({ method: "GET", cookie: "mavio_sid=abc" }), mkRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("allows POST when no session cookie (API-key path)", () => {
    const next = vi.fn();
    csrfProtection()(mkReq({ method: "POST", origin: "https://evil.example" }), mkRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("blocks POST with session cookie + no Origin/Referer", () => {
    const next = vi.fn();
    const res = mkRes();
    csrfProtection()(mkReq({ method: "POST", cookie: "mavio_sid=abc" }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
  });

  it("blocks POST with session cookie + untrusted Origin", () => {
    process.env.MAVIO_TRUSTED_ORIGINS = "https://console.mavio.dev";
    const next = vi.fn();
    const res = mkRes();
    csrfProtection()(
      mkReq({ method: "POST", cookie: "mavio_sid=abc", origin: "https://evil.example" }),
      res,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(403);
    delete process.env.MAVIO_TRUSTED_ORIGINS;
  });

  it("allows POST with session cookie + trusted Origin", () => {
    process.env.MAVIO_TRUSTED_ORIGINS = "https://console.mavio.dev";
    const next = vi.fn();
    csrfProtection()(
      mkReq({ method: "POST", cookie: "mavio_sid=abc", origin: "https://console.mavio.dev" }),
      mkRes(),
      next,
    );
    expect(next).toHaveBeenCalled();
    delete process.env.MAVIO_TRUSTED_ORIGINS;
  });

  it("falls back to Referer when Origin missing", () => {
    process.env.MAVIO_TRUSTED_ORIGINS = "https://console.mavio.dev";
    const next = vi.fn();
    csrfProtection()(
      mkReq({
        method: "POST",
        cookie: "mavio_sid=abc",
        referer: "https://console.mavio.dev/imports/pending",
      }),
      mkRes(),
      next,
    );
    expect(next).toHaveBeenCalled();
    delete process.env.MAVIO_TRUSTED_ORIGINS;
  });

  it("dev default: allows localhost when MAVIO_TRUSTED_ORIGINS unset", () => {
    delete process.env.MAVIO_TRUSTED_ORIGINS;
    const next = vi.fn();
    csrfProtection()(
      mkReq({ method: "POST", cookie: "mavio_sid=abc", origin: "http://localhost:3000" }),
      mkRes(),
      next,
    );
    expect(next).toHaveBeenCalled();
  });
});

describe("isTrustedOrigin", () => {
  it("matches configured origin exactly", () => {
    expect(isTrustedOrigin("https://a.example", ["https://a.example"])).toBe(true);
    expect(isTrustedOrigin("https://a.example/path", ["https://a.example"])).toBe(true);
    expect(isTrustedOrigin("https://b.example", ["https://a.example"])).toBe(false);
  });
  it("dev default allows localhost/127.0.0.1", () => {
    expect(isTrustedOrigin("http://localhost:3000", [])).toBe(true);
    expect(isTrustedOrigin("http://127.0.0.1:4000", [])).toBe(true);
    expect(isTrustedOrigin("https://evil.example", [])).toBe(false);
  });
  it("rejects garbage input", () => {
    expect(isTrustedOrigin("not-a-url", ["https://a.example"])).toBe(false);
    expect(isTrustedOrigin("", [])).toBe(false);
  });
});
