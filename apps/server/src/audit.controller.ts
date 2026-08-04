import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { Actions } from "@mavio/rbac";
import type { AuditLogRecord } from "@mavio/registry";
import { ApiKeyGuard } from "./auth.guard.js";
import { RbacGuard, RequirePermission } from "./rbac.guard.js";
import { AuditService } from "./audit.module.js";

@Controller("api/audit")
@UseGuards(ApiKeyGuard, RbacGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermission(Actions.AuditRead)
  async list(
    @Query("actor") actor?: string,
    @Query("action") action?: string,
    @Query("outcome") outcome?: string,
    @Query("since") since?: string,
    @Query("limit") limit?: string,
  ): Promise<AuditLogRecord[]> {
    return this.audit.repository.list({
      actorId: actor,
      action,
      outcome,
      since: since ? new Date(since) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
