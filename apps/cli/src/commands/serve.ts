import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";

const HERE = dirname(fileURLToPath(import.meta.url));

export function registerServe(program: Command): void {
  program
    .command("serve")
    .description("Start the Mavio-MCP server (router + admin API)")
    .option("-c, --config <path>", "path to mavio.config.yaml", "./mavio.config.yaml")
    .option("-p, --port <port>", "HTTP port", "4000")
    .action((opts: { config: string; port: string }) => {
      const entry = resolve(HERE, "../../../server/dist/main.js");
      const child = spawn(process.execPath, [entry], {
        env: {
          ...process.env,
          MAVIO_CONFIG_PATH: resolve(process.cwd(), opts.config),
          MAVIO_HTTP_PORT: opts.port,
        },
        stdio: "inherit",
      });
      child.on("exit", (code) => process.exit(code ?? 0));
    });
}
