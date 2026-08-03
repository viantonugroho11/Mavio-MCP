import { request } from "undici";
import type { MCPFrame, TransportDescriptor } from "@mavio/core";
import { MavioError } from "@mavio/core";
import type { Session, Transport } from "./index.js";

class HttpSession implements Session {
  constructor(
    private readonly baseUrl: string,
    private readonly headers: Record<string, string>,
  ) {}

  async send(frame: MCPFrame): Promise<MCPFrame> {
    const res = await request(this.baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.headers },
      body: JSON.stringify(frame),
    });
    if (res.statusCode >= 400) {
      throw new MavioError(
        `http transport ${res.statusCode}`,
        "TRANSPORT_HTTP_ERROR",
      );
    }
    const body = (await res.body.json()) as MCPFrame;
    return body;
  }

  async close(): Promise<void> {
    // stateless
  }
}

export class HttpTransport implements Transport {
  readonly kind = "http" as const;

  async open(descriptor: TransportDescriptor): Promise<Session> {
    if (descriptor.type !== "http") {
      throw new MavioError("wrong descriptor for http transport", "TRANSPORT_MISMATCH");
    }
    const headers: Record<string, string> = { ...(descriptor.headers ?? {}) };
    if (descriptor.auth?.type === "bearer") {
      // secretRef resolution deferred to SecretProvider — MVP: read env var by name
      const envName = descriptor.auth.secretRef.replace(/^secret:\/\//, "").toUpperCase();
      const value = process.env[envName];
      if (value) headers["authorization"] = `Bearer ${value}`;
    }
    return new HttpSession(descriptor.baseUrl, headers);
  }
}
