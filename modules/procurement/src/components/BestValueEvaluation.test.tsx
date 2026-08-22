import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { validateAwardRecommendation } from '../policy';

it('does not identify the lowest price as an automatic winner', () => {
  const source = readFileSync(new URL('./BestValueEvaluation.tsx', import.meta.url), 'utf8');
  expect(source).toContain('Total lifecycle cost');
  expect(source).toContain('Warranty and support');
  expect(source).not.toMatch(/automatic winner/i);
});

it('requires independent approval when the recommendation differs from evaluation', () => {
  expect(validateAwardRecommendation({
    evaluatedVendorId: 'vendor-a',
    recommendedVendorId: 'vendor-b',
    varianceJustification: '',
  })).toContain('Written variance justification is required.');
});

it('requires the governed evidence pack before a recommendation can be submitted', () => {
  expect(validateAwardRecommendation({
    evaluatedVendorId: 'vendor-a',
    recommendedVendorId: 'vendor-a',
    rationale: '',
    commercialTabulationId: '',
    technicalEvaluationId: '',
    riskEvidenceReference: '',
  })).toEqual(expect.arrayContaining([
    'Recommendation rationale is required.',
    'Commercial tabulation is required.',
    'Technical evaluation is required.',
    'Applicable risk evidence is required.',
  ]));
});

it('renders server-led variance stages and audit evidence instead of a generic review gate', () => {
  const source = readFileSync(new URL('./BestValueEvaluation.tsx', import.meta.url), 'utf8');
  expect(source).toContain('Variance review: {varianceStageLabel}');
  expect(source).toContain("'Department Head'");
  expect(source).toContain("'Finance'");
  expect(source).toContain('Submitted by');
  expect(source).toContain('DOA assignment');
  expect(source).not.toContain('canReview,');
});
