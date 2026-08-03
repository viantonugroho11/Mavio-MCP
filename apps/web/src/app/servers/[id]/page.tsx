import Link from "next/link";
import { getCapabilities, getServer } from "@/lib/api";
import { ToolExplorer } from "@/components/tool-explorer";

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
        <ToolExplorer serverId={server.id} tools={tools} />
      )}
    </section>
  );
}
