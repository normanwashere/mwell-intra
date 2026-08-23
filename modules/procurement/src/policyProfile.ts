import type {
  ProcurementPolicyControls,
  ProcurementPolicyProfile,
} from './types';

export const MPIC_SOURCE_FILENAME = 'MPIC Procurement Policy February2025.docx';
export const MWELL_OPERATING_SOURCE_FILENAME =
  'mWell Procurement Policy and Procedures - Revised Modern Visual - Word Updated.docx';

const MPIC_CONTROL_SOURCE = `${MPIC_SOURCE_FILENAME} (February 2025)`;
const MWELL_CONTROL_SOURCE = `${MWELL_OPERATING_SOURCE_FILENAME} (canonical Mwell requirements source)`;

const CONTROL_KEYS: Array<keyof ProcurementPolicyControls> = [
  'formalBidAmount',
  'inviteTargetMin',
  'inviteTargetMax',
  'sealedBidMinimumResponses',
  'bidWindowWorkingDays',
  'maxExtensionCalendarDays',
  'vendorAcknowledgementHours',
  'clarificationHours',
  'tabulationHours',
  'technicalEvaluationWorkingDays',
  'poAcknowledgementHours',
  'repeatOrderMaxAmount',
  'repeatOrderMaxAgeDays',
  'pettyCashMaxAmount',
  'poInvoiceThreshold',
  'vendorProbationMonths',
];

const POSITIVE_INTEGER_CONTROLS: Array<keyof ProcurementPolicyControls> = [
  'inviteTargetMin',
  'inviteTargetMax',
  'sealedBidMinimumResponses',
  'bidWindowWorkingDays',
  'maxExtensionCalendarDays',
  'vendorAcknowledgementHours',
  'clarificationHours',
  'tabulationHours',
  'technicalEvaluationWorkingDays',
  'poAcknowledgementHours',
  'repeatOrderMaxAgeDays',
  'vendorProbationMonths',
];

const MPIC_CONTROLS: ProcurementPolicyControls = {
  // The parent source contains no Mwell-specific formal-bid amount.
  formalBidAmount: null,
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
};

const inheritedControlSources = Object.fromEntries(
  CONTROL_KEYS
    .filter((control) => control !== 'formalBidAmount')
    .map((control) => [control, MPIC_CONTROL_SOURCE]),
) as Partial<Record<keyof ProcurementPolicyControls, string>>;

/**
 * Parent governance source. It is deliberately a draft source profile: only an
 * activated Mwell operating profile can govern a live Mwell transaction.
 */
export const MPIC_SOURCE_PROFILE: ProcurementPolicyProfile = {
  id: 'mpic-procurement-policy-february-2025',
  code: 'MPIC-PROCUREMENT-2025-02',
  version: '2025-02',
  name: 'MPIC Procurement Policy February 2025',
  sourceFilename: MPIC_SOURCE_FILENAME,
  sourceDocumentStatus: 'approved',
  sourceOrganization: 'MPIC',
  relationship: 'parent_source',
  controlSources: Object.fromEntries(
    CONTROL_KEYS
      .map((control) => [control, MPIC_CONTROL_SOURCE]),
  ) as Partial<Record<keyof ProcurementPolicyControls, string>>,
  status: 'draft',
  effectiveFrom: '2025-02-01',
  controls: MPIC_CONTROLS,
};

/**
 * Current local operating profile. Its formal-bid threshold is an Mwell
 * control, while the remaining controls retain their MPIC source labels.
 */
export const MWELL_OPERATING_PROFILE: ProcurementPolicyProfile = {
  id: 'mwell-operating-policy-2026-08',
  code: 'MWELL-PROCUREMENT-OPERATING',
  version: '2026-08',
  name: 'Mwell Procurement Operating Policy',
  sourceFilename: MWELL_OPERATING_SOURCE_FILENAME,
  sourceDocumentStatus: 'updated_visual_draft',
  sourceOrganization: 'Mwell',
  relationship: 'mwell_operating',
  inheritedFromProfileId: MPIC_SOURCE_PROFILE.id,
  controlSources: {
    ...inheritedControlSources,
    formalBidAmount: MWELL_CONTROL_SOURCE,
  },
  status: 'draft',
  effectiveFrom: '2026-01-01',
  controls: {
    ...MPIC_CONTROLS,
    formalBidAmount: 1_000_000,
  },
};

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function assertExactSourceFilename(profile: ProcurementPolicyProfile): void {
  if (!profile.sourceFilename || profile.sourceFilename.trim() !== profile.sourceFilename) {
    throw new Error('An exact source filename is required.');
  }
  if (profile.sourceFilename.includes('/') || profile.sourceFilename.includes('\\')) {
    throw new Error('Source filename must not include a directory path.');
  }
  if (
    profile.relationship === 'parent_source'
    && profile.sourceFilename !== MPIC_SOURCE_FILENAME
  ) {
    throw new Error(`Parent source profile must reference ${MPIC_SOURCE_FILENAME}.`);
  }
  if (
    profile.relationship === 'mwell_operating'
    && profile.sourceFilename !== MWELL_OPERATING_SOURCE_FILENAME
  ) {
    throw new Error(`Mwell operating source profile must reference ${MWELL_OPERATING_SOURCE_FILENAME}.`);
  }
}

function assertOperatingProfileProvenance(profile: ProcurementPolicyProfile): void {
  if (profile.relationship !== 'mwell_operating') return;
  if (!profile.inheritedFromProfileId?.trim()) {
    throw new Error('Mwell operating profiles must identify their inherited parent profile.');
  }
  if (profile.status !== 'active') return;

  if (profile.sourceDocumentStatus !== 'approved') {
    throw new Error('An approved source document status is required before profile activation.');
  }

  for (const control of CONTROL_KEYS) {
    if (!profile.controlSources[control]?.trim()) {
      throw new Error(`A source attribution is required for policy control ${control} before activation.`);
    }
  }
}

/** Validates the invariant controls that must exist before a profile is saved. */
export function validatePolicyProfile(profile: ProcurementPolicyProfile): ProcurementPolicyProfile {
  assertExactSourceFilename(profile);
  assertOperatingProfileProvenance(profile);

  if (!isIsoDate(profile.effectiveFrom)) {
    throw new Error('Profile effective-from date must be a valid ISO date.');
  }
  if (profile.effectiveTo !== undefined) {
    if (!isIsoDate(profile.effectiveTo)) {
      throw new Error('Profile effective-to date must be a valid ISO date.');
    }
    if (profile.effectiveTo < profile.effectiveFrom) {
      throw new Error('Profile effective-to date cannot precede the effective-from date.');
    }
  }

  for (const key of CONTROL_KEYS) {
    const value = profile.controls[key];
    if (key === 'formalBidAmount' && value === null) continue;
    if (value === null || !Number.isFinite(value) || value < 0) {
      throw new Error(`Policy control ${key} must be a non-negative value.`);
    }
  }

  for (const key of POSITIVE_INTEGER_CONTROLS) {
    const value = profile.controls[key];
    if (value === null || !Number.isInteger(value) || value <= 0) {
      throw new Error(`Policy control ${key} must be a positive integer.`);
    }
  }

  const { controls } = profile;
  if (controls.inviteTargetMin > controls.inviteTargetMax) {
    throw new Error('Invite target maximum cannot be below the invite target minimum.');
  }
  if (controls.sealedBidMinimumResponses > controls.inviteTargetMax) {
    throw new Error('Sealed-bid minimum responses cannot exceed the invite target maximum.');
  }
  return profile;
}

function isEffectiveOn(profile: ProcurementPolicyProfile, transactionDate: string): boolean {
  return profile.effectiveFrom <= transactionDate
    && (profile.effectiveTo === undefined || profile.effectiveTo >= transactionDate);
}

/**
 * Selects one effective Mwell operating profile for a transaction. Overlap is
 * rejected because an amount/control decision must always be reproducible.
 */
export function selectEffectivePolicyProfile(
  profiles: readonly ProcurementPolicyProfile[],
  transactionDate: string,
): ProcurementPolicyProfile {
  if (!isIsoDate(transactionDate)) {
    throw new Error('Transaction date must be a valid ISO date.');
  }
  const effective = profiles
    .filter((profile) => profile.relationship === 'mwell_operating')
    .filter((profile) => profile.status === 'active')
    .filter((profile) => isEffectiveOn(profile, transactionDate));

  if (effective.length === 0) {
    throw new Error('No active Mwell operating policy profile is effective on the transaction date.');
  }
  if (effective.length > 1) {
    throw new Error('Overlapping active Mwell operating policy profiles are not permitted.');
  }

  return validatePolicyProfile(effective[0]!);
}
