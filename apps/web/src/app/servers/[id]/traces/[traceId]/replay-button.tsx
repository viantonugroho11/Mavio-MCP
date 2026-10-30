"use client";

import { useState } from "react";
import { replayTrace } from "@/lib/api";

export function ReplayButton({ traceId }: { traceId: string }): JSX.Element {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<unknown>(null);

  async function handleReplay(): Promise<void> {
    setState("loading");
    try {
      const res = await replayTrace(traceId);
      setResult(res.result);
      setState("done");
    } catch (err) {
      setResult(err instanceof Error ? err.message : "replay failed");
      setState("error");
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={handleReplay}
        disabled={state === "loading"}
        className="text-xs font-mono uppercase tracking-widest px-3 py-1.5 border border-accent text-accent hover:bg-accent hover:text-white disabled:opacity-50 rounded transition-colors"
      >
        {state === "loading" ? "Replaying…" : "Replay ↺"}
      </button>
      {(state === "done" || state === "error") && (
        <div className={`text-xs font-mono border rounded px-3 py-2 max-w-sm break-all ${state === "error" ? "border-red-400 text-red-600" : "border-rule text-muted"}`}>
          {state === "done" ? "Replay dispatched." : String(result)}
        </div>
      )}
    </div>
  );
}
