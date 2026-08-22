import { describe, expect, it } from 'vitest';
import {
  MPIC_SOURCE_PROFILE,
  MWELL_OPERATING_PROFILE,
  selectEffectivePolicyProfile,
  validatePolicyProfile,
} from './policyProfile';

describe('procurement policy profile', () => {
  it('retains exact February 2025 source-policy values', () => {
    expect(MPIC_SOURCE_PROFILE.controls).toMatchObject({
      inviteTargetMin: 3,
      inviteTargetMax: 4,
      sealedBidMinimumResponses: 3,
      bidWindowWorkingDays: 7,
      maxExtensionWorkingDays: 7,
      vendorAcknowledgementHours: 24,
      clarificationHours: 48,
      tabulationHours: 48,
      technicalEvaluationWorkingDays: 5,
      poAcknowledgementHours: 48,
      repeatOrderMaxAmount: 250_000,
      repeatOrderMaxAgeDays: 365,
      pettyCashMaxAmount: 2_000,
      poInvoiceThreshold: 50_000,
      vendorProbationMonths: 6,
    });
    expect(MPIC_SOURCE_PROFILE.controls.formalBidAmount).toBeNull();
  });

  it('selects the latest active profile effective on the transaction date', () => {
    const selected = selectEffectivePolicyProfile([
      { ...MWELL_OPERATING_PROFILE, id: 'old', effectiveFrom: '2025-01-01', status: 'superseded' },
      { ...MWELL_OPERATING_PROFILE, id: 'active', effectiveFrom: '2026-08-01', status: 'active' },
    ], '2026-08-22');
    expect(selected.id).toBe('active');
  });

  it('rejects an invite maximum below its minimum', () => {
    expect(() => validatePolicyProfile({
      ...MWELL_OPERATING_PROFILE,
      controls: { ...MWELL_OPERATING_PROFILE.controls, inviteTargetMin: 4, inviteTargetMax: 3 },
    })).toThrow(/invite target/i);
  });

  it('rejects overlapping active Mwell operating profiles', () => {
    expect(() => selectEffectivePolicyProfile([
      { ...MWELL_OPERATING_PROFILE, id: 'a', effectiveFrom: '2026-08-01' },
      { ...MWELL_OPERATING_PROFILE, id: 'b', effectiveFrom: '2026-08-15' },
    ], '2026-08-22')).toThrow(/overlapping/i);
  });
});
