// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  LearningContext,
  type LearningContextValue,
} from "@intra/learning";
import { VendorPurchaseOrderAcknowledgements } from "./VendorPurchaseOrderAcknowledgements";

const auth = vi.hoisted(() => ({
  session: {
    mode: "supabase",
    userRoles: {},
    roleCapabilities: { core: ["submit_accreditation"] },
    profile: { id: "vendor-1", kind: "vendor", name: "Vendor One" },
    supabaseClient: { schema: vi.fn() },
    signOut: vi.fn(),
  },
}));
vi.mock("@intra/auth", () => ({ useSession: () => auth.session }));

const requirement = {
  id: "vendor-ack-readiness",
  version: 1,
  audience: "vendor" as const,
  kind: "orientation" as const,
  title: "Vendor submission and acknowledgement readiness",
  mandatory: true,
  prerequisiteIds: [],
  capabilityOutcomes: [],
};
const rpc = vi.fn();
const acknowledge = vi.fn();
let effective = true;
let root: Root;
let container: HTMLDivElement;
let po: ReturnType<typeof purchaseOrder>;
function purchaseOrder() {
  return {
    id: "po-1",
    poNumber: "PO-001",
    vendorName: "Vendor One",
    lines: [{ description: "Medical supplies", quantity: 2, unitPrice: 100 }],
    total: 200,
    documentHash: "hash-v3",
    lifecycle: { revision: 3, acknowledgementStatus: "pending" },
  };
}
function learning(): LearningContextValue {
  return {
    snapshot: {
      curricula: [
        {
          curriculum: {
            id: "vendor-path",
            version: 1,
            personaId: "vendor",
            audience: "vendor",
            requirementIds: [requirement.id],
          },
          requirements: [requirement],
          source: "role",
        },
      ],
      progress: [],
      certifications: [],
      lockedCapabilities: [],
      refreshedAt: "2026-09-06T00:00:00Z",
    },
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
    resume: vi.fn(),
    closeTraining: vi.fn(),
    closeActivity: vi.fn(),
    recordCheckpoint: vi.fn(),
    evaluateTrainingChoice: vi.fn(),
    submitAssessment: vi.fn(),
    acknowledgePolicy: vi.fn(),
    requestSupport: vi.fn(),
    isLiveCapability: (module, capability) =>
      module === "core" && capability === "submit_accreditation" && effective,
    lockedReason: () => ({
      capability: { module: "core", capability: "submit_accreditation" },
      reason: "missing_certification",
      requirementIds: [requirement.id],
      canRequestEmergencyException: false,
    }),
  };
}
async function render(withLearning = true) {
  await act(async () =>
    root.render(
      withLearning
        ? createElement(
            LearningContext.Provider,
            { value: learning() },
            createElement(VendorPurchaseOrderAcknowledgements),
          )
        : createElement(VendorPurchaseOrderAcknowledgements),
    ),
  );
}
function button(name: string) {
  return Array.from(container.querySelectorAll("button")).find(
    (item) => item.textContent === name,
  );
}
async function draft() {
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, " REF-001 ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const details = container.querySelector("details")!;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState({}, "", "/vendor/purchase-orders");
  effective = true;
  po = purchaseOrder();
  auth.session.roleCapabilities = { core: ["submit_accreditation"] };
  acknowledge.mockReset().mockResolvedValue({ data: null, error: null });
  rpc
    .mockReset()
    .mockImplementation((name, input) =>
      name === "acknowledge_purchase_order"
        ? acknowledge(input)
        : Promise.resolve({ data: [po], error: null }),
    );
  auth.session.supabaseClient.schema.mockReturnValue({ rpc });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("keeps PO read and reference draft through exact vendor requirement recovery", async () => {
  effective = false;
  await render();
  await draft();
  expect(container.textContent).toContain("Medical supplies");
  expect(container.textContent).toContain(requirement.title);
  expect(button("Acknowledge revision 3")).toBeUndefined();
  const recovery = Array.from(container.querySelectorAll("a")).find(
    (item) => item.textContent === "Resume onboarding",
  )!;
  expect(recovery.getAttribute("href")).toBe(
    "/vendor/onboarding?requirement=vendor-ack-readiness&next=%2Fvendor%2Fpurchase-orders",
  );
  expect(recovery.target).toBe("_blank");
  expect(acknowledge).not.toHaveBeenCalled();
  effective = true;
  await render();
  expect(container.querySelector("input")!.value).toBe(" REF-001 ");
  expect(container.querySelector("details")!.open).toBe(true);
  expect(button("Acknowledge revision 3")!.disabled).toBe(false);
});

it("fails closed without role authority or a learning snapshot, while retaining PO read", async () => {
  auth.session.roleCapabilities = { core: [] };
  await render();
  expect(container.textContent).toContain(
    "This action is not assigned to your role",
  );
  expect(container.querySelector("details")).not.toBeNull();
  auth.session.roleCapabilities = { core: ["submit_accreditation"] };
  await render(false);
  expect(container.textContent).toContain(
    "This action is temporarily unavailable",
  );
  expect(button("Acknowledge revision 3")).toBeUndefined();
  expect(acknowledge).not.toHaveBeenCalled();
});

it("retains read/hash/reference prerequisites and sends the unchanged revision-bound payload once", async () => {
  let finish!: (value: { data: null; error: null }) => void;
  acknowledge.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  expect(button("Acknowledge revision 3")!.disabled).toBe(true);
  await draft();
  const confirm = button("Acknowledge revision 3")!;
  await act(async () => {
    confirm.click();
    confirm.click();
  });
  expect(confirm.disabled).toBe(true);
  expect(acknowledge).toHaveBeenCalledExactlyOnceWith({
    payload: {
      purchase_order_id: "po-1",
      expected_revision: 3,
      document_hash: "hash-v3",
      acknowledgement_reference: "REF-001",
    },
  });
  await act(async () => finish({ data: null, error: null }));
});

it("shows server rejection and requires the refreshed revision to be reviewed without losing the reference", async () => {
  acknowledge.mockResolvedValue({
    data: null,
    error: { message: "Revision changed" },
  });
  await render();
  await draft();
  po = {
    ...po,
    documentHash: "hash-v4",
    lifecycle: { ...po.lifecycle, revision: 4 },
  };
  await act(async () => button("Acknowledge revision 3")!.click());
  expect(container.querySelector('[role="alert"]')!.textContent).toContain(
    "Revision changed. Review the refreshed purchase order before retrying.",
  );
  expect(container.querySelector("input")!.value).toBe(" REF-001 ");
  expect(button("Acknowledge revision 4")!.disabled).toBe(true);
  expect(acknowledge).toHaveBeenCalledTimes(1);
});
