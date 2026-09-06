import type { KnowledgeContent, KnowledgeModule } from "./types";
import { WAREHOUSE_ROUTE_CONTRACTS } from "@intra/warehouse/navigation";
import { PROCUREMENT_ROUTE_CONTRACTS } from "@intra/procurement/routes";
import { mountLegalRouteContracts } from "@intra/legal/routes";
import { SHELL_PAGE_ROUTE_CONTRACTS } from "../routes";
import { outgoingEdges } from "./graph";

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

export function isCombinedControlName(featureId: string, name: string): boolean {
  // This exact Finance button opens one versioned correction editor.
  if (featureId === "warehouse-finance" && name === "Edit and resubmit") return false;
  return /,|\band\b/i.test(name);
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

/** Content inventory only. Accepted capture artifacts remain a separate release gate. */
export function validateTaskCoverage(content: KnowledgeContent) {
  const unmappedLiveControls: string[] = [];
  const unresolvedTargets: string[] = [];
  const missingActionEvidence: string[] = [];
  const flows = new Map(content.flows.map((flow) => [flow.id, flow]));
  const roles = new Set(content.roles.map((role) => role.id));
  const inventory = content.features.flatMap((feature) => {
    const executable = feature.availability !== "coming_soon";
    for (const id of feature.relatedFlowIds) {
      const flow = flows.get(id);
      if (!flow) unresolvedTargets.push(`${feature.id}:${id}`);
      else if (executable && flow.availability === "coming_soon")
        unresolvedTargets.push(`${feature.id}:${id}:coming_soon`);
    }
    for (const id of feature.roleIds)
      if (!roles.has(id)) unresolvedTargets.push(`${feature.id}:role:${id}`);
    return feature.controls.map((control) => {
      const key = `${feature.id}:${control.name}`;
      const mapped = [control.name, control.behavior, control.validation, control.result,
        feature.owner, feature.reviewedAt, ...feature.policyBasis].every((value) => value.trim())
        && feature.policyBasis.length > 0 && feature.routes.length > 0;
      if (executable && !mapped) unmappedLiveControls.push(key);
      const evidenceIds = content.evidence.filter((item) =>
        item.featureId === feature.id && item.desktopSrc && item.mobileSrc &&
        item.state.trim() && item.expectedLandmark.trim() &&
        item.hotspots.some((spot) => spot.label.trim() === control.name.trim() && spot.instruction.trim()),
      ).map((item) => item.id);
      if (executable && !evidenceIds.length) missingActionEvidence.push(key);
      return {
        key, featureId: feature.id, control: control.name,
        referenceId: `feature-${feature.id}`, availability: feature.availability,
        owner: feature.owner, roleIds: feature.roleIds, capabilityIds: feature.capabilityIds,
        routes: feature.routes, flowIds: feature.relatedFlowIds,
        prerequisite: control.validation, fields: feature.fields ?? [], result: control.result,
        nextOwnerRoleIds: [...new Set(feature.relatedFlowIds.flatMap((id) => {
          const flow = flows.get(id);
          return flow?.nodes.filter((node) => node.type === "handoff").flatMap((node) =>
            flow.edges.filter((edge) => edge.from === node.id).flatMap((edge) =>
              flow.nodes.find((target) => target.id === edge.to)?.ownerRoleIds ?? [])) ?? [];
        }))],
        recovery: feature.exceptions, policyReferences: feature.policyBasis,
        evidenceIds, mapped: Boolean(mapped), executable,
        // Metadata/control matches are not visual review, freshness or artifact verification.
        unverified: true as const,
      };
    });
  });
  // coverage is imported by the client feature catalog: keep graph checks pure,
  // without importing the filesystem-based release validator.
  const invalidDecisionBranches: string[] = [];
  for (const flow of content.flows) {
    const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
    const fail = (id: string, reason: string) => invalidDecisionBranches.push(`${flow.id}:${id}:${reason}`);
    if (!nodes.has(flow.startNodeId)) fail(flow.startNodeId, "missing start");
    for (const edge of flow.edges)
      if (!nodes.has(edge.from) || !nodes.has(edge.to)) fail(edge.from, `missing destination/source ${edge.to}`);
    const reachable = new Set<string>();
    const pending = [flow.startNodeId];
    while (pending.length) {
      const id = pending.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      pending.push(...outgoingEdges(flow, id).map((edge) => edge.to));
    }
    const terminating = new Set(flow.nodes.filter((node) => node.type === "terminal").map((node) => node.id));
    const reverse = [...terminating];
    while (reverse.length) {
      const id = reverse.pop()!;
      for (const edge of flow.edges.filter((item) => item.to === id)) {
        if (terminating.has(edge.from)) continue;
        terminating.add(edge.from);
        reverse.push(edge.from);
      }
    }
    for (const node of flow.nodes) {
      if (!reachable.has(node.id)) fail(node.id, "orphan");
      if (!terminating.has(node.id)) fail(node.id, "no terminal outcome");
      if (!node.ownerRoleIds.length || node.ownerRoleIds.some((id) => !roles.has(id))) fail(node.id, "unknown owner");
      if (node.type !== "decision") continue;
      const edges = outgoingEdges(flow, node.id);
      const labels = edges.map((edge) => edge.label?.trim().replace(/\s+/g, " ").toLowerCase());
      if (!roles.has(node.authorityRoleId) || !node.ownerRoleIds.includes(node.authorityRoleId) || !node.policyBasis.trim()) fail(node.id, "decision authority/policy");
      if (edges.length < 2 || labels.some((label) => !label) || new Set(labels).size !== edges.length) fail(node.id, "decision labels");
      const destinations = new Set(edges.map((edge) => edge.to));
      if (destinations.size !== edges.length && !(node.mergeContract?.justification.trim() && edges.filter((edge) => edge.to === node.mergeContract?.destinationNodeId).length >= 2)) fail(node.id, "decision destinations");
    }
  }
  unresolvedTargets.push(...buildKnowledgeCoverage(content).errors.filter((error) =>
    error.includes("unknown route") || error.includes("has no live feature documentation"),
  ));
  for (const flow of content.flows.filter((item) => item.availability !== "coming_soon")) {
    for (const node of flow.nodes.filter((item) => ["start", "action", "handoff"].includes(item.type))) {
      const evidence = content.evidence.find((item) => item.id === node.evidenceId && item.nodeId === node.id);
      if (!evidence?.desktopSrc || !evidence.mobileSrc || !evidence.hotspots.length)
        missingActionEvidence.push(`${flow.id}:${node.id}`);
    }
  }
  return {
    unmappedLiveControls, unresolvedTargets, missingActionEvidence, invalidDecisionBranches,
    inventory, unverified: true as const,
    counts: {
      features: content.features.length, controls: inventory.length,
      liveFeatures: content.features.filter((item) => item.availability === "live").length,
      limitedFeatures: content.features.filter((item) => item.availability === "limited").length,
      comingSoonFeatures: content.features.filter((item) => item.availability === "coming_soon").length,
      flows: content.flows.length, decisions: content.flows.reduce((n, flow) => n + flow.nodes.filter((node) => node.type === "decision").length, 0),
      policyReferences: new Set(content.features.flatMap((feature) => feature.policyBasis)).size,
      evidenceRecords: content.evidence.length,
      controlEvidenceMatches: inventory.filter((item) => item.evidenceIds.length).length,
    },
  };
}

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
            if (isCombinedControlName(feature.id, control.name))
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
