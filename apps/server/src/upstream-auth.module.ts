import { Global, Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import type {
  DispatchInjection,
  UpstreamCredential,
  UpstreamCredentialProvider,
} from "@mavio/sdk";
import type { Principal, ServerDescriptor, TransportDescriptor } from "@mavio/core";
import {
  PrincipalUpstreamCredentialsRepository,
  SlackUserProvider,
  TokenExchangeProvider,
  Vault,
  VaultTransitKeyWrapper,
  LocalKeyWrapper,
  type KeyWrapper,
  type SubjectTokenResolver,
} from "@mavio/upstream-auth";
import { readKek, resetSharedKek, VAULT_RELOAD_CHANNEL } from "./vault-admin.controller.js";
import type { Redis } from "@mavio/cache";
import { REDIS_SUB } from "./cache.module.js";
import type { Kysely } from "kysely";
import type { Database } from "@mavio/registry";
import type { MavioMetrics } from "@mavio/observability";
import { REGISTRY_DB } from "./registry.module.js";
import { METRICS } from "./observability.module.js";

export const UPSTREAM_PROVIDERS = Symbol("UPSTREAM_PROVIDERS");
export const UPSTREAM_TOKEN_SERVICE = Symbol("UPSTREAM_TOKEN_SERVICE");
export const UPSTREAM_CREDS_REPO = Symbol("UPSTREAM_CREDS_REPO");

/**
 * In-memory registry of upstream credential providers. Populated at boot
 * from env; plugins can register at runtime via manager hooks.
 */
export class UpstreamProviderRegistry {
  private readonly providers = new Map<string, UpstreamCredentialProvider>();

  register(p: UpstreamCredentialProvider): void {
    this.providers.set(p.id, p);
  }

  get(id: string): UpstreamCredentialProvider | undefined {
    return this.providers.get(id);
  }

  list(): UpstreamCredentialProvider[] {
    return [...this.providers.values()];
  }
}

export type UpstreamResolution =
  | { kind: "skip" }
  | { kind: "consent_required"; providerId: string; consentUrl: string | null }
  | { kind: "ready"; injection: DispatchInjection };

@Injectable()
export class UpstreamTokenService {
  constructor(
    private readonly registry: UpstreamProviderRegistry,
    private readonly repo: PrincipalUpstreamCredentialsRepository,
    private readonly metrics: MavioMetrics,
  ) {}

  async resolveForDispatch(
    principal: Principal | undefined,
    descriptor: ServerDescriptor,
  ): Promise<UpstreamResolution> {
    const providerId = (descriptor.metadata as { upstreamOAuthProvider?: string } | undefined)
      ?.upstreamOAuthProvider;
    if (!providerId) return { kind: "skip" };
    if (!principal) {
      this.metrics.upstreamTokenDenied.inc({ provider: providerId, reason: "no_principal" });
      return { kind: "consent_required", providerId, consentUrl: null };
    }

    const provider = this.registry.get(providerId);
    if (!provider) {
      this.metrics.upstreamTokenDenied.inc({ provider: providerId, reason: "unknown_provider" });
      return { kind: "consent_required", providerId, consentUrl: null };
    }

    const existing = await this.repo.get(principal.id, providerId);
    let cred: UpstreamCredential | null = existing;

    if (!cred) {
      if (provider.mint) {
        try {
          cred = await provider.mint({ principalId: principal.id });
          await this.persist(principal.id, providerId, cred);
          this.metrics.upstreamTokenRefresh.inc({ provider: providerId, outcome: "minted" });
        } catch {
          this.metrics.upstreamTokenDenied.inc({ provider: providerId, reason: "mint_failed" });
          return {
            kind: "consent_required",
            providerId,
            consentUrl: await this.buildConsentUrl(provider, principal.id),
          };
        }
      } else {
        this.metrics.upstreamTokenDenied.inc({ provider: providerId, reason: "no_credential" });
        return {
          kind: "consent_required",
          providerId,
          consentUrl: await this.buildConsentUrl(provider, principal.id),
        };
      }
    } else if (isExpiringSoon(cred)) {
      try {
        const refreshed = await provider.refresh(cred);
        await this.persist(principal.id, providerId, refreshed);
        cred = refreshed;
        this.metrics.upstreamTokenRefresh.inc({ provider: providerId, outcome: "refreshed" });
      } catch {
        this.metrics.upstreamTokenRefresh.inc({ provider: providerId, outcome: "failed" });
        this.metrics.upstreamTokenDenied.inc({ provider: providerId, reason: "refresh_failed" });
        await this.repo.revoke(principal.id, providerId);
        return {
          kind: "consent_required",
          providerId,
          consentUrl: await this.buildConsentUrl(provider, principal.id),
        };
      }
    }

    return { kind: "ready", injection: provider.inject(cred) };
  }

  private async persist(
    principalId: string,
    providerId: string,
    cred: UpstreamCredential,
  ): Promise<void> {
    await this.repo.put({
      principalId,
      providerId,
      accessToken: cred.accessToken,
      refreshToken: cred.refreshToken,
      tokenType: cred.tokenType,
      scopes: cred.scopes,
      expiresAt: cred.expiresAt,
      issuer: cred.issuer,
      subject: cred.subject,
    });
  }

  private async buildConsentUrl(
    provider: UpstreamCredentialProvider,
    principalId: string,
  ): Promise<string | null> {
    const base = process.env.MAVIO_PUBLIC_BASE_URL ?? "";
    if (!base) return null;
    const state = `${principalId}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`;
    try {
      const result = await provider.authorize({
        principalId,
        state,
        returnTo: "/",
        callbackBaseUrl: base,
      });
      return result?.url ?? null;
    } catch {
      return null;
    }
  }
}

function isExpiringSoon(cred: UpstreamCredential): boolean {
  if (!cred.expiresAt) return false;
  return cred.expiresAt.getTime() - Date.now() <= 60_000;
}

/**
 * Chooses the KEK backend based on env:
 *   MAVIO_VAULT_KEK=vault-transit → HashiCorp Vault Transit remote wrap/unwrap
 *   (anything else / unset)       → LocalKeyWrapper backed by MAVIO_VAULT_KEYRING
 * Local wrappers reuse the shared EnvKekProvider singleton so admin
 * rotate/retire operations mutate the same instance the Vault reads through.
 */
function buildKeyWrapper(): KeyWrapper {
  if (process.env.MAVIO_VAULT_KEK === "vault-transit") {
    const endpoint = process.env.MAVIO_VAULT_TRANSIT_ENDPOINT;
    const token = process.env.MAVIO_VAULT_TRANSIT_TOKEN;
    const keyName = process.env.MAVIO_VAULT_TRANSIT_KEY;
    if (!endpoint || !token || !keyName) {
      throw new Error(
        "MAVIO_VAULT_KEK=vault-transit requires _ENDPOINT, _TOKEN, and _KEY env vars",
      );
    }
    return new VaultTransitKeyWrapper({
      endpoint,
      token,
      keyName,
      mount: process.env.MAVIO_VAULT_TRANSIT_MOUNT,
      namespace: process.env.MAVIO_VAULT_TRANSIT_NAMESPACE,
    });
  }
  return new LocalKeyWrapper(readKek());
}

/**
 * Applies a DispatchInjection to a transport descriptor. Returns a shallow
 * clone — never mutates the cached descriptor. Env is overlaid onto stdio,
 * headers onto everything else.
 */
export function applyInjection(
  descriptor: ServerDescriptor,
  injection: DispatchInjection,
): ServerDescriptor {
  const t = descriptor.transport;
  let transport: TransportDescriptor;
  if (t.type === "stdio") {
    transport = { ...t, env: { ...(t.env ?? {}), ...(injection.env ?? {}) } };
  } else if (t.type === "http" || t.type === "sse" || t.type === "ws" || t.type === "graphql") {
    transport = { ...t, headers: { ...(t.headers ?? {}), ...(injection.headers ?? {}) } };
  } else {
    transport = t;
  }
  return { ...descriptor, transport };
}

/**
 * Reads the subject token to feed into a token-exchange grant. Looks up the
 * upstream IdP access token that Mavio persisted at OIDC login time under the
 * configured session provider id (MAVIO_TOKENX_SUBJECT_PROVIDER_ID, default
 * "mavio-session"). Non-existence returns null → provider throws → middleware
 * returns consent_required.
 */
function makeSubjectResolver(
  repo: PrincipalUpstreamCredentialsRepository,
): SubjectTokenResolver {
  const providerId = process.env.MAVIO_TOKENX_SUBJECT_PROVIDER_ID ?? "mavio-session";
  return async ({ principalId }) => {
    const stored = await repo.get(principalId, providerId);
    if (!stored) return null;
    return { token: stored.accessToken, tokenType: stored.tokenType };
  };
}

@Global()
@Module({
  providers: [
    {
      provide: UPSTREAM_CREDS_REPO,
      inject: [REGISTRY_DB],
      useFactory: (db: Kysely<Database>): PrincipalUpstreamCredentialsRepository => {
        const wrapper = buildKeyWrapper();
        const vault = new Vault(wrapper);
        return new PrincipalUpstreamCredentialsRepository(db, vault);
      },
    },
    {
      provide: UPSTREAM_PROVIDERS,
      inject: [UPSTREAM_CREDS_REPO],
      useFactory: (repo: PrincipalUpstreamCredentialsRepository): UpstreamProviderRegistry => {
        const registry = new UpstreamProviderRegistry();
        if (process.env.MAVIO_SLACK_CLIENT_ID && process.env.MAVIO_SLACK_CLIENT_SECRET) {
          registry.register(
            new SlackUserProvider({
              clientId: process.env.MAVIO_SLACK_CLIENT_ID,
              clientSecret: process.env.MAVIO_SLACK_CLIENT_SECRET,
              userScopes: (process.env.MAVIO_SLACK_USER_SCOPES ?? "chat:write,channels:read").split(
                ",",
              ),
            }),
          );
        }
        if (process.env.MAVIO_TOKENX_ENDPOINT && process.env.MAVIO_TOKENX_AUDIENCE) {
          registry.register(
            new TokenExchangeProvider({
              id: process.env.MAVIO_TOKENX_ID ?? "keycloak",
              tokenEndpoint: process.env.MAVIO_TOKENX_ENDPOINT,
              clientId: process.env.MAVIO_TOKENX_CLIENT_ID ?? "mavio",
              clientSecret: process.env.MAVIO_TOKENX_CLIENT_SECRET,
              audience: process.env.MAVIO_TOKENX_AUDIENCE,
              resource: process.env.MAVIO_TOKENX_RESOURCE,
              subjectTokenResolver: makeSubjectResolver(repo),
            }),
          );
        }
        return registry;
      },
    },
    {
      provide: UPSTREAM_TOKEN_SERVICE,
      inject: [UPSTREAM_PROVIDERS, UPSTREAM_CREDS_REPO, METRICS],
      useFactory: (
        registry: UpstreamProviderRegistry,
        repo: PrincipalUpstreamCredentialsRepository,
        metrics: MavioMetrics,
      ): UpstreamTokenService => new UpstreamTokenService(registry, repo, metrics),
    },
  ],
  exports: [UPSTREAM_PROVIDERS, UPSTREAM_TOKEN_SERVICE, UPSTREAM_CREDS_REPO],
})
export class UpstreamAuthModule implements OnModuleInit {
  constructor(@Inject(REDIS_SUB) private readonly sub: Redis) {}

  async onModuleInit(): Promise<void> {
    console.log("[upstream-auth] providers loaded");
    // Hot-reload the local KEK singleton on rotate/retire published by any
    // replica. Non-local wrappers (Vault Transit / KMS plugins) are managed
    // out-of-band and don't need this channel — they still receive the message
    // but re-hydrating the local KEK is harmless in that case.
    await this.sub.subscribe(VAULT_RELOAD_CHANNEL).catch((err) => {
      console.warn(`[upstream-auth] failed to subscribe to ${VAULT_RELOAD_CHANNEL}:`, err);
    });
    this.sub.on("message", (channel, message) => {
      if (channel !== VAULT_RELOAD_CHANNEL) return;
      console.log(`[upstream-auth] keyring reload signal: ${message}`);
      resetSharedKek();
    });
  }
}
