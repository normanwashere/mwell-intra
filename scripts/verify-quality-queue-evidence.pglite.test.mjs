import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20260911225104_quality_queue_lazy_evidence.sql', import.meta.url), 'utf8');
test('quality summary preserves rows, exact evidence, caller RLS and read-only grants', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema warehouse;
      create role authenticated; create role anon; create role service_role;
      grant usage on schema warehouse to authenticated,anon;
      create table warehouse.quality_inspections(id text primary key,source_type text,source_id text,product_id text,
        procurement_po_line_id text,bin_id text,lot_id text,serial_number text,quantity integer,disposition text,
        reason text,inspected_by text,inspected_at timestamptz,evidence_urls jsonb);
      alter table warehouse.quality_inspections enable row level security;
      grant select on warehouse.quality_inspections to authenticated;
      create policy inspection_actor on warehouse.quality_inspections for select to authenticated
        using (inspected_by=current_setting('test.actor',true));
      insert into warehouse.quality_inspections(id,source_id,inspected_by,inspected_at,evidence_urls)
        select 'inspection-'||n,'receipt-'||n,case when n=1002 then 'other' else 'quality' end,now(),
        case when n=1 then '[]'::jsonb else jsonb_build_array('data:image/png;base64,'||repeat('a',2000),'quality/exact.png') end
        from generate_series(1,1002) n;
    `);
    const original = (await db.query('select md5(string_agg(evidence_urls::text,\'\' order by id)) as hash from warehouse.quality_inspections')).rows;
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual((await db.query('select md5(string_agg(evidence_urls::text,\'\' order by id)) as hash from warehouse.quality_inspections')).rows, original);
    await db.exec("set role authenticated; select set_config('test.actor','quality',false)");
    assert.equal((await db.query('select count(*)::int as n from warehouse.quality_inspection_queue')).rows[0].n,1001);
    assert.equal((await db.query("select evidence_count from warehouse.quality_inspection_queue where id='inspection-1'")).rows[0].evidence_count,0);
    assert.equal((await db.query("select evidence_count from warehouse.quality_inspection_queue where id='inspection-2'")).rows[0].evidence_count,2);
    const row=(await db.query("select * from warehouse.quality_inspection_queue where id='inspection-2'")).rows[0];
    assert(!('evidence_urls' in row));
    assert.equal(row.source_id,'receipt-2');
    assert.equal((await db.query("select evidence_urls from warehouse.quality_inspections where id='inspection-2'")).rows[0].evidence_urls[1],'quality/exact.png');
    await assert.rejects(db.exec("update warehouse.quality_inspection_queue set disposition='accepted' where id='inspection-2'"),/permission denied/);
    await db.exec("select set_config('test.actor','other',false)");
    assert.equal((await db.query('select count(*)::int as n from warehouse.quality_inspection_queue')).rows[0].n,1);
    assert.equal((await db.query("select evidence_urls from warehouse.quality_inspections where id='inspection-2'")).rows.length,0);
    await db.exec("select set_config('test.actor','revoked',false)");
    assert.equal((await db.query('select count(*)::int as n from warehouse.quality_inspection_queue')).rows[0].n,0);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select * from warehouse.quality_inspection_queue'),/permission denied/);
  } finally { await db.close(); }
});
