import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionValue } from "@intra/auth";
import type { ProductWorkspaceData } from "./data";

const state = vi.hoisted(() => ({
  session: null as unknown as SessionValue,
  workspace: null as unknown as {
    data: ProductWorkspaceData;
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    decideReadiness: (id: string, decision: "approved" | "rejected", note: string) => Promise<void>;
    acknowledgeHandoff: (id: string) => Promise<void>;
    decidePrice: (id: string, decision: "approved" | "rejected", note: string) => Promise<void>;
    createReadiness: () => Promise<void>;
    proposePrice: () => Promise<void>;
  },
}));

vi.mock("@intra/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@intra/auth")>();
  return { ...actual, useSession: () => state.session };
});

vi.mock("./data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./data")>();
  return { ...actual, useProductWorkspace: () => state.workspace };
});

import { ProductApp } from "./ProductApp";

const DATA: ProductWorkspaceData = {
  readiness: [
    {
      id: "ready-1",
      productId: "prod-1",
      title: "Remote care launch",
      version: 2,
      status: "submitted",
      evidence: [
        {
          id: "e-1",
          label: "Security review",
          reference: "SEC-241",
          required: true,
          verified: true,
        },
      ],
      conditions: "Launch during the approved change window.",
      preparedBy: "contributor-1",
      submittedBy: "contributor-1",
      submittedAt: "2026-07-22T01:00:00.000Z",
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      operationsAcknowledgedBy: null,
      operationsAcknowledgedAt: null,
      createdAt: "2026-07-22T00:00:00.000Z",
      updatedAt: "2026-07-22T01:00:00.000Z",
    },
  ],
  pricing: [
    {
      id: "price-1",
      productId: "prod-1",
      productName: "Remote care kit",
      version: 3,
      status: "submitted",
      currentPrice: 1000,
      proposedPrice: 1200,
      costBasis: 750,
      reason: "Reflect the approved supplier cost revision.",
      effectiveAt: "2026-08-01T00:00:00.000Z",
      proposedBy: "contributor-1",
      submittedAt: "2026-07-22T01:00:00.000Z",
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: "2026-07-22T00:00:00.000Z",
    },
  ],
  warnings: [],
};

function session(productRoles: string[]): SessionValue {
  return {
    profile: {
      id: "owner-1",
      email: "product.owner@mwell.demo",
      kind: "employee",
      name: "Pia Salcedo",
      title: "Product Owner",
    },
    userRoles: { core: ["staff"], product: productRoles },
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
  };
}

describe("ProductApp", () => {
  beforeEach(() => {
    state.session = session(["product_owner"]);
    state.workspace = {
      data: DATA,
      loading: false,
      error: null,
      refresh: vi.fn(async () => undefined),
      decideReadiness: vi.fn(async () => undefined),
      acknowledgeHandoff: vi.fn(async () => undefined),
      decidePrice: vi.fn(async () => undefined),
      createReadiness: vi.fn(async () => undefined),
      proposePrice: vi.fn(async () => undefined),
    };
  });

  it("gives the Product Owner final decisions without preparation controls", () => {
    render(<ProductApp />);
    expect(
      screen.getByRole("heading", { name: "Product readiness" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Remote care launch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve go-live" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject go-live" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve price" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New readiness package" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Propose price" })).not.toBeInTheDocument();
  });

  it("gives Operations only the approved handoff acknowledgement", () => {
    state.session = session(["operations_partner"]);
    state.workspace = {
      ...state.workspace,
      data: {
        ...DATA,
        readiness: [{ ...DATA.readiness[0]!, status: "approved" }],
      },
    };
    render(<ProductApp />);
    expect(
      screen.getByRole("button", { name: "Acknowledge Operations handoff" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve go-live" })).not.toBeInTheDocument();
    expect(screen.queryByText("Pricing governance")).not.toBeInTheDocument();
  });

  it("keeps contributors in preparation and proposal actions", () => {
    state.session = session(["contributor"]);
    render(<ProductApp />);
    expect(screen.getByRole("button", { name: "New readiness package" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Propose price" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve go-live" })).not.toBeInTheDocument();
  });

  it("fails closed for unrelated roles", () => {
    state.session = session([]);
    render(<ProductApp />);
    expect(
      screen.getByRole("heading", { name: "No Product access" }),
    ).toBeInTheDocument();
  });

  it("locks a go-live decision while pending and prevents duplicate submission", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    state.workspace.decideReadiness = vi.fn(() => pending);
    render(<ProductApp />);

    fireEvent.click(screen.getByRole("button", { name: "Approve go-live" }));
    fireEvent.change(screen.getByLabelText("Decision note"), {
      target: { value: "All required evidence is current." },
    });
    const submit = screen.getAllByRole("button", {
      name: "Approve go-live",
    }).at(-1)!;
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(state.workspace.decideReadiness).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Approve go-live..." }),
    ).toBeDisabled();
    await act(async () => release());
    await waitFor(() =>
      expect(screen.queryByLabelText("Decision note")).not.toBeInTheDocument(),
    );
  });

  it("retains a stale go-live decision note and refreshes the record", async () => {
    state.workspace.decideReadiness = vi.fn(async () => {
      throw new Error("Readiness package not found or no longer submitted.");
    });
    render(<ProductApp />);

    fireEvent.click(screen.getByRole("button", { name: "Reject go-live" }));
    const note = screen.getByLabelText("Decision note");
    fireEvent.change(note, {
      target: { value: "Required launch evidence is no longer current." },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Reject go-live" }).at(-1)!,
    );

    expect(
      await screen.findByText(/record changed.*latest state has been loaded/i),
    ).toBeInTheDocument();
    expect(note).toHaveValue(
      "Required launch evidence is no longer current.",
    );
    expect(state.workspace.refresh).toHaveBeenCalledWith({ background: true });
    expect(
      screen.getAllByRole("button", { name: "Reject go-live" }).at(-1),
    ).toBeDisabled();
  });

  it("keeps readiness form values after a failed submission", async () => {
    state.session = session(["contributor"]);
    state.workspace.createReadiness = vi.fn(async () => {
      throw new Error("Network request failed");
    });
    render(<ProductApp />);

    fireEvent.click(
      screen.getByRole("button", { name: "New readiness package" }),
    );
    fireEvent.change(screen.getByLabelText("Product ID"), {
      target: { value: "PROD-88" },
    });
    fireEvent.change(screen.getByLabelText("Readiness title"), {
      target: { value: "Care kit launch" },
    });
    fireEvent.change(screen.getByLabelText("Evidence name"), {
      target: { value: "Security review" },
    });
    fireEvent.change(screen.getByLabelText("Evidence reference"), {
      target: { value: "SEC-882" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit package" }));

    expect(await screen.findByText(/check your connection/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Product ID")).toHaveValue("PROD-88");
    expect(screen.getByLabelText("Readiness title")).toHaveValue(
      "Care kit launch",
    );
  });

  it("keeps price form values after a failed proposal", async () => {
    state.session = session(["contributor"]);
    state.workspace.proposePrice = vi.fn(async () => {
      throw new Error("Price proposal validation failed at the server");
    });
    render(<ProductApp />);

    fireEvent.click(screen.getByRole("button", { name: "Propose price" }));
    fireEvent.change(screen.getByLabelText("Product ID"), {
      target: { value: "PROD-99" },
    });
    fireEvent.change(screen.getByLabelText("Proposed price"), {
      target: { value: "1400" },
    });
    fireEvent.change(screen.getByLabelText("Cost basis"), {
      target: { value: "900" },
    });
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Approved supplier cost and margin review." },
    });
    fireEvent.change(screen.getByLabelText("Effective date and time"), {
      target: { value: "2026-08-01T09:00" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Submit price proposal" }),
    );

    expect(
      await screen.findByText(/price proposal validation failed/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Product ID")).toHaveValue("PROD-99");
    expect(screen.getByLabelText("Proposed price")).toHaveValue(1400);
  });

  it("does not invite a duplicate price decision when readback fails after save", async () => {
    state.workspace.decidePrice = vi.fn(async () => {
      throw new Error(
        "The Product action was saved, but the latest state could not be loaded.",
      );
    });
    render(<ProductApp />);

    fireEvent.click(screen.getByRole("button", { name: "Approve price" }));
    const note = screen.getByLabelText("Decision note");
    fireEvent.change(note, {
      target: { value: "Commercial basis and effective date are approved." },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: "Approve price" }).at(-1)!,
    );

    expect(
      await screen.findByText(/was saved.*do not submit it again/i),
    ).toBeInTheDocument();
    expect(note).toHaveValue(
      "Commercial basis and effective date are approved.",
    );
    expect(
      screen.getAllByRole("button", { name: "Approve price" }).at(-1),
    ).toBeDisabled();
  });

  it("prevents duplicate Operations handoff acknowledgement", async () => {
    state.session = session(["operations_partner"]);
    state.workspace = {
      ...state.workspace,
      data: {
        ...DATA,
        readiness: [{ ...DATA.readiness[0]!, status: "approved" }],
      },
    };
    let release!: () => void;
    state.workspace.acknowledgeHandoff = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(<ProductApp />);

    const handoff = screen.getByRole("button", {
      name: "Acknowledge Operations handoff",
    });
    fireEvent.click(handoff);
    fireEvent.click(handoff);

    expect(state.workspace.acknowledgeHandoff).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", {
        name: "Acknowledging Operations handoff...",
      }),
    ).toBeDisabled();
    await act(async () => release());
  });
});
