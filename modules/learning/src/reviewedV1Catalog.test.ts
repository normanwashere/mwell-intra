import { afterEach, describe, expect, it, vi } from "vitest";
import * as rbac from "@intra/rbac";
import * as catalog from "./catalog";
import { SCOPED_READINESS_CANDIDATES } from "./scopedReadinessCandidates";
import { OPS_CUSTODY_CANDIDATES } from "./opsCustodyCandidates";
import { SupabaseLearningRepository } from "./repository";

const reviewedRoleOutcomes = [
  {
    module: "warehouse",
    role: "warehouse_operator",
    capabilities: [
      "receive_stock",
      "manage_inventory",
      "cycle_count",
      "manage_returns",
      "reserve_allocate",
      "issue_items",
      "transfer_stock",
      "inspect_quality",
    ],
  },
  {
    module: "warehouse",
    role: "warehouse_supervisor",
    capabilities: [
      "receive_stock",
      "manage_inventory",
      "manage_products",
      "manage_locations",
      "cycle_count",
      "manage_returns",
      "reserve_allocate",
      "issue_items",
      "transfer_stock",
      "manage_operation_routes",
      "inspect_quality",
      "release_quality_hold",
      "approve_stock_adjustment",
      "resolve_exceptions",
      "import_warehouse_data",
    ],
  },
  {
    module: "warehouse",
    role: "logistics_supervisor",
    capabilities: [
      "receive_stock",
      "manage_inventory",
      "manage_products",
      "manage_locations",
      "cycle_count",
      "manage_returns",
      "reserve_allocate",
      "issue_items",
      "transfer_stock",
      "manage_operation_routes",
      "inspect_quality",
      "release_quality_hold",
      "approve_stock_adjustment",
      "resolve_exceptions",
      "import_warehouse_data",
    ],
  },
  {
    module: "warehouse",
    role: "operations",
    capabilities: [
      "request_fulfillment",
      "request_stock",
      "submit_return_case",
    ],
  },
  {
    module: "warehouse",
    role: "finance",
    capabilities: ["manage_finance_close", "approve_stock_adjustment_finance"],
  },
  {
    module: "procurement",
    role: "procurement_officer",
    capabilities: [
      "create_request",
      "manage_rfp",
      "manage_request_collaborators",
      "cancel_request",
      "author_po",
      "manage_vendors",
      "approve_request",
    ],
  },
  {
    module: "procurement",
    role: "admin",
    capabilities: [
      "create_request",
      "manage_rfp",
      "manage_request_collaborators",
      "cancel_request",
      "author_po",
      "approve_request",
      "approve_award",
      "final_approve_po",
      "manage_vendors",
      "accept_payment_readiness",
      "review_payment_readiness",
      "release_payment",
      "admin",
    ],
  },
] as const;

const pending = [
  {
    module: "warehouse",
    role: "warehouse_operator",
    capability: "submit_return_case",
    status: "pending_versioned_review",
  },
  {
    module: "warehouse",
    role: "warehouse_supervisor",
    capability: "submit_return_case",
    status: "pending_versioned_review",
  },
  {
    module: "warehouse",
    role: "logistics_supervisor",
    capability: "submit_return_case",
    status: "pending_versioned_review",
  },
  {
    module: "warehouse",
    role: "operations",
    capability: "recommend_replenishment",
    status: "pending_versioned_review",
  },
  {
    module: "warehouse",
    role: "operations",
    capability: "register_exports",
    status: "pending_versioned_review",
  },
  {
    module: "warehouse",
    role: "finance",
    capability: "register_exports",
    status: "pending_versioned_review",
  },
  {
    module: "warehouse",
    role: "finance",
    capability: "review_exports",
    status: "pending_versioned_review",
  },
  {
    module: "warehouse",
    role: "bi_analyst",
    capability: "register_exports",
    status: "pending_versioned_review",
  },
  {
    module: "procurement",
    role: "procurement_officer",
    capability: "cancel_purchase_order",
    status: "pending_versioned_review",
  },
  {
    module: "procurement",
    role: "procurement_officer",
    capability: "manage_replenishment",
    status: "pending_versioned_review",
  },
  {
    module: "procurement",
    role: "admin",
    capability: "cancel_purchase_order",
    status: "pending_versioned_review",
  },
  {
    module: "procurement",
    role: "admin",
    capability: "manage_replenishment",
    status: "pending_versioned_review",
  },
] as const;

afterEach(() => {
  vi.doUnmock("@intra/rbac");
  vi.resetModules();
});

describe("pinned v1 source metadata boundary, not DB-published coverage", () => {
  it("keeps server outcomes authoritative even when the same v1 source requirement is broader", async () => {
    // Synthetic RPC fixture, not a saved live readback or publication assertion.
    const curriculum = catalog.roleCurriculumFor(
      "warehouse",
      "warehouse_operator",
    )!;
    const requirementId =
      "internal.role.warehouse.warehouse_operator.capability-practice.v1";
    const serverOutcome = { module: "warehouse", capability: "receive_stock" };
    const serverSnapshot = {
      curricula: [
        {
          curriculum,
          source: "role",
          requirements: catalog.LEARNING_CATALOG.requirements
            .filter((item) => curriculum.requirementIds.includes(item.id))
            .map((item) =>
              item.id === requirementId
                ? { ...item, capabilityOutcomes: [serverOutcome] }
                : item,
            ),
        },
      ],
      progress: [],
      certifications: [],
      lockedCapabilities: [],
      refreshedAt: "2026-09-14T00:00:00.000Z",
    };
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: serverSnapshot, error: null });
    const repository = new SupabaseLearningRepository({
      schema: () => ({ rpc }),
    });
    const snapshot = await repository.snapshot();
    expect(
      snapshot.curricula[0]?.requirements.find(
        (item) => item.id === requirementId,
      )?.capabilityOutcomes,
    ).toEqual([serverOutcome]);
    expect(
      catalog.LEARNING_CATALOG.requirements.find(
        (item) => item.id === requirementId,
      )?.capabilityOutcomes.length,
    ).toBeGreaterThan(1);
    expect(snapshot.certifications).toEqual([]);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("my_learning_snapshot");

    rpc.mockResolvedValue({
      data: { ...serverSnapshot, curricula: [] },
      error: null,
    });
    expect((await repository.snapshot()).curricula).toEqual([]);
    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "my_learning_snapshot",
      "my_learning_snapshot",
    ]);
  });

  it("retains the 54 reviewed requirements and 33 role curricula alongside the separate seller addition", () => {
    expect(catalog.LEARNING_CATALOG.requirements.filter(item => item.id !== "internal.role.events.seller.custody-practice.v1")).toHaveLength(54);
    expect(catalog.ROLE_CURRICULA.filter(item => item.id !== "internal.role.events.seller.v1")).toHaveLength(33);
    expect(catalog.LEARNING_CATALOG.requirements).toHaveLength(55);
    expect(catalog.ROLE_CURRICULA).toHaveLength(34);
    expect(
      catalog.LEARNING_CATALOG.requirements.every((item) => item.version === 1),
    ).toBe(true);
    expect(catalog.ROLE_CURRICULA.every((item) => item.version === 1)).toBe(
      true,
    );
  });

  it.each(reviewedRoleOutcomes)(
    "preserves $module:$role reviewed v1 outcomes",
    ({ module, role, capabilities }) => {
      const requirement = catalog.LEARNING_CATALOG.requirements.find(
        (item) =>
          item.id === `internal.role.${module}.${role}.capability-practice.v1`,
      );
      expect(requirement?.capabilityOutcomes).toEqual(
        capabilities.map((capability) => ({ module, capability })),
      );
    },
  );

  it("keeps BI Analyst on generic guided practice without a new export requirement", () => {
    expect(
      catalog.roleCurriculumFor("warehouse", "bi_analyst")?.requirementIds,
    ).toEqual([
      "internal.leadership_insights.orientation.v1",
      "internal.leadership_insights.guided-practice.v1",
    ]);
    expect(
      catalog.LEARNING_CATALOG.requirements.some(
        (item) =>
          item.id ===
          "internal.role.warehouse.bi_analyst.capability-practice.v1",
      ),
    ).toBe(false);
  });

  it("reports exactly the 12 unreviewed role outcomes as pending, not v1 training", () => {
    expect(catalog.PENDING_ROLE_TRAINING_COVERAGE).toEqual(pending);
    for (const item of pending) {
      expect(rbac.roleCapabilities).toContainEqual({
        module: item.module,
        role: item.role,
        cap: item.capability,
      });
      expect(rbac.requiresLiveCertification(item.module, item.capability)).toBe(
        true,
      );
      const ids = catalog.roleCurriculumFor(
        item.module,
        item.role,
      )!.requirementIds;
      expect(
        catalog.LEARNING_CATALOG.requirements
          .filter((r) => ids.includes(r.id))
          .flatMap((r) => r.capabilityOutcomes),
      ).not.toContainEqual({
        module: item.module,
        capability: item.capability,
      });
    }
  });

  it("does not assign pending work or candidates through default or coverage curricula", () => {
    for (const candidate of [
      ...SCOPED_READINESS_CANDIDATES,
      ...OPS_CUSTODY_CANDIDATES,
    ]) {
      expect(
        catalog.LEARNING_CATALOG.requirements.some(
          (item) => item.simulationId === candidate.id,
        ),
      ).toBe(false);
    }
    for (const [module, capability] of [
      ["warehouse", "recommend_replenishment"],
      ["warehouse", "register_exports"],
      ["warehouse", "review_exports"],
      ["procurement", "cancel_purchase_order"],
      ["procurement", "manage_replenishment"],
    ] as const) {
      expect(catalog.requiredCurriculaFor({ module, capability })).toEqual([]);
    }
    // Admin's pre-existing return-case practice does not cover other roles.
    expect(
      catalog.requiredCurriculaFor({
        module: "warehouse",
        capability: "submit_return_case",
      }).length,
    ).toBeGreaterThan(0);
    expect(catalog.CAPABILITY_COVERAGE_CURRICULA).toHaveLength(1);
    expect(catalog.CAPABILITY_COVERAGE_CURRICULA[0]?.id).toBe(
      "internal.unassigned.warehouse.set_pricing.v1",
    );
  });

  it("does not generate new v1 training when RBAC adds roles, grants or unassigned mutations", async () => {
    vi.doMock("@intra/rbac", () => ({
      ...rbac,
      roleCapabilities: [
        ...[...rbac.roleCapabilities].reverse(),
        {
          module: "warehouse",
          role: "bi_analyst",
          cap: "test_future_mutation",
        },
        { module: "warehouse", role: "test_future_role", cap: "request_stock" },
      ],
      CAPABILITY_CLASSIFICATIONS: [
        ...rbac.CAPABILITY_CLASSIFICATIONS,
        {
          module: "warehouse",
          capability: "test_future_mutation",
          access: "mutation",
        },
        {
          module: "warehouse",
          capability: "test_unassigned_mutation",
          access: "mutation",
        },
      ],
    }));
    vi.resetModules();
    const changed = await import("./catalog");
    expect(changed.LEARNING_CATALOG).toEqual(catalog.LEARNING_CATALOG);
    expect(changed.PENDING_ROLE_TRAINING_COVERAGE).toEqual(pending);
    expect(changed.MUTATING_CAPABILITIES).toContainEqual({
      module: "warehouse",
      capability: "test_future_mutation",
    });
    expect(
      changed.requiredCurriculaFor({
        module: "warehouse",
        capability: "test_future_mutation",
      }),
    ).toEqual([]);
  });

  it("does not rewrite reviewed v1 content when a current grant or classification is revoked", async () => {
    vi.doMock("@intra/rbac", () => ({
      ...rbac,
      roleCapabilities: rbac.roleCapabilities.filter(
        (g) => g.cap !== "receive_stock" && g.cap !== "reserve_allocate",
      ),
      CAPABILITY_CLASSIFICATIONS: rbac.CAPABILITY_CLASSIFICATIONS.map((item) =>
        item.module === "warehouse" && item.capability === "receive_stock"
          ? { ...item, access: "read" }
          : item,
      ),
    }));
    vi.resetModules();
    const changed = await import("./catalog");
    expect(changed.LEARNING_CATALOG).toEqual(catalog.LEARNING_CATALOG);
  });
});
