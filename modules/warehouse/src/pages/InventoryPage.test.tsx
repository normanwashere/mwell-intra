import { afterEach, describe, it, expect, vi } from "vitest";
import { act, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InventoryPage } from "./InventoryPage";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InventoryPage", () => {
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
    // ECG ring sizes collapse into one family; OTG bag stays standalone
    expect(within(list).getByText("ECG Ring")).toBeInTheDocument();
    expect(within(list).getByText("On-The-Go Bag")).toBeInTheDocument();
    expect(within(list).getAllByText(/6 sizes/i).length).toBeGreaterThan(0);
  });

  it("progressively reveals one-column inventory batches while scrolling", async () => {
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
      ...Array.from({ length: 30 }, (_, index) => ({
        ...template,
        id: `scroll-product-${index}`,
        sku: `SCROLL-${index}`,
        name: `Scroll product ${String(index).padStart(2, "0")}`,
        category: "merchandise" as const,
        deviceType: undefined,
        merchandiseType: undefined,
        attributes: {},
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
  });

  it("expands a family to reveal its size variants", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventoryPage />);
    await screen.findByLabelText("Inventory list");

    await user.click(screen.getByRole("button", { name: /ECG Ring/i }));
    expect(await screen.findByText("Size 6")).toBeInTheDocument();
    expect(screen.getByText("Size 10")).toBeInTheDocument();
  });

  it("filters by category", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InventoryPage />);
    await screen.findByLabelText("Inventory list");

    await user.click(screen.getByRole("tab", { name: /device/i }));
    const list = screen.getByLabelText("Inventory list");
    expect(within(list).queryByText("Event Shirt")).not.toBeInTheDocument();
    expect(within(list).getByText("mWellness Smart Watch")).toBeInTheDocument();
  });

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

  it("searches by SKU and auto-expands matches", async () => {
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
