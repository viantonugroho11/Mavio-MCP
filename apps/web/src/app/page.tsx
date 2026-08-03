import Link from "next/link";
import { listServers } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ServersPage(): Promise<JSX.Element> {
  let servers: Awaited<ReturnType<typeof listServers>> = [];
  let error: string | null = null;
  try {
    servers = await listServers();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <section>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="font-display text-4xl italic">Registered servers</h1>
        <Link
          href="/imports"
          className="text-sm font-mono uppercase tracking-widest text-accent hover:underline"
        >
          + Import
        </Link>
      </div>

      {error && (
        <div className="border border-rule bg-panel px-4 py-3 text-sm text-muted font-mono">
          Cannot reach admin API: {error}
        </div>
      )}

      {!error && servers.length === 0 && (
        <p className="text-muted">No servers registered. Import an OpenAPI spec to begin.</p>
      )}

      <ul className="divide-y divide-rule border-t border-b border-rule">
        {servers.map((s) => (
          <li key={s.id} className="py-4 flex items-baseline gap-4">
            <Link href={`/servers/${encodeURIComponent(s.id)}`} className="font-mono text-accent hover:underline">
              {s.id}
            </Link>
            <span className="text-muted text-sm">
              {s.workspaceId}/{s.projectId}
            </span>
            <span className="text-sm">{s.name}</span>
            <span className="ml-auto text-xs font-mono uppercase tracking-widest text-bronze">
              {s.sourceType} · {s.transport.type}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
