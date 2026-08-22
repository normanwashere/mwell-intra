import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { LEARNING_CATALOG, ROLE_CURRICULA } from '../../../../modules/learning/src/catalog';
import { DEMO_PROFILES } from '../../lib/demoProfiles';

const SESSION_KEY = 'intra.memory-session.v1';
const PO_KEY = 'intra.procurement.v2.purchase_orders';

const sessions = {
  requester: { profileId: 'demo-logistics', roles: { core: ['staff'], procurement: ['requester'] } },
  procurement: { profileId: 'demo-procurement', roles: { core: ['staff'], procurement: ['procurement_officer'] } },
  finance: { profileId: 'demo-procurement-finance', roles: { core: ['staff'], procurement: ['finance'] } },
} as const;

async function setSession(page: Page, session: (typeof sessions)[keyof typeof sessions]) {
  const profile = DEMO_PROFILES.find((candidate) => candidate.id === session.profileId);
  const roles = profile?.roles ?? session.roles;
  const learningKey = `intra.demo-learning.v1:${session.profileId}:${JSON.stringify(roles)}`;
  const roleKeys = new Set(Object.entries(roles).flatMap(([module, roleNames]) => roleNames.map((role) => `${module}:${role}`)));
  const requirementIds = new Set(ROLE_CURRICULA.filter((curriculum) => roleKeys.has(`${curriculum.module}:${curriculum.role}`)).flatMap((curriculum) => curriculum.requirementIds));
  const completedProgress = LEARNING_CATALOG.requirements.filter((requirement) => requirementIds.has(requirement.id)).map((requirement) => ({ assignmentRequirementId: `payment-journey:${requirement.id}`, requirementId: requirement.id, requirementVersion: requirement.version, state: 'passed', attemptCount: 1, allowsSharedCompletion: requirement.kind === 'orientation', completedAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z' }));
  await page.evaluate(
    ({ key, value, learningKey, completedProgress }) => {
      sessionStorage.setItem(key, JSON.stringify(value));
      sessionStorage.setItem(learningKey, JSON.stringify({ progress: completedProgress, completedCheckpoints: {} }));
    },
    { key: SESSION_KEY, value: { profileId: session.profileId, roles }, learningKey, completedProgress },
  );
}

test('PO acceptance and Finance readiness persist across the governed role flow', async ({ page }, testInfo) => {
  await page.goto('/');
  await setSession(page, sessions.procurement);
  await page.goto('/procurement/purchase-orders');
  await expect.poll(() => page.evaluate((key) => {
    const rows = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown[];
    return rows.length;
  }, PO_KEY)).toBeGreaterThan(0);
  const poId = await page.evaluate((key) => {
    const rows = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{ id: string; vendorName: string; status: string }>;
    return rows.find((row) => row.vendorName.includes('Acme') && row.status === 'issued' && row.total === 1600000)?.id;
  }, PO_KEY);
  expect(poId).toBeTruthy();
  await page.evaluate(({ poKey, requesterId }) => {
    const purchaseOrders = JSON.parse(localStorage.getItem(poKey) ?? '[]') as Array<{ id: string; requestId?: string; commitmentReadiness?: unknown; lines?: Array<{ id: string }>; receiptStatus?: Record<string, unknown> }>;
    const purchaseOrder = purchaseOrders.find((row) => row.id === requesterId);
    const requestId = purchaseOrder?.requestId;
    if (purchaseOrder) purchaseOrder.commitmentReadiness = {
      ready: true,
      phase: 'issue',
      requestId: requestId ?? '',
      blockers: [],
      evidence: [],
      protections: [],
      requirements: [],
      canRecordAcceptance: true,
    };
    if (purchaseOrder?.lines?.[0]) {
      purchaseOrder.receiptStatus = {
        ...(purchaseOrder.receiptStatus ?? {}),
        acceptedLines: [{ poLineId: purchaseOrder.lines[0].id, acceptedQuantity: 120, rejectedOrQuarantinedQuantity: 0 }],
      };
    }
    const requests = JSON.parse(localStorage.getItem('intra.procurement.v2.requests') ?? '[]') as Array<{ id: string; requesterId?: string; requesterEmail?: string }>;
    const request = requests.find((row) => row.id === requestId);
    if (request) Object.assign(request, { requesterId: 'demo-logistics', requesterEmail: 'logistics@mwell.demo' });
    localStorage.setItem(poKey, JSON.stringify(purchaseOrders));
    localStorage.setItem('intra.procurement.v2.requests', JSON.stringify(requests));
  }, { poKey: PO_KEY, requesterId: poId });
  await setSession(page, sessions.requester);
  await page.goto(`/procurement/purchase-orders/${poId}`);

  await expect(page.getByRole('heading', { name: 'Acceptance and payment readiness' })).toBeVisible();
  await expect(page.getByLabel(/QC-accepted quantity for ECG ring/)).toHaveValue('120');
  await page.getByRole('button', { name: 'Record technical acceptance' }).click();
  await expect(page.getByText('Technical acceptance recorded')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Active acceptance packs' })).toContainText('1 active acceptance pack');

  await setSession(page, sessions.procurement);
  await page.reload();
  await page.getByLabel('Invoice / SI number').fill('SI-UAT-0001');
  await page.getByLabel('Invoice amount').fill('960000');
  await page.getByLabel('Invoice date').fill('2026-08-04');
  await page.getByLabel('Due date').fill('2026-09-03');
  await page.getByLabel('Tax amount').fill('90000');
  await page.getByLabel('Withholding amount').fill('15000');
  await page.getByLabel('Invoice, OR, or SI private reference').fill('private/invoice-si.pdf');
  await page.getByLabel('Delivery or milestone private reference').fill('private/warehouse-acceptance.pdf');
  await page.getByLabel('Tax and withholding private reference').fill('private/tax-support.pdf');
  await page.getByRole('button', { name: 'Validate match and send to Finance' }).click();
  await expect(page.getByText('Payment evidence sent to Finance')).toBeVisible();

  await setSession(page, sessions.finance);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Accept for payment' })).toBeEnabled();
  await page.getByLabel('Finance review note').fill('Three-way match and tax support verified.');
  await page.getByRole('button', { name: 'Accept for payment' }).click();
  await expect(page.getByText('Payment pack accepted')).toBeVisible();
  await expect(page.getByText('Finance accepted')).toBeVisible();

  await page.getByLabel('Release amount').fill('300000');
  await page.getByLabel('Payment reference').fill('BANK-UAT-0001');
  await page.getByRole('button', { name: 'Post payment release' }).click();
  await expect(page.getByText('Payment release posted')).toBeVisible();
  await expect(page.getByText(/remaining.*660,000/i)).toBeVisible();

  await page.getByLabel('Release amount').fill('660000');
  await page.getByLabel('Payment reference').fill('BANK-UAT-0002');
  await page.getByRole('button', { name: 'Post payment release' }).click();
  await expect(page.getByText('Finance released')).toBeVisible();

  const persisted = await page.evaluate(({ key, id }) => {
    const rows = JSON.parse(localStorage.getItem(key) ?? '[]') as Array<{
      id: string;
      status: string;
      acceptancePack?: { acceptanceType: string; acceptedAmount?: number };
      paymentReadiness?: { status: string; invoiceNumber?: string; releasedAmount?: number };
    }>;
    return rows.find((row) => row.id === id);
  }, { key: PO_KEY, id: poId });
  expect(persisted?.acceptancePack).toMatchObject({ acceptanceType: 'goods' });
  expect(persisted?.paymentReadiness).toMatchObject({
    status: 'released',
    invoiceNumber: 'SI-UAT-0001',
    releasedAmount: 960000,
  });
  expect(persisted?.status).toBe('issued');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const evidenceDir = resolve(process.cwd(), '../../docs/qa/evidence');
  mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path: resolve(evidenceDir, `task-10-finance-recovery-${testInfo.project.name}.png`), fullPage: true });
});
