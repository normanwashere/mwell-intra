import { describe, expect, it } from 'vitest';
import { buildLegalSeed } from './seed';
import { computeCaseStatus } from './localStore';

const NOW = new Date('2026-07-06T12:00:00.000Z');

describe('buildLegalSeed', () => {
  const seed = buildLegalSeed(NOW);

  it('seeds six cases across the full lifecycle', () => {
    expect(seed.cases).toHaveLength(6);
    const statuses = seed.cases.map((c) => c.status);
    expect(statuses).toContain('draft');
    expect(statuses).toContain('submitted');
    expect(statuses).toContain('under_review');
    expect(statuses).toContain('rejected');
    expect(statuses.filter((s) => s === 'approved')).toHaveLength(2);
  });

  it('derives renewal_due for the soon-expiring approved case', () => {
    const brightpath = seed.cases.find((c) => c.vendorId === 'ven-brightpath')!;
    expect(brightpath.status).toBe('approved');
    // computeCaseStatus reads Date.now(); assert on the seeded expiry instead
    // of freezing the clock — it must sit within the 30-day renewal window.
    const days =
      (new Date(brightpath.expiresAt!).getTime() - NOW.getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('every case has a tailored checklist', () => {
    for (const kase of seed.cases) {
      const items = seed.checklist.filter((i) => i.caseId === kase.id);
      expect(items.length, `${kase.vendorName} checklist`).toBeGreaterThan(5);
      for (const item of items) {
        expect(item.code).toBeTruthy(); // catalog-backed, not legacy rows
      }
    }
  });

  it('the approved international case is fully documented and signed', () => {
    const global = seed.cases.find((c) => c.vendorId === 'ven-globalhealth')!;
    const items = seed.checklist.filter((i) => i.caseId === global.id);
    expect(items.every((i) => i.decision !== 'pending')).toBe(true);
    const signed = seed.signedInstruments.filter((s) => s.caseId === global.id);
    expect(signed.length).toBeGreaterThanOrEqual(3);
    expect(global.decisionSignature?.signerName).toBe('Andre Villanueva');
    expect(global.submissionSignature?.dataUrl).toMatch(/^data:image\/svg\+xml/);
  });

  it('CareGrid carries a rejected v1 → submitted v2 document chain', () => {
    const caregrid = seed.cases.find((c) => c.vendorId === 'ven-caregrid')!;
    const caseDocs = seed.docs.filter((d) => d.caseId === caregrid.id);
    const rejected = caseDocs.find((d) => d.status === 'rejected');
    expect(rejected).toBeDefined();
    expect(rejected!.version).toBe(1);
    expect(rejected!.reviewerNote).toBeTruthy();
    const resubmission = caseDocs.find(
      (d) => d.requirementId === rejected!.requirementId && d.version === 2,
    );
    expect(resubmission).toBeDefined();
    expect(resubmission!.status).toBe('submitted');
  });

  it('docs are linked both ways (checklist.documentIds ↔ doc.requirementId)', () => {
    for (const doc of seed.docs) {
      if (!doc.requirementId) continue;
      const item = seed.checklist.find((i) => i.id === doc.requirementId);
      expect(item, `doc ${doc.filename} orphaned`).toBeDefined();
      if (doc.status !== 'rejected') {
        expect(item!.documentIds).toContain(doc.id);
      }
    }
  });

  it('signed instruments reference real instrument checklist items', () => {
    for (const sig of seed.signedInstruments) {
      const item = seed.checklist.find(
        (i) => i.caseId === sig.caseId && (i.instrumentCode ?? i.code) === sig.code,
      );
      expect(item, `instrument ${sig.code} not on checklist`).toBeDefined();
      expect(item!.instrument).toBe(true);
    }
  });

  it('timeline covers each case and is sorted newest-first', () => {
    for (const kase of seed.cases) {
      const entries = seed.timeline.filter((t) => t.caseId === kase.id);
      expect(entries.length, `${kase.vendorName} timeline`).toBeGreaterThanOrEqual(1);
      expect(entries.some((t) => t.action === 'created')).toBe(true);
    }
    const times = seed.timeline.map((t) => t.at);
    const sorted = [...times].sort((a, b) => b.localeCompare(a));
    expect(times).toEqual(sorted);
  });

  it('invites exist for the fresh draft case', () => {
    expect(seed.invites.length).toBeGreaterThanOrEqual(1);
    const vertex = seed.invites.find((i) => i.companyName.startsWith('Vertex'));
    expect(vertex?.status).toBe('sent');
    expect(vertex?.jurisdiction).toBe('UK');
  });

  it('vendor scoping is intact — Acme sees exactly one case', () => {
    expect(seed.cases.filter((c) => c.vendorId === 'ven-acme')).toHaveLength(1);
    // No vendorId collisions with mismatched names (hygiene would fire).
    const byVendor = new Map<string, Set<string>>();
    for (const c of seed.cases) {
      const names = byVendor.get(c.vendorId) ?? new Set<string>();
      names.add(c.vendorName);
      byVendor.set(c.vendorId, names);
    }
    for (const [vendorId, names] of byVendor) {
      expect(names.size, `vendorId ${vendorId} collides`).toBe(1);
    }
  });

  it('all dates are in the past except accreditation expiries', () => {
    const nowMs = NOW.getTime();
    for (const kase of seed.cases) {
      expect(new Date(kase.openedAt).getTime()).toBeLessThanOrEqual(nowMs);
      if (kase.submittedAt) {
        expect(new Date(kase.submittedAt).getTime()).toBeLessThanOrEqual(nowMs);
      }
      if (kase.decidedAt) {
        expect(new Date(kase.decidedAt).getTime()).toBeLessThanOrEqual(nowMs);
      }
    }
    for (const doc of seed.docs) {
      expect(new Date(doc.uploadedAt).getTime()).toBeLessThanOrEqual(nowMs);
    }
  });

  it('is deterministic for a fixed now', () => {
    expect(buildLegalSeed(NOW)).toEqual(seed);
  });
});

describe('computeCaseStatus on seeded data', () => {
  it('flags the soon-expiring approved case as renewal_due', () => {
    const seed = buildLegalSeed(new Date());
    const brightpath = seed.cases.find((c) => c.vendorId === 'ven-brightpath')!;
    expect(computeCaseStatus(brightpath)).toBe('renewal_due');
  });
});
