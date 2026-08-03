import type { MCPFrame, TransportDescriptor } from "@mavio/core";
import { MavioError } from "@mavio/core";
import { StdioTransport } from "./stdio.js";
import { HttpTransport } from "./http.js";

export interface Session {
  send(frame: MCPFrame): Promise<MCPFrame>;
  close(): Promise<void>;
}

export interface Transport {
  readonly kind: TransportDescriptor["type"];
  open(descriptor: TransportDescriptor): Promise<Session>;
}

export class TransportManager {
  private readonly transports = new Map<string, Transport>();

  constructor() {
    const stdio = new StdioTransport();
    const http = new HttpTransport();
    this.register(stdio);
    this.register(http);
  }

  register(transport: Transport): void {
    this.transports.set(transport.kind, transport);
  }

  async open(descriptor: TransportDescriptor): Promise<Session> {
    const impl = this.transports.get(descriptor.type);
    if (!impl) {
      throw new MavioError(
        `no transport registered for ${descriptor.type}`,
        "TRANSPORT_UNSUPPORTED",
      );
    }
    return impl.open(descriptor);
  }
}

export { StdioTransport } from "./stdio.js";
export { HttpTransport } from "./http.js";
