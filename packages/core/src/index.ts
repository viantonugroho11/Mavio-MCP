export type ServerId = string;
export type WorkspaceId = string;
export type ProjectId = string;

export type TransportKind = "stdio" | "http" | "sse" | "ws" | "sql" | "graphql";

export interface StdioTransportDescriptor {
  type: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface HttpTransportDescriptor {
  type: "http";
  baseUrl: string;
  headers?: Record<string, string>;
  auth?: { type: "bearer"; secretRef: string } | { type: "none" };
}

export interface SqlTransportDescriptor {
  type: "sql";
  dialect: "postgres";
  dsn: string;
  allowedTables?: string[];
  readOnly?: boolean;
}

export interface SseTransportDescriptor {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
  auth?: { type: "bearer"; secretRef: string } | { type: "none" };
}

export interface GraphqlTransportDescriptor {
  type: "graphql";
  endpoint: string;
  headers?: Record<string, string>;
  auth?: { type: "bearer"; secretRef: string } | { type: "none" };
}

export type TransportDescriptor =
  | StdioTransportDescriptor
  | HttpTransportDescriptor
  | SseTransportDescriptor
  | SqlTransportDescriptor
  | GraphqlTransportDescriptor;

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ServerCapabilities {
  tools?: ToolDefinition[];
  resources?: unknown[];
  prompts?: unknown[];
  serverInfo?: { name?: string; version?: string };
}

export interface ServerDescriptor {
  id: ServerId;
  workspaceId: WorkspaceId;
  projectId: ProjectId;
  name: string;
  transport: TransportDescriptor;
  sourceType: "openapi" | "sql" | "graphql" | "mcp" | "native";
  tags?: string[];
  version?: string;
  metadata?: Record<string, unknown>;
  status?: ServerStatus;
  lastCheckedAt?: string;
}

export type ServerStatus = "healthy" | "degraded" | "down" | "unknown";

export interface Principal {
  id: string;
  type: "user" | "service";
  workspaceId: WorkspaceId;
  scopes: string[];
  attributes?: Record<string, unknown>;
}

export interface MCPFrame {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class MavioError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "MavioError";
  }
}

export class NotFoundError extends MavioError {
  constructor(what: string) {
    super(`${what} not found`, "NOT_FOUND");
  }
}

export class UnauthorizedError extends MavioError {
  constructor(reason = "unauthorized") {
    super(reason, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends MavioError {
  constructor(reason = "forbidden") {
    super(reason, "FORBIDDEN");
  }
}
