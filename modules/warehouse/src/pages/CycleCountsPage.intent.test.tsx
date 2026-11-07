import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CycleCountsPage } from './CycleCountsPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';
import { SupabaseRepository } from '@intra/data-kit';
import type { SupabaseClient } from '@supabase/supabase-js';

async function prepare(repo = makeRepo(), blind = true) {
  const user = userEvent.setup();
  const view = renderWithProviders(<CycleCountsPage />, { repo, role: 'warehouse_operator' });
  await user.selectOptions(await screen.findByLabelText('Location'), 'loc-wh');
  await screen.findByRole('heading', { name: 'Count sheet' });
  if (blind) await user.click(screen.getByRole('button', { name: 'Blind count' }));
  fireEvent.change(screen.getByLabelText(/Counted Event Shirt \(L\)/i), { target: { value: '100' } });
  await user.upload(screen.getByLabelText(/attach cycle-count evidence/i), new File(['synthetic'], 'count.jpg', { type: 'image/jpeg' }));
  await screen.findByRole('list', { name: /captured evidence/i });
  return { user, view, repo };
}

describe('cycle-count immutable submission', () => {
  it('unlocks only a server-confirmed PWC01 rollback, retaining observations and evidence for a new explicit submission', async () => {
    const repo = makeRepo();
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, status: 400,
      error: { code: 'PWC01', message: 'Receipt lots changed. Recheck each lot.' } })
      .mockImplementation(async (_name, args) => ({ data: { cycle_count: args.payload.cycle_count, requests: [] }, error: null, status: 200 }));
    const adapter = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
    const send = vi.spyOn(repo, 'createAndSubmitCycleCount').mockImplementation(input => adapter.createAndSubmitCycleCount(input));
    const { user } = await prepare(repo);
    await user.click(screen.getByRole('button', { name: /submit count/i }));
    await screen.findByText('Receipt lots changed. Recheck each lot.');
    const field = screen.getByLabelText(/Counted Event Shirt \(L\)/i);
    expect(field).toHaveValue(100);
    expect(field).toBeEnabled();
    expect(screen.getByLabelText('Location')).toBeEnabled();
    expect(screen.queryByRole('button', { name: /retry saved count/i })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Count not submitted. Receipt lots changed. Recheck each lot.');
    expect(screen.getByRole('list', { name: /captured evidence/i })).toBeInTheDocument();
    const first = structuredClone(send.mock.calls[0]![0]);
    fireEvent.change(field, { target: { value: '99' } });
    await user.click(screen.getByRole('button', { name: /submit count/i }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    const second = send.mock.calls[1]![0];
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(second.cycleCountId).not.toBe(first.cycleCountId);
    expect(second.evidenceUrls).toEqual(first.evidenceUrls);
    expect(second.lines).toEqual([{ productId: 'shirt-l', expected: 120, counted: 99 }]);
  });

  it('retains per-lot observations after a conclusive changed-lot rejection and requires the newly refreshed lot explicitly', async () => {
    const data = await makeRepo().getData();
    data.stockLevels = data.stockLevels.filter(row => row.productId !== 'shirt-l');
    data.stockLevels.push(
      { productId: 'shirt-l', locationId: 'loc-wh', lotId: 'lot-a', quantity: 2 },
      { productId: 'shirt-l', locationId: 'loc-wh', quantity: 0 },
    );
    const repo = makeRepo(data);
    vi.spyOn(repo, 'getData').mockImplementation(async () => structuredClone(data));
    const rpc = vi.fn().mockImplementationOnce(async () => {
      data.stockLevels.push({ productId: 'shirt-l', locationId: 'loc-wh', lotId: 'new-lot', quantity: 1 });
      return { data: null, status: 400, error: { code: 'PWC01', message: 'Lots changed. Count each current lot.' } };
    }).mockResolvedValue({ data: { requests: [] }, error: null, status: 200 });
    const adapter = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
    const send = vi.spyOn(repo, 'createAndSubmitCycleCount').mockImplementation(input => adapter.createAndSubmitCycleCount(input));
    const user = userEvent.setup();
    renderWithProviders(<CycleCountsPage />, { repo, role: 'warehouse_operator' });
    await user.selectOptions(await screen.findByLabelText('Location'), 'loc-wh');
    await screen.findByRole('heading', { name: 'Count sheet' });
    fireEvent.change(screen.getAllByLabelText('Event Shirt (L) lot lot-a counted')[0]!, { target: { value: '1' } });
    fireEvent.change(screen.getAllByLabelText('Event Shirt (L) lot Unlotted counted')[0]!, { target: { value: '0' } });
    await user.upload(screen.getByLabelText(/attach cycle-count evidence/i), new File(['synthetic'], 'lot.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('list', { name: /captured evidence/i });
    await user.click(screen.getByRole('button', { name: /submit count/i }));
    const newLot = (await screen.findAllByLabelText('Event Shirt (L) lot new-lot counted'))[0]!;
    expect(newLot).toBeEnabled();
    expect(newLot).toHaveValue(null);
    expect(screen.getAllByLabelText('Event Shirt (L) lot lot-a counted')[0]).toHaveValue(1);
    expect(screen.getAllByLabelText('Event Shirt (L) lot Unlotted counted')[0]).toHaveValue(0);
    expect(screen.getByRole('button', { name: /submit count/i })).toBeDisabled();
    fireEvent.change(newLot, { target: { value: '0' } });
    await user.click(screen.getByRole('button', { name: /submit count/i }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    const [first, second] = send.mock.calls.map(call => call[0]);
    expect(second!.idempotencyKey).not.toBe(first!.idempotencyKey);
    expect(second!.cycleCountId).not.toBe(first!.cycleCountId);
    expect(second!.evidenceUrls).toEqual(first!.evidenceUrls);
    expect(second!.lines[0]).toEqual({ productId: 'shirt-l', expected: 3, counted: 1,
      lotCounts: [{ lotId: 'lot-a', counted: 1 }, { lotId: null, counted: 0 }, { lotId: 'new-lot', counted: 0 }] });
  });

  it('does not abandon an actually committed count when its lost response is followed by revoked replay authority', async () => {
    const repo = makeRepo();
    const original = repo.createAndSubmitCycleCount.bind(repo);
    const rpc = vi.fn().mockResolvedValue({ data: null, status: 403, error: { code: '42501', message: 'Replay authority revoked' } });
    const adapter = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
    const send = vi.spyOn(repo, 'createAndSubmitCycleCount').mockImplementationOnce(async input => {
      await original(input);
      throw new Error('Response lost after commit');
    }).mockImplementation(input => adapter.createAndSubmitCycleCount(input));
    const { user } = await prepare(repo);
    const before = (await repo.getData()).cycleCounts.length;
    await user.click(screen.getByRole('button', { name: /submit count/i }));
    await screen.findByText('Response lost after commit');
    await user.click(screen.getByRole('button', { name: /retry saved count/i }));
    await screen.findByText('Replay authority revoked');
    expect(screen.getByLabelText(/Counted Event Shirt \(L\)/i)).toBeDisabled();
    expect(send.mock.calls[1]![0]).toEqual(send.mock.calls[0]![0]);
    expect((await repo.getData()).cycleCounts).toHaveLength(before + 1);
  });

  it('keeps the exact intent after a committed submit whose record read fails', async () => {
    const repo = makeRepo();
    const send = vi.spyOn(repo, 'createAndSubmitCycleCount');
    vi.spyOn(repo, 'getCycleCount').mockRejectedValue(new Error('Count record read unavailable'));
    const { user } = await prepare(repo);
    await user.click(screen.getByRole('button', { name: /submit count/i }));
    await screen.findByText('Count record read unavailable');
    expect(screen.getByLabelText(/Counted Event Shirt \(L\)/i)).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /retry saved count/i }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]![0]).toEqual(send.mock.calls[0]![0]);
  });

  it.each([
    { code: 'P0001', status: 400 }, { code: '23514', status: 400 },
    { code: 'PWC01', status: 500 }, { code: '42501', status: 403 },
  ])('keeps ambiguous or replay-revoked commands locked ($code / $status), even with absent count readback', async ({ code, status }) => {
    const repo = makeRepo();
    const rpc = vi.fn().mockResolvedValue({ data: null, status, error: { code, message: 'Outcome cannot be confirmed' } });
    const adapter = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
    const send = vi.spyOn(repo, 'createAndSubmitCycleCount').mockImplementation(input => adapter.createAndSubmitCycleCount(input));
    vi.spyOn(repo, 'getCycleCount').mockResolvedValue(null);
    const { user } = await prepare(repo);
    await user.click(screen.getByRole('button', { name: /submit count/i }));
    await screen.findByText('Outcome cannot be confirmed');
    expect(screen.getByLabelText(/Counted Event Shirt \(L\)/i)).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /retry saved count/i }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]![0]).toEqual(send.mock.calls[0]![0]);
    expect(screen.getByLabelText(/Counted Event Shirt \(L\)/i)).toBeDisabled();
  });

  it('replays the exact command after a committed response is lost, without a second count or request', async () => {
    const repo = makeRepo();
    const original = repo.createAndSubmitCycleCount.bind(repo);
    const send = vi.spyOn(repo, 'createAndSubmitCycleCount');
    send.mockImplementationOnce(async (input) => {
      await original(input);
      throw new Error('Response lost after commit');
    });
    const { user } = await prepare(repo);
    const before = await repo.getData();
    const requestsBefore = await repo.listStockChangeRequests({ limit: 200 });
    await user.click(screen.getByRole('button', { name: /submit count/i }));
    await screen.findByText('Response lost after commit');
    await user.click(screen.getByRole('button', { name: /submit count|retry saved count/i }));
    await screen.findByText(/awaiting warehouse supervisor/i);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0]).toEqual(send.mock.calls[0]![0]);
    expect((await repo.getData()).cycleCounts).toHaveLength(before.cycleCounts.length + 1);
    expect((await repo.listStockChangeRequests({ limit: 200 })).rows).toHaveLength(requestsBefore.rows.length + 1);
  });

  it('restores a locked command after reload even when the expected inventory changes', async () => {
    const repo = makeRepo();
    const send = vi.spyOn(repo, 'createAndSubmitCycleCount').mockRejectedValueOnce(new Error('Offline before response'));
    const { user, view } = await prepare(repo);
    await user.click(screen.getByRole('button', { name: /submit count/i }));
    await screen.findByText('Offline before response');
    const first = structuredClone(send.mock.calls[0]![0]);
    view.unmount();
    const changed = await repo.getData();
    changed.stockLevels.filter(row => row.productId === 'shirt-l').forEach(row => { row.quantity = 3; });
    const nextRepo = makeRepo(changed);
    const replay = vi.spyOn(nextRepo, 'createAndSubmitCycleCount').mockResolvedValue([]);
    renderWithProviders(<CycleCountsPage />, { repo: nextRepo, role: 'warehouse_operator' });
    await screen.findByRole('heading', { name: 'Count sheet' });
    expect(screen.getByLabelText(/Counted Event Shirt \(L\)/i)).toHaveValue(100);
    expect(screen.getByLabelText(/Counted Event Shirt \(L\)/i)).toBeDisabled();
    expect(screen.getByLabelText('Location')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /retry saved count/i }));
    await waitFor(() => expect(replay).toHaveBeenCalledTimes(1));
    expect(replay.mock.calls[0]![0]).toEqual(first);
    expect(first).toHaveProperty('cycleCountId', expect.stringMatching(/^cc-/));
  });

  it('sends only one command while a slow submission receives repeated clicks', async () => {
    const repo = makeRepo();
    let resolve!: (value: []) => void;
    const send = vi.spyOn(repo, 'createAndSubmitCycleCount').mockImplementation(() => new Promise(done => { resolve = done; }));
    await prepare(repo);
    const button = screen.getByRole('button', { name: /submit count/i });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(send).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    await act(async () => resolve([]));
  });

  it('submits only entered normal-mode rows, including deliberate zero, without expected fallbacks', async () => {
    const repo = makeRepo();
    const send = vi.spyOn(repo, 'createAndSubmitCycleCount');
    const { user } = await prepare(repo, false);
    fireEvent.change(screen.getByLabelText(/Counted Event Shirt \(L\)/i), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Search count sheet'), { target: { value: 'shirt' } });
    await user.click(screen.getByRole('button', { name: /submit count/i }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]![0].lines).toEqual([{ productId: 'shirt-l', expected: 120, counted: 0 }]);
    const saved = (await repo.getData()).cycleCounts.at(-1)!;
    expect(saved.lines).toEqual([{ productId: 'shirt-l', expected: 120, counted: 0 }]);
  });

  it.each(['', ' ,  '])('treats an empty serialized field (%j) as uncounted rather than zero', async raw => {
    const { user } = await prepare();
    await user.selectOptions(screen.getByLabelText('Category'), 'device');
    const field = screen.getByLabelText(/Scanned serials ECG Ring \(Size 6\)/i);
    fireEvent.change(field, { target: { value: 'ECG-RING-6-SN0003' } });
    fireEvent.change(field, { target: { value: raw } });
    expect(screen.getByText(/0\/\d+ counted/)).toBeInTheDocument();
    expect(screen.queryByText(/missing for ECG Ring/i)).not.toBeInTheDocument();
  });

  it('records serialized zero only through an explicit no-units-found entry', async () => {
    const repo = makeRepo();
    const send = vi.spyOn(repo, 'createAndSubmitCycleCount').mockResolvedValue([]);
    const { user } = await prepare(repo);
    await user.selectOptions(screen.getByLabelText('Category'), 'device');
    await user.click(screen.getAllByRole('checkbox', { name: 'ECG Ring (Size 6) no units found' })[0]!);
    await user.upload(screen.getByLabelText(/attach cycle-count evidence/i), new File(['zero'], 'zero.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('list', { name: /captured evidence/i });
    await user.click(screen.getByRole('button', { name: /submit count/i }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]![0].lines).toEqual([{ productId: 'ecg-ring-6', expected: 2, counted: 0, serialNumbers: [] }]);
  });

  it('accepts multiple scans, prevents duplicates, permits removed serials, and resets after completion in the same bin', async () => {
    const repo = makeRepo();
    const { user } = await prepare(repo);
    await user.selectOptions(screen.getByLabelText('Category'), 'device');
    const field = screen.getByLabelText(/Scanned serials ECG Ring \(Size 6\)/i);
    const serials = (await repo.getData()).units.filter(unit => unit.productId === 'ecg-ring-6'
      && unit.locationId === 'loc-wh' && !unit.binId && ['in_stock', 'returned'].includes(unit.status)).map(unit => unit.serialNumber);
    expect(serials).toHaveLength(2);
    const scan = async (serial: string) => {
      fireEvent.change(screen.getByLabelText('Enter barcode manually'), { target: { value: serial } });
      await user.click(screen.getByRole('button', { name: 'Add' }));
    };
    await scan(serials[0]!);
    await scan(serials[1]!);
    await scan(serials[0]!);
    expect(screen.getByRole('alert')).toHaveTextContent(/already scanned/i);
    fireEvent.change(field, { target: { value: serials[1] } });
    await scan(serials[0]!);
    expect(field).toHaveValue(`${serials[1]}, ${serials[0]}`);
    await user.upload(screen.getByLabelText(/attach cycle-count evidence/i), new File(['serials'], 'serials.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('list', { name: /captured evidence/i });
    await user.click(screen.getByRole('button', { name: /submit count/i }));
    await screen.findByText('Count completed · balanced');
    expect(field).toHaveValue('');
    await scan(serials[0]!);
    expect(field).toHaveValue(serials[0]);
    expect(screen.queryByText(/already scanned/i)).not.toBeInTheDocument();
  });

  it('does not describe a rejected historical count as awaiting approval when reconciling its lost response', async () => {
    const repo = makeRepo();
    vi.spyOn(repo, 'createAndSubmitCycleCount')
      .mockRejectedValueOnce(new Error('Response unavailable'))
      .mockResolvedValue([]);
    const read = vi.spyOn(repo, 'getCycleCount').mockImplementation(async id => ({
      id, locationId: 'loc-wh', category: 'merchandise', status: 'rejected',
      lines: [{ productId: 'shirt-l', expected: 120, counted: 100 }], actor: 'counter', createdAt: '2026-11-05',
    }));
    const { user } = await prepare(repo);
    await user.click(screen.getByRole('button', { name: /submit count/i }));
    await screen.findByText('Response unavailable');
    await user.click(screen.getByRole('button', { name: /retry saved count/i }));
    await screen.findByText(/saved count was rejected/i);
    expect(read).toHaveBeenCalledWith(expect.stringMatching(/^cc-/));
    expect(screen.queryByText(/awaiting warehouse supervisor/i)).not.toBeInTheDocument();
  });

  it('requires all represented lot counts including unlotted zero and preserves receipt identities', async () => {
    const data = await makeRepo().getData();
    data.stockLevels = data.stockLevels.filter(row => row.productId !== 'shirt-l');
    data.stockLevels.push(
      { productId: 'shirt-l', locationId: 'loc-wh', lotId: 'audit-lot-a', quantity: 2 },
      { productId: 'shirt-l', locationId: 'loc-wh', lotId: 'audit-lot-b', quantity: 1 },
      { productId: 'shirt-l', locationId: 'loc-wh', quantity: 1 },
      { productId: 'shirt-l', locationId: 'loc-cebu', lotId: 'other-location', quantity: 90 },
      { productId: 'shirt-l', locationId: 'loc-wh', binId: 'bin-pasig-a1', lotId: 'other-bin', quantity: 90 },
    );
    data.lots.push(
      { id: 'audit-lot-a', productId: 'shirt-l', lotCode: 'AUDIT-A', unitCost: 1, receivedAt: '2026-11-05' },
      { id: 'audit-lot-b', productId: 'shirt-l', lotCode: 'AUDIT-B', unitCost: 1, receivedAt: '2026-11-05' },
    );
    const repo = makeRepo(data);
    const send = vi.spyOn(repo, 'createAndSubmitCycleCount').mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithProviders(<CycleCountsPage />, { repo, role: 'warehouse_operator' });
    await user.selectOptions(await screen.findByLabelText('Location'), 'loc-wh');
    await screen.findByRole('heading', { name: 'Count sheet' });
    expect(screen.queryByLabelText(/Counted Event Shirt \(L\)$/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getAllByLabelText('Event Shirt (L) lot AUDIT-A counted')[0]!, { target: { value: '1' } });
    await user.upload(screen.getByLabelText(/attach cycle-count evidence/i), new File(['lot'], 'lot.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('list', { name: /captured evidence/i });
    expect(screen.getByRole('button', { name: /submit count/i })).toBeDisabled();
    fireEvent.change(screen.getAllByLabelText('Event Shirt (L) lot AUDIT-B counted')[0]!, { target: { value: '1' } });
    expect(screen.getByRole('button', { name: /submit count/i })).toBeDisabled();
    fireEvent.change(screen.getAllByLabelText('Event Shirt (L) lot Unlotted counted')[0]!, { target: { value: '0' } });
    await user.click(screen.getByRole('button', { name: /submit count/i }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]![0].lines).toEqual([{
      productId: 'shirt-l', expected: 4, counted: 2,
      lotCounts: [{ lotId: 'audit-lot-a', counted: 1 }, { lotId: 'audit-lot-b', counted: 1 }, { lotId: null, counted: 0 }],
    }]);
  });

  it('retains zero-balance lots and submits offsetting observations as a variance even when the net delta is zero', async () => {
    const data = await makeRepo().getData();
    data.stockLevels = data.stockLevels.filter(row => row.productId !== 'shirt-l');
    data.stockLevels.push(
      { productId: 'shirt-l', locationId: 'loc-wh', lotId: 'empty-receipt', quantity: 0 },
      { productId: 'shirt-l', locationId: 'loc-wh', lotId: 'stocked-receipt', quantity: 2 },
    );
    const repo = makeRepo(data);
    const send = vi.spyOn(repo, 'createAndSubmitCycleCount').mockResolvedValue([]);
    vi.spyOn(repo, 'getCycleCount').mockImplementation(async id => ({
      id, locationId: 'loc-wh', status: 'pending_approval', actor: 'counter', createdAt: '2026-11-05',
      lines: [{ productId: 'shirt-l', expected: 2, counted: 2, lotCounts: [{ lotId: 'empty-receipt', counted: 1 }, { lotId: 'stocked-receipt', counted: 1 }] }],
    }));
    const user = userEvent.setup();
    renderWithProviders(<CycleCountsPage />, { repo, role: 'warehouse_operator' });
    await user.selectOptions(await screen.findByLabelText('Location'), 'loc-wh');
    await screen.findByRole('heading', { name: 'Count sheet' });
    fireEvent.change(screen.getAllByLabelText('Event Shirt (L) lot empty-receipt counted')[0]!, { target: { value: '1' } });
    fireEvent.change(screen.getAllByLabelText('Event Shirt (L) lot stocked-receipt counted')[0]!, { target: { value: '1' } });
    expect(screen.getByText('1 variance(s)')).toBeInTheDocument();
    expect(screen.queryByText('balanced')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Variances only' }));
    expect(screen.getAllByLabelText('Event Shirt (L) lot empty-receipt counted')).toHaveLength(2);
    await user.upload(screen.getByLabelText(/attach cycle-count evidence/i), new File(['lots'], 'lots.jpg', { type: 'image/jpeg' }));
    await screen.findByRole('list', { name: /captured evidence/i });
    await user.click(screen.getByRole('button', { name: /submit count/i }));
    await screen.findByText(/awaiting warehouse supervisor/i);
    expect(screen.queryByText('Count completed · balanced')).not.toBeInTheDocument();
    expect(send.mock.calls[0]![0].lines).toEqual([{
      productId: 'shirt-l', expected: 2, counted: 2,
      lotCounts: [{ lotId: 'empty-receipt', counted: 1 }, { lotId: 'stocked-receipt', counted: 1 }],
    }]);
  });
});
