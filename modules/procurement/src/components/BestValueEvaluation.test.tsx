import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToastProvider } from '@intra/ui';
import { expect, it } from 'vitest';
import { validateAwardRecommendation } from '../policy';
import { BestValueEvaluation } from './BestValueEvaluation';
import type { VarianceReviewEligibility } from '../types';

it.each([
  [undefined, 'Stage unavailable'],
  [{ canReview: false }, 'Stage unavailable'],
  [{ canReview: false, nextStage: 'department_head' }, 'Department Head'],
  [{ canReview: false, nextStage: 'finance' }, 'Finance'],
] as Array<[VarianceReviewEligibility | undefined, string]>)('labels only the server-provided variance stage: %j', (varianceEligibility, expected) => {
  const html = renderToStaticMarkup(createElement(ToastProvider, { children: createElement(BestValueEvaluation, {
    requestId: 'request-1', canManage: false, client: null,
    event: { id: 'event-1', status: 'evaluation', responses: [], varianceEligibility,
      awardRecommendation: { id: 'recommendation-1', sourcingEventId: 'event-1', version: 2, status: 'pending_variance',
        evaluatedVendorId: 'vendor-1', recommendedVendorId: 'vendor-2', commercialTabulationId: 'tab-1', technicalEvaluationId: 'tech-1',
        rationale: 'Persisted best-value recommendation', createdAt: '2026-09-14T00:00:00Z' } },
  }) }));
  expect(html).toContain(`Next variance stage: ${expected}.`);
  if (!varianceEligibility?.nextStage) expect(html).not.toContain('Next variance stage: Finance.');
  expect(html).not.toContain('Record Finance approval');
  expect(html).not.toContain('Record Department Head approval');
});

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
