import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

it('sends only the governed route confirmation inputs and requires a re-confirmation after a server recomputation', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/RequestDetailPage.tsx'), 'utf8');

  expect(source).toContain('expected_route_version: displayedRoute?.routeVersion ?? 0');
  expect(source).toContain('requested_mode: requestedMode');
  expect(source).not.toContain('risk_facts: routeRiskFacts');
  expect(source).not.toContain('reasons: routeRecommendation.reasons');
  expect(source).toContain('The active policy recomputed this route. Review the returned route and confirm again.');
  expect(source).toContain('returnedRoutePayload.policy_profile_id !== displayedRoute.policyProfileId');
});

it('renders server-governed exception evidence and blockers for non-competitive routes', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/RequestDetailPage.tsx'), 'utf8');
  expect(source).toContain('Exception control status');
  expect(source).toContain('rechecked by the server at route confirmation, award, and PO issue');
  expect(source).toContain('evaluateProcurementException');
});
