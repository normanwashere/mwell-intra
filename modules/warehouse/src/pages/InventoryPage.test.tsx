import { afterEach, describe, it, expect, vi } from "vitest";
import { act, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { InventoryPage } from "./InventoryPage";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";
import { useWarehouse } from "@/app/store";
import type { InventoryPosition, PageResult } from "@intra/data-kit";

const position = (overrides: Partial<InventoryPosition> = {}): InventoryPosition => ({
  productId: "power", locationId: "loc-wh", onHand: 10, committed: 0,
  held: 0, unavailable: 0, available: 10, ...overrides,
});

async function availabilitySeed(serialized = true) {
  const seed = await makeRepo().getData();
  seed.products = [{ ...seed.products[0]!, id: "power", name: "Power Gen 2", sku: "WATCH-POW-G2", serialized,
    reorderPoint: 3319, attributes: { "Source category": "Watches" } }];
  seed.units = serialized ? Array.from({ length: 3320 }, (_, index) => ({ ...seed.units[0]!,
    id: `power-${index}`, productId: "power", serialNumber: `POWER-${index}`, status: "in_stock" as const })) : [];
  seed.stockLevels = serialized ? [] : [{ productId: "power", locationId: "loc-wh", quantity: 3320 }];
  seed.allocations = [];
  seed.returns = [];
  return seed;
}

function RefreshSnapshot() {
  const { refresh } = useWarehouse();
  return <button onClick={() => void refresh()}>Refresh snapshot</button>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InventoryPage", () => {
  it("uses all governed availability pages for the held Power watch and its low-stock result", async () => {
    const user = userEvent.setup();
    const repo = makeRepo(await availabilitySeed());
    const load = vi.spyOn(repo, "listInventoryPositions").mockImplementation(async ({ cursor }) => cursor
      ? { rows: [position({ binId: "accepted", onHand: 1, available: 1 }), position({ binId: "damaged", onHand: 1, held: 1, available: 0 })], total: 102 }
      : { rows: Array.from({ length: 100 }, (_, i) => position({ binId: `import-${i}`, onHand: i === 99 ? 348 : 30, available: i === 99 ? 348 : 30 })), nextCursor: "100", total: 102 });
    renderWithProviders(<InventoryPage />, { repo });
    await user.type(await screen.findByLabelText("Search inventory"), "WATCH-POW-G2");
    const row = screen.getByRole("button", { name: /Power Gen 2.*WATCH-POW-G2/ });
    expect(await within(row).findByText("3319")).toBeVisible();
    expect(within(row).queryByText("3320")).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledWith({ limit: 100, cursor: "100" });
    await user.click(screen.getByRole("button", { name: "Low stock only" }));
    expect(screen.getByRole("button", { name: /Power Gen 2.*3319/ })).toBeVisible();
    expect(screen.getByText("1 low")).toBeVisible();
  });

  it.each([true, false])("uses governed held and returned totals once for serialized=%s, including family totals", async (serialized) => {
    const seed = await availabilitySeed(serialized);
    seed.products = ["Black", "Silver"].map((color, i) => ({ ...seed.products[0]!, id: i ? "silver" : "power",
      name: `Power ${color}`, sku: `POWER-${color}`, attributes: { familyId: "power", familyName: "Power", color } }));
    const repo = makeRepo(seed);
    vi.spyOn(repo, "listInventoryPositions").mockResolvedValue({ rows: [
      position({ binId: "main", onHand: 10, held: 2, unavailable: 1, committed: 2, available: 5 }),
      position({ binId: "returns", onHand: 4, held: 1, unavailable: 2, available: 1 }),
      position({ productId: "silver", onHand: 8, held: 2, unavailable: 2, available: 4 }),
    ], total: 3 });
    renderWithProviders(<InventoryPage />, { repo });
    const black = await screen.findByRole("button", { name: /Power Black.*POWER-Black/ });
    expect(await within(black).findByText("6")).toBeVisible();
    expect(within(screen.getByRole("button", { name: /Power Silver.*POWER-Silver/ })).getByText("4")).toBeVisible();
    const family = screen.getByRole("heading", { name: "Power" }).closest("section")!;
    expect(within(family).getByText("10")).toBeVisible();
  });

  it("does not publish partial pages or low-stock claims while availability is loading", async () => {
    const repo = makeRepo(await availabilitySeed());
    let finish!: (result: PageResult<InventoryPosition>) => void;
    vi.spyOn(repo, "listInventoryPositions").mockImplementation(async ({ cursor }) => cursor
      ? new Promise((resolve) => { finish = resolve; })
      : { rows: [position({ available: 3318 })], nextCursor: "next", total: 2 });
    renderWithProviders(<InventoryPage />, { repo, route: "/inventory?filter=low" });
    expect(await screen.findByText("Checking inventory availability...")).toBeVisible();
    expect(screen.getByRole("button", { name: "Low stock only" })).toBeDisabled();
    expect(screen.queryByText("No low-stock items")).not.toBeInTheDocument();
    expect(screen.queryByText("3318")).not.toBeInTheDocument();
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    await act(async () => finish({ rows: [position({ available: 1 })], total: 2 }));
    expect(await screen.findByText("3319")).toBeVisible();
  });

  it("hides numeric availability and low-stock claims after a later-page read error, then retries", async () => {
    const user = userEvent.setup();
    const repo = makeRepo(await availabilitySeed());
    const load = vi.spyOn(repo, "listInventoryPositions")
      .mockResolvedValueOnce({ rows: [position({ available: 3318 })], nextCursor: "next", total: 2 })
      .mockRejectedValueOnce(new Error("offline"));
    renderWithProviders(<InventoryPage />, { repo });
    expect(await screen.findByText(/Inventory availability could not be verified/)).toBeVisible();
    const row = screen.getByRole("button", { name: /Power Gen 2.*WATCH-POW-G2/ });
    expect(within(row).getByText("Unverified")).toBeVisible();
    expect(within(row).queryByText(/^(3318|3320|0)$/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Low stock only" })).toBeDisabled();
    load.mockResolvedValue({ rows: [position({ onHand: 3320, held: 1, available: 3319 })], total: 1 });
    await user.click(screen.getByRole("button", { name: "Refresh availability" }));
    expect(await within(row).findByText("3319")).toBeVisible();
  });

  it("ignores an old availability response after a newer warehouse snapshot", async () => {
    const user = userEvent.setup();
    const repo = makeRepo(await availabilitySeed());
    let finish!: (result: PageResult<InventoryPosition>) => void;
    const load = vi.spyOn(repo, "listInventoryPositions")
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue({ rows: [position({ onHand: 3320, held: 1, available: 3319 })], total: 1 });
    renderWithProviders(<><RefreshSnapshot /><InventoryPage /></>, { repo });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Refresh snapshot" }));
    expect(await screen.findByText("3319")).toBeVisible();
    await act(async () => finish({ rows: [position({ available: 3320 })], total: 1 }));
    expect(screen.queryByText("3320")).not.toBeInTheDocument();
    expect(screen.getByText("3319")).toBeVisible();
  });

  it("hides previously verified availability during a manual refresh", async () => {
    const user = userEvent.setup();
    const repo = makeRepo(await availabilitySeed(false));
    const load = vi.spyOn(repo, "listInventoryPositions").mockResolvedValue({ rows: [position({ available: 7 })], total: 1 });
    renderWithProviders(<InventoryPage />, { repo });
    expect(await screen.findByText("7")).toBeVisible();
    let finish!: (result: PageResult<InventoryPosition>) => void;
    load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await user.click(screen.getByRole("button", { name: "Refresh availability" }));
    expect(screen.queryByText("7")).not.toBeInTheDocument();
    expect(screen.getByText("Checking")).toBeVisible();
    expect(screen.getByRole("button", { name: "Low stock only" })).toBeDisabled();
    await act(async () => finish({ rows: [position({ available: 8 })], total: 1 }));
    expect(await screen.findByText("8")).toBeVisible();
  });

  it("recovers availability after a failed warehouse snapshot without reviving its old total", async () => {
    const user = userEvent.setup();
    const repo = makeRepo(await availabilitySeed());
    const readSnapshot = vi.spyOn(repo, "getData");
    const load = vi.spyOn(repo, "listInventoryPositions").mockResolvedValue({ rows: [position({ available: 7 })], total: 1 });
    renderWithProviders(<><RefreshSnapshot /><InventoryPage /></>, { repo });
    expect(await screen.findByText("7")).toBeVisible();
    readSnapshot.mockRejectedValueOnce(new Error("Snapshot unavailable"));
    await user.click(screen.getByRole("button", { name: "Refresh snapshot" }));
    expect(await screen.findByText(/Inventory availability could not be verified/)).toBeVisible();
    expect(screen.queryByText("7")).not.toBeInTheDocument();
    let finish!: (result: PageResult<InventoryPosition>) => void;
    load.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    await user.click(screen.getByRole("button", { name: "Refresh availability" }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    expect(screen.queryByText("7")).not.toBeInTheDocument();
    expect(screen.getByText("Checking")).toBeVisible();
    await act(async () => finish({ rows: [position({ available: 8 })], total: 1 }));
    expect(await screen.findByText("8")).toBeVisible();
  });

  it("keeps the compact filter band keyboard-accessible with a separate count line", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventoryPage />);
    const filters = await screen.findByRole("region", {
      name: "Inventory filters",
    });
    const search = within(filters).getByRole("textbox", {
      name: "Search inventory",
    });
    const category = within(filters).getByRole("combobox", {
      name: "Category filter",
    });
    const lowStock = within(filters).getByRole("button", {
      name: "Low stock only",
    });
    const controls = search.closest(".grid");
    expect(filters).not.toHaveClass("card");
    expect(filters).toHaveClass("border-y");
    expect(controls).toHaveClass(
      "grid-cols-1",
      "lg:grid-cols-[minmax(0,1fr)_240px_auto]",
    );
    expect(controls).toContainElement(category);
    expect(controls).toContainElement(lowStock);
    expect(within(filters).getByText(/^\d+ SKUs/).parentElement).toBe(filters);
    search.focus();
    await user.tab();
    expect(category).toHaveFocus();
    await user.tab();
    expect(lowStock).toHaveFocus();
    await user.keyboard(" ");
    expect(lowStock).toHaveAttribute("aria-pressed", "true");
  });

  it("opens a printable barcode sheet for quantity-controlled stock", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventoryPage />, { role: "warehouse_supervisor" });

    await user.click(
      await screen.findByRole("button", { name: "Print barcode sheet" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Barcode label sheet",
    });
    expect(within(dialog).getByText("Doctor Token")).toBeInTheDocument();
    expect(within(dialog).getByText("4900099905")).toBeInTheDocument();
    expect(within(dialog).queryByText("Smart Watch")).not.toBeInTheDocument();
  });
  it("groups SKUs into product families", async () => {
    renderWithProviders(<InventoryPage />);
    const list = await screen.findByLabelText("Inventory list");
    expect(list).toHaveClass("grid-cols-1");
    expect(list.className).not.toMatch(/grid-cols-2/);
    // Exact size variants share a heading; their names and SKUs remain visible.
    expect(within(list).getByText("ECG Ring")).toBeInTheDocument();
    expect(within(list).getByText("On-The-Go Bag")).toBeInTheDocument();
    expect(within(list).getAllByText("6 variants").length).toBeGreaterThan(0);
    expect(within(list).getByText("ECG Ring (Size 6)")).toBeVisible();
    expect(within(list).getByText("ECG-RING-6")).toBeVisible();
  });

  it("progressively reveals one-column inventory batches while scrolling", async () => {
    const user = userEvent.setup();
    let notifyIntersection: IntersectionObserverCallback = () => undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();

    class TestIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "";
      readonly thresholds = [];

      constructor(callback: IntersectionObserverCallback) {
        notifyIntersection = callback;
      }

      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
      takeRecords = () => [];
    }

    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);

    const seed = await makeRepo().getData();
    const template = seed.products[0]!;
    seed.products.push(
      ...Array.from({ length: 125 }, (_, index) => ({
        ...template,
        id: `scroll-product-${index}`,
        sku: `SCROLL-${index}`,
        name: `Scroll product ${String(index).padStart(3, "0")}`,
        category: "merchandise" as const,
        deviceType: undefined,
        merchandiseType: undefined,
        attributes: { "Source category": "Accessory" },
      })),
    );

    renderWithProviders(<InventoryPage />, { repo: makeRepo(seed) });
    const list = await screen.findByLabelText("Inventory list");

    expect(list.children).toHaveLength(12);
    expect(observe).toHaveBeenCalledWith(
      screen.getByTestId("inventory-load-sentinel"),
    );

    act(() => {
      notifyIntersection(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    await waitFor(() => expect(list.children).toHaveLength(24));

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Category filter" }),
      "accessories",
    );
    await waitFor(() => expect(list.children).toHaveLength(12));
    expect(within(list).getByText("Scroll product 000")).toBeVisible();
    await user.type(screen.getByLabelText("Search inventory"), "SCROLL-124");
    expect(within(list).getByText("Scroll product 124")).toBeVisible();
    expect(list.children).toHaveLength(1);
    expect(
      screen.queryByTestId("inventory-load-sentinel"),
    ).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Search inventory"));
    await waitFor(() => expect(list.children).toHaveLength(12));
    for (let count = 24; count <= 132; count += 12) {
      act(() => {
        notifyIntersection(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
      await waitFor(() =>
        expect(list.children).toHaveLength(Math.min(count, 125)),
      );
    }
    expect(within(list).getByText("Scroll product 124")).toBeVisible();
    expect(screen.getByText(/^125 SKUs/)).toBeVisible();
    expect(
      screen.queryByTestId("inventory-load-sentinel"),
    ).not.toBeInTheDocument();
  });

  it("keeps variant names and SKUs in accessible single-column rows with product navigation", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route path="/" element={<InventoryPage />} />
        <Route
          path="/inventory/ecg-ring-6"
          element={<h1>Selected ECG-RING-6</h1>}
        />
      </Routes>,
    );
    const variants = await screen.findByRole("list", {
      name: "ECG Ring variants",
    });
    expect(variants).toHaveClass("grid-cols-1");
    expect(variants.className).not.toMatch(/grid-cols-[23]/);
    const row = within(variants).getByRole("button", {
      name: /ECG Ring \(Size 6\).*ECG-RING-6/,
    });
    expect(row).toBeVisible();
    expect(within(row).getByText("serialized")).toBeVisible();
    await user.click(row);
    expect(
      await screen.findByRole("heading", { name: "Selected ECG-RING-6" }),
    ).toBeVisible();
  });

  it("filters source categories and combines them with search without merging unrelated items", async () => {
    const user = userEvent.setup();
    const seed = await makeRepo().getData();
    const template = seed.products[0]!;
    seed.products = [
      ["Watch", "Watch Pro"],
      ["Watch", "Watch Lite"],
      ["Ring", "Sleep Ring"],
      ["Accessory", "Watch Strap"],
      ["Merch", "Ceramic Mug"],
      ["Merch", "Pen"],
      ["OTG", "OTG Kit"],
      ["Packaging", "Shipping Box"],
      ["HPG", "HealthPass Card"],
      ["", "Legacy Item"],
    ].map(([sourceCategory, name], index) => ({
      ...template,
      id: `source-${index}`,
      sku: `SOURCE-${index}`,
      name: name!,
      category: "merchandise",
      merchandiseType: "other",
      attributes: {
        "Source category": sourceCategory!,
        Subcategory:
          sourceCategory === "Merch"
            ? "Accessories"
            : sourceCategory === "OTG"
              ? "Packaging"
              : "",
      },
    }));
    renderWithProviders(<InventoryPage />, { repo: makeRepo(seed) });
    const list = await screen.findByLabelText("Inventory list");
    expect(list.children).toHaveLength(10);
    expect(screen.getByText(/^10 SKUs/)).toBeVisible();
    const filter = screen.getByRole("combobox", { name: "Category filter" });
    for (const [value, name, count] of [
      ["watches", "Watch Pro", 2],
      ["rings", "Sleep Ring", 1],
      ["accessories", "Watch Strap", 1],
      ["merchandise", "Ceramic Mug", 2],
      ["otg", "OTG Kit", 1],
      ["packaging", "Shipping Box", 1],
      ["healthpass", "HealthPass Card", 1],
      ["uncategorized", "Legacy Item", 1],
    ] as const) {
      await user.selectOptions(filter, value);
      expect(within(list).getByText(name)).toBeVisible();
      expect(list.children).toHaveLength(count);
    }
    expect(within(list).getByText("Needs categorization")).toBeVisible();
    await user.selectOptions(filter, "watches");
    await user.type(screen.getByLabelText("Search inventory"), "SOURCE-1");
    expect(within(list).getByText("Watch Lite")).toBeVisible();
    expect(within(list).queryByText("Watch Pro")).not.toBeInTheDocument();
    expect(screen.getByText(/^1 SKU/)).toBeVisible();
    await user.selectOptions(filter, "packaging");
    expect(screen.getByText("No matching items")).toBeVisible();
  });

  it("shows color family variant counts, including the matching count after search", async () => {
    const user = userEvent.setup();
    const seed = await makeRepo().getData();
    seed.products = ["Black", "Silver"].map((color, index) => ({
      ...seed.products[0]!,
      id: `watch-${index}`,
      sku: `WATCH-${index}`,
      name: `Watch Pro ${color}`,
      attributes: {
        category: "Watches",
        familyId: "watch-pro",
        familyName: "Watch Pro",
        color,
      },
    }));
    renderWithProviders(<InventoryPage />, { repo: makeRepo(seed) });
    const list = await screen.findByLabelText("Inventory list");
    expect(within(list).getByText("2 variants")).toBeVisible();
    expect(within(list).queryByText(/sizes/)).not.toBeInTheDocument();
    expect(within(list).getByText("Watch Pro Black")).toBeVisible();
    expect(within(list).getByText("WATCH-1")).toBeVisible();
    await user.type(screen.getByLabelText("Search inventory"), "Black");
    expect(within(list).getByText("1 of 2 variants")).toBeVisible();
    expect(
      within(list).queryByText("Watch Pro Silver"),
    ).not.toBeInTheDocument();
  });

  it.each(["device", "merchandise"] as const)(
    "preserves the operational %s dashboard deep-link",
    async (filter) => {
      renderWithProviders(<InventoryPage />, {
        route: `/inventory?filter=${filter}`,
      });
      const list = await screen.findByLabelText("Inventory list");
      expect(within(list).queryByText("mWellness Smart Watch") !== null).toBe(
        filter === "device",
      );
      expect(within(list).queryByText("Event Shirt (S)") !== null).toBe(
        filter === "merchandise",
      );
    },
  );

  it("shows shelf-life risk on expiry-tracked inventory", async () => {
    const seed = await makeRepo().getData();
    seed.products = seed.products.map((product) =>
      product.id === "doctor-token"
        ? { ...product, expiryTracked: true, shelfLifeWarningDays: 30 }
        : product,
    );
    seed.lots.push({
      id: "lot-expired-ui",
      productId: "doctor-token",
      lotCode: "EXP-001",
      unitCost: 10,
      receivedAt: "2026-06-01T00:00:00Z",
      expiryDate: "2026-07-09",
    });
    renderWithProviders(<InventoryPage />, { repo: makeRepo(seed) });

    const list = await screen.findByLabelText("Inventory list");
    expect(within(list).getByText("Expired")).toBeInTheDocument();
  });

  it("filters to low-stock items only", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventoryPage />);
    await screen.findByLabelText("Inventory list");

    await user.click(screen.getByRole("button", { name: /low stock only/i }));
    const list = screen.getByLabelText("Inventory list");
    expect(within(list).getByText("ECG Ring")).toBeInTheDocument();
    expect(within(list).queryByText("Event Shirt")).not.toBeInTheDocument();
  });

  it("searches by SKU and keeps the matching product identity visible", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventoryPage />);
    await screen.findByLabelText("Inventory list");

    await user.type(screen.getByLabelText(/search inventory/i), "ECG-RING-6");
    const list = screen.getByLabelText("Inventory list");
    expect(within(list).getByText("ECG Ring")).toBeInTheDocument();
    expect(within(list).getByText("Size 6")).toBeInTheDocument();
    expect(within(list).queryByText("On-The-Go Bag")).not.toBeInTheDocument();
  });

  it("hides Add product for roles without manage_products", async () => {
    renderWithProviders(<InventoryPage />, { role: "finance" });
    await screen.findByLabelText("Inventory list");
    expect(
      screen.queryByRole("button", { name: /add product/i }),
    ).not.toBeInTheDocument();
  });

  it("lets a manager create a new SKU", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    renderWithProviders(<InventoryPage />, {
      role: "logistics_supervisor",
      repo,
    });
    await screen.findByLabelText("Inventory list");

    await user.click(screen.getByRole("button", { name: /add product/i }));
    const dialog = await screen.findByRole("dialog", { name: /add product/i });
    await user.type(within(dialog).getByLabelText("SKU"), "TEST-SKU-1");
    await user.type(within(dialog).getByLabelText("Name"), "Test Widget");
    await user.click(
      within(dialog).getByRole("button", { name: /create product/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/added test widget/i)).toBeInTheDocument();
    });
    const data = await repo.getData();
    expect(data.products.some((p) => p.sku === "TEST-SKU-1")).toBe(true);
  });

  it("uses operational item class to enforce sellable serialization", async () => {
    const user = userEvent.setup();
    const repo = makeRepo();
    renderWithProviders(<InventoryPage />, {
      role: "logistics_supervisor",
      repo,
    });
    await screen.findByLabelText("Inventory list");

    await user.click(screen.getByRole("button", { name: /add product/i }));
    const dialog = await screen.findByRole("dialog", { name: /add product/i });
    await user.type(within(dialog).getByLabelText("SKU"), "SALE-TAB-1");
    await user.type(within(dialog).getByLabelText("Name"), "Sale Tablet");
    await user.selectOptions(
      within(dialog).getByLabelText("Item class"),
      "sellable_sku",
    );
    await user.selectOptions(
      within(dialog).getByLabelText("Unit of measure"),
      "piece",
    );
    expect(
      within(dialog).getByText(/one serial is required for every unit/i),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: /create product/i }),
    );

    await waitFor(async () => {
      expect(
        (await repo.getData()).products.find(
          (product) => product.sku === "SALE-TAB-1",
        ),
      ).toMatchObject({
        itemClass: "sellable_sku",
        serialized: true,
        uom: "piece",
      });
    });
  });
});
