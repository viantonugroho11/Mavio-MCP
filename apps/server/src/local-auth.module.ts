import { Global, Module } from "@nestjs/common";
import { LocalUserRepository, type Database } from "@mavio/registry";
import { REGISTRY_DB } from "./registry.module.js";
import type { Kysely } from "kysely";

export const LOCAL_USER_REPO = Symbol("LOCAL_USER_REPO");

@Global()
@Module({
  providers: [
    {
      provide: LOCAL_USER_REPO,
      inject: [REGISTRY_DB],
      useFactory: (db: Kysely<Database>) => new LocalUserRepository(db),
    },
  ],
  exports: [LOCAL_USER_REPO],
})
export class LocalAuthModule {}
