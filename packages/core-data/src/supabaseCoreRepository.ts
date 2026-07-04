// SupabaseCoreRepository — live adapter for the `core` schema.
// Every write calls a SECURITY DEFINER RPC (spec §6.7 envelope: {payload}).
// Server enforces capability gates + RLS; this adapter just projects.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActivityLogFilter, CoreRepository } from './repository';
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

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

function rowToProfile(r: Row): CoreProfile {
  return {
    id: r.id,
    email: r.email,
    fullName: r.full_name ?? null,
    title: r.title ?? null,
    kind: r.kind,
    vendorId: r.vendor_id ?? null,
    status: r.status,
    createdAt: r.created_at,
  };
}
function rowToVendor(r: Row): CoreVendor {
  return {
    id: r.id,
    legalName: r.legal_name,
    tradeName: r.trade_name ?? null,
    tin: r.tin ?? null,
    category: r.category ?? null,
    accreditationStatus: r.accreditation_status,
    accreditationExpiresAt: r.accreditation_expires_at ?? null,
    ownerModule: r.owner_module,
    createdAt: r.created_at,
  };
}
function rowToDocument(r: Row): CoreDocument {
  return {
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    docType: r.doc_type,
    storagePath: r.storage_path,
    version: r.version,
    status: r.status,
    expiresAt: r.expires_at ?? null,
    uploadedBy: r.uploaded_by ?? null,
    createdAt: r.created_at,
  };
}
function rowToApproval(r: Row): CoreApproval {
  return {
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    step: r.step,
    approverRole: r.approver_role,
    decision: r.decision,
    decidedBy: r.decided_by ?? null,
    decidedAt: r.decided_at ?? null,
    note: r.note ?? null,
    slaDueAt: r.sla_due_at ?? null,
  };
}
function rowToActivity(r: Row): CoreActivityLogEntry {
  return {
    id: r.id,
    module: r.module,
    entityType: r.entity_type,
    entityId: r.entity_id,
    action: r.action,
    actor: r.actor ?? null,
    detail: r.detail,
    createdAt: r.created_at,
  };
}
function rowToNotification(r: Row): CoreNotification {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind,
    entityType: r.entity_type ?? null,
    entityId: r.entity_id ?? null,
    readAt: r.read_at ?? null,
    createdAt: r.created_at,
  };
}
function rowToUserRole(r: Row): CoreUserRole {
  return { userId: r.user_id, module: r.module, role: r.role };
}

/**
 * Assumes the injected client is pinned to `db.schema = 'core'` (or the caller
 * uses `.schema('core')` at call sites). Table selects reference bare names.
 */
export class SupabaseCoreRepository implements CoreRepository {
  constructor(private client: SupabaseClient<any, any>) {}

  private async rpc(fn: string, payload: unknown): Promise<any> {
    const { data, error } = await this.client.rpc(fn, { payload });
    if (error) throw new Error(`${fn} failed: ${error.message}`);
    return data;
  }

  async getProfiles(): Promise<CoreProfile[]> {
    const { data, error } = await this.client.from('profiles').select('*');
    if (error) throw new Error(`getProfiles: ${error.message}`);
    return (data ?? []).map(rowToProfile);
  }
  async getUserRoles(userId: string): Promise<CoreUserRole[]> {
    const { data, error } = await this.client.from('user_roles').select('*').eq('user_id', userId);
    if (error) throw new Error(`getUserRoles: ${error.message}`);
    return (data ?? []).map(rowToUserRole);
  }
  async upsertProfile(input: UpsertProfileInput): Promise<CoreProfile> {
    return rowToProfile(await this.rpc('upsert_profile', {
      id: input.id,
      email: input.email,
      full_name: input.fullName,
      title: input.title,
      kind: input.kind,
      vendor_id: input.vendorId,
      status: input.status,
    }));
  }
  async assignUserRole(input: AssignUserRoleInput): Promise<CoreUserRole> {
    await this.rpc('assign_user_role', {
      user_id: input.userId,
      module: input.module,
      role: input.role,
    });
    return { ...input };
  }
  async revokeUserRole(input: AssignUserRoleInput): Promise<void> {
    await this.rpc('revoke_user_role', {
      user_id: input.userId,
      module: input.module,
      role: input.role,
    });
  }
  async getVendors(): Promise<CoreVendor[]> {
    const { data, error } = await this.client.from('vendors').select('*');
    if (error) throw new Error(`getVendors: ${error.message}`);
    return (data ?? []).map(rowToVendor);
  }
  async getVendor(id: string): Promise<CoreVendor | null> {
    const { data, error } = await this.client.from('vendors').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`getVendor: ${error.message}`);
    return data ? rowToVendor(data) : null;
  }
  async upsertVendor(input: UpsertVendorInput): Promise<CoreVendor> {
    return rowToVendor(await this.rpc('upsert_vendor', {
      id: input.id,
      legal_name: input.legalName,
      trade_name: input.tradeName,
      tin: input.tin,
      category: input.category,
      owner_module: input.ownerModule,
    }));
  }
  async setAccreditationStatus(input: SetAccreditationStatusInput): Promise<CoreVendor> {
    return rowToVendor(await this.rpc('set_accreditation_status', {
      vendor_id: input.vendorId,
      accreditation_status: input.accreditationStatus,
      accreditation_expires_at: input.accreditationExpiresAt,
    }));
  }
  async getDocuments(entityType: string, entityId: string): Promise<CoreDocument[]> {
    const { data, error } = await this.client
      .from('documents')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('version', { ascending: false });
    if (error) throw new Error(`getDocuments: ${error.message}`);
    return (data ?? []).map(rowToDocument);
  }
  async registerDocument(input: RegisterDocumentInput): Promise<CoreDocument> {
    return rowToDocument(await this.rpc('register_document', {
      entity_type: input.entityType,
      entity_id: input.entityId,
      doc_type: input.docType,
      storage_path: input.storagePath,
      version: input.version,
      status: input.status,
      expires_at: input.expiresAt,
      module: input.module,
    }));
  }
  async getApprovals(entityType: string, entityId: string): Promise<CoreApproval[]> {
    const { data, error } = await this.client
      .from('approvals')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .order('step', { ascending: true });
    if (error) throw new Error(`getApprovals: ${error.message}`);
    return (data ?? []).map(rowToApproval);
  }
  async createApprovalStep(input: CreateApprovalStepInput): Promise<CoreApproval> {
    return rowToApproval(await this.rpc('create_approval_step', {
      entity_type: input.entityType,
      entity_id: input.entityId,
      step: input.step,
      approver_role: input.approverRole,
      sla_due_at: input.slaDueAt,
    }));
  }
  async recordApprovalDecision(input: RecordApprovalDecisionInput): Promise<CoreApproval> {
    return rowToApproval(await this.rpc('record_approval_decision', {
      approval_id: input.approvalId,
      decision: input.decision,
      note: input.note,
    }));
  }
  async getActivityLog(filter: ActivityLogFilter = {}): Promise<CoreActivityLogEntry[]> {
    let q = this.client.from('activity_log').select('*').order('id', { ascending: false });
    if (filter.module) q = q.eq('module', filter.module);
    if (filter.entityType) q = q.eq('entity_type', filter.entityType);
    if (filter.entityId) q = q.eq('entity_id', filter.entityId);
    if (filter.limit) q = q.limit(filter.limit);
    const { data, error } = await q;
    if (error) throw new Error(`getActivityLog: ${error.message}`);
    return (data ?? []).map(rowToActivity);
  }
  async logActivity(input: LogActivityInput): Promise<CoreActivityLogEntry> {
    return rowToActivity(await this.rpc('log_activity', {
      module: input.module,
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      detail: input.detail,
    }));
  }
  async getNotifications(userId: string): Promise<CoreNotification[]> {
    const { data, error } = await this.client
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`getNotifications: ${error.message}`);
    return (data ?? []).map(rowToNotification);
  }
  async enqueueNotification(input: EnqueueNotificationInput): Promise<CoreNotification> {
    return rowToNotification(await this.rpc('enqueue_notification', {
      user_id: input.userId,
      kind: input.kind,
      entity_type: input.entityType,
      entity_id: input.entityId,
    }));
  }
  async markNotificationRead(notificationId: string): Promise<CoreNotification> {
    return rowToNotification(await this.rpc('mark_notification_read', {
      notification_id: notificationId,
    }));
  }
}
