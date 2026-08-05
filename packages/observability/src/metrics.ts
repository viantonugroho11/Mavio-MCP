import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

export class MavioMetrics {
  readonly registry: Registry;
  readonly routerRequests: Counter<string>;
  readonly routerDuration: Histogram<string>;
  readonly breakerState: Gauge<string>;
  readonly rateLimitDenied: Counter<string>;
  readonly importerRuns: Counter<string>;
  readonly upstreamErrors: Counter<string>;
  readonly upstreamTokenRefresh: Counter<string>;
  readonly upstreamTokenDenied: Counter<string>;
  readonly vaultDecryptFail: Counter<string>;

  constructor(prefix = "mavio_") {
    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry, prefix });

    this.routerRequests = new Counter({
      name: `${prefix}router_requests_total`,
      help: "MCP tool calls routed",
      labelNames: ["server", "tool", "outcome"] as const,
      registers: [this.registry],
    });

    this.routerDuration = new Histogram({
      name: `${prefix}router_request_duration_seconds`,
      help: "MCP tool call latency",
      labelNames: ["server", "tool", "outcome"] as const,
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.breakerState = new Gauge({
      name: `${prefix}breaker_state`,
      help: "Circuit breaker state (0=closed, 1=half_open, 2=open)",
      labelNames: ["server"] as const,
      registers: [this.registry],
    });

    this.rateLimitDenied = new Counter({
      name: `${prefix}rate_limit_denied_total`,
      help: "Rate-limit denials",
      labelNames: ["server", "scope"] as const,
      registers: [this.registry],
    });

    this.importerRuns = new Counter({
      name: `${prefix}importer_runs_total`,
      help: "Importer executions",
      labelNames: ["kind", "outcome"] as const,
      registers: [this.registry],
    });

    this.upstreamErrors = new Counter({
      name: `${prefix}upstream_errors_total`,
      help: "Errors dispatching to upstream servers",
      labelNames: ["server", "kind"] as const,
      registers: [this.registry],
    });

    this.upstreamTokenRefresh = new Counter({
      name: `${prefix}upstream_token_refresh_total`,
      help: "Per-principal upstream token refresh attempts",
      labelNames: ["provider", "outcome"] as const,
      registers: [this.registry],
    });

    this.upstreamTokenDenied = new Counter({
      name: `${prefix}upstream_token_denied_total`,
      help: "Requests that could not proceed because no valid upstream token was available",
      labelNames: ["provider", "reason"] as const,
      registers: [this.registry],
    });

    this.vaultDecryptFail = new Counter({
      name: `${prefix}vault_decrypt_fail_total`,
      help: "Vault decrypt failures (retired key, tampered ciphertext, corrupt row)",
      labelNames: ["reason"] as const,
      registers: [this.registry],
    });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }
}

export const BREAKER_STATE_VALUE: Record<"closed" | "half_open" | "open", number> = {
  closed: 0,
  half_open: 1,
  open: 2,
};
