import type { Command } from "commander";
import kleur from "kleur";
import { request } from "undici";

export function registerImport(program: Command): void {
  const cmd = program.command("import").description("Import external sources as MCP servers");

  cmd
    .command("sql")
    .description("Introspect a Postgres database and register it as an MCP server")
    .requiredOption("--id <id>", "server id")
    .requiredOption("--dsn <dsn>", "postgres://user:pass@host:port/db")
    .option("--tables <list>", "comma-separated allowlist (default: all)")
    .option("--read-only", "read-only mode", true)
    .option("--workspace <ws>", "workspace id", "default")
    .option("--project <proj>", "project id", "sandbox")
    .option("--api <url>", "Mavio admin API base URL", "http://localhost:4000")
    .option("--key <key>", "admin API key")
    .action(async (opts: Record<string, string | boolean>) => {
      const key = (opts.key as string | undefined) ?? process.env.MAVIO_ADMIN_API_KEY ?? "";
      const tables = typeof opts.tables === "string" ? opts.tables.split(",").map((s) => s.trim()) : undefined;
      const res = await request(`${opts.api as string}/api/imports/sql`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({
          id: opts.id,
          workspaceId: opts.workspace,
          projectId: opts.project,
          dsn: opts.dsn,
          allowedTables: tables,
          readOnly: opts.readOnly !== false,
        }),
      });
      const body = (await res.body.json()) as { ok?: boolean; toolCount?: number; tables?: string[] };
      if (res.statusCode >= 400) {
        console.error(kleur.red("import failed:"), body);
        process.exit(1);
      }
      console.log(kleur.green("✓"), `imported ${opts.id as string} — ${body.toolCount} tools across ${body.tables?.length ?? 0} tables`);
    });

  cmd
    .command("graphql")
    .description("Introspect a GraphQL endpoint and register it as an MCP server")
    .requiredOption("--id <id>")
    .requiredOption("--endpoint <url>")
    .option("--workspace <ws>", "workspace id", "default")
    .option("--project <proj>", "project id", "sandbox")
    .option("--api <url>", "Mavio admin API base URL", "http://localhost:4000")
    .option("--key <key>", "admin API key")
    .action(async (opts: Record<string, string>) => {
      const key = opts.key ?? process.env.MAVIO_ADMIN_API_KEY ?? "";
      const res = await request(`${opts.api}/api/imports/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({
          id: opts.id,
          workspaceId: opts.workspace,
          projectId: opts.project,
          endpoint: opts.endpoint,
        }),
      });
      const body = (await res.body.json()) as { ok?: boolean; toolCount?: number };
      if (res.statusCode >= 400) {
        console.error(kleur.red("import failed:"), body);
        process.exit(1);
      }
      console.log(kleur.green("✓"), `imported ${opts.id} — ${body.toolCount} tools`);
    });

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
