import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { actor, ControlledProcurementRpcFixture, installControlledRpc } from '../helpers/controlled-procurement-rpc';

type Task9Actor = 'vendor' | 'unrelatedVendor' | 'procurement';
type Task9Phase = (
  actorKey: Task9Actor,
  fixture: ControlledProcurementRpcFixture,
  run: (page: Page) => Promise<void>,
) => Promise<void>;

const test = base.extend<{ task9Phase: Task9Phase }>({
  task9Phase: [async ({ browser }, use, testInfo) => {
    const contexts: { actorKey: Task9Actor; context: BrowserContext }[] = [];
    const timed = async (phase: string, run: () => Promise<void>) => {
      const startedAt = Date.now();
      let status = 'failed';
      console.log(`Task 9 ${testInfo.project.name}: ${phase} started`);
      try {
        await base.step(phase, run);
        status = 'passed';
      } finally {
        console.log(`Task 9 ${testInfo.project.name}: ${phase} ${status} (${Date.now() - startedAt}ms)`);
      }
    };

    const failures: unknown[] = [];
    try {
      await use((actorKey, fixture, run) => timed(`${actorKey} workflow`, async () => {
        const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
        contexts.push({ actorKey, context });
        await installControlledRpc(context, fixture, actorKey);
        await run(await context.newPage());
      }));
    } catch (error) {
      failures.push(error);
    }
    // Runner-owned trace finalization belongs to fixture cleanup, not the 30s workflow budget.
    const results = await Promise.allSettled(contexts.map(({ actorKey, context }) =>
      timed(`${actorKey} cleanup`, () => context.close()),
    ));
    failures.push(...results.flatMap(result => result.status === 'rejected' ? [result.reason] : []));
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Task 9 workflow or actor context cleanup failed');
  }, { timeout: 30_000 }],
});

async function signIn(page: Page, actorKey: Task9Actor) {
  const destination = actorKey === 'procurement' ? '/procurement/purchase-orders/controlled-po-task-9' : '/vendor/purchase-orders';
  await page.goto(`/login?redirect=${encodeURIComponent(destination)}`);
  await page.getByLabel('Email').fill(actor(actorKey).email);
  await page.getByLabel('Password').fill('Controlled-Rpc-Only-2026!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toHaveCount(0);
}

test('Task 9 controlled lifecycle covers vendor acknowledgement, procurement delivery, monitoring, and quality recovery', async ({ task9Phase }, testInfo) => {
  const fixture = new ControlledProcurementRpcFixture();
  fixture.prepareTask9PurchaseOrder();

  await task9Phase('vendor', fixture, async vendor => {
    await signIn(vendor, 'vendor');
    await expect(vendor.getByRole('main', { name: 'Vendor PO acknowledgements' })).toBeVisible();
    const acknowledge = vendor.getByRole('button', { name: 'Acknowledge revision 2', exact: true });
    await expect(acknowledge).toBeDisabled();
    await vendor.getByLabel('Acknowledgement reference for PO-CONTROLLED-009').fill('ACK-CONTROLLED-009');
    await expect(acknowledge).toBeDisabled();
    await vendor.getByText('Read purchase order', { exact: true }).click();
    await expect(vendor.getByText('Controlled clinical supply', { exact: true })).toBeVisible();
    await expect(vendor.getByText('Expected delivery: 2026-09-01', { exact: true })).toBeVisible();
    await expect(acknowledge).toBeEnabled();
    await acknowledge.click();
    await expect(vendor.getByText('acknowledged', { exact: true })).toBeVisible();
    await expect(vendor.getByText('Revision 3', { exact: true })).toBeVisible();
    const [ackCall] = fixture.callsNamed('acknowledge_purchase_order');
    expect(fixture.callsNamed('acknowledge_purchase_order')).toHaveLength(1);
    expect(ackCall).toMatchObject({ actor: actor('vendor').id, schema: 'procurement', payload: {
      purchase_order_id: 'controlled-po-task-9', expected_revision: 2,
      acknowledgement_reference: 'ACK-CONTROLLED-009', document_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    } });
    await vendor.reload();
    await expect(vendor.getByText('acknowledged', { exact: true })).toBeVisible();
    await expect(vendor.getByRole('button', { name: /^Acknowledge revision/ })).toHaveCount(0);
    await vendor.screenshot({ path: testInfo.outputPath(`task-9-controlled-vendor-ack-${testInfo.project.name}.png`), fullPage: true });
  });

  await task9Phase('unrelatedVendor', fixture, async unrelatedVendor => {
    await signIn(unrelatedVendor, 'unrelatedVendor');
    await expect(unrelatedVendor.getByText('No issued purchase orders require acknowledgement.')).toBeVisible();
  });

  await task9Phase('procurement', fixture, async procurement => {
    await signIn(procurement, 'procurement');
    await expect(procurement.getByRole('region', { name: 'PO commitment readiness' })).toBeVisible();
    await procurement.getByLabel('Vendor delivery notice reference').fill('DELIVERY-CONTROLLED-009');
    await procurement.getByRole('button', { name: 'Record delivery notice' }).click();
    await expect(procurement.getByText('Delivery notice recorded')).toBeVisible();
    await expect(procurement.getByText('Maintain vendor notice, RMA, credit, and payment hold')).toBeVisible();
    await procurement.screenshot({ path: testInfo.outputPath(`task-9-controlled-quality-recovery-${testInfo.project.name}.png`), fullPage: true });
  });
});
