import type { Request } from "express";
import type { TLSSocket } from "node:tls";
import type { Principal } from "@mavio/core";

/**
 * Federated identity resolvers.
 *
 * mTLS and SAML in enterprise deployments are normally terminated at a
 * trusted reverse proxy (Envoy, NGINX, Pomerium, oauth2-proxy) which
 * validates the client cert / SAML assertion and forwards the verified
 * subject on trusted headers. We do the same here.
 *
 * Also supports native mTLS when TLS terminates on the Node process itself
 * (peer certificate exposed via `req.socket.getPeerCertificate()`).
 */

const TRUSTED_HEADER_SUBJECT = "x-auth-subject";
const TRUSTED_HEADER_TYPE = "x-auth-type";
const TRUSTED_HEADER_WORKSPACE = "x-auth-workspace";
const TRUSTED_HEADER_SCOPES = "x-auth-scopes";

export function trustedHeaderPrincipal(req: Request): Principal | undefined {
  if (process.env.MAVIO_TRUSTED_PROXY_ENABLED !== "1") return undefined;
  const subject = header(req, TRUSTED_HEADER_SUBJECT);
  if (!subject) return undefined;
  const type = (header(req, TRUSTED_HEADER_TYPE) ?? "user").toLowerCase();
  const workspace = header(req, TRUSTED_HEADER_WORKSPACE) ?? "default";
  const scopes = (header(req, TRUSTED_HEADER_SCOPES) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    id: subject,
    type: type === "service" ? "service" : "user",
    workspaceId: workspace,
    scopes,
  };
}

/**
 * Extract principal from a directly-terminated mTLS session. Enable with
 * `MAVIO_MTLS_ENABLED=1`. Node HTTPS server must be started with
 * `requestCert: true` for this to have anything to read.
 */
export function mtlsPrincipal(req: Request): Principal | undefined {
  if (process.env.MAVIO_MTLS_ENABLED !== "1") return undefined;
  const socket = req.socket as TLSSocket | undefined;
  if (!socket || typeof socket.getPeerCertificate !== "function") return undefined;
  const cert = socket.getPeerCertificate();
  if (!cert || Object.keys(cert).length === 0) return undefined;
  if (typeof (socket as { authorized?: boolean }).authorized === "boolean" && !(socket as { authorized: boolean }).authorized) {
    return undefined;
  }
  const subjectCn = cert.subject?.CN;
  if (!subjectCn) return undefined;
  return {
    id: `cn:${subjectCn}`,
    type: "service",
    workspaceId: process.env.MAVIO_MTLS_WORKSPACE ?? "default",
    scopes: [],
  };
}

function header(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}
