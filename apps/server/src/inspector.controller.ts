import { Controller, Get, Inject, Param, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { Actions } from "@mavio/rbac";
import { InspectorService, type ServerDescription, type ToolDetail } from "@mavio/inspector";
import { ApiKeyGuard } from "./auth.guard.js";
import { RbacGuard, RequirePermission } from "./rbac.guard.js";
import { INSPECTOR_SERVICE } from "./inspector.module.js";

@Controller("api/inspector")
@UseGuards(ApiKeyGuard, RbacGuard)
export class InspectorController {
  constructor(@Inject(INSPECTOR_SERVICE) private readonly inspector: InspectorService) {}

  @Get(":serverId")
  @RequirePermission(Actions.ServerRead, (req: Request) => ({ server: req.params.serverId }))
  describe(@Param("serverId") serverId: string): Promise<ServerDescription> {
    return this.inspector.describe(serverId);
  }

  @Get(":serverId/tools/:toolName")
  @RequirePermission(Actions.ServerRead, (req: Request) => ({ server: req.params.serverId }))
  explainTool(
    @Param("serverId") serverId: string,
    @Param("toolName") toolName: string,
  ): Promise<ToolDetail> {
    return this.inspector.explainTool(serverId, toolName);
  }
}
