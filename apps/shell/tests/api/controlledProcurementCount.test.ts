import { createClient } from "@supabase/supabase-js";
import type { Route } from "@playwright/test";
import { expect, it } from "vitest";
import { actor, type ActorKey, CONTROLLED_ANON_KEY, CONTROLLED_SUPABASE_URL, ControlledProcurementRpcFixture } from "../helpers/controlled-procurement-rpc";

function controlledClient(fixture = new ControlledProcurementRpcFixture(), actorKey: ActorKey = "procurement") {
  return createClient(CONTROLLED_SUPABASE_URL, CONTROLLED_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer controlled-${actor(actorKey).id}` },
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const body = request.method === "GET" ? null : await request.text();
        let result: Parameters<Route["fulfill"]>[0];
        await fixture.handle({
          request: () => ({
            url: () => request.url, method: () => request.method,
            headers: () => Object.fromEntries(request.headers), postData: () => body,
          }),
          fulfill: async (value: Parameters<Route["fulfill"]>[0]) => { result = value; },
          continue: () => { throw new Error("Fixture escaped the isolated fetch"); },
        } as unknown as Route);
        if (!result || typeof result.body !== "string") throw new Error("Expected a JSON fixture response");
        return new Response(result.body, {
          status: result.status ?? 200,
          headers: { "content-type": result.contentType ?? "application/json", ...result.headers },
        });
      },
    },
  });
}

it("returns the exact count required by the bounded request projection through the real SDK", async () => {
  const fixture = new ControlledProcurementRpcFixture();
  const result = await controlledClient(fixture).schema("procurement").from("requests")
    .select("*", { count: "exact" }).eq("id", fixture.requestId).limit(2);
  expect(result.error).toBeNull();
  expect(result.count).toBe(1);
  expect(result.data).toHaveLength(1);
  expect(result.data?.[0].id).toBe(fixture.requestId);
});

it("reports an exact zero for empty filtered requests and approval steps", async () => {
  const client = controlledClient();
  for (const [table, column] of [["requests", "id"], ["approval_steps", "request_id"]]) {
    const result = await client.schema("procurement").from(table!)
      .select("*", { count: "exact" }).eq(column!, "not-visible").limit(2);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
    expect(result.count).toBe(0);
  }
});

it("counts the complete filtered projection before applying the requested range", async () => {
  const client = controlledClient();
  const all = await client.schema("core").from("profiles").select("*", { count: "exact" });
  expect(all.data!.length).toBeGreaterThan(2);
  const page = await client.schema("core").from("profiles").select("*", { count: "exact" }).range(1, 2);
  expect(page.error).toBeNull();
  expect(page.count).toBe(all.data!.length);
  expect(page.data).toEqual(all.data!.slice(1, 3));
});

it("does not fabricate an exact count when the caller did not request one", async () => {
  const result = await controlledClient().schema("procurement").from("requests").select("*");
  expect(result.error).toBeNull();
  expect(result.data).toHaveLength(1);
  expect(result.count).toBeNull();
});

it("projects the current request-bound sourcing read contract for the Task 10 owner", async () => {
  const fixture = new ControlledProcurementRpcFixture();
  fixture.prepareTask10PurchaseOrder();
  const result = await controlledClient(fixture).schema("procurement").rpc("sourcing_workspace", {
    payload: { request_id: fixture.requestId },
  });
  expect(result.error).toBeNull();
  expect(result.data).toMatchObject({
    requestId: fixture.requestId,
    event: { id: "controlled-sourcing-10", status: "draft", communications: [], commercialTabulations: [],
      technicalEvaluations: [], awardRecommendation: null, varianceDecisionsVisible: true,
      varianceDecisions: [], varianceEligibility: { canReview: false } },
  });
});

it("omits restricted variance history for a dashboard-only sourcing reader", async () => {
  const fixture = new ControlledProcurementRpcFixture();
  fixture.prepareTask10PurchaseOrder();
  const result = await controlledClient(fixture, "operations").schema("procurement").rpc("sourcing_workspace", {
    payload: { request_id: fixture.requestId },
  });
  expect(result.error).toBeNull();
  expect(result.data.event).toMatchObject({ varianceDecisionsVisible: false, varianceEligibility: { canReview: false } });
  expect(result.data.event).not.toHaveProperty("varianceDecisions");
});

it("keeps sourcing actor and exact-request denials when projecting the richer response", async () => {
  const fixture = new ControlledProcurementRpcFixture();
  fixture.prepareTask10PurchaseOrder();
  for (const [actorKey, requestId] of [["finance", fixture.requestId], ["procurement", "foreign-request"]] as const) {
    const result = await controlledClient(fixture, actorKey).schema("procurement").rpc("sourcing_workspace", {
      payload: { request_id: requestId },
    });
    expect(result.status).toBe(403);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("No procurement sourcing access is assigned to this account.");
  }
  expect(fixture.task10).toMatchObject({ vendorCurrent: false, acceptance: false, closed: false });
});

it("keeps payment document options PO-bound and hidden from the requester", async () => {
  const fixture = new ControlledProcurementRpcFixture();
  fixture.prepareTask10PurchaseOrder();
  fixture.task10!.acceptance = true;
  const result = await controlledClient(fixture).schema("procurement").rpc("payment_evidence_options", {
    payload: { purchase_order_id: "controlled-po-task-10" },
  });
  expect(result.error).toBeNull();
  expect(result.data).toEqual({ foreignVendor: false, packDocuments: [], documents: [
    { id: "controlled-invoice-10", filename: "invoice-10.pdf", purpose: "invoice" },
    { id: "controlled-acceptance-document-10", filename: "acceptance-10.pdf", purpose: "acceptance" },
    { id: "controlled-tax-10", filename: "tax-10.pdf", purpose: "tax" },
  ] });
  for (const [actorKey, purchaseOrderId, status] of [["operations", "controlled-po-task-10", 403], ["procurement", "foreign-po", 404]] as const) {
    const denied = await controlledClient(fixture, actorKey).schema("procurement").rpc("payment_evidence_options", {
      payload: { purchase_order_id: purchaseOrderId },
    });
    expect(denied.status).toBe(status);
    expect(denied.data).toBeNull();
  }
});

it("rejects free-text evidence paths and swapped document purposes without preparing payment", async () => {
  const fixture = new ControlledProcurementRpcFixture();
  fixture.prepareTask10PurchaseOrder();
  fixture.task10!.acceptance = true;
  fixture.task10!.vendorCurrent = true;
  for (const invoice of ["private/invoice-10.pdf", "controlled-tax-10"]) {
    const result = await controlledClient(fixture).schema("procurement").rpc("prepare_invoice_payment_readiness", {
      payload: { purchase_order_id: "controlled-po-task-10", invoice_or_si_storage_path: invoice,
        milestone_support_storage_path: "controlled-acceptance-document-10", tax_withholding_support_storage_path: "controlled-tax-10" },
    });
    expect(result.status).toBe(400);
    expect(fixture.task10!.prepared).toBe(false);
  }
});

it("retains receipt evidence after governed PO closure", async () => {
  const fixture = new ControlledProcurementRpcFixture();
  fixture.prepareTask10PurchaseOrder();
  fixture.purchaseOrder!.status = "issued";
  const client = controlledClient(fixture).schema("procurement");
  const issued = await client.rpc("purchase_order_receipt_status", { payload: { purchase_order_id: "controlled-po-task-10" } });
  fixture.purchaseOrder!.status = "closed";
  const closed = await client.rpc("purchase_order_receipt_status", { payload: { purchase_order_id: "controlled-po-task-10" } });
  expect(closed.error).toBeNull();
  expect(closed.data).toEqual(issued.data);
  expect(closed.data[0]).toMatchObject({ accepted_quantity: 1, outstanding_quantity: 0, latest_qc_status: "accepted" });
});

it("isolates variance personas without changing the full payment and closure actors", () => {
  expect(actor("finance").roles.procurement).toEqual(["finance"]);
  expect(actor("finance").capabilities.procurement).toEqual(["view_finance", "accept_payment_readiness", "release_payment"]);
  expect(actor("deptHead").roles.procurement).toEqual(["approver"]);
  expect(actor("deptHead").capabilities.procurement).toEqual(["final_approve_po"]);
  expect(actor("varianceFinance").roles).not.toHaveProperty("procurement");
  expect(actor("varianceFinance").capabilities.procurement).toEqual(["view_finance"]);
  expect(actor("varianceDeptHead").roles).not.toHaveProperty("procurement");
  expect(actor("varianceDeptHead").capabilities).not.toHaveProperty("procurement");
});

it("applies request-read RLS before exact count while retaining explicit Finance access", async () => {
  const fixture = new ControlledProcurementRpcFixture();
  for (const actorKey of ["unrelated", "financeNoCapability", "varianceDeptHead", "operations", "deptHead"] as const) {
    const denied = await controlledClient(fixture, actorKey).schema("procurement").from("requests")
      .select("*", { count: "exact" }).eq("id", fixture.requestId).limit(2);
    expect(denied.error).toBeNull();
    expect(denied.count).toBe(0);
    expect(denied.data).toEqual([]);
  }
  for (const actorKey of ["procurement", "finance", "varianceFinance"] as const) {
    const allowed = await controlledClient(fixture, actorKey).schema("procurement").from("requests")
      .select("*", { count: "exact" }).eq("id", fixture.requestId).limit(2);
    expect(allowed.error).toBeNull();
    expect(allowed.count).toBe(1);
    expect(allowed.data?.[0].id).toBe(fixture.requestId);
  }
  fixture.prepareTask10PurchaseOrder();
  for (const actorKey of ["operations", "deptHead"] as const) {
    const shared = await controlledClient(fixture, actorKey).schema("procurement").from("requests")
      .select("*", { count: "exact" }).eq("id", fixture.requestId).limit(2);
    expect(shared.count).toBe(1);
  }
});

it("shares only the exception fixture request with its independent reviewers", async () => {
  const fixture = new ControlledProcurementRpcFixture();
  fixture.prepareExceptionWorkspace();
  for (const [actorKey, count] of [["exceptionReviewer", 1], ["exceptionDoa", 1], ["exceptionFinance", 1],
    ["unrelated", 0], ["operations", 0], ["deptHead", 0]] as const) {
    const result = await controlledClient(fixture, actorKey).schema("procurement").from("requests")
      .select("*", { count: "exact" }).eq("id", fixture.requestId).limit(2);
    expect(result.error).toBeNull();
    expect(result.count).toBe(count);
    expect(result.data).toHaveLength(count);
  }
});
