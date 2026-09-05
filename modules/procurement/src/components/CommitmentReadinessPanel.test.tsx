import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

import { CommitmentReadinessPanel } from './CommitmentReadinessPanel';

it.each(['blocked', 'open', 'ready', undefined] as const)('does not certify a closed PO package when governed closure is %s', (closureStatus) => {
  const html = renderToStaticMarkup(createElement(CommitmentReadinessPanel, {
    terminal: true,
    readiness: { ready: false, blockers: ['Missing approved evidence'], requiredEvidence: [] },
    lifecycle: closureStatus ? { revision: 1, acknowledgementStatus: 'pending', deliveryNoticeStatus: 'pending', qualityRecoveryStatus: 'payment_hold', closureStatus } : undefined,
    canAcknowledge: false, canRecordDeliveryNotice: false,
    onAcknowledge: vi.fn(), onRecordDeliveryNotice: vi.fn(),
  }));
  expect(html).not.toContain('Package closed');
  expect(html).toContain('PO closed; lifecycle review required');
  expect(html).toContain('Missing approved evidence');
  if (closureStatus) {
    expect(html).toContain('Governed closure');
    expect(html).toContain('Payment hold');
  }
});

it('certifies package closure only from the governed lifecycle', () => {
  const html = renderToStaticMarkup(createElement(CommitmentReadinessPanel, {
    terminal: true,
    readiness: { ready: true, blockers: [], requiredEvidence: [] },
    lifecycle: { revision: 2, acknowledgementStatus: 'acknowledged', deliveryNoticeStatus: 'recorded', qualityRecoveryStatus: 'resolved', closureStatus: 'closed' },
    canAcknowledge: false, canRecordDeliveryNotice: false,
    onAcknowledge: vi.fn(), onRecordDeliveryNotice: vi.fn(),
  }));
  expect(html).toContain('Package closed');
  expect(html).not.toContain('lifecycle review required');
});

it('shows the 48-hour vendor acknowledgement threshold and quality recovery handoff', () => {
  const html = renderToStaticMarkup(createElement(CommitmentReadinessPanel, {
    readiness: {
      ready: false,
      blockers: ['Commercial tabulation is required.'],
      requiredEvidence: [{ kind: 'commercial_tabulation', label: 'Commercial tabulation', status: 'missing', basis: 'Competitive route', source: 'Policy profile', owner: 'Procurement', recovery: 'Submit approved tabulation.' }],
    },
    lifecycle: {
      revision: 3,
      issuedAt: '2026-08-22T00:00:00.000Z',
      acknowledgementDueAt: '2026-08-24T00:00:00.000Z',
      acknowledgementStatus: 'overdue',
      deliveryNoticeStatus: 'pending',
      qualityRecoveryStatus: 'payment_hold',
      closureStatus: 'blocked',
    },
    monitoring: [{
      id: 'queue-1', kind: 'vendor_acknowledgement_overdue', owner: 'Procurement',
      dueAt: '2026-08-24T00:00:00.000Z', ageHours: 52, lastNoticeAt: '2026-08-24T00:00:00.000Z',
      nextAction: 'Escalate vendor acknowledgement',
    }],
    canAcknowledge: true,
    canRecordDeliveryNotice: true,
    onAcknowledge: vi.fn(),
    onRecordDeliveryNotice: vi.fn(),
  }));

  expect(html).toContain('48-hour acknowledgement threshold');
  expect(html).toContain('Commercial tabulation');
  expect(html).toContain('Owner: Procurement');
  expect(html).toContain('Payment hold');
  expect(html).toContain('Escalate vendor acknowledgement');
  expect(html).toContain('Record vendor acknowledgement');
});
