import { request } from "undici";
import { MavioError } from "@mavio/core";
import type {
  DispatchInjection,
  UpstreamCredential,
  UpstreamCredentialProvider,
  UpstreamProviderAuthorizeContext,
} from "@mavio/sdk";

export interface TokenExchangeConfig {
  /** Provider id — matches ServerDescriptor.metadata.upstreamOAuthProvider. */
  id: string;
  /** Token endpoint (Keycloak: <issuer>/protocol/openid-connect/token). */
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  /** Downstream audience for the exchanged token. Emitted as `audience` param. */
  audience: string;
  /** Optional downstream `resource` param (RFC 8707 style). */
  resource?: string;
  /**
   * Requested token type. Default urn:ietf:params:oauth:token-type:access_token.
   * Some Keycloak deployments issue `urn:ietf:params:oauth:token-type:jwt`.
   */
  requestedTokenType?: string;
  /**
   * Scopes to request on the downstream token. Keycloak treats these as
   * additive to the client's default scopes.
   */
  scopes?: string[];
  /** Header name for injection. Default authorization. */
  injectHeader?: string;
  /** Env var for stdio injection. Optional. */
  injectEnvVar?: string;
  /** Seconds before expiry to preemptively refresh. Default 60. */
  refreshEarlySec?: number;
  /**
   * Resolves the subject token that RFC 8693 will exchange. The middleware
   * feeds the caller's Mavio session, and this callback picks the right
   * upstream token (typically the Keycloak session access token).
   */
  subjectTokenResolver: SubjectTokenResolver;
}

/**
 * Looks up the caller's subject token — typically the access_token minted for
 * the Mavio session by the caller's Mavio-side OIDC login. Runs on every mint;
 * implementations should be cheap (Redis/session cache).
 */
export type SubjectTokenResolver = (input: { principalId: string }) => Promise<
  { token: string; tokenType?: string } | null
>;

interface TokenExchangeResponse {
  access_token: string;
  refresh_token?: string;
  issued_token_type?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
const DEFAULT_REQUESTED_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const DEFAULT_SUBJECT_TYPE = "urn:ietf:params:oauth:token-type:access_token";

/**
 * RFC 8693 token-exchange provider.
 *
 * Use case A — Keycloak SSO: user is already authenticated to Mavio via the
 * regular OIDC flow (login.controller). Keycloak session's access_token is
 * exchanged for a downstream token audience-restricted to a specific backend
 * (e.g. analytics-db-mcp).
 *
 * Use case B — KrakenD gateway: the same mechanism produces a per-user JWT
 * audienced at KrakenD's `aud` policy. KrakenD then attributes / rate-limits
 * per user without any coupling to Mavio.
 *
 * No interactive `authorize()` step: the user has already consented at their
 * primary Mavio session. `mint()` produces the downstream token from that
 * session on demand.
 */
export class TokenExchangeProvider implements UpstreamCredentialProvider {
  readonly id: string;
  private readonly refreshEarly: number;

  constructor(private readonly cfg: TokenExchangeConfig) {
    this.id = cfg.id;
    this.refreshEarly = (cfg.refreshEarlySec ?? 60) * 1000;
  }

  async authorize(_ctx: UpstreamProviderAuthorizeContext): Promise<{ url: string } | null> {
    // No browser round-trip needed — subject token comes from the caller's
    // existing Mavio session. Middleware calls mint() directly.
    return null;
  }

  async mint(input: { principalId: string; subjectToken?: string }): Promise<UpstreamCredential> {
    let subjectToken = input.subjectToken;
    if (!subjectToken) {
      const resolved = await this.cfg.subjectTokenResolver({ principalId: input.principalId });
      if (!resolved) {
        throw new MavioError(
          `no subject token available for principal ${input.principalId}`,
          "UPSTREAM_EXCHANGE_NO_SUBJECT",
        );
      }
      subjectToken = resolved.token;
    }
    const body = new URLSearchParams({
      grant_type: GRANT_TYPE,
      client_id: this.cfg.clientId,
      subject_token: subjectToken,
      subject_token_type: DEFAULT_SUBJECT_TYPE,
      requested_token_type: this.cfg.requestedTokenType ?? DEFAULT_REQUESTED_TYPE,
      audience: this.cfg.audience,
    });
    if (this.cfg.clientSecret) body.set("client_secret", this.cfg.clientSecret);
    if (this.cfg.resource) body.set("resource", this.cfg.resource);
    if (this.cfg.scopes && this.cfg.scopes.length > 0) body.set("scope", this.cfg.scopes.join(" "));
    return this.postToken(body);
  }

  async refresh(token: UpstreamCredential): Promise<UpstreamCredential> {
    // Token-exchange tokens have no refresh_token. Re-mint from the current
    // subject token instead — that's the whole point of the pattern.
    if (!token.subject) {
      throw new MavioError(
        `token-exchange refresh: missing principal binding on token`,
        "UPSTREAM_REFRESH_NONE",
      );
    }
    return this.mint({ principalId: token.subject });
  }

  inject(token: UpstreamCredential): DispatchInjection {
    const out: DispatchInjection = {};
    const header = this.cfg.injectHeader ?? "authorization";
    out.headers = { [header]: `${token.tokenType ?? "Bearer"} ${token.accessToken}` };
    if (this.cfg.injectEnvVar) out.env = { [this.cfg.injectEnvVar]: token.accessToken };
    return out;
  }

  expiringSoon(token: UpstreamCredential): boolean {
    if (!token.expiresAt) return false;
    return token.expiresAt.getTime() - Date.now() <= this.refreshEarly;
  }

  private async postToken(body: URLSearchParams): Promise<UpstreamCredential> {
    const res = await request(this.cfg.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: body.toString(),
    });
    if (res.statusCode >= 400) {
      const detail = await res.body.text().catch(() => "");
      throw new MavioError(
        `token-exchange ${res.statusCode}: ${detail.slice(0, 200)}`,
        "UPSTREAM_TOKEN_HTTP",
      );
    }
    const payload = (await res.body.json()) as TokenExchangeResponse;
    if (!payload.access_token) {
      throw new MavioError("token-exchange response missing access_token", "UPSTREAM_TOKEN_SHAPE");
    }
    const expiresAt = payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000)
      : undefined;
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      tokenType: payload.token_type ?? "Bearer",
      scopes: payload.scope ? payload.scope.split(/[\s,]+/).filter(Boolean) : undefined,
      expiresAt,
      issuer: this.cfg.tokenEndpoint,
    };
  }
}
