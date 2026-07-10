import type { ReactNode } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { render, screen } from '@testing-library/react';
import { SessionProvider } from '@intra/auth';
import { ToastProvider } from '@intra/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const providerProps = vi.hoisted(() => vi.fn());

vi.mock('@/app/store', () => ({
  WarehouseProvider: (props: {
    children: ReactNode;
    source?: string;
    supabaseClient?: SupabaseClient;
  }) => {
    providerProps(props);
    return <div data-testid="warehouse-provider">warehouse live</div>;
  },
}));

vi.mock('@/app/App', () => ({ App: () => null }));
vi.mock('@/components/PwaPrompts', () => ({ PwaPrompts: () => null }));

import { WarehouseApp } from './WarehouseApp';

function makeLiveClient(): SupabaseClient<Record<string, unknown>, string> {
  const user = {
    id: 'warehouse-user',
    email: 'warehouse@mwell.com.ph',
    app_metadata: { roles: { warehouse: ['logistics_supervisor'] } },
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
      expect.objectContaining({ source: 'supabase', supabaseClient: client }),
    );
  });
});
