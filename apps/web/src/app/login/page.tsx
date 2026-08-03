import { API_URL, listAuthProviders } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { return_to?: string };
}): Promise<JSX.Element> {
  let providers: Awaited<ReturnType<typeof listAuthProviders>> = [];
  let error: string | null = null;
  try {
    providers = await listAuthProviders();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const returnTo = searchParams.return_to ?? "/";

  return (
    <main className="max-w-md mx-auto px-6 py-16">
      <h1 className="font-display text-3xl italic mb-2">Sign in</h1>
      <p className="text-muted text-sm mb-8">Choose a provider to continue.</p>

      {error && (
        <div className="mb-6 p-3 border border-rule text-sm text-muted">
          Failed to load providers: {error}
        </div>
      )}

      {providers.length === 0 && !error && (
        <p className="text-sm text-muted">
          No OIDC providers configured. An admin can add one at{" "}
          <code className="text-ink">PUT /api/auth/providers/:id</code>.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {providers.map((p) => {
          const href = `${API_URL}${p.loginUrl}?return_to=${encodeURIComponent(returnTo)}`;
          return (
            <li key={p.id}>
              <a
                href={href}
                className="block px-4 py-3 border border-rule hover:border-bronze transition-colors"
              >
                <span className="text-sm font-medium">{p.displayName}</span>
                <span className="ml-2 font-mono text-[10px] uppercase tracking-widest text-muted">
                  {p.id}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
