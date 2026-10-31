import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { serialize as serializeCookie } from "cookie";
import { Actions } from "@mavio/rbac";
import type { LocalUserRepository } from "@mavio/registry";
import { ApiKeyGuard } from "./auth.guard.js";
import { RbacGuard, RequirePermission } from "./rbac.guard.js";
import { LOCAL_USER_REPO } from "./local-auth.module.js";
import { SESSION_STORE, SESSION_TTL } from "./session.module.js";
import { SessionStore } from "./session.store.js";
import { AuditService, clientIp } from "./audit.module.js";
import { RbacRepository } from "@mavio/registry";
import { RBAC_REPO } from "./rbac.module.js";

const COOKIE_NAME = "mavio_sid";

@Controller()
export class LocalAuthController {
  constructor(
    @Inject(LOCAL_USER_REPO) private readonly localUsers: LocalUserRepository,
    @Inject(SESSION_STORE) private readonly sessions: SessionStore,
    @Inject(SESSION_TTL) private readonly ttlSeconds: number,
    @Inject(RBAC_REPO) private readonly rbac: RbacRepository,
    private readonly audit: AuditService,
  ) {}

  @Post("auth/local/login")
  @HttpCode(200)
  async login(
    @Body() body: { username?: string; password?: string; returnTo?: string },
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { username, password, returnTo = "/" } = body;
    if (!username || !password) {
      throw new HttpException("username and password required", 400);
    }
    const user = await this.localUsers.verify(username, password);
    if (!user) {
      this.audit.log({
        actorId: null,
        actorType: null,
        action: "auth.local.login",
        resource: { username },
        outcome: "denied",
        ip: clientIp(req),
      });
      throw new HttpException("invalid credentials", 401);
    }

    const principalId = `local:${user.id}`;
    await this.rbac.ensurePrincipal({
      id: principalId,
      type: "user",
      displayName: user.displayName,
      workspaceId: user.workspaceId,
    });

    const sid = await this.sessions.create({
      principalId,
      providerId: "local",
      workspaceId: user.workspaceId,
      email: user.email ?? undefined,
      displayName: user.displayName,
    });

    this.audit.log({
      actorId: principalId,
      actorType: "user",
      action: "auth.local.login",
      resource: { username },
      outcome: "ok",
      ip: clientIp(req),
    });

    const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
    res.setHeader(
      "set-cookie",
      serializeCookie(COOKIE_NAME, sid, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: this.ttlSeconds,
      }),
    );
    res.json({ ok: true, returnTo: safeReturn });
  }

  // Admin CRUD
  @Get("api/auth/local/users")
  @UseGuards(ApiKeyGuard, RbacGuard)
  @RequirePermission(Actions.WorkspaceAdmin)
  listUsers() {
    return this.localUsers.list();
  }

  @Post("api/auth/local/users")
  @UseGuards(ApiKeyGuard, RbacGuard)
  @RequirePermission(Actions.WorkspaceAdmin)
  createUser(
    @Body()
    body: {
      username: string;
      password: string;
      email?: string;
      displayName?: string;
      workspaceId?: string;
    },
  ) {
    return this.localUsers.create(body);
  }

  @Delete("api/auth/local/users/:id")
  @UseGuards(ApiKeyGuard, RbacGuard)
  @RequirePermission(Actions.WorkspaceAdmin)
  @HttpCode(204)
  async deleteUser(@Param("id") id: string): Promise<void> {
    await this.localUsers.delete(id);
  }

  @Put("api/auth/local/users/:id/password")
  @UseGuards(ApiKeyGuard, RbacGuard)
  @RequirePermission(Actions.WorkspaceAdmin)
  @HttpCode(204)
  async setPassword(@Param("id") id: string, @Body() body: { password: string }): Promise<void> {
    if (!body.password) throw new HttpException("password required", 400);
    await this.localUsers.setPassword(id, body.password);
  }
}
