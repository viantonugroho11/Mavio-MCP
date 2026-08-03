#!/usr/bin/env node
import { Command } from "commander";
import kleur from "kleur";
import { registerInit } from "./commands/init.js";
import { registerImport } from "./commands/import.js";
import { registerServe } from "./commands/serve.js";
import { registerServers } from "./commands/servers.js";
import { registerRbac } from "./commands/rbac.js";

const program = new Command();

program
  .name("mavio")
  .description("Mavio-MCP developer toolkit")
  .version("0.1.0-mvp");

registerInit(program);
registerServe(program);
registerImport(program);
registerServers(program);
registerRbac(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(kleur.red("error:"), err instanceof Error ? err.message : err);
  process.exit(1);
});
