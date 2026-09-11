import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrations = new URL('../../supabase/migrations/', import.meta.url);
const candidateName = '20260911080134_restore_ownerless_commitment_readiness.sql';
const candidate = await readFile(new URL(candidateName, migrations), 'utf8');
const signature = 'create or replace function procurement.commitment_readiness(payload jsonb)';
function wrapper(sql) {
  const start = sql.toLowerCase().lastIndexOf(signature);
  assert(start >= 0);
  const end = sql.indexOf('$$;', start);
  assert(end > start);
  return sql.slice(start, end + 3);
}
const priorFiles = (await readdir(migrations)).filter(name => name.endsWith('.sql') && name < candidateName).sort();
const definitions = [];
for (const name of priorFiles) {
  const sql = await readFile(new URL(name, migrations), 'utf8');
  if (sql.toLowerCase().includes(signature)) definitions.push({ name, definition: wrapper(sql) });
}
const latest = definitions.at(-1);
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

test('candidate repairs the actual latest wrapper without changing policy requirements or assigning owners', async t => {
  assert.equal(latest.name, '20260822110000_mpic_procurement_policy_alignment.sql');
  const requirement = sql => sql.match(/v_requirement:=.*;/)[0];
  assert.equal(requirement(candidate), requirement(latest.definition));
  assert.doesNotMatch(candidate, /\b(update|insert into|delete from)\s+procurement\.requests/i);
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema core; create schema private; create schema procurement;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.actor', true), '')::uuid
      $$;
      create table core.test_live_caps(actor uuid, capability text);
      create function core.has_live_cap(m text, c text) returns boolean language sql stable as $$
        select exists(select 1 from core.test_live_caps where actor=auth.uid() and capability=m||'.'||c)
      $$;
      create table procurement.requests(id text primary key, requester_id uuid);
      create table procurement.acceptance_reviewer_assignments(request_id text, reviewer_id uuid, superseded_at timestamptz);
      insert into procurement.requests values('ownerless',null),('owned','${B}'),('private-denial',null);
      create function private.procurement_commitment_readiness(p_request text,p_vendor uuid,p_phase text)
      returns jsonb language plpgsql security definer set search_path='' as $$
      begin
        if p_request='private-denial' then raise exception 'Underlying policy authority denied'; end if;
        return jsonb_build_object(
          'requestId',p_request,'vendorId',p_vendor,'phase',p_phase,'ready',false,'route','rfq',
          'evidence',jsonb_build_array(
            jsonb_build_object('controlCode','RFQ_COMMERCIAL_COMPARISON','reviewStatus','approved'),
            jsonb_build_object('controlCode','IMPORT_PLAN','reviewStatus','submitted')
          ),
          'blockers',jsonb_build_array('Missing bond')
        );
      end $$;
      revoke all on function private.procurement_commitment_readiness(text,uuid,text) from public,anon,authenticated;
      grant usage on schema procurement to anon,authenticated,service_role;
    `);
    async function asActor(actor, role = 'authenticated') {
      await db.exec('reset role');
      await db.query("select set_config('test.actor',$1,false)", [actor ?? '']);
      await db.exec('set role ' + role);
    }
    async function caps(...values) {
      await db.exec('reset role; delete from core.test_live_caps;');
      for (const value of values) await db.query('insert into core.test_live_caps values($1,$2)', [A, 'procurement.'+value]);
      await asActor(A);
    }
    async function call(request = 'ownerless', extra = {}) {
      const result = await db.query('select procurement.commitment_readiness($1::jsonb) as result', [JSON.stringify({request_id:request,...extra})]);
      return result.rows[0].result;
    }

    await db.exec(latest.definition);
    await db.exec('revoke all on function procurement.commitment_readiness(jsonb) from public,anon; grant execute on function procurement.commitment_readiness(jsonb) to authenticated,service_role;');
    await caps('view_dashboard');
    await t.test('reproduces Aug22 failure for an existing ownerless request with live control access', async () => {
      await assert.rejects(call(), /Procurement request not found/);
    });
    await db.exec('reset role');
    await db.exec(candidate);
    await t.test('each existing live control capability allows read but never implies acceptance', async () => {
      for (const capability of ['view_dashboard','author_po','approve_award']) {
        await caps(capability);
        const result = await call('ownerless',{vendor_id:C,phase:'award'});
        assert.equal(result.requestId,'ownerless');
        assert.equal(result.vendorId,C);
        assert.equal(result.phase,'award');
        assert.equal(result.ready,false);
        assert.equal(result.canRecordAcceptance,false);
        assert.deepEqual(result.blockers,['Missing bond']);
        assert.deepEqual(result.requirements.map(item => [item.kind,item.status]),[
          ['RFQ_COMMERCIAL_COMPARISON','present'],['IMPORT_PLAN','missing'],['blocker:Missing_bond','missing']
        ]);
        assert.equal(result.requirements[0].source,'Governed policy evidence');
        assert.equal(result.requirements[2].source,'Server commitment predicate');
      }
    });
    await t.test('ordinary caller cannot read ownerless or someone else owned request; revocation is live', async () => {
      await caps();
      await assert.rejects(call(),/Procurement request has no active owner/);
      await assert.rejects(call('owned'),/Not authorized to view commitment readiness/);
    });
    await t.test('missing row is distinct from an ownerless row', async () => {
      await caps('view_dashboard');
      await assert.rejects(call('missing'),/Procurement request not found/);
    });
    await t.test('private policy authority is still called and its denial propagates', async () => {
      await assert.rejects(call('private-denial'),/Underlying policy authority denied/);
      await assert.rejects(db.query("select private.procurement_commitment_readiness('ownerless',null,'issue')"),/permission denied/);
    });
    await t.test('acceptance is true only for an owner or explicit active reviewer assignment', async () => {
      await db.exec('reset role');
      await db.query("insert into procurement.acceptance_reviewer_assignments values('ownerless',$1,null)",[A]);
      await asActor(A);
      assert.equal((await call()).canRecordAcceptance,true);
      await db.exec("reset role; update procurement.acceptance_reviewer_assignments set superseded_at=now();");
      await asActor(A);
      assert.equal((await call()).canRecordAcceptance,false);
      await asActor(B);
      assert.equal((await call('owned')).canRecordAcceptance,true);
    });
    await t.test('anonymous role and missing authenticated uid are denied', async () => {
      await asActor(null,'anon');
      await assert.rejects(call(),/permission denied/);
      await asActor(null);
      await assert.rejects(call(),/Authentication required/);
    });
    await t.test('ACL, postgres owner, definer boundary and empty search_path are preserved', async () => {
      await db.exec('reset role');
      const {rows} = await db.query(`
        select pg_get_userbyid(proowner) as owner,prosecdef,provolatile,proconfig,
        has_function_privilege('authenticated',oid,'EXECUTE') as authenticated,
        has_function_privilege('service_role',oid,'EXECUTE') as service_role,
        has_function_privilege('anon',oid,'EXECUTE') as anon
        from pg_proc where oid='procurement.commitment_readiness(jsonb)'::regprocedure
      `);
      assert.equal(rows[0].owner,'postgres');
      assert.equal(rows[0].prosecdef,true);
      assert.equal(rows[0].provolatile,'v');
      assert.deepEqual(rows[0].proconfig,['search_path=""']);
      assert.equal(rows[0].authenticated,true);
      assert.equal(rows[0].service_role,true);
      assert.equal(rows[0].anon,false);
      assert.equal((await db.query("select requester_id from procurement.requests where id='ownerless'")).rows[0].requester_id,null);
    });
  } finally { await db.close(); }
});
