import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SessionValue, UserCapabilities } from "@intra/auth";
import { ToastProvider } from "@/components/ui";
import { ReplenishmentControlPanel, type ReplenishmentCandidate } from "./ReplenishmentControlPanel";

let session: SessionValue;
vi.mock("@intra/auth", () => ({ useSession: () => session }));

const candidates: ReplenishmentCandidate[] = [{
  productId: "new-product", productName: "New merchandise", recommendedQuantity: 5,
  onHand: 1, reorderPoint: 6, leadTimeDays: 7, stockoutRisk: "high", rationale: "Expected demand",
}];
const saved = [
  { id: "rec-1", product_id: "saved-product", status: "recommended" },
  { id: "rec-2", product_id: "accepted-product", status: "accepted" },
  { id: "rec-3", product_id: "linked-product", status: "handed_off", procurement_request_id: "request-1", purchase_order_id: "po-1" },
].map(row => ({ ...row, recommended_quantity: 5, on_hand: 1, reorder_point: 6, lead_time_days: 7, stockout_risk: "high", rationale: "Saved rationale" }));
const rpc = vi.fn();
const schema = vi.fn();
const list = vi.fn();
const ui = () => <ToastProvider><ReplenishmentControlPanel candidates={candidates} /></ToastProvider>;

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: {}, error: null });
  list.mockResolvedValue({ data: saved, error: null });
  schema.mockReturnValue({ from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ order: vi.fn().mockReturnValue({ limit: list }) }) }), rpc });
  session = {
    mode: "supabase", loading: false, profile: { id: "actor-1", email: "actor@example.invalid", kind: "employee" },
    userRoles: {}, userCapabilities: {}, roleCapabilities: {}, supabaseClient: { schema },
  } as unknown as SessionValue;
});

const controls = () => [screen.getByRole("button", { name: "Save +5" }), screen.getByRole("button", { name: "Accept" }),
  screen.getByRole("button", { name: "Hand off to Procurement" }), ...screen.getAllByRole("button", { name: "Dismiss" })] as const;

describe("Replenishment effective action authority", () => {
  it.each([
    {},
    { warehouse: ["view_procurement"], procurement: ["view"] },
    { warehouse: ["manage_replenishment"], procurement: ["recommend_replenishment"] },
  ] satisfies UserCapabilities[])("retains read-only rows and links but denies writes for %j", async userCapabilities => {
    session.userCapabilities = userCapabilities;
    session.roleCapabilities = { warehouse: ["recommend_replenishment"], procurement: ["manage_replenishment"] };
    session.userRoles = { warehouse: ["operations"], procurement: ["procurement_admin"] };
    render(ui());
    await screen.findByText("saved-product");
    expect(screen.getByText("New merchandise")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Procurement request" })).toHaveAttribute("href", "/procurement/requests/request-1");
    expect(screen.getByRole("link", { name: "Open purchase order" })).toHaveAttribute("href", "/procurement/purchase-orders/po-1");
    for (const button of controls()) { expect(button).toBeDisabled(); fireEvent.click(button); }
    expect(rpc).not.toHaveBeenCalled();
    expect(schema).toHaveBeenCalledWith("procurement");
    expect(list).toHaveBeenCalledWith(200);
  });

  it("effective Warehouse recommendation can Save but cannot accept, dismiss or hand off", async () => {
    session.userCapabilities = { warehouse: ["recommend_replenishment"] };
    render(ui());
    await screen.findByText("saved-product");
    const [save, ...management] = controls();
    expect(save).toBeEnabled();
    for (const button of management) { expect(button).toBeDisabled(); fireEvent.click(button); }
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.click(save);
    await waitFor(() => expect(rpc).toHaveBeenCalledExactlyOnceWith("manage_replenishment_recommendation", { payload: {
      action: "recommend", product_id: "new-product", recommended_quantity: 5, on_hand: 1, reorder_point: 6,
      lead_time_days: 7, stockout_risk: "high", rationale: "Expected demand",
    } }));
  });

  it.each([
    ["Accept", "accept", "rec-1"], ["Hand off to Procurement", "handoff", "rec-2"], ["Dismiss", "dismiss", "rec-1"],
  ])("effective Procurement management preserves %s payload but cannot Save", async (label, action, id) => {
    session.userCapabilities = { procurement: ["manage_replenishment"] };
    render(ui());
    await screen.findByText("saved-product");
    const save = screen.getByRole("button", { name: "Save +5" });
    expect(save).toBeDisabled(); fireEvent.click(save); expect(rpc).not.toHaveBeenCalled();
    const button = screen.getAllByRole("button", { name: label })[0];
    if (!button) throw new Error(`Missing ${label} action`);
    expect(button).toBeEnabled(); fireEvent.click(button);
    await waitFor(() => expect(rpc).toHaveBeenCalledExactlyOnceWith("manage_replenishment_recommendation", { payload: { id, action } }));
  });

  it("combines effective grants from multiple modules, not a selected display role", async () => {
    session.userRoles = { warehouse: ["operations", "bi_analyst"], procurement: ["procurement_officer"] };
    session.userCapabilities = { warehouse: ["recommend_replenishment"], procurement: ["manage_replenishment"] };
    render(ui());
    await screen.findByText("saved-product");
    controls().forEach(button => expect(button).toBeEnabled());
  });

  it.each(["loading", "signed-out", "missing-projection"])("denies all actions when %s while retaining fetched rows", async state => {
    session.userCapabilities = { warehouse: ["recommend_replenishment"], procurement: ["manage_replenishment"] };
    if (state === "loading") session.loading = true;
    if (state === "signed-out") session.profile = null;
    if (state === "missing-projection") session.userCapabilities = undefined;
    render(ui());
    await screen.findByText("saved-product");
    for (const button of controls()) { expect(button).toBeDisabled(); fireEvent.click(button); }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("revoking effective grants disables existing controls without hiding rows or writing", async () => {
    session.userCapabilities = { warehouse: ["recommend_replenishment"], procurement: ["manage_replenishment"] };
    const { rerender } = render(ui());
    await screen.findByText("saved-product");
    controls().forEach(button => expect(button).toBeEnabled());
    session = { ...session, userCapabilities: {} };
    rerender(ui());
    for (const button of controls()) { expect(button).toBeDisabled(); fireEvent.click(button); }
    expect(screen.getByText("saved-product")).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("preserves memory-mode absence with no live reads or writes", () => {
    session.mode = "memory";
    render(ui());
    expect(screen.queryByRole("heading", { name: "Replenishment control" })).not.toBeInTheDocument();
    expect(schema).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
