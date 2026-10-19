import { describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useNavigate } from 'react-router-dom';
import { QualityPage } from "./QualityPage";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";
import { InMemoryRepository } from '@/data/inMemoryRepository';
import type { InventoryHold, QualityInspectionSummary } from '@intra/data-kit';

const linkedReceipt = 'external-acbde0f1-7483-4a6a-b37a-d42b7aded9cc';

async function repositoryWithLinkedInspections(pendingCount = 0) {
  const data = await makeRepo().getData();
  data.receipts = []; data.returns = [];
  const repo = makeRepo(data);
  const completed: QualityInspectionSummary[] = Array.from({ length: 75 }, (_, index) => ({
    id: `completed-${index}`, sourceType: 'receipt',
    sourceId: index < 3 ? linkedReceipt : `${linkedReceipt}-different`,
    productId: 'shirt-l', quantity: 1, disposition: index === 2 ? 'damaged' : 'accepted',
    serialNumber: `UNIT-${index}`, inspectedAt: '2026-10-19T00:00:00Z',
    inspectedBy: 'inspector', evidenceCount: 0,
  }));
  const pending: QualityInspectionSummary[] = Array.from({ length: pendingCount }, (_, index) => ({
    ...completed[0]!, id: `pending-${index}`, sourceId: 'other-pending-receipt',
    serialNumber: `PENDING-${index}`, disposition: 'pending',
  }));
  const rows = [...pending, ...completed];
  const load = vi.spyOn(repo, 'listQualityInspectionSummaries').mockImplementation(async query => {
    const offset = Number(query.cursor ?? 0);
    return { rows: rows.slice(offset, offset + 100), total: rows.length,
      ...(offset + 100 < rows.length ? { nextCursor: String(offset + 100) } : {}) };
  });
  const save = vi.spyOn(repo, 'inspectQuality');
  const batchSave = vi.spyOn(repo, 'inspectQualityBatch');
  return { repo, completed, rows, load, save, batchSave, locationId: data.locations[0]!.id };
}

async function repositoryWithPendingReceipt() {
  const repo = makeRepo();
  const data = await repo.getData();
  const receipt = await repo.receiveStock({
    actor: "receiver@mwell.com.ph",
    locationId: data.locations.find(
      (location) => location.type === "warehouse",
    )!.id,
    supplierId: data.suppliers[0]!.id,
    lines: [{ productId: "shirt-l", quantity: 2 }],
    evidenceUrls: ["data:image/png;base64,receipt"],
    receiptException: {
      type: "non_po",
      reason: "Approved test receipt outside the PO workflow",
      evidenceUrls: ["data:application/pdf;base64,approval"],
    },
  });
  return { repo, receipt };
}

describe("QualityPage", () => {
  it('labels inspection timestamps in Asia/Manila while preserving stored timestamps and collapsible traceability', async () => {
    const { repo, rows } = await repositoryWithLinkedInspections();
    rows[0]!.inspectedAt = '2026-10-19T17:15:00Z';
    renderWithProviders(<QualityPage />, { repo, route: `/quality?source=${linkedReceipt}` });
    const item = await screen.findByRole('listitem', { name: 'Inspection completed-0' });
    const time = item.querySelector('time')!;
    expect(time).toHaveTextContent('Oct 20, 2026, 1:15 AM (Asia/Manila)');
    expect(time).toHaveAttribute('datetime', '2026-10-19T17:15:00Z');
    const details = within(item).getByText('Traceability').closest('details')!;
    expect(details).not.toHaveAttribute('open');
    await userEvent.click(within(item).getByText('Traceability'));
    expect(within(details).getByText(`receipt: ${linkedReceipt}`)).toBeVisible();
    expect(within(details).getByText('Inspection: completed-0')).toBeVisible();
    expect(rows[0]!.inspectedAt).toBe('2026-10-19T17:15:00Z');
  });

  it('uses the same Manila date/time for pending records and holds without changing the receipt delivery date', async () => {
    const data = await makeRepo().getData();
    data.receipts = [{ id: linkedReceipt, locationId: 'loc-wh', actualDeliveryDate: '2026-10-20',
      lines: [{ productId: 'shirt-l', quantity: 1 }], actor: 'receiver', createdAt: '2026-10-19T17:15:00Z' }];
    data.returns = [];
    const repo = makeRepo(data);
    vi.spyOn(repo, 'listQualityInspectionSummaries').mockResolvedValue({ rows: [] });
    vi.spyOn(repo, 'listHolds').mockResolvedValue({ rows: [{ id: 'date-hold', inspectionId: 'date-inspection',
      productId: 'shirt-l', locationId: 'loc-wh', quantity: 1, status: 'active', reason: 'Damaged',
      createdBy: 'quality', createdAt: '2026-10-19T17:15:00Z' }] });
    renderWithProviders(<QualityPage />, { repo });
    const list = await screen.findByRole('list', { name: 'Pending inspections' });
    expect(within(list).getByText(/Recorded:/)).toHaveTextContent('Oct 20, 2026, 1:15 AM (Asia/Manila)');
    await userEvent.click(screen.getByRole('tab', { name: 'Holds' }));
    expect(screen.getByText(/Hold created:/)).toHaveTextContent('Oct 20, 2026, 1:15 AM (Asia/Manila)');
    expect((await repo.getData()).receipts[0]!.actualDeliveryDate).toBe('2026-10-20');
  });

  it('hands a completed receipt source to all three exact inspections, not similarly named receipts', async () => {
    const { repo, save, batchSave } = await repositoryWithLinkedInspections(608);
    renderWithProviders(<QualityPage />, { repo, route: `/quality?source=${linkedReceipt}`, role: 'warehouse_operator' });
    const list = await screen.findByRole('list', { name: 'Completed inspections' });
    expect(screen.getByRole('tab', { name: 'Completed' })).toHaveAttribute('aria-selected', 'true');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getAllByText('accepted')).toHaveLength(2);
    expect(within(list).getByText('damaged')).toBeInTheDocument();
    expect(screen.getByText('3 of 75 completed inspections')).toBeInTheDocument();
    expect(screen.queryByText(/unavailable or outside your access/)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Pending' }));
    expect(screen.getByText('0 of 608 pending inspections')).toBeInTheDocument();
    expect(screen.queryByText(/unavailable or outside your access/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View Completed (3)' }));
    expect(screen.getByRole('list', { name: 'Completed inspections' })).toBeVisible();
    expect(save).not.toHaveBeenCalled();
    expect(batchSave).not.toHaveBeenCalled();
  });

  it('hands a receipt to its exact active holds and completed inspections without opening a mutation sheet', async () => {
    const { repo, locationId, save, batchSave } = await repositoryWithLinkedInspections();
    const hold: InventoryHold = { id: 'linked-hold', inspectionId: 'completed-2', productId: 'shirt-l',
      locationId, quantity: 1, status: 'active', reason: 'Damaged watch pending review',
      createdBy: 'inspector', createdAt: '2026-10-19T00:00:00Z' };
    vi.spyOn(repo, 'listHolds').mockResolvedValue({ rows: [hold, { ...hold, id: 'unrelated-hold',
      inspectionId: 'completed-3', reason: 'Different receipt hold' }] });
    const release = vi.spyOn(repo, 'releaseHold');
    renderWithProviders(<QualityPage />, { repo, route: `/quality?source=${linkedReceipt}`,
      source: 'supabase', capabilities: ['inspect_quality'], role: 'warehouse_operator' });
    const list = await screen.findByRole('list', { name: 'Active holds' });
    expect(screen.getByRole('tab', { name: 'Holds' })).toHaveAttribute('aria-selected', 'true');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('Damaged watch pending review')).toBeVisible();
    expect(screen.getByText('1 of 2 active holds')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review hold' })).not.toBeInTheDocument();
    expect(screen.queryByText(/unavailable or outside your access/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View Completed (3)' }));
    expect(within(screen.getByRole('list', { name: 'Completed inspections' })).getAllByRole('listitem')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'View Holds (1)' }));
    expect(screen.getByRole('list', { name: 'Active holds' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    expect(batchSave).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('shows every pending line for a mixed receipt source and keeps completed handover available', async () => {
    const { repo, rows, completed, save, batchSave } = await repositoryWithLinkedInspections();
    rows.push(...['first', 'second'].map(id => ({ ...completed[0]!, id, disposition: 'pending' as const })));
    renderWithProviders(<QualityPage />, { repo, route: `/quality?source=${linkedReceipt}`, role: 'warehouse_operator' });
    const list = await screen.findByRole('list', { name: 'Pending inspections' });
    expect(within(list).getAllByRole('button', { name: 'Inspect' })).toHaveLength(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View Completed (3)' }));
    expect(within(screen.getByRole('list', { name: 'Completed inspections' })).getAllByRole('listitem')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'View Pending (2)' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    expect(batchSave).not.toHaveBeenCalled();
  });

  it('recovers the completed source after a failed queue read without claiming an access denial', async () => {
    const { repo, load, save } = await repositoryWithLinkedInspections();
    load.mockRejectedValueOnce(new Error('Quality read failed'));
    renderWithProviders(<QualityPage />, { repo, route: `/quality?source=${linkedReceipt}`, role: 'warehouse_operator' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Quality read failed');
    expect(screen.queryByText(/unavailable or outside your access/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry quality queue' }));
    const list = await screen.findByRole('list', { name: 'Completed inspections' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'Completed' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/unavailable or outside your access/)).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('clears an unsubmitted batch when navigating to another exact receipt source', async () => {
    const { repo, rows, completed, save, batchSave } = await repositoryWithLinkedInspections();
    rows.push(...['first', 'second'].map(id => ({ ...completed[0]!, id, disposition: 'pending' as const })));
    rows.push({ ...completed[0]!, id: 'next-line', sourceId: 'next-receipt', disposition: 'pending' });
    let navigate!: ReturnType<typeof useNavigate>;
    function RoutedQuality() { navigate = useNavigate(); return <QualityPage />; }
    renderWithProviders(<RoutedQuality />, { repo, route: `/quality?source=${linkedReceipt}`, role: 'warehouse_operator' });
    await userEvent.click(await screen.findByRole('button', { name: 'Select group' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review selected inspections' }));
    expect(await screen.findByRole('dialog', { name: 'Review selected inspections' })).toBeVisible();
    await act(async () => navigate('/quality?source=next-receipt'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByLabelText('Inspection selection')).not.toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Pending inspections' });
    expect(within(list).getAllByRole('button', { name: 'Inspect' })).toHaveLength(1);
    expect(within(list).getByRole('checkbox')).not.toBeChecked();
    await act(async () => navigate(`/quality?source=${linkedReceipt}`));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Inspection selection')).not.toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
    expect(batchSave).not.toHaveBeenCalled();
  });

  it.each(['nonexistent', 'access-filtered'])('does not substitute another receipt for a %s source', async kind => {
    const { repo, rows, load, save } = await repositoryWithLinkedInspections();
    const source = kind === 'nonexistent' ? 'missing-receipt' : linkedReceipt;
    if (kind === 'access-filtered') load.mockResolvedValue({ rows: rows.filter(row => row.sourceId !== linkedReceipt) });
    renderWithProviders(<QualityPage />, { repo, route: `/quality?source=${source}`,
      source: 'supabase', capabilities: ['inspect_quality'], role: 'warehouse_operator' });
    expect(await screen.findByText('This source is unavailable or outside your access. No different item was selected.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^View (Pending|Holds|Completed)/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Completed' }));
    expect(screen.queryByRole('list', { name: 'Completed inspections' })).not.toBeInTheDocument();
    expect(screen.getByText(/unavailable or outside your access/)).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps batch selection within one exact source and does not save while reviewing', async () => {
    const data = await makeRepo().getData();
    data.receipts = []; data.returns = [];
    const repo = new InMemoryRepository(data);
    const receive = () => repo.receiveStock({ actor:'receiver', locationId:data.locations[0]!.id,
      lines:[{productId:'shirt-l',quantity:3}], receiptException:{type:'non_po',reason:'Test receipt',evidenceUrls:['test/evidence.pdf']} });
    await receive(); await receive();
    const save = vi.spyOn(repo, 'inspectQualityBatch');
    renderWithProviders(<QualityPage />, {repo,role:'warehouse_operator'});
    const user = userEvent.setup();
    const controls = await screen.findAllByRole('checkbox', {name:/^Select /});
    expect(controls).toHaveLength(2);
    await user.click(controls[0]!);
    expect(controls[1]).toBeDisabled();
    await user.click(screen.getByRole('button',{name:'Review selected inspections'}));
    const dialog = await screen.findByRole('dialog',{name:'Review selected inspections'});
    expect(within(dialog).getByRole('button',{name:'Submit 1 inspection'})).toBeDisabled();
    expect(save).not.toHaveBeenCalled();
  });
  it('shows conflicting inspection IDs as a retryable queue failure and recovers the exact source', async () => {
    const { repo, receipt } = await repositoryWithPendingReceipt();
    const row = {
      id: 'conflicting-source', sourceType: 'receipt' as const, sourceId: receipt.id,
      productId: 'shirt-l', quantity: 2, disposition: 'pending' as const,
      inspectedAt: '2026-09-01T00:00:00Z', inspectedBy: 'receiver', evidenceUrls: [],
    };
    const load = vi.spyOn(repo, 'listQualityInspections').mockResolvedValue({ rows: [row, { ...row, quantity: 1 }] });
    const inspect = vi.spyOn(repo, 'inspectQuality');
    renderWithProviders(<QualityPage />, { repo, route: '/quality?source=conflicting-source', role: 'warehouse_operator' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Conflicting inspection records');
    expect(screen.getByRole('heading', { name: 'Quality control' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inspect' })).not.toBeInTheDocument();
    expect(screen.queryByText('0 pending inspections')).not.toBeInTheDocument();
    expect(inspect).not.toHaveBeenCalled();
    load.mockResolvedValue({ rows: [row] });
    await userEvent.click(screen.getByRole('button', { name: 'Retry quality queue' }));
    const dialog = await screen.findByRole('dialog', { name: 'Inspect stock' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledWith({ limit: 100 });
    expect(inspect).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Pending inspections' })).toBeInTheDocument();
  });
  it('loads an old active hold beyond the first 100 through real repository pagination', async () => {
    const data = await makeRepo().getData();
    data.receipts = [];
    data.returns = [];
    let sequence = 0;
    const repo = new InMemoryRepository(data, {
      storage: null,
      now: () => '2026-01-01T00:00:00Z',
      id: prefix => `${prefix}-${String(++sequence).padStart(5, '0')}`,
    });
    const receipt = await repo.receiveStock({
      actor: 'receiver', locationId: data.locations.find(row => row.type === 'warehouse')!.id,
      lines: [{ productId: 'shirt-l', quantity: 107 }], evidenceUrls: [],
      receiptException: { type: 'non_po', reason: 'Local acceptance fixture', evidenceUrls: ['data:application/pdf;base64,fixture'] },
    });
    for (let index = 0; index < 101; index++) await repo.inspectQuality({
      idempotencyKey: `old-hold-boundary-${index}`, sourceType: 'receipt', sourceId: receipt.id,
      productId: 'shirt-l', quantity: 1, disposition: 'hold', reason: `Boundary hold ${index}`,
      evidenceUrls: ['data:image/png;base64,fixture'],
    });
    const first = await repo.listHolds({ limit: 100 });
    expect(first.rows).toHaveLength(100);
    const later = await repo.listHolds({ limit: 100, cursor: first.nextCursor });
    expect(later.rows).toHaveLength(1);
    expect(later.rows[0]?.reason).toBe('Boundary hold 0');
    renderWithProviders(<QualityPage />, { repo, role: 'warehouse_supervisor' });
    expect(await screen.findByText('1 pending inspections')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Holds' }));
    const holds = await screen.findByRole('list', { name: 'Active holds' });
    expect(within(holds).getAllByRole('listitem')).toHaveLength(101);
    expect(screen.getByText('101 active holds')).toBeInTheDocument();
    expect(screen.queryByText('1 pending inspections')).not.toBeInTheDocument();
    expect(within(holds).getByText('Boundary hold 0')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'Boundary hold 0');
    expect(within(holds).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('1 of 101 active holds')).toBeInTheDocument();
  });

  it('retains group search and current versus total counts after inspecting and switching tabs', async () => {
    const data = await makeRepo().getData();
    data.returns = [];
    data.receipts = Array.from({ length: 6 }, (_, index) => ({
      id: `group-receipt-${index}`, actor: 'receiver', locationId: data.locations[0]!.id,
      createdAt: '2026-01-01T00:00:00Z', lines: [
        { productId: 'shirt-l', quantity: 2 }, { productId: 'shirt-l', quantity: 3 },
      ],
    }));
    renderWithProviders(<QualityPage />, { repo: makeRepo(data), role: 'warehouse_operator' });
    expect(await screen.findByText('12 pending inspections')).toBeInTheDocument();
    const search = screen.getByRole('searchbox');
    await userEvent.type(search, 'group-receipt-4');
    expect(screen.getByText('2 of 12 pending inspections')).toBeInTheDocument();
    const queue = screen.getByRole('list', { name: 'Pending inspections' });
    expect(queue.querySelectorAll(':scope > li > details')).toHaveLength(1);
    expect(queue.querySelector('details')).toHaveAttribute('open');
    await userEvent.click(within(queue).getAllByRole('button', { name: 'Inspect' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Inspect stock' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(search).toHaveValue('group-receipt-4');
    await userEvent.click(screen.getByRole('tab', { name: 'Completed' }));
    expect(screen.getByText('0 of 0 completed inspections')).toBeInTheDocument();
    expect(screen.queryByText('12 pending inspections')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Pending' }));
    expect(search).toHaveValue('group-receipt-4');
    expect(screen.getByText('2 of 12 pending inspections')).toBeInTheDocument();
    await userEvent.clear(search);
    expect(screen.getByText('12 pending inspections')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Pending inspections' }).querySelectorAll(':scope > li > details')).toHaveLength(6);
  });

  it("opens the exact task inspection from a later queue page", async () => {
    const { repo, receipt } = await repositoryWithPendingReceipt();
    const staged = {
      sourceType: 'receipt' as const, sourceId: receipt.id, productId: 'shirt-l', quantity: 1,
      disposition: 'pending' as const, inspectedAt: '2026-09-01T00:00:00Z', inspectedBy: 'receiver', evidenceUrls: [],
    };
    vi.spyOn(repo, 'listQualityInspections').mockImplementation(async query => query?.cursor === 'older'
      ? { rows: [{ ...staged, id: 'target', serialNumber: 'TARGET-UNIT' }] }
      : { rows: [{ ...staged, id: 'first', serialNumber: 'FIRST' }], nextCursor: 'older' });
    renderWithProviders(<QualityPage />, { repo, route: '/quality?source=target', role: 'warehouse_operator' });
    const dialog = await screen.findByRole('dialog', { name: 'Inspect stock' });
    expect(within(dialog).getByText(/TARGET-UNIT/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/FIRST/)).not.toBeInTheDocument();
    expect(repo.listQualityInspections).toHaveBeenCalledWith({ limit: 100, cursor: 'older' });
  });

  it("does not substitute an unrelated inspection when a source is unavailable", async () => {
    const { repo } = await repositoryWithPendingReceipt();
    renderWithProviders(<QualityPage />, { repo, route: '/quality?source=missing', role: 'warehouse_operator' });
    expect(await screen.findByText(/No different item was selected/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it("separates live inspection and hold-release capabilities", async () => {
    const { repo, receipt } = await repositoryWithPendingReceipt();
    await repo.inspectQuality({
      idempotencyKey: "quality-minimal-hold-001",
      sourceType: "receipt",
      sourceId: receipt.id,
      productId: "shirt-l",
      quantity: 1,
      disposition: "hold",
      reason: "Review needed",
      evidenceUrls: ["data:image/png;base64,hold"],
    });
    const inspectOnly = renderWithProviders(<QualityPage />, {
      repo,
      role: "warehouse_operator",
      source: "supabase",
      capabilities: ["inspect_quality"],
    });
    expect(
      await screen.findAllByRole("button", { name: "Inspect" }),
    ).not.toHaveLength(0);
    await userEvent.click(screen.getByRole("tab", { name: "Holds" }));
    expect(
      screen.queryByRole("button", { name: "Review hold" }),
    ).not.toBeInTheDocument();
    inspectOnly.unmount();

    renderWithProviders(<QualityPage />, {
      repo,
      role: "warehouse_operator",
      source: "supabase",
      capabilities: ["release_quality_hold"],
    });
    expect(
      await screen.findByRole("tab", { name: "Pending" }),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: "Inspect" })).toHaveLength(
      0,
    );
    await userEvent.click(screen.getByRole("tab", { name: "Holds" }));
    expect(
      await screen.findByRole("button", { name: "Review hold" }),
    ).toBeInTheDocument();
  });

  it.each([
    ["warehouse_operator", /record inspection facts/i],
    ["warehouse_supervisor", /controlled exception disposition/i],
  ] as const)(
    "renders canonical %s quality responsibilities",
    async (role, expectedContent) => {
      renderWithProviders(<QualityPage />, { role });
      expect(await screen.findByText(expectedContent)).toBeInTheDocument();
    },
  );

  it("separates Operator fact capture from Supervisor exception disposition", async () => {
    const { repo } = await repositoryWithPendingReceipt();
    const { unmount } = renderWithProviders(<QualityPage />, {
      repo,
      role: "warehouse_operator",
    });
    expect(
      await screen.findByText(/record inspection facts/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Supervisor decides quarantine or rejection/i),
    ).toBeInTheDocument();
    unmount();

    renderWithProviders(<QualityPage />, {
      repo,
      role: "logistics_supervisor",
    });
    expect(
      await screen.findByText(/controlled exception disposition/i),
    ).toBeInTheDocument();
  });

  it("keeps a provisional receipt inspection in the queue and out of hold decisions", async () => {
    const { repo, receipt } = await repositoryWithPendingReceipt();
    const locationId = (await repo.getData()).locations.find(
      (location) => location.type === "warehouse",
    )!.id;
    vi.spyOn(repo, "listQualityInspections").mockResolvedValue({
      rows: [{
        id: "pending-receipt-inspection",
        sourceType: "receipt",
        sourceId: receipt.id,
        productId: "shirt-l",
        quantity: 2,
        disposition: "pending",
        reason: "Awaiting independent quality inspection",
        evidenceUrls: [],
        inspectedBy: "receiver@mwell.com.ph",
        inspectedAt: "2026-08-15T00:00:00Z",
      }],
      total: 1,
    });
    vi.spyOn(repo, "listHolds").mockResolvedValue({
      rows: [{
        id: "pending-receipt-hold",
        inspectionId: "pending-receipt-inspection",
        productId: "shirt-l",
        locationId,
        quantity: 2,
        status: "active",
        reason: "Awaiting independent quality inspection",
        createdBy: "receiver@mwell.com.ph",
        createdAt: "2026-08-15T00:00:00Z",
      }],
      total: 1,
    });

    renderWithProviders(<QualityPage />, { repo, role: "warehouse_operator" });
    const queue = await screen.findByLabelText("Pending inspections");
    expect(within(queue).getByText((content) => content.includes(receipt.id)))
      .toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Holds" }));
    expect(await screen.findByText("No active holds")).toBeInTheDocument();
  });

  it("presents serialized provisional custody as an exact serial inspection task", async () => {
    const user = userEvent.setup();
    const { repo, receipt } = await repositoryWithPendingReceipt();
    const inspect = vi.spyOn(repo, "inspectQuality");
    vi.spyOn(repo, "listQualityInspections").mockResolvedValue({
      rows: [{
        id: "pending-serialized-inspection",
        sourceType: "receipt",
        sourceId: receipt.id,
        productId: "shirt-l",
        procurementPoLineId: "po-line-serialized",
        serialNumber: "RING-0001",
        quantity: 1,
        disposition: "pending",
        reason: "Awaiting independent quality inspection",
        evidenceUrls: [],
        inspectedBy: "receiver@mwell.com.ph",
        inspectedAt: "2026-08-26T00:00:00Z",
      }],
      total: 1,
    });

    renderWithProviders(<QualityPage />, { repo, role: "warehouse_operator" });
    const queue = await screen.findByLabelText("Pending inspections");
    const serialText = within(queue).getByText(/serial RING-0001/i);
    expect(serialText).toBeInTheDocument();
    await user.click(within(serialText.closest("li")!).getByRole("button", { name: "Inspect" }));
    const dialog = await screen.findByRole("dialog", { name: "Inspect stock" });
    expect(within(dialog).getByText(/serial RING-0001/i)).toBeInTheDocument();
    await user.upload(
      within(dialog).getByLabelText("Attach inspection evidence"),
      new File(["proof"], "proof.png", { type: "image/png" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Submit inspection" }));

    await waitFor(() => expect(inspect).toHaveBeenCalledWith(expect.objectContaining({
      procurementPoLineId: "po-line-serialized",
      serialNumber: "RING-0001",
      quantity: 1,
    })));
  });

  it("holds a pending receipt only after reason and evidence are supplied", async () => {
    const user = userEvent.setup();
    const { repo, receipt } = await repositoryWithPendingReceipt();
    renderWithProviders(<QualityPage />, { repo, role: "warehouse_operator" });

    const queue = await screen.findByLabelText("Pending inspections");
    const sourceText = within(queue).getByText((content) =>
      content.includes(receipt.id),
    );
    const sourceRow = sourceText.closest("li");
    expect(sourceRow).not.toBeNull();
    const inspect = within(sourceRow!).getByRole("button", { name: "Inspect" });
    await user.click(inspect);

    const dialog = await screen.findByRole("dialog", { name: "Inspect stock" });
    await user.selectOptions(
      within(dialog).getByLabelText("Disposition"),
      "hold",
    );
    expect(
      within(dialog).getByRole("button", { name: "Submit inspection" }),
    ).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText("Reason"),
      "Packaging seal is broken",
    );
    await user.upload(
      within(dialog).getByLabelText("Attach inspection evidence"),
      new File(["proof"], "proof.png", { type: "image/png" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Submit inspection" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Inspect stock" }),
      ).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("tab", { name: "Holds" }));
    expect(
      await screen.findByText("Packaging seal is broken"),
    ).toBeInTheDocument();
    expect(screen.getByText("On hold")).toBeInTheDocument();
  });

  it("shows hold custody and requires evidence before release", async () => {
    const user = userEvent.setup();
    const { repo, receipt } = await repositoryWithPendingReceipt();
    await repo.inspectQuality({
      idempotencyKey: "quality-test-hold-001",
      sourceType: "receipt",
      sourceId: receipt.id,
      productId: "shirt-l",
      quantity: 1,
      disposition: "hold",
      reason: "Awaiting supplier confirmation",
      evidenceUrls: ["data:image/png;base64,hold"],
    });
    renderWithProviders(<QualityPage />, {
      repo,
      role: "logistics_supervisor",
    });

    await user.click(await screen.findByRole("tab", { name: "Holds" }));
    const holds = await screen.findByLabelText("Active holds");
    expect(within(holds).getByText(/created by/i)).toBeInTheDocument();
    await user.click(
      within(holds).getByRole("button", { name: "Review hold" }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: "Review inventory hold",
    });
    expect(
      within(dialog).getByText(/separation of duties/i),
    ).toBeInTheDocument();
    await user.type(
      within(dialog).getByLabelText("Release reason"),
      "Supplier approved the packaging variance",
    );
    expect(
      within(dialog).getByRole("button", { name: "Release as accepted" }),
    ).toBeDisabled();
  });

  it("queues physical returns for inspection before putaway", async () => {
    const repo = makeRepo();
    const data = await repo.getData();
    await repo.recordReturn({
      actor: "returns@mwell.com.ph",
      source: "customer",
      lines: [
        {
          productId: "shirt-l",
          quantity: 1,
          reason: "unused / surplus",
          locationId: data.locations.find(
            (location) => location.type === "warehouse",
          )!.id,
        },
      ],
      evidenceUrls: ["data:image/png;base64,return"],
    });
    renderWithProviders(<QualityPage />, { repo, role: "warehouse_operator" });

    const queue = await screen.findByLabelText("Pending inspections");
    expect(within(queue).getAllByText(/return/i).length).toBeGreaterThan(0);
    expect(
      within(queue).getAllByText(/event shirt \(l\)/i).length,
    ).toBeGreaterThan(0);
  });

  it("creates an evidence-backed vendor return from a rejected hold", async () => {
    const user = userEvent.setup();
    const { repo, receipt } = await repositoryWithPendingReceipt();
    await repo.inspectQuality({
      idempotencyKey: "quality-vendor-ui-001",
      sourceType: "receipt",
      sourceId: receipt.id,
      productId: "shirt-l",
      quantity: 1,
      disposition: "vendor_return",
      reason: "Wrong item supplied",
      evidenceUrls: ["data:image/png;base64,rejected"],
    });
    renderWithProviders(<QualityPage />, {
      repo,
      role: "warehouse_operator",
      source: "supabase",
      capabilities: ["manage_returns"],
    });

    await user.click(await screen.findByRole("tab", { name: "Holds" }));
    await user.click(
      within(await screen.findByLabelText("Active holds")).getByRole("button", {
        name: "Review hold",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Review inventory hold",
    });
    expect(within(dialog).getByLabelText("Supplier")).toHaveValue(
      (await repo.getData()).suppliers[0]!.id,
    );
    await user.type(
      within(dialog).getByLabelText("Vendor return reference"),
      "RMA-UI-001",
    );
    await user.type(
      within(dialog).getByLabelText("Vendor return reason"),
      "Rejected at incoming inspection",
    );
    await user.upload(
      within(dialog).getByLabelText("Attach vendor return evidence"),
      new File(["rma"], "rma.png", { type: "image/png" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create vendor return" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Review inventory hold" }),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByText("RMA-UI-001")).toBeInTheDocument();
    expect(screen.getByText("Ready for handoff")).toBeInTheDocument();
  });
});
