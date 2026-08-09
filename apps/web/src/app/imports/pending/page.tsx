"use client";
import { useEffect, useState } from "react";
import { approveImport, listPendingImports, rejectImport, type ServerRow } from "@/lib/api";

export default function PendingImportsPage(): JSX.Element {
  const [rows, setRows] = useState<ServerRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      setRows(await listPendingImports());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const act = async (id: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <h1 className="font-display text-4xl italic mb-6">Pending Imports</h1>
      <p className="text-sm text-muted mb-4 font-mono">Admin review — approve or reject each submitted MCP source.</p>
      {error && <p className="mb-4 text-sm text-rose-700 font-mono">{error}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-muted font-mono">No pending imports.</p>
      ) : (
        <table className="w-full text-sm font-mono border border-rule">
          <thead>
            <tr className="border-b border-rule text-left text-xs uppercase tracking-widest text-muted">
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Submitted by</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-b border-rule">
                <td className="px-3 py-2">{s.id}</td>
                <td className="px-3 py-2">{s.name}</td>
                <td className="px-3 py-2">{s.sourceType}</td>
                <td className="px-3 py-2">{(s as ServerRow & { submittedBy?: string }).submittedBy ?? "—"}</td>
                <td className="px-3 py-2 flex gap-2">
                  <button
                    disabled={busy === s.id}
                    onClick={() => void act(s.id, () => approveImport(s.id))}
                    className="bg-accent text-white px-3 py-1 text-xs uppercase tracking-widest disabled:opacity-40"
                  >
                    Approve
                  </button>
                  <button
                    disabled={busy === s.id}
                    onClick={() => {
                      const reason = window.prompt("Rejection reason?") ?? "";
                      void act(s.id, () => rejectImport(s.id, reason));
                    }}
                    className="border border-rule px-3 py-1 text-xs uppercase tracking-widest disabled:opacity-40"
                  >
                    Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
