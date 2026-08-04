import type { Kysely } from "kysely";
import type { Database } from "./schema.js";

export interface AuditLogInput {
  actorId?: string | null;
  actorType?: string | null;
  action: string;
  resource?: Record<string, unknown>;
  outcome: "ok" | "denied" | "error";
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export interface AuditLogRecord {
  id: string;
  at: Date;
  actorId: string | null;
  actorType: string | null;
  action: string;
  resource: Record<string, unknown>;
  outcome: string;
  metadata: Record<string, unknown>;
  ip: string | null;
}

export interface AuditLogFilter {
  actorId?: string;
  action?: string;
  outcome?: string;
  since?: Date;
  limit?: number;
}

export class AuditRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async record(input: AuditLogInput): Promise<void> {
    await this.db
      .insertInto("audit_logs")
      .values({
        actor_id: input.actorId ?? null,
        actor_type: input.actorType ?? null,
        action: input.action,
        resource: JSON.stringify(input.resource ?? {}),
        outcome: input.outcome,
        metadata: JSON.stringify(input.metadata ?? {}),
        ip: input.ip ?? null,
      })
      .execute();
  }

  async list(filter: AuditLogFilter = {}): Promise<AuditLogRecord[]> {
    let q = this.db
      .selectFrom("audit_logs")
      .selectAll()
      .orderBy("at", "desc")
      .limit(Math.min(filter.limit ?? 100, 500));
    if (filter.actorId) q = q.where("actor_id", "=", filter.actorId);
    if (filter.action) q = q.where("action", "=", filter.action);
    if (filter.outcome) q = q.where("outcome", "=", filter.outcome);
    if (filter.since) q = q.where("at", ">=", filter.since);
    const rows = await q.execute();
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      actorId: r.actor_id,
      actorType: r.actor_type,
      action: r.action,
      resource: (r.resource as Record<string, unknown>) ?? {},
      outcome: r.outcome,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      ip: r.ip,
    }));
  }
}
