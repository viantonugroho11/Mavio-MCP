import Link from "next/link";

export function Nav(): JSX.Element {
  return (
    <header className="border-b border-rule">
      <div className="max-w-5xl mx-auto px-6 py-5 flex items-baseline gap-8">
        <Link href="/" className="font-display text-2xl italic tracking-tight">
          Mavio<span className="text-bronze">·</span>MCP
        </Link>
        <nav className="flex gap-6 text-sm text-muted">
          <Link href="/" className="hover:text-ink">Servers</Link>
          <Link href="/playground" className="hover:text-ink">Playground</Link>
          <Link href="/imports" className="hover:text-ink">Imports</Link>
        </nav>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-bronze">
          v0.1.0-mvp
        </span>
      </div>
    </header>
  );
}
