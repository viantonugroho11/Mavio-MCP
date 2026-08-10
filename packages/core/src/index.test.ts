import { describe, it, expectTypeOf } from "vitest";
import type { TransportDescriptor, StreamableHttpTransportDescriptor } from "./index.js";

describe("StreamableHttpTransportDescriptor", () => {
  it("is a member of TransportDescriptor union", () => {
    const d: StreamableHttpTransportDescriptor = {
      type: "streamable-http",
      url: "http://x/mcp",
    };
    const t: TransportDescriptor = d;
    expectTypeOf(t).toMatchTypeOf<TransportDescriptor>();
  });
});
