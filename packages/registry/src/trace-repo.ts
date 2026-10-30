import type { Kysely } from "kysely";
import type { Database } from "./schema.js";

export type FailStage =
  | "transform_request"
  | "backend"
  | "transform_response"
  | "schema_validate";

export interface HopRecord {
  stage: string;
  startedAt: string;
  durationMs: number;
  outcome: "ok" | "error";
}

export interface TraceInput {
  principalId: string | null;
  workspaceId: string;
  serverId: string;
  toolName: string;
  clientRequest: Record<string, unknown>;
  backendRequest: Record<string, unknown>;
  backendResponse: Record<string, unknown>;
  clientResponse: Record<string, unknown>;
  hops: HopRecord[];
  failStage: FailStage | null;
  schemaDiff: Record<string, unknown> | null;
  nodeId: string | null;
  latencyMs: number;
}

export interface TraceRecord extends TraceInput {
  id: string;
  timestamp: Date;
}

export interface TraceFilter {
  serverId?: string;
  toolName?: string;
  failStage?: FailStage | "any";
  from?: Date;
  to?: Date;
  limit?: number;
}

const MAX_BODY_BYTES = 64 * 1024;

function capBody(obj: unknown): unknown {
  const s = JSON.stringify(obj);
  if (s.length <= MAX_BODY_BYTES) return obj;
  return { _truncated: true, _preview: s.slice(0, MAX_BODY_BYTES) };
}

const REDACT_KEYS = new Set([
  "authorization",
  "x-api-key",
  "api-key",
  "token",
  "password",
  "secret",
  "cookie",
  "set-cookie",
]);

function redact(obj: unknown, depth = 0): unknown {
  if (depth > 8 || obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : redact(v, depth + 1);
  }
  return out;
}

export class TraceRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async insert(input: TraceInput): Promise<string> {
    const row = await this.db
      .insertInto("invocation_traces")
      .values({
        principal_id: input.principalId,
        workspace_id: input.workspaceId,
        server_id: input.serverId,
        tool_name: input.toolName,
        client_request: JSON.stringify(capBody(redact(input.clientRequest))),
        backend_request: JSON.stringify(capBody(redact(input.backendRequest))),
        backend_response: JSON.stringify(capBody(redact(input.backendResponse))),
        client_response: JSON.stringify(capBody(input.clientResponse)),
        hops: JSON.stringify(input.hops),
        fail_stage: input.failStage,
        schema_diff: input.schemaDiff ? JSON.stringify(input.schemaDiff) : null,
        node_id: input.nodeId,
        latency_ms: input.latencyMs,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async get(id: string): Promise<TraceRecord | null> {
    const row = await this.db
      .selectFrom("invocation_traces")
      .selectAll()
      .where("id", "=", id)
      .executeTakeFirst();
    return row ? rowToRecord(row) : null;
  }

  async list(filter: TraceFilter = {}): Promise<TraceRecord[]> {
    let q = this.db.selectFrom("invocation_traces").selectAll();
    if (filter.serverId) q = q.where("server_id", "=", filter.serverId);
    if (filter.toolName) q = q.where("tool_name", "=", filter.toolName);
    if (filter.failStage && filter.failStage !== "any") {
      q = q.where("fail_stage", "=", filter.failStage);
    } else if (filter.failStage === "any") {
      q = q.where("fail_stage", "is not", null);
    }
    if (filter.from) q = q.where("timestamp", ">=", filter.from);
    if (filter.to) q = q.where("timestamp", "<=", filter.to);
    const rows = await q
      .orderBy("timestamp", "desc")
      .limit(filter.limit ?? 100)
      .execute();
    return rows.map(rowToRecord);
  }
}

function rowToRecord(row: {
  id: string;
  timestamp: Date;
  principal_id: string | null;
  workspace_id: string;
  server_id: string;
  tool_name: string;
  client_request: unknown;
  backend_request: unknown;
  backend_response: unknown;
  client_response: unknown;
  hops: unknown;
  fail_stage: string | null;
  schema_diff: unknown;
  node_id: string | null;
  latency_ms: number;
}): TraceRecord {
  return {
    id: row.id,
    timestamp: row.timestamp,
    principalId: row.principal_id,
    workspaceId: row.workspace_id,
    serverId: row.server_id,
    toolName: row.tool_name,
    clientRequest: row.client_request as Record<string, unknown>,
    backendRequest: row.backend_request as Record<string, unknown>,
    backendResponse: row.backend_response as Record<string, unknown>,
    clientResponse: row.client_response as Record<string, unknown>,
    hops: row.hops as HopRecord[],
    failStage: (row.fail_stage as FailStage | null) ?? null,
    schemaDiff: (row.schema_diff as Record<string, unknown> | null) ?? null,
    nodeId: row.node_id,
    latencyMs: row.latency_ms,
  };
}
