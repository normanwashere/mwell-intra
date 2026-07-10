import type {
  AccreditationCase,
  AccreditationDoc,
  RequirementChecklistItem,
} from './types';

function escapeCell(value: string | number | boolean | undefined): string {
  const text = value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function accreditationSummaryFilename(kase: AccreditationCase): string {
  const safeVendor = kase.vendorName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'vendor';
  return `mwell-intra-accreditation-${safeVendor}-${kase.id}.csv`;
}

export function accreditationSummaryCsv(
  kase: AccreditationCase,
  checklist: RequirementChecklistItem[],
  documents: AccreditationDoc[],
): string {
  const documentById = new Map(documents.map((doc) => [doc.id, doc]));
  const headers = [
    'caseId',
    'vendor',
    'caseStatus',
    'jurisdiction',
    'riskTier',
    'openedAt',
    'submittedAt',
    'decidedAt',
    'expiresAt',
    'requirementCode',
    'requirement',
    'required',
    'decision',
    'reviewedAt',
    'reviewer',
    'documentCount',
    'latestDocumentStatus',
  ];
  const rows = checklist.map((item) => {
    const linked = item.documentIds
      .map((id) => documentById.get(id))
      .filter((doc): doc is AccreditationDoc => Boolean(doc))
      .sort((a, b) => b.version - a.version);
    return [
      kase.id,
      kase.vendorName,
      kase.status,
      kase.jurisdiction,
      kase.riskTier,
      kase.openedAt,
      kase.submittedAt,
      kase.decidedAt,
      kase.expiresAt,
      item.code,
      item.requirement,
      item.required,
      item.decision,
      item.reviewedAt,
      item.reviewerEmail,
      linked.length,
      linked[0]?.status,
    ].map(escapeCell).join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}
