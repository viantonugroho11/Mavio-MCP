import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import type { EventAuth } from "@mavio/registry";

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Verify inbound webhook authenticity. M2 supports HMAC-SHA256 only; mTLS
 * and OIDC are validated by upstream layers or deferred to M4.
 *
 * Header contract: `x-mavio-signature: sha256=<hex>` computed over the raw
 * request body using the shared secret resolved from `auth.secretRef` (env
 * var name in M2 — Vault-backed lookup lands in M4).
 */
export function verifyIngressAuth(
  req: Request,
  auth: EventAuth,
  rawBody: Buffer,
): VerifyResult {
  if (auth.type === "none") return { ok: true };
  if (auth.type === "mtls") {
    // The mTLS peer cert is validated by the terminating proxy or by
    // federated-auth.ts before the route handler runs. Trust the transport.
    return { ok: true };
  }
  if (auth.type === "oidc") {
    // OIDC bearer validation lands in M4 alongside per-route audience checks.
    return { ok: false, reason: "oidc ingress not implemented in M2" };
  }
  if (auth.type !== "hmac") return { ok: false, reason: `unknown auth type: ${String(auth.type)}` };

  const ref = auth.secretRef;
  if (!ref) return { ok: false, reason: "hmac auth missing secretRef" };
  const secret = process.env[ref];
  if (!secret) return { ok: false, reason: `hmac secret env ${ref} not set` };

  const header = req.header("x-mavio-signature") ?? "";
  const match = header.match(/^sha256=([a-f0-9]{64})$/i);
  if (!match) return { ok: false, reason: "invalid signature header" };

  const provided = Buffer.from(match[1]!, "hex");
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  if (provided.length !== expected.length) return { ok: false, reason: "signature length mismatch" };
  if (!timingSafeEqual(provided, expected)) return { ok: false, reason: "signature mismatch" };
  return { ok: true };
}

/**
 * Build tool arguments from the webhook payload.
 *
 * If `argsTemplate` is unset, forward the parsed JSON body verbatim as
 * `arguments`. If set, do a shallow render: string values matching
 * `${body}` pass the whole body; `${body.path.to.field}` extracts a nested
 * value. Non-matching values pass through unchanged. Deep template DSL is
 * deferred — most integrations only need the two shapes above.
 */
export function renderArgs(
  template: Record<string, unknown> | undefined,
  body: unknown,
): Record<string, unknown> {
  if (!template) {
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : { body };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(template)) {
    out[k] = renderValue(v, body);
  }
  return out;
}

function renderValue(v: unknown, body: unknown): unknown {
  if (typeof v !== "string") return v;
  const m = v.match(/^\$\{body(?:\.([\w.]+))?\}$/);
  if (!m) return v;
  const path = m[1];
  if (!path) return body;
  let cur: unknown = body;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}
