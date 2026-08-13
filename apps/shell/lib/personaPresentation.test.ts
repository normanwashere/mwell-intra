import { describe, expect, it } from "vitest";
import type { SessionProfile } from "@intra/auth";
import type { UserRoles } from "@intra/rbac";
import { resolvePersonaPresentation } from "./personaPresentation";
import { DEMO_PROFILES } from "./demoProfiles";

const profile = (title?: string): SessionProfile => ({
  id: "person-1",
  email: "person@mwell.test",
  kind: "employee",
  name: "Test Person",
  title,
});

const personas: Array<{
  title: string;
  department: string;
  roles: Partial<UserRoles>;
  kind?: "employee" | "vendor";
}> = [
  {
    title: "Platform Administrator",
    department: "Technology",
    roles: { core: ["staff", "platform_admin"] },
  },
  {
    title: "General Employee",
    department: "Any department",
    roles: {
      core: ["staff"],
      procurement: ["requester"],
      events: ["requester"],
      warehouse: ["business_unit"],
      product: ["contributor"],
    },
  },
  {
    title: "Operations Associate",
    department: "Operations",
    roles: {
      core: ["staff"],
      warehouse: ["warehouse_operator", "operations"],
    },
  },
  {
    title: "Operations Lead",
    department: "Operations",
    roles: {
      core: ["staff"],
      procurement: ["approver"],
      warehouse: ["warehouse_supervisor", "logistics_supervisor"],
      product: ["operations_partner"],
    },
  },
  {
    title: "Procurement Lead",
    department: "Procurement",
    roles: {
      core: ["staff"],
      procurement: ["procurement_officer", "admin"],
      warehouse: ["procurement"],
    },
  },
  {
    title: "Finance Controller",
    department: "Finance",
    roles: {
      core: ["staff"],
      procurement: ["finance"],
      warehouse: ["finance"],
      events: ["finance_reviewer"],
    },
  },
  {
    title: "Legal & Compliance Lead",
    department: "Legal & Compliance",
    roles: {
      core: ["staff"],
      legal: ["legal_reviewer", "compliance", "admin"],
    },
  },
  {
    title: "Marketing & Events Lead",
    department: "Marketing",
    roles: {
      core: ["staff"],
      events: ["coordinator", "admin"],
      warehouse: ["marketing"],
    },
  },
  {
    title: "Product Owner",
    department: "Product",
    roles: {
      core: ["staff"],
      events: ["viewer"],
      product: ["product_owner"],
    },
  },
  {
    title: "Leadership / Insights",
    department: "Leadership",
    roles: {
      core: ["staff"],
      insights: ["analyst", "manager", "executive"],
      warehouse: ["bi_analyst"],
    },
  },
  {
    title: "Vendor Representative",
    department: "External",
    kind: "vendor",
    roles: { core: ["vendor_portal"] },
  },
];

describe("resolvePersonaPresentation", () => {
  it.each(personas)("resolves the canonical $title persona", (persona) => {
    const result = resolvePersonaPresentation(
      { ...profile(), kind: persona.kind ?? "employee" },
      persona.roles,
    );

    expect(result.title).toBe(persona.title);
    expect(result.department).toBe(persona.department);
  });

  it("keeps the canonical job title separate from scoped Finance authority", () => {
    const result = resolvePersonaPresentation(
      profile("Finance Manager"),
      {
        core: ["staff"],
        procurement: ["finance"],
        warehouse: ["finance"],
        events: ["finance_reviewer"],
      },
    );

    expect(result.title).toBe("Finance Controller");
    expect(result.authority.map((item) => item.label)).toEqual([
      "Inventory Finance Reviewer",
      "Procurement Finance Reviewer",
      "Event Finance Reviewer",
    ]);
    expect(result.authority.map((item) => item.label)).not.toContain(
      result.title,
    );
  });

  it("preserves a genuine custom job title while listing roles as authority", () => {
    const result = resolvePersonaPresentation(profile("Senior Accountant"), {
      core: ["staff"],
      procurement: ["finance"],
    });

    expect(result.title).toBe("Senior Accountant");
    expect(result.authority).toEqual([
      {
        module: "procurement",
        moduleLabel: "Procurement",
        role: "finance",
        label: "Procurement Finance Reviewer",
      },
    ]);
  });

  it("uses the role-owning department for a dedicated demo duty", () => {
    const result = resolvePersonaPresentation(profile("Finance reviewer"), {
      core: ["staff"],
      procurement: ["finance"],
    });

    expect(result.department).toBe("Procurement");
    expect(result.responsibility).toBeUndefined();
  });

  it("keeps canonical demo personas aligned without making platform roles operational", () => {
    const profileById = new Map(DEMO_PROFILES.map((item) => [item.id, item]));

    expect(profileById.get("demo-admin")?.roles).toEqual({
      core: ["platform_admin", "staff"],
    });
    expect(profileById.get("demo-procurement")?.roles).toMatchObject({
      procurement: ["procurement_officer", "admin"],
      warehouse: ["procurement"],
    });
    expect(profileById.get("demo-legal")?.roles.legal).toEqual([
      "legal_reviewer",
      "compliance",
      "admin",
    ]);
    expect(profileById.get("demo-executive")?.roles.insights).toEqual([
      "analyst",
      "manager",
      "executive",
    ]);
  });
});
