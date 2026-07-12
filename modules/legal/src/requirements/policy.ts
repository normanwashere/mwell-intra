// Vendor accreditation policy engine.
//
// Given a `TailoringProfile` (jurisdiction, entity type, category, risk tier,
// contract type, spend band, personal-data handling), returns the tailored
// list of catalog requirements that apply to that vendor. The function is
// pure and side-effect-free so the same logic drives:
//   - the Invite wizard preview (before the case is created)
//   - the store's seeding on case creation
//   - the expiry engine's "checklist collapsed to only the expiring items"
//     when a case flips to `renewal_due`
//
// Tests: `./policy.test.ts`.
//
// Adding a new axis: extend `TailoringProfile`, then update `matches()` below
// AND every relevant catalog entry. `docs/VENDOR-ACCREDITATION.md#adding-a-new-requirement`
// has the checklist.

import type {
  ContractType,
  EntityType,
  Jurisdiction,
  RequirementDefinition,
  RiskTier,
  SpendBand,
  VendorCategory,
} from '../types';
import { SPEND_BAND_ORDER } from '../types';
import { REQUIREMENT_CATALOG } from './catalog';

export interface TailoringProfile {
  jurisdiction: Jurisdiction;
  entityType: EntityType;
  category: VendorCategory;
  riskTier: RiskTier;
  contractType: ContractType;
  spendBand: SpendBand;
  handlesPersonalData: boolean;
}

/**
 * A requirement is *applicable* when it matches the profile on every axis
 * the requirement constrains. An empty array on an axis means "any" (the
 * requirement doesn't constrain that axis).
 */
export function matches(
  req: RequirementDefinition,
  profile: TailoringProfile,
): boolean {
  if (req.requiresPersonalData && !profile.handlesPersonalData) return false;
  if (
    req.jurisdictions.length &&
    !req.jurisdictions.includes('*') &&
    !req.jurisdictions.includes(profile.jurisdiction)
  ) {
    return false;
  }
  if (
    req.entityTypes.length &&
    !req.entityTypes.includes('*') &&
    !req.entityTypes.includes(profile.entityType)
  ) {
    return false;
  }
  if (
    req.categories.length &&
    !req.categories.includes('*') &&
    !req.categories.includes(profile.category)
  ) {
    return false;
  }
  if (
    req.riskTiers.length &&
    !req.riskTiers.includes('*') &&
    !req.riskTiers.includes(profile.riskTier)
  ) {
    return false;
  }
  if (
    req.contractTypes?.length &&
    !req.contractTypes.includes('*') &&
    !req.contractTypes.includes(profile.contractType)
  ) {
    return false;
  }
  // `minSpendBand` gates in-scope requirements that only apply once the
  // engagement crosses a spend threshold (bonds, EDD, insurance §12).
  if (req.minSpendBand) {
    if (SPEND_BAND_ORDER[profile.spendBand] < SPEND_BAND_ORDER[req.minSpendBand]) {
      return false;
    }
  }
  return true;
}

/** All catalog entries that apply to the given profile. */
export function tailorRequirements(
  profile: TailoringProfile,
): RequirementDefinition[] {
  return REQUIREMENT_CATALOG.filter((r) => matches(r, profile));
}

/**
 * Filter to just the required entries (drops optional/nice-to-have rows).
 * Used by the invite wizard KPI and the "You still owe" banner.
 */
export function tailorRequiredOnly(
  profile: TailoringProfile,
): RequirementDefinition[] {
  return tailorRequirements(profile).filter(isPolicyBackedRequirement);
}

/** Only sourced requirements may block submission or accreditation. */
export function isPolicyBackedRequirement(
  requirement: RequirementDefinition,
): boolean {
  return requirement.required && Boolean(requirement.policySource);
}

export {
  VENDOR_ACCREDITATION_V2025,
  buildV2025Checklist,
  validateV2025Application,
} from './vendorAccreditationV2025';

/** Group tailored requirements by `RequirementGroup`. */
export function groupTailored(
  profile: TailoringProfile,
): Record<string, RequirementDefinition[]> {
  const out: Record<string, RequirementDefinition[]> = {};
  for (const r of tailorRequirements(profile)) {
    (out[r.group] ??= []).push(r);
  }
  return out;
}

/** Convenience: default profile used by the invite wizard on first render. */
export const DEFAULT_TAILORING_PROFILE: TailoringProfile = {
  jurisdiction: 'PH',
  entityType: 'corporation',
  category: 'goods',
  riskTier: 'low',
  contractType: 'spot_po',
  spendBand: 'below_100k',
  handlesPersonalData: false,
};

/**
 * Diff two tailoring profiles into a human-readable change summary. Used to
 * annotate the timeline when a reviewer edits the profile mid-case.
 */
export function diffProfile(
  a: TailoringProfile,
  b: TailoringProfile,
): string[] {
  const diffs: string[] = [];
  const push = <K extends keyof TailoringProfile>(k: K) => {
    if (a[k] !== b[k]) diffs.push(`${k}: ${String(a[k])} \u2192 ${String(b[k])}`);
  };
  push('jurisdiction');
  push('entityType');
  push('category');
  push('riskTier');
  push('contractType');
  push('spendBand');
  push('handlesPersonalData');
  return diffs;
}

// ---------------------------------------------------------------------------
// Expiry engine
// ---------------------------------------------------------------------------

/** Days between now and the given ISO date. Negative when already expired. */
export function daysUntil(iso: string | undefined | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((t - Date.now()) / 86_400_000);
}

/**
 * A single expiry entry for the "You still owe" banner and the case-level
 * "renewal due" trigger.
 */
export interface ExpiringEntry {
  requirementCode: string;
  requirementLabel: string;
  documentId?: string;
  expiresAt: string;
  daysUntil: number;
  /** True when already past due. */
  overdue: boolean;
}

/**
 * True when any of the provided expiry entries fall within the window
 * (default 90 days). Drives the case-level `renewal_due` flip.
 */
export function anyExpiringWithin(
  entries: readonly { expiresAt?: string | null }[],
  windowDays = 90,
): boolean {
  return entries.some((e) => {
    const d = daysUntil(e.expiresAt ?? undefined);
    return d !== null && d <= windowDays;
  });
}
