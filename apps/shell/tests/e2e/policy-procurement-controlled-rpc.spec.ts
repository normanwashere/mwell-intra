import { expect, test, type Page } from '@playwright/test';
import {
  actor,
  CONTROLLED_ANON_KEY,
  CONTROLLED_SUPABASE_URL,
  ControlledProcurementRpcFixture,
  installControlledRpc,
} from '../helpers/controlled-procurement-rpc';

type ActorKey = 'deptHead' | 'finance' | 'financeNoCapability' | 'unrelated';

async function signIn(page: Page, fixture: ControlledProcurementRpcFixture, actorKey: ActorKey, redirect: string) {
  await page.goto(`/login?redirect=${encodeURIComponent(redirect)}`);
  await page.getByLabel('Email').fill(actor(actorKey).email);
  await page.getByLabel('Password').fill('Controlled-Rpc-Only-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
}

async function expectRestrictedSurface(page: Page) {
  await expect(page.getByRole('heading', { name: 'Controlled route and sourcing verification' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Procurement sections' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirm procurement route' })).toHaveCount(0);
  await expect(page.getByText('Competitive sourcing', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Read-only request summary')).toBeVisible();
}

async function expectNoScopedWorkspace(page: Page) {
  await expect(page.getByRole('heading', { name: 'No procurement access' })).toBeVisible();
  await expect(page.getByLabel('Read-only request summary')).toHaveCount(0);
  await expect(page.getByText('Variance review:', { exact: false })).toHaveCount(0);
}

async function expectSourcingRpcDenied(page: Page, fixture: ControlledProcurementRpcFixture, actorKey: ActorKey) {
  const result = await page.evaluate(async ({ actorId, requestId, url, anonKey }) => {
    const response = await fetch(`${url}/rest/v1/rpc/sourcing_workspace`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer controlled-${actorId}`,
        'Content-Profile': 'procurement',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ payload: { request_id: requestId } }),
    });
    return { status: response.status, body: await response.json() as { message?: string } };
  }, {
    actorId: actor(actorKey).id,
    requestId: fixture.requestId,
    url: CONTROLLED_SUPABASE_URL,
    anonKey: CONTROLLED_ANON_KEY,
  });
  expect(result.status).toBe(403);
  expect(result.body.message).toMatch(/No procurement sourcing access is assigned/i);
}

test('DOA variance reviewers enter only their exact governed request on desktop and mobile', async ({ browser }) => {
  const fixture = new ControlledProcurementRpcFixture();
  fixture.preparePendingVariance();
  const requestPath = `/procurement/requests/${fixture.requestId}`;

  const outOfStageFinanceContext = await browser.newContext();
  await installControlledRpc(outOfStageFinanceContext, fixture, 'finance');
  const outOfStageFinancePage = await outOfStageFinanceContext.newPage();
  await signIn(outOfStageFinancePage, fixture, 'finance', requestPath);
  await expectNoScopedWorkspace(outOfStageFinancePage);
  await outOfStageFinanceContext.close();

  const departmentContext = await browser.newContext();
  await installControlledRpc(departmentContext, fixture, 'deptHead');
  const departmentPage = await departmentContext.newPage();
  await signIn(departmentPage, fixture, 'deptHead', requestPath);
  await expectRestrictedSurface(departmentPage);
  await expect(departmentPage.getByText('Variance review: Department Head')).toBeVisible();
  await departmentPage.goto('/procurement/requests/new');
  await expectNoScopedWorkspace(departmentPage);
  await departmentPage.goto(`${requestPath}/sourcing`);
  await expectNoScopedWorkspace(departmentPage);
  await expectSourcingRpcDenied(departmentPage, fixture, 'deptHead');
  await departmentPage.goto('/admin/doa');
  await expect(departmentPage.getByRole('heading', { name: 'Procurement policy profiles' })).toHaveCount(0);
  await departmentPage.goto(requestPath);
  await departmentPage.getByLabel('Variance approval note').fill('Department Head confirms the documented operating variance.');
  await departmentPage.getByRole('button', { name: 'Record Department Head approval' }).click();
  await expectNoScopedWorkspace(departmentPage);
  await departmentContext.close();

  const financeWithoutCapabilityContext = await browser.newContext();
  await installControlledRpc(financeWithoutCapabilityContext, fixture, 'financeNoCapability');
  const financeWithoutCapabilityPage = await financeWithoutCapabilityContext.newPage();
  await signIn(financeWithoutCapabilityPage, fixture, 'financeNoCapability', requestPath);
  await expectNoScopedWorkspace(financeWithoutCapabilityPage);
  await financeWithoutCapabilityContext.close();

  const financeContext = await browser.newContext();
  await installControlledRpc(financeContext, fixture, 'finance');
  const financePage = await financeContext.newPage();
  await signIn(financePage, fixture, 'finance', requestPath);
  await expectRestrictedSurface(financePage);
  await expect(financePage.getByText('Variance review: Finance')).toBeVisible();
  await financePage.goto('/procurement');
  await expectNoScopedWorkspace(financePage);
  await financePage.goto(`${requestPath}/sourcing`);
  await expectNoScopedWorkspace(financePage);
  await expectSourcingRpcDenied(financePage, fixture, 'finance');
  await financePage.goto(requestPath);
  await financePage.getByLabel('Variance approval note').fill('Finance confirms the evidence and active authority.');
  await financePage.getByRole('button', { name: 'Record Finance approval' }).click();
  await expectNoScopedWorkspace(financePage);
  await financeContext.close();

  const unrelatedContext = await browser.newContext();
  await installControlledRpc(unrelatedContext, fixture, 'unrelated');
  const unrelatedPage = await unrelatedContext.newPage();
  await signIn(unrelatedPage, fixture, 'unrelated', requestPath);
  await expectNoScopedWorkspace(unrelatedPage);
  await unrelatedContext.close();

  expect(fixture.callsNamed('review_recommendation_variance').map((call) => call.actor)).toEqual([
    'controlled-department-head',
    'controlled-finance',
  ]);
  expect(fixture.callsNamed('evaluation_workspace').some((call) => call.actor === 'controlled-unrelated')).toBe(true);
  expect(fixture.callsNamed('evaluation_workspace').some((call) => call.actor === 'controlled-finance-no-capability')).toBe(true);
  expect(fixture.callsNamed('review_recommendation_variance').some((call) => call.actor === 'controlled-finance-no-capability')).toBe(false);
});
