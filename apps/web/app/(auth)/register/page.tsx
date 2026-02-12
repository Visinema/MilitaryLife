'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api-client';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await api.register(email, password);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto mt-12 max-w-md rounded-md border border-border bg-panel p-6 shadow-panel">
      <h1 className="text-2xl font-semibold text-text">Register</h1>
      <p className="mt-2 text-sm text-muted">Create your account to start your military career simulation.</p>

      <form className="mt-5 space-y-4" onSubmit={onSubmit}>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs uppercase tracking-[0.12em] text-muted">Password</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded border border-border bg-bg px-3 py-2 text-sm text-text"
          />
        </div>

        <button
          disabled={loading}
          className="w-full rounded border border-accent bg-accent/20 px-4 py-2 text-sm font-medium text-text disabled:opacity-70"
        >
          {loading ? 'Creating account...' : 'Create Account'}
        </button>
      </form>

      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

      <p className="mt-4 text-sm text-muted">
        Already have an account?{' '}
        <Link className="text-text underline" href="/login">
          Login
        </Link>
      </p>
    </div>
  );
}
