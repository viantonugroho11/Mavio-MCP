import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import pg from "pg";
import type { SqlTransportDescriptor } from "@mavio/core";
import { dispatchSql, type SqlDispatchMeta } from "@mavio/import-sql";

const { Pool } = pg;

@Injectable()
export class SqlDispatcher implements OnModuleDestroy {
  private readonly pools = new Map<string, pg.Pool>();

  private getPool(serverId: string, dsn: string): pg.Pool {
    let pool = this.pools.get(serverId);
    if (!pool) {
      pool = new Pool({ connectionString: dsn, max: 4 });
      this.pools.set(serverId, pool);
    }
    return pool;
  }

  async dispatch(
    serverId: string,
    descriptor: SqlTransportDescriptor,
    meta: SqlDispatchMeta,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const pool = this.getPool(serverId, descriptor.dsn);
    return dispatchSql(pool, meta, args, {
      readOnly: descriptor.readOnly ?? true,
      allowedTables: descriptor.allowedTables,
    });
  }

  invalidate(serverId: string): void {
    const pool = this.pools.get(serverId);
    if (pool) {
      void pool.end().catch(() => undefined);
      this.pools.delete(serverId);
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const pool of this.pools.values()) await pool.end().catch(() => undefined);
    this.pools.clear();
  }
}
