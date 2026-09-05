import assert from "node:assert/strict";

const awaiting = "Awaiting independent quality inspection";
const canonical = value => value?.trim().toUpperCase() || null;
function actionable(state, payload) {
  return state.inspections.filter(row => row.source_type === "receipt" &&
    row.source_id === payload.source_id && row.product_id === payload.product_id &&
    row.procurement_po_line_id === payload.procurement_po_line_id &&
    (row.bin_id || null) === (payload.bin_id || null) &&
    (row.lot_id || null) === (payload.lot_id || null) &&
    canonical(row.serial_number) === canonical(payload.serial_number) &&
    row.disposition === "pending" && row.reason === awaiting);
}
function denial(result, message) {
  assert.equal(result.ok, false, "Quality negative probe unexpectedly succeeded");
  assert.equal(result.status, 400);
  const error = JSON.parse(result.body);
  assert.equal(error.code, "P0001");
  assert.equal(error.message, message);
}

// A denial alone cannot distinguish a foreign line from stale/non-actionable custody.
export async function certifyPoLineIdentity({ payload, wrongLine, readState, call }) {
  const before = await readState();
  assert.ok(before.receipt.procurement_po_id);
  assert.ok(before.receipt.received_by);
  assert.equal(before.receipt.id, payload.source_id);
  assert.ok(wrongLine && wrongLine !== payload.procurement_po_line_id);
  const matches = actionable(before, payload);
  assert.equal(matches.length, 1, "PO-line probe requires exactly one actionable correct-line inspection");
  assert.equal(matches[0].quantity, payload.quantity);
  const holds = before.holds.filter(row => row.inspection_id === matches[0].id &&
    row.status === "active" && row.reason === awaiting);
  assert.equal(holds.length, 1, "PO-line probe requires linked provisional custody");
  assert.equal(actionable(before, { ...payload, procurement_po_line_id: wrongLine }).length, 0);
  for (const [line, message, suffix] of [
    [null, "Procurement PO-line identity is required for receipt quality disposition", "missing-line"],
    [wrongLine, "Actionable provisional receipt inspection not found", "foreign-line"],
  ]) {
    denial(await call({ ...payload, procurement_po_line_id: line,
      idempotency_key: `${payload.idempotency_key}-${suffix}` }), message);
    assert.deepEqual(await readState(), before, "Rejected PO-line probe changed custody");
  }
  const accepted = await call(payload);
  assert.equal(accepted.ok, true, `Correct-line positive control failed: ${accepted.ok ? "" : JSON.parse(accepted.body).message}`);
  const result = JSON.parse(accepted.body);
  assert.equal(result.inspection.id, matches[0].id);
  assert.equal(result.inspection.disposition, "accepted");
  assert.equal(result.hold.id, holds[0].id);
  assert.equal(result.hold.status, "released");
  return accepted;
}

export async function certifyControlledExceptionDenial({ payload, readState, call }) {
  const before = await readState();
  assert.ok(before.receipt.procurement_po_id);
  assert.equal(before.receipt.id, payload.source_id);
  assert.ok(before.exception && before.exception.status === "open", "Controlled exception must remain open");
  assert.equal(before.exception.source_type, "receipt");
  assert.equal(before.exception.source_id, payload.source_id);
  assert.equal(before.exception.exception_type, "po_receipt");
  assert.ok(before.inspections.some(row => row.source_id === payload.source_id &&
    row.product_id === payload.product_id && row.procurement_po_line_id === payload.procurement_po_line_id),
  "Controlled exception probe requires the correct receipt line");
  assert.equal(actionable(before, payload).length, 0, "Controlled custody must not enter routine QC");
  denial(await call(payload), "Actionable provisional receipt inspection not found");
  assert.deepEqual(await readState(), before, "Routine QC changed controlled exception custody");
}
