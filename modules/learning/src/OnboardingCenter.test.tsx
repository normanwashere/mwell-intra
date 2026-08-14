import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningSnapshot } from "./types";
import { OnboardingCenter } from "./OnboardingCenter";
import { OnboardingStatusBand } from "./OnboardingStatusBand";
import { LearningContext, type LearningContextValue } from "./LearningProvider";
import {
  clearTrainingAdaptersForTests,
  registerTrainingAdapter,
} from "./training/registry";

const push = vi.fn();
const prefetch = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, prefetch }),
  useSearchParams: () => new URLSearchParams(),
}));

const session = {
  profile: {
    id: "learner-1",
    email: "operator@mwell.test",
    kind: "employee" as "employee" | "vendor",
  },
};

vi.mock("@intra/auth", async () => {
  const actual = await vi.importActual<typeof import("@intra/auth")>(
    "@intra/auth",
  );
  return { ...actual, useSession: () => session };
});

const snapshot: LearningSnapshot = {
  curricula: [
    {
      curriculum: {
        id: "ops-associate",
        version: 1,
        personaId: "operations_associate",
        audience: "internal",
        requirementIds: ["orientation", "receiving", "assessment"],
      },
      source: "role",
      requirements: [
        {
          id: "orientation",
          version: 1,
          audience: "internal",
          kind: "orientation",
          title: "Warehouse safety orientation",
          mandatory: true,
          prerequisiteIds: [],
          capabilityOutcomes: [],
        },
        {
          id: "receiving",
          version: 1,
          audience: "internal",
          kind: "scenario",
          title: "Receive and inspect a serialized device",
          mandatory: true,
          prerequisiteIds: ["orientation"],
          capabilityOutcomes: [
            { module: "warehouse", capability: "receive_stock" },
          ],
          simulationId: "receiving-sim",
        },
        {
          id: "assessment",
          version: 1,
          audience: "internal",
          kind: "assessment",
          title: "Receiving controls check",
          mandatory: true,
          prerequisiteIds: ["receiving"],
          capabilityOutcomes: [
            { module: "warehouse", capability: "receive_stock" },
          ],
          passingScore: 80,
          maxAttempts: 3,
        },
      ],
    },
    {
      curriculum: {
        id: "shared-safety",
        version: 1,
        personaId: "operations_lead",
        audience: "internal",
        requirementIds: ["orientation"],
      },
      source: "department",
      requirements: [
        {
          id: "orientation",
          version: 1,
          audience: "internal",
          kind: "orientation",
          title: "Warehouse safety orientation",
          mandatory: true,
          prerequisiteIds: [],
          capabilityOutcomes: [],
        },
      ],
    },
  ],
  progress: [
    {
      assignmentRequirementId: "ar-orientation",
      requirementId: "orientation",
      requirementVersion: 1,
      state: "passed",
      attemptCount: 1,
      allowsSharedCompletion: true,
      completedAt: "2026-08-12T09:00:00.000Z",
      updatedAt: "2026-08-12T09:00:00.000Z",
    },
    {
      assignmentRequirementId: "ar-receiving",
      requirementId: "receiving",
      requirementVersion: 1,
      state: "in_progress",
      attemptCount: 1,
      allowsSharedCompletion: false,
      activeAttempt: {
        id: "attempt-1",
        attemptNumber: 1,
        mode: "scenario",
        startedAt: "2026-08-13T09:00:00.000Z",
      },
      updatedAt: "2026-08-13T09:00:00.000Z",
    },
    {
      assignmentRequirementId: "ar-assessment",
      requirementId: "assessment",
      requirementVersion: 1,
      state: "needs_support",
      attemptCount: 3,
      allowsSharedCompletion: false,
      updatedAt: "2026-08-13T09:30:00.000Z",
    },
  ],
  certifications: [
    {
      id: "cert-1",
      userId: "learner-1",
      departmentId: "operations",
      sourceRoleAssignmentId: "role-1",
      capability: { module: "warehouse", capability: "view_inventory" },
      curriculumId: "ops-associate",
      curriculumVersion: 1,
      requirementIds: ["orientation"],
      issuedAt: "2026-08-12T09:00:00.000Z",
      effectiveAt: "2026-08-12T09:00:00.000Z",
      expiresAt: "2027-08-12T09:00:00.000Z",
      issuedBy: "system",
    },
  ],
  lockedCapabilities: [
    {
      capability: { module: "warehouse", capability: "receive_stock" },
      reason: "retraining_required",
      requirementIds: ["receiving", "assessment"],
      canRequestEmergencyException: true,
    },
  ],
  refreshedAt: "2026-08-13T10:00:00.000Z",
};

function value(overrides: Partial<LearningContextValue> = {}): LearningContextValue {
  return {
    snapshot,
    loading: false,
    stale: false,
    error: null,
    resumeRequirementId: null,
    startingRequirementId: null,
    trainingError: null,
    activeTraining: null,
    activeActivity: null,
    refresh: vi.fn(),
    refreshAccess: vi.fn().mockResolvedValue(true),
    resume: vi.fn().mockResolvedValue(undefined),
    closeTraining: vi.fn(),
    closeActivity: vi.fn(),
    recordCheckpoint: vi.fn().mockResolvedValue(undefined),
    submitAssessment: vi.fn(),
    acknowledgePolicy: vi.fn(),
    requestSupport: vi.fn(),
    isLiveCapability: vi.fn().mockReturnValue(false),
    lockedReason: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

function renderCenter(overrides: Partial<LearningContextValue> = {}) {
  return render(
    <LearningContext.Provider value={value(overrides)}>
      <OnboardingCenter />
    </LearningContext.Provider>,
  );
}

describe("OnboardingCenter", () => {
  beforeEach(() => {
    push.mockClear();
    prefetch.mockClear();
    clearTrainingAdaptersForTests();
    registerTrainingAdapter({
      id: "receiving-sim",
      version: 1,
      scenarioIds: ["receiving-sim"],
      route: "/warehouse/receiving?training=receiving-sim",
      initialState: () => ({ ready: true }),
      dispatch: (state) => ({ state, nextStepId: "complete", completed: true }),
    });
  });

  it("navigates an active domain simulation to its real module surface", async () => {
    renderCenter({
      activeTraining: {
        requirementId: "receiving",
        assignmentRequirementId: "ar-receiving",
        attemptId: "attempt-receiving",
        mode: "scenario",
        simulationId: "receiving-sim",
      },
    });

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/warehouse/receiving?training=receiving-sim",
      ),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("prefetches assigned domain simulations before a learner starts them", async () => {
    renderCenter();

    await waitFor(() =>
      expect(prefetch).toHaveBeenCalledWith(
        "/warehouse/receiving?training=receiving-sim",
      ),
    );
  });

  it("fails closed when a practice has no supported domain simulation", () => {
    renderCenter({
      snapshot: {
        ...snapshot,
        curricula: snapshot.curricula.map((effective) => ({
          ...effective,
          requirements: effective.requirements.map((requirement) =>
            requirement.id === "receiving"
              ? { ...requirement, simulationId: "procurement-role-practice" }
              : requirement,
          ),
        })),
      },
    });

    expect(screen.getByRole("button", {
      name: "Resume Receive and inspect a serialized device",
    })).toBeDisabled();
    expect(screen.getAllByText("Guided practice is being prepared").length).toBeGreaterThan(0);
  });

  it("prioritizes the next action and deduplicates shared multi-role requirements", () => {
    renderCenter();

    expect(
      screen.getByRole("heading", { level: 1, name: "Role onboarding" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Operations Associate")).toBeInTheDocument();
    expect(screen.getByText("1 of 3 required steps complete")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Resume Receive and inspect a serialized device",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Warehouse safety orientation")).toHaveLength(1);
    expect(screen.getByText("Retraining required")).toBeInTheDocument();
    expect(screen.getByText("Temporary emergency access")).toBeInTheDocument();
    expect(screen.getByText("Needs support")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Read recovery guidance" }),
    ).toHaveAttribute("href", "/knowledge?article=trouble-access-denied");
  });

  it("deduplicates equivalent orientations assigned by different personas", () => {
    const equivalentOrientation = {
      ...snapshot.curricula[0]!.requirements[0]!,
      id: "product-owner-orientation",
    };
    const productPractice = {
      ...snapshot.curricula[0]!.requirements[1]!,
      id: "product-owner-practice",
      title: "Product Owner guided practice",
      prerequisiteIds: [equivalentOrientation.id],
    };
    renderCenter({
      snapshot: {
        ...snapshot,
        curricula: [
          ...snapshot.curricula,
          {
            curriculum: {
              id: "product-owner",
              version: 1,
              personaId: "product_owner",
              audience: "internal",
              requirementIds: [equivalentOrientation.id, productPractice.id],
            },
            source: "role",
            requirements: [equivalentOrientation, productPractice],
          },
        ],
        progress: [
          ...snapshot.progress,
          {
            assignmentRequirementId: "ar-product-owner-orientation",
            requirementId: equivalentOrientation.id,
            requirementVersion: equivalentOrientation.version,
            state: "not_started",
            attemptCount: 0,
            allowsSharedCompletion: true,
            updatedAt: "2026-08-13T10:00:00.000Z",
          },
          {
            assignmentRequirementId: "ar-product-owner-practice",
            requirementId: productPractice.id,
            requirementVersion: productPractice.version,
            state: "not_started",
            attemptCount: 0,
            allowsSharedCompletion: false,
            updatedAt: "2026-08-13T10:00:00.000Z",
          },
        ],
      },
    });

    expect(
      screen.getAllByRole("heading", {
        level: 3,
        name: "Warehouse safety orientation",
      }),
    ).toHaveLength(1);
    expect(
      screen.getByText("Complete Warehouse safety orientation first"),
    ).toBeInTheDocument();
  });

  it("blocks unmet prerequisites and labels retryable work accurately", () => {
    renderCenter({
      snapshot: {
        ...snapshot,
        progress: snapshot.progress.map((item) =>
          item.requirementId === "orientation"
            ? { ...item, state: "not_started" as const }
            : item.requirementId === "receiving"
              ? { ...item, state: "failed_retryable" as const }
              : item,
        ),
      },
    });

    expect(
      screen.getByRole("button", {
        name: "Try again Receive and inspect a serialized device",
      }),
    ).toBeDisabled();
    expect(screen.getByText("Complete Warehouse safety orientation first")).toBeInTheDocument();
  });

  it("does not offer an expired requirement as the next action", () => {
    renderCenter({
      snapshot: {
        ...snapshot,
        progress: snapshot.progress.map((item) =>
          item.requirementId === "receiving"
            ? { ...item, state: "expired" as const }
            : item,
        ),
      },
    });

    expect(
      screen.getByRole("button", {
        name: "Expired Receive and inspect a serialized device",
      }),
    ).toBeDisabled();
    expect(screen.getByText("Ask your manager to reassign this step")).toBeInTheDocument();
  });

  it("shows certification evidence and a retryable stale-data warning", () => {
    renderCenter({ stale: true, error: "Learning service unavailable" });

    expect(screen.getByText("Certification active")).toBeInTheDocument();
    expect(screen.getByText("Learning status may be out of date")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh status" })).toBeInTheDocument();
  });

  it("keeps expired certification evidence visible with a clear recovery state", () => {
    renderCenter({
      snapshot: {
        ...snapshot,
        certifications: [
          {
            ...snapshot.certifications[0]!,
            id: "cert-expired",
            expiresAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    });

    expect(screen.getByText("Certification expired")).toBeInTheDocument();
    expect(screen.getByText("Expired Jan 1, 2026")).toBeInTheDocument();
  });

  it("directs a user with no assignments instead of leaving a dead end", () => {
    renderCenter({
      snapshot: {
        curricula: [],
        progress: [],
        certifications: [],
        lockedCapabilities: [],
        refreshedAt: "2026-08-13T10:00:00.000Z",
      },
    });

    expect(screen.getByText("No onboarding assigned yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Knowledge Base" })).toHaveAttribute(
      "href",
      "/knowledge",
    );
  });

  it("distinguishes an initial service failure from an empty assignment", () => {
    renderCenter({
      snapshot: null,
      error: "Learning service unavailable",
      refresh: vi.fn(),
    });

    expect(screen.getByText("Onboarding unavailable")).toBeInTheDocument();
    expect(screen.getByText("Learning service unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("No onboarding assigned yet")).not.toBeInTheDocument();
  });

  it("shows a stable loading state", () => {
    renderCenter({ snapshot: null, loading: true });
    expect(screen.getByText("Loading your onboarding")).toBeInTheDocument();
  });

  it("hands vendor users to the isolated vendor onboarding route", () => {
    session.profile.kind = "vendor";
    renderCenter();
    expect(
      screen.getByRole("link", { name: "Continue to vendor onboarding" }),
    ).toHaveAttribute("href", "/vendor/onboarding");
    session.profile.kind = "employee";
  });

  it("renders the assigned vendor curriculum inside the isolated vendor workspace", () => {
    session.profile.kind = "vendor";
    render(
      <LearningContext.Provider
        value={value({
          snapshot: {
            ...snapshot,
            curricula: snapshot.curricula.map((effective) => ({
              ...effective,
              curriculum: {
                ...effective.curriculum,
                audience: "vendor",
              },
            })),
          },
        })}
      >
        <OnboardingCenter audience="vendor" />
      </LearningContext.Provider>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Vendor onboarding" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Continue to vendor onboarding" }),
    ).not.toBeInTheDocument();
    session.profile.kind = "employee";
  });

  it("does not render vendor onboarding content to an employee session", () => {
    session.profile.kind = "employee";
    render(
      <LearningContext.Provider value={value()}>
        <OnboardingCenter audience="vendor" />
      </LearningContext.Provider>,
    );

    expect(screen.getByText("Vendor onboarding unavailable")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.queryByText("Vendor Representative")).not.toBeInTheDocument();
  });
});

describe("OnboardingStatusBand", () => {
  it("summarizes readiness without presenting onboarding as an app module", () => {
    render(
      <LearningContext.Provider value={value()}>
        <OnboardingStatusBand />
      </LearningContext.Provider>,
    );

    expect(
      screen.getByRole("region", { name: "Role readiness" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 of 3 required steps complete")).toBeInTheDocument();
    expect(
      screen.getByText("Receive and inspect a serialized device"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue onboarding" })).toHaveAttribute(
      "href",
      "/onboarding",
    );
  });

  it("does not manufacture a completion state while assignments are unavailable", () => {
    render(
      <LearningContext.Provider value={value({ snapshot: null, loading: true })}>
        <OnboardingStatusBand />
      </LearningContext.Provider>,
    );

    expect(screen.getByText("Checking role readiness")).toBeInTheDocument();
    expect(screen.queryByText(/complete/i)).not.toBeInTheDocument();
  });

  it("shows a retryable service error instead of claiming no learning is assigned", () => {
    const refresh = vi.fn();
    render(
      <LearningContext.Provider
        value={value({
          snapshot: null,
          error: "Learning service unavailable",
          refresh,
        })}
      >
        <OnboardingStatusBand />
      </LearningContext.Provider>,
    );

    expect(screen.getByText("Role readiness unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No required learning assigned")).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Retry" }).click();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("exposes numeric progress semantics to assistive technology", () => {
    render(
      <LearningContext.Provider value={value()}>
        <OnboardingStatusBand />
      </LearningContext.Provider>,
    );

    expect(screen.getByRole("progressbar", { name: "Role readiness progress" })).toHaveAttribute(
      "aria-valuenow",
      "33",
    );
  });
});
