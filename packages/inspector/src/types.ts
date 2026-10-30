import type { ServerDescriptor, ToolDefinition, TransportDescriptor } from "@mavio/core";

export interface ResourceDescriptor {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface PromptDescriptor {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface TransportMeta {
  kind: TransportDescriptor["type"];
  endpoint?: string;
  command?: string;
  tls: boolean;
}

export interface ServerDescription {
  server: ServerDescriptor;
  serverInfo: { name?: string; version?: string } | null;
  transportMeta: TransportMeta;
  tools: ToolDefinition[];
  resources: ResourceDescriptor[];
  prompts: PromptDescriptor[];
  snapshotVersion: string | null;
  snapshotTakenAt: Date | null;
}

export interface ToolDetail extends ToolDefinition {
  serverId: string;
}
