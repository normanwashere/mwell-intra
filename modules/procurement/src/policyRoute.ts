import type {
  ProcurementMode,
  ProcurementPolicyProfile,
  ProcurementRoute,
  RequestCategory,
  RequirementKind,
  SourcingMethod,
} from './types';

export interface ProcurementRouteInput {
  /** Required for new requests. Category is not a safe substitute. */
  requirementKind: RequirementKind;
  category?: RequestCategory;
  amount?: number;
  requestedMode?: ProcurementMode;
  complex?: boolean;
  technical?: boolean;
  strategic?: boolean;
  highRisk?: boolean;
  dataSensitive?: boolean;
  importation?: boolean;
}

export interface ProcurementRouteRecommendation {
  route: ProcurementRoute;
  /** Route suggestions are advisory until Procurement records confirmation. */
  requiresProcurementConfirmation: true;
}

const AMBIGUOUS_LEGACY_CATEGORIES = new Set<RequestCategory>([
  'marketing',
  'medical',
  'capex',
  'other',
]);

/**
 * Only legacy reads may infer a requirement kind from an old category. The
 * ambiguous categories deliberately return undefined so the record can enter
 * the remediation queue rather than silently receiving a new classification.
 */
export function inferLegacyRequirementKind(
  category: RequestCategory | undefined,
): RequirementKind | undefined {
  if (!category || AMBIGUOUS_LEGACY_CATEGORIES.has(category)) return undefined;
  switch (category) {
    case 'goods':
      return 'materials';
    case 'services':
    case 'subscription':
    case 'construction':
    case 'manpower':
    case 'it_software':
      return 'services';
    case 'petty_cash':
      return 'materials';
  }
}

function governanceTier(
  input: Pick<ProcurementRouteInput, 'amount' | 'complex' | 'technical' | 'strategic' | 'highRisk' | 'dataSensitive' | 'importation'>,
  profile: ProcurementPolicyProfile,
): ProcurementRoute['governanceTier'] {
  const formalBidAmount = profile.controls.formalBidAmount;
  if (formalBidAmount === null) {
    throw new Error('An active Mwell formal-bid threshold is required.');
  }
  if (
    input.complex ||
    input.technical ||
    input.strategic ||
    input.highRisk ||
    input.dataSensitive ||
    input.importation
  ) {
    return 'high_risk';
  }
  return (input.amount ?? 0) >= formalBidAmount ? 'formal_bid' : 'standard';
}

function assertActiveMwellOperatingProfile(profile: ProcurementPolicyProfile): void {
  if (profile.relationship !== 'mwell_operating' || profile.status !== 'active') {
    throw new Error('An active Mwell operating policy profile is required.');
  }
}

/**
 * Derives the three independent route axes for a new request. Requirement
 * kind controls RFQ/RFP; procurement mode controls whether a solicitation is
 * needed; amount and risk controls governance. None may stand in for another.
 */
export function deriveProcurementRoute(
  input: ProcurementRouteInput,
  profile: ProcurementPolicyProfile,
): ProcurementRouteRecommendation {
  assertActiveMwellOperatingProfile(profile);
  if (input.requirementKind !== 'materials' && input.requirementKind !== 'services') {
    throw new Error('A requirement kind is required before Procurement can derive a route.');
  }

  const procurementMode = input.requestedMode ?? 'competitive_bidding';
  const tier = governanceTier(input, profile);
  const solicitationType = procurementMode === 'competitive_bidding'
    ? input.requirementKind === 'services' ? 'rfp' : 'rfq'
    : 'none';

  return {
    route: {
      solicitationType,
      procurementMode,
      governanceTier: tier,
      policyProfileId: profile.id,
      reasons: [
        input.requirementKind === 'services' ? 'service_requirement' : 'material_requirement',
        `mode:${procurementMode}`,
        `tier:${tier}`,
      ],
    },
    requiresProcurementConfirmation: true,
  };
}

/** Projects the new route onto the deprecated legacy field for old consumers. */
export function legacySourcingMethod(route: ProcurementRoute): SourcingMethod {
  switch (route.procurementMode) {
    case 'petty_cash':
      return 'petty_cash';
    case 'repeat_order':
      return 'repeat_order';
    case 'emergency_purchase':
      return 'emergency';
    case 'sole_source':
    case 'approved_exception':
      return 'direct_award';
    case 'competitive_bidding':
      return route.solicitationType === 'rfp' ? 'rfp' : 'rfq';
  }
}

function legacyMode(method: SourcingMethod): ProcurementMode {
  switch (method) {
    case 'petty_cash':
      return 'petty_cash';
    case 'repeat_order':
      return 'repeat_order';
    case 'emergency':
      return 'emergency_purchase';
    case 'direct_award':
      return 'sole_source';
    case 'small_purchase':
    case 'rfq':
    case 'rfp':
      return 'competitive_bidding';
  }
}

/**
 * Deterministic read adapter for old rows. It preserves the stored
 * solicitation projection and adds a remediation reason whenever the old
 * category cannot safely determine its requirement kind.
 */
export function routeFromLegacy(
  method: SourcingMethod,
  category: RequestCategory | undefined,
  amount: number | undefined,
  profile: ProcurementPolicyProfile,
): ProcurementRoute {
  assertActiveMwellOperatingProfile(profile);
  const inferredRequirementKind = inferLegacyRequirementKind(category);
  const procurementMode = legacyMode(method);
  const special = category === 'construction' || category === 'manpower';
  const tier = governanceTier({ amount, highRisk: special }, profile);
  const solicitationType = procurementMode === 'competitive_bidding'
    ? method === 'rfp' ? 'rfp' : 'rfq'
    : 'none';

  return {
    solicitationType,
    procurementMode,
    governanceTier: tier,
    policyProfileId: profile.id,
    reasons: [
      `legacy_method:${method}`,
      `mode:${procurementMode}`,
      `tier:${tier}`,
      ...(inferredRequirementKind
        ? [`legacy_requirement_kind:${inferredRequirementKind}`]
        : ['legacy_mapping_requires_review']),
    ],
  };
}
