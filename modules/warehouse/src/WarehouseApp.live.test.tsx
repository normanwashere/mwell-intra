import type { ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SessionProvider, useSession } from '@intra/auth';
import { ToastProvider } from '@intra/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const providerProps = vi.hoisted(() => vi.fn());

vi.mock('@/app/store', () => ({
  WarehouseProvider: (props: {
    children: ReactNode;
    source?: string;
    supabaseClient?: SupabaseClient;
    capabilities?: readonly string[];
    roleCode?: string;
  }) => {
    providerProps(props);
    return <div data-testid="warehouse-provider">warehouse live<input aria-label="Warehouse draft" /></div>;
  },
}));

vi.mock('@/app/App', () => ({ App: () => null }));
vi.mock('@/components/PwaPrompts', () => ({ PwaPrompts: () => null }));

import { WarehouseApp } from './WarehouseApp';

function RefreshAccess() {
  const { refreshCapabilities } = useSession();
  return <button onClick={() => void refreshCapabilities()}>Refresh access</button>;
}

function makeLiveClient({
  roles = ['logistics_supervisor'],
  capabilities = ['receive_stock'],
}: {
  roles?: string[];
  capabilities?: string[];
} = {}): SupabaseClient<Record<string, unknown>, string> {
  const user = {
    id: 'warehouse-user',
    email: 'warehouse@mwell.com.ph',
    app_metadata: { roles: { warehouse: roles } },
    user_metadata: { full_name: 'Warehouse User' },
    aud: 'authenticated',
    created_at: '2026-07-10T00:00:00.000Z',
  };
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user, access_token: 'token' } },
        error: null,
      }),
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    schema: vi.fn().mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: {
          roleCapabilities: { warehouse: capabilities },
          userCapabilities: { warehouse: capabilities },
        },
        error: null,
      }),
    }),
  } as unknown as SupabaseClient<Record<string, unknown>, string>;
}

describe('WarehouseApp live repository wiring', () => {
  beforeEach(() => {
    providerProps.mockClear();
    window.history.replaceState(window.history.state, '', '/warehouse/');
  });

  it('passes the authenticated Supabase client and live source to WarehouseProvider', async () => {
    const client = makeLiveClient();
    render(
      <SessionProvider config={{ mode: 'supabase', client }}>
        <ToastProvider>
          <WarehouseApp basename="/warehouse" />
        </ToastProvider>
      </SessionProvider>,
    );

    await screen.findByTestId('warehouse-provider');
    expect(providerProps).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'supabase',
        supabaseClient: client,
        capabilities: ['receive_stock'],
      }),
    );
  });

  it('admits an unknown runtime bundle only through its live capabilities', async () => {
    const client = makeLiveClient({
      roles: ['night_shift_receiving'],
      capabilities: ['view_dashboard', 'receive_stock'],
    });
    render(
      <SessionProvider config={{ mode: 'supabase', client }}>
        <ToastProvider>
          <WarehouseApp basename="/warehouse" />
        </ToastProvider>
      </SessionProvider>,
    );

    await screen.findByTestId('warehouse-provider');
    expect(providerProps).toHaveBeenCalledWith(
      expect.objectContaining({
        roleCode: 'night_shift_receiving',
        capabilities: ['view_dashboard', 'receive_stock'],
      }),
    );
  });

  it.each(['SIGNED_IN', 'TOKEN_REFRESHED'] as const)('shows bounded checking rather than denial after same-user %s and preserves the deep link', async (event) => {
    const client = makeLiveClient();
    window.history.replaceState({}, '', '/warehouse/inventory/product-101?view=stock#detail');
    render(<SessionProvider config={{ mode: 'supabase', client }}><WarehouseApp /></SessionProvider>);
    await screen.findByTestId('warehouse-provider');
    const rpc = vi.mocked(client.schema('core').rpc);
    let resolveFocus!: (value: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise(done => { resolveFocus = done; }) as never);
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    let resolve!: (value: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise(done => { resolve = done; }) as never);
    const { data } = await client.auth.getSession();
    act(() => { vi.mocked(client.auth.onAuthStateChange).mock.calls[0]![0](event, data.session); });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(3));
    expect(screen.queryByText('No warehouse access')).not.toBeInTheDocument();
    expect(screen.getByText('Checking warehouse access')).toBeInTheDocument();
    expect(screen.queryByTestId('warehouse-provider')).not.toBeInTheDocument();
    const dashboard = screen.getByRole('link', { name: 'Back to dashboard' });
    expect(dashboard).toHaveAttribute('href', '/');
    expect(dashboard).toHaveClass('min-h-11', 'min-w-11', 'focus-visible:outline-2', 'focus-visible:outline-offset-2');
    dashboard.focus();
    expect(dashboard).toHaveFocus();
    await act(async () => resolve({ data: { roleCapabilities: { warehouse: ['receive_stock'] }, userCapabilities: { warehouse: ['receive_stock'] } }, error: null }));
    expect(screen.getByTestId('warehouse-provider')).toBeInTheDocument();
    await act(async () => resolveFocus({ data: null, error: { message: 'stale focus response' } }));
    expect(screen.getByTestId('warehouse-provider')).toBeInTheDocument();
    expect(screen.queryByText('Could not verify warehouse access')).not.toBeInTheDocument();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/warehouse/inventory/product-101?view=stock#detail');
  });

  it.each(['rejected', 'malformed'] as const)('offers retry rather than role denial after a %s snapshot', async (failure) => {
    const client = makeLiveClient();
    render(<SessionProvider config={{ mode: 'supabase', client }}><WarehouseApp /></SessionProvider>);
    await screen.findByTestId('warehouse-provider');
    const rpc = vi.mocked(client.schema('core').rpc);
    if (failure === 'rejected') rpc.mockRejectedValueOnce(new Error('offline'));
    else rpc.mockResolvedValueOnce({ data: null, error: null } as never);
    act(() => window.dispatchEvent(new Event('focus')));
    await screen.findByText('Could not verify warehouse access');
    expect(screen.queryByText('No warehouse access')).not.toBeInTheDocument();
    expect(screen.queryByTestId('warehouse-provider')).not.toBeInTheDocument();
    const dashboard = screen.getByRole('link', { name: 'Back to dashboard' });
    expect(dashboard).toHaveAttribute('href', '/');
    expect(dashboard).toHaveClass('min-h-11', 'min-w-11', 'focus-visible:outline-2', 'focus-visible:outline-offset-2');
    dashboard.focus();
    expect(dashboard).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Retry access' }));
    await screen.findByTestId('warehouse-provider');
    expect(client.auth.getUser).toHaveBeenCalled();
  });

  it('keeps a successfully verified empty capability set denied, without offering a failed-check retry', async () => {
    const client = makeLiveClient({ capabilities: [] });
    render(<SessionProvider config={{ mode: 'supabase', client }}><WarehouseApp /></SessionProvider>);
    await screen.findByText('No warehouse access');
    expect(screen.queryByText('Could not verify warehouse access')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry access' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('warehouse-provider')).not.toBeInTheDocument();
  });

  it.each(['manual', 'focus'] as const)('retains the mounted draft during a successful ready-state %s refresh', async (trigger) => {
    const client = makeLiveClient();
    render(<SessionProvider config={{ mode: 'supabase', client }}><RefreshAccess /><WarehouseApp /></SessionProvider>);
    await screen.findByTestId('warehouse-provider');
    const draft = screen.getByRole('textbox', { name: 'Warehouse draft' });
    fireEvent.change(draft, { target: { value: 'unsent warehouse draft' } });
    const rpc = vi.mocked(client.schema('core').rpc);
    let resolve!: (value: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise(done => { resolve = done; }) as never);
    if (trigger === 'manual') fireEvent.click(screen.getByRole('button', { name: 'Refresh access' }));
    else act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Checking warehouse access')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Warehouse draft' })).toBe(draft);
    expect(draft).toHaveValue('unsent warehouse draft');
    expect(providerProps.mock.lastCall?.[0].capabilities).toEqual(['receive_stock']);
    await act(async () => resolve({ data: { roleCapabilities: { warehouse: ['receive_stock'] }, userCapabilities: { warehouse: ['receive_stock'] } }, error: null }));
    expect(screen.getByRole('textbox', { name: 'Warehouse draft' })).toBe(draft);
    expect(draft).toHaveValue('unsent warehouse draft');
  });
});
