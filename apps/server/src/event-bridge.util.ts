import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { Issuer } from "openid-client";
import type { EventAuth } from "@mavio/registry";

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

// Per-issuer JWKS set cache — keyed by jwks_uri, valid for 1h.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const issuerDiscoveryCache = new Map<string, { jwksUri: string; fetchedAt: number }>();
const DISCOVERY_TTL_MS = 3_600_000;

async function getJwksSet(issuerUrl: string): Promise<ReturnType<typeof createRemoteJWKSet>> {
  const cached = issuerDiscoveryCache.get(issuerUrl);
  let jwksUri: string;

  if (cached && Date.now() - cached.fetchedAt < DISCOVERY_TTL_MS) {
    jwksUri = cached.jwksUri;
  } else {
    const issuer = await Issuer.discover(issuerUrl);
    jwksUri = issuer.metadata.jwks_uri as string;
    issuerDiscoveryCache.set(issuerUrl, { jwksUri, fetchedAt: Date.now() });
  }

  const existing = jwksCache.get(jwksUri);
  if (existing) return existing;
  const jwks = createRemoteJWKSet(new URL(jwksUri));
  jwksCache.set(jwksUri, jwks);
  return jwks;
}

async function verifyOidcBearer(
  req: Request,
  auth: EventAuth,
): Promise<VerifyResult> {
  const issuerUrl = auth.issuerUrl;
  if (!issuerUrl) return { ok: false, reason: "oidc auth missing issuerUrl" };

  const header = req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return { ok: false, reason: "missing bearer token" };
  const token = match[1];

  try {
    const jwks = await getJwksSet(issuerUrl);
    await jwtVerify(token, jwks, {
      issuer: issuerUrl,
      audience: auth.audience,
      algorithms: ["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "oidc verify error" };
  }
}

/**
 * Verify inbound webhook authenticity. Supports HMAC-SHA256, mTLS (proxy-
 * validated), and OIDC bearer JWT (RS256/ES256 against issuer JWKS).
 *
 * Header contract for HMAC: `x-mavio-signature: sha256=<hex>` computed over
 * the raw request body using the shared secret from `auth.secretRef`.
 */
export async function verifyIngressAuth(
  req: Request,
  auth: EventAuth,
  rawBody: Buffer,
): Promise<VerifyResult> {
  if (auth.type === "none") return { ok: true };
  if (auth.type === "mtls") {
    // Peer cert validated by terminating proxy or federated-auth.ts.
    return { ok: true };
  }
  if (auth.type === "oidc") return verifyOidcBearer(req, auth);
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
