import { describe, expect, it } from 'vitest';
import { accreditationSummaryCsv, accreditationSummaryFilename } from './caseSummary';
import type { AccreditationCase, RequirementChecklistItem } from './types';

const kase: AccreditationCase = {
  id: 'case_001',
  vendorId: 'vendor_001',
  vendorName: 'Acme Health, Inc.',
  status: 'under_review',
  openedAt: '2026-07-01T00:00:00.000Z',
  jurisdiction: 'PH',
  riskTier: 'high',
};

describe('accreditation case summary export', () => {
  it('uses a stable and safe filename', () => {
    expect(accreditationSummaryFilename(kase)).toBe(
      'mwell-intra-accreditation-acme-health-inc-case_001.csv',
    );
  });

  it('escapes vendor names and reports checklist evidence state', () => {
    const checklist: RequirementChecklistItem[] = [{
      id: 'item_1',
      caseId: kase.id,
      code: 'PH_SEC_REG',
      requirement: 'SEC registration',
      required: true,
      decision: 'approved',
      documentIds: ['doc_1'],
    }];
    const csv = accreditationSummaryCsv(kase, checklist, [{
      id: 'doc_1',
      caseId: kase.id,
      vendorId: kase.vendorId,
      docType: 'SEC registration',
      filename: 'sec.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      status: 'approved',
      version: 1,
      uploadedAt: '2026-07-02T00:00:00.000Z',
    }]);
    expect(csv).toContain('"Acme Health, Inc."');
    expect(csv).toContain('PH_SEC_REG,SEC registration,true,approved');
    expect(csv).toContain(',1,approved');
  });
});
