// Procurement domain types (preview build). Mirrors what the eventual Supabase
// adapter (@intra/core-data + procurement.* RPCs) will return, kept camelCase
// on the client per the platform mapper-boundary invariant (spec §6.4).

export type RequestStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export interface ProcurementRequestLine {
  id: string;
  description: string;
  quantity: number;
  uom?: string;
  unitPrice?: number;
}

export interface ProcurementRequest {
  id: string;
  title: string;
  description?: string;
  department?: string;
  costCenter?: string;
  status: RequestStatus;
  requesterName?: string;
  requesterEmail?: string;
  neededBy?: string; // ISO date
  vendorId?: string;
  vendorName?: string;
  lines: ProcurementRequestLine[];
  createdAt: string;
  submittedAt?: string;
  decidedAt?: string;
  decisionNote?: string;
  decidedByEmail?: string;
  /** Derived: sum(line.quantity * line.unitPrice ?? 0) — computed at write time. */
  estimatedAmount?: number;
}

export type PurchaseOrderStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'issued'
  | 'closed'
  | 'cancelled';

export interface PurchaseOrderLine {
  id: string;
  description: string;
  quantity: number;
  uom?: string;
  unitPrice?: number;
  receivedQuantity: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string; // human-friendly (PO-2026-0001)
  requestId?: string; // links back to the PR
  vendorId: string;
  vendorName: string;
  status: PurchaseOrderStatus;
  actorEmail?: string;
  expectedDate?: string;
  notes?: string;
  origin: 'procurement' | 'warehouse';
  lines: PurchaseOrderLine[];
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedByEmail?: string;
  /** sum(qty * unitPrice ?? 0). */
  total: number;
}

/** Preview build: a single approval "step" tied to a request. Multi-tier
 *  policy (e.g. dept head → finance → CFO) lands post-MVP. */
export interface ApprovalDecision {
  entityType: 'request' | 'purchase_order';
  entityId: string;
  decision: 'approved' | 'rejected';
  note?: string;
  decidedAt: string;
  decidedByEmail?: string;
}

/** Very light vendor projection used only by procurement UI. In live mode this
 *  comes from `core.vendors`; in demo mode from the seeded list below. */
export interface ProcurementVendor {
  id: string;
  legalName: string;
  category?: string;
  /** From `core.vendors.accreditation_status`. Award is gated on `approved`. */
  accreditationStatus:
    | 'draft'
    | 'submitted'
    | 'under_review'
    | 'approved'
    | 'rejected'
    | 'expired'
    | 'renewal_due';
  accreditationExpiresAt?: string;
}
