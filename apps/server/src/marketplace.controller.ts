import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { Actions } from "@mavio/rbac";
import { MarketplaceClient, type MarketplaceEntry } from "@mavio/marketplace";
import { ApiKeyGuard } from "./auth.guard.js";
import { RbacGuard, RequirePermission } from "./rbac.guard.js";

@Controller("api/marketplace")
@UseGuards(ApiKeyGuard, RbacGuard)
export class MarketplaceController {
  private client: MarketplaceClient | null = null;

  private getClient(): MarketplaceClient | null {
    if (this.client) return this.client;
    const url = process.env.MAVIO_MARKETPLACE_URL;
    if (!url) return null;
    this.client = new MarketplaceClient({
      indexUrl: url,
      publicKeyPem: process.env.MAVIO_MARKETPLACE_PUBKEY_PEM,
    });
    return this.client;
  }

  @Get()
  @RequirePermission(Actions.PluginInstall)
  async search(@Query("q") q?: string): Promise<{ enabled: boolean; results: MarketplaceEntry[] }> {
    const client = this.getClient();
    if (!client) return { enabled: false, results: [] };
    return { enabled: true, results: await client.search(q ?? "") };
  }

  @Get("get")
  @RequirePermission(Actions.PluginInstall)
  async get(@Query("name") name: string): Promise<MarketplaceEntry | { error: string }> {
    const client = this.getClient();
    if (!client) return { error: "marketplace disabled" };
    const entry = await client.get(name);
    return entry ?? { error: `not found: ${name}` };
  }
}
