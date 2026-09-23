import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson, datasetChecksum, recordHash, verifyDataset } from './hashing';

const record = { record_id: 'id-1', dataset: 'warehouse.products', source_system: 'intra', source_id: 'id-1', source_updated_at: null, data_quality_flags: [], amount: '1.00' };
const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

describe('RFC 8785 integrity contract', () => {
  it('matches the published cross-language golden vectors', () => {
    const vectors = JSON.parse(readFileSync(new URL('../../../../docs/integrations/reporting-api/hash-vectors.json', import.meta.url), 'utf8'));
    for (const fixture of vectors.records) {
      expect(canonicalJson(fixture.input)).toBe(fixture.canonical);
      expect(recordHash(fixture.input)).toBe(fixture.record_hash);
    }
    for (const fixture of vectors.datasets) expect(datasetChecksum(fixture.records)).toBe(fixture.checksum);
  });
  it('matches the RFC canonical serialization, including numeric and escaping rules', () => {
    const value = { numbers: [Number('333333333.33333329'), 1E30, 4.50, 2e-3, 1e-27], string: '\u20ac$\u000f\nA\'B"\\"/', literals: [null, true, false] };
    expect(canonicalJson(value)).toBe('{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"\u20ac$\\u000f\\nA\'B\\"\\\\\\"/"}');
  });
  it('sorts object keys but preserves decimals, Unicode and meaningful array order', () => {
    expect(recordHash(record)).toBe(recordHash({ ...record, record_hash: 'ignored', amount: '1.00' }));
    expect(recordHash(record)).not.toBe(recordHash({ ...record, amount: '1.0' }));
    expect(recordHash(record)).not.toBe(recordHash({ ...record, data_quality_flags: ['missing_link'] }));
    expect(recordHash({ value: null })).not.toBe(recordHash({}));
    expect(recordHash({ v: '\u00e9' })).not.toBe(recordHash({ v: 'e\u0301' }));
    expect(recordHash({ v: [1, 2] })).not.toBe(recordHash({ v: [2, 1] }));
    expect(recordHash({ b: 2, a: 1 })).toBe(sha('{"a":1,"b":2}'));
  });
  it('does not silently omit unexpected record fields such as capture metadata', () => {
    expect(recordHash({ ...record, captured_at: '2026-09-23T00:00:00Z' })).not.toBe(recordHash(record));
  });
  it.each([NaN, Infinity, undefined, new Date(), { a: undefined }, { toJSON: () => ({}) }, '\ud800', [undefined]])('rejects non-JSON input instead of silently normalizing it', value => {
    expect(() => canonicalJson(value)).toThrow();
  });
  it('rejects cycles, custom prototypes and accessors without invoking them', () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrow();
    expect(() => canonicalJson(Object.create({ secret: 'hidden' }))).toThrow();
    expect(() => canonicalJson(Object.defineProperty({}, 'x', { enumerable: true, get() { throw new Error('SECRET'); } }))).toThrow('Invalid reporting data.');
  });
  it('sorts dataset IDs by UTF-8 bytes, not JavaScript UTF-16 collation', () => {
    const a = { record_id: '\ue000', record_hash: 'a'.repeat(64) };
    const b = { record_id: '\ud800\udc00', record_hash: 'b'.repeat(64) };
    expect(datasetChecksum([b, a])).toBe(sha(JSON.stringify([a.record_id, a.record_hash]) + '\n' + JSON.stringify([b.record_id, b.record_hash]) + '\n'));
    expect(datasetChecksum([])).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(() => datasetChecksum([a, a])).toThrow();
    expect(() => datasetChecksum([{ record_id: 'a', record_hash: 'not-a-hash' }])).toThrow();
  });
  it('verifies every record hash and final count/checksum before accepting a dataset', () => {
    const rows = [{ ...record, record_hash: recordHash(record) }];
    const manifest = { hash_algorithm: 'sha256-jcs-v1', record_count: 1, checksum: datasetChecksum(rows) };
    expect(verifyDataset(rows, manifest)).toBe(true);
    expect(() => verifyDataset([{ ...rows[0]!, amount: '2.00' }], manifest)).toThrow();
    expect(() => verifyDataset(rows, { ...manifest, record_count: 2 })).toThrow();
    expect(() => verifyDataset(rows, { ...manifest, checksum: '0'.repeat(64) })).toThrow();
    expect(() => verifyDataset(rows, { ...manifest, hash_algorithm: 'sha256' })).toThrow();
  });
});
