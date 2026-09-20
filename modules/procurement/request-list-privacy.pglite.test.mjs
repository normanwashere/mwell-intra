import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const privacy = await readFile(new URL('../../supabase/migrations/20260815154702_procurement_finance_requester_privacy.sql', import.meta.url), 'utf8');
const visibility = await readFile(new URL('../../supabase/migrations/20260826170000_procurement_request_operational_visibility.sql', import.meta.url), 'utf8');

test('fixed request and approval equality reads retain the actual owner/collaborator/certified-operator RLS contract', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon; create role service_role;
      create schema auth; create schema core; create schema private; create schema procurement;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
      create function core.has_live_cap(m text,c text) returns boolean language sql stable as $$ select (m||'.'||c)=any(string_to_array(current_setting('test.caps',true),',')) $$;
      create table procurement.requests(id text primary key,requester_id uuid,status text);
      create table procurement.approval_steps(id text primary key,request_id text,step_order integer);
      create table procurement.request_collaborators(request_id text,user_id uuid,revoked_at timestamptz);
      insert into procurement.requests values ('old-owned','${owner}','approved'),('foreign-request','${foreign}','draft');
      insert into procurement.approval_steps values ('old-step','old-owned',1),('foreign-step','foreign-request',1);
      alter table procurement.requests enable row level security;
      alter table procurement.approval_steps enable row level security;
      grant usage on schema auth,core,private,procurement to authenticated;
      grant select on procurement.requests,procurement.approval_steps to authenticated;
    `);
    await db.exec(visibility);
    for (const name of ['procurement_requests_read', 'procurement_steps_read']) {
      const policy = privacy.match(new RegExp(`create policy ${name} on [\\s\\S]*?;`));
      assert.ok(policy, name);
      await db.exec(policy[0]);
    }
    const readAs = async (actor, caps = '') => {
      await db.query("select set_config('test.actor',$1,false),set_config('test.caps',$2,false)", [actor, caps]);
      await db.exec('set role authenticated');
      try {
        return {
          requests: (await db.query("select id from procurement.requests where id=$1 limit 2", ['old-owned'])).rows,
          steps: (await db.query("select id from procurement.approval_steps where request_id=$1 order by step_order limit 101", ['old-owned'])).rows,
        };
      } finally { await db.exec('reset role'); }
    };
    assert.deepEqual(await readAs(owner), { requests: [{ id: 'old-owned' }], steps: [{ id: 'old-step' }] });
    assert.deepEqual(await readAs(foreign, 'procurement.view_dashboard'), { requests: [], steps: [] });
    assert.deepEqual(await readAs(foreign, 'procurement.author_po'), { requests: [{ id: 'old-owned' }], steps: [{ id: 'old-step' }] });
    await db.query('insert into procurement.request_collaborators values ($1,$2,null)', ['old-owned', foreign]);
    assert.equal((await readAs(foreign)).requests.length, 1);
    await db.exec('update procurement.request_collaborators set revoked_at=now()');
    assert.deepEqual(await readAs(foreign), { requests: [], steps: [] });
  } finally { await db.close(); }
});
