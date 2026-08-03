import type { Command } from "commander";
import kleur from "kleur";
import { request } from "undici";

export function registerImport(program: Command): void {
  const cmd = program.command("import").description("Import external sources as MCP servers");

  cmd
    .command("openapi")
    .description("Import an OpenAPI spec")
    .requiredOption("--id <id>", "server id")
    .option("--url <url>", "OpenAPI document URL")
    .option("--path <path>", "OpenAPI document local path")
    .option("--base-url <baseUrl>", "override base URL if spec has no servers[]")
    .option("--workspace <ws>", "workspace id", "default")
    .option("--project <proj>", "project id", "sandbox")
    .option("--api <url>", "Mavio admin API base URL", "http://localhost:4000")
    .option("--key <key>", "admin API key (or env MAVIO_ADMIN_API_KEY)")
    .action(async (opts: Record<string, string>) => {
      const key = opts.key ?? process.env.MAVIO_ADMIN_API_KEY ?? "";
      const res = await request(`${opts.api}/api/imports/openapi`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
          id: opts.id,
          workspaceId: opts.workspace,
          projectId: opts.project,
          url: opts.url,
          path: opts.path,
          baseUrl: opts.baseUrl,
        }),
      });
      const body = (await res.body.json()) as { ok?: boolean; toolCount?: number; message?: string };
      if (res.statusCode >= 400) {
        console.error(kleur.red("import failed:"), body);
        process.exit(1);
      }
      console.log(kleur.green("✓"), `imported ${opts.id} — ${body.toolCount} tools`);
    });
}
