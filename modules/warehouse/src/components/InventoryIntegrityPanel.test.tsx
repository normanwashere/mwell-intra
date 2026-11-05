import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui';
import { InventoryIntegrityPanel } from './InventoryIntegrityPanel';

const query = vi.hoisted(() => ({ limit: vi.fn() }));
vi.mock('@intra/auth', async importOriginal => ({ ...await importOriginal<typeof import('@intra/auth')>(),
  useSession: () => ({ mode: 'supabase', supabaseClient: client }),
}));
const client = { schema: () => ({ from: () => ({ select: () => ({ order: () => query }) }) }) };
const mount = () => render(<ToastProvider><InventoryIntegrityPanel products={[]} canManage canApprove /></ToastProvider>);

describe('inventory integrity queue priority', () => {
  beforeEach(() => { query.limit.mockReset(); });
  it('uses a compact empty summary instead of a second empty-state panel', async () => {
    query.limit.mockResolvedValue({ data: [], error: null });
    mount();
    expect(await screen.findByText('No integrity exceptions')).toBeVisible();
    expect(screen.getByText('No integrity exceptions').tagName).toBe('P');
    expect(screen.queryByText(/Counts, expiry, recalls/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open case' })).toBeVisible();
  });
  it('never labels a pending or failed read as an empty queue', async () => {
    let finish!: (result: unknown) => void;
    query.limit.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    mount();
    expect(screen.queryByText('No integrity exceptions')).not.toBeInTheDocument();
    await waitFor(() => expect(query.limit).toHaveBeenCalled());
    finish({ data: null, error: { message: 'Not available' } });
    expect(await screen.findByText(/Integrity cases could not be loaded/)).toBeVisible();
    expect(screen.queryByText('No integrity exceptions')).not.toBeInTheDocument();
  });
  it('keeps an active critical containment action visible', async () => {
    query.limit.mockResolvedValue({ data: [{ id: 'recall-1', case_type: 'recall', status: 'open', severity: 'critical', reason: 'Recall needs containment' }], error: null });
    mount();
    expect(await screen.findByText('Recall needs containment')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Contain' })).toBeVisible();
  });
});
