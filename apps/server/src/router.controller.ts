import { Body, Controller, Inject, Post, Req, UseInterceptors } from "@nestjs/common";
import type { Request } from "express";
import type { MCPFrame } from "@mavio/core";
import { RbacRepository } from "@mavio/registry";
import { RouterService } from "./router.service.js";
import { RateLimitInterceptor } from "./rate-limit.interceptor.js";
import { RBAC_REPO } from "./rbac.module.js";
import { resolvePrincipalFromRequest } from "./principal-resolver.js";

@Controller("mcp")
@UseInterceptors(RateLimitInterceptor)
export class RouterController {
  constructor(
    private readonly router: RouterService,
    @Inject(RBAC_REPO) private readonly rbac: RbacRepository,
  ) {}

  @Post()
  async handle(@Body() frame: MCPFrame, @Req() req: Request): Promise<MCPFrame> {
    const principal = await resolvePrincipalFromRequest(req, this.rbac);
    return this.router.handle(frame, principal);
  }
}
