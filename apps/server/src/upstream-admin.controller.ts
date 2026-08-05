import {
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { Actions } from "@mavio/rbac";
import type { PrincipalUpstreamCredentialsRepository } from "@mavio/upstream-auth";
import { ApiKeyGuard } from "./auth.guard.js";
import { RbacGuard, RequirePermission } from "./rbac.guard.js";
import {
  UPSTREAM_CREDS_REPO,
  UPSTREAM_PROVIDERS,
  UpstreamProviderRegistry,
} from "./upstream-auth.module.js";
import { AuditService, clientIp } from "./audit.module.js";

interface UpstreamTokenView {
  providerId: string;
  tokenType: string;
  scopes: string[];
  expiresAt: string | null;
  issuer: string | null;
  subject: string | null;
  keyId: string;
  updatedAt: string;
  expired: boolean;
}

@Controller("api/rbac/principals/:id/upstream-tokens")
@UseGuards(ApiKeyGuard, RbacGuard)
export class UpstreamAdminController {
  constructor(
    @Inject(UPSTREAM_CREDS_REPO)
    private readonly repo: PrincipalUpstreamCredentialsRepository,
    @Inject(UPSTREAM_PROVIDERS)
    private readonly providers: UpstreamProviderRegistry,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission(Actions.WorkspaceAdmin)
  async list(@Param("id") principalId: string): Promise<UpstreamTokenView[]> {
    const rows = await this.repo.listByPrincipal(principalId);
    return rows.map((r) => ({
      providerId: r.providerId,
      tokenType: r.tokenType,
      scopes: r.scopes,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      issuer: r.issuer,
      subject: r.subject,
      keyId: r.keyId,
      updatedAt: r.updatedAt.toISOString(),
      expired: !!(r.expiresAt && r.expiresAt.getTime() < Date.now()),
    }));
  }

  @Delete(":providerId")
  @RequirePermission(Actions.WorkspaceAdmin)
  async revoke(
    @Param("id") principalId: string,
    @Param("providerId") providerId: string,
    @Req() req: Request,
  ): Promise<{ revoked: boolean }> {
    // Best-effort remote revoke first — never blocks local delete.
    const provider = this.providers.get(providerId);
    if (provider?.revoke) {
      try {
        const existing = await this.repo.get(principalId, providerId);
        if (existing) {
          await provider.revoke({
            accessToken: existing.accessToken,
            refreshToken: existing.refreshToken,
            tokenType: existing.tokenType,
            scopes: existing.scopes,
            expiresAt: existing.expiresAt,
            issuer: existing.issuer,
            subject: existing.subject,
          });
        }
      } catch (err) {
        console.warn(
          `[upstream-admin] remote revoke failed for ${principalId}/${providerId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    const revoked = await this.repo.revoke(principalId, providerId);
    this.audit.log({
      actorId: null,
      actorType: null,
      action: "upstream.token.revoke",
      resource: { principalId, providerId },
      outcome: revoked ? "ok" : "error",
      metadata: {},
      ip: clientIp(req),
    });
    return { revoked };
  }

  @Post(":providerId/reconsent")
  @RequirePermission(Actions.WorkspaceAdmin)
  async reconsent(
    @Param("id") principalId: string,
    @Param("providerId") providerId: string,
  ): Promise<{ consentUrl: string | null }> {
    await this.repo.revoke(principalId, providerId);
    const base = process.env.MAVIO_PUBLIC_BASE_URL;
    if (!base) return { consentUrl: null };
    return {
      consentUrl: `${base}/auth/upstream/${providerId}/login?return_to=/`,
    };
  }
}
