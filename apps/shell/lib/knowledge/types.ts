export type KnowledgeModule =
  "core" | "warehouse" | "procurement" | "legal" | "vendor" | "admin";

export type FlowNodeType =
  | "start"
  | "action"
  | "decision"
  | "handoff"
  | "system"
  | "exception"
  | "terminal";

export interface KnowledgeRole {
  id: string;
  label: string;
  module: KnowledgeModule;
  purpose: string;
}

export interface KnowledgeStep {
  title: string;
  ownerRoleIds: string[];
  instruction: string;
  expectedOutcome: string;
  exception?: string;
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

export interface KnowledgeFlowNode {
  id: string;
  type: FlowNodeType;
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

export interface KnowledgeFlowEdge {
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
  mobileX?: number;
  mobileY?: number;
  label: string;
  instruction: string;
}

export interface KnowledgeEvidence {
  id: string;
  nodeId: string;
  desktopSrc: string;
  mobileSrc?: string;
  route: string;
  roleId: string;
  capturedAt: string;
  reviewedAt: string;
  provenance: "production" | "documentation";
  alt: string;
  expectedLandmark: string;
  expectedDatabaseEffect?: string;
  sensitiveDataReviewed: boolean;
  hotspots: KnowledgeHotspot[];
}

export interface KnowledgeFlow {
  id: string;
  title: string;
  summary: string;
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
