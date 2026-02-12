import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="mx-auto flex min-h-[80vh] max-w-3xl flex-col justify-center gap-8">
      <section className="rounded-md border border-border bg-panel p-8 shadow-panel">
        <p className="text-xs uppercase tracking-[0.14em] text-muted">Military Career Life Simulator</p>
        <h1 className="mt-3 text-3xl font-semibold text-text">Server-Authoritative Career Simulation</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Build a military career in a synchronized real-time system where one in-game day equals ten real seconds.
          Progression, events, and decisions are persisted in PostgreSQL.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/register" className="rounded border border-accent bg-accent/20 px-4 py-2 text-sm font-medium text-text">
            Create Account
          </Link>
          <Link href="/login" className="rounded border border-border bg-bg px-4 py-2 text-sm font-medium text-text">
            Login
          </Link>
          <Link href="/dashboard" className="rounded border border-border bg-bg px-4 py-2 text-sm font-medium text-text">
            Open Dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
