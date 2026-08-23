import { describe, expect, it } from 'vitest';
import {
  MPIC_SOURCE_PROFILE,
  MPIC_SOURCE_FILENAME,
  MWELL_OPERATING_PROFILE,
  MWELL_OPERATING_SOURCE_FILENAME,
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
      maxExtensionCalendarDays: 7,
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

  it('inherits every non-local control from MPIC and attributes every Mwell control', () => {
    for (const control of Object.keys(MPIC_SOURCE_PROFILE.controls) as Array<
      keyof typeof MPIC_SOURCE_PROFILE.controls
    >) {
      if (control !== 'formalBidAmount') {
        expect(MWELL_OPERATING_PROFILE.controls[control]).toBe(MPIC_SOURCE_PROFILE.controls[control]);
        expect(MWELL_OPERATING_PROFILE.controlSources[control]?.trim()).toContain(MPIC_SOURCE_FILENAME);
      } else {
        expect(MWELL_OPERATING_PROFILE.controlSources[control]?.trim()).toContain(
          MWELL_OPERATING_SOURCE_FILENAME,
        );
      }
      expect(MWELL_OPERATING_PROFILE.controlSources[control]?.trim()).toBeTruthy();
    }
    expect(MWELL_OPERATING_PROFILE.controls.formalBidAmount).toBe(1_000_000);
    expect(MWELL_OPERATING_PROFILE.sourceDocumentStatus).toBe('updated_visual_draft');
  });

  it('blocks activation when the controlled Mwell source remains a draft for review', () => {
    expect(() => validatePolicyProfile({
      ...MWELL_OPERATING_PROFILE,
      status: 'active',
    })).toThrow(/approved source document status/i);
  });

  it('selects the latest active profile effective on the transaction date', () => {
    const selected = selectEffectivePolicyProfile([
      { ...MWELL_OPERATING_PROFILE, id: 'old', effectiveFrom: '2025-01-01', status: 'superseded' },
      { ...MWELL_OPERATING_PROFILE, id: 'active', effectiveFrom: '2026-08-01', status: 'active', sourceDocumentStatus: 'approved' },
    ], '2026-08-22');
    expect(selected.id).toBe('active');
  });

  it('rejects an invite maximum below its minimum', () => {
    expect(() => validatePolicyProfile({
      ...MWELL_OPERATING_PROFILE,
      controls: { ...MWELL_OPERATING_PROFILE.controls, inviteTargetMin: 4, inviteTargetMax: 3 },
    })).toThrow(/invite target/i);
  });

  it.each([
    ['a non-canonical Mwell source filename', { sourceFilename: 'policy.docx' }, /source profile/i],
    ['a missing inherited MPIC profile', { inheritedFromProfileId: undefined }, /inherited/i],
    ['a blank control source', { status: 'active' as const, sourceDocumentStatus: 'approved' as const, controlSources: { ...MWELL_OPERATING_PROFILE.controlSources, inviteTargetMin: '  ' } }, /source attribution/i],
  ])('rejects %s before an operating profile can activate', (_name, patch, message) => {
    expect(() => validatePolicyProfile({
      ...MWELL_OPERATING_PROFILE,
      ...patch,
    })).toThrow(message);
  });

  it.each([
    ['zero invite minimum', { inviteTargetMin: 0 }],
    ['fractional invite maximum', { inviteTargetMax: 3.5 }],
    ['zero sealed response minimum', { sealedBidMinimumResponses: 0 }],
    ['fractional bid window', { bidWindowWorkingDays: 7.5 }],
    ['zero vendor acknowledgement duration', { vendorAcknowledgementHours: 0 }],
    ['fractional probation duration', { vendorProbationMonths: 0.5 }],
  ])('rejects %s', (_name, controls) => {
    expect(() => validatePolicyProfile({
      ...MWELL_OPERATING_PROFILE,
      controls: { ...MWELL_OPERATING_PROFILE.controls, ...controls },
    })).toThrow(/positive integer/i);
  });

  it('rejects a sealed-bid response minimum above the invitation maximum', () => {
    expect(() => validatePolicyProfile({
      ...MWELL_OPERATING_PROFILE,
      controls: {
        ...MWELL_OPERATING_PROFILE.controls,
        inviteTargetMin: 3,
        inviteTargetMax: 3,
        sealedBidMinimumResponses: 4,
      },
    })).toThrow(/sealed-bid minimum/i);
  });

  it('rejects overlapping active Mwell operating profiles', () => {
    expect(() => selectEffectivePolicyProfile([
      { ...MWELL_OPERATING_PROFILE, id: 'a', effectiveFrom: '2026-08-01', status: 'active', sourceDocumentStatus: 'approved' },
      { ...MWELL_OPERATING_PROFILE, id: 'b', effectiveFrom: '2026-08-15', status: 'active', sourceDocumentStatus: 'approved' },
    ], '2026-08-22')).toThrow(/overlapping/i);
  });

  it('rejects absent, inactive-only, and suspended-only profile selections', () => {
    expect(() => selectEffectivePolicyProfile([], '2026-08-22')).toThrow(/no active/i);
    expect(() => selectEffectivePolicyProfile([
      { ...MWELL_OPERATING_PROFILE, status: 'draft' },
    ], '2026-08-22')).toThrow(/no active/i);
    expect(() => selectEffectivePolicyProfile([
      { ...MWELL_OPERATING_PROFILE, status: 'suspended' },
    ], '2026-08-22')).toThrow(/no active/i);
  });

  it('treats effective date boundaries as inclusive and rejects invalid transaction dates', () => {
    const bounded = {
      ...MWELL_OPERATING_PROFILE,
      status: 'active' as const,
      sourceDocumentStatus: 'approved' as const,
      effectiveFrom: '2026-08-22',
      effectiveTo: '2026-08-24',
    };
    expect(selectEffectivePolicyProfile([bounded], '2026-08-22').id).toBe(bounded.id);
    expect(selectEffectivePolicyProfile([bounded], '2026-08-24').id).toBe(bounded.id);
    expect(() => selectEffectivePolicyProfile([bounded], '2026-08-21')).toThrow(/no active/i);
    expect(() => selectEffectivePolicyProfile([bounded], '2026-02-30')).toThrow(/valid ISO date/i);
  });
});
