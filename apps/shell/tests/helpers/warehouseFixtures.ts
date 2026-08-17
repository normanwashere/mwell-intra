import type { Page } from "@playwright/test";
import { DEMO_PROFILES } from "../../lib/demoProfiles";
import {
  LEARNING_CATALOG,
  ROLE_CURRICULA,
} from "../../../../modules/learning/src/catalog";

export const WAREHOUSE_ROLES = [
  "warehouse_operator",
  "logistics_supervisor",
  "finance",
  "bi_analyst",
  "business_unit",
  "marketing",
  "procurement",
  "warehouse_admin",
] as const;

export type WarehouseRole = (typeof WAREHOUSE_ROLES)[number];
export type AuditTheme = "light" | "dark";

const MEMORY_SESSION_KEY = "intra.memory-session.v1";
const THEME_KEY = "intra-theme";

const ROLE_PROFILE_IDS: Record<WarehouseRole, string> = {
  warehouse_operator: "demo-warehouse-operator",
  logistics_supervisor: "demo-logistics",
  finance: "demo-finance",
  bi_analyst: "demo-bi",
  business_unit: "demo-business-unit",
  marketing: "demo-marketing",
  procurement: "demo-procurement",
  warehouse_admin: "demo-warehouse-admin",
};

export const ROLE_ROUTES: Record<WarehouseRole, readonly string[]> = {
  warehouse_operator: [
    "/warehouse",
    "/warehouse/inventory",
    "/warehouse/receiving",
    "/warehouse/storage",
    "/warehouse/allocations",
    "/warehouse/cycle-counts",
    "/warehouse/returns",
    "/warehouse/quality",
    "/warehouse/exceptions",
    "/warehouse/scan",
  ],
  logistics_supervisor: [
    "/warehouse",
    "/warehouse/receiving",
    "/warehouse/storage",
    "/warehouse/cycle-counts",
    "/warehouse/quality",
    "/warehouse/approvals",
    "/warehouse/exceptions",
    "/warehouse/imports",
    "/warehouse/operation-routes",
    "/warehouse/scan",
  ],
  finance: [
    "/warehouse",
    "/warehouse/inventory",
    "/finance",
    "/warehouse/approvals",
    "/warehouse/exceptions",
  ],
  bi_analyst: ["/warehouse", "/warehouse/inventory", "/warehouse/exceptions"],
  business_unit: [
    "/warehouse",
    "/warehouse/inventory",
    "/warehouse/allocations",
  ],
  marketing: ["/warehouse", "/warehouse/inventory", "/warehouse/allocations"],
  procurement: [
    "/warehouse",
    "/warehouse/inventory",
    "/warehouse/procurement",
    "/warehouse/purchase-orders",
    "/warehouse/suppliers",
  ],
  warehouse_admin: [
    "/warehouse",
    "/warehouse/inventory",
    "/warehouse/receiving",
    "/warehouse/storage",
    "/warehouse/allocations",
    "/warehouse/cycle-counts",
    "/warehouse/returns",
    "/warehouse/quality",
    "/warehouse/approvals",
    "/warehouse/exceptions",
    "/warehouse/imports",
    "/warehouse/operation-routes",
    "/warehouse/scan",
  ],
};

export const CANONICAL_WORKSPACE_ROUTES = [
  { role: "marketing", route: "/events" },
  { role: "bi_analyst", route: "/insights/warehouse" },
] as const satisfies readonly { role: WarehouseRole; route: string }[];

export async function installWarehouseSession(
  page: Page,
  role: WarehouseRole,
  theme: AuditTheme = "light",
): Promise<void> {
  const profile = DEMO_PROFILES.find(
    (candidate) => candidate.id === ROLE_PROFILE_IDS[role],
  );
  if (!profile) throw new Error(`Missing demo profile for ${role}.`);
  const roleKeys = new Set(
    Object.entries(profile.roles).flatMap(([module, roles]) =>
      roles.map((assignedRole) => `${module}:${assignedRole}`),
    ),
  );
  const orientationIds = new Set(
    ROLE_CURRICULA.filter((curriculum) =>
      roleKeys.has(`${curriculum.module}:${curriculum.role}`),
    ).flatMap((curriculum) => curriculum.requirementIds),
  );
  const completedProgress = LEARNING_CATALOG.requirements
    .filter(
      (requirement) =>
        requirement.kind === "orientation" &&
        orientationIds.has(requirement.id),
    )
    .map((requirement) => ({
      assignmentRequirementId: `visual-fixture:${requirement.id}`,
      requirementId: requirement.id,
      requirementVersion: requirement.version,
      state: "passed",
      attemptCount: 1,
      allowsSharedCompletion: true,
      completedAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
    }));
  const learningKey = `intra.demo-learning.v1:${profile.id}:${JSON.stringify(profile.roles)}`;
  await page.addInitScript(
    ({
      sessionKey,
      themeKey,
      learningKey,
      completedProgress,
      session,
      selectedTheme,
    }) => {
      window.sessionStorage.setItem(sessionKey, JSON.stringify(session));
      window.sessionStorage.setItem(
        learningKey,
        JSON.stringify({
          progress: completedProgress,
          completedCheckpoints: {},
        }),
      );
      window.localStorage.setItem(themeKey, selectedTheme);
    },
    {
      sessionKey: MEMORY_SESSION_KEY,
      themeKey: THEME_KEY,
      learningKey,
      completedProgress,
      selectedTheme: theme,
      session: {
        profileId: profile.id,
        roles: profile.roles,
      },
    },
  );
}

export function routeSlug(route: string): string {
  return (
    route
      .replace(/^\/warehouse(?:\/|$)/, "")
      .replace(/^\/+/, "")
      .replaceAll("/", "-") || "dashboard"
  );
}
