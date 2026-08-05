import { Global, Inject, Module, type OnModuleInit } from "@nestjs/common";
import { BuiltinRbacEngine, type PolicyEngine } from "@mavio/rbac";
import { OpaPolicyEngine, CedarSidecarPolicyEngine } from "@mavio/rbac-opa";
import { RbacRepository } from "@mavio/registry";
import type { Database } from "@mavio/registry";
import type { Kysely } from "kysely";
import { REGISTRY_DB } from "./registry.module.js";

export const RBAC_REPO = Symbol("RBAC_REPO");
export const POLICY_ENGINE = Symbol("POLICY_ENGINE");

function buildPolicyEngine(repo: RbacRepository): PolicyEngine {
  const kind = process.env.MAVIO_RBAC_ENGINE ?? "builtin";
  const url = process.env.MAVIO_RBAC_ENGINE_URL;
  const token = process.env.MAVIO_RBAC_ENGINE_TOKEN;
  if (kind === "opa") {
    if (!url) {
      console.warn("[rbac] MAVIO_RBAC_ENGINE=opa but MAVIO_RBAC_ENGINE_URL unset — falling back to builtin");
      return new BuiltinRbacEngine(repo);
    }
    console.log(`[rbac] policy engine: opa @ ${url}`);
    return new OpaPolicyEngine({ url, token, failClosed: true });
  }
  if (kind === "cedar") {
    if (!url) {
      console.warn("[rbac] MAVIO_RBAC_ENGINE=cedar but MAVIO_RBAC_ENGINE_URL unset — falling back to builtin");
      return new BuiltinRbacEngine(repo);
    }
    console.log(`[rbac] policy engine: cedar @ ${url}`);
    return new CedarSidecarPolicyEngine({ url, token, failClosed: true });
  }
  return new BuiltinRbacEngine(repo);
}

@Global()
@Module({
  providers: [
    {
      provide: RBAC_REPO,
      inject: [REGISTRY_DB],
      useFactory: (db: Kysely<Database>): RbacRepository => new RbacRepository(db),
    },
    {
      provide: POLICY_ENGINE,
      inject: [RBAC_REPO],
      useFactory: buildPolicyEngine,
    },
  ],
  exports: [RBAC_REPO, POLICY_ENGINE],
})
export class RbacModule implements OnModuleInit {
  constructor(@Inject(RBAC_REPO) private readonly repo: RbacRepository) {}

  async onModuleInit(): Promise<void> {
    await this.repo.syncBuiltinRoles();
    console.log("[rbac] builtin roles synced");
  }
}
