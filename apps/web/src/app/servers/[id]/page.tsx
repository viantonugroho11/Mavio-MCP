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
      <Link href="/" className="text-xs font-mono uppercase tracking-widest text-muted hover:text-ink">
        ← All servers
      </Link>

      <div className="flex items-baseline justify-between mt-4">
        <h1 className="font-display text-4xl italic">{server.name}</h1>
        <div className="flex gap-4">
          <Link
            href={`/servers/${encodeURIComponent(server.id)}/traces`}
            className="text-xs font-mono uppercase tracking-widest text-muted hover:text-ink"
          >
            Traces
          </Link>
          <Link
            href={`/servers/${encodeURIComponent(server.id)}/history`}
            className="text-xs font-mono uppercase tracking-widest text-accent hover:underline"
          >
            History →
          </Link>
        </div>
      </div>

      <div className="mt-2 font-mono text-xs text-muted space-x-2">
        <span>{server.id}</span>
        <span>·</span>
        <span>{server.workspaceId}/{server.projectId}</span>
        <span>·</span>
        <span>{server.sourceType}</span>
        {server.status && <><span>·</span><span>status: {server.status}</span></>}
      </div>

      {/* Transport metadata */}
      <div className="mt-6 border border-rule bg-panel px-4 py-3">
        <h2 className="font-mono text-xs uppercase tracking-widest text-muted mb-2">Transport</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
          <dt className="text-muted">kind</dt>
          <dd className="text-ink">{transportMeta.kind}</dd>
          {transportMeta.endpoint && (
            <>
              <dt className="text-muted">endpoint</dt>
              <dd className="text-ink break-all">{transportMeta.endpoint}</dd>
            </>
          )}
          {transportMeta.command && (
            <>
              <dt className="text-muted">command</dt>
              <dd className="text-ink">{transportMeta.command}</dd>
            </>
          )}
          <dt className="text-muted">tls</dt>
          <dd className={transportMeta.tls ? "text-emerald-600" : "text-muted"}>{transportMeta.tls ? "yes" : "no"}</dd>
          {serverInfo?.name && (
            <>
              <dt className="text-muted">server name</dt>
              <dd className="text-ink">{serverInfo.name}</dd>
            </>
          )}
          {serverInfo?.version && (
            <>
              <dt className="text-muted">server version</dt>
              <dd className="text-ink">{serverInfo.version}</dd>
            </>
          )}
          {snapshotVersion && (
            <>
              <dt className="text-muted">snapshot</dt>
              <dd className="text-ink">
                {snapshotVersion}
                {snapshotTakenAt && (
                  <span className="text-muted ml-2">
                    · {new Date(snapshotTakenAt).toISOString()}
                  </span>
                )}
              </dd>
            </>
          )}
        </dl>
      </div>

      {/* Tools */}
      <h2 className="font-display text-2xl italic mt-10 mb-4">
        Tools <span className="text-bronze text-sm not-italic font-mono">({tools.length})</span>
      </h2>
      {tools.length === 0 ? (
        <p className="text-muted text-sm">No capability snapshot yet.</p>
      ) : (
        <ToolExplorer serverId={server.id} tools={tools} />
      )}

      {/* Resources */}
      {resources.length > 0 && (
        <>
          <h2 className="font-display text-2xl italic mt-10 mb-4">
            Resources <span className="text-bronze text-sm not-italic font-mono">({resources.length})</span>
          </h2>
          <ResourceList resources={resources} />
        </>
      )}

      {/* Prompts */}
      {prompts.length > 0 && (
        <>
          <h2 className="font-display text-2xl italic mt-10 mb-4">
            Prompts <span className="text-bronze text-sm not-italic font-mono">({prompts.length})</span>
          </h2>
          <PromptList prompts={prompts} />
        </>
      )}
    </section>
  );
}

function ResourceList({ resources }: { resources: ResourceInfo[] }): JSX.Element {
  return (
    <ul className="divide-y divide-rule border-t border-b border-rule">
      {resources.map((r) => (
        <li key={r.uri} className="py-3">
          <div className="flex items-baseline gap-3">
            <code className="font-mono text-sm text-accent">{r.uri}</code>
            {r.mimeType && <span className="text-xs font-mono text-muted">{r.mimeType}</span>}
          </div>
          {r.name && <div className="text-sm text-ink mt-0.5">{r.name}</div>}
          {r.description && <div className="text-sm text-muted mt-0.5">{r.description}</div>}
        </li>
      ))}
    </ul>
  );
}

function PromptList({ prompts }: { prompts: PromptInfo[] }): JSX.Element {
  return (
    <ul className="divide-y divide-rule border-t border-b border-rule">
      {prompts.map((p) => (
        <li key={p.name} className="py-3">
          <div className="flex items-baseline gap-3">
            <code className="font-mono text-sm text-accent">{p.name}</code>
          </div>
          {p.description && <div className="text-sm text-muted mt-0.5">{p.description}</div>}
          {p.arguments && p.arguments.length > 0 && (
            <ul className="mt-2 text-xs font-mono space-y-1">
              {p.arguments.map((a) => (
                <li key={a.name} className="flex items-baseline gap-2 pl-4">
                  <span className="text-ink">{a.name}</span>
                  {a.required && <span className="text-bronze">*</span>}
                  {a.description && <span className="text-muted">— {a.description}</span>}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
