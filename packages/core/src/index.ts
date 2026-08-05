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

export interface WsTransportDescriptor {
  type: "ws";
  url: string;
  headers?: Record<string, string>;
  auth?: { type: "bearer"; secretRef: string } | { type: "none" };
  subprotocol?: string;
}

export type TransportDescriptor =
  | StdioTransportDescriptor
  | HttpTransportDescriptor
  | SseTransportDescriptor
  | WsTransportDescriptor
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

export interface SecretResolver {
  resolve(ref: string): string | undefined;
}

export function resolveSecretRef(
  ref: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!ref) return undefined;
  const name = ref.replace(/^secret:\/\//, "").toUpperCase();
  return env[name];
}

export function bearerHeaderFromAuth(
  auth: { type: "bearer"; secretRef: string } | { type: "none" } | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  if (!auth || auth.type !== "bearer") return {};
  const value = resolveSecretRef(auth.secretRef, env);
  return value ? { authorization: `Bearer ${value}` } : {};
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

export class CircuitOpenError extends MavioError {
  constructor(key: string, public readonly retryAt: number) {
    super(`circuit open for ${key}, retry at ${new Date(retryAt).toISOString()}`, "CIRCUIT_OPEN");
  }
}

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetMs?: number;
  halfOpenMaxCalls?: number;
  now?: () => number;
}

interface CircuitEntry {
  state: CircuitState;
  failures: number;
  successes: number;
  openedAt: number;
  halfOpenInFlight: number;
}

export class CircuitBreaker {
  private readonly entries = new Map<string, CircuitEntry>();
  private readonly failureThreshold: number;
  private readonly resetMs: number;
  private readonly halfOpenMaxCalls: number;
  private readonly now: () => number;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.resetMs = opts.resetMs ?? 30_000;
    this.halfOpenMaxCalls = opts.halfOpenMaxCalls ?? 1;
    this.now = opts.now ?? (() => Date.now());
  }

  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const entry = this.entryFor(key);
    if (entry.state === "open") {
      const elapsed = this.now() - entry.openedAt;
      if (elapsed < this.resetMs) {
        throw new CircuitOpenError(key, entry.openedAt + this.resetMs);
      }
      entry.state = "half_open";
      entry.halfOpenInFlight = 0;
      entry.successes = 0;
    }
    if (entry.state === "half_open" && entry.halfOpenInFlight >= this.halfOpenMaxCalls) {
      throw new CircuitOpenError(key, entry.openedAt + this.resetMs);
    }
    if (entry.state === "half_open") entry.halfOpenInFlight++;
    try {
      const result = await fn();
      this.onSuccess(entry);
      return result;
    } catch (err) {
      this.onFailure(entry);
      throw err;
    }
  }

  snapshot(key: string): CircuitState {
    return this.entries.get(key)?.state ?? "closed";
  }

  private entryFor(key: string): CircuitEntry {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { state: "closed", failures: 0, successes: 0, openedAt: 0, halfOpenInFlight: 0 };
      this.entries.set(key, entry);
    }
    return entry;
  }

  private onSuccess(entry: CircuitEntry): void {
    if (entry.state === "half_open") {
      entry.successes++;
      entry.halfOpenInFlight = Math.max(0, entry.halfOpenInFlight - 1);
      if (entry.successes >= this.halfOpenMaxCalls) {
        entry.state = "closed";
        entry.failures = 0;
        entry.successes = 0;
      }
      return;
    }
    entry.failures = 0;
  }

  private onFailure(entry: CircuitEntry): void {
    if (entry.state === "half_open") {
      entry.state = "open";
      entry.openedAt = this.now();
      entry.halfOpenInFlight = 0;
      return;
    }
    entry.failures++;
    if (entry.failures >= this.failureThreshold) {
      entry.state = "open";
      entry.openedAt = this.now();
    }
  }
}
