import type { Command } from "commander";
import kleur from "kleur";
import { request } from "undici";

const headers = (key?: string): Record<string, string> => {
  const k = key ?? process.env.MAVIO_ADMIN_API_KEY ?? "";
  return k ? { authorization: `Bearer ${k}` } : {};
};

interface CommonOpts {
  api: string;
  key?: string;
}

async function callApi<T>(url: string, init: Parameters<typeof request>[1] = {}): Promise<T> {
  const res = await request(url, init);
  const body = (await res.body.json()) as T & { message?: string };
  if (res.statusCode >= 400) {
    throw new Error(`${res.statusCode}: ${JSON.stringify(body)}`);
  }
  return body;
}

export function registerRbac(program: Command): void {
  const cmd = program.command("rbac").description("Manage principals, roles, assignments");

  cmd
    .command("principals:create")
    .requiredOption("--id <id>", "principal id")
    .option("--type <t>", "user|service", "service")
    .option("--name <name>", "display name")
    .option("--workspace <ws>", "workspace id", "default")
    .option("--api <url>", "admin API base URL", "http://localhost:4000")
    .option("--key <key>", "admin API key")
    .action(async (opts: CommonOpts & Record<string, string>) => {
      const result = await callApi<{ id: string }>(`${opts.api}/api/rbac/principals`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers(opts.key) },
        body: JSON.stringify({
          id: opts.id,
          type: opts.type,
          displayName: opts.name ?? opts.id,
          workspaceId: opts.workspace,
        }),
      });
      console.log(kleur.green("✓"), `created principal ${result.id}`);
    });

  cmd
    .command("keys:issue")
    .requiredOption("--principal <id>")
    .option("--api <url>", "admin API base URL", "http://localhost:4000")
    .option("--key <key>", "admin API key")
    .action(async (opts: CommonOpts & { principal: string }) => {
      const result = await callApi<{ apiKey: string; principal: { id: string } }>(
        `${opts.api}/api/rbac/principals/${opts.principal}/keys`,
        { method: "POST", headers: headers(opts.key) },
      );
      console.log(kleur.green("✓"), `issued key for ${result.principal.id}`);
      console.log(kleur.bold("API key (store now — not retrievable):"));
      console.log(kleur.cyan(result.apiKey));
    });

  cmd
    .command("assign")
    .requiredOption("--principal <id>")
    .requiredOption("--role <name>", "role name (owner|admin|developer|operator|viewer|tool.invoker)")
    .option("--workspace <ws>")
    .option("--project <proj>")
    .option("--server <server>")
    .option("--tool <tool>")
    .option("--api <url>", "admin API base URL", "http://localhost:4000")
    .option("--key <key>", "admin API key")
    .action(
      async (
        opts: CommonOpts & { principal: string; role: string; workspace?: string; project?: string; server?: string; tool?: string },
      ) => {
        await callApi(`${opts.api}/api/rbac/assignments`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers(opts.key) },
          body: JSON.stringify({
            principalId: opts.principal,
            roleName: opts.role,
            workspace: opts.workspace,
            project: opts.project,
            server: opts.server,
            tool: opts.tool,
          }),
        });
        console.log(kleur.green("✓"), `${opts.role} → ${opts.principal}`);
      },
    );

  cmd
    .command("roles:list")
    .option("--api <url>", "admin API base URL", "http://localhost:4000")
    .option("--key <key>", "admin API key")
    .action(async (opts: CommonOpts) => {
      const rows = await callApi<Array<{ name: string; permissions: unknown[] }>>(
        `${opts.api}/api/rbac/roles`,
        { headers: headers(opts.key) },
      );
      for (const r of rows) {
        console.log(`${kleur.cyan(r.name)}  ${kleur.dim(`${r.permissions.length} perms`)}`);
      }
    });
}
