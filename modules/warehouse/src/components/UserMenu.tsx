import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Role } from '@/domain/types';
import { useWarehouse } from '@/app/store';
import { useSession } from '@/auth/session';
import { ROLES } from '@/auth/roles';
import { Sheet } from './ui';
import { Icon } from './Icon';
import { useToast } from './ui';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Header account button: shows the signed-in profile and offers sign-out. */
export function UserMenu() {
  const { role, setRole } = useWarehouse();
  const { profile, logout, mode, changePassword, userRoles } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  const name = profile?.name ?? ROLES[role].label;
  const roleLabel = ROLES[role].label;
  const canChangePassword = mode === 'supabase';
  // In demo/memory mode a user may hold several warehouse roles; let them switch
  // between the roles their session actually carries. In supabase mode the role
  // is authoritative from the JWT, so no in-app switching is offered.
  const switchableRoles = (userRoles.warehouse ?? []) as Role[];
  const canSwitchRole = mode === 'memory' && switchableRoles.length > 1;

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    // Return to the sign-in screen from wherever the user was, so the app never
    // appears "still logged in" on a protected route after sign-out.
    navigate('/', { replace: true });
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (pw.length < 8) {
      setPwError('Password must be at least 8 characters.');
      return;
    }
    if (pw !== confirm) {
      setPwError('Passwords do not match.');
      return;
    }
    setPwSaving(true);
    try {
      await changePassword(pw);
      toast.success('Password updated.');
      setPwOpen(false);
      setPw('');
      setConfirm('');
    } catch (e2) {
      setPwError(e2 instanceof Error ? e2.message : 'Could not update password.');
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Account"
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 text-left transition hover:bg-inset sm:pr-3"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-grad text-xs font-bold text-white">
          {initials(name)}
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-sm font-semibold leading-tight text-ink">
            {name}
          </span>
          <span className="block truncate text-xs leading-tight text-faint">
            {roleLabel}
          </span>
        </span>
        <Icon name="chevron" className="hidden h-4 w-4 rotate-90 text-faint sm:block" />
      </button>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Account"
        side="right"
        footer={
          <button
            type="button"
            className="btn-outline w-full justify-center"
            onClick={() => void handleLogout()}
          >
            <Icon name="logout" className="h-4 w-4" /> Log out
          </button>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-grad text-base font-bold text-white">
              {initials(name)}
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold text-ink">{name}</p>
              {profile?.email && (
                <p className="truncate text-xs text-faint">{profile.email}</p>
              )}
            </div>
          </div>
          <div className="rounded-xl bg-inset p-3">
            <p className="text-xs uppercase tracking-wide text-faint">Active role</p>
            <p className="mt-0.5 text-sm font-semibold text-ink">{roleLabel}</p>
            <p className="mt-1 text-xs text-muted">{ROLES[role].description}</p>
          </div>

          {canSwitchRole && (
            <div className="rounded-xl bg-inset p-3">
              <p className="text-xs uppercase tracking-wide text-faint">
                Switch role
              </p>
              <div className="mt-2 grid gap-1.5">
                {switchableRoles.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setRole(r);
                      setOpen(false);
                    }}
                    aria-pressed={r === role}
                    className={`flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${
                      r === role
                        ? 'bg-brand-grad font-semibold text-white'
                        : 'bg-surface text-ink hover:bg-line/40'
                    }`}
                  >
                    <span>{ROLES[r].label}</span>
                    {r === role && <Icon name="check" className="h-4 w-4" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {canChangePassword && !pwOpen && (
            <button
              type="button"
              className="btn-ghost w-full justify-center"
              onClick={() => setPwOpen(true)}
            >
              <Icon name="rotate" className="h-4 w-4" /> Change password
            </button>
          )}

          {pwOpen && (
            <form onSubmit={submitPassword} className="space-y-3 rounded-xl bg-inset p-3">
              <p className="text-sm font-semibold text-ink">Change password</p>
              <div>
                <label htmlFor="um-pw" className="label">New password</label>
                <input
                  id="um-pw"
                  type="password"
                  autoComplete="new-password"
                  className="input"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  disabled={pwSaving}
                  placeholder="At least 8 characters"
                />
              </div>
              <div>
                <label htmlFor="um-pw-confirm" className="label">Confirm</label>
                <input
                  id="um-pw-confirm"
                  type="password"
                  autoComplete="new-password"
                  className="input"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={pwSaving}
                />
              </div>
              {pwError && (
                <p role="alert" className="text-xs text-rose-600 dark:text-rose-300">
                  {pwError}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="btn-primary flex-1 justify-center"
                  disabled={pwSaving}
                >
                  {pwSaving ? 'Saving…' : 'Update'}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setPwOpen(false);
                    setPw('');
                    setConfirm('');
                    setPwError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          <p className="text-xs text-faint">
            Signing out returns you to the sign-in screen.
          </p>
        </div>
      </Sheet>
    </>
  );
}
