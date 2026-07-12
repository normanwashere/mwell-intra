// Human-language label maps for the legal + vendor surfaces.
//
// Cross-cutting rule (UX-REVIEW-VENDOR-LEGAL.md §3.6, UX-REVIEW-FULL-APP.md
// Exec #4 / LG-3): raw enum slugs (`under_review`, `renewal_due`) must never
// render as user copy. Internal users get concise pipeline labels; vendors get
// plain-language status sentences ("We're reviewing your documents") plus a
// tooltip explainer.

import type { CaseStatus } from './types';

/** Internal (reviewer-facing) status labels — concise, Title case. */
export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  approved: 'Approved',
  provisional: 'Provisional clearance',
  rejected: 'Rejected',
  expired: 'Expired',
  renewal_due: 'Renewal due',
};

/** Vendor-facing plain-language status line (§2.1 / §3.6 label table). */
export const VENDOR_STATUS_LABEL: Record<CaseStatus, string> = {
  draft: 'Action needed — complete your application',
  submitted: 'We\u2019re reviewing your documents',
  under_review: 'We\u2019re reviewing your documents',
  approved: 'Accredited',
  provisional: 'Temporary clearance granted',
  rejected: 'Not approved — see reviewer notes',
  renewal_due: 'Renewal needed',
  expired: 'Accreditation expired',
};

/** Longer vendor-facing explainer that lives behind the status InfoTip. */
export const VENDOR_STATUS_EXPLAINER: Record<CaseStatus, string> = {
  draft:
    'Upload the outstanding documents and sign any pending agreements, then submit for review.',
  submitted:
    'Our Legal team is checking every document you submitted. We\u2019ll flag anything that needs a re-upload.',
  under_review:
    'Our Legal team is checking every document you submitted. We\u2019ll flag anything that needs a re-upload.',
  approved:
    'Your organization is accredited to transact with Mwell. We\u2019ll remind you before it expires.',
  provisional:
    'You have time-limited clearance to transact while a few items are finalized. Complete the outstanding requirements before it expires to become fully accredited.',
  rejected:
    'Legal could not approve the application. Open the case to read the reviewer notes and next steps.',
  renewal_due:
    'Your accreditation expires soon. Re-submit the time-bound documents to stay accredited.',
  expired:
    'Your accreditation has lapsed. Contact your Mwell account manager to start a renewal.',
};

/** Status-dot tone shared by the hero chip, vendor card, and sticky bar. */
export const CASE_STATUS_DOT: Record<CaseStatus, string> = {
  draft: 'bg-slate-400',
  submitted: 'bg-cyan-400',
  under_review: 'bg-amber-400',
  approved: 'bg-emerald-400',
  provisional: 'bg-cyan-400',
  rejected: 'bg-rose-400',
  expired: 'bg-rose-400',
  renewal_due: 'bg-amber-400',
};

/** Badge tone per status (shared table + detail chips). */
export const CASE_STATUS_TONE: Record<
  CaseStatus,
  'slate' | 'cyan' | 'amber' | 'emerald' | 'rose'
> = {
  draft: 'slate',
  submitted: 'cyan',
  under_review: 'amber',
  approved: 'emerald',
  provisional: 'cyan',
  rejected: 'rose',
  expired: 'rose',
  renewal_due: 'amber',
};

/** Timeline action slugs → human labels (both audiences). */
export const TIMELINE_ACTION_LABEL: Record<string, string> = {
  created: 'Case opened',
  submitted: 'Submitted for review',
  approved: 'Accreditation approved',
  rejected: 'Accreditation rejected',
  doc_uploaded: 'Document uploaded',
  doc_reviewed: 'Document reviewed',
  checklist_decided: 'Checklist decided',
  instrument_signed: 'Agreement signed',
  reminder_sent: 'Reminder sent',
};

export function timelineActionLabel(action: string): string {
  return TIMELINE_ACTION_LABEL[action] ?? action.replace(/_/g, ' ');
}

/**
 * One date format for the module (UX-REVIEW-FULL-APP.md Exec #4): en-PH
 * `d MMM yyyy` medium dates. Relative time (`@intra/ui` relativeTime) stays
 * reserved for activity feeds.
 */
export function formatDate(iso: string | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '\u2014';
  return d.toLocaleDateString('en-PH', { dateStyle: 'medium' });
}

/** Date + time, minute precision, for signature artifacts / timeline. */
export function formatDateTime(iso: string | undefined): string {
  if (!iso) return '\u2014';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '\u2014';
  return d.toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
}
