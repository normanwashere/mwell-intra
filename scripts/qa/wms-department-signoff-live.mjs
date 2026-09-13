import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { auditPersonas } from './uat-audit-identities.mjs';

// Opening inventory is a synthetic prerequisite, never receiving/putaway evidence.
// Business transitions use authenticated users; privileged fixture SQL is separate.
const origin = 'https://mwell-intra-uat.vercel.app';
const project = 'kkoitlvydytdhlpxhuah';
const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const { chromium, expect: baseExpect } = require('@playwright/test');
const expect = baseExpect.configure({ timeout: 25000 });
const { createClient } = require('@supabase/supabase-js');
const command = process.argv[2];
let folder = path.resolve(process.argv[3] ?? `outputs/wms-signoff/${randomUUID()}`);
const manifestPath = path.join(folder, 'manifest.json');
const health = async (commit) => {
  const response = await fetch(origin + '/api/health', { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  assert(response.ok, 'UAT health request failed');
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.deployment.appEnv, 'uat');
  assert.equal(body.deployment.supabaseProjectRef, project);
  assert.match(body.commit, /^[a-f0-9]{40}$/);
  if (commit) assert.equal(body.commit, commit, 'UAT build changed during signoff');
  return body;
};

if (command === 'prepare') {
  const deployed = await health();
  const runId = randomUUID();
  const cases = ['desktop-1440', 'mobile-390'].map(viewport => {
    const prefix = `wms-${runId.slice(0, 8)}-${viewport}`;
    return { viewport, productId: prefix, productName: `WMS signoff ${viewport}`, locationId: `${prefix}-loc`,
      binId: `${prefix}-bin`, binCode: `WMS-${runId.slice(0, 8)}-${viewport}`, sku: prefix.toUpperCase(),
      requestId: randomUUID(), orderId: randomUUID(), openingQuantity: 10, requestedQuantity: 2 };
  });
  const manifest = { runId, origin, project, commit: deployed.commit, requiredDate: new Date().toISOString().slice(0, 10), fixturePurpose: 'Synthetic opening stock, not a procurement receipt.', cases };
  await mkdir(path.dirname(folder), { recursive: true });
  await mkdir(folder, { recursive: false });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' });
  const sql = cases.map(c => `insert into warehouse.locations(id,name,type) values('${c.locationId}','${c.productName}','warehouse');
insert into warehouse.storage_areas(id,location_id,code,label,zone) values('${c.binId}','${c.locationId}','${c.binCode}','${c.productName} isolated bin','WMS-SIGNOFF');
insert into warehouse.products(id,sku,name,category,serialized,attributes,unit_cost,item_class) values('${c.productId}','${c.sku}','${c.productName}','merchandise',false,'{"signoffRun":"${runId}","synthetic":true}',1,'merchandise');
insert into warehouse.stock_levels(product_id,location_id,bin_id,quantity) values('${c.productId}','${c.locationId}','${c.binId}',${c.openingQuantity});`).join('\n');
  await writeFile(path.join(folder, 'prepare.sql'), `-- UAT ${project} only. Unique inserts fail on collisions. No authority changes.\nbegin;\n${sql}\ncommit;\n`, { flag: 'wx' });
  console.log(JSON.stringify({ folder, manifestPath, commit: deployed.commit, next: 'Review and apply prepare.sql to the named UAT project, then run with this folder.' }));
} else if (command === 'run') {
  assert.equal(process.env.APP_ENV, 'uat');
  assert.equal(process.env.AUDIT_MUTATIONS, 'true');
  assert(process.env.AUDIT_PASSWORD, 'AUDIT_PASSWORD must be supplied securely');
  const m = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(m.origin, origin);
  assert.equal(m.project, project);
  assert.match(m.runId, /^[a-f0-9-]{36}$/);
  folder = path.join(folder, `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await mkdir(folder);
  const report = { runId: m.runId, commit: m.commit, startedAt: new Date().toISOString(),
    scope: 'Department fulfillment: authenticated request/approval API, real browser picking/packing/release/acknowledgment. Not receiving, ecommerce, returns, hardware or human acceptance.',
    synthetic: true, complete: false, cleanup: 'Independent SQL readback and exact-run cleanup required', checks: [], failures: [] };
  const persist = () => writeFile(path.join(folder, 'results.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(folder, 'results.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  const personas = auditPersonas('checkpoint-v1');
  const actors = {};
  let browser;
  try {
    report.health = await health(m.commit);
    for (const role of ['marketing_events_lead', 'operations_associate', 'operations_lead', 'general_employee']) {
      const persona = personas.find(p => p.role === role);
      assert(persona);
      const client = createClient(`https://${project}.supabase.co`, 'sb_publishable_7YRN3Sg0Cm8QRoDt6IszlA_yAuRD5u9', {
        auth: { persistSession: false, autoRefreshToken: true },
        global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([AbortSignal.timeout(20000), init?.signal].filter(Boolean)) }) },
      });
      const login = await client.auth.signInWithPassword({ email: persona.email, password: process.env.AUDIT_PASSWORD });
      assert(!login.error, `Login failed for ${role}`);
      actors[role] = { persona, client, id: login.data.user.id };
    }
    browser = await chromium.launch();
    const proofPage = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await proofPage.setContent('<body style="font:24px Arial;padding:40px;background:white;color:black"><h1>SYNTHETIC UAT EVIDENCE</h1><p>Automated WMS recipient acknowledgment.</p><p>No physical delivery or human acceptance is claimed.</p></body>');
    const proof = await proofPage.screenshot();
    await writeFile(path.join(folder, 'synthetic-acknowledgment.png'), proof);
    await proofPage.close();
    for (const c of m.cases) {
      const contexts = [];
      const pages = {};
      let activePage;
      try {
        const read = async (table, column, id, actor = 'operations_lead') => {
          const result = await actors[actor].client.schema('warehouse').from(table).select('*').eq(column, id);
          assert(!result.error, `${table} readback: ${result.error?.message}`);
          return result.data;
        };
        const order = async () => {
          const rows = await read('fulfillment_orders', 'id', c.orderId);
          assert.equal(rows.length, 1, 'Exactly one run-owned order is required');
          return rows[0];
        };
        const inventory = async () => {
          const stock = await read('stock_levels', 'product_id', c.productId);
          const movements = await read('movements', 'product_id', c.productId);
          const reservations = await read('fulfillment_reservations', 'order_id', c.orderId);
          return { stock, movements, reservations };
        };
        const rpc = (actor, name, payload) => actors[actor].client.schema('warehouse').rpc(name, { payload });
        const negative = async (actor, name, payload, expected) => {
          const before = { order: await order(), inventory: await inventory() };
          const result = await rpc(actor, name, payload);
          assert(result.error, `${name} unexpectedly allowed`);
          assert.match(result.error.message, expected);
          assert.deepEqual({ order: await order(), inventory: await inventory() }, before, 'Denied command mutated order or inventory');
          report.checks.push({ viewport: c.viewport, checkpoint: payload.action ?? name, kind: 'negative-api', actor: actors[actor].id, passed: true, error: result.error.message, unchanged: true });
          await persist();
        };
        const pageFor = async role => {
          if (!pages[role]) {
            const mobile = c.viewport.startsWith('mobile');
            const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1440, height: mobile ? 844 : 900 },
              isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', reducedMotion: 'reduce' });
            contexts.push(context);
            const page = await context.newPage();
            activePage = page;
            page.setDefaultTimeout(25000);
            await page.goto(origin + '/login?redirect=%2Fwarehouse%2Ffulfillment');
            await page.locator('#email').fill(actors[role].persona.email);
            await page.locator('#password').fill(process.env.AUDIT_PASSWORD);
            await page.getByRole('button', { name: /^sign in$/i }).click();
            await page.waitForURL(url => url.pathname !== '/login');
            pages[role] = page;
          }
          activePage = pages[role];
          return pages[role];
        };
        const capture = async (page, checkpoint, actor, state, kind = 'ui') => {
          const file = `${c.viewport}-${report.checks.length}-${checkpoint}.png`;
          const geometry = await page.evaluate(() => ({ width: innerWidth, contentWidth: document.documentElement.scrollWidth }));
          await page.screenshot({ path: path.join(folder, file), fullPage: true });
          report.checks.push({ viewport: c.viewport, checkpoint, kind, actor: actors[actor].id, passed: true,
            route: page.url(), screenshot: file, geometry, readback: state });
          await persist();
          assert(geometry.contentWidth <= geometry.width + 1, `${checkpoint} horizontal overflow`);
        };
        const queue = async role => {
          const page = await pageFor(role);
          await page.goto(`${origin}/warehouse/fulfillment?tab=orders&status=all&q=${encodeURIComponent(`REQ-${c.requestId}`)}`);
          const card = page.getByRole('listitem', { name: `Order REQ-${c.requestId}`, exact: true });
          await expect(card).toBeVisible();
          return { page, card };
        };
        const opening = await inventory();
        assert.equal(opening.stock.reduce((sum, row) => sum + row.quantity, 0), c.openingQuantity);
        assert.equal(opening.movements.length, 0, 'Fixture already used');
        const existing = await read('department_stock_requests', 'id', c.requestId);
        if (existing.length) {
          assert(process.argv.includes('--resume-approved'), 'Existing request requires explicit --resume-approved');
          assert.equal(existing.length, 1);
          assert.equal(existing[0].purpose, `Synthetic WMS signoff ${m.runId}`);
          assert.equal(existing[0].requested_by, actors.marketing_events_lead.id);
          assert.equal(existing[0].approved_by, actors.operations_lead.id);
          assert.equal(existing[0].fulfillment_order_id, c.orderId);
          assert.equal((await order()).status, 'received', 'Resume is only allowed before allocation');
        }
        const request = await rpc('marketing_events_lead', 'create_department_stock_request', {
          request_id: c.requestId, idempotency_key: `${m.runId}-${c.viewport}-request`, requesting_department: 'marketing',
          cost_center: 'CC-4100', required_date: m.requiredDate ?? existing[0]?.required_date ?? new Date().toISOString().slice(0, 10), purpose: `Synthetic WMS signoff ${m.runId}`,
          expense_treatment: 'expense', lines: [{ productId: c.productId, quantity: c.requestedQuantity }],
        });
        assert(!request.error, request.error?.message);
        assert.equal(request.data.status, 'pending_approval');
        const approved = await rpc('operations_lead', 'decide_department_stock_request', {
          request_id: c.requestId, fulfillment_order_id: c.orderId, decision: 'approved', idempotency_key: `${m.runId}-${c.viewport}-approve`,
        });
        assert(!approved.error, approved.error?.message);
        assert.equal(approved.data.fulfillment_order_id, c.orderId);
        report.checks.push({ viewport: c.viewport, checkpoint: 'request-approved', kind: 'authenticated-api', passed: true,
          requester: actors.marketing_events_lead.id, actor: actors.operations_lead.id,
          readback: (await read('department_stock_requests', 'id', c.requestId))[0] });
        const { page, card } = await queue('operations_associate');
        await capture(page, 'warehouse-handover', 'operations_associate', await order());
        await negative('general_employee', 'advance_fulfillment_order', { order_id: c.orderId, action: 'allocate', idempotency_key: `${m.runId}-${c.viewport}-deny-requester` }, /Not authorized/);
        for (const [button, expected] of [['Allocate stock', 'allocated'], ['Start picking', 'picking']]) {
          await card.getByRole('button', { name: button, exact: true }).click();
          await expect.poll(async () => (await order()).status).toBe(expected);
          await capture(page, expected, 'operations_associate', await order());
        }
        await card.getByRole('button', { name: 'Confirm scanned pick', exact: true }).click();
        const pick = page.getByRole('dialog');
        await expect(pick).toBeVisible();
        await pick.getByLabel(`Scanned bin code for ${c.productName}`, { exact: true }).fill('WRONG-BIN');
        await pick.getByRole('button', { name: 'Use bin', exact: true }).click();
        await expect(pick.getByRole('alert')).toContainText('Wrong source bin');
        assert.equal((await order()).status, 'picking');
        await capture(page, 'wrong-bin-denied', 'operations_associate', await order());
        await pick.getByLabel(`Scanned bin code for ${c.productName}`, { exact: true }).fill(c.binCode);
        await pick.getByRole('button', { name: 'Use bin', exact: true }).click();
        await pick.getByLabel(`Product barcode for ${c.productName}`, { exact: true }).fill(c.sku);
        await pick.getByRole('button', { name: 'Use product', exact: true }).click();
        await pick.getByLabel(`Picked quantity for ${c.productName}`, { exact: true }).fill(String(c.requestedQuantity));
        await capture(page, 'pick-captured', 'operations_associate', await order());
        await pick.getByRole('button', { name: 'Confirm pick', exact: true }).click();
        await expect.poll(async () => (await order()).status).toBe('packing');
        await expect(pick).not.toBeVisible();
        assert.equal((await order()).picked_by, actors.operations_associate.id);
        assert.equal((await order()).lines[0].pickBinId, c.binId);
        await page.reload();
        await expect(card).toBeVisible();
        await capture(page, 'pick-refresh-persisted', 'operations_associate', await order());
        await card.getByRole('button', { name: 'Prepare accountable handover', exact: true }).click();
        const pack = page.getByRole('dialog');
        await pack.getByLabel('Recipient name', { exact: true }).fill('Synthetic Marketing Recipient');
        await capture(page, 'packing-captured', 'operations_associate', await order());
        await pack.getByRole('button', { name: 'Confirm packing', exact: true }).click();
        await expect.poll(async () => (await order()).status).toBe('ready');
        await expect(pack).not.toBeVisible();
        assert.equal((await order()).packed_by, actors.operations_associate.id);
        await expect(card.getByText('Awaiting release by a second warehouse operator.')).toBeVisible();
        await capture(page, 'independent-release-required', 'operations_associate', await order());
        await negative('operations_associate', 'advance_fulfillment_order', { order_id: c.orderId, action: 'release', idempotency_key: `${m.runId}-${c.viewport}-deny-packer` }, /second warehouse operator/);
        const lead = await queue('operations_lead');
        await lead.card.getByRole('button', { name: 'Release handover', exact: true }).click();
        await expect.poll(async () => (await order()).status).toBe('released');
        assert.equal((await order()).released_by, actors.operations_lead.id);
        await capture(lead.page, 'released', 'operations_lead', { order: await order(), inventory: await inventory() });
        await negative('operations_lead', 'advance_fulfillment_order', { order_id: c.orderId, action: 'acknowledge_receipt', idempotency_key: `${m.runId}-${c.viewport}-deny-releaser` }, /releasing operator/);
        const requester = await pageFor('marketing_events_lead');
        await requester.goto(`${origin}/warehouse/fulfillment?tab=requests&request=${c.requestId}`);
        await requester.getByRole('button', { name: 'Acknowledge receipt', exact: true }).click();
        const ack = requester.getByRole('dialog').filter({ has: requester.getByRole('heading', { name: /^Acknowledge receipt/ }) });
        await ack.getByLabel('Acknowledgment reference', { exact: true }).fill(`SYNTHETIC-${m.runId}`);
        await ack.locator('input[type=file]').setInputFiles({ name: 'synthetic-acknowledgment.png', mimeType: 'image/png', buffer: proof });
        await expect(ack.getByRole('button', { name: 'Confirm receipt', exact: true })).toBeEnabled();
        await capture(requester, 'recipient-evidence-captured', 'marketing_events_lead', await order());
        await ack.getByRole('button', { name: 'Confirm receipt', exact: true }).click();
        await expect.poll(async () => (await order()).status).toBe('completed');
        await expect(ack).not.toBeVisible();
        const saved = await order();
        assert.equal(saved.acknowledged_by, actors.marketing_events_lead.id);
        assert.equal(saved.acknowledgement_reference, `SYNTHETIC-${m.runId}`);
        const finalStock = await inventory();
        assert.equal(finalStock.stock.reduce((sum, row) => sum + row.quantity, 0), c.openingQuantity - c.requestedQuantity);
        assert.equal(finalStock.movements.length, 1);
        assert.equal(finalStock.movements[0].quantity, c.requestedQuantity);
        assert.equal(finalStock.movements[0].from_bin_id, c.binId);
        assert.equal(finalStock.reservations.length, 1);
        assert.equal(finalStock.reservations[0].status, 'released');
        assert.equal((await read('department_stock_requests', 'id', c.requestId))[0].status, 'closed');
        await requester.reload();
        await expect(requester.getByText('Receipt acknowledged', { exact: false }).first()).toBeVisible();
        await expect(requester.getByRole('button', { name: 'Acknowledge receipt', exact: true })).toHaveCount(0);
        await capture(requester, 'completed-reconciled', 'marketing_events_lead', { order: saved, inventory: finalStock });
      } catch (error) {
        const screenshot = `${c.viewport}-failure.png`;
        await activePage?.screenshot({ path: path.join(folder, screenshot), fullPage: true }).catch(() => {});
        report.failures.push({ viewport: c.viewport, message: error.message, screenshot, route: activePage?.url() });
        await persist();
      } finally {
        for (const context of contexts) await context.close();
      }
    }
    report.endHealth = await health(m.commit);
    report.complete = report.failures.length === 0;
  } catch (error) {
    report.failures.push({ message: error.message });
  } finally {
    await browser?.close();
    for (const actor of Object.values(actors)) actor.client.auth.stopAutoRefresh();
    report.finishedAt = new Date().toISOString();
    await persist();
  }
  if (!report.complete) process.exitCode = 1;
  console.log(JSON.stringify({ folder, complete: report.complete, checks: report.checks.length, failures: report.failures }));
} else {
  throw new Error('Usage: node scripts/qa/wms-department-signoff-live.mjs prepare|run [evidence-folder]');
}
