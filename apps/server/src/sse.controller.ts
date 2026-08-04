import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { InvalidationBus, InvalidationEvent } from "@mavio/cache";
import { INVALIDATION_BUS } from "./cache.module.js";
import { SseSessionRegistry } from "./sse.registry.js";

/**
 * Downstream SSE for MCP clients.
 * - Emits capability-invalidation notifications so clients can refetch tools/list.
 * - Provides a sid via the `endpoint` frame; POST /mcp?sid=<sid> replies are fanned
 *   back onto this stream as `event: message` frames (classic MCP HTTP+SSE).
 */
@Controller()
export class SseController {
  constructor(
    @Inject(INVALIDATION_BUS) private readonly bus: InvalidationBus,
    private readonly registry: SseSessionRegistry,
  ) {}

  @Get("mcp/sse")
  stream(@Req() req: Request, @Res() res: Response): void {
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders?.();

    const sid = this.registry.register(res);
    res.write(`event: endpoint\ndata: /mcp?sid=${sid}\n\n`);

    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const onEvent = (evt: InvalidationEvent): void => {
      send("notification", {
        jsonrpc: "2.0",
        method: "notifications/tools/list_changed",
        params: evt,
      });
    };
    const unsubscribe = this.bus.onEvent(onEvent);

    const ping = setInterval(() => {
      res.write(`: keep-alive\n\n`);
    }, 15000);

    req.on("close", () => {
      clearInterval(ping);
      unsubscribe();
      this.registry.unregister(sid);
    });
  }
}
