import { describe, it, expect, vi } from "vitest";
import { buildSeed } from "@intra/data-kit";
import { Route, Routes } from "react-router-dom";
import { act, fireEvent, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductDetailPage } from "./ProductDetailPage";
import { renderWithProviders } from "@/test/renderWithProviders";
import { makeRepo } from "@/test/renderWithProviders";

import type { Role } from "@/domain/types";
import type { InventoryHold } from "@intra/data-kit";

async function scanRelocation(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, serial: string) {
  await user.type(within(dialog).getByLabelText("Enter barcode manually"), serial);
  await user.click(within(dialog).getByRole("button", { name: "Add" }));
}

function relocationHold(overrides: Partial<InventoryHold> = {}): InventoryHold {
  return { id: "hold-relocation", inspectionId: "inspection-relocation", productId: "smart-watch",
    locationId: "loc-wh", serialNumber: "SMART-WATCH-SN0001", quantity: 1, status: "active",
    reason: "Quality review", createdBy: "quality-reviewer", createdAt: "2026-09-09T00:00:00Z", ...overrides };
}

function renderDetail(id: string, role: Role = "logistics_supervisor") {
  return renderWithProviders(
    <Routes>
      <Route path="/inventory/:id" element={<ProductDetailPage />} />
    </Routes>,
    { route: `/inventory/${id}`, role },
  );
}

describe("ProductDetailPage", () => {
  it("removes one relocation serial, allows rescanning it, and submits only remaining selections", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    const move = vi.spyOn(repo, "relocate");
    renderWithProviders(<Routes><Route path="/inventory/:id" element={<ProductDetailPage />} /></Routes>, { repo, route: "/inventory/smart-watch" });
    await user.click(await screen.findByRole("button", { name: /relocate/i }));
    const dialog = await screen.findByRole("dialog", { name: "Relocate stock" });
    await scanRelocation(user, dialog, "SMART-WATCH-SN0001");
    await scanRelocation(user, dialog, "SMART-WATCH-SN0002");
    await user.click(within(dialog).getByRole("button", { name: "Remove SMART-WATCH-SN0001" }));
    expect(within(dialog).getByRole("list", { name: "Accepted scans" })).not.toHaveTextContent("SMART-WATCH-SN0001");
    await scanRelocation(user, dialog, "SMART-WATCH-SN0001");
    expect(within(dialog).getByRole("list", { name: "Accepted scans" })).toHaveTextContent("SMART-WATCH-SN0001");
    await user.click(within(dialog).getByRole("button", { name: "Remove SMART-WATCH-SN0002" }));
    await user.selectOptions(within(dialog).getByLabelText("To bin"), "bin-pasig-a1");
    await user.click(within(dialog).getByRole("button", { name: "Move stock" }));
    await waitFor(() => expect(move).toHaveBeenCalledWith(expect.objectContaining({ quantity: 1, serialNumbers: ["SMART-WATCH-SN0001"] })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /relocate/i }));
    expect(within(await screen.findByRole("dialog")).queryByRole("list", { name: "Accepted scans" })).not.toBeInTheDocument();
  });

  it("preserves the relocation draft on Escape and restores it after remount only for its scope", async () => {
    const user = userEvent.setup();
    const mounted = renderDetail("smart-watch");
    await user.click(await screen.findByRole("button", { name: /relocate/i }));
    let dialog = await screen.findByRole("dialog", { name: "Relocate stock" });
    await scanRelocation(user, dialog, "SMART-WATCH-SN0001");
    await user.selectOptions(within(dialog).getByLabelText("To bin"), "bin-pasig-a1");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /relocate/i }));
    dialog = await screen.findByRole("dialog", { name: "Relocate stock" });
    expect(within(dialog).getByLabelText("To bin")).toHaveValue("bin-pasig-a1");
    expect(within(dialog).getByRole("list", { name: "Accepted scans" })).toHaveTextContent("SMART-WATCH-SN0001");
    mounted.unmount();
    const otherProduct = renderDetail("shirt-l");
    await user.click(await screen.findByRole("button", { name: /relocate/i }));
    expect(within(await screen.findByRole("dialog")).queryByRole("button", { name: "Resume draft" })).not.toBeInTheDocument();
    otherProduct.unmount();
    const otherOperator = renderDetail("smart-watch", "warehouse_supervisor");
    await user.click(await screen.findByRole("button", { name: /relocate/i }));
    expect(within(await screen.findByRole("dialog")).queryByRole("button", { name: "Resume draft" })).not.toBeInTheDocument();
    otherOperator.unmount();
    renderDetail("smart-watch");
    await user.click(await screen.findByRole("button", { name: /relocate/i }));
    dialog = await screen.findByRole("dialog", { name: "Relocate stock" });
    expect(within(dialog).getByRole("button", { name: "Move stock" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Resume draft" }));
    expect(within(dialog).getByLabelText("To bin")).toHaveValue("bin-pasig-a1");
    expect(within(dialog).getByRole("list", { name: "Accepted scans" })).toHaveTextContent("SMART-WATCH-SN0001");
    await user.click(within(dialog).getByRole("button", { name: "Discard draft" }));
    expect(within(dialog).queryByRole("list", { name: "Accepted scans" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Move stock" })).toBeDisabled();
  });

  it("preserves bulk relocation quantity across close and reopen", async () => {
    const user = userEvent.setup();
    renderDetail("shirt-l");
    await user.click(await screen.findByRole("button", { name: /relocate/i }));
    const dialog = await screen.findByRole("dialog", { name: "Relocate stock" });
    fireEvent.change(within(dialog).getByLabelText("Relocate quantity"), { target: { value: "7" } });
    await user.selectOptions(within(dialog).getByLabelText("To bin"), "bin-pasig-a1");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /relocate/i }));
    expect(within(await screen.findByRole("dialog")).getByLabelText("Relocate quantity")).toHaveValue(7);
  });

  it.each([
    ["Quality review", /SMART-WATCH-SN0001 cannot be moved because it is on hold/i, /warehouse supervisor/],
    ["Awaiting independent quality inspection", /SMART-WATCH-SN0001 is waiting for inspection/i, /other than the receiver.*Quality Control > Pending/],
  ])("blocks a selected serial with %s and explains who can help without clearing it", async (reason, message, nextStep) => {
    const user = userEvent.setup();
    const repo = makeRepo();
    const holds = vi.spyOn(repo, "listHolds").mockImplementation(async ({ cursor }) => cursor
      ? { rows: [relocationHold({ reason })], total: 101 }
      : { rows: Array.from({ length: 100 }, (_, i) => relocationHold({ id: `other-${i}`, productId: "shirt-l" })), nextCursor: "100", total: 101 });
    const move = vi.spyOn(repo, "relocate");
    const release = vi.spyOn(repo, "releaseHold");
    renderWithProviders(<Routes><Route path="/inventory/:id" element={<ProductDetailPage />} /></Routes>, { repo, route: "/inventory/smart-watch" });
    await user.click(await screen.findByRole("button", { name: /relocate/i }));
    const dialog = await screen.findByRole("dialog", { name: "Relocate stock" });
    await scanRelocation(user, dialog, "SMART-WATCH-SN0001");
    await user.selectOptions(within(dialog).getByLabelText("To bin"), "bin-pasig-a1");
    await user.click(within(dialog).getByRole("button", { name: "Move stock" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent(message));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(nextStep);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/nothing was moved/i);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/quality/i);
    expect(within(dialog).getByRole("list", { name: "Accepted scans" })).toHaveTextContent("SMART-WATCH-SN0001");
    expect(holds).toHaveBeenCalledWith(expect.objectContaining({ cursor: "100" }));
    expect(move).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("fails closed when holds cannot be checked and retains the draft for a fresh preflight", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    vi.spyOn(repo, "listHolds").mockRejectedValueOnce(new Error("offline"));
    const move = vi.spyOn(repo, "relocate");
    renderWithProviders(<Routes><Route path="/inventory/:id" element={<ProductDetailPage />} /></Routes>, { repo, route: "/inventory/smart-watch" });
    await user.click(await screen.findByRole("button", { name: /relocate/i }));
    const dialog = await screen.findByRole("dialog", { name: "Relocate stock" });
    await scanRelocation(user, dialog, "SMART-WATCH-SN0001");
    await user.selectOptions(within(dialog).getByLabelText("To bin"), "bin-pasig-a1");
    await user.click(within(dialog).getByRole("button", { name: "Move stock" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent(/holds could not be checked/i));
    expect(move).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Move stock" }));
    await waitFor(() => expect(move).toHaveBeenCalledTimes(1));
  });

  it("does not block relocation for released holds or holds on another serial", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    vi.spyOn(repo, "listHolds").mockResolvedValue({ rows: [relocationHold({ status: "released" }), relocationHold({ id: "other", serialNumber: "SMART-WATCH-SN0002" })] });
    renderWithProviders(<Routes><Route path="/inventory/:id" element={<ProductDetailPage />} /></Routes>, { repo, route: "/inventory/smart-watch" });
    await user.click(await screen.findByRole("button", { name: /relocate/i }));
    const dialog = await screen.findByRole("dialog", { name: "Relocate stock" });
    await scanRelocation(user, dialog, "SMART-WATCH-SN0001");
    await user.selectOptions(within(dialog).getByLabelText("To bin"), "bin-pasig-a1");
    await user.click(within(dialog).getByRole("button", { name: "Move stock" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect((await repo.getData()).units.find(unit => unit.serialNumber === "SMART-WATCH-SN0001")?.binId).toBe("bin-pasig-a1");
  });

  it("blocks held bulk quantity only in the exact source bin and lot", async () => {
    const user = userEvent.setup();
    const seed = structuredClone(buildSeed());
    seed.stockLevels = [{ productId: "shirt-l", locationId: "loc-wh", quantity: 5, unavailable: 4 }];
    const repo = makeRepo(seed);
    vi.spyOn(repo, "listHolds").mockResolvedValue({ rows: [
      relocationHold({ productId: "shirt-l", serialNumber: undefined, quantity: 4 }),
      relocationHold({ id: "other-bin", productId: "shirt-l", serialNumber: undefined, binId: "bin-pasig-a1", quantity: 100 }),
      relocationHold({ id: "other-lot", productId: "shirt-l", serialNumber: undefined, lotId: "other-lot", quantity: 100 }),
    ] });
    const move = vi.spyOn(repo, "relocate");
    renderWithProviders(<Routes><Route path="/inventory/:id" element={<ProductDetailPage />} /></Routes>, { repo, route: "/inventory/shirt-l" });
    await user.click(await screen.findByRole("button", { name: /relocate/i }));
    const dialog = await screen.findByRole("dialog", { name: "Relocate stock" });
    await user.selectOptions(within(dialog).getByLabelText("To bin"), "bin-pasig-a1");
    fireEvent.change(within(dialog).getByLabelText("Relocate quantity"), { target: { value: "2" } });
    await user.click(within(dialog).getByRole("button", { name: "Move stock" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/only 1.*active holds/i);
    expect(move).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText("Relocate quantity"), { target: { value: "1" } });
    await user.click(within(dialog).getByRole("button", { name: "Move stock" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect((await repo.getData()).stockLevels.find(row => !row.binId)?.quantity).toBe(4);
  });

  it("freezes selections during hold preflight and stops after a product scope unmount", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    let resolveHolds!: (value: { rows: InventoryHold[] }) => void;
    const holds = vi.spyOn(repo, "listHolds").mockImplementation(() => new Promise(resolve => { resolveHolds = resolve; }));
    const move = vi.spyOn(repo, "relocate");
    const mounted = renderWithProviders(<Routes><Route path="/inventory/:id" element={<ProductDetailPage />} /></Routes>, { repo, route: "/inventory/smart-watch" });
    await user.click(await screen.findByRole("button", { name: /relocate/i }));
    const dialog = await screen.findByRole("dialog", { name: "Relocate stock" });
    await scanRelocation(user, dialog, "SMART-WATCH-SN0001");
    await user.selectOptions(within(dialog).getByLabelText("To bin"), "bin-pasig-a1");
    fireEvent.click(within(dialog).getByRole("button", { name: "Move stock" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Move stock" }));
    expect(holds).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole("button", { name: "Remove SMART-WATCH-SN0001" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Discard draft" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(dialog).toBeInTheDocument();
    mounted.unmount();
    await act(async () => resolveHolds({ rows: [] }));
    expect(move).not.toHaveBeenCalled();
  });

  it("does not treat invisible live holds as an empty hold population", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    const move = vi.spyOn(repo, "relocate");
    renderWithProviders(<Routes><Route path="/inventory/:id" element={<ProductDetailPage />} /></Routes>, {
      repo, route: "/inventory/smart-watch", source: "supabase", capabilities: ["transfer_stock"],
    });
    await user.click(await screen.findByRole("button", { name: /relocate/i }));
    const dialog = await screen.findByRole("dialog", { name: "Relocate stock" });
    await scanRelocation(user, dialog, "SMART-WATCH-SN0001");
    await user.selectOptions(within(dialog).getByLabelText("To bin"), "bin-pasig-a1");
    await user.click(within(dialog).getByRole("button", { name: "Move stock" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/holds cannot be verified.*access/i);
    expect(move).not.toHaveBeenCalled();
  });

  it("revalidates restored serial custody before submitting a saved draft", async () => {
    const user = userEvent.setup();
    const mounted = renderDetail("smart-watch");
    await user.click(await screen.findByRole("button", { name: /relocate/i }));
    let dialog = await screen.findByRole("dialog", { name: "Relocate stock" });
    await scanRelocation(user, dialog, "SMART-WATCH-SN0001");
    await user.selectOptions(within(dialog).getByLabelText("To bin"), "bin-pasig-a1");
    mounted.unmount();
    const seed = structuredClone(buildSeed());
    seed.units.find(unit => unit.serialNumber === "SMART-WATCH-SN0001")!.binId = "bin-pasig-a2";
    const repo = makeRepo(seed);
    const move = vi.spyOn(repo, "relocate");
    renderWithProviders(<Routes><Route path="/inventory/:id" element={<ProductDetailPage />} /></Routes>, { repo, route: "/inventory/smart-watch" });
    await user.click(await screen.findByRole("button", { name: /relocate/i }));
    dialog = await screen.findByRole("dialog", { name: "Relocate stock" });
    await user.click(within(dialog).getByRole("button", { name: "Resume draft" }));
    await user.click(within(dialog).getByRole("button", { name: "Move stock" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/source bin/i);
    expect(move).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("list", { name: "Accepted scans" })).toHaveTextContent("SMART-WATCH-SN0001");
  });

  it("loads every serialized unit and combines bin and text filtering", async () => {
    const user = userEvent.setup();
    const seed = structuredClone(buildSeed());
    const template = seed.units.find(unit => unit.productId === "smart-watch")!;
    seed.units = Array.from({ length: 65 }, (_, i) => ({ ...template, id: `unit-${i}`, serialNumber: `PAGE-${String(i + 1).padStart(3, "0")}`, binId: i < 60 ? "bin-pasig-a1" : undefined }));
    renderWithProviders(<Routes><Route path="/inventory/:id" element={<ProductDetailPage />} /></Routes>, { repo: makeRepo(seed), route: "/inventory/smart-watch" });
    const units = await screen.findByRole("list", { name: "Serialized units" });
    expect(within(units).getAllByRole("listitem")).toHaveLength(30);
    await user.click(screen.getByRole("button", { name: "Load more units" }));
    await user.click(screen.getByRole("button", { name: "Load more units" }));
    expect(within(units).getAllByRole("listitem")).toHaveLength(65);
    expect(screen.queryByRole("button", { name: "Load more units" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Filter units by bin"), "bin-pasig-a1");
    expect(within(units).getAllByRole("listitem")).toHaveLength(30);
    expect(within(units).getByText("PAGE-001").closest("button")).toHaveTextContent("PASIG-A-01");
    await user.type(screen.getByLabelText("Filter serialized units"), "PAGE-065");
    expect(screen.getByText("No matching units")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Filter units by bin"), "general");
    expect(within(await screen.findByRole("list", { name: "Serialized units" })).getByText("PAGE-065")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Filter serialized units"));
    expect(within(screen.getByRole("list", { name: "Serialized units" })).getAllByRole("listitem")).toHaveLength(5);
  });

  it("presents complete long product metadata as labeled details rather than status chips", async () => {
    const seed = structuredClone(buildSeed());
    const product = seed.products.find((item) => item.id === "smart-watch")!;
    const purpose = "Synthetic departmental merchandise for accountable handover and reconciliation";
    const costBasis = "SEED-COST-BASIS-".repeat(12);
    product.attributes = { purpose, cost_basis: costBasis };
    renderWithProviders(<Routes><Route path="/inventory/:id" element={<ProductDetailPage />} /></Routes>, { repo: makeRepo(seed), route: "/inventory/smart-watch" });
    const metadata = await screen.findByRole("region", { name: "Product details" });
    expect(within(metadata).getByText("purpose").tagName).toBe("DT");
    expect(within(metadata).getByText(purpose).tagName).toBe("DD");
    expect(within(metadata).getByText(costBasis).tagName).toBe("DD");
    expect(within(metadata).getByText(costBasis)).not.toHaveClass("chip");
    expect(screen.getByRole("heading", { name: product.name, level: 1 })).toBeVisible();
  });

  it("relocates only the scanned serial from the exact source bin", async () => {
    const user = userEvent.setup();
    const seed = structuredClone(buildSeed());
    const target = seed.units.find((unit) => unit.serialNumber === "SMART-WATCH-SN0001")!;
    const other = seed.units.find((unit) => unit.productId === target.productId && unit.serialNumber !== target.serialNumber)!;
    target.binId = undefined;
    other.locationId = target.locationId;
    other.binId = "bin-pasig-a1";
    const repo = makeRepo(seed);
    const move = vi.spyOn(repo, "relocate");
    renderWithProviders(<Routes><Route path="/inventory/:id" element={<ProductDetailPage />} /></Routes>, { repo, route: "/inventory/smart-watch" });
    await user.click(await screen.findByRole("button", { name: /relocate/i }));
    const dialog = await screen.findByRole("dialog", { name: "Relocate stock" });
    const submit = within(dialog).getByRole("button", { name: "Move stock" });
    expect(submit).toBeDisabled();
    const scan = async (serial: string) => {
      await user.type(within(dialog).getByLabelText("Enter barcode manually"), serial);
      await user.click(within(dialog).getByRole("button", { name: "Add" }));
    };
    await scan(other.serialNumber);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/source bin/i);
    expect(submit).toBeDisabled();
    await scan(target.serialNumber);
    await scan(target.serialNumber);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/already scanned/i);
    await user.selectOptions(within(dialog).getByLabelText("To bin"), "bin-pasig-a1");
    await user.click(submit);
    await waitFor(() => expect(move).toHaveBeenCalledTimes(1));
    expect(move).toHaveBeenCalledWith(expect.objectContaining({ productId: target.productId, locationId: target.locationId, fromBinId: undefined, toBinId: "bin-pasig-a1", quantity: 1, serialNumbers: [target.serialNumber] }));
    expect((await repo.getData()).units.find((unit) => unit.serialNumber === target.serialNumber)?.binId).toBe("bin-pasig-a1");
  });

  it("clears relocation serials when the source bin changes", async () => {
    const user = userEvent.setup();
    renderDetail("smart-watch");
    await user.click(await screen.findByRole("button", { name: /relocate/i }));
    const dialog = await screen.findByRole("dialog", { name: "Relocate stock" });
    await user.type(within(dialog).getByLabelText("Enter barcode manually"), "SMART-WATCH-SN0001");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getByRole("list", { name: "Accepted scans" })).toHaveTextContent("SMART-WATCH-SN0001");
    await user.selectOptions(within(dialog).getByLabelText("From bin"), "bin-pasig-a1");
    expect(within(dialog).queryByRole("list", { name: "Accepted scans" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Move stock" })).toBeDisabled();
  });

  it("keeps exact relocation custody frozen while saving and preserves server rejection", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    let rejectMove!: (reason: Error) => void;
    const move = vi.spyOn(repo, "relocate").mockImplementation(() => new Promise((_resolve, reject) => { rejectMove = reject; }));
    renderWithProviders(<Routes><Route path="/inventory/:id" element={<ProductDetailPage />} /></Routes>, { repo, route: "/inventory/smart-watch" });
    await user.click(await screen.findByRole("button", { name: /relocate/i }));
    const dialog = await screen.findByRole("dialog", { name: "Relocate stock" });
    await user.type(within(dialog).getByLabelText("Enter barcode manually"), "SMART-WATCH-SN0001");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await user.selectOptions(within(dialog).getByLabelText("To bin"), "bin-pasig-a1");
    const submit = within(dialog).getByRole("button", { name: "Move stock" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(move).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByLabelText("From bin")).toBeDisabled();
    expect(within(dialog).getByLabelText("To bin")).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Remove SMART-WATCH-SN0001" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(dialog).toBeInTheDocument();
    await act(async () => rejectMove(new Error("Held serialized inventory cannot be transferred")));
    await screen.findByText(/This stock is on a Quality hold/);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/not confirmed/i);
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/movement history before trying again/i);
    expect(within(dialog).getByRole("list", { name: "Accepted scans" })).toHaveTextContent("SMART-WATCH-SN0001");
    expect((await repo.getData()).units.find((unit) => unit.serialNumber === "SMART-WATCH-SN0001")?.binId).toBeUndefined();
  });

  it("rejects wrong-product and unavailable serials before relocating", async () => {
    const user = userEvent.setup();
    const seed = structuredClone(buildSeed());
    seed.units.find((unit) => unit.serialNumber === "SMART-WATCH-SN0001")!.status = "pending_inspection";
    const repo = makeRepo(seed);
    const move = vi.spyOn(repo, "relocate");
    renderWithProviders(<Routes><Route path="/inventory/:id" element={<ProductDetailPage />} /></Routes>, { repo, route: "/inventory/smart-watch" });
    await user.click(await screen.findByRole("button", { name: /relocate/i }));
    const dialog = await screen.findByRole("dialog", { name: "Relocate stock" });
    for (const serial of ["ECG-RING-6-SN0003", "SMART-WATCH-SN0001"]) {
      await user.type(within(dialog).getByLabelText("Enter barcode manually"), serial);
      await user.click(within(dialog).getByRole("button", { name: "Add" }));
      expect(within(dialog).getByRole("alert")).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: "Move stock" })).toBeDisabled();
    }
    expect(move).not.toHaveBeenCalled();
  });

  it("shows product header, stock by location and serialized units", async () => {
    renderDetail("ecg-ring-10");
    expect(
      await screen.findByRole("heading", { name: /ECG Ring \(Size 10\)/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Stock by location")).toBeInTheDocument();
    expect(screen.getByLabelText("Serialized units")).toBeInTheDocument();
    expect(screen.getByLabelText("Movement history")).toBeInTheDocument();
  });

  it("shows shelf-life risk on the product record", async () => {
    const seed = await makeRepo().getData();
    seed.products = seed.products.map((product) =>
      product.id === "doctor-token"
        ? { ...product, expiryTracked: true, shelfLifeWarningDays: 30 }
        : product,
    );
    seed.lots.push({
      id: "lot-expired-detail",
      productId: "doctor-token",
      lotCode: "EXP-DETAIL",
      unitCost: 10,
      receivedAt: "2026-06-01T00:00:00Z",
      expiryDate: "2026-07-09",
    });
    renderWithProviders(
      <Routes>
        <Route path="/inventory/:id" element={<ProductDetailPage />} />
      </Routes>,
      { route: "/inventory/doctor-token", repo: makeRepo(seed) },
    );
    expect(await screen.findByText("Expired")).toBeInTheDocument();
  });

  it("opens a unit traceability timeline", async () => {
    const user = userEvent.setup();
    renderDetail("ecg-ring-10");
    const units = await screen.findByLabelText("Serialized units");
    const unitBtn = within(units).getAllByRole("button")[0];
    expect(unitBtn).toBeDefined();
    await user.click(unitBtn!);
    expect(
      await screen.findByRole("dialog", { name: /unit traceability/i }),
    ).toBeInTheDocument();
  });

  it("filters serialized units by query", async () => {
    const user = userEvent.setup();
    renderDetail("smart-watch");
    const units = await screen.findByLabelText("Serialized units");
    expect(within(units).getByText("SMART-WATCH-SN0001")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/filter serialized units/i), "CB");
    const filtered = screen.getByLabelText("Serialized units");
    expect(
      within(filtered).getByText("SMART-WATCH-CB0001"),
    ).toBeInTheDocument();
    expect(
      within(filtered).queryByText("SMART-WATCH-SN0001"),
    ).not.toBeInTheDocument();
  });

  it("transfers stock between locations", async () => {
    const user = userEvent.setup();
    renderDetail("shirt-l", "logistics_supervisor");
    await screen.findByRole("heading", { name: /Event Shirt \(L\)/i });

    await user.click(screen.getByRole("button", { name: /transfer/i }));
    const dialog = await screen.findByRole("dialog", {
      name: /transfer stock/i,
    });
    await user.selectOptions(within(dialog).getByLabelText("To"), "loc-cebu");
    await user.click(
      within(dialog).getByRole("button", { name: /confirm transfer/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/transferred/i)).toBeInTheDocument();
    });
  });

  it("transfers the exact serialized unit selected by scan", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    renderWithProviders(
      <Routes>
        <Route path="/inventory/:id" element={<ProductDetailPage />} />
      </Routes>,
      { route: "/inventory/smart-watch", role: "logistics_supervisor", repo },
    );
    await screen.findByRole("heading", { name: /mWellness Smart Watch/i });
    await user.click(screen.getByRole("button", { name: /transfer/i }));
    const dialog = await screen.findByRole("dialog", {
      name: /transfer stock/i,
    });
    const manual = within(dialog).getByLabelText("Enter barcode manually");

    await user.type(manual, "ECG-RING-6-SN0003");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /does not match/i,
    );

    await user.type(manual, "SMART-WATCH-SN0001");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    await user.selectOptions(within(dialog).getByLabelText("To"), "loc-cebu");
    await user.click(
      within(dialog).getByRole("button", { name: /confirm transfer/i }),
    );

    await waitFor(async () => {
      const unit = (await repo.getData()).units.find(
        (row) => row.serialNumber === "SMART-WATCH-SN0001",
      );
      expect(unit?.locationId).toBe("loc-cebu");
    });
  });

  it("hides the transfer action for finance", async () => {
    renderDetail("shirt-l", "finance");
    await screen.findByRole("heading", { name: /Event Shirt \(L\)/i });
    expect(
      screen.queryByRole("button", { name: /transfer/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps warehouse pricing read-only for the pricing role", async () => {
    renderDetail("shirt-l", "pricing");
    await screen.findByRole("heading", { name: /Event Shirt \(L\)/i });

    expect(screen.getByText(/Price ₱350/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /set price/i }),
    ).not.toBeInTheDocument();
  });

  it("hides set price for non-pricing roles", async () => {
    renderDetail("shirt-l", "logistics_supervisor");
    await screen.findByRole("heading", { name: /Event Shirt \(L\)/i });
    expect(
      screen.queryByRole("button", { name: /set price/i }),
    ).not.toBeInTheDocument();
  });

  it("shows Edit product for managers and hides it for others", async () => {
    renderDetail("shirt-l", "logistics_supervisor");
    await screen.findByRole("heading", { name: /Event Shirt \(L\)/i });
    expect(
      screen.getByRole("button", { name: /edit product/i }),
    ).toBeInTheDocument();
  });

  it("hides Edit product for roles without manage_products", async () => {
    renderDetail("shirt-l", "bi_analyst");
    await screen.findByRole("heading", { name: /Event Shirt \(L\)/i });
    expect(
      screen.queryByRole("button", { name: /edit product/i }),
    ).not.toBeInTheDocument();
  });

  it("edits the reorder point through the product editor", async () => {
    const user = userEvent.setup();
    renderDetail("shirt-l", "procurement");
    await screen.findByRole("heading", { name: /Event Shirt \(L\)/i });

    await user.click(screen.getByRole("button", { name: /edit product/i }));
    const dialog = await screen.findByRole("dialog", { name: /edit product/i });
    const reorder = within(dialog).getByLabelText(/reorder point/i);
    await user.clear(reorder);
    await user.type(reorder, "99");
    await user.click(
      within(dialog).getByRole("button", { name: /save changes/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/updated/i)).toBeInTheDocument();
    });
  });

  it("submits a governed write-off request without directly changing stock", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    const before = (await repo.getData()).stockLevels.find(
      (row) => row.productId === "shirt-l" && row.locationId === "loc-main",
    )?.quantity;
    renderWithProviders(
      <Routes>
        <Route path="/inventory/:id" element={<ProductDetailPage />} />
      </Routes>,
      { route: "/inventory/shirt-l", role: "warehouse_operator", repo },
    );
    await screen.findByRole("heading", { name: /Event Shirt \(L\)/i });

    await user.click(screen.getByRole("button", { name: /adjust/i }));
    const dialog = await screen.findByRole("dialog", {
      name: /request stock change/i,
    });
    await user.type(within(dialog).getByLabelText("Reason"), "damaged");
    await user.click(
      within(dialog).getByRole("button", { name: /submit for approval/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/request submitted/i)).toBeInTheDocument();
    });
    expect((await repo.listStockChangeRequests({})).rows).toEqual([
      expect.objectContaining({
        sourceType: "write_off",
        quantityDelta: -1,
        reason: "damaged",
      }),
    ]);
    expect(
      (await repo.getData()).stockLevels.find(
        (row) => row.productId === "shirt-l" && row.locationId === "loc-main",
      )?.quantity,
    ).toBe(before);
  });

  it("edits the operational item class and stocking unit", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    renderWithProviders(
      <Routes>
        <Route path="/inventory/:id" element={<ProductDetailPage />} />
      </Routes>,
      { route: "/inventory/shirt-l", role: "warehouse_supervisor", repo },
    );
    await screen.findByRole("heading", { name: /Event Shirt \(L\)/i });

    await user.click(screen.getByRole("button", { name: /edit product/i }));
    const dialog = await screen.findByRole("dialog", { name: /edit product/i });
    await user.selectOptions(
      within(dialog).getByLabelText("Item class"),
      "event_material",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Unit of measure"),
      "set",
    );
    await user.click(
      within(dialog).getByRole("button", { name: /save changes/i }),
    );

    await waitFor(async () => {
      expect(
        (await repo.getData()).products.find(
          (product) => product.id === "shirt-l",
        ),
      ).toMatchObject({
        itemClass: "event_material",
        serializationPolicy: "none",
        serialized: false,
        uom: "set",
      });
    });
  });

  it("requires inventory authority to request a stock change in a live bundle", async () => {
    const cycleOnly = renderWithProviders(
      <Routes>
        <Route path="/inventory/:id" element={<ProductDetailPage />} />
      </Routes>,
      {
        route: "/inventory/shirt-l",
        role: "warehouse_operator",
        source: "supabase",
        capabilities: ["cycle_count"],
      },
    );
    await screen.findByRole("heading", { name: /Event Shirt \(L\)/i });
    expect(
      screen.queryByRole("button", { name: /adjust/i }),
    ).not.toBeInTheDocument();
    cycleOnly.unmount();

    renderWithProviders(
      <Routes>
        <Route path="/inventory/:id" element={<ProductDetailPage />} />
      </Routes>,
      {
        route: "/inventory/shirt-l",
        role: "warehouse_operator",
        source: "supabase",
        capabilities: ["manage_inventory"],
      },
    );
    expect(
      await screen.findByRole("button", { name: /adjust/i }),
    ).toBeInTheDocument();
  });

  it("routes serialized corrections to identified cycle-count evidence", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/inventory/:id" element={<ProductDetailPage />} />
        <Route path="/cycle-counts" element={<h1>Cycle counts</h1>} />
      </Routes>,
      {
        route: "/inventory/ecg-ring-10",
        role: "warehouse_supervisor",
        source: "supabase",
        capabilities: ["manage_inventory", "cycle_count"],
      },
    );
    await screen.findByRole("heading", { name: /ECG Ring \(Size 10\)/i });
    expect(
      screen.queryByRole("button", { name: /^adjust$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /count identified units/i }),
    ).toBeInTheDocument();
  });

  it("requires transfer_stock for relocation in a live bundle", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/inventory/:id" element={<ProductDetailPage />} />
      </Routes>,
      {
        route: "/inventory/shirt-l",
        role: "warehouse_operator",
        source: "supabase",
        capabilities: ["manage_inventory", "receive_stock", "manage_locations"],
      },
    );
    await screen.findByRole("heading", { name: /Event Shirt \(L\)/i });
    expect(
      screen.queryByRole("button", { name: /relocate/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the request action for the legacy Supervisor alias", async () => {
    renderDetail("shirt-l", "logistics_supervisor");
    await screen.findByRole("heading", { name: /Event Shirt \(L\)/i });
    expect(screen.getByRole("button", { name: /adjust/i })).toBeInTheDocument();
  });
});
