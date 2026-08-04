import { Body, Controller, Get, Inject, NotFoundException, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
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

  @Get("runs/export")
  @RequirePermission(Actions.ServerRead)
  async export(
    @Res() res: Response,
    @Query("server") server?: string,
    @Query("format") format?: string,
    @Query("limit") limit?: string,
  ): Promise<void> {
    const runs = await this.repo.list({
      serverId: server,
      limit: limit ? Math.min(Number(limit), 1000) : 500,
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (format === "ndjson") {
      res.setHeader("content-type", "application/x-ndjson");
      res.setHeader("content-disposition", `attachment; filename="playground-runs-${stamp}.ndjson"`);
      for (const r of runs) res.write(`${JSON.stringify(r)}\n`);
      res.end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.setHeader("content-disposition", `attachment; filename="playground-runs-${stamp}.json"`);
    res.end(JSON.stringify(runs, null, 2));
  }

  @Get("runs/:id")
  @RequirePermission(Actions.ServerRead)
  async get(@Param("id") id: string): Promise<unknown> {
    return this.repo.get(id);
  }

  @Post("runs/:id/replay")
  @RequirePermission(Actions.ToolInvoke)
  async replay(
    @Param("id") id: string,
    @Req() req: Request & { principal?: Principal },
  ): Promise<{ runId: string; latencyMs: number; response: unknown; replayedFrom: string }> {
    const original = await this.repo.get(id);
    if (!original) throw new NotFoundException(`run ${id} not found`);
    const args = (original.arguments ?? {}) as Record<string, unknown>;
    const started = Date.now();
    const frame = await this.router.invokeAndReturn(
      `${original.serverId}.${original.toolName}`,
      args,
      req.principal,
    );
    const latencyMs = Date.now() - started;
    const isError = Boolean(frame.error);
    const run = await this.repo.record({
      principalId: req.principal?.id ?? "unknown",
      serverId: original.serverId,
      toolName: original.toolName,
      arguments: args,
      response: frame,
      latencyMs,
      status: isError ? "error" : "ok",
    });
    return { runId: run.id, latencyMs, response: frame, replayedFrom: id };
  }
}
