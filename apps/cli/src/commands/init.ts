import { access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Command } from "commander";
import kleur from "kleur";

const TEMPLATE = `version: 1

mavio:
  publicUrl: http://localhost:4000
  dataDir: ./.mavio

database:
  url: \${MAVIO_DB_URL}

cache:
  url: \${MAVIO_REDIS_URL}

auth:
  providers:
    - type: apiKey
      id: default

workspaces:
  - id: default
    name: Default Workspace
    projects:
      - id: sandbox
        name: Sandbox

servers: []

router:
  endpoint: /mcp
`;

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Scaffold mavio.config.yaml in the current directory")
    .option("-f, --force", "overwrite existing config", false)
    .action(async (opts: { force: boolean }) => {
      const path = resolve(process.cwd(), "mavio.config.yaml");
      if (!opts.force) {
        try {
          await access(path);
          console.error(kleur.yellow("mavio.config.yaml already exists — use --force to overwrite"));
          process.exit(1);
        } catch {
          // does not exist, proceed
        }
      }
      await writeFile(path, TEMPLATE, "utf8");
      console.log(kleur.green("✓"), `wrote ${path}`);
      console.log("next: docker compose up -d && pnpm --filter @mavio/registry migrate && mavio serve");
    });
}
