import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  buildSeed,
  type FulfillmentAction,
  type FulfillmentOrder,
} from "@intra/data-kit";
import { ToastProvider } from "@/components/ui";
import { makeRepo } from "@/test/renderWithProviders";
import type { Capability } from "@/auth/roles";
import { useWarehouse, WarehouseProvider } from "./store";

function AcknowledgmentProbe({ action }: { action: FulfillmentAction }) {
  const warehouse = useWarehouse();
  const [result, setResult] = useState<boolean>();
  return (
    <>
      <button
        disabled={!warehouse.data}
        onClick={async () =>
          setResult(
            await warehouse.advanceFulfillmentOrder({
              orderId: "ack-order",
              action,
              acknowledgementReference: "ACK-SEP9",
              acknowledgementEvidenceUrl: "acceptance/proof.jpg",
            }),
          )
        }
      >
        Submit action
      </button>
      <output aria-label="Result">
        {result === undefined ? "pending" : String(result)}
      </output>
      <output aria-label="Action status">{warehouse.lastActionStatus}</output>
    </>
  );
}

async function setup({
  capabilities = [],
  createdBy = "other-requester",
  releasedBy = "releaser-id",
  requestedBy,
  action = "acknowledge_receipt",
  status = "released",
  deliveryMethod = "internal_handover",
}: {
  capabilities?: Capability[];
  createdBy?: string;
  releasedBy?: string;
  requestedBy?: string;
  action?: FulfillmentAction;
  status?: FulfillmentOrder["status"];
  deliveryMethod?: FulfillmentOrder["deliveryMethod"];
} = {}) {
  const data = buildSeed();
  data.fulfillmentOrders = [
    {
      id: "ack-order",
      externalReference: "ACK-ORDER",
      source: "department_request",
      deliveryMethod,
      status,
      createdBy,
      releasedBy,
      createdAt: "2026-09-09T01:00:00Z",
      updatedAt: "2026-09-09T01:00:00Z",
      packaging: [],
      shipmentEvents: [],
      lines: [
        {
          productId: "doctor-token",
          quantity: 1,
          pickedQuantity: 1,
          pickedSerialNumbers: [],
        },
      ],
    },
  ];
  data.departmentStockRequests = requestedBy
    ? [
        {
          id: "linked-request",
          fulfillmentOrderId: "ack-order",
          requestedBy,
          requestingDepartment: "marketing",
          requestedAt: "2026-09-09T01:00:00Z",
          purpose: "Event",
          costCenter: "CC-1",
          requiredDate: "2026-09-09",
          expenseTreatment: "expense",
          status: "issued",
          lines: [{ productId: "doctor-token", quantity: 1 }],
        },
      ]
    : [];
  const repo = makeRepo(data);
  const advance = vi.spyOn(repo, "advanceFulfillmentOrder");
  render(
    <ToastProvider>
      <WarehouseProvider
        repo={repo}
        source="supabase"
        actor="requester@example.com"
        identityId="requester-id"
        capabilities={capabilities}
      >
        <AcknowledgmentProbe action={action} />
      </WarehouseProvider>
    </ToastProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Submit action" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Submit action" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Result")).not.toHaveTextContent("pending"),
  );
  return { repo, advance };
}

describe("action-specific receipt acknowledgment authorization", () => {
  it.each(["internal_handover", "event_handover", "third_party_transfer"] as const)(
    "accepts recipient acknowledgment for %s",
    async (deliveryMethod) => {
      const { advance } = await setup({ deliveryMethod, capabilities: ["request_fulfillment"] });
      expect(screen.getByLabelText("Result")).toHaveTextContent("true");
      expect(advance).toHaveBeenCalledOnce();
    },
  );

  it("blocks direct shipment acknowledgment even for an authorized creator", async () => {
    const { repo, advance } = await setup({
      deliveryMethod: "shipment",
      createdBy: "requester-id",
      capabilities: ["request_fulfillment", "issue_items"],
    });
    expect(screen.getByLabelText("Result")).toHaveTextContent("false");
    expect(screen.getByLabelText("Action status")).toHaveTextContent("failed");
    expect(advance).not.toHaveBeenCalled();
    expect((await repo.getData()).fulfillmentOrders[0]?.status).toBe("released");
    expect(screen.getByText(/Shipments require proof of delivery/)).toBeVisible();
  });

  it.each([
    {
      name: "request_fulfillment-only recorder",
      capabilities: ["request_fulfillment"] as Capability[],
    },
    {
      name: "issue_items recorder",
      capabilities: ["issue_items"] as Capability[],
    },
    {
      name: "order creator without fulfillment capabilities",
      createdBy: "requester-id",
    },
    {
      name: "linked requester without fulfillment capabilities",
      requestedBy: "requester-id",
    },
  ])("accepts the SQL-authorized $name", async (options) => {
    const { repo, advance } = await setup(options);
    expect(screen.getByLabelText("Result")).toHaveTextContent("true");
    expect(screen.getByLabelText("Action status")).toHaveTextContent(
      "committed",
    );
    expect(advance).toHaveBeenCalledOnce();
    expect((await repo.getData()).fulfillmentOrders[0]).toMatchObject({
      status: "completed",
      acknowledgementReference: "ACK-SEP9",
      acknowledgementEvidenceUrl: "acceptance/proof.jpg",
    });
  });

  it.each([
    { name: "nonowner without capabilities" },
    {
      name: "nonowner with only request_stock",
      capabilities: ["request_stock"] as Capability[],
    },
    {
      name: "nonowner with only reserve_allocate",
      capabilities: ["reserve_allocate"] as Capability[],
    },
    {
      name: "releasing profile despite request_fulfillment",
      releasedBy: "requester-id",
      capabilities: ["request_fulfillment"] as Capability[],
    },
    {
      name: "releasing actor despite being creator",
      releasedBy: "requester@example.com",
      createdBy: "requester-id",
    },
    {
      name: "creator before release",
      createdBy: "requester-id",
      status: "ready" as const,
    },
  ])("rejects $name before the repository call", async (options) => {
    const { advance } = await setup(options);
    expect(screen.getByLabelText("Result")).toHaveTextContent("false");
    expect(screen.getByLabelText("Action status")).toHaveTextContent("failed");
    expect(advance).not.toHaveBeenCalled();
  });

  it("does not extend requester access to allocation", async () => {
    const { advance } = await setup({
      action: "allocate",
      status: "received",
      capabilities: ["request_fulfillment"],
      createdBy: "requester-id",
    });
    expect(screen.getByLabelText("Result")).toHaveTextContent("false");
    expect(advance).not.toHaveBeenCalled();
  });
});
