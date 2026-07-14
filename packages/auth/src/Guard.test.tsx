import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { MemoryProfile } from './contracts';
import { SessionProvider, useSession } from './SessionProvider';
import { Guard, useCan } from './Guard';

beforeEach(() => {
  // The provider persists the memory-mode session per tab; make sure each test
  // starts signed out so the previous test's session doesn't leak in.
  window.sessionStorage.clear();
});

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

function LiveSessionProbe() {
  const { profile, userCapabilities } = useSession();
  const canReceive = useCan('warehouse', 'receive_stock');
  const canReserve = useCan('warehouse', 'reserve_allocate');
  return (
    <div>
      <span data-testid="live-user">{profile?.email ?? 'anon'}</span>
      <span data-testid="live-capabilities">
        {userCapabilities?.warehouse?.join(',') ?? 'none'}
      </span>
      <span data-testid="live-receive">{canReceive ? 'yes' : 'no'}</span>
      <span data-testid="live-reserve">{canReserve ? 'yes' : 'no'}</span>
    </div>
  );
}

function liveClient() {
  const user = {
    id: 'live-user',
    email: 'live@mwell.test',
    app_metadata: { roles: { warehouse: ['business_unit'] } },
    user_metadata: {},
  } as unknown as User;
  const session = { user } as Session;
  const rpc = vi.fn().mockResolvedValue({
    data: { warehouse: ['receive_stock'] },
    error: null,
  });
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session } }),
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    schema: vi.fn().mockReturnValue({ rpc }),
  } as unknown as SupabaseClient<Record<string, unknown>, string>;
  return { client, rpc };
}

describe('<Guard>', () => {
  it('denies (renders accessible fallback) when the session has no roles', async () => {
    render(
      <SessionProvider config={{ mode: 'memory', profiles: PROFILES }}>
        <Guard module="warehouse" cap="receive_stock">
          <div>secret content</div>
        </Guard>
      </SessionProvider>,
    );
    // Guard renders null while the session is restoring; wait for the fallback.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Access denied');
    expect(alert.textContent).toContain('Back to dashboard');
    expect(screen.queryByText('secret content')).toBeNull();
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

  it('renders a custom fallback when provided', async () => {
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
    await screen.findByText('please request access');
    expect(screen.queryByText('secret content')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('useCan', () => {
  it('uses the verified live my_capabilities snapshot in Supabase mode', async () => {
    const { client, rpc } = liveClient();
    render(
      <SessionProvider config={{ mode: 'supabase', client }}>
        <LiveSessionProbe />
      </SessionProvider>,
    );

    await screen.findByText('live@mwell.test');
    expect(rpc).toHaveBeenCalledWith('my_capabilities');
    expect(screen.getByTestId('live-capabilities').textContent).toBe(
      'receive_stock',
    );
    expect(screen.getByTestId('live-receive').textContent).toBe('yes');
    expect(screen.getByTestId('live-reserve').textContent).toBe('no');
  });

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
