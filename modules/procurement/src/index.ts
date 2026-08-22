// @intra/procurement — purchase requests + PO authoring (Step 3a).
//
// The Next.js shell imports `ProcurementApp` and renders it under `/procurement`.

export { ProcurementApp } from "./ProcurementApp";
export type { ProcurementAppProps } from "./ProcurementApp";
export { ensureProcurementSeed } from "./localStore";
export {
  MPIC_SOURCE_PROFILE,
  MWELL_OPERATING_PROFILE,
  selectEffectivePolicyProfile,
  validatePolicyProfile,
} from "./policyProfile";
export {
  appliedPolicyProfileSummary,
  mapLivePolicyProfile,
  policyEffectiveDate,
} from "./policyProfileAdapter";
export {
  deriveProcurementRoute,
  inferLegacyRequirementKind,
  legacySourcingMethod,
  routeFromLegacy,
} from "./policyRoute";
export type {
  ProcurementRouteInput,
  ProcurementRouteRecommendation,
} from "./policyRoute";
export type {
  GovernanceTier,
  ProcurementMode,
  ProcurementPolicyControls,
  ProcurementPolicyProfile,
  ProcurementRoute,
  RequirementKind,
  SolicitationType,
} from "./types";
export {
  PROCUREMENT_ROUTE_BY_ID,
  PROCUREMENT_ROUTE_CONTRACTS,
  procurementRoutesForAudience,
} from "./routes";
export type { ProcurementRouteContract, ProcurementRouteId } from "./routes";
