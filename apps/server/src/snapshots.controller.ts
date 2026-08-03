import { Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
import { Actions } from "@mavio/rbac";
import { Registry, diffCapabilities, type CapabilityDiff } from "@mavio/registry";
import { REGISTRY } from "./registry.module.js";
import { ApiKeyGuard } from "./auth.guard.js";
import { RbacGuard, RequirePermission } from "./rbac.guard.js";

@Controller("api/servers/:id/snapshots")
@UseGuards(ApiKeyGuard, RbacGuard)
export class SnapshotsController {
  constructor(@Inject(REGISTRY) private readonly registry: Registry) {}

  @Get()
  @RequirePermission(Actions.ServerRead)
  async list(@Param("id") id: string): Promise<unknown> {
    return this.registry.listSnapshots(id);
  }

  @Get("diff")
  @RequirePermission(Actions.ServerRead)
  async diff(
    @Param("id") _id: string,
    @Query("a") a: string,
    @Query("b") b: string,
  ): Promise<CapabilityDiff | { error: string }> {
    const [aSnap, bSnap] = await Promise.all([this.registry.getSnapshot(a), this.registry.getSnapshot(b)]);
    if (!aSnap || !bSnap) return { error: "snapshot not found" };
    return diffCapabilities(aSnap.capabilities, bSnap.capabilities);
  }
}
