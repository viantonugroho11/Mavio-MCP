import type { Kysely } from "kysely";
import { sql } from "kysely";
import { NotFoundError } from "@mavio/core";
import type { Database } from "./schema.js";

export type EventSourceType = "webhook" | "kafka" | "nats";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface WebhookMatch {
  path: string;
  method?: "POST" | "PUT";
}

export interface StreamMatch {
  topic: string;
  filter?: string;
}

export type EventMatch = WebhookMatch | StreamMatch;

export interface McpTarget {
  serverId: string;
  toolName: string;
  argsTemplate?: Record<string, unknown>;
}

export interface EventAuth {
  type: "hmac" | "mtls" | "oidc" | "none";
  secretRef?: string;
  issuerUrl?: string;
  audience?: string;
}

export interface EventRoute {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  sourceType: EventSourceType;
  match: EventMatch;
  mcpTarget: McpTarget;
  principalId: string;
  schemaRef?: string;
  schemaJson?: Record<string, unknown>;
  auth: EventAuth;
  enabled: boolean;
  approvalStatus: ApprovalStatus;
  submittedBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateEventRouteInput {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  sourceType: EventSourceType;
  match: EventMatch;
  mcpTarget: McpTarget;
  principalId: string;
  schemaRef?: string;
  schemaJson?: Record<string, unknown>;
  auth?: EventAuth;
  submittedBy?: string;
  autoApprove?: boolean;
}

export interface ListEventRouteFilter {
  workspaceId?: string;
  projectId?: string;
  sourceType?: EventSourceType;
  approvalStatus?: ApprovalStatus | "any";
  enabledOnly?: boolean;
}

export class EventRouteRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async create(input: CreateEventRouteInput): Promise<EventRoute> {
    const approvalStatus: ApprovalStatus = input.autoApprove ? "approved" : "pending";
    const row = await this.db
      .insertInto("event_routes")
      .values({
        id: input.id,
        workspace_id: input.workspaceId,
        project_id: input.projectId,
        name: input.name,
        source_type: input.sourceType,
        match: JSON.stringify(input.match),
        mcp_target: JSON.stringify(input.mcpTarget),
        principal_id: input.principalId,
        schema_ref: input.schemaRef ?? null,
        schema_json: input.schemaJson ? JSON.stringify(input.schemaJson) : null,
        auth: JSON.stringify(input.auth ?? { type: "none" }),
        approval_status: approvalStatus,
        submitted_by: input.submittedBy ?? null,
        approved_by: input.autoApprove ? (input.submittedBy ?? null) : null,
        approved_at: input.autoApprove ? new Date() : null,
      })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          name: input.name,
          match: JSON.stringify(input.match),
          mcp_target: JSON.stringify(input.mcpTarget),
          schema_ref: input.schemaRef ?? null,
          schema_json: input.schemaJson ? JSON.stringify(input.schemaJson) : null,
          auth: JSON.stringify(input.auth ?? { type: "none" }),
          approval_status: "pending",
          submitted_by: input.submittedBy ?? null,
          approved_by: null,
          approved_at: null,
          rejection_reason: null,
          updated_at: sql`now()`,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return toRoute(row);
  }

  async get(id: string): Promise<EventRoute> {
    const row = await this.db
      .selectFrom("event_routes")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    if (!row) throw new NotFoundError(`event_route ${id}`);
    return toRoute(row);
  }

  async list(filter: ListEventRouteFilter = {}): Promise<EventRoute[]> {
    let q = this.db.selectFrom("event_routes").selectAll();
    if (filter.workspaceId) q = q.where("workspace_id", "=", filter.workspaceId);
    if (filter.projectId) q = q.where("project_id", "=", filter.projectId);
    if (filter.sourceType) q = q.where("source_type", "=", filter.sourceType);
    const status = filter.approvalStatus ?? "approved";
    if (status !== "any") q = q.where("approval_status", "=", status);
    if (filter.enabledOnly) q = q.where("enabled", "=", true);
    const rows = await q.orderBy("id", "asc").execute();
    return rows.map(toRoute);
  }

  async approve(id: string, approverId: string): Promise<EventRoute> {
    const row = await this.db
      .updateTable("event_routes")
      .set({
        approval_status: "approved",
        approved_by: approverId,
        approved_at: new Date(),
        rejection_reason: null,
        updated_at: sql`now()`,
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new NotFoundError(`event_route ${id}`);
    return toRoute(row);
  }

  async reject(id: string, approverId: string, reason: string): Promise<EventRoute> {
    const row = await this.db
      .updateTable("event_routes")
      .set({
        approval_status: "rejected",
        approved_by: approverId,
        approved_at: new Date(),
        rejection_reason: reason,
        updated_at: sql`now()`,
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new NotFoundError(`event_route ${id}`);
    return toRoute(row);
  }

  async setEnabled(id: string, enabled: boolean): Promise<EventRoute> {
    const row = await this.db
      .updateTable("event_routes")
      .set({ enabled, updated_at: sql`now()` })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new NotFoundError(`event_route ${id}`);
    return toRoute(row);
  }

  async delete(id: string): Promise<void> {
    const result = await this.db.deleteFrom("event_routes").where("id", "=", id).executeTakeFirst();
    if (result.numDeletedRows === 0n) throw new NotFoundError(`event_route ${id}`);
  }
}

function toRoute(row: {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  source_type: string;
  match: unknown;
  mcp_target: unknown;
  principal_id: string;
  schema_ref: string | null;
  schema_json: unknown | null;
  auth: unknown;
  enabled: boolean;
  approval_status: string;
  submitted_by: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
}): EventRoute {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    name: row.name,
    sourceType: row.source_type as EventSourceType,
    match: row.match as EventMatch,
    mcpTarget: row.mcp_target as McpTarget,
    principalId: row.principal_id,
    schemaRef: row.schema_ref ?? undefined,
    schemaJson: (row.schema_json as Record<string, unknown> | null) ?? undefined,
    auth: (row.auth as EventAuth) ?? { type: "none" },
    enabled: row.enabled,
    approvalStatus: row.approval_status as ApprovalStatus,
    submittedBy: row.submitted_by ?? undefined,
    approvedBy: row.approved_by ?? undefined,
    approvedAt: row.approved_at?.toISOString(),
    rejectionReason: row.rejection_reason ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
