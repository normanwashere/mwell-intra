import { beforeEach, describe, it, expect } from "vitest";
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PurchaseOrdersPage } from "./PurchaseOrdersPage";
import { renderWithProviders } from "@/test/renderWithProviders";
import { PROCUREMENT_PO_KEY } from "@/data/procurementBridge";
import { InMemoryRepository } from "@/data/inMemoryRepository";
import type { ReceiveProcurementPOInput } from "@intra/data-kit";

class LiveProcurementRepository extends InMemoryRepository {
  receivedInputs: ReceiveProcurementPOInput[] = [];

  override async getReceivableProcurementPOs() {
    return [
      {
        id: "live-po-1",
        poNumber: "PO-LIVE-001",
        vendorName: "Live Medical Vendor",
        status: "issued" as const,
        lines: [
          {
            id: "live-line-1",
            productId: "smart-watch",
            description: "Smart watches",
            quantity: 2,
            receivedQuantity: 0,
          },
        ],
      },
    ];
  }

  override async receiveProcurementPO(input: ReceiveProcurementPOInput) {
    this.receivedInputs.push(input);
    return super.receiveProcurementPO(input);
  }
}

describe("PurchaseOrdersPage", () => {
  it("does not expose PO authoring or cancellation to the Operator", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: "warehouse_operator" });
    const list = await screen.findByLabelText("Purchase orders");
    expect(
      screen.queryByRole("button", { name: /new po/i }),
    ).not.toBeInTheDocument();
    await user.click(within(list).getAllByRole("button")[0]!);
    expect(
      screen.queryByRole("button", { name: /cancel po/i }),
    ).not.toBeInTheDocument();
  });

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("lists seeded purchase orders with human PO numbers", async () => {
    renderWithProviders(<PurchaseOrdersPage />, { role: "warehouse_operator" });
    const list = await screen.findByLabelText("Purchase orders");
    expect(
      within(list).getAllByText(/mWellness Wearables/i).length,
    ).toBeGreaterThan(0);
    expect(within(list).getByText(/MetroPrint Apparel/i)).toBeInTheDocument();
    // No raw ids as labels (WH-26) — stable PO-#### numbers instead.
    expect(within(list).queryByText(/po-wearables/i)).not.toBeInTheDocument();
    expect(within(list).getAllByText(/PO-\d{4}/).length).toBeGreaterThan(0);
  });

  it("filters purchase orders by status", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: "procurement" });
    await screen.findByLabelText("Purchase orders");

    await user.click(screen.getByRole("tab", { name: /^closed$/i }));
    const list = screen.getByLabelText("Purchase orders");
    expect(within(list).getByText(/GiftWorks/i)).toBeInTheDocument();
    expect(
      within(list).queryByText(/mWellness Wearables/i),
    ).not.toBeInTheDocument();
  });

  it("never exposes raw Warehouse PO authoring", async () => {
    renderWithProviders(<PurchaseOrdersPage />, { role: "procurement" });
    await screen.findByLabelText("Purchase orders");
    expect(screen.queryByRole("button", { name: /new po/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open procurement requests/i }))
      .toHaveAttribute("href", "/procurement/requests");
  });

  it("receives stock via the PO detail sheet (row is the target)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: "warehouse_operator" });
    const list = await screen.findByLabelText("Purchase orders");

    // Open the ordered wearables PO from its row.
    await user.click(
      within(list).getAllByRole("button", { name: /mWellness Wearables/i })[0]!,
    );
    const detail = await screen.findByRole("dialog", {
      name: /mWellness Wearables/i,
    });
    await user.click(
      within(detail).getByRole("button", { name: /^receive and inspect$/i }),
    );

    const dialog = await screen.findByRole("dialog", {
      name: /receive against po/i,
    });
    expect(
      within(dialog).getByText(/inspection required/i),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: /confirm receipt/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/received against po into inspection staging/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("link", { name: /open quality queue/i }),
    ).toBeInTheDocument();
  });

  it("does not offer Receive on a draft PO (WH-25)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: "warehouse_operator" });
    const list = await screen.findByLabelText("Purchase orders");

    // The seeded draft PO (sleep rings + OTG bags from mWellness Wearables).
    const draftRow = within(list)
      .getAllByRole("button")
      .find((b) => /draft/i.test(b.textContent ?? ""));
    expect(draftRow).toBeDefined();
    await user.click(draftRow!);
    const detail = await screen.findByRole("dialog", {
      name: /mWellness Wearables/i,
    });
    expect(
      within(detail).queryByRole("button", { name: /^receive$/i }),
    ).not.toBeInTheDocument();
    expect(within(detail).getByText(/not yet ordered/i)).toBeInTheDocument();
  });

  it("cancels an open purchase order after an explicit confirm", async () => {
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />, { role: "procurement" });
    const list = await screen.findByLabelText("Purchase orders");

    await user.click(
      within(list).getAllByRole("button", { name: /MetroPrint Apparel/i })[0]!,
    );
    const detail = await screen.findByRole("dialog", {
      name: /MetroPrint Apparel/i,
    });
    await user.click(
      within(detail).getByRole("button", { name: /cancel po/i }),
    );
    await user.click(
      within(detail).getByRole("button", { name: /confirm cancel/i }),
    );

    await waitFor(() => {
      expect(screen.getByText(/purchase order cancelled/i)).toBeInTheDocument();
    });
  });

  it("keeps procurement-issued PO links inside the Warehouse workflow", async () => {
    window.localStorage.setItem(
      PROCUREMENT_PO_KEY,
      JSON.stringify([
        {
          id: "ppo-9",
          poNumber: "PO-2026-0003",
          vendorId: "ven-acme",
          vendorName: "Acme Medical Supplies",
          status: "issued",
          origin: "request",
          lines: [
            {
              id: "l1",
              description: "Barcode scanners",
              quantity: 4,
              unitPrice: 650000,
              receivedQuantity: 0,
            },
          ],
          createdAt: "2026-07-05T10:00:00.000Z",
          updatedAt: "2026-07-05T10:00:00.000Z",
          total: 2600000,
        },
      ]),
    );
    renderWithProviders(<PurchaseOrdersPage />, { role: "warehouse_operator" });
    const list = await screen.findByLabelText("Purchase orders");

    expect(within(list).getByText("From Procurement")).toBeInTheDocument();
    const link = within(list).getByRole("link", { name: "PO-2026-0003" });
    expect(link).toHaveAttribute("href", "/warehouse/purchase-orders?po=ppo-9");
    expect(
      within(list).getByRole("button", { name: /^receive and inspect$/i }),
    ).toBeInTheDocument();
    expect(
      within(list).getByText(/Acme Medical Supplies/i),
    ).toBeInTheDocument();
  });

  it("opens the governed receipt detail from the Procurement handoff query", async () => {
    window.localStorage.setItem(
      PROCUREMENT_PO_KEY,
      JSON.stringify([
        {
          id: "ppo-handoff",
          poNumber: "PO-HANDOFF-001",
          vendorName: "Handoff Vendor",
          status: "issued",
          lines: [
            {
              id: "line-handoff",
              productId: "smart-watch",
              description: "Smart watches",
              quantity: 2,
              receivedQuantity: 0,
            },
          ],
          createdAt: "2026-07-15T00:00:00.000Z",
          total: 0,
        },
      ]),
    );

    renderWithProviders(<PurchaseOrdersPage />, {
      role: "warehouse_operator",
      route: "/purchase-orders?po=ppo-handoff",
    });

    const dialog = await screen.findByRole("dialog", {
      name: /receive approved procurement po/i,
    });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("PO-HANDOFF-001")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("tab", { name: /clean receipt/i }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("tab", { name: /short/i }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("tab", { name: /excess/i }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("tab", { name: /damaged/i }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("tab", { name: /unidentified/i }),
    ).toBeInTheDocument();
  });

  it("captures unidentified custody without forcing a Warehouse product mapping", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      PROCUREMENT_PO_KEY,
      JSON.stringify([
        {
          id: "ppo-unidentified",
          poNumber: "PO-UNIDENTIFIED-001",
          vendorName: "Unknown Load Vendor",
          status: "issued",
          lines: [
            {
              id: "line-unidentified",
              description: "Expected diagnostic kit",
              quantity: 2,
              receivedQuantity: 0,
            },
          ],
          createdAt: "2026-07-15T00:00:00.000Z",
          total: 0,
        },
      ]),
    );

    renderWithProviders(<PurchaseOrdersPage />, { role: "warehouse_operator" });
    const list = await screen.findByLabelText("Purchase orders");
    await user.click(
      within(list).getByRole("button", { name: /^receive and inspect$/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /receive approved procurement po/i,
    });
    await user.click(
      within(dialog).getByRole("tab", { name: /unidentified/i }),
    );

    expect(
      within(dialog).queryByLabelText(/map expected diagnostic kit/i),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByLabelText(
        /observed description for expected diagnostic kit/i,
      ),
    ).toHaveValue("Expected diagnostic kit");
    expect(
      within(dialog).getByLabelText(
        /observed identifiers for expected diagnostic kit/i,
      ),
    ).toBeInTheDocument();
  });

  it("uses the live handoff in Supabase mode and ignores local cached POs", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      PROCUREMENT_PO_KEY,
      JSON.stringify([
        {
          id: "cached-po",
          poNumber: "PO-CACHED",
          vendorName: "Cached Vendor",
          status: "issued",
          lines: [],
          createdAt: "2026-07-01T00:00:00Z",
        },
      ]),
    );
    const repo = new LiveProcurementRepository();
    renderWithProviders(<PurchaseOrdersPage />, {
      role: "logistics_supervisor",
      repo,
      source: "supabase",
      capabilities: ["receive_stock"],
    });

    const list = await screen.findByLabelText("Purchase orders");
    expect(
      screen.queryByRole("link", { name: /open quality queue/i }),
    ).not.toBeInTheDocument();
    expect(within(list).getByText("PO-LIVE-001")).toBeInTheDocument();
    expect(within(list).queryByText(/mWellness Wearables/i)).not.toBeInTheDocument();
    expect(within(list).queryByText("PO-CACHED")).not.toBeInTheDocument();
    await user.click(
      within(list).getByRole("button", { name: /^receive and inspect$/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /receive approved procurement po/i,
    });
    await user.type(
      within(dialog).getByLabelText(/delivery evidence url/i),
      "evidence/live.jpg",
    );
    await user.click(
      within(dialog).getByRole("button", { name: /confirm governed receipt/i }),
    );

    await waitFor(() => expect(repo.receivedInputs).toHaveLength(1));
    expect(repo.receivedInputs[0]).toMatchObject({
      poId: "live-po-1",
      locationId: "loc-wh",
    });
  });
});
