import type { SessionProfile } from "@intra/auth";
import { MODULE_LIST, type Module, type UserRoles } from "@intra/rbac";
import {
  getAdminModulePresentation,
  getAdminRolePresentation,
} from "./adminRolePresentation";
import { OPERATING_PERSONAS } from "./knowledge/operatingPersonas";

export interface PersonaAuthorityItem {
  readonly module: Module;
  readonly moduleLabel: string;
  readonly role: string;
  readonly label: string;
}

export interface PersonaPresentation {
  readonly title: string;
  readonly department: string;
  readonly responsibility?: string;
  readonly authority: readonly PersonaAuthorityItem[];
}

interface PersonaMatch {
  readonly id: string;
  readonly matches: (
    profile: SessionProfile,
    roles: Partial<UserRoles>,
  ) => boolean;
}

function hasRole(
  roles: Partial<UserRoles>,
  module: Module,
  role: string,
): boolean {
  return roles[module]?.includes(role) === true;
}

const PERSONA_MATCHES: readonly PersonaMatch[] = [
  {
    id: "vendor_representative",
    matches: (profile, roles) =>
      profile.kind === "vendor" || hasRole(roles, "core", "vendor_portal"),
  },
  {
    id: "platform_administrator",
    matches: (_profile, roles) => hasRole(roles, "core", "platform_admin"),
  },
  {
    id: "operations_lead",
    matches: (_profile, roles) =>
      hasRole(roles, "warehouse", "warehouse_supervisor") ||
      (hasRole(roles, "warehouse", "logistics_supervisor") &&
        hasRole(roles, "procurement", "approver")),
  },
  {
    id: "operations_associate",
    matches: (_profile, roles) =>
      hasRole(roles, "warehouse", "warehouse_operator"),
  },
  {
    id: "procurement_lead",
    matches: (_profile, roles) =>
      hasRole(roles, "procurement", "admin") &&
      hasRole(roles, "procurement", "procurement_officer"),
  },
  {
    id: "finance_controller",
    matches: (_profile, roles) =>
      hasRole(roles, "procurement", "finance") &&
      hasRole(roles, "warehouse", "finance"),
  },
  {
    id: "legal_compliance_lead",
    matches: (_profile, roles) =>
      hasRole(roles, "legal", "admin") &&
      (hasRole(roles, "legal", "legal_reviewer") ||
        hasRole(roles, "legal", "compliance")),
  },
  {
    id: "marketing_events_lead",
    matches: (_profile, roles) =>
      hasRole(roles, "events", "admin") &&
      hasRole(roles, "warehouse", "marketing"),
  },
  {
    id: "product_owner",
    matches: (_profile, roles) => hasRole(roles, "product", "product_owner"),
  },
  {
    id: "leadership_insights",
    matches: (_profile, roles) =>
      hasRole(roles, "insights", "executive") &&
      hasRole(roles, "insights", "manager"),
  },
  {
    id: "general_employee",
    matches: (_profile, roles) =>
      hasRole(roles, "procurement", "requester") &&
      hasRole(roles, "warehouse", "business_unit"),
  },
];

function authorityFor(roles: Partial<UserRoles>): PersonaAuthorityItem[] {
  const authority = MODULE_LIST.flatMap((module) =>
    (roles[module] ?? [])
      .filter((role) => !(module === "core" && role === "staff"))
      .map((role) => ({
        module,
        moduleLabel: getAdminModulePresentation(module).shortLabel,
        role,
        label: getAdminRolePresentation(module, role).label,
      })),
  );

  return authority.filter(
    (item, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.module === item.module && candidate.label === item.label,
      ) === index,
  );
}

function fallbackDepartment(
  profile: SessionProfile,
  roles: Partial<UserRoles>,
): string {
  if (profile.kind === "vendor") return "External";
  const module = MODULE_LIST.find(
    (candidate) => candidate !== "core" && (roles[candidate]?.length ?? 0) > 0,
  );
  return module ? getAdminModulePresentation(module).label : "Unassigned";
}

export function resolvePersonaPresentation(
  profile: SessionProfile,
  roles: Partial<UserRoles>,
): PersonaPresentation {
  const matched = PERSONA_MATCHES.find((candidate) =>
    candidate.matches(profile, roles),
  );
  const persona = matched
    ? OPERATING_PERSONAS.find((candidate) => candidate.id === matched.id)
    : undefined;

  return {
    title:
      persona?.label ??
      profile.title?.trim() ??
      (profile.kind === "vendor" ? "Vendor Representative" : "Employee"),
    department: persona?.department ?? fallbackDepartment(profile, roles),
    responsibility: persona?.responsibility,
    authority: authorityFor(roles),
  };
}
