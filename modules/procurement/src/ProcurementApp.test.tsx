import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ProcurementApp.tsx', import.meta.url), 'utf8');

describe('ProcurementApp variance-review admission', () => {
  it('keeps DOA variance reviewers on a server-checked, request-only route', () => {
    expect(source).toContain('VarianceReviewPage');
    expect(source).toContain('varianceReviewDeepLink');
    expect(source).toContain('varianceReviewOnly');
    expect(source).toContain('<VarianceReviewPage />');
    expect(source).not.toContain("operations: ['department_head']");
    expect(source).not.toContain("finance: ['controller']");
  });

  it('does not expose broad Procurement routes to a variance-review-only session', () => {
    const varianceOnlyBlock = source.match(/\) : varianceReviewOnly \? \([\s\S]*?\) : \(/)?.[0] ?? '';
    expect(varianceOnlyBlock).toContain('PROCUREMENT_ROUTE_BY_ID["request-detail"].path');
    expect(varianceOnlyBlock).toContain('<VarianceReviewPage />');
    expect(varianceOnlyBlock).not.toContain('<RequestsPage />');
    expect(varianceOnlyBlock).not.toContain('<CreateRequestPage />');
    expect(varianceOnlyBlock).not.toContain('<SourcingWorkspace');
  });
});
