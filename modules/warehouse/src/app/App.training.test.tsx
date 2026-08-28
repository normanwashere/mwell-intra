import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { App } from "./App";
import {
  certifiedTestLearning,
  renderWithProviders,
} from "@/test/renderWithProviders";
import type { LearningContextValue } from "@intra/learning";

const session = vi.hoisted(() => ({
  capabilities: ["reserve_allocate"] as string[],
}));
vi.mock("@/pages/AllocationsPage", () => ({
  AllocationsPage: () => <h1>Allocations</h1>,
}));
vi.mock("@/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/auth/session")>();
  return {
    ...actual,
    useSession: () => ({
      ...actual.useSession(),
      roleCapabilities: { warehouse: session.capabilities },
    }),
  };
});

function lockedLearning(
  overrides: Partial<LearningContextValue> = {},
): LearningContextValue {
  return {
    ...certifiedTestLearning,
    isLiveCapability: () => false,
    lockedReason: (_module, capability) =>
      capability === "reserve_allocate"
        ? {
            capability: { module: "warehouse", capability: "reserve_allocate" },
            reason: "missing_certification",
            requirementIds: ["marketing-reservation-assessment"],
            canRequestEmergencyException: false,
          }
        : null,
    ...overrides,
  };
}

describe("Warehouse training denial recovery", () => {
  beforeEach(() => {
    session.capabilities = ["reserve_allocate"];
  });

  it("links a training-locked Marketing assignment to its exact learning step", async () => {
    renderWithProviders(<App />, {
      role: "marketing",
      source: "supabase",
      capabilities: [],
      route: "/allocations",
      learning: lockedLearning(),
    });
    expect(
      await screen.findByText("Complete onboarding before this action"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Resume onboarding" }),
    ).toHaveAttribute(
      "href",
      "/onboarding?requirement=marketing-reservation-assessment",
    );
    expect(
      screen.queryByText(/not assigned to your current roles/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reserve for event" }),
    ).not.toBeInTheDocument();
  });

  it("does not offer training as a bypass for a missing assignment", async () => {
    session.capabilities = ["view_inventory"];
    renderWithProviders(<App />, {
      role: "marketing",
      source: "supabase",
      capabilities: [],
      route: "/allocations",
      learning: lockedLearning(),
    });
    expect(
      await screen.findByText(/not assigned to your current roles/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Resume onboarding" }),
    ).not.toBeInTheDocument();
  });

  it("offers an access refresh instead of a stale training explanation", async () => {
    const refreshAccess = vi.fn().mockResolvedValue(false);
    renderWithProviders(<App />, {
      role: "marketing",
      source: "supabase",
      capabilities: [],
      route: "/allocations",
      learning: lockedLearning({ stale: true, refreshAccess }),
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Refresh access" }),
    );
    await waitFor(() => expect(refreshAccess).toHaveBeenCalledOnce());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Access could not be refreshed",
    );
    expect(
      screen.queryByRole("link", { name: "Resume onboarding" }),
    ).not.toBeInTheDocument();
  });

  it("honors a live capability from another assignment without showing a training lock", async () => {
    session.capabilities = ["reserve_allocate", "issue_items"];
    renderWithProviders(<App />, {
      role: "marketing",
      source: "supabase",
      capabilities: ["issue_items"],
      route: "/allocations",
      learning: lockedLearning(),
    });
    expect(
      await screen.findByRole("heading", { name: "Allocations" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Complete onboarding before this action"),
    ).not.toBeInTheDocument();
  });
});
