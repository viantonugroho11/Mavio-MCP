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

  await sql`
    CREATE TABLE IF NOT EXISTS principals (
      id            text PRIMARY KEY,
      type          text NOT NULL,
      display_name  text NOT NULL,
      api_key_hash  text UNIQUE,
      workspace_id  text NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS principals_workspace_idx
      ON principals (workspace_id);
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS principals_api_key_hash_idx
      ON principals (api_key_hash) WHERE api_key_hash IS NOT NULL;
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS roles (
      name         text PRIMARY KEY,
      inherits     text[] NOT NULL DEFAULT '{}',
      permissions  jsonb NOT NULL,
      builtin      boolean NOT NULL DEFAULT false,
      created_at   timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS role_assignments (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      principal_id  text NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
      role_name     text NOT NULL,
      workspace_id  text,
      project_id    text,
      server_id     text,
      tool_name     text,
      created_at    timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS role_assignments_principal_idx
      ON role_assignments (principal_id);
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS playground_runs (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      principal_id  text NOT NULL,
      server_id     text NOT NULL,
      tool_name     text NOT NULL,
      arguments     jsonb NOT NULL,
      response      jsonb NOT NULL,
      latency_ms    integer NOT NULL,
      status        text NOT NULL,
      invoked_at    timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS playground_runs_invoked_idx
      ON playground_runs (server_id, invoked_at DESC);
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS oidc_providers (
      id                 text PRIMARY KEY,
      display_name       text NOT NULL,
      issuer_url         text NOT NULL,
      client_id          text NOT NULL,
      client_secret_ref  text NOT NULL,
      redirect_uri       text NOT NULL,
      scopes             text[] NOT NULL DEFAULT ARRAY['openid','profile','email'],
      enabled            boolean NOT NULL DEFAULT true,
      created_at         timestamptz NOT NULL DEFAULT now(),
      updated_at         timestamptz NOT NULL DEFAULT now()
    );
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS oidc_providers_enabled_idx
      ON oidc_providers (enabled) WHERE enabled = true;
  `.execute(db);

  await db.destroy();
  console.log("migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
