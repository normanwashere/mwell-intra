// Persistence specs for the legal localStore (T1.2): signed-instrument
// records, timeline writes, and reminder bookkeeping. A minimal
// window/localStorage shim stands in for the browser.

import { beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

const storage = new MemoryStorage();
vi.stubGlobal('window', {
  localStorage: storage,
  dispatchEvent: () => true,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
});

// Import AFTER the shim so module-level `typeof window` checks see it.
const { signInstrument } = await import('./localStore');

const SIGNED_KEY = 'intra.legal.v1.signed_instruments';
const TIMELINE_KEY = 'intra.legal.v1.timeline';

function readJson<T>(key: string): T[] {
  const raw = storage.getItem(key);
  return raw ? (JSON.parse(raw) as T[]) : [];
}

beforeEach(() => {
  storage.clear();
});

describe('signInstrument persistence', () => {
  const input = {
    caseId: 'case_1',
    code: 'SIGN_NDA',
    templateVersion: '2026.07.01',
    signerName: 'Alice Vendor',
    signerEmail: 'vendor@acme.demo',
    signaturePng: 'data:image/png;base64,abc',
    signatureMethod: 'drawn' as const,
    signerUa: 'test-agent | tzOffset=-480',
    fields: { has_relationship: 'no' },
  };

  it('persists a SignedInstrument row with a snapshot of the version', () => {
    const record = signInstrument(input);
    const rows = readJson<typeof record>(SIGNED_KEY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: record.id,
      caseId: 'case_1',
      code: 'SIGN_NDA',
      templateVersion: '2026.07.01',
      signerName: 'Alice Vendor',
      signatureMethod: 'drawn',
      signaturePng: 'data:image/png;base64,abc',
      fields: { has_relationship: 'no' },
    });
    expect(rows[0]!.signedAt).toBeTruthy();
  });

  it('writes an instrument_signed timeline entry for the case', () => {
    signInstrument(input);
    const timeline = readJson<{ caseId: string; action: string; detail?: string }>(
      TIMELINE_KEY,
    );
    const entry = timeline.find((t) => t.action === 'instrument_signed');
    expect(entry).toBeTruthy();
    expect(entry!.caseId).toBe('case_1');
    expect(entry!.detail).toContain('SIGN_NDA');
    expect(entry!.detail).toContain('Alice Vendor');
  });

  it('stacks multiple signatures newest-first', () => {
    const first = signInstrument(input);
    const second = signInstrument({ ...input, code: 'SIGN_COI' });
    const rows = readJson<{ id: string; code: string }>(SIGNED_KEY);
    expect(rows.map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it('keeps signatures scoped per case', () => {
    signInstrument(input);
    signInstrument({ ...input, caseId: 'case_2' });
    const rows = readJson<{ caseId: string }>(SIGNED_KEY);
    expect(rows.filter((r) => r.caseId === 'case_1')).toHaveLength(1);
    expect(rows.filter((r) => r.caseId === 'case_2')).toHaveLength(1);
  });

  it('omits fields when the template has none', () => {
    const record = signInstrument({ ...input, fields: undefined });
    const rows = readJson<{ id: string; fields?: unknown }>(SIGNED_KEY);
    expect(rows[0]!.id).toBe(record.id);
    expect(rows[0]!.fields).toBeUndefined();
  });

  it('binds both technology MNDA signatures to the same immutable hash', () => {
    const hash = 'a'.repeat(64);
    const vendor = signInstrument({
      ...input,
      templateVersion: 'mnda-tech-service-provider-2026.06.10-clean-v1',
      documentHash: hash,
      signerParty: 'service_provider',
    });
    const mwell = signInstrument({
      ...input,
      templateVersion: 'mnda-tech-service-provider-2026.06.10-clean-v1',
      signerName: 'Approved MPHTC Signatory',
      signerEmail: 'legal@mwell.com.ph',
      documentHash: hash,
      signerParty: 'mphtc',
    });
    expect(vendor.documentHash).toBe(hash);
    expect(mwell.documentHash).toBe(hash);
    expect(readJson<{ documentHash?: string }>(SIGNED_KEY)).toHaveLength(2);
  });

  it('rejects a countersignature for a different document hash', () => {
    signInstrument({
      ...input,
      templateVersion: 'mnda-tech-service-provider-2026.06.10-clean-v1',
      documentHash: 'a'.repeat(64),
      signerParty: 'service_provider',
    });
    expect(() =>
      signInstrument({
        ...input,
        templateVersion: 'mnda-tech-service-provider-2026.06.10-clean-v1',
        documentHash: 'b'.repeat(64),
        signerParty: 'mphtc',
      }),
    ).toThrow('same document hash');
  });
});
