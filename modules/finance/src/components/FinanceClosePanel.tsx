'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Badge, Card, EmptyState, EvidenceAttachment, useEvidenceAttachment, Field, Icon, Sheet, money, useToast } from '@intra/ui';
import type {
  FinanceCloseEntry,
  FinanceCloseEvidenceRecordType,
  FinanceCloseSourceRecordType,
  FinanceCloseEntryType,
  ManageFinanceCloseEntryInput,
} from '../types';
import { isSupportedFinanceEvidenceReference, validateFinanceCloseEntry } from '../data';

const ENTRY_LABEL: Record<FinanceCloseEntryType, string> = {
  inventory_valuation: 'Inventory valuation',
  cogs: 'Cost of goods sold',
  merchandise_expense: 'Merchandise expense',
  cost_center: 'Cost-center posting',
  write_off: 'Write-off',
  event_settlement: 'Event settlement',
};

const SOURCE_LABEL: Record<FinanceCloseSourceRecordType, string> = {
  procurement_request: 'Procurement request',
  purchase_order: 'Purchase order',
  payment_readiness_pack: 'Payment-readiness pack',
  payment_release: 'Payment release',
  warehouse_receipt: 'Warehouse receipt',
  event_reconciliation: 'Event reconciliation',
};

const EVIDENCE_LABEL: Record<FinanceCloseEvidenceRecordType, string> = {
  request_attachment: 'Request attachment',
  payment_readiness_pack: 'Payment-readiness pack',
  payment_release: 'Payment release',
  core_document: 'Registered document',
  warehouse_receipt: 'Warehouse receipt',
  event_reconciliation: 'Event reconciliation evidence',
};

interface FinanceClosePanelProps {
  entries: FinanceCloseEntry[];
  manage: (input: ManageFinanceCloseEntryInput) => Promise<FinanceCloseEntry>;
  openEvidence: (entry: FinanceCloseEntry) => Promise<string>;
  canManage: boolean;
  currentActorId?: string;
}

function emptyCloseDraft() {
  const today = new Date().toISOString().slice(0, 10);
  return {
    periodStart: today.slice(0, 8) + '01', periodEnd: today,
    entryType: 'inventory_valuation' as FinanceCloseEntryType,
    sourceModule: 'warehouse', sourceReference: '',
    sourceRecordType: 'purchase_order' as FinanceCloseSourceRecordType, sourceRecordId: '',
    evidenceRecordType: 'payment_release' as FinanceCloseEvidenceRecordType, evidenceRecordId: '',
    costCenter: '', amount: 0, reconciliationNote: '',
  };
}
type CloseDraft = ReturnType<typeof emptyCloseDraft>;
const DRAFT_TTL = 7 * 24 * 60 * 60 * 1000;
function readCloseDraft(key: string | undefined): { draft: CloseDraft; raw: string } | undefined {
  if (!key) return;
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > 20_000) return;
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || !Number.isFinite(saved.savedAt) || saved.savedAt > Date.now()
      || Date.now() - saved.savedAt > DRAFT_TTL || !saved.draft || typeof saved.draft !== 'object') return;
    const template = emptyCloseDraft();
    for (const [field, value] of Object.entries(template)) {
      const candidate = saved.draft[field];
      if (typeof candidate !== typeof value || (typeof candidate === 'string' && candidate.length > 4000)) return;
    }
    if (!Number.isFinite(saved.draft.amount) || !(saved.draft.entryType in ENTRY_LABEL)
      || !(saved.draft.sourceRecordType in SOURCE_LABEL) || !(saved.draft.evidenceRecordType in EVIDENCE_LABEL)) return;
    // Whitelist fields: never recover stored URLs, files, tokens, or extra payload keys.
    return { raw, draft: Object.fromEntries(Object.keys(template).map((field) => [field, saved.draft[field]])) as CloseDraft };
  } catch { return; }
}

export function FinanceClosePanel(props: FinanceClosePanelProps) {
  return <FinanceClosePanelSession key={`${props.currentActorId ?? 'anonymous'}:${props.canManage}`} {...props} />;
}

function FinanceClosePanelSession({
  entries,
  manage,
  openEvidence,
  canManage,
  currentActorId,
}: FinanceClosePanelProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [workingId, setWorkingId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [openingEvidenceId, setOpeningEvidenceId] = useState<string>();
  const [evidenceLink, setEvidenceLink] = useState<{ id: string; url: string }>();
  useEffect(() => {
    if (!evidenceLink) return;
    const timer = window.setTimeout(() => setEvidenceLink(undefined), 295_000);
    return () => window.clearTimeout(timer);
  }, [evidenceLink]);
  const evidenceOperation = useRef<object | null>(null);
  useEffect(() => () => { evidenceOperation.current = null; }, []);
  const [draft, setDraft] = useState(emptyCloseDraft);
  const savingRef = useRef(false);
  const attachment = useEvidenceAttachment(`${open}:${draft.sourceRecordType}:${draft.sourceRecordId}:${draft.evidenceRecordType}:${draft.evidenceRecordId}`);
  const evidenceIdentity = attachment.document?.documentId
    ? { evidenceRecordType: 'core_document' as const, evidenceRecordId: attachment.document.documentId }
    : { evidenceRecordType: draft.evidenceRecordType, evidenceRecordId: draft.evidenceRecordId };
  const requiresAttachment = !evidenceIdentity.evidenceRecordId.trim();
  const draftKey = currentActorId && canManage ? `intra.finance-close-draft.v1.${encodeURIComponent(currentActorId)}` : undefined;
  const [recovery, setRecovery] = useState(() => readCloseDraft(draftKey));
  const revision = useRef(recovery?.raw ?? null);
  const [draftStatus, setDraftStatus] = useState('');
  const [draftConflict, setDraftConflict] = useState(false);
  const empty = useRef(emptyCloseDraft());
  const dirty = JSON.stringify(draft) !== JSON.stringify(empty.current);

  useEffect(() => {
    if (!open || !dirty || !draftKey || draftConflict || saving) return;
    setDraftStatus('Saving browser draft...');
    const timer = window.setTimeout(() => {
      try {
        const existing = localStorage.getItem(draftKey);
        if (existing !== revision.current && readCloseDraft(draftKey)) {
          setDraftConflict(true);
          setDraftStatus('This draft changed in another tab. Resume the saved draft before editing further.');
          return;
        }
        const raw = JSON.stringify({ version: 1, savedAt: Date.now(), draft });
        if (raw.length > 20_000 || Object.values(draft).some((value) => typeof value === 'string' && value.length > 4000)) {
          setDraftStatus('Draft is too large to save on this browser. Keep this page open.');
          return;
        }
        localStorage.setItem(draftKey, raw);
        revision.current = raw;
        setRecovery({ draft, raw });
        setDraftStatus('Saved on this browser');
      } catch { setDraftStatus('Browser draft could not be saved. Keep this page open.'); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, dirty, draft, draftKey, draftConflict, saving]);

  useEffect(() => {
    if (!open || (!dirty && !attachment.reference)) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [open, dirty, attachment.reference]);

  const resumeDraft = () => {
    const saved = readCloseDraft(draftKey);
    if (!saved) { setRecovery(undefined); setDraftStatus('No valid browser draft remains.'); return; }
    revision.current = saved.raw;
    setDraft(saved.draft);
    setDraftConflict(false);
    attachment.clear();
    setOpen(true);
  };
  const discardDraft = () => {
    try {
      if (draftKey && localStorage.getItem(draftKey) === revision.current) localStorage.removeItem(draftKey);
      else if (draftKey && readCloseDraft(draftKey)) {
        setDraftConflict(true);
        setDraftStatus('This draft changed in another tab. Resume it before discarding.');
        return;
      }
      revision.current = null;
      setRecovery(undefined);
      setDraft(emptyCloseDraft());
      attachment.clear();
      setDraftStatus('');
      setDraftConflict(false);
      setOpen(false);
    } catch { setDraftStatus('Browser draft could not be discarded.'); }
  };

  const transition = async (
    entry: FinanceCloseEntry,
    action: 'post' | 'reconcile' | 'exception',
  ) => {
    if (action === 'exception' && !entry.reconciliationNote?.trim()) {
      toast.error('Provide a correction reason on the close entry before flagging it.');
      return;
    }
    setWorkingId(entry.id);
    try {
      await manage({
        action,
        id: entry.id,
        expectedUpdatedAt: entry.updatedAt,
        reconciliationNote: action === 'exception' ? entry.reconciliationNote : undefined,
      });
      toast.success(
        action === 'post'
          ? 'Close entry posted.'
          : action === 'reconcile'
            ? 'Close entry reconciled.'
            : 'Close exception recorded.',
      );
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Finance close entry could not be updated.',
      );
    } finally {
      setWorkingId(undefined);
    }
  };

  const retrieveEvidence = async (entry: FinanceCloseEntry) => {
    const operation = {};
    evidenceOperation.current = operation;
    setEvidenceLink(undefined);
    setOpeningEvidenceId(entry.id);
    try {
      const evidenceUrl = await openEvidence(entry);
      const parsed = new URL(evidenceUrl);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Invalid evidence preview.');
      if (evidenceOperation.current === operation) {
        setEvidenceLink({ id: entry.id, url: evidenceUrl });
        window.open(evidenceUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (cause) {
      if (evidenceOperation.current !== operation) return;
      toast.error(
        cause instanceof Error ? cause.message : 'Event reconciliation evidence could not be opened.',
      );
    } finally {
      if (evidenceOperation.current === operation) setOpeningEvidenceId(undefined);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current || draftConflict || !attachment.canSubmit(requiresAttachment)) return;
    const validation = validateFinanceCloseEntry({ action: 'save', ...draft, ...evidenceIdentity, evidenceUrl: attachment.reference });
    if (validation.length) {
      toast.error(validation[0] ?? 'Finance close entry is incomplete.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await manage({
        action: 'save',
        ...draft,
        ...evidenceIdentity,
        evidenceUrl: attachment.reference,
        costCenter: draft.costCenter || undefined,
      });
      toast.success('Finance close entry prepared for independent posting.');
      setOpen(false);
      try {
        if (draftKey && localStorage.getItem(draftKey) === revision.current) localStorage.removeItem(draftKey);
        revision.current = null;
        setRecovery(undefined);
        setDraftStatus('');
      } catch { setDraftStatus('Entry prepared, but its browser draft could not be removed.'); }
      setDraft((current) => ({
        ...current,
        sourceReference: '',
        sourceRecordId: '',
        evidenceRecordId: '',
        amount: 0,
        reconciliationNote: '',
      }));
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : 'Finance close entry could not be prepared.',
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3" aria-labelledby="finance-close-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-faint">Period control</p>
          <h2 id="finance-close-title" className="font-display text-xl font-bold text-ink">
            Finance close
          </h2>
          <p className="text-sm text-muted">
            Valuation, COGS, expenses, write-offs, cost centers, and event settlement in one
            governed queue.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            className="btn-primary w-full sm:w-auto"
            onClick={() => { if (recovery) resumeDraft(); else setOpen(true); }}
          >
            <Icon name="plus" className="h-4 w-4" /> Prepare close entry
          </button>
        )}
      </div>

      {canManage && recovery && !open && <div className="flex flex-wrap items-center gap-2 border-y border-line py-2">
        <span className="text-sm text-muted">Finance close draft saved on this browser</span>
        <button type="button" className="btn-outline btn-sm" onClick={resumeDraft}>Resume draft</button>
        <button type="button" className="btn-ghost btn-sm" onClick={discardDraft}>Discard draft</button>
      </div>}

      {entries.length === 0 ? (
        <EmptyState
          compact
          icon="coins"
          title="No close entries"
          message={
            canManage
              ? 'Prepare the first evidence-backed period entry. A second Finance user posts it.'
              : 'No close entries are available in your current Finance scope.'
          }
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {entries.map((entry) => (
            <Card key={entry.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{ENTRY_LABEL[entry.entryType]}</p>
                  <p className="truncate text-xs text-muted">
                    {entry.sourceModule} / {entry.sourceReference} / {entry.periodEnd}
                  </p>
                </div>
                <Badge
                  tone={
                    entry.status === 'reconciled'
                      ? 'emerald'
                      : entry.status === 'exception'
                        ? 'rose'
                        : 'brand'
                  }
                >
                  {entry.status}
                </Badge>
              </div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs text-faint">Amount</p>
                  <p className="font-display text-lg font-bold text-ink">{money(entry.amount)}</p>
                </div>
                {canManage && (
                  <div className="flex flex-wrap justify-end gap-2">
                    {(entry.sourceRecordType === 'event_reconciliation' || entry.evidenceUrl?.startsWith('evidence://')) && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        disabled={openingEvidenceId === entry.id}
                        onClick={() => void retrieveEvidence(entry)}
                      >
                        <Icon name="clipboard" className="h-4 w-4" />
                        {openingEvidenceId === entry.id ? 'Opening...' : 'Open evidence'}
                      </button>
                    )}
                    {evidenceLink?.id === entry.id && <a href={evidenceLink.url} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm">
                      <Icon name="download" className="h-4 w-4" /> Open document
                    </a>}
                    {entry.status === 'ready' && (
                      <button
                        type="button"
                        className="btn-outline btn-sm"
                        disabled={
                          workingId === entry.id ||
                          Boolean(
                            currentActorId && entry.settlementApprovedBy === currentActorId,
                          ) ||
                          (entry.sourceRecordType === 'event_reconciliation' &&
                            !isSupportedFinanceEvidenceReference(entry.evidenceUrl))
                        }
                        title={
                          currentActorId && entry.settlementApprovedBy === currentActorId
                            ? 'A different Finance user must post this settlement.'
                            : undefined
                        }
                        onClick={() => void transition(entry, 'post')}
                      >
                        Post
                      </button>
                    )}
                    {entry.status === 'posted' && (
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        disabled={
                          workingId === entry.id ||
                          Boolean(
                            currentActorId && entry.settlementApprovedBy === currentActorId,
                          )
                        }
                        title={
                          currentActorId && entry.settlementApprovedBy === currentActorId
                            ? 'A different Finance user must reconcile this settlement.'
                            : undefined
                        }
                        onClick={() => void transition(entry, 'reconcile')}
                      >
                        Reconcile
                      </button>
                    )}
                    {!['reconciled', 'exception'].includes(entry.status) && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-rose-700 dark:text-rose-300"
                        disabled={workingId === entry.id}
                        onClick={() => void transition(entry, 'exception')}
                      >
                        Flag
                      </button>
                    )}
                  </div>
                )}
              </div>
              <dl className="grid gap-2 border-t border-line pt-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-faint">Canonical source</dt>
                  <dd className="font-medium text-ink">
                    {entry.sourceRecordType
                      ? SOURCE_LABEL[entry.sourceRecordType]
                      : 'Legacy unbound entry'}
                    {entry.sourceRecordId ? ` / ${entry.sourceRecordId}` : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-faint">Registered evidence</dt>
                  <dd className="font-medium text-ink">
                    {entry.evidenceRecordType
                      ? EVIDENCE_LABEL[entry.evidenceRecordType]
                      : 'Not bound'}
                    {entry.evidenceRecordId ? ` / ${entry.evidenceRecordId}` : ''}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-faint">Actor lineage</dt>
                  <dd className="text-ink">
                    Prepared by{' '}
                    {entry.preparedActor?.name ?? entry.preparedActor?.email ?? entry.preparedBy}
                    {entry.postedBy
                      ? `; posted by ${entry.postedActor?.name ?? entry.postedActor?.email ?? entry.postedBy}`
                      : ''}
                    {entry.reconciledBy
                      ? `; reconciled by ${entry.reconciledActor?.name ?? entry.reconciledActor?.email ?? entry.reconciledBy}`
                      : ''}
                  </dd>
                </div>
              </dl>
            </Card>
          ))}
        </div>
      )}

      {canManage && (
        <Sheet
          open={open}
          onOpenChange={(next) => { if (!savingRef.current) setOpen(next); }}
          title="Prepare Finance close entry"
          description="Attach source evidence now. Independent posting is enforced after preparation."
          footer={
            <button
              type="submit"
              form="finance-close-form"
              className="btn-primary w-full"
              disabled={
                saving || draftConflict || !attachment.canSubmit(requiresAttachment) || validateFinanceCloseEntry({ action: 'save', ...draft, ...evidenceIdentity, evidenceUrl: attachment.reference }).length > 0
              }
            >
              {saving ? 'Preparing...' : 'Prepare for posting'}
            </button>
          }
        >
          <form
            id="finance-close-form"
            className="space-y-4"
            onSubmit={(event) => void submit(event)}
          >
            {draftKey && <div className="space-y-1 border-b border-line pb-3">
              <p role="status" className="text-xs text-muted">{draftStatus || 'Browser-only draft recovery; expires after 7 days.'}</p>
              <p className="text-xs text-muted">Evidence links are not saved in browser drafts.</p>
              {draftConflict && <button type="button" className="btn-outline btn-sm" onClick={resumeDraft}>Resume saved draft</button>}
              <button type="button" className="btn-ghost btn-sm" disabled={saving} onClick={discardDraft}>Discard draft</button>
            </div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Period start" htmlFor="close-period-start">
                <input
                  id="close-period-start"
                  className="input"
                  type="date"
                  value={draft.periodStart}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      periodStart: event.target.value,
                    }))
                  }
                  required
                />
              </Field>
              <Field label="Period end" htmlFor="close-period-end">
                <input
                  id="close-period-end"
                  className="input"
                  type="date"
                  min={draft.periodStart}
                  value={draft.periodEnd}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      periodEnd: event.target.value,
                    }))
                  }
                  required
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Canonical source type" htmlFor="close-source-record-type">
                <select
                  id="close-source-record-type"
                  className="input"
                  value={draft.sourceRecordType}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      sourceRecordType: event.target.value as FinanceCloseSourceRecordType,
                    }))
                  }
                >
                  {Object.entries(SOURCE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Canonical source ID" htmlFor="close-source-record-id">
                <input
                  id="close-source-record-id"
                  className="input"
                  value={draft.sourceRecordId}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      sourceRecordId: event.target.value,
                    }))
                  }
                  required
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Evidence type" htmlFor="close-evidence-record-type">
                <select
                  id="close-evidence-record-type"
                  className="input"
                  value={evidenceIdentity.evidenceRecordType}
                  disabled={saving || Boolean(attachment.document?.documentId)}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      evidenceRecordType: event.target.value as FinanceCloseEvidenceRecordType,
                    }))
                  }
                >
                  {Object.entries(EVIDENCE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Registered evidence ID" htmlFor="close-evidence-record-id">
                <input
                  id="close-evidence-record-id"
                  className="input"
                  value={evidenceIdentity.evidenceRecordId}
                  disabled={saving || Boolean(attachment.document?.documentId)}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      evidenceRecordId: event.target.value,
                    }))
                  }
                  required
                />
              </Field>
            </div>
            <Field label="Entry type" htmlFor="close-entry-type">
              <select
                id="close-entry-type"
                className="input"
                value={draft.entryType}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    entryType: event.target.value as FinanceCloseEntryType,
                  }))
                }
              >
                {Object.entries(ENTRY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Source module" htmlFor="close-source-module">
                <input
                  id="close-source-module"
                  className="input"
                  value={draft.sourceModule}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      sourceModule: event.target.value,
                    }))
                  }
                  required
                />
              </Field>
              <Field label="Source reference" htmlFor="close-source-reference">
                <input
                  id="close-source-reference"
                  className="input"
                  value={draft.sourceReference}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      sourceReference: event.target.value,
                    }))
                  }
                  required
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Cost center" htmlFor="close-cost-center">
                <input
                  id="close-cost-center"
                  className="input"
                  value={draft.costCenter}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      costCenter: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="Amount (PHP)" htmlFor="close-amount">
                <input
                  id="close-amount"
                  className="input"
                  type="number"
                  step="0.01"
                  value={draft.amount}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      amount: Number(event.target.value),
                    }))
                  }
                  required
                />
              </Field>
            </div>
            <EvidenceAttachment id="close-evidence" attachment={attachment} disabled={saving || !draft.sourceRecordId.trim()}
              recordLabel={draft.sourceReference || draft.sourceRecordId || 'Selected Finance source'}
              uploadScope={draft.sourceRecordType !== 'event_reconciliation'
                ? { sourceType: draft.sourceRecordType, sourceId: draft.sourceRecordId } : undefined}
              unavailableReason={draft.sourceRecordType === 'event_reconciliation'
                ? 'Event settlement evidence is attached through Event reconciliation.' : undefined} />
            <Field label="Reconciliation note" htmlFor="close-note">
              <textarea
                id="close-note"
                className="input min-h-24"
                value={draft.reconciliationNote}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    reconciliationNote: event.target.value,
                  }))
                }
              />
            </Field>
          </form>
        </Sheet>
      )}
    </section>
  );
}
