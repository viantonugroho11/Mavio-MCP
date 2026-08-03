import { sql } from "kysely";
import { createDb } from "./db.js";

async function main(): Promise<void> {
  const url = process.env.MAVIO_DB_URL;
  if (!url) throw new Error("MAVIO_DB_URL not set");
  const db = createDb(url);

  await sql`
    CREATE TABLE IF NOT EXISTS servers (
      id            text PRIMARY KEY,
      workspace_id  text NOT NULL,
      project_id    text NOT NULL,
      name          text NOT NULL,
      source_type   text NOT NULL,
      transport     jsonb NOT NULL,
      version       text,
      metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
      tags          text[] NOT NULL DEFAULT '{}',
      status        text NOT NULL DEFAULT 'unknown',
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS servers_workspace_idx
      ON servers (workspace_id, project_id);
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS servers_tags_idx
      ON servers USING GIN (tags);
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS capability_snapshots (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      server_id     text NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      version       text NOT NULL,
      capabilities  jsonb NOT NULL,
      taken_at      timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS capability_snapshots_server_idx
      ON capability_snapshots (server_id, taken_at DESC);
  `.execute(db);

  await db.destroy();
  console.log("migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
