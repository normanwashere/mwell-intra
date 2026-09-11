import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20260911035750_loading_query_performance.sql', import.meta.url), 'utf8');
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';

test('performance migration preserves visibility across 64 identity/capability combinations', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon;
      create schema auth; create schema core; create schema warehouse; create schema procurement;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
      create function core.has_live_cap(text,text) returns boolean language sql stable as $$select ($1 || '.' || $2) = any(string_to_array(current_setting('test.caps',true),','))$$;
      create function core.platform_followup_owner(text) returns boolean language sql stable as $$select $1 = current_setting('test.area',true)$$;
      create table core.activity_log(id bigint primary key, created_at timestamptz);
      insert into core.activity_log select i, timestamptz '2026-01-01' + i * interval '1 minute' from generate_series(1,10000) i;
      create table core.insight_followups(id int primary key, requested_by uuid, area text);
      create table warehouse.export_jobs(id int primary key, created_by uuid, export_type text);
      create table procurement.requests(id int primary key, requester_id uuid);
      create table procurement.request_collaborators(id int primary key, request_id int references procurement.requests, user_id uuid);
      insert into core.insight_followups values (1,'${first}','warehouse'),(2,'${second}','finance'),(3,null,null);
      insert into warehouse.export_jobs values (1,'${first}','insights_snapshot'),(2,'${first}','inventory'),(3,'${second}','inventory'),(4,null,null);
      insert into procurement.requests values (1,'${first}'),(2,'${second}');
      insert into procurement.request_collaborators values (1,1,'${second}'),(2,2,'${first}'),(3,2,'${second}');
      grant usage on schema auth,core,warehouse,procurement to authenticated;
      grant select on core.insight_followups,warehouse.export_jobs,procurement.requests,procurement.request_collaborators to authenticated;
      alter table core.insight_followups enable row level security;
      alter table warehouse.export_jobs enable row level security;
      alter table procurement.requests enable row level security;
      alter table procurement.request_collaborators enable row level security;
      create policy own_requests on procurement.requests for select to authenticated using (requester_id = (select auth.uid()));
      create policy insight_followups_read on core.insight_followups for select to authenticated using (requested_by = auth.uid() or core.platform_followup_owner(area));
      create policy warehouse_export_jobs_read on warehouse.export_jobs for select to authenticated using (
        (created_by = auth.uid() and ((export_type = 'insights_snapshot' and core.has_live_cap('insights','prepare_exports')) or (export_type <> 'insights_snapshot' and core.has_live_cap('warehouse','register_exports')))) or core.has_live_cap('warehouse','review_exports'));
      create policy request_collaborators_read on procurement.request_collaborators for select to authenticated using (
        user_id = auth.uid() or exists(select 1 from procurement.requests request where request.id = request_collaborators.request_id and request.requester_id = auth.uid()));
    `);
    const snapshot = async () => {
      const visibility = [];
      for (const actor of [first, second, '33333333-3333-4333-8333-333333333333', '']) {
        for (let mask = 0; mask < 8; mask++) {
          const caps = ['insights.prepare_exports','warehouse.register_exports','warehouse.review_exports'].filter((_, index) => mask & (1 << index)).join(',');
          for (const area of ['', 'warehouse']) {
            await db.query("select set_config('test.actor',$1,false),set_config('test.caps',$2,false),set_config('test.area',$3,false)", [actor, caps, area]);
            await db.exec('set role authenticated');
            const rows = [];
            for (const table of ['core.insight_followups','warehouse.export_jobs','procurement.request_collaborators']) rows.push((await db.query(`select id from ${table} order by id`)).rows);
            visibility.push(rows);
            await db.exec('reset role');
          }
        }
      }
      return visibility;
    };
    const before = await snapshot();
    await db.exec(`begin; ${migration} commit;`);
    assert.deepEqual(await snapshot(), before);
    assert.equal(before.length, 64);
    const policy = await db.query("select qual from pg_policies where policyname in ('insight_followups_read','warehouse_export_jobs_read','request_collaborators_read')");
    assert.equal(policy.rows.length, 3);
    assert.ok(policy.rows.every(row => row.qual.includes('SELECT auth.uid()')));
    await db.exec('analyze core.activity_log');
    const plan = await db.query('explain (format json) select * from core.activity_log order by created_at desc limit 250');
    assert.match(JSON.stringify(plan.rows), /activity_log_created_at_id_idx/);
    const guards = await db.query("select has_table_privilege('anon','warehouse.export_jobs','SELECT') as anonymous, has_table_privilege('authenticated','warehouse.export_jobs','UPDATE') as write");
    assert.deepEqual(guards.rows, [{ anonymous: false, write: false }]);
    // Reapplication is safe and does not create duplicate indexes or policies.
    await db.exec(`begin; ${migration} commit;`);
  } finally { await db.close(); }
});
