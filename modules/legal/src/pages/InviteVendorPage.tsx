"use client";

// Invite wizard (T1) — three steps:
//   1. Vendor identity (company, email, jurisdiction, entity type, category)
//   2. Risk profile (risk tier, contract type, spend band, personal data)
//   3. Preview of the auto-tailored requirement checklist + signable
//      instruments, then send.
//
// The preview and the seeded checklist share the same policy engine
// (requirements/policy.ts), so what Legal sees on step 3 is exactly what the
// vendor receives.

import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  Field,
  HeroChipButton,
  Icon,
  InfoTip,
  Input,
  ModuleHero,
  useToast,
} from "@intra/ui";
import { Guard, useSession } from "@intra/auth";
import {
  CONTRACT_TYPE_LABEL,
  ENTITY_TYPE_LABEL,
  JURISDICTION_LABEL,
  RISK_TIER_LABEL,
  SPEND_BAND_LABEL,
  VENDOR_CATEGORY_LABEL,
  type ContractType,
  type EntityType,
  type Jurisdiction,
  type RequirementGroup,
  type RiskTier,
  type SpendBand,
  type VendorCategory,
} from "../types";
import {
  DEFAULT_TAILORING_PROFILE,
  tailorRequirements,
  type TailoringProfile,
} from "../requirements/policy";
import { groupLabel, groupOrderIndex } from "../caseLogic";
import { useAccreditationCases, useVendorInvites } from "../localStore";

const STEPS = [
  { n: 1, label: "Vendor identity" },
  { n: 2, label: "Risk profile" },
  { n: 3, label: "Review & send" },
] as const;

export function InviteVendorPage() {
  const navigate = useNavigate();
  const { profile: session, mode } = useSession();
  const { toast, success, error } = useToast();
  const { invite } = useVendorInvites();
  const { addCase } = useAccreditationCases();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [tailoring, setTailoring] = useState<TailoringProfile>(
    DEFAULT_TAILORING_PROFILE,
  );
  const [originCountry, setOriginCountry] = useState("");
  const [busy, setBusy] = useState(false);
  const inviteAttemptKey = useRef(
    globalThis.crypto?.randomUUID?.() ?? `vendor-invite-${Date.now()}`,
  );
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );
  // Step-3 preview groups collapse to their count line by default (§2.4) so
  // the review step stays a short scroll at 390px.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const patch = <K extends keyof TailoringProfile>(
    key: K,
    value: TailoringProfile[K],
  ) => setTailoring((p) => ({ ...p, [key]: value }));

  // Live-tailored preview (step 3). Grouped in canonical group order.
  const tailored = useMemo(() => tailorRequirements(tailoring), [tailoring]);
  const grouped = useMemo(() => {
    const map = new Map<string, typeof tailored>();
    for (const def of tailored) {
      const list = map.get(def.group);
      if (list) list.push(def);
      else map.set(def.group, [def]);
    }
    return [...map.entries()].sort(
      (a, b) =>
        groupOrderIndex(a[0] as RequirementGroup) -
        groupOrderIndex(b[0] as RequirementGroup),
    );
  }, [tailored]);
  const requiredCount = tailored.filter((d) => d.required).length;
  const instruments = tailored.filter((d) => d.instrument);

  const identityValid =
    companyName.trim().length > 0 &&
    /\S+@\S+\.\S+/.test(email.trim()) &&
    (tailoring.jurisdiction !== "OTHER" || originCountry.trim().length > 0);

  function next() {
    if (step === 1 && !identityValid) {
      setValidationMessage(
        "Fill in the company, a valid email, and the jurisdiction first.",
      );
      return;
    }
    setValidationMessage(null);
    setStep((s) => (s < 3 ? ((s + 1) as 2 | 3) : s));
  }

  async function submit() {
    if (!identityValid) {
      setValidationMessage(
        "Company name and a valid contact email are required.",
      );
      setStep(1);
      return;
    }
    setValidationMessage(null);
    setBusy(true);
    try {
      const inv = await invite({
        email: email.trim(),
        companyName: companyName.trim(),
        category: VENDOR_CATEGORY_LABEL[tailoring.category],
        actor: session?.email,
        profile: tailoring,
        originCountry: originCountry.trim() || undefined,
        idempotencyKey: inviteAttemptKey.current,
      });
      const kase = inv.caseId
        ? { id: inv.caseId }
        : await addCase(
            inv.vendorId ?? `ven-${inv.id}`,
            companyName.trim(),
            VENDOR_CATEGORY_LABEL[tailoring.category],
            session?.email,
            {
              profile: tailoring,
              originCountry: originCountry.trim() || undefined,
              contactEmail: email.trim(),
            },
          );
      if (inv.deliveryStatus === "delivery_failed") {
        toast(
          `Case opened, but the invitation email was not delivered. Verify the address before resending.`,
          "info",
        );
      } else if (inv.deliveryStatus === "pending_delivery") {
        toast(
          "This invitation is already being sent. The existing vendor case was opened.",
          "info",
        );
      } else {
        success(
          `Invite sent — ${tailored.length} tailored requirements opened for ${companyName.trim()}`,
        );
      }
      navigate(`/cases/${kase.id}`);
    } catch (e) {
      error(e instanceof Error ? e.message : "Could not send the invite.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Guard module="legal" cap="manage_checklist">
      <div className="mx-auto max-w-2xl space-y-4 sm:space-y-6">
        <ModuleHero
          eyebrow="Invite vendor"
          title="Onboard a new vendor"
          description="The accreditation checklist tailors itself from your answers."
          icon="building"
          className="p-4 sm:p-6"
          action={
            <HeroChipButton href="/legal" icon="arrowRight">
              Back to cases
            </HeroChipButton>
          }
        />

        {/* Compact stepper */}
        <ol
          className="hidden items-center gap-1.5 sm:flex"
          aria-label="Invite steps"
        >
          {STEPS.map((s, i) => {
            const state =
              s.n === step ? "current" : s.n < step ? "done" : "todo";
            return (
              <li
                key={s.n}
                className="flex min-w-0 flex-1 items-center gap-1.5"
              >
                <button
                  type="button"
                  onClick={() => s.n < step && setStep(s.n as 1 | 2)}
                  disabled={s.n >= step}
                  className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-2.5 py-2 text-left transition ${
                    state === "current"
                      ? "bg-brand-500/10"
                      : state === "done"
                        ? "hover:bg-inset"
                        : "opacity-60"
                  }`}
                  aria-current={state === "current" ? "step" : undefined}
                >
                  <span
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      state === "done"
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : state === "current"
                          ? "bg-brand-600 text-white"
                          : "bg-inset text-faint"
                    }`}
                  >
                    {state === "done" ? (
                      <Icon name="check" className="h-3.5 w-3.5" />
                    ) : (
                      s.n
                    )}
                  </span>
                  <span
                    className={`hidden truncate text-xs font-semibold sm:block ${
                      state === "current"
                        ? "text-brand-700 dark:text-brand-300"
                        : "text-muted"
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
        <p className="-mt-2 text-xs font-semibold text-brand-700 dark:text-brand-300 sm:hidden">
          Step {step} of 3 — {STEPS[step - 1]!.label}
        </p>

        {step === 1 && (
          <Card>
            <div className="space-y-4">
              <Field label="Company name" htmlFor="companyName">
                <Input
                  id="companyName"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Acme Medical Supplies, Inc."
                  required
                />
              </Field>
              <Field label="Vendor contact email" htmlFor="email">
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ops@acme.com"
                  required
                />
              </Field>
              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <SelectField
                  id="jurisdiction"
                  label="Jurisdiction"
                  value={tailoring.jurisdiction}
                  onChange={(v) => patch("jurisdiction", v as Jurisdiction)}
                  options={JURISDICTION_LABEL}
                />
                <SelectField
                  id="entityType"
                  label="Entity type"
                  value={tailoring.entityType}
                  onChange={(v) => patch("entityType", v as EntityType)}
                  options={ENTITY_TYPE_LABEL}
                />
              </div>
              {tailoring.jurisdiction === "OTHER" && (
                <Field label="Country of registration" htmlFor="originCountry">
                  <Input
                    id="originCountry"
                    value={originCountry}
                    onChange={(e) => setOriginCountry(e.target.value)}
                    placeholder="e.g. Australia"
                    required
                  />
                </Field>
              )}
              <SelectField
                id="vendorCategory"
                label="Vendor category"
                value={tailoring.category}
                onChange={(v) => patch("category", v as VendorCategory)}
                options={VENDOR_CATEGORY_LABEL}
                hint="Drives sector permits (FDA, PCAB, DOLE D.O. 174, ISO)."
              />
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <div className="space-y-4">
              <SelectField
                id="riskTier"
                label="Risk tier"
                value={tailoring.riskTier}
                onChange={(v) => patch("riskTier", v as RiskTier)}
                options={RISK_TIER_LABEL}
                hint="High risk triggers the Enhanced Due Diligence pack (§7)."
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  id="contractType"
                  label="Contract type"
                  value={tailoring.contractType}
                  onChange={(v) => patch("contractType", v as ContractType)}
                  options={CONTRACT_TYPE_LABEL}
                />
                <SelectField
                  id="spendBand"
                  label="Expected annual spend"
                  value={tailoring.spendBand}
                  onChange={(v) => patch("spendBand", v as SpendBand)}
                  options={SPEND_BAND_LABEL}
                  hint="Bonds & insurance kick in above ₱1M (§12)."
                />
              </div>
              <label className="flex items-start gap-2.5 rounded-xl border border-line bg-inset/50 p-3 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={tailoring.handlesPersonalData}
                  onChange={(e) =>
                    patch("handlesPersonalData", e.target.checked)
                  }
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold">
                    Vendor will handle personal data
                  </span>
                  <span className="block text-xs text-muted">
                    Adds the NPC registration + Data Processing Agreement (RA
                    10173 / GDPR) to the checklist.
                  </span>
                </span>
              </label>
            </div>
          </Card>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-display text-base font-bold text-ink">
                    {companyName || "Vendor"}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {email} · {JURISDICTION_LABEL[tailoring.jurisdiction]}
                    {tailoring.jurisdiction === "OTHER" && originCountry
                      ? ` (${originCountry})`
                      : ""}{" "}
                    · {ENTITY_TYPE_LABEL[tailoring.entityType]} ·{" "}
                    {VENDOR_CATEGORY_LABEL[tailoring.category]}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge
                    tone={
                      tailoring.riskTier === "high"
                        ? "rose"
                        : tailoring.riskTier === "medium"
                          ? "amber"
                          : "emerald"
                    }
                  >
                    {RISK_TIER_LABEL[tailoring.riskTier]} risk
                  </Badge>
                  <Badge tone="brand">
                    {SPEND_BAND_LABEL[tailoring.spendBand]}
                  </Badge>
                  {tailoring.handlesPersonalData && (
                    <Badge tone="cyan">personal data</Badge>
                  )}
                </div>
              </div>
              <p className="mt-3 rounded-xl bg-inset px-3 py-2 text-sm text-muted">
                <span className="font-semibold text-ink">
                  {tailored.length} requirements
                </span>{" "}
                will be requested ({requiredCount} required,{" "}
                {instruments.length} signable instruments).
              </p>
            </Card>

            {grouped.map(([group, defs]) => {
              const open = openGroups[group] ?? false;
              const gRequired = defs.filter((d) => d.required).length;
              const gInstruments = defs.filter((d) => d.instrument).length;
              return (
                <Card key={group}>
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() =>
                      setOpenGroups((cur) => ({ ...cur, [group]: !open }))
                    }
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon
                        name="chevron"
                        className={`h-3.5 w-3.5 shrink-0 text-faint transition ${open ? "rotate-90" : ""}`}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-display text-sm font-bold text-ink">
                          {groupLabel(group as RequirementGroup)}
                        </span>
                        <span className="block text-xs text-muted">
                          {defs.length} requirement
                          {defs.length === 1 ? "" : "s"}, {gRequired} required
                          {gInstruments > 0
                            ? ` · ${gInstruments} signable`
                            : ""}
                        </span>
                      </span>
                    </span>
                    <Badge tone="slate">
                      {gRequired}/{defs.length} required
                    </Badge>
                  </button>
                  {open && (
                    <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
                      {defs.map((d) => (
                        <li
                          key={d.code}
                          className="flex items-start gap-2 text-sm text-ink"
                        >
                          <Icon
                            name={d.instrument ? "signature" : "clipboard"}
                            className={`mt-0.5 h-4 w-4 shrink-0 ${
                              d.instrument
                                ? "text-brand-600 dark:text-brand-300"
                                : "text-faint"
                            }`}
                          />
                          <span className="min-w-0">
                            {d.label}
                            {!d.required && (
                              <>
                                {" "}
                                <span className="ml-1 whitespace-nowrap text-xs text-faint">
                                  optional
                                </span>
                              </>
                            )}
                            {d.instrument && (
                              <>
                                {" "}
                                <span className="ml-1 whitespace-nowrap text-xs font-semibold text-brand-700 dark:text-brand-300">
                                  sign in-browser
                                </span>
                              </>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {validationMessage && (
          <div
            role="alert"
            className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-800 dark:text-rose-200"
          >
            {validationMessage}
          </div>
        )}

        <div
          data-mobile-action-bar="true"
          className="flex flex-col-reverse gap-2 rounded-lg border border-line bg-surface p-3 shadow-e1 sm:flex-row sm:items-center sm:justify-between"
        >
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as 1 | 2)}
              className="btn-ghost min-h-11 w-full sm:w-auto"
            >
              Back
            </button>
          ) : (
            <Link to="/" className="btn-ghost min-h-11 w-full sm:w-auto">
              Cancel
            </Link>
          )}
          {step < 3 ? (
            <Button
              className="min-h-11 w-full sm:w-auto"
              type="button"
              variant="primary"
              onClick={next}
            >
              Continue
              <Icon name="arrowRight" className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              onClick={submit}
              disabled={busy}
              className="min-h-11 w-full sm:w-auto"
            >
              <Icon name="plus" className="h-4 w-4" />
              {busy ? "Sending…" : "Send invite & open case"}
            </Button>
          )}
        </div>

        {mode === "memory" && (
          <p className="flex items-center gap-1 text-xs text-muted">
            <span className="chip bg-amber-500/15 text-amber-800 dark:text-amber-300">
              Demo
            </span>
            <InfoTip
              label="About demo invites"
              content="No email is sent in local demo mode. The invited address is available only inside this browser session."
            />
          </p>
        )}
      </div>
    </Guard>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Readonly<Record<string, string>>;
  hint?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-semibold uppercase tracking-wide text-faint"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input"
      >
        {Object.entries(options).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
