import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { UnitCustodyHistory } from './UnitCustodyHistory';

const { rpc, session } = vi.hoisted(() => {
  const rpc = vi.fn();
  return { rpc, session: { mode: 'supabase', supabaseClient: { schema: vi.fn(() => ({ rpc })) } } };
});
vi.mock('@/auth/session', () => ({ useSession: () => session }));
const props = { unitId: 'unit-1', locationName: (id: string) => `Warehouse ${id}`, binName: (id?: string) => id ?? 'General area' };
const row = (id: number) => ({ id: String(id), unit_id: 'unit-1', operation: 'changed', recorded_at: '2026-11-05T01:00:00Z',
  before_state: { location_id: 'one', bin_id: 'A', status: 'in_stock' },
  after_state: { location_id: 'one', bin_id: 'B', status: 'in_stock' },
});
beforeEach(() => { rpc.mockReset(); session.mode = 'supabase'; });

describe('UnitCustodyHistory', () => {
  it('loads exact unit history and displays both custody locations', async () => {
    rpc.mockResolvedValue({ data: [row(1)], error: null });
    render(<UnitCustodyHistory {...props} />);
    expect(await screen.findByText('Custody updated')).toBeVisible();
    expect(rpc).toHaveBeenCalledWith('unit_custody_history', { p_unit_id: 'unit-1', p_before_id: null });
    expect(screen.getByText('From: In stock - Warehouse one / A')).toBeVisible();
    expect(screen.getByText('To: In stock - Warehouse one / B')).toBeVisible();
  });
  it('does not present an empty legacy history as proof of no movements', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    render(<UnitCustodyHistory {...props} />);
    expect(await screen.findByText(/Older product totals do not identify this serial/)).toBeVisible();
  });
  it('reports failed reads, retains the distinction from empty and permits retry', async () => {
    rpc.mockResolvedValueOnce({ error: { message: 'network' }, data: null }).mockResolvedValueOnce({ data: [row(1)], error: null });
    render(<UnitCustodyHistory {...props} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    expect(screen.queryByText(/No unit-specific custody changes/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Custody updated')).toBeVisible();
  });
  it('uses the last displayed row as cursor rather than skipping the extra fetched row', async () => {
    rpc.mockResolvedValueOnce({ data: Array.from({ length: 51 }, (_, i) => row(60 - i)), error: null })
      .mockResolvedValueOnce({ data: [row(10)], error: null });
    render(<UnitCustodyHistory {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Older custody changes' }));
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith('unit_custody_history', { p_unit_id: 'unit-1', p_before_id: '11' }));
    await waitFor(() => expect(screen.getAllByText('Custody updated')).toHaveLength(51));
    expect(screen.queryByRole('button', { name: 'Older custody changes' })).not.toBeInTheDocument();
  });
  it('ignores an old unit response after the selected unit changes', async () => {
    let complete!: (value: unknown) => void;
    rpc.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }))
      .mockResolvedValueOnce({ data: [], error: null });
    const view = render(<UnitCustodyHistory {...props} />);
    view.rerender(<UnitCustodyHistory {...props} unitId="unit-2" />);
    await screen.findByText(/Older product totals/);
    await act(async () => complete({ data: [row(1)], error: null }));
    expect(screen.queryByText('Custody updated')).not.toBeInTheDocument();
  });
  it('does not contact live services in a demo session', () => {
    session.mode = 'memory';
    render(<UnitCustodyHistory {...props} />);
    expect(rpc).not.toHaveBeenCalled();
  });
});
