import { Controller, Delete, Get, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { McpSessionStore, type McpSessionRecord } from "./mcp-session.store.js";
import { StreamableHttpSessionRegistry } from "./streamable-http.session-registry.js";

@Controller("admin/sessions")
export class McpSessionsController {
  constructor(
    private readonly store: McpSessionStore,
    private readonly streamable: StreamableHttpSessionRegistry,
  ) {}

  @Get()
  list(): McpSessionRecord[] {
    return this.store.list();
  }

  @Get(":id")
  findOne(@Param("id") id: string, @Res() res: Response): void {
    const r = this.store.get(id);
    if (!r) {
      res.status(404).end();
      return;
    }
    res.json(r);
  }

  /** Force-terminate: close SSE stream + remove from both stores. */
  @Delete(":id")
  async remove(@Param("id") id: string, @Res() res: Response): Promise<void> {
    const exists = this.store.get(id);
    if (!exists) {
      res.status(404).end();
      return;
    }
    if (await this.streamable.has(id)) {
      this.streamable.delete(id);
    }
    this.store.delete(id);
    res.status(200).end();
  }
}
