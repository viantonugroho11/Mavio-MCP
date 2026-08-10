import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UnprocessableEntityException,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import type { MCPFrame, Principal } from "@mavio/core";
import { NotFoundError } from "@mavio/core";
import { Actions } from "@mavio/rbac";
import {
  EventRouteRepository,
  type CreateEventRouteInput,
  type EventRoute,
  type EventSourceType,
} from "@mavio/registry";
import { EVENT_ROUTE_REPO } from "./registry.module.js";
import { ApiKeyGuard } from "./auth.guard.js";
import { RbacGuard, RequirePermission } from "./rbac.guard.js";
import { AuditService } from "./audit.module.js";
import { verifyIngressAuth } from "./event-bridge.util.js";
import { EventDispatcherService } from "./event-dispatcher.service.js";

interface CreateRouteBody {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  sourceType: EventSourceType;
  match: CreateEventRouteInput["match"];
  mcpTarget: CreateEventRouteInput["mcpTarget"];
  principalId: string;
  schemaRef?: string;
  schemaJson?: Record<string, unknown>;
  auth?: CreateEventRouteInput["auth"];
}

/**
 * Event Bridge admin surface + webhook ingress (ADR-022).
 *
 * Admin endpoints (submit / list / approve / reject) are guarded by
 * ApiKeyGuard + RbacGuard, following the ADR-021 pattern.
 *
 * `/api/events/:id` is the webhook ingress. It runs HMAC verify locally,
 * then hands off to `EventDispatcherService` which is shared with broker
 * consumers (Kafka/NATS, ADR-022 M5) so every source flows through the
 * same schema, principal, dispatch, audit, metric pipeline.
 */
@Controller("api/events")
export class EventsController {
  constructor(
    @Inject(EVENT_ROUTE_REPO) private readonly routes: EventRouteRepository,
    private readonly audit: AuditService,
    private readonly dispatcher: EventDispatcherService,
  ) {}

  @Post("routes")
  @UseGuards(ApiKeyGuard, RbacGuard)
  @RequirePermission(Actions.EventRouteSubmit)
  async submit(@Body() body: CreateRouteBody, @Req() req: Request): Promise<EventRoute> {
    const principal = (req as Request & { principal?: Principal }).principal;
    const route = await this.routes.create({
      ...body,
      submittedBy: principal?.id,
    });
    this.audit.logFromRequest(req as Request & { principal?: Principal }, {
      action: "event.route.submit",
      resource: { route: route.id },
      outcome: "ok",
      metadata: { sourceType: route.sourceType, target: route.mcpTarget },
    });
    return route;
  }

  @Get("routes")
  @UseGuards(ApiKeyGuard, RbacGuard)
  @RequirePermission(Actions.EventRouteSubmit)
  async list(
    @Query("status") status?: "pending" | "approved" | "rejected" | "any",
    @Query("sourceType") sourceType?: EventSourceType,
  ): Promise<EventRoute[]> {
    return this.routes.list({ approvalStatus: status ?? "any", sourceType });
  }

  @Post("routes/:id/approve")
  @UseGuards(ApiKeyGuard, RbacGuard)
  @RequirePermission(Actions.EventRouteApprove)
  async approve(@Param("id") id: string, @Req() req: Request): Promise<EventRoute> {
    const approver =
      (req as Request & { principal?: Principal }).principal?.id ?? "unknown";
    const route = await this.routes.approve(id, approver);
    this.audit.logFromRequest(req as Request & { principal?: Principal }, {
      action: "event.route.approve",
      resource: { route: id },
      outcome: "ok",
      metadata: {},
    });
    return route;
  }

  @Post("routes/:id/reject")
  @UseGuards(ApiKeyGuard, RbacGuard)
  @RequirePermission(Actions.EventRouteApprove)
  async reject(
    @Param("id") id: string,
    @Body() body: { reason?: string },
    @Req() req: Request,
  ): Promise<EventRoute> {
    const approver =
      (req as Request & { principal?: Principal }).principal?.id ?? "unknown";
    const route = await this.routes.reject(id, approver, body.reason ?? "");
    this.audit.logFromRequest(req as Request & { principal?: Principal }, {
      action: "event.route.reject",
      resource: { route: id },
      outcome: "ok",
      metadata: { reason: body.reason ?? "" },
    });
    return route;
  }

  /**
   * Webhook ingress. External caller POSTs raw JSON; we verify HMAC on the
   * raw body, then defer everything else to the shared dispatcher.
   *
   * ApiKeyGuard is intentionally NOT applied — the external system does not
   * carry a Mavio API key. RBAC still runs at dispatch because the router
   * enforces ToolInvoke against the route-owner principal.
   */
  @Post(":id")
  async ingest(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<{ ok: boolean; correlationId: string; result?: MCPFrame }> {
    let route: EventRoute;
    try {
      route = await this.routes.get(id);
    } catch (err) {
      if (err instanceof NotFoundError) throw new BadRequestException(err.message);
      throw err;
    }

    const rawBody =
      (req as Request & { rawBody?: Buffer }).rawBody ??
      Buffer.from(typeof body === "string" ? body : JSON.stringify(body ?? {}));
    const verdict = verifyIngressAuth(req, route.auth, rawBody);

    const result = await this.dispatcher.dispatch({
      routeId: id,
      body,
      authVerdict: verdict,
    });

    switch (result.outcome) {
      case "auth_failed":
        throw new UnauthorizedException(result.reason ?? "auth failed");
      case "schema_invalid":
        throw new UnprocessableEntityException(
          `payload schema violation: ${result.schemaErrors}`,
        );
      case "not_ready":
        throw new ForbiddenException(`route ${id} not dispatchable: ${result.reason}`);
      case "owner_missing":
        throw new BadRequestException(
          `route ${id} owner principal ${result.reason} missing`,
        );
      case "ok":
      case "error":
        return {
          ok: result.outcome === "ok",
          correlationId: result.correlationId,
          result: result.frame,
        };
    }
  }
}
