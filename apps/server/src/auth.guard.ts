import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Principal } from "@mavio/core";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const header = req.header("authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    const expected = process.env.MAVIO_ADMIN_API_KEY;
    if (!expected) {
      // dev mode: allow, mark as service principal
      req.principal = {
        id: "dev",
        type: "service",
        workspaceId: "default",
        scopes: ["*"],
      };
      return true;
    }
    if (!match || match[1] !== expected) {
      throw new UnauthorizedException("invalid api key");
    }
    req.principal = {
      id: "admin",
      type: "service",
      workspaceId: "default",
      scopes: ["*"],
    };
    return true;
  }
}
