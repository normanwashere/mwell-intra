'use client';

// Password reset landing (spec §5). Supabase redirects here after a reset email
// (SessionProvider `resetRedirectPath`). Minimal stub: set a new password via
// useSession().changePassword. Fuller recovery UX can arrive later.

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, Field, Icon, Input } from '@intra/ui';
import { useSession } from '@intra/auth';

export default function ResetPasswordPage() {
  const { mode, changePassword } = useSession();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

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
    <div className="mx-auto grid max-w-md gap-4 py-6">
      <div className="text-center">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink">
          Set a new password
        </h1>
        <p className="mt-1 text-sm text-muted">
          Choose a strong password of at least 8 characters.
        </p>
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
          <form onSubmit={onSubmit} className="grid gap-4">
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
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? 'Updating…' : 'Update password'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
