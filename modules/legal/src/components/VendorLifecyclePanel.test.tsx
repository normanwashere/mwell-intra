import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import {
  VendorEligibilityAuthorityWorkspace,
  VendorEligibilityProjection,
} from './VendorLifecyclePanel';

it('renders Legal/VMO probation metrics, evidence, notice, and a read-only procurement projection', () => {
  const html = renderToStaticMarkup(
    createElement(VendorEligibilityProjection, {
      projection: {
        vendorId: 'vendor-1',
        vendorName: 'Acme Medical Supplies',
        status: 'probation',
        eligible: true,
        authority: 'Legal/VMO',
        reviewDueAt: '2027-02-22',
        decision: 'extend',
        poWinRate: 0.2,
        deliveryCommitmentRate: 1,
        returnOrRejectionCount: 0,
        documentTimelinessRate: 1,
        evidenceReference: 'private/vendor-review.pdf',
        noticeReference: 'private/vendor-extension-notice.pdf',
      },
    }),
  );

  expect(html).toContain('Six-month probation review');
  expect(html).toContain('PO win rate 20%');
  expect(html).toContain('Delivery commitment 100%');
  expect(html).toContain('private/vendor-extension-notice.pdf');
  expect(html).toContain('Read-only Procurement eligibility projection');
  expect(html).toContain('Legal/VMO');
});

it('offers Legal/VMO the governed probation, clearance, and custody commands', () => {
  const html = renderToStaticMarkup(
    createElement(VendorEligibilityAuthorityWorkspace, {
      vendors: [{ id: 'vendor-1', name: 'North Star Logistics' }],
      probationReviews: [{ id: 'review-1', vendorId: 'vendor-1', revision: 1 }],
      onRecordProbationReview: () => undefined,
      onRecordEligibilityDecision: () => undefined,
      onRecordTemporaryClearance: () => undefined,
      onRecordSampleCustody: () => undefined,
    }),
  );

  expect(html).toContain('Six-month probation decision');
  expect(html).toContain('Six-month probation metrics');
  expect(html).toContain('PO win rate');
  expect(html).toContain('Delivery commitment rate');
  expect(html).toContain('Expected revision');
  expect(html).toContain('Temporary clearance scope');
  expect(html).toContain('Independent clearance decision');
  expect(html).toContain('Sample custody evidence');
  expect(html).toContain('Evidence reference');
  expect(html).toContain('Notice reference');
});
