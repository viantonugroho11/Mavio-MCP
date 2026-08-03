import type { Command } from "commander";
import kleur from "kleur";
import { request } from "undici";

export function registerServers(program: Command): void {
  const cmd = program.command("servers").description("List and inspect registered MCP servers");

  cmd
    .command("list")
    .description("List servers via admin API")
    .option("--api <url>", "Mavio admin API base URL", "http://localhost:4000")
    .option("--key <key>", "admin API key")
    .action(async (opts: { api: string; key?: string }) => {
      const key = opts.key ?? process.env.MAVIO_ADMIN_API_KEY ?? "";
      const res = await request(`${opts.api}/api/servers`, {
        headers: key ? { authorization: `Bearer ${key}` } : {},
      });
      if (res.statusCode >= 400) {
        console.error(kleur.red(`error ${res.statusCode}`));
        process.exit(1);
      }
      const rows = (await res.body.json()) as Array<{
        id: string;
        name: string;
        workspaceId: string;
        projectId: string;
        sourceType: string;
        tags?: string[];
      }>;
      if (rows.length === 0) {
        console.log(kleur.dim("no servers registered"));
        return;
      }
      for (const r of rows) {
        console.log(
          `${kleur.cyan(r.id)}  ${kleur.dim(`[${r.workspaceId}/${r.projectId}]`)}  ${r.name}  ${kleur.dim(r.sourceType)}${
            r.tags?.length ? kleur.dim(`  #${r.tags.join(" #")}`) : ""
          }`,
        );
      }
    });
}
