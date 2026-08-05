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
import type { PkceStateStore } from "./pkce.js";
import { InMemoryPkceStateStore } from "./pkce.js";

export interface SlackUserProviderConfig {
  /** Provider id — matches ServerDescriptor.metadata.upstreamOAuthProvider. */
  id?: string;
  clientId: string;
  clientSecret: string;
  /** Slack user scopes (xoxp), e.g. ["chat:write","channels:read","users:read"]. */
  userScopes: string[];
  /** Optional Slack bot scopes if you also want a bot token in the response. */
  botScopes?: string[];
  /**
   * Env var to inject on stdio dispatches — matches the env var the official
   * @modelcontextprotocol/server-slack reads. Default: SLACK_BOT_TOKEN.
   */
  injectEnvVar?: string;
}

interface SlackAuthedUser {
  id: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

interface SlackTokenResponse {
  ok: boolean;
  error?: string;
  access_token?: string;   // bot token (xoxb-…)
  refresh_token?: string;  // bot refresh (rotating tokens feature)
  expires_in?: number;
  scope?: string;
  token_type?: string;
  authed_user?: SlackAuthedUser;
  team?: { id: string; name?: string };
}

const AUTHORIZE_ENDPOINT = "https://slack.com/oauth/v2/authorize";
const TOKEN_ENDPOINT = "https://slack.com/api/oauth.v2.access";
const REVOKE_ENDPOINT = "https://slack.com/api/auth.revoke";

/**
 * Slack OAuth v2 user-scope provider. Produces an xoxp-… USER token that acts
 * as the logged-in user, not the workspace bot. Compatible with rotating
 * tokens (Slack "token rotation") when refresh_token is returned.
 *
 * Injects into stdio env — the community `@modelcontextprotocol/server-slack`
 * reads SLACK_BOT_TOKEN and Slack's Web API accepts xoxp-… wherever xoxb-…
 * works for the corresponding user scopes.
 */
export class SlackUserProvider implements UpstreamCredentialProvider {
  readonly id: string;
  private readonly envVar: string;

  constructor(
    private readonly cfg: SlackUserProviderConfig,
    private readonly state: PkceStateStore = new InMemoryPkceStateStore(),
  ) {
    this.id = cfg.id ?? "slack";
    this.envVar = cfg.injectEnvVar ?? "SLACK_BOT_TOKEN";
  }

  async authorize(ctx: UpstreamProviderAuthorizeContext): Promise<{ url: string }> {
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    await this.state.put(ctx.state, verifier);

    const url = new URL(AUTHORIZE_ENDPOINT);
    url.searchParams.set("client_id", this.cfg.clientId);
    url.searchParams.set("user_scope", this.cfg.userScopes.join(","));
    if (this.cfg.botScopes && this.cfg.botScopes.length > 0) {
      url.searchParams.set("scope", this.cfg.botScopes.join(","));
    }
    url.searchParams.set("state", ctx.state);
    url.searchParams.set(
      "redirect_uri",
      `${ctx.callbackBaseUrl}/auth/upstream/${this.id}/callback`,
    );
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
      code: ctx.code,
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      redirect_uri: `${ctx.callbackBaseUrl}/auth/upstream/${this.id}/callback`,
      code_verifier: verifier,
    });
    return this.postToken(body);
  }

  async refresh(token: UpstreamCredential): Promise<UpstreamCredential> {
    if (!token.refreshToken) {
      // Slack only issues refresh_token when token rotation is enabled on the app.
      // Without it, the user must reconsent.
      throw new MavioError(
        "slack: token rotation not enabled — reconsent required",
        "UPSTREAM_REFRESH_NONE",
      );
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
    });
    const fresh = await this.postToken(body);
    if (!fresh.refreshToken) fresh.refreshToken = token.refreshToken;
    return fresh;
  }

  async revoke(token: UpstreamCredential): Promise<void> {
    await request(REVOKE_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Bearer ${token.accessToken}`,
      },
      body: new URLSearchParams({ token: token.accessToken }).toString(),
    });
  }

  inject(token: UpstreamCredential): DispatchInjection {
    return {
      env: { [this.envVar]: token.accessToken },
      headers: { authorization: `Bearer ${token.accessToken}` },
    };
  }

  private async postToken(body: URLSearchParams): Promise<UpstreamCredential> {
    const res = await request(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
    });
    if (res.statusCode >= 400) {
      const detail = await res.body.text().catch(() => "");
      throw new MavioError(
        `slack token endpoint ${res.statusCode}: ${detail.slice(0, 200)}`,
        "UPSTREAM_TOKEN_HTTP",
      );
    }
    const payload = (await res.body.json()) as SlackTokenResponse;
    if (!payload.ok) {
      throw new MavioError(
        `slack oauth.v2.access error: ${payload.error ?? "unknown"}`,
        "UPSTREAM_TOKEN_SHAPE",
      );
    }
    // User token lives in authed_user for user-scope flows. Fall back to the
    // top-level access_token for pure bot-scope apps (still supported).
    const user = payload.authed_user;
    const accessToken = user?.access_token ?? payload.access_token;
    if (!accessToken) {
      throw new MavioError("slack response missing access_token", "UPSTREAM_TOKEN_SHAPE");
    }
    const expiresIn = user?.expires_in ?? payload.expires_in;
    const scopeStr = user?.scope ?? payload.scope;
    return {
      accessToken,
      refreshToken: user?.refresh_token ?? payload.refresh_token,
      tokenType: user?.token_type ?? payload.token_type ?? "Bearer",
      scopes: scopeStr ? scopeStr.split(/[\s,]+/).filter(Boolean) : undefined,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
      issuer: "https://slack.com",
      subject: user?.id,
    };
  }
}
