import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionValue } from '@intra/auth';
import { FINANCE_DEMO_DATA } from './seed';
import type { FinanceData } from './types';

const state = vi.hoisted(() => ({
  session: null as unknown as SessionValue,
  data: null as unknown as {
    data: FinanceData;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
  },
}));

vi.mock('@intra/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@intra/auth')>();
  return { ...actual, useSession: () => state.session };
});

vi.mock('./data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./data')>();
  return { ...actual, useFinanceData: () => state.data };
});

import { FinanceApp } from './FinanceApp';

function session(roles: SessionValue['userRoles']): SessionValue {
  return {
    profile: {
      id: 'finance-user',
      email: 'finance@mwell.demo',
      kind: 'employee',
      name: 'Rina Domingo',
      title: 'Finance Manager',
    },
    userRoles: roles,
    mode: 'memory',
    supabaseClient: null,
    loading: false,
    signingIn: false,
    authError: null,
    memoryProfiles: [],
    signInWithPassword: vi.fn(async () => true),
    signOut: vi.fn(async () => undefined),
    resetPassword: vi.fn(async () => undefined),
    changePassword: vi.fn(async () => undefined),
  };
}

describe('FinanceApp', () => {
  beforeEach(() => {
    state.session = session({
      core: ['staff'],
      warehouse: ['finance'],
      procurement: ['finance'],
    });
    state.data = {
      data: FINANCE_DEMO_DATA,
      loading: false,
      error: null,
      refresh: vi.fn(async () => undefined),
    };
  });

  it('shows one unified workspace for a dual-role Finance user', () => {
    render(<FinanceApp />);
    expect(screen.getByText('Warehouse Finance')).toBeInTheDocument();
    expect(screen.getByText('Procurement Finance')).toBeInTheDocument();
    expect(screen.getByText('Payment readiness')).toBeInTheDocument();
    expect(screen.getByText('Cross-module activity')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /review next payment pack/i }),
    ).toHaveAttribute('href', '/procurement/purchase-orders/po-demo-1042');
  });

  it('admits Procurement Finance without inventing Warehouse access', () => {
    state.session = session({ core: ['staff'], procurement: ['finance'] });
    render(<FinanceApp />);
    expect(screen.getByText('Procurement Finance')).toBeInTheDocument();
    expect(screen.queryByText('Warehouse Finance')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /cycle-count variances/i })).not.toBeInTheDocument();
  });

  it('keeps a Warehouse-only Finance user in Warehouse-owned workflows', () => {
    state.session = session({ core: ['staff'], warehouse: ['finance'] });
    state.data = {
      ...state.data,
      data: {
        ...FINANCE_DEMO_DATA,
        payments: [],
        activity: FINANCE_DEMO_DATA.activity.filter(
          (item) => item.source !== 'procurement_po',
        ),
      },
    };
    render(<FinanceApp />);
    expect(screen.getByRole('link', { name: /review inventory value/i })).toHaveAttribute(
      'href',
      '/warehouse/inventory',
    );
    expect(screen.queryByRole('link', { name: /open purchase orders/i })).not.toBeInTheDocument();
  });

  it('shows an explicit denial for unrelated roles', () => {
    state.session = session({ core: ['staff'], procurement: ['requester'] });
    render(<FinanceApp />);
    expect(screen.getByRole('heading', { name: 'No Finance access' })).toBeInTheDocument();
  });

  it('preserves valid data when one live source reports a warning', () => {
    state.data = {
      ...state.data,
      error: 'Inventory valuation: source unavailable',
    };
    render(<FinanceApp />);
    expect(screen.getByText(/some Finance sources are unavailable/i)).toBeInTheDocument();
    expect(screen.getAllByText('PO-2026-1042')).toHaveLength(2);
  });
});
