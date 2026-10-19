import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExternalReceivingPage } from "./ExternalReceivingPage";
import type {
  ExternalOrder,
  ExternalReceivingWorkspace,
} from "@/data/externalReceiving";
import { WAREHOUSE_ROUTE_BY_ID } from "@/app/modules";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  refresh: vi.fn(),
  caps: ["receive_stock", "inspect_quality", "transfer_stock"],
  mode: "supabase",
  user: "receiver",
}));
const client = { schema: () => ({ rpc: mock.rpc }) };
const warehouse = {
  data: {
    products: [
      {
        id: "product",
        name: "Medical device",
        sku: "MD-1",
        uom: "piece",
        serialized: false,
      },
    ],
    suppliers: [{ id: "supplier", name: "Medical supplier" }],
    locations: [{ id: "location", name: "Main warehouse", type: "warehouse" }],
    storageAreas: [
      { id: "bin", locationId: "location", code: "A-1", active: true },
    ],
  },
  can: (cap: string) => mock.caps.includes(cap),
  refresh: mock.refresh,
};
vi.mock("@/auth/session", () => ({
  useSession: () => ({
    mode: mock.mode,
    profile: { id: mock.user },
    supabaseClient: client,
  }),
}));
vi.mock("@/app/store", () => ({ useWarehouse: () => warehouse }));
vi.mock("@/components/ExternalPOEvidence", () => ({
  ExternalPOEvidence: () => <div>PO documents</div>,
}));
vi.mock("@/components/camera/EvidenceCapture", () => ({
  EvidenceCapture: ({ onChange }: { onChange: (value: string[]) => void }) => (
    <button type="button" onClick={() => onChange(["shipment/photo.jpg"])}>
      Attach shipment photo
    </button>
  ),
}));
vi.mock("@/components/EvidenceGallery", () => ({
  EvidenceGallery: () => <div>Saved shipment photos</div>,
}));

const makeOrder = (): ExternalOrder => ({
  id: "11111111-1111-4111-8111-111111111111",
  po_number: "EMAIL-101",
  supplier_id: "supplier",
  location_id: "location",
  status: "draft",
  evidence_urls: ["warehouse-po-evidence/creator/upload/document.pdf"],
  email_sender: "supplier@example.com",
  email_date: "2026-10-18",
  notes: "",
  version: 1,
  created_by: "receiver",
  confirmed_by: null,
  review_note: null,
  created_at: "2026-10-18T00:00:00Z",
  lines: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      product_id: "product",
      quantity: 10,
      received_quantity: 0,
      uom: "piece",
    },
  ],
  shipments: [],
});
let workspace: ExternalReceivingWorkspace;
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  mock.mode = "supabase";
  mock.user = "receiver";
  mock.caps = ["receive_stock", "inspect_quality", "transfer_stock"];
  mock.refresh.mockResolvedValue(undefined);
  workspace = { can_confirm: false, orders: [makeOrder()] };
  mock.rpc.mockImplementation(async (name: string) =>
    name === "external_po_workspace"
      ? { data: structuredClone(workspace), error: null }
      : { data: null, error: { code: "P0001", message: "Not configured" } },
  );
});
const mount = () =>
  render(
    <MemoryRouter
      basename="/warehouse"
      initialEntries={["/warehouse/external-receiving"]}
    >
      <ExternalReceivingPage />
    </MemoryRouter>,
  );
async function openOrder() {
  fireEvent.click(
    await screen.findByRole("button", { name: /Open EMAIL-101/ }),
  );
  return screen.findByRole("dialog");
}
function savedShipment() {
  const order = workspace.orders[0]!;
  order.shipments = [
    {
      id: "33333333-3333-4333-8333-333333333333",
      order_id: order.id,
      delivery_reference: "DR-42",
      actual_delivery_date: "2026-10-19",
      bin_id: "bin",
      evidence_urls: ["shipment/photo.jpg"],
      notes: "Partial delivery",
      status: "draft",
      receipt_id: null,
      version: 1,
      created_by: "receiver",
      lines: [
        { po_line_id: order.lines[0]!.id, quantity: 4, serial_numbers: [] },
      ],
    },
  ];
}

describe("external receiving workflow", () => {
  it('links each posted shipment product to its exact warehouse and receipt, not generic Storage', async () => {
    savedShipment();
    const shipment = workspace.orders[0]!.shipments[0]!;
    shipment.status = 'posted';
    shipment.receipt_id = 'external-receipt-one';
    mount();
    const dialog = await openOrder();
    expect(within(dialog).getByRole('link', { name: 'Open Storage: Medical device' })).toHaveAttribute(
      'href', '/warehouse/storage?warehouse=location&receipt=external-receipt-one&product=product',
    );
    expect(within(dialog).queryByRole('link', { name: 'Open Storage' })).not.toBeInTheDocument();
    expect(mock.rpc.mock.calls.every(([name]) => name === 'external_po_workspace')).toBe(true);
  });

  it.each(['receive_stock', 'manage_locations'])('does not offer receipt putaway without transfer authority (%s)', async (cap) => {
    savedShipment();
    workspace.orders[0]!.shipments[0]!.status = 'posted';
    workspace.orders[0]!.shipments[0]!.receipt_id = 'external-receipt-one';
    mock.caps = ['receive_stock', cap];
    mount();
    const dialog = await openOrder();
    expect(within(dialog).queryByRole('link', { name: /Open Storage/ })).not.toBeInTheDocument();
  });

  it("links receiving users directly to Procurement PO receiving alongside registration", async () => {
    mock.caps = ["receive_stock"];
    mount();
    await screen.findByRole("button", { name: /Open EMAIL-101/ });
    const header = within(screen.getByRole("banner"));
    expect(header.getByRole("link", { name: "Procurement PO receiving" })).toHaveAttribute(
      "href",
      "/warehouse/purchase-orders",
    );
    expect(WAREHOUSE_ROUTE_BY_ID["purchase-orders"].gateCapabilityIds).toContain("receive_stock");
    expect(header.getByRole("button", { name: "Register emailed PO" })).toBeEnabled();
  });

  it.each(["inspect_quality", "view_procurement"])("hides Procurement PO receiving from %s-only users", async (capability) => {
    mock.caps = [capability];
    mount();
    await screen.findByRole("button", { name: /Open EMAIL-101/ });
    expect(screen.queryByRole("link", { name: "Procurement PO receiving" })).not.toBeInTheDocument();
  });

  it("clears a rejected PO save when returning to the record and switching to shipment entry", async () => {
    mount();
    await openOrder();
    fireEvent.click(screen.getByRole("button", { name: "Edit PO record" }));
    fireEvent.click(screen.getByRole("button", { name: "Save PO record" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not configured");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Back to PO record" }));
    expect(screen.getByRole("dialog", { name: "EMAIL-101" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record shipment" }));
    expect(screen.getByRole("dialog", { name: "Shipment arrival" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["Record shipment", "Resume DR-42"])("does not carry a rejected posting error into %s", async (action) => {
    savedShipment();
    workspace.orders[0]!.status = "confirmed";
    mount();
    await openOrder();
    fireEvent.click(screen.getByRole("button", { name: "Post DR-42 to Quality" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not configured");
    fireEvent.click(screen.getByRole("button", { name: action }));
    expect(screen.getByRole("dialog", { name: "Shipment arrival" })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not present the previous save notice as the status of a new edit", async () => {
    mock.rpc.mockImplementation(async (name) => {
      if (name === "external_po_workspace") return { data: structuredClone(workspace), error: null };
      workspace.orders[0]!.version++;
      return { data: { order_id: workspace.orders[0]!.id }, error: null };
    });
    mount();
    await openOrder();
    fireEvent.click(screen.getByRole("button", { name: "Edit PO record" }));
    fireEvent.click(screen.getByRole("button", { name: "Save PO record" }));
    expect(await screen.findByText("Saved record verified.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Edit PO record" }));
    expect(screen.getByRole("dialog", { name: "Edit PO record" })).toBeVisible();
    expect(screen.queryByText("Saved record verified.")).not.toBeInTheDocument();
  });

  it.each(["receipt-42", "receipt/42?line=1&note=two words#detail"])(
    "links the posted shipment Quality handoff to its encoded receipt %s",
    async (receiptId) => {
      savedShipment();
      const shipment = workspace.orders[0]!.shipments[0]!;
      shipment.status = "posted";
      shipment.receipt_id = receiptId;
      mount();
      await openOrder();
      const shipments = within(screen.getByRole("list", { name: "Saved shipments" }));
      expect(shipments.getByRole("link", { name: "Review Quality" })).toHaveAttribute(
        "href",
        `/warehouse/quality?source=${encodeURIComponent(receiptId)}`,
      );
      expect(screen.getByRole("link", { name: "Open Quality" })).toHaveAttribute("href", "/warehouse/quality");
      expect(mock.rpc.mock.calls.every(([name]) => name === "external_po_workspace")).toBe(true);
    },
  );
  it.each([
    { status: "draft" as const, receiptId: "receipt-42", caps: ["inspect_quality"] },
    { status: "posted" as const, receiptId: null, caps: ["inspect_quality"] },
    { status: "posted" as const, receiptId: "receipt-42", caps: ["view_procurement"] },
  ])("hides the shipment Quality handoff without a posted receipt and Quality access: $status, $receiptId, $caps", async ({ status, receiptId, caps }) => {
    savedShipment();
    const shipment = workspace.orders[0]!.shipments[0]!;
    shipment.status = status;
    shipment.receipt_id = receiptId;
    mock.caps = caps;
    mount();
    await openOrder();
    expect(screen.queryByRole("link", { name: "Review Quality" })).not.toBeInTheDocument();
  });

  it("registers the internal route with exactly the requested OR gates", () => {
    expect(WAREHOUSE_ROUTE_BY_ID["external-receiving"]).toMatchObject({
      path: "/external-receiving",
      gateCapabilityIds: [
        "receive_stock",
        "inspect_quality",
        "view_procurement",
      ],
    });
    expect(WAREHOUSE_ROUTE_BY_ID.receiving.path).toBe("/receiving");
    expect(WAREHOUSE_ROUTE_BY_ID["purchase-orders"].path).toBe(
      "/purchase-orders",
    );
  });
  it("shows errors instead of an empty queue and retries the read", async () => {
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Connection unavailable" },
    });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not connect to external receiving. Check your connection and retry.",
    );
    expect(
      screen.queryByText("No emailed POs registered"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
    expect(
      await screen.findByRole("button", { name: /Open EMAIL-101/ }),
    ).toBeEnabled();
  });
  it("shows the unavailable-environment message and the complete operational sequence", async () => {
    mock.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "PGRST202",
        message:
          "Could not find warehouse.external_po_workspace in the schema cache",
      },
    });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "External receiving is not available in this environment yet. Contact support.",
    );
    expect(screen.queryByText(/schema cache/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("No emailed POs registered"),
    ).not.toBeInTheDocument();
    const steps = within(
      screen.getByRole("list", { name: "External receiving workflow" }),
    ).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual([
      "1. Register emailed PO",
      "2. Operations Lead confirmation",
      "3. Save shipment arrival",
      "4. Post to Quality",
      "5. Quality inspection",
      "6. Putaway",
    ]);
  });
  it("does not write or show a simulated queue in memory mode", () => {
    mock.mode = "memory";
    mount();
    expect(screen.getByRole("alert")).toHaveTextContent("signed-in");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "never offers creator self-confirmation (can_confirm %s)",
    async (canConfirm) => {
      workspace.can_confirm = canConfirm;
      mount();
      await openOrder();
      expect(
        screen.queryByRole("button", { name: "Confirm PO record" }),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/not purchase approval/i)).toBeInTheDocument();
    },
  );
  it("keeps QA and procurement viewers out of shipment mutations", async () => {
    mock.caps = ["inspect_quality"];
    mount();
    await openOrder();
    expect(
      screen.queryByRole("button", { name: "Record shipment" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit PO record" }),
    ).not.toBeInTheDocument();
  });
  it("allows an independent Operations Lead to confirm through the exact RPC", async () => {
    workspace.can_confirm = true;
    mock.user = "lead";
    mock.caps = ["view_procurement"];
    mock.rpc.mockImplementation(async (name, args) => {
      if (name === "external_po_workspace")
        return { data: structuredClone(workspace), error: null };
      workspace.orders[0]!.status = "confirmed";
      workspace.orders[0]!.version++;
      return { data: { order_id: args.payload.order_id }, error: null };
    });
    mount();
    await openOrder();
    fireEvent.change(screen.getByLabelText("Review note"), {
      target: { value: "Matches emailed PO" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm PO record" }));
    await waitFor(() => expect(mock.refresh).toHaveBeenCalledOnce());
    expect(mock.rpc).toHaveBeenCalledWith("external_po_command", {
      payload: expect.objectContaining({
        action: "confirm_order",
        version: 1,
        review_note: "Matches emailed PO",
        idempotency_key: expect.any(String),
      }),
    });
    expect(
      screen.queryByRole("button", { name: "Edit PO record" }),
    ).not.toBeInTheDocument();
  });
  it("resumes a saved draft shipment with server quantities and no inventory write", async () => {
    savedShipment();
    mount();
    await openOrder();
    fireEvent.click(screen.getByRole("button", { name: "Resume DR-42" }));
    expect(screen.getByLabelText("Delivery reference")).toHaveValue("DR-42");
    expect(
      screen.getByLabelText("Delivered quantity for Medical device"),
    ).toHaveValue(4);
    expect(screen.getByText(/arrival record only/i)).toBeInTheDocument();
    expect(
      mock.rpc.mock.calls.every(([name]) => name === "external_po_workspace"),
    ).toBe(true);
  });
  it("saves a shipment against an unconfirmed order, reads it back, then posts only after confirmation", async () => {
    mock.rpc.mockImplementation(async (name, args) => {
      if (name === "external_po_workspace")
        return { data: structuredClone(workspace), error: null };
      const p = args.payload;
      if (p.action === "save_shipment") {
        workspace.orders[0]!.shipments.push({
          ...p,
          id: p.shipment_id,
          status: "draft",
          receipt_id: null,
          version: 1,
          created_by: "receiver",
        });
        return {
          data: { order_id: p.order_id, shipment_id: p.shipment_id },
          error: null,
        };
      }
      workspace.orders[0]!.shipments[0]!.status = "posted";
      workspace.orders[0]!.shipments[0]!.receipt_id = "receipt-1";
      return {
        data: {
          order_id: p.order_id,
          shipment_id: p.shipment_id,
          receipt_id: "receipt-1",
        },
        error: null,
      };
    });
    const view = mount();
    await openOrder();
    fireEvent.click(screen.getByRole("button", { name: "Record shipment" }));
    fireEvent.change(screen.getByLabelText("Delivery reference"), {
      target: { value: "DR-new" },
    });
    fireEvent.change(screen.getByLabelText("Actual delivery date"), {
      target: { value: "2026-10-19" },
    });
    fireEvent.change(screen.getByLabelText("Arrival bin"), {
      target: { value: "bin" },
    });
    fireEvent.change(
      screen.getByLabelText("Delivered quantity for Medical device"),
      { target: { value: "3" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Attach shipment photo" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save shipment" }));
    await waitFor(() => expect(mock.refresh).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("button", { name: "Post DR-new to Quality" }),
    ).toBeDisabled();
    view.unmount();
    workspace.orders[0]!.status = "confirmed";
    mount();
    await openOrder();
    fireEvent.click(
      screen.getByRole("button", { name: "Post DR-new to Quality" }),
    );
    await waitFor(() => expect(mock.refresh).toHaveBeenCalledTimes(2));
    expect(mock.rpc).toHaveBeenCalledWith("external_po_command", {
      payload: expect.objectContaining({
        action: "post_shipment",
        version: 1,
        shipment_id: workspace.orders[0]!.shipments[0]!.id,
      }),
    });
    expect(screen.getByRole("link", { name: "Open Quality" })).toHaveAttribute(
      "href",
      "/warehouse/quality",
    );
    expect(screen.getByRole("link", { name: "Open Storage: Medical device" })).toHaveAttribute(
      "href",
      "/warehouse/storage?warehouse=location&receipt=receipt-1&product=product",
    );
  });
  it("freezes uncertain writes, disables editing, and restores the same retry after remount", async () => {
    savedShipment();
    workspace.orders[0]!.status = "confirmed";
    let reject!: (reason: unknown) => void;
    mock.rpc.mockImplementation((name) =>
      name === "external_po_workspace"
        ? Promise.resolve({ data: structuredClone(workspace), error: null })
        : new Promise((_, fail) => {
            reject = fail;
          }),
    );
    const view = mount();
    await openOrder();
    fireEvent.click(
      screen.getByRole("button", { name: "Post DR-42 to Quality" }),
    );
    expect(screen.getByRole("button", { name: "Resume DR-42" })).toBeDisabled();
    await act(async () => reject(new TypeError("Failed to fetch")));
    const original = mock.rpc.mock.calls.find(
      ([name]) => name === "external_po_command",
    )![1];
    view.unmount();
    mount();
    const retry = await screen.findByRole("button", {
      name: "Retry saved action",
    });
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await waitFor(() =>
      expect(
        mock.rpc.mock.calls.filter(([name]) => name === "external_po_command"),
      ).toHaveLength(2),
    );
    expect(
      mock.rpc.mock.calls.filter(
        ([name]) => name === "external_po_command",
      )[1]![1],
    ).toEqual(original);
    await act(async () => reject(new TypeError("Failed to fetch")));
  });
  it("leaves excess shipments as draft with a correction reason", async () => {
    savedShipment();
    workspace.orders[0]!.status = "confirmed";
    workspace.orders[0]!.lines[0]!.received_quantity = 8;
    mount();
    const dialog = await openOrder();
    expect(
      within(dialog).getByRole("button", { name: "Post DR-42 to Quality" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByText(
        /^Document correction required: excess or unidentified/i,
      ),
    ).toBeInTheDocument();
  });
  it("loads subsequent pages without losing saved pending arrivals", async () => {
    workspace.has_more = true;
    workspace.next_offset = 100;
    const second = {
      ...makeOrder(),
      id: crypto.randomUUID(),
      po_number: "EMAIL-202",
    };
    mock.rpc.mockImplementation(async (_name, args) => ({
      data:
        args.payload.offset === 100
          ? {
              can_confirm: false,
              orders: [second],
              has_more: false,
              next_offset: 200,
            }
          : structuredClone(workspace),
      error: null,
    }));
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Load more orders" }),
    );
    expect(
      await screen.findByRole("button", { name: "Open EMAIL-202" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open EMAIL-101" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Load more orders" }),
    ).not.toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledWith("external_po_workspace", {
      payload: { offset: 100 },
    });
  });
  it("does not let another receiver edit or post someone else's saved records", async () => {
    savedShipment();
    mock.user = "other-receiver";
    mount();
    await openOrder();
    expect(
      screen.queryByRole("button", { name: "Edit PO record" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Resume DR-42" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Post DR-42 to Quality" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("DR-42")).toBeInTheDocument();
  });
  it("does not resend an acknowledged action when exact-record readback fails", async () => {
    savedShipment();
    workspace.orders[0]!.status = "confirmed";
    let failRead = true;
    mock.rpc.mockImplementation(async (name, args) => {
      if (name === "external_po_command") {
        const shipment = workspace.orders[0]!.shipments[0]!;
        shipment.status = "posted";
        shipment.receipt_id = "receipt-42";
        return {
          data: {
            order_id: args.payload.order_id,
            shipment_id: args.payload.shipment_id,
            receipt_id: "receipt-42",
          },
          error: null,
        };
      }
      if (args.payload.order_id && failRead)
        return { data: null, error: { message: "Readback unavailable" } };
      return { data: structuredClone(workspace), error: null };
    });
    mount();
    await openOrder();
    fireEvent.click(
      screen.getByRole("button", { name: "Post DR-42 to Quality" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Readback unavailable",
    );
    failRead = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry verification" }));
    await waitFor(() => expect(mock.refresh).toHaveBeenCalledOnce());
    expect(
      mock.rpc.mock.calls.filter(([name]) => name === "external_po_command"),
    ).toHaveLength(1);
    expect(mock.rpc).toHaveBeenCalledWith("external_po_workspace", {
      payload: { order_id: workspace.orders[0]!.id },
    });
    expect(screen.getByText(/normal putaway in Storage/)).toBeInTheDocument();
  });
  it("registers a missing-document PO draft with catalog UOM and stable client IDs", async () => {
    workspace.orders = [];
    mock.rpc.mockImplementation(async (name, args) => {
      if (name === "external_po_workspace")
        return { data: structuredClone(workspace), error: null };
      const p = args.payload;
      workspace.orders = [
        {
          ...makeOrder(),
          ...p,
          id: p.order_id,
          version: 1,
          lines: p.lines.map((line: object) => ({
            ...line,
            received_quantity: 0,
          })),
          shipments: [],
        },
      ];
      return { data: { order_id: p.order_id }, error: null };
    });
    mount();
    await screen.findByText("No emailed POs registered");
    fireEvent.click(
      screen.getByRole("button", { name: "Register emailed PO" }),
    );
    fireEvent.change(screen.getByLabelText("Supplier"), {
      target: { value: "supplier" },
    });
    fireEvent.change(screen.getByLabelText("Receiving location"), {
      target: { value: "location" },
    });
    fireEvent.change(screen.getByLabelText("Product 1"), {
      target: { value: "product" },
    });
    fireEvent.change(screen.getByLabelText("Quantity 1"), {
      target: { value: "7" },
    });
    expect(screen.getByLabelText("UOM 1")).toHaveValue("piece");
    fireEvent.click(screen.getByRole("button", { name: "Save PO record" }));
    await waitFor(() => expect(mock.refresh).toHaveBeenCalledOnce());
    expect(mock.rpc).toHaveBeenCalledWith("external_po_command", {
      payload: expect.objectContaining({
        action: "save_order",
        version: 0,
        po_number: null,
        order_id: expect.stringMatching(/^[a-f0-9-]{36}$/),
        evidence_urls: [],
        lines: [
          expect.objectContaining({
            id: expect.stringMatching(/^[a-f0-9-]{36}$/),
            quantity: 7,
            uom: "piece",
          }),
        ],
      }),
    });
  });
  it("requires a review note and allows return for correction without purchase approval", async () => {
    workspace.can_confirm = true;
    mock.user = "lead";
    mock.rpc.mockImplementation(async (name, args) => {
      if (name === "external_po_workspace")
        return { data: structuredClone(workspace), error: null };
      workspace.orders[0]!.status = "returned";
      workspace.orders[0]!.review_note = args.payload.review_note;
      return { data: { order_id: args.payload.order_id }, error: null };
    });
    mount();
    await openOrder();
    expect(
      screen.getByRole("button", { name: "Confirm PO record" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Return for correction" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Review note"), {
      target: { value: "Quantity does not match the attachment" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Return for correction" }),
    );
    await waitFor(() => expect(mock.refresh).toHaveBeenCalledOnce());
    expect(mock.rpc).toHaveBeenCalledWith("external_po_command", {
      payload: expect.objectContaining({
        action: "return_order",
        version: 1,
        review_note: "Quantity does not match the attachment",
      }),
    });
  });
});
