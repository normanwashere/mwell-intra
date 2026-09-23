import { createHash } from 'node:crypto';
import canonicalize from 'canonicalize';
import { hashSchema, integritySchema } from './contracts';
import { ReportingError } from './errors';
import { MAX_JSON_DEPTH, MAX_PAGE_BYTES } from './json';

function assertJson(value: unknown, depth = 0, seen = new WeakSet<object>()): void {
  const bad = () => { throw new ReportingError('invalid_data'); };
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') { if (!value.isWellFormed()) bad(); return; }
  if (typeof value === 'number') { if (!Number.isFinite(value)) bad(); return; }
  if (typeof value !== 'object' || depth >= MAX_JSON_DEPTH || seen.has(value)) bad();
  const object = value as object;
  const array = Array.isArray(object);
  if (Object.getPrototypeOf(object) !== (array ? Array.prototype : Object.prototype) && (array || Object.getPrototypeOf(object) !== null)) bad();
  seen.add(object);
  const keys = Reflect.ownKeys(object);
  if (array && keys.length !== (object as unknown[]).length + 1) bad();
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
    if (typeof key !== 'string' || !key.isWellFormed() || !descriptor.enumerable || !('value' in descriptor)) bad();
    if (array && (!/^(0|[1-9]\d*)$/.test(key as string) || Number(key) >= (object as unknown[]).length)) bad();
    assertJson(descriptor.value, depth + 1, seen);
  }
  seen.delete(object);
}

export function canonicalJson(value: unknown): string {
  assertJson(value);
  const result = canonicalize(value);
  if (result === undefined || Buffer.byteLength(result) > MAX_PAGE_BYTES) throw new ReportingError('invalid_data');
  return result;
}

export function recordHash(value: unknown): string {
  assertJson(value);
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new ReportingError('invalid_data');
  const record = { ...value } as Record<string, unknown>;
  // Capture timestamps belong in manifests. Never silently drop business fields.
  delete record.record_hash;
  return createHash('sha256').update(canonicalJson(record), 'utf8').digest('hex');
}

type DigestRecord = { record_id: string; record_hash: string };
export function datasetChecksum(rows: readonly DigestRecord[]): string {
  const ids = new Set<string>();
  for (const row of rows) {
    if (typeof row.record_id !== 'string' || !row.record_id || !row.record_id.isWellFormed() || ids.has(row.record_id) || !hashSchema.safeParse(row.record_hash).success) throw new ReportingError('invalid_data');
    ids.add(row.record_id);
  }
  const sorted = [...rows].sort((a, b) => Buffer.compare(Buffer.from(a.record_id, 'utf8'), Buffer.from(b.record_id, 'utf8')));
  const hash = createHash('sha256');
  for (const row of sorted) hash.update(canonicalJson([row.record_id, row.record_hash]) + '\n', 'utf8');
  return hash.digest('hex');
}

// Integrity only. Callers must additionally validate dataset-specific schemas and authority.
export function verifyDataset(rows: readonly (DigestRecord & Record<string, unknown>)[], manifest: unknown): true {
  const result = integritySchema.safeParse(manifest);
  if (!result.success || rows.length !== result.data.record_count) throw new ReportingError('invalid_data');
  for (const row of rows) if (row.record_hash !== recordHash(row)) throw new ReportingError('invalid_data');
  if (datasetChecksum(rows) !== result.data.checksum) throw new ReportingError('invalid_data');
  return true;
}
