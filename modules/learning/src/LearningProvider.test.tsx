import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { UserCapabilities } from "@intra/auth";
import type { LearningRepository } from "./repository";
import type { LearningSnapshot } from "./types";
import { LearningProvider, useLearning } from "./LearningProvider";

const session: {
  profile: { id: string; email: string; kind: "employee" };
  userCapabilities: UserCapabilities;
  userRoles?: Record<string, string[]>;
} = {
  profile: {
    id: "learner-1",
    email: "operator@mwell.test",
    kind: "employee" as const,
  },
  userCapabilities: {
    warehouse: ["view_inventory"],
  } satisfies UserCapabilities,
};

vi.mock("@intra/auth", async () => {
  const actual = await vi.importActual<typeof import("@intra/auth")>(
    "@intra/auth",
  );
  return { ...actual, useSession: () => session };
});

const emptySnapshot = (refreshedAt = "2026-08-13T00:00:00.000Z") =>
  ({
    curricula: [],
    progress: [],
    certifications: [],
    lockedCapabilities: [
      {
        capability: { module: "warehouse", capability: "receive_stock" },
        reason: "missing_certification",
        requirementIds: ["receiving-scenario"],
        canRequestEmergencyException: true,
      },
    ],
    refreshedAt,
  }) satisfies LearningSnapshot;

function repository(
  snapshot: LearningSnapshot | (() => Promise<LearningSnapshot>),
): LearningRepository {
  const resolve =
    typeof snapshot === "function"
      ? snapshot
      : vi.fn().mockResolvedValue(snapshot);
  return {
    snapshot: vi.fn(resolve),
    resolveAssignments: vi.fn(resolve),
    startRequirement: vi.fn(),
    checkpoint: vi.fn(),
    submitAssessment: vi.fn(),
    acknowledgePolicy: vi.fn(),
    requestSupport: vi.fn(),
    refreshCertifications: vi.fn(),
  } as LearningRepository;
}

function Probe() {
  const learning = useLearning();
  const lock = learning.lockedReason("warehouse", "receive_stock");
  return (
    <div>
      <span data-testid="loading">{String(learning.loading)}</span>
      <span data-testid="error">{learning.error ?? "none"}</span>
      <span data-testid="stale">{String(learning.stale)}</span>
      <span data-testid="snapshot">
        {learning.snapshot?.refreshedAt ?? "none"}
      </span>
      <span data-testid="curricula">
        {learning.snapshot?.curricula.length ?? 0}
      </span>
      <span data-testid="view-live">
        {String(learning.isLiveCapability("warehouse", "view_inventory"))}
      </span>
      <span data-testid="receive-live">
        {String(learning.isLiveCapability("warehouse", "receive_stock"))}
      </span>
      <span data-testid="lock">{lock?.reason ?? "none"}</span>
      <button onClick={() => learning.resume("receiving-scenario")}>Resume</button>
      <span data-testid="resume">{learning.resumeRequirementId ?? "none"}</span>
      <button onClick={() => void learning.refresh()}>Refresh</button>
    </div>
  );
}

describe("LearningProvider", () => {
  it("loads resolved assignments and exposes fail-closed capability helpers", async () => {
    const learningRepository = repository(emptySnapshot());
    render(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );

    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    await waitFor(() =>
      expect(screen.getByTestId("snapshot")).toHaveTextContent(
        "2026-08-13T00:00:00.000Z",
      ),
    );
    expect(learningRepository.resolveAssignments).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("view-live")).toHaveTextContent("true");
    expect(screen.getByTestId("receive-live")).toHaveTextContent("false");
    expect(screen.getByTestId("lock")).toHaveTextContent(
      "missing_certification",
    );

    await act(async () => screen.getByRole("button", { name: "Resume" }).click());
    expect(screen.getByTestId("resume")).toHaveTextContent(
      "receiving-scenario",
    );
  });

  it("keeps the previous read-only snapshot visible but marks it stale after refresh failure", async () => {
    let calls = 0;
    const learningRepository = repository(async () => {
      calls += 1;
      if (calls === 1) return emptySnapshot();
      throw new Error("Learning service unavailable");
    });
    render(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );
    await screen.findByText("2026-08-13T00:00:00.000Z");

    await act(async () =>
      screen.getByRole("button", { name: "Refresh" }).click(),
    );

    expect(screen.getByTestId("snapshot")).toHaveTextContent(
      "2026-08-13T00:00:00.000Z",
    );
    expect(screen.getByTestId("stale")).toHaveTextContent("true");
    expect(screen.getByTestId("error")).toHaveTextContent(
      "Learning service unavailable",
    );
  });

  it("refreshes when the window regains focus", async () => {
    const learningRepository = repository(emptySnapshot());
    render(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );
    await waitFor(() =>
      expect(learningRepository.resolveAssignments).toHaveBeenCalledTimes(1),
    );

    window.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect(learningRepository.resolveAssignments).toHaveBeenCalledTimes(2),
    );
  });

  it("refreshes when the active role assignment changes", async () => {
    const learningRepository = repository(emptySnapshot());
    const { rerender } = render(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );
    await waitFor(() =>
      expect(learningRepository.resolveAssignments).toHaveBeenCalledTimes(1),
    );

    session.userRoles = { warehouse: ["operations"] };
    rerender(
      <LearningProvider repository={learningRepository}>
        <Probe />
      </LearningProvider>,
    );

    await waitFor(() =>
      expect(learningRepository.resolveAssignments).toHaveBeenCalledTimes(2),
    );
    session.userRoles = undefined;
  });

  it("derives a role-accurate preview snapshot in local memory mode", async () => {
    session.userRoles = {
      core: ["staff"],
      warehouse: ["operations"],
    };
    render(
      <LearningProvider>
        <Probe />
      </LearningProvider>,
    );

    await waitFor(() =>
      expect(Number(screen.getByTestId("curricula").textContent)).toBeGreaterThan(0),
    );
    expect(screen.getByTestId("lock")).toHaveTextContent("none");
    session.userRoles = undefined;
  });
});
