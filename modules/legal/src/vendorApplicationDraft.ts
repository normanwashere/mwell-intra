import type { VendorApplicationSnapshot } from './types';

const LOCAL_KEY = 'intra.legal.v3.vendor_applications';

interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface DraftRow {
  case_id?: string;
  payload?: VendorApplicationSnapshot;
  version?: number;
  status?: 'draft' | 'submitted' | 'superseded' | 'policy_review_required';
}

interface DraftQuery {
  select(columns: string): DraftQuery;
  eq(column: string, value: string): DraftQuery;
  in(column: string, values: string[]): DraftQuery;
  order(column: string, options: { ascending: boolean }): DraftQuery;
  limit(value: number): DraftQuery;
  maybeSingle(): Promise<{
    data: DraftRow | null;
    error: { message: string } | null;
  }>;
}

interface LegalDraftClient {
  schema(name: 'legal'): {
    from(table: 'vendor_application_snapshots'): DraftQuery;
    rpc(
      name: 'save_vendor_application_draft' | 'discard_vendor_application_draft',
      args: { payload: Record<string, unknown> },
    ): Promise<{ data: DraftRow | null; error: { message: string } | null }>;
  };
}

export interface VendorApplicationDraftRecord {
  application?: VendorApplicationSnapshot;
  version: number;
  status: DraftRow['status'];
}

export interface VendorApplicationDraftRepository {
  load(caseId: string): Promise<VendorApplicationDraftRecord | null>;
  save(
    caseId: string,
    application: VendorApplicationSnapshot,
    expectedVersion: number,
    idempotencyKey: string,
  ): Promise<VendorApplicationDraftRecord>;
  discard(caseId: string, expectedVersion: number): Promise<void>;
}

function browserStorage(): DraftStorage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function readMemory(storage: DraftStorage | undefined): Record<string, VendorApplicationSnapshot | VendorApplicationDraftRecord> {
  if (!storage) return {};
  try {
    return JSON.parse(storage.getItem(LOCAL_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function memoryRecord(value?: VendorApplicationSnapshot | VendorApplicationDraftRecord): VendorApplicationDraftRecord | null {
  if (!value) return null;
  return 'version' in value ? value : { application: value, version: 1, status: 'draft' };
}

function mapRow(row: DraftRow | null): VendorApplicationDraftRecord | null {
  if (!row) return null;
  return {
    application: row.status === 'superseded' ? undefined : row.payload,
    version: Number(row.version ?? 0),
    status: row.status,
  };
}

export function createVendorApplicationDraftRepository(options: {
  mode: 'memory' | 'supabase';
  client?: LegalDraftClient | null;
  storage?: DraftStorage;
  canManageDraft?: boolean;
}): VendorApplicationDraftRepository {
  const storage = options.storage ?? browserStorage();
  const client = options.client;

  if (options.mode === 'supabase' && !client) {
    throw new Error('The Legal draft service is not configured.');
  }

  const assertCanManageDraft = () => {
    if (options.canManageDraft !== true) {
      throw new Error('Accreditation draft access required.');
    }
  };

  return {
    async load(caseId) {
      if (options.mode === 'memory') {
        return memoryRecord(readMemory(storage)[caseId]);
      }
      const { data, error } = await client!
        .schema('legal')
        .from('vendor_application_snapshots')
        .select('case_id,payload,version,status,updated_at')
        .eq('case_id', caseId)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return mapRow(data);
    },

    async save(caseId, application, expectedVersion, idempotencyKey) {
      assertCanManageDraft();
      if (options.mode === 'memory') {
        if (!storage) throw new Error('Browser storage is unavailable.');
        const rows = readMemory(storage);
        if ((memoryRecord(rows[caseId])?.version ?? 0) !== expectedVersion) throw new Error('Draft version changed; reload before saving.');
        storage.setItem(LOCAL_KEY, JSON.stringify({ ...rows, [caseId]: { application, version: expectedVersion + 1, status: 'draft' } }));
        return {
          application,
          version: Math.max(expectedVersion + 1, 1),
          status: 'draft',
        };
      }
      const { data, error } = await client!.schema('legal').rpc('save_vendor_application_draft', {
        payload: {
          case_id: caseId,
          application,
          expected_version: expectedVersion,
          idempotency_key: idempotencyKey,
        },
      });
      if (error) throw new Error(error.message);
      const mapped = mapRow(data);
      if (!mapped) throw new Error('The draft service returned no saved draft.');
      return mapped;
    },

    async discard(caseId, expectedVersion) {
      assertCanManageDraft();
      if (options.mode === 'memory') {
        if (!storage) return;
        const rows = readMemory(storage);
        const current = memoryRecord(rows[caseId]);
        if ((current?.version ?? 0) !== expectedVersion) throw new Error('Draft version changed; reload before discarding.');
        rows[caseId] = { version: expectedVersion, status: 'superseded' };
        storage.setItem(LOCAL_KEY, JSON.stringify(rows));
        return;
      }
      const { error } = await client!.schema('legal').rpc('discard_vendor_application_draft', {
        payload: { case_id: caseId, expected_version: expectedVersion },
      });
      if (error) throw new Error(error.message);
    },
  };
}

export type { LegalDraftClient };
