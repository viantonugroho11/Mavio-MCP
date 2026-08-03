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

export interface Database {
  servers: ServersTable;
  capability_snapshots: CapabilitySnapshotsTable;
}
