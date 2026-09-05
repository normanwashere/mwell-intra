// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { Blob } from 'node:buffer';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { expect, it, vi } from 'vitest';
import { loadLiveFinanceData, summarizeFinanceData } from './data';
import { paymentUrgency } from './paymentUrgency';

it('PF02: actual SQL pages retain mixed totals, oldest open pack and beyond-page dependencies', async () => {
  const bundle = await readFile(resolve('../../node_modules/@electric-sql/pglite/dist/pglite.data'));
  vi.stubGlobal('Blob', Blob);
  const db = new PGlite({ fsBundle: new Blob([bundle]) as unknown as globalThis.Blob });
  try {
    await db.exec(`create schema core; create schema warehouse; create schema procurement;
      create function core.has_live_cap(text,text) returns boolean language sql as $$select true$$;
      create table core.v_finance_activity(source text,ref_id text,amount numeric,status text,occurred_at timestamptz);
      create table procurement.purchase_orders(id text,po_number text,vendor_name text,total numeric,status text,updated_at timestamptz);
      create table procurement.payment_readiness_packs(id uuid,purchase_order_id text,status text,prepared_at timestamptz,invoice_amount numeric,released_amount numeric,due_date date);
      create table warehouse.products(id text,unit_cost numeric);
      create table warehouse.inventory_position_v1(product_id text,on_hand bigint);
      create table core.finance_close_entry_authority(id uuid);`);
    const sql = await readFile(resolve('../../supabase/migrations/20260905091000_platform_finance.sql'), 'utf8');
    for (const name of ['platform_finance_page', 'platform_finance_totals']) {
      const start = sql.indexOf(`create function core.${name}(`);
      expect(start).toBeGreaterThanOrEqual(0);
      await db.exec(sql.slice(start, sql.indexOf('$$;', start) + 3));
    }
    const today = new Date().toISOString().slice(0, 10);
    await db.exec(`insert into core.v_finance_activity
      select case i%3 when 0 then 'procurement_po' when 1 then 'warehouse_receipt' else 'warehouse_return' end,
        lpad(i::text,5,'0'),case when i%3=2 then -i else i end,'recorded','${today}'
      from generate_series(1,1206)i;
      insert into procurement.purchase_orders select 'po-'||lpad(i::text,5,'0'),'PO-'||i,'Vendor '||i,i,'issued','${today}' from generate_series(1,1005)i;
      insert into procurement.payment_readiness_packs
      select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'po-'||lpad(i::text,5,'0'),
        case when i=1005 then 'accepted' else 'released' end,
        case when i=1005 then '2020-01-01'::timestamptz else '${today}'::timestamptz end,
        i,case when i=1005 then 0 else i end,'2020-02-01'::date from generate_series(1,1005)i;
      insert into warehouse.products select 'product-'||lpad(i::text,5,'0'),i from generate_series(1,1005)i;
      insert into warehouse.inventory_position_v1 select 'product-'||lpad(i::text,5,'0'),2 from generate_series(1,1005)i;`);
    const calls: { source: string; after: string }[] = [];
    const client = { schema: () => ({ rpc: async (name: string, args: Record<string, string | number>) => {
      if (name === 'platform_finance_page') {
        calls.push({ source: String(args.p_source), after: String(args.p_after) });
        const result = await db.query<{ result: unknown }>('select core.platform_finance_page($1,$2,$3) result',
          [args.p_source, args.p_after, Math.min(Number(args.p_size), 37)]);
        return { data: result.rows[0]!.result, error: null };
      }
      const result = await db.query<{ result: unknown }>('select core.platform_finance_totals($1,$2) result', [args.p_start, args.p_end]);
      return { data: result.rows[0]!.result, error: null };
    } }) };
    const data = await loadLiveFinanceData(client as never);
    const expected = { committedValue: 0, receivedValue: 0, returnedValue: 0 };
    for (let i = 1; i <= 1206; i++) {
      expected[i % 3 === 0 ? 'committedValue' : i % 3 === 1 ? 'receivedValue' : 'returnedValue'] += i;
    }
    expect(data.warnings).toEqual([]);
    expect(data.activity).toHaveLength(1206);
    expect(new Set(data.activity.map((row) => row.id)).size).toBe(1206);
    expect(data.totals).toMatchObject(expected);
    expect(summarizeFinanceData(data)).toMatchObject({ ...expected, inventoryValue: 1005 * 1006 });
    expect(data.payments).toHaveLength(1005);
    expect(data.payments.every((pack) => pack.vendorName !== 'Vendor not available')).toBe(true);
    const oldest = paymentUrgency(data.payments).find((pack) => pack.remainingAmount > 0)!;
    expect(oldest).toMatchObject({ purchaseOrderId: 'po-01005', poNumber: 'PO-1005', vendorName: 'Vendor 1005',
      remainingAmount: 1005, status: 'accepted' });
    expect(oldest.preparedAt).toMatch(/^2020-01-01/);
    expect(data.sourceStates).toEqual({ activity: 'complete', payments: 'complete', inventory: 'complete', close: 'complete' });
    for (const source of ['activity', 'orders', 'payments', 'inventory', 'products']) {
      expect(calls.filter((call) => call.source === source && call.after).length).toBeGreaterThan(20);
    }
  } finally { await db.close(); vi.unstubAllGlobals(); }
}, 20000);
