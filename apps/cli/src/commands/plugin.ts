import type { Command } from "commander";
import kleur from "kleur";
import { request } from "undici";

interface PluginView {
  name: string;
  version: string;
  enabled: boolean;
  mavioApi: string;
  contributes: Record<string, unknown>;
  activatedAt: string | null;
}

const commonOpts = (cmd: Command): Command =>
  cmd
    .option("--api <url>", "Mavio admin API base URL", "http://localhost:4000")
    .option("--key <key>", "admin API key");

function authHeaders(key?: string): Record<string, string> {
  const k = key ?? process.env.MAVIO_ADMIN_API_KEY ?? "";
  return k ? { authorization: `Bearer ${k}` } : {};
}

export function registerPlugin(program: Command): void {
  const cmd = program.command("plugin").description("Manage Mavio plugins");

  commonOpts(cmd.command("list").description("List discovered plugins")).action(
    async (opts: { api: string; key?: string }) => {
      const res = await request(`${opts.api}/api/plugins`, { headers: authHeaders(opts.key) });
      if (res.statusCode >= 400) exit(res.statusCode);
      const rows = (await res.body.json()) as PluginView[];
      if (rows.length === 0) {
        console.log(kleur.dim("no plugins installed"));
        return;
      }
      for (const p of rows) {
        const status = p.enabled ? kleur.green("enabled") : kleur.yellow("disabled");
        console.log(
          `${kleur.cyan(p.name)}@${p.version}  ${status}  ${kleur.dim(`mavioApi=${p.mavioApi}`)}`,
        );
      }
    },
  );

  commonOpts(cmd.command("enable <name>").description("Enable plugin")).action(
    async (name: string, opts: { api: string; key?: string }) => {
      const res = await request(`${opts.api}/api/plugins/${encodeURIComponent(name)}/enable`, {
        method: "POST",
        headers: authHeaders(opts.key),
      });
      if (res.statusCode >= 400) exit(res.statusCode);
      console.log(kleur.green(`${name} enabled`));
    },
  );

  commonOpts(cmd.command("disable <name>").description("Disable plugin")).action(
    async (name: string, opts: { api: string; key?: string }) => {
      const res = await request(`${opts.api}/api/plugins/${encodeURIComponent(name)}/disable`, {
        method: "POST",
        headers: authHeaders(opts.key),
      });
      if (res.statusCode >= 400) exit(res.statusCode);
      console.log(kleur.yellow(`${name} disabled`));
    },
  );
}

function exit(code: number): never {
  console.error(kleur.red(`error ${code}`));
  process.exit(1);
}
