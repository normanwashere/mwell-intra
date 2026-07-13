import type {
  KnowledgeContent,
  KnowledgeHotspot,
  KnowledgeModule,
} from "./types";

export const KNOWLEDGE_CAPTURE_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

export interface KnowledgeEvidenceRequirement {
  evidenceId: string;
  workflowId: string;
  nodeId: string;
  module: KnowledgeModule;
  roleId: string;
  route: string;
  state: string;
  expectedLandmark: string;
  targetKey: string;
  sourceCommit: string;
  environment: "production";
  desktop: {
    src: string;
    width: number;
    height: number;
  };
  mobile: {
    src: string;
    width: number;
    height: number;
  };
  hotspots: KnowledgeHotspot[];
}

const EXECUTABLE_NODE_TYPES = new Set(["start", "action", "handoff"]);

function routeModule(route: string): KnowledgeModule {
  const segment = route.split("/").filter(Boolean)[0];
  if (
    segment === "warehouse" ||
    segment === "procurement" ||
    segment === "legal" ||
    segment === "vendor" ||
    segment === "admin"
  )
    return segment;
  return "core";
}

export function evidenceRequirements(
  content: KnowledgeContent,
): KnowledgeEvidenceRequirement[] {
  const evidenceById = new Map(content.evidence.map((item) => [item.id, item]));

  return content.flows.flatMap((workflow) => {
    if (workflow.availability !== "live") return [];
    return workflow.nodes
      .filter((node) => EXECUTABLE_NODE_TYPES.has(node.type))
      .map((node) => {
        if (!node.evidenceId)
          throw new Error(`${workflow.id}:${node.id} has no evidenceId`);
        const evidence = evidenceById.get(node.evidenceId);
        if (!evidence)
          throw new Error(
            `${workflow.id}:${node.id} references missing evidence ${node.evidenceId}`,
          );
        return {
          evidenceId: evidence.id,
          workflowId: workflow.id,
          nodeId: node.id,
          module: routeModule(evidence.route),
          roleId: evidence.roleId,
          route: evidence.route,
          state: evidence.state,
          expectedLandmark: evidence.expectedLandmark,
          targetKey: node.id,
          sourceCommit: evidence.appCommit,
          environment: "production" as const,
          desktop: {
            src: evidence.desktopSrc,
            ...KNOWLEDGE_CAPTURE_VIEWPORTS.desktop,
          },
          mobile: {
            src: evidence.mobileSrc,
            ...KNOWLEDGE_CAPTURE_VIEWPORTS.mobile,
          },
          hotspots: evidence.hotspots,
        };
      });
  });
}

export function validateEvidenceRequirements(
  requirements: KnowledgeEvidenceRequirement[],
  options: {
    deployedCommit?: string;
    requireDeployedCommit?: boolean;
  } = {},
): string[] {
  const errors: string[] = [];
  if (options.requireDeployedCommit && !options.deployedCommit)
    errors.push(
      "DEPLOYED_COMMIT is required for release evidence verification",
    );
  const evidenceIds = new Set<string>();
  const nodeKeys = new Set<string>();

  for (const item of requirements) {
    const nodeKey = `${item.workflowId}:${item.nodeId}`;
    if (evidenceIds.has(item.evidenceId))
      errors.push(`${item.evidenceId} is duplicated`);
    if (nodeKeys.has(nodeKey)) errors.push(`${nodeKey} is scheduled twice`);
    evidenceIds.add(item.evidenceId);
    nodeKeys.add(nodeKey);

    if (!item.expectedLandmark.trim())
      errors.push(`${item.evidenceId} has no expected landmark`);
    if (!item.hotspots.length)
      errors.push(`${item.evidenceId} has no actionable hotspot`);
    if (!item.desktop.src || !item.mobile.src)
      errors.push(`${item.evidenceId} is missing a viewport artifact path`);
    if (
      item.desktop.width !== KNOWLEDGE_CAPTURE_VIEWPORTS.desktop.width ||
      item.desktop.height !== KNOWLEDGE_CAPTURE_VIEWPORTS.desktop.height ||
      item.mobile.width !== KNOWLEDGE_CAPTURE_VIEWPORTS.mobile.width ||
      item.mobile.height !== KNOWLEDGE_CAPTURE_VIEWPORTS.mobile.height
    )
      errors.push(`${item.evidenceId} has unsupported capture dimensions`);
    if (!/^[0-9a-f]{40}$/.test(item.sourceCommit))
      errors.push(`${item.evidenceId} has an invalid source commit`);
    if (
      options.deployedCommit &&
      item.sourceCommit !== options.deployedCommit
    )
      errors.push(
        `${item.evidenceId} source commit does not match the deployed commit`,
      );
    for (const hotspot of item.hotspots)
      if (
        [hotspot.x, hotspot.y, hotspot.mobileX, hotspot.mobileY].some(
          (coordinate) => coordinate < 0 || coordinate > 1,
        )
      )
        errors.push(`${item.evidenceId}:${hotspot.id} hotspot is out of bounds`);
  }

  return errors;
}
