import { request } from "undici";
import type { MCPFrame, TransportDescriptor } from "@mavio/core";
import { bearerHeaderFromAuth, MavioError } from "@mavio/core";
import type { Session, Transport } from "./index.js";

class StreamableHttpSession implements Session {
  private sessionId: string | null = null;

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string>,
  ) {}

  async send(frame: MCPFrame): Promise<MCPFrame> {
    const isInitialize = frame.method === "initialize";
    const reqHeaders: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...this.headers,
    };
    if (this.sessionId) reqHeaders["mcp-session-id"] = this.sessionId;

    const res = await request(this.url, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify(frame),
    });

    if (res.statusCode >= 400) {
      throw new MavioError(
        `streamable-http POST ${res.statusCode}`,
        "TRANSPORT_HTTP_ERROR",
      );
    }

    if (isInitialize) {
      const sid = res.headers["mcp-session-id"];
      if (typeof sid === "string") this.sessionId = sid;
      else if (Array.isArray(sid) && sid[0]) this.sessionId = sid[0];
    }

    const ctypeRaw = res.headers["content-type"];
    const ctype = Array.isArray(ctypeRaw) ? ctypeRaw[0] ?? "" : ctypeRaw ?? "";

    if (ctype.includes("text/event-stream")) {
      return parseFirstSseFrame(res.body);
    }
    const body = (await res.body.json()) as MCPFrame;
    return body;
  }

  async close(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await request(this.url, {
        method: "DELETE",
        headers: {
          "mcp-session-id": this.sessionId,
          ...this.headers,
        },
      });
    } catch {
      /* best-effort */
    }
    this.sessionId = null;
  }
}

async function parseFirstSseFrame(
  body: AsyncIterable<Buffer> | { text(): Promise<string> },
): Promise<MCPFrame> {
  let buffer = "";
  const iter = body as AsyncIterable<Buffer>;
  for await (const chunk of iter) {
    buffer += chunk.toString("utf8");
    const idx = buffer.indexOf("\n\n");
    if (idx !== -1) {
      const raw = buffer.slice(0, idx);
      return sseEventToFrame(raw);
    }
  }
  throw new MavioError("streamable-http: empty SSE body", "TRANSPORT_HTTP_ERROR");
}

function sseEventToFrame(raw: string): MCPFrame {
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  const data = dataLines.join("\n");
  return JSON.parse(data) as MCPFrame;
}

export class StreamableHttpTransport implements Transport {
  readonly kind = "streamable-http" as const;

  async open(descriptor: TransportDescriptor): Promise<Session> {
    if (descriptor.type !== "streamable-http") {
      throw new MavioError(
        "wrong descriptor for streamable-http transport",
        "TRANSPORT_MISMATCH",
      );
    }
    const headers: Record<string, string> = {
      ...(descriptor.headers ?? {}),
      ...bearerHeaderFromAuth(descriptor.auth),
    };
    return new StreamableHttpSession(descriptor.url, headers);
  }
}
