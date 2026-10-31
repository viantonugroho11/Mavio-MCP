import Link from "next/link";
import { listServers } from "@/lib/api";

export const dynamic = "force-dynamic";

const STATUS_CONFIG: Record<string, { dot: string; badge: string; label: string }> = {
  healthy: { dot: "bg-success", badge: "bg-success-muted text-success", label: "Healthy" },
  degraded: { dot: "bg-warning", badge: "bg-warning-muted text-warning", label: "Degraded" },
  down: { dot: "bg-danger", badge: "bg-danger-muted text-danger", label: "Down" },
  unknown: { dot: "bg-subtle", badge: "bg-panel text-subtle", label: "Unknown" },
};

export default async function ServersPage(): Promise<JSX.Element> {
  let servers: Awaited<ReturnType<typeof listServers>> = [];
  let error: string | null = null;
  try {
    servers = await listServers();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const healthy = servers.filter((s) => s.status === "healthy").length;
  const total = servers.length;

  return (
    <section>
      {/* Page header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-display text-3xl italic text-ink mb-1">Servers</h1>
          {total > 0 && (
            <p className="text-sm text-muted">
              {healthy} of {total} healthy
            </p>
          )}
        </div>
        <Link
          href="/imports"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
            <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          Import
        </Link>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-danger/20 bg-danger-muted px-4 py-3 text-sm text-danger mb-6">
          <strong className="font-medium">API error:</strong> {error}
        </div>
      )}

      {/* Empty state */}
      {!error && servers.length === 0 && (
        <div className="rounded-xl border border-rule bg-panel px-8 py-16 text-center">
          <div className="w-12 h-12 rounded-xl bg-accent-muted flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="3" stroke="#2E48D6" strokeWidth="1.5"/>
              <path d="M3 9h18M9 21V9" stroke="#2E48D6" strokeWidth="1.5"/>
            </svg>
          </div>
          <h2 className="text-lg font-medium text-ink mb-2">No servers yet</h2>
          <p className="text-sm text-muted mb-6 max-w-xs mx-auto">
            Import an OpenAPI, SQL, or GraphQL source to register your first MCP server.
          </p>
          <Link
            href="/imports"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-colors"
          >
            Import a source
          </Link>
        </div>
      )}

      {/* Server cards */}
      {servers.length > 0 && (
        <div className="grid gap-3">
          {servers.map((s) => {
            const status = s.status ?? "unknown";
            const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.unknown;
            return (
              <Link
                key={s.id}
                href={`/servers/${encodeURIComponent(s.id)}`}
                className="group block rounded-lg border border-rule bg-panel px-5 py-4 hover:border-accent/30 hover:shadow-card-hover transition-all"
              >
                <div className="flex items-center gap-3">
                  {/* Status dot */}
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cfg.dot}`} />

                  {/* ID + name */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-mono text-sm font-medium text-accent group-hover:underline">
                        {s.id}
                      </span>
                      {s.name && s.name !== s.id && (
                        <span className="text-sm text-ink">{s.name}</span>
                      )}
                      {s.approvalStatus && s.approvalStatus !== "approved" && (
                        <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full border border-warning/30 bg-warning-muted text-warning">
                          {s.approvalStatus}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted font-mono">
                        {s.workspaceId}/{s.projectId}
                      </span>
                    </div>
                  </div>

                  {/* Right meta */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full ${cfg.badge}`}>
                      {cfg.label}
                    </span>
                    <span className="text-xs font-mono text-bronze uppercase tracking-widest hidden sm:block">
                      {s.sourceType}
                    </span>
                    <span className="text-subtle text-xs">·</span>
                    <span className="text-xs font-mono text-subtle uppercase tracking-widest hidden sm:block">
                      {s.transport.type}
                    </span>
                    <svg
                      width="16" height="16" viewBox="0 0 16 16" fill="none"
                      className="text-subtle group-hover:text-accent transition-colors ml-1"
                    >
                      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
