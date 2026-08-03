"use client";
import { useEffect, useMemo, useState } from "react";
import { callTool, getCapabilities, listServers, type ServerRow, type ToolInfo } from "@/lib/api";

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
      const started = Date.now();
      const response = await callTool(`${serverId}.${toolName}`, args);
      const elapsed = Date.now() - started;
      setResult(`// ${elapsed}ms\n${JSON.stringify(response, null, 2)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <section>
      <h1 className="font-display text-4xl italic mb-6">Playground</h1>

      {error && (
        <div className="mb-4 border border-rule bg-panel px-4 py-3 text-sm font-mono text-muted">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-4">
        <label className="block">
          <span className="block text-xs font-mono uppercase tracking-widest text-muted mb-1">Server</span>
          <select
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
            className="w-full border border-rule bg-ground px-3 py-2 font-mono text-sm"
          >
            <option value="">— choose —</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>{s.id}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-mono uppercase tracking-widest text-muted mb-1">Tool</span>
          <select
            value={toolName}
            onChange={(e) => setToolName(e.target.value)}
            className="w-full border border-rule bg-ground px-3 py-2 font-mono text-sm"
            disabled={!tools.length}
          >
            {tools.map((t) => (
              <option key={t.name} value={t.name}>{t.name}</option>
            ))}
          </select>
        </label>
      </div>

      {selectedTool?.description && (
        <p className="text-sm text-muted mb-2">{selectedTool.description}</p>
      )}

      <label className="block mb-4">
        <span className="block text-xs font-mono uppercase tracking-widest text-muted mb-1">
          Arguments (JSON)
        </span>
        <textarea
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          rows={8}
          className="w-full border border-rule bg-panel px-3 py-2 font-mono text-sm"
        />
      </label>

      <button
        onClick={invoke}
        disabled={!serverId || !toolName || pending}
        className="bg-accent text-white px-4 py-2 text-sm font-mono uppercase tracking-widest disabled:opacity-40"
      >
        {pending ? "Calling…" : "Invoke"}
      </button>

      {result && (
        <pre className="mt-6 bg-panel border border-rule p-4 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
          {result}
        </pre>
      )}
    </section>
  );
}
