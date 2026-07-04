import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '@/auth/session';
import { Logo } from '@/components/Logo';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PageHeader } from '@/components/ui';

/**
 * Reached either by clicking the password-reset email (Supabase deposits a
 * recovery session via the URL hash, detected by the client) or by navigating
 * here directly while signed in. Lets the user set a new password, then returns
 * them to the app.
 */
export function ResetPasswordPage() {
  const { changePassword, logout, mode } = useSession();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'memory') {
      setError('Password reset is unavailable in demo mode.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      await changePassword(password);
      setDone(true);
    } catch (e2) {
      setError(e2 instanceof Error ? e2.message : 'Could not update password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-app">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-10 sm:px-6">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo className="mb-3 h-8 w-auto" />
          <PageHeader
            title="Set a new password"
            subtitle="Choose a new password for your warehouse account."
          />
        </div>

        {done ? (
          <div className="space-y-4">
            <p className="rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-200">
              Your password was updated. You can now sign in with it.
            </p>
            <button
              type="button"
              className="btn-primary w-full justify-center"
              onClick={async () => {
                await logout();
                navigate('/');
              }}
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="reset-password" className="label">
                New password
              </label>
              <input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={saving}
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <label htmlFor="reset-confirm" className="label">
                Confirm password
              </label>
              <input
                id="reset-confirm"
                type="password"
                autoComplete="new-password"
                className="input"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={saving}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="btn-primary w-full justify-center"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
