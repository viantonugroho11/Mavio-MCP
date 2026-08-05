import type { Command } from "commander";
import kleur from "kleur";
import { request } from "undici";

const headers = (key?: string): Record<string, string> => {
  const k = key ?? process.env.MAVIO_ADMIN_API_KEY ?? "";
  return k ? { authorization: `Bearer ${k}` } : {};
};

async function callApi<T>(
  url: string,
  init: Parameters<typeof request>[1] = {},
): Promise<T> {
  const res = await request(url, init);
  const body = (await res.body.json().catch(() => ({}))) as T & { message?: string };
  if (res.statusCode >= 400) {
    throw new Error(`${res.statusCode}: ${JSON.stringify(body)}`);
  }
  return body;
}

interface CommonOpts {
  api: string;
  key?: string;
}

interface UpstreamTokenView {
  providerId: string;
  tokenType: string;
  scopes: string[];
  expiresAt: string | null;
  issuer: string | null;
  subject: string | null;
  keyId: string;
  updatedAt: string;
  expired: boolean;
}

export function registerUpstream(program: Command): void {
  const cmd = program
    .command("upstream")
    .description("Manage per-principal upstream OAuth credentials");

  cmd
    .command("list")
    .description("List stored upstream tokens for a principal (metadata only)")
    .requiredOption("--principal <id>", "principal id")
    .option("--api <url>", "admin API base URL", "http://localhost:4000")
    .option("--key <key>", "admin API key")
    .action(async (opts: CommonOpts & { principal: string }) => {
      const rows = await callApi<UpstreamTokenView[]>(
        `${opts.api}/api/rbac/principals/${encodeURIComponent(opts.principal)}/upstream-tokens`,
        { headers: headers(opts.key) },
      );
      if (rows.length === 0) {
        console.log(kleur.gray("(no upstream tokens stored)"));
        return;
      }
      for (const r of rows) {
        const status = r.expired ? kleur.red("EXPIRED") : kleur.green("OK");
        console.log(
          `${status}  ${kleur.bold(r.providerId)}  scopes=${r.scopes.join(",") || "-"}  expires=${
            r.expiresAt ?? "-"
          }  key_id=${r.keyId}  subject=${r.subject ?? "-"}`,
        );
      }
    });

  cmd
    .command("revoke")
    .description("Revoke a stored upstream token (calls provider.revoke, then deletes locally)")
    .requiredOption("--principal <id>", "principal id")
    .requiredOption("--provider <pid>", "provider id")
    .option("--api <url>", "admin API base URL", "http://localhost:4000")
    .option("--key <key>", "admin API key")
    .action(async (opts: CommonOpts & { principal: string; provider: string }) => {
      const out = await callApi<{ revoked: boolean }>(
        `${opts.api}/api/rbac/principals/${encodeURIComponent(opts.principal)}/upstream-tokens/${encodeURIComponent(opts.provider)}`,
        { method: "DELETE", headers: headers(opts.key) },
      );
      console.log(out.revoked ? kleur.green("revoked") : kleur.yellow("nothing to revoke"));
    });

  cmd
    .command("reconsent")
    .description(
      "Clear a stored upstream token so the next invoke forces consent again — returns consent URL",
    )
    .requiredOption("--principal <id>", "principal id")
    .requiredOption("--provider <pid>", "provider id")
    .option("--api <url>", "admin API base URL", "http://localhost:4000")
    .option("--key <key>", "admin API key")
    .action(async (opts: CommonOpts & { principal: string; provider: string }) => {
      const out = await callApi<{ consentUrl: string | null }>(
        `${opts.api}/api/rbac/principals/${encodeURIComponent(opts.principal)}/upstream-tokens/${encodeURIComponent(opts.provider)}/reconsent`,
        { method: "POST", headers: headers(opts.key) },
      );
      console.log(
        out.consentUrl
          ? `open in browser: ${kleur.cyan(out.consentUrl)}`
          : kleur.yellow("consent URL unavailable — set MAVIO_PUBLIC_BASE_URL on the server"),
      );
    });
}
