import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MemoryProfile } from './contracts';
import { SessionProvider, useSession } from './SessionProvider';
import { Guard, useCan } from './Guard';

// logistics_supervisor grants `receive_stock` (not `reserve_allocate`);
// business_unit grants `reserve_allocate` (not `receive_stock`).
const PROFILES: MemoryProfile[] = [
  {
    id: 'sup',
    email: 'sup@mwell.test',
    kind: 'employee',
    roles: { warehouse: ['logistics_supervisor'] },
  },
  {
    id: 'bu',
    email: 'bu@mwell.test',
    kind: 'employee',
    roles: { warehouse: ['business_unit'] },
  },
];

/** Signs in as `email` on mount and renders the resolved email once ready. */
function SignInOnMount({ email }: { email: string }) {
  const { signInWithPassword, profile } = useSession();
  useEffect(() => {
    void signInWithPassword(email, 'demo');
  }, [signInWithPassword, email]);
  return <span data-testid="who">{profile?.email ?? 'anon'}</span>;
}

function CanProbe({
  cap,
}: {
  cap: 'receive_stock' | 'reserve_allocate';
}) {
  const allowed = useCan('warehouse', cap);
  return <span data-testid="probe">{allowed ? 'yes' : 'no'}</span>;
}

describe('<Guard>', () => {
  it('denies (renders accessible fallback) when the session has no roles', () => {
    render(
      <SessionProvider config={{ mode: 'memory', profiles: PROFILES }}>
        <Guard module="warehouse" cap="receive_stock">
          <div>secret content</div>
        </Guard>
      </SessionProvider>,
    );
    expect(screen.queryByText('secret content')).toBeNull();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Access denied');
  });

  it('renders children once a role granting the capability is present', async () => {
    render(
      <SessionProvider config={{ mode: 'memory', profiles: PROFILES }}>
        <SignInOnMount email="sup@mwell.test" />
        <Guard module="warehouse" cap="receive_stock">
          <div>secret content</div>
        </Guard>
      </SessionProvider>,
    );
    await screen.findByText('sup@mwell.test');
    expect(screen.queryByText('secret content')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stays scoped: a role without the capability is denied', async () => {
    render(
      <SessionProvider config={{ mode: 'memory', profiles: PROFILES }}>
        <SignInOnMount email="bu@mwell.test" />
        <Guard module="warehouse" cap="receive_stock">
          <div>secret content</div>
        </Guard>
      </SessionProvider>,
    );
    await screen.findByText('bu@mwell.test');
    expect(screen.queryByText('secret content')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Access denied');
  });

  it('renders a custom fallback when provided', () => {
    render(
      <SessionProvider config={{ mode: 'memory', profiles: PROFILES }}>
        <Guard
          module="warehouse"
          cap="receive_stock"
          fallback={<div>please request access</div>}
        >
          <div>secret content</div>
        </Guard>
      </SessionProvider>,
    );
    expect(screen.queryByText('secret content')).toBeNull();
    expect(screen.queryByText('please request access')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('useCan', () => {
  it('reflects the scoped capability of the signed-in roles', async () => {
    render(
      <SessionProvider config={{ mode: 'memory', profiles: PROFILES }}>
        <SignInOnMount email="bu@mwell.test" />
        <CanProbe cap="reserve_allocate" />
      </SessionProvider>,
    );
    await screen.findByText('bu@mwell.test');
    expect(screen.getByTestId('probe').textContent).toBe('yes');
  });

  it('returns false for a capability the roles do not grant', async () => {
    render(
      <SessionProvider config={{ mode: 'memory', profiles: PROFILES }}>
        <SignInOnMount email="bu@mwell.test" />
        <CanProbe cap="receive_stock" />
      </SessionProvider>,
    );
    await screen.findByText('bu@mwell.test');
    expect(screen.getByTestId('probe').textContent).toBe('no');
  });
});
