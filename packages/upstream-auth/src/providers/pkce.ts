import { createHash, randomBytes } from "node:crypto";
import { request } from "undici";
import { MavioError } from "@mavio/core";
import type {
  DispatchInjection,
  UpstreamCredential,
  UpstreamCredentialProvider,
  UpstreamProviderAuthorizeContext,
  UpstreamProviderExchangeContext,
} from "@mavio/sdk";

export interface Oauth2PkceConfig {
  /** Provider id — matches ServerDescriptor.metadata.upstreamOAuthProvider. */
  id: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  /** Header name to inject on outbound HTTP dispatches. Default: authorization. */
  injectHeader?: string;
  /** Env var name to inject on outbound stdio dispatches. Optional. */
  injectEnvVar?: string;
  /** How many seconds before `expires_at` a token should be refreshed. Default 60. */
  refreshEarlySec?: number;
}

interface PkceState {
  verifier: string;
  createdAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
}

/**
 * Generic OAuth 2.0 Authorization-Code + PKCE provider.
 *
 * State-to-verifier mapping lives in memory keyed by the state token — good
 * enough for a single-node deployment; production replicas plug a
 * Redis-backed PkceStateStore via the constructor.
 */
export interface PkceStateStore {
  put(state: string, verifier: string): Promise<void>;
  take(state: string): Promise<string | null>;
}

export class InMemoryPkceStateStore implements PkceStateStore {
  private readonly map = new Map<string, PkceState>();
  private readonly ttlMs: number;

  constructor(ttlMs = 600_000) {
    this.ttlMs = ttlMs;
  }

  async put(state: string, verifier: string): Promise<void> {
    this.map.set(state, { verifier, createdAt: Date.now() });
    // opportunistic sweep
    for (const [k, v] of this.map) {
      if (Date.now() - v.createdAt > this.ttlMs) this.map.delete(k);
    }
  }

  async take(state: string): Promise<string | null> {
    const entry = this.map.get(state);
    if (!entry) return null;
    this.map.delete(state);
    if (Date.now() - entry.createdAt > this.ttlMs) return null;
    return entry.verifier;
  }
}

export class Oauth2PkceProvider implements UpstreamCredentialProvider {
  readonly id: string;
  private readonly refreshEarly: number;

  constructor(
    private readonly cfg: Oauth2PkceConfig,
    private readonly state: PkceStateStore = new InMemoryPkceStateStore(),
  ) {
    this.id = cfg.id;
    this.refreshEarly = (cfg.refreshEarlySec ?? 60) * 1000;
  }

  async authorize(ctx: UpstreamProviderAuthorizeContext): Promise<{ url: string }> {
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    await this.state.put(ctx.state, verifier);

    const url = new URL(this.cfg.authorizationEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.cfg.clientId);
    url.searchParams.set(
      "redirect_uri",
      `${ctx.callbackBaseUrl}/auth/upstream/${this.cfg.id}/callback`,
    );
    url.searchParams.set("state", ctx.state);
    url.searchParams.set("scope", this.cfg.scopes.join(" "));
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return { url: url.toString() };
  }

  async exchange(ctx: UpstreamProviderExchangeContext): Promise<UpstreamCredential> {
    const verifier = await this.state.take(ctx.state);
    if (!verifier) {
      throw new MavioError(`unknown or expired state: ${ctx.state}`, "UPSTREAM_PKCE_STATE");
    }
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: ctx.code,
      redirect_uri: `${ctx.callbackBaseUrl}/auth/upstream/${this.cfg.id}/callback`,
      client_id: this.cfg.clientId,
      code_verifier: verifier,
    });
    if (this.cfg.clientSecret) body.set("client_secret", this.cfg.clientSecret);
    return this.postToken(body);
  }

  async refresh(token: UpstreamCredential): Promise<UpstreamCredential> {
    if (!token.refreshToken) {
      throw new MavioError(
        `provider ${this.cfg.id}: no refresh_token — user must reconsent`,
        "UPSTREAM_REFRESH_NONE",
      );
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
      client_id: this.cfg.clientId,
    });
    if (this.cfg.clientSecret) body.set("client_secret", this.cfg.clientSecret);
    const fresh = await this.postToken(body);
    // Some IdPs (Google, Slack) omit refresh_token on refresh — reuse the prior one.
    if (!fresh.refreshToken) fresh.refreshToken = token.refreshToken;
    return fresh;
  }

  async revoke(token: UpstreamCredential): Promise<void> {
    if (!this.cfg.revocationEndpoint) return;
    const body = new URLSearchParams({
      token: token.accessToken,
      token_type_hint: "access_token",
      client_id: this.cfg.clientId,
    });
    if (this.cfg.clientSecret) body.set("client_secret", this.cfg.clientSecret);
    await request(this.cfg.revocationEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  }

  inject(token: UpstreamCredential): DispatchInjection {
    const out: DispatchInjection = {};
    const header = this.cfg.injectHeader ?? "authorization";
    out.headers = { [header]: `${token.tokenType ?? "Bearer"} ${token.accessToken}` };
    if (this.cfg.injectEnvVar) {
      out.env = { [this.cfg.injectEnvVar]: token.accessToken };
    }
    return out;
  }

  /** True when the token is unusable now or within the early-refresh window. */
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
        `token endpoint ${res.statusCode}: ${detail.slice(0, 200)}`,
        "UPSTREAM_TOKEN_HTTP",
      );
    }
    const payload = (await res.body.json()) as TokenResponse;
    if (!payload.access_token) {
      throw new MavioError("token endpoint returned no access_token", "UPSTREAM_TOKEN_SHAPE");
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
    };
  }
}
