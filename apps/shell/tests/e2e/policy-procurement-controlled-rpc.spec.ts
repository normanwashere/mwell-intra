import { expect, test, type Page } from '@playwright/test';
import {
  actor,
  ControlledProcurementRpcFixture,
  installControlledRpc,
} from '../helpers/controlled-procurement-rpc';

type ActorKey = 'deptHead' | 'finance' | 'unrelated';

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

test('DOA variance reviewers enter only their exact governed request on desktop and mobile', async ({ browser }) => {
  const fixture = new ControlledProcurementRpcFixture();
  fixture.preparePendingVariance();
  const requestPath = `/procurement/requests/${fixture.requestId}`;

  const departmentContext = await browser.newContext();
  await installControlledRpc(departmentContext, fixture, 'deptHead');
  const departmentPage = await departmentContext.newPage();
  await signIn(departmentPage, fixture, 'deptHead', requestPath);
  await expectRestrictedSurface(departmentPage);
  await expect(departmentPage.getByText('Variance review: Department Head')).toBeVisible();
  await departmentPage.goto('/procurement/requests/new');
  await expect(departmentPage.getByRole('heading', { name: 'No procurement access' })).toBeVisible();
  await departmentPage.goto('/admin/doa');
  await expect(departmentPage.getByRole('heading', { name: 'Procurement policy profiles' })).toHaveCount(0);
  await departmentPage.goto(requestPath);
  await departmentPage.getByLabel('Variance approval note').fill('Department Head confirms the documented operating variance.');
  await departmentPage.getByRole('button', { name: 'Record Department Head approval' }).click();
  await expect(departmentPage.getByText('Variance Department Head decision recorded')).toBeVisible();
  await departmentContext.close();

  const financeContext = await browser.newContext();
  await installControlledRpc(financeContext, fixture, 'finance');
  const financePage = await financeContext.newPage();
  await signIn(financePage, fixture, 'finance', requestPath);
  await expectRestrictedSurface(financePage);
  await expect(financePage.getByText('Variance review: Finance')).toBeVisible();
  await financePage.goto('/procurement');
  await expect(financePage.getByRole('heading', { name: 'No procurement access' })).toBeVisible();
  await financePage.goto(requestPath);
  await financePage.getByLabel('Variance approval note').fill('Finance confirms the evidence and active authority.');
  await financePage.getByRole('button', { name: 'Record Finance approval' }).click();
  await expect(financePage.getByText('Variance Finance decision recorded')).toBeVisible();
  await financeContext.close();

  const unrelatedContext = await browser.newContext();
  await installControlledRpc(unrelatedContext, fixture, 'unrelated');
  const unrelatedPage = await unrelatedContext.newPage();
  await signIn(unrelatedPage, fixture, 'unrelated', requestPath);
  await expect(unrelatedPage.getByRole('heading', { name: 'No procurement access' })).toBeVisible();
  await expect(unrelatedPage.getByText('Variance review:')).toHaveCount(0);
  await unrelatedContext.close();

  expect(fixture.callsNamed('review_recommendation_variance').map((call) => call.actor)).toEqual([
    'controlled-department-head',
    'controlled-finance',
  ]);
  expect(fixture.callsNamed('evaluation_workspace').some((call) => call.actor === 'controlled-unrelated')).toBe(true);
});
