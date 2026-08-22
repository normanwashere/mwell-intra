import { describe, expect, it } from 'vitest';
import { MWELL_OPERATING_PROFILE } from './policyProfile';
import {
  deriveProcurementRoute,
  legacySourcingMethod,
  routeFromLegacy,
} from './policyRoute';

describe('three-axis procurement routing', () => {
  it.each([
    ['low-value material', { requirementKind: 'materials', category: 'goods', amount: 50_000 }, 'rfq', 'competitive_bidding', 'standard'],
    ['high-value material', { requirementKind: 'materials', category: 'goods', amount: 1_500_000 }, 'rfq', 'competitive_bidding', 'formal_bid'],
    ['low-value service', { requirementKind: 'services', category: 'services', amount: 50_000 }, 'rfp', 'competitive_bidding', 'standard'],
    ['high-risk service', { requirementKind: 'services', category: 'services', amount: 50_000, highRisk: true }, 'rfp', 'competitive_bidding', 'high_risk'],
  ] as const)('%s', (_name, input, solicitationType, procurementMode, governanceTier) => {
    expect(deriveProcurementRoute(input, MWELL_OPERATING_PROFILE).route).toMatchObject({
      solicitationType,
      procurementMode,
      governanceTier,
    });
  });

  it('routes an approved sole-source request without changing its goods classification', () => {
    expect(deriveProcurementRoute({
      requirementKind: 'materials',
      category: 'goods',
      amount: 80_000,
      requestedMode: 'sole_source',
    }, MWELL_OPERATING_PROFILE).route).toMatchObject({
      solicitationType: 'none',
      procurementMode: 'sole_source',
      governanceTier: 'standard',
    });
  });

  it('requires a requirement kind for a new route and never guesses it from category', () => {
    expect(() => deriveProcurementRoute({
      category: 'goods',
      amount: 80_000,
    } as never, MWELL_OPERATING_PROFILE)).toThrow(/requirement kind/i);
  });

  it('requires an active Mwell operating profile for a new or legacy route', () => {
    expect(() => deriveProcurementRoute({
      requirementKind: 'materials',
    }, { ...MWELL_OPERATING_PROFILE, status: 'draft' })).toThrow(/active Mwell operating/i);
    expect(() => routeFromLegacy(
      'rfq',
      'goods',
      10_000,
      { ...MWELL_OPERATING_PROFILE, relationship: 'parent_source' },
    )).toThrow(/active Mwell operating/i);
  });

  it('keeps legacy projections deterministic without using amount as an RFQ/RFP switch', () => {
    const route = routeFromLegacy('rfq', 'goods', 1_500_000, MWELL_OPERATING_PROFILE);
    expect(route).toMatchObject({
      solicitationType: 'rfq',
      procurementMode: 'competitive_bidding',
      governanceTier: 'formal_bid',
    });
    expect(legacySourcingMethod(route)).toBe('rfq');
  });

  it.each([
    'petty_cash',
    'small_purchase',
    'rfq',
    'rfp',
    'direct_award',
    'repeat_order',
    'emergency',
  ] as const)('round-trips legacy %s without semantic loss', (method) => {
    const route = routeFromLegacy(method, 'goods', 50_000, MWELL_OPERATING_PROFILE);
    expect(route.legacySourcingMethod).toBe(method);
    expect(legacySourcingMethod(route)).toBe(method);
  });

  it.each([
    ['complex', { complex: true }, 'risk:complex'],
    ['technical', { technical: true }, 'risk:technical'],
    ['strategic', { strategic: true }, 'risk:strategic'],
    ['high risk', { highRisk: true }, 'risk:high_risk'],
    ['data sensitivity', { dataSensitive: true }, 'risk:data_sensitive'],
    ['importation', { importation: true }, 'risk:importation'],
  ] as const)('records the %s governance trigger', (_name, input, expectedReason) => {
    const route = deriveProcurementRoute({
      requirementKind: 'services',
      category: 'services',
      amount: 50_000,
      ...input,
    }, MWELL_OPERATING_PROFILE).route;
    expect(route.governanceTier).toBe('high_risk');
    expect(route.reasons).toEqual(expect.arrayContaining([
      'service_requirement',
      expectedReason,
      'mode:competitive_bidding',
      'tier:high_risk',
    ]));
  });

  it('retains each applicable risk trigger on a multi-risk route', () => {
    const route = deriveProcurementRoute({
      requirementKind: 'services',
      complex: true,
      dataSensitive: true,
      importation: true,
    }, MWELL_OPERATING_PROFILE).route;
    expect(route.reasons).toEqual(expect.arrayContaining([
      'risk:complex',
      'risk:data_sensitive',
      'risk:importation',
    ]));
  });

  it.each(['marketing', 'medical', 'capex', 'other'] as const)(
    'places an ambiguous legacy %s category in remediation review',
    (category) => {
      expect(routeFromLegacy('rfq', category, 50_000, MWELL_OPERATING_PROFILE).reasons).toContain(
        'legacy_mapping_requires_review',
      );
    },
  );
});
