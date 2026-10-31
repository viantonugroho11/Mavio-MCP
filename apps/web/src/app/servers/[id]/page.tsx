import Link from "next/link";
import { describeServer, type PromptInfo, type ResourceInfo } from "@/lib/api";
import { ToolExplorer } from "@/components/tool-explorer";

export const dynamic = "force-dynamic";

export default async function ServerInspector({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const desc = await describeServer(id);
  const { server, tools, resources, prompts, serverInfo, transportMeta, snapshotVersion, snapshotTakenAt } = desc;

  return (
    <section>
      {/* Breadcrumb */}
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink transition-colors mb-6"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        All servers
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <h1 className="font-display text-3xl italic text-ink">{server.name}</h1>
          <p className="mt-1 font-mono text-xs text-muted">
            {server.id} · {server.workspaceId}/{server.projectId} · {server.sourceType}
            {server.status && <> · <span className="text-ink">{server.status}</span></>}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/servers/${encodeURIComponent(server.id)}/traces`}
            className="px-3 py-1.5 rounded border border-rule text-xs font-mono uppercase tracking-widest text-muted hover:text-ink hover:border-ink/30 transition-colors"
          >
            Traces
          </Link>
          <Link
            href={`/servers/${encodeURIComponent(server.id)}/history`}
            className="px-3 py-1.5 rounded bg-accent-muted text-accent text-xs font-mono uppercase tracking-widest hover:bg-accent hover:text-white transition-colors"
          >
            History
          </Link>
        </div>
      </div>

      {/* Transport card */}
      <div className="mt-6 rounded-lg border border-rule bg-panel p-5">
        <h2 className="text-xs font-mono uppercase tracking-widest text-muted mb-3">Transport</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <MetaItem label="Kind" value={transportMeta.kind} />
          {transportMeta.endpoint && (
            <MetaItem label="Endpoint" value={transportMeta.endpoint} mono break />
          )}
          {transportMeta.command && (
            <MetaItem label="Command" value={transportMeta.command} mono />
          )}
          <MetaItem
            label="TLS"
            value={transportMeta.tls ? "Enabled" : "Disabled"}
            accent={transportMeta.tls ? "success" : undefined}
          />
          {serverInfo?.name && <MetaItem label="Server name" value={serverInfo.name} />}
          {serverInfo?.version && <MetaItem label="Version" value={serverInfo.version} mono />}
          {snapshotVersion && (
            <MetaItem
              label="Snapshot"
              value={`${snapshotVersion}${snapshotTakenAt ? ` · ${new Date(snapshotTakenAt).toLocaleString()}` : ""}`}
              mono
            />
          )}
        </div>
      </div>

      {/* Tools */}
      <div className="mt-10">
        <div className="flex items-baseline gap-3 mb-4">
          <h2 className="font-display text-2xl italic">Tools</h2>
          <span className="px-2 py-0.5 rounded-full bg-accent-muted text-accent text-xs font-mono font-medium">
            {tools.length}
          </span>
        </div>
        {tools.length === 0 ? (
          <p className="text-muted text-sm">No capability snapshot yet.</p>
        ) : (
          <ToolExplorer serverId={server.id} tools={tools} />
        )}
      </div>

      {/* Resources */}
      {resources.length > 0 && (
        <div className="mt-10">
          <div className="flex items-baseline gap-3 mb-4">
            <h2 className="font-display text-2xl italic">Resources</h2>
            <span className="px-2 py-0.5 rounded-full bg-bronze-muted text-bronze text-xs font-mono font-medium">
              {resources.length}
            </span>
          </div>
          <ResourceList resources={resources} />
        </div>
      )}

      {/* Prompts */}
      {prompts.length > 0 && (
        <div className="mt-10">
          <div className="flex items-baseline gap-3 mb-4">
            <h2 className="font-display text-2xl italic">Prompts</h2>
            <span className="px-2 py-0.5 rounded-full bg-panel text-muted text-xs font-mono font-medium">
              {prompts.length}
            </span>
          </div>
          <PromptList prompts={prompts} />
        </div>
      )}
    </section>
  );
}

function MetaItem({
  label,
  value,
  mono,
  break: breakAll,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  break?: boolean;
  accent?: "success" | "danger";
}): JSX.Element {
  const valueClass = accent === "success"
    ? "text-success"
    : accent === "danger"
    ? "text-danger"
    : "text-ink";
  return (
    <div>
      <dt className="text-[10px] font-mono uppercase tracking-widest text-muted mb-0.5">{label}</dt>
      <dd className={`text-sm ${mono ? "font-mono" : ""} ${breakAll ? "break-all" : ""} ${valueClass}`}>
        {value}
      </dd>
    </div>
  );
}

function ResourceList({ resources }: { resources: ResourceInfo[] }): JSX.Element {
  return (
    <div className="rounded-lg border border-rule overflow-hidden">
      {resources.map((r, i) => (
        <div key={r.uri} className={`px-5 py-3.5 ${i > 0 ? "border-t border-rule" : ""} bg-panel`}>
          <div className="flex items-center gap-3 flex-wrap">
            <code className="font-mono text-sm text-accent">{r.uri}</code>
            {r.mimeType && (
              <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full bg-ground text-muted border border-rule">
                {r.mimeType}
              </span>
            )}
          </div>
          {r.name && <div className="text-sm text-ink mt-0.5">{r.name}</div>}
          {r.description && <div className="text-xs text-muted mt-0.5">{r.description}</div>}
        </div>
      ))}
    </div>
  );
}

function PromptList({ prompts }: { prompts: PromptInfo[] }): JSX.Element {
  return (
    <div className="rounded-lg border border-rule overflow-hidden">
      {prompts.map((p, i) => (
        <div key={p.name} className={`px-5 py-3.5 ${i > 0 ? "border-t border-rule" : ""} bg-panel`}>
          <code className="font-mono text-sm text-accent">{p.name}</code>
          {p.description && <div className="text-sm text-muted mt-0.5">{p.description}</div>}
          {p.arguments && p.arguments.length > 0 && (
            <ul className="mt-2 space-y-1">
              {p.arguments.map((a) => (
                <li key={a.name} className="flex items-center gap-2 pl-4 text-xs font-mono">
                  <span className="text-ink">{a.name}</span>
                  {a.required && (
                    <span className="text-[9px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded bg-danger-muted text-danger">
                      required
                    </span>
                  )}
                  {a.description && <span className="text-muted">— {a.description}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
