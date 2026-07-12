import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import type {
  KnowledgeCaptureArtifact,
  KnowledgeCaptureReport,
  KnowledgeCaptureReportEntry,
  KnowledgeContent,
  KnowledgeEvidence,
  KnowledgeFeature,
} from "./types";
import { edgeChoiceId } from "./graph";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const EXECUTABLE_NODE_TYPES = new Set(["start", "action", "handoff"]);
const AVAILABILITY = new Set(["live", "limited", "coming_soon"]);
const OUTCOMES = new Set([
  "complete",
  "revision",
  "rejected",
  "cancelled",
  "escalated",
]);

function isISODate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

function hasText(value: string | undefined): value is string {
  return Boolean(value?.trim());
}

function normalizeDecisionLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function hasProhibition(value: string): boolean {
  return /\b(do not|never|must not)\b/i.test(value);
}

function routeMatches(pattern: string, route: string): boolean {
  if (pattern === route) return true;
  if (pattern !== "/" && route.startsWith(`${pattern}/`)) return true;
  const patternSegments = pattern.split("/").filter(Boolean);
  const routeSegments = route.split("/").filter(Boolean);
  return (
    patternSegments.length === routeSegments.length &&
    patternSegments.every(
      (segment, index) =>
        segment.startsWith(":") || segment === routeSegments[index],
    )
  );
}

function roleCanAccessRoute(
  content: KnowledgeContent,
  roleId: string,
  route: string,
): boolean {
  const role = content.roles.find((candidate) => candidate.id === roleId);
  return Boolean(
    role?.authority.accessibleRoutes.some((pattern) =>
      routeMatches(pattern, route),
    ),
  );
}

interface FeatureSemanticMappingRule {
  id: string;
  signal?: RegExp;
  featureIds?: string[];
  requiredPolicy?: { id: string; signal: RegExp };
  requiredPolicies?: Array<{ id: string; signal: RegExp }>;
  requiredFlowIds: string[];
}

export const FEATURE_SEMANTIC_MAPPING_RULES: FeatureSemanticMappingRule[] = [
  {
    id: "pricing",
    signal:
      /\b(price revision|pricing|product price|current and prior prices|effective price|landed cost|margin context)\b/i,
    requiredPolicy: {
      id: "pricing-and-valuation",
      signal: /Pricing and valuation policy/i,
    },
    requiredFlowIds: ["pricing-and-costing"],
  },
  {
    id: "receiving",
    signal:
      /\b(warehouse receiving|goods receipt|linked receipts|source receipts|receipt evidence|receipt costing|receipt performance|receipt context|purchase order receipt|received quantities|partially received)\b/i,
    requiredFlowIds: ["receive-to-putaway"],
  },
  {
    id: "event-custody",
    signal:
      /\b(stock reservation|stock reservations|reservations and issues|event demand|event header|event inventory|event location|event-location|allocated stock|allocation return|stock allocation|reserved allocations|event fulfillment|event stock)\b/i,
    requiredPolicy: {
      id: "warehouse-custody",
      signal: /Warehouse custody policy/i,
    },
    requiredFlowIds: ["event-fulfillment"],
  },
  {
    id: "vendor-accreditation",
    signal:
      /\b(accreditation|vendor eligibility|accreditation case|vendor application|accreditation lifecycle|accreditation requirement|accreditation status|accreditation data|legal instrument)\b/i,
    requiredPolicy: {
      id: "vendor-accreditation",
      signal: /Vendor accreditation policy/i,
    },
    requiredFlowIds: ["vendor-accreditation"],
  },
  {
    id: "inventory-adjustment",
    signal:
      /\b(cycle count|physical count|stock adjustment|stock adjustments|count variance|variance records)\b/i,
    requiredPolicy: {
      id: "inventory-integrity",
      signal: /Inventory integrity policy/i,
    },
    requiredFlowIds: ["cycle-count-adjustment"],
  },
  {
    id: "warehouse-returns",
    signal:
      /\b(returned stock|warehouse returns|return context|return disposition|returns and outcomes|returned quantities)\b/i,
    requiredPolicy: {
      id: "inventory-integrity",
      signal: /Inventory integrity policy/i,
    },
    requiredFlowIds: ["returns-reconciliation"],
  },
  {
    id: "operational-exceptions",
    signal:
      /\b(warehouse exceptions|exception records|failed commands|blocked routes|idempotent command|operational failures)\b/i,
    requiredPolicy: {
      id: "operational-resilience",
      signal: /Operational resilience/i,
    },
    requiredFlowIds: ["exception-and-recovery"],
  },
  {
    id: "warehouse-data-comprehensive",
    featureIds: ["warehouse-data", "warehouse-reports"],
    requiredPolicies: [
      { id: "warehouse-control", signal: /Warehouse control policy/i },
      { id: "warehouse-custody", signal: /Warehouse custody policy/i },
      { id: "operational-resilience", signal: /Operational resilience/i },
      { id: "inventory-integrity", signal: /Inventory integrity policy/i },
      {
        id: "pricing-and-valuation",
        signal: /Pricing and valuation policy/i,
      },
    ],
    requiredFlowIds: [
      "receive-to-putaway",
      "event-fulfillment",
      "exception-and-recovery",
      "cycle-count-adjustment",
      "returns-reconciliation",
      "pricing-and-costing",
    ],
  },
];

function featureSemanticText(feature: KnowledgeFeature): string {
  return [
    feature.title,
    feature.purpose,
    ...feature.routes,
    ...feature.capabilityIds,
    ...feature.controls.flatMap((control) => [
      control.name,
      control.behavior,
      control.validation,
      control.result,
    ]),
    ...(feature.fields ?? []).flatMap((field) => [
      field.name,
      field.purpose,
      field.validation,
    ]),
    ...feature.reads,
    ...feature.writes,
    ...feature.statuses,
    ...(feature.notifications ?? []),
    ...feature.exceptions,
    ...(feature.completionEvidence ?? []),
  ].join(" ");
}

export function validateFeatureSemanticMappings(
  features: KnowledgeFeature[],
): string[] {
  const errors = new Set<string>();
  for (const feature of features) {
    const semanticText = featureSemanticText(feature);
    const policyText = (feature.policyBasis ?? []).join(" ");
    for (const rule of FEATURE_SEMANTIC_MAPPING_RULES) {
      const applies =
        Boolean(rule.featureIds?.includes(feature.id)) ||
        Boolean(rule.signal?.test(semanticText));
      if (!applies) continue;
      const requiredPolicies = [
        ...(rule.requiredPolicy ? [rule.requiredPolicy] : []),
        ...(rule.requiredPolicies ?? []),
      ];
      for (const policy of requiredPolicies)
        if (!policy.signal.test(policyText))
          errors.add(
            `feature ${feature.id} semantic mapping requires policy ${policy.id}`,
          );
      for (const flowId of rule.requiredFlowIds)
        if (!(feature.relatedFlowIds ?? []).includes(flowId))
          errors.add(
            `feature ${feature.id} semantic mapping requires flow ${flowId}`,
          );
    }
  }
  return [...errors];
}

export function validateKnowledgeContent(content: KnowledgeContent): string[] {
  const errors: string[] = [];
  const roleIds = new Set(content.roles.map((role) => role.id));
  const flowIds = new Set(content.flows.map((flow) => flow.id));
  const evidenceIds = new Set<string>();
  const nodeContexts = new Map(
    content.flows.flatMap((flow) =>
      flow.nodes.map((node) => [node.id, { flow, node }] as const),
    ),
  );
  const imageContexts = new Map<string, string>();

  for (const role of content.roles) {
    if (!AVAILABILITY.has(role.availability))
      errors.push(`role ${role.id} has invalid availability`);
    if (Boolean(role.rbacModule) !== Boolean(role.rbacRole))
      errors.push(`role ${role.id} has incomplete RBAC coordinates`);
    if (role.availability === "live" && !role.dailyTasks?.length)
      errors.push(`role ${role.id} has no daily tasks`);
    if (role.availability === "live" && !role.responsibilityStages?.length)
      errors.push(`role ${role.id} has no responsibility stages`);
    for (const task of role.dailyTasks ?? [])
      if (!hasText(task))
        errors.push(`role ${role.id} has an empty daily task`);
    for (const stage of role.responsibilityStages ?? []) {
      if (!hasText(stage.title))
        errors.push(
          `role ${role.id} has a responsibility stage without a title`,
        );
      if (!hasText(stage.responsibility))
        errors.push(
          `role ${role.id} has a responsibility stage without responsibility`,
        );
      if (!hasText(stage.outcome))
        errors.push(
          `role ${role.id} has a responsibility stage without an outcome`,
        );
    }

    const authority = role.authority;
    if (!authority) {
      errors.push(`role ${role.id} has no authority profile`);
      continue;
    }
    if (role.availability === "live" && !authority.capabilities.length)
      errors.push(`role ${role.id} has no capability profile`);
    for (const route of authority.accessibleRoutes)
      if (!route.startsWith("/"))
        errors.push(`role ${role.id} has invalid accessible route ${route}`);
    for (const relatedRoleId of [
      ...authority.upstreamRoleIds,
      ...authority.downstreamRoleIds,
    ])
      if (!roleIds.has(relatedRoleId))
        errors.push(
          `role ${role.id} references unknown authority role ${relatedRoleId}`,
        );
    if (!hasText(authority.escalation))
      errors.push(`role ${role.id} has no escalation path`);
  }

  const liveRoutes = new Set(
    content.articles.flatMap((article) => article.liveRoutes),
  );
  const featureIds = new Set<string>();
  for (const feature of content.features) {
    if (featureIds.has(feature.id))
      errors.push(`duplicate feature id ${feature.id}`);
    featureIds.add(feature.id);
    if (!AVAILABILITY.has(feature.availability))
      errors.push(`feature ${feature.id} has invalid availability`);
    if (!isISODate(feature.reviewedAt))
      errors.push(`feature ${feature.id} has invalid review date`);
    for (const route of feature.routes)
      if (!route.startsWith("/"))
        errors.push(`feature ${feature.id} has invalid route ${route}`);
    for (const roleId of feature.roleIds)
      if (!roleIds.has(roleId))
        errors.push(`feature ${feature.id} references unknown role ${roleId}`);
    if (!feature.policyBasis?.length)
      errors.push(`feature ${feature.id} has no policy basis`);
    for (const policy of feature.policyBasis ?? [])
      if (!hasText(policy))
        errors.push(`feature ${feature.id} has an empty policy basis`);
    for (const flowId of feature.relatedFlowIds ?? [])
      if (!flowIds.has(flowId))
        errors.push(`feature ${feature.id} references unknown flow ${flowId}`);
    if (!feature.controls.length)
      errors.push(`feature ${feature.id} has no controls`);
    for (const control of feature.controls)
      for (const [name, value] of Object.entries(control))
        if (!hasText(value))
          errors.push(`feature ${feature.id} control has no ${name}`);
    if (
      feature.availability === "coming_soon" &&
      feature.routes.some((route) => liveRoutes.has(route))
    )
      for (const route of feature.routes)
        if (liveRoutes.has(route))
          errors.push(
            `feature ${feature.id} is coming soon but covers live route ${route}`,
          );
  }

  errors.push(...validateFeatureSemanticMappings(content.features));

  for (const evidence of content.evidence) {
    if (evidenceIds.has(evidence.id))
      errors.push(`duplicate evidence id ${evidence.id}`);
    evidenceIds.add(evidence.id);
    if (!roleIds.has(evidence.roleId))
      errors.push(`${evidence.id} references unknown role ${evidence.roleId}`);
    if (!evidence.desktopSrc.startsWith("/knowledge/"))
      errors.push(`${evidence.id} has invalid desktop screenshot path`);
    if (!evidence.mobileSrc)
      errors.push(`${evidence.id} requires a mobile screenshot`);
    else if (!evidence.mobileSrc.startsWith("/knowledge/"))
      errors.push(`${evidence.id} has invalid mobile screenshot path`);
    if (!isISODate(evidence.capturedAt) || !isISODate(evidence.reviewedAt))
      errors.push(`${evidence.id} has invalid evidence date`);
    if (!GIT_COMMIT.test(evidence.appCommit))
      errors.push(`${evidence.id} has invalid app commit provenance`);
    if (!hasText(evidence.state))
      errors.push(`${evidence.id} has no deterministic capture state`);
    if (!hasText(evidence.expectedLandmark))
      errors.push(`${evidence.id} has no expected landmark`);
    if (!evidence.sensitiveDataReviewed)
      errors.push(`${evidence.id} has not completed sensitive-data review`);

    const nodeContext = nodeContexts.get(evidence.nodeId);
    if (!nodeContext)
      errors.push(`${evidence.id} references unknown node ${evidence.nodeId}`);
    else {
      if (!nodeContext.node.ownerRoleIds.includes(evidence.roleId))
        errors.push(
          `${evidence.id} role ${evidence.roleId} does not own ${nodeContext.flow.id}:${evidence.nodeId}`,
        );
      if (
        nodeContext.node.databaseEffect &&
        evidence.expectedDatabaseEffect !== nodeContext.node.databaseEffect
      )
        errors.push(
          `${evidence.id} does not match its expected database effect`,
        );
    }
    if (!roleCanAccessRoute(content, evidence.roleId, evidence.route))
      errors.push(
        `${evidence.id} route ${evidence.route} is not accessible to role ${evidence.roleId}`,
      );

    const sharingContext = [
      evidence.roleId,
      evidence.route,
      evidence.state,
      evidence.expectedLandmark,
      evidence.hotspots.map((hotspot) => hotspot.label).join("|"),
    ].join("\u0000");
    for (const source of [evidence.desktopSrc, evidence.mobileSrc].filter(
      Boolean,
    )) {
      const existingContext = imageContexts.get(source);
      if (existingContext && existingContext !== sharingContext)
        errors.push(
          `${evidence.id} reuses ${source} for a different capture context`,
        );
      else imageContexts.set(source, sharingContext);
    }

    const hotspotNumbers = new Set<number>();
    const hotspotIds = new Set<string>();
    for (const hotspot of evidence.hotspots) {
      if (hotspotNumbers.has(hotspot.number))
        errors.push(
          `${evidence.id} has duplicate hotspot number ${hotspot.number}`,
        );
      if (hotspotIds.has(hotspot.id))
        errors.push(`${evidence.id} has duplicate hotspot id ${hotspot.id}`);
      hotspotNumbers.add(hotspot.number);
      hotspotIds.add(hotspot.id);
      if (hotspot.x < 0 || hotspot.x > 1 || hotspot.y < 0 || hotspot.y > 1)
        errors.push(
          `${evidence.id}:${hotspot.id} hotspot coordinates must be between 0 and 1`,
        );
      if (hotspot.mobileX < 0 || hotspot.mobileX > 1)
        errors.push(
          `${evidence.id}:${hotspot.id} mobile hotspot coordinates must be between 0 and 1`,
        );
      if (hotspot.mobileY < 0 || hotspot.mobileY > 1)
        errors.push(
          `${evidence.id}:${hotspot.id} mobile hotspot coordinates must be between 0 and 1`,
        );
    }
  }

  for (const article of content.articles) {
    if (!AVAILABILITY.has(article.availability))
      errors.push(`${article.id} has invalid article availability`);
    if (!isISODate(article.reviewedAt))
      errors.push(`${article.id} has invalid article review date`);
    for (const route of article.liveRoutes)
      if (!route.startsWith("/"))
        errors.push(`${article.id} has invalid route ${route}`);
      else if (
        !content.features.some(
          (feature) =>
            feature.availability !== "coming_soon" &&
            feature.routes.some((pattern) => routeMatches(pattern, route)),
        )
      )
        errors.push(`${article.id} links unregistered live route ${route}`);
    if (article.availability === "coming_soon" && article.liveRoutes.length)
      errors.push(`${article.id} is coming soon but links a live route`);
    for (const section of article.sections)
      for (const step of section.steps ?? []) {
        for (const roleId of step.ownerRoleIds)
          if (!roleIds.has(roleId))
            errors.push(
              `${article.id}:${step.title} references unknown role ${roleId}`,
            );
        if (step.evidenceId && !evidenceIds.has(step.evidenceId))
          errors.push(
            `${article.id}:${step.title} references missing evidence ${step.evidenceId}`,
          );
        for (const prohibitedAction of step.prohibitedActions ?? [])
          if (!hasProhibition(prohibitedAction))
            errors.push(
              `${article.id}:${step.title} prohibited action must state a prohibition`,
            );
      }
  }

  for (const flow of content.flows) {
    const nodeIds = new Set<string>();
    for (const item of flow.nodes) {
      if (nodeIds.has(item.id))
        errors.push(`${flow.id} has duplicate node id ${item.id}`);
      nodeIds.add(item.id);
      for (const roleId of item.ownerRoleIds)
        if (!roleIds.has(roleId))
          errors.push(
            `${flow.id}:${item.id} references unknown role ${roleId}`,
          );
      if (item.evidenceId && !evidenceIds.has(item.evidenceId))
        errors.push(
          `${flow.id}:${item.id} references missing evidence ${item.evidenceId}`,
        );
      if (
        EXECUTABLE_NODE_TYPES.has(item.type) &&
        item.ownerRoleIds.some(
          (roleId) =>
            content.roles.find((role) => role.id === roleId)?.availability ===
            "live",
        ) &&
        !item.evidenceId
      )
        errors.push(`flow ${flow.id}:${item.id} requires screenshot evidence`);
      if (item.type === "decision") {
        if (!hasText(item.authorityRoleId))
          errors.push(`flow ${flow.id}:${item.id} has no authority`);
        else if (!roleIds.has(item.authorityRoleId))
          errors.push(
            `flow ${flow.id}:${item.id} references unknown authority ${item.authorityRoleId}`,
          );
        else if (!item.ownerRoleIds.includes(item.authorityRoleId))
          errors.push(
            `flow ${flow.id}:${item.id} authority must own the decision`,
          );
        if (!hasText(item.policyBasis))
          errors.push(`flow ${flow.id}:${item.id} has no policy basis`);
      }
      if (item.type === "terminal") {
        if (!item.terminalOutcome || !OUTCOMES.has(item.terminalOutcome))
          errors.push(
            `flow ${flow.id}:${item.id} has invalid terminal outcome`,
          );
      }
    }

    if (!nodeIds.has(flow.startNodeId)) {
      errors.push(`${flow.id} has unknown start node ${flow.startNodeId}`);
      continue;
    }

    const outgoing = new Map<string, typeof flow.edges>();
    const incoming = new Map<string, typeof flow.edges>();
    const edgeChoiceIds = new Set<string>();
    for (const edge of flow.edges) {
      const choiceId = edgeChoiceId(flow, edge);
      if (edgeChoiceIds.has(choiceId))
        errors.push(`${flow.id} has duplicate edge choice id ${choiceId}`);
      edgeChoiceIds.add(choiceId);
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        errors.push(`${flow.id} has invalid edge ${edge.from}->${edge.to}`);
        continue;
      }
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
      incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
      const source = flow.nodes.find((item) => item.id === edge.from);
      if (source?.type === "decision" && !edge.label?.trim())
        errors.push(
          `${flow.id}:${edge.from} decision edge to ${edge.to} requires a label`,
        );
    }

    for (const item of flow.nodes) {
      if (item.type !== "decision") continue;
      const branches = outgoing.get(item.id) ?? [];
      if (branches.length < 2)
        errors.push(
          `flow ${flow.id}:${item.id} decision requires at least two outcomes`,
        );

      const labelCounts = new Map<string, number>();
      for (const branch of branches) {
        if (!branch.label?.trim()) continue;
        const label = normalizeDecisionLabel(branch.label);
        labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
      }
      if (labelCounts.size < 2)
        errors.push(
          `flow ${flow.id}:${item.id} decision requires at least two unique outcome labels`,
        );
      for (const [label, count] of labelCounts)
        if (count > 1)
          errors.push(
            `flow ${flow.id}:${item.id} decision has duplicate outcome label "${label}"`,
          );

      const destinationCounts = new Map<string, number>();
      for (const branch of branches)
        destinationCounts.set(
          branch.to,
          (destinationCounts.get(branch.to) ?? 0) + 1,
        );

      const mergeContract = item.mergeContract;
      const mergeCount = mergeContract
        ? (destinationCounts.get(mergeContract.destinationNodeId) ?? 0)
        : 0;
      const validMergeContract = Boolean(
        mergeContract &&
        hasText(mergeContract.justification) &&
        mergeCount >= 2,
      );
      if (mergeContract && !hasText(mergeContract.justification))
        errors.push(
          `flow ${flow.id}:${item.id} merge contract has no justification`,
        );
      if (mergeContract && mergeCount < 2)
        errors.push(
          `flow ${flow.id}:${item.id} merge contract destination ${mergeContract.destinationNodeId} is not shared by at least two outcomes`,
        );

      if (destinationCounts.size < 2 && !validMergeContract)
        errors.push(
          `flow ${flow.id}:${item.id} decision requires at least two distinct destinations`,
        );
      for (const [destination, count] of destinationCounts)
        if (
          count > 1 &&
          (!validMergeContract ||
            mergeContract?.destinationNodeId !== destination)
        )
          errors.push(
            `flow ${flow.id}:${item.id} decision has duplicate destination ${destination} without a merge contract`,
          );
    }

    for (const item of flow.nodes)
      if (item.type !== "terminal" && !outgoing.get(item.id)?.length)
        errors.push(`${flow.id}:${item.id} is a non-terminal dead end`);

    const reachable = new Set<string>();
    const queue = [flow.startNodeId];
    while (queue.length) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const edge of outgoing.get(id) ?? []) queue.push(edge.to);
    }
    for (const item of flow.nodes)
      if (!reachable.has(item.id))
        errors.push(`${flow.id}:${item.id} is unreachable from start`);

    const reachesTerminal = new Set(
      flow.nodes
        .filter((item) => item.type === "terminal")
        .map((item) => item.id),
    );
    const reverseQueue = [...reachesTerminal];
    while (reverseQueue.length) {
      const id = reverseQueue.shift()!;
      for (const edge of incoming.get(id) ?? [])
        if (!reachesTerminal.has(edge.from)) {
          reachesTerminal.add(edge.from);
          reverseQueue.push(edge.from);
        }
    }
    for (const item of flow.nodes)
      if (reachable.has(item.id) && !reachesTerminal.has(item.id))
        errors.push(`${flow.id}:${item.id} cannot reach a terminal outcome`);
  }

  return errors;
}

interface EvidenceArtifactValidationOptions {
  publicRoot: string;
  repositoryRoot: string;
  reportPath: string;
}

function decodePng(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature))
    throw new Error("invalid PNG signature");

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  const imageData: Buffer[] = [];
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new Error("truncated PNG chunk");
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      if (length !== 13) throw new Error("invalid PNG header");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === "IDAT") imageData.push(data);
    else if (type === "IEND") {
      ended = true;
      break;
    }
    offset = dataEnd + 4;
  }
  if (!width || !height || !imageData.length || !ended || interlace !== 0)
    throw new Error("incomplete or unsupported PNG");
  const channels = new Map([
    [0, 1],
    [2, 3],
    [3, 1],
    [4, 2],
    [6, 4],
  ]).get(colorType);
  if (!channels) throw new Error("unsupported PNG color type");
  const decoded = inflateSync(Buffer.concat(imageData));
  const rowBytes = Math.ceil((width * channels * bitDepth) / 8) + 1;
  if (decoded.length !== rowBytes * height)
    throw new Error("invalid PNG raster");
  return { width, height };
}

export function validateKnowledgeEvidenceArtifacts(
  content: KnowledgeContent,
  { publicRoot, repositoryRoot, reportPath }: EvidenceArtifactValidationOptions,
): string[] {
  const errors: string[] = [];
  const commits = new Set(
    content.evidence.map((evidence) => evidence.appCommit),
  );
  for (const commit of commits) validateCommit(commit, repositoryRoot, errors);
  let report: KnowledgeCaptureReport | undefined;
  try {
    const parsed = JSON.parse(readFileSync(reportPath, "utf8")) as unknown;
    if (isCaptureReport(parsed)) report = parsed;
  } catch {
    // The per-evidence migration errors below identify the complete recapture set.
  }

  if (!report) {
    for (const evidence of content.evidence)
      errors.push(`${evidence.id} requires capture report schema v1 metadata`);
    return errors;
  }

  if (report.evidenceCount !== content.evidence.length)
    errors.push("capture report evidence count mismatch");
  validateCommit(report.sourceCommit, repositoryRoot, errors);
  if (
    content.evidence.some(
      (evidence) =>
        evidence.capturedAt !== report.capturedAt ||
        evidence.reviewedAt !== report.reviewedAt,
    )
  )
    errors.push("capture report dates do not match evidence metadata");
  const expectedIds = new Set(content.evidence.map((evidence) => evidence.id));
  for (const id of Object.keys(report.evidence))
    if (!expectedIds.has(id))
      errors.push(`capture report has unknown evidence ${id}`);

  if (commits.size !== 1 || !commits.has(report.sourceCommit))
    errors.push(
      "capture report sourceCommit does not match evidence source commit",
    );

  const hashes = new Map<
    string,
    Array<{ evidence: KnowledgeEvidence; kind: string }>
  >();
  for (const evidence of content.evidence) {
    const entry = report.evidence[evidence.id];
    if (!entry) {
      errors.push(`${evidence.id} requires capture report schema v1 metadata`);
      continue;
    }
    validateCaptureSemantics(evidence, entry, errors);
    for (const [kind, source, expected] of [
      ["desktop", evidence.desktopSrc, entry.desktop],
      ["mobile", evidence.mobileSrc, entry.mobile],
    ] as const) {
      const root = path.resolve(publicRoot);
      const file = path.resolve(root, `.${source}`);
      if (!file.startsWith(`${root}${path.sep}`)) {
        errors.push(`${evidence.id} has an unsafe ${kind} screenshot path`);
        continue;
      }
      try {
        const dimensions = decodePng(file);
        const hash = createHash("sha256")
          .update(readFileSync(file))
          .digest("hex");
        if (expected.file !== source)
          errors.push(`${evidence.id} ${kind} capture file mismatch`);
        if (hash !== expected.sha256)
          errors.push(`${evidence.id} ${kind} SHA-256 mismatch`);
        if (
          dimensions.width !== expected.width ||
          dimensions.height !== expected.height
        )
          errors.push(`${evidence.id} ${kind} dimensions mismatch`);
        const viewport =
          kind === "desktop"
            ? { width: 1440, height: 900 }
            : { width: 390, height: 844 };
        if (
          dimensions.width !== viewport.width ||
          dimensions.height !== viewport.height
        )
          errors.push(
            `${evidence.id} ${kind} screenshot must be ${viewport.width}x${viewport.height}, received ${dimensions.width}x${dimensions.height}`,
          );
        const hashKey = `${kind}\u0000${hash}`;
        const matches = hashes.get(hashKey) ?? [];
        matches.push({ evidence, kind });
        hashes.set(hashKey, matches);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(
          `${evidence.id} cannot decode ${kind} screenshot: ${message}`,
        );
      }
    }
  }

  for (const matches of hashes.values()) {
    if (matches.length < 2) continue;
    const [first, ...duplicates] = matches;
    for (const duplicate of duplicates) {
      const sameGroup =
        Boolean(first!.evidence.sharedEvidenceGroup) &&
        first!.evidence.sharedEvidenceGroup ===
          duplicate.evidence.sharedEvidenceGroup;
      const sameSemantics =
        evidenceSharingContext(first!.evidence) ===
        evidenceSharingContext(duplicate.evidence);
      if (!sameGroup || !sameSemantics)
        errors.push(
          `${duplicate.evidence.id} has duplicate ${duplicate.kind} bytes with ${first!.evidence.id} without an identical sharedEvidenceGroup context`,
        );
    }
  }
  return errors;
}

function validateCommit(
  commit: string,
  repositoryRoot: string,
  errors: string[],
): void {
  if (!GIT_COMMIT.test(commit)) return;
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
      cwd: repositoryRoot,
      stdio: "ignore",
    });
  } catch {
    errors.push(
      `evidence app commit ${commit} is not valid in this repository`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isCaptureArtifact(value: unknown): value is KnowledgeCaptureArtifact {
  if (
    !isRecord(value) ||
    !isRecord(value.controlBounds) ||
    !isRecord(value.hotspot)
  )
    return false;
  const bounds = value.controlBounds;
  return (
    typeof value.file === "string" &&
    typeof value.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(value.sha256) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    ["x", "y", "width", "height"].every((key) => isFiniteNumber(bounds[key])) &&
    isFiniteNumber(value.hotspot.x) &&
    isFiniteNumber(value.hotspot.y)
  );
}

function isCaptureEntry(value: unknown): value is KnowledgeCaptureReportEntry {
  if (!isRecord(value) || !isRecord(value.control)) return false;
  return (
    typeof value.route === "string" &&
    typeof value.roleId === "string" &&
    typeof value.state === "string" &&
    typeof value.control.id === "string" &&
    typeof value.control.label === "string" &&
    typeof value.control.instruction === "string" &&
    isCaptureArtifact(value.desktop) &&
    isCaptureArtifact(value.mobile)
  );
}

function isCaptureReport(value: unknown): value is KnowledgeCaptureReport {
  if (!isRecord(value) || !isRecord(value.evidence)) return false;
  return (
    value.schemaVersion === 1 &&
    typeof value.sourceCommit === "string" &&
    GIT_COMMIT.test(value.sourceCommit) &&
    typeof value.capturedAt === "string" &&
    typeof value.reviewedAt === "string" &&
    isFiniteNumber(value.evidenceCount) &&
    Object.values(value.evidence).every(isCaptureEntry)
  );
}

function evidenceSharingContext(evidence: KnowledgeEvidence): string {
  const control = evidence.hotspots[0];
  return [
    evidence.roleId,
    evidence.route,
    evidence.state,
    control?.id,
    control?.label,
    control?.instruction,
  ].join("\u0000");
}

function validateCaptureSemantics(
  evidence: KnowledgeEvidence,
  entry: KnowledgeCaptureReportEntry,
  errors: string[],
): void {
  if (entry.route !== evidence.route)
    errors.push(`${evidence.id} capture report route mismatch`);
  if (entry.roleId !== evidence.roleId)
    errors.push(`${evidence.id} capture report role mismatch`);
  if (entry.state !== evidence.state)
    errors.push(`${evidence.id} capture report state mismatch`);
  const control = evidence.hotspots[0];
  if (
    !control ||
    entry.control.id !== control.id ||
    entry.control.label !== control.label ||
    entry.control.instruction !== control.instruction
  )
    errors.push(`${evidence.id} capture report control mismatch`);

  for (const [kind, artifact, x, y] of [
    ["desktop", entry.desktop, control?.x, control?.y],
    ["mobile", entry.mobile, control?.mobileX, control?.mobileY],
  ] as const) {
    const bounds = artifact.controlBounds;
    if (
      bounds.x < 0 ||
      bounds.y < 0 ||
      bounds.width <= 0 ||
      bounds.height <= 0 ||
      bounds.x + bounds.width > artifact.width ||
      bounds.y + bounds.height > artifact.height
    )
      errors.push(`${evidence.id} ${kind} control bounds are invalid`);
    const derivedX = Number(
      ((bounds.x + bounds.width / 2) / artifact.width).toFixed(4),
    );
    const derivedY = Number(
      ((bounds.y + bounds.height / 2) / artifact.height).toFixed(4),
    );
    if (
      artifact.hotspot.x !== x ||
      artifact.hotspot.y !== y ||
      typeof x !== "number" ||
      typeof y !== "number" ||
      Math.abs(derivedX - x) >= 0.0005 ||
      Math.abs(derivedY - y) >= 0.0005
    )
      errors.push(`${evidence.id} ${kind} hotspot mismatch`);
  }
}

export function validateKnowledgeBase(content: KnowledgeContent): string[] {
  const errors: string[] = validateKnowledgeContent(content);
  const roleIds = new Set(content.roles.map((role) => role.id));
  const articleIds = new Set<string>();
  const slugs = new Set<string>();
  const flowIds = new Set(content.flows.map((flow) => flow.id));

  for (const article of content.articles) {
    if (articleIds.has(article.id))
      errors.push(`Duplicate article id: ${article.id}`);
    if (slugs.has(article.slug))
      errors.push(`Duplicate article slug: ${article.slug}`);
    articleIds.add(article.id);
    slugs.add(article.slug);
    if (!AVAILABILITY.has(article.availability))
      errors.push(`Article ${article.id} has invalid availability`);
    for (const role of article.roles)
      if (!roleIds.has(role))
        errors.push(`Article ${article.id} references unknown role ${role}`);
    for (const route of article.liveRoutes)
      if (!route.startsWith("/"))
        errors.push(`Article ${article.id} has invalid route ${route}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(article.reviewedAt))
      errors.push(`Article ${article.id} has invalid review date`);
  }
  for (const article of content.articles) {
    for (const id of article.relatedArticleIds)
      if (!articleIds.has(id))
        errors.push(`Article ${article.id} links unknown article ${id}`);
    for (const id of article.flowIds)
      if (!flowIds.has(id))
        errors.push(`Article ${article.id} links unknown flow ${id}`);
  }
  for (const flow of content.flows) {
    const nodes = new Map(flow.nodes.map((item) => [item.id, item]));
    if (!nodes.has(flow.startNodeId))
      errors.push(`Flow ${flow.id} has unknown start node`);
    if (!flow.nodes.some((item) => item.type === "terminal"))
      errors.push(`Flow ${flow.id} has no terminal node`);
    for (const role of flow.roles)
      if (!roleIds.has(role))
        errors.push(`Flow ${flow.id} references unknown role ${role}`);
    for (const edge of flow.edges)
      if (!nodes.has(edge.from) || !nodes.has(edge.to))
        errors.push(
          `Flow ${flow.id} has invalid edge ${edge.from}->${edge.to}`,
        );
  }
  for (const role of content.roles) {
    if (!content.articles.some((article) => article.roles.includes(role.id)))
      errors.push(`Role ${role.id} has no article`);
    if (!content.flows.some((flow) => flow.roles.includes(role.id)))
      errors.push(`Role ${role.id} has no flow`);
  }
  return [...new Set(errors)];
}
