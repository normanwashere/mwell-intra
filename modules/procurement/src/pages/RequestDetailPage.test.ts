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

it('renders the authoritative exception workspace for non-competitive routes', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/RequestDetailPage.tsx'), 'utf8');
  expect(source).toContain('ExceptionWorkspace');
  expect(source).toContain('aria-label="Governed exception workspace"');
  expect(source).toContain('expectedRouteVersion={displayedRoute.routeVersion ?? req.route?.routeVersion ?? 0}');
  expect(source).not.toContain('evaluateProcurementException');
});

it('keeps an unavailable request deep link in place and gives the user a recovery path', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/pages/RequestDetailPage.tsx'), 'utf8');

  expect(source).not.toContain('if (!req) return <Navigate to="/" replace />');
  expect(source).toContain('title="Request not available"');
  expect(source).toContain('The request may not exist, or your account may not be authorized to view it.');
  expect(source).toContain('to="/requests"');
});
