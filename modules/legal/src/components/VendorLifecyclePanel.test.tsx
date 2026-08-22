import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';

import { VendorEligibilityProjection } from './VendorLifecyclePanel';

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
