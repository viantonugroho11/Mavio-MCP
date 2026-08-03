"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { listRuns, type PlaygroundRun } from "@/lib/api";

export default function HistoryPage(): JSX.Element {
  const [runs, setRuns] = useState<PlaygroundRun[]>([]);
  const [selected, setSelected] = useState<PlaygroundRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listRuns().then(setRuns).catch((e) => setError(String(e)));
  }, []);

  return (
    <section>
      <Link href="/playground" className="text-xs font-mono uppercase tracking-widest text-muted hover:text-ink">
        ← Playground
      </Link>
      <h1 className="font-display text-4xl italic mt-4 mb-6">Run history</h1>

      {error && <div className="border border-rule bg-panel px-4 py-3 text-sm font-mono text-muted">{error}</div>}

      <div className="grid grid-cols-[1fr_2fr] gap-6">
        <ul className="border border-rule divide-y divide-rule">
          {runs.length === 0 && <li className="px-3 py-3 text-xs text-muted font-mono">no runs</li>}
          {runs.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => setSelected(r)}
                className={`w-full text-left px-3 py-3 text-xs font-mono hover:bg-panel ${
                  selected?.id === r.id ? "bg-panel" : ""
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      r.status === "ok" ? "bg-emerald-600" : "bg-rose-600"
                    }`}
                  />
                  <span className="text-accent">{r.serverId}.{r.toolName}</span>
                  <span className="ml-auto text-muted">{r.latencyMs}ms</span>
                </div>
                <div className="text-muted mt-1">{new Date(r.invokedAt).toISOString()}</div>
              </button>
            </li>
          ))}
        </ul>

        {selected && (
          <div>
            <h2 className="font-display text-xl italic mb-2">
              {selected.serverId}.{selected.toolName}
            </h2>
            <p className="text-xs text-muted font-mono mb-4">
              {new Date(selected.invokedAt).toISOString()} · {selected.latencyMs}ms · {selected.status}
            </p>

            <h3 className="text-xs font-mono uppercase tracking-widest text-muted mb-1">Arguments</h3>
            <pre className="bg-panel border border-rule p-3 text-xs font-mono overflow-x-auto">
              {JSON.stringify(selected.arguments, null, 2)}
            </pre>

            <h3 className="text-xs font-mono uppercase tracking-widest text-muted mt-4 mb-1">Response</h3>
            <pre className="bg-panel border border-rule p-3 text-xs font-mono overflow-x-auto">
              {JSON.stringify(selected.response, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}
