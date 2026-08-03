import { Global, Inject, Module, type OnModuleInit } from "@nestjs/common";
import { BuiltinRbacEngine, type PolicyEngine } from "@mavio/rbac";
import { RbacRepository } from "@mavio/registry";
import type { Database } from "@mavio/registry";
import type { Kysely } from "kysely";
import { REGISTRY_DB } from "./registry.module.js";

export const RBAC_REPO = Symbol("RBAC_REPO");
export const POLICY_ENGINE = Symbol("POLICY_ENGINE");

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
      useFactory: (repo: RbacRepository): PolicyEngine => new BuiltinRbacEngine(repo),
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
