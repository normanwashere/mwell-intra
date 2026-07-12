import { MODULE_LIST, listModuleRoles, roleCapabilities } from "@intra/rbac";
import { describe, expect, it } from "vitest";
import {
  COMING_SOON_ROLES,
  KNOWLEDGE_ROLES,
  LIVE_KNOWLEDGE_ROLES,
  knowledgeRoleForRbac,
} from "./roles";

describe("knowledge role authority registry", () => {
  it("maps every current RBAC role to exactly one live handbook profile with matching capabilities", () => {
    for (const module of MODULE_LIST) {
      for (const role of listModuleRoles(module)) {
        const guide = knowledgeRoleForRbac(module, role);
        const expectedCapabilities = roleCapabilities
          .filter((grant) => grant.module === module && grant.role === role)
          .map((grant) => grant.cap);

        expect(guide, `${module}:${role}`).toBeDefined();
        expect(guide?.availability, `${module}:${role}`).toBe("live");
        expect(
          KNOWLEDGE_ROLES.filter(
            (profile) =>
              profile.rbacModule === module && profile.rbacRole === role,
          ),
          `${module}:${role}`,
        ).toHaveLength(1);
        expect(
          new Set(guide?.authority.capabilities),
          `${module}:${role}`,
        ).toEqual(new Set(expectedCapabilities));
      }
    }
  });

  it("preserves the live handbook registry while exporting roadmap profiles separately", () => {
    expect(KNOWLEDGE_ROLES).toEqual(LIVE_KNOWLEDGE_ROLES);
    expect(
      KNOWLEDGE_ROLES.some((role) => role.availability === "coming_soon"),
    ).toBe(false);
    expect(COMING_SOON_ROLES.map((role) => role.id)).toEqual(
      expect.arrayContaining([
        "strategic_sourcing_lead",
        "vendor_relationship_manager",
        "inventory_planner",
        "internal_auditor",
        "department_budget_owner",
        "security_reviewer",
      ]),
    );
  });

  it("keeps roadmap roles outside live RBAC and live routes", () => {
    for (const role of COMING_SOON_ROLES) {
      expect(role.rbacModule, role.id).toBeUndefined();
      expect(role.rbacRole, role.id).toBeUndefined();
      expect(role.authority.accessibleRoutes, role.id).toEqual([]);
    }
  });
});
