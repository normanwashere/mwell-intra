import type { KnowledgeContent, KnowledgeModule } from "./types";

export interface LiveRouteManifestEntry {
  route: string;
  module: KnowledgeModule;
  capabilityIds: string[];
  administratorRoleIds?: string[];
}

export interface KnowledgeCoverageReport {
  errors: string[];
  warnings: string[];
  routeCoverage: Map<string, string[]>;
}

const route = (
  routePath: string,
  module: KnowledgeModule,
  capabilityIds: string[] = [],
  administratorRoleIds?: string[],
): LiveRouteManifestEntry => ({
  route: routePath,
  module,
  capabilityIds,
  administratorRoleIds,
});

export const LIVE_ROUTE_MANIFEST: LiveRouteManifestEntry[] = [
  route("/", "core", [
    "view_directory",
    "view_vendors",
    "view_documents",
    "view_approvals",
    "manage_notifications",
  ]),
  route("/login", "core"),
  route("/reset-password", "core"),
  route("/knowledge", "core"),
  route("/~offline", "core"),
  route(
    "/admin/users",
    "admin",
    ["manage_rbac", "view_audit", "manage_approvals", "record_approval"],
    ["platform_admin"],
  ),
  route(
    "/admin/doa",
    "admin",
    ["manage_doa"],
    ["platform_admin", "legal_admin"],
  ),

  route("/warehouse", "warehouse", ["view_dashboard"]),
  route("/warehouse/scan", "warehouse", [
    "receive_stock",
    "issue_items",
    "manage_returns",
    "cycle_count",
    "transfer_stock",
  ]),
  route("/warehouse/tasks", "warehouse", [
    "inspect_quality",
    "view_exceptions",
    "cycle_count",
  ]),
  route("/warehouse/inventory", "warehouse", [
    "manage_inventory",
    "manage_products",
  ]),
  route("/warehouse/inventory/:id", "warehouse", [
    "manage_inventory",
    "manage_products",
  ]),
  route("/warehouse/receiving", "warehouse", ["receive_stock"]),
  route("/warehouse/allocations", "warehouse", [
    "reserve_allocate",
    "issue_items",
  ]),
  route("/warehouse/returns", "warehouse", ["manage_returns"]),
  route("/warehouse/storage", "warehouse", [
    "receive_stock",
    "manage_locations",
    "transfer_stock",
    "cycle_count",
  ]),
  route("/warehouse/events", "warehouse", ["reserve_allocate", "view_finance"]),
  route("/warehouse/events/:id", "warehouse", [
    "reserve_allocate",
    "view_finance",
  ]),
  route("/warehouse/procurement", "warehouse", ["view_procurement"]),
  route("/warehouse/purchase-orders", "warehouse", [
    "view_procurement",
    "receive_stock",
  ]),
  route("/warehouse/cycle-counts", "warehouse", ["cycle_count"]),
  route("/warehouse/quality", "warehouse", [
    "inspect_quality",
    "release_quality_hold",
  ]),
  route("/warehouse/approvals", "warehouse", ["approve_stock_adjustment"]),
  route("/warehouse/exceptions", "warehouse", [
    "view_exceptions",
    "resolve_exceptions",
  ]),
  route("/warehouse/finance", "warehouse", ["view_finance"]),
  route("/warehouse/pricing", "warehouse", ["view_pricing", "set_pricing"]),
  route("/warehouse/data", "warehouse", ["view_analytics"]),
  route("/warehouse/reports", "warehouse", ["view_analytics", "view_finance"]),
  route("/warehouse/suppliers", "warehouse", ["view_procurement"]),
  route("/warehouse/locations", "warehouse", ["manage_locations"]),
  route("/warehouse/imports", "warehouse", ["import_warehouse_data"]),
  route("/warehouse/operation-routes", "warehouse", [
    "manage_operation_routes",
  ]),

  route("/procurement", "procurement", ["view_dashboard"]),
  route("/procurement/requests/new", "procurement", [
    "create_request",
    "manage_rfp",
  ]),
  route("/procurement/requests/:id", "procurement", [
    "view_dashboard",
    "approve_request",
    "approve_award",
    "view_finance",
    "manage_rfp",
  ]),
  route("/procurement/approvals", "procurement", [
    "approve_request",
    "approve_award",
  ]),
  route("/procurement/purchase-orders", "procurement", [
    "author_po",
    "approve_award",
    "view_finance",
    "admin",
  ]),
  route("/procurement/purchase-orders/:id", "procurement", [
    "author_po",
    "approve_award",
    "view_finance",
    "admin",
  ]),

  route("/legal", "legal", [
    "view_dashboard",
    "review_accreditation",
    "manage_accreditation",
    "view_vendors",
  ]),
  route("/legal/cases/:id", "legal", [
    "review_accreditation",
    "manage_checklist",
    "approve_accreditation",
    "manage_documents",
    "manage_accreditation",
    "manage_approvals",
    "record_approval",
  ]),
  route("/legal/cases/:id/application", "legal", [
    "review_accreditation",
    "manage_checklist",
  ]),
  route("/legal/cases/:id/sign/:code", "legal", [
    "manage_documents",
    "approve_accreditation",
  ]),
  route("/legal/invites/new", "legal", ["manage_checklist", "manage_vendors"]),

  route("/vendor", "vendor", ["view_own_accreditation"]),
  route("/vendor/cases/:id", "vendor", [
    "view_own_accreditation",
    "submit_documents",
    "submit_accreditation",
  ]),
  route("/vendor/cases/:id/application", "vendor", [
    "submit_accreditation",
    "view_own_accreditation",
  ]),
  route("/vendor/cases/:id/sign/:code", "vendor", [
    "submit_documents",
    "view_own_accreditation",
  ]),
  route("/vendor/invites/new", "vendor", ["view_own_accreditation"]),
];

function normalizeRoute(value: string): string {
  const pathname = value.split(/[?#]/, 1)[0] || "/";
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return withLeadingSlash.length > 1
    ? withLeadingSlash.replace(/\/+$/, "")
    : withLeadingSlash;
}

function matchesRoute(pattern: string, candidate: string): boolean {
  const patternParts = normalizeRoute(pattern).split("/");
  const candidateParts = normalizeRoute(candidate).split("/");
  return (
    patternParts.length === candidateParts.length &&
    patternParts.every(
      (part, index) => part.startsWith(":") || part === candidateParts[index],
    )
  );
}

const hasDocumentedText = (values: string[] | undefined): boolean =>
  Boolean(values?.length && values.every((value) => value.trim().length > 0));

export function buildKnowledgeCoverage(
  content: KnowledgeContent,
): KnowledgeCoverageReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const routeCoverage = new Map(
    LIVE_ROUTE_MANIFEST.map((entry) => [entry.route, [] as string[]]),
  );
  const liveFeatures = content.features.filter(
    (feature) => feature.availability !== "coming_soon",
  );

  for (const feature of content.features) {
    const isLive = feature.availability !== "coming_soon";
    if (isLive && feature.controls.length === 0)
      errors.push(`live feature ${feature.id} has no documented controls`);
    if (isLive && !hasDocumentedText(feature.reads))
      errors.push(`live feature ${feature.id} has no documented reads`);
    if (isLive && !hasDocumentedText(feature.writes))
      errors.push(`live feature ${feature.id} has no documented writes`);
    if (isLive && !hasDocumentedText(feature.statuses))
      errors.push(`live feature ${feature.id} has no documented statuses`);
    if (isLive && !hasDocumentedText(feature.notifications))
      errors.push(`live feature ${feature.id} has no documented notifications`);
    if (isLive && !hasDocumentedText(feature.exceptions))
      errors.push(`live feature ${feature.id} has no documented exceptions`);
    if (isLive && !hasDocumentedText(feature.completionEvidence))
      errors.push(
        `live feature ${feature.id} has no documented completion evidence`,
      );
    if (
      isLive &&
      (!feature.fields?.length ||
        feature.fields.some(
          (field) =>
            !field.name.trim() ||
            !field.purpose.trim() ||
            !field.validation.trim(),
        ))
    )
      errors.push(
        `live feature ${feature.id} has incomplete field documentation`,
      );

    for (const featureRoute of feature.routes) {
      const matchingEntries = LIVE_ROUTE_MANIFEST.filter((entry) =>
        matchesRoute(entry.route, featureRoute),
      );
      if (matchingEntries.length === 0) {
        const message = `feature ${feature.id} references unknown route ${normalizeRoute(featureRoute)}`;
        if (isLive) errors.push(message);
        else warnings.push(`coming-soon ${message}`);
        continue;
      }
      for (const entry of matchingEntries) {
        if (isLive) routeCoverage.get(entry.route)!.push(feature.id);
        else
          warnings.push(
            `coming-soon feature ${feature.id} references live route ${entry.route}`,
          );
      }
    }
  }

  for (const entry of LIVE_ROUTE_MANIFEST) {
    const featureIds = routeCoverage.get(entry.route)!;
    if (featureIds.length === 0)
      errors.push(
        `live route ${entry.route} has no live feature documentation`,
      );
    if (entry.administratorRoleIds && featureIds.length > 0) {
      const authorized = liveFeatures.some(
        (feature) =>
          featureIds.includes(feature.id) &&
          feature.roleIds.some((roleId) =>
            entry.administratorRoleIds!.includes(roleId),
          ),
      );
      if (!authorized)
        errors.push(
          `administrator route ${entry.route} is not assigned to an authorized administrator role`,
        );
    }
  }

  const documentedCapabilities = new Set(
    liveFeatures.flatMap((feature) => feature.capabilityIds),
  );
  const currentCapabilities = new Set(
    content.roles
      .filter((role) => role.availability !== "coming_soon")
      .flatMap((role) => role.authority.capabilities),
  );
  for (const capability of currentCapabilities)
    if (!documentedCapabilities.has(capability))
      errors.push(
        `live capability ${capability} has no live feature documentation`,
      );

  return { errors, warnings, routeCoverage };
}
