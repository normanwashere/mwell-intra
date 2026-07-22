export interface GovernedAdminProfile {
  readonly id: string;
  readonly email: string;
  readonly full_name: string | null;
  readonly kind: "employee" | "vendor";
  readonly status: string;
}

export interface RoleChangeEvidence {
  readonly approvalReference: string;
  readonly reason: string;
  readonly effectiveAt: string;
  readonly expiresAt: string;
}

export function validateRoleChangeEvidence(
  evidence: RoleChangeEvidence,
): Partial<Record<keyof RoleChangeEvidence, string>> {
  const errors: Partial<Record<keyof RoleChangeEvidence, string>> = {};
  if (!evidence.approvalReference.trim()) {
    errors.approvalReference = "Approval reference is required.";
  }
  if (!evidence.reason.trim()) {
    errors.reason = "Business reason is required.";
  }
  if (!evidence.effectiveAt) {
    errors.effectiveAt = "Effective date is required.";
  }
  if (
    evidence.effectiveAt &&
    evidence.expiresAt &&
    evidence.expiresAt <= evidence.effectiveAt
  ) {
    errors.expiresAt = "Expiry must be after the effective date.";
  }
  return errors;
}

export interface ProfileDirectoryFilters {
  readonly query: string;
  readonly status: string;
  readonly kind: "all" | "employee" | "vendor";
  readonly page: number;
  readonly pageSize: number;
}

export function filterAndPageProfiles<T extends GovernedAdminProfile>(
  profiles: readonly T[],
  filters: ProfileDirectoryFilters,
): { readonly rows: readonly T[]; readonly total: number; readonly pages: number } {
  const query = filters.query.trim().toLocaleLowerCase();
  const filtered = profiles
    .filter(
      (profile) =>
        filters.status === "all" || profile.status === filters.status,
    )
    .filter(
      (profile) => filters.kind === "all" || profile.kind === filters.kind,
    )
    .filter((profile) => {
      if (!query) return true;
      return `${profile.full_name ?? ""} ${profile.email}`
        .toLocaleLowerCase()
        .includes(query);
    })
    .sort((left, right) =>
      `${left.full_name ?? ""} ${left.email}`.localeCompare(
        `${right.full_name ?? ""} ${right.email}`,
      ),
    );
  const pageSize = Math.max(1, filters.pageSize);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(1, filters.page), pages);
  const start = (page - 1) * pageSize;
  return {
    rows: filtered.slice(start, start + pageSize),
    total: filtered.length,
    pages,
  };
}
