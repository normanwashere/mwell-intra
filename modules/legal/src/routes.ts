export type LegalRouteId =
  "cases" | "case-detail" | "application" | "sign-instrument" | "invite-vendor";

export interface LegalRouteContract {
  id: LegalRouteId;
  path: string;
  internalCapabilityIds: string[];
  vendorCapabilityIds: string[];
  internalMinimumControls: number;
  internalMinimumFields: number;
  vendorMinimumControls: number;
  vendorMinimumFields: number;
}

export const LEGAL_ROUTE_CONTRACTS: LegalRouteContract[] = [
  {
    id: "cases",
    path: "/",
    internalCapabilityIds: ["view_dashboard"],
    vendorCapabilityIds: ["view_own_accreditation"],
    internalMinimumControls: 3,
    internalMinimumFields: 2,
    vendorMinimumControls: 2,
    vendorMinimumFields: 2,
  },
  {
    id: "case-detail",
    path: "/cases/:id",
    internalCapabilityIds: [
      "view_dashboard",
      "review_accreditation",
      "approve_accreditation",
    ],
    vendorCapabilityIds: [
      "view_own_accreditation",
      "submit_documents",
      "submit_accreditation",
    ],
    internalMinimumControls: 6,
    internalMinimumFields: 4,
    vendorMinimumControls: 5,
    vendorMinimumFields: 4,
  },
  {
    id: "application",
    path: "/cases/:id/application",
    internalCapabilityIds: ["view_dashboard"],
    vendorCapabilityIds: ["view_own_accreditation", "submit_accreditation"],
    internalMinimumControls: 2,
    internalMinimumFields: 3,
    vendorMinimumControls: 4,
    vendorMinimumFields: 8,
  },
  {
    id: "sign-instrument",
    path: "/cases/:id/sign/:code",
    internalCapabilityIds: ["view_dashboard"],
    vendorCapabilityIds: ["view_own_accreditation", "submit_documents"],
    internalMinimumControls: 2,
    internalMinimumFields: 3,
    vendorMinimumControls: 3,
    vendorMinimumFields: 4,
  },
  {
    id: "invite-vendor",
    path: "/invites/new",
    internalCapabilityIds: ["view_dashboard", "manage_checklist"],
    vendorCapabilityIds: ["view_own_accreditation"],
    internalMinimumControls: 3,
    internalMinimumFields: 8,
    vendorMinimumControls: 2,
    vendorMinimumFields: 2,
  },
];

export const LEGAL_ROUTE_BY_ID = Object.fromEntries(
  LEGAL_ROUTE_CONTRACTS.map((entry) => [entry.id, entry]),
) as Record<LegalRouteId, LegalRouteContract>;

export function mountLegalRouteContracts(
  basename: "/legal" | "/vendor",
  module: "legal" | "vendor",
) {
  const vendor = module === "vendor";
  return LEGAL_ROUTE_CONTRACTS.map((entry) => ({
    route: entry.path === "/" ? basename : `${basename}${entry.path}`,
    module,
    capabilityIds: vendor
      ? entry.vendorCapabilityIds
      : entry.internalCapabilityIds,
    minimumControls: vendor
      ? entry.vendorMinimumControls
      : entry.internalMinimumControls,
    minimumFields: vendor
      ? entry.vendorMinimumFields
      : entry.internalMinimumFields,
  }));
}
