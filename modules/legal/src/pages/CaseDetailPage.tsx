'use client';

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
  useToast,
} from '@intra/ui';
import { Guard, useSession } from '@intra/auth';
import type {
  AccreditationCase,
  ChecklistDecision,
  RequirementChecklistItem,
} from '../types';
import {
  computeCaseStatus,
  useAccreditationCases,
  useAccreditationDocs,
  useCaseTimeline,
  useChecklist,
} from '../localStore';
import { DocumentUploader } from '../components/DocumentUploader';

const CHECKLIST_TONE: Record<ChecklistDecision, 'slate' | 'emerald' | 'rose' | 'amber'> = {
  pending: 'amber',
  approved: 'emerald',
  rejected: 'rose',
  na: 'slate',
};

export function CaseDetailPage() {
  const { id = '' } = useParams();
  const { getById, submitCase, decideCase, loading: casesLoading } = useAccreditationCases();
  const { forCase: checklistForCase, review, attach } = useChecklist();
  const { forCase: docsForCase, upload, setStatus: setDocStatus } = useAccreditationDocs();
  const { rows: timeline } = useCaseTimeline(id);
  const { success, error } = useToast();
  const { profile } = useSession();

  const kase: AccreditationCase | undefined = getById(id);
  const items = useMemo(() => checklistForCase(id), [checklistForCase, id]);
  const docs = useMemo(() => docsForCase(id), [docsForCase, id]);

  const [decisionOpen, setDecisionOpen] = useState<null | 'approved' | 'rejected'>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [decisionExpiry, setDecisionExpiry] = useState('');
  const [decisionScope, setDecisionScope] = useState('');
  const [uploadingFor, setUploadingFor] = useState<RequirementChecklistItem | null>(null);
  const [reviewingItem, setReviewingItem] = useState<RequirementChecklistItem | null>(null);
  const [reviewDecision, setReviewDecision] = useState<ChecklistDecision>('approved');
  const [reviewNote, setReviewNote] = useState('');

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
  const requiredRejected = requiredItems.filter((i) => i.decision === 'rejected').length;
  const readyForDecision =
    requiredItems.length > 0 && requiredApproved === requiredItems.length;

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
    const ok = decideCase(kase!.id, decisionOpen, {
      note: decisionNote || undefined,
      scope: decisionScope || undefined,
      expiresAt: decisionExpiry || undefined,
      actor: profile?.email,
    });
    if (ok) {
      success(`Accreditation ${decisionOpen}`);
      setDecisionOpen(null);
    } else {
      error('Could not save the decision.');
    }
  }

  function handleSubmit() {
    const ok = submitCase(kase!.id, profile?.email);
    if (ok) success('Case submitted for legal review');
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
                  {effectiveStatus}
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
        </dl>
      </Card>

      {kase.status === 'draft' && isVendor && (
        <Card className="border-cyan-500/30 bg-cyan-500/5">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-cyan-500/15 text-cyan-800 dark:text-cyan-300">
              <Icon name="info" className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-ink">
                Ready to send to Legal?
              </p>
              <p className="mt-0.5 text-sm text-muted">
                Upload the required documents against each checklist item, then submit. Legal will review and get back to you.
              </p>
              <div className="mt-3">
                <button type="button" onClick={handleSubmit} className="btn-primary btn-sm">
                  <Icon name="check" className="h-4 w-4" />
                  Submit for review
                </button>
              </div>
            </div>
          </div>
        </Card>
      )}

      <div>
        <SectionTitle
          title="Requirement checklist"
          subtitle={`${requiredApproved} approved · ${requiredRejected} rejected · ${requiredItems.length} required in total`}
          action={
            !isVendor && kase.status === 'submitted' && readyForDecision ? (
              <Guard module="legal" cap="approve_accreditation">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDecisionOpen('rejected');
                      setDecisionNote('');
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
                    }}
                    className="btn-primary"
                  >
                    Approve accreditation
                  </button>
                </div>
              </Guard>
            ) : undefined
          }
        />

        <ul className="space-y-3">
          {items.map((item) => {
            const itemDocs = docs.filter((d) => item.documentIds.includes(d.id) || d.requirementId === item.id);
            return (
              <li key={item.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-base font-bold text-ink">
                          {item.requirement}
                        </h3>
                        {item.required && <Badge tone="brand">required</Badge>}
                        <Badge tone={CHECKLIST_TONE[item.decision]}>{item.decision}</Badge>
                      </div>
                      {item.description && (
                        <p className="mt-0.5 text-sm text-muted">{item.description}</p>
                      )}
                      {item.reviewerNote && (
                        <p className="mt-1 text-xs text-muted">
                          Reviewer note: {item.reviewerNote}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {isVendor && (
                        <Guard module="core" cap="submit_documents">
                          <button
                            type="button"
                            onClick={() => setUploadingFor(item)}
                            className="btn-outline btn-sm"
                          >
                            <Icon name="plus" className="h-4 w-4" />
                            Upload
                          </button>
                        </Guard>
                      )}
                      {!isVendor && (
                        <Guard module="legal" cap="review_accreditation">
                          <button
                            type="button"
                            onClick={() => openReview(item)}
                            className={item.decision === 'pending' ? 'btn-primary btn-sm' : 'btn-outline btn-sm'}
                          >
                            <Icon name="check" className="h-4 w-4" />
                            {item.decision === 'pending' ? 'Review' : 'Re-review'}
                          </button>
                        </Guard>
                      )}
                    </div>
                  </div>

                  {itemDocs.length > 0 && (
                    <ul className="mt-3 space-y-2 border-t border-line pt-3">
                      {itemDocs.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <span className="flex items-center gap-2 min-w-0">
                            <Icon name="clipboard" className="h-4 w-4 text-faint" />
                            <span className="min-w-0 truncate">{d.filename}</span>
                            <Badge tone={CHECKLIST_TONE[d.status === 'submitted' ? 'pending' : d.status === 'approved' ? 'approved' : d.status === 'rejected' ? 'rejected' : 'na']}>
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
                              <Guard module="legal" cap="review_accreditation">
                                <button
                                  type="button"
                                  onClick={() => setDocStatus(d.id, 'approved', profile?.email)}
                                  className="btn-outline btn-sm"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDocStatus(d.id, 'rejected', profile?.email)}
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
          })}
        </ul>
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
                          : 'bg-inset text-muted';
                return (
                  <li
                    key={entry.id}
                    className={`flex items-start gap-3 rounded-lg px-1 py-1 transition ${latest ? '' : 'opacity-70'}`}
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
                                  : 'clipboard'
                        }
                        className="h-4 w-4"
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${latest ? 'font-semibold text-ink' : 'text-ink/85'}`}>
                        <span className="font-semibold">{entry.action.replace('_', ' ')}</span>
                        {entry.detail ? ` \u2014 ${entry.detail}` : ''}
                      </p>
                      <p className="text-xs text-faint">
                        {new Date(entry.at).toLocaleString()}
                        {entry.actorEmail ? ` \u00b7 ${entry.actorEmail}` : ''}
                        {latest ? ' \u00b7 now' : ''}
                      </p>
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
              upload; // silence unused; upload is called INSIDE DocumentUploader
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

      {/* Case decision sheet */}
      <Sheet
        open={Boolean(decisionOpen)}
        onOpenChange={(v) => !v && setDecisionOpen(null)}
        title={
          decisionOpen === 'approved'
            ? `Approve accreditation — ${kase.vendorName}`
            : `Reject accreditation — ${kase.vendorName}`
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
              Note (optional)
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
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setDecisionOpen(null)} className="btn-ghost">
              Cancel
            </button>
            <button
              type="button"
              onClick={submitDecision}
              className={decisionOpen === 'approved' ? 'btn-primary' : 'btn-outline text-rose-700 dark:text-rose-300'}
            >
              Confirm {decisionOpen}
            </button>
          </div>
        </div>
      </Sheet>
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
