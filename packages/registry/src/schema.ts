import type { Generated } from "kysely";

export interface ServersTable {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  source_type: string;
  transport: unknown;
  version: string | null;
  metadata: unknown;
  tags: string[];
  status: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CapabilitySnapshotsTable {
  id: Generated<string>;
  server_id: string;
  version: string;
  capabilities: unknown;
  taken_at: Generated<Date>;
}

export interface PrincipalsTable {
  id: string;
  type: string;
  display_name: string;
  api_key_hash: string | null;
  workspace_id: string;
  created_at: Generated<Date>;
}

export interface RoleAssignmentsTable {
  id: Generated<string>;
  principal_id: string;
  role_name: string;
  workspace_id: string | null;
  project_id: string | null;
  server_id: string | null;
  tool_name: string | null;
  created_at: Generated<Date>;
}

export interface RolesTable {
  name: string;
  inherits: string[];
  permissions: unknown;
  builtin: boolean;
  created_at: Generated<Date>;
}

export interface OidcProvidersTable {
  id: string;
  display_name: string;
  issuer_url: string;
  client_id: string;
  client_secret_ref: string;
  redirect_uri: string;
  scopes: string[];
  enabled: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface PlaygroundRunsTable {
  id: Generated<string>;
  principal_id: string;
  server_id: string;
  tool_name: string;
  arguments: unknown;
  response: unknown;
  latency_ms: number;
  status: string;
  invoked_at: Generated<Date>;
}

export interface PluginsTable {
  name: string;
  version: string;
  enabled: boolean;
  package_dir: string | null;
  installed_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Database {
  servers: ServersTable;
  capability_snapshots: CapabilitySnapshotsTable;
  principals: PrincipalsTable;
  role_assignments: RoleAssignmentsTable;
  roles: RolesTable;
  playground_runs: PlaygroundRunsTable;
  oidc_providers: OidcProvidersTable;
  plugins: PluginsTable;
}
