export type ProcurementRouteId =
  | "requests"
  | "create-request"
  | "request-detail"
  | "approvals"
  | "purchase-orders"
  | "po-detail";

export interface ProcurementRouteContract {
  id: ProcurementRouteId;
  path: string;
  capabilityIds: string[];
  audiences: Array<"full" | "approvals-only">;
  minimumControls: number;
  minimumFields: number;
}

export const PROCUREMENT_ROUTE_CONTRACTS: ProcurementRouteContract[] = [
  {
    id: "requests",
    path: "/",
    capabilityIds: ["view_dashboard", "create_request"],
    audiences: ["full", "approvals-only"],
    minimumControls: 3,
    minimumFields: 2,
  },
  {
    id: "create-request",
    path: "/requests/new",
    capabilityIds: ["view_dashboard", "create_request", "manage_rfp"],
    audiences: ["full"],
    minimumControls: 5,
    minimumFields: 12,
  },
  {
    id: "request-detail",
    path: "/requests/:id",
    capabilityIds: ["view_dashboard", "manage_rfp", "author_po"],
    audiences: ["full", "approvals-only"],
    minimumControls: 5,
    minimumFields: 4,
  },
  {
    id: "approvals",
    path: "/approvals",
    capabilityIds: ["approve_request"],
    audiences: ["full", "approvals-only"],
    minimumControls: 4,
    minimumFields: 2,
  },
  {
    id: "purchase-orders",
    path: "/purchase-orders",
    capabilityIds: [
      "view_dashboard",
      "author_po",
      "approve_award",
      "view_finance",
      "admin",
    ],
    audiences: ["full"],
    minimumControls: 3,
    minimumFields: 2,
  },
  {
    id: "po-detail",
    path: "/purchase-orders/:id",
    capabilityIds: [
      "view_dashboard",
      "author_po",
      "approve_award",
      "view_finance",
      "admin",
    ],
    audiences: ["full"],
    minimumControls: 6,
    minimumFields: 5,
  },
];

export const PROCUREMENT_ROUTE_BY_ID = Object.fromEntries(
  PROCUREMENT_ROUTE_CONTRACTS.map((entry) => [entry.id, entry]),
) as Record<ProcurementRouteId, ProcurementRouteContract>;

export function procurementRoutesForAudience(
  audience: "full" | "approvals-only",
): ProcurementRouteContract[] {
  return PROCUREMENT_ROUTE_CONTRACTS.filter((entry) =>
    entry.audiences.includes(audience),
  );
}
