export type ReadinessStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "superseded";

export interface ReadinessEvidence {
  id: string;
  label: string;
  reference: string;
  required: boolean;
  verified: boolean;
}

export interface ReadinessPackage {
  id: string;
  productId: string;
  title: string;
  version: number;
  status: ReadinessStatus;
  evidence: ReadinessEvidence[];
  conditions: string;
  preparedBy: string;
  submittedBy: string | null;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  operationsAcknowledgedBy: string | null;
  operationsAcknowledgedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReadinessSubmission {
  productId: string;
  title: string;
  evidence: ReadinessEvidence[];
}

export type PriceProposalStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "rejected"
  | "superseded";

export interface PriceProposal {
  id: string;
  productId: string;
  productName: string;
  version: number;
  status: PriceProposalStatus;
  currentPrice: number;
  proposedPrice: number;
  costBasis: number;
  reason: string;
  effectiveAt: string;
  proposedBy: string;
  submittedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface PriceProposalDraft {
  productId: string;
  proposedPrice: number;
  costBasis: number;
  reason: string;
  effectiveAt: string;
}
