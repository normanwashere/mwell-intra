'use client';

import type { VendorAccreditationDeclaration } from '../types';

export function AccreditationDeclaration({
  value,
  onChange,
  readOnly = false,
}: {
  value: VendorAccreditationDeclaration;
  onChange: (value: VendorAccreditationDeclaration) => void;
  readOnly?: boolean;
}) {
  const patch = (next: Partial<VendorAccreditationDeclaration>) =>
    onChange({ ...value, ...next });

  return (
    <div className="space-y-4 text-sm">
      <label className="flex min-h-11 items-start gap-3 text-ink">
        <input
          type="checkbox"
          checked={value.accepted}
          disabled={readOnly}
          onChange={(event) => patch({ accepted: event.target.checked })}
          className="mt-1 h-5 w-5 rounded border-line text-brand-600"
        />
        <span>I certify that the information and submitted documents are true and correct and understand that false or incomplete information may cause disapproval.</span>
      </label>
      <fieldset>
        <legend className="font-semibold text-ink">Are there pending lawsuits, foreclosures, bankruptcies, or other legal actions involving the company?</legend>
        <div className="mt-2 flex gap-2">
          <label className="btn-ghost min-h-11">
            <input type="radio" name="legal-actions" checked={!value.noLegalActions} disabled={readOnly} onChange={() => patch({ noLegalActions: false })} />
            Yes
          </label>
          <label className="btn-ghost min-h-11">
            <input type="radio" name="legal-actions" checked={value.noLegalActions} disabled={readOnly} onChange={() => patch({ noLegalActions: true, disclosureDetails: '' })} />
            No
          </label>
        </div>
      </fieldset>
      {!value.noLegalActions && (
        <label className="block font-semibold text-ink">
          Disclosure details
          <textarea value={value.disclosureDetails} disabled={readOnly} onChange={(event) => patch({ disclosureDetails: event.target.value })} rows={4} className="input mt-1.5" />
        </label>
      )}
      <label className="flex min-h-11 items-start gap-3 text-ink">
        <input
          type="checkbox"
          checked={value.verificationAuthorized}
          disabled={readOnly}
          onChange={(event) => patch({ verificationAuthorized: event.target.checked })}
          className="mt-1 h-5 w-5 rounded border-line text-brand-600"
        />
        <span>I authorize MPHTC to verify the information and documents supplied in this application.</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="font-semibold text-ink">Authorized signatory<input value={value.signerName} disabled={readOnly} onChange={(event) => patch({ signerName: event.target.value })} className="input mt-1.5" /></label>
        <label className="font-semibold text-ink">Designation<input value={value.signerTitle} disabled={readOnly} onChange={(event) => patch({ signerTitle: event.target.value })} className="input mt-1.5" /></label>
      </div>
    </div>
  );
}
