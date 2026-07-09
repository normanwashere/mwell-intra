'use client';

// Password reset landing (spec §5). Supabase redirects here after a reset email
// (SessionProvider `resetRedirectPath`). Minimal stub: set a new password via
// useSession().changePassword. Fuller recovery UX can arrive later.

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import * as m from 'framer-motion/m';
import { Button, Card, Field, HeroStat, Icon, Input } from '@intra/ui';
import { useSession } from '@intra/auth';
import { MwellIntraLogo } from '@shell/components/MwellIntraLogo';

export default function ResetPasswordPage() {
  const { mode, changePassword } = useSession();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await changePassword(password);
      setDone(true);
      setTimeout(() => router.replace('/'), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-[calc(100dvh-2rem)] flex-col items-center justify-center px-4 py-8">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-brand-500/8 blur-3xl" />
        <div className="absolute -right-16 bottom-0 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
      </div>

      <m.div
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md space-y-4"
      >
        <div className="hero-surface relative overflow-hidden rounded-3xl p-6 text-center">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-3xl bg-gradient-to-b from-brand-500 to-brand-700"
          />
          <MwellIntraLogo
            className="justify-center"
            logoClassName="text-2xl"
            labelClassName="text-[0.68rem]"
          />
          <h1 className="mt-1 font-display text-display text-ink">Set a new password</h1>
          <p className="mt-1.5 text-sm text-muted">
            Choose a strong password of at least 8 characters.
          </p>
          <div className="mt-4 flex justify-center">
            <HeroStat label="Security">
              <Icon name="lock" className="mx-auto h-6 w-6 text-brand-600" />
            </HeroStat>
          </div>
        </div>

        <Card>
          {mode === 'memory' ? (
            <p className="text-sm text-muted" role="status">
              Password reset isn&apos;t available in demo mode.{' '}
              <Link href="/login" className="font-medium text-brand-700 hover:underline dark:text-brand-300">
                Back to sign in
              </Link>
              .
            </p>
          ) : done ? (
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300" role="status">
              <Icon name="check" className="h-4 w-4" /> Password updated. Redirecting…
            </p>
          ) : (
            <form method="post" onSubmit={onSubmit} className="grid gap-4">
              <Field label="New password" htmlFor="password">
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
              <Field label="Confirm password" htmlFor="confirm">
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </Field>
              {error && (
                <p className="text-sm font-medium text-rose-600 dark:text-rose-300" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={!hydrated || busy} className="w-full">
                {!hydrated ? 'Preparing…' : busy ? 'Updating…' : 'Update password'}
              </Button>
            </form>
          )}
        </Card>

        <p className="text-center text-xs text-faint">
          <Link href="/login" className="inline-flex min-h-11 items-center justify-center hover:underline">
            Back to sign in
          </Link>
        </p>
      </m.div>
    </main>
  );
}
