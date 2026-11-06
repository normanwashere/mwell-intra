import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EventCustodyWorkspace } from './EventCustodyWorkspace';

const state = vi.hoisted(() => ({ rpc: vi.fn(), session: {} as Record<string, unknown> }));
vi.mock('@intra/auth', () => ({ useSession: () => state.session }));
const entry = (id: string, archived: boolean) => ({ id, allocation_id: id, kind: 'sale', seller_id: 'seller-1', quantity: 1,
  amount: 10, external_reference: id, serial_numbers: [], created_at: '2026-11-06T17:00:00Z', archived_source: archived });
const ledger = () => ({ enabled: true, may_configure: false, event_status: 'active', allocations: [],
  entries: [entry('ARCHIVED-SALE', true), entry('ACTIVE-SALE', false)], archived_allocation_count: 1, sellers: [],
  totals: { sold_units: 2, giveaway_units: 0, gross_sales_amount: 20 }, next_offset: null });
beforeEach(() => {
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ data: ledger(), error: null });
  state.session = { profile: { id: 'seller-1' }, mode: 'supabase', supabaseClient: { schema: () => ({ rpc: state.rpc }) },
    userRoles: { events: ['seller'] }, userCapabilities: { events: ['view_event_custody', 'record_event_outcome'] } };
});
it('keeps archived history and totals without an archived Reverse action', async () => {
  render(<EventCustodyWorkspace eventId="event-1" />);
  const archived = (await screen.findByText('ARCHIVED-SALE')).closest('li')!;
  expect(within(archived).queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
  expect(within(archived).getByText('Archived test custody')).toBeInTheDocument();
  expect(screen.getByLabelText('Recorded outcome totals')).toHaveTextContent('20.00');
  const active = screen.getByText('ACTIVE-SALE').closest('li')!;
  fireEvent.click(within(active).getByRole('button', { name: 'Reverse' }));
  expect(screen.getByRole('button', { name: 'Record reversal' })).toBeEnabled();
});
it('does not tell a seller to release archived stock again', async () => {
  render(<EventCustodyWorkspace eventId="event-1" />);
  expect(await screen.findByText('No active allocations.')).toBeInTheDocument();
  expect(screen.getByText('Archived test custody remains in history and cannot record new outcomes.')).toBeInTheDocument();
  expect(screen.queryByText(/Warehouse must release the stock/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Record outcome' })).toBeDisabled();
  expect(state.rpc.mock.calls.every(([name]) => name === 'event_custody_ledger')).toBe(true);
});
it('clears a selected reversal when a fresh ledger marks that entry archived', async () => {
  let archived = false;
  state.rpc.mockImplementation(async (name: string) => {
    if (name === 'record_event_outcome') {
      archived = true;
      return { data: null, error: { message: 'This is archived UAT event custody.' } };
    }
    return { data: { ...ledger(), entries: [entry('ACTIVE-SALE', archived)] }, error: null };
  });
  render(<EventCustodyWorkspace eventId="event-1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reverse' }));
  fireEvent.change(screen.getByLabelText('External reference'), { target: { value: 'CORRECTION' } });
  fireEvent.change(screen.getByLabelText('Correction reason'), { target: { value: 'Correction' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record reversal' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry read' }));
  await screen.findByText('Archived test custody');
  expect(screen.queryByRole('button', { name: 'Record reversal' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
  expect(state.rpc.mock.calls.filter(([name]) => name === 'record_event_outcome')).toHaveLength(1);
});
