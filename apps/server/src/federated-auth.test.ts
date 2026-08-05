import { describe, expect, it, afterEach } from "vitest";
import type { Request } from "express";
import { mtlsPrincipal, trustedHeaderPrincipal } from "./federated-auth.js";

function mkReq(headers: Record<string, string>, socket?: unknown): Request {
  return { headers, socket } as unknown as Request;
}

afterEach(() => {
  delete process.env.MAVIO_TRUSTED_PROXY_ENABLED;
  delete process.env.MAVIO_MTLS_ENABLED;
  delete process.env.MAVIO_MTLS_WORKSPACE;
});

describe("trustedHeaderPrincipal", () => {
  it("returns undefined when feature flag off", () => {
    expect(trustedHeaderPrincipal(mkReq({ "x-auth-subject": "alice" }))).toBeUndefined();
  });

  it("returns undefined without subject header", () => {
    process.env.MAVIO_TRUSTED_PROXY_ENABLED = "1";
    expect(trustedHeaderPrincipal(mkReq({}))).toBeUndefined();
  });

  it("parses subject + type + workspace + scopes", () => {
    process.env.MAVIO_TRUSTED_PROXY_ENABLED = "1";
    const p = trustedHeaderPrincipal(
      mkReq({
        "x-auth-subject": "alice@example.com",
        "x-auth-type": "user",
        "x-auth-workspace": "acme",
        "x-auth-scopes": "server:read, tool:invoke",
      }),
    );
    expect(p).toEqual({
      id: "alice@example.com",
      type: "user",
      workspaceId: "acme",
      scopes: ["server:read", "tool:invoke"],
    });
  });

  it("defaults type to user and workspace to default", () => {
    process.env.MAVIO_TRUSTED_PROXY_ENABLED = "1";
    const p = trustedHeaderPrincipal(mkReq({ "x-auth-subject": "svc" }));
    expect(p?.type).toBe("user");
    expect(p?.workspaceId).toBe("default");
  });

  it("collapses unknown type to user", () => {
    process.env.MAVIO_TRUSTED_PROXY_ENABLED = "1";
    const p = trustedHeaderPrincipal(mkReq({ "x-auth-subject": "svc", "x-auth-type": "robot" }));
    expect(p?.type).toBe("user");
  });
});

describe("mtlsPrincipal", () => {
  it("returns undefined when flag off", () => {
    const socket = {
      authorized: true,
      getPeerCertificate: () => ({ subject: { CN: "cn1" } }),
    };
    expect(mtlsPrincipal(mkReq({}, socket))).toBeUndefined();
  });

  it("returns principal from peer cert CN when authorized", () => {
    process.env.MAVIO_MTLS_ENABLED = "1";
    process.env.MAVIO_MTLS_WORKSPACE = "svc";
    const socket = {
      authorized: true,
      getPeerCertificate: () => ({ subject: { CN: "worker-1" } }),
    };
    const p = mtlsPrincipal(mkReq({}, socket));
    expect(p).toEqual({ id: "cn:worker-1", type: "service", workspaceId: "svc", scopes: [] });
  });

  it("refuses unauthorized peer cert", () => {
    process.env.MAVIO_MTLS_ENABLED = "1";
    const socket = {
      authorized: false,
      getPeerCertificate: () => ({ subject: { CN: "worker-1" } }),
    };
    expect(mtlsPrincipal(mkReq({}, socket))).toBeUndefined();
  });

  it("returns undefined when cert has no CN", () => {
    process.env.MAVIO_MTLS_ENABLED = "1";
    const socket = {
      authorized: true,
      getPeerCertificate: () => ({ subject: {} }),
    };
    expect(mtlsPrincipal(mkReq({}, socket))).toBeUndefined();
  });
});
