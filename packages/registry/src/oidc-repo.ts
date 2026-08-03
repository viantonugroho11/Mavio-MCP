import type { Kysely } from "kysely";
import { NotFoundError } from "@mavio/core";
import type { Database } from "./schema.js";

export interface OidcProvider {
  id: string;
  displayName: string;
  issuerUrl: string;
  clientId: string;
  clientSecretRef: string;
  redirectUri: string;
  scopes: string[];
  enabled: boolean;
}

export interface OidcProviderInput {
  id: string;
  displayName: string;
  issuerUrl: string;
  clientId: string;
  clientSecretRef: string;
  redirectUri: string;
  scopes?: string[];
  enabled?: boolean;
}

export class OidcProviderRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async list(includeDisabled = false): Promise<OidcProvider[]> {
    let query = this.db.selectFrom("oidc_providers").selectAll();
    if (!includeDisabled) query = query.where("enabled", "=", true);
    const rows = await query.orderBy("id", "asc").execute();
    return rows.map((r) => this.toProvider(r));
  }

  async get(id: string): Promise<OidcProvider> {
    const row = await this.db
      .selectFrom("oidc_providers")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) throw new NotFoundError(`oidc provider ${id}`);
    return this.toProvider(row);
  }

  async upsert(input: OidcProviderInput): Promise<OidcProvider> {
    const scopes = input.scopes ?? ["openid", "profile", "email"];
    const enabled = input.enabled ?? true;
    const row = await this.db
      .insertInto("oidc_providers")
      .values({
        id: input.id,
        display_name: input.displayName,
        issuer_url: input.issuerUrl,
        client_id: input.clientId,
        client_secret_ref: input.clientSecretRef,
        redirect_uri: input.redirectUri,
        scopes,
        enabled,
      })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          display_name: input.displayName,
          issuer_url: input.issuerUrl,
          client_id: input.clientId,
          client_secret_ref: input.clientSecretRef,
          redirect_uri: input.redirectUri,
          scopes,
          enabled,
          updated_at: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.toProvider(row);
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom("oidc_providers").where("id", "=", id).execute();
  }

  private toProvider(row: {
    id: string;
    display_name: string;
    issuer_url: string;
    client_id: string;
    client_secret_ref: string;
    redirect_uri: string;
    scopes: string[];
    enabled: boolean;
  }): OidcProvider {
    return {
      id: row.id,
      displayName: row.display_name,
      issuerUrl: row.issuer_url,
      clientId: row.client_id,
      clientSecretRef: row.client_secret_ref,
      redirectUri: row.redirect_uri,
      scopes: row.scopes,
      enabled: row.enabled,
    };
  }
}
