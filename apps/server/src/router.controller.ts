import { Body, Controller, Inject, Post, Query, Req, Res, UseInterceptors } from "@nestjs/common";
import type { Request, Response } from "express";
import type { MCPFrame } from "@mavio/core";
import { RbacRepository } from "@mavio/registry";
import { RouterService } from "./router.service.js";
import { RateLimitInterceptor } from "./rate-limit.interceptor.js";
import { RBAC_REPO } from "./rbac.module.js";
import { resolvePrincipalFromRequest } from "./principal-resolver.js";
import { SseSessionRegistry } from "./sse.registry.js";
import { StreamableHttpSessionRegistry } from "./streamable-http.session-registry.js";
import { McpSessionStore } from "./mcp-session.store.js";

@Controller("mcp")
@UseInterceptors(RateLimitInterceptor)
export class RouterController {
  constructor(
    private readonly router: RouterService,
    @Inject(RBAC_REPO) private readonly rbac: RbacRepository,
    private readonly sseRegistry: SseSessionRegistry,
    private readonly streamable: StreamableHttpSessionRegistry,
    private readonly mcpSessions: McpSessionStore,
  ) {}

  @Post()
  async handle(
    @Body() frame: MCPFrame,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query("sid") sid?: string,
  ): Promise<MCPFrame | void> {
    const principal = await resolvePrincipalFromRequest(req, this.rbac);
    const streamableSid = (req.headers["mcp-session-id"] as string | undefined) ?? undefined;
    const accept = (req.headers["accept"] as string | undefined) ?? "";

    // Streamable HTTP: session header present
    if (streamableSid) {
      if (!this.streamable.has(streamableSid)) {
        res.status(404).end();
        return;
      }
      this.streamable.touch(streamableSid);
      const response = await this.router.handle(frame, principal, streamableSid);
      if (accept.includes("text/event-stream")) {
        res.setHeader("content-type", "text/event-stream");
        res.setHeader("cache-control", "no-cache, no-transform");
        res.setHeader("connection", "keep-alive");
        res.flushHeaders?.();
        // Per ADR-024: assign stable event ID so client can replay with Last-Event-ID.
        // streamId is the request's JSON-RPC id (or "anon" for notifications).
        const rpcId = String((frame as { id?: unknown }).id ?? "anon");
        await this.streamable.writeResponseEvent(streamableSid, rpcId, JSON.stringify(response), res);
        res.end();
        return;
      }
      return response;
    }

    // Streamable HTTP: initialize (creates session)
    if (!sid && frame.method === "initialize") {
      const newSid = this.streamable.create();
      this.mcpSessions.register(newSid, "streamable-http", principal?.id ?? null);
      const response = await this.router.handle(frame, principal, newSid);
      res.setHeader("mcp-session-id", newSid);
      return response;
    }

    // Classic SSE POST with ?sid=
    if (sid && this.sseRegistry.has(sid)) {
      const response = await this.router.handle(frame, principal);
      const delivered = this.sseRegistry.send(sid, response);
      if (delivered) {
        res.status(202).end();
        return;
      }
      return response;
    }

    // Fallback: plain POST /mcp (legacy stateless), pass through
    return this.router.handle(frame, principal);
  }
}
