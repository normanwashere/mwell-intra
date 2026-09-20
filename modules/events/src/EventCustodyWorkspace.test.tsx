import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { EventCustodyWorkspace } from './EventCustodyWorkspace';
const state = vi.hoisted(() => ({ rpc: vi.fn(), session: {} as Record<string, unknown> }));
vi.mock('@intra/auth', () => ({ useSession: () => state.session }));
const allocation = { allocation_id: 'a1', product_id: 'Watch', serialized: true, issued_units: 1, returned_units: 0,
  sold_units: 0, giveaway_units: 0, remaining_units: 1, eligible_serials: ['S1'] };
const ledger = () => ({ enabled: true, may_configure: false, event_status: 'active', allocations: [allocation], entries: [], sellers: [],
  totals: { sold_units: 0, giveaway_units: 0, gross_sales_amount: 0 }, next_offset: null });
beforeEach(() => {
  state.rpc.mockReset();
  state.rpc.mockImplementation(async (name: string) => ({ data: name === 'event_custody_ledger' ? ledger() : { id: 'entry-1' }, error: null }));
  state.session = { profile: { id: 'seller-1' }, mode: 'supabase', supabaseClient: { schema: () => ({ rpc: state.rpc }) },
    userRoles: { events: ['seller'] }, userCapabilities: { events: ['view_event_custody', 'record_event_outcome'] } };
});
it('records exact selected custody without a warehouse issue and retries an uncertain write with the same key', async () => {
  let attempts = 0;
  state.rpc.mockImplementation(async (name: string) => ({ data: name === 'event_custody_ledger' ? ledger() : { id: 'entry-1' },
    error: name === 'record_event_outcome' && attempts++ === 0 ? { message: 'Connection interrupted' } : null }));
  render(<EventCustodyWorkspace eventId="event-1" />);
  await screen.findByLabelText('Issued allocation');
  fireEvent.change(screen.getByLabelText('Issued allocation'), { target: { value: 'a1' } });
  fireEvent.click(screen.getByLabelText('S1'));
  fireEvent.change(screen.getByLabelText('Total sales amount (PHP)'), { target: { value: '125' } });
  fireEvent.change(screen.getByLabelText('External reference'), { target: { value: 'SALE-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record outcome' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Record outcome' }));
  await waitFor(() => expect(state.rpc.mock.calls.filter(([name]) => name === 'record_event_outcome')).toHaveLength(2));
  const writes = state.rpc.mock.calls.filter(([name]) => name === 'record_event_outcome');
  expect(writes[0]![1]).toEqual(writes[1]![1]);
  expect(writes[0]![1].payload).toMatchObject({ event_id: 'event-1', allocation_id: 'a1', quantity: 1, serial_numbers: ['S1'], amount: 125 });
  expect(writes[0]![1].payload).not.toHaveProperty('seller_id');
  expect(state.rpc.mock.calls.every(([name]) => ['event_custody_ledger','record_event_outcome'].includes(name))).toBe(true);
});
it('does not turn a serialized allocation with no eligible serials into a bulk-quantity sale', async () => {
  state.rpc.mockResolvedValue({ data: { ...ledger(), allocations: [{ ...allocation, eligible_serials: [] }] }, error: null });
  render(<EventCustodyWorkspace eventId="event-1" />);
  await screen.findByLabelText('Issued allocation');
  fireEvent.change(screen.getByLabelText('Issued allocation'), { target: { value: 'a1' } });
  expect(screen.queryByLabelText('Quantity')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Record outcome' })).toBeDisabled();
});
it('keeps owner activation disabled until explicit schema capability and learning readiness is confirmed', async () => {
  state.session = { ...state.session, userRoles: { events: ['coordinator'] }, userCapabilities: { events: ['manage_events'] } };
  state.rpc.mockResolvedValue({ data: { ...ledger(), enabled: false, may_configure: true,
    readiness: { ready: false, schema: true, capabilities: true, learning: false } }, error: null });
  render(<EventCustodyWorkspace eventId="event-1" />);
  expect(await screen.findByRole('button', { name: 'Enable prospective custody' })).toBeDisabled();
  expect(screen.getByLabelText('Custody rollout prerequisites')).toHaveTextContent('Learning publication: pending');
});
