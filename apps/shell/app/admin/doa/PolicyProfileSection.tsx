'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Field, Input, Sheet, useToast } from '@intra/ui';
import {
  MPIC_SOURCE_PROFILE,
  MWELL_OPERATING_PROFILE,
} from '@intra/procurement';
import type { ProcurementPolicyControls } from '@intra/procurement';

type PolicyClient = {
  schema(name: 'procurement'): {
    rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
    from?: (table: string) => {
      select(columns: string): {
        order(column: string, options?: { ascending?: boolean }): Promise<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
};

type PolicyProfileHistory = {
  id: string;
  code: string;
  version: string;
  status: string;
  relationship: string;
  effective_from: string;
  created_by: string;
  activated_by: string | null;
  source_filename?: string;
};

type PolicyConflict = {
  id: string;
  parent_rule: string;
  local_rule: string;
  impact: string;
  status: string;
  created_at: string;
};

type PolicyEvent = {
  id: string;
  policy_profile_id: string;
  event_type: string;
  actor_id: string;
  profile_actor_id: string;
  event_at: string;
};

const CONTROL_LABELS: Record<keyof ProcurementPolicyControls, string> = {
  formalBidAmount: 'Formal-bid amount (PHP)',
  inviteTargetMin: 'Competitive invite minimum',
  inviteTargetMax: 'Competitive invite maximum',
  sealedBidMinimumResponses: 'Sealed-bid usable responses',
  bidWindowWorkingDays: 'Bid window (working days)',
  maxExtensionWorkingDays: 'Maximum extension (working days)',
  vendorAcknowledgementHours: 'Vendor acknowledgement (hours)',
  clarificationHours: 'Clarification response (hours)',
  tabulationHours: 'Commercial tabulation (hours)',
  technicalEvaluationWorkingDays: 'Technical evaluation (working days)',
  poAcknowledgementHours: 'PO acknowledgement (hours)',
  repeatOrderMaxAmount: 'Repeat-order maximum (PHP)',
  repeatOrderMaxAgeDays: 'Repeat-order lookback (days)',
  pettyCashMaxAmount: 'Petty-cash maximum (PHP)',
  poInvoiceThreshold: 'Invoice PO threshold (PHP)',
  vendorProbationMonths: 'Vendor probation (months)',
};

export function PolicyProfileSection({
  canManage,
  mode,
  client,
}: {
  canManage: boolean;
  mode: 'memory' | 'supabase';
  client: PolicyClient | null;
}) {
  const toast = useToast();
  const [controls, setControls] = useState(MWELL_OPERATING_PROFILE.controls);
  const [effectiveFrom, setEffectiveFrom] = useState(MWELL_OPERATING_PROFILE.effectiveFrom);
  const [busy, setBusy] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflictId, setConflictId] = useState('');
  const [rationale, setRationale] = useState('');
  const [selectedMapping, setSelectedMapping] = useState('retain_mwell_mapping');
  const [draftId, setDraftId] = useState<string | null>(null);
  const [documentHash, setDocumentHash] = useState('');
  const [parentProfileId, setParentProfileId] = useState('');
  const [profileHistory, setProfileHistory] = useState<PolicyProfileHistory[]>([]);
  const [openConflicts, setOpenConflicts] = useState<PolicyConflict[]>([]);
  const [events, setEvents] = useState<PolicyEvent[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeMapping, setActiveMapping] = useState({ code: MWELL_OPERATING_PROFILE.code, version: MWELL_OPERATING_PROFILE.version, effectiveFrom: MWELL_OPERATING_PROFILE.effectiveFrom, sourceFilename: MWELL_OPERATING_PROFILE.sourceFilename, controlSources: MWELL_OPERATING_PROFILE.controlSources });
  const controlEntries = useMemo(
    () => Object.entries(CONTROL_LABELS) as Array<[keyof ProcurementPolicyControls, string]>,
    [],
  );

  useEffect(() => {
    let active = true;
    const loadHistory = async () => {
      if (mode !== 'supabase' || !client) return;
      const procurement = client.schema('procurement');
      if (!procurement.from) return;
      const [profiles, conflicts, profileEvents, effective] = await Promise.all([
        procurement.from('policy_profiles').select('id,code,version,status,relationship,effective_from,created_by,activated_by,source_filename').order('effective_from', { ascending: false }),
        procurement.from('policy_conflicts').select('id,parent_rule,local_rule,impact,status,created_at').order('created_at', { ascending: false }),
        procurement.from('policy_profile_events').select('id,policy_profile_id,event_type,actor_id,profile_actor_id,event_at').order('event_at', { ascending: false }),
        procurement.rpc('get_effective_policy_profile', { as_of: null }),
      ]);
      if (!active) return;
      const firstError = profiles.error ?? conflicts.error ?? profileEvents.error ?? effective.error;
      if (firstError) {
        setHistoryError(firstError.message);
        return;
      }
      setHistoryError(null);
      setProfileHistory((profiles.data ?? []) as PolicyProfileHistory[]);
      setOpenConflicts(((conflicts.data ?? []) as PolicyConflict[]).filter((conflict) => conflict.status === 'open'));
      setEvents((profileEvents.data ?? []) as PolicyEvent[]);
      if (effective.data && typeof effective.data === 'object') {
        const raw = effective.data as Record<string, unknown>;
        const nextControls = Object.fromEntries(Object.keys(CONTROL_LABELS).map((key) => [key, raw[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)] ?? null])) as unknown as ProcurementPolicyControls;
        setControls(nextControls);
        setEffectiveFrom(String(raw.effective_from ?? MWELL_OPERATING_PROFILE.effectiveFrom).slice(0, 10));
        setActiveMapping({ code: String(raw.code ?? MWELL_OPERATING_PROFILE.code), version: String(raw.version ?? MWELL_OPERATING_PROFILE.version), effectiveFrom: String(raw.effective_from ?? MWELL_OPERATING_PROFILE.effectiveFrom).slice(0, 10), sourceFilename: String(raw.source_filename ?? MWELL_OPERATING_PROFILE.sourceFilename), controlSources: raw.control_sources && typeof raw.control_sources === 'object' ? raw.control_sources as typeof MWELL_OPERATING_PROFILE.controlSources : MWELL_OPERATING_PROFILE.controlSources });
      }
    };
    void loadHistory();
    return () => { active = false; };
  }, [client, mode, reloadKey]);

  const saveDraft = async () => {
    if (!canManage) return;
    if (!/^[a-f0-9]{64}$/i.test(documentHash)) {
      toast.error('Enter the 64-character SHA-256 hash for the controlled policy document.');
      return;
    }
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(parentProfileId)) {
      toast.error('Select the governed parent source profile before saving an Mwell operating revision.');
      return;
    }
    if (mode !== 'supabase' || !client) {
      toast.toast('Preview mode shows the governed editor but cannot save a policy revision.');
      return;
    }
    setBusy(true);
    const { data, error } = await client.schema('procurement').rpc('save_policy_profile', {
      payload: {
        code: `${activeMapping.code}-REV`,
        version: `${activeMapping.version}-REV`,
        name: `${activeMapping.code} revision`,
        relationship: 'mwell_operating',
        source_profile_id: parentProfileId,
        source_filename: activeMapping.sourceFilename,
        source_organization: 'Mwell',
        control_sources: activeMapping.controlSources,
        controls,
        effective_from: new Date(`${effectiveFrom}T00:00:00+08:00`).toISOString(),
        document_hash: documentHash,
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    const id = data && typeof data === 'object' && 'id' in data ? String((data as { id: unknown }).id) : null;
    setDraftId(id);
    setDocumentHash('');
    setReloadKey((value) => value + 1);
    toast.success('Procurement policy revision saved as a draft. A separate checker must activate it.');
  };

  const resolveConflict = async () => {
    if (!conflictId.trim() || !rationale.trim()) return toast.error('Select a recorded conflict and enter the required rationale.');
    if (mode !== 'supabase' || !client) return toast.toast('Preview mode cannot resolve a policy conflict.');
    setBusy(true);
    const { error } = await client.schema('procurement').rpc('resolve_policy_conflict', {
      payload: { id: conflictId.trim(), selected_mapping: selectedMapping.trim(), rationale: rationale.trim() },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    setConflictOpen(false);
    setRationale('');
    setReloadKey((value) => value + 1);
    toast.success('Policy conflict resolved and recorded in immutable history.');
  };

  const activateDraft = async () => {
    if (!draftId || mode !== 'supabase' || !client) return;
    setBusy(true);
    const { error } = await client.schema('procurement').rpc('activate_policy_profile', { payload: { id: draftId } });
    setBusy(false);
    if (error) return toast.error(error.message);
    setReloadKey((value) => value + 1);
    toast.success('Policy profile activated by the checker. The prior active profile was retained as history.');
  };

  return (
    <section aria-labelledby="procurement-policy-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="procurement-policy-heading" className="text-lg font-semibold text-ink">Procurement policy profiles</h2>
          <p className="mt-1 text-sm text-muted">Separate from DOA. This controls route thresholds and operating timeframes, while DOA assigns approval authority.</p>
        </div>
        <Badge tone="emerald">Governed active mapping</Badge>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="font-semibold text-ink">Parent source</h3>
          <p className="mt-2 text-sm text-muted">{MPIC_SOURCE_PROFILE.sourceFilename} · {MPIC_SOURCE_PROFILE.sourceOrganization}</p>
          <p className="mt-1 text-xs text-faint">Source controls are inherited unless a documented Mwell operating mapping states otherwise.</p>
        </Card>
        <Card className="p-4">
          <h3 className="font-semibold text-ink">Active Mwell mapping</h3>
          <p className="mt-2 text-sm text-muted">{activeMapping.code} {activeMapping.version} · effective {activeMapping.effectiveFrom}</p>
          <p className="mt-1 text-xs text-faint">Maker: policy author. Checker: a different authorized Admin or Legal user.</p>
        </Card>
      </div>

      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="font-semibold text-ink">Draft controlled revision</h3><p className="mt-1 text-xs text-muted">Each numeric control keeps its source mapping. Saving a draft does not activate it.</p></div>
          <Badge tone="amber">Maker-checker</Badge>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {controlEntries.map(([key, label]) => (
            <Field key={key} label={label} htmlFor={`policy-${key}`}>
              <Input
                id={`policy-${key}`}
                type="number"
                min={key === 'formalBidAmount' ? 0 : 1}
                step={key.includes('Amount') || key.includes('Threshold') ? '0.01' : '1'}
                disabled={!canManage}
                value={controls[key] ?? ''}
                onChange={(event) => setControls((current) => ({ ...current, [key]: event.target.value === '' ? null : Number(event.target.value) }))}
              />
              <p className="mt-1 text-xs text-faint">{activeMapping.controlSources[key] ?? 'Source mapping required'}</p>
            </Field>
          ))}
          <Field label="Effective date" htmlFor="policy-effective-from">
            <Input id="policy-effective-from" type="date" disabled={!canManage} value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} />
          </Field>
          <Field label="Controlled document SHA-256" htmlFor="policy-document-hash">
            <Input id="policy-document-hash" disabled={!canManage} value={documentHash} onChange={(event) => setDocumentHash(event.target.value.trim())} placeholder="64-character document hash" />
            <p className="mt-1 text-xs text-faint">Required before a policy revision can be saved for independent review.</p>
          </Field>
          <Field label="Governed parent source profile" htmlFor="policy-parent-profile">
            <select id="policy-parent-profile" className="input" disabled={!canManage} value={parentProfileId} onChange={(event) => setParentProfileId(event.target.value)}>
              <option value="">Select a governed parent source</option>
              {profileHistory.filter((profile) => profile.relationship === 'parent_source').map((profile) => <option key={profile.id} value={profile.id}>{profile.code} {profile.version}</option>)}
            </select>
            <p className="mt-1 text-xs text-faint">{profileHistory.find((profile) => profile.id === parentProfileId) ? `${profileHistory.find((profile) => profile.id === parentProfileId)?.code} ${profileHistory.find((profile) => profile.id === parentProfileId)?.version} · ${profileHistory.find((profile) => profile.id === parentProfileId)?.source_filename ?? 'controlled source'} ` : 'The canonical MPIC source must already be governed before an Mwell mapping can be saved.'}</p>
          </Field>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button disabled={!canManage || busy} onClick={() => void saveDraft()}>{busy ? 'Saving...' : 'Save policy draft'}</Button>
          <Button variant="outline" disabled={!canManage} onClick={() => setConflictOpen(true)}>Resolve a conflict</Button>
          <Button variant="outline" disabled={!canManage || !draftId || busy} onClick={() => void activateDraft()}>Activate as checker</Button>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <h3 className="font-semibold text-ink">History and unresolved conflicts</h3>
        <p className="mt-1 text-sm text-muted">Activation history, draft author, checker, and unresolved policy conflicts are read from the governed profile records. A conflict needs a documented mapping and rationale before activation.</p>
        {historyError ? <p role="alert" className="mt-3 text-sm text-danger">Could not load policy history: {historyError}</p> : null}
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <div><h4 className="text-sm font-semibold text-ink">Profiles</h4><ul className="mt-2 space-y-2 text-sm text-muted">{profileHistory.length ? profileHistory.slice(0, 4).map((profile) => <li key={profile.id}><strong className="text-ink">{profile.code} {profile.version}</strong><br />{profile.status} · effective {profile.effective_from.slice(0, 10)}<br />Maker {profile.created_by} · checker {profile.activated_by ?? 'Pending'}</li>) : <li>No governed profile history is available yet.</li>}</ul></div>
          <div><h4 className="text-sm font-semibold text-ink">Open conflicts</h4><ul className="mt-2 space-y-2 text-sm text-muted">{openConflicts.length ? openConflicts.slice(0, 4).map((conflict) => <li key={conflict.id}><strong className="text-ink">{conflict.parent_rule}</strong><br />{conflict.impact}<br /><button type="button" className="mt-1 text-link underline" onClick={() => { setConflictId(conflict.id); setConflictOpen(true); }}>Resolve this conflict</button></li>) : <li>No unresolved policy conflicts.</li>}</ul></div>
          <div><h4 className="text-sm font-semibold text-ink">Activation events</h4><ul className="mt-2 space-y-2 text-sm text-muted">{events.length ? events.slice(0, 4).map((event) => <li key={event.id}><strong className="text-ink">{event.event_type.replaceAll('_', ' ')}</strong><br />{event.event_at.slice(0, 10)} · actor {event.actor_id}</li>) : <li>No activation events are available yet.</li>}</ul></div>
        </div>
      </Card>

      <Sheet open={conflictOpen} onOpenChange={setConflictOpen} title="Resolve policy conflict">
        <div className="space-y-4 p-4">
          <p className="text-sm text-muted">Use this only for a recorded conflict. The latest profile modifier cannot resolve their own conflict.</p>
          <Field label="Recorded conflict ID" htmlFor="policy-conflict-id"><Input id="policy-conflict-id" value={conflictId} onChange={(event) => setConflictId(event.target.value)} /></Field>
          <Field label="Selected mapping" htmlFor="policy-conflict-mapping"><Input id="policy-conflict-mapping" value={selectedMapping} onChange={(event) => setSelectedMapping(event.target.value)} /></Field>
          <Field label="Required rationale" htmlFor="policy-conflict-rationale"><textarea id="policy-conflict-rationale" className="input min-h-28" value={rationale} onChange={(event) => setRationale(event.target.value)} /></Field>
          <Button onClick={() => void resolveConflict()}>Record resolution</Button>
        </div>
      </Sheet>
    </section>
  );
}
