import type { Kysely } from "kysely";
import type { Database } from "./schema.js";

export interface PluginRecord {
  name: string;
  version: string;
  enabled: boolean;
  packageDir: string | null;
  installedAt: Date;
  updatedAt: Date;
}

export class PluginRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async list(): Promise<PluginRecord[]> {
    const rows = await this.db.selectFrom("plugins").selectAll().orderBy("name", "asc").execute();
    return rows.map(toRecord);
  }

  async upsert(input: {
    name: string;
    version: string;
    enabled?: boolean;
    packageDir?: string | null;
  }): Promise<PluginRecord> {
    const enabled = input.enabled ?? true;
    const row = await this.db
      .insertInto("plugins")
      .values({
        name: input.name,
        version: input.version,
        enabled,
        package_dir: input.packageDir ?? null,
      })
      .onConflict((oc) =>
        oc.column("name").doUpdateSet({
          version: input.version,
          package_dir: input.packageDir ?? null,
          updated_at: new Date(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return toRecord(row);
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    await this.db
      .updateTable("plugins")
      .set({ enabled, updated_at: new Date() })
      .where("name", "=", name)
      .execute();
  }
}

function toRecord(row: {
  name: string;
  version: string;
  enabled: boolean;
  package_dir: string | null;
  installed_at: Date;
  updated_at: Date;
}): PluginRecord {
  return {
    name: row.name,
    version: row.version,
    enabled: row.enabled,
    packageDir: row.package_dir,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  };
}
