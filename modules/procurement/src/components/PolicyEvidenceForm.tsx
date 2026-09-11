'use client';

import { useState } from 'react';
import type { RequestAttachment } from '../types';

const referenceFields = [['reference', 'Evidence reference'], ['summary', 'Findings and recommendation']] as const;
export const POLICY_EVIDENCE_CONTROLS = [
  { code: 'RFQ_COMMERCIAL_COMPARISON', label: 'RFQ commercial comparison', fields: referenceFields },
  { code: 'RFP_TECHNICAL_EVALUATION', label: 'RFP technical evaluation', fields: referenceFields },
  { code: 'RFP_COMMERCIAL_EVALUATION', label: 'RFP commercial evaluation', fields: referenceFields },
  { code: 'RFP_AWARD_RECOMMENDATION', label: 'RFP award recommendation', fields: referenceFields },
  { code: 'IMPORT_PLAN', label: 'Importation plan', fields: [
    ['incoterms', 'Incoterms'], ['importerOfRecord', 'Importer of record'],
    ['permitsAndRegistrations', 'Permits and registrations'], ['customsBrokerAndLogistics', 'Customs broker and logistics'],
    ['dutiesTaxesFreightInsurance', 'Duties, taxes, freight and insurance'], ['foreignPaymentTiming', 'Foreign payment timing'],
    ['deliveryAcceptanceAndWarranty', 'Delivery, acceptance and warranty'],
  ] },
  { code: 'PCAB_LICENSE', label: 'PCAB license', fields: [['reference', 'License reference'], ['summary', 'License scope and validity']] },
  { code: 'INSTALLATION_PROTECTIONS', label: 'Installation protections', fields: [['reference', 'Protection reference'], ['summary', 'Commissioning, defects, warranty, acceptance and risk protections']] },
  { code: 'PETTY_CASH_LIQUIDATION', label: 'Petty cash liquidation', fields: [['reference', 'Liquidation reference'], ['summary', 'Receipt and liquidation details']] },
] as const;
export const POLICY_EVIDENCE_TYPES = ['document', 'assessment', 'plan'] as const;

export function policyEvidenceErrors(controlCode: string, evidenceType: string, facts: Record<string, string>) {
  const errors: Record<string, string> = {};
  const control = POLICY_EVIDENCE_CONTROLS.find(item => item.code === controlCode);
  if (!control) errors.control = 'Select a supported policy requirement.';
  if (!(POLICY_EVIDENCE_TYPES as readonly string[]).includes(evidenceType)) errors.type = 'Select an evidence format.';
  for (const [key, label] of control?.fields ?? []) {
    if (!facts[key]?.trim()) errors[key] = `${label} is required.`;
    else if (facts[key]!.length > 4000) errors[key] = 'Use 4,000 characters or fewer.';
  }
  return errors;
}

export function PolicyEvidenceForm({ submit, attachments = [] }: {
  submit: (input: { controlCode: string; evidenceType: string; facts: Record<string, unknown> }) => Promise<void>;
  attachments?: RequestAttachment[];
}) {
  const [controlCode, setControl] = useState('');
  const [evidenceType, setType] = useState('document');
  const [facts, setFacts] = useState<Record<string, string>>({});
  const [attachmentId, setAttachmentId] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState('');
  const [failure, setFailure] = useState('');
  const control = POLICY_EVIDENCE_CONTROLS.find(item => item.code === controlCode);
  const errors = policyEvidenceErrors(controlCode, evidenceType, facts);
  return <form className="space-y-3" onSubmit={async event => {
    event.preventDefault();
    setAttempted(true);
    if (pending || Object.keys(errors).length) return;
    setPending(true); setFailure(''); setResult('');
    try {
      const payload = Object.fromEntries((control?.fields ?? []).map(([key]) => [key, facts[key]!.trim()]));
      await submit({ controlCode, evidenceType, facts: { ...payload, ...(attachmentId ? { attachmentId } : {}) } });
      setFacts({}); setControl(''); setAttachmentId(''); setAttempted(false); setResult('Policy evidence submitted for review.');
    } catch { setFailure('Evidence could not be submitted. Your entries are retained; please retry.'); }
    finally { setPending(false); }
  }}>
    <label className="block text-sm font-semibold">Policy requirement<select className="input mt-1" value={controlCode} aria-invalid={attempted && !!errors.control} onChange={event => { setControl(event.target.value); setFacts({}); setAttempted(false); }}><option value="">Select a requirement</option>{POLICY_EVIDENCE_CONTROLS.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
    {attempted && errors.control && <p role="alert" className="text-sm text-rose-700">{errors.control}</p>}
    <label className="block text-sm font-semibold">Evidence format<select className="input mt-1" value={evidenceType} onChange={event => setType(event.target.value)}>{POLICY_EVIDENCE_TYPES.map(type => <option key={type} value={type}>{type === 'document' ? 'Document' : type === 'plan' ? 'Plan' : 'Assessment'}</option>)}</select></label>
    {control?.fields.map(([key, label]) => <div key={key}><label htmlFor={`policy-${key}`} className="block text-sm font-semibold">{label}</label><textarea id={`policy-${key}`} className="input mt-1" rows={2} maxLength={4000} value={facts[key] ?? ''} aria-invalid={attempted && !!errors[key]} aria-describedby={attempted && errors[key] ? `policy-${key}-error` : undefined} onChange={event => setFacts(current => ({ ...current, [key]: event.target.value }))} />{attempted && errors[key] && <p id={`policy-${key}-error`} role="alert" className="text-sm text-rose-700">{errors[key]}</p>}</div>)}
    {attachments.length > 0 && <label className="block text-sm font-semibold">Supporting request attachment<select className="input mt-1" value={attachmentId} onChange={event => setAttachmentId(event.target.value)}><option value="">No attachment selected</option>{attachments.map(item => <option key={item.id} value={item.id}>{item.filename}</option>)}</select></label>}
    {failure && <p role="alert">{failure}</p>}{result && <p role="status">{result}</p>}
    <button type="submit" className="btn-outline" disabled={pending}>{pending ? 'Submitting...' : 'Add policy evidence'}</button>
  </form>;
}
