"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { importGraphqlEndpoint, importOpenApi, importSql } from "@/lib/api";

type Tab = "openapi" | "sql" | "graphql";

export default function ImportsPage(): JSX.Element {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("openapi");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const finish = (id: string, msg: string): void => {
    setOk(msg);
    setTimeout(() => router.push(`/servers/${encodeURIComponent(id)}`), 600);
  };

  const wrap = async (fn: () => Promise<{ id: string; msg: string }>): Promise<void> => {
    setError(null);
    setOk(null);
    setPending(true);
    try {
      const { id, msg } = await fn();
      finish(id, msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <section>
      <h1 className="font-display text-4xl italic mb-6">Import a source</h1>

      <div className="flex gap-4 border-b border-rule mb-6">
        {(["openapi", "sql", "graphql"] as Tab[]).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-2 text-xs font-mono uppercase tracking-widest ${
              tab === k ? "border-b-2 border-accent text-ink" : "text-muted"
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      {tab === "openapi" && <OpenApiForm pending={pending} onSubmit={wrap} />}
      {tab === "sql" && <SqlForm pending={pending} onSubmit={wrap} />}
      {tab === "graphql" && <GraphqlForm pending={pending} onSubmit={wrap} />}

      {ok && <p className="mt-4 text-sm text-accent font-mono">{ok}</p>}
      {error && <p className="mt-4 text-sm text-rose-700 font-mono">{error}</p>}
    </section>
  );
}

interface SubmitProps {
  pending: boolean;
  onSubmit: (fn: () => Promise<{ id: string; msg: string }>) => Promise<void>;
}

function Field({
  label,
  span,
  children,
}: {
  label: string;
  span?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className={`block ${span ? "col-span-2" : ""}`}>
      <span className="block text-xs font-mono uppercase tracking-widest text-muted mb-1">{label}</span>
      {children}
    </label>
  );
}

function OpenApiForm({ pending, onSubmit }: SubmitProps): JSX.Element {
  const [id, setId] = useState("petstore");
  const [url, setUrl] = useState("https://petstore3.swagger.io/api/v3/openapi.json");
  const [baseUrl, setBaseUrl] = useState("");

  return (
    <form
      className="grid grid-cols-2 gap-4 max-w-2xl"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(async () => {
          const r = await importOpenApi({ id, workspaceId: "default", projectId: "sandbox", url, baseUrl });
          return { id, msg: `Imported ${r.toolCount} tools` };
        });
      }}
    >
      <Field label="Server ID">
        <input value={id} onChange={(e) => setId(e.target.value)} required className="w-full border border-rule bg-ground px-3 py-2 font-mono text-sm" />
      </Field>
      <Field label="OpenAPI URL" span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} className="w-full border border-rule bg-ground px-3 py-2 font-mono text-sm" />
      </Field>
      <Field label="Base URL (override)" span>
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="only if spec has no servers[]" className="w-full border border-rule bg-ground px-3 py-2 font-mono text-sm" />
      </Field>
      <button type="submit" disabled={pending} className="col-span-2 bg-accent text-white px-4 py-2 text-sm font-mono uppercase tracking-widest disabled:opacity-40 justify-self-start">
        {pending ? "Importing…" : "Import OpenAPI"}
      </button>
    </form>
  );
}

function SqlForm({ pending, onSubmit }: SubmitProps): JSX.Element {
  const [id, setId] = useState("analytics");
  const [dsn, setDsn] = useState("postgres://mavio:mavio@localhost:5432/mavio");
  const [tables, setTables] = useState("");
  const [readOnly, setReadOnly] = useState(true);

  return (
    <form
      className="grid grid-cols-2 gap-4 max-w-2xl"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(async () => {
          const list = tables ? tables.split(",").map((s) => s.trim()) : undefined;
          const r = await importSql({
            id,
            workspaceId: "default",
            projectId: "sandbox",
            dsn,
            allowedTables: list,
            readOnly,
          });
          return { id, msg: `Imported ${r.toolCount} tools across ${r.tables.length} tables` };
        });
      }}
    >
      <Field label="Server ID">
        <input value={id} onChange={(e) => setId(e.target.value)} required className="w-full border border-rule bg-ground px-3 py-2 font-mono text-sm" />
      </Field>
      <Field label="Postgres DSN" span>
        <input value={dsn} onChange={(e) => setDsn(e.target.value)} className="w-full border border-rule bg-ground px-3 py-2 font-mono text-sm" />
      </Field>
      <Field label="Allowed tables (comma-separated; empty = all)" span>
        <input value={tables} onChange={(e) => setTables(e.target.value)} placeholder="users, orders" className="w-full border border-rule bg-ground px-3 py-2 font-mono text-sm" />
      </Field>
      <label className="col-span-2 flex items-center gap-2 text-sm font-mono">
        <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
        read-only (default on)
      </label>
      <button type="submit" disabled={pending} className="col-span-2 bg-accent text-white px-4 py-2 text-sm font-mono uppercase tracking-widest disabled:opacity-40 justify-self-start">
        {pending ? "Importing…" : "Import SQL"}
      </button>
    </form>
  );
}

function GraphqlForm({ pending, onSubmit }: SubmitProps): JSX.Element {
  const [id, setId] = useState("countries");
  const [endpoint, setEndpoint] = useState("https://countries.trevorblades.com/graphql");

  return (
    <form
      className="grid grid-cols-2 gap-4 max-w-2xl"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(async () => {
          const r = await importGraphqlEndpoint({ id, workspaceId: "default", projectId: "sandbox", endpoint });
          return { id, msg: `Imported ${r.toolCount} tools` };
        });
      }}
    >
      <Field label="Server ID">
        <input value={id} onChange={(e) => setId(e.target.value)} required className="w-full border border-rule bg-ground px-3 py-2 font-mono text-sm" />
      </Field>
      <Field label="GraphQL endpoint" span>
        <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className="w-full border border-rule bg-ground px-3 py-2 font-mono text-sm" />
      </Field>
      <button type="submit" disabled={pending} className="col-span-2 bg-accent text-white px-4 py-2 text-sm font-mono uppercase tracking-widest disabled:opacity-40 justify-self-start">
        {pending ? "Importing…" : "Import GraphQL"}
      </button>
    </form>
  );
}
