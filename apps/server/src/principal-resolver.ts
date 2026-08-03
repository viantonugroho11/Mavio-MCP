import type { Request } from "express";
import { parse as parseCookie } from "cookie";
import type { Principal } from "@mavio/core";
import { UnauthorizedError } from "@mavio/core";
import type { RbacRepository } from "@mavio/registry";
import type { SessionStore } from "./session.store.js";

export interface ResolveOptions {
  strict?: boolean;
  sessions?: SessionStore;
}

const COOKIE_NAME = "mavio_sid";

export async function resolvePrincipalFromRequest(
  req: Request,
  rbac: RbacRepository,
  opts: ResolveOptions = {},
): Promise<Principal | undefined> {
  // 1. Session cookie (web console).
  if (opts.sessions) {
    const cookieHeader = req.headers.cookie;
    const sid = cookieHeader ? parseCookie(cookieHeader)[COOKIE_NAME] : undefined;
    if (sid) {
      const session = await opts.sessions.read(sid);
      if (session) {
        return {
          id: session.principalId,
          type: "user",
          workspaceId: session.workspaceId,
          scopes: [],
        };
      }
    }
  }

  // 2. Bearer token (API keys, admin, dev fallback).
  const header = req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];
  const adminKey = process.env.MAVIO_ADMIN_API_KEY;

  if (token && adminKey && token === adminKey) {
    return { id: "admin", type: "service", workspaceId: "default", scopes: ["*"] };
  }
  if (token) {
    const stored = await rbac.findByApiKey(token);
    if (stored) {
      return { id: stored.id, type: stored.type, workspaceId: stored.workspaceId, scopes: [] };
    }
  }
  if (!adminKey) {
    return { id: "dev", type: "service", workspaceId: "default", scopes: ["*"] };
  }
  if (opts.strict) throw new UnauthorizedError("invalid api key");
  return undefined;
}
