'use client';

// Accreditation case workspace (T1.3 / T1.5 / T2 + UX-REVIEW-VENDOR-LEGAL.md
// §2.2, F1.1, F2).
//
// - Vendor-ownership guard: vendors can only render their own case (F1.1).
// - Sticky progress bar (status + n/m + next action) once the hero scrolls
//   away (§2.2.1); sits under the shell/vendor chrome (z-10 < header z-20).
// - Meta tile grid demoted to one muted line + (i) popover (§2.2.4); the hero
//   eyebrow carries status ("Accreditation case · Under review").
// - Checklist groups with every required item approved render collapsed as a
//   ✓ summary row; groups with rejected/open items auto-expand (§2.2.2), and
//   rows sort rejected-first inside each group (§2.2.5).
// - Row-as-target: the requirement card itself opens the review sheet
//   (internal) or upload/sign action (vendor); per-row buttons reduce to
//   status + chevron (§2.2.3). Keyboard accessible (role=button,
//   Enter/Space).
// - Doc version chains: newest doc renders full, older versions collapse
//   under "N previous versions" (F2.1). Internal reviewers additionally get a
//   case-level Documents panel (F2.2) and a read-only "Previous cycle
//   documents" disclosure on renewal cases (F2.3).
// - Vendors see plain-language status labels everywhere (§3.6).

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  Badge,
  Card,
  DataTable,
  HeroChipButton,
  Icon,
  InfoTip,
  ModuleHero,
  SectionTitle,
  Sheet,
  SignaturePad,
  relativeTime,
  useToast,
  type Column,
  type SignaturePayload,
} from '@intra/ui';
import { Guard, useCan, useSession } from '@intra/auth';
import type {
  AccreditationCase,
  AccreditationDoc,
  CaseSignature,
  ChecklistDecision,
  RequirementChecklistItem,
  SignedInstrument,
} from '../types';
import { JURISDICTION_LABEL, RISK_TIER_LABEL } from '../types';
import {
  computeCaseStatus,
  useAccreditationCases,
  useAccreditationDocs,
  useCaseTimeline,
  useChecklist,
  useSignedInstruments,
  useVendorAliases,
} from '../localStore';
import {
  computeCaseProgress,
  docVersionChain,
  groupLabel,
  groupOrderIndex,
  isGroupSolved,
  itemExpiringSoon,
  sortChecklistRows,
} from '../caseLogic';
import {
  CASE_STATUS_DOT,
  CASE_STATUS_LABEL,
  formatDate,
  formatDateTime,
  timelineActionLabel,
  VENDOR_STATUS_LABEL,
} from '../labels';
import { shouldBlockVendorAccess } from '../vendorAccess';
import { daysUntil } from '../requirements/policy';
import { DocumentUploader } from '../components/DocumentUploader';
import { SignedRecord } from './SignInstrumentPage';

const CHECKLIST_TONE: Record<ChecklistDecision, 'slate' | 'emerald' | 'rose' | 'amber'> = {
  pending: 'amber',
  approved: 'emerald',
  rejected: 'rose',
  na: 'slate',
};

const CHECKLIST_LABEL: Record<ChecklistDecision, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  na: 'N/A',
};

const DOC_STATUS_LABEL: Record<AccreditationDoc['status'], string> = {
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
};

function toCaseSignature(sig: SignaturePayload): CaseSignature {
  return {
    method: sig.method,
    dataUrl: sig.dataUrl,
    signerName: sig.signerName,
    signedAt: sig.signedAt,
    userAgent: sig.userAgent,
  };
}

export function CaseDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const {
    getById,
    submitCase,
    decideCase,
    sendReminder,
    loading: casesLoading,
  } = useAccreditationCases();
  const { forCase: checklistForCase, review, attach } = useChecklist();
  const { forCase: docsForCase, setStatus: setDocStatus } = useAccreditationDocs();
  const { forCase: signedForCase } = useSignedInstruments();
  const { rows: aliases } = useVendorAliases();
  const { rows: timeline } = useCaseTimeline(id);
  const { success, error } = useToast();
  const { profile } = useSession();
  // NOTE: `Guard fallback={null}` renders the default AccessDenied block
  // (null ?? <AccessDenied/>), so capability-dependent actions use useCan.
  const canApprove = useCan('legal', 'approve_accreditation');
  const canReview = useCan('legal', 'review_accreditation');
  const canUpload = useCan('core', 'submit_documents');

  const kase: AccreditationCase | undefined = getById(id);
  const items = useMemo(() => checklistForCase(id), [checklistForCase, id]);
  const docs = useMemo(() => docsForCase(id), [docsForCase, id]);
  const signed = useMemo(() => signedForCase(id), [signedForCase, id]);
  const evidence = useMemo(() => ({ docs, signed }), [docs, signed]);
  const progress = useMemo(
    () => computeCaseProgress(items, evidence),
    [items, evidence],
  );

  const groupedItems = useMemo(() => {
    const map = new Map<string, RequirementChecklistItem[]>();
    for (const item of items) {
      const key = item.group ?? '__general';
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return [...map.entries()]
      .sort(
        (a, b) =>
          groupOrderIndex(a[1][0]?.group) - groupOrderIndex(b[1][0]?.group),
      )
      .map(([key, rows]) => [key, sortChecklistRows(rows, evidence)] as const);
  }, [items, evidence]);

  const [decisionOpen, setDecisionOpen] = useState<null | 'approved' | 'rejected'>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [decisionExpiry, setDecisionExpiry] = useState('');
  const [decisionScope, setDecisionScope] = useState('');
  const [decisionSignature, setDecisionSignature] = useState<SignaturePayload | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitSignature, setSubmitSignature] = useState<SignaturePayload | null>(null);
  const [uploadingFor, setUploadingFor] = useState<RequirementChecklistItem | null>(null);
  const [reviewingItem, setReviewingItem] = useState<RequirementChecklistItem | null>(null);
  const [reviewDecision, setReviewDecision] = useState<ChecklistDecision>('approved');
  const [reviewNote, setReviewNote] = useState('');
  const [expandedWhy, setExpandedWhy] = useState<string | null>(null);
  /** Per-group expand override; default comes from isGroupSolved. */
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>({});
  const [prevCycleOpen, setPrevCycleOpen] = useState(false);

  // Sticky progress bar (§2.2.1): appears once the hero scrolls out of view.
  const pageRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const [heroVisible, setHeroVisible] = useState(true);
  useEffect(() => {
    const el = heroRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      ([entry]) => setHeroVisible(entry?.isIntersecting ?? true),
      { threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [casesLoading]);

  // Renewal continuity (F2.3) — resolved before any early return so hook
  // order stays stable across renders.
  const previousCase = getById(kase?.previousCaseId ?? '');
  const previousDocs = useMemo(
    () => (kase?.previousCaseId ? docsForCase(kase.previousCaseId) : []),
    [docsForCase, kase?.previousCaseId],
  );

  if (casesLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
        <div className="h-40 animate-pulse rounded-3xl bg-inset" />
        <div className="h-64 animate-pulse rounded-2xl bg-inset" />
      </div>
    );
  }
  if (!kase) return <Navigate to="/" replace />;

  const isVendor = profile?.kind === 'vendor';
  // Vendor-ownership guard (F1.1): never render another vendor's case shell.
  if (shouldBlockVendorAccess(profile, kase, aliases)) {
    return <Navigate to="/" replace />;
  }

  const effectiveStatus = computeCaseStatus(kase);
  const statusLabel = isVendor
    ? VENDOR_STATUS_LABEL[effectiveStatus]
    : CASE_STATUS_LABEL[effectiveStatus];
  const requiredItems = items.filter((i) => i.required);
  const requiredApproved = requiredItems.filter((i) => i.decision === 'approved').length;
  const readyForDecision =
    requiredItems.length > 0 && requiredApproved === requiredItems.length;
  const outstandingCount = progress.outstanding.length;
  const awaitingReviewCount = progress.awaitingReview.length;

  const nextAction = isVendor
    ? outstandingCount > 0
      ? `${outstandingCount} to upload`
      : kase.status === 'draft'
        ? 'Ready to submit'
        : 'Nothing owed'
    : readyForDecision && kase.status === 'submitted'
      ? 'Ready to decide'
      : awaitingReviewCount > 0
        ? `${awaitingReviewCount} to review`
        : `Waiting on vendor: ${outstandingCount}`;

  const metaLine = [
    kase.category,
    kase.jurisdiction
      ? kase.jurisdiction === 'OTHER' && kase.originCountry
        ? kase.originCountry
        : JURISDICTION_LABEL[kase.jurisdiction]
      : undefined,
    kase.submittedAt ? `Submitted ${formatDate(kase.submittedAt)}` : `Opened ${formatDate(kase.openedAt)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  function openReview(item: RequirementChecklistItem) {
    setReviewingItem(item);
    setReviewDecision(item.decision === 'pending' ? 'approved' : item.decision);
    setReviewNote(item.reviewerNote ?? '');
  }
  function submitReview() {
    if (!reviewingItem) return;
    const ok = review(reviewingItem.id, reviewDecision, {
      email: profile?.email,
      note: reviewNote,
    });
    if (ok) {
      success(`Checklist item ${CHECKLIST_LABEL[reviewDecision].toLowerCase()}`);
      setReviewingItem(null);
    } else {
      error('Could not save the review.');
    }
  }

  function submitDecision() {
    if (!decisionOpen) return;
    if (!decisionSignature) {
      error('An electronic signature is required to record the decision.');
      return;
    }
    const ok = decideCase(kase!.id, decisionOpen, {
      note: decisionNote || undefined,
      scope: decisionScope || undefined,
      expiresAt: decisionExpiry || undefined,
      actor: profile?.email,
      signature: toCaseSignature(decisionSignature),
    });
    if (ok) {
      success(`Accreditation ${decisionOpen}`);
      setDecisionOpen(null);
      setDecisionSignature(null);
    } else {
      error('Could not save the decision.');
    }
  }

  function confirmSubmit() {
    if (!submitSignature) {
      error('Sign the completeness attestation to submit.');
      return;
    }
    const ok = submitCase(kase!.id, profile?.email, toCaseSignature(submitSignature));
    if (ok) {
      success('Case submitted for legal review');
      setSubmitOpen(false);
      setSubmitSignature(null);
    } else {
      error('Could not submit the case.');
    }
  }

  function handleReminder() {
    const ok = sendReminder(kase!.id, profile?.email);
    if (ok) success(`Reminder sent to ${ok.contactEmail ?? ok.vendorName}`);
    else error('Could not record the reminder.');
  }

  /** Row-as-target action (§2.2.3): what tapping a requirement card does. */
  function activateRow(item: RequirementChecklistItem) {
    if (isVendor) {
      if (item.instrument) {
        navigate(`/cases/${kase!.id}/sign/${item.instrumentCode ?? item.code}`);
      } else if (canUpload) {
        setUploadingFor(item);
      }
    } else if (item.instrument) {
      navigate(`/cases/${kase!.id}/sign/${item.instrumentCode ?? item.code}`);
    } else if (canReview) {
      openReview(item);
    }
  }
  function rowInteractive(item: RequirementChecklistItem): boolean {
    if (isVendor) return item.instrument ? true : canUpload;
    return item.instrument ? true : canReview;
  }

  return (
    <div ref={pageRef} className="space-y-6">
      {/* Compact progress bar once the hero scrolls away (§2.2.1) — fixed
          below the app chrome (z-10 < the shell/vendor header's z-20), sized
          to the page column so it never covers the shell sidebar. */}
      {!heroVisible && (
        <StickyCaseBar pageRef={pageRef}>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface/95 px-3 py-2 shadow-e1 backdrop-blur">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className={`h-2 w-2 shrink-0 rounded-full ${CASE_STATUS_DOT[effectiveStatus]}`}
              />
              <span className="truncate text-sm font-semibold text-ink">{statusLabel}</span>
            </span>
            <span className="flex shrink-0 items-center gap-3 text-sm">
              <span className="tnum font-semibold text-ink">
                {requiredApproved}/{requiredItems.length}
              </span>
              <span className="hidden text-muted sm:inline" aria-hidden>
                ·
              </span>
              <span className="font-semibold text-brand-700 dark:text-brand-300">
                {nextAction}
              </span>
            </span>
          </div>
        </StickyCaseBar>
      )}

      <div ref={heroRef}>
        <ModuleHero
          eyebrow={`Accreditation case · ${statusLabel}`}
          title={kase.vendorName}
          icon="clipboard"
          action={
            <HeroChipButton href={isVendor ? '/vendor' : '/legal'} icon="arrowRight">
              Back to cases
            </HeroChipButton>
          }
          accessory={
            <div className="flex flex-wrap items-end gap-6">
              <div>
                <p className="text-xs uppercase tracking-wide text-brand-100/70">Status</p>
                <p className="mt-1">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold text-white">
                    <span
                      aria-hidden
                      className={`inline-block h-1.5 w-1.5 rounded-full ${CASE_STATUS_DOT[effectiveStatus].replace('400', '300')}`}
                    />
                    {statusLabel}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-brand-100/70">Checklist</p>
                <p className="tnum text-2xl font-extrabold">
                  {requiredApproved}/{requiredItems.length}
                  <span className="ml-1 text-sm font-medium text-brand-100/70">approved</span>
                </p>
              </div>
            </div>
          }
        />
      </div>

      {/* Meta demoted to one muted line; full record behind (i) (§2.2.4). */}
      <div className="-mt-3 flex items-center gap-1 px-1">
        <p className="min-w-0 truncate text-sm text-muted">{metaLine}</p>
        <InfoTip
          label="Full case record"
          side="bottom"
          content={
            <dl className="grid min-w-[14rem] gap-x-4 gap-y-1.5">
              <MetaTipItem label="Vendor" value={kase.vendorName} />
              <MetaTipItem
                label="Jurisdiction"
                value={
                  kase.jurisdiction
                    ? kase.jurisdiction === 'OTHER' && kase.originCountry
                      ? kase.originCountry
                      : JURISDICTION_LABEL[kase.jurisdiction]
                    : '—'
                }
              />
              <MetaTipItem
                label="Risk tier"
                value={kase.riskTier ? RISK_TIER_LABEL[kase.riskTier] : '—'}
              />
              <MetaTipItem label="Opened" value={formatDate(kase.openedAt)} />
              <MetaTipItem label="Submitted" value={formatDate(kase.submittedAt)} />
              <MetaTipItem label="Expires" value={formatDate(kase.expiresAt)} />
              <MetaTipItem label="Contact" value={kase.contactEmail ?? '—'} />
              <MetaTipItem
                label="Last reminder"
                value={formatDate(kase.lastReminderAt)}
              />
              {kase.scope && <MetaTipItem label="Scope" value={kase.scope} />}
            </dl>
          }
        />
      </div>

      {/* Vendor: you still owe N + submit CTA. Legal: waiting on vendor. */}
      {isVendor && kase.status === 'draft' && (
        <Card
          className={
            outstandingCount > 0
              ? 'border-amber-500/30 bg-amber-500/5'
              : 'border-emerald-500/30 bg-emerald-500/5'
          }
        >
          <div className="flex items-start gap-3">
            <span
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                outstandingCount > 0
                  ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                  : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
              }`}
            >
              <Icon name={outstandingCount > 0 ? 'alert' : 'check'} className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">
                {outstandingCount > 0
                  ? `You still owe ${outstandingCount} document${outstandingCount === 1 ? '' : 's'}`
                  : 'Everything is in — ready to submit'}
              </p>
              <p className="mt-0.5 text-sm text-muted">
                {outstandingCount > 0
                  ? 'Upload evidence or sign the pending agreements below, then submit for legal review.'
                  : 'Submit for review — you\u2019ll sign a short attestation that the intake is complete and truthful.'}
              </p>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => {
                    setSubmitSignature(null);
                    setSubmitOpen(true);
                  }}
                  className="btn-primary btn-sm"
                >
                  <Icon name="signature" className="h-4 w-4" />
                  Submit for review
                </button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {!isVendor &&
        (kase.status === 'draft' || kase.status === 'submitted' || kase.status === 'under_review') &&
        outstandingCount > 0 && (
          <Card className="border-cyan-500/30 bg-cyan-500/5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cyan-500/15 text-cyan-800 dark:text-cyan-300">
                  <Icon name="rotate" className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    Waiting on vendor: {outstandingCount} item{outstandingCount === 1 ? '' : 's'}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">
                    {awaitingReviewCount > 0
                      ? `${awaitingReviewCount} submitted item${awaitingReviewCount === 1 ? '' : 's'} awaiting your review meanwhile.`
                      : 'No evidence to review yet.'}
                    {kase.lastReminderAt
                      ? ` Last reminder ${formatDate(kase.lastReminderAt)}.`
                      : ''}
                  </p>
                </div>
              </div>
              <Guard module="legal" cap="review_accreditation" fallback={null}>
                <button type="button" onClick={handleReminder} className="btn-outline btn-sm">
                  <Icon name="bell" className="h-4 w-4" />
                  Send reminder
                </button>
              </Guard>
            </div>
          </Card>
        )}

      {/* Overall progress */}
      <Card>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-ink">Overall progress</p>
          <p className="tnum text-sm font-semibold text-ink">
            {Math.round(progress.ratio * 100)}%
            <span className="ml-1 font-normal text-muted">
              of required items approved
            </span>
          </p>
        </div>
        <div
          role="progressbar"
          aria-valuenow={Math.round(progress.ratio * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-2 h-2 overflow-hidden rounded-full bg-inset"
        >
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${Math.round(progress.ratio * 100)}%` }}
          />
        </div>
      </Card>

      <div>
        <SectionTitle
          title="Requirement checklist"
          subtitle={`${requiredApproved} of ${requiredItems.length} required approved · ${progress.expiringSoon} expiring soon`}
          action={
            !isVendor && kase.status === 'submitted' && readyForDecision && canApprove ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDecisionOpen('rejected');
                    setDecisionNote('');
                    setDecisionSignature(null);
                  }}
                  className="btn-outline"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDecisionOpen('approved');
                    setDecisionExpiry('');
                    setDecisionScope(kase.category ?? '');
                    setDecisionSignature(null);
                  }}
                  className="btn-primary"
                >
                  <Icon name="signature" className="h-4 w-4" />
                  Approve accreditation
                </button>
              </div>
            ) : undefined
          }
        />

        <div className="space-y-5">
          {groupedItems.map(([key, groupRows]) => {
            const gApproved = groupRows.filter((i) => i.decision === 'approved').length;
            const solved = isGroupSolved(groupRows);
            const expanded = groupOverrides[key] ?? !solved;
            return (
              <section key={key} aria-label={groupLabel(groupRows[0]?.group)}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() =>
                      setGroupOverrides((cur) => ({ ...cur, [key]: !expanded }))
                    }
                    className="flex min-w-0 items-center gap-2 text-left font-display text-sm font-bold uppercase tracking-wide text-muted transition hover:text-ink"
                  >
                    <Icon
                      name="chevron"
                      className={`h-3.5 w-3.5 shrink-0 transition ${expanded ? 'rotate-90' : ''}`}
                      aria-hidden
                    />
                    <span className="truncate">{groupLabel(groupRows[0]?.group)}</span>
                    {solved ? (
                      <Badge tone="emerald">
                        <Icon name="check" className="mr-0.5 inline h-3 w-3" aria-hidden />
                        {gApproved}/{groupRows.length}
                      </Badge>
                    ) : (
                      <Badge tone="slate">
                        {gApproved}/{groupRows.length}
                      </Badge>
                    )}
                  </button>
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-inset sm:w-36" aria-hidden>
                    <div
                      className="h-full rounded-full bg-brand-500/70"
                      style={{
                        width: `${groupRows.length ? Math.round((gApproved / groupRows.length) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
                {expanded ? (
                  <ul className="space-y-3">
                    {groupRows.map((item) => (
                      <ChecklistRow
                        key={item.id}
                        item={item}
                        docs={docs}
                        signed={signed}
                        isVendor={isVendor}
                        interactive={rowInteractive(item)}
                        onActivate={() => activateRow(item)}
                        whyExpanded={expandedWhy === item.id}
                        onToggleWhy={() =>
                          setExpandedWhy((cur) => (cur === item.id ? null : item.id))
                        }
                        onDocStatus={
                          !isVendor && canReview
                            ? (docId, status) => setDocStatus(docId, status, profile?.email)
                            : undefined
                        }
                      />
                    ))}
                  </ul>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setGroupOverrides((cur) => ({ ...cur, [key]: true }))
                    }
                    className="card flex w-full items-center gap-2.5 p-3 text-left text-sm text-muted transition hover:bg-inset"
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                      <Icon name="check" className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    All {groupRows.length} item{groupRows.length === 1 ? '' : 's'} done —
                    tap to expand
                  </button>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {/* Case-level Documents panel — internal reviewers only (F2.2). */}
      {!isVendor && (
        <div>
          <SectionTitle
            title="Documents"
            subtitle={`${docs.length} file${docs.length === 1 ? '' : 's'} on this case, all versions`}
            action={
              <InfoTip
                label="About this panel"
                content="Every document the vendor ever uploaded on this case — including superseded and rejected versions — in one auditable table."
              />
            }
          />
          {docs.length === 0 ? (
            <Card>
              <p className="text-sm text-muted">No documents uploaded yet.</p>
            </Card>
          ) : (
            <DataTable
              ariaLabel="Case documents"
              rows={[...docs].sort(
                (a, b) =>
                  new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
              )}
              columns={documentColumns(items)}
              keyOf={(d) => d.id}
            />
          )}
        </div>
      )}

      {/* Previous cycle documents — renewal continuity (F2.3). */}
      {!isVendor && kase.previousCaseId && previousCase && (
        <div>
          <button
            type="button"
            onClick={() => setPrevCycleOpen((v) => !v)}
            aria-expanded={prevCycleOpen}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition hover:text-ink"
          >
            <Icon
              name="chevron"
              className={`h-3.5 w-3.5 transition ${prevCycleOpen ? 'rotate-90' : ''}`}
              aria-hidden
            />
            Previous cycle documents ({previousDocs.length})
            <span className="font-normal text-faint">
              — {previousCase.vendorName}, opened {formatDate(previousCase.openedAt)}
            </span>
          </button>
          {prevCycleOpen && (
            <div className="mt-2">
              {previousDocs.length === 0 ? (
                <Card>
                  <p className="text-sm text-muted">
                    No documents were uploaded on the previous cycle.
                  </p>
                </Card>
              ) : (
                <DataTable
                  ariaLabel="Previous cycle documents"
                  rows={[...previousDocs].sort(
                    (a, b) =>
                      new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
                  )}
                  columns={documentColumns([])}
                  keyOf={(d) => d.id}
                />
              )}
            </div>
          )}
        </div>
      )}

      <div>
        <SectionTitle
          title="Activity"
          action={
            <InfoTip
              label="About this feed"
              content="Every action on this case, newest first, with the captured e-signature artifacts."
            />
          }
        />
        <Card>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted">No activity recorded yet.</p>
          ) : (
            <ol className="space-y-2">
              {timeline.map((entry, i) => {
                const latest = i === 0;
                const tone =
                  entry.action === 'approved'
                    ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                    : entry.action === 'rejected'
                      ? 'bg-rose-500/15 text-rose-800 dark:text-rose-300'
                      : entry.action === 'submitted'
                        ? 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-300'
                        : entry.action === 'doc_uploaded'
                          ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300'
                          : entry.action === 'instrument_signed'
                            ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300'
                            : entry.action === 'reminder_sent'
                              ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                              : 'bg-inset text-muted';
                // Attach the captured signature artifact to the entries that
                // carry one (decision / submission / signed instrument).
                const sig: CaseSignature | undefined =
                  entry.action === 'approved' || entry.action === 'rejected'
                    ? kase.decisionSignature
                    : entry.action === 'submitted'
                      ? kase.submissionSignature
                      : undefined;
                const signedRecord: SignedInstrument | undefined =
                  entry.action === 'instrument_signed'
                    ? signed.find((s) => entry.detail?.startsWith(s.code))
                    : undefined;
                return (
                  <li
                    key={entry.id}
                    className={`flex items-start gap-3 rounded-lg px-1 py-1 transition ${latest ? '' : 'opacity-80'}`}
                  >
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tone}`}>
                      <Icon
                        name={
                          entry.action === 'approved'
                            ? 'check'
                            : entry.action === 'rejected'
                              ? 'x'
                              : entry.action === 'doc_uploaded'
                                ? 'plus'
                                : entry.action === 'submitted'
                                  ? 'rotate'
                                  : entry.action === 'instrument_signed'
                                    ? 'signature'
                                    : entry.action === 'reminder_sent'
                                      ? 'bell'
                                      : 'clipboard'
                        }
                        className="h-4 w-4"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${latest ? 'font-semibold text-ink' : 'text-ink/85'}`}>
                        <span className="font-semibold">{timelineActionLabel(entry.action)}</span>
                        {entry.detail ? ` \u2014 ${entry.detail}` : ''}
                      </p>
                      <p className="text-xs text-faint" title={formatDateTime(entry.at)}>
                        {relativeTime(entry.at)}
                        {entry.actorEmail ? ` \u00b7 ${entry.actorEmail}` : ''}
                      </p>
                      {sig && <SignatureArtifact sig={sig} />}
                      {signedRecord && (
                        <SignatureArtifact
                          sig={{
                            method: signedRecord.signatureMethod,
                            dataUrl: signedRecord.signaturePng,
                            signerName: signedRecord.signerName,
                            signedAt: signedRecord.signedAt,
                            userAgent: signedRecord.signerUa,
                          }}
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>

      {/* Upload sheet */}
      <Sheet
        open={Boolean(uploadingFor)}
        onOpenChange={(v) => !v && setUploadingFor(null)}
        title={uploadingFor ? `Upload for “${uploadingFor.requirement}”` : ''}
      >
        {uploadingFor && (
          <DocumentUploader
            caseId={kase.id}
            vendorId={kase.vendorId}
            requirement={uploadingFor}
            actorEmail={profile?.email}
            onDone={(doc) => {
              attach(uploadingFor.id, doc.id);
              setUploadingFor(null);
              success(`Uploaded ${doc.filename}`);
            }}
          />
        )}
      </Sheet>

      {/* Review checklist item sheet */}
      <Sheet
        open={Boolean(reviewingItem)}
        onOpenChange={(v) => !v && setReviewingItem(null)}
        title={reviewingItem ? `Review — ${reviewingItem.requirement}` : ''}
      >
        <div className="space-y-3 p-1">
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-faint">
              Decision
            </label>
            <div className="mt-1 grid grid-cols-4 gap-1 rounded-xl bg-inset p-1">
              {(['approved', 'rejected', 'na', 'pending'] as ChecklistDecision[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setReviewDecision(d)}
                  className={`rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
                    reviewDecision === d
                      ? 'bg-surface text-ink shadow-e1'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  {CHECKLIST_LABEL[d]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="review-note" className="text-xs font-semibold uppercase tracking-wide text-faint">
              Reviewer note
            </label>
            <textarea
              id="review-note"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              rows={3}
              className="input"
              placeholder="What did you check? Any conditions?"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setReviewingItem(null)} className="btn-ghost">
              Cancel
            </button>
            <button type="button" onClick={submitReview} className="btn-primary">
              Save review
            </button>
          </div>
        </div>
      </Sheet>

      {/* Case decision sheet — signature REQUIRED (T1.5) */}
      <Sheet
        open={Boolean(decisionOpen)}
        onOpenChange={(v) => {
          if (!v) {
            setDecisionOpen(null);
            setDecisionSignature(null);
          }
        }}
        title={
          decisionOpen === 'approved'
            ? `Sign & approve — ${kase.vendorName}`
            : `Sign & reject — ${kase.vendorName}`
        }
      >
        <div className="space-y-3 p-1">
          {decisionOpen === 'approved' && (
            <>
              <div>
                <label htmlFor="scope" className="text-xs font-semibold uppercase tracking-wide text-faint">
                  Scope of accreditation
                </label>
                <input
                  id="scope"
                  value={decisionScope}
                  onChange={(e) => setDecisionScope(e.target.value)}
                  placeholder="e.g. Medical devices — serialized"
                  className="input"
                />
              </div>
              <div>
                <label htmlFor="expiry" className="text-xs font-semibold uppercase tracking-wide text-faint">
                  Expires on
                </label>
                <input
                  id="expiry"
                  type="date"
                  value={decisionExpiry}
                  onChange={(e) => setDecisionExpiry(e.target.value)}
                  className="input"
                />
                <p className="mt-1 text-xs text-muted">
                  Defaults to 1 year from today if left blank.
                </p>
              </div>
            </>
          )}
          <div>
            <label htmlFor="note" className="text-xs font-semibold uppercase tracking-wide text-faint">
              Note {decisionOpen === 'rejected' ? '(recommended)' : '(optional)'}
            </label>
            <textarea
              id="note"
              value={decisionNote}
              onChange={(e) => setDecisionNote(e.target.value)}
              rows={3}
              className="input"
              placeholder="Rationale, conditions, follow-ups…"
            />
          </div>
          <div className="space-y-2 rounded-2xl border border-line bg-inset/60 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
              <Icon name="signature" className="h-4 w-4" />
              Electronic signature (required)
            </div>
            <SignaturePad
              defaultSignerName={profile?.name ?? ''}
              onChange={setDecisionSignature}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setDecisionOpen(null);
                setDecisionSignature(null);
              }}
              className="btn-ghost"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitDecision}
              disabled={!decisionSignature}
              className={
                decisionOpen === 'approved'
                  ? 'btn-primary disabled:cursor-not-allowed disabled:opacity-60'
                  : 'btn-outline text-rose-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-300'
              }
            >
              <Icon name="signature" className="h-4 w-4" />
              Sign & {decisionOpen === 'approved' ? 'approve' : 'reject'}
            </button>
          </div>
        </div>
      </Sheet>

      {/* Vendor submit-with-attestation sheet (T2) */}
      <Sheet
        open={submitOpen}
        onOpenChange={(v) => {
          setSubmitOpen(v);
          if (!v) setSubmitSignature(null);
        }}
        title="Attest & submit for review"
      >
        <div className="space-y-3 p-1">
          <p className="text-sm text-muted">
            By signing you attest that the documents and declarations provided
            on this case are complete, current, and truthful to the best of
            your knowledge. Legal will start their review once submitted.
          </p>
          {outstandingCount > 0 && (
            <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              <Icon name="alert" className="mr-1 inline h-4 w-4" />
              {outstandingCount} required item{outstandingCount === 1 ? '' : 's'} still
              {outstandingCount === 1 ? ' has' : ' have'} no evidence — you can
              submit, but Legal may bounce it back.
            </p>
          )}
          <div className="space-y-2 rounded-2xl border border-line bg-inset/60 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
              <Icon name="signature" className="h-4 w-4" />
              Attestation signature (required)
            </div>
            <SignaturePad
              defaultSignerName={profile?.name ?? ''}
              onChange={setSubmitSignature}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setSubmitOpen(false)} className="btn-ghost">
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmSubmit}
              disabled={!submitSignature}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Icon name="signature" className="h-4 w-4" />
              Sign & submit
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sticky compact bar (§2.2.1)
// ---------------------------------------------------------------------------

/**
 * Fixed bar pinned right below the app chrome. Measures the sticky <header>
 * (shell top bar or vendor chrome) plus the page column, so it aligns with
 * content at every viewport and never fights the shell sidebar or the
 * header's z-20.
 */
function StickyCaseBar({
  pageRef,
  children,
}: {
  pageRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
}) {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  useEffect(() => {
    const measure = () => {
      const header = document.querySelector('header');
      const top = (header?.getBoundingClientRect().bottom ?? 0) + 8;
      const rect = pageRef.current?.getBoundingClientRect();
      setStyle({
        position: 'fixed',
        top,
        left: rect?.left ?? 0,
        width: rect?.width ?? '100%',
        zIndex: 10,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [pageRef]);
  if (!style) return null;
  return <div style={style}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Documents panel columns (F2.2)
// ---------------------------------------------------------------------------

function documentColumns(
  items: readonly RequirementChecklistItem[],
): Column<AccreditationDoc>[] {
  const requirementOf = (d: AccreditationDoc) =>
    items.find((i) => i.id === d.requirementId || i.documentIds.includes(d.id))
      ?.requirement ?? d.docType.replace(/_/g, ' ');
  return [
    {
      key: 'filename',
      header: 'File',
      primary: true,
      render: (d) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-semibold text-ink">{d.filename}</span>
          <Badge tone="slate">v{d.version}</Badge>
        </span>
      ),
    },
    {
      key: 'requirement',
      header: 'Requirement',
      render: (d) => <span className="text-sm text-muted">{requirementOf(d)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (d) => (
        <Badge
          tone={
            d.status === 'approved'
              ? 'emerald'
              : d.status === 'rejected'
                ? 'rose'
                : d.status === 'expired'
                  ? 'slate'
                  : 'amber'
          }
        >
          {DOC_STATUS_LABEL[d.status]}
        </Badge>
      ),
    },
    {
      key: 'uploadedBy',
      header: 'Uploaded by',
      hideOnMobile: true,
      render: (d) => (
        <span className="text-sm text-muted">{d.uploadedByEmail ?? '—'}</span>
      ),
    },
    {
      key: 'uploadedAt',
      header: 'Uploaded',
      render: (d) => formatDate(d.uploadedAt),
    },
    {
      key: 'expiresAt',
      header: 'Expires',
      hideOnMobile: true,
      render: (d) => formatDate(d.expiresAt),
    },
    {
      key: 'open',
      header: '',
      align: 'right',
      render: (d) =>
        d.dataUrl ? (
          <a
            href={d.dataUrl}
            target="_blank"
            rel="noreferrer"
            download={d.filename}
            className="btn-ghost btn-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <Icon name="download" className="h-4 w-4" />
            Open
          </a>
        ) : (
          <span className="text-xs text-faint">—</span>
        ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Row + fragments
// ---------------------------------------------------------------------------

function ChecklistRow({
  item,
  docs,
  signed,
  isVendor,
  interactive,
  onActivate,
  whyExpanded,
  onToggleWhy,
  onDocStatus,
}: {
  item: RequirementChecklistItem;
  docs: AccreditationDoc[];
  signed: SignedInstrument[];
  isVendor: boolean;
  interactive: boolean;
  onActivate: () => void;
  whyExpanded: boolean;
  onToggleWhy: () => void;
  onDocStatus?: (docId: string, status: 'approved' | 'rejected') => void;
}) {
  const [versionsOpen, setVersionsOpen] = useState(false);
  const itemDocs = docs.filter(
    (d) => item.documentIds.includes(d.id) || d.requirementId === item.id,
  );
  const chain = docVersionChain(itemDocs);
  const signedRecord = item.instrument
    ? signed.find(
        (s) =>
          !s.revokedAt &&
          (s.code === item.instrumentCode || s.code === item.code),
      )
    : undefined;
  const expiring = itemExpiringSoon(item, { docs, signed });
  const expiringDays = itemDocs
    .map((d) => daysUntil(d.expiresAt))
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b)[0];

  // Row-as-target (§2.2.3): the whole card opens the one consistent action;
  // inner links/buttons stop propagation.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  };
  const stop = (e: MouseEvent) => e.stopPropagation();

  return (
    <li>
      <div
        onClick={interactive ? onActivate : undefined}
        onKeyDown={interactive ? onKeyDown : undefined}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={
          interactive
            ? `${item.requirement} — ${isVendor ? (item.instrument ? 'review and sign' : 'upload document') : 'open review'}`
            : undefined
        }
        className={`card p-4 sm:p-5 ${
          interactive
            ? 'cursor-pointer transition hover:bg-inset/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500'
            : ''
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {item.instrument && (
                <Icon
                  name="signature"
                  className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300"
                  aria-label="Signable agreement"
                />
              )}
              <h4 className="font-display text-base font-bold text-ink">
                {item.requirement}
              </h4>
              {item.required && <Badge tone="brand">Required</Badge>}
              {expiring && (
                <Badge tone="rose">
                  {expiringDays != null && expiringDays < 0
                    ? 'Expired'
                    : `Expires in ${expiringDays}d`}
                </Badge>
              )}
            </div>
            {item.description && (
              <p className="mt-0.5 text-sm text-muted">{item.description}</p>
            )}
            {item.whyWeNeedIt && (
              <div className="mt-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleWhy();
                  }}
                  aria-expanded={whyExpanded}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300"
                >
                  <Icon name="info" className="h-3.5 w-3.5" />
                  Why we need this
                  <Icon
                    name="chevron"
                    className={`h-3 w-3 transition ${whyExpanded ? 'rotate-90' : ''}`}
                  />
                </button>
                {whyExpanded && (
                  <p className="mt-1 rounded-lg bg-inset px-3 py-2 text-xs text-muted">
                    {item.whyWeNeedIt}
                    {item.helpUrl && (
                      <>
                        {' '}
                        <a
                          href={item.helpUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={stop}
                          className="font-semibold text-brand-700 hover:underline dark:text-brand-300"
                        >
                          Issuer website ↗
                        </a>
                      </>
                    )}
                  </p>
                )}
              </div>
            )}
            {item.reviewerNote && (
              <p className="mt-1 text-xs text-muted">
                Reviewer note: {item.reviewerNote}
              </p>
            )}
          </div>
          {/* Status + chevron — the row itself is the action (§2.2.3). */}
          <div className="flex shrink-0 items-center gap-2">
            <Badge tone={CHECKLIST_TONE[item.decision]}>
              {CHECKLIST_LABEL[item.decision]}
            </Badge>
            {interactive && (
              <Icon name="chevron" className="h-4 w-4 text-faint" aria-hidden />
            )}
          </div>
        </div>

        {signedRecord && (
          <div className="mt-3 border-t border-line pt-3">
            <SignedRecord record={signedRecord} />
          </div>
        )}

        {/* Doc version chain (F2.1): current renders full; older versions
            collapse behind a disclosure. */}
        {chain && (
          <div className="mt-3 space-y-2 border-t border-line pt-3">
            <DocRow
              doc={chain.current}
              current
              onDocStatus={onDocStatus}
              onStop={stop}
            />
            {chain.previous.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setVersionsOpen((v) => !v);
                  }}
                  aria-expanded={versionsOpen}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-muted transition hover:text-ink"
                >
                  <Icon
                    name="chevron"
                    className={`h-3 w-3 transition ${versionsOpen ? 'rotate-90' : ''}`}
                    aria-hidden
                  />
                  {chain.previous.length} previous version
                  {chain.previous.length === 1 ? '' : 's'}
                </button>
                {versionsOpen && (
                  <ul className="mt-2 space-y-2 border-l-2 border-line pl-3">
                    {chain.previous.map((d) => (
                      <li key={d.id}>
                        <DocRow doc={d} onDocStatus={onDocStatus} onStop={stop} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function DocRow({
  doc,
  current = false,
  onDocStatus,
  onStop,
}: {
  doc: AccreditationDoc;
  current?: boolean;
  onDocStatus?: (docId: string, status: 'approved' | 'rejected') => void;
  onStop: (e: MouseEvent) => void;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 text-sm ${
        current ? '' : 'opacity-75'
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon name="clipboard" className="h-4 w-4 shrink-0 text-faint" />
        <span className="min-w-0 truncate">{doc.filename}</span>
        <Badge
          tone={
            doc.status === 'approved'
              ? 'emerald'
              : doc.status === 'rejected'
                ? 'rose'
                : doc.status === 'expired'
                  ? 'slate'
                  : 'amber'
          }
        >
          {DOC_STATUS_LABEL[doc.status]}
        </Badge>
        <span className="text-xs text-muted">
          v{doc.version}
          {current ? ' · current' : ''}
          {doc.uploadedByEmail ? ` · ${doc.uploadedByEmail}` : ''}
          {` · ${formatDate(doc.uploadedAt)}`}
          {doc.expiresAt ? ` · exp ${formatDate(doc.expiresAt)}` : ''}
        </span>
      </span>
      <span className="flex gap-2">
        {doc.dataUrl && (
          <a
            href={doc.dataUrl}
            target="_blank"
            rel="noreferrer"
            download={doc.filename}
            onClick={onStop}
            className="btn-ghost btn-sm"
          >
            <Icon name="download" className="h-4 w-4" />
            Open
          </a>
        )}
        {onDocStatus && doc.status === 'submitted' && (
          <>
            <button
              type="button"
              onClick={(e) => {
                onStop(e);
                onDocStatus(doc.id, 'approved');
              }}
              className="btn-outline btn-sm"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={(e) => {
                onStop(e);
                onDocStatus(doc.id, 'rejected');
              }}
              className="btn-outline btn-sm"
            >
              Reject
            </button>
          </>
        )}
      </span>
    </div>
  );
}

/** Small bordered signature PNG + caption ("e-signed by NAME · date · method"). */
function SignatureArtifact({ sig }: { sig: CaseSignature }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-2 text-xs">
      <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
        <Icon name="signature" className="h-3.5 w-3.5" />
        e-signed by {sig.signerName}
      </span>
      <span className="text-muted">
        {formatDateTime(sig.signedAt)}
        {' · '}
        <span className="uppercase tracking-wide">{sig.method}</span>
      </span>
      <img
        src={sig.dataUrl}
        alt={`Signature of ${sig.signerName}`}
        className="ml-auto h-10 w-auto max-w-[9rem] rounded border border-line bg-white object-contain"
      />
    </div>
  );
}

function MetaTipItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[0.65rem] font-semibold uppercase tracking-wide text-faint">
        {label}
      </dt>
      <dd className="min-w-0 truncate text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}
