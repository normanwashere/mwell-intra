import { describe, expect, it } from 'vitest';
import { mapProcurementRequest } from './localStore';

describe('mapProcurementRequest', () => {
  it('maps governed route axes while retaining the legacy projection for old consumers', () => {
    const request = mapProcurementRequest({
      id: 'req-route-001',
      title: 'Formal device restock',
      status: 'draft',
      created_at: '2026-08-22T00:00:00.000Z',
      solicitation_type: 'rfq',
      procurement_mode: 'competitive_bidding',
      governance_tier: 'formal_bid',
      policy_profile_id: 'profile-mwell-2026',
      route_reasons: ['material_requirement', 'tier:formal_bid'],
      sourcing_method: 'rfq',
    } as never);

    expect(request.route).toEqual({
      solicitationType: 'rfq',
      procurementMode: 'competitive_bidding',
      governanceTier: 'formal_bid',
      policyProfileId: 'profile-mwell-2026',
      reasons: ['material_requirement', 'tier:formal_bid'],
      legacySourcingMethod: 'rfq',
      confirmedAt: undefined,
      confirmedByEmail: undefined,
    });
    expect(request.sourcingMethod).toBe('rfq');
  });

  it('does not manufacture an authority route from a legacy-only row', () => {
    const request = mapProcurementRequest({
      id: 'req-legacy-001',
      title: 'Legacy request',
      status: 'draft',
      created_at: '2026-08-22T00:00:00.000Z',
      sourcing_method: 'small_purchase',
    } as never);

    expect(request.route).toBeUndefined();
    expect(request.sourcingMethod).toBe('small_purchase');
  });
});
