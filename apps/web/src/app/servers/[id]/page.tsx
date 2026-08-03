import Link from "next/link";
import { getCapabilities, getServer } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ServerInspector({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  const [server, caps] = await Promise.all([getServer(id), getCapabilities(id)]);
  const tools = caps.tools ?? [];

  return (
    <section>
      <Link href="/" className="text-xs font-mono uppercase tracking-widest text-muted hover:text-ink">
        ← All servers
      </Link>
      <div className="flex items-baseline justify-between mt-4">
        <h1 className="font-display text-4xl italic">{server.name}</h1>
        <Link
          href={`/servers/${encodeURIComponent(server.id)}/history`}
          className="text-xs font-mono uppercase tracking-widest text-accent hover:underline"
        >
          History →
        </Link>
      </div>
      <div className="mt-2 font-mono text-xs text-muted">
        {server.id} · {server.workspaceId}/{server.projectId} · {server.sourceType} · {server.transport.type}
        {server.transport.baseUrl ? ` · ${server.transport.baseUrl}` : ""}
        {server.status ? ` · status: ${server.status}` : ""}
      </div>

      <h2 className="font-display text-2xl italic mt-10 mb-4">
        Tools <span className="text-bronze text-sm not-italic font-mono">({tools.length})</span>
      </h2>

      {tools.length === 0 ? (
        <p className="text-muted text-sm">No capability snapshot yet.</p>
      ) : (
        <ul className="divide-y divide-rule border-t border-b border-rule">
          {tools.map((t) => (
            <li key={t.name} className="py-4">
              <div className="flex items-baseline gap-3">
                <code className="font-mono text-sm text-accent">{server.id}.{t.name}</code>
                {t.description && <span className="text-sm text-muted">{t.description}</span>}
              </div>
              <details className="mt-2">
                <summary className="text-xs font-mono uppercase tracking-widest text-muted cursor-pointer">
                  input schema
                </summary>
                <pre className="mt-2 bg-panel p-3 text-xs font-mono overflow-x-auto rounded">
                  {JSON.stringify(t.inputSchema, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
