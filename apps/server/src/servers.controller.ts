import { Body, Controller, Delete, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import type { ServerDescriptor } from "@mavio/core";
import { Registry } from "@mavio/registry";
import { REGISTRY } from "./registry.module.js";
import { ApiKeyGuard } from "./auth.guard.js";
import { RouterService } from "./router.service.js";

@Controller("api/servers")
@UseGuards(ApiKeyGuard)
export class ServersController {
  constructor(
    @Inject(REGISTRY) private readonly registry: Registry,
    private readonly router: RouterService,
  ) {}

  @Get()
  list(): Promise<ServerDescriptor[]> {
    return this.registry.list();
  }

  @Get(":id")
  get(@Param("id") id: string): Promise<ServerDescriptor> {
    return this.registry.get(id);
  }

  @Post()
  async register(@Body() body: ServerDescriptor): Promise<ServerDescriptor> {
    const result = await this.registry.register(body);
    this.router.invalidate();
    return result;
  }

  @Delete(":id")
  async remove(@Param("id") id: string): Promise<{ ok: true }> {
    await this.registry.unregister(id);
    this.router.invalidate();
    return { ok: true };
  }
}
