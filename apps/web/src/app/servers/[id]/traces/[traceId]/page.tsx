import Link from "next/link";
import { getTrace, type TraceRecord } from "@/lib/api";
import { notFound } from "next/navigation";
import { ReplayButton } from "./replay-button";

export const dynamic = "force-dynamic";

const STAGE_LABELS: Record<string, string> = {
  transform_request: "Transform ↑",
  backend: "Backend",
  transform_response: "Transform ↓",
  schema_validate: "Schema Validate",
};

function CodeBlock({ value }: { value: unknown }): JSX.Element {
  return (
    <pre className="text-xs font-mono bg-panel border border-rule rounded p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-64">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function HopTimeline({ trace }: { trace: TraceRecord }): JSX.Element {
  const hops = trace.hops ?? [];
  if (hops.length === 0) {
    return (
      <div className="text-xs text-muted font-mono">
        hop timeline not captured (error before dispatch)
      </div>
    );
  }
  return (
    <div className="flex gap-2 items-center flex-wrap">
      {hops.map((hop, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className={`text-xs font-mono px-2 py-1 rounded border ${hop.outcome === "error" ? "border-red-400 text-red-600 bg-red-50 dark:bg-red-950/20" : "border-emerald-400 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/20"}`}>
            <div>{hop.stage}</div>
            <div className="text-muted">{hop.durationMs}ms</div>
          </div>
          {i < hops.length - 1 && <span className="text-muted text-xs">→</span>}
        </div>
      ))}
    </div>
  );
}

export default async function TraceDetailPage({
  params,
}: {
  params: Promise<{ id: string; traceId: string }>;
}): Promise<JSX.Element> {
  const { id, traceId } = await params;
  let trace: TraceRecord;
  try {
    trace = await getTrace(traceId);
  } catch {
    notFound();
  }

  const failStage = trace.failStage;

  return (
    <section className="space-y-6">
      <div className="flex items-baseline justify-between">
        <Link
          href={`/servers/${encodeURIComponent(id)}/traces`}
          className="text-xs font-mono uppercase tracking-widest text-muted hover:text-ink"
        >
          ← Traces
        </Link>
        <ReplayButton traceId={traceId} />
      </div>

      <div>
        <h1 className="font-display text-2xl italic">{trace.toolName}</h1>
        <div className="mt-1 flex flex-wrap gap-3 text-xs font-mono text-muted">
          <span>{trace.serverId}</span>
          <span>·</span>
          <span>{new Date(trace.timestamp).toISOString()}</span>
          <span>·</span>
          <span>{trace.latencyMs}ms</span>
          {trace.principalId && <><span>·</span><span>{trace.principalId}</span></>}
          {trace.nodeId && <><span>·</span><span>node:{trace.nodeId}</span></>}
        </div>
      </div>

      {failStage && (
        <div className="border border-red-300 bg-red-50 dark:bg-red-950/20 px-4 py-3 rounded">
          <p className="text-sm font-mono text-red-700 dark:text-red-400">
            Failed at: <strong>{STAGE_LABELS[failStage] ?? failStage}</strong>
          </p>
        </div>
      )}

      {/* Hop timeline */}
      <div>
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted mb-2">Hop Timeline</h2>
        <HopTimeline trace={trace} />
      </div>

      {/* Four-hop panels */}
      <div className="grid gap-6">
        <HopPanel
          title="Client Request"
          highlight={failStage === "transform_request"}
          data={trace.clientRequest}
        />
        <HopPanel
          title="Backend Request (post-transform)"
          highlight={failStage === "transform_request"}
          data={trace.backendRequest}
        />
        <HopPanel
          title="Backend Response"
          highlight={failStage === "backend" || failStage === "transform_response"}
          data={trace.backendResponse}
        />
        <HopPanel
          title="Client Response"
          highlight={failStage === "schema_validate"}
          data={trace.clientResponse}
        />
      </div>

      {trace.schemaDiff && (
        <div>
          <h2 className="font-mono text-xs uppercase tracking-widest text-muted mb-2">Schema Drift</h2>
          <CodeBlock value={trace.schemaDiff} />
        </div>
      )}
    </section>
  );
}

function HopPanel({
  title,
  highlight,
  data,
}: {
  title: string;
  highlight: boolean;
  data: unknown;
}): JSX.Element {
  return (
    <div className={`border rounded p-4 ${highlight ? "border-red-400" : "border-rule"}`}>
      <h3 className={`font-mono text-xs uppercase tracking-widest mb-2 ${highlight ? "text-red-600" : "text-muted"}`}>
        {title}
        {highlight && <span className="ml-2 text-red-500">← failed here</span>}
      </h3>
      <CodeBlock value={data} />
    </div>
  );
}
