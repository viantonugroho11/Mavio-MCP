import { request } from "undici";
import type { ServerDescriptor } from "@mavio/core";
import { MavioError } from "@mavio/core";
import type { ExternalRegistrySource } from "./index.js";

export interface EtcdSourceConfig {
  /** Base URL of the etcd v3 gRPC-JSON gateway, e.g. http://etcd:2379 */
  endpoint: string;
  /** Key prefix, defaults to `/mavio/servers/`. */
  prefix?: string;
  /** Optional bearer token (etcd v3 auth). */
  token?: string;
}

interface RangeResponse {
  kvs?: Array<{ key: string; value: string }>;
}

export class EtcdSource implements ExternalRegistrySource {
  readonly kind = "etcd" as const;
  private readonly prefix: string;

  constructor(private readonly cfg: EtcdSourceConfig) {
    this.prefix = cfg.prefix ?? "/mavio/servers/";
  }

  async list(): Promise<ServerDescriptor[]> {
    const prefix = this.prefix;
    const rangeEnd = incrementLastByte(prefix);
    const body = {
      key: Buffer.from(prefix).toString("base64"),
      range_end: Buffer.from(rangeEnd).toString("base64"),
    };
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.cfg.token) headers.authorization = this.cfg.token;
    const res = await request(`${this.cfg.endpoint}/v3/kv/range`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (res.statusCode >= 400) {
      throw new MavioError(`etcd range ${res.statusCode}`, "EXTERNAL_REGISTRY_ERROR");
    }
    const payload = (await res.body.json()) as RangeResponse;
    const kvs = payload.kvs ?? [];
    return kvs
      .map((kv) => decodeDescriptor(kv.value))
      .filter((d): d is ServerDescriptor => d !== null);
  }

  async close(): Promise<void> {
    // stateless HTTP
  }
}

function incrementLastByte(s: string): string {
  const buf = Buffer.from(s);
  for (let i = buf.length - 1; i >= 0; i--) {
    const byte = buf[i] ?? 0;
    if (byte < 0xff) {
      buf[i] = byte + 1;
      return buf.slice(0, i + 1).toString();
    }
  }
  return "\0";
}

function decodeDescriptor(b64: string): ServerDescriptor | null {
  try {
    const raw = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(raw) as ServerDescriptor;
  } catch {
    return null;
  }
}
