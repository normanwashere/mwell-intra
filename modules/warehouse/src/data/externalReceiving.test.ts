import { describe, expect, it, vi } from "vitest";
import {
  loadExternalReceiving,
  runExternalReceivingCommand,
  freezeExternalCommand,
  shipmentPostingIssue,
  type ExternalOrder,
  type ExternalShipment,
} from "./externalReceiving";

function client(
  data: unknown,
  error: { message: string; code?: string } | null = null,
) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { schema: vi.fn(() => ({ rpc })), rpc };
}

describe("external receiving RPC contract", () => {
  it("reads the warehouse workspace with an offset, preserving pagination metadata", async () => {
    const api = client({
      can_confirm: false,
      orders: [],
      has_more: true,
      next_offset: 100,
    });
    expect(await loadExternalReceiving(api)).toEqual({
      can_confirm: false,
      orders: [],
      has_more: true,
      next_offset: 100,
    });
    expect(api.schema).toHaveBeenCalledWith("warehouse");
    expect(api.rpc).toHaveBeenCalledWith("external_po_workspace", {
      payload: { offset: 0 },
    });
  });

  it("does not turn an error or malformed response into an empty workspace", async () => {
    await expect(
      loadExternalReceiving(
        client(null, { message: "Access denied", code: "42501" }),
      ),
    ).rejects.toThrow(
      "You do not have access to external receiving. Contact your administrator.",
    );
    for (const invalid of [
      null,
      {},
      { orders: [] },
      { can_confirm: true, orders: [{}] },
    ]) {
      await expect(loadExternalReceiving(client(invalid))).rejects.toThrow(
        /invalid/i,
      );
    }
  });

  it("sends exactly the frozen snake-case command on every retry", async () => {
    const input = {
      action: "save_order" as const,
      order_id: crypto.randomUUID(),
      version: 0,
      po_number: null,
      supplier_id: "supplier",
      location_id: "location",
      email_sender: "sender@example.com",
      email_date: null,
      notes: "",
      evidence_urls: ["warehouse-po-evidence/user/file.pdf"],
      lines: [
        { id: crypto.randomUUID(), product_id: "sku", quantity: 2, uom: "pcs" },
      ],
    };
    const frozen = freezeExternalCommand(input);
    input.lines[0]!.quantity = 90;
    const api = client({ order_id: input.order_id });
    await runExternalReceivingCommand(api, frozen);
    await runExternalReceivingCommand(api, frozen);
    expect(api.rpc.mock.calls[0]).toEqual(api.rpc.mock.calls[1]);
    expect(api.rpc).toHaveBeenCalledWith("external_po_command", {
      payload: expect.objectContaining({
        action: "save_order",
        idempotency_key: expect.any(String),
        lines: [expect.objectContaining({ quantity: 2 })],
      }),
    });
    expect(Object.isFrozen(frozen.lines)).toBe(true);
  });

  it("marks transport and invalid acknowledgements as uncertain, not successful", async () => {
    const request = freezeExternalCommand({
      action: "post_shipment",
      order_id: "order",
      shipment_id: "shipment",
      version: 1,
    });
    await expect(
      runExternalReceivingCommand(client(null), request),
    ).rejects.toMatchObject({ uncertain: true });
    await expect(
      runExternalReceivingCommand(client({ order_id: "other" }), request),
    ).rejects.toMatchObject({ uncertain: true });
    await expect(
      runExternalReceivingCommand(
        client(null, { message: "Conflict", code: "40001" }),
        request,
      ),
    ).rejects.toMatchObject({ uncertain: false });
    const api = client(null);
    api.rpc.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(
      runExternalReceivingCommand(api, request),
    ).rejects.toMatchObject({ uncertain: true });
  });

  it.each(["PGRST202", "PGRST106", "3F000", "42883"])(
    "maps unavailable RPC/schema %s without exposing internal names",
    async (code) => {
      const api = client(null, {
        code,
        message:
          "Could not find warehouse.external_po_workspace in the schema cache",
      });
      const expected =
        "External receiving is not available in this environment yet. Contact support.";
      await expect(loadExternalReceiving(api)).rejects.toMatchObject({
        message: expected,
        uncertain: false,
      });
      const request = freezeExternalCommand({
        action: "confirm_order",
        order_id: "order",
        version: 1,
        review_note: "Checked",
      });
      await expect(
        runExternalReceivingCommand(api, request),
      ).rejects.toMatchObject({
        message: expected,
        uncertain: code !== "42883",
      });
    },
  );

  it.each(["PGRST301", "PGRST302", "PGRST303", "28000", "28P01"])(
    "maps authentication error %s to sign-in guidance",
    async (code) => {
      const api = client(null, {
        code,
        message: "JWT verification failed: internal details",
      });
      await expect(loadExternalReceiving(api)).rejects.toThrow(
        "Your session could not be verified. Sign in again to continue.",
      );
    },
  );

  it.each([
    "permission denied for schema warehouse",
    "new row violates row-level security policy",
    "Not authorized to record external PO deliveries.",
  ])("maps generic access rejection: %s", async (message) => {
    const api = client(null, { code: "42501", message });
    const request = freezeExternalCommand({
      action: "confirm_order",
      order_id: "order",
      version: 1,
      review_note: "Checked",
    });
    await expect(
      runExternalReceivingCommand(api, request),
    ).rejects.toMatchObject({
      message:
        "You do not have access to external receiving. Contact your administrator.",
      uncertain: false,
    });
  });

  it.each([
    { code: "", message: "TypeError: Failed to fetch" },
    { code: "PGRST000", message: "Database connection unavailable" },
    {
      code: "PGRST002",
      message: "Could not query the database for the schema cache",
    },
    { code: "08006", message: "connection failure" },
    { code: "57014", message: "canceling statement due to statement timeout" },
  ])(
    "makes network/service outages retryable without claiming a command failed: $code $message",
    async (error) => {
      const api = client(null, error);
      await expect(loadExternalReceiving(api)).rejects.toMatchObject({
        message:
          "Could not connect to external receiving. Check your connection and retry.",
        uncertain: false,
      });
      const request = freezeExternalCommand({
        action: "confirm_order",
        order_id: "order",
        version: 1,
        review_note: "Checked",
      });
      await expect(
        runExternalReceivingCommand(api, request),
      ).rejects.toMatchObject({
        message:
          "The action could not be confirmed. Check your connection and retry the saved action to check its outcome.",
        uncertain: true,
      });
    },
  );

  it("maps thrown read failures without treating them as an empty workspace", async () => {
    const api = client(null);
    api.rpc.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(loadExternalReceiving(api)).rejects.toMatchObject({
      message:
        "Could not connect to external receiving. Check your connection and retry.",
      uncertain: false,
    });
    const request = freezeExternalCommand({
      action: "confirm_order",
      order_id: "order",
      version: 1,
      review_note: "Checked",
    });
    await expect(
      runExternalReceivingCommand(api, request),
    ).rejects.toMatchObject({
      message:
        "The action could not be confirmed. Check your connection and retry the saved action to check its outcome.",
      uncertain: true,
    });
  });

  it.each([
    {
      code: "P0001",
      message:
        "Delivered quantity exceeds the remaining PO quantity. Keep the excess aside.",
    },
    {
      code: "42501",
      message:
        "Only the receiver who saved this delivery can change or post it.",
    },
    { code: "40001", message: "This PO changed. Reload it before reviewing." },
  ])("preserves server business messages: $code", async (error) => {
    const api = client(null, error);
    await expect(loadExternalReceiving(api)).rejects.toThrow(error.message);
    const request = freezeExternalCommand({
      action: "confirm_order",
      order_id: "order",
      version: 1,
      review_note: "Checked",
    });
    await expect(
      runExternalReceivingCommand(api, request),
    ).rejects.toMatchObject({ message: error.message, uncertain: false });
  });
});

describe("posting boundaries", () => {
  const order = {
    status: "confirmed",
    lines: [{ id: "line", quantity: 10, received_quantity: 6 }],
  } as ExternalOrder;
  const shipment = {
    status: "draft",
    evidence_urls: ["shipment/photo.jpg"],
    lines: [{ po_line_id: "line", quantity: 4, serial_numbers: [] }],
  } as unknown as ExternalShipment;
  it("permits multiple partials only within remaining quantities", () => {
    expect(shipmentPostingIssue(order, shipment)).toBeNull();
    expect(
      shipmentPostingIssue(order, {
        ...shipment,
        lines: [{ ...shipment.lines[0]!, quantity: 5 }],
      }),
    ).toMatch(/correction/i);
    expect(
      shipmentPostingIssue(order, {
        ...shipment,
        lines: [shipment.lines[0]!, shipment.lines[0]!],
      }),
    ).toMatch(/correction/i);
  });
  it("keeps unconfirmed and unidentified arrivals in draft", () => {
    expect(
      shipmentPostingIssue({ ...order, status: "draft" }, shipment),
    ).toMatch(/confirmation/i);
    expect(
      shipmentPostingIssue(order, {
        ...shipment,
        lines: [{ ...shipment.lines[0]!, po_line_id: "unknown" }],
      }),
    ).toMatch(/correction/i);
  });
  it("requires image evidence and exact distinct serial quantities before posting", () => {
    const products = [{ id: "product", serialized: true }];
    const serialOrder = {
      ...order,
      lines: [{ ...order.lines[0]!, product_id: "product" }],
    };
    expect(
      shipmentPostingIssue(
        serialOrder,
        { ...shipment, evidence_urls: [] },
        products,
      ),
    ).toMatch(/photo evidence/i);
    expect(shipmentPostingIssue(serialOrder, shipment, products)).toMatch(
      /every delivered unit/i,
    );
    const serialShipment = {
      ...shipment,
      lines: [
        { ...shipment.lines[0]!, serial_numbers: ["SN1", "sn1", "SN3", "SN4"] },
      ],
    };
    expect(shipmentPostingIssue(serialOrder, serialShipment, products)).toMatch(
      /unique/i,
    );
    expect(
      shipmentPostingIssue(
        serialOrder,
        {
          ...serialShipment,
          lines: [
            {
              ...serialShipment.lines[0]!,
              serial_numbers: ["SN1", "SN2", "SN3", "SN4"],
            },
          ],
        },
        products,
      ),
    ).toBeNull();
  });
});
