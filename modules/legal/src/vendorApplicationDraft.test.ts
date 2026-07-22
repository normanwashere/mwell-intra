import { describe, expect, it, vi } from 'vitest';
import type { VendorApplicationSnapshot } from './types';
import { createVendorApplicationDraftRepository } from './vendorApplicationDraft';

const application = {
  policyVersion: 'vendor-accreditation-v2025',
  entityType: 'corporation',
  jurisdiction: 'PH',
  company: { tradeName: 'Acme' },
  manpower: {},
  technologyServiceProvider: false,
  technologyQualifications: [],
  fieldDispositions: {},
  declaration: {},
} as unknown as VendorApplicationSnapshot;

function liveClient(latest: Record<string, unknown> | null = null) {
  const rpc = vi.fn(async (name: string) => ({
    data:
      name === 'save_vendor_application_draft'
        ? {
            case_id: 'case-1',
            payload: application,
            version: 3,
            status: 'draft' as const,
          }
        : { case_id: 'case-1', version: 3, status: 'superseded' as const },
    error: null,
  }));
  const maybeSingle = vi.fn(async () => ({ data: latest, error: null }));
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    maybeSingle,
  };
  return {
    client: { schema: vi.fn(() => ({ from: vi.fn(() => chain), rpc })) },
    rpc,
    maybeSingle,
  };
}

describe('vendor application draft repository', () => {
  it('loads a vendor-scoped server draft in Supabase mode without reading localStorage', async () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    const live = liveClient({
      payload: application,
      version: 2,
      status: 'draft',
    });
    const repository = createVendorApplicationDraftRepository({
      mode: 'supabase',
      client: live.client,
      storage,
    });

    await expect(repository.load('case-1')).resolves.toMatchObject({
      application,
      version: 2,
      status: 'draft',
    });
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it('saves with optimistic versioning through the guarded RPC', async () => {
    const live = liveClient();
    const repository = createVendorApplicationDraftRepository({
      mode: 'supabase',
      client: live.client,
    });

    await expect(repository.save('case-1', application, 2, 'save-1')).resolves.toMatchObject({
      version: 3,
      status: 'draft',
    });
    expect(live.rpc).toHaveBeenCalledWith('save_vendor_application_draft', {
      payload: {
        case_id: 'case-1',
        application,
        expected_version: 2,
        idempotency_key: 'save-1',
      },
    });
  });

  it('discards a Supabase draft through a governed command', async () => {
    const live = liveClient();
    const repository = createVendorApplicationDraftRepository({
      mode: 'supabase',
      client: live.client,
    });

    await repository.discard('case-1', 3);

    expect(live.rpc).toHaveBeenCalledWith('discard_vendor_application_draft', {
      payload: { case_id: 'case-1', expected_version: 3 },
    });
  });

  it('keeps memory-mode drafts local and removable', async () => {
    const storage = {
      getItem: vi.fn(() => '{}'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const repository = createVendorApplicationDraftRepository({
      mode: 'memory',
      storage,
    });

    await repository.save('case-1', application, 0, 'ignored');
    expect(storage.setItem).toHaveBeenCalledOnce();

    await repository.discard('case-1', 1);
    const persisted = JSON.parse(String(storage.setItem.mock.calls.at(-1)?.[1]));
    expect(persisted).toEqual({});
  });
});
