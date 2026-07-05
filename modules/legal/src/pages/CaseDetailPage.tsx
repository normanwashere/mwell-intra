'use client';

// Accreditation case workspace (T1.3 / T1.5 / T2).
//
// - Checklist grouped by RequirementGroup with per-group + overall progress.
// - "Why we need this" inline expand per row; expiring badges via daysUntil.
// - Instrument rows deep-link to the sign page (vendor) and render the
//   captured signature once signed.
// - Vendor: "You still owe N" banner + submit-with-attestation-signature.
// - Legal: "Waiting on vendor: N" banner, Send reminder, and approve / reject
//   decisions that REQUIRE an electronic signature (same pattern as
//   procurement's ApprovalInboxPage).

import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  Badge,
  Card,
  HeroChipButton,
  Icon,
  ModuleHero,
  SectionTitle,
  Sheet,
  SignaturePad,
  useToast,
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
import {
  JURISDICTION_LABEL,
  RISK_TIER_LABEL,
} from '../types';
import {
  computeCaseStatus,
  useAccreditationCases,
  useAccreditationDocs,
  useCaseTimeline,
  useChecklist,
  useSignedInstruments,
} from '../localStore';
import {
  computeCaseProgress,
  groupLabel,
  groupOrderIndex,
  itemExpiringSoon,
} from '../caseLogic';
import { daysUntil } from '../requirements/policy';
import { DocumentUploader } from '../components/DocumentUploader';
import { SignedRecord } from './SignInstrumentPage';

const CHECKLIST_TONE: Record<ChecklistDecision, 'slate' | 'emerald' | 'rose' | 'amber'> = {
  pending: 'amber',
  approved: 'emerald',
  rejected: 'rose',
  na: 'slate',
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
  const { rows: timeline } = useCaseTimeline(id);
  const { success, error } = useToast();
  const { profile } = useSession();
  // NOTE: `Guard fallback={null}` renders the default AccessDenied block
  // (null ?? <AccessDenied/>), so capability-dependent actions use useCan.
  const canApprove = useCan('legal', 'approve_accreditation');

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
    return [...map.entries()].sort(
      (a, b) =>
        groupOrderIndex(a[1][0]?.group) - groupOrderIndex(b[1][0]?.group),
    );
  }, [items]);

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
  const effectiveStatus = computeCaseStatus(kase);
  const requiredItems = items.filter((i) => i.required);
  const requiredApproved = requiredItems.filter((i) => i.decision === 'approved').length;
  const readyForDecision =
    requiredItems.length > 0 && requiredApproved === requiredItems.length;
  const outstandingCount = progress.outstanding.length;
  const awaitingReviewCount = progress.awaitingReview.length;

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
      success(`Checklist item ${reviewDecision}`);
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

  return (
    <div className="space-y-6">
      <ModuleHero
        eyebrow="Accreditation case"
        title={kase.vendorName}
        description={
          kase.category
            ? `Category: ${kase.category}${kase.scope ? ` · Scope: ${kase.scope}` : ''}`
            : 'Legal accreditation review workspace.'
        }
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
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      effectiveStatus === 'approved'
                        ? 'bg-emerald-300'
                        : effectiveStatus === 'rejected' || effectiveStatus === 'expired'
                          ? 'bg-rose-300'
                          : effectiveStatus === 'renewal_due' || effectiveStatus === 'under_review'
                            ? 'bg-amber-300'
                            : effectiveStatus === 'submitted'
                              ? 'bg-cyan-300'
                              : 'bg-slate-300'
                    }`}
                  />
                  {effectiveStatus.replace('_', ' ')}
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

      <Card>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <MetaItem label="Vendor" value={kase.vendorName} />
          <MetaItem
            label="Jurisdiction"
            value={
              kase.jurisdiction
                ? kase.jurisdiction === 'OTHER' && kase.originCountry
                  ? kase.originCountry
                  : JURISDICTION_LABEL[kase.jurisdiction]
                : '—'
            }
          />
          <MetaItem
            label="Risk tier"
            value={kase.riskTier ? RISK_TIER_LABEL[kase.riskTier] : '—'}
          />
          <MetaItem
            label="Opened"
            value={new Date(kase.openedAt).toLocaleDateString()}
          />
          <MetaItem
            label="Submitted"
            value={kase.submittedAt ? new Date(kase.submittedAt).toLocaleDateString() : '—'}
          />
          <MetaItem
            label="Expires"
            value={kase.expiresAt ? new Date(kase.expiresAt).toLocaleDateString() : '—'}
          />
          <MetaItem
            label="Contact"
            value={kase.contactEmail ?? '—'}
          />
          <MetaItem
            label="Last reminder"
            value={
              kase.lastReminderAt
                ? new Date(kase.lastReminderAt).toLocaleDateString()
                : '—'
            }
          />
        </dl>
      </Card>

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
                  ? 'Upload evidence or sign the pending instruments below, then submit for legal review.'
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
                      ? ` Last reminder ${new Date(kase.lastReminderAt).toLocaleDateString()}.`
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
            return (
              <section key={key} aria-label={groupLabel(groupRows[0]?.group)}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 font-display text-sm font-bold uppercase tracking-wide text-muted">
                    {groupLabel(groupRows[0]?.group)}
                    <Badge tone={gApproved === groupRows.length ? 'emerald' : 'slate'}>
                      {gApproved}/{groupRows.length}
                    </Badge>
                  </h3>
                  <div className="h-1.5 w-24 overflow-hidden rounded-full bg-inset sm:w-36" aria-hidden>
                    <div
                      className="h-full rounded-full bg-brand-500/70"
                      style={{
                        width: `${groupRows.length ? Math.round((gApproved / groupRows.length) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
                <ul className="space-y-3">
                  {groupRows.map((item) => (
                    <ChecklistRow
                      key={item.id}
                      item={item}
                      kase={kase}
                      docs={docs}
                      signed={signed}
                      isVendor={isVendor}
                      whyExpanded={expandedWhy === item.id}
                      onToggleWhy={() =>
                        setExpandedWhy((cur) => (cur === item.id ? null : item.id))
                      }
                      onUpload={() => setUploadingFor(item)}
                      onReview={() => openReview(item)}
                      onDocStatus={(docId, status) =>
                        setDocStatus(docId, status, profile?.email)
                      }
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>

      <div>
        <SectionTitle title="Activity" subtitle="Every action on this case, newest first." />
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
                        <span className="font-semibold">{entry.action.replace(/_/g, ' ')}</span>
                        {entry.detail ? ` \u2014 ${entry.detail}` : ''}
                      </p>
                      <p className="text-xs text-faint">
                        {new Date(entry.at).toLocaleString()}
                        {entry.actorEmail ? ` \u00b7 ${entry.actorEmail}` : ''}
                        {latest ? ' \u00b7 now' : ''}
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
                  {d}
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
// Row + fragments
// ---------------------------------------------------------------------------

function ChecklistRow({
  item,
  kase,
  docs,
  signed,
  isVendor,
  whyExpanded,
  onToggleWhy,
  onUpload,
  onReview,
  onDocStatus,
}: {
  item: RequirementChecklistItem;
  kase: AccreditationCase;
  docs: AccreditationDoc[];
  signed: SignedInstrument[];
  isVendor: boolean;
  whyExpanded: boolean;
  onToggleWhy: () => void;
  onUpload: () => void;
  onReview: () => void;
  onDocStatus: (docId: string, status: 'approved' | 'rejected') => void;
}) {
  const itemDocs = docs.filter(
    (d) => item.documentIds.includes(d.id) || d.requirementId === item.id,
  );
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

  return (
    <li>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {item.instrument && (
                <Icon
                  name="signature"
                  className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-300"
                  aria-label="Signable instrument"
                />
              )}
              <h4 className="font-display text-base font-bold text-ink">
                {item.requirement}
              </h4>
              {item.required && <Badge tone="brand">required</Badge>}
              <Badge tone={CHECKLIST_TONE[item.decision]}>{item.decision}</Badge>
              {expiring && (
                <Badge tone="rose">
                  {expiringDays != null && expiringDays < 0
                    ? 'expired'
                    : `expires in ${expiringDays}d`}
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
                  onClick={onToggleWhy}
                  aria-expanded={whyExpanded}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300"
                >
                  <Icon name="info" className="h-3.5 w-3.5" />
                  Why we need this
                  <Icon
                    name="chevron"
                    className={`h-3 w-3 transition ${whyExpanded ? 'rotate-180' : ''}`}
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
          <div className="flex shrink-0 flex-wrap gap-2">
            {isVendor && item.instrument && !signedRecord && (
              <Link
                to={`/cases/${kase.id}/sign/${item.instrumentCode ?? item.code}`}
                className="btn-primary btn-sm"
              >
                <Icon name="signature" className="h-4 w-4" />
                Review &amp; sign
              </Link>
            )}
            {!isVendor && item.instrument && (
              <Link
                to={`/cases/${kase.id}/sign/${item.instrumentCode ?? item.code}`}
                className="btn-ghost btn-sm"
              >
                <Icon name="search" className="h-4 w-4" />
                {signedRecord ? 'View signed record' : 'View template'}
              </Link>
            )}
            {isVendor && !item.instrument && (
              <Guard module="core" cap="submit_documents" fallback={null}>
                <button type="button" onClick={onUpload} className="btn-outline btn-sm">
                  <Icon name="plus" className="h-4 w-4" />
                  Upload
                </button>
              </Guard>
            )}
            {!isVendor && (
              <Guard module="legal" cap="review_accreditation" fallback={null}>
                <button
                  type="button"
                  onClick={onReview}
                  className={item.decision === 'pending' ? 'btn-primary btn-sm' : 'btn-outline btn-sm'}
                >
                  <Icon name="check" className="h-4 w-4" />
                  {item.decision === 'pending' ? 'Review' : 'Re-review'}
                </button>
              </Guard>
            )}
          </div>
        </div>

        {signedRecord && (
          <div className="mt-3 border-t border-line pt-3">
            <SignedRecord record={signedRecord} />
          </div>
        )}

        {itemDocs.length > 0 && (
          <ul className="mt-3 space-y-2 border-t border-line pt-3">
            {itemDocs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <Icon name="clipboard" className="h-4 w-4 shrink-0 text-faint" />
                  <span className="min-w-0 truncate">{d.filename}</span>
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
                    {d.status}
                  </Badge>
                  <span className="text-xs text-muted">
                    v{d.version} · {Math.round(d.sizeBytes / 1024)} KB
                    {d.expiresAt ? ` · exp ${new Date(d.expiresAt).toLocaleDateString()}` : ''}
                  </span>
                </span>
                <span className="flex gap-2">
                  {d.dataUrl && (
                    <a
                      href={d.dataUrl}
                      target="_blank"
                      rel="noreferrer"
                      download={d.filename}
                      className="btn-ghost btn-sm"
                    >
                      <Icon name="download" className="h-4 w-4" />
                      Open
                    </a>
                  )}
                  {!isVendor && d.status === 'submitted' && (
                    <Guard module="legal" cap="review_accreditation" fallback={null}>
                      <button
                        type="button"
                        onClick={() => onDocStatus(d.id, 'approved')}
                        className="btn-outline btn-sm"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => onDocStatus(d.id, 'rejected')}
                        className="btn-outline btn-sm"
                      >
                        Reject
                      </button>
                    </Guard>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </li>
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
        {new Date(sig.signedAt).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })}
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

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.65rem] font-semibold uppercase tracking-wide text-faint">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm font-semibold text-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}
