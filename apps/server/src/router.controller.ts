import { Body, Controller, Inject, Post, Req, UseInterceptors } from "@nestjs/common";
import type { Request } from "express";
import type { MCPFrame, Principal } from "@mavio/core";
import { RbacRepository } from "@mavio/registry";
import { RouterService } from "./router.service.js";
import { RateLimitInterceptor } from "./rate-limit.interceptor.js";
import { RBAC_REPO } from "./rbac.module.js";

@Controller("mcp")
@UseInterceptors(RateLimitInterceptor)
export class RouterController {
  constructor(
    private readonly router: RouterService,
    @Inject(RBAC_REPO) private readonly rbac: RbacRepository,
  ) {}

  @Post()
  async handle(@Body() frame: MCPFrame, @Req() req: Request): Promise<MCPFrame> {
    const principal = await this.resolvePrincipal(req);
    return this.router.handle(frame, principal);
  }

  private async resolvePrincipal(req: Request): Promise<Principal | undefined> {
    const header = req.header("authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1];
    const adminKey = process.env.MAVIO_ADMIN_API_KEY;

    if (token && adminKey && token === adminKey) {
      return { id: "admin", type: "service", workspaceId: "default", scopes: ["*"] };
    }
    if (token) {
      const stored = await this.rbac.findByApiKey(token);
      if (stored) {
        return { id: stored.id, type: stored.type, workspaceId: stored.workspaceId, scopes: [] };
      }
    }
    if (!adminKey) {
      // dev mode — permit as root
      return { id: "dev", type: "service", workspaceId: "default", scopes: ["*"] };
    }
    return undefined; // no principal → engine will deny non-open actions
  }
}
