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
import { closeActionReason } from '../closeEligibility';
import type { SearchCloseSources, LoadCloseEvidence, CloseSource, CloseEvidenceOption } from '../sourceSelection';
import { closeSourceBlocker } from '../sourceSelection';

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
  searchSources?: SearchCloseSources;
  loadEvidenceOptions?: LoadCloseEvidence;
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
  searchSources,
  loadEvidenceOptions,
}: FinanceClosePanelProps) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FinanceCloseEntry>();
  const [flagging, setFlagging] = useState<FinanceCloseEntry>();
  const [flagReason, setFlagReason] = useState('');
  const [workingId, setWorkingId] = useState<string>();
  const transitionLock = useRef(false);
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
  const [sourceQuery, setSourceQuery] = useState('');
  const [sources, setSources] = useState<CloseSource[]>([]);
  const [sourceError, setSourceError] = useState('');
  const [authorizedSource, setAuthorizedSource] = useState<CloseSource>();
  const [evidenceOptions, setEvidenceOptions] = useState<CloseEvidenceOption[]>([]);
  useEffect(() => {
    if (!searchSources || !canManage) return;
    const query = new URLSearchParams(window.location.search);
    const type = query.get('close_source_type');
    const id = query.get('close_source_id');
    if (!type || !id) return;
    const blocker = closeSourceBlocker(type);
    if (blocker) { toast.error(blocker); return; }
    let active = true;
    void searchSources('', type, id).then(rows => {
      const source = rows.find(row => row.type === type && row.id === id);
      if (!source) throw new Error('The requested source is not available in your scope.');
      if (active) { setDraft(current => ({...current,sourceRecordType:source.type,sourceRecordId:source.id,sourceModule:source.module,sourceReference:source.reference,amount:source.amount ?? 0,evidenceRecordType:'core_document',evidenceRecordId:''})); setOpen(true); }
    }).catch(cause => { if (active) toast.error(cause.message || 'Source access unavailable'); });
    return () => { active = false; };
  }, [searchSources, canManage]);
  useEffect(() => {
    if (!open || !searchSources) return;
    let active = true;
    const timer = setTimeout(() => {
      void searchSources(sourceQuery).then(rows => { if (active) { setSources(rows); setSourceError(''); } }).catch(cause => { if (active) setSourceError(cause.message || 'Source lookup unavailable'); });
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [open, sourceQuery, searchSources]);
  useEffect(() => {
    setAuthorizedSource(undefined); setEvidenceOptions([]);
    if (!open || !searchSources || !draft.sourceRecordId) return;
    const blocker = closeSourceBlocker(draft.sourceRecordType);
    if (blocker) { setSourceError(blocker); return; }
    let active = true;
    void searchSources('', draft.sourceRecordType, draft.sourceRecordId).then(async rows => {
      const source = rows.find(row => row.id === draft.sourceRecordId && row.type === draft.sourceRecordType);
      if (!source) throw new Error('Source access unavailable. Select an authorized source.');
      const options = await loadEvidenceOptions?.(source.type, source.id) ?? [];
      if (active) { setAuthorizedSource(source); setEvidenceOptions(options); setSourceError(''); }
    }).catch(cause => { if (active) setSourceError(cause.message || 'Source lookup unavailable'); });
    return () => { active = false; };
  }, [open, draft.sourceRecordId, draft.sourceRecordType, searchSources, loadEvidenceOptions]);
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
    if (!open || !dirty || !draftKey || draftConflict || saving || editing) return;
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
  }, [open, dirty, draft, draftKey, draftConflict, saving, editing]);

  useEffect(() => {
    if (!open || (!dirty && !attachment.reference)) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [open, dirty, attachment.reference]);

  const resumeDraft = () => {
    setEditing(undefined);
    const saved = readCloseDraft(draftKey);
    if (!saved) { setRecovery(undefined); setDraftStatus('No valid browser draft remains.'); return; }
    revision.current = saved.raw;
    setDraft(saved.draft);
    setDraftConflict(false);
    attachment.clear();
    setOpen(true);
  };
  const discardDraft = () => {
    if (editing) { setEditing(undefined); setDraft(emptyCloseDraft()); attachment.clear(); setOpen(false); return; }
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
    if (transitionLock.current) return;
    const blocked = closeActionReason(entry, action, currentActorId, canManage);
    if (blocked || (action === 'exception' && !flagReason.trim())) {
      toast.error(blocked ?? 'Enter a correction reason.');
      return;
    }
    transitionLock.current = true;
    setWorkingId(entry.id);
    try {
      await manage({
        action,
        id: entry.id,
        expectedUpdatedAt: entry.updatedAt,
        reconciliationNote: action === 'exception' ? flagReason.trim() : undefined,
      });
      setFlagging(undefined);
      setFlagReason('');
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
      transitionLock.current = false;
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
      if (searchSources) {
        const matches = await searchSources('', draft.sourceRecordType, draft.sourceRecordId);
        const selected = matches.find(source => source.id === draft.sourceRecordId && source.type === draft.sourceRecordType);
        if (!selected || selected.module !== draft.sourceModule || selected.reference !== draft.sourceReference) throw new Error('Source access or canonical identity changed. Select the source again.');
      }
      await manage({
        action: 'save',
        id: editing?.id,
        expectedUpdatedAt: editing?.updatedAt,
        ...draft,
        ...evidenceIdentity,
        evidenceUrl: attachment.reference || editing?.evidenceUrl || '',
        costCenter: draft.costCenter || undefined,
      });
      toast.success('Finance close entry prepared for independent posting.');
      setOpen(false);
      setEditing(undefined);
      try {
        if (!editing) {
          if (draftKey && localStorage.getItem(draftKey) === revision.current) localStorage.removeItem(draftKey);
          revision.current = null;
          setRecovery(undefined);
          setDraftStatus('');
        }
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
            onClick={() => { if (recovery) resumeDraft(); else { setEditing(undefined); setDraft(emptyCloseDraft()); setOpen(true); } }}
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
              <span id={`close-${entry.id}`} />
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
                {(
                  <div className="flex flex-wrap justify-end gap-2">
                    {(entry.evidenceRecordId || entry.sourceRecordType === 'event_reconciliation' || entry.evidenceUrl?.startsWith('evidence://')) && (
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
                    {canManage && entry.status === 'ready' && (
                      <button
                        type="button"
                        className="btn-outline btn-sm"
                        disabled={
                          workingId === entry.id || Boolean(closeActionReason(entry, 'post', currentActorId, canManage)) ||
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
                    {canManage && entry.status === 'posted' && (
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        disabled={
                          workingId === entry.id || Boolean(closeActionReason(entry, 'reconcile', currentActorId, canManage)) ||
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
                    {canManage && ['draft', 'ready'].includes(entry.status) && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-rose-700 dark:text-rose-300"
                        disabled={workingId === entry.id}
                        onClick={() => { setFlagReason(''); setFlagging(entry); }}
                      >
                        Flag
                      </button>
                    )}
                  </div>
                )}
              </div>
              {entry.reconciliationNote && <p className="text-sm [overflow-wrap:anywhere]">Correction / reconciliation note: {entry.reconciliationNote}{entry.correctionBy ? `; flagged by ${entry.correctionBy} at ${entry.correctionAt}` : ''}</p>}
              {['ready', 'posted'].includes(entry.status) && <p role="status" className="text-sm text-muted">{closeActionReason(entry, entry.status === 'ready' ? 'post' : 'reconcile', currentActorId, canManage) ?? `Next: independent Finance ${entry.status === 'ready' ? 'poster' : 'reconciler'}`}</p>}
              {canManage && !closeActionReason(entry, 'save', currentActorId, canManage) && <button type="button" className="btn-outline btn-sm" onClick={() => {
                setEditing(entry);
                setDraft({ ...emptyCloseDraft(), periodStart: entry.periodStart, periodEnd: entry.periodEnd,
                  entryType: entry.entryType, sourceModule: entry.sourceModule, sourceReference: entry.sourceReference,
                  sourceRecordType: entry.sourceRecordType!, sourceRecordId: entry.sourceRecordId ?? '',
                  evidenceRecordType: entry.evidenceRecordType!, evidenceRecordId: entry.evidenceRecordId ?? '',
                  amount: entry.amount, costCenter: entry.costCenter ?? '', reconciliationNote: entry.reconciliationNote ?? '' });
                attachment.clear(); setOpen(true);
              }}>Edit and resubmit</button>}
              {entry.sourceRecordType === 'event_reconciliation' && entry.status === 'exception' && <a className="btn-outline btn-sm" href={`/events/${encodeURIComponent(entry.sourceRecordId ?? '')}`}>Open governed Event correction</a>}
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

      {canManage && <Sheet open={Boolean(flagging)} onOpenChange={(next) => { if (!workingId && !next) setFlagging(undefined); }} title="Flag close entry" footer={<button type="button" className="btn-primary" disabled={Boolean(workingId) || !flagReason.trim()} onClick={() => flagging && void transition(flagging, 'exception')}>Record correction reason</button>}>
        <Field label="Correction reason" htmlFor="close-flag-reason"><textarea id="close-flag-reason" className="input" value={flagReason} onChange={event => setFlagReason(event.target.value)} required /></Field>
      </Sheet>}
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
                saving || draftConflict || (Boolean(searchSources) && !authorizedSource) || !attachment.canSubmit(requiresAttachment) || validateFinanceCloseEntry({ action: 'save', ...draft, ...evidenceIdentity, evidenceUrl: attachment.reference }).length > 0
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
            {searchSources && <div className="space-y-2">
              <Field label="Find source by business reference" htmlFor="close-source-search"><input id="close-source-search" className="input" value={sourceQuery} onChange={event => setSourceQuery(event.target.value)} /></Field>
              {sourceError && <p role="alert">{sourceError}</p>}
              <p className="text-sm text-muted">Available sources: purchase orders, receipts, posted payment releases. Event settlements are upstream-only. Direct request/pack preparation, counts, and returns are unavailable here.</p>
              <label className="block">Source record<select className="input w-full" value={authorizedSource ? `${authorizedSource.type}:${authorizedSource.id}` : ''} onChange={event => {
                const source = sources.find(row => `${row.type}:${row.id}` === event.target.value);
                if (!source) return;
                setDraft(current => ({...current, sourceRecordType: source.type, sourceRecordId: source.id, sourceModule: source.module, sourceReference: source.reference, amount: source.amount ?? current.amount, evidenceRecordId: '', evidenceRecordType: 'core_document'}));
                attachment.clear();
              }}><option value="">Select an authorized source</option>{sources.map(source => <option key={`${source.type}:${source.id}`} value={`${source.type}:${source.id}`}>{source.reference} / {source.party ?? 'Party unavailable'} / {source.occurred_at.slice(0,10)} / {source.amount == null ? 'Amount unavailable' : money(source.amount)}</option>)}</select></label>
              {authorizedSource && <div className="flex flex-wrap gap-3"><a className="underline" href={authorizedSource.href}>Open source record</a><a className="underline" href={`/finance?${new URLSearchParams({close_source_type:authorizedSource.type,close_source_id:authorizedSource.id})}`}>Open prebound source draft</a></div>}
              <label className="block">Eligible registered evidence<select className="input w-full" value={draft.evidenceRecordId} onChange={event => { const evidence = evidenceOptions.find(item => item.id === event.target.value); if (evidence) setDraft(current => ({...current,evidenceRecordId:evidence.id,evidenceRecordType:evidence.type})); }}><option value="">Select evidence or upload below</option>{evidenceOptions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            </div>}
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
                  disabled={Boolean(searchSources)}
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
                  readOnly={Boolean(searchSources)}
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
                  disabled={saving || Boolean(searchSources) || Boolean(attachment.document?.documentId)}
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
                  disabled={saving || Boolean(searchSources) || Boolean(attachment.document?.documentId)}
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
                  readOnly={Boolean(searchSources)}
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
                  readOnly={Boolean(searchSources)}
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
