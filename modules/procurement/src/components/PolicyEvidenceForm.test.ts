import { expect, it } from 'vitest';
import { POLICY_EVIDENCE_CONTROLS, policyEvidenceErrors } from './PolicyEvidenceForm';
it('keeps every required server import-plan fact key', () => {
  const control = POLICY_EVIDENCE_CONTROLS.find(item => item.code === 'IMPORT_PLAN')!;
  expect(control.fields.map(([key]) => key)).toEqual(['incoterms','importerOfRecord','permitsAndRegistrations','customsBrokerAndLogistics','dutiesTaxesFreightInsurance','foreignPaymentTiming','deliveryAcceptanceAndWarranty']);
  const facts = Object.fromEntries(control.fields.map(([key]) => [key, 'Business evidence']));
  expect(policyEvidenceErrors(control.code, 'plan', facts)).toEqual({});
  delete facts.importerOfRecord;
  expect(policyEvidenceErrors(control.code, 'plan', facts)).toHaveProperty('importerOfRecord');
});
it('rejects unknown controls, formats and incomplete business facts before submission', () => {
  expect(policyEvidenceErrors('UNKNOWN', 'raw', {})).toHaveProperty('control');
  expect(policyEvidenceErrors('IMPORT_PLAN', 'raw', {})).toHaveProperty('type');
  expect(policyEvidenceErrors('RFQ_COMMERCIAL_COMPARISON', 'document', { reference: '   ', summary: 'x'.repeat(4001) })).toEqual({ reference: 'Evidence reference is required.', summary: 'Use 4,000 characters or fewer.' });
});
