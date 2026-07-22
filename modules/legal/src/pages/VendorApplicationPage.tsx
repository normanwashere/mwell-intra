'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
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
import type {
  AccreditationFieldDisposition,
  EntityType,
  VendorApplicationSnapshot,
  VendorCompanyDetails,
} from '../types';
import {
  buildV2025Checklist,
  validateV2025Application,
  VENDOR_ACCREDITATION_V2025,
} from '../requirements/vendorAccreditationV2025';
import { useAccreditationCases, useVendorAliases } from '../localStore';
import { shouldBlockVendorAccess } from '../vendorAccess';
import { TechnologyQualificationForm } from '../components/TechnologyQualificationForm';
import { AccreditationDeclaration } from '../components/AccreditationDeclaration';
import { createVendorApplicationDraftRepository, type LegalDraftClient } from '../vendorApplicationDraft';
type SupportedEntity = Extract<EntityType, 'corporation' | 'sole_prop' | 'partnership'>;

function supportedEntity(value: EntityType | undefined): SupportedEntity {
  return value === 'sole_prop' || value === 'partnership' ? value : 'corporation';
}

function blankApplication(entityType: SupportedEntity, vendorName: string): VendorApplicationSnapshot {
  return {
    policyVersion: 'vendor-accreditation-v2025',
    entityType,
    jurisdiction: 'PH',
    company: {
      tradeName: vendorName,
      contactNumber: '',
      businessAddress: '',
      incorporationDate: '',
      incorporationPlace: '',
      tin: '',
      email: '',
      website: '',
      fax: '',
      principalName: '',
      principalEmail: '',
      principalContactNumber: '',
      correspondenceName: '',
      correspondenceEmail: '',
      correspondenceContactNumber: '',
      productsOrServices: '',
      businessType: entityType,
    },
    manpower: {
      countAndExpertise: '',
      qualifications: '',
      completedProjects: '',
    },
    technologyServiceProvider: false,
    technologyQualifications: [],
    fieldDispositions: {},
    declaration: {
      accepted: false,
      noLegalActions: true,
      disclosureDetails: '',
      verificationAuthorized: false,
      signerName: '',
      signerTitle: '',
      signedAt: '',
    },
  };
}

const COMPANY_FIELDS: Array<{
  key: keyof VendorCompanyDetails;
  label: string;
  type?: 'text' | 'email' | 'date' | 'url' | 'textarea';
  allowNa?: boolean;
}> = [
  { key: 'tradeName', label: 'Company trade name' },
  { key: 'contactNumber', label: 'Company contact number' },
  { key: 'businessAddress', label: 'Business address', type: 'textarea' },
  {
    key: 'incorporationDate',
    label: 'Date of incorporation',
    type: 'date',
    allowNa: true,
  },
  { key: 'incorporationPlace', label: 'Place of incorporation', allowNa: true },
  { key: 'tin', label: 'TIN' },
  { key: 'email', label: 'Company email', type: 'email' },
  { key: 'website', label: 'Website', type: 'url', allowNa: true },
  { key: 'fax', label: 'Fax number', allowNa: true },
  { key: 'principalName', label: 'CEO / President / Owner / Partner' },
  { key: 'principalEmail', label: 'Principal email', type: 'email' },
  { key: 'principalContactNumber', label: 'Principal contact number' },
  { key: 'correspondenceName', label: 'General correspondence contact' },
  { key: 'correspondenceEmail', label: 'Correspondence email', type: 'email' },
  {
    key: 'correspondenceContactNumber',
    label: 'Correspondence contact number',
  },
  {
    key: 'productsOrServices',
    label: 'Products or services',
    type: 'textarea',
  },
];

export function VendorApplicationPage() {
  const { id = '' } = useParams();
  const { profile, mode, supabaseClient } = useSession();
  const { getById, submitCase, loading } = useAccreditationCases();
  const { rows: aliases } = useVendorAliases();
  const { success, error } = useToast();
  const kase = getById(id);
  const isVendor = profile?.kind === 'vendor';
  const readOnly = !isVendor || kase?.status === 'approved';
  const [application, setApplication] = useState<VendorApplicationSnapshot | null>(null);
  const [signature, setSignature] = useState<SignaturePayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [draftVersion, setDraftVersion] = useState(0);
  const [draftState, setDraftState] = useState<'loading' | 'saved' | 'unsaved' | 'saving' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const editRevision = useRef(0);
  const repository = useMemo(() => {
    if (mode === 'supabase' && !supabaseClient) return null;
    return createVendorApplicationDraftRepository({
      mode,
      client: supabaseClient as unknown as LegalDraftClient | null,
    });
  }, [mode, supabaseClient]);

  useEffect(() => {
    if (!kase || !repository) return;
    let active = true;
    setApplication(null);
    setLoadError(null);
    setDraftState('loading');
    void repository
      .load(kase.id)
      .then((draft) => {
        if (!active) return;
        setApplication(draft?.application ?? blankApplication(supportedEntity(kase.entityType), kase.vendorName));
        setDraftVersion(draft?.version ?? 0);
        setSubmitted(draft?.status === 'submitted');
        setDraftState('saved');
        editRevision.current = 0;
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setLoadError(cause instanceof Error ? cause.message : 'The application could not be loaded.');
        setDraftState('error');
      });
    return () => {
      active = false;
    };
  }, [isVendor, kase?.id, repository]);

  useEffect(() => {
    if (!kase || !application || !repository || !isVendor || readOnly || draftState !== 'unsaved') return;
    const revision = editRevision.current;
    const timer = window.setTimeout(() => {
      setDraftState('saving');
      void repository
        .save(kase.id, application, draftVersion, globalThis.crypto?.randomUUID?.() ?? `${kase.id}-${Date.now()}`)
        .then((saved) => {
          setDraftVersion(saved.version);
          setDraftState(editRevision.current === revision ? 'saved' : 'unsaved');
        })
        .catch(() => setDraftState('error'));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [application, draftState, draftVersion, isVendor, kase, readOnly, repository]);

  const checklist = useMemo(
    () =>
      application
        ? buildV2025Checklist(application.entityType, {
            jurisdiction: application.jurisdiction,
            handlesPersonalData: kase?.handlesPersonalData,
            technologyServiceProvider: application.technologyServiceProvider,
          })
        : [],
    [application, kase?.handlesPersonalData],
  );

  if (loading)
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="h-64 animate-pulse rounded-lg bg-inset" />
      </div>
    );
  if (!kase) {
    return (
      <div className="mx-auto max-w-xl py-8">
        <Card>
          <div className="space-y-3 text-center">
            <Icon name="alert" className="mx-auto h-8 w-8 text-amber-600" />
            <h1 className="font-display text-2xl font-bold text-ink">Application not available</h1>
            <p className="text-sm text-muted">
              This accreditation application may have expired, been removed, or belong to another vendor.
            </p>
            <Link to="/" className="btn-primary">
              Return to vendor portal
            </Link>
          </div>
        </Card>
      </div>
    );
  }
  if (shouldBlockVendorAccess(profile, kase, aliases)) return <Navigate to="/" replace />;
  if (loadError) {
    return (
      <div role="alert">
        <Card className="mx-auto max-w-xl">
          <h1 className="font-display text-xl font-bold text-ink">Application could not be loaded</h1>
          <p className="mt-2 text-sm text-muted">{loadError}</p>
          <Link to={`/cases/${kase.id}`} className="btn-primary mt-4">
            Return to case
          </Link>
        </Card>
      </div>
    );
  }
  if (!application)
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="h-64 animate-pulse rounded-lg bg-inset" />
      </div>
    );

  const activeCase = kase;
  const currentApplication = application;
  const validation = validateV2025Application(application);

  function updateCompany(key: keyof VendorCompanyDetails, value: string) {
    updateApplication((current) => ({
      ...current,
      company: { ...current.company, [key]: value },
    }));
  }

  function updateApplication(change: (current: VendorApplicationSnapshot) => VendorApplicationSnapshot) {
    editRevision.current += 1;
    setDraftState('unsaved');
    setApplication((current) => (current ? change(current) : current));
  }

  function setDisposition(path: string, disposition?: AccreditationFieldDisposition) {
    updateApplication((current) => {
      const next = { ...current.fieldDispositions };
      if (disposition) next[path] = disposition;
      else delete next[path];
      return { ...current, fieldDispositions: next };
    });
  }

  async function saveDraft() {
    if (!repository) return;
    setDraftState('saving');
    try {
      const saved = await repository.save(
        activeCase.id,
        currentApplication,
        draftVersion,
        globalThis.crypto?.randomUUID?.() ?? `${activeCase.id}-${Date.now()}`,
      );
      setDraftVersion(saved.version);
      setDraftState('saved');
      success(mode === 'supabase' ? 'Application draft saved securely' : 'Application draft saved on this device');
    } catch (cause) {
      setDraftState('error');
      error(cause instanceof Error ? cause.message : 'Could not save the draft.');
    }
  }

  async function discardDraft() {
    if (!repository || !window.confirm('Discard the current application draft? This action is recorded.')) return;
    setBusy(true);
    try {
      await repository.discard(activeCase.id, draftVersion);
      setApplication(blankApplication(supportedEntity(activeCase.entityType), activeCase.vendorName));
      editRevision.current = 0;
      setDraftState('saved');
      success('Draft discarded');
    } catch (cause) {
      error(cause instanceof Error ? cause.message : 'Could not discard the draft.');
    } finally {
      setBusy(false);
    }
  }

  async function submitApplication() {
    if (!kase || !application) return;
    if (!signature) {
      error('Add the authorized signatory signature before submitting.');
      return;
    }
    const next: VendorApplicationSnapshot = {
      ...application,
      declaration: { ...application.declaration, signedAt: signature.signedAt },
    };
    const result = validateV2025Application(next);
    if (!result.ok) {
      error(`Complete ${result.errors.length} required application field${result.errors.length === 1 ? '' : 's'}.`);
      return;
    }
    setBusy(true);
    try {
      if (mode === 'supabase' && supabaseClient) {
        const { error: rpcError } = await supabaseClient.schema('legal').rpc('submit_vendor_application', {
          payload: {
            case_id: kase.id,
            application: next,
            declaration: next.declaration,
            signature,
          },
        });
        if (rpcError) throw new Error(rpcError.message);
      } else {
        await repository?.save(
          kase.id,
          next,
          draftVersion,
          globalThis.crypto?.randomUUID?.() ?? `${kase.id}-${Date.now()}`,
        );
        await submitCase(kase.id, profile?.email, {
          method: signature.method,
          dataUrl: signature.dataUrl,
          signerName: signature.signerName,
          signedAt: signature.signedAt,
          userAgent: signature.userAgent,
        });
      }
      setApplication(next);
      setSubmitted(true);
      success('Vendor Accreditation Form v.2025 submitted for review');
    } catch (cause) {
      error(cause instanceof Error ? cause.message : 'Could not submit the application.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ModuleHero
        eyebrow="Vendor Accreditation Form v.2025"
        title={kase.vendorName}
        description="Complete the company, experience, evidence, and declaration sections used by Legal and Procurement."
        icon="clipboard"
        action={
          <HeroChipButton href={`/cases/${kase.id}`} icon="arrowRight">
            Back to case
          </HeroChipButton>
        }
        accessory={
          <Badge tone={submitted ? 'emerald' : validation.ok ? 'cyan' : 'amber'}>
            {submitted
              ? 'Submitted'
              : validation.ok
                ? 'Ready to sign'
                : `${validation.errors.length} fields incomplete`}
          </Badge>
        }
      />

      <section>
        <SectionTitle
          title="Company details"
          subtitle="Use the legal and tax registration details. Mark N/A only where the form permits it."
        />
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            {COMPANY_FIELDS.map((field) => {
              const path = `company.${field.key}`;
              const disposition = application.fieldDispositions[path];
              const value = String(application.company[field.key] ?? '');
              return (
                <label key={field.key} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
                  <span className="flex min-h-6 items-center justify-between gap-2 text-sm font-semibold text-ink">
                    {field.label}
                    {field.allowNa && !readOnly && (
                      <button
                        type="button"
                        className="min-h-11 px-2 text-xs text-brand-700"
                        onClick={() =>
                          setDisposition(
                            path,
                            disposition
                              ? undefined
                              : {
                                  status: 'not_applicable',
                                  reason: 'Not applicable to this vendor',
                                },
                          )
                        }
                      >
                        {disposition ? 'Enter value' : 'Mark N/A'}
                      </button>
                    )}
                  </span>
                  {field.type === 'textarea' ? (
                    <textarea
                      rows={3}
                      className="input mt-1.5"
                      value={disposition ? disposition.reason : value}
                      disabled={readOnly || Boolean(disposition)}
                      onChange={(event) => updateCompany(field.key, event.target.value)}
                    />
                  ) : (
                    <input
                      type={field.type ?? 'text'}
                      className="input mt-1.5"
                      value={disposition ? `N/A - ${disposition.reason}` : value}
                      disabled={readOnly || Boolean(disposition)}
                      onChange={(event) => updateCompany(field.key, event.target.value)}
                    />
                  )}
                </label>
              );
            })}
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle
          title="Manpower and experience"
          subtitle="Describe the team and completed work that supports this application."
        />
        <Card>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ['countAndExpertise', 'Manpower count and expertise'],
                ['qualifications', 'Qualifications or certifications'],
                ['completedProjects', 'Completed projects'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="text-sm font-semibold text-ink">
                {label}
                <textarea
                  rows={4}
                  className="input mt-1.5"
                  value={application.manpower[key]}
                  disabled={readOnly}
                  onChange={(event) =>
                    updateApplication((current) => ({
                      ...current,
                      manpower: {
                        ...current.manpower,
                        [key]: event.target.value,
                      },
                    }))
                  }
                />
              </label>
            ))}
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle title="Technology qualification" subtitle="Applicable only to technology service providers." />
        <Card>
          <label className="mb-4 flex min-h-11 items-center gap-3 font-semibold text-ink">
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={application.technologyServiceProvider}
              disabled={readOnly}
              onChange={(event) =>
                updateApplication((current) => ({
                  ...current,
                  technologyServiceProvider: event.target.checked,
                  technologyQualifications: event.target.checked ? current.technologyQualifications : [],
                }))
              }
            />
            This is a technology service provider
          </label>
          {application.technologyServiceProvider && (
            <TechnologyQualificationForm
              value={application.technologyQualifications}
              readOnly={readOnly}
              onChange={(technologyQualifications) =>
                updateApplication((current) => ({
                  ...current,
                  technologyQualifications,
                }))
              }
            />
          )}
        </Card>
      </section>

      <section>
        <SectionTitle
          title="Document checklist"
          subtitle={`${checklist.filter((item) => item.required).length} required items derived from the entity type and applicable conditions.`}
        />
        <Card>
          <ul className="grid gap-2 sm:grid-cols-2">
            {checklist.map((item) => (
              <li
                key={item.code}
                className="flex min-h-11 items-center gap-3 rounded-lg border border-line px-3 py-2 text-sm"
              >
                <Icon name={item.required ? 'check' : 'info'} className="h-4 w-4 shrink-0 text-brand-600" />
                <span className="min-w-0 flex-1 text-ink">{item.label}</span>
                <Badge tone={item.required ? 'cyan' : 'slate'}>{item.required ? 'Required' : 'If applicable'}</Badge>
              </li>
            ))}
          </ul>
          <Link to={`/cases/${kase.id}`} className="btn-ghost mt-4">
            <Icon name="clipboard" className="h-4 w-4" />
            Open document uploads
          </Link>
        </Card>
      </section>

      <section>
        <SectionTitle
          title="Declaration"
          subtitle={`Controlling source: ${VENDOR_ACCREDITATION_V2025.sourceDocument}`}
        />
        <Card>
          <AccreditationDeclaration
            value={application.declaration}
            readOnly={readOnly}
            onChange={(declaration) => updateApplication((current) => ({ ...current, declaration }))}
          />
          {!readOnly && (
            <div className="mt-5 border-t border-line pt-5">
              <SignaturePad defaultSignerName={application.declaration.signerName} onChange={setSignature} />
            </div>
          )}
        </Card>
      </section>

      {!readOnly && (
        <div className="safe-bottom flex flex-col gap-3 rounded-lg border border-line bg-surface p-3 shadow-e1 sm:flex-row sm:items-center sm:justify-between md:sticky md:bottom-4 md:z-10 md:bg-surface/95 md:shadow-e2 md:backdrop-blur">
          <p className="text-sm text-muted" aria-live="polite">
            {draftState === 'saving'
              ? 'Saving securely...'
              : draftState === 'saved'
                ? 'Saved securely'
                : draftState === 'error'
                  ? 'Draft could not be saved'
                  : 'Unsaved changes'}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" className="btn-ghost min-h-11" disabled={busy} onClick={() => void discardDraft()}>
              Discard draft
            </button>
            <button
              type="button"
              className="btn-ghost min-h-11"
              disabled={busy || draftState === 'saving'}
              onClick={() => void saveDraft()}
            >
              Save now
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !validation.ok || !signature}
              onClick={() => void submitApplication()}
            >
              <Icon name="signature" className="h-4 w-4" />
              {busy ? 'Submitting...' : 'Sign and submit'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
