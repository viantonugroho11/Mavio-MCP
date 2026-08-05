import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { WebSocketServer, WebSocket } from "ws";
import type { MCPFrame } from "@mavio/core";
import type { RbacRepository } from "@mavio/registry";
import type { Request } from "express";
import { RouterService } from "./router.service.js";
import { resolvePrincipalFromRequest } from "./principal-resolver.js";

const WS_PATH = "/mcp/ws";

/**
 * Downstream WebSocket transport for MCP clients.
 * Each socket is a single MCP session — client sends JSON-RPC frames, server
 * replies with correlated frames on the same socket. Notifications
 * (capability invalidation) are pushed as `notifications/tools/list_changed`.
 */
export function attachWsGateway(
  httpServer: HttpServer,
  router: RouterService,
  rbac: RbacRepository,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (!req.url || !req.url.startsWith(WS_PATH)) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    const shim = reqShim(req);
    const principal = await resolvePrincipalFromRequest(shim, rbac).catch(() => undefined);

    const ping = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
    }, 15000);

    ws.on("message", async (raw) => {
      let frame: MCPFrame;
      try {
        frame = JSON.parse(raw.toString()) as MCPFrame;
      } catch {
        return; // ignore malformed
      }
      try {
        const response = await router.handle(frame, principal);
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(response));
      } catch (err) {
        if (ws.readyState === ws.OPEN) {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: frame.id ?? null,
              error: { code: -32000, message: (err as Error).message },
            }),
          );
        }
      }
    });

    ws.on("close", () => clearInterval(ping));
    ws.on("error", () => clearInterval(ping));
  });

  return wss;
}

function reqShim(req: IncomingMessage): Request {
  const headers = req.headers;
  return {
    headers,
    header: (name: string) => {
      const v = headers[name.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    },
  } as unknown as Request;
}
