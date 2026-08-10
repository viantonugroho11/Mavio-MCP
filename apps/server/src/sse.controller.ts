import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import type { NotificationBus } from "@mavio/cache";
import { NOTIFICATION_BUS } from "./cache.module.js";
import { SseSessionRegistry } from "./sse.registry.js";

/**
 * Downstream SSE for MCP clients (ADR-022 M3).
 *
 * Notification transport is now Redis-Streams-backed. Every frame is written
 * with `id: <stream-id>` so the browser's built-in EventSource passes the
 * value back as `Last-Event-ID` on reconnect. We resume from that id, which
 * means a subscriber that hops to a different replica (or was offline for a
 * few seconds) replays every notification within the stream's retention
 * window instead of losing them.
 *
 * The `endpoint` frame + `sid` semantics of MCP HTTP+SSE are preserved so
 * POST /mcp?sid=<sid> replies still stream back through SseSessionRegistry.
 */
@Controller()
export class SseController {
  constructor(
    @Inject(NOTIFICATION_BUS) private readonly notify: NotificationBus,
    private readonly registry: SseSessionRegistry,
  ) {}

  @Get("mcp/sse")
  async stream(@Req() req: Request, @Res() res: Response): Promise<void> {
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders?.();

    const sid = this.registry.register(res);
    res.write(`event: endpoint\ndata: /mcp?sid=${sid}\n\n`);

    // Resume from client-supplied Last-Event-ID; otherwise start at the
    // current stream tail so a fresh subscriber does not replay all history.
    const lastEventId = req.header("last-event-id");
    let cursor = lastEventId && /^\d+-\d+$/.test(lastEventId)
      ? lastEventId
      : await this.notify.tailId();

    let closed = false;
    const ping = setInterval(() => {
      if (!closed) res.write(`: keep-alive\n\n`);
    }, 15000);

    req.on("close", () => {
      closed = true;
      clearInterval(ping);
      this.registry.unregister(sid);
    });

    // Consume loop — blocks in Redis for up to 15s at a time; drains
    // records, forwards each as one SSE frame with its stream id.
    while (!closed) {
      let records;
      try {
        records = await this.notify.readFrom(cursor, 100, 15000);
      } catch {
        if (closed) break;
        await sleep(1000);
        continue;
      }
      if (closed) break;
      for (const rec of records) {
        cursor = rec.id;
        const frame = {
          jsonrpc: "2.0",
          method: rec.envelope.method,
          params: rec.envelope.params,
        };
        res.write(`id: ${rec.id}\nevent: notification\ndata: ${JSON.stringify(frame)}\n\n`);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
