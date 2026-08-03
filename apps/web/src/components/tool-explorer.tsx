"use client";

import { useMemo, useState } from "react";
import { SchemaTree } from "./schema-tree";
import type { ToolInfo } from "@/lib/api";

export function ToolExplorer({
  serverId,
  tools,
}: {
  serverId: string;
  tools: ToolInfo[];
}): JSX.Element {
  const [q, setQ] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tools;
    return tools.filter(
      (t) =>
        t.name.toLowerCase().includes(needle) ||
        (t.description ?? "").toLowerCase().includes(needle),
    );
  }, [tools, q]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="filter tools by name or description…"
          className="flex-1 px-3 py-2 bg-panel border border-rule text-sm font-mono focus:outline-none focus:border-bronze"
        />
        <label className="text-xs text-muted flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={showRaw}
            onChange={(e) => setShowRaw(e.target.checked)}
          />
          raw JSON
        </label>
        <span className="text-xs font-mono text-muted">
          {filtered.length}/{tools.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted text-sm">No match.</p>
      ) : (
        <ul className="divide-y divide-rule border-t border-b border-rule">
          {filtered.map((t) => (
            <li key={t.name} className="py-4">
              <div className="flex items-baseline gap-3">
                <code className="font-mono text-sm text-accent">
                  {serverId}.{t.name}
                </code>
                {t.description && (
                  <span className="text-sm text-muted">{t.description}</span>
                )}
              </div>
              <details className="mt-2" open={filtered.length <= 5}>
                <summary className="text-xs font-mono uppercase tracking-widest text-muted cursor-pointer">
                  input schema
                </summary>
                <div className="mt-2 bg-panel p-3">
                  {showRaw ? (
                    <pre className="text-xs font-mono overflow-x-auto">
                      {JSON.stringify(t.inputSchema, null, 2)}
                    </pre>
                  ) : (
                    <SchemaTree schema={t.inputSchema} />
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
