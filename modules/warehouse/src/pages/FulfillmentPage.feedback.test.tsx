import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { buildSeed, type FulfillmentOrder } from "@intra/data-kit";
import { FulfillmentPage } from "./FulfillmentPage";
import { makeRepo, renderWithProviders } from "@/test/renderWithProviders";
import { uploadEvidence } from "@/data/supabase/evidence";

vi.mock("@/data/supabase/evidence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/supabase/evidence")>()),
  uploadEvidence: vi.fn(),
}));

function order(overrides: Partial<FulfillmentOrder> = {}): FulfillmentOrder {
  return {
    id: "order-feedback",
    source: "ecommerce",
    externalReference: "SEPT9-ORDER",
    status: "received",
    deliveryMethod: "shipment",
    createdBy: "requester",
    createdAt: "2026-09-09T01:00:00Z",
    updatedAt: "2026-09-09T01:00:00Z",
    lines: [
      {
        productId: "doctor-token",
        quantity: 1,
        pickedQuantity: 1,
        pickedSerialNumbers: [],
      },
    ],
    packaging: [],
    shipmentEvents: [],
    ...overrides,
  };
}

async function details(record: FulfillmentOrder) {
  const data = buildSeed();
  data.fulfillmentOrders = [record];
  renderWithProviders(<FulfillmentPage />, {
    repo: makeRepo(data),
    route: "/fulfillment?tab=orders",
  });
  if (record.status === "completed") {
    fireEvent.change(await screen.findByLabelText("Status"), {
      target: { value: "all" },
    });
  }
  fireEvent.click(
    await screen.findByRole("button", { name: "View order details" }),
  );
  return screen.findByRole("dialog", {
    name: `Order details / ${record.externalReference}`,
  });
}

describe("September 9 fulfillment evidence and linkage", () => {
  it('distinguishes an internal handover from a customer shipment and shows stored order context', async () => {
    const record = order({ id: 'internal', source: 'department_request', deliveryMethod: 'internal_handover',
      requestingDepartment: 'marketing', orderNotes: 'Collect at the warehouse desk',
      handoverRecipientName: 'Test Recipient', handoverReference: 'HANDOVER-11',
      pickedAt: '2026-09-09T02:00:00Z', lines: [{ productId: 'doctor-token', quantity: 1, pickedQuantity: 1, pickedSerialNumbers: ['SERIAL-11'] }] });
    const data = buildSeed();
    data.fulfillmentOrders = [record];
    data.departmentStockRequests = [{ id: 'request-11', requestingDepartment: 'marketing', purpose: 'Client welcome pack', costCenter: 'MKT-11',
      requiredDate: '2026-09-12', expenseTreatment: 'expense', status: 'approved', requestedBy: 'requester', requestedByName: 'Test Requester',
      requestedAt: '2026-09-08T01:00:00Z', fulfillmentOrderId: record.id, lines: record.lines }];
    renderWithProviders(<FulfillmentPage />, { repo: makeRepo(data), route: '/fulfillment?tab=orders' });
    fireEvent.click(await screen.findByRole('button', { name: 'View order details' }));
    const dialog = await screen.findByRole('dialog', { name: `Order details / ${record.externalReference}` });
    expect(within(dialog).getByText('Request recorded')).toBeVisible();
    expect(within(dialog).getByText('Not applicable to internal requests')).toBeVisible();
    expect(within(dialog).getByText('Test Requester')).toBeVisible();
    expect(within(dialog).getByText('Client welcome pack')).toBeVisible();
    expect(within(dialog).getByText('MKT-11')).toBeVisible();
    expect(within(dialog).getByText('Collect at the warehouse desk')).toBeVisible();
    expect(within(dialog).queryByText('Shipment timeline')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/HANDOVER-11/)).toBeVisible();
    fireEvent.click(within(dialog).getByText(/Picked serials/));
    expect(within(dialog).getByText('SERIAL-11')).toBeVisible();
  });
  it("opens persisted POD evidence even when shipment history is empty", async () => {
    const dialog = await details(
      order({
        proofOfDeliveryReference: "POD-SEP9",
        proofOfDeliveryEvidenceUrl: "data:image/png;base64,eA==",
      }),
    );
    const pod = within(dialog).getByRole("region", {
      name: "Proof of delivery",
    });
    expect(within(pod).getByText("POD-SEP9")).toBeVisible();
    expect(
      await within(pod).findByRole("img", { name: "Evidence" }),
    ).toHaveAttribute("src", "data:image/png;base64,eA==");
    fireEvent.click(
      within(pod).getByRole("button", { name: "View evidence photo" }),
    );
    const preview = await screen.findByRole("dialog", {
      name: "Evidence photo",
    });
    expect(
      within(preview).getByRole("img", { name: "Evidence" }),
    ).toHaveAttribute("src", "data:image/png;base64,eA==");
    fireEvent.click(within(preview).getByRole("button", { name: "Close" }));
    expect(dialog).toBeVisible();
  });

  it('retains an external POD link without treating it as an uploaded photo', async () => {
    const dialog = await details(order({ proofOfDeliveryReference: 'EXTERNAL-POD', proofOfDeliveryEvidenceUrl: 'https://evidence.example/pod.jpg' }));
    const pod = within(dialog).getByRole('region', { name: 'Proof of delivery' });
    expect(within(pod).getByText('EXTERNAL-POD')).toBeVisible();
    expect(within(pod).getByRole('link', { name: /open external evidence/i })).toHaveAttribute('href', 'https://evidence.example/pod.jpg');
    expect(within(pod).queryByRole('img')).not.toBeInTheDocument();
  });

  it.each([
    "javascript:alert(1)",
    "http://evidence.example/pod.jpg",
    "data:text/html;base64,eA==",
    "delivery/private.jpg",
  ])("does not expose unsafe or inaccessible POD evidence: %s", async (url) => {
    const dialog = await details(order({ proofOfDeliveryEvidenceUrl: url }));
    const pod = within(dialog).getByRole("region", {
      name: "Proof of delivery",
    });
    expect(await within(pod).findByRole("alert")).toHaveTextContent(
      "Evidence unavailable",
    );
    expect(within(pod).queryByRole("img")).not.toBeInTheDocument();
    expect(within(pod).queryByRole("link")).not.toBeInTheDocument();
  });

  it("opens legacy timeline evidence through the current gallery", async () => {
    const dialog = await details(
      order({
        shipmentEvents: [
          {
            status: "delivered",
            actor: "courier",
            occurredAt: "2026-09-09T04:00:00Z",
            evidenceUrl: "data:image/png;base64,eA==",
          },
        ],
      }),
    );
    const timeline = within(dialog).getByRole("region", {
      name: "Shipment timeline",
    });
    expect(await within(timeline).findByRole("img")).toHaveAttribute(
      "src",
      "data:image/png;base64,eA==",
    );
    fireEvent.click(
      within(timeline).getByRole("button", { name: "View evidence photo" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Evidence photo" }),
    ).toBeVisible();
  });

  it("follows the return-case relationship to the original order without inventing replacement delivery metadata", async () => {
    const data = buildSeed();
    data.fulfillmentOrders = [
      order({ externalReference: "REPL-SEPT9" }),
      order({
        id: "original",
        externalReference: "ORIGINAL-SEPT9",
        status: "completed",
        deliveryAddress: {
          addressLine: "12 Original Street",
          city: "Makati",
          province: "Metro Manila",
          postalCode: "1200",
        },
      }),
    ];
    data.customerReturnCases = [
      {
        id: "case-sept9",
        sourceOrderId: "original",
        replacementOrderId: "order-feedback",
        productId: "doctor-token",
        defectDescription: "Damaged on arrival",
        requestingDepartment: "customer_service",
        status: "resolved",
        resolution: "replacement",
        createdBy: "customer-service",
        createdAt: "2026-09-09T01:00:00Z",
      },
    ];
    renderWithProviders(<FulfillmentPage />, {
      repo: makeRepo(data),
      route: "/fulfillment?tab=orders",
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "View order details" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Order details / REPL-SEPT9",
    });
    const linkage = within(dialog).getByRole("region", {
      name: "Replacement linkage",
    });
    expect(within(linkage).getByText("case-sept9")).toBeVisible();
    expect(within(linkage).getByText("Damaged on arrival")).toBeVisible();
    expect(
      within(dialog).getByText(/replacement delivery address is not recorded/i),
    ).toBeVisible();
    expect(
      within(dialog).queryByText(/12 Original Street/),
    ).not.toBeInTheDocument();
    fireEvent.click(
      within(linkage).getByRole("button", {
        name: "View original order ORIGINAL-SEPT9",
      }),
    );
    const original = await screen.findByRole("dialog", {
      name: "Order details / ORIGINAL-SEPT9",
    });
    expect(
      within(original).getByRole("region", { name: "Operational summary" }),
    ).toHaveTextContent("12 Original Street");
  });

  it("does not infer replacement linkage from a REPL prefix or a backorder parent", async () => {
    const dialog = await details(
      order({
        externalReference: "REPL-UNRELATED",
        parentOrderId: "backorder-parent",
      }),
    );
    expect(
      within(dialog).queryByRole("region", { name: "Replacement linkage" }),
    ).not.toBeInTheDocument();
  });
});

async function receiptSetup({
  releasedBy = "different-operator",
  role = "warehouse_operator",
  capabilities = ["issue_items"],
  deliveryMethod = "internal_handover",
  workspace = 'orders',
  requestedBy = 'marketing@mwell',
  orderStatus = 'released',
}: {
  releasedBy?: string;
  deliveryMethod?: FulfillmentOrder["deliveryMethod"];
  role?: "warehouse_operator" | "marketing";
  workspace?: 'orders' | 'requests';
  requestedBy?: string;
  orderStatus?: FulfillmentOrder['status'];
  capabilities?: (
    "issue_items" | "request_stock" | "request_fulfillment" | "reserve_allocate"
  )[];
} = {}) {
  const data = buildSeed();
  data.fulfillmentOrders = [
    order({
      source: "department_request",
      status: orderStatus,
      deliveryMethod,
      releasedBy,
      handoverRecipientName: "Maya Santos",
      handoverRecipientDepartment: "Marketing",
    }),
  ];
  if (workspace === 'requests') data.departmentStockRequests = [{
    id: 'marketing-request', fulfillmentOrderId: 'order-feedback', requestedBy,
    requestingDepartment: 'marketing', requestedAt: '2026-09-09T00:00:00Z',
    purpose: 'Giveaway for Ms A.', costCenter: 'CC-4100', requiredDate: '2026-09-10',
    expenseTreatment: 'expense', status: 'issued', lines: [{ productId: 'doctor-token', quantity: 1 }],
  }];
  const repo = makeRepo(data);
  const advance = vi.spyOn(repo, "advanceFulfillmentOrder");
  renderWithProviders(<FulfillmentPage />, {
    repo,
    role,
    capabilities,
    source: "supabase",
    route: `/fulfillment?tab=${workspace}`,
  });
  if (workspace === 'orders') fireEvent.click(
    await screen.findByRole("button", { name: "Released follow-up: 1" }),
  );
  return { repo, advance };
}

async function openReceipt() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Acknowledge receipt" }),
  );
  return screen.findByRole("dialog", {
    name: "Acknowledge receipt / SEPT9-ORDER",
  });
}

function upload(dialog: HTMLElement) {
  fireEvent.change(
    within(dialog).getByLabelText("Upload recipient acknowledgment evidence"),
    {
      target: {
        files: [new File(["photo"], "receipt.jpg", { type: "image/jpeg" })],
      },
    },
  );
}

describe("September 9 recipient acknowledgment", () => {
  beforeEach(() => vi.mocked(uploadEvidence).mockReset());

  it('lets the Marketing requester acknowledge directly from Department requests with the existing evidence contract', async () => {
    const { repo, advance } = await receiptSetup({ workspace: 'requests', role: 'marketing', capabilities: ['request_stock'] });
    const dialog = await openReceipt();
    expect(within(dialog).getByRole('button', { name: 'Confirm receipt' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Acknowledgment reference'), { target: { value: 'MKT-ACK-11' } });
    expect(within(dialog).getByRole('button', { name: 'Confirm receipt' })).toBeDisabled();
    vi.mocked(uploadEvidence).mockResolvedValueOnce('acceptance/marketing.jpg');
    upload(dialog);
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Confirm receipt' })).toBeEnabled());
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(advance).toHaveBeenCalledOnce();
    expect((await repo.getData()).fulfillmentOrders[0]).toMatchObject({ status: 'completed', acknowledgementReference: 'MKT-ACK-11' });
    expect(await screen.findByText(/Receipt acknowledged/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Acknowledge receipt' })).not.toBeInTheDocument();
  });

  it('offers the same receipt form inside View request and cancelling does not save', async () => {
    const { advance } = await receiptSetup({ workspace: 'requests', role: 'marketing', capabilities: ['request_stock'] });
    fireEvent.click(await screen.findByRole('button', { name: 'View request' }));
    const review = await screen.findByRole('dialog', { name: 'Review request' });
    fireEvent.click(within(review).getByRole('button', { name: 'Acknowledge receipt' }));
    const receipt = await screen.findByRole('dialog', { name: 'Acknowledge receipt / SEPT9-ORDER' });
    expect(review).not.toBeInTheDocument();
    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(1);
    fireEvent.click(within(receipt).getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('dialog', { name: 'Review request' })).toBeVisible();
    expect(advance).not.toHaveBeenCalled();
  });

  it.each([
    { releasedBy: 'marketing@mwell' }, { requestedBy: 'other-requester' },
    { orderStatus: 'ready' as const }, { deliveryMethod: 'shipment' as const },
  ])('does not grant requester acknowledgment when blocked: %j', async overrides => {
    const { advance } = await receiptSetup({ workspace: 'requests', role: 'marketing', capabilities: ['request_stock'], ...overrides });
    await screen.findByRole('button', { name: 'View request' });
    expect(screen.queryByRole('button', { name: 'Acknowledge receipt' })).not.toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });

  it("does not expose receipt acknowledgment for a released shipment", async () => {
    const { advance } = await receiptSetup({ deliveryMethod: "shipment" });
    expect(screen.queryByRole("button", { name: "Acknowledge receipt" })).not.toBeInTheDocument();
    expect(advance).not.toHaveBeenCalled();
  });

  it.each(["warehouse_operator@mwell", "demo-warehouse_operator"])(
    "hides acknowledgment from the releasing identity %s",
    async (releasedBy) => {
      const { advance } = await receiptSetup({ releasedBy });
      expect(
        screen.queryByRole("button", { name: "Acknowledge receipt" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(/releasing operator cannot acknowledge receipt/i),
      ).toBeVisible();
      expect(advance).not.toHaveBeenCalled();
    },
  );

  it.each([["request_stock"], ["reserve_allocate"]] as const)(
    "hides acknowledgment for a nonowner with only %s",
    async (capability) => {
      const { advance } = await receiptSetup({
        role: "marketing",
        capabilities: [capability],
      });
      expect(
        screen.queryByRole("button", { name: "Acknowledge receipt" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(
          /receipt acknowledgment is unavailable for this account/i,
        ),
      ).toBeVisible();
      expect(advance).not.toHaveBeenCalled();
    },
  );

  it("allows a request_fulfillment-only account to submit recipient acceptance", async () => {
    const { repo, advance } = await receiptSetup({
      role: "marketing",
      capabilities: ["request_fulfillment"],
    });
    const dialog = await openReceipt();
    expect(
      within(dialog).getByText(/recipient acceptance, not warehouse release/i),
    ).toBeVisible();
    fireEvent.change(
      within(dialog).getByLabelText("Acknowledgment reference"),
      { target: { value: "REQUESTER-ACK" } },
    );
    vi.mocked(uploadEvidence).mockResolvedValueOnce("acceptance/requester.jpg");
    upload(dialog);
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Confirm receipt" }),
      ).toBeEnabled(),
    );
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(advance).toHaveBeenCalledOnce();
    expect((await repo.getData()).fulfillmentOrders[0]).toMatchObject({
      status: "completed",
      acknowledgementReference: "REQUESTER-ACK",
      acknowledgementEvidenceUrl: "acceptance/requester.jpg",
    });
  });

  it("records recipient evidence, waits for upload, and prevents duplicate submission", async () => {
    const { repo, advance } = await receiptSetup();
    const dialog = await openReceipt();
    expect(
      within(dialog).getByText(/recipient acceptance, not warehouse release/i),
    ).toBeVisible();
    expect(within(dialog).getByText(/Maya Santos/)).toBeVisible();
    let resolve!: (url: string) => void;
    vi.mocked(uploadEvidence).mockReturnValueOnce(
      new Promise((res) => {
        resolve = res;
      }),
    );
    fireEvent.change(
      within(dialog).getByLabelText("Acknowledgment reference"),
      { target: { value: "  ACK-SEPT9  " } },
    );
    upload(dialog);
    await waitFor(() => expect(uploadEvidence).toHaveBeenCalledOnce());
    expect(
      within(dialog).getByRole("button", { name: "Uploading evidence..." }),
    ).toBeDisabled();
    fireEvent.submit(dialog.querySelector("form")!);
    expect(advance).not.toHaveBeenCalled();
    await act(async () => resolve("acknowledgment/sept9.jpg"));
    act(() => {
      fireEvent.submit(dialog.querySelector("form")!);
      fireEvent.submit(dialog.querySelector("form")!);
    });
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(advance).toHaveBeenCalledOnce();
    expect((await repo.getData()).fulfillmentOrders[0]).toMatchObject({
      status: "completed",
      acknowledgementReference: "ACK-SEPT9",
      acknowledgementEvidenceUrl: "acknowledgment/sept9.jpg",
    });
  });

  it("requires a nonblank reference and successful evidence upload even for direct form submission", async () => {
    const { advance } = await receiptSetup();
    const dialog = await openReceipt();
    fireEvent.change(
      within(dialog).getByLabelText("Acknowledgment reference"),
      { target: { value: "   " } },
    );
    fireEvent.submit(dialog.querySelector("form")!);
    expect(advance).not.toHaveBeenCalled();
    fireEvent.change(
      within(dialog).getByLabelText("Acknowledgment reference"),
      { target: { value: "ACK" } },
    );
    vi.mocked(uploadEvidence).mockRejectedValueOnce(
      new Error("Connection lost"),
    );
    upload(dialog);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "We cannot confirm whether this action finished.",
    );
    expect(
      within(dialog).getByRole("button", { name: "Confirm receipt" }),
    ).toBeDisabled();
    fireEvent.submit(dialog.querySelector("form")!);
    expect(advance).not.toHaveBeenCalled();
    vi.mocked(uploadEvidence).mockResolvedValueOnce("acknowledgment/retry.jpg");
    upload(dialog);
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Confirm receipt" }),
      ).toBeEnabled(),
    );
  });

  it("retains capture with recovery guidance after a denied submission", async () => {
    const { advance } = await receiptSetup();
    advance.mockRejectedValueOnce(
      new Error("Not authorized to acknowledge this release"),
    );
    const dialog = await openReceipt();
    fireEvent.change(
      within(dialog).getByLabelText("Acknowledgment reference"),
      { target: { value: "ACK" } },
    );
    vi.mocked(uploadEvidence).mockResolvedValueOnce(
      "acknowledgment/retained.jpg",
    );
    upload(dialog);
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Confirm receipt" }),
      ).toBeEnabled(),
    );
    fireEvent.submit(dialog.querySelector("form")!);
    const rejection = await within(dialog).findByText(/receipt was not confirmed/i);
    expect(rejection).toHaveAttribute("role", "alert");
    expect(rejection).toHaveTextContent(/your evidence is retained/i);
    expect(within(dialog).getByText("Evidence unavailable")).toBeVisible();
    expect(advance).toHaveBeenCalledTimes(1);
    expect(advance).toHaveBeenCalledWith(expect.objectContaining({
      action: "acknowledge_receipt",
      acknowledgementReference: "ACK",
      acknowledgementEvidenceUrl: "acknowledgment/retained.jpg",
    }));
    expect(
      within(dialog).getByLabelText("Acknowledgment reference"),
    ).toHaveValue("ACK");
    expect(
      within(dialog).getByRole("list", { name: "Captured evidence" }),
    ).toBeVisible();
  });

  it("clears a dismissed draft before reopening acknowledgment", async () => {
    await receiptSetup();
    const dialog = await openReceipt();
    fireEvent.change(
      within(dialog).getByLabelText("Acknowledgment reference"),
      { target: { value: "OLD" } },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    const reopened = await openReceipt();
    expect(
      within(reopened).getByLabelText("Acknowledgment reference"),
    ).toHaveValue("");
    expect(
      within(reopened).queryByRole("list", { name: "Captured evidence" }),
    ).not.toBeInTheDocument();
  });
});

async function replacementSetup(hasOriginal = true, persist = false) {
  const data = buildSeed();
  data.fulfillmentOrders = hasOriginal
    ? [
        order({
          id: "original",
          lines: [
            {
              productId: "smart-watch",
              quantity: 1,
              pickedQuantity: 1,
              pickedSerialNumbers: [],
            },
          ],
          customerName: "Maya Santos",
          customerContact: "09171234567",
          deliveryAddress: {
            addressLine: "12 Original Street",
            city: "Makati",
            province: "Metro Manila",
            postalCode: "1200",
          },
        }),
      ]
    : [];
  data.customerReturnCases = [
    {
      id: "replacement-case",
      sourceOrderId: "original",
      productId: "smart-watch",
      defectDescription: "Damaged on arrival",
      requestingDepartment: "customer_service",
      status: "decision_required",
      resolution: "pending",
      createdBy: "customer-service",
      createdAt: "2026-09-09T01:00:00Z",
    },
  ];
  const repo = makeRepo(data);
  const resolve = vi.spyOn(repo, "resolveCustomerReturnCase");
  if (!persist)
    resolve.mockResolvedValue({
      ...data.customerReturnCases[0]!,
      status: "resolved",
      resolution: "replacement",
    });
  renderWithProviders(<FulfillmentPage />, {
    repo,
    role: "warehouse_supervisor",
    route: "/fulfillment?tab=returns",
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Record resolution" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Resolve return case",
  });
  fireEvent.change(within(dialog).getByLabelText("Quarantine bin"), {
    target: { value: data.storageAreas.find((area) => area.active)?.id },
  });
  return { dialog, resolve, repo };
}

function newReplacementDestination(dialog: HTMLElement) {
  const values = {
    "Replacement recipient name": "  New Recipient  ",
    "Replacement contact number": "  09179876543  ",
    "Replacement email (optional)": "  recipient@example.com  ",
    "Replacement address line": "  99 New Street  ",
    "Replacement city": "  Pasig  ",
    "Replacement province": "  Metro Manila  ",
    "Replacement postal code": "  1600  ",
    "Reason for new delivery details":
      "  Customer requested a new destination  ",
  };
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(within(dialog).getByLabelText(label), {
      target: { value },
    });
  }
}

describe("Replacement delivery contract selection", () => {
  it('shows the original order in the return list and resolution without changing the record', async () => {
    const { dialog, resolve } = await replacementSetup(true);
    expect(within(dialog).getByRole('region', { name: 'Return case context' })).toHaveTextContent('SEPT9-ORDER');
    expect(within(dialog).getByRole('region', { name: 'Return case context' })).toHaveTextContent('Damaged on arrival');
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('list', { name: 'Customer return cases' })).toHaveTextContent('Original order: SEPT9-ORDER');
  });
  it.each(["original", "new"] as const)(
    "persists the %s destination through the real page and memory repository",
    async (mode) => {
      const { dialog, repo } = await replacementSetup(true, true);
      if (mode === "new") {
        fireEvent.click(
          within(dialog).getByRole("radio", { name: "New delivery details" }),
        );
        newReplacementDestination(dialog);
      }
      fireEvent.submit(dialog.querySelector("form")!);
      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      const saved = await repo.getData();
      const resolved = saved.customerReturnCases[0]!;
      expect(resolved.status).toBe("resolved");
      const replacement = saved.fulfillmentOrders.find(
        (candidate) => candidate.id === resolved.replacementOrderId,
      );
      expect(replacement).toMatchObject(
        mode === "original"
          ? {
              customerName: "Maya Santos",
              customerContact: "09171234567",
              deliveryAddress: {
                addressLine: "12 Original Street",
                city: "Makati",
                province: "Metro Manila",
                postalCode: "1200",
              },
            }
          : {
              customerName: "New Recipient",
              customerContact: "09179876543",
              customerEmail: "recipient@example.com",
              deliveryAddress: {
                addressLine: "99 New Street",
                city: "Pasig",
                province: "Metro Manila",
                postalCode: "1600",
              },
            },
      );
      expect(
        saved.fulfillmentOrders.find((candidate) => candidate.id === "original")
          ?.deliveryAddress?.addressLine,
      ).toBe("12 Original Street");
      fireEvent.click(screen.getByRole("tab", { name: "Orders and events" }));
      const replacementCard = screen
        .getByText(replacement!.externalReference)
        .closest("li")!;
      fireEvent.click(
        within(replacementCard).getByRole("button", {
          name: "View order details",
        }),
      );
      const details = await screen.findByRole("dialog", {
        name: `Order details / ${replacement!.externalReference}`,
      });
      expect(
        within(details).getByRole("region", { name: "Operational summary" }),
      ).toHaveTextContent(
        mode === "original" ? "12 Original Street" : "99 New Street",
      );
      expect(
        within(details).getByRole("region", { name: "Replacement linkage" }),
      ).toHaveTextContent("replacement-case");
      expect(
        within(details).queryByText(
          /replacement delivery address is not recorded/i,
        ),
      ).not.toBeInTheDocument();
    },
  );

  it("retains the exact new destination while a resolution save is uncertain", async () => {
    const { dialog, resolve } = await replacementSetup();
    fireEvent.click(
      within(dialog).getByRole("radio", { name: "New delivery details" }),
    );
    newReplacementDestination(dialog);
    let reject!: (error: Error) => void;
    resolve.mockImplementationOnce(
      () =>
        new Promise((_res, rej) => {
          reject = rej;
        }),
    );
    act(() => {
      fireEvent.submit(dialog.querySelector("form")!);
      fireEvent.submit(dialog.querySelector("form")!);
    });
    await waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(dialog).toBeVisible();
    const command = structuredClone(resolve.mock.calls[0]![0]);
    await act(async () => reject(new Error("Response lost")));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      /resolution was not confirmed/i,
    );
    expect(
      within(dialog).getByLabelText("Replacement address line"),
    ).toBeDisabled();
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(resolve.mock.calls[1]![0]).toEqual(command);
  });

  it("explicitly requests the original delivery details through return resolution", async () => {
    const { dialog, resolve } = await replacementSetup();
    expect(
      within(dialog).getByRole("radio", { name: "Original delivery details" }),
    ).toBeChecked();
    expect(within(dialog).getByText(/12 Original Street/)).toBeVisible();
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ replacementDelivery: { mode: "original" } }),
    );
  });

  it("submits complete trimmed new recipient/address details and a change reason", async () => {
    const { dialog, resolve } = await replacementSetup();
    fireEvent.click(
      within(dialog).getByRole("radio", { name: "New delivery details" }),
    );
    newReplacementDestination(dialog);
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        replacementDelivery: {
          mode: "new",
          customerName: "New Recipient",
          customerContactNumber: "09179876543",
          customerEmail: "recipient@example.com",
          deliveryAddress: {
            addressLine: "99 New Street",
            city: "Pasig",
            province: "Metro Manila",
            postalCode: "1600",
          },
          reason: "Customer requested a new destination",
        },
      }),
    );
  });

  it.each([
    "Replacement recipient name",
    "Replacement contact number",
    "Replacement address line",
    "Replacement city",
    "Replacement province",
    "Replacement postal code",
    "Reason for new delivery details",
  ])(
    "blocks incomplete new delivery details (%s) even on direct submission",
    async (label) => {
      const { dialog, resolve } = await replacementSetup();
      fireEvent.click(
        within(dialog).getByRole("radio", { name: "New delivery details" }),
      );
      newReplacementDestination(dialog);
      fireEvent.change(within(dialog).getByLabelText(label), {
        target: { value: "   " },
      });
      fireEvent.submit(dialog.querySelector("form")!);
      expect(resolve).not.toHaveBeenCalled();
      expect(
        within(dialog).getByRole("button", { name: "Save resolution" }),
      ).toBeDisabled();
    },
  );

  it("requires new delivery details when the original order is unavailable", async () => {
    const { dialog, resolve } = await replacementSetup(false);
    expect(
      within(dialog).getByRole("radio", { name: "Original delivery details" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("radio", { name: "New delivery details" }),
    ).toBeChecked();
    expect(
      within(dialog).getByText(
        /original delivery details are unavailable or incomplete/i,
      ),
    ).toBeVisible();
    fireEvent.submit(dialog.querySelector("form")!);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("does not send new delivery fields after switching back to the original address", async () => {
    const { dialog, resolve } = await replacementSetup();
    fireEvent.click(
      within(dialog).getByRole("radio", { name: "New delivery details" }),
    );
    newReplacementDestination(dialog);
    fireEvent.click(
      within(dialog).getByRole("radio", { name: "Original delivery details" }),
    );
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ replacementDelivery: { mode: "original" } }),
    );
  });

  it("omits delivery changes for non-replacement resolutions", async () => {
    const { dialog, resolve } = await replacementSetup();
    fireEvent.change(within(dialog).getByLabelText("Resolution"), {
      target: { value: "re_kit" },
    });
    expect(
      within(dialog).queryByRole("radio", {
        name: "Original delivery details",
      }),
    ).not.toBeInTheDocument();
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    expect(resolve.mock.calls[0]![0]).not.toHaveProperty(
      "replacementDelivery",
      expect.anything(),
    );
  });
});
