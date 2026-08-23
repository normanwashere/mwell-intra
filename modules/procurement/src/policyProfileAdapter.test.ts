import { describe, expect, it } from 'vitest';
import {
  appliedPolicyProfileSummary,
  mapLivePolicyProfile,
  policyEffectiveDate,
} from './policyProfileAdapter';

describe('governed profile refresh adapter', () => {
  it('keeps the Manila effective date stable when Supabase serializes midnight in UTC', () => {
    expect(policyEffectiveDate('2026-07-31T16:00:00.000Z')).toBe('2026-08-01');
  });

  it('retains the exact non-default profile identity, version, and effective date for the request-detail summary', () => {
    const profile = mapLivePolicyProfile({
      id: '32000000-0000-0000-0000-000000000099',
      code: 'MWELL-UAT-POLICY-REV',
      version: '2026.08.22',
      name: 'Mwell operating policy revision',
      source_filename: 'mWell Procurement Policy and Procedures - Revised Modern Visual - Word Updated.docx',
      source_organization: 'Mwell',
      source_document_status: 'approved',
      status: 'active',
      effective_from: '2026-08-01T00:00:00+08:00',
      control_sources: {},
    });

    expect(profile).toMatchObject({
      id: '32000000-0000-0000-0000-000000000099',
      code: 'MWELL-UAT-POLICY-REV',
      version: '2026.08.22',
      effectiveFrom: '2026-08-01',
    });
    expect(appliedPolicyProfileSummary(profile, profile!.id)).toBe(
      'MWELL-UAT-POLICY-REV 2026.08.22 · effective 2026-08-01 · ID 32000000-0000-0000-0000-000000000099',
    );
  });
});
