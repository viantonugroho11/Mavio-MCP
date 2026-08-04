import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { clientIp } from "./audit.module.js";

function req(headers: Record<string, string>, ip?: string, remote?: string): Request {
  return {
    headers,
    ip,
    socket: { remoteAddress: remote } as unknown,
  } as unknown as Request;
}

describe("clientIp", () => {
  it("prefers first entry from x-forwarded-for", () => {
    expect(clientIp(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("1.1.1.1");
  });
  it("trims whitespace", () => {
    expect(clientIp(req({ "x-forwarded-for": "  1.1.1.1  ,2.2.2.2" }))).toBe("1.1.1.1");
  });
  it("falls back to req.ip when no forwarded header", () => {
    expect(clientIp(req({}, "3.3.3.3"))).toBe("3.3.3.3");
  });
  it("falls back to socket.remoteAddress", () => {
    expect(clientIp(req({}, undefined, "4.4.4.4"))).toBe("4.4.4.4");
  });
  it("returns null when nothing available", () => {
    expect(clientIp(req({}))).toBeNull();
  });
});
