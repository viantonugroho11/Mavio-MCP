import { Controller, Get, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { generators } from "openid-client";
import { parse as parseCookie, serialize as serializeCookie } from "cookie";
import type { Principal } from "@mavio/core";
import { RbacRepository } from "@mavio/registry";
import { OIDC_PROVIDER_REPO } from "./auth.module.js";
import { OidcClientCache } from "./oidc-client.cache.js";
import { SessionStore } from "./session.store.js";
import { OIDC_CLIENT_CACHE, SESSION_STORE, SESSION_TTL } from "./session.module.js";
import { RBAC_REPO } from "./rbac.module.js";
import { AuditService, clientIp } from "./audit.module.js";
import type { PrincipalUpstreamCredentialsRepository } from "@mavio/upstream-auth";
import { UPSTREAM_CREDS_REPO } from "./upstream-auth.tokens.js";

const COOKIE_NAME = "mavio_sid";

@Controller("auth")
export class LoginController {
  constructor(
    @Inject(OIDC_CLIENT_CACHE) private readonly clients: OidcClientCache,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(SESSION_TTL) private readonly ttlSeconds: number,
    @Inject(RBAC_REPO) private readonly rbac: RbacRepository,
    @Inject(UPSTREAM_CREDS_REPO)
    private readonly upstreamRepo: PrincipalUpstreamCredentialsRepository,
    private readonly audit: AuditService,
  ) {}

  @Get(":providerId/login")
  async login(
    @Param("providerId") providerId: string,
    @Query("return_to") returnTo: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const provider = await this.clients.getProvider(providerId);
    if (!provider.enabled) {
      res.status(404).json({ error: "provider not enabled" });
      return;
    }
    const client = await this.clients.getClient(provider);

    const state = generators.state();
    const nonce = generators.nonce();
    const codeVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(codeVerifier);

    await this.sessions.saveState({
      providerId,
      codeVerifier,
      nonce,
      state,
      returnTo: safeReturnTo(returnTo),
    });

    const url = client.authorizationUrl({
      scope: provider.scopes.join(" "),
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    res.redirect(302, url);
  }

  @Get(":providerId/callback")
  async callback(
    @Param("providerId") providerId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const provider = await this.clients.getProvider(providerId);
    const client = await this.clients.getClient(provider);
    const params = client.callbackParams(req);

    if (!params.state) {
      res.status(400).json({ error: "missing state" });
      return;
    }
    const stored = await this.sessions.consumeState(params.state);
    if (!stored || stored.providerId !== providerId) {
      res.status(400).json({ error: "state mismatch or expired" });
      return;
    }

    const tokenSet = await client.callback(provider.redirectUri, params, {
      state: stored.state,
      nonce: stored.nonce,
      code_verifier: stored.codeVerifier,
    });

    const claims = tokenSet.claims();
    if (!claims.sub) {
      res.status(400).json({ error: "id token missing sub" });
      return;
    }

    const principalId = `oidc:${providerId}:${claims.sub}`;
    const email = typeof claims.email === "string" ? claims.email : undefined;
    const displayName =
      (typeof claims.name === "string" && claims.name) ||
      (typeof claims.preferred_username === "string" && claims.preferred_username) ||
      email ||
      principalId;
    const workspaceId = "default";

    const { created } = await this.rbac.ensurePrincipal({
      id: principalId,
      type: "user",
      displayName,
      workspaceId,
    });
    if (created) {
      const defaultRole = process.env.MAVIO_OIDC_DEFAULT_ROLE;
      if (defaultRole) {
        await this.rbac
          .assign({
            principalId,
            roleName: defaultRole,
            scope: { workspace: workspaceId },
          })
          .catch((err) => console.warn(`[oidc] default role assign failed: ${err}`));
      }
    }

    const sid = await this.sessions.create({
      principalId,
      providerId,
      workspaceId,
      email,
      displayName,
    });

    // Capture the IdP access + refresh tokens so token-exchange providers
    // (Keycloak, KrakenD) can mint audience-restricted downstream tokens on
    // behalf of this user. Stored under a fixed synthetic provider id so the
    // subject-token resolver finds it regardless of which OIDC provider the
    // user picked.
    if (tokenSet.access_token) {
      const subjectProviderId =
        process.env.MAVIO_TOKENX_SUBJECT_PROVIDER_ID ?? "mavio-session";
      try {
        await this.upstreamRepo.put({
          principalId,
          providerId: subjectProviderId,
          accessToken: tokenSet.access_token,
          refreshToken: tokenSet.refresh_token,
          tokenType: tokenSet.token_type ?? "Bearer",
          scopes: provider.scopes,
          expiresAt: tokenSet.expires_at
            ? new Date(tokenSet.expires_at * 1000)
            : undefined,
          issuer: provider.issuerUrl,
          subject: claims.sub,
        });
      } catch (err) {
        console.warn(
          `[oidc] failed to persist IdP subject token for ${principalId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    this.audit.log({
      actorId: principalId,
      actorType: "user",
      action: "auth.login",
      resource: { providerId },
      outcome: "ok",
      metadata: { created, email },
      ip: clientIp(req),
    });

    res.setHeader(
      "set-cookie",
      serializeCookie(COOKIE_NAME, sid, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: this.ttlSeconds,
      }),
    );
    res.redirect(302, stored.returnTo);
  }

  @Post("logout")
  async logout(@Req() req: Request, @Res() res: Response): Promise<void> {
    const sid = readSidCookie(req);
    let principalId: string | null = null;
    if (sid) {
      const data = await this.sessions.read(sid);
      principalId = data?.principalId ?? null;
      await this.sessions.destroy(sid);
    }
    this.audit.log({
      actorId: principalId,
      actorType: principalId ? "user" : null,
      action: "auth.logout",
      outcome: "ok",
      ip: clientIp(req),
    });
    res.setHeader(
      "set-cookie",
      serializeCookie(COOKIE_NAME, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
      }),
    );
    res.status(204).end();
  }

  @Get("me")
  async me(@Req() req: Request, @Res() res: Response): Promise<void> {
    const sid = readSidCookie(req);
    if (!sid) {
      res.status(401).json({ error: "no session" });
      return;
    }
    const data = await this.sessions.read(sid);
    if (!data) {
      res.status(401).json({ error: "session expired" });
      return;
    }
    const principal: Principal = {
      id: data.principalId,
      type: "user",
      workspaceId: data.workspaceId,
      scopes: [],
    };
    res.json({
      principal,
      email: data.email,
      displayName: data.displayName,
      providerId: data.providerId,
      expiresAt: data.expiresAt,
    });
  }
}

function readSidCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  const cookies = parseCookie(header);
  return cookies[COOKIE_NAME];
}

function safeReturnTo(input: string | undefined): string {
  if (!input) return "/";
  if (input.startsWith("/") && !input.startsWith("//")) return input;
  return "/";
}
