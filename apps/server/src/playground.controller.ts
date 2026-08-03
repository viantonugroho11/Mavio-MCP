import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { Principal } from "@mavio/core";
import { Actions } from "@mavio/rbac";
import { PlaygroundRepository } from "@mavio/registry";
import type { Database } from "@mavio/registry";
import type { Kysely } from "kysely";
import { REGISTRY_DB } from "./registry.module.js";
import { RouterService } from "./router.service.js";
import { ApiKeyGuard } from "./auth.guard.js";
import { RbacGuard, RequirePermission } from "./rbac.guard.js";

interface InvokeBody {
  server: string;
  tool: string;
  arguments: Record<string, unknown>;
}

const PLAYGROUND_REPO = Symbol("PLAYGROUND_REPO_LOCAL");

@Controller("api/playground")
@UseGuards(ApiKeyGuard, RbacGuard)
export class PlaygroundController {
  private readonly repo: PlaygroundRepository;

  constructor(
    @Inject(REGISTRY_DB) db: Kysely<Database>,
    private readonly router: RouterService,
  ) {
    this.repo = new PlaygroundRepository(db);
  }

  @Post("invoke")
  @RequirePermission(Actions.ToolInvoke)
  async invoke(
    @Body() body: InvokeBody,
    @Req() req: Request & { principal?: Principal },
  ): Promise<{ runId: string; latencyMs: number; response: unknown }> {
    const started = Date.now();
    const frame = await this.router.invokeAndReturn(`${body.server}.${body.tool}`, body.arguments, req.principal);
    const latencyMs = Date.now() - started;
    const isError = Boolean(frame.error);
    const run = await this.repo.record({
      principalId: req.principal?.id ?? "unknown",
      serverId: body.server,
      toolName: body.tool,
      arguments: body.arguments,
      response: frame,
      latencyMs,
      status: isError ? "error" : "ok",
    });
    return { runId: run.id, latencyMs, response: frame };
  }

  @Get("runs")
  @RequirePermission(Actions.ServerRead)
  async list(@Query("server") server?: string): Promise<unknown> {
    return this.repo.list({ serverId: server });
  }

  @Get("runs/:id")
  @RequirePermission(Actions.ServerRead)
  async get(@Param("id") id: string): Promise<unknown> {
    return this.repo.get(id);
  }
}
