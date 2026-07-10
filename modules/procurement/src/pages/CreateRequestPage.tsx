'use client';

// Create-request wizard — 3-step stepper (UX-REVIEW-FULL-APP.md PR-7 / J2-1,
// porting the legal invite wizard's house pattern):
//   1. What        — category, title, context, line items.
//   2. Codes & why — department, cost center, project/budget codes,
//                    needed-by, justification triple, attachments.
//   3. Sourcing & review — suggested sourcing + override, conditional
//                    compliance fields, ladder preview, vendor, required-docs
//                    checklist (live attached/missing state), submit.
//
// All wizard state lives in this component so moving between steps never
// loses input. The live approval-ladder preview + sourcing suggestion +
// required-documents preview from the single-page version survive on step 3.

import type { ChangeEvent, FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  Field,
  HeroChipButton,
  Icon,
  InfoTip,
  Input,
  ModuleHero,
  Textarea,
  useToast,
} from '@intra/ui';
import { Guard, useCan, useSession } from '@intra/auth';
import type {
  ImportationPlan,
  ProcurementExceptionPack,
  ProcurementRiskFacts,
  RequestAttachmentKind,
  RequestCategory,
  SourcingMethod,
} from '../types';
import { useProcurementRequests, useProcurementVendors } from '../localStore';
import {
  CATEGORY_META,
  buildApprovalLadder,
  deriveSourcingRecommendation,
  requiredDocumentsStatus,
  sourcingMethodLabel,
  tierLabel,
} from '../policy';
import { SourcingDecisionPanel } from '../components/SourcingDecisionPanel';
import { ExceptionPack } from '../components/ExceptionPack';
import { FinancialProtectionPanel } from '../components/FinancialProtectionPanel';
import { EvaluationMatrix, type EvaluationMatrixValue } from '../components/EvaluationMatrix';
import { ATTACHMENT_KIND_LABEL, accreditationLabel } from '../labels';
import {
  validateRequestAttachment,
  type PendingRequestAttachment,
} from '../attachments';

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

const KIND_OPTIONS: RequestAttachmentKind[] = [
  'spec',
  'budget',
  'previous_cost',
  'quote',
  'award_recommendation',
  'justification',
  'bond',
  'brochure',
  'other',
];

type StepN = 1 | 2 | 3;
const STEPS = [
  { n: 1 as StepN, label: 'What are you buying?' },
  { n: 2 as StepN, label: 'Codes & justification' },
  { n: 3 as StepN, label: 'Sourcing & review' },
] as const;

export function CreateRequestPage() {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const { add } = useProcurementRequests();
  const vendors = useProcurementVendors();
  const { profile } = useSession();
  const canConfirmRoute = useCan('procurement', 'manage_rfp');

  const [step, setStep] = useState<StepN>(1);

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
  const [routeConfirmed, setRouteConfirmed] = useState(false);
  const [riskFacts, setRiskFacts] = useState<ProcurementRiskFacts>({
    comparable: true,
    complex: false,
    technical: false,
    strategic: false,
    highRisk: false,
    dataSensitive: false,
    importation: false,
  });

  // Compliance flags
  const [philgeps, setPhilgeps] = useState('');
  const [directAwardReason, setDirectAwardReason] = useState('');
  const [priceReasonableness, setPriceReasonableness] = useState('');
  const [exceptionPack, setExceptionPack] = useState<ProcurementExceptionPack>({
    type: 'direct_award',
    justification: '',
    priceReasonableness: '',
    risksAndMitigations: '',
  });
  const [importationPlan, setImportationPlan] = useState<ImportationPlan>({
    incoterms: '',
    importerOfRecord: '',
    permitsAndRegistrations: '',
    customsBrokerAndLogistics: '',
    dutiesTaxesFreightInsurance: '',
    foreignPaymentTiming: '',
    deliveryAcceptanceAndWarranty: '',
  });
  const [evaluation, setEvaluation] = useState<EvaluationMatrixValue>({
    intendedResponses: 0,
    vendorsInvited: 0,
    responsesReceived: 0,
    insufficientBidsExceptionApproved: false,
  });

  const [attachments, setAttachments] = useState<PendingRequestAttachment[]>([]);

  const total = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const q = toNumber(l.quantity) ?? 0;
        const p = toNumber(l.unitPrice) ?? 0;
        return sum + q * p;
      }, 0),
    [lines],
  );

  const recommendation = useMemo(
    () =>
      deriveSourcingRecommendation({
        category: category || undefined,
        amount: total,
        emergency,
        repeat,
        ...riskFacts,
      }),
    [category, total, emergency, repeat, riskFacts],
  );
  const suggestedMethod = recommendation.method;

  // Keep the sourcing method in sync with the suggestion until the officer
  // explicitly overrides.
  useEffect(() => {
    if (!sourcingOverride) setSourcingMethod(suggestedMethod);
    setRouteConfirmed(false);
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

  // PR-19: the required-docs checklist reflects the actual attachments.
  const docsStatus = useMemo(
    () =>
      requiredDocumentsStatus(
        {
          category: category || undefined,
          amount: total,
          sourcingMethod: effectiveSourcing,
        },
        attachments,
      ),
    [category, total, effectiveSourcing, attachments],
  );
  const missingDocs = docsStatus.filter((d) => !d.attached);

  const step1Valid =
    title.trim().length > 0 &&
    category !== '' &&
    lines.some((l) => l.description.trim());
  const step2Valid = needDesc.trim().length > 0;
  const canSubmit = step1Valid && step2Valid;
  const exceptionRequired = ['direct_award', 'emergency', 'repeat_order', 'petty_cash'].includes(effectiveSourcing);
  const exceptionReady =
    !exceptionRequired ||
    (exceptionPack.justification.trim().length > 0 &&
      (effectiveSourcing === 'petty_cash'
        ? exceptionPack.financeEligibilityConfirmed === true &&
          exceptionPack.nonRecurringNonSplitAttested === true
        : (exceptionPack.priceReasonableness ?? priceReasonableness).trim().length > 0));
  const importationReady =
    !riskFacts.importation ||
    Object.values(importationPlan).every((value) => value.trim().length > 0);
  const routeEvidenceReady = exceptionReady && importationReady;

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));
  }

  function handleAttachmentPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    try {
      validateRequestAttachment(file);
      setAttachments((prev) => [
        ...prev,
        {
          file,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          uploadedByEmail: profile?.email,
          kind: 'other',
        },
      ]);
    } catch (err) {
      error(err instanceof Error ? err.message : 'Could not use the selected file.');
    }
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  function setAttachmentKind(idx: number, kind: RequestAttachmentKind) {
    setAttachments((prev) =>
      prev.map((a, i) => (i === idx ? { ...a, kind } : a)),
    );
  }

  function goNext() {
    if (step === 1 && !step1Valid) {
      error('Pick a category, give the request a title, and describe at least one line item.');
      return;
    }
    if (step === 2 && !step2Valid) {
      error('Describe the need — approvers read it first.');
      return;
    }
    setStep((s) => (s < 3 ? ((s + 1) as StepN) : s));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }

  function goBack() {
    setStep((s) => (s > 1 ? ((s - 1) as StepN) : s));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }

  async function handleSubmit(event: FormEvent, andSubmit = false) {
    event.preventDefault();
    if (!canSubmit) {
      error('Give the request a title, category, need description, and at least one line item.');
      return;
    }
    if (andSubmit && !routeConfirmed) {
      error('Save the draft for Procurement route confirmation before approval submission.');
      return;
    }
    // Explicit quantity guard — a line entered as 0 (or negative) must not
    // silently coerce to 1 on save.
    const invalidQtyLine = lines.find(
      (l) => l.description.trim() && l.quantity.trim() !== '' && !(Number(l.quantity) >= 1),
    );
    if (invalidQtyLine) {
      error('Each line quantity must be a whole number of at least 1.');
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
      const exceptionType: ProcurementExceptionPack['type'] =
        effectiveSourcing === 'emergency'
          ? 'emergency'
          : effectiveSourcing === 'repeat_order'
            ? 'repeat_continuity'
            : effectiveSourcing === 'petty_cash'
              ? 'petty_cash_non_accredited'
              : 'direct_award';

      const compliance: Parameters<typeof add>[0]['compliance'] = {
        philgepsReference: philgeps.trim() || undefined,
        priceReasonableness: priceReasonableness.trim() || undefined,
        vendorAccreditationRequired:
          effectiveSourcing !== 'petty_cash' && effectiveSourcing !== 'emergency',
        routeConfirmed,
        routeConfirmedByEmail: routeConfirmed ? profile?.email : undefined,
        policyVersion: 'procurement-policy-revised-2026',
        riskFacts,
        exceptionPack:
          ['direct_award', 'emergency', 'repeat_order', 'petty_cash'].includes(effectiveSourcing)
            ? { ...exceptionPack, type: exceptionType, priceReasonableness: priceReasonableness.trim() || exceptionPack.priceReasonableness }
            : undefined,
        importationPlan: riskFacts.importation ? importationPlan : undefined,
        intendedResponses: evaluation.intendedResponses || undefined,
        vendorsInvited: evaluation.vendorsInvited || undefined,
        responsesReceived: evaluation.responsesReceived || undefined,
        insufficientBidsExceptionApproved:
          evaluation.insufficientBidsExceptionApproved || undefined,
      };
      if (effectiveSourcing === 'direct_award' || effectiveSourcing === 'emergency') {
        const reason = (directAwardReason || 'other') as
          | 'sole_supplier'
          | 'emergency'
          | 'repeat_continuity'
          | 'other';
        compliance.directAwardReason = reason;
      }

      const created = await add({
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
          description="Three quick steps — the sourcing path and approval ladder preview themselves as you type."
          icon="cart"
          action={
            <HeroChipButton icon="x" href="/procurement">
              Cancel
            </HeroChipButton>
          }
        />

        {/* Compact stepper (legal invite-wizard house pattern) */}
        <ol className="flex items-center gap-1.5" aria-label="Request steps">
          {STEPS.map((s, i) => {
            const state = s.n === step ? 'current' : s.n < step ? 'done' : 'todo';
            return (
              <li key={s.n} className="flex min-w-0 flex-1 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => s.n < step && setStep(s.n)}
                  disabled={s.n >= step}
                  className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-2.5 py-2 text-left transition ${
                    state === 'current'
                      ? 'bg-brand-500/10'
                      : state === 'done'
                        ? 'hover:bg-inset'
                        : 'opacity-60'
                  }`}
                  aria-current={state === 'current' ? 'step' : undefined}
                >
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      state === 'done'
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : state === 'current'
                          ? 'bg-brand-600 text-white'
                          : 'bg-inset text-faint'
                    }`}
                  >
                    {state === 'done' ? <Icon name="check" className="h-3.5 w-3.5" /> : s.n}
                  </span>
                  <span
                    className={`hidden truncate text-xs font-semibold sm:block ${
                      state === 'current' ? 'text-brand-700 dark:text-brand-300' : 'text-muted'
                    }`}
                  >
                    {s.label}
                  </span>
                </button>
                {i < STEPS.length - 1 && (
                  <span aria-hidden className="h-px w-3 shrink-0 bg-line" />
                )}
              </li>
            );
          })}
        </ol>
        <p className="-mt-4 text-xs font-semibold text-brand-700 dark:text-brand-300 sm:hidden">
          Step {step} of 3 — {STEPS[step - 1]!.label}
        </p>

        <form className="space-y-6" onSubmit={(e) => handleSubmit(e, false)}>
          {/* ==================== STEP 1 — What ==================== */}
          {step === 1 && (
            <>
              <section className="card space-y-4 p-4 sm:p-5">
                <div>
                  <h2 className="font-display text-base font-bold text-ink">Category</h2>
                  <p className="text-xs text-muted">
                    Category drives sourcing path, approvers, and required documents.
                  </p>
                </div>
                <fieldset>
                  <legend className="sr-only">Category</legend>
                  {/* PR-10: compact 2-col chips at 390px; descriptions appear
                      from sm upward. */}
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                    {CATEGORY_META.map((c) => {
                      const active = category === c.code;
                      return (
                        <label
                          key={c.code}
                          className={[
                            'group flex cursor-pointer flex-col rounded-2xl border p-2.5 transition sm:p-3',
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
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="text-sm font-semibold leading-snug text-ink">
                              {c.label}
                            </span>
                            {c.highRisk && <Badge tone="amber">high-risk</Badge>}
                          </div>
                          <p className="mt-1 hidden text-xs text-muted sm:block">
                            {c.description}
                          </p>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              </section>

              <section className="card space-y-4 p-4 sm:p-5">
                <div>
                  <h2 className="font-display text-base font-bold text-ink">Title & context</h2>
                </div>
                <Field label="Title" htmlFor="title">
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Salesforce Enterprise seats — FY26"
                    required
                  />
                </Field>
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

              <section className="card space-y-3 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-base font-bold text-ink">Line items</h2>
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
                  <table className="w-full min-w-[720px] table-fixed text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-faint">
                      <tr>
                        <th className="w-2/5 py-2 pr-3">Description</th>
                        <th className="w-24 py-2 pr-3">Qty</th>
                        <th className="w-24 py-2 pr-3">UoM</th>
                        <th className="w-28 py-2 pr-3">Unit ₱</th>
                        <th className="w-24 py-2 pr-3 text-right">Line ₱</th>
                        <th className="w-12" aria-hidden />
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
                                inputMode="numeric"
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
                                inputMode="decimal"
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
                                className="grid h-11 w-11 place-items-center rounded-lg text-faint transition hover:bg-inset hover:text-rose-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-faint"
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
            </>
          )}

          {/* ============ STEP 2 — Codes & justification ============ */}
          {step === 2 && (
            <>
              <section className="card space-y-4 p-4 sm:p-5">
                <div>
                  <h2 className="font-display text-base font-bold text-ink">Who is it for?</h2>
                  <p className="text-xs text-muted">
                    Cost center + project/budget code so Finance can reconcile the spend.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Department" htmlFor="department">
                    <Input
                      id="department"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      placeholder="Marketing / IT / HR / …"
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

              <section className="card space-y-4 p-4 sm:p-5">
                <div>
                  <h2 className="flex items-center gap-1.5 font-display text-base font-bold text-ink">
                    Why is it needed?
                    <InfoTip
                      label="About the justification"
                      content="Structured justification per policy §9 (Award Recommendation). These sections render deterministically on the AR form."
                    />
                  </h2>
                  <p className="text-xs text-muted">
                    Approvers read &ldquo;need&rdquo; and &ldquo;risk if not procured&rdquo; first.
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
              </section>

              <section className="card space-y-3 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-base font-bold text-ink">Attachments</h2>
                    <p className="text-xs text-muted">
                      JPEG, PNG, WebP, or PDF up to 10 MB each. Tag each file so the
                      required-documents checklist can tick itself.
                    </p>
                  </div>
                  <label className="btn-outline btn-sm inline-flex cursor-pointer">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="sr-only"
                      onChange={handleAttachmentPick}
                    />
                    <Icon name="plus" className="h-4 w-4" />
                    Add file
                  </label>
                </div>

                {attachments.length === 0 ? (
                  <p className="text-sm text-muted">No files attached yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {attachments.map((a, i) => (
                      <li
                        key={`${a.filename}-${i}`}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-ink" title={a.filename}>
                            {a.filename}
                          </p>
                          <p className="text-xs text-muted">
                            {(a.sizeBytes / 1024).toFixed(1)} KB · {a.mimeType}
                          </p>
                        </div>
                        <select
                          aria-label={`Document type for ${a.filename}`}
                          className="input w-auto text-xs"
                          value={a.kind ?? 'other'}
                          onChange={(e) =>
                            setAttachmentKind(i, e.target.value as RequestAttachmentKind)
                          }
                        >
                          {KIND_OPTIONS.map((k) => (
                            <option key={k} value={k}>
                              {ATTACHMENT_KIND_LABEL[k]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeAttachment(i)}
                          aria-label={`Remove ${a.filename}`}
                          className="grid h-11 w-11 place-items-center rounded-lg text-faint transition hover:bg-inset hover:text-rose-600"
                        >
                          <Icon name="x" className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          {/* ============ STEP 3 — Sourcing & review ============ */}
          {step === 3 && (
            <>
              <section className="card space-y-3 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-base font-bold text-ink">Sourcing path</h2>
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

                <SourcingDecisionPanel
                  riskFacts={riskFacts}
                  onRiskFactsChange={(value) => {
                    setRiskFacts(value);
                    setRouteConfirmed(false);
                  }}
                  recommendation={recommendation}
                  value={effectiveSourcing}
                  onChange={(method) => {
                    setSourcingMethod(method);
                    setSourcingOverride(method !== suggestedMethod);
                    setRouteConfirmed(false);
                  }}
                  canConfirm={canConfirmRoute}
                  confirmed={routeConfirmed}
                />
                {canConfirmRoute && !routeConfirmed && (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!routeEvidenceReady}
                    onClick={() => setRouteConfirmed(true)}
                  >
                    <Icon name="check" className="h-4 w-4" />
                    Confirm sourcing route
                  </button>
                )}
                {!routeEvidenceReady && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">Complete the applicable exception and importation controls before Procurement confirms this route.</p>
                )}
                {sourcingOverride && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    <Icon name="alert" className="mr-1 inline h-3.5 w-3.5" />
                    You&apos;re overriding the suggested path. Explain why in the justification —
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

                {['direct_award', 'emergency', 'repeat_order', 'petty_cash'].includes(effectiveSourcing) && (
                  <ExceptionPack method={effectiveSourcing} value={exceptionPack} onChange={setExceptionPack} />
                )}

                {riskFacts.importation && (
                  <section className="space-y-3 rounded-lg border border-line p-4">
                    <div><h3 className="font-semibold text-ink">Importation plan</h3><p className="text-xs text-muted">Importation adds landed-cost, logistics, permit, and payment controls but does not automatically force RFP.</p></div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {([
                        ['incoterms', 'Incoterms / shipping terms'],
                        ['importerOfRecord', 'Importer of record'],
                        ['permitsAndRegistrations', 'Permits, licenses, and registrations'],
                        ['customsBrokerAndLogistics', 'Customs broker and logistics'],
                        ['dutiesTaxesFreightInsurance', 'Duties, taxes, freight, insurance, storage, FX, and bank charges'],
                        ['foreignPaymentTiming', 'Foreign payment timing and protection'],
                        ['deliveryAcceptanceAndWarranty', 'Delivery, acceptance, commissioning, defects, and warranty'],
                      ] as const).map(([key, label]) => (
                        <label key={key} className="text-sm font-semibold text-ink">{label}<textarea rows={3} className="input mt-1.5" value={importationPlan[key]} onChange={(event) => setImportationPlan({ ...importationPlan, [key]: event.target.value })} /></label>
                      ))}
                    </div>
                  </section>
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

                {(effectiveSourcing === 'rfp' || effectiveSourcing === 'rfq') && (
                  <EvaluationMatrix
                    value={evaluation}
                    onChange={setEvaluation}
                    readOnly={!canConfirmRoute}
                  />
                )}
              </section>

              <section className="card space-y-3 p-4 sm:p-5">
                <div><h2 className="font-display text-base font-bold text-ink">Financial protection review</h2><p className="text-xs text-muted">Policy triggers are shown before award so bonds, insurance, or SBLC evidence is not discovered after work starts.</p></div>
                <FinancialProtectionPanel category={category || undefined} amount={total} importation={riskFacts.importation} />
              </section>

              <section className="card space-y-3 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="flex items-center gap-1.5 font-display text-base font-bold text-ink">
                      Approval preview
                      <InfoTip
                        label="How the ladder is derived"
                        content="Derived from category, amount, and sourcing path (policy §3 + §9). The ladder is created when you submit."
                      />
                    </h2>
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

              <section className="card space-y-3 p-4 sm:p-5">
                <div>
                  <h2 className="font-display text-base font-bold text-ink">Preferred vendor</h2>
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
                          ? ` — ${accreditationLabel(v.accreditationStatus)}`
                          : ''}
                      </option>
                    ))}
                  </select>
                </Field>
              </section>

              <section className="card space-y-3 p-4 sm:p-5">
                <div>
                  <h2 className="font-display text-base font-bold text-ink">
                    Required documents for {sourcingMethodLabel(effectiveSourcing)}
                  </h2>
                  <p className="text-xs text-muted">
                    Matched live against the files you attached on step 2.
                  </p>
                </div>
                <ul className="space-y-2 text-sm">
                  {docsStatus.map((d) => (
                    <li key={d.key} className="flex items-start gap-2">
                      {d.attached ? (
                        <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
                      ) : (
                        <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-ink">
                          {d.label}{' '}
                          <Badge tone={d.attached ? 'emerald' : 'amber'}>
                            {d.attached ? 'attached' : 'missing'}
                          </Badge>
                        </p>
                        <p className="text-xs text-muted">{d.why}</p>
                      </div>
                    </li>
                  ))}
                </ul>
                {missingDocs.length > 0 && (
                  <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                    <Icon name="alert" className="mr-1 inline h-3.5 w-3.5" />
                    {missingDocs.length} required document{missingDocs.length === 1 ? '' : 's'} not
                    attached yet — approvers will see {missingDocs.length === 1 ? 'it' : 'them'} flagged
                    as missing on the request.
                  </p>
                )}
              </section>
            </>
          )}

          {/* Sticky wizard footer — Continue / Back / Save / Submit. */}
          <div className="sticky bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-app/95 px-1 py-3 backdrop-blur md:bottom-0">
            {step > 1 ? (
              <button type="button" onClick={goBack} className="btn-ghost">
                Back
              </button>
            ) : (
              <Link to="/" className="btn-ghost">
                Cancel
              </Link>
            )}
            {step < 3 ? (
              // Stays enabled and explains itself via toast when a step is
              // incomplete (dead-disabled buttons were a J2-4 complaint).
              <Button type="button" variant="primary" onClick={goNext}>
                Continue
                <Icon name="arrowRight" className="h-4 w-4" />
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" variant="outline" disabled={submitting || !canSubmit}>
                  {submitting ? 'Saving…' : 'Save draft'}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={submitting || !canSubmit || !routeConfirmed}
                  onClick={(e) => handleSubmit(e as unknown as FormEvent, true)}
                >
                  {submitting
                    ? 'Submitting…'
                    : routeConfirmed
                      ? 'Save & submit for approval'
                      : 'Awaiting Procurement routing'}
                </Button>
              </div>
            )}
          </div>
        </form>
      </div>
    </Guard>
  );
}
