import type { KnowledgeContent, KnowledgeModule } from "./types";
import { WAREHOUSE_ROUTE_CONTRACTS } from "@intra/warehouse";
import { PROCUREMENT_ROUTE_CONTRACTS } from "@intra/procurement";
import { mountLegalRouteContracts } from "@intra/legal";
import { SHELL_PAGE_ROUTE_CONTRACTS } from "../routes";

export interface LiveRouteManifestEntry {
  route: string;
  module: KnowledgeModule;
  capabilityIds: string[];
  administratorRoleIds?: string[];
  minimumControls: number;
  minimumFields: number;
}

export interface KnowledgeCoverageReport {
  errors: string[];
  warnings: string[];
  routeCoverage: Map<string, string[]>;
}

type RouteSource = Omit<LiveRouteManifestEntry, "administratorRoleIds"> & {
  administratorRoleIds?: string[];
};

const routeSources: RouteSource[] = [
  ...SHELL_PAGE_ROUTE_CONTRACTS,
  ...WAREHOUSE_ROUTE_CONTRACTS.map((entry) => ({
    ...entry,
    route: entry.path === "/" ? "/warehouse" : `/warehouse${entry.path}`,
    module: "warehouse" as const,
  })),
  ...PROCUREMENT_ROUTE_CONTRACTS.map((entry) => ({
    ...entry,
    route: entry.path === "/" ? "/procurement" : `/procurement${entry.path}`,
    module: "procurement" as const,
  })),
  ...mountLegalRouteContracts("/legal", "legal"),
  ...mountLegalRouteContracts("/vendor", "vendor"),
];

const mergedRoutes = new Map<string, LiveRouteManifestEntry>();
for (const source of routeSources) {
  const existing = mergedRoutes.get(source.route);
  if (!existing) {
    mergedRoutes.set(source.route, {
      route: source.route,
      module: source.module as KnowledgeModule,
      capabilityIds: [...source.capabilityIds],
      administratorRoleIds: source.administratorRoleIds
        ? [...source.administratorRoleIds]
        : undefined,
      minimumControls: source.minimumControls,
      minimumFields: source.minimumFields,
    });
    continue;
  }
  if (existing.module !== source.module)
    throw new Error(
      `route ${source.route} has conflicting modules ${existing.module} and ${source.module}`,
    );
  existing.capabilityIds = [
    ...new Set([...existing.capabilityIds, ...source.capabilityIds]),
  ];
  const administratorRoleIds = [
    ...new Set([
      ...(existing.administratorRoleIds ?? []),
      ...(source.administratorRoleIds ?? []),
    ]),
  ];
  existing.administratorRoleIds = administratorRoleIds.length
    ? administratorRoleIds
    : undefined;
  existing.minimumControls = Math.max(
    existing.minimumControls,
    source.minimumControls,
  );
  existing.minimumFields = Math.max(
    existing.minimumFields,
    source.minimumFields,
  );
}

export const LIVE_ROUTE_MANIFEST: LiveRouteManifestEntry[] = [
  ...mergedRoutes.values(),
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
      const exactEntries = LIVE_ROUTE_MANIFEST.filter(
        (entry) => normalizeRoute(entry.route) === normalizeRoute(featureRoute),
      );
      const matchingEntries = exactEntries.length
        ? exactEntries
        : LIVE_ROUTE_MANIFEST.filter((entry) =>
            matchesRoute(entry.route, featureRoute),
          );
      if (matchingEntries.length === 0) {
        const message = `feature ${feature.id} references unknown route ${normalizeRoute(featureRoute)}`;
        if (isLive) errors.push(message);
        else warnings.push(`coming-soon ${message}`);
        continue;
      }
      for (const entry of matchingEntries) {
        if (isLive) {
          routeCoverage.get(entry.route)!.push(feature.id);
          if (feature.controls.length < entry.minimumControls)
            errors.push(
              `live feature ${feature.id} documents ${feature.controls.length} controls; route ${entry.route} requires at least ${entry.minimumControls}`,
            );
          if ((feature.fields?.length ?? 0) < entry.minimumFields)
            errors.push(
              `live feature ${feature.id} documents ${feature.fields?.length ?? 0} fields; route ${entry.route} requires at least ${entry.minimumFields}`,
            );
          for (const control of feature.controls)
            if (/,|\band\b/i.test(control.name))
              errors.push(
                `live feature ${feature.id} has combined control name ${control.name}`,
              );
          for (const field of feature.fields ?? [])
            if (/,|\band\b/i.test(field.name))
              errors.push(
                `live feature ${feature.id} has combined field name ${field.name}`,
              );
          for (const capability of feature.capabilityIds)
            if (!entry.capabilityIds.includes(capability))
              errors.push(
                `feature ${feature.id} claims capability ${capability} outside route ${entry.route}`,
              );
        } else
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
    const routeFeatures = liveFeatures.filter((feature) =>
      featureIds.includes(feature.id),
    );
    const documentedCapabilities = new Set(
      routeFeatures.flatMap((feature) => feature.capabilityIds),
    );
    for (const capability of entry.capabilityIds)
      if (!documentedCapabilities.has(capability))
        errors.push(
          `live route ${entry.route} capability ${capability} has no feature documentation`,
        );
  }

  return { errors, warnings, routeCoverage };
}
