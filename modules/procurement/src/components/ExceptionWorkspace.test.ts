import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/ExceptionWorkspace.tsx'), 'utf8');

it('uses the server workspace and versioned public commands instead of client approval claims', () => {
  expect(source).toContain("call('exception_workspace'");
  expect(source).toContain("call('submit_policy_exception_pack'");
  expect(source).toContain("call('review_policy_exception_pack'");
  expect(source).toContain('expected_route_version: expectedRouteVersion');
  expect(source).toContain('expected_revision: workspace.pack?.revision');
  expect(source).toContain('canProcurementReview');
  expect(source).toContain('canFinanceReview');
  expect(source).toContain('canDoaReview');
  expect(source).not.toContain('MWELL_OPERATING_PROFILE');
});

it('keeps reviewer controls role-specific and gives failures a recovery path', () => {
  expect(source).toContain('Your available stage is assigned by the live role and active DOA record');
  expect(source).toContain('Server blockers');
  expect(source).toContain('workspace.recovery');
  expect(source).toContain('Decision history');
  expect(source).toContain('Refresh exception workspace');
  expect(source).toContain('Replace stale exception evidence');
  expect(source).toContain('staleBinding');
});
