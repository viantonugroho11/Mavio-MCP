import { Issuer, type Client } from "openid-client";
import type { OidcProvider, OidcProviderRepository } from "@mavio/registry";

interface Cached {
  client: Client;
  fetchedAt: number;
}

/**
 * Lazy discovery + client cache. Providers are stored in DB; discovery happens
 * on first use per provider and is retained until the process restarts or TTL
 * expires. Client secret is resolved from env at call time so rotation is
 * picked up on the next login without a code deploy.
 */
export class OidcClientCache {
  private readonly cache = new Map<string, Cached>();

  constructor(
    private readonly repo: OidcProviderRepository,
    private readonly ttlMs = 3600_000,
  ) {}

  async getProvider(id: string): Promise<OidcProvider> {
    return this.repo.get(id);
  }

  async getClient(provider: OidcProvider): Promise<Client> {
    const secret = process.env[provider.clientSecretRef];
    if (!secret) {
      throw new Error(
        `oidc: env var ${provider.clientSecretRef} not set for provider ${provider.id}`,
      );
    }
    const cached = this.cache.get(provider.id);
    if (cached && Date.now() - cached.fetchedAt < this.ttlMs) {
      return cached.client;
    }
    const issuer = await Issuer.discover(provider.issuerUrl);
    const client = new issuer.Client({
      client_id: provider.clientId,
      client_secret: secret,
      redirect_uris: [provider.redirectUri],
      response_types: ["code"],
    });
    this.cache.set(provider.id, { client, fetchedAt: Date.now() });
    return client;
  }

  invalidate(id?: string): void {
    if (id) this.cache.delete(id);
    else this.cache.clear();
  }
}
