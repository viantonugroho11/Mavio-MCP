import { Controller, Delete, Get, Headers, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { StreamableHttpSessionRegistry } from "./streamable-http.session-registry.js";

@Controller("mcp")
export class StreamableHttpController {
  constructor(private readonly registry: StreamableHttpSessionRegistry) {}

  @Get()
  async stream(
    @Req() req: Request,
    @Res() res: Response,
    @Headers("mcp-session-id") sessionId: string | undefined,
  ): Promise<void> {
    if (!sessionId || !this.registry.has(sessionId)) {
      res.status(404).end();
      return;
    }
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders?.();

    this.registry.touch(sessionId);
    this.registry.attachPushStream(sessionId, res);

    const ping = setInterval(() => {
      try {
        res.write(`: keep-alive\n\n`);
      } catch {
        /* stream closed */
      }
    }, 15000);

    req.on("close", () => {
      clearInterval(ping);
      this.registry.detachPushStream(sessionId);
    });
  }

  @Delete()
  terminate(
    @Res() res: Response,
    @Headers("mcp-session-id") sessionId: string | undefined,
  ): void {
    if (!sessionId || !this.registry.has(sessionId)) {
      res.status(404).end();
      return;
    }
    this.registry.delete(sessionId);
    res.status(200).end();
  }
}
