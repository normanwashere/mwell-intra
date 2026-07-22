import { render, screen } from "@testing-library/react";
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
});
