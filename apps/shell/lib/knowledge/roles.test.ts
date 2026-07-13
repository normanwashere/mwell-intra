import { MODULE_LIST, listModuleRoles, roleCapabilities } from "@intra/rbac";
import { MODULES as WAREHOUSE_MODULES } from "@intra/warehouse";
import { describe, expect, it } from "vitest";
import {
  COMING_SOON_ROLES,
  KNOWLEDGE_ROLES,
  LIVE_KNOWLEDGE_ROLES,
  WAREHOUSE_DETAIL_ROUTE_ALIASES,
  WAREHOUSE_ROUTE_CAPABILITY_ENTRIES,
  knowledgeRoleIdsForAssignments,
  knowledgeRoleForRbac,
} from "./roles";

describe("knowledge role authority registry", () => {
  it("maps scoped RBAC assignments to explicit handbook role IDs", () => {
    expect(
      knowledgeRoleIdsForAssignments({
        core: ["staff", "vendor_portal"],
        procurement: ["procurement_officer"],
        legal: ["legal_reviewer"],
        warehouse: ["operations"],
      }),
    ).toEqual([
      "core_staff_only",
      "vendor_portal",
      "warehouse_operations",
      "procurement_officer",
      "legal_reviewer",
    ]);
  });

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

  it("derives warehouse route capabilities from the independent warehouse module export", () => {
    const routesFromModules = WAREHOUSE_MODULES.map((module) => ({
      route: module.path === "/" ? "/warehouse" : `/warehouse${module.path}`,
      capabilities: module.capabilities,
    }));

    expect(WAREHOUSE_DETAIL_ROUTE_ALIASES).toEqual([
      {
        route: "/warehouse/inventory/:id",
        parentPath: "/inventory",
        parentHref: "/warehouse/inventory",
        parentLabel: "Open inventory list",
      },
      {
        route: "/warehouse/events/:id",
        parentPath: "/events",
        parentHref: "/warehouse/events",
        parentLabel: "Open events list",
      },
    ]);
    expect(WAREHOUSE_ROUTE_CAPABILITY_ENTRIES).toEqual([
      ...routesFromModules,
      ...WAREHOUSE_DETAIL_ROUTE_ALIASES.map((alias) => {
        const parent = WAREHOUSE_MODULES.find(
          (module) => module.path === alias.parentPath,
        );
        return {
          route: alias.route,
          capabilities: parent?.capabilities,
        };
      }),
    ]);
  });

  it("derives every warehouse handbook route from those capability entries", () => {
    for (const role of listModuleRoles("warehouse")) {
      const guide = knowledgeRoleForRbac("warehouse", role);
      const expectedRoutes = WAREHOUSE_ROUTE_CAPABILITY_ENTRIES.filter(
        (route) =>
          route.capabilities.some((capability) =>
            guide?.authority.capabilities.includes(capability),
          ),
      ).map((route) => route.route);

      expect(guide?.authority.accessibleRoutes, role).toEqual(expectedRoutes);
    }
  });

  it("gives every live profile complete authority guidance and handoffs", () => {
    for (const role of LIVE_KNOWLEDGE_ROLES) {
      const authority = role.authority;

      expect(
        authority.capabilities,
        `${role.id}:capabilities`,
      ).not.toHaveLength(0);
      expect(authority.canDo, `${role.id}:canDo`).not.toHaveLength(0);
      expect(authority.cannotDo, `${role.id}:cannotDo`).not.toHaveLength(0);
      expect(authority.decisions, `${role.id}:decisions`).not.toHaveLength(0);
      expect(authority.upstreamRoleIds, `${role.id}:upstream`).not.toHaveLength(
        0,
      );
      expect(
        authority.downstreamRoleIds,
        `${role.id}:downstream`,
      ).not.toHaveLength(0);
      expect(authority.escalation.trim(), `${role.id}:escalation`).not.toBe("");
      expect(authority.cannotDo, `${role.id}:cannotDo`).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/\b(do not|never|must not)\b/i),
        ]),
      );
    }
  });

  it("keeps roadmap roles outside live RBAC and operational access", () => {
    for (const role of COMING_SOON_ROLES) {
      expect(role.rbacModule, role.id).toBeUndefined();
      expect(role.rbacRole, role.id).toBeUndefined();
      expect(role.authority.capabilities, role.id).toEqual([]);
      expect(role.authority.accessibleRoutes, role.id).toEqual([]);
      expect(
        [
          role.purpose,
          ...role.authority.canDo,
          ...role.authority.decisions,
        ].join(" "),
        role.id,
      ).toMatch(/\b(plan|planned|future)\b/i);
      expect(role.authority.cannotDo, role.id).toEqual(
        expect.arrayContaining([expect.stringMatching(/\bdo not\b/i)]),
      );
    }
  });
});
