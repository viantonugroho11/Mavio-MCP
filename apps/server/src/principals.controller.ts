import { Body, Controller, Delete, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { Actions } from "@mavio/rbac";
import { RbacRepository } from "@mavio/registry";
import { RBAC_REPO } from "./rbac.module.js";
import { ApiKeyGuard } from "./auth.guard.js";
import { RbacGuard, RequirePermission } from "./rbac.guard.js";

interface CreatePrincipalBody {
  id: string;
  type: "user" | "service";
  displayName: string;
  workspaceId: string;
}

interface AssignRoleBody {
  principalId: string;
  roleName: string;
  workspace?: string;
  project?: string;
  server?: string;
  tool?: string;
}

@Controller("api/rbac")
@UseGuards(ApiKeyGuard, RbacGuard)
export class RbacController {
  constructor(@Inject(RBAC_REPO) private readonly repo: RbacRepository) {}

  @Get("principals")
  @RequirePermission(Actions.WorkspaceAdmin)
  listPrincipals(): Promise<unknown> {
    return this.repo.listPrincipals();
  }

  @Post("principals")
  @RequirePermission(Actions.WorkspaceAdmin)
  createPrincipal(@Body() body: CreatePrincipalBody): Promise<unknown> {
    return this.repo.createPrincipal(body);
  }

  @Post("principals/:id/keys")
  @RequirePermission(Actions.WorkspaceAdmin)
  async issueKey(@Param("id") id: string): Promise<unknown> {
    return this.repo.issueApiKey(id);
  }

  @Get("roles")
  @RequirePermission(Actions.WorkspaceAdmin)
  listRoles(): Promise<unknown> {
    return this.repo.listRoles();
  }

  @Post("assignments")
  @RequirePermission(Actions.WorkspaceAdmin)
  async assign(@Body() body: AssignRoleBody): Promise<{ ok: true }> {
    await this.repo.assign({
      principalId: body.principalId,
      roleName: body.roleName,
      scope: {
        workspace: body.workspace,
        project: body.project,
        server: body.server,
        tool: body.tool,
      },
    });
    return { ok: true };
  }

  @Delete("assignments/:id")
  @RequirePermission(Actions.WorkspaceAdmin)
  async unassign(@Param("id") id: string): Promise<{ ok: true }> {
    await this.repo.unassign(id);
    return { ok: true };
  }
}
