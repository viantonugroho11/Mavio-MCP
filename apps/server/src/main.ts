import "reflect-metadata";
import { bootstrapTracing, shutdownTracing } from "@mavio/observability";
import { NestFactory } from "@nestjs/core";
import type { RbacRepository } from "@mavio/registry";
import type { Server as HttpServer } from "node:http";
import { AppModule } from "./app.module.js";
import { RouterService } from "./router.service.js";
import { RBAC_REPO } from "./rbac.module.js";
import { attachWsGateway } from "./ws.gateway.js";

async function bootstrap(): Promise<void> {
  bootstrapTracing({ serviceName: "mavio-mcp-server", serviceVersion: "0.1.0" });
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  app.enableCors({ origin: true });
  const port = Number(process.env.MAVIO_HTTP_PORT ?? 4000);
  await app.listen(port);
  const httpServer = app.getHttpServer() as HttpServer;
  const router = app.get(RouterService);
  const rbac = app.get<RbacRepository>(RBAC_REPO);
  attachWsGateway(httpServer, router, rbac);
  console.log(`mavio server listening on http://localhost:${port}`);
  console.log(`  MCP endpoint: POST http://localhost:${port}/mcp`);
  console.log(`  MCP WS:       ws://localhost:${port}/mcp/ws`);
  console.log(`  Admin API:    http://localhost:${port}/api/servers`);
  console.log(`  Metrics:      GET http://localhost:${port}/metrics`);
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      void shutdownTracing().finally(() => process.exit(0));
    });
  }
}

bootstrap().catch((err) => {
  console.error("bootstrap failed:", err);
  process.exit(1);
});
