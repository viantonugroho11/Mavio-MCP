"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getCapabilities, invokePlayground, listServers, type ServerRow, type ToolInfo } from "@/lib/api";

export default function PlaygroundPage(): JSX.Element {
  const [servers, setServers] = useState<ServerRow[]>([]);
  const [serverId, setServerId] = useState<string>("");
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [toolName, setToolName] = useState<string>("");
  const [argsText, setArgsText] = useState<string>("{}");
  const [result, setResult] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listServers().then(setServers).catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!serverId) return;
    getCapabilities(serverId)
      .then((c) => {
        setTools(c.tools ?? []);
        setToolName(c.tools?.[0]?.name ?? "");
      })
      .catch((e) => setError(String(e)));
  }, [serverId]);

  const selectedTool = useMemo(() => tools.find((t) => t.name === toolName), [tools, toolName]);

  const invoke = async (): Promise<void> => {
    setError(null);
    setPending(true);
    try {
      const args = JSON.parse(argsText);
      const outcome = await invokePlayground(serverId, toolName, args);
      setResult(`// ${outcome.latencyMs}ms · run ${outcome.runId}\n${JSON.stringify(outcome.response, null, 2)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  const canInvoke = Boolean(serverId && toolName && !pending);

  return (
    <section>
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display text-3xl italic text-ink mb-1">Playground</h1>
          <p className="text-sm text-muted">Invoke tools interactively against registered servers.</p>
        </div>
        <Link
          href="/playground/history"
          className="px-3 py-1.5 rounded border border-rule text-xs font-mono uppercase tracking-widest text-muted hover:text-ink hover:border-ink/30 transition-colors"
        >
          History →
        </Link>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-5 rounded-lg border border-danger/20 bg-danger-muted px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="rounded-lg border border-rule bg-panel p-5 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-muted mb-1.5">
              Server
            </label>
            <select
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              className="w-full border border-rule bg-ground px-3 py-2 font-mono text-sm rounded focus-visible:ring-2 ring-accent/20 transition-colors hover:border-ink/30"
            >
              <option value="">— choose —</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>{s.id}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-muted mb-1.5">
              Tool
            </label>
            <select
              value={toolName}
              onChange={(e) => setToolName(e.target.value)}
              className="w-full border border-rule bg-ground px-3 py-2 font-mono text-sm rounded focus-visible:ring-2 ring-accent/20 transition-colors hover:border-ink/30 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!tools.length}
            >
              {!tools.length && <option value="">— select server first —</option>}
              {tools.map((t) => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>

        {selectedTool?.description && (
          <p className="text-sm text-muted mb-4 px-1">{selectedTool.description}</p>
        )}

        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest text-muted mb-1.5">
            Arguments (JSON)
          </label>
          <textarea
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            rows={8}
            className="w-full border border-rule bg-ground px-3 py-2.5 font-mono text-sm rounded resize-y focus-visible:ring-2 ring-accent/20 transition-colors hover:border-ink/20 scrollbar-thin"
            spellCheck={false}
          />
        </div>
      </div>

      <button
        onClick={invoke}
        disabled={!canInvoke}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {pending ? (
          <>
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            Calling…
          </>
        ) : (
          "Invoke"
        )}
      </button>

      {/* Result */}
      {result && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono uppercase tracking-widest text-muted">Response</span>
          </div>
          <pre className="rounded-lg bg-panel border border-rule p-5 text-xs font-mono overflow-x-auto whitespace-pre-wrap scrollbar-thin leading-relaxed">
            {result}
          </pre>
        </div>
      )}
    </section>
  );
}
