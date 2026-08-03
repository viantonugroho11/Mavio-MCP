import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { MCPFrame, TransportDescriptor } from "@mavio/core";
import { MavioError } from "@mavio/core";
import type { Session, Transport } from "./index.js";

interface Pending {
  resolve: (frame: MCPFrame) => void;
  reject: (err: Error) => void;
}

class StdioSession implements Session {
  private buffer = "";
  private readonly pending = new Map<string | number, Pending>();
  private closed = false;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.onData(chunk));
    child.on("exit", () => this.handleExit());
    child.on("error", (err) => this.handleExit(err));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const frame = JSON.parse(line) as MCPFrame;
        if (frame.id !== null && frame.id !== undefined) {
          const pending = this.pending.get(frame.id);
          if (pending) {
            this.pending.delete(frame.id);
            pending.resolve(frame);
          }
        }
      } catch {
        // ignore malformed frames
      }
    }
  }

  private handleExit(err?: Error): void {
    this.closed = true;
    const reason = err ?? new MavioError("stdio session closed", "TRANSPORT_CLOSED");
    for (const p of this.pending.values()) p.reject(reason);
    this.pending.clear();
  }

  async send(frame: MCPFrame): Promise<MCPFrame> {
    if (this.closed) {
      throw new MavioError("stdio session already closed", "TRANSPORT_CLOSED");
    }
    if (frame.id === null || frame.id === undefined) {
      this.child.stdin.write(JSON.stringify(frame) + "\n");
      return frame;
    }
    return new Promise<MCPFrame>((resolve, reject) => {
      this.pending.set(frame.id!, { resolve, reject });
      this.child.stdin.write(JSON.stringify(frame) + "\n");
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.child.kill();
  }
}

export class StdioTransport implements Transport {
  readonly kind = "stdio" as const;

  async open(descriptor: TransportDescriptor): Promise<Session> {
    if (descriptor.type !== "stdio") {
      throw new MavioError("wrong descriptor for stdio transport", "TRANSPORT_MISMATCH");
    }
    const child = spawn(descriptor.command, descriptor.args ?? [], {
      cwd: descriptor.cwd,
      env: { ...process.env, ...descriptor.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return new StdioSession(child);
  }
}
