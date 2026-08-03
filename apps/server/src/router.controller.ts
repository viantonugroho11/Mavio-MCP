import { Body, Controller, Post, UseInterceptors } from "@nestjs/common";
import type { MCPFrame } from "@mavio/core";
import { RouterService } from "./router.service.js";
import { RateLimitInterceptor } from "./rate-limit.interceptor.js";

@Controller("mcp")
@UseInterceptors(RateLimitInterceptor)
export class RouterController {
  constructor(private readonly router: RouterService) {}

  @Post()
  async handle(@Body() frame: MCPFrame): Promise<MCPFrame> {
    return this.router.handle(frame);
  }
}
