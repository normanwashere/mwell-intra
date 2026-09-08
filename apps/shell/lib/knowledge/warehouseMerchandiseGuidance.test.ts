import { describe, expect, it } from "vitest";
import { EXPLICIT_FEATURE_DETAILS } from "./featureDetails";
import { KNOWLEDGE_FLOWS } from "./workflows";

const control = (feature: string, name: string) => {
  const item = EXPLICIT_FEATURE_DETAILS[feature]!.controls.find(row => row.name === name);
  expect(item, `${feature}: ${name}`).toBeDefined();
  return item!;
};
const receiptFlow = KNOWLEDGE_FLOWS.find(flow => flow.id === "receive-to-putaway")!;

describe("Warehouse merchandise guidance", () => {
  it("explains bulk receiving and picking without waiving serialized identity", () => {
    const quantity = EXPLICIT_FEATURE_DETAILS["warehouse-receiving"]!.fields.find(row => row.name === "Quantity")!;
    expect(quantity.purpose).toContain("1000 nonserialized tumblers");
    expect(quantity.purpose).toContain("Repeated merchandise scans do not add another 1000");
    const pick = control("warehouse-fulfillment", "Confirm pick");
    expect(pick.behavior).toContain("picked quantity 10");
    expect(pick.behavior).toContain("one eligible serial per unit");
    expect(pick.validation).toContain("Jacket S, M and L are separate variants");
    expect(pick.validation).toContain("Split backorder");
    expect(pick.result).toContain("not separately persisted scan proof");
  });
  it("documents exact-bin rejection, safe recovery and legacy limits", () => {
    const release = control("warehouse-fulfillment", "Release order");
    expect(release.validation).toContain("held, missing, inactive or short");
    expect(release.validation).toContain("do not substitute stock from A");
    expect(release.validation).toContain("do not clear the bin");
    expect(release.validation).toContain("cannot be the recorded packer");
    expect(release.result).toContain("verify status and movements");
    expect(release.result).toContain("not an explicit General Area instruction");
  });
  it("requires Quality acceptance before general-area putaway", () => {
    const putaway = control("warehouse-storage", "Put away stock");
    expect(putaway.behavior).toContain("starts quantity at 1");
    expect(putaway.validation).toContain("eligible unbinned stock");
    const gate = receiptFlow.nodes.find(node => node.id === "receive-bin-ready")!;
    expect(gate.body).toContain("hold is released");
    expect(gate.body).toContain("Held or pending stock must not enter");
    const action = receiptFlow.nodes.find(node => node.id === "receive-putaway")!;
    expect(action.body).toContain("explicitly enter 1000");
    expect(action.body).not.toContain("move unavailable units");
  });
  it("makes Quality readiness explicit on both decision branches", () => {
    const branches = receiptFlow.edges.filter(edge => edge.from === "receive-bin-ready");
    expect(branches.find(edge => edge.to === "receive-putaway")).toMatchObject({
      label: "Accepted, unheld stock and valid bin", outcome: "success",
    });
    expect(branches).toContainEqual(expect.objectContaining({
      to: "receive-escalated", label: "Quality not accepted or hold active", outcome: "exception",
    }));
    expect(branches).toContainEqual(expect.objectContaining({
      to: "receive-escalated", label: "No valid bin or route", outcome: "exception",
    }));
    const recovery = receiptFlow.nodes.find(node => node.id === "receive-escalated")!;
    expect(recovery.body).toContain("Do not move stock");
    expect(recovery.body).toContain("authorized Quality owner");
    expect(recovery.body).toContain("storage administrator");
    expect(recovery.body).toContain("accepted and unheld");
  });
  it("labels sample POs synthetic and separates them from the 1000-unit example", () => {
    const trace = receiptFlow.nodes.find(node => node.id === "receive-traceability")!;
    expect(trace.body).toContain("Synthetic tester references only");
    expect(trace.body).toContain("PO0005 / Company D");
    expect(trace.body).toContain("PO0006 / Company E has Tumbler 300");
    expect(trace.body).toContain("run owner's approval");
  });
  it("requires issued POs and limits the receiving metadata gap to actual delivery date", () => {
    const receive = control("warehouse-purchase-orders", "Receive order");
    expect(receive.behavior).toContain("Receive approved procurement PO");
    expect(receive.validation).toContain("must be issued with remaining quantity");
    expect(receive.validation).toContain("approval alone is not sufficient");
    expect(receive.result).toContain("Actual delivery-date capture/readback remains an open metadata item");
    expect(receive.result).toContain("posting timestamp is not the actual physical delivery date");
    expect(receive.result).not.toMatch(/receiver.name|requested.by|handover recipient/i);
    expect(receive.result).toContain("does not claim every reported UI issue is resolved");
    expect(EXPLICIT_FEATURE_DETAILS["warehouse-purchase-orders"]!.fields.find(row => row.name === "Expected date")!.purpose).toContain("not the actual physical delivery date");
  });
});
