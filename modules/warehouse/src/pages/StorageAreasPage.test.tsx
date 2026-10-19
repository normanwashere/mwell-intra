import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StorageAreasPage } from './StorageAreasPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';
import { loadCompleteControlQueue } from '@/domain/controlQueues';
import type { StorageArea } from '@/domain/types';
import { _resetMemoryQueue, allPending, replayEntry, type InventoryHold, type InventoryPosition } from '@intra/data-kit';
import { useNavigate } from 'react-router-dom';

describe('StorageAreasPage receipt handoff', () => {
  async function fixture() {
    const data = await makeRepo().getData();
    data.locations = [
      { id: 'loc-wh', name: 'RBC warehouse', type: 'warehouse' },
      { id: 'loc-other', name: 'Receipt warehouse', type: 'warehouse' },
    ];
    data.storageAreas = [
      { id: 'rbc-bin', locationId: 'loc-wh', code: 'RBC-A', active: true },
      { id: 'receipt-bin', locationId: 'loc-other', code: 'RECEIPT-A', active: true },
    ];
    data.receipts = [{ id: 'external-receipt', locationId: 'loc-other', deliveryReference: 'DR-42',
      actualDeliveryDate: '2026-10-20', lines: [{ productId: 'shirt-l', quantity: 2 }], actor: 'receiver', createdAt: '2026-10-19T17:00:00Z' }];
    data.stockLevels = [
      { productId: 'shirt-l', locationId: 'loc-wh', quantity: 99 },
      { productId: 'shirt-l', locationId: 'loc-other', quantity: 2, lotId: 'lot-one' },
      { productId: 'shirt-l', locationId: 'loc-other', quantity: 1, lotId: 'lot-two' },
    ];
    const repo = makeRepo(data);
    const inspections = vi.spyOn(repo, 'listQualityInspectionSummaries').mockResolvedValue({ rows: [{
      id: 'inspection-one', sourceType: 'receipt', sourceId: 'external-receipt', productId: 'shirt-l',
      lotId: 'lot-one', quantity: 2, disposition: 'accepted', inspectedBy: 'quality',
      inspectedAt: '2026-10-19T18:00:00Z', evidenceCount: 0,
    }] });
    const relocate = vi.spyOn(repo, 'relocate');
    return { data, repo, inspections, relocate };
  }
  const route = '/storage?warehouse=loc-other&receipt=external-receipt&product=shirt-l';

  it('opens a copied receipt link in its warehouse with source details and no automatic movement', async () => {
    const { repo, relocate } = await fixture();
    const before = await repo.getData();
    renderWithProviders(<StorageAreasPage />, { repo, route });
    const dialog = await screen.findByRole('dialog', { name: 'Put away stock' });
    expect(within(dialog).getByText('Warehouse: Receipt warehouse')).toBeVisible();
    expect(dialog).toHaveAccessibleDescription('Receipt warehouse / DR-42 / General-area inventory');
    expect(within(dialog).getByText(/Selected receipt: DR-42/)).toBeVisible();
    await userEvent.click(within(dialog).getByText('Receipt and Quality lot references'));
    expect(await within(dialog).findByText(/lot-one/)).toBeVisible();
    expect(within(dialog).getByText(/Bulk putaway uses eligible stock across receipt lots/)).toBeVisible();
    expect(await within(dialog).findByText('3 eligible unit(s) in the general area')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Confirm putaway' })).toBeDisabled();
    expect(relocate).not.toHaveBeenCalled();
    expect(await repo.getData()).toEqual(before);
  });

  it('rejects another warehouse destination and preserves the existing relocate contract on explicit confirmation', async () => {
    const { repo, relocate } = await fixture();
    relocate.mockRejectedValue(new Error('Offline test: no stock changes'));
    const user = userEvent.setup();
    renderWithProviders(<StorageAreasPage />, { repo, route });
    const dialog = await screen.findByRole('dialog', { name: 'Put away stock' });
    const input = within(dialog).getByLabelText('Enter destination bin manually');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm putaway' });
    await user.type(input, 'RBC-A{Enter}');
    expect(confirm).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'RECEIPT-A{Enter}');
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(relocate).not.toHaveBeenCalled();
    await user.click(confirm);
    await waitFor(() => expect(relocate).toHaveBeenCalledOnce());
    expect(relocate.mock.calls[0]![0]).toMatchObject({ productId: 'shirt-l', locationId: 'loc-other', toBinId: 'receipt-bin', quantity: 1 });
    expect(relocate.mock.calls[0]![0]).not.toHaveProperty('lotId');
  });

  it.each([
    'warehouse=loc-wh&receipt=external-receipt&product=shirt-l',
    'warehouse=hidden&receipt=external-receipt&product=shirt-l',
    'warehouse=loc-other&receipt=hidden&product=shirt-l',
    'warehouse=loc-other&receipt=external-receipt&product=smart-watch',
    'warehouse=loc-other&receipt=external-receipt',
    'warehouse=loc-other&warehouse=loc-wh&receipt=external-receipt&product=shirt-l',
  ])('rejects invalid context without silently selecting RBC: %s', async (query) => {
    const { repo, relocate } = await fixture();
    renderWithProviders(<StorageAreasPage />, { repo, route: `/storage?${query}` });
    expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable|invalid|access/i);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Warehouse')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Put away' })).toBeDisabled();
    expect(relocate).not.toHaveBeenCalled();
  });

  it('does not use other accepted stock to unblock a held receipt', async () => {
    const { repo, inspections, relocate } = await fixture();
    inspections.mockResolvedValue({ rows: [] });
    renderWithProviders(<StorageAreasPage />, { repo, route });
    const dialog = await screen.findByRole('dialog', { name: 'Put away stock' });
    expect(await within(dialog).findByText('0 eligible unit(s) in the general area')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Confirm putaway' })).toBeDisabled();
    expect(relocate).not.toHaveBeenCalled();
  });

  it('clears the old capture when navigating from a valid receipt to inaccessible context', async () => {
    const { repo, relocate } = await fixture();
    let navigate!: ReturnType<typeof useNavigate>;
    function RoutedStorage() { navigate = useNavigate(); return <StorageAreasPage />; }
    renderWithProviders(<RoutedStorage />, { repo, route });
    await screen.findByRole('dialog', { name: 'Put away stock' });
    await act(async () => navigate('/storage?warehouse=loc-wh&receipt=hidden&product=shirt-l'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable|access/i);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Warehouse')).toHaveValue('');
    expect(relocate).not.toHaveBeenCalled();
  });

  it('fails closed without transfer authority', async () => {
    const { repo, relocate } = await fixture();
    renderWithProviders(<StorageAreasPage />, { repo, route, source: 'supabase', capabilities: ['receive_stock'] });
    expect(await screen.findByRole('alert')).toHaveTextContent(/access/i);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(relocate).not.toHaveBeenCalled();
  });

  it('switches between exact receipt warehouses with the same SKU and reopens the copied link on remount', async () => {
    const { data } = await fixture();
    data.receipts.push({ ...data.receipts[0]!, id: 'rbc-receipt', locationId: 'loc-wh', deliveryReference: 'RBC delivery' });
    const repo = makeRepo(data);
    const relocate = vi.spyOn(repo, 'relocate');
    let navigate!: ReturnType<typeof useNavigate>;
    function RoutedStorage() { navigate = useNavigate(); return <StorageAreasPage />; }
    const view = renderWithProviders(<RoutedStorage />, { repo, route });
    let dialog = await screen.findByRole('dialog', { name: 'Put away stock' });
    expect(within(dialog).getByText('Warehouse: Receipt warehouse')).toBeVisible();
    const rbcRoute = '/storage?warehouse=loc-wh&receipt=rbc-receipt&product=shirt-l';
    await act(async () => navigate(rbcRoute));
    dialog = await screen.findByRole('dialog', { name: 'Put away stock' });
    expect(within(dialog).getByText('Warehouse: RBC warehouse')).toBeVisible();
    expect(within(dialog).getByText('Selected receipt: RBC delivery')).toBeVisible();
    view.unmount();
    renderWithProviders(<StorageAreasPage />, { repo, route: rbcRoute });
    dialog = await screen.findByRole('dialog', { name: 'Put away stock' });
    expect(within(dialog).getByText('Warehouse: RBC warehouse')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Confirm putaway' })).toBeDisabled();
    expect(relocate).not.toHaveBeenCalled();
  });

  it('rejects a different receipt serial and retains the Quality hold on the selected serial', async () => {
    const { data } = await fixture();
    const unit = data.units.find(row => row.serialNumber === 'SMART-WATCH-SN0001')!;
    unit.locationId = 'loc-other'; unit.binId = undefined; unit.status = 'in_stock';
    data.units.push({ ...unit, id: 'unrelated-unit', serialNumber: 'UNRELATED-SERIAL' });
    data.receipts[0]!.lines = [{ productId: unit.productId, quantity: 1, serialNumbers: [unit.serialNumber] }];
    const repo = makeRepo(data);
    vi.spyOn(repo, 'listQualityInspectionSummaries').mockResolvedValue({ rows: [{
      id: 'serial-inspection', sourceType: 'receipt', sourceId: 'external-receipt', productId: unit.productId,
      lotId: unit.lotId, serialNumber: unit.serialNumber, quantity: 1, disposition: 'accepted', inspectedBy: 'quality',
      inspectedAt: '2026-10-19T18:00:00Z', evidenceCount: 0,
    }] });
    vi.spyOn(repo, 'listHolds').mockResolvedValue({ rows: [{ id: 'serial-hold', inspectionId: 'serial-inspection',
      productId: unit.productId, locationId: unit.locationId, lotId: unit.lotId, serialNumber: unit.serialNumber,
      quantity: 1, status: 'active', reason: 'Damaged', createdBy: 'quality', createdAt: '2026-10-19T18:30:00Z' }] });
    const relocate = vi.spyOn(repo, 'relocate');
    renderWithProviders(<StorageAreasPage />, { repo, route: `/storage?warehouse=loc-other&receipt=external-receipt&product=${unit.productId}` });
    const dialog = await screen.findByRole('dialog', { name: 'Put away stock' });
    const user = userEvent.setup();
    const input = within(dialog).getByLabelText('Enter stock code manually');
    await user.type(input, 'UNRELATED-SERIAL{Enter}');
    expect(await within(dialog).findByText(/does not belong to the selected receipt/)).toBeVisible();
    await user.clear(input);
    await user.type(input, `${unit.serialNumber}{Enter}`);
    expect(await within(dialog).findByText('0 eligible unit(s) in the general area')).toBeVisible();
    await user.type(within(dialog).getByLabelText('Enter destination bin manually'), 'RECEIPT-A{Enter}');
    expect(within(dialog).getByRole('button', { name: 'Confirm putaway' })).toBeDisabled();
    expect(relocate).not.toHaveBeenCalled();
  });

  it('keeps receipt capture blocked on a Quality read failure and recovers only after refresh', async () => {
    const { repo, inspections } = await fixture();
    inspections.mockRejectedValue(new Error('Quality unavailable'));
    renderWithProviders(<StorageAreasPage />, { repo, route });
    const dialog = await screen.findByRole('dialog', { name: 'Put away stock' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/could not be verified/);
    expect(within(dialog).getByRole('button', { name: 'Confirm putaway' })).toBeDisabled();
    inspections.mockResolvedValue({ rows: [] });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Refresh stock availability' }));
    expect(await within(dialog).findByText('0 eligible unit(s) in the general area')).toBeVisible();
  });

  it.each(['saving', 'queued'] as const)('pins a %s putaway command and capture when the receipt URL changes', async (status) => {
    _resetMemoryQueue();
    let reject: ((error: Error) => void) | undefined;
    try {
      const { repo, relocate } = await fixture();
      if (status === 'saving') relocate.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
      else relocate.mockRejectedValueOnce(new Error('Failed to fetch'));
      let navigate!: ReturnType<typeof useNavigate>;
      function RoutedStorage() { navigate = useNavigate(); return <StorageAreasPage />; }
      renderWithProviders(<RoutedStorage />, { repo, route, source: 'supabase', capabilities: ['transfer_stock', 'inspect_quality'] });
      const user = userEvent.setup();
      const dialog = await screen.findByRole('dialog', { name: 'Put away stock' });
      await user.type(within(dialog).getByLabelText('Enter destination bin manually'), 'RECEIPT-A{Enter}');
      const confirm = within(dialog).getByRole('button', { name: 'Confirm putaway' });
      await waitFor(() => expect(confirm).toBeEnabled());
      await user.click(confirm);
      await waitFor(() => expect(relocate).toHaveBeenCalledOnce());
      const original = relocate.mock.calls[0]![0];
      if (status === 'queued') await within(dialog).findByText(/Putaway queued for sync/);
      await act(async () => navigate('/storage?warehouse=loc-wh&receipt=hidden&product=shirt-l'));
      expect(screen.getByRole('dialog', { name: 'Put away stock' })).toBe(dialog);
      expect(within(dialog).getByText('Warehouse: Receipt warehouse')).toBeVisible();
      expect(within(dialog).getByText('Selected RECEIPT-A')).toBeVisible();
      expect(within(dialog).getByLabelText('Enter destination bin manually')).toBeDisabled();
      expect(within(dialog).getByLabelText('Quantity to put away')).toBeDisabled();
      if (status === 'queued') {
        await user.click(confirm);
        expect(relocate).toHaveBeenCalledOnce();
        expect((await allPending())[0]!.input).toMatchObject({ idempotencyKey: original.idempotencyKey,
          productId: 'shirt-l', locationId: 'loc-other', toBinId: 'receipt-bin', quantity: 1 });
      } else expect(confirm).toBeDisabled();
    } finally {
      if (reject) await act(async () => reject!(new Error('Offline test: rejected')));
      _resetMemoryQueue();
    }
  });

  it.each(['saving', 'queued'] as const)('pins a %s task-source capture until the pending command resolves', async (status) => {
    _resetMemoryQueue();
    let reject: ((error: Error) => void) | undefined;
    try {
      const { data } = await fixture();
      data.products.push({ ...data.products.find(row => row.id === 'shirt-l')!, id: 'other-product', sku: 'OTHER-SKU', name: 'Other product' });
      data.stockLevels.push({ productId: 'other-product', locationId: 'loc-wh', quantity: 9 });
      const repo = makeRepo(data);
      const tasks = vi.spyOn(repo, 'listWarehouseTasks').mockResolvedValue({ rows: [
        { id: 'task-a', type: 'putaway', sourceId: 'staging:["shirt-l","loc-other"]', title: 'Put away A', status: 'due' },
        { id: 'task-b', type: 'putaway', sourceId: 'staging:["other-product","loc-wh"]', title: 'Put away B', status: 'due' },
      ] });
      const relocate = vi.spyOn(repo, 'relocate');
      if (status === 'saving') relocate.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
      else relocate.mockRejectedValueOnce(new Error('Failed to fetch'));
      let navigate!: ReturnType<typeof useNavigate>;
      function RoutedStorage() { navigate = useNavigate(); return <StorageAreasPage />; }
      renderWithProviders(<RoutedStorage />, { repo, route: '/storage?source=task-a', source: 'supabase', capabilities: ['transfer_stock', 'inspect_quality'] });
      const user = userEvent.setup();
      const dialog = await screen.findByRole('dialog', { name: 'Put away stock' });
      const quantity = within(dialog).getByLabelText('Quantity to put away');
      fireEvent.change(quantity, { target: { value: '1' } });
      await user.type(within(dialog).getByLabelText('Enter destination bin manually'), 'RECEIPT-A{Enter}');
      const confirm = within(dialog).getByRole('button', { name: 'Confirm putaway' });
      await waitFor(() => expect(confirm).toBeEnabled());
      await user.click(confirm);
      await waitFor(() => expect(relocate).toHaveBeenCalledOnce());
      const original = relocate.mock.calls[0]![0];
      if (status === 'queued') await within(dialog).findByText(/Putaway queued for sync/);
      const readsBeforeNavigation = tasks.mock.calls.length;
      await act(async () => navigate('/storage?source=task-b'));
      expect(within(dialog).getByText('Warehouse: Receipt warehouse')).toBeVisible();
      expect(within(dialog).getByText('Selected RECEIPT-A')).toBeVisible();
      expect(within(dialog).queryByText(/Other product/)).not.toBeInTheDocument();
      expect(quantity).toHaveValue(1);
      expect(quantity).toBeDisabled();
      expect(within(dialog).getByLabelText('Enter destination bin manually')).toBeDisabled();
      expect(tasks).toHaveBeenCalledTimes(readsBeforeNavigation);
      if (status === 'queued') {
        await user.click(confirm);
        expect(relocate).toHaveBeenCalledOnce();
        const pending = (await allPending())[0]!;
        expect(pending.input).toMatchObject({ idempotencyKey: original.idempotencyKey,
          productId: 'shirt-l', locationId: 'loc-other', toBinId: 'receipt-bin', quantity: 1 });
        await act(async () => { expect(await replayEntry({ repo, actor: String(pending.input.actor) }, pending)).toBe(true); });
        await user.click(confirm);
        expect(relocate).toHaveBeenCalledTimes(2);
        expect(relocate.mock.calls[1]![0]).toEqual(original);
      } else {
        expect(confirm).toBeDisabled();
        await act(async () => reject!(new Error('Insufficient eligible stock')));
        reject = undefined;
      }
      expect(await screen.findByText('Warehouse: RBC warehouse')).toBeVisible();
      const nextDialog = screen.getByRole('dialog', { name: 'Put away stock' });
      expect(within(nextDialog).getByLabelText('Quantity to put away')).toHaveValue(9);
      expect(within(nextDialog).queryByText('Selected RECEIPT-A')).not.toBeInTheDocument();
      expect(within(nextDialog).getByRole('button', { name: 'Confirm putaway' })).toBeDisabled();
      expect((await repo.getData()).stockLevels.find(row => row.productId === 'other-product')?.quantity).toBe(9);
    } finally {
      if (reject) await act(async () => reject!(new Error('Offline test: rejected')));
      _resetMemoryQueue();
    }
  });
});

describe('StorageAreasPage putaway availability', () => {
  async function fixture() {
    const seed = await makeRepo().getData();
    const unit = seed.units.find(row => row.serialNumber === 'SMART-WATCH-SN0001')!;
    unit.serialNumber = 'OCT19-EXT-WATCH-002';
    unit.status = 'in_stock';
    unit.binId = undefined;
    const hold: InventoryHold = {
      id: 'damaged-watch', inspectionId: 'damaged-inspection', productId: unit.productId,
      locationId: unit.locationId, lotId: unit.lotId, serialNumber: unit.serialNumber,
      quantity: 1, status: 'active', reason: 'Damaged', createdBy: 'quality', createdAt: '2026-10-19T00:00:00Z',
    };
    return { repo: makeRepo(seed), unit, hold };
  }

  async function scanStock(repo: ReturnType<typeof makeRepo>, options: { liveWithoutHoldAccess?: boolean; live?: boolean; code?: string } = {}) {
    const user = userEvent.setup();
    renderWithProviders(<StorageAreasPage />, { repo, ...(options.liveWithoutHoldAccess
      ? { source: 'supabase' as const, capabilities: ['transfer_stock' as const] }
      : options.live ? { source: 'supabase' as const, capabilities: ['transfer_stock' as const, 'inspect_quality' as const] } : {}) });
    await user.click(await screen.findByRole('button', { name: /put away/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Put away stock' });
    await user.type(within(dialog).getByLabelText('Enter stock code manually'), `${options.code ?? 'OCT19-EXT-WATCH-002'}{Enter}`);
    await user.type(within(dialog).getByLabelText('Enter destination bin manually'), 'PASIG-A-01{Enter}');
    return { user, dialog, confirm: within(dialog).getByRole('button', { name: 'Confirm putaway' }) };
  }

  it.each(['Damaged', 'Awaiting independent quality inspection'])('blocks an in-stock serial with a paginated active hold: %s', async (reason) => {
    const { repo, hold } = await fixture();
    const before = await repo.getData();
    const holds = vi.spyOn(repo, 'listHolds').mockImplementation(async query => query.cursor
      ? { rows: [{ ...hold, reason }] } : { rows: [], nextCursor: 'holds-2' });
    const relocate = vi.spyOn(repo, 'relocate');
    const { dialog, user, confirm } = await scanStock(repo);
    expect(await within(dialog).findByText('0 eligible unit(s) in the general area')).toBeVisible();
    const guidance = within(dialog).getByRole('alert');
    expect(guidance).toHaveTextContent(/Quality/);
    expect(guidance).toHaveTextContent(reason === 'Damaged' ? /hold/i : /independent.*inspection/i);
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Enter destination bin manually'), 'PASIG-A-01{Enter}');
    expect(guidance).toBeVisible();
    await user.click(confirm);
    expect(relocate).not.toHaveBeenCalled();
    expect(holds).toHaveBeenCalledWith(expect.objectContaining({ status: 'active', cursor: 'holds-2' }));
    expect(await repo.getData()).toEqual(before);
  });

  it('allows a clear serial despite released holds and holds for other exact stock identities', async () => {
    const { repo, unit, hold } = await fixture();
    vi.spyOn(repo, 'listHolds').mockResolvedValue({ rows: [
      { ...hold, status: 'released' }, { ...hold, serialNumber: 'other-serial' },
      { ...hold, productId: 'other-product' }, { ...hold, locationId: 'other-warehouse' },
      { ...hold, binId: 'other-bin' }, { ...hold, lotId: 'other-lot' },
    ] });
    const { dialog, user, confirm } = await scanStock(repo);
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);
    await waitFor(async () => expect((await repo.getData()).units.find(row => row.id === unit.id)?.binId).toBe('bin-pasig-a1'));
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('Selected PASIG-A-01')).toBeVisible();
    expect(within(dialog).getByLabelText('Enter stock code manually')).toBeEnabled();
    expect(confirm).toBeDisabled();
  });

  it('does not advertise eligibility or enable confirmation before the hold check completes', async () => {
    const { repo, hold } = await fixture();
    let resolve!: (value: { rows: InventoryHold[] }) => void;
    vi.spyOn(repo, 'listHolds').mockImplementation(() => new Promise(done => { resolve = done; }));
    const { dialog, confirm } = await scanStock(repo);
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByText('Checking eligible stock...')).toBeVisible();
    await act(async () => resolve({ rows: [hold] }));
    expect(await within(dialog).findByText('0 eligible unit(s) in the general area')).toBeVisible();
    expect(confirm).toBeDisabled();
  });

  it('fails closed when active holds cannot be read and can retry availability', async () => {
    const { repo } = await fixture();
    const holds = vi.spyOn(repo, 'listHolds').mockRejectedValue(new Error('Connection unavailable'));
    const relocate = vi.spyOn(repo, 'relocate');
    const { dialog, user, confirm } = await scanStock(repo);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/could not be verified/i);
    expect(confirm).toBeDisabled();
    expect(relocate).not.toHaveBeenCalled();
    holds.mockResolvedValue({ rows: [] });
    await user.click(within(dialog).getByRole('button', { name: 'Refresh stock availability' }));
    await waitFor(() => expect(confirm).toBeEnabled());
  });

  it('does not mistake an RLS-hidden hold population for eligible live stock', async () => {
    const { repo } = await fixture();
    const holds = vi.spyOn(repo, 'listHolds');
    const { dialog, confirm } = await scanStock(repo, { liveWithoutHoldAccess: true });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/current access.*Quality/i);
    expect(confirm).toBeDisabled();
    expect(holds).not.toHaveBeenCalled();
  });

  it('rechecks a newly added hold before submitting a previously eligible serial', async () => {
    const { repo, hold } = await fixture();
    vi.spyOn(repo, 'listHolds').mockResolvedValueOnce({ rows: [] }).mockResolvedValue({ rows: [hold] });
    const relocate = vi.spyOn(repo, 'relocate');
    const { dialog, user, confirm } = await scanStock(repo);
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Quality.*hold|hold.*Quality/i);
    expect(confirm).toBeDisabled();
    expect(relocate).not.toHaveBeenCalled();
  });

  it('keeps a specific hold message in the sheet after a server rejection', async () => {
    const { repo, hold } = await fixture();
    const holds = vi.spyOn(repo, 'listHolds').mockResolvedValue({ rows: [] });
    const relocate = vi.spyOn(repo, 'relocate').mockImplementation(async () => {
      holds.mockResolvedValue({ rows: [hold] });
      throw new Error('Active Quality hold blocks relocation');
    });
    const { dialog, user, confirm } = await scanStock(repo);
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Quality.*hold|hold.*Quality/i);
    expect(within(dialog).getByText('0 eligible unit(s) in the general area')).toBeVisible();
    expect(confirm).toBeDisabled();
    expect(relocate).toHaveBeenCalledOnce();
    await user.type(within(dialog).getByLabelText('Enter destination bin manually'), 'PASIG-A-01{Enter}');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/Quality/);
  });

  it('refreshes bulk eligibility on scan and on request without closing the sheet', async () => {
    const { repo } = await fixture();
    const realPositions = repo.listInventoryPositions.bind(repo);
    let available = 0;
    const positions = vi.spyOn(repo, 'listInventoryPositions').mockImplementation(async query => {
      const result = await realPositions(query);
      return { ...result, rows: result.rows.map(row => row.productId === 'shirt-l' && !row.binId
        ? { ...row, available } : row) };
    });
    const user = userEvent.setup();
    renderWithProviders(<StorageAreasPage />, { repo });
    await user.click(await screen.findByRole('button', { name: /put away/i }));
    const dialog = await screen.findByRole('dialog', { name: 'Put away stock' });
    await waitFor(() => expect(positions).toHaveBeenCalled());
    available = 7;
    await user.type(within(dialog).getByLabelText('Enter stock code manually'), 'shirt-l{Enter}');
    expect(await within(dialog).findByText('7 eligible unit(s) in the general area')).toBeVisible();
    available = 0;
    await user.click(within(dialog).getByRole('button', { name: 'Refresh stock availability' }));
    expect(await within(dialog).findByText('0 eligible unit(s) in the general area')).toBeVisible();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/No eligible stock.*Quality/i);
    expect(within(dialog).queryByText(/from 1 to 0/)).not.toBeInTheDocument();
    available = 7;
    await user.click(within(dialog).getByRole('button', { name: 'Refresh stock availability' }));
    expect(await within(dialog).findByText('7 eligible unit(s) in the general area')).toBeVisible();
    expect(dialog).toBeInTheDocument();
  });

  it('ignores an older availability response after a newer refresh completes', async () => {
    const { repo } = await fixture();
    const { dialog, user, confirm } = await scanStock(repo, { code: 'shirt-l' });
    await waitFor(() => expect(confirm).toBeEnabled());
    const rows = (await repo.listInventoryPositions({})).rows;
    const position = rows.find(row => row.productId === 'shirt-l' && !row.binId)!;
    let finishOlder!: (value: { rows: InventoryPosition[] }) => void;
    vi.spyOn(repo, 'listInventoryPositions')
      .mockImplementationOnce(() => new Promise(resolve => { finishOlder = resolve; }))
      .mockResolvedValue({ rows: [{ ...position, available: 0 }] });
    const refresh = within(dialog).getByRole('button', { name: 'Refresh stock availability' });
    await user.click(refresh);
    expect(confirm).toBeDisabled();
    await user.click(refresh);
    expect(await within(dialog).findByText('0 eligible unit(s) in the general area')).toBeVisible();
    await act(async () => finishOlder({ rows: [{ ...position, available: 99 }] }));
    expect(within(dialog).getByText('0 eligible unit(s) in the general area')).toBeVisible();
    expect(confirm).toBeDisabled();
  });

  it('keeps a queued serial capture locked and reuses its command through offline replay', async () => {
    _resetMemoryQueue();
    try {
      const { repo, unit } = await fixture();
      vi.spyOn(repo, 'listHolds').mockResolvedValue({ rows: [] });
      const relocate = vi.spyOn(repo, 'relocate').mockRejectedValueOnce(new Error('Failed to fetch'));
      const { dialog, user, confirm } = await scanStock(repo, { live: true });
      await waitFor(() => expect(confirm).toBeEnabled());
      await user.click(confirm);
      expect(await within(dialog).findByText(/Putaway queued for sync/)).toBeVisible();
      expect(within(dialog).getByLabelText('Enter stock code manually')).toBeDisabled();
      expect(within(dialog).getByLabelText('Enter destination bin manually')).toBeDisabled();
      expect(within(dialog).getByRole('button', { name: 'Refresh stock availability' })).toBeDisabled();
      const pending = (await allPending())[0]!;
      expect(pending.input.serialNumbers).toEqual([unit.serialNumber]);
      expect(pending.input.idempotencyKey).toBe(relocate.mock.calls[0]![0].idempotencyKey);
      await user.click(confirm);
      expect(relocate).toHaveBeenCalledOnce();
      await act(async () => { expect(await replayEntry({ repo, actor: String(pending.input.actor) }, pending)).toBe(true); });
      expect(relocate).toHaveBeenCalledTimes(2);
      expect(relocate.mock.calls[1]![0].idempotencyKey).toBe(pending.input.idempotencyKey);
      await user.click(confirm);
      await waitFor(() => expect(within(dialog).queryByText(/Putaway queued for sync/)).not.toBeInTheDocument());
      expect(relocate).toHaveBeenCalledTimes(2);
      expect((await repo.getData()).units.find(row => row.id === unit.id)?.binId).toBe('bin-pasig-a1');
    } finally {
      _resetMemoryQueue();
    }
  });
});

describe('StorageAreasPage bin scanning', () => {
  const localBin: StorageArea = { id: 'local-bin', locationId: 'loc-wh', code: 'A-01-01', label: 'Selected warehouse bin', active: true };
  const foreignBin: StorageArea = { id: 'foreign-bin', locationId: 'loc-other', code: 'A-01-01', label: 'Other warehouse bin', active: true };

  async function setupScan(storageAreas: StorageArea[], warehouseId = 'loc-wh') {
    const seed = await makeRepo().getData();
    seed.locations = [
      { id: 'loc-wh', name: 'Main warehouse', type: 'warehouse' },
      { id: 'loc-other', name: 'Other warehouse', type: 'warehouse' },
    ];
    seed.storageAreas = storageAreas;
    const repo = makeRepo(seed);
    const before = await repo.getData();
    const user = userEvent.setup();
    renderWithProviders(<StorageAreasPage />, { repo });
    const warehouse = await screen.findByLabelText('Warehouse');
    await user.selectOptions(warehouse, warehouseId);
    await user.click(screen.getByRole('button', { name: 'Scan' }));
    const scanner = await screen.findByRole('dialog', { name: 'Scan a storage area' });
    const scan = async (value: string) => {
      await user.type(within(scanner).getByLabelText('Enter barcode manually'), `${value}{Enter}`);
    };
    return { repo, before, warehouse, scan };
  }

  it.each(['loc-wh', 'loc-other'])('resolves a shared code only within selected warehouse %s', async (warehouseId) => {
    const bins = warehouseId === 'loc-wh' ? [foreignBin, localBin] : [localBin, foreignBin];
    const { repo, before, warehouse, scan } = await setupScan(bins, warehouseId);
    await scan('  a-01-01  ');
    const dialog = await screen.findByRole('dialog', { name: 'Bin A-01-01' });
    expect(within(dialog).getByText(warehouseId === 'loc-wh' ? 'Selected warehouse bin' : 'Other warehouse bin')).toBeVisible();
    expect(warehouse).toHaveValue(warehouseId);
    expect(await repo.getData()).toEqual(before);
  });

  it('rejects a foreign bin ID without switching warehouses or opening its contents', async () => {
    const { repo, before, warehouse, scan } = await setupScan([foreignBin, localBin]);
    await scan('  FOREIGN-BIN  ');
    expect(await screen.findByText(/belongs to another warehouse/i)).toBeVisible();
    expect(warehouse).toHaveValue('loc-wh');
    expect(screen.queryByRole('dialog', { name: /^Bin / })).not.toBeInTheDocument();
    expect(await repo.getData()).toEqual(before);
  });

  it.each([
    ['a-01-01', true],
    ['a-01-01', false],
    [' A-01-01 ', true],
  ] as const)('rejects duplicate local code "%s" (active: %s)', async (code, active) => {
    const duplicate = { ...localBin, id: 'duplicate-bin', code, active };
    const { repo, before, warehouse, scan } = await setupScan([foreignBin, localBin, duplicate]);
    await scan('A-01-01');
    expect(await screen.findByText(/multiple storage areas.*selected warehouse/i)).toBeVisible();
    expect(warehouse).toHaveValue('loc-wh');
    expect(screen.queryByRole('dialog', { name: /^Bin / })).not.toBeInTheDocument();
    expect(await repo.getData()).toEqual(before);
  });

  it('still resolves a unique local bin ID when its code is duplicated', async () => {
    const duplicate = { ...localBin, id: 'duplicate-bin', label: 'Legacy duplicate' };
    const { repo, before, warehouse, scan } = await setupScan([foreignBin, duplicate, localBin]);
    await scan('  LOCAL-BIN  ');
    const dialog = await screen.findByRole('dialog', { name: 'Bin A-01-01' });
    expect(within(dialog).getByText('Selected warehouse bin')).toBeVisible();
    expect(warehouse).toHaveValue('loc-wh');
    expect(await repo.getData()).toEqual(before);
  });

  it.each(['FOREIGN-ONLY', 'UNKNOWN'])('does not fall back to another warehouse for code %s', async (code) => {
    const { repo, before, warehouse, scan } = await setupScan([{ ...foreignBin, code: 'FOREIGN-ONLY' }, localBin]);
    await scan(code);
    expect(await screen.findByText(/no storage area matches.*selected warehouse/i)).toBeVisible();
    expect(warehouse).toHaveValue('loc-wh');
    expect(screen.queryByRole('dialog', { name: /^Bin / })).not.toBeInTheDocument();
    expect(await repo.getData()).toEqual(before);
  });
});

describe('StorageAreasPage', () => {
  it('keeps long bin identity above a separate zone and opens the same bin without changing stock', async () => {
    const seed = await makeRepo().getData();
    const code = 'DEST-4f486cb0-035c-4599-9a6b-bece2440ebc8-desktop1440';
    const label = 'Synthetic inbound signoff 4f486cb0-035c-4599-9a6b-bece2440ebc8 desktop1440';
    const zone = '4f486cb0-035c-4599-9a6b-bece2440ebc8';
    seed.storageAreas = [{ id: 'long-bin', locationId: 'loc-wh', code, label, zone, active: true }];
    seed.stockLevels = [{ productId: 'shirt-l', locationId: 'loc-wh', binId: 'long-bin', quantity: 7 }];
    const repo = makeRepo(seed);
    const before = await repo.getData();
    const user = userEvent.setup();
    renderWithProviders(<StorageAreasPage />, { repo });
    const identity = await screen.findByText(code, { exact: true });
    const bin = identity.closest('button')!;
    expect(identity).not.toHaveClass('truncate');
    expect(within(bin).getByText(label, { exact: true })).not.toHaveClass('truncate');
    expect(within(bin).getByText(`Zone: ${zone}`, { exact: true })).toBeVisible();
    expect(within(bin).getByText(/items across 1 SKU/)).toBeVisible();
    await user.click(bin);
    const dialog = await screen.findByRole('dialog', { name: `Bin ${code}` });
    expect(within(dialog).getByText(code, { exact: true })).toBeVisible();
    expect(await repo.getData()).toEqual(before);
  });

  it('opens generated staging work and refreshes remaining quantity after partial putaway', async () => {
    const seed = await makeRepo().getData();
    seed.stockLevels = [{ productId: 'shirt-l', locationId: 'loc-wh', quantity: 60 }];
    const repo = makeRepo(seed);
    const task = (await loadCompleteControlQueue(query => repo.listWarehouseTasks(query))).find(row => row.sourceId === 'staging:["shirt-l","loc-wh"]')!;
    const user = userEvent.setup();
    renderWithProviders(<StorageAreasPage />, { repo, route: `/storage?source=${encodeURIComponent(task.sourceId)}` });
    const dialog = await screen.findByRole('dialog', { name: /put away stock/i });
    const quantity = within(dialog).getByLabelText('Quantity to put away');
    expect(quantity).toHaveValue(60);
    fireEvent.change(quantity, { target: { value: '50' } });
    await user.type(within(dialog).getByLabelText('Enter destination bin manually'), 'PASIG-A-01{Enter}');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm putaway' }));
    expect(await screen.findByText(/10 units: remaining stock is still due/)).toBeVisible();
    expect((await loadCompleteControlQueue(query => repo.listWarehouseTasks(query))).find(row => row.id === task.id)?.title).toContain('10 units');
  });
  it('moves 50 of 60 bulk units once and retains the destination for the next scan', async () => {
    const seed = await makeRepo().getData();
    seed.stockLevels = [{ productId: 'shirt-l', locationId: 'loc-wh', quantity: 60 }];
    const repo = makeRepo(seed);
    const relocate = vi.spyOn(repo, 'relocate');
    const user = userEvent.setup();
    renderWithProviders(<StorageAreasPage />, { repo });
    await user.click(await screen.findByRole('button', { name: /put away/i }));
    const dialog = await screen.findByRole('dialog', { name: /put away stock/i });
    await user.type(within(dialog).getByLabelText('Enter stock code manually'), 'shirt-l{Enter}');
    const quantity = within(dialog).getByLabelText('Quantity to put away');
    await user.clear(quantity);
    await user.type(quantity, '50');
    await user.type(within(dialog).getByLabelText('Enter destination bin manually'), 'PASIG-A-01{Enter}');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm putaway' }));
    await waitFor(() => expect(relocate).toHaveBeenCalledOnce());
    const data = await repo.getData();
    expect(data.stockLevels.find(row => row.productId === 'shirt-l' && !row.binId)?.quantity).toBe(10);
    expect(data.stockLevels.find(row => row.productId === 'shirt-l' && row.binId === 'bin-pasig-a1')?.quantity).toBe(50);
    expect(within(dialog).getByText('Selected PASIG-A-01')).toBeVisible();
  });

  it('blocks fractional/excess quantities, double taps, and dismissal during a delayed putaway', async () => {
    const seed = await makeRepo().getData();
    seed.stockLevels = [{ productId: 'shirt-l', locationId: 'loc-wh', quantity: 60, unavailable: 10 }];
    const repo = makeRepo(seed);
    let reject!: (error: Error) => void;
    const relocate = vi.spyOn(repo, 'relocate').mockImplementation(() => new Promise((_resolve, rej) => { reject = rej; }));
    const user = userEvent.setup();
    renderWithProviders(<StorageAreasPage />, { repo });
    await user.click(await screen.findByRole('button', { name: /put away/i }));
    const dialog = await screen.findByRole('dialog', { name: /put away stock/i });
    await user.type(within(dialog).getByLabelText('Enter stock code manually'), 'shirt-l{Enter}');
    await user.type(within(dialog).getByLabelText('Enter destination bin manually'), 'PASIG-A-01{Enter}');
    const quantity = within(dialog).getByLabelText('Quantity to put away');
    for (const value of ['0', '1.5', '51', '']) {
      fireEvent.change(quantity, { target: { value } });
      expect(within(dialog).getByRole('button', { name: 'Confirm putaway' })).toBeDisabled();
    }
    fireEvent.change(quantity, { target: { value: '50' } });
    const confirm = within(dialog).getByRole('button', { name: 'Confirm putaway' });
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
    await waitFor(() => expect(relocate).toHaveBeenCalledOnce());
    await user.keyboard('{Escape}');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(dialog).toBeInTheDocument();
    await act(async () => reject(new Error('Connection lost')));
    expect(quantity).toHaveValue(50);
    await user.keyboard('{Escape}');
    expect(within(dialog).getByRole('button', { name: 'Keep capturing' })).toBeVisible();
  });

  it('opens the exact unit from a paginated putaway task source', async () => {
    const repo = makeRepo();
    const data = await repo.getData();
    const unit = data.units.find(row => row.serialNumber === 'SMART-WATCH-SN0001')!;
    const tasks = vi.spyOn(repo, 'listWarehouseTasks').mockImplementation(async (query) => query.cursor
      ? { rows: [{ id: 'putaway-exact', type: 'putaway', sourceId: unit.id, title: 'Store watch', status: 'due' }] }
      : { rows: [], nextCursor: 'page-2' });
    const relocate = vi.spyOn(repo, 'relocate');
    renderWithProviders(<StorageAreasPage />, { repo, route: `/storage?source=${encodeURIComponent(unit.id)}` });
    const dialog = await screen.findByRole('dialog', { name: /put away stock/i });
    expect(within(dialog).getByText(/1 serialized unit: SMART-WATCH-SN0001/)).toBeVisible();
    expect(within(dialog).queryByText(/Store watch/)).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Enter stock code manually')).toBeDisabled();
    expect(tasks).toHaveBeenCalledWith(expect.objectContaining({ cursor: 'page-2' }));
    expect(relocate).not.toHaveBeenCalled();
  });

  it.each(['completed', 'missing'] as const)('shows an explicit %s source without opening unrelated stock', async (status) => {
    const repo = makeRepo();
    vi.spyOn(repo, 'listWarehouseTasks').mockResolvedValue({ rows: status === 'completed'
      ? [{ id: 'putaway-done', type: 'putaway', sourceId: 'selected', title: 'Store watch', status: 'completed' }]
      : [] });
    renderWithProviders(<StorageAreasPage />, { repo, route: '/storage?source=selected' });
    await screen.findByText(status === 'completed' ? 'Store watch: completed.' : 'The selected putaway task is unavailable or you do not have access.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to tasks' })).toHaveAttribute('href', '/tasks?status=due');
  });
  it('requires transfer_stock for live putaway', async () => {
    renderWithProviders(<StorageAreasPage />, {
      role: 'warehouse_operator',
      source: 'supabase',
      capabilities: ['receive_stock'],
    });
    await screen.findByRole('heading', { name: 'Storage areas' });
    expect(screen.queryByRole('button', { name: /put away/i })).not.toBeInTheDocument();
  });

  it('opens the exact add-bin state requested by a Knowledge Base guide link', async () => {
    renderWithProviders(<StorageAreasPage />, {
      role: 'logistics_supervisor',
      route: '/storage?guide=setup-bin&returnTo=%2Fknowledge%3Fflow%3Dwarehouse-setup',
    });

    const dialog = await screen.findByRole('dialog', { name: 'Add storage area' });
    const binCode = within(dialog).getByLabelText('Bin code');
    expect(binCode).toHaveAttribute('id', 'sa-code');
    await waitFor(() => expect(binCode).toHaveFocus());
    expect(within(dialog).getByRole('button', { name: 'Add bin' })).toBeInTheDocument();
    expect(
      within(dialog).getByRole('link', { name: 'Back to workflow guide' }),
    ).toHaveAttribute('href', '/knowledge?flow=warehouse-setup');
  });

  it('does not render an unsafe guided return destination', async () => {
    renderWithProviders(<StorageAreasPage />, {
      role: 'logistics_supervisor',
      route: '/storage?guide=setup-bin&returnTo=https%3A%2F%2Fevil.example',
    });

    const dialog = await screen.findByRole('dialog', { name: 'Add storage area' });
    expect(
      within(dialog).queryByRole('link', { name: 'Back to workflow guide' }),
    ).not.toBeInTheDocument();
  });

  it('puts away the exact scanned unit into the scanned destination bin', async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    renderWithProviders(<StorageAreasPage />, {
      role: 'logistics_supervisor',
      repo,
    });

    await user.click(await screen.findByRole('button', { name: /put away/i }));
    const dialog = await screen.findByRole('dialog', { name: /put away stock/i });
    await user.type(
      within(dialog).getByLabelText('Enter stock code manually'),
      'SMART-WATCH-SN0001',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add stock' }));
    await user.type(
      within(dialog).getByLabelText('Enter destination bin manually'),
      'PASIG-A-01',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add bin' }));
    await user.click(within(dialog).getByRole('button', { name: /confirm putaway/i }));

    await waitFor(async () => {
      const unit = (await repo.getData()).units.find(
        (row) => row.serialNumber === 'SMART-WATCH-SN0001',
      );
      expect(unit?.binId).toBe('bin-pasig-a1');
    });
  });
});
