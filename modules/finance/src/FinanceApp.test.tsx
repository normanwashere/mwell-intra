import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionValue } from "@intra/auth";
import { ToastProvider } from "@intra/ui";
import { FINANCE_DEMO_DATA } from "./seed";
import type { FinanceData } from "./types";

const state = vi.hoisted(() => ({
  session: null as unknown as SessionValue,
  data: null as unknown as {
    data: FinanceData;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    manageCloseEntry: ReturnType<typeof vi.fn>;
    openCloseEvidence: ReturnType<typeof vi.fn>;
  },
}));

vi.mock("@intra/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@intra/auth")>();
  const { can } = await import('@intra/rbac');
  return { ...actual, useSession: () => state.session, useCan: (module: keyof SessionValue['userRoles'], cap: string) => state.session.mode === 'supabase' ? state.session.userCapabilities?.[module]?.includes(cap) === true : can(state.session.userRoles, module, cap as never) };
});

vi.mock("./data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./data")>();
  return { ...actual, useFinanceData: () => state.data };
});

import { FinanceApp } from "./FinanceApp";

function renderFinanceApp() {
  return render(
    <ToastProvider>
      <FinanceApp />
    </ToastProvider>,
  );
}

function session(roles: SessionValue["userRoles"]): SessionValue {
  return {
    profile: {
      id: "finance-user",
      email: "finance@mwell.demo",
      kind: "employee",
      name: "Rina Domingo",
      title: "Finance Manager",
    },
    userRoles: roles,
    mode: "memory",
    supabaseClient: null,
    loading: false,
    signingIn: false,
    authError: null,
    memoryProfiles: [],
    signInWithPassword: vi.fn(async () => true),
    signOut: vi.fn(async () => undefined),
    resetPassword: vi.fn(async () => undefined),
    changePassword: vi.fn(async () => undefined),
    refreshCapabilities: vi.fn(async () => true),
  };
}

describe("FinanceApp", () => {
  beforeEach(() => {
    state.session = session({
      core: ["staff"],
      warehouse: ["finance"],
      procurement: ["finance"],
    });
    state.data = {
      data: FINANCE_DEMO_DATA,
      loading: false,
      error: null,
      refresh: vi.fn(async () => undefined),
      manageCloseEntry: vi.fn(async () => undefined),
      openCloseEvidence: vi.fn(async () => "https://example.com/events/event-a"),
    };
  });

  it("shows one unified workspace for a dual-role Finance user", () => {
    renderFinanceApp();
    expect(
      screen.getByRole("heading", { name: "Finance control center" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Warehouse Finance")).toBeInTheDocument();
    expect(screen.getByText("Procurement Finance")).toBeInTheDocument();
    expect(screen.getByText("Payment readiness")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Payment readiness" }),
    ).toHaveClass("min-w-0", "max-w-full", "overflow-hidden");
    for (const purchaseOrderLink of screen.getAllByRole("link", {
      name: "PO-2026-0004",
    })) {
      expect(purchaseOrderLink).toHaveClass("break-all", "sm:break-normal");
      expect(purchaseOrderLink).toHaveClass("min-h-11");
    }
    for (const activityLink of screen.getAllByRole("link", {
      name: "po_seed_004",
    })) {
      expect(activityLink).toHaveClass("min-h-11");
    }
    expect(screen.getByText("Cross-module activity")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /stock adjustment approvals/i }),
    ).toHaveAttribute("href", "/warehouse/approvals");
    expect(
      screen.getByRole("link", { name: /review next payment pack/i }),
    ).toHaveAttribute("href", "/procurement/purchase-orders/po_seed_004");
  });

  it('uses effective live grants, withholding uncertified close actions while retaining reads', () => {
    state.session = {...state.session, mode: 'supabase', userCapabilities: {warehouse:['view_finance']}, roleCapabilities: {warehouse:['view_finance','manage_finance_close']}};
    const view = renderFinanceApp();
    expect(screen.queryByRole('button',{name:'Prepare close entry'})).not.toBeInTheDocument();
    expect(screen.getByRole('link',{name:'Complete Finance onboarding'})).toBeInTheDocument();
    expect(screen.queryByRole('heading',{name:'Payment readiness'})).not.toBeInTheDocument();
    state.session = {...state.session, userCapabilities: {warehouse:['view_finance','manage_finance_close']}};
    view.rerender(<ToastProvider><FinanceApp /></ToastProvider>);
    expect(screen.getByRole('button',{name:'Prepare close entry'})).toBeInTheDocument();
  });

  it("opens receipt evidence in place instead of linking Finance to receiving", () => {
    renderFinanceApp();

    expect(
      screen.queryByRole("link", { name: "receipt-demo-318" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole("button", {
        name: "View receipt-demo-318 details",
      })[0]!,
    );

    const dialog = screen.getByRole("dialog", {
      name: "Finance activity receipt-demo-318",
    });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("Warehouse receipt")).toBeInTheDocument();
    expect(within(dialog).getByText("received")).toBeInTheDocument();
  });

  it("admits Procurement Finance without inventing Warehouse access", () => {
    state.session = session({ core: ["staff"], procurement: ["finance"] });
    renderFinanceApp();
    expect(screen.getByText("Procurement Finance")).toBeInTheDocument();
    expect(screen.queryByText("Warehouse Finance")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /stock adjustment approvals/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /prepare close entry/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps Warehouse Pricing read-only in the Finance workspace", () => {
    state.session = session({ core: ["staff"], warehouse: ["pricing"] });
    renderFinanceApp();
    expect(screen.getByText("Warehouse Finance")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /prepare close entry/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps a Warehouse-only Finance user in Warehouse-owned workflows", () => {
    state.session = session({ core: ["staff"], warehouse: ["finance"] });
    state.data = {
      ...state.data,
      data: {
        ...FINANCE_DEMO_DATA,
        payments: [],
        activity: FINANCE_DEMO_DATA.activity.filter(
          (item) => item.source !== "procurement_po",
        ),
      },
    };
    renderFinanceApp();
    expect(
      screen.getByRole("link", { name: /review inventory value/i }),
    ).toHaveAttribute("href", "/warehouse/inventory");
    expect(
      screen.queryByRole("link", { name: /open purchase orders/i }),
    ).not.toBeInTheDocument();
  });

  it("retrieves Event evidence through the audited action before posting", async () => {
    state.data = {
      ...state.data,
      data: {
        ...FINANCE_DEMO_DATA,
        closeEntries: [
          {
            ...FINANCE_DEMO_DATA.closeEntries[0]!,
            sourceRecordType: "event_reconciliation",
            sourceRecordId: "event-a",
            evidenceRecordType: "event_reconciliation",
            evidenceRecordId: "event-a",
            evidenceUrl: "https://example.com/events/event-a",
          },
        ],
      },
    };
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderFinanceApp();

    const openEvidence = screen.getByRole("button", { name: "Open evidence" });
    await act(async () => {
      fireEvent.click(openEvidence);
      await vi.waitFor(() =>
        expect(state.data.openCloseEvidence).toHaveBeenCalledWith(
          expect.objectContaining({ id: "close-demo-event-settlement" }),
        ),
      );
    });
    expect(open).toHaveBeenCalledWith(
      "https://example.com/events/event-a",
      "_blank",
      "noopener,noreferrer",
    );
    await vi.waitFor(() => expect(openEvidence).toBeEnabled());
    open.mockRestore();
  });

  it("prevents the settlement approver from posting the generated close entry", () => {
    state.data = {
      ...state.data,
      data: {
        ...FINANCE_DEMO_DATA,
        closeEntries: [
          {
            ...FINANCE_DEMO_DATA.closeEntries[0]!,
            sourceRecordType: "event_reconciliation",
            sourceRecordId: "event-a",
            evidenceRecordType: "event_reconciliation",
            evidenceRecordId: "event-a",
            settlementApprovedBy: "finance-user",
          },
        ],
      },
    };
    renderFinanceApp();

    expect(screen.getByRole("button", { name: "Post" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Post" })).toHaveAttribute(
      "title",
      "A different Finance user must post this settlement.",
    );
  });

  it("keeps posting available to an independent Finance actor", () => {
    state.data = {
      ...state.data,
      data: {
        ...FINANCE_DEMO_DATA,
        closeEntries: [
          {
            ...FINANCE_DEMO_DATA.closeEntries[0]!,
            sourceRecordType: "event_reconciliation",
            sourceRecordId: "event-a",
            evidenceRecordType: "event_reconciliation",
            evidenceRecordId: "event-a",
            settlementApprovedBy: "finance-approver",
          },
        ],
      },
    };
    renderFinanceApp();

    expect(screen.getByRole("button", { name: "Post" })).toBeEnabled();
  });

  it("shows an explicit denial for unrelated roles", () => {
    state.session = session({ core: ["staff"], procurement: ["requester"] });
    renderFinanceApp();
    expect(
      screen.getByRole("heading", { name: "No Finance access" }),
    ).toBeInTheDocument();
  });

  it("preserves valid data when one live source reports a warning", () => {
    state.data = {
      ...state.data,
      error: "Inventory valuation: source unavailable",
    };
    renderFinanceApp();
    expect(
      screen.getByText(/some Finance sources are unavailable/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText("PO-2026-0004")).toHaveLength(2);
  });
});
