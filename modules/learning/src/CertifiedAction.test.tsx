import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CertifiedAction } from "./CertifiedAction";
import { LearningContext, type LearningContextValue } from "./LearningProvider";

const session = {
  mode: "supabase" as const,
  userRoles: { warehouse: ["warehouse_operator"] },
  roleCapabilities: { warehouse: ["receive_stock"] },
};
vi.mock("@intra/auth", async () => {
  const actual = await vi.importActual<typeof import("@intra/auth")>("@intra/auth");
  return { ...actual, useSession: () => session };
});

function value(overrides: Partial<LearningContextValue> = {}): LearningContextValue {
  return {
    snapshot: null, loading: false, stale: false, error: null,
    resumeRequirementId: null, startingRequirementId: null, trainingError: null,
    activeTraining: null, activeActivity: null, refresh: vi.fn(), resume: vi.fn(), closeTraining: vi.fn(), closeActivity: vi.fn(),
    recordCheckpoint: vi.fn(), submitAssessment: vi.fn(), acknowledgePolicy: vi.fn(),
    requestSupport: vi.fn(), isLiveCapability: vi.fn().mockReturnValue(true),
    lockedReason: vi.fn().mockReturnValue(null), ...overrides,
  };
}

describe("CertifiedAction", () => {
  beforeEach(() => {
    session.roleCapabilities = { warehouse: ["receive_stock"] };
  });

  it("runs a certified action once while the command is in flight", async () => {
    let release!: () => void;
    const command = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    render(
      <LearningContext.Provider value={value()}>
        <CertifiedAction module="warehouse" capability="receive_stock">
          {({ execute, pending }) => (
            <button disabled={pending} onClick={() => void execute(command)}>Receive stock</button>
          )}
        </CertifiedAction>
      </LearningContext.Provider>,
    );

    const button = screen.getByRole("button", { name: "Receive stock" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(command).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    release();
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("never renders the command for role denial or incomplete training", () => {
    session.roleCapabilities = { warehouse: [] };
    const { rerender } = render(
      <LearningContext.Provider value={value()}>
        <CertifiedAction module="warehouse" capability="receive_stock">
          {() => <button>Receive stock</button>}
        </CertifiedAction>
      </LearningContext.Provider>,
    );
    expect(screen.queryByRole("button", { name: "Receive stock" })).not.toBeInTheDocument();
    expect(screen.getByText("This action is not assigned to your role")).toBeInTheDocument();

    session.roleCapabilities = { warehouse: ["receive_stock"] };
    rerender(
      <LearningContext.Provider
        value={value({
          isLiveCapability: vi.fn().mockReturnValue(false),
          lockedReason: vi.fn().mockReturnValue({
            capability: { module: "warehouse", capability: "receive_stock" },
            reason: "missing_certification",
            requirementIds: ["receiving"],
            canRequestEmergencyException: false,
          }),
        })}
      >
        <CertifiedAction module="warehouse" capability="receive_stock">
          {() => <button>Receive stock</button>}
        </CertifiedAction>
      </LearningContext.Provider>,
    );
    expect(screen.queryByRole("button", { name: "Receive stock" })).not.toBeInTheDocument();
    expect(screen.getByText("Complete onboarding before this action")).toBeInTheDocument();
  });

  it("fails closed when learning authority is unavailable", () => {
    render(
      <CertifiedAction module="warehouse" capability="receive_stock">
        {() => <button>Receive stock</button>}
      </CertifiedAction>,
    );

    expect(screen.queryByRole("button", { name: "Receive stock" })).not.toBeInTheDocument();
    expect(screen.getByText("This action is temporarily unavailable")).toBeInTheDocument();
  });
});
