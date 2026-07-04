// Core domain types (camelCase) mirroring the `core` schema tables.
// snake_case mapping happens only at the SupabaseCoreRepository boundary.

export type ProfileKind = 'employee' | 'vendor';
export type ProfileStatus = 'active' | 'disabled';

export interface CoreProfile {
  id: string;
  email: string;
  fullName?: string | null;
  title?: string | null;
  kind: ProfileKind;
  vendorId?: string | null;
  status: ProfileStatus;
  createdAt: string;
}

export type AccreditationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'renewal_due';

export interface CoreVendor {
  id: string;
  legalName: string;
  tradeName?: string | null;
  tin?: string | null;
  category?: string | null;
  accreditationStatus: AccreditationStatus;
  accreditationExpiresAt?: string | null;
  ownerModule: string;
  createdAt: string;
}

export type DocumentStatus = 'submitted' | 'approved' | 'rejected' | 'expired';

export interface CoreDocument {
  id: string;
  entityType: string;
  entityId: string;
  docType: string;
  storagePath: string;
  version: number;
  status: DocumentStatus;
  expiresAt?: string | null;
  uploadedBy?: string | null;
  createdAt: string;
}

export type ApprovalDecision = 'pending' | 'approved' | 'rejected';

export interface CoreApproval {
  id: string;
  entityType: string;
  entityId: string;
  step: number;
  approverRole: string;
  decision: ApprovalDecision;
  decidedBy?: string | null;
  decidedAt?: string | null;
  note?: string | null;
  slaDueAt?: string | null;
}

export interface CoreActivityLogEntry {
  id: number;
  module: string;
  entityType: string;
  entityId: string;
  action: string;
  actor?: string | null;
  detail?: unknown;
  createdAt: string;
}

export interface CoreNotification {
  id: string;
  userId: string;
  kind: string;
  entityType?: string | null;
  entityId?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface CoreUserRole {
  userId: string;
  module: string;
  role: string;
}

// -------- Input DTOs (mirror RPC payload shapes; camelCase to caller) --------

export interface UpsertProfileInput {
  id: string;
  email: string;
  fullName?: string;
  title?: string;
  kind?: ProfileKind;
  vendorId?: string | null;
  status?: ProfileStatus;
}

export interface AssignUserRoleInput {
  userId: string;
  module: string;
  role: string;
}

export interface UpsertVendorInput {
  id?: string;
  legalName: string;
  tradeName?: string;
  tin?: string;
  category?: string;
  ownerModule?: string;
}

export interface SetAccreditationStatusInput {
  vendorId: string;
  accreditationStatus: AccreditationStatus;
  accreditationExpiresAt?: string | null;
}

export interface RegisterDocumentInput {
  entityType: string;
  entityId: string;
  docType: string;
  storagePath: string;
  version?: number;
  status?: DocumentStatus;
  expiresAt?: string | null;
  module?: string;
}

export interface CreateApprovalStepInput {
  entityType: string;
  entityId: string;
  step?: number;
  approverRole: string;
  slaDueAt?: string | null;
}

export interface RecordApprovalDecisionInput {
  approvalId: string;
  decision: 'approved' | 'rejected';
  note?: string;
}

export interface LogActivityInput {
  module: string;
  entityType: string;
  entityId: string;
  action: string;
  detail?: unknown;
}

export interface EnqueueNotificationInput {
  userId: string;
  kind: string;
  entityType?: string;
  entityId?: string;
}

// -------- Actor / auth context (for the InMemory adapter to enforce gates) --

/**
 * Minimal actor context the InMemory adapter uses to enforce capability gates
 * and vendor-tier scoping, mirroring what `auth.uid()` / `core.is_vendor()` /
 * `core.current_vendor_id()` return in Postgres. The SupabaseCoreRepository
 * ignores this — the server enforces the real check.
 */
export interface CoreActor {
  userId: string;
  /** Scoped roles per module — matches JWT `app_metadata.roles`. */
  roles: Partial<Record<string, readonly string[]>>;
  kind: ProfileKind;
  vendorId?: string | null;
}
