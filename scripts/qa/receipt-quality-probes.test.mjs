import assert from "node:assert/strict";
import test from "node:test";
import { certifyPoLineIdentity } from "./receipt-quality-probes.mjs";

const payload = { source_id: "receipt", product_id: "product", procurement_po_line_id: "line",
  quantity: 1, disposition: "accepted", idempotency_key: "qc" };
const state = () => ({ receipt: { id: "receipt", procurement_po_id: "po", received_by: "receiver" },
  inspections: [{ id: "inspection", source_type: "receipt", source_id: "receipt", product_id: "product",
    procurement_po_line_id: "line", quantity: 1, disposition: "pending", reason: "Awaiting independent quality inspection" }],
  holds: [{ id: "hold", inspection_id: "inspection", status: "active", reason: "Awaiting independent quality inspection" }] });
const failed = message => ({ ok: false, status: 400, body: JSON.stringify({ code: "P0001", message }) });

test("a generic denial never certifies line identity even with valid pending custody", async () => {
  await assert.rejects(certifyPoLineIdentity({ payload, wrongLine: "foreign", readState: async () => state(),
    call: async () => failed("Not authorized") }), /Not authorized/);
});

test("missing or resolved custody fails before issuing a negative RPC", async () => {
  for (const invalidate of [s => { s.holds = []; }, s => { s.inspections[0].disposition = "accepted"; }]) {
    const before = state(); invalidate(before);
    let calls = 0;
    await assert.rejects(certifyPoLineIdentity({ payload, wrongLine: "foreign", readState: async () => before,
      call: async () => { calls++; } }));
    assert.equal(calls, 0);
  }
});

test("a matching error with mutated custody cannot pass", async () => {
  const before = state();
  await assert.rejects(certifyPoLineIdentity({ payload, wrongLine: "foreign", readState: async () => structuredClone(before),
    call: async () => { before.holds[0].status = "released";
      return failed("Procurement PO-line identity is required for receipt quality disposition"); } }), /changed custody/);
});

test("only line identity and idempotency key change; a failing positive control fails certification", async () => {
  const calls = [];
  await assert.rejects(certifyPoLineIdentity({ payload, wrongLine: "foreign", readState: async () => state(),
    call: async value => {
      calls.push(value);
      return failed(calls.length === 1 ? "Procurement PO-line identity is required for receipt quality disposition"
        : "Actionable provisional receipt inspection not found");
    } }), /Correct-line positive control failed/);
  assert.equal(calls.length, 3);
  for (const value of calls) {
    const { procurement_po_line_id, idempotency_key, ...rest } = value;
    const { procurement_po_line_id: line, idempotency_key: key, ...expected } = payload;
    assert.deepEqual(rest, expected);
  }
  assert.deepEqual(calls.map(value => value.procurement_po_line_id), [null, "foreign", "line"]);
});
