import { request } from "undici";
import type { MCPFrame, TransportDescriptor } from "@mavio/core";
import { bearerHeaderFromAuth, MavioError } from "@mavio/core";
import type { Session, Transport } from "./index.js";

interface Pending {
  resolve: (frame: MCPFrame) => void;
  reject: (err: Error) => void;
}

/**
 * Classic MCP HTTP+SSE transport (pre-Streamable-HTTP spec).
 * Flow:
 *  1. GET <url> with Accept: text/event-stream.
 *  2. Server pushes `event: endpoint\ndata: <post-url>\n\n` first.
 *  3. Client POSTs frames to <post-url>; server publishes responses on the SSE
 *     stream, matched to requests by frame.id.
 */
class SseSession implements Session {
  private readonly pending = new Map<string | number, Pending>();
  private endpointUrl: string | null = null;
  private endpointReady!: Promise<string>;
  private endpointResolve!: (url: string) => void;
  private abort = new AbortController();
  private streamDone: Promise<void>;
  private closed = false;

  constructor(
    private readonly sseUrl: string,
    private readonly headers: Record<string, string>,
  ) {
    this.endpointReady = new Promise<string>((res) => {
      this.endpointResolve = res;
    });
    this.streamDone = this.openStream();
  }

  private async openStream(): Promise<void> {
    const res = await request(this.sseUrl, {
      method: "GET",
      headers: { accept: "text/event-stream", ...this.headers },
      signal: this.abort.signal,
    });
    if (res.statusCode !== 200) {
      throw new MavioError(`sse GET ${res.statusCode}`, "TRANSPORT_HTTP_ERROR");
    }
    let buffer = "";
    for await (const chunk of res.body) {
      buffer += chunk.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        this.handleEvent(raw);
      }
    }
  }

  private handleEvent(raw: string): void {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    const data = dataLines.join("\n");
    if (!data) return;

    if (event === "endpoint") {
      const url = data.startsWith("http") ? data : new URL(data, this.sseUrl).toString();
      this.endpointUrl = url;
      this.endpointResolve(url);
      return;
    }
    if (event === "message" || event === "response") {
      try {
        const frame = JSON.parse(data) as MCPFrame;
        if (frame.id !== undefined && frame.id !== null) {
          const p = this.pending.get(frame.id);
          if (p) {
            this.pending.delete(frame.id);
            p.resolve(frame);
          }
        }
      } catch (err) {
        console.warn("[sse] bad frame:", err);
      }
    }
  }

  async send(frame: MCPFrame): Promise<MCPFrame> {
    if (this.closed) throw new MavioError("sse session closed", "TRANSPORT_CLOSED");
    const endpoint = await this.endpointReady;
    if (frame.id === undefined || frame.id === null) {
      // notification — fire and forget
      await request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.headers },
        body: JSON.stringify(frame),
      });
      return frame;
    }
    const promise = new Promise<MCPFrame>((resolve, reject) => {
      this.pending.set(frame.id!, { resolve, reject });
    });
    const res = await request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.headers },
      body: JSON.stringify(frame),
    });
    if (res.statusCode >= 400) {
      this.pending.delete(frame.id);
      throw new MavioError(`sse POST ${res.statusCode}`, "TRANSPORT_HTTP_ERROR");
    }
    return promise;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    for (const [, p] of this.pending) p.reject(new MavioError("session closed", "TRANSPORT_CLOSED"));
    this.pending.clear();
    await this.streamDone.catch(() => undefined);
  }
}

export class SseTransport implements Transport {
  readonly kind = "sse" as const;

  async open(descriptor: TransportDescriptor): Promise<Session> {
    if (descriptor.type !== "sse") {
      throw new MavioError("wrong descriptor for sse transport", "TRANSPORT_MISMATCH");
    }
    const headers: Record<string, string> = {
      ...(descriptor.headers ?? {}),
      ...bearerHeaderFromAuth(descriptor.auth),
    };
    return new SseSession(descriptor.url, headers);
  }
}
