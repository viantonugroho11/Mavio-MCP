import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Principal } from "@mavio/core";
import { RbacRepository } from "@mavio/registry";
import { RBAC_REPO } from "./rbac.module.js";

/**
 * Extracts a Principal from a Bearer token.
 *  - MAVIO_ADMIN_API_KEY env value ⇒ synthetic root principal (all scopes)
 *  - DB-issued mk_* key ⇒ looked up in principals table
 *  - Missing/mismatched key + no env admin key set ⇒ dev-mode root
 *  - Missing/mismatched key with env admin key set ⇒ 401
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(RBAC_REPO) private readonly rbac: RbacRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const header = req.header("authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1];
    const adminKey = process.env.MAVIO_ADMIN_API_KEY;

    if (token && adminKey && token === adminKey) {
      req.principal = rootPrincipal("admin");
      return true;
    }

    if (token) {
      const stored = await this.rbac.findByApiKey(token);
      if (stored) {
        req.principal = {
          id: stored.id,
          type: stored.type,
          workspaceId: stored.workspaceId,
          scopes: [],
        };
        return true;
      }
    }

    if (!adminKey) {
      req.principal = rootPrincipal("dev");
      return true;
    }

    throw new UnauthorizedException("invalid api key");
  }
}

function rootPrincipal(id: string): Principal {
  return { id, type: "service", workspaceId: "default", scopes: ["*"] };
}
