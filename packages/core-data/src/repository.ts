// CoreRepository PORT (spec §1, §4, §6). Mirrors the 11 SECURITY DEFINER RPCs
// in supabase/migrations/*core_rpcs.sql, plus a small set of reads used by the
// UI. Two adapters implement it: InMemoryCoreRepository (demo/tests) and
// SupabaseCoreRepository (live). UI never calls Supabase directly (spec §6.1).

import type {
  AssignUserRoleInput,
  CoreActivityLogEntry,
  CoreApproval,
  CoreDocument,
  CoreNotification,
  CoreProfile,
  CoreUserRole,
  CoreVendor,
  CreateApprovalStepInput,
  EnqueueNotificationInput,
  LogActivityInput,
  RecordApprovalDecisionInput,
  RegisterDocumentInput,
  SetAccreditationStatusInput,
  UpsertProfileInput,
  UpsertVendorInput,
} from './types';

export interface ActivityLogFilter {
  module?: string;
  entityType?: string;
  entityId?: string;
  limit?: number;
}

/**
 * The Core repository port. Every method that writes must (in the memory
 * adapter) enforce the corresponding `core.has_cap()` gate.
 */
export interface CoreRepository {
  // Identity + RBAC administration
  getProfiles(): Promise<CoreProfile[]>;
  getUserRoles(userId: string): Promise<CoreUserRole[]>;
  upsertProfile(input: UpsertProfileInput): Promise<CoreProfile>;
  assignUserRole(input: AssignUserRoleInput): Promise<CoreUserRole>;
  revokeUserRole(input: AssignUserRoleInput): Promise<void>;

  // Vendor master
  getVendors(): Promise<CoreVendor[]>;
  getVendor(id: string): Promise<CoreVendor | null>;
  upsertVendor(input: UpsertVendorInput): Promise<CoreVendor>;
  setAccreditationStatus(input: SetAccreditationStatusInput): Promise<CoreVendor>;

  // Documents
  getDocuments(entityType: string, entityId: string): Promise<CoreDocument[]>;
  registerDocument(input: RegisterDocumentInput): Promise<CoreDocument>;

  // Approvals
  getApprovals(entityType: string, entityId: string): Promise<CoreApproval[]>;
  createApprovalStep(input: CreateApprovalStepInput): Promise<CoreApproval>;
  recordApprovalDecision(input: RecordApprovalDecisionInput): Promise<CoreApproval>;

  // Activity log
  getActivityLog(filter?: ActivityLogFilter): Promise<CoreActivityLogEntry[]>;
  logActivity(input: LogActivityInput): Promise<CoreActivityLogEntry>;

  // Notifications
  getNotifications(userId: string): Promise<CoreNotification[]>;
  enqueueNotification(input: EnqueueNotificationInput): Promise<CoreNotification>;
  markNotificationRead(notificationId: string): Promise<CoreNotification>;
}
