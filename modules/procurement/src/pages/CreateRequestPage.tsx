'use client';

import type { ChangeEvent, FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  Field,
  HeroChipButton,
  Icon,
  Input,
  ModuleHero,
  Textarea,
  useToast,
} from '@intra/ui';
import { Guard, useSession } from '@intra/auth';
import type {
  RequestAttachment,
  RequestCategory,
  SourcingMethod,
} from '../types';
import { useProcurementRequests, useProcurementVendors } from '../localStore';
import {
  CATEGORY_META,
  buildApprovalLadder,
  minimumQuotes,
  requiredDocuments,
  sourcingMethodLabel,
  suggestSourcingMethod,
  tierLabel,
} from '../policy';

interface LineDraft {
  key: string;
  description: string;
  quantity: string;
  uom: string;
  unitPrice: string;
}

function blankLine(): LineDraft {
  return {
    key: globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
    description: '',
    quantity: '1',
    uom: 'ea',
    unitPrice: '',
  };
}

function toNumber(v: string): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
const MAX_BYTES = 10 * 1024 * 1024;

const ALL_SOURCING: SourcingMethod[] = [
  'petty_cash',
  'small_purchase',
  'rfq',
  'rfp',
  'direct_award',
  'repeat_order',
  'emergency',
];

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

type PendingAttachment = Omit<RequestAttachment, 'id' | 'uploadedAt'>;

export function CreateRequestPage() {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const { add } = useProcurementRequests();
  const vendors = useProcurementVendors();
  const { profile } = useSession();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<RequestCategory | ''>('');
  const [department, setDepartment] = useState('');
  const [costCenter, setCostCenter] = useState('');
  const [projectCode, setProjectCode] = useState('');
  const [budgetCode, setBudgetCode] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [description, setDescription] = useState('');
  const [vendorId, setVendorId] = useState<string>('');
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [submitting, setSubmitting] = useState(false);

  // Justification (Award Recommendation §9)
  const [needDesc, setNeedDesc] = useState('');
  const [alternatives, setAlternatives] = useState('');
  const [riskIfNot, setRiskIfNot] = useState('');

  // Sourcing method (auto-suggested, officer can override)
  const [sourcingMethod, setSourcingMethod] = useState<SourcingMethod | ''>('');
  const [sourcingOverride, setSourcingOverride] = useState(false);
  const [emergency, setEmergency] = useState(false);
  const [repeat, setRepeat] = useState(false);

  // Compliance flags
  const [philgeps, setPhilgeps] = useState('');
  const [directAwardReason, setDirectAwardReason] = useState('');
  const [priceReasonableness, setPriceReasonableness] = useState('');

  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  const total = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const q = toNumber(l.quantity) ?? 0;
        const p = toNumber(l.unitPrice) ?? 0;
        return sum + q * p;
      }, 0),
    [lines],
  );

  const suggestedMethod = useMemo(
    () =>
      suggestSourcingMethod({
        category: category || undefined,
        amount: total,
        emergency,
        repeat,
      }),
    [category, total, emergency, repeat],
  );

  // Keep the sourcing method in sync with the suggestion until the officer
  // explicitly overrides.
  useEffect(() => {
    if (!sourcingOverride) setSourcingMethod(suggestedMethod);
  }, [suggestedMethod, sourcingOverride]);

  const effectiveSourcing: SourcingMethod = (sourcingMethod || suggestedMethod) as SourcingMethod;

  const ladder = useMemo(
    () =>
      buildApprovalLadder({
        category: category || undefined,
        amount: total,
        sourcingMethod: effectiveSourcing,
      }),
    [category, total, effectiveSourcing],
  );

  const requiredDocs = useMemo(
    () =>
      requiredDocuments({
        category: category || undefined,
        amount: total,
        sourcingMethod: effectiveSourcing,
      }),
    [category, total, effectiveSourcing],
  );

  const minQuotes = minimumQuotes(effectiveSourcing);

  const canSubmit =
    title.trim().length > 0 &&
    lines.some((l) => l.description.trim()) &&
    category !== '' &&
    needDesc.trim().length > 0;

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  }

  async function handleAttachmentPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    if (!ALLOWED_MIME.has(file.type)) {
      error(`Unsupported file type (${file.type || 'unknown'}). Allowed: JPEG, PNG, WebP, PDF.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 10 MB.`);
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      setAttachments((prev) => [
        ...prev,
        {
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          dataUrl,
          uploadedByEmail: profile?.email,
          kind: 'other',
        },
      ]);
    } catch (err) {
      error(err instanceof Error ? err.message : 'Could not read the file.');
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit(event: FormEvent, andSubmit = false) {
    event.preventDefault();
    if (!canSubmit) {
      error('Give the request a title, category, need description, and at least one line item.');
      return;
    }
    setSubmitting(true);
    try {
      const cleanLines = lines
        .filter((l) => l.description.trim())
        .map((l) => ({
          description: l.description.trim(),
          quantity: toNumber(l.quantity) ?? 1,
          uom: l.uom.trim() || 'ea',
          unitPrice: toNumber(l.unitPrice),
        }));
      const vendor = vendors.find((v) => v.id === vendorId);

      const compliance: Parameters<typeof add>[0]['compliance'] = {
        philgepsReference: philgeps.trim() || undefined,
        priceReasonableness: priceReasonableness.trim() || undefined,
        vendorAccreditationRequired:
          effectiveSourcing !== 'petty_cash' && effectiveSourcing !== 'emergency',
      };
      if (effectiveSourcing === 'direct_award' || effectiveSourcing === 'emergency') {
        const reason = (directAwardReason || 'other') as
          | 'sole_supplier'
          | 'emergency'
          | 'repeat_continuity'
          | 'other';
        compliance.directAwardReason = reason;
      }

      const created = add({
        title: title.trim(),
        description: description.trim() || undefined,
        department: department.trim() || undefined,
        costCenter: costCenter.trim() || undefined,
        projectCode: projectCode.trim() || undefined,
        budgetCode: budgetCode.trim() || undefined,
        neededBy: neededBy.trim() || undefined,
        vendorId: vendor?.id,
        vendorName: vendor?.legalName,
        requesterName: profile?.name,
        requesterEmail: profile?.email,
        lines: cleanLines,
        category: (category || undefined) as RequestCategory | undefined,
        sourcingMethod: effectiveSourcing,
        sourcingOverride,
        justification: {
          need: needDesc.trim(),
          alternatives: alternatives.trim() || undefined,
          risk: riskIfNot.trim() || undefined,
        },
        attachments,
        compliance,
      });
      if (andSubmit) {
        navigate(`/requests/${created.id}?submit=1`);
      } else {
        success('Draft request saved');
        navigate(`/requests/${created.id}`);
      }
    } catch (e) {
      error(e instanceof Error ? e.message : 'Could not save the draft.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Guard module="procurement" cap="create_request">
      <div className="mx-auto max-w-4xl space-y-6">
        <ModuleHero
          eyebrow="New request"
          title="Draft a purchase request"
          description="Pick a category, describe the need, add line items and any supporting evidence. Procurement will confirm the sourcing path before award."
          icon="cart"
          action={
            <HeroChipButton icon="x" href="/procurement">
              Cancel
            </HeroChipButton>
          }
        />

        <form className="space-y-6" onSubmit={(e) => handleSubmit(e, false)}>
          {/* -------------- Category picker -------------- */}
          <section className="card space-y-4 p-4 sm:p-5">
            <div>
              <h2 className="font-display text-base font-bold text-ink">1. What are you buying?</h2>
              <p className="text-xs text-muted">Category drives sourcing path, approvers, and required documents.</p>
            </div>
            <fieldset>
              <legend className="sr-only">Category</legend>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {CATEGORY_META.map((c) => {
                  const active = category === c.code;
                  return (
                    <label
                      key={c.code}
                      className={[
                        'group flex cursor-pointer flex-col rounded-2xl border p-3 transition',
                        active
                          ? 'border-brand-500 bg-brand-500/10 ring-2 ring-brand-500/40'
                          : 'border-line bg-surface hover:border-brand-500/40',
                      ].join(' ')}
                    >
                      <input
                        type="radio"
                        name="category"
                        value={c.code}
                        checked={active}
                        onChange={() => setCategory(c.code)}
                        className="sr-only"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-ink">{c.label}</span>
                        {c.highRisk && <Badge tone="amber">high-risk</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-muted">{c.description}</p>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </section>

          {/* -------------- Header fields -------------- */}
          <section className="card space-y-4 p-4 sm:p-5">
            <div>
              <h2 className="font-display text-base font-bold text-ink">2. Who is it for?</h2>
              <p className="text-xs text-muted">Cost center + project/budget code so Finance can reconcile the spend.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Title" htmlFor="title">
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Salesforce Enterprise seats — FY26"
                  required
                />
              </Field>
              <Field label="Needed by" htmlFor="neededBy">
                <Input
                  id="neededBy"
                  type="date"
                  value={neededBy}
                  onChange={(e) => setNeededBy(e.target.value)}
                />
              </Field>
              <Field label="Department" htmlFor="department">
                <Input
                  id="department"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  placeholder="Marketing / IT / HR / …"
                />
              </Field>
              <Field label="Cost center" htmlFor="costCenter">
                <Input
                  id="costCenter"
                  value={costCenter}
                  onChange={(e) => setCostCenter(e.target.value)}
                  placeholder="MKT-2026-EV"
                />
              </Field>
              <Field label="Project code (optional)" htmlFor="projectCode">
                <Input
                  id="projectCode"
                  value={projectCode}
                  onChange={(e) => setProjectCode(e.target.value)}
                  placeholder="PRJ-CRM-ROLLOUT"
                />
              </Field>
              <Field label="Budget / GL code" htmlFor="budgetCode">
                <Input
                  id="budgetCode"
                  value={budgetCode}
                  onChange={(e) => setBudgetCode(e.target.value)}
                  placeholder="GL-5100-SW"
                />
              </Field>
            </div>
          </section>

          {/* -------------- Justification -------------- */}
          <section className="card space-y-4 p-4 sm:p-5">
            <div>
              <h2 className="font-display text-base font-bold text-ink">3. Why is it needed?</h2>
              <p className="text-xs text-muted">
                Structured justification per policy §9 (Award Recommendation). Approvers read
                &ldquo;need&rdquo; and &ldquo;risk if not procured&rdquo; first.
              </p>
            </div>
            <Field label="Need description *" htmlFor="needDesc">
              <Textarea
                id="needDesc"
                value={needDesc}
                onChange={(e) => setNeedDesc(e.target.value)}
                rows={3}
                placeholder="What outcome does this deliver? Which team benefits and how?"
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Alternatives considered" htmlFor="alternatives">
                <Textarea
                  id="alternatives"
                  value={alternatives}
                  onChange={(e) => setAlternatives(e.target.value)}
                  rows={3}
                  placeholder="Vendors evaluated, in-house options ruled out, prior quotes."
                />
              </Field>
              <Field label="Risk if not procured" htmlFor="riskIfNot">
                <Textarea
                  id="riskIfNot"
                  value={riskIfNot}
                  onChange={(e) => setRiskIfNot(e.target.value)}
                  rows={3}
                  placeholder="Operational, compliance, patient-care, or revenue impact of doing nothing."
                />
              </Field>
            </div>
            <Field label="Additional context (optional)" htmlFor="description">
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Links to prior POs, PhilGEPS notices, delivery constraints…"
              />
            </Field>
          </section>

          {/* -------------- Line items -------------- */}
          <section className="card space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-bold text-ink">4. Line items</h2>
                <p className="text-xs text-muted">
                  Add each SKU / service / license with quantity + unit price. Estimated total updates live.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLines((prev) => [...prev, blankLine()])}
                className="btn-outline btn-sm"
              >
                <Icon name="plus" className="h-4 w-4" />
                Add line
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] table-fixed text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-faint">
                  <tr>
                    <th className="w-2/5 py-2 pr-3">Description</th>
                    <th className="w-16 py-2 pr-3">Qty</th>
                    <th className="w-20 py-2 pr-3">UoM</th>
                    <th className="w-24 py-2 pr-3">Unit ₱</th>
                    <th className="w-24 py-2 pr-3 text-right">Line ₱</th>
                    <th className="w-8" aria-hidden />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const q = toNumber(l.quantity) ?? 0;
                    const p = toNumber(l.unitPrice) ?? 0;
                    return (
                      <tr key={l.key} className="border-t border-line align-top">
                        <td className="py-2 pr-3">
                          <input
                            aria-label={`Line ${i + 1} description`}
                            className="input"
                            value={l.description}
                            onChange={(e) => updateLine(l.key, { description: e.target.value })}
                            placeholder="Enterprise seat — SFDC Sales Cloud"
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            aria-label={`Line ${i + 1} quantity`}
                            className="input"
                            type="number"
                            min="0"
                            step="1"
                            value={l.quantity}
                            onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            aria-label={`Line ${i + 1} unit of measure`}
                            className="input"
                            value={l.uom}
                            onChange={(e) => updateLine(l.key, { uom: e.target.value })}
                          />
                        </td>
                        <td className="py-2 pr-3">
                          <input
                            aria-label={`Line ${i + 1} unit price`}
                            className="input"
                            type="number"
                            min="0"
                            step="0.01"
                            value={l.unitPrice}
                            onChange={(e) => updateLine(l.key, { unitPrice: e.target.value })}
                            placeholder="0.00"
                          />
                        </td>
                        <td className="py-2 pr-3 text-right tnum font-semibold text-ink">
                          {(q * p).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td className="py-2">
                          <button
                            type="button"
                            onClick={() => removeLine(l.key)}
                            disabled={lines.length === 1}
                            aria-label={`Remove line ${i + 1}`}
                            className="grid h-8 w-8 place-items-center rounded-lg text-faint transition hover:bg-inset hover:text-rose-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-faint"
                          >
                            <Icon name="x" className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line">
                    <td colSpan={4} className="py-2 pr-3 text-right text-xs uppercase tracking-wide text-faint">
                      Estimated total
                    </td>
                    <td className="py-2 pr-3 text-right tnum text-base font-extrabold text-ink">
                      ₱{total.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          {/* -------------- Sourcing method -------------- */}
          <section className="card space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-bold text-ink">5. Sourcing path</h2>
                <p className="text-xs text-muted">
                  Suggested from category + estimated total. Override with justification if you must go direct.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <Badge tone="cyan">Suggested</Badge>
                <span className="font-semibold text-ink">
                  {sourcingMethodLabel(suggestedMethod)}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={emergency}
                  onChange={(e) => setEmergency(e.target.checked)}
                />
                Emergency purchase
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={repeat}
                  onChange={(e) => setRepeat(e.target.checked)}
                />
                Repeat order / continuity
              </label>
            </div>

            <Field label="Sourcing method" htmlFor="sourcing">
              <select
                id="sourcing"
                className="input"
                value={sourcingMethod || suggestedMethod}
                onChange={(e) => {
                  const v = e.target.value as SourcingMethod;
                  setSourcingMethod(v);
                  setSourcingOverride(v !== suggestedMethod);
                }}
              >
                {ALL_SOURCING.map((m) => (
                  <option key={m} value={m}>
                    {sourcingMethodLabel(m)}
                  </option>
                ))}
              </select>
            </Field>
            {sourcingOverride && (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                <Icon name="alert" className="mr-1 inline h-3.5 w-3.5" />
                You&apos;re overriding the suggested path. Explain why in the justification below —
                Procurement Head will review before approval.
              </p>
            )}

            {(effectiveSourcing === 'direct_award' || effectiveSourcing === 'emergency') && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Direct-award reason" htmlFor="daReason">
                  <select
                    id="daReason"
                    className="input"
                    value={directAwardReason}
                    onChange={(e) => setDirectAwardReason(e.target.value)}
                  >
                    <option value="">— pick a reason —</option>
                    <option value="sole_supplier">Sole supplier</option>
                    <option value="emergency">Emergency</option>
                    <option value="repeat_continuity">Repeat / continuity</option>
                    <option value="other">Other approved exception</option>
                  </select>
                </Field>
                <Field label="Price reasonableness note" htmlFor="priceReason">
                  <Input
                    id="priceReason"
                    value={priceReasonableness}
                    onChange={(e) => setPriceReasonableness(e.target.value)}
                    placeholder="Benchmark, prior PO, negotiated discount…"
                  />
                </Field>
              </div>
            )}

            {(effectiveSourcing === 'rfp' || effectiveSourcing === 'rfq') && (
              <Field label="PhilGEPS reference (if applicable)" htmlFor="philgeps">
                <Input
                  id="philgeps"
                  value={philgeps}
                  onChange={(e) => setPhilgeps(e.target.value)}
                  placeholder="e.g. PhilGEPS Notice 2026-04-123"
                />
              </Field>
            )}

            {minQuotes != null && (
              <p className="text-xs text-muted">
                <Icon name="info" className="mr-1 inline h-3.5 w-3.5" />
                Minimum of <strong>{minQuotes}</strong> comparable{' '}
                {effectiveSourcing === 'rfp' ? 'proposals' : 'quotations'} required for this path (policy §5).
              </p>
            )}
          </section>

          {/* -------------- Approval preview -------------- */}
          <section className="card space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-bold text-ink">6. Approval preview</h2>
                <p className="text-xs text-muted">
                  Derived from category, amount, and sourcing path (policy §3 + §9). Ladder is created on submit.
                </p>
              </div>
              <span className="text-xs text-faint">{ladder.length} step{ladder.length === 1 ? '' : 's'}</span>
            </div>
            <ol className="flex flex-wrap items-center gap-2 text-xs">
              {ladder.map((t, i) => (
                <li key={t} className="flex items-center gap-2">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-500/15 text-brand-700 dark:text-brand-300">
                    {i + 1}
                  </span>
                  <span className="font-semibold text-ink">{tierLabel(t)}</span>
                  {i < ladder.length - 1 && (
                    <Icon name="arrowRight" className="h-3.5 w-3.5 text-faint" />
                  )}
                </li>
              ))}
            </ol>
          </section>

          {/* -------------- Vendor -------------- */}
          <section className="card space-y-3 p-4 sm:p-5">
            <div>
              <h2 className="font-display text-base font-bold text-ink">7. Preferred vendor</h2>
              <p className="text-xs text-muted">
                Optional. Award is gated on accreditation (policy §7); Procurement can invite additional bidders.
              </p>
            </div>
            <Field label="Vendor" htmlFor="vendor">
              <select
                id="vendor"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                className="input"
              >
                <option value="">— none / open to bids —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.legalName}
                    {v.accreditationStatus !== 'approved'
                      ? ` · (${v.accreditationStatus})`
                      : ''}
                  </option>
                ))}
              </select>
            </Field>
          </section>

          {/* -------------- Attachments + doc checklist -------------- */}
          <section className="card space-y-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-bold text-ink">8. Attachments</h2>
                <p className="text-xs text-muted">
                  JPEG, PNG, WebP, or PDF up to 10 MB each. Same guards as Legal accreditation uploads.
                </p>
              </div>
              <label className="btn-outline btn-sm inline-flex cursor-pointer">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="sr-only"
                  disabled={uploading}
                  onChange={handleAttachmentPick}
                />
                <Icon name="plus" className="h-4 w-4" />
                {uploading ? 'Reading…' : 'Add file'}
              </label>
            </div>

            {attachments.length === 0 ? (
              <p className="text-sm text-muted">No files attached yet.</p>
            ) : (
              <ul className="space-y-2">
                {attachments.map((a, i) => (
                  <li
                    key={`${a.filename}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface p-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink" title={a.filename}>
                        {a.filename}
                      </p>
                      <p className="text-xs text-muted">
                        {(a.sizeBytes / 1024).toFixed(1)} KB · {a.mimeType}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      aria-label={`Remove ${a.filename}`}
                      className="grid h-8 w-8 place-items-center rounded-lg text-faint transition hover:bg-inset hover:text-rose-600"
                    >
                      <Icon name="x" className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="rounded-xl border border-dashed border-line bg-inset/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-faint">
                Required documents for {sourcingMethodLabel(effectiveSourcing)}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-muted">
                {requiredDocs.map((d) => (
                  <li key={d.key}>
                    <span className="font-semibold text-ink">{d.label}</span> — {d.why}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Link to="/" className="btn-ghost">
              Cancel
            </Link>
            <Button
              type="submit"
              variant="outline"
              disabled={submitting || !canSubmit}
            >
              {submitting ? 'Saving…' : 'Save draft'}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={submitting || !canSubmit}
              onClick={(e) => handleSubmit(e as unknown as FormEvent, true)}
            >
              {submitting ? 'Submitting…' : 'Save & submit for approval'}
            </Button>
          </div>
        </form>
      </div>
    </Guard>
  );
}
