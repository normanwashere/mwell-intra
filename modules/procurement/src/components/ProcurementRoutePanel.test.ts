import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { MWELL_OPERATING_PROFILE } from '../policyProfile';
import { ProcurementRoutePanel } from './ProcurementRoutePanel';

it('explains high-value goods without calling them an RFP', () => {
  const value = {
    solicitationType: 'rfq' as const,
    procurementMode: 'competitive_bidding' as const,
    governanceTier: 'formal_bid' as const,
    policyProfileId: MWELL_OPERATING_PROFILE.id,
    reasons: ['material_requirement', 'tier:formal_bid'],
  };
  const html = renderToStaticMarkup(createElement(ProcurementRoutePanel, {
    value,
    recommendation: { route: value, requiresProcurementConfirmation: true },
    profile: MWELL_OPERATING_PROFILE,
    canConfirm: true,
    onModeChange: vi.fn(),
  }));
  expect(html).toContain('Request for Quotation');
  expect(html).toContain('Competitive bidding');
  expect(html).toContain('Formal bid controls');
  expect(html).not.toContain('Request for Proposal');
  const summary = html.match(/<summary[^>]*class="([^"]+)"[^>]*>Why this route and policy profile<\/summary>/);
  expect(summary?.[1]?.split(' ')).toContain('min-h-11');
  expect(summary?.[1]?.split(' ')).toContain('py-3');
});
