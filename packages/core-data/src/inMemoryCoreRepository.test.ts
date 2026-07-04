import { describe, expect, it, beforeEach } from 'vitest';
import { buildRoleCapabilityMatrixFromRbac } from './createCoreRepository';
import { InMemoryCoreRepository } from './inMemoryCoreRepository';
import type { CoreActor } from './types';

const matrix = buildRoleCapabilityMatrixFromRbac();

function makeAdmin(): CoreActor {
  return {
    userId: 'user-admin',
    kind: 'employee',
    roles: { core: ['platform_admin'] },
  };
}

function makeStaff(): CoreActor {
  return {
    userId: 'user-staff',
    kind: 'employee',
    roles: { core: ['staff'] },
  };
}

function makeVendor(vendorId: string): CoreActor {
  return {
    userId: `user-vendor-${vendorId}`,
    kind: 'vendor',
    vendorId,
    roles: { core: ['vendor_portal'] },
  };
}

function makeRepo(actor: CoreActor) {
  return new InMemoryCoreRepository({ actor, matrix });
}

describe('InMemoryCoreRepository — RPC gates', () => {
  it('platform_admin can upsert profile and log activity', async () => {
    const repo = makeRepo(makeAdmin());
    const p = await repo.upsertProfile({ id: 'u1', email: 'u1@mwell' });
    expect(p.email).toBe('u1@mwell');
    const log = await repo.getActivityLog({ entityType: 'profile' });
    expect(log[0]?.action).toBe('upserted');
  });

  it('staff cannot upsert profile (no manage_rbac)', async () => {
    const repo = makeRepo(makeStaff());
    await expect(repo.upsertProfile({ id: 'u1', email: 'u1@mwell' })).rejects.toThrow(
      /Not authorized/,
    );
  });

  it('assign_user_role rejects unknown role', async () => {
    const repo = makeRepo(makeAdmin());
    await expect(
      repo.assignUserRole({ userId: 'u1', module: 'warehouse', role: 'ghost' }),
    ).rejects.toThrow(/Unknown role/);
  });

  it('assign_user_role accepts known warehouse role', async () => {
    const repo = makeRepo(makeAdmin());
    const r = await repo.assignUserRole({
      userId: 'u1',
      module: 'warehouse',
      role: 'logistics_supervisor',
    });
    expect(r.role).toBe('logistics_supervisor');
  });
});

describe('InMemoryCoreRepository — vendors', () => {
  it('platform_admin creates vendor with default status draft', async () => {
    const repo = makeRepo(makeAdmin());
    const v = await repo.upsertVendor({ legalName: 'Acme Corp' });
    expect(v.accreditationStatus).toBe('draft');
    expect(v.ownerModule).toBe('legal');
  });

  it('staff cannot upsert vendor', async () => {
    const repo = makeRepo(makeStaff());
    await expect(repo.upsertVendor({ legalName: 'Acme' })).rejects.toThrow(/Not authorized/);
  });

  it('setAccreditationStatus flips lifecycle and logs from/to', async () => {
    const repo = makeRepo(makeAdmin());
    const v = await repo.upsertVendor({ legalName: 'Acme' });
    const updated = await repo.setAccreditationStatus({
      vendorId: v.id,
      accreditationStatus: 'approved',
    });
    expect(updated.accreditationStatus).toBe('approved');
    const log = await repo.getActivityLog({ module: 'legal', entityType: 'vendor' });
    expect(log[0]?.action).toBe('status_changed');
    expect((log[0]?.detail as any).to).toBe('approved');
  });

  it('rejects invalid accreditation status', async () => {
    const repo = makeRepo(makeAdmin());
    const v = await repo.upsertVendor({ legalName: 'X' });
    await expect(
      repo.setAccreditationStatus({ vendorId: v.id, accreditationStatus: 'bogus' as any }),
    ).rejects.toThrow(/Invalid accreditation_status/);
  });

  it('vendor-kind actor sees only their own vendor', async () => {
    const admin = makeRepo(makeAdmin());
    const v1 = await admin.upsertVendor({ legalName: 'One' });
    const v2 = await admin.upsertVendor({ legalName: 'Two' });
    const vendorRepo = new InMemoryCoreRepository({
      actor: makeVendor(v1.id),
      matrix,
      seed: { vendors: [v1, v2] },
    });
    const list = await vendorRepo.getVendors();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(v1.id);
  });
});

describe('InMemoryCoreRepository — documents', () => {
  it('vendor can register document for their own vendor only', async () => {
    const admin = makeRepo(makeAdmin());
    const v = await admin.upsertVendor({ legalName: 'V' });
    const vendorRepo = new InMemoryCoreRepository({
      actor: makeVendor(v.id),
      matrix,
    });
    const doc = await vendorRepo.registerDocument({
      entityType: 'vendor',
      entityId: v.id,
      docType: 'business_permit',
      storagePath: 'permits/x.pdf',
    });
    expect(doc.uploadedBy).toContain('vendor');
  });

  it('vendor cannot register document for OTHER vendor', async () => {
    const vendorRepo = new InMemoryCoreRepository({
      actor: makeVendor('vendor-a'),
      matrix,
    });
    await expect(
      vendorRepo.registerDocument({
        entityType: 'vendor',
        entityId: 'vendor-b',
        docType: 'x',
        storagePath: 'x',
      }),
    ).rejects.toThrow(/only register documents for their own/);
  });

  it('registerDocument requires manage_documents or submit_documents', async () => {
    const staffRepo = makeRepo(makeStaff());
    await expect(
      staffRepo.registerDocument({
        entityType: 'vendor',
        entityId: 'v1',
        docType: 'x',
        storagePath: 'x',
      }),
    ).rejects.toThrow(/Not authorized/);
  });
});

describe('InMemoryCoreRepository — approvals', () => {
  let repo: InMemoryCoreRepository;
  beforeEach(() => {
    repo = makeRepo(makeAdmin());
  });

  it('createApprovalStep opens pending row + logs approval_requested', async () => {
    const a = await repo.createApprovalStep({
      entityType: 'purchase_order',
      entityId: 'po-1',
      approverRole: 'approver',
    });
    expect(a.decision).toBe('pending');
    const log = await repo.getActivityLog({ entityType: 'purchase_order' });
    expect(log[0]?.action).toBe('approval_requested');
  });

  it('recordApprovalDecision requires approved|rejected', async () => {
    const a = await repo.createApprovalStep({
      entityType: 'po',
      entityId: 'po-2',
      approverRole: 'approver',
    });
    await expect(
      repo.recordApprovalDecision({ approvalId: a.id, decision: 'maybe' as any }),
    ).rejects.toThrow(/approved or rejected/);
  });

  it('recordApprovalDecision cannot decide twice', async () => {
    const a = await repo.createApprovalStep({
      entityType: 'po',
      entityId: 'po-3',
      approverRole: 'approver',
    });
    await repo.recordApprovalDecision({ approvalId: a.id, decision: 'approved' });
    await expect(
      repo.recordApprovalDecision({ approvalId: a.id, decision: 'rejected' }),
    ).rejects.toThrow(/not found or already decided/);
  });
});

describe('InMemoryCoreRepository — notifications + activity log', () => {
  it('activity log is newest-first', async () => {
    const repo = makeRepo(makeAdmin());
    await repo.logActivity({
      module: 'core',
      entityType: 'test',
      entityId: 'a',
      action: 'first',
    });
    await repo.logActivity({
      module: 'core',
      entityType: 'test',
      entityId: 'a',
      action: 'second',
    });
    const rows = await repo.getActivityLog({ entityType: 'test' });
    expect(rows[0]?.action).toBe('second');
    expect(rows[1]?.action).toBe('first');
  });

  it('markNotificationRead scoped to caller', async () => {
    const repo = makeRepo(makeAdmin());
    const n = await repo.enqueueNotification({
      userId: 'user-admin',
      kind: 'test',
    });
    const read = await repo.markNotificationRead(n.id);
    expect(read.readAt).toBeTruthy();
  });

  it('markNotificationRead rejects other users notifications', async () => {
    const admin = makeRepo(makeAdmin());
    const n = await admin.enqueueNotification({ userId: 'user-other', kind: 'test' });
    await expect(admin.markNotificationRead(n.id)).rejects.toThrow(/not found for current user/);
  });
});
