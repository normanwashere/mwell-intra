import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningSnapshot } from "./types";
import { MODULES } from "@intra/rbac";
import type { UserRoles } from "@intra/rbac";
import { ROLE_CURRICULA } from "./catalog";
import { OnboardingCenter } from "./OnboardingCenter";
import { OnboardingStatusBand } from "./OnboardingStatusBand";
import { OPERATING_PERSONAS } from "./personas";
import { LearningContext, type LearningContextValue } from "./LearningProvider";
import {
  clearTrainingAdaptersForTests,
  registerTrainingAdapter,
} from "./training/registry";

const push = vi.fn();
const prefetch = vi.fn();
let searchParams = new URLSearchParams();
let sessionProfileMissing = false;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, prefetch }),
  useSearchParams: () => searchParams,
}));

const session = {
  loading: false,
  userRoles: { warehouse: ["operations"] } as Partial<UserRoles>,
  profile: {
    id: "learner-1",
    email: "operator@mwell.test",
    kind: "employee" as "employee" | "vendor",
    name: "Test account",
  },
};

vi.mock("@intra/auth", async () => {
  const actual =
    await vi.importActual<typeof import("@intra/auth")>("@intra/auth");
  return { ...actual, useSession: () => ({
    ...session,
    profile: sessionProfileMissing ? undefined : session.profile,
  }) };
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

function value(
  overrides: Partial<LearningContextValue> = {},
): LearningContextValue {
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
    evaluateTrainingChoice: vi.fn(),
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
  it('shows the next requirement only once, alongside its task and remaining count', () => {
    renderCenter();
    expect(screen.getAllByText('Receive and inspect a serialized device').filter(item => !item.classList.contains('sr-only'))).toHaveLength(1);
    expect(screen.getByText('Required for: Warehouse / Receive Stock')).toBeInTheDocument();
    expect(screen.getByText('2 requirements remaining')).toBeInTheDocument();
  });

  it('separates the shell job persona from assigned modules and scoped action roles', () => {
    render(<LearningContext.Provider value={value()}><OnboardingCenter jobPersona="Operations Associate" /></LearningContext.Provider>);
    expect(screen.getByText('Job persona').nextElementSibling?.textContent).toBe('Operations Associate');
    expect(screen.getByText('Assigned modules').nextElementSibling?.textContent).toBe('Warehouse');
    expect(screen.getByRole('heading', { name: 'Required learning' })).toBeInTheDocument();
    expect(screen.getByText('Warehouse / eCommerce / Operations').closest('details')).not.toHaveAttribute('open');
  });
  it('names the eligible operational task for the next requirement', () => {
    render(<LearningContext.Provider value={value()}><OnboardingCenter availableTasks={[{ id: 'receive', title: 'Receive delivery', outcome: 'Inspect received units', actionCapabilities: [{ module: 'warehouse', capability: 'receive_stock' }] }]} /></LearningContext.Provider>);
    expect(screen.getByText('Required for: Receive delivery')).toBeInTheDocument();
  });
  it("collapses shared completed history while retaining version and completion evidence", () => {
    const { container } = renderCenter();
    const history = screen.queryByText('Completed learning history')?.closest('details');
    expect(history).toBeDefined();
    expect(history).not.toHaveAttribute('open');
    expect(within(history!).getAllByText('Warehouse safety orientation')).toHaveLength(1);
    fireEvent.click(within(history!).getByText('Completed learning history'));
    expect(history).toHaveAttribute('open');
    expect(history?.textContent).toContain('Version 1');
    expect(history?.querySelector('time')?.getAttribute('dateTime')).toBe('2026-08-12T09:00:00.000Z');
    expect(container.querySelectorAll('[data-next-requirement]')).toHaveLength(1);
    expect(screen.getByText('2 requirements remaining')).toBeInTheDocument();
  });

  it("keeps complete readiness compact without a progress panel or preparation CTA", () => {
    render(<LearningContext.Provider value={value({ snapshot: { ...snapshot, lockedCapabilities: [], progress: snapshot.progress.map(item => ({ ...item, state: 'passed' })) } })}><OnboardingStatusBand /></LearningContext.Provider>);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View learning history/ })).toHaveAttribute('href', '/onboarding');
    expect(screen.getByText(/3 of 3 required steps complete/)).toBeInTheDocument();
  });

  it("opens a completed requirement deep link inside history", () => {
    Element.prototype.scrollIntoView = vi.fn();
    searchParams = new URLSearchParams('requirement=orientation');
    renderCenter();
    const history = screen.queryByText('Completed learning history')?.closest('details');
    expect(history).toHaveAttribute('open');
    expect(history?.querySelector('[aria-current="step"]')?.id).toBe('onboarding-requirement-orientation');
  });

  it("puts the next required action before the optional workspace return", () => {
    renderCenter();
    expect(
      screen.getByText("Next required action").compareDocumentPosition(
        screen.getByText("Workspace access"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Continue to My Work" })).toBeInTheDocument();
  });
  it("keeps action text compact while retaining the full accessible requirement name", () => {
    renderCenter();
    const action = screen.getByRole("button", { name: "Resume Receive and inspect a serialized device" });
    expect(action.querySelector('.sr-only')?.textContent?.trim()).toBe('Receive and inspect a serialized device');
    expect(action.textContent).toContain('Resume');
  });
  it("prioritizes task learning and retains the complete mandatory checklist", () => {
    const task = {
      id: "receive",
      title: "Receive delivery",
      outcome: "Inspect and record the received units",
      actionCapabilities: [
        { module: "warehouse" as const, capability: "receive_stock" },
      ],
    };
    render(
      <LearningContext.Provider value={value()}>
        <OnboardingCenter selectedTask={task} />
      </LearningContext.Provider>,
    );
    expect(screen.getByText(task.outcome)).toBeInTheDocument();
    expect(
      screen
        .getByRole("region", { name: "Task learning" })
        .compareDocumentPosition(
          screen.getByText("All assigned mandatory learning"),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByText("1 of 3 required steps complete"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Needed for this task" }),
    ).toBeInTheDocument();
    const all = screen.getByText("All assigned learning").closest("details")!;
    expect(all).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("All assigned learning"));
    expect(
      screen.getByRole("heading", { name: "Required learning" }),
    ).toBeInTheDocument();
  });

  it("fails closed for stale task learning without losing the return destination", () => {
    searchParams = new URLSearchParams("next=%2Fwarehouse");
    render(
      <LearningContext.Provider value={value({ stale: true })}>
        <OnboardingCenter
          selectedTask={{
            id: "receive",
            title: "Receive delivery",
            outcome: "Inspect units",
            actionCapabilities: [
              { module: "warehouse", capability: "receive_stock" },
            ],
          }}
        />
      </LearningContext.Provider>,
    );
    expect(
      screen.getByText(/Task learning readiness is unavailable/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Continue to Warehouse" }),
    ).toHaveAttribute("href", "/warehouse");
    fireEvent.click(screen.getByText("All assigned learning"));
    expect(
      screen.getByRole("button", {
        name: "Resume Receive and inspect a serialized device",
      }),
    ).toBeDisabled();
  });
  it.each([false, true])(
    "labels contributor scope, not its product-owner training persona (published=%s)",
    (published) => {
      session.userRoles = { product: ["contributor"] };
      const curriculum = ROLE_CURRICULA.find(
        (item) => item.module === "product" && item.role === "contributor",
      )!;
      const orientation = {
        ...snapshot.curricula[0]!.requirements[0]!,
        title: "Role orientation",
      };
      renderCenter({
        snapshot: {
          ...snapshot,
          progress: [],
          curricula: [
            {
              source: "role",
              curriculum: {
                ...curriculum,
                id: published
                  ? "internal.role.product.contributor.capability-practice.v1.curriculum"
                  : curriculum.id,
              },
              requirements: [orientation],
            },
          ],
        },
      });
      expect(
        screen.getByText("Product / Product Contributor", {
          selector: ".chip",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getAllByText("Assigned to: Product / Product Contributor"),
      ).toHaveLength(1);
      expect(screen.queryByText("Product Owner")).not.toBeInTheDocument();
      session.userRoles = { warehouse: ["operations"] };
    },
  );

  it("shows the vendor account name without ellipsis in the onboarding header", () => {
    session.profile.kind = "vendor";
    session.profile.name = "Long Vendor Company / Authorized Representative";
    session.userRoles = { core: ["vendor_portal"] };
    const base = snapshot.curricula[0]!;
    render(
      <LearningContext.Provider
        value={value({
          snapshot: {
            ...snapshot,
            curricula: [
              {
                ...base,
                curriculum: { ...base.curriculum, audience: "vendor" },
                requirements: base.requirements.map((item) => ({
                  ...item,
                  audience: "vendor",
                })),
              },
            ],
          },
        })}
      >
        <OnboardingCenter audience="vendor" />
      </LearningContext.Provider>,
    );
    expect(screen.getByText(session.profile.name)).toHaveClass("break-words");
    expect(screen.getByText(session.profile.name)).not.toHaveClass("truncate");
    session.profile.kind = "employee";
    session.profile.name = "Test account";
    session.userRoles = { warehouse: ["operations"] };
  });

  beforeEach(() => {
    session.loading = false;
    sessionProfileMissing = false;
    push.mockClear();
    prefetch.mockClear();
    searchParams = new URLSearchParams();
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

    expect(
      screen.getByRole("button", {
        name: "Resume Receive and inspect a serialized device",
      }),
    ).toBeDisabled();
    expect(
      screen.getAllByText("Guided practice is being prepared").length,
    ).toBeGreaterThan(0);
  });

  it("prioritizes the next action and deduplicates shared multi-role requirements", () => {
    renderCenter();

    expect(
      screen.getByRole("heading", { level: 1, name: "Role onboarding" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Warehouse / eCommerce / Operations"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 of 3 required steps complete"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Resume Receive and inspect a serialized device",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Warehouse safety orientation")).toHaveLength(1);
    expect(screen.getByText("Retraining required")).toBeInTheDocument();
    expect(screen.getByText("Emergency access may be requested. Approval is required.")).toBeInTheDocument();
    expect(screen.queryByText("Temporary emergency access")).not.toBeInTheDocument();
    expect(screen.getByText("Needs support")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Read recovery guidance" }),
    ).toHaveAttribute("href", "/knowledge?article=trouble-access-denied");
  });

  it("does not offer emergency access when the learner is not eligible to request it", () => {
    renderCenter({
      snapshot: {
        ...snapshot,
        lockedCapabilities: snapshot.lockedCapabilities.map((lock) => ({
          ...lock,
          canRequestEmergencyException: false,
        })),
      },
    });
    expect(screen.getByText("Retraining required")).toBeInTheDocument();
    expect(screen.queryByText("Emergency access may be requested. Approval is required.")).not.toBeInTheDocument();
  });

  it("keeps same-title orientations independent across personas", () => {
    const equivalentOrientation = {
      ...snapshot.curricula[0]!.requirements[0]!,
      id: "product-owner-orientation",
    };
    const productPractice = {
      ...snapshot.curricula[0]!.requirements[1]!,
      id: "product-owner-practice",
      title: "Product Owner guided practice",
      prerequisiteIds: [equivalentOrientation.id],
      simulationId: "internal.product_owner.guided-practice.v1",
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
    ).toHaveLength(2);
    expect(
      screen.getByRole("button", {
        name: "Start Product Owner guided practice",
      }),
    ).toBeDisabled();
  });

  it("identifies the next generic orientation's persona without changing its button name", () => {
    const base = snapshot.curricula[0]!;
    const curricula = ["general_employee", "finance_controller"].map(
      (personaId) => ({
        ...base,
        curriculum: {
          ...base.curriculum,
          id:
            personaId === "general_employee"
              ? "internal.role.warehouse.business_unit.v1"
              : "internal.role.warehouse.finance.v1",
          personaId,
        },
        requirements: [
          {
            ...base.requirements[0]!,
            id: `${personaId}-orientation`,
            title: "Role orientation",
          },
        ],
      }),
    );
    const resume = vi.fn();
    renderCenter({
      resume,
      snapshot: { ...snapshot, curricula, progress: curricula.map((item) => ({
        ...snapshot.progress[0]!,
        assignmentRequirementId: `ar-${item.curriculum.personaId}`,
        requirementId: item.requirements[0]!.id,
        state: "not_started",
        attemptCount: 0,
        completedAt: undefined,
      })) },
    });
    const nextSection = screen.getByText("Next required action").parentElement!;
    expect(
      within(nextSection).getByText("Assigned to: Warehouse / Business Unit"),
    ).toBeInTheDocument();
    expect(
      within(nextSection).queryByText(
        "Assigned to: Warehouse / Finance Manager",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Assigned to: Warehouse / Finance Manager"),
    ).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", {
      name: "Start Role orientation",
    });
    buttons[0]!.click();
    expect(resume).toHaveBeenCalledWith("general_employee-orientation", "ar-general_employee");
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
    expect(
      screen.getByText("Complete Warehouse safety orientation first"),
    ).toBeInTheDocument();
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
    expect(
      screen.getByText("Ask your manager to reassign this step"),
    ).toBeInTheDocument();
  });

  it("shows certification evidence and a retryable stale-data warning", () => {
    renderCenter({ stale: true, error: "Learning service unavailable" });

    expect(screen.getByText("Certification active")).toBeInTheDocument();
    expect(
      screen.getByText("Learning status may be out of date"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Refresh status" }),
    ).toBeInTheDocument();
  });

  it.each(["passed", "waived"] as const)("does not promise a first certificate after 4/4 required steps are %s", (state) => {
    const requirements = Array.from({ length: 4 }, (_, index) => ({
      ...snapshot.curricula[0]!.requirements[0]!,
      id: `leadership-step-${index}`,
      title: `Leadership step ${index + 1}`,
    }));
    const completedSnapshot: LearningSnapshot = {
      ...snapshot,
      curricula: [{ ...snapshot.curricula[0]!, requirements,
        curriculum: { ...snapshot.curricula[0]!.curriculum, requirementIds: requirements.map(item => item.id) } }],
      progress: requirements.map(item => ({ ...snapshot.progress[0]!,
        requirementId: item.id, assignmentRequirementId: `ar-${item.id}`, state })),
      certifications: [],
      lockedCapabilities: [],
    };
    const before = JSON.stringify(completedSnapshot);
    renderCenter({ snapshot: completedSnapshot });
    expect(screen.getByText("4 of 4 required steps complete")).toBeInTheDocument();
    expect(screen.getByText("No certifications have been recorded. Your required learning is complete; existing permissions still apply.")).toBeInTheDocument();
    expect(screen.queryByText(/Complete your first capability path/)).not.toBeInTheDocument();
    expect(screen.queryByText("Certification active")).not.toBeInTheDocument();
    expect(JSON.stringify(completedSnapshot)).toBe(before);
  });

  it("points incomplete learners to remaining requirements without promising certification", () => {
    renderCenter({ snapshot: { ...snapshot, certifications: [] } });
    expect(screen.getByText("1 of 3 required steps complete")).toBeInTheDocument();
    expect(screen.getByText("No certifications have been recorded. Check your remaining required learning above.")).toBeInTheDocument();
    expect(screen.queryByText(/Your required learning is complete/)).not.toBeInTheDocument();
  });

  it("does not imply optional-only assignments are required to earn a certificate", () => {
    renderCenter({ snapshot: { ...snapshot, certifications: [],
      curricula: snapshot.curricula.map(item => ({ ...item,
        requirements: item.requirements.map(requirement => ({ ...requirement, mandatory: false })) })) } });
    expect(screen.getByText("No certifications have been recorded. No required learning is currently assigned.")).toBeInTheDocument();
    expect(screen.queryByText(/Your required learning is complete/)).not.toBeInTheDocument();
  });

  it("preserves the no-assignment view without claiming certification or completion", () => {
    renderCenter({ snapshot: { ...snapshot, curricula: [], progress: [], certifications: [], lockedCapabilities: [] } });
    expect(screen.getByRole("heading", { name: "No onboarding assigned yet" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Certifications" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Complete your first capability path/)).not.toBeInTheDocument();
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

  it("distinguishes certification modules and roles without merging grants", () => {
    const certifications = [
      { module: "legal" as const, role: "legal_reviewer" },
      { module: "legal" as const, role: "compliance" },
      { module: "core" as const, role: "platform_admin" },
      { module: "legal" as const, role: "legal_reviewer" },
    ].map(({ module, role }, index) => ({
      ...snapshot.certifications[0]!,
      id: `cert-scope-${index}`,
      sourceRoleAssignmentId: `assignment-${index}`,
      capability: { module, capability: "manage_documents" },
      curriculumId: `internal.role.${module}.${role}.capability-practice.v1.curriculum`,
    }));
    renderCenter({ snapshot: { ...snapshot, certifications } });

    expect(screen.getAllByText("Certification active")).toHaveLength(4);
    expect(screen.getAllByText("Manage Documents")).toHaveLength(4);
    const rows = screen
      .getAllByText("Manage Documents")
      .map((label) => within(label.closest("li")!));
    expect(rows[0]!.getByText("Legal / Legal Reviewer")).toBeInTheDocument();
    expect(rows[1]!.getByText("Legal / Compliance")).toBeInTheDocument();
    expect(
      rows[2]!.getByText("Core / Platform Administrator"),
    ).toBeInTheDocument();
    expect(rows[3]!.getByText("Legal / Legal Reviewer")).toBeInTheDocument();
    for (const row of rows)
      expect(row.getByText("Valid until Aug 12, 2027")).toBeInTheDocument();
  });

  it.each([
    ["core", "platform_admin"],
    ["events", "admin"],
    ["events", "coordinator"],
    ["events", "finance_reviewer"],
    ["events", "requester"],
    ["legal", "admin"],
    ["legal", "compliance"],
    ["legal", "legal_reviewer"],
    ["procurement", "admin"],
    ["procurement", "approver"],
    ["procurement", "finance"],
    ["procurement", "procurement_officer"],
    ["procurement", "requester"],
    ["product", "contributor"],
    ["product", "operations_partner"],
    ["product", "product_owner"],
    ["warehouse", "business_unit"],
    ["warehouse", "finance"],
    ["warehouse", "logistics_supervisor"],
    ["warehouse", "marketing"],
    ["warehouse", "operations"],
    ["warehouse", "procurement"],
    ["warehouse", "warehouse_supervisor"],
    ["core", "vendor_portal"],
  ] as const)(
    "labels provisioned v1 %s / %s certificates using canonical roles",
    (module, role) => {
      const audience = role === "vendor_portal" ? "vendor" : "internal";
      renderCenter({
        snapshot: {
          ...snapshot,
          certifications: [
            {
              ...snapshot.certifications[0]!,
              curriculumId: `${audience}.role.${module}.${role}.capability-practice.v1.curriculum`,
              curriculumVersion: 1,
              capability: { module, capability: "manage_documents" },
            },
          ],
        },
      });
      const definition = MODULES[module];
      const roleLabel = Object.entries(definition.roles).find(
        ([key]) => key === role,
      )![1].label;
      expect(
        screen.getByText(`${definition.label} / ${roleLabel}`, {
          selector: "p.break-words",
        }),
      ).toBeInTheDocument();
      expect(screen.getAllByText("Certification active")).toHaveLength(1);
    },
  );

  it.each([
    { revokedAt: "2026-01-01T00:00:00.000Z", status: "revoked" },
    { supersededAt: "2026-01-01T00:00:00.000Z", status: "superseded" },
    { expiresAt: "2026-01-01T00:00:00.000Z", status: "expired" },
  ])(
    "retains $status certification status with readable role context",
    ({ status, ...dates }) => {
      renderCenter({
        snapshot: {
          ...snapshot,
          certifications: [
            {
              ...snapshot.certifications[0]!,
              capability: { module: "legal", capability: "manage_documents" },
              curriculumId:
                "internal.role.legal.compliance.capability-practice.v1.curriculum",
              ...dates,
            },
          ],
        },
      });
      expect(screen.getByText(`Certification ${status}`)).toBeInTheDocument();
      expect(screen.getByText("Legal / Compliance")).toBeInTheDocument();
      expect(
        screen.queryByText("Certification active"),
      ).not.toBeInTheDocument();
    },
  );

  it.each([
    [
      "internal.role.warehouse.warehouse_admin.capability-practice.v1.curriculum",
      1,
      "warehouse",
      "Warehouse / Warehouse Administrator",
    ],
    [
      "internal.role.warehouse.warehouse_admin.capability-practice.v1.curriculum",
      2,
      "warehouse",
      "Warehouse / Role context unavailable",
    ],
    [
      "vendor.role.warehouse.warehouse_admin.capability-practice.v1.curriculum",
      1,
      "warehouse",
      "Warehouse / Role context unavailable",
    ],
    [
      "internal.role.warehouse.warehouse_admin.capability-practice.v1.curriculum",
      1,
      "legal",
      "Legal / Role context unavailable",
    ],
    [
      "internal.role.warehouse.marketing.capability-practice.v1.curriculum",
      1,
      "warehouse",
      "Warehouse / Marketing",
    ],
    [
      "internal.role.warehouse.marketing.capability-practice.v1.curriculum",
      2,
      "warehouse",
      "Warehouse / Marketing",
    ],
    [
      "internal.warehouse.warehouse_operator.receiving-certification.v1",
      1,
      "warehouse",
      "Warehouse / Warehouse Operator",
    ],
    [
      "internal.warehouse.warehouse_operator.receiving-certification.v1",
      2,
      "warehouse",
      "Warehouse / Warehouse Operator",
    ],
    [
      "internal.warehouse.warehouse_operator.receiving-certification.v1",
      3,
      "warehouse",
      "Warehouse / Role context unavailable",
    ],
    [
      "vendor.role.core.vendor_portal.capability-practice.v1.curriculum",
      1,
      "core",
      "Core / Vendor Portal User",
    ],
    ["internal.role.legal.compliance.v1", 1, "legal", "Legal / Compliance"],
    ["vendor.role.core.vendor_portal.capability-practice.v1.curriculum", 3, "core", "Core / Role context unavailable"],
    ["internal.role.core.vendor_portal.capability-practice.v1.curriculum", 2, "core", "Core / Role context unavailable"],
    ["vendor.role.core.platform_admin.capability-practice.v1.curriculum", 2, "core", "Core / Role context unavailable"],
    ["vendor.role.core.vendor_portal.capability-practice.v1.curriculum", 2, "procurement", "Procurement / Role context unavailable"],
    ["vendor.role.core.vendor_portal.evidence-review.v2.curriculum", 2, "core", "Core / Role context unavailable"],
    [
      "internal.role.legal.compliance.capability-practice.v1.curriculum",
      2,
      "legal",
      "Legal / Role context unavailable",
    ],
    [
      "internal.role.warehouse.marketing.capability-practice.v1.curriculum",
      3,
      "warehouse",
      "Warehouse / Role context unavailable",
    ],
    [
      "internal.role.legal.compliance.capability-practice.v1.curriculum",
      1,
      "warehouse",
      "Warehouse / Role context unavailable",
    ],
  ] as const)(
    "resolves only verified curriculum identity %s version %s in %s",
    (curriculumId, curriculumVersion, module, label) => {
      renderCenter({
        snapshot: {
          ...snapshot,
          certifications: [
            {
              ...snapshot.certifications[0]!,
              curriculumId,
              curriculumVersion,
              capability: { module, capability: "manage_documents" },
            },
          ],
        },
      });
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText("Certification active")).toBeInTheDocument();
    },
  );

  it.each([
    ["admin", 1, "Procurement Admin"],
    ["admin", 2, "Procurement Admin"],
    ["finance", 1, "Finance"],
    ["finance", 2, "Finance"],
  ] as const)("labels the verified Procurement %s v%s payment assignment and certificate without changing readiness", (role, version, label) => {
    const curriculumId = `internal.role.procurement.${role}.capability-practice.v1.curriculum`;
    const requirement = {
      ...snapshot.curricula[0]!.requirements[1]!,
      id: "payment-review-only",
      title: "Review current payment pack independently",
      prerequisiteIds: [],
      capabilityOutcomes: [{ module: "procurement" as const, capability: "review_payment_readiness" }],
    };
    const observed: LearningSnapshot = {
      ...snapshot,
      curricula: [{
        ...snapshot.curricula[0]!,
        curriculum: { ...snapshot.curricula[0]!.curriculum, id: curriculumId, version, requirementIds: [requirement.id] },
        requirements: [requirement],
      }],
      progress: [{ ...snapshot.progress[0]!, requirementId: requirement.id }],
      certifications: [{ ...snapshot.certifications[0]!, curriculumId, curriculumVersion: version,
        capability: { module: "procurement", capability: "review_payment_readiness" } }],
      lockedCapabilities: [],
    };
    const before = structuredClone(observed);
    const resume = vi.fn(), refreshAccess = vi.fn(), isLiveCapability = vi.fn().mockReturnValue(false);
    renderCenter({ snapshot: observed, resume, refreshAccess, isLiveCapability });
    expect(screen.getByText(`Assigned to: Procurement / ${label}`)).toBeInTheDocument();
    expect(screen.getByText(`Procurement / ${label}`, { selector: "p.break-words" })).toBeInTheDocument();
    expect(screen.getByText("Review Payment Readiness")).toBeInTheDocument();
    expect(screen.getByText("Certification active")).toBeInTheDocument();
    expect(observed).toEqual(before);
    expect(resume).not.toHaveBeenCalled();
    expect(refreshAccess).not.toHaveBeenCalled();
  });

  it.each([
    ["internal.role.procurement.admin.capability-practice.v1.curriculum", 3, "procurement"],
    ["internal.role.procurement.procurement_officer.capability-practice.v1.curriculum", 2, "procurement"],
    ["vendor.role.procurement.admin.capability-practice.v1.curriculum", 2, "procurement"],
    ["internal.role.procurement.admin.capability-practice.v1.curriculum", 2, "warehouse"],
    ["internal.role.procurement.admin.payment-readiness.v2.curriculum", 2, "procurement"],
    ["internal.role.procurement.finance.capability-practice.v1.curriculum", 3, "procurement"],
    ["vendor.role.procurement.finance.capability-practice.v1.curriculum", 2, "procurement"],
    ["internal.role.procurement.finance.capability-practice.v1.curriculum", 2, "warehouse"],
    ["internal.role.procurement.finance.payment-readiness.v2.curriculum", 2, "procurement"],
    ["internal.role.procurement.approver.capability-practice.v1.curriculum", 2, "procurement"],
  ] as const)("does not infer a payment role from unverified %s v%s in %s", (curriculumId, curriculumVersion, module) => {
    renderCenter({ snapshot: { ...snapshot, certifications: [{ ...snapshot.certifications[0]!,
      curriculumId, curriculumVersion, capability: { module, capability: "review_payment_readiness" } }] } });
    expect(screen.getByText(`${MODULES[module].label} / Role context unavailable`)).toBeInTheDocument();
    expect(screen.getByText("Certification active")).toBeInTheDocument();
  });

  it.each([1, 2])("labels the exact published Vendor Portal v%s assignment and certificate without changing readiness", (version) => {
    const curriculumId = "vendor.role.core.vendor_portal.capability-practice.v1.curriculum";
    const requirement = { ...snapshot.curricula[0]!.requirements[1]!, id: "vendor-evidence-review",
      audience: "vendor" as const, title: "Review vendor evidence", prerequisiteIds: [],
      capabilityOutcomes: [{ module: "core" as const, capability: "submit_accreditation" }] };
    const observed: LearningSnapshot = { ...snapshot,
      curricula: [{ ...snapshot.curricula[0]!, curriculum: { ...snapshot.curricula[0]!.curriculum,
        id: curriculumId, version, audience: "vendor", requirementIds: [requirement.id] }, requirements: [requirement] }],
      progress: [{ ...snapshot.progress[0]!, requirementId: requirement.id }],
      certifications: [{ ...snapshot.certifications[0]!, curriculumId, curriculumVersion: version,
        capability: { module: "core", capability: "submit_accreditation" } }], lockedCapabilities: [] };
    const before = structuredClone(observed);
    const context = value({ snapshot: observed });
    session.profile.kind = "vendor";
    try {
      render(<LearningContext.Provider value={context}><OnboardingCenter audience="vendor" /></LearningContext.Provider>);
      expect(screen.getByText("Assigned to: Core / Vendor Portal User")).toBeInTheDocument();
      expect(screen.getByText("Core / Vendor Portal User", { selector: "p.break-words" })).toBeInTheDocument();
      expect(screen.getByText("Certification active")).toBeInTheDocument();
      expect(observed).toEqual(before);
      expect(context.resume).not.toHaveBeenCalled();
      expect(context.refreshAccess).not.toHaveBeenCalled();
    } finally { session.profile.kind = "employee"; }
  });

  it("waits for a cold vendor session before deciding audience, then shows the existing learning placeholder", () => {
    session.loading = true;
    sessionProfileMissing = true;
    const context = value({ snapshot: null, loading: true });
    const { rerender } = render(<LearningContext.Provider value={context}><OnboardingCenter audience="vendor" /></LearningContext.Provider>);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Loading your onboarding").closest('[aria-live="polite"]')).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Role onboarding" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Continue to Vendor" })).not.toBeInTheDocument();
    session.loading = false;
    sessionProfileMissing = false;
    session.profile.kind = "vendor";
    try {
      rerender(<LearningContext.Provider value={context}><OnboardingCenter audience="vendor" /></LearningContext.Provider>);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getByText("Loading your onboarding")).toBeInTheDocument();
      expect(context.resume).not.toHaveBeenCalled();
      expect(context.refreshAccess).not.toHaveBeenCalled();
    } finally { session.profile.kind = "employee"; }
  });

  it.each([false, true])("denies settled non-vendor or failed missing-profile sessions even while learning loads (missing=%s)", (missing) => {
    sessionProfileMissing = missing;
    const context = value({ loading: true, error: missing ? "Session unavailable" : null });
    render(<LearningContext.Provider value={context}><OnboardingCenter audience="vendor" /></LearningContext.Provider>);
    expect(screen.getByRole("alert")).toHaveTextContent("Vendor onboarding unavailable");
    expect(screen.queryByText("Loading your onboarding")).not.toBeInTheDocument();
    expect(screen.queryByText("Certification active")).not.toBeInTheDocument();
    expect(context.resume).not.toHaveBeenCalled();
  });

  it("does not reveal stale learning while vendor session identity is pending, and stops loading after auth failure", () => {
    session.loading = true;
    sessionProfileMissing = true;
    const context = value();
    const { rerender } = render(<LearningContext.Provider value={context}><OnboardingCenter audience="vendor" /></LearningContext.Provider>);
    expect(screen.getByText("Loading your onboarding")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Certification active")).not.toBeInTheDocument();
    session.loading = false;
    rerender(<LearningContext.Provider value={context}><OnboardingCenter audience="vendor" /></LearningContext.Provider>);
    expect(screen.getByRole("alert")).toHaveTextContent("Vendor onboarding unavailable");
    expect(screen.queryByText("Loading your onboarding")).not.toBeInTheDocument();
    expect(screen.queryByText("Certification active")).not.toBeInTheDocument();
  });

  it("does not guess role or expose assignment IDs for an unknown curriculum", () => {
    const { container } = renderCenter({
      snapshot: {
        ...snapshot,
        certifications: [
          {
            ...snapshot.certifications[0]!,
            curriculumId: "unknown-private-curriculum-id",
            sourceRoleAssignmentId: "private-assignment-id",
            departmentId: "private-department-id",
          },
        ],
      },
    });
    expect(
      screen.getByText("Warehouse / Role context unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByText("Certification active")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/private-.*-id/);
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
    expect(
      screen.getByRole("link", { name: "Return to workspace" }),
    ).toHaveAttribute("href", "/work");
  });

  it("distinguishes an initial service failure from an empty assignment", () => {
    renderCenter({
      snapshot: null,
      error: "Learning service unavailable",
      refresh: vi.fn(),
    });

    expect(screen.getByText("Onboarding unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("Learning service unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No onboarding assigned yet"),
    ).not.toBeInTheDocument();
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
              requirements: effective.requirements.map((item) => ({
                ...item,
                audience: "vendor" as const,
              })),
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

    expect(
      screen.getByText("Vendor onboarding unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.queryByText("Vendor Representative")).not.toBeInTheDocument();
  });
});

describe("OnboardingStatusBand", () => {
  it.each([
    { snapshot: null, stale: false, error: null },
    {
      snapshot: { ...snapshot, curricula: [], lockedCapabilities: [] },
      stale: true,
      error: null,
    },
    { snapshot, stale: false, error: "Refresh failed" },
  ])(
    "does not claim readiness from missing or unconfirmed state %#",
    (state) => {
      const refresh = vi.fn();
      render(
        <LearningContext.Provider
          value={value({ ...state, loading: false, refresh })}
        >
          <OnboardingStatusBand />
        </LearningContext.Provider>,
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Role readiness unavailable",
      );
      expect(
        screen.queryByText(
          /No required learning|No actions are waiting|actions need learning/,
        ),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      screen.getByRole("button", { name: "Retry" }).click();
      expect(refresh).toHaveBeenCalledOnce();
    },
  );

  it("counts unique learning-locked actions, excluding role and service restrictions", () => {
    const lock = snapshot.lockedCapabilities[0]!;
    const locks = [
      lock,
      { ...lock, reason: "missing_certification" },
      {
        ...lock,
        capability: { module: "procurement", capability: "approve_request" },
        reason: "expired_certification",
      },
      {
        ...lock,
        capability: { module: "core", capability: "admin" },
        reason: "missing_role",
      },
      {
        ...lock,
        capability: { module: "core", capability: "manage_users" },
        reason: "unavailable",
      },
    ] as unknown as LearningSnapshot["lockedCapabilities"];
    render(
      <LearningContext.Provider
        value={value({ snapshot: { ...snapshot, lockedCapabilities: locks } })}
      >
        <OnboardingStatusBand />
      </LearningContext.Provider>,
    );
    expect(screen.getByText(/2 actions need learning/)).toBeInTheDocument();
  });

  it.each([
    [
      "/vendor/cases/case-1/application?tab=documents#declaration",
      "/vendor/cases/case-1/application?tab=documents#declaration",
    ],
    ["/vendor?tab=cases#active", "/vendor?tab=cases#active"],
    ["/procurement/requests/one", "/vendor"],
    ["/vendor/onboarding?next=bad#step", "/vendor"],
    ["/vendor/onboarding/step", "/vendor"],
    ["//external.test/vendor/cases", "/vendor"],
    ["/vendor/../admin", "/vendor"],
    ["/vendor/%2e%2e/admin", "/vendor"],
    ["/vendor/%2f..%2fadmin", "/vendor"],
  ])("bounds vendor return %s", (next, expected) => {
    session.profile.kind = "vendor";
    searchParams = new URLSearchParams({ next });
    render(
      <LearningContext.Provider
        value={value({ snapshot: { ...snapshot, curricula: [] } })}
      >
        <OnboardingCenter audience="vendor" />
      </LearningContext.Provider>,
    );
    expect(
      screen.getByRole("link", { name: "Return to workspace" }),
    ).toHaveAttribute("href", expected);
    session.profile.kind = "employee";
    searchParams = new URLSearchParams();
  });

  it.each(OPERATING_PERSONAS)(
    "uses the same unfinished checklist for $label",
    (persona) => {
      const audience =
        persona.id === "vendor_representative" ? "vendor" : "internal";
      session.profile.kind = audience === "vendor" ? "vendor" : "employee";
      searchParams = new URLSearchParams();
      const effective = snapshot.curricula[0]!;
      const assigned: LearningSnapshot = {
        ...snapshot,
        progress: [],
        curricula: [
          {
            ...effective,
            curriculum: {
              ...effective.curriculum,
              personaId: persona.id,
              audience,
            },
            requirements: effective.requirements.map((item) => ({
              ...item,
              audience,
            })),
          },
        ],
      };
      render(
        <LearningContext.Provider value={value({ snapshot: assigned })}>
          <OnboardingCenter audience={audience} />
          <OnboardingStatusBand />
        </LearningContext.Provider>,
      );
      expect(
        screen.queryByText(persona.label, { selector: ".chip" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("link", {
          name:
            audience === "vendor"
              ? "Continue to Vendor"
              : "Continue to My Work",
        }),
      ).toHaveAttribute("href", audience === "vendor" ? "/vendor" : "/work");
      expect(
        screen.getByRole("link", { name: "Continue onboarding" }),
      ).toHaveAttribute(
        "href",
        audience === "vendor" ? "/vendor/onboarding" : "/onboarding",
      );
      session.profile.kind = "employee";
    },
  );

  it("offers return before any learning is completed without resuming or granting credit", () => {
    searchParams = new URLSearchParams("next=%2Fprocurement");
    const resume = vi.fn();
    renderCenter({ resume, snapshot: { ...snapshot, progress: [] } });
    expect(
      screen.getByRole("link", { name: "Continue to Procurement" }),
    ).toHaveAttribute("href", "/procurement");
    expect(
      screen.getByText("0 of 3 required steps complete"),
    ).toBeInTheDocument();
    expect(resume).not.toHaveBeenCalled();
  });

  it("keeps authorized work available before orientation", () => {
    const firstTimeSnapshot: LearningSnapshot = {
      ...snapshot,
      progress: snapshot.progress.map((item) =>
        item.requirementId === "orientation"
          ? {
              ...item,
              state: "not_started",
              attemptCount: 0,
              completedAt: undefined,
            }
          : item,
      ),
    };
    render(
      <LearningContext.Provider value={value({ snapshot: firstTimeSnapshot })}>
        <OnboardingStatusBand />
      </LearningContext.Provider>,
    );

    expect(
      screen.getByText(/Other authorized work remains available/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("0 of 3 required steps complete"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Continue onboarding" }),
    ).toHaveAttribute("href", "/onboarding");
  });

  it("returns a user to the requested module after role orientation", () => {
    searchParams = new URLSearchParams("next=%2Fprocurement");
    renderCenter();

    expect(
      screen.getByRole("link", { name: "Continue to Procurement" }),
    ).toHaveAttribute("href", "/procurement");
    expect(
      screen.getByText("Existing permissions and action requirements still apply."),
    ).toBeInTheDocument();
  });

  it("summarizes readiness without presenting onboarding as an app module", () => {
    render(
      <LearningContext.Provider value={value()}>
        <OnboardingStatusBand />
      </LearningContext.Provider>,
    );

    expect(
      screen.getByRole("region", { name: "Role readiness" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 of 3 required steps complete"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Receive and inspect a serialized device"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Continue onboarding" }),
    ).toHaveAttribute("href", "/onboarding");
  });

  it("does not manufacture a completion state while assignments are unavailable", () => {
    render(
      <LearningContext.Provider
        value={value({ snapshot: null, loading: true })}
      >
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
    expect(
      screen.queryByText("No required learning assigned"),
    ).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Retry" }).click();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("exposes numeric progress semantics to assistive technology", () => {
    render(
      <LearningContext.Provider value={value()}>
        <OnboardingStatusBand />
      </LearningContext.Provider>,
    );

    expect(
      screen.getByRole("progressbar", { name: "Role readiness progress" }),
    ).toHaveAttribute("aria-valuenow", "33");
  });
});
