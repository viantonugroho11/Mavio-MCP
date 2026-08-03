import type { Kysely } from "kysely";
import { sql } from "kysely";
import type {
  ServerCapabilities,
  ServerDescriptor,
  ServerStatus,
  TransportDescriptor,
} from "@mavio/core";
import { NotFoundError } from "@mavio/core";
import type { Database } from "./schema.js";

export { createDb } from "./db.js";
export type { Database } from "./schema.js";
export { RbacRepository, hashApiKey } from "./rbac-repo.js";
export type { Principal as StoredPrincipal, IssuedApiKey } from "./rbac-repo.js";
export { diffCapabilities, type CapabilityDiff, type ToolChange } from "./diff.js";
export { PlaygroundRepository, type PlaygroundRun } from "./playground-repo.js";

export interface RegisterInput extends Omit<ServerDescriptor, "version"> {
  version?: string;
}

export class Registry {
  constructor(private readonly db: Kysely<Database>) {}

  async register(input: RegisterInput): Promise<ServerDescriptor> {
    const row = await this.db
      .insertInto("servers")
      .values({
        id: input.id,
        workspace_id: input.workspaceId,
        project_id: input.projectId,
        name: input.name,
        source_type: input.sourceType,
        transport: JSON.stringify(input.transport),
        version: input.version ?? null,
        metadata: JSON.stringify(input.metadata ?? {}),
        tags: input.tags ?? [],
        status: "unknown",
      })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          name: input.name,
          transport: JSON.stringify(input.transport),
          tags: input.tags ?? [],
          metadata: JSON.stringify(input.metadata ?? {}),
          updated_at: sql`now()`,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.toDescriptor(row);
  }

  async unregister(id: string): Promise<void> {
    const result = await this.db.deleteFrom("servers").where("id", "=", id).executeTakeFirst();
    if (result.numDeletedRows === 0n) throw new NotFoundError(`server ${id}`);
  }

  async get(id: string): Promise<ServerDescriptor> {
    const row = await this.db.selectFrom("servers").selectAll().where("id", "=", id).executeTakeFirst();
    if (!row) throw new NotFoundError(`server ${id}`);
    return this.toDescriptor(row);
  }

  async list(filter: { workspaceId?: string; projectId?: string } = {}): Promise<ServerDescriptor[]> {
    let q = this.db.selectFrom("servers").selectAll();
    if (filter.workspaceId) q = q.where("workspace_id", "=", filter.workspaceId);
    if (filter.projectId) q = q.where("project_id", "=", filter.projectId);
    const rows = await q.orderBy("id", "asc").execute();
    return rows.map((r) => this.toDescriptor(r));
  }

  async updateStatus(id: string, status: ServerStatus): Promise<void> {
    await this.db
      .updateTable("servers")
      .set({ status, updated_at: sql`now()` })
      .where("id", "=", id)
      .execute();
  }

  async snapshotCapabilities(
    serverId: string,
    version: string,
    capabilities: ServerCapabilities,
  ): Promise<void> {
    await this.db
      .insertInto("capability_snapshots")
      .values({
        server_id: serverId,
        version,
        capabilities: JSON.stringify(capabilities),
      })
      .execute();
  }

  async latestCapabilities(serverId: string): Promise<ServerCapabilities | null> {
    const row = await this.db
      .selectFrom("capability_snapshots")
      .selectAll()
      .where("server_id", "=", serverId)
      .orderBy("taken_at", "desc")
      .limit(1)
      .executeTakeFirst();
    return row ? (row.capabilities as ServerCapabilities) : null;
  }

  async listSnapshots(
    serverId: string,
    limit = 25,
  ): Promise<Array<{ id: string; version: string; takenAt: Date; capabilities: ServerCapabilities }>> {
    const rows = await this.db
      .selectFrom("capability_snapshots")
      .selectAll()
      .where("server_id", "=", serverId)
      .orderBy("taken_at", "desc")
      .limit(limit)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      takenAt: r.taken_at,
      capabilities: r.capabilities as ServerCapabilities,
    }));
  }

  async getSnapshot(id: string): Promise<{ version: string; capabilities: ServerCapabilities } | null> {
    const row = await this.db
      .selectFrom("capability_snapshots")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row ? { version: row.version, capabilities: row.capabilities as ServerCapabilities } : null;
  }

  private toDescriptor(row: {
    id: string;
    workspace_id: string;
    project_id: string;
    name: string;
    source_type: string;
    transport: unknown;
    version: string | null;
    metadata: unknown;
    tags: string[];
    status?: string;
    updated_at?: Date;
  }): ServerDescriptor {
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      name: row.name,
      sourceType: row.source_type as ServerDescriptor["sourceType"],
      transport: row.transport as TransportDescriptor,
      version: row.version ?? undefined,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      tags: row.tags,
      status: (row.status as ServerDescriptor["status"]) ?? "unknown",
      lastCheckedAt: row.updated_at?.toISOString(),
    };
  }
}
