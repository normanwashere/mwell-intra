import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionValue } from "@intra/auth";
import { ToastProvider } from "@intra/ui";
import type { EventsData } from "./types";

const state = vi.hoisted(() => ({
  session: null as unknown as SessionValue,
  reconciliationStatus: "draft" as "draft" | "submitted" | "approved",
  issuedUnits: 3,
  saveReconciliation: vi.fn(async () => undefined),
  openReconciliationEvidence: vi.fn(async () =>
    "https://example.com/uat/events/UAT-AUG24-EVENT-A"),
}));

vi.mock("@intra/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@intra/auth")>();
  return { ...actual, useSession: () => state.session };
});

vi.mock("./data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./data")>();
  const data = (): EventsData => ({
    events: [
      {
        id: "uat-event-a",
        name: "UAT Event A - On-ground Sales",
        type: "b2c",
        startDate: "2026-09-12",
        endDate: "2026-09-13",
        ownerEmail: "marketing@mwell.demo",
        lifecycle: "planned",
        reservedUnits: 3,
        issuedUnits: state.issuedUnits,
        returnedUnits: 0,
      },
    ],
    reconciliations: [
      {
        eventId: "uat-event-a",
        status: state.reconciliationStatus,
        soldUnits: 3,
        giveawayUnits: 0,
        returnedUnits: 0,
        lostUnits: 0,
        damagedUnits: 0,
        rekitUnits: 0,
        grossSalesAmount: 16_970,
        evidenceUrl: "https://example.com/uat/events/UAT-AUG24-EVENT-A",
        preparedBy: "marketing-user",
        updatedAt: "2026-08-24T12:00:00Z",
      },
    ],
    warnings: [],
  });
  return {
    ...actual,
    useEventsData: () => ({
      data: data(),
      loading: false,
      error: null,
      refresh: vi.fn(async () => undefined),
      createEvent: vi.fn(async () => undefined),
      manageEvent: vi.fn(async () => undefined),
      requestFulfillment: vi.fn(async () => undefined),
      saveReconciliation: state.saveReconciliation,
      openReconciliationEvidence: state.openReconciliationEvidence,
      isDemo: false,
    }),
  };
});

import { EventsApp } from "./EventsApp";

function session(roles: SessionValue["userRoles"]): SessionValue {
  return {
    profile: {
      id: "event-user",
      email: "event-user@mwell.demo",
      kind: "employee",
      name: "Event User",
      title: "Event User",
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

function renderEvent() {
  return render(
    <ToastProvider>
      <EventsApp eventId="uat-event-a" />
    </ToastProvider>,
  );
}

describe("event reconciliation handoff", () => {
  beforeEach(() => {
    state.reconciliationStatus = "draft";
    state.issuedUnits = 3;
    state.saveReconciliation.mockClear();
    state.openReconciliationEvidence.mockClear();
  });

  it("LV07 preserves custody labels and large counts in a text-relative wrapping grid", () => {
    state.issuedUnits = 123456789;
    state.session = session({ events: ["coordinator"] });
    renderEvent();
    const totals = screen.getByLabelText("Event custody totals");
    expect(totals.style.gridTemplateColumns).toBe("repeat(auto-fit, minmax(min(100%, 5rem), 1fr))");
    for (const [label, count] of [["Reserved", "3"], ["Issued", "123456789"], ["Returned", "0"]] as const) {
      const term = within(totals).getByText(label);
      expect(term).toHaveClass("max-w-full", "[overflow-wrap:anywhere]");
      expect(term.closest("dt")).toHaveClass("sm:flex-wrap");
      expect(term.closest("dt")?.nextElementSibling).toHaveTextContent(count);
      expect(term.closest("dt")?.nextElementSibling).toHaveClass("break-all");
    }
    expect(totals.querySelectorAll("dd")).toHaveLength(3);
    expect(screen.getByRole("heading", { name: "Event reconciliation" })).toHaveClass("[overflow-wrap:anywhere]");
    expect(state.saveReconciliation).not.toHaveBeenCalled();
  });

  it("gives Event operations the evidence-backed submission action without asking for a Finance reference", async () => {
    state.session = session({ events: ["coordinator"] });
    renderEvent();

    expect(screen.getByText("Draft reconciliation")).toBeInTheDocument();
    expect(screen.getByText("Event operations")).toBeInTheDocument();
    expect(screen.getByText("Evidence attached")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Submit to Finance" }));

    expect(screen.getByLabelText("Finance reference")).toBeDisabled();
    expect(screen.getByLabelText("Evidence URL")).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Submit reconciliation" }));
    await waitFor(() =>
      expect(state.saveReconciliation).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "submit",
          eventId: "uat-event-a",
          financeReference: "",
        }),
      ),
    );
  });

  it('LV06 keeps live balance and identity in the editor without blocking an incomplete draft', async () => {
    state.issuedUnits = 5;
    state.session = session({ events: ['coordinator'] });
    renderEvent();
    fireEvent.click(screen.getByRole('button', { name: 'Edit outcomes' }));
    expect(screen.getByText('Issued: 5 / Accounted: 3 / Remaining: 2')).toBeInTheDocument();
    expect(screen.getByText('Incomplete draft balance')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Giveaway'), { target: { value: '3' } });
    expect(screen.getByText('Issued: 5 / Accounted: 6 / Remaining: -1')).toBeInTheDocument();
    expect(screen.getByText('Excess outcomes')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Giveaway'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(state.saveReconciliation).toHaveBeenCalledWith(expect.objectContaining({ action: 'save', soldUnits: 3 })));
  });

  it("lets the Finance reviewer add only the missing reference before approval", async () => {
    state.reconciliationStatus = "submitted";
    state.session = session({ events: ["finance_reviewer"] });
    renderEvent();

    expect(screen.getByText("Finance review")).toBeInTheDocument();
    expect(screen.getByText("Finance settlement reviewer")).toBeInTheDocument();
    expect(screen.getByText("Finance settlement reference is missing.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review settlement" }));

    expect(screen.getByLabelText("Sold")).toBeDisabled();
    expect(screen.getByLabelText("Evidence URL")).toBeDisabled();
    const financeReference = screen.getByLabelText("Finance reference");
    expect(financeReference).toBeEnabled();
    fireEvent.change(financeReference, { target: { value: "FIN-EVT-AUG24-001" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve settlement" }));
    await waitFor(() =>
      expect(state.saveReconciliation).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "approve",
          financeReference: "FIN-EVT-AUG24-001",
        }),
      ),
    );
  });

  it("shows the current owner and stage without mutation controls to Event viewers", () => {
    state.reconciliationStatus = "submitted";
    state.session = session({ events: ["viewer"] });
    renderEvent();

    expect(screen.getByText("Finance review")).toBeInTheDocument();
    expect(screen.getByText("Finance settlement reviewer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit to Finance" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review settlement" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve settlement" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open evidence" })).toBeInTheDocument();
  });

  it("uses the audited evidence action for Event and Finance reviewers", async () => {
    state.reconciliationStatus = "submitted";
    state.session = session({ events: ["finance_reviewer"] });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderEvent();

    fireEvent.click(screen.getByRole("button", { name: "Open evidence" }));

    await waitFor(() =>
      expect(state.openReconciliationEvidence).toHaveBeenCalledWith("uat-event-a"),
    );
    expect(open).toHaveBeenCalledWith(
      "https://example.com/uat/events/UAT-AUG24-EVENT-A",
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });
});
