import WebSocket from "ws";
import type { MCPFrame, TransportDescriptor } from "@mavio/core";
import { bearerHeaderFromAuth, MavioError } from "@mavio/core";
import type { Session, Transport } from "./index.js";

interface Pending {
  resolve: (frame: MCPFrame) => void;
  reject: (err: Error) => void;
}

class WsSession implements Session {
  private readonly pending = new Map<string | number, Pending>();
  private ready!: Promise<void>;
  private closed = false;
  private ws: WebSocket;

  constructor(url: string, headers: Record<string, string>, subprotocol?: string) {
    this.ws = new WebSocket(url, subprotocol ? [subprotocol] : undefined, { headers });
    this.ready = new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", (err) => reject(err));
    });
    this.ws.on("message", (raw) => this.handleMessage(raw.toString()));
    this.ws.on("close", () => this.failAll(new MavioError("ws closed", "TRANSPORT_CLOSED")));
    this.ws.on("error", (err) => this.failAll(err instanceof Error ? err : new Error(String(err))));
  }

  private handleMessage(text: string): void {
    let frame: MCPFrame;
    try {
      frame = JSON.parse(text) as MCPFrame;
    } catch (err) {
      console.warn("[ws] bad frame:", err);
      return;
    }
    if (frame.id === undefined || frame.id === null) return;
    const p = this.pending.get(frame.id);
    if (p) {
      this.pending.delete(frame.id);
      p.resolve(frame);
    }
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  async send(frame: MCPFrame): Promise<MCPFrame> {
    if (this.closed) throw new MavioError("ws session closed", "TRANSPORT_CLOSED");
    await this.ready;
    if (frame.id === undefined || frame.id === null) {
      this.ws.send(JSON.stringify(frame));
      return frame;
    }
    const promise = new Promise<MCPFrame>((resolve, reject) => {
      this.pending.set(frame.id!, { resolve, reject });
    });
    this.ws.send(JSON.stringify(frame));
    return promise;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new MavioError("session closed", "TRANSPORT_CLOSED"));
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}

export class WsTransport implements Transport {
  readonly kind = "ws" as const;

  async open(descriptor: TransportDescriptor): Promise<Session> {
    if (descriptor.type !== "ws") {
      throw new MavioError("wrong descriptor for ws transport", "TRANSPORT_MISMATCH");
    }
    const headers: Record<string, string> = {
      ...(descriptor.headers ?? {}),
      ...bearerHeaderFromAuth(descriptor.auth),
    };
    return new WsSession(descriptor.url, headers, descriptor.subprotocol);
  }
}
