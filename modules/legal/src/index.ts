// @intra/legal — vendor accreditation intake and review (Step 3b).
//
// The Next.js shell imports `LegalApp` under `/legal`; vendor-tier users use
// the shell's `/vendor` route group (Step 3c) which can mount the same module
// with a narrower basename.

export { LegalApp } from "./LegalApp";
export type { LegalAppProps } from "./LegalApp";
export { ensureLegalSeed } from "./localStore";
export {
  LEGAL_ROUTE_BY_ID,
  LEGAL_ROUTE_CONTRACTS,
  mountLegalRouteContracts,
} from "./routes";
export type { LegalRouteContract, LegalRouteId } from "./routes";
