import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import AjvModule, { type ValidateFunction } from "ajv";
import type { MCPFrame, Principal } from "@mavio/core";
import { NotFoundError } from "@mavio/core";
import type { EventRoute, EventRouteRepository, RbacRepository } from "@mavio/registry";
import { MavioMetrics } from "@mavio/observability";
import { EVENT_ROUTE_REPO } from "./registry.module.js";
import { RBAC_REPO } from "./rbac.module.js";
import { METRICS } from "./observability.module.js";
import { RouterService } from "./router.service.js";
import { AuditService } from "./audit.module.js";
import { renderArgs } from "./event-bridge.util.js";

const Ajv = ((AjvModule as unknown as { default?: typeof AjvModule }).default ??
  AjvModule) as unknown as new (opts?: unknown) => {
  compile: (schema: unknown) => ValidateFunction;
  errorsText: (errors: unknown, opts?: { separator?: string }) => string;
};

export type DispatchOutcome =
  | "ok"
  | "error"
  | "not_ready"
  | "auth_failed"
  | "schema_invalid"
  | "owner_missing";

export interface DispatchInput {
  routeId: string;
  body: unknown;
  /**
   * Adapter-supplied auth verdict. Webhook controller runs HMAC first and
   * passes `{ ok: true }`; broker consumers trust broker-level ACLs and pass
   * `{ ok: true, reason: 'broker-authenticated' }`. Set `ok=false` to force
   * a denial with the given reason.
   */
  authVerdict?: { ok: boolean; reason?: string };
  /** Optional caller-supplied correlation id (adapter may already have one). */
  correlationId?: string;
}

export interface DispatchResult {
  outcome: DispatchOutcome;
  correlationId: string;
  frame?: MCPFrame;
  reason?: string;
  schemaErrors?: string;
}

/**
 * Shared ingress dispatcher (ADR-022 M5). Extracts everything after the
 * transport-specific auth check so the webhook controller and any broker
 * consumer (Kafka/NATS/…) run through the exact same policy, validation,
 * dispatch, audit, metric path.
 */
@Injectable()
export class EventDispatcherService {
  private readonly ajv = new Ajv({ allErrors: true, strict: false });
  private readonly validators = new Map<string, { updatedAt: string; fn: ValidateFunction }>();

  constructor(
    @Inject(EVENT_ROUTE_REPO) private readonly routes: EventRouteRepository,
    @Inject(RBAC_REPO) private readonly rbac: RbacRepository,
    @Inject(METRICS) private readonly metrics: MavioMetrics,
    private readonly router: RouterService,
    private readonly audit: AuditService,
  ) {}

  private validatorFor(route: EventRoute): ValidateFunction | null {
    if (!route.schemaJson) return null;
    const cached = this.validators.get(route.id);
    if (cached && cached.updatedAt === route.updatedAt) return cached.fn;
    const fn = this.ajv.compile(route.schemaJson);
    this.validators.set(route.id, { updatedAt: route.updatedAt, fn });
    return fn;
  }

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const started = process.hrtime.bigint();
    const correlationId = input.correlationId ?? randomUUID();

    let route: EventRoute;
    try {
      route = await this.routes.get(input.routeId);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return { outcome: "not_ready", correlationId, reason: err.message };
      }
      throw err;
    }

    if (!route.enabled || route.approvalStatus !== "approved") {
      this.metrics.eventIngressTotal?.inc({
        source: route.sourceType,
        route: route.id,
        outcome: "not_ready",
      });
      return {
        outcome: "not_ready",
        correlationId,
        reason: `enabled=${route.enabled} approval=${route.approvalStatus}`,
      };
    }

    const verdict = input.authVerdict ?? { ok: true };
    if (!verdict.ok) {
      this.metrics.eventIngressTotal?.inc({
        source: route.sourceType,
        route: route.id,
        outcome: "auth_failed",
      });
      this.audit.log({
        actorId: null,
        actorType: "external",
        action: "event.ingress",
        resource: { route: route.id, correlationId },
        outcome: "denied",
        metadata: { reason: verdict.reason, correlationId },
      });
      return { outcome: "auth_failed", correlationId, reason: verdict.reason };
    }

    const validate = this.validatorFor(route);
    if (validate && !validate(input.body)) {
      const errorSummary = this.ajv.errorsText(validate.errors, { separator: "; " });
      this.metrics.eventIngressTotal?.inc({
        source: route.sourceType,
        route: route.id,
        outcome: "schema_invalid",
      });
      this.audit.log({
        actorId: null,
        actorType: "external",
        action: "event.ingress",
        resource: { route: route.id, correlationId },
        outcome: "denied",
        metadata: { reason: "schema_invalid", errors: errorSummary, correlationId },
      });
      return { outcome: "schema_invalid", correlationId, schemaErrors: errorSummary };
    }

    const owner = await this.rbac.findById(route.principalId);
    if (!owner) {
      return { outcome: "owner_missing", correlationId, reason: route.principalId };
    }
    const principal: Principal = {
      id: owner.id,
      type: owner.type,
      workspaceId: owner.workspaceId,
      scopes: [],
    };

    const args = renderArgs(route.mcpTarget.argsTemplate, input.body);
    const fqName = `${route.mcpTarget.serverId}.${route.mcpTarget.toolName}`;
    const frame = await this.router.invokeAndReturn(fqName, args, principal);
    const outcome: DispatchOutcome = frame.error ? "error" : "ok";
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;

    this.metrics.eventIngressTotal?.inc({
      source: route.sourceType,
      route: route.id,
      outcome,
    });
    this.metrics.eventIngressDuration?.observe(
      { source: route.sourceType, route: route.id, outcome },
      seconds,
    );
    this.audit.log({
      actorId: principal.id,
      actorType: "service",
      action: "event.ingress",
      resource: { route: route.id, tool: fqName, correlationId },
      outcome: outcome === "ok" ? "ok" : "error",
      metadata: { durationMs: Math.round(seconds * 1000), correlationId },
    });

    return { outcome, correlationId, frame };
  }
}
