import { Injectable } from "@nestjs/common";
import type { GraphqlTransportDescriptor } from "@mavio/core";
import { dispatchGraphql, type GraphqlDispatchMeta } from "@mavio/import-graphql";

@Injectable()
export class GraphqlDispatcher {
  async dispatch(
    descriptor: GraphqlTransportDescriptor,
    meta: GraphqlDispatchMeta,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const headers: Record<string, string> = { ...(descriptor.headers ?? {}) };
    if (descriptor.auth?.type === "bearer") {
      const envName = descriptor.auth.secretRef.replace(/^secret:\/\//, "").toUpperCase();
      const value = process.env[envName];
      if (value) headers.authorization = `Bearer ${value}`;
    }
    return dispatchGraphql(descriptor.endpoint, meta, args, headers);
  }
}
