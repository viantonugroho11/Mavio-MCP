import { Global, Inject, Module } from "@nestjs/common";
import type { Redis } from "@mavio/cache";
import { OidcProviderRepository } from "@mavio/registry";
import { REDIS } from "./cache.module.js";
import { OIDC_PROVIDER_REPO } from "./auth.module.js";
import { SessionStore } from "./session.store.js";
import { OidcClientCache } from "./oidc-client.cache.js";

export const SESSION_STORE = Symbol("SESSION_STORE");
export const OIDC_CLIENT_CACHE = Symbol("OIDC_CLIENT_CACHE");
export const SESSION_TTL = Symbol("SESSION_TTL");

@Global()
@Module({
  providers: [
    {
      provide: SESSION_TTL,
      useFactory: (): number => Number(process.env.MAVIO_SESSION_TTL_SECONDS ?? 86400),
    },
    {
      provide: SESSION_STORE,
      inject: [REDIS, SESSION_TTL],
      useFactory: (redis: Redis, ttl: number): SessionStore => new SessionStore(redis, ttl),
    },
    {
      provide: OIDC_CLIENT_CACHE,
      inject: [OIDC_PROVIDER_REPO],
      useFactory: (repo: OidcProviderRepository): OidcClientCache => new OidcClientCache(repo),
    },
  ],
  exports: [SESSION_STORE, OIDC_CLIENT_CACHE, SESSION_TTL],
})
export class SessionModule {
  constructor(
    @Inject(SESSION_STORE) _s: SessionStore,
    @Inject(OIDC_CLIENT_CACHE) _c: OidcClientCache,
  ) {}
}
