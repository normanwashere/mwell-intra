import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationsPage } from "./AllocationsPage";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";
import { modulesForWarehouseAccess } from "@/app/modules";
import { canOpenWarehouseRoute } from "@/app/authorization";

async function openReserveSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^reserve$/i }));
  return screen.findByRole("dialog");
}

function issueButtonFor(productName: string) {
  const list = screen.getByLabelText("Allocations");
  const items = within(list).getAllByRole("listitem");
  const li = items.find((el) => within(el).queryByText(productName));
  if (!li) throw new Error(`No allocation row for ${productName}`);
  return within(li).getByRole("button", { name: /^issue$/i });
}

describe("AllocationsPage", () => {
  it("blocks fractional quantities before any reservation is saved", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    const reserve = vi.spyOn(repo, "reserve");
    renderWithProviders(<AllocationsPage />, {
      role: "warehouse_operator",
      repo,
    });
    await screen.findByLabelText("Allocations");
    const dialog = await openReserveSheet(user);
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "shirt-l",
    );
    fireEvent.change(within(dialog).getByLabelText("Quantity"), {
      target: { value: "1.5" },
    });
    await user.click(
      within(dialog).getByRole("button", { name: /^reserve$/i }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /whole number/i,
    );
    expect(reserve).not.toHaveBeenCalled();
  });

  it("removes a draft line without changing another line's purpose", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AllocationsPage />, { role: "warehouse_operator" });
    await screen.findByLabelText("Allocations");
    const dialog = await openReserveSheet(user);
    await user.click(
      within(dialog).getByRole("button", { name: /add product/i }),
    );
    await user.selectOptions(
      within(dialog).getAllByLabelText("Product")[1]!,
      "doctor-token",
    );
    await user.selectOptions(
      within(dialog).getAllByLabelText("Purpose")[1]!,
      "giveaway",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Remove product 1" }),
    );
    expect(within(dialog).getByLabelText("Product")).toHaveValue(
      "doctor-token",
    );
    expect(within(dialog).getByLabelText("Purpose")).toHaveValue("giveaway");
  });

  it("does not expose reservation controls without the reservation capability", async () => {
    renderWithProviders(<AllocationsPage />, {
      role: "marketing",
      source: "supabase",
      capabilities: ["view_dashboard", "view_inventory", "request_stock"],
    });
    await screen.findByLabelText("Allocations");
    expect(
      screen.queryByRole("button", { name: /^reserve$|^issue$|^return$/i }),
    ).not.toBeInTheDocument();
  });

  it("reserves multiple products with a purpose on each line", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    const reserve = vi.spyOn(repo, "reserve");
    renderWithProviders(<AllocationsPage />, {
      role: "warehouse_operator",
      repo,
    });
    await screen.findByLabelText("Allocations");
    const dialog = await openReserveSheet(user);
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "shirt-l",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Purpose"),
      "selling",
    );
    await user.click(
      within(dialog).getByRole("button", { name: /add product/i }),
    );
    await user.selectOptions(
      within(dialog).getAllByLabelText("Product")[1]!,
      "doctor-token",
    );
    await user.selectOptions(
      within(dialog).getAllByLabelText("Purpose")[1]!,
      "giveaway",
    );
    await user.click(
      within(dialog).getByRole("button", { name: /^reserve$/i }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(reserve).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ productId: "shirt-l", promotional: false }),
    );
    expect(reserve).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ productId: "doctor-token", promotional: true }),
    );
    expect(reserve.mock.calls[0]![0].eventId).toBe(
      reserve.mock.calls[1]![0].eventId,
    );
    const list = screen.getByLabelText("Allocations");
    expect(within(list).getAllByText(/Selling/).length).toBeGreaterThan(0);
    expect(within(list).getAllByText(/Giveaway/).length).toBeGreaterThan(0);
  });

  it("validates combined stock across selling and giveaway lines before saving any", async () => {
    const user = userEvent.setup();
    const seed = await makeRepo().getData();
    seed.allocations = [];
    seed.stockLevels = [
      { productId: "shirt-l", locationId: "loc-wh", quantity: 3 },
    ];
    const repo = makeRepo(seed);
    const reserve = vi.spyOn(repo, "reserve");
    renderWithProviders(<AllocationsPage />, {
      role: "warehouse_operator",
      repo,
    });
    await screen.findByText("No allocations yet");
    const dialog = await openReserveSheet(user);
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "shirt-l",
    );
    fireEvent.change(within(dialog).getByLabelText("Quantity"), {
      target: { value: "2" },
    });
    await user.click(
      within(dialog).getByRole("button", { name: /add product/i }),
    );
    await user.selectOptions(
      within(dialog).getAllByLabelText("Product")[1]!,
      "shirt-l",
    );
    await user.selectOptions(
      within(dialog).getAllByLabelText("Purpose")[1]!,
      "giveaway",
    );
    fireEvent.change(within(dialog).getAllByLabelText("Quantity")[1]!, {
      target: { value: "2" },
    });
    await user.click(
      within(dialog).getByRole("button", { name: /^reserve$/i }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /available/i,
    );
    expect(reserve).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getAllByLabelText("Quantity")[1]!, {
      target: { value: "1" },
    });
    await user.click(
      within(dialog).getByRole("button", { name: /^reserve$/i }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(reserve).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        productId: "shirt-l",
        quantity: 2,
        promotional: false,
      }),
    );
    expect(reserve).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        productId: "shirt-l",
        quantity: 1,
        promotional: true,
      }),
    );
  });

  it("locks unconfirmed lines after a lost response without resubmitting saved reservations", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    const originalReserve = repo.reserve.bind(repo);
    const reserve = vi
      .spyOn(repo, "reserve")
      .mockImplementationOnce(originalReserve)
      .mockImplementationOnce(async (input) => {
        await originalReserve(input);
        throw new Error("Response lost after commit");
      });
    renderWithProviders(<AllocationsPage />, {
      role: "warehouse_operator",
      repo,
    });
    await screen.findByLabelText("Allocations");
    const dialog = await openReserveSheet(user);
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "shirt-l",
    );
    await user.click(
      within(dialog).getByRole("button", { name: /add product/i }),
    );
    await user.selectOptions(
      within(dialog).getAllByLabelText("Product")[1]!,
      "doctor-token",
    );
    await user.click(
      within(dialog).getByRole("button", { name: /^reserve$/i }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /1.*saved/i,
    );
    expect(within(dialog).getAllByLabelText("Product")).toHaveLength(1);
    expect(within(dialog).getByLabelText("Product")).toHaveValue(
      "doctor-token",
    );
    expect(
      within(dialog).getByRole("button", { name: /^reserve$/i }),
    ).toBeDisabled();
    expect(within(dialog).getByLabelText("Product")).toBeDisabled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/unconfirmed/i);
    expect(screen.queryByText(/^Reserved \d+ product/)).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: /^reserve$/i }),
    );
    expect(reserve).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      reserve.mock.calls.filter(([input]) => input.productId === "shirt-l"),
    ).toHaveLength(1);
  });

  it("submits each reservation only once while a save is pending", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    const originalReserve = repo.reserve.bind(repo);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reserve = vi
      .spyOn(repo, "reserve")
      .mockImplementation(async (input) => {
        await pending;
        return originalReserve(input);
      });
    renderWithProviders(<AllocationsPage />, {
      role: "warehouse_operator",
      repo,
    });
    await screen.findByLabelText("Allocations");
    const dialog = await openReserveSheet(user);
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "shirt-l",
    );
    await user.dblClick(
      within(dialog).getByRole("button", { name: /^reserve$/i }),
    );
    expect(reserve).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    release();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(reserve).toHaveBeenCalledTimes(1);
  });

  it("routes Marketing to allocations only with reservation access and not to approvals", () => {
    const capabilities = new Set([
      "view_dashboard",
      "view_inventory",
      "request_stock",
    ]);
    const can = (capability: string) => capabilities.has(capability);
    expect(canOpenWarehouseRoute("allocations", can)).toBe(false);
    capabilities.add("reserve_allocate");
    expect(canOpenWarehouseRoute("allocations", can)).toBe(true);
    expect(canOpenWarehouseRoute("approvals", can)).toBe(false);
    expect(
      modulesForWarehouseAccess("supabase", "marketing", can).map(
        (item) => item.id,
      ),
    ).toContain("allocations");
  });

  it("lets a reservation-only Marketing capability reserve without issuing or returns", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    const reserve = vi.spyOn(repo, "reserve");
    renderWithProviders(<AllocationsPage />, {
      role: "marketing",
      repo,
      source: "supabase",
      capabilities: [
        "view_dashboard",
        "view_inventory",
        "request_stock",
        "reserve_allocate",
      ],
    });
    await screen.findByLabelText("Allocations");
    expect(
      screen.queryByRole("button", { name: /^issue$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^return$/i }),
    ).not.toBeInTheDocument();
    const dialog = await openReserveSheet(user);
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "shirt-l",
    );
    await user.click(
      within(dialog).getByRole("button", { name: /^reserve$/i }),
    );
    await waitFor(() => expect(reserve).toHaveBeenCalledTimes(1));
  });

  it("reserves stock for an event via the sheet", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AllocationsPage />, { role: "warehouse_operator" });
    await screen.findByLabelText("Allocations");

    const dialog = await openReserveSheet(user);
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "shirt-l",
    );
    const qty = within(dialog).getByLabelText("Quantity");
    await user.clear(qty);
    await user.type(qty, "5");
    await user.click(
      within(dialog).getByRole("button", { name: /^reserve$/i }),
    );

    await waitFor(() => {
      const list = screen.getByLabelText("Allocations");
      expect(
        within(list).getAllByText(/Event Shirt \(L\)/i).length,
      ).toBeGreaterThan(0);
    });
  });

  it("blocks over-reservation with an error", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AllocationsPage />, { role: "warehouse_operator" });
    await screen.findByLabelText("Allocations");

    const dialog = await openReserveSheet(user);
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "otg-bag",
    );
    const qty = within(dialog).getByLabelText("Quantity");
    await user.clear(qty);
    await user.type(qty, "9999");
    await user.click(
      within(dialog).getByRole("button", { name: /^reserve$/i }),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /available/i,
    );
  });

  it("warns about expired stock without blocking reservation in W1", async () => {
    const seed = await makeRepo().getData();
    seed.products = seed.products.map((product) =>
      product.id === "doctor-token"
        ? { ...product, expiryTracked: true, shelfLifeWarningDays: 30 }
        : product,
    );
    seed.lots.push({
      id: "lot-expired-allocation",
      productId: "doctor-token",
      lotCode: "EXP-ALLOC",
      unitCost: 10,
      receivedAt: "2026-06-01T00:00:00Z",
      expiryDate: "2026-07-09",
    });
    const user = userEvent.setup();
    renderWithProviders(<AllocationsPage />, {
      role: "warehouse_operator",
      repo: makeRepo(seed),
    });
    await screen.findByLabelText("Allocations");

    const dialog = await openReserveSheet(user);
    await user.selectOptions(
      within(dialog).getByLabelText("Product"),
      "doctor-token",
    );
    expect(
      within(dialog).getByText(/expired lot on hand/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /^reserve$/i }),
    ).toBeEnabled();
  });

  it("filters allocations by status", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AllocationsPage />, { role: "warehouse_operator" });
    await screen.findByLabelText("Allocations");

    await user.click(screen.getByRole("tab", { name: /^reserved$/i }));
    const list = screen.getByLabelText("Allocations");
    expect(within(list).getByText("Doctor Token")).toBeInTheDocument();
    expect(within(list).queryByText("Event Shirt (L)")).not.toBeInTheDocument();
  });

  it("issues a reserved allocation", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AllocationsPage />, { role: "warehouse_operator" });
    await screen.findByLabelText("Allocations");

    const issueButtons = await screen.findAllByRole("button", {
      name: /^issue$/i,
    });
    expect(issueButtons.length).toBeGreaterThan(0);
    const issueBtn = issueButtons[0];
    expect(issueBtn).toBeDefined();
    await user.click(issueBtn!);

    const dialog = await screen.findByRole("dialog", {
      name: /issue allocation/i,
    });
    await user.click(
      within(dialog).getByRole("button", { name: /confirm issue/i }),
    );

    await waitFor(() => {
      expect(screen.getAllByText("issued").length).toBeGreaterThan(0);
    });
  });

  it("issues a serialized allocation with the chosen serial units", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    renderWithProviders(<AllocationsPage />, {
      role: "warehouse_operator",
      repo,
    });
    await screen.findByLabelText("Allocations");

    await user.click(issueButtonFor("mWellness Smart Watch"));
    const dialog = await screen.findByRole("dialog", {
      name: /issue allocation/i,
    });

    // alloc-4 reserves 8 smart watches; the first 8 in-stock serials are
    // pre-selected. Swap one selection to prove the chosen serials go out.
    await user.click(within(dialog).getByText("SMART-WATCH-SN0001")); // deselect
    await user.click(within(dialog).getByText("SMART-WATCH-SN0009")); // select

    await user.click(
      within(dialog).getByRole("button", { name: /confirm issue/i }),
    );

    await waitFor(async () => {
      const data = await repo.getData();
      const status = (id: string) =>
        data.units.find((u) => u.id === id)?.status;
      // The 8 chosen serials (u2..u8 + u9) are issued; the deselected u1 is not.
      expect(status("smart-watch-u9")).toBe("issued");
      expect(status("smart-watch-u1")).toBe("in_stock");
      for (const i of [2, 3, 4, 5, 6, 7, 8]) {
        expect(status(`smart-watch-u${i}`)).toBe("issued");
      }
      const issued = data.units.filter(
        (u) => u.productId === "smart-watch" && u.status === "issued",
      );
      // 8 newly issued + the 1 seeded field-assigned VIP unit.
      expect(issued).toHaveLength(9);
    });
  });

  it("disables confirm until exactly the required serials are selected", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AllocationsPage />, { role: "warehouse_operator" });
    await screen.findByLabelText("Allocations");

    await user.click(issueButtonFor("mWellness Smart Watch"));
    const dialog = await screen.findByRole("dialog", {
      name: /issue allocation/i,
    });
    const confirm = within(dialog).getByRole("button", {
      name: /confirm issue/i,
    });

    // Pre-selected at the required count (8) → enabled.
    expect(confirm).toBeEnabled();

    // Drop below the required count → disabled with a clear hint.
    await user.click(within(dialog).getByText("SMART-WATCH-SN0002"));
    expect(confirm).toBeDisabled();
    expect(
      within(dialog).getByText(/select 8 of 12 units/i),
    ).toBeInTheDocument();

    // Restore the count → enabled again.
    await user.click(within(dialog).getByText("SMART-WATCH-SN0002"));
    expect(confirm).toBeEnabled();
  });

  it("validates scanned issue serials against the allocation product", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AllocationsPage />, { role: "warehouse_operator" });
    await screen.findByLabelText("Allocations");
    await user.click(issueButtonFor("mWellness Smart Watch"));
    const dialog = await screen.findByRole("dialog", {
      name: /issue allocation/i,
    });
    await user.click(within(dialog).getByText("SMART-WATCH-SN0001"));

    const manual = within(dialog).getByLabelText("Enter barcode manually");
    await user.type(manual, "ECG-RING-6-SN0003");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /does not match/i,
    );
    await user.type(manual, "SMART-WATCH-SN0009");
    await user.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      /scan accepted/i,
    );
    expect(
      within(dialog).getByRole("button", { name: /confirm issue/i }),
    ).toBeEnabled();
  });

  it("issues a non-serialized allocation without a serial picker", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    renderWithProviders(<AllocationsPage />, {
      role: "warehouse_operator",
      repo,
    });
    await screen.findByLabelText("Allocations");

    await user.click(issueButtonFor("Doctor Token"));
    const dialog = await screen.findByRole("dialog", {
      name: /issue allocation/i,
    });

    // Non-serialized: no serial selection UI, confirm immediately available.
    expect(
      within(dialog).queryByLabelText("Serial units"),
    ).not.toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", {
      name: /confirm issue/i,
    });
    expect(confirm).toBeEnabled();

    await user.click(confirm);

    await waitFor(async () => {
      const data = await repo.getData();
      expect(data.allocations.find((a) => a.id === "alloc-3")?.status).toBe(
        "issued",
      );
    });
  });
});
