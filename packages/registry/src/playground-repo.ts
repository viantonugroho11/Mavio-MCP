import type { Kysely } from "kysely";
import type { Database } from "./schema.js";

export interface PlaygroundRun {
  id: string;
  principalId: string;
  serverId: string;
  toolName: string;
  arguments: unknown;
  response: unknown;
  latencyMs: number;
  status: "ok" | "error";
  invokedAt: Date;
}

export class PlaygroundRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async record(input: Omit<PlaygroundRun, "id" | "invokedAt">): Promise<PlaygroundRun> {
    const row = await this.db
      .insertInto("playground_runs")
      .values({
        principal_id: input.principalId,
        server_id: input.serverId,
        tool_name: input.toolName,
        arguments: JSON.stringify(input.arguments),
        response: JSON.stringify(input.response),
        latency_ms: input.latencyMs,
        status: input.status,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.toRun(row);
  }

  async list(filter: { serverId?: string; limit?: number } = {}): Promise<PlaygroundRun[]> {
    let q = this.db.selectFrom("playground_runs").selectAll().orderBy("invoked_at", "desc").limit(filter.limit ?? 50);
    if (filter.serverId) q = q.where("server_id", "=", filter.serverId);
    const rows = await q.execute();
    return rows.map((r) => this.toRun(r));
  }

  async get(id: string): Promise<PlaygroundRun | null> {
    const row = await this.db.selectFrom("playground_runs").selectAll().where("id", "=", id).executeTakeFirst();
    return row ? this.toRun(row) : null;
  }

  private toRun(row: {
    id: string;
    principal_id: string;
    server_id: string;
    tool_name: string;
    arguments: unknown;
    response: unknown;
    latency_ms: number;
    status: string;
    invoked_at: Date;
  }): PlaygroundRun {
    return {
      id: row.id,
      principalId: row.principal_id,
      serverId: row.server_id,
      toolName: row.tool_name,
      arguments: row.arguments,
      response: row.response,
      latencyMs: row.latency_ms,
      status: row.status as "ok" | "error",
      invokedAt: row.invoked_at,
    };
  }
}
