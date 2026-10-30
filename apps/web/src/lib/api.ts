export const API_URL = process.env.NEXT_PUBLIC_MAVIO_API_URL ?? "http://localhost:4000";

const authHeaders = (): Record<string, string> => {
  const key = process.env.NEXT_PUBLIC_MAVIO_ADMIN_API_KEY;
  return key ? { authorization: `Bearer ${key}` } : {};
};

export interface ServerRow {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  sourceType: string;
  transport: { type: string; baseUrl?: string; command?: string; endpoint?: string; dsn?: string };
  tags?: string[];
  version?: string;
  status?: "healthy" | "degraded" | "down" | "unknown";
  lastCheckedAt?: string;
  approvalStatus?: "pending" | "approved" | "rejected";
  submittedBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface Capabilities {
  tools?: ToolInfo[];
  serverInfo?: { name?: string; version?: string };
}

export async function listServers(): Promise<ServerRow[]> {
  const res = await fetch(`${API_URL}/api/servers`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`list servers ${res.status}`);
  return res.json();
}

export async function getServer(id: string): Promise<ServerRow> {
  const res = await fetch(`${API_URL}/api/servers/${id}`, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`get server ${res.status}`);
  return res.json();
}

export async function getCapabilities(id: string): Promise<Capabilities> {
  const res = await fetch(`${API_URL}/api/servers/${id}/capabilities`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`capabilities ${res.status}`);
  return res.json();
}

export async function importOpenApi(body: {
  id: string;
  workspaceId: string;
  projectId: string;
  url?: string;
  baseUrl?: string;
  upstreamOAuthProvider?: string;
}): Promise<{ ok: boolean; approvalStatus: string; snapshotDeferred: boolean }> {
  const res = await fetch(`${API_URL}/api/imports/openapi`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    approvalStatus?: string;
    snapshotDeferred?: boolean;
    message?: string;
  };
  if (!res.ok) throw new Error(json.message ?? `import ${res.status}`);
  return {
    ok: true,
    approvalStatus: json.approvalStatus ?? "pending",
    snapshotDeferred: json.snapshotDeferred ?? true,
  };
}

export type McpTransport =
  | { type: "stdio"; command: string; args?: string[] }
  | {
      type: "http";
      baseUrl: string;
      headers?: Record<string, string>;
      auth?: { type: "bearer"; secretRef: string };
    }
  | {
      type: "sse";
      url: string;
      headers?: Record<string, string>;
      auth?: { type: "bearer"; secretRef: string };
    };

export async function importMcp(body: {
  id: string;
  workspaceId: string;
  projectId: string;
  name?: string;
  transport: McpTransport;
  upstreamOAuthProvider?: string;
}): Promise<{ ok: boolean; approvalStatus: string; snapshotDeferred: boolean }> {
  const res = await fetch(`${API_URL}/api/imports/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    ok?: boolean;
    approvalStatus?: string;
    snapshotDeferred?: boolean;
    message?: string;
  };
  if (!res.ok) throw new Error(json.message ?? `import ${res.status}`);
  return {
    ok: true,
    approvalStatus: json.approvalStatus ?? "pending",
    snapshotDeferred: json.snapshotDeferred ?? true,
  };
}

export async function listPendingImports(): Promise<ServerRow[]> {
  const res = await fetch(`${API_URL}/api/imports/pending`, {
    headers: authHeaders(),
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`list pending ${res.status}`);
  return res.json();
}

export async function approveImport(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/imports/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    credentials: "include",
  });
  if (!res.ok) throw new Error(`approve ${res.status}`);
}

export async function rejectImport(id: string, reason: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/imports/${encodeURIComponent(id)}/reject`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error(`reject ${res.status}`);
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${API_URL}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  return res.json();
}

export interface Snapshot {
  id: string;
  version: string;
  takenAt: string;
  capabilities: Capabilities;
}

export interface CapabilityDiff {
  added: Array<{ name: string }>;
  removed: Array<{ name: string }>;
  changed: Array<{ name: string }>;
  unchanged: number;
}

export async function listSnapshots(serverId: string): Promise<Snapshot[]> {
  const res = await fetch(`${API_URL}/api/servers/${serverId}/snapshots`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`snapshots ${res.status}`);
  return res.json();
}

export async function diffSnapshots(serverId: string, a: string, b: string): Promise<CapabilityDiff> {
  const res = await fetch(
    `${API_URL}/api/servers/${serverId}/snapshots/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
    { headers: authHeaders(), cache: "no-store" },
  );
  if (!res.ok) throw new Error(`diff ${res.status}`);
  return res.json();
}

export interface PlaygroundRun {
  id: string;
  serverId: string;
  toolName: string;
  arguments: unknown;
  response: unknown;
  latencyMs: number;
  status: "ok" | "error";
  invokedAt: string;
}

export async function invokePlayground(
  server: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<{ runId: string; latencyMs: number; response: unknown }> {
  const res = await fetch(`${API_URL}/api/playground/invoke`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ server, tool, arguments: args }),
  });
  if (!res.ok) throw new Error(`invoke ${res.status}`);
  return res.json();
}

export async function listRuns(serverId?: string): Promise<PlaygroundRun[]> {
  const url = new URL(`${API_URL}/api/playground/runs`);
  if (serverId) url.searchParams.set("server", serverId);
  const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`runs ${res.status}`);
  return res.json();
}

export async function importSql(body: {
  id: string;
  workspaceId: string;
  projectId: string;
  dsn: string;
  allowedTables?: string[];
  readOnly?: boolean;
}): Promise<{ ok: boolean; approvalStatus: string; snapshotDeferred: boolean }> {
  const res = await fetch(`${API_URL}/api/imports/sql`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message ?? `import ${res.status}`);
  return json;
}

export async function importGraphqlEndpoint(body: {
  id: string;
  workspaceId: string;
  projectId: string;
  endpoint: string;
}): Promise<{ ok: boolean; approvalStatus: string; snapshotDeferred: boolean }> {
  const res = await fetch(`${API_URL}/api/imports/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message ?? `import ${res.status}`);
  return json;
}

export interface AuthProvider {
  id: string;
  displayName: string;
  loginUrl: string;
}

export interface Me {
  principal: { id: string; type: string; workspaceId: string; scopes: string[] };
  email?: string;
  displayName?: string;
  providerId: string;
  expiresAt: number;
}

export async function listAuthProviders(): Promise<AuthProvider[]> {
  const res = await fetch(`${API_URL}/auth/providers`, { cache: "no-store" });
  if (!res.ok) throw new Error(`providers ${res.status}`);
  return res.json();
}

export async function fetchMe(): Promise<Me | null> {
  const res = await fetch(`${API_URL}/auth/me`, { credentials: "include", cache: "no-store" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`me ${res.status}`);
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch(`${API_URL}/auth/logout`, { method: "POST", credentials: "include" });
}

export interface HopRecord {
  stage: string;
  startedAt: string;
  durationMs: number;
  outcome: "ok" | "error";
}

export interface TraceRecord {
  id: string;
  timestamp: string;
  principalId: string | null;
  workspaceId: string;
  serverId: string;
  toolName: string;
  clientRequest: Record<string, unknown>;
  backendRequest: Record<string, unknown>;
  backendResponse: Record<string, unknown>;
  clientResponse: Record<string, unknown>;
  hops: HopRecord[];
  failStage: string | null;
  schemaDiff: Record<string, unknown> | null;
  nodeId: string | null;
  latencyMs: number;
}

export type TraceFailStage = "transform_request" | "backend" | "transform_response" | "schema_validate" | "any";

export async function listTraces(opts: {
  server?: string;
  tool?: string;
  failStage?: TraceFailStage;
  from?: string;
  to?: string;
  limit?: number;
} = {}): Promise<TraceRecord[]> {
  const url = new URL(`${API_URL}/api/traces`);
  if (opts.server) url.searchParams.set("server", opts.server);
  if (opts.tool) url.searchParams.set("tool", opts.tool);
  if (opts.failStage) url.searchParams.set("failStage", opts.failStage);
  if (opts.from) url.searchParams.set("from", opts.from);
  if (opts.to) url.searchParams.set("to", opts.to);
  if (opts.limit) url.searchParams.set("limit", String(opts.limit));
  const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(`traces ${res.status}`);
  return res.json();
}

export async function getTrace(id: string): Promise<TraceRecord> {
  const res = await fetch(`${API_URL}/api/traces/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`trace ${res.status}`);
  return res.json();
}

export async function replayTrace(id: string): Promise<{ result: unknown }> {
  const res = await fetch(`${API_URL}/api/traces/${encodeURIComponent(id)}/replay`, {
    method: "POST",
    headers: { ...authHeaders(), "content-type": "application/json" },
  });
  if (!res.ok) throw new Error(`replay ${res.status}`);
  return res.json();
}

export async function deleteServer(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/servers/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`delete ${res.status}`);
}

export interface ResourceInfo {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface PromptArg {
  name: string;
  description?: string;
  required?: boolean;
}

export interface PromptInfo {
  name: string;
  description?: string;
  arguments?: PromptArg[];
}

export interface TransportMeta {
  kind: string;
  endpoint?: string;
  command?: string;
  tls: boolean;
}

export interface ServerDescription {
  server: ServerRow;
  serverInfo: { name?: string; version?: string } | null;
  transportMeta: TransportMeta;
  tools: ToolInfo[];
  resources: ResourceInfo[];
  prompts: PromptInfo[];
  snapshotVersion: string | null;
  snapshotTakenAt: string | null;
}

export async function describeServer(serverId: string): Promise<ServerDescription> {
  const res = await fetch(`${API_URL}/api/inspector/${encodeURIComponent(serverId)}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`inspector ${res.status}`);
  return res.json();
}

export async function explainTool(serverId: string, toolName: string): Promise<ToolInfo & { serverId: string }> {
  const res = await fetch(
    `${API_URL}/api/inspector/${encodeURIComponent(serverId)}/tools/${encodeURIComponent(toolName)}`,
    { headers: authHeaders(), cache: "no-store" },
  );
  if (!res.ok) throw new Error(`explain tool ${res.status}`);
  return res.json();
}
