import type { ServerDescriptor } from "@mavio/core";
import { EtcdSource, type EtcdSourceConfig } from "./etcd.js";
import { ConsulSource, type ConsulSourceConfig } from "./consul.js";

/**
 * External registry source — read-only view of ServerDescriptor entries stored
 * under a key prefix in a KV service (etcd/Consul). Used by the server's
 * mirror-sync loop to hydrate Postgres from external service discovery.
 */
export interface ExternalRegistrySource {
  readonly kind: "etcd" | "consul";
  list(): Promise<ServerDescriptor[]>;
  close(): Promise<void>;
}

export type ExternalRegistryConfig =
  | ({ kind: "etcd" } & EtcdSourceConfig)
  | ({ kind: "consul" } & ConsulSourceConfig);

export function createRegistrySource(cfg: ExternalRegistryConfig): ExternalRegistrySource {
  if (cfg.kind === "etcd") return new EtcdSource(cfg);
  return new ConsulSource(cfg);
}

export { EtcdSource, type EtcdSourceConfig } from "./etcd.js";
export { ConsulSource, type ConsulSourceConfig } from "./consul.js";
