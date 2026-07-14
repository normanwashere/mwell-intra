export type KnowledgeModule =
  | "core"
  | "warehouse"
  | "procurement"
  | "finance"
  | "legal"
  | "vendor"
  | "admin"
  | "events"
  | "insights";

export type KnowledgeAvailability = "live" | "limited" | "coming_soon";

export type KnowledgeOutcome =
  "complete" | "revision" | "rejected" | "cancelled" | "escalated";

export type FlowNodeType =
  | "start"
  | "action"
  | "decision"
  | "handoff"
  | "system"
  | "exception"
  | "terminal";

export interface KnowledgeAuthority {
  capabilities: string[];
  accessibleRoutes: string[];
  canDo: string[];
  cannotDo: string[];
  decisions: string[];
  upstreamRoleIds: string[];
  downstreamRoleIds: string[];
  escalation: string;
}

export interface KnowledgeResponsibilityStage {
  title: string;
  responsibility: string;
  outcome: string;
}

export interface KnowledgeRole {
  id: string;
  rbacModule?: "core" | "warehouse" | "procurement" | "legal" | "events" | "insights";
  rbacRole?: string;
  label: string;
  module: KnowledgeModule;
  availability: KnowledgeAvailability;
  purpose: string;
  dailyTasks: string[];
  responsibilityStages: KnowledgeResponsibilityStage[];
  authority: KnowledgeAuthority;
}

export interface KnowledgeFeatureControl {
  name: string;
  behavior: string;
  validation: string;
  result: string;
}

export interface KnowledgeFeatureField {
  name: string;
  purpose: string;
  required: boolean;
  validation: string;
}

export interface KnowledgeFeature {
  id: string;
  title: string;
  module: KnowledgeModule;
  availability: KnowledgeAvailability;
  routes: string[];
  roleIds: string[];
  capabilityIds: string[];
  purpose: string;
  policyBasis: string[];
  relatedFlowIds: string[];
  controls: KnowledgeFeatureControl[];
  fields?: KnowledgeFeatureField[];
  reads: string[];
  writes: string[];
  statuses: string[];
  notifications?: string[];
  exceptions: string[];
  completionEvidence?: string[];
  owner: string;
  reviewedAt: string;
}

export interface KnowledgeDecision {
  authorityRoleId: string;
  policyBasis: string;
  terminalOutcome?: KnowledgeOutcome;
}

export interface KnowledgeStep {
  title: string;
  ownerRoleIds: string[];
  instruction: string;
  expectedOutcome: string;
  exception?: string;
  evidenceId?: string;
  prerequisites?: string[];
  databaseEffect?: string;
  handoff?: string;
  prohibitedActions?: string[];
}

export interface KnowledgeSection {
  id: string;
  title: string;
  body: string;
  steps?: KnowledgeStep[];
}

export interface KnowledgeArticle {
  id: string;
  slug: string;
  title: string;
  summary: string;
  module: KnowledgeModule;
  availability: KnowledgeAvailability;
  roles: string[];
  keywords: string[];
  sections: KnowledgeSection[];
  relatedArticleIds: string[];
  flowIds: string[];
  liveRoutes: string[];
  owner: string;
  reviewedAt: string;
  screenshots?: Array<{ src: string; alt: string; caption: string }>;
}

interface KnowledgeFlowNodeBase {
  id: string;
  title: string;
  ownerRoleIds: string[];
  body: string;
  prerequisite?: string;
  outcome?: string;
  exception?: string;
  articleId?: string;
  evidenceId?: string;
  databaseEffect?: string;
}

export interface KnowledgeDecisionNode extends KnowledgeFlowNodeBase {
  type: "decision";
  authorityRoleId: string;
  policyBasis: string;
  mergeContract?: {
    destinationNodeId: string;
    justification: string;
  };
  terminalOutcome?: never;
}

export interface KnowledgeTerminalNode extends KnowledgeFlowNodeBase {
  type: "terminal";
  authorityRoleId?: never;
  policyBasis?: never;
  terminalOutcome: KnowledgeOutcome;
}

export interface KnowledgeProcessNode extends KnowledgeFlowNodeBase {
  type: Exclude<FlowNodeType, "decision" | "terminal">;
  authorityRoleId?: never;
  policyBasis?: never;
  terminalOutcome?: never;
}

export type KnowledgeFlowNode =
  KnowledgeDecisionNode | KnowledgeTerminalNode | KnowledgeProcessNode;

export interface KnowledgeFlowEdge {
  id?: string;
  from: string;
  to: string;
  label?: string;
  outcome?: "success" | "exception" | "neutral";
}

export interface KnowledgeHotspot {
  id: string;
  number: number;
  x: number;
  y: number;
  mobileX: number;
  mobileY: number;
  label: string;
  instruction: string;
}

export interface KnowledgeEvidence {
  id: string;
  nodeId?: string;
  featureId?: string;
  desktopSrc: string;
  mobileSrc: string;
  route: string;
  roleId: string;
  state: string;
  capturedAt: string;
  reviewedAt: string;
  appCommit: string;
  provenance: "production" | "documentation";
  environment?: "demo" | "production";
  alt: string;
  expectedLandmark: string;
  expectedDatabaseEffect?: string;
  sensitiveDataReviewed: boolean;
  sharedEvidenceGroup?: string;
  hotspots: KnowledgeHotspot[];
}

export interface KnowledgeCaptureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KnowledgeCaptureArtifact {
  file: string;
  sha256: string;
  width: number;
  height: number;
  controlBounds: KnowledgeCaptureBounds;
  hotspot: { x: number; y: number };
}

export interface KnowledgeCaptureReportEntry {
  route: string;
  roleId: string;
  state: string;
  control: Pick<KnowledgeHotspot, "id" | "label" | "instruction">;
  desktop: KnowledgeCaptureArtifact;
  mobile: KnowledgeCaptureArtifact;
}

export interface KnowledgeCaptureReport {
  schemaVersion: 1;
  sourceCommit: string;
  runtime: {
    parentNode: string;
    serverNode: string;
  };
  capturedAt: string;
  reviewedAt: string;
  evidenceCount: number;
  evidence: Record<string, KnowledgeCaptureReportEntry>;
}

export interface KnowledgeFlow {
  id: string;
  title: string;
  summary: string;
  availability?: KnowledgeAvailability;
  roles: string[];
  startNodeId: string;
  nodes: KnowledgeFlowNode[];
  edges: KnowledgeFlowEdge[];
}

export interface GlossaryEntry {
  term: string;
  definition: string;
  aliases: string[];
}

export interface FutureFeature {
  id: string;
  title: string;
  status: "proposed" | "planned" | "in_progress" | "released";
  value: string;
}

export interface KnowledgeContent {
  roles: KnowledgeRole[];
  features: KnowledgeFeature[];
  articles: KnowledgeArticle[];
  flows: KnowledgeFlow[];
  glossary: GlossaryEntry[];
  futureFeatures: FutureFeature[];
  evidence: KnowledgeEvidence[];
}

export type KnowledgeResultType = "article" | "flow" | "glossary" | "future";

export interface KnowledgeSearchResult {
  id: string;
  type: KnowledgeResultType;
  title: string;
  summary: string;
  score: number;
  href: string;
  module?: KnowledgeModule;
  roleIds: string[];
}
