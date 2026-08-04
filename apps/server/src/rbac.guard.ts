import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { Principal } from "@mavio/core";
import type { Action, PolicyEngine, ResourceRef } from "@mavio/rbac";
import { POLICY_ENGINE } from "./rbac.module.js";
import { AuditService, clientIp } from "./audit.module.js";

export const REQUIRE_PERMISSION = "mavio:requirePermission";

export interface PermissionRequirement {
  action: Action;
  resource?: (req: Request) => ResourceRef;
}

export const RequirePermission = (
  action: Action,
  resource?: (req: Request) => ResourceRef,
): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_PERMISSION, { action, resource });

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(POLICY_ENGINE) private readonly engine: PolicyEngine,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const requirement =
      this.reflector.get<PermissionRequirement>(REQUIRE_PERMISSION, context.getHandler()) ??
      this.reflector.get<PermissionRequirement>(REQUIRE_PERMISSION, context.getClass());
    if (!requirement) return true;
    const principal = req.principal;
    if (!principal) {
      this.audit.log({
        action: "rbac.deny",
        outcome: "denied",
        metadata: { required: requirement.action, reason: "no principal" },
        ip: clientIp(req),
      });
      throw new ForbiddenException("no principal");
    }
    if (principal.scopes.includes("*")) return true;

    const resource = requirement.resource ? requirement.resource(req) : {};
    const decision = await this.engine.can(principal, requirement.action, resource);
    if (!decision.allowed) {
      this.audit.log({
        actorId: principal.id,
        actorType: principal.type,
        action: "rbac.deny",
        resource: { ...resource },
        outcome: "denied",
        metadata: { required: requirement.action, reason: decision.reason },
        ip: clientIp(req),
      });
      throw new ForbiddenException(`denied: ${requirement.action} (${decision.reason})`);
    }
    return true;
  }
}
