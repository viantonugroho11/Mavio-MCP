import { request } from "undici";
import type { Principal } from "@mavio/core";
import type { Action, Decision, PolicyEngine, ResourceRef } from "@mavio/rbac";

export interface RemoteHttpPolicyConfig {
  /** Full URL to POST decision requests to. */
  url: string;
  /** Optional bearer token. */
  token?: string;
  /** Additional headers. */
  headers?: Record<string, string>;
  /** Milliseconds to wait before rejecting. Defaults to 2000. */
  timeoutMs?: number;
  /** How to interpret non-boolean responses; defaults to closed (deny). */
  failClosed?: boolean;
}

interface QueryPayload {
  principal: Principal;
  action: Action;
  resource: ResourceRef;
}

/**
 * Generic HTTP policy engine. POSTs `{input: {principal, action, resource}}`
 * to the configured URL and expects `{result: {allow: bool, reason?: string}}`
 * (OPA-shaped) OR `{allow: bool, reason?: string}` (flat) OR bare bool.
 *
 * `OpaPolicyEngine` and `CedarSidecarPolicyEngine` are thin wrappers that just
 * pick sensible default URLs / payload shape for those services.
 */
export class RemoteHttpPolicyEngine implements PolicyEngine {
  private readonly timeoutMs: number;

  constructor(protected readonly cfg: RemoteHttpPolicyConfig) {
    this.timeoutMs = cfg.timeoutMs ?? 2000;
  }

  protected buildBody(payload: QueryPayload): unknown {
    return { input: payload };
  }

  async can(principal: Principal, action: Action, resource: ResourceRef): Promise<Decision> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(this.cfg.headers ?? {}),
    };
    if (this.cfg.token) headers.authorization = `Bearer ${this.cfg.token}`;
    try {
      const res = await request(this.cfg.url, {
        method: "POST",
        headers,
        body: JSON.stringify(this.buildBody({ principal, action, resource })),
        signal: controller.signal,
      });
      if (res.statusCode >= 400) {
        return {
          allowed: !this.cfg.failClosed ? false : false,
          reason: `policy service ${res.statusCode}`,
        };
      }
      const body = (await res.body.json()) as unknown;
      return parseDecision(body);
    } catch (err) {
      return { allowed: false, reason: `policy service error: ${(err as Error).message}` };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * OPA policy engine. Points at an OPA server, typically
 * `http://opa:8181/v1/data/mavio/authz/allow`. Default rule shape:
 *   package mavio.authz
 *   default allow = false
 *   allow { ... }
 */
export class OpaPolicyEngine extends RemoteHttpPolicyEngine {
  protected override buildBody(payload: QueryPayload): unknown {
    return { input: payload };
  }
}

/**
 * Cedar sidecar policy engine (e.g. cedar-agent). Cedar's HTTP protocol also
 * accepts `{principal, action, resource}` — we tunnel the same payload.
 */
export class CedarSidecarPolicyEngine extends RemoteHttpPolicyEngine {
  protected override buildBody(payload: QueryPayload): unknown {
    return {
      principal: `Mavio::User::"${payload.principal.id}"`,
      action: `Mavio::Action::"${payload.action}"`,
      resource: payload.resource,
      context: { workspaceId: payload.principal.workspaceId, scopes: payload.principal.scopes },
    };
  }
}

function parseDecision(raw: unknown): Decision {
  if (typeof raw === "boolean") return { allowed: raw, reason: raw ? "remote allow" : "remote deny" };
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const flat = extractAllow(obj);
    if (flat !== undefined) {
      return {
        allowed: flat.allow,
        reason: flat.reason ?? (flat.allow ? "remote allow" : "remote deny"),
      };
    }
    const nested = obj.result;
    if (nested && typeof nested === "object") {
      const inner = extractAllow(nested as Record<string, unknown>);
      if (inner !== undefined) {
        return {
          allowed: inner.allow,
          reason: inner.reason ?? (inner.allow ? "remote allow" : "remote deny"),
        };
      }
      if (typeof nested === "boolean") {
        return { allowed: nested, reason: nested ? "remote allow" : "remote deny" };
      }
    }
  }
  return { allowed: false, reason: "policy service returned unrecognized shape" };
}

function extractAllow(obj: Record<string, unknown>): { allow: boolean; reason?: string } | undefined {
  const allow = obj.allow ?? obj.decision ?? obj.allowed;
  if (typeof allow === "boolean") {
    const reason = typeof obj.reason === "string" ? obj.reason : undefined;
    return { allow, reason };
  }
  return undefined;
}
