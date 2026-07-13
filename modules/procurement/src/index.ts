// @intra/procurement — purchase requests + PO authoring (Step 3a).
//
// The Next.js shell imports `ProcurementApp` and renders it under `/procurement`.

export { ProcurementApp } from "./ProcurementApp";
export type { ProcurementAppProps } from "./ProcurementApp";
export { ensureProcurementSeed } from "./localStore";
export {
  PROCUREMENT_ROUTE_BY_ID,
  PROCUREMENT_ROUTE_CONTRACTS,
  procurementRoutesForAudience,
} from "./routes";
export type { ProcurementRouteContract, ProcurementRouteId } from "./routes";
