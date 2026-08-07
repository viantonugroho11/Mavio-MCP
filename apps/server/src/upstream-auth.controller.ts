import { Controller, Get, Inject, Param, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { RbacRepository } from "@mavio/registry";
import type { UpstreamCredential } from "@mavio/sdk";
import type { PrincipalUpstreamCredentialsRepository } from "@mavio/upstream-auth";
import { RBAC_REPO } from "./rbac.module.js";
import { resolvePrincipalFromRequest } from "./principal-resolver.js";
import { SessionStore } from "./session.store.js";
import { SESSION_STORE } from "./session.module.js";
import { AuditService, clientIp } from "./audit.module.js";
import { UPSTREAM_CREDS_REPO, UPSTREAM_PROVIDERS } from "./upstream-auth.tokens.js";
import { UpstreamProviderRegistry } from "./upstream-auth.module.js";

/**
 * Consent flow for per-principal upstream OAuth providers (ADR-018).
 *
 * Flow:
 *   1. Mavio-authenticated user hits GET /auth/upstream/:providerId/login
 *   2. Server builds provider.authorize() URL with state → returnTo mapping
 *      and redirects the browser to the IdP.
 *   3. IdP redirects back to /auth/upstream/:providerId/callback?code=&state=
 *   4. Server calls provider.exchange() → persists credential in vault
 *      (encrypted) → 302 to the original returnTo.
 *
 * The Mavio session cookie is required at step 1 — this endpoint is for
 * *already-logged-in* users who need to authorize an upstream app on top of
 * their existing Mavio identity.
 */
@Controller("auth/upstream")
export class UpstreamAuthController {
  constructor(
    @Inject(UPSTREAM_PROVIDERS) private readonly providers: UpstreamProviderRegistry,
    @Inject(UPSTREAM_CREDS_REPO)
    private readonly repo: PrincipalUpstreamCredentialsRepository,
    @Inject(RBAC_REPO) private readonly rbac: RbacRepository,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    private readonly audit: AuditService,
  ) {}

  @Get(":providerId/login")
  async login(
    @Param("providerId") providerId: string,
    @Query("return_to") returnTo: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const principal = await resolvePrincipalFromRequest(req, this.rbac, {
      sessions: this.sessions,
    }).catch(() => undefined);
    if (!principal) {
      res.status(401).json({ error: "mavio session required — log in first" });
      return;
    }
    const provider = this.providers.get(providerId);
    if (!provider) {
      res.status(404).json({ error: `unknown upstream provider: ${providerId}` });
      return;
    }
    const base = publicBaseUrl(req);
    // State encodes principal + return_to so callback (which is unauthenticated
    // per OAuth spec) can bind the exchanged credential to the right user.
    const state = `${principal.id}::${Date.now()}::${Math.random().toString(36).slice(2, 10)}`;
    await this.sessions.saveState(
      {
        providerId: `upstream:${providerId}`,
        codeVerifier: "",
        nonce: "",
        state,
        returnTo: safeReturnTo(returnTo),
      },
      600,
    );

    const authorization = await provider.authorize({
      principalId: principal.id,
      state,
      returnTo: safeReturnTo(returnTo),
      callbackBaseUrl: base,
    });
    if (!authorization) {
      // Non-interactive provider (token-exchange) — mint now and redirect.
      if (!provider.mint) {
        res.status(500).json({ error: `provider ${providerId} has no authorize or mint path` });
        return;
      }
      try {
        const cred = await provider.mint({ principalId: principal.id });
        await this.persist(principal.id, providerId, cred);
        this.audit.log({
          actorId: principal.id,
          actorType: principal.type,
          action: "upstream.token.issue",
          resource: { providerId },
          outcome: "ok",
          metadata: { mode: "mint" },
          ip: clientIp(req),
        });
        res.redirect(302, safeReturnTo(returnTo));
      } catch (err) {
        res.status(502).json({
          error: `mint failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    res.redirect(302, authorization.url);
  }

  @Get(":providerId/callback")
  async callback(
    @Param("providerId") providerId: string,
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (error) {
      res.status(400).json({ error: `provider error: ${error}` });
      return;
    }
    if (!code || !state) {
      res.status(400).json({ error: "missing code or state" });
      return;
    }
    const stored = await this.sessions.consumeState(state);
    if (!stored || stored.providerId !== `upstream:${providerId}`) {
      res.status(400).json({ error: "state mismatch or expired" });
      return;
    }
    const principalId = state.split("::")[0];
    if (!principalId) {
      res.status(400).json({ error: "malformed state" });
      return;
    }
    const provider = this.providers.get(providerId);
    if (!provider || !provider.exchange) {
      res.status(404).json({ error: `unknown or non-exchange provider: ${providerId}` });
      return;
    }
    const base = publicBaseUrl(req);

    let cred;
    try {
      cred = await provider.exchange({
        principalId,
        code,
        state,
        callbackBaseUrl: base,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.audit.log({
        actorId: principalId,
        actorType: "user",
        action: "upstream.token.issue",
        resource: { providerId },
        outcome: "error",
        metadata: { detail },
        ip: clientIp(req),
      });
      res.status(502).json({ error: `exchange failed: ${detail}` });
      return;
    }

    await this.persist(principalId, providerId, cred);
    this.audit.log({
      actorId: principalId,
      actorType: "user",
      action: "upstream.token.issue",
      resource: { providerId },
      outcome: "ok",
      metadata: { mode: "authcode", scopes: cred.scopes ?? [] },
      ip: clientIp(req),
    });
    res.redirect(302, stored.returnTo);
  }

  private async persist(
    principalId: string,
    providerId: string,
    cred: UpstreamCredential,
  ): Promise<void> {
    await this.repo.put({
      principalId,
      providerId,
      accessToken: cred.accessToken,
      refreshToken: cred.refreshToken,
      tokenType: cred.tokenType,
      scopes: cred.scopes,
      expiresAt: cred.expiresAt,
      issuer: cred.issuer,
      subject: cred.subject,
    });
  }
}

function publicBaseUrl(req: Request): string {
  return (
    process.env.MAVIO_PUBLIC_BASE_URL ??
    `${req.protocol}://${req.get("host") ?? "localhost"}`
  );
}

function safeReturnTo(value: string | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
