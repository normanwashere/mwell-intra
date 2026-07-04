// InMemoryCoreRepository — full-parity in-memory adapter for `core` RPCs.
// Mirrors every gate + invariant in supabase/migrations/*core_rpcs.sql so demo
// mode == live mode functionally (spec §6.5 invariant: adapters stay
// behavior-identical).

import type {
  ActivityLogFilter,
  CoreRepository,
} from './repository';
import type {
  AccreditationStatus,
  AssignUserRoleInput,
  CoreActor,
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

const VALID_ACCREDITATION: readonly AccreditationStatus[] = [
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'expired',
  'renewal_due',
];

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  // Sufficient for demo/tests; live path uses Postgres gen_random_uuid.
  return globalThis.crypto?.randomUUID?.() ?? `id_${Math.random().toString(36).slice(2)}${Date.now()}`;
}

/**
 * Enforces the same capability semantics as `core.has_any_cap()` in Postgres
 * (spec §4.2): if ANY of the caller's per-module roles grants the capability,
 * allow. Vendor-kind actors get the same rule; the extra vendor-scope check
 * happens in the RPC body.
 */
function hasAnyCap(actor: CoreActor, cap: string, matrix: RoleCapabilityMatrix): boolean {
  for (const module of Object.keys(actor.roles) as string[]) {
    const roles = actor.roles[module] ?? [];
    for (const role of roles) {
      if (matrix[module]?.[role]?.has(cap)) return true;
    }
  }
  return false;
}

function requireCap(actor: CoreActor, cap: string, matrix: RoleCapabilityMatrix): void {
  if (!hasAnyCap(actor, cap, matrix)) {
    throw new Error(`Not authorized: ${cap}`);
  }
}

/** Flat role→capability map, keyed by module then role. */
export type RoleCapabilityMatrix = Record<string, Record<string, ReadonlySet<string>>>;

/** Options to seed the adapter with existing data. */
export interface InMemoryCoreOptions {
  actor: CoreActor;
  matrix: RoleCapabilityMatrix;
  seed?: {
    profiles?: CoreProfile[];
    vendors?: CoreVendor[];
    documents?: CoreDocument[];
    approvals?: CoreApproval[];
    activityLog?: CoreActivityLogEntry[];
    notifications?: CoreNotification[];
    userRoles?: CoreUserRole[];
  };
}

export class InMemoryCoreRepository implements CoreRepository {
  private actor: CoreActor;
  private matrix: RoleCapabilityMatrix;

  private profiles: CoreProfile[];
  private userRoles: CoreUserRole[];
  private vendors: CoreVendor[];
  private documents: CoreDocument[];
  private approvals: CoreApproval[];
  private activity: CoreActivityLogEntry[];
  private notifications: CoreNotification[];
  private nextActivityId = 1;

  constructor(opts: InMemoryCoreOptions) {
    this.actor = opts.actor;
    this.matrix = opts.matrix;
    this.profiles = [...(opts.seed?.profiles ?? [])];
    this.userRoles = [...(opts.seed?.userRoles ?? [])];
    this.vendors = [...(opts.seed?.vendors ?? [])];
    this.documents = [...(opts.seed?.documents ?? [])];
    this.approvals = [...(opts.seed?.approvals ?? [])];
    this.activity = [...(opts.seed?.activityLog ?? [])];
    this.notifications = [...(opts.seed?.notifications ?? [])];
    this.nextActivityId = (this.activity[this.activity.length - 1]?.id ?? 0) + 1;
  }

  /** Test seam: swap the active actor (mimics a new JWT / sign-in). */
  setActor(actor: CoreActor): void {
    this.actor = actor;
  }

  // ---- Identity ---------------------------------------------------------

  async getProfiles(): Promise<CoreProfile[]> {
    // Reads are broader than writes; spec §4 policy is view_directory-cap-scoped
    // but here we mirror the "select for authenticated" default.
    return this.profiles.slice();
  }

  async getUserRoles(userId: string): Promise<CoreUserRole[]> {
    return this.userRoles.filter((r) => r.userId === userId);
  }

  async upsertProfile(input: UpsertProfileInput): Promise<CoreProfile> {
    requireCap(this.actor, 'manage_rbac', this.matrix);
    if (!input.id) throw new Error('profile id (= auth.users.id) is required');
    const existing = this.profiles.find((p) => p.id === input.id);
    const next: CoreProfile = existing
      ? {
          ...existing,
          email: input.email ?? existing.email,
          fullName: input.fullName ?? existing.fullName,
          title: input.title ?? existing.title,
          kind: input.kind ?? existing.kind,
          vendorId: input.vendorId !== undefined ? input.vendorId : existing.vendorId,
          status: input.status ?? existing.status,
        }
      : {
          id: input.id,
          email: input.email,
          fullName: input.fullName ?? null,
          title: input.title ?? null,
          kind: input.kind ?? 'employee',
          vendorId: input.vendorId ?? null,
          status: input.status ?? 'active',
          createdAt: nowIso(),
        };
    if (existing) {
      this.profiles = this.profiles.map((p) => (p.id === next.id ? next : p));
    } else {
      this.profiles.push(next);
    }
    this.recordActivity({
      module: 'core',
      entityType: 'profile',
      entityId: next.id,
      action: 'upserted',
      detail: { email: next.email, kind: next.kind, status: next.status },
    });
    return next;
  }

  async assignUserRole(input: AssignUserRoleInput): Promise<CoreUserRole> {
    requireCap(this.actor, 'manage_rbac', this.matrix);
    if (!this.matrix[input.module]?.[input.role]) {
      throw new Error(`Unknown role ${input.module}/${input.role}`);
    }
    const exists = this.userRoles.find(
      (r) => r.userId === input.userId && r.module === input.module && r.role === input.role,
    );
    if (!exists) this.userRoles.push({ ...input });
    this.recordActivity({
      module: 'core',
      entityType: 'user_role',
      entityId: input.userId,
      action: 'role_granted',
      detail: { module: input.module, role: input.role },
    });
    return { ...input };
  }

  async revokeUserRole(input: AssignUserRoleInput): Promise<void> {
    requireCap(this.actor, 'manage_rbac', this.matrix);
    this.userRoles = this.userRoles.filter(
      (r) => !(r.userId === input.userId && r.module === input.module && r.role === input.role),
    );
    this.recordActivity({
      module: 'core',
      entityType: 'user_role',
      entityId: input.userId,
      action: 'role_revoked',
      detail: { module: input.module, role: input.role },
    });
  }

  // ---- Vendor master ----------------------------------------------------

  async getVendors(): Promise<CoreVendor[]> {
    if (this.actor.kind === 'vendor') {
      return this.vendors.filter((v) => v.id === this.actor.vendorId);
    }
    return this.vendors.slice();
  }

  async getVendor(id: string): Promise<CoreVendor | null> {
    if (this.actor.kind === 'vendor' && this.actor.vendorId !== id) return null;
    return this.vendors.find((v) => v.id === id) ?? null;
  }

  async upsertVendor(input: UpsertVendorInput): Promise<CoreVendor> {
    requireCap(this.actor, 'manage_vendors', this.matrix);
    if (input.id) {
      const existing = this.vendors.find((v) => v.id === input.id);
      if (!existing) throw new Error(`Vendor not found: ${input.id}`);
      const next: CoreVendor = {
        ...existing,
        legalName: input.legalName ?? existing.legalName,
        tradeName: input.tradeName ?? existing.tradeName,
        tin: input.tin ?? existing.tin,
        category: input.category ?? existing.category,
        ownerModule: input.ownerModule ?? existing.ownerModule,
      };
      this.vendors = this.vendors.map((v) => (v.id === next.id ? next : v));
      this.recordActivity({
        module: 'core',
        entityType: 'vendor',
        entityId: next.id,
        action: 'updated',
        detail: { legalName: next.legalName, category: next.category },
      });
      return next;
    }
    const created: CoreVendor = {
      id: newId(),
      legalName: input.legalName,
      tradeName: input.tradeName ?? null,
      tin: input.tin ?? null,
      category: input.category ?? null,
      accreditationStatus: 'draft',
      accreditationExpiresAt: null,
      ownerModule: input.ownerModule ?? 'legal',
      createdAt: nowIso(),
    };
    this.vendors.push(created);
    this.recordActivity({
      module: 'core',
      entityType: 'vendor',
      entityId: created.id,
      action: 'created',
      detail: { legalName: created.legalName, category: created.category },
    });
    return created;
  }

  async setAccreditationStatus(input: SetAccreditationStatusInput): Promise<CoreVendor> {
    requireCap(this.actor, 'manage_accreditation', this.matrix);
    if (!VALID_ACCREDITATION.includes(input.accreditationStatus)) {
      throw new Error(`Invalid accreditation_status: ${input.accreditationStatus}`);
    }
    const existing = this.vendors.find((v) => v.id === input.vendorId);
    if (!existing) throw new Error(`Vendor not found: ${input.vendorId}`);
    const next: CoreVendor = {
      ...existing,
      accreditationStatus: input.accreditationStatus,
      accreditationExpiresAt:
        input.accreditationExpiresAt !== undefined
          ? input.accreditationExpiresAt
          : existing.accreditationExpiresAt,
    };
    this.vendors = this.vendors.map((v) => (v.id === next.id ? next : v));
    this.recordActivity({
      module: 'legal',
      entityType: 'vendor',
      entityId: next.id,
      action: 'status_changed',
      detail: {
        from: existing.accreditationStatus,
        to: next.accreditationStatus,
        expiresAt: next.accreditationExpiresAt,
      },
    });
    return next;
  }

  // ---- Documents --------------------------------------------------------

  async getDocuments(entityType: string, entityId: string): Promise<CoreDocument[]> {
    if (this.actor.kind === 'vendor') {
      if (entityType !== 'vendor' || entityId !== this.actor.vendorId) return [];
    }
    return this.documents.filter((d) => d.entityType === entityType && d.entityId === entityId);
  }

  async registerDocument(input: RegisterDocumentInput): Promise<CoreDocument> {
    const authorized =
      hasAnyCap(this.actor, 'manage_documents', this.matrix) ||
      hasAnyCap(this.actor, 'submit_documents', this.matrix);
    if (!authorized) throw new Error('Not authorized: manage_documents');
    if (this.actor.kind === 'vendor') {
      if (input.entityType !== 'vendor' || input.entityId !== this.actor.vendorId) {
        throw new Error('Vendors may only register documents for their own vendor record.');
      }
    }
    const created: CoreDocument = {
      id: newId(),
      entityType: input.entityType,
      entityId: input.entityId,
      docType: input.docType,
      storagePath: input.storagePath,
      version: input.version ?? 1,
      status: input.status ?? 'submitted',
      expiresAt: input.expiresAt ?? null,
      uploadedBy: this.actor.userId,
      createdAt: nowIso(),
    };
    this.documents.push(created);
    this.recordActivity({
      module: input.module ?? 'core',
      entityType: 'document',
      entityId: created.id,
      action: 'created',
      detail: {
        entityType: created.entityType,
        entityId: created.entityId,
        docType: created.docType,
        version: created.version,
        storagePath: created.storagePath,
      },
    });
    return created;
  }

  // ---- Approvals --------------------------------------------------------

  async getApprovals(entityType: string, entityId: string): Promise<CoreApproval[]> {
    return this.approvals.filter((a) => a.entityType === entityType && a.entityId === entityId);
  }

  async createApprovalStep(input: CreateApprovalStepInput): Promise<CoreApproval> {
    requireCap(this.actor, 'manage_approvals', this.matrix);
    const created: CoreApproval = {
      id: newId(),
      entityType: input.entityType,
      entityId: input.entityId,
      step: input.step ?? 1,
      approverRole: input.approverRole,
      decision: 'pending',
      decidedBy: null,
      decidedAt: null,
      note: null,
      slaDueAt: input.slaDueAt ?? null,
    };
    this.approvals.push(created);
    this.recordActivity({
      module: 'core',
      entityType: created.entityType,
      entityId: created.entityId,
      action: 'approval_requested',
      detail: { approvalId: created.id, step: created.step, approverRole: created.approverRole },
    });
    return created;
  }

  async recordApprovalDecision(input: RecordApprovalDecisionInput): Promise<CoreApproval> {
    requireCap(this.actor, 'record_approval', this.matrix);
    if (input.decision !== 'approved' && input.decision !== 'rejected') {
      throw new Error(`Decision must be approved or rejected, got ${String(input.decision)}`);
    }
    const idx = this.approvals.findIndex((a) => a.id === input.approvalId && a.decision === 'pending');
    if (idx < 0) throw new Error(`Approval step not found or already decided: ${input.approvalId}`);
    const prev = this.approvals[idx]!;
    const next: CoreApproval = {
      ...prev,
      decision: input.decision,
      decidedBy: this.actor.userId,
      decidedAt: nowIso(),
      note: input.note ?? null,
    };
    this.approvals[idx] = next;
    this.recordActivity({
      module: 'core',
      entityType: next.entityType,
      entityId: next.entityId,
      action: next.decision,
      detail: { approvalId: next.id, step: next.step, note: next.note },
    });
    return next;
  }

  // ---- Activity log -----------------------------------------------------

  async getActivityLog(filter: ActivityLogFilter = {}): Promise<CoreActivityLogEntry[]> {
    let rows = this.activity.slice().reverse(); // newest first
    if (filter.module) rows = rows.filter((r) => r.module === filter.module);
    if (filter.entityType) rows = rows.filter((r) => r.entityType === filter.entityType);
    if (filter.entityId) rows = rows.filter((r) => r.entityId === filter.entityId);
    if (filter.limit) rows = rows.slice(0, filter.limit);
    return rows;
  }

  async logActivity(input: LogActivityInput): Promise<CoreActivityLogEntry> {
    if (!this.actor.userId) throw new Error('Not authenticated');
    return this.recordActivity(input);
  }

  // ---- Notifications ----------------------------------------------------

  async getNotifications(userId: string): Promise<CoreNotification[]> {
    return this.notifications
      .filter((n) => n.userId === userId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async enqueueNotification(input: EnqueueNotificationInput): Promise<CoreNotification> {
    requireCap(this.actor, 'manage_notifications', this.matrix);
    const created: CoreNotification = {
      id: newId(),
      userId: input.userId,
      kind: input.kind,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      readAt: null,
      createdAt: nowIso(),
    };
    this.notifications.push(created);
    return created;
  }

  async markNotificationRead(notificationId: string): Promise<CoreNotification> {
    if (!this.actor.userId) throw new Error('Not authenticated');
    const idx = this.notifications.findIndex(
      (n) => n.id === notificationId && n.userId === this.actor.userId,
    );
    if (idx < 0) throw new Error('Notification not found for current user.');
    const prev = this.notifications[idx]!;
    const next: CoreNotification = { ...prev, readAt: prev.readAt ?? nowIso() };
    this.notifications[idx] = next;
    return next;
  }

  // ---- Internal ---------------------------------------------------------

  private recordActivity(input: LogActivityInput): CoreActivityLogEntry {
    const entry: CoreActivityLogEntry = {
      id: this.nextActivityId++,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actor: this.actor.userId,
      detail: input.detail,
      createdAt: nowIso(),
    };
    this.activity.push(entry);
    return entry;
  }
}
