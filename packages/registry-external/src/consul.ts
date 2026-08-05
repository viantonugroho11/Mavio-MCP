import { request } from "undici";
import type { ServerDescriptor } from "@mavio/core";
import { MavioError } from "@mavio/core";
import type { ExternalRegistrySource } from "./index.js";

export interface ConsulSourceConfig {
  /** Base URL of the Consul HTTP API, e.g. http://consul:8500 */
  endpoint: string;
  /** KV prefix, defaults to `mavio/servers`. */
  prefix?: string;
  /** Optional ACL token. */
  token?: string;
  /** Optional datacenter override. */
  datacenter?: string;
}

interface ConsulKvEntry {
  Key: string;
  Value: string | null;
}

export class ConsulSource implements ExternalRegistrySource {
  readonly kind = "consul" as const;
  private readonly prefix: string;

  constructor(private readonly cfg: ConsulSourceConfig) {
    this.prefix = (cfg.prefix ?? "mavio/servers").replace(/^\/+|\/+$/g, "");
  }

  async list(): Promise<ServerDescriptor[]> {
    const url = new URL(`/v1/kv/${this.prefix}`, this.cfg.endpoint);
    url.searchParams.set("recurse", "true");
    if (this.cfg.datacenter) url.searchParams.set("dc", this.cfg.datacenter);
    const headers: Record<string, string> = {};
    if (this.cfg.token) headers["x-consul-token"] = this.cfg.token;
    const res = await request(url.toString(), { method: "GET", headers });
    if (res.statusCode === 404) return [];
    if (res.statusCode >= 400) {
      throw new MavioError(`consul kv ${res.statusCode}`, "EXTERNAL_REGISTRY_ERROR");
    }
    const entries = (await res.body.json()) as ConsulKvEntry[];
    return entries
      .map((e) => decodeDescriptor(e.Value))
      .filter((d): d is ServerDescriptor => d !== null);
  }

  async close(): Promise<void> {
    // stateless HTTP
  }
}

function decodeDescriptor(b64: string | null): ServerDescriptor | null {
  if (!b64) return null;
  try {
    const raw = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(raw) as ServerDescriptor;
  } catch {
    return null;
  }
}
