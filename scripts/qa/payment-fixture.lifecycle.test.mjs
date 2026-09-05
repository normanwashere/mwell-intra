import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createPaymentAuditEvidence } from './payment-audit-evidence.mjs';

const source = readFileSync(new URL('./full-intra-live-e2e.mjs', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const migration = readFileSync(new URL('../../supabase/migrations/20260714175318_single_po_receipt_authority.sql', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const marker = 'QA-20260905-00003D4B-desktop-1440';
const ids = new Proxy({}, { get: (_target, key) => `${marker}-${key}` });
const poStart = source.indexOf('await insertAuditRows(client, "procurement", "purchase_orders", [');
const poEnd = source.indexOf(']);', poStart);
const orders = new Function('ids', 'marker', `return ${source.slice(source.indexOf('[', poStart), poEnd + 1)}`)(ids, marker);
const lineStart = source.indexOf('"purchase_order_lines",\n    [', poEnd);
const lineEnd = source.indexOf('.map((line) => ({ receiving_status: "open", ...line }))', lineStart);
const lines = new Function('ids', 'marker', `return ${source.slice(source.indexOf('[', lineStart), lineEnd)}.map(line => ({ receiving_status: 'open', ...line }))`)(ids, marker);

test('actual fully received fixture reaches closed with zero balance and can upload payment evidence', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema procurement;
      create table procurement.purchase_orders(id text primary key,status text,updated_at timestamptz);
      create table procurement.purchase_order_lines(id text, purchase_order_id text, quantity int, received_quantity int default 0, receiving_status text);`);
    // Execute the actual receipt close/reopen block, not a mocked issued status.
    const start = migration.indexOf('  select not exists (\n', migration.indexOf("perform set_config('warehouse.procurement_po_line_queue', '[]', true)"));
    const end = migration.indexOf('returning * into v_po;', start) + 'returning * into v_po;'.length;
    assert.ok(start > 0 && end > start);
    await db.exec(`create function procurement.finish_receipt(p_id text) returns text language plpgsql as $$
      declare v_po procurement.purchase_orders; v_closed boolean;
      begin select * into v_po from procurement.purchase_orders where id=p_id;
      ${migration.slice(start, end)} return v_po.status; end $$;`);
    for (const poId of [ids.cleanPo, ids.partialPo]) {
      const order = orders.find(row => row.id === poId);
      const poLines = lines.filter(row => row.purchase_order_id === poId);
      assert.equal(order.total, poLines.reduce((sum, line) => sum + line.quantity * line.unit_price, 0));
      await db.query('insert into procurement.purchase_orders(id,status) values($1,$2)', [order.id, order.status]);
      for (const line of poLines) await db.query('insert into procurement.purchase_order_lines values($1,$2,$3,$4,$5)',
        [line.id, poId, line.quantity, [ids.cleanLine, ids.partialLine, ids.concurrentLine].includes(line.id) ? line.quantity : 0, line.receiving_status]);
      const status = (await db.query('select procurement.finish_receipt($1) status', [poId])).rows[0].status;
      assert.equal(status, 'closed');
      assert.equal((await db.query("select sum(quantity-received_quantity)::int n from procurement.purchase_order_lines where purchase_order_id=$1 and receiving_status='open'", [poId])).rows[0].n, 0);
      let uploads = 0;
      const po = { ...order, status, acceptance_evidence_version: 2 };
      const result = await createPaymentAuditEvidence({ purchaseOrderId: poId, marker, browserUser: { id: 'user', role: 'authenticated' },
        readPurchaseOrderAsBrowserUser: async () => ({ ...po, request_id: `req_${marker}-receipt-request` }),
        uploadAsBrowserUser: async () => { uploads++; return { ok: true }; },
        // Registration is mocked here; real SQL lifecycle coverage remains a separate requirement.
        callRpcAsBrowserUser: async (_page, _schema, _fn, payload) => ({ ok: true, body: JSON.stringify({ ...payload.attachment,
          request_id: `req_${marker}-receipt-request`, uploaded_by: 'user', payment_po_id: poId,
          payment_vendor_id: po.core_vendor_id, payment_evidence_version: 2, payment_purpose: payload.purpose }) }),
      });
      assert.equal(uploads, 3);
      assert.equal(Object.keys(result.references).length, 3);
    }
  } finally { await db.close(); }
});
