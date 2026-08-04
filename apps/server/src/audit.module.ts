import { Global, Inject, Injectable, Module } from "@nestjs/common";
import type { Request } from "express";
import type { Kysely } from "kysely";
import type { Principal } from "@mavio/core";
import { AuditRepository, type Database, type AuditLogInput } from "@mavio/registry";
import { REGISTRY_DB } from "./registry.module.js";

export const AUDIT_REPO = Symbol("AUDIT_REPO");

@Injectable()
export class AuditService {
  constructor(@Inject(AUDIT_REPO) private readonly repo: AuditRepository) {}

  log(input: AuditLogInput): void {
    void this.repo.record(input).catch((err) => {
      console.warn(`[audit] write failed: ${(err as Error).message}`);
    });
  }

  logFromRequest(
    req: Request & { principal?: Principal },
    input: Omit<AuditLogInput, "actorId" | "actorType" | "ip">,
  ): void {
    this.log({
      ...input,
      actorId: req.principal?.id ?? null,
      actorType: req.principal?.type ?? null,
      ip: clientIp(req),
    });
  }

  get repository(): AuditRepository {
    return this.repo;
  }
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0]!.trim();
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

@Global()
@Module({
  providers: [
    {
      provide: AUDIT_REPO,
      inject: [REGISTRY_DB],
      useFactory: (db: Kysely<Database>): AuditRepository => new AuditRepository(db),
    },
    AuditService,
  ],
  exports: [AUDIT_REPO, AuditService],
})
export class AuditModule {}
