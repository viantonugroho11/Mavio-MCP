import { Body, Controller, Post } from "@nestjs/common";
import type { MCPFrame } from "@mavio/core";
import { RouterService } from "./router.service.js";

@Controller("mcp")
export class RouterController {
  constructor(private readonly router: RouterService) {}

  @Post()
  async handle(@Body() frame: MCPFrame): Promise<MCPFrame> {
    return this.router.handle(frame);
  }
}
