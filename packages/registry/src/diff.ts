import { createHash } from "node:crypto";
import type { ServerCapabilities, ToolDefinition } from "@mavio/core";

export interface ToolChange {
  name: string;
  before?: ToolDefinition;
  after?: ToolDefinition;
}

export interface CapabilityDiff {
  added: ToolChange[];
  removed: ToolChange[];
  changed: ToolChange[];
  unchanged: number;
}

export function diffCapabilities(a: ServerCapabilities, b: ServerCapabilities): CapabilityDiff {
  const before = new Map((a.tools ?? []).map((t) => [t.name, t]));
  const after = new Map((b.tools ?? []).map((t) => [t.name, t]));
  const added: ToolChange[] = [];
  const removed: ToolChange[] = [];
  const changed: ToolChange[] = [];
  let unchanged = 0;

  for (const [name, tool] of after) {
    const prior = before.get(name);
    if (!prior) {
      added.push({ name, after: tool });
    } else if (hash(prior) !== hash(tool)) {
      changed.push({ name, before: prior, after: tool });
    } else {
      unchanged++;
    }
  }
  for (const [name, tool] of before) {
    if (!after.has(name)) removed.push({ name, before: tool });
  }
  return { added, removed, changed, unchanged };
}

function hash(t: ToolDefinition): string {
  return createHash("sha256").update(JSON.stringify(t)).digest("hex");
}
