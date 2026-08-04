import { Body, Controller, Inject, Post, Query, Req, Res, UseInterceptors } from "@nestjs/common";
import type { Request, Response } from "express";
import type { MCPFrame } from "@mavio/core";
import { RbacRepository } from "@mavio/registry";
import { RouterService } from "./router.service.js";
import { RateLimitInterceptor } from "./rate-limit.interceptor.js";
import { RBAC_REPO } from "./rbac.module.js";
import { resolvePrincipalFromRequest } from "./principal-resolver.js";
import { SseSessionRegistry } from "./sse.registry.js";

@Controller("mcp")
@UseInterceptors(RateLimitInterceptor)
export class RouterController {
  constructor(
    private readonly router: RouterService,
    @Inject(RBAC_REPO) private readonly rbac: RbacRepository,
    private readonly sseRegistry: SseSessionRegistry,
  ) {}

  @Post()
  async handle(
    @Body() frame: MCPFrame,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query("sid") sid?: string,
  ): Promise<MCPFrame | void> {
    const principal = await resolvePrincipalFromRequest(req, this.rbac);
    const response = await this.router.handle(frame, principal);
    if (sid && this.sseRegistry.has(sid)) {
      const delivered = this.sseRegistry.send(sid, response);
      if (delivered) {
        res.status(202).end();
        return;
      }
    }
    return response;
  }
}
