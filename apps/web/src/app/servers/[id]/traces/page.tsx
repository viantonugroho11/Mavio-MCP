import Link from "next/link";
import { listTraces, type TraceRecord, type TraceFailStage } from "@/lib/api";

export const dynamic = "force-dynamic";

const FAIL_STAGE_LABELS: Record<string, string> = {
  transform_request: "transform↑",
  backend: "backend",
  transform_response: "transform↓",
  schema_validate: "schema drift",
};

function FailStagePill({ stage }: { stage: string | null }): JSX.Element {
  if (!stage) return <span className="text-muted text-xs font-mono">—</span>;
  const label = FAIL_STAGE_LABELS[stage] ?? stage;
  return (
    <span className="inline-block text-xs font-mono px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
      {label}
    </span>
  );
}

function LatencyBadge({ ms }: { ms: number }): JSX.Element {
  const color = ms < 200 ? "text-emerald-600" : ms < 1000 ? "text-amber-600" : "text-red-600";
  return <span className={`font-mono text-xs ${color}`}>{ms}ms</span>;
}

export default async function TracesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ failStage?: string; tool?: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const sp = await searchParams;
  const failStage = sp.failStage as TraceFailStage | undefined;
  const tool = sp.tool;

  let traces: TraceRecord[] = [];
  let fetchError: string | null = null;
  try {
    traces = await listTraces({ server: id, failStage, tool, limit: 200 });
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "failed to load traces";
  }

  const tools = Array.from(new Set(traces.map((t) => t.toolName))).sort();

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <Link href={`/servers/${encodeURIComponent(id)}`} className="text-xs font-mono uppercase tracking-widest text-muted hover:text-ink">
          ← Server
        </Link>
        <Link href={`/servers/${encodeURIComponent(id)}/history`} className="text-xs font-mono uppercase tracking-widest text-accent hover:underline">
          History →
        </Link>
      </div>

      <h1 className="font-display text-3xl italic mt-4">Traces</h1>
      <p className="font-mono text-xs text-muted mt-1">{id}</p>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap gap-3 text-xs font-mono">
        <span className="text-muted">fail stage:</span>
        {(["", "transform_request", "backend", "transform_response", "schema_validate", "any"] as const).map((s) => {
          const active = (failStage ?? "") === s;
          const label = s === "" ? "all" : s === "any" ? "any error" : (FAIL_STAGE_LABELS[s] ?? s);
          const href = buildHref(id, s || undefined, tool);
          return (
            <Link
              key={s}
              href={href}
              className={`px-2 py-0.5 rounded border ${active ? "border-accent text-accent" : "border-rule text-muted hover:text-ink"}`}
            >
              {label}
            </Link>
          );
        })}
      </div>

      {tools.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-mono">
          <span className="text-muted">tool:</span>
          <Link
            href={buildHref(id, failStage, undefined)}
            className={`px-2 py-0.5 rounded border ${!tool ? "border-accent text-accent" : "border-rule text-muted hover:text-ink"}`}
          >
            all
          </Link>
          {tools.map((t) => (
            <Link
              key={t}
              href={buildHref(id, failStage, t)}
              className={`px-2 py-0.5 rounded border ${tool === t ? "border-accent text-accent" : "border-rule text-muted hover:text-ink"}`}
            >
              {t}
            </Link>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="mt-6">
        {fetchError ? (
          <p className="text-sm text-red-600 font-mono">{fetchError}</p>
        ) : traces.length === 0 ? (
          <p className="text-sm text-muted">
            No traces captured yet. Enable tracing by setting{" "}
            <code className="font-mono text-xs bg-panel px-1">metadata.trace.enabled = true</code> on the server.
          </p>
        ) : (
          <div className="border border-rule divide-y divide-rule text-sm">
            <div className="grid grid-cols-[1fr_8rem_6rem_8rem_6rem] gap-x-4 px-4 py-2 text-xs font-mono text-muted bg-panel">
              <span>tool</span>
              <span>timestamp</span>
              <span>latency</span>
              <span>fail stage</span>
              <span></span>
            </div>
            {traces.map((trace) => (
              <div
                key={trace.id}
                className={`grid grid-cols-[1fr_8rem_6rem_8rem_6rem] gap-x-4 px-4 py-3 items-center ${trace.failStage ? "bg-red-50 dark:bg-red-950/10" : ""}`}
              >
                <span className="font-mono text-xs text-ink truncate">{trace.toolName}</span>
                <span className="font-mono text-xs text-muted">
                  {new Date(trace.timestamp).toLocaleTimeString()}
                </span>
                <LatencyBadge ms={trace.latencyMs} />
                <FailStagePill stage={trace.failStage} />
                <Link
                  href={`/servers/${encodeURIComponent(id)}/traces/${encodeURIComponent(trace.id)}`}
                  className="text-xs font-mono text-accent hover:underline text-right"
                >
                  view →
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function buildHref(serverId: string, failStage?: string, tool?: string): string {
  const params = new URLSearchParams();
  if (failStage) params.set("failStage", failStage);
  if (tool) params.set("tool", tool);
  const qs = params.toString();
  return `/servers/${encodeURIComponent(serverId)}/traces${qs ? `?${qs}` : ""}`;
}
