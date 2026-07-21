import { describe, it, expect } from "vitest";
import { Route, Routes } from "react-router-dom";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductDetailPage } from "./ProductDetailPage";
import { renderWithProviders } from "@/test/renderWithProviders";
import { makeRepo } from "@/test/renderWithProviders";

import type { Role } from "@/domain/types";

function renderDetail(id: string, role: Role = "logistics_supervisor") {
  return renderWithProviders(
    <Routes>
      <Route path="/inventory/:id" element={<ProductDetailPage />} />
    </Routes>,
    { route: `/inventory/${id}`, role },
  );
}

describe("ProductDetailPage", () => {
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

  it("lets the pricing role set a price", async () => {
    const user = userEvent.setup();
    renderDetail("shirt-l", "pricing");
    await screen.findByRole("heading", { name: /Event Shirt \(L\)/i });

    await user.click(screen.getByRole("button", { name: /set price/i }));
    const dialog = await screen.findByRole("dialog", { name: /set price/i });
    expect(within(dialog).getByLabelText(/sell price/i)).toBeInTheDocument();
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
