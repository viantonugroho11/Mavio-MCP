import { Global, Inject, Injectable, Module, type OnModuleInit } from "@nestjs/common";
import type {
  DispatchInjection,
  UpstreamCredential,
  UpstreamCredentialProvider,
} from "@mavio/sdk";
import type { Principal, ServerDescriptor, TransportDescriptor } from "@mavio/core";
import {
  EnvKekProvider,
  PrincipalUpstreamCredentialsRepository,
  SlackUserProvider,
  TokenExchangeProvider,
  Vault,
  type SubjectTokenResolver,
} from "@mavio/upstream-auth";
import type { Kysely } from "kysely";
import type { Database } from "@mavio/registry";
import { REGISTRY_DB } from "./registry.module.js";

export const UPSTREAM_PROVIDERS = Symbol("UPSTREAM_PROVIDERS");
export const UPSTREAM_TOKEN_SERVICE = Symbol("UPSTREAM_TOKEN_SERVICE");

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
  ) {}

  async resolveForDispatch(
    principal: Principal | undefined,
    descriptor: ServerDescriptor,
  ): Promise<UpstreamResolution> {
    const providerId = (descriptor.metadata as { upstreamOAuthProvider?: string } | undefined)
      ?.upstreamOAuthProvider;
    if (!providerId) return { kind: "skip" };
    if (!principal) {
      return { kind: "consent_required", providerId, consentUrl: null };
    }

    const provider = this.registry.get(providerId);
    if (!provider) {
      return { kind: "consent_required", providerId, consentUrl: null };
    }

    const existing = await this.repo.get(principal.id, providerId);
    let cred: UpstreamCredential | null = existing;

    if (!cred) {
      // No credential yet. If the provider does non-interactive mint (token
      // exchange), attempt it. Otherwise, tell the caller to consent.
      if (provider.mint) {
        try {
          cred = await provider.mint({ principalId: principal.id });
          await this.persist(principal.id, providerId, cred);
        } catch {
          return {
            kind: "consent_required",
            providerId,
            consentUrl: await this.buildConsentUrl(provider, principal.id),
          };
        }
      } else {
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
      } catch {
        // Refresh failed — user must reconsent.
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

@Global()
@Module({
  providers: [
    {
      provide: UPSTREAM_PROVIDERS,
      useFactory: (): UpstreamProviderRegistry => {
        const registry = new UpstreamProviderRegistry();
        // Builtin Slack provider (env-configured).
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
        // Keycloak / KrakenD token-exchange (env-configured).
        if (process.env.MAVIO_TOKENX_ENDPOINT && process.env.MAVIO_TOKENX_AUDIENCE) {
          const resolver: SubjectTokenResolver = async () => null;
          registry.register(
            new TokenExchangeProvider({
              id: process.env.MAVIO_TOKENX_ID ?? "keycloak",
              tokenEndpoint: process.env.MAVIO_TOKENX_ENDPOINT,
              clientId: process.env.MAVIO_TOKENX_CLIENT_ID ?? "mavio",
              clientSecret: process.env.MAVIO_TOKENX_CLIENT_SECRET,
              audience: process.env.MAVIO_TOKENX_AUDIENCE,
              resource: process.env.MAVIO_TOKENX_RESOURCE,
              subjectTokenResolver: resolver,
            }),
          );
        }
        return registry;
      },
    },
    {
      provide: UPSTREAM_TOKEN_SERVICE,
      inject: [UPSTREAM_PROVIDERS, REGISTRY_DB],
      useFactory: (
        registry: UpstreamProviderRegistry,
        db: Kysely<Database>,
      ): UpstreamTokenService => {
        const kek = new EnvKekProvider();
        const vault = new Vault(kek);
        const repo = new PrincipalUpstreamCredentialsRepository(db, vault);
        return new UpstreamTokenService(registry, repo);
      },
    },
  ],
  exports: [UPSTREAM_PROVIDERS, UPSTREAM_TOKEN_SERVICE],
})
export class UpstreamAuthModule implements OnModuleInit {
  onModuleInit(): void {
    console.log("[upstream-auth] providers loaded");
  }
}
