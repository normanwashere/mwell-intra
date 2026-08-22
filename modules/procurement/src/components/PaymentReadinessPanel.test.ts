import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

import { PaymentReadinessPanel } from './PaymentReadinessPanel';
import type { AcceptancePack, PaymentReadinessPack } from '../types';
import { MWELL_OPERATING_PROFILE } from '../policyProfile';

it('enables Finance preparation when the preview binds every active acceptance and aggregate quantity', () => {
  const acceptances: AcceptancePack[] = [
    {
      id: 'accept-1',
      purchaseOrderId: 'po-1',
      acceptanceType: 'goods',
      acceptedScope: 'Receipt one',
      exceptions: [],
      acceptedAt: '2026-07-15T08:00:00Z',
      status: 'accepted',
    },
    {
      id: 'accept-2',
      purchaseOrderId: 'po-1',
      acceptanceType: 'goods',
      acceptedScope: 'Receipt two',
      exceptions: [],
      acceptedAt: '2026-07-15T09:00:00Z',
      status: 'accepted',
    },
  ];
  const pack: PaymentReadinessPack = {
    id: 'pack-1',
    purchaseOrderId: 'po-1',
    acceptancePackId: 'accept-1',
    acceptancePackIds: ['accept-1', 'accept-2'],
    acceptedQuantity: 7,
    poMatch: true,
    invoiceOrSiReference: 'invoice-1',
    milestoneSupportReference: 'delivery-1',
    invoiceNumber: 'INV-1',
    invoiceDate: '2026-07-15',
    invoiceAmount: 10_000,
    taxWithholdingSupportReference: 'tax-1',
    status: 'draft',
    preparedAt: '2026-07-15T10:00:00Z',
  };

  const html = renderToStaticMarkup(
    createElement(PaymentReadinessPanel, {
      acceptances,
      pack,
      canAccept: false,
      canPrepare: true,
      canReview: false,
      canRelease: false,
      purchaseOrderAmount: 10_000,
      acceptanceType: 'goods',
      onAccept: vi.fn(),
      onPrepare: vi.fn(),
      onReview: vi.fn(),
      onRelease: vi.fn(),
    }),
  );

  expect(html).toContain('2 active acceptance packs');
  expect(html).toContain('7 accepted unit');
  expect(html).toMatch(/<button[^>]*>[^<]*(?:<[^>]+>)*Validate match and send to Finance/);
  expect(html).not.toMatch(
    /<button[^>]*disabled[^>]*>[^<]*(?:<[^>]+>)*Validate match and send to Finance/,
  );
});

it('sums acceptance quantities before a pack exists and keeps immutable staleness history visible after replacement', () => {
  const acceptances: AcceptancePack[] = [
    {
      id: 'accept-1',
      purchaseOrderId: 'po-1',
      acceptanceType: 'goods',
      acceptedScope: 'Receipt one',
      acceptedQuantity: 3,
      exceptions: [],
      acceptedAt: '2026-07-15T08:00:00Z',
      status: 'accepted',
    },
    {
      id: 'accept-2',
      purchaseOrderId: 'po-1',
      acceptanceType: 'goods',
      acceptedScope: 'Receipt two',
      acceptedQuantity: 4,
      exceptions: [],
      acceptedAt: '2026-07-15T09:00:00Z',
      status: 'accepted',
    },
  ];
  const pack: PaymentReadinessPack = {
    id: 'replacement',
    purchaseOrderId: 'po-1',
    acceptancePackId: 'accept-1',
    acceptancePackIds: ['accept-1', 'accept-2'],
    acceptedQuantity: 7,
    poMatch: true,
    invoiceOrSiReference: 'invoice-2',
    milestoneSupportReference: 'delivery-2',
    taxWithholdingSupportReference: 'tax-2',
    status: 'ready_for_finance',
    preparedAt: '2026-07-15T12:00:00Z',
    correctedFrom: 'finalized-stale-pack',
  };
  const html = renderToStaticMarkup(
    createElement(PaymentReadinessPanel, {
      acceptances,
      pack,
      stalenessEvents: [
        {
          id: 'event-1',
          paymentReadinessPackId: 'finalized-stale-pack',
          purchaseOrderId: 'po-1',
          priorStatus: 'accepted',
          priorAcceptanceEvidenceVersion: 1,
          acceptanceEvidenceVersion: 2,
          reason: 'Later acceptance evidence',
          recordedAt: '2026-07-15T11:00:00Z',
          financeReviewedByEmail: 'finance.reviewer@mwell.com.ph',
          financeReviewedAt: '2026-07-15T10:30:00Z',
          financeNote: 'Accepted after three-way match.',
        },
      ],
      canAccept: false,
      canPrepare: true,
      canReview: true,
      canRelease: false,
      purchaseOrderAmount: 10_000,
      acceptanceType: 'goods',
      onAccept: vi.fn(),
      onPrepare: vi.fn(),
      onReview: vi.fn(),
      onRelease: vi.fn(),
    }),
  );
  expect(html).toContain('7 accepted unit');
  expect(html).toContain('Finance evidence staleness history');
  expect(html).toContain('Evidence v1 to v2');
  expect(html).toContain('Prior decision: Accepted');
  expect(html).toContain('finance.reviewer@mwell.com.ph');
  expect(html).toContain('Accepted after three-way match.');
  expect(html).toContain('Replacement for finalized-stale-pack');
});

it('shows amount-based service acceptance without requiring Warehouse lines', () => {
  const html = renderToStaticMarkup(
    createElement(PaymentReadinessPanel, {
      acceptances: [],
      canAccept: true,
      canPrepare: false,
      canReview: false,
      canRelease: false,
      purchaseOrderAmount: 75_000,
      acceptanceType: 'service',
      onAccept: vi.fn(),
      onPrepare: vi.fn(),
      onReview: vi.fn(),
      onRelease: vi.fn(),
    }),
  );

  expect(html).toContain('Accepted service value');
  expect(html).not.toContain('QC-accepted quantity');
  expect(html).toContain('Record service acceptance');
});

it('shows a governed payment release action only after Finance acceptance', () => {
  const pack: PaymentReadinessPack = {
    id: 'pack-release',
    purchaseOrderId: 'po-1',
    acceptancePackId: 'accept-1',
    poMatch: true,
    invoiceOrSiReference: 'invoice.pdf',
    milestoneSupportReference: 'delivery.pdf',
    taxWithholdingSupportReference: 'tax.pdf',
    status: 'accepted',
    preparedAt: '2026-07-15T12:00:00Z',
    invoiceNumber: 'INV-1002',
    invoiceAmount: 50_000,
    releasedAmount: 10_000,
  };
  const html = renderToStaticMarkup(
    createElement(PaymentReadinessPanel, {
      acceptances: [],
      pack,
      canAccept: false,
      canPrepare: false,
      canReview: true,
      canRelease: true,
      purchaseOrderAmount: 50_000,
      acceptanceType: 'goods',
      onAccept: vi.fn(),
      onPrepare: vi.fn(),
      onReview: vi.fn(),
      onRelease: vi.fn(),
    }),
  );

  expect(html).toContain('Record payment release');
  expect(html).toContain('40,000');
  expect(html).toContain('Payment reference');
});

it('does not offer payment release to a Finance acceptor without release authority', () => {
  const pack: PaymentReadinessPack = {
    id: 'pack-separated',
    purchaseOrderId: 'po-1',
    acceptancePackId: 'accept-1',
    poMatch: true,
    invoiceOrSiReference: 'invoice.pdf',
    milestoneSupportReference: 'delivery.pdf',
    taxWithholdingSupportReference: 'tax.pdf',
    status: 'accepted',
    preparedAt: '2026-07-15T12:00:00Z',
    invoiceNumber: 'INV-1003',
    invoiceAmount: 50_000,
    releasedAmount: 0,
  };
  const html = renderToStaticMarkup(
    createElement(PaymentReadinessPanel, {
      acceptances: [],
      pack,
      canAccept: false,
      canPrepare: false,
      canReview: true,
      canRelease: false,
      purchaseOrderAmount: 50_000,
      acceptanceType: 'goods',
      onAccept: vi.fn(),
      onPrepare: vi.fn(),
      onReview: vi.fn(),
      onRelease: vi.fn(),
    }),
  );

  expect(html).not.toContain('Record payment release');
});

it('shows the request-bound profile threshold and itemized evidence without accepting a client readiness assertion', () => {
  const html = renderToStaticMarkup(
    createElement(PaymentReadinessPanel, {
      acceptances: [],
      pack: {
        id: 'pack-evidence',
        purchaseOrderId: 'po-1',
        acceptancePackId: 'accept-1',
        poMatch: false,
        invoiceOrSiReference: 'invoice.pdf',
        milestoneSupportReference: 'acceptance.pdf',
        status: 'draft',
        preparedAt: '2026-08-22T12:00:00Z',
        invoiceNumber: 'INV-1004',
        invoiceAmount: 50_000,
      },
      policyProfile: MWELL_OPERATING_PROFILE,
      foreignVendor: true,
      canAccept: false,
      canPrepare: false,
      canReview: false,
      canRelease: false,
      purchaseOrderAmount: 50_000,
      acceptanceType: 'goods',
      onAccept: vi.fn(),
      onPrepare: vi.fn(),
      onReview: vi.fn(),
      onRelease: vi.fn(),
    }),
  );

  expect(html).toContain('Active Mwell threshold: PHP 50,000');
  expect(html).toContain('Invoice, OR, or SI evidence');
  expect(html).toContain('Purchase order or agreement evidence');
  expect(html).toContain('Foreign-vendor tax, withholding, and payment controls');
  expect(html).toContain('Server recomputes payment readiness');
});
