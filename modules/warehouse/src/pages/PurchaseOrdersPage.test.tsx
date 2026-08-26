import { beforeEach, describe, it, expect } from "vitest";
import { fireEvent, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PurchaseOrdersPage } from "./PurchaseOrdersPage";
import { renderWithProviders } from "@/test/renderWithProviders";
import { PROCUREMENT_PO_KEY } from "@/data/procurementBridge";
import { InMemoryRepository } from "@/data/inMemoryRepository";
import type { ReceiveProcurementPOInput } from "@intra/data-kit";

class LiveProcurementRepository extends InMemoryRepository {
  receivedInputs: ReceiveProcurementPOInput[] = [];

  constructor(private readonly quantity = 2) {
    super();
  }

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
            quantity: this.quantity,
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
    expect(
      screen.queryByRole("button", { name: /new po/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /open procurement requests/i }),
    ).toHaveAttribute("href", "/procurement/requests");
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
    expect(link).toHaveClass("min-h-11");
    expect(
      within(list).getByRole("button", { name: /^receive and inspect$/i }),
    ).toBeInTheDocument();
    expect(
      within(list).getByText(/Acme Medical Supplies/i),
    ).toBeInTheDocument();
  });

  it("opens a per-line governed receipt breakdown from the Procurement handoff query", async () => {
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
    for (const outcome of [
      "Clean",
      "Damaged",
      "Unidentified",
      "Short",
      "Excess",
    ]) {
      expect(
        within(dialog).getByRole("spinbutton", {
          name: new RegExp(`${outcome} quantity for Smart watches`, "i"),
        }),
      ).toBeInTheDocument();
    }
    expect(
      within(dialog).getByLabelText(/clean serials for smart watches/i),
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
    const unidentified = within(dialog).getByRole("spinbutton", {
      name: /unidentified quantity for expected diagnostic kit/i,
    });
    await user.clear(unidentified);
    await user.type(unidentified, "2");

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

  it("submits a PO-0001 mixed serialized receipt as one governed command", async () => {
    const user = userEvent.setup();
    const repo = new LiveProcurementRepository(100);
    renderWithProviders(<PurchaseOrdersPage />, {
      role: "logistics_supervisor",
      repo,
      source: "supabase",
      capabilities: ["receive_stock"],
    });

    const list = await screen.findByLabelText("Purchase orders");
    await user.click(
      within(list).getByRole("button", { name: /^receive and inspect$/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /receive approved procurement po/i,
    });

    const setQuantity = async (outcome: string, quantity: number) => {
      const input = within(dialog).getByRole("spinbutton", {
        name: new RegExp(`${outcome} quantity for Smart watches`, "i"),
      });
      fireEvent.change(input, { target: { value: String(quantity) } });
    };
    await setQuantity("Clean", 50);
    await setQuantity("Damaged", 20);
    await setQuantity("Unidentified", 10);
    await setQuantity("Short", 20);

    const serials = (prefix: string, count: number) =>
      Array.from(
        { length: count },
        (_, index) => `${prefix}-${String(index + 1).padStart(3, "0")}`,
      );
    const cleanSerials = serials("CLEAN", 50);
    const damagedSerials = serials("DAMAGED", 20);
    const unidentifiedSerials = serials("UNKNOWN", 10);
    fireEvent.change(
      within(dialog).getByLabelText(/clean serials for smart watches/i),
      { target: { value: cleanSerials.join("\n") } },
    );
    fireEvent.change(
      within(dialog).getByLabelText(/damaged serials for smart watches/i),
      { target: { value: damagedSerials.join("\n") } },
    );
    fireEvent.change(
      within(dialog).getByLabelText(/unidentified serials for smart watches/i),
      { target: { value: unidentifiedSerials.join("\n") } },
    );
    await user.type(
      within(dialog).getByLabelText(/delivery evidence url/i),
      "evidence/po-0001-delivery.jpg",
    );
    await user.type(
      within(dialog).getByLabelText(/exception reason/i),
      "Mixed delivery condition documented at receiving",
    );

    expect(
      within(dialog).getByText(/80 physical.*20 short.*0 excess/i),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: /confirm governed receipt/i }),
    );

    await waitFor(() => expect(repo.receivedInputs).toHaveLength(1));
    expect(repo.receivedInputs[0]).toMatchObject({
      mode: "breakdown",
      poId: "live-po-1",
      locationId: "loc-wh",
      exceptionReason: "Mixed delivery condition documented at receiving",
      lines: [
        {
          mode: "breakdown",
          lineId: "live-line-1",
          productId: "smart-watch",
          expectedQuantity: 100,
          outcomes: {
            clean: { quantity: 50, serialNumbers: cleanSerials },
            damaged: { quantity: 20, serialNumbers: damagedSerials },
            unidentified: {
              quantity: 10,
              serialNumbers: unidentifiedSerials,
              observedDescription: "Smart watches",
            },
            short: { quantity: 20 },
            excess: { quantity: 0, serialNumbers: [] },
          },
        },
      ],
      evidenceUrls: ["evidence/po-0001-delivery.jpg"],
    });
  });

  it("blocks a receipt whose outcomes do not reconcile to the expected balance", async () => {
    const user = userEvent.setup();
    const repo = new LiveProcurementRepository(100);
    renderWithProviders(<PurchaseOrdersPage />, {
      role: "logistics_supervisor",
      repo,
      source: "supabase",
      capabilities: ["receive_stock"],
    });
    const list = await screen.findByLabelText("Purchase orders");
    await user.click(
      within(list).getByRole("button", { name: /^receive and inspect$/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /receive approved procurement po/i,
    });
    const clean = within(dialog).getByRole("spinbutton", {
      name: /clean quantity for smart watches/i,
    });
    fireEvent.change(clean, { target: { value: "79" } });
    await user.type(
      within(dialog).getByLabelText(/delivery evidence url/i),
      "evidence/mismatch.jpg",
    );

    expect(
      within(dialog).getByText(
        /outcomes must reconcile to 100 expected units/i,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /confirm governed receipt/i }),
    ).toBeDisabled();
    expect(repo.receivedInputs).toHaveLength(0);
  });

  it("blocks duplicate serialized identities across physical outcomes", async () => {
    const user = userEvent.setup();
    const repo = new LiveProcurementRepository(2);
    renderWithProviders(<PurchaseOrdersPage />, {
      role: "logistics_supervisor",
      repo,
      source: "supabase",
      capabilities: ["receive_stock"],
    });
    const list = await screen.findByLabelText("Purchase orders");
    await user.click(
      within(list).getByRole("button", { name: /^receive and inspect$/i }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: /receive approved procurement po/i,
    });
    const clean = within(dialog).getByRole("spinbutton", {
      name: /clean quantity for smart watches/i,
    });
    const damaged = within(dialog).getByRole("spinbutton", {
      name: /damaged quantity for smart watches/i,
    });
    fireEvent.change(clean, { target: { value: "1" } });
    fireEvent.change(damaged, { target: { value: "1" } });
    fireEvent.change(
      within(dialog).getByLabelText(/clean serials for smart watches/i),
      { target: { value: "DUPLICATE-001" } },
    );
    fireEvent.change(
      within(dialog).getByLabelText(/damaged serials for smart watches/i),
      { target: { value: "DUPLICATE-001" } },
    );

    expect(
      within(dialog).getByText(
        /serial numbers must be unique across outcomes/i,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /confirm governed receipt/i }),
    ).toBeDisabled();
    expect(repo.receivedInputs).toHaveLength(0);
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
    expect(
      within(list).queryByText(/mWellness Wearables/i),
    ).not.toBeInTheDocument();
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
    fireEvent.change(
      within(dialog).getByLabelText(/clean serials for smart watches/i),
      { target: { value: "LIVE-001\nLIVE-002" } },
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
