import { Module } from "@nestjs/common";
import { TraceRepository } from "@mavio/registry";
import { RegistryModule, REGISTRY_DB } from "./registry.module.js";
import type { Kysely } from "kysely";
import type { Database } from "@mavio/registry";

export const TRACE_REPO = Symbol("TRACE_REPO");

@Module({
  imports: [RegistryModule],
  providers: [
    {
      provide: TRACE_REPO,
      inject: [REGISTRY_DB],
      useFactory: (db: Kysely<Database>): TraceRepository => new TraceRepository(db),
    },
  ],
  exports: [TRACE_REPO],
})
export class TraceModule {}
