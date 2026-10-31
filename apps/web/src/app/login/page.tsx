import { API_URL, listAuthProviders } from "@/lib/api";
import { LocalLoginForm } from "@/components/local-login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}): Promise<JSX.Element> {
  let providers: Awaited<ReturnType<typeof listAuthProviders>> = [];
  let error: string | null = null;
  try {
    providers = await listAuthProviders();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const { return_to } = await searchParams;
  const returnTo = return_to ?? "/";

  return (
    <div className="min-h-[calc(100vh-10rem)] flex items-center justify-center">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <span className="font-display text-3xl italic tracking-tight text-ink">
            Mavio<span className="text-bronze">·</span>MCP
          </span>
          <p className="mt-2 text-sm text-muted">Sign in to continue to the console.</p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-rule bg-panel shadow-card p-6">
          <h1 className="text-base font-semibold text-ink mb-1">Choose a provider</h1>
          <p className="text-sm text-muted mb-5">Select an identity provider to authenticate.</p>

          {error && (
            <div className="mb-4 rounded-lg border border-danger/20 bg-danger-muted px-4 py-3 text-sm text-danger">
              Failed to load providers: {error}
            </div>
          )}

          {providers.length === 0 && !error && (
            <div className="rounded-lg bg-ground border border-rule px-4 py-4 text-sm text-muted">
              No auth providers configured. An admin can add OIDC at{" "}
              <code className="text-ink font-mono text-xs">PUT /api/auth/providers/:id</code>{" "}
              or local users at{" "}
              <code className="text-ink font-mono text-xs">POST /api/auth/local/users</code>.
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {providers.map((p) => {
              if (p.type === "local") {
                return (
                  <li key={p.id}>
                    <div className="px-4 py-4 rounded-lg border border-rule bg-ground">
                      <p className="text-sm font-medium text-ink mb-1">{p.displayName}</p>
                      <LocalLoginForm returnTo={returnTo} />
                    </div>
                  </li>
                );
              }
              const href = `${API_URL}${p.loginUrl}?return_to=${encodeURIComponent(returnTo)}`;
              return (
                <li key={p.id}>
                  <a
                    href={href}
                    className="flex items-center justify-between px-4 py-3 rounded-lg border border-rule bg-ground hover:border-accent/40 hover:bg-accent-muted transition-all group"
                  >
                    <span className="text-sm font-medium text-ink group-hover:text-accent transition-colors">
                      {p.displayName}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
                        {p.id}
                      </span>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-muted group-hover:text-accent transition-colors">
                        <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
