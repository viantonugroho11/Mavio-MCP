import { sql, type Kysely } from "kysely";
import type { Database } from "@mavio/registry";
import { Vault } from "./vault.js";

/**
 * Decrypted upstream token as callers see it. `accessToken` and `refreshToken`
 * are cleartext strings; the vault handles encryption round-trip.
 */
export interface UpstreamToken {
  principalId: string;
  providerId: string;
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scopes: string[];
  expiresAt?: Date;
  issuer?: string;
  subject?: string;
  keyId: string;
  updatedAt: Date;
}

export interface UpstreamTokenInput {
  principalId: string;
  providerId: string;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scopes?: string[];
  expiresAt?: Date;
  issuer?: string;
  subject?: string;
}

export class PrincipalUpstreamCredentialsRepository {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly vault: Vault,
  ) {}

  async put(input: UpstreamTokenInput): Promise<UpstreamToken> {
    const access = this.vault.encrypt(input.accessToken);
    // Refresh token, if present, is stored inline in the same ciphertext blob
    // as a JSON envelope so it shares one DEK and one row.
    const payload = JSON.stringify({
      access: input.accessToken,
      refresh: input.refreshToken ?? null,
    });
    const env = this.vault.encrypt(payload);

    const row = await this.db
      .insertInto("principal_upstream_credentials")
      .values({
        principal_id: input.principalId,
        provider_id: input.providerId,
        key_id: env.keyId,
        wrapped_dek: env.wrappedDek,
        iv: env.iv,
        auth_tag: env.authTag,
        ciphertext: env.ciphertext,
        token_type: input.tokenType ?? "Bearer",
        scopes: input.scopes ?? [],
        expires_at: input.expiresAt ?? null,
        issuer: input.issuer ?? null,
        subject: input.subject ?? null,
      })
      .onConflict((oc) =>
        oc.columns(["principal_id", "provider_id"]).doUpdateSet({
          key_id: env.keyId,
          wrapped_dek: env.wrappedDek,
          iv: env.iv,
          auth_tag: env.authTag,
          ciphertext: env.ciphertext,
          token_type: input.tokenType ?? "Bearer",
          scopes: input.scopes ?? [],
          expires_at: input.expiresAt ?? null,
          issuer: input.issuer ?? null,
          subject: input.subject ?? null,
          updated_at: sql`now()`,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();

    // Silence unused-variable warning; access envelope kept for future
    // access-only reads that don't need the refresh token.
    void access;

    return this.toToken(row);
  }

  async get(principalId: string, providerId: string): Promise<UpstreamToken | null> {
    const row = await this.db
      .selectFrom("principal_upstream_credentials")
      .selectAll()
      .where("principal_id", "=", principalId)
      .where("provider_id", "=", providerId)
      .executeTakeFirst();
    if (!row) return null;
    return this.toToken(row);
  }

  async revoke(principalId: string, providerId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom("principal_upstream_credentials")
      .where("principal_id", "=", principalId)
      .where("provider_id", "=", providerId)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  /**
   * Metadata-only listing for admin surfaces (never returns access tokens).
   */
  async listByPrincipal(principalId: string): Promise<
    Array<{
      providerId: string;
      tokenType: string;
      scopes: string[];
      expiresAt: Date | null;
      issuer: string | null;
      subject: string | null;
      keyId: string;
      updatedAt: Date;
    }>
  > {
    const rows = await this.db
      .selectFrom("principal_upstream_credentials")
      .select([
        "provider_id",
        "token_type",
        "scopes",
        "expires_at",
        "issuer",
        "subject",
        "key_id",
        "updated_at",
      ])
      .where("principal_id", "=", principalId)
      .orderBy("provider_id", "asc")
      .execute();
    return rows.map((r) => ({
      providerId: r.provider_id,
      tokenType: r.token_type,
      scopes: r.scopes,
      expiresAt: r.expires_at,
      issuer: r.issuer,
      subject: r.subject,
      keyId: r.key_id,
      updatedAt: r.updated_at,
    }));
  }

  async countByKeyId(): Promise<Record<string, number>> {
    const rows = await this.db
      .selectFrom("principal_upstream_credentials")
      .select(({ fn }) => ["key_id", fn.count<number>("id").as("count")])
      .groupBy("key_id")
      .execute();
    const out: Record<string, number> = {};
    for (const r of rows) out[r.key_id] = Number(r.count);
    return out;
  }

  /**
   * Re-wrap a row's envelope under the current primary key. Called by refresh
   * paths and by an optional background sweep before a `retire` operation.
   */
  async rewrap(principalId: string, providerId: string): Promise<void> {
    const row = await this.db
      .selectFrom("principal_upstream_credentials")
      .selectAll()
      .where("principal_id", "=", principalId)
      .where("provider_id", "=", providerId)
      .executeTakeFirst();
    if (!row) return;
    const env = {
      keyId: row.key_id,
      wrappedDek: row.wrapped_dek,
      iv: row.iv,
      authTag: row.auth_tag,
      ciphertext: row.ciphertext,
    };
    const next = this.vault.rewrap(env);
    if (next.keyId === row.key_id) return;
    await this.db
      .updateTable("principal_upstream_credentials")
      .set({
        key_id: next.keyId,
        wrapped_dek: next.wrappedDek,
        iv: next.iv,
        auth_tag: next.authTag,
        ciphertext: next.ciphertext,
        updated_at: sql`now()`,
      })
      .where("id", "=", row.id)
      .execute();
  }

  private toToken(row: {
    principal_id: string;
    provider_id: string;
    key_id: string;
    wrapped_dek: Buffer;
    iv: Buffer;
    auth_tag: Buffer;
    ciphertext: Buffer;
    token_type: string;
    scopes: string[];
    expires_at: Date | null;
    issuer: string | null;
    subject: string | null;
    updated_at: Date;
  }): UpstreamToken {
    const plaintext = this.vault
      .decrypt({
        keyId: row.key_id,
        wrappedDek: row.wrapped_dek,
        iv: row.iv,
        authTag: row.auth_tag,
        ciphertext: row.ciphertext,
      })
      .toString("utf8");
    const parsed = JSON.parse(plaintext) as { access: string; refresh: string | null };
    return {
      principalId: row.principal_id,
      providerId: row.provider_id,
      accessToken: parsed.access,
      refreshToken: parsed.refresh ?? undefined,
      tokenType: row.token_type,
      scopes: row.scopes,
      expiresAt: row.expires_at ?? undefined,
      issuer: row.issuer ?? undefined,
      subject: row.subject ?? undefined,
      keyId: row.key_id,
      updatedAt: row.updated_at,
    };
  }
}
