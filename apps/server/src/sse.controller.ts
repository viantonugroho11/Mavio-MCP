import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { InvalidationBus, InvalidationEvent } from "@mavio/cache";
import { INVALIDATION_BUS } from "./cache.module.js";

/**
 * Downstream SSE stream for MCP clients — emits capability-invalidation events
 * so clients can call `tools/list` again without polling. Streamable per-call
 * tool responses (correlated by frame.id) are TODO — needs response-fanout on
 * RouterService.
 */
@Controller()
export class SseController {
  constructor(@Inject(INVALIDATION_BUS) private readonly bus: InvalidationBus) {}

  @Get("mcp/sse")
  stream(@Req() req: Request, @Res() res: Response): void {
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders?.();

    // Endpoint hint for classic MCP SSE clients: where to POST frames.
    res.write(`event: endpoint\ndata: /mcp\n\n`);

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
    });
  }
}
