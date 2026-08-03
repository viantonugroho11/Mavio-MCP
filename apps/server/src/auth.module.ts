import { Global, Inject, Module } from "@nestjs/common";
import type { Kysely } from "kysely";
import { OidcProviderRepository, type Database } from "@mavio/registry";
import { REGISTRY_DB } from "./registry.module.js";

export const OIDC_PROVIDER_REPO = Symbol("OIDC_PROVIDER_REPO");

@Global()
@Module({
  providers: [
    {
      provide: OIDC_PROVIDER_REPO,
      inject: [REGISTRY_DB],
      useFactory: (db: Kysely<Database>): OidcProviderRepository =>
        new OidcProviderRepository(db),
    },
  ],
  exports: [OIDC_PROVIDER_REPO],
})
export class AuthModule {
  constructor(@Inject(OIDC_PROVIDER_REPO) _repo: OidcProviderRepository) {}
}
