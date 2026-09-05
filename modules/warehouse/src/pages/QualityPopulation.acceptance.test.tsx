import { expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QualityPage } from './QualityPage';
import { makeRepo, renderWithProviders } from '@/test/renderWithProviders';
import { InMemoryRepository } from '@/data/inMemoryRepository';

async function fixture() {
  const data = await makeRepo().getData();
  data.receipts = [];
  data.returns = [];
  let sequence = 0;
  let clockTick = 0;
  const repo = new InMemoryRepository(data, { storage: null,
    now: () => new Date(Date.UTC(2026, 0, 1) + clockTick++ * 1000).toISOString(),
    id: prefix => `${prefix}-${String(++sequence).padStart(5, '0')}` });
  const locationId = data.locations.find(row => row.type === 'warehouse')!.id;
  const receive = (lines: Parameters<typeof repo.receiveStock>[0]['lines']) => repo.receiveStock({
    actor: 'local-receiver', locationId, lines, evidenceUrls: [],
    receiptException: { type: 'non_po', reason: 'Isolated acceptance fixture', evidenceUrls: ['data:application/pdf;base64,fixture'] },
  });
  return { repo, data, receive };
}

it('WE03: 150 completed inspections plus one older accepted receipt (151 decisions) retain the old hold through paging, failure and retry', async () => {
  const { repo, receive } = await fixture();
  const accepted = await receive([{ productId: 'shirt-l', quantity: 1 }]);
  const oldestAccepted = await repo.inspectQuality({ idempotencyKey: 'population-accepted-receipt', sourceType: 'receipt', sourceId: accepted.id,
    productId: 'shirt-l', quantity: 1, disposition: 'accepted', evidenceUrls: [] });
  const receipt = await receive([{ productId: 'shirt-l', quantity: 150 }]);
  const old = await repo.inspectQuality({ idempotencyKey: 'population-old-hold', sourceType: 'receipt', sourceId: receipt.id,
    productId: 'shirt-l', quantity: 1, disposition: 'hold', reason: 'Old active population hold', evidenceUrls: ['data:image/png;base64,old'] });
  for (let i = 1; i < 150; i++) await repo.inspectQuality({ idempotencyKey: `population-completed-${i}`, sourceType: 'receipt', sourceId: receipt.id,
    productId: 'shirt-l', quantity: 1, disposition: 'accepted', evidenceUrls: ['data:image/png;base64,accepted'] });
  const originalLoad = repo.listQualityInspections.bind(repo);
  const load = vi.spyOn(repo, 'listQualityInspections');
  const first = await repo.listQualityInspections({ limit: 100 });
  const second = await repo.listQualityInspections({ limit: 100, cursor: first.nextCursor });
  expect(first.rows).toHaveLength(100);
  expect(second.rows).toHaveLength(51);
  expect(new Set([...first.rows, ...second.rows].map(row => row.id)).size).toBe(151);
  expect(second.rows.some(row => row.id === old.id)).toBe(true);
  expect(second.rows.some(row => row.id === oldestAccepted.id)).toBe(true);
  expect(Date.parse(oldestAccepted.inspectedAt)).toBeLessThan(Date.parse(old.inspectedAt));
  const laterDecisions = [...first.rows, ...second.rows].filter(row => row.id !== old.id && row.id !== oldestAccepted.id);
  expect(laterDecisions).toHaveLength(149);
  expect(laterDecisions.every(row => Date.parse(row.inspectedAt) > Date.parse(old.inspectedAt))).toBe(true);
  load.mockRejectedValue(new Error('Population page unavailable'));
  const view = renderWithProviders(<QualityPage />, { repo, role: 'warehouse_supervisor' });
  expect(await screen.findByRole('alert')).toHaveTextContent('Population page unavailable');
  expect(screen.queryByText('No inspections waiting')).not.toBeInTheDocument();
  load.mockImplementation(originalLoad);
  await userEvent.click(screen.getByRole('button', { name: 'Retry quality queue' }));
  await screen.findByText('0 pending inspections');
  await userEvent.click(screen.getByRole('tab', { name: 'Completed' }));
  expect(within(await screen.findByRole('list', { name: 'Completed inspections' })).getAllByRole('listitem')).toHaveLength(151);
  view.unmount();
  const hold = (await repo.listHolds({ limit: 100 })).rows.find(row => row.inspectionId === old.id)!;
  renderWithProviders(<QualityPage />, { repo, role: 'warehouse_supervisor', route: `/quality?source=${hold.id}` });
  const holds = await screen.findByRole('list', { name: 'Active holds' });
  expect(within(holds).getAllByRole('listitem')).toHaveLength(1);
  expect(within(holds).getByText('Old active population hold')).toBeInTheDocument();
  await userEvent.click(within(holds).getByRole('button', { name: 'Review hold' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('Old active population hold');
});

it.each([false, true])('WE04: same-SKU A/B remains exact after split acceptance and paginated remount (serialized=%s)', async (serialized) => {
  const { repo, data, receive } = await fixture();
  const productId = serialized ? data.products.find(row => row.serialized)!.id : 'shirt-l';
  const lines = [
    { productId, quantity: 2, procurementLineId: 'population-A', binId: 'population-bin-A', ...(serialized ? { serialNumbers: ['AB-A-1', 'AB-A-2'] } : {}) },
    { productId, quantity: 2, procurementLineId: 'population-B', binId: 'population-bin-B', ...(serialized ? { serialNumbers: ['AB-B-1', 'AB-B-2'] } : {}) },
  ];
  const receipt = await receive(lines);
  for (let i = 1; i <= 2; i++) await repo.inspectQuality({ idempotencyKey: `population-split-A-${i}`, sourceType: 'receipt', sourceId: receipt.id,
    productId, quantity: 1, binId: 'population-bin-A', procurementPoLineId: 'population-A',
    ...(serialized ? { serialNumber: `AB-A-${i}` } : {}), disposition: 'accepted', evidenceUrls: [`data:image/png;base64,proofA${i}`] });
  const filler = await receive([{ productId: 'shirt-l', quantity: 150 }]);
  for (let i = 0; i < 150; i++) await repo.inspectQuality({ idempotencyKey: `population-filler-${i}`, sourceType: 'receipt', sourceId: filler.id,
    productId: 'shirt-l', quantity: 1, disposition: 'accepted', evidenceUrls: [] });
  const first = await repo.listQualityInspections({ limit: 100 });
  const later = await repo.listQualityInspections({ limit: 100, cursor: first.nextCursor });
  expect(first.rows.some(row => row.sourceId === receipt.id)).toBe(false);
  expect(later.rows.filter(row => row.sourceId === receipt.id)).toHaveLength(2);
  const inspect = vi.spyOn(repo, 'inspectQuality');
  for (let mount = 0; mount < 2; mount++) {
    const view = renderWithProviders(<QualityPage />, { repo, role: 'warehouse_operator' });
    await screen.findByText(`${serialized ? 2 : 1} pending inspections`);
    await userEvent.type(screen.getByRole('searchbox'), receipt.id);
    const queue = screen.getByRole('list', { name: 'Pending inspections' });
    expect(within(queue).getAllByRole('button', { name: 'Inspect' })).toHaveLength(serialized ? 2 : 1);
    expect(queue).not.toHaveTextContent('AB-A-');
    if (serialized) {
      expect(queue).toHaveTextContent('AB-B-1');
      expect(queue).toHaveTextContent('AB-B-2');
    }
    await userEvent.click(within(queue).getAllByRole('button', { name: 'Inspect' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Inspect stock' });
    expect(dialog).toHaveTextContent(serialized ? '1 unit(s)' : '2 unit(s)');
    if (serialized) expect(dialog).toHaveTextContent('AB-B-1');
    if (mount === 1) {
      await userEvent.upload(within(dialog).getByLabelText('Attach inspection evidence'), new File(['B-proof'], 'B.png', { type: 'image/png' }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Submit inspection' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(inspect).toHaveBeenCalledTimes(1);
      expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ sourceId: receipt.id, productId,
        procurementPoLineId: 'population-B', binId: 'population-bin-B', quantity: serialized ? 1 : 2,
        ...(serialized ? { serialNumber: 'AB-B-1' } : {}), evidenceUrls: [expect.stringContaining('data:image/png')] }));
      const remaining = serialized ? 1 : 0;
      await screen.findByText(`${remaining} of ${remaining} pending inspections`);
    }
    view.unmount();
  }
});

it('UX03: 150 serial tasks across three receipts retain group search and submit only the selected individual evidence', async () => {
  const { repo, data, receive } = await fixture();
  const product = data.products.find(row => row.serialized)!;
  const receipts = [];
  for (let group = 0; group < 3; group++) receipts.push(await receive([{ productId: product.id, quantity: 50,
    serialNumbers: Array.from({ length: 50 }, (_, index) => `POP-${group}-${String(index).padStart(3, '0')}`) }]));
  const inspect = vi.spyOn(repo, 'inspectQuality');
  renderWithProviders(<QualityPage />, { repo, role: 'warehouse_operator' });
  await screen.findByText('150 pending inspections');
  expect(screen.getByRole('list', { name: 'Pending inspections' }).querySelectorAll('details')).toHaveLength(3);
  const search = screen.getByRole('searchbox');
  await userEvent.type(search, 'POP-2-049');
  expect(screen.getByText('1 of 150 pending inspections')).toBeInTheDocument();
  const queue = screen.getByRole('list', { name: 'Pending inspections' });
  expect(queue.querySelector('details')).toHaveAttribute('open');
  await userEvent.click(within(queue).getByRole('button', { name: 'Inspect' }));
  let dialog = await screen.findByRole('dialog', { name: 'Inspect stock' });
  expect(dialog).toHaveTextContent('POP-2-049');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  await userEvent.click(screen.getByRole('tab', { name: 'Completed' }));
  await userEvent.click(screen.getByRole('tab', { name: 'Pending' }));
  expect(search).toHaveValue('POP-2-049');
  expect(screen.getByText('1 of 150 pending inspections')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Inspect' }));
  dialog = await screen.findByRole('dialog', { name: 'Inspect stock' });
  await userEvent.upload(within(dialog).getByLabelText('Attach inspection evidence'), new File(['individual-proof'], 'serial-proof.png', { type: 'image/png' }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Submit inspection' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(inspect).toHaveBeenCalledTimes(1);
  expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ sourceId: receipts[2]!.id, productId: product.id,
    serialNumber: 'POP-2-049', quantity: 1, disposition: 'accepted', evidenceUrls: [expect.stringContaining('data:image/png')] }));
  const recorded = await repo.listQualityInspections({ limit: 100 });
  expect(recorded.rows).toHaveLength(1);
  expect(recorded.rows[0]).toMatchObject({ serialNumber: 'POP-2-049', quantity: 1, disposition: 'accepted' });
  expect(recorded.rows[0]!.evidenceUrls).toHaveLength(1);
  expect(search).toHaveValue('POP-2-049');
  await userEvent.clear(search);
  expect(await screen.findByText('149 pending inspections')).toBeInTheDocument();
});
