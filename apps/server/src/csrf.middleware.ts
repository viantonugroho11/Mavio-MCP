import type { Request, Response, NextFunction } from "express";

const SESSION_COOKIE = "mavio_sid";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defense for session-cookie requests. When a state-changing request
 * carries a `mavio_sid` cookie, we require that the request's Origin (or
 * Referer, as fallback) matches one of the configured trusted origins.
 * Bearer-token (API key) requests are exempt — API keys are not automatically
 * sent by browsers, so the CSRF threat model does not apply.
 *
 * Configure via env: MAVIO_TRUSTED_ORIGINS = "https://console.example.com,https://ops.example.com"
 * In dev (unset), we default to allowing localhost/127.0.0.1 on any port.
 */
export function csrfProtection() {
  const configured = (process.env.MAVIO_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!UNSAFE_METHODS.has(req.method)) return next();

    const cookieHeader = req.headers.cookie ?? "";
    const hasSessionCookie = cookieHeader.split(";").some((c) => c.trim().startsWith(`${SESSION_COOKIE}=`));
    if (!hasSessionCookie) return next(); // API-key auth path — no CSRF risk.

    const origin = (req.headers.origin as string | undefined) ?? "";
    const referer = (req.headers.referer as string | undefined) ?? "";
    const check = origin || referer;
    if (!check) {
      res.status(403).json({
        statusCode: 403,
        error: "CSRF: missing Origin/Referer on session-cookie request",
      });
      return;
    }

    if (isTrustedOrigin(check, configured)) return next();

    res.status(403).json({
      statusCode: 403,
      error: `CSRF: origin ${check} not in trusted list`,
    });
  };
}

export function isTrustedOrigin(headerValue: string, configured: string[]): boolean {
  let origin: string;
  try {
    origin = new URL(headerValue).origin;
  } catch {
    return false;
  }
  if (configured.length > 0) return configured.includes(origin);
  // Dev default: allow localhost/127.0.0.1 on any port.
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}
