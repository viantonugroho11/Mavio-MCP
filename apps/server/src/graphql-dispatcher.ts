import { Injectable } from "@nestjs/common";
import type { GraphqlTransportDescriptor } from "@mavio/core";
import { bearerHeaderFromAuth } from "@mavio/core";
import { dispatchGraphql, type GraphqlDispatchMeta } from "@mavio/import-graphql";

@Injectable()
export class GraphqlDispatcher {
  async dispatch(
    descriptor: GraphqlTransportDescriptor,
    meta: GraphqlDispatchMeta,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      ...(descriptor.headers ?? {}),
      ...bearerHeaderFromAuth(descriptor.auth),
    };
    return dispatchGraphql(descriptor.endpoint, meta, args, headers);
  }
}
