'use client';

// Sign-instrument page (T1.4) — route `/cases/:id/sign/:code`.
//
// Renders the legal instrument template (body paragraphs + version), any
// pre-signature disclosure fields, then the shared SignaturePad. Confirm is
// disabled until every required field is answered AND a valid signature is
// present. Vendors sign; Legal reviewers get a read-only view of the signed
// record (or the unsigned template).

import { useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  Badge,
  Card,
  HeroChipButton,
  Icon,
  ModuleHero,
  SectionTitle,
  SignaturePad,
  useToast,
  type SignaturePayload,
} from '@intra/ui';
import { useSession } from '@intra/auth';
import type { InstrumentField, SignedInstrument } from '../types';
import { resolveInstrument } from '../requirements/instruments';
import {
  useAccreditationCases,
  useChecklist,
  useSignedInstruments,
} from '../localStore';

export function SignInstrumentPage() {
  const { id = '', code = '' } = useParams();
  const navigate = useNavigate();
  const { profile } = useSession();
  const { success, error } = useToast();
  const { getById, loading: casesLoading } = useAccreditationCases();
  const { forCase: checklistForCase } = useChecklist();
  const { findSigned, sign } = useSignedInstruments();

  const kase = getById(id);
  const template = useMemo(() => resolveInstrument(code), [code]);
  const checklistItem = useMemo(
    () =>
      checklistForCase(id).find(
        (i) => i.instrumentCode === code || i.code === code,
      ),
    [checklistForCase, id, code],
  );
  const existing: SignedInstrument | undefined = findSigned(id, code);

  const isVendor = profile?.kind === 'vendor';
  const backPath = isVendor ? `/cases/${id}` : `/cases/${id}`;

  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [signature, setSignature] = useState<SignaturePayload | null>(null);
  const [busy, setBusy] = useState(false);

  if (casesLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="h-40 animate-pulse rounded-3xl bg-inset" />
        <div className="h-64 animate-pulse rounded-2xl bg-inset" />
      </div>
    );
  }
  if (!kase || !template) return <Navigate to="/" replace />;

  const fields = template.fields ?? [];
  const requiredFieldsOk = fields.every(
    (f) => !f.required || (fieldValues[f.name] ?? '').trim().length > 0,
  );
  const canSign = isVendor && !existing;
  const confirmEnabled = Boolean(signature) && requiredFieldsOk && !busy;

  function setField(name: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [name]: value }));
  }

  function confirm() {
    if (!signature || !template || !kase) return;
    if (!requiredFieldsOk) {
      error('Answer the required disclosure questions before signing.');
      return;
    }
    setBusy(true);
    try {
      sign({
        caseId: kase.id,
        code,
        templateVersion: template.version,
        signerName: signature.signerName,
        signerEmail: profile?.email,
        signaturePng: signature.dataUrl,
        signatureMethod: signature.method,
        signerUa: signature.userAgent,
        fields: fields.length > 0 ? { ...fieldValues } : undefined,
      });
      success(`${template.label} signed`);
      navigate(backPath);
    } catch (e) {
      error(e instanceof Error ? e.message : 'Could not save the signature.');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ModuleHero
        eyebrow={`${kase.vendorName} · v${template.version}`}
        title={template.label}
        description={template.summary}
        icon="signature"
        action={
          <HeroChipButton href={isVendor ? `/vendor/cases/${id}` : `/legal/cases/${id}`} icon="arrowRight">
            Back to case
          </HeroChipButton>
        }
        accessory={
          <div>
            <p className="text-xs uppercase tracking-wide text-brand-100/70">Status</p>
            <p className="mt-1">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold text-white">
                <span
                  aria-hidden
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    existing ? 'bg-emerald-300' : 'bg-amber-300'
                  }`}
                />
                {existing ? 'Signed' : 'Awaiting signature'}
              </span>
            </p>
          </div>
        }
      />

      <div>
        <SectionTitle
          title="Agreement text"
          subtitle={`Template version ${template.version}. The version you sign is snapshotted on the record.`}
        />
        <Card>
          <div className="space-y-3 text-sm leading-relaxed text-ink">
            {template.body.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
          {checklistItem?.whyWeNeedIt && (
            <p className="mt-4 rounded-xl bg-inset px-3 py-2 text-xs text-muted">
              <Icon name="info" className="mr-1 inline h-3.5 w-3.5" />
              Why we need this: {checklistItem.whyWeNeedIt}
            </p>
          )}
        </Card>
      </div>

      {existing ? (
        <div>
          <SectionTitle
            title="Signed record"
            subtitle="Legally-binding electronic signature (RA 8792, DocuSign-equivalent intent)."
          />
          <Card>
            {existing.fields && Object.keys(existing.fields).length > 0 && (
              <dl className="mb-4 space-y-2 border-b border-line pb-4 text-sm">
                {fields.map((f) =>
                  existing.fields?.[f.name] ? (
                    <div key={f.name}>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-faint">
                        {f.label}
                      </dt>
                      <dd className="mt-0.5 whitespace-pre-line text-ink">
                        {existing.fields[f.name]}
                      </dd>
                    </div>
                  ) : null,
                )}
              </dl>
            )}
            <SignedRecord record={existing} />
          </Card>
        </div>
      ) : canSign ? (
        <>
          {fields.length > 0 && (
            <div>
              <SectionTitle
                title="Disclosures"
                subtitle="Answer before signing — your answers are stored on the signed record."
              />
              <Card>
                <div className="space-y-4">
                  {fields.map((f) => (
                    <DisclosureField
                      key={f.name}
                      field={f}
                      value={fieldValues[f.name] ?? ''}
                      onChange={(v) => setField(f.name, v)}
                    />
                  ))}
                </div>
              </Card>
            </div>
          )}

          <div>
            <SectionTitle
              title="Sign"
              subtitle="Draw or type your signature. This carries the same intent as a wet signature."
            />
            <Card>
              <SignaturePad
                defaultSignerName={profile?.name ?? ''}
                onChange={setSignature}
              />
              <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
                <Link to={`/cases/${id}`} className="btn-ghost">
                  Cancel
                </Link>
                <button
                  type="button"
                  onClick={confirm}
                  disabled={!confirmEnabled}
                  className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Icon name="signature" className="h-4 w-4" />
                  {busy ? 'Saving…' : `Confirm & sign ${template.label}`}
                </button>
              </div>
            </Card>
          </div>
        </>
      ) : (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-800 dark:text-amber-300">
              <Icon name="info" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-ink">Awaiting vendor signature</p>
              <p className="mt-0.5 text-sm text-muted">
                This instrument is signed by the vendor from their portal. The
                signed record will appear here once captured.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function DisclosureField({
  field,
  value,
  onChange,
}: {
  field: InstrumentField;
  value: string;
  onChange: (value: string) => void;
}) {
  if (field.kind === 'yesno') {
    return (
      <fieldset>
        <legend className="text-sm font-semibold text-ink">
          {field.label}
          {field.required && <span className="ml-1 text-rose-600">*</span>}
        </legend>
        <div className="mt-2 flex gap-2">
          {(['yes', 'no'] as const).map((opt) => (
            <label
              key={opt}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition ${
                value === opt
                  ? 'border-brand-500 bg-brand-500/10 text-brand-700 dark:text-brand-300'
                  : 'border-line text-muted hover:text-ink'
              }`}
            >
              <input
                type="radio"
                name={field.name}
                value={opt}
                checked={value === opt}
                onChange={() => onChange(opt)}
                className="sr-only"
              />
              {opt === 'yes' ? 'Yes' : 'No'}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  const id = `disc-${field.name}`;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {field.label}
        {field.required && <span className="ml-1 text-rose-600">*</span>}
      </label>
      {field.kind === 'textarea' ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="input mt-1.5"
          placeholder={field.placeholder}
        />
      ) : (
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input mt-1.5"
          placeholder={field.placeholder}
        />
      )}
    </div>
  );
}

/** Shared render of a captured signed-instrument record. */
export function SignedRecord({ record }: { record: SignedInstrument }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
          <Icon name="signature" className="h-4 w-4 text-brand-600 dark:text-brand-300" />
          e-signed by {record.signerName}
          <Badge tone="emerald">v{record.templateVersion}</Badge>
        </p>
        <p className="text-xs text-muted">
          {new Date(record.signedAt).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
          {record.signerEmail ? ` · ${record.signerEmail}` : ''}
          {' · '}
          <span className="uppercase tracking-wide">{record.signatureMethod}</span>
        </p>
        <p className="line-clamp-2 text-[0.68rem] text-faint" title={record.signerUa}>
          {record.signerUa}
        </p>
      </div>
      <div className="shrink-0 rounded-xl border border-line bg-white p-2">
        <img
          src={record.signaturePng}
          alt={`Signature of ${record.signerName}`}
          className="h-14 w-48 object-contain"
        />
      </div>
    </div>
  );
}
