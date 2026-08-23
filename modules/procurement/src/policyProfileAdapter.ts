import type { ProcurementPolicyProfile } from './types';
import { MWELL_OPERATING_PROFILE } from './policyProfile';

export function policyEffectiveDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Maps the governed profile row read after route confirmation for display. */
export function mapLivePolicyProfile(row: Record<string, unknown>): ProcurementPolicyProfile | null {
  if (
    typeof row.id !== 'string' ||
    typeof row.code !== 'string' ||
    typeof row.version !== 'string' ||
    typeof row.name !== 'string' ||
    typeof row.source_filename !== 'string' ||
    typeof row.source_organization !== 'string' ||
    !['draft_for_review', 'approved'].includes(String(row.source_document_status)) ||
    !['draft', 'active', 'superseded', 'suspended'].includes(String(row.status)) ||
    (typeof row.effective_from !== 'string' && !(row.effective_from instanceof Date))
  ) return null;

  return {
    ...MWELL_OPERATING_PROFILE,
    id: row.id,
    code: row.code,
    version: row.version,
    name: row.name,
    sourceFilename: row.source_filename,
    sourceOrganization: row.source_organization,
    sourceDocumentStatus: row.source_document_status === 'approved' ? 'approved' : 'updated_visual_draft',
    status: row.status as ProcurementPolicyProfile['status'],
    effectiveFrom: policyEffectiveDate(row.effective_from),
    controlSources:
      row.control_sources && typeof row.control_sources === 'object'
        ? row.control_sources as ProcurementPolicyProfile['controlSources']
        : {},
  };
}

export function appliedPolicyProfileSummary(
  profile: ProcurementPolicyProfile | null,
  profileId: string,
): string {
  if (!profile) return `Loading governed profile · effective ... · ID ${profileId}`;
  return `${profile.code} ${profile.version} · effective ${profile.effectiveFrom} · ID ${profileId}`;
}
