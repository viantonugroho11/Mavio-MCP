import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  app.enableCors({ origin: true });
  const port = Number(process.env.MAVIO_HTTP_PORT ?? 4000);
  await app.listen(port);
  console.log(`mavio server listening on http://localhost:${port}`);
  console.log(`  MCP endpoint: POST http://localhost:${port}/mcp`);
  console.log(`  Admin API:    http://localhost:${port}/api/servers`);
}

bootstrap().catch((err) => {
  console.error("bootstrap failed:", err);
  process.exit(1);
});
