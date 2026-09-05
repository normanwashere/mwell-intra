import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QualityPage } from "./QualityPage";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";
import { InMemoryRepository } from '@/data/inMemoryRepository';

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
    expect(within(holds).getByText('Boundary hold 0')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'Boundary hold 0');
    expect(within(holds).getAllByRole('listitem')).toHaveLength(1);
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
    expect(queue.querySelectorAll('details')).toHaveLength(1);
    expect(queue.querySelector('details')).toHaveAttribute('open');
    await userEvent.click(within(queue).getAllByRole('button', { name: 'Inspect' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Inspect stock' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(search).toHaveValue('group-receipt-4');
    await userEvent.click(screen.getByRole('tab', { name: 'Completed' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Pending' }));
    expect(search).toHaveValue('group-receipt-4');
    expect(screen.getByText('2 of 12 pending inspections')).toBeInTheDocument();
    await userEvent.clear(search);
    expect(screen.getByText('12 pending inspections')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Pending inspections' }).querySelectorAll('details')).toHaveLength(6);
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
    const sourceRow = sourceText.closest("details");
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
