import { Body, Controller, Delete, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { ServerCapabilities, ServerDescriptor } from "@mavio/core";
import { Actions } from "@mavio/rbac";
import { Registry } from "@mavio/registry";
import { REGISTRY } from "./registry.module.js";
import { ApiKeyGuard } from "./auth.guard.js";
import { RbacGuard, RequirePermission } from "./rbac.guard.js";
import { RouterService } from "./router.service.js";

@Controller("api/servers")
@UseGuards(ApiKeyGuard, RbacGuard)
export class ServersController {
  constructor(
    @Inject(REGISTRY) private readonly registry: Registry,
    private readonly router: RouterService,
  ) {}

  @Get()
  @RequirePermission(Actions.ServerRead)
  list(): Promise<ServerDescriptor[]> {
    return this.registry.list();
  }

  @Get(":id")
  @RequirePermission(Actions.ServerRead, (req: Request) => ({ server: req.params.id }))
  get(@Param("id") id: string): Promise<ServerDescriptor> {
    return this.registry.get(id);
  }

  @Get(":id/capabilities")
  @RequirePermission(Actions.ServerRead, (req: Request) => ({ server: req.params.id }))
  async capabilities(@Param("id") id: string): Promise<ServerCapabilities | { tools: [] }> {
    return (await this.registry.latestCapabilities(id)) ?? { tools: [] };
  }

  @Post()
  @RequirePermission(Actions.ServerWrite)
  async register(@Body() body: ServerDescriptor): Promise<ServerDescriptor> {
    const result = await this.registry.register(body);
    await this.router.invalidate(body.id);
    return result;
  }

  @Delete(":id")
  @RequirePermission(Actions.ServerAdmin, (req: Request) => ({ server: req.params.id }))
  async remove(@Param("id") id: string): Promise<{ ok: true }> {
    await this.registry.unregister(id);
    await this.router.invalidate(id);
    return { ok: true };
  }
}
