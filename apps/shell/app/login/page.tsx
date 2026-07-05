'use client';

// Sign-in (spec §5). Email + password via useSession().signInWithPassword.
// In memory mode it matches an injected demo profile by email; quick-fill chips
// make the demo profiles one tap away. On success we route to the dashboard.

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, Field, Icon, Input } from '@intra/ui';
import { useSession } from '@intra/auth';

/** Only allow local same-origin paths in ?redirect to prevent open-redirect. */
function safeRedirect(candidate: string | null): string {
  if (!candidate) return '/';
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return '/';
  return candidate;
}

export default function LoginPage() {
  const {
    profile,
    mode,
    signingIn,
    authError,
    memoryProfiles,
    signInWithPassword,
    resetPassword,
  } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = safeRedirect(searchParams?.get('redirect') ?? null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  // Already signed in → leave the login screen. Respects ?redirect= so deep
  // links (e.g. /warehouse/receiving redirect through login) resume where
  // the user meant to land.
  useEffect(() => {
    if (profile) router.replace(redirectTo);
  }, [profile, router, redirectTo]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    await signInWithPassword(email, password);
  };

  const onReset = async () => {
    setNotice(null);
    if (!email.trim()) {
      setNotice('Enter your email above first.');
      return;
    }
    try {
      await resetPassword(email);
      setNotice('If that email exists, a reset link is on its way.');
    } catch {
      // authError surfaces the failure message.
    }
  };

  return (
    <div className="mx-auto grid max-w-md gap-4 py-6">
      <div className="text-center">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink">
          Sign in to <span className="brand-gradient">Mwell Intra</span>
        </h1>
        <p className="mt-1 text-sm text-muted">
          {mode === 'supabase'
            ? 'Use your Mwell email and password.'
            : 'Demo mode — pick a profile below or use its email.'}
        </p>
      </div>

      <Card>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@mwell.com"
              required
            />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'memory' ? 'any value in demo mode' : '••••••••'}
            />
          </Field>

          {authError && (
            <p className="text-sm font-medium text-rose-600 dark:text-rose-300" role="alert">
              {authError}
            </p>
          )}
          {notice && (
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300" role="status">
              {notice}
            </p>
          )}

          <Button type="submit" disabled={signingIn} className="w-full">
            <Icon name="lock" className="h-4 w-4" />
            {signingIn ? 'Signing in…' : 'Sign in'}
          </Button>

          {mode === 'supabase' && (
            <button
              type="button"
              onClick={() => void onReset()}
              className="text-center text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
            >
              Forgot your password?
            </button>
          )}
        </form>
      </Card>

      {mode === 'memory' && memoryProfiles.length > 0 && (
        <Card>
          <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-wide text-faint">
            Demo profiles
          </p>
          <ul className="grid gap-1.5">
            {memoryProfiles.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setEmail(p.email);
                    setPassword('demo');
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl bg-inset px-3 py-2.5 text-left transition hover:bg-line"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {p.name ?? p.email}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {p.title ?? p.email}
                    </span>
                  </span>
                  <Icon name="arrowRight" className="h-4 w-4 shrink-0 text-faint" />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="text-center text-xs text-faint">
        <Link href="/" className="hover:underline">
          Back to home
        </Link>
      </p>
    </div>
  );
}
