import { expect, test } from '@playwright/test';
import {
  actor,
  ControlledProcurementRpcFixture,
  installControlledRpc,
} from '../helpers/controlled-procurement-rpc';

async function signIn(page: import('@playwright/test').Page, fixture: ControlledProcurementRpcFixture, actorKey: 'procurement' | 'admin' | 'legal' | 'operations' | 'deptHead' | 'finance', redirect: string) {
  await page.goto(`/login?redirect=${encodeURIComponent(redirect)}`);
  await page.getByLabel('Email').fill(actor(actorKey).email);
  await page.getByLabel('Password').fill('Controlled-Rpc-Only-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(250);
  if (await page.getByRole('heading', { name: 'Sign in' }).isVisible()) {
    throw new Error(`Controlled sign-in did not redirect: ${await page.getByRole('alert').allTextContents()} calls=${JSON.stringify(fixture.calls)}`);
  }
}

test('stateful controlled RPC covers procurement confirmation, sourcing, submission, and policy maker-checker lifecycle', async ({ browser }) => {
  const fixture = new ControlledProcurementRpcFixture();

  const procurementContext = await browser.newContext();
  await installControlledRpc(procurementContext, fixture, 'procurement');
  const procurementPage = await procurementContext.newPage();
  await signIn(procurementPage, fixture, 'procurement', `/procurement/requests/${fixture.requestId}`);
  await expect(procurementPage.getByRole('heading', { name: 'Controlled route and sourcing verification' })).toBeVisible();

  await procurementPage.getByRole('button', { name: 'Confirm procurement route' }).click();
  await expect(procurementPage.getByText('Sourcing route confirmed')).toBeVisible();
  expect(fixture.callsNamed('confirm_route_decision')).toContainEqual({
    actor: 'controlled-procurement',
    schema: 'procurement',
    name: 'confirm_route_decision',
    payload: {
      request_id: fixture.requestId,
      expected_route_version: 0,
      requested_mode: 'competitive_bidding',
    },
  });
  expect(fixture.request.compliance).toMatchObject({ routeConfirmed: true });
  expect(fixture.request.route_version).toBe(1);

  await procurementPage.reload();
  await expect(procurementPage.getByLabel('Confirmed procurement route')).toContainText('MWELL-CONTROLLED-OPERATING 2026.08');
  await expect(procurementPage.getByLabel('Confirmed procurement route')).toContainText('effective 2026-08-01');
  await expect(procurementPage.getByLabel('Confirmed procurement route')).toContainText(`ID ${fixture.activeProfileId}`);
  expect(fixture.callsNamed('read:requests').length).toBeGreaterThanOrEqual(2);

  await procurementPage.getByLabel('Submission deadline').fill('2026-09-30T12:00');
  await procurementPage.getByLabel('Package version').fill('RFQ-CONTROLLED-v1');
  await procurementPage.getByLabel('Package SHA-256').fill('a'.repeat(64));
  await procurementPage.getByRole('button', { name: 'Create plan' }).click();
  await expect(procurementPage.getByText('Sourcing plan created')).toBeVisible();
  for (const vendorId of ['vendor-1', 'vendor-2', 'vendor-3']) {
    await procurementPage.getByLabel('Vendor to invite').selectOption(vendorId);
    await procurementPage.getByRole('button', { name: 'Record invitation' }).click();
  }
  await procurementPage.getByRole('button', { name: 'Issue controlled package' }).click();
  await procurementPage.getByLabel('Clarification question').fill('Confirm the required warranty period.');
  await procurementPage.getByLabel('Approved answer').fill('Provide a minimum 12-month warranty.');
  await procurementPage.getByRole('button', { name: 'Broadcast identical clarification' }).click();
  await expect(procurementPage.getByText('Clarification broadcast to every invitee')).toBeVisible();
  for (const [index, vendorId] of ['vendor-1', 'vendor-2', 'vendor-3'].entries()) {
    await procurementPage.getByLabel('Invited vendor').selectOption(vendorId);
    await procurementPage.getByLabel('Proposal evidence reference').fill(`controlled-proposal-${index + 1}.pdf`);
    await procurementPage.getByLabel('Quoted amount').fill(String(200_000 + index * 10_000));
    await procurementPage.getByLabel('Technical score (0-100)').fill(String(90 - index));
    await procurementPage.getByRole('button', { name: 'Record response' }).click();
  }
  await procurementPage.getByRole('button', { name: 'Close response window' }).click();
  await procurementPage.getByRole('button', { name: 'Open controlled evaluation' }).click();
  await procurementPage.getByLabel('Tabulation evidence reference').fill('controlled-commercial-tabulation-v1.pdf');
  await procurementPage.getByLabel('Commercial comparison notes').fill('Three compliant commercial responses were compared against the controlled package.');
  await procurementPage.getByRole('button', { name: 'Save commercial tabulation' }).click();
  await expect(procurementPage.getByText('Commercial tabulation submitted for the governed record')).toBeVisible();
  const criterionLabels = ['Technical compliance', 'Quality', 'Lead time', 'Total lifecycle cost', 'Warranty and support', 'Support', 'Price', 'Payment terms', 'Training'];
  for (const [index, vendorId] of ['vendor-1', 'vendor-2', 'vendor-3'].entries()) {
    const score = String(90 - index * 10);
    await procurementPage.getByLabel('Technical evaluation vendor').selectOption(vendorId);
    await procurementPage.getByLabel('Technical evidence reference').fill(`controlled-technical-${vendorId}.pdf`);
    await procurementPage.getByLabel('Technical review comments').fill(`Controlled technical evidence for ${vendorId}.`);
    for (const criterion of criterionLabels) await procurementPage.getByLabel(`${criterion} score`, { exact: true }).fill(score);
    await procurementPage.getByRole('button', { name: 'Submit technical evaluation' }).click();
    await expect(procurementPage.getByText('Technical evaluation submitted with evidence')).toBeVisible();
  }
  await procurementPage.getByLabel('Best-value recommended vendor').selectOption('vendor-2');
  await procurementPage.getByLabel('Risk evidence reference').fill('controlled-risk-review-v1.pdf');
  await procurementPage.getByLabel('Best-value rationale').fill('North Star offers the governed best-value balance with complete commercial, technical, and risk evidence.');
  await procurementPage.getByLabel('Written variance justification').fill('Lifecycle cost and contracted support outweigh the higher technical score, with documented evidence.');
  await procurementPage.getByRole('button', { name: 'Submit recommendation' }).click();
  await expect(procurementPage.getByText('Variance recommendation submitted for independent approval')).toBeVisible();
  await expect(procurementPage.getByRole('button', { name: 'Record controlled award' })).toHaveCount(0);
  await procurementContext.close();

  const departmentContext = await browser.newContext();
  await installControlledRpc(departmentContext, fixture, 'deptHead');
  const departmentPage = await departmentContext.newPage();
  await signIn(departmentPage, fixture, 'deptHead', `/procurement/requests/${fixture.requestId}`);
  await expect(departmentPage.getByText('Variance review: Department Head')).toBeVisible();
  await departmentPage.getByLabel('Variance approval note').fill('Department Head confirms the documented operating variance.');
  await departmentPage.getByRole('button', { name: 'Record Department Head approval' }).click();
  await expect(departmentPage.getByText('Variance Department Head decision recorded')).toBeVisible();
  await departmentContext.close();

  const financeContext = await browser.newContext();
  await installControlledRpc(financeContext, fixture, 'finance');
  const financePage = await financeContext.newPage();
  await signIn(financePage, fixture, 'finance', `/procurement/requests/${fixture.requestId}`);
  await expect(financePage.getByText('Variance review: Finance')).toBeVisible();
  await financePage.getByLabel('Variance approval note').fill('Finance confirms the evidence and active authority.');
  await financePage.getByRole('button', { name: 'Record Finance approval' }).click();
  await expect(financePage.getByText('Variance Finance decision recorded')).toBeVisible();
  await financeContext.close();

  const awardContext = await browser.newContext();
  await installControlledRpc(awardContext, fixture, 'procurement');
  const awardPage = await awardContext.newPage();
  await signIn(awardPage, fixture, 'procurement', `/procurement/requests/${fixture.requestId}`);
  await awardPage.getByRole('button', { name: 'Record controlled award' }).click();
  await expect(awardPage.getByText('Sourcing award recorded')).toBeVisible();
  expect(fixture.sourcing).toMatchObject({ status: 'awarded', selectedVendorId: 'vendor-2' });
  expect(fixture.sourcing?.responses.filter((response) => response.receivedAt)).toHaveLength(3);
  expect(fixture.callsNamed('save_sourcing_event')).toHaveLength(1);
  expect(fixture.callsNamed('invite_sourcing_vendors')).toHaveLength(3);
  expect(fixture.callsNamed('record_sourcing_response')).toHaveLength(3);
  expect(fixture.callsNamed('save_commercial_tabulation')).toHaveLength(1);
  expect(fixture.callsNamed('submit_technical_evaluation')).toHaveLength(3);
  expect(fixture.callsNamed('submit_award_recommendation')).toHaveLength(1);
  expect(fixture.callsNamed('record_solicitation_communication').at(-1)).toMatchObject({
    payload: { communication_type: 'clarification' },
  });
  expect(fixture.callsNamed('transition_sourcing_event').map((call) => call.payload.action)).toEqual(['issue', 'response_closed', 'evaluation', 'award']);

  fixture.sourcing!.status = 'failed_bid';
  await awardPage.reload();
  await awardPage.getByLabel('Requote deadline').fill('2026-10-07T12:00');
  await awardPage.getByLabel('Requote package version').fill('RFQ-CONTROLLED-v2');
  await awardPage.getByLabel('Requote package SHA-256').fill('b'.repeat(64));
  await awardPage.getByLabel('Vendor to invite').selectOption('vendor-4');
  await awardPage.getByRole('button', { name: 'Source and requote' }).click();
  await expect(awardPage.getByText('Additional vendor sourced and equal requote issued')).toBeVisible();
  expect(fixture.callsNamed('transition_sourcing_event').at(-1)).toMatchObject({ payload: { action: 'source_additional_and_requote', vendor_id: 'vendor-4' } });
  fixture.sourcing!.status = 'awarded';
  fixture.sourcing!.selectedVendorId = 'vendor-2';
  await awardPage.reload();

  await awardPage.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(awardPage.getByText('Request submitted for approval')).toBeVisible();
  expect(fixture.callsNamed('submit_request')).toContainEqual({
    actor: 'controlled-procurement',
    schema: 'procurement',
    name: 'submit_request',
    payload: { id: fixture.requestId },
  });
  expect(fixture.request.status).toBe('submitted');
  await awardContext.close();

  const adminContext = await browser.newContext();
  await installControlledRpc(adminContext, fixture, 'admin');
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, fixture, 'admin', '/admin/doa');
  await expect(adminPage.getByRole('heading', { name: 'Procurement policy profiles' })).toBeVisible();
  await adminPage.getByLabel('Governed parent source profile').selectOption(fixture.parentProfileId);
  await adminPage.getByRole('region', { name: 'Procurement policy profiles' }).getByLabel('Effective date').fill('2026-09-01');
  await adminPage.getByLabel('Controlled document SHA-256').fill('a'.repeat(64));
  await adminPage.getByRole('button', { name: 'Save policy draft' }).click();
  await expect(adminPage.getByText('Procurement policy revision saved as a draft. A separate checker must activate it.')).toBeVisible();
  const saved = fixture.callsNamed('save_policy_profile').at(-1);
  expect(saved).toMatchObject({
    actor: 'controlled-admin',
    payload: { source_profile_id: fixture.parentProfileId },
  });
  expect(fixture.callsNamed('read:policy_profiles').length).toBeGreaterThan(0);
  await adminPage.getByRole('button', { name: 'Activate as checker' }).click();
  await expect(adminPage.getByText('A separate policy checker must activate the profile')).toBeVisible();
  expect(fixture.profileById('10000000-0000-4000-8000-000000000004')?.status).toBe('draft');
  await adminContext.close();

  const legalContext = await browser.newContext();
  await installControlledRpc(legalContext, fixture, 'legal');
  const legalPage = await legalContext.newPage();
  await signIn(legalPage, fixture, 'legal', '/admin/doa');
  await expect(legalPage.getByRole('heading', { name: 'Procurement policy profiles' })).toBeVisible();
  await legalPage.getByRole('button', { name: 'Resolve this conflict' }).click();
  await legalPage.getByLabel('Required rationale').fill('The operating mapping preserves the MPIC threshold and documents the local response timing rationale.');
  await legalPage.getByRole('button', { name: 'Record resolution' }).click();
  await expect(legalPage.getByText('Policy conflict resolved and recorded in immutable history.')).toBeVisible();
  await legalPage.getByRole('button', { name: 'Activate this draft as checker' }).click();
  await expect(legalPage.getByText('Policy profile activated by the checker. The prior active profile was retained as history.')).toBeVisible();
  await legalPage.reload();
  await expect(legalPage.getByText('MWELL-CONTROLLED-OPERATING-REV 2026.08-REV', { exact: true })).toBeVisible();
  await expect(legalPage.getByText('activated', { exact: true })).toBeVisible();
  await expect(legalPage.getByText('No unresolved policy conflicts.')).toBeVisible();
  expect(fixture.callsNamed('read:policy_conflicts').length).toBeGreaterThan(0);
  expect(fixture.callsNamed('read:policy_profile_events').length).toBeGreaterThan(0);
  expect(fixture.conflicts[0]?.status).toBe('resolved');
  expect(fixture.profileById('10000000-0000-4000-8000-000000000004')).toMatchObject({ status: 'active', activated_by: 'controlled-legal' });
  expect(fixture.callsNamed('resolve_policy_conflict').at(-1)).toMatchObject({ actor: 'controlled-legal', payload: { id: fixture.conflictId } });
  expect(fixture.callsNamed('activate_policy_profile').at(-1)).toMatchObject({ actor: 'controlled-legal', payload: { id: '10000000-0000-4000-8000-000000000004' } });
  await legalContext.close();

  const operationsContext = await browser.newContext();
  await installControlledRpc(operationsContext, fixture, 'operations');
  const operationsPage = await operationsContext.newPage();
  await signIn(operationsPage, fixture, 'operations', '/admin/doa');
  await expect(operationsPage).toHaveURL(/\/$/);
  await expect(operationsPage.getByRole('heading', { name: 'Your Intra workspace' })).toBeVisible();
  await expect(operationsPage.getByRole('heading', { name: 'Procurement policy profiles' })).toHaveCount(0);
  expect(fixture.callsNamed('save_policy_profile').filter((call) => call.actor === 'controlled-operations')).toHaveLength(0);
  await operationsContext.close();
});
