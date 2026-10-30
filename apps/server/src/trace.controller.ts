import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  Inject,
} from "@nestjs/common";
import type { Request } from "express";
import type { Principal } from "@mavio/core";
import { Actions } from "@mavio/rbac";
import type { TraceRecord, FailStage } from "@mavio/registry";
import { TraceRepository } from "@mavio/registry";
import { ApiKeyGuard } from "./auth.guard.js";
import { RbacGuard, RequirePermission } from "./rbac.guard.js";
import { TRACE_REPO } from "./trace.module.js";
import { RouterService } from "./router.service.js";

@Controller("api/traces")
@UseGuards(ApiKeyGuard, RbacGuard)
export class TraceController {
  constructor(
    @Inject(TRACE_REPO) private readonly repo: TraceRepository,
    private readonly router: RouterService,
  ) {}

  @Get()
  @RequirePermission(Actions.ServerRead)
  async list(
    @Query("server") server?: string,
    @Query("tool") tool?: string,
    @Query("failStage") failStage?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ): Promise<TraceRecord[]> {
    return this.repo.list({
      serverId: server,
      toolName: tool,
      failStage: failStage as FailStage | "any" | undefined,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(":id")
  @RequirePermission(Actions.ServerRead, (req) => ({ server: req.params["id"] ?? "" }))
  async get(@Param("id") id: string): Promise<TraceRecord> {
    const trace = await this.repo.get(id);
    if (!trace) throw new NotFoundException(`trace ${id} not found`);
    return trace;
  }

  @Post(":id/replay")
  @RequirePermission(Actions.ToolInvoke, (req) => ({ server: req.params["id"] ?? "" }))
  async replay(
    @Param("id") id: string,
    @Req() req: Request,
  ): Promise<{ traceId?: string; result: unknown }> {
    const trace = await this.repo.get(id);
    if (!trace) throw new NotFoundException(`trace ${id} not found`);
    const principal = (req as Request & { principal?: Principal }).principal;
    const fqName = `${trace.serverId}.${trace.toolName}`;
    const args = (trace.clientRequest as { args?: Record<string, unknown> }).args ?? {};
    const frame = await this.router.invokeAndReturn(fqName, args, principal);
    return { result: frame.result ?? frame.error };
  }
}
