import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Principal } from "@mavio/core";
import { UnauthorizedError } from "@mavio/core";
import { RbacRepository } from "@mavio/registry";
import { RBAC_REPO } from "./rbac.module.js";
import { resolvePrincipalFromRequest } from "./principal-resolver.js";
import { SessionStore } from "./session.store.js";
import { SESSION_STORE } from "./session.module.js";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @Inject(RBAC_REPO) private readonly rbac: RbacRepository,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { principal?: Principal }>();
    try {
      const principal = await resolvePrincipalFromRequest(req, this.rbac, {
        strict: true,
        sessions: this.sessions,
      });
      if (!principal) throw new UnauthorizedException("invalid api key");
      req.principal = principal;
      return true;
    } catch (err) {
      if (err instanceof UnauthorizedError) throw new UnauthorizedException(err.message);
      throw err;
    }
  }
}
