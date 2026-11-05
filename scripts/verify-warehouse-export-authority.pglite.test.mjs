import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const registration = read('20260710170000_warehouse_w1_imports_po_and_reporting.sql');
const original = read('20260710043410_govern_warehouse_csv_exports.sql');
const certified = read('20260815183000_leadership_insights_launch_blockers.sql');
const fix = read('20261105134446_warehouse_export_command_authority.sql');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
let db;
function fn(sql, name) {
  const escaped = name.replaceAll('.', '\\.');
  const match = sql.match(new RegExp(`create(?: or replace)? function ${escaped}\\(payload jsonb\\)[\\s\\S]*?\\$\\$;`, 'i'));
  assert.ok(match, name); return match[0];
}
function policy(sql, name) {
  const match = sql.match(new RegExp(`create policy ${name}\\b[\\s\\S]*?;`, 'i'));
  assert.ok(match, name); return match[0];
}
async function actor({ uid = A, live = 'warehouse:register_exports', raw = '', role = 'authenticated' } = {}) {
  await db.query("select set_config('test.uid',$1,false), set_config('test.live',$2,false), set_config('test.raw',$3,false), set_config('test.role',$4,false)", [uid, live, raw, role]);
}
let serial = 0;
const payload = (extra = {}) => {
  const id = `exp_test_authority_${++serial}`;
  return { id, export_type: 'inventory_position', filename: 'mwell-intra-inventory_position-20261105T130000Z.csv',
    storage_path: `exports/${A}/${id}.csv`, checksum_sha256: 'a'.repeat(64), row_count: 2, ...extra };
};
async function call(name, p) {
  await db.exec('set role authenticated');
  try { return await db.query(`select warehouse.${name}($1::jsonb) as result`, [JSON.stringify(p)]); }
  finally { await db.exec('reset role'); }
}
before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema core; create schema warehouse; create schema storage; create schema private;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_setting('test.role',true)$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{"email":"synthetic@example.invalid"}'::jsonb$$;
    create function core.has_cap(m text,c text) returns boolean language sql stable as $$select (m||':'||c)=any(string_to_array(current_setting('test.raw',true),','))$$;
    create function core.has_live_cap(m text,c text) returns boolean language sql stable as $$select (m||':'||c)=any(string_to_array(current_setting('test.live',true),','))$$;
    create table core.activity_log(module text,entity_type text,entity_id text,action text,actor uuid,detail jsonb);
    create table warehouse.export_jobs(id text primary key, export_type text not null,filename text not null,storage_path text not null,
      checksum_sha256 text not null,row_count integer not null check(row_count>=0),created_by uuid not null,created_by_email text,
      corrected_from text,status text default 'prepared',review_note text);
    alter table warehouse.export_jobs enable row level security;
    create table storage.objects(id text primary key,bucket_id text,name text,owner_id text);
    alter table storage.objects enable row level security;
    grant usage on schema auth,core,warehouse,storage,private to authenticated,anon,service_role;
    grant select on warehouse.export_jobs to authenticated;
    grant select,insert,delete on storage.objects to authenticated;
  `);
  await db.exec(fn(registration, 'warehouse.register_export_job'));
  await db.exec('alter function warehouse.register_export_job(jsonb) rename to register_export_job_uncertified_impl; revoke all on function warehouse.register_export_job_uncertified_impl(jsonb) from public,anon,authenticated,service_role;');
  await db.exec(fn(original, 'warehouse.prepare_export_download'));
  await db.exec('alter function warehouse.prepare_export_download(jsonb) rename to prepare_export_download_pre_insights_certification; revoke all on function warehouse.prepare_export_download_pre_insights_certification(jsonb) from public,anon,authenticated; grant execute on function warehouse.prepare_export_download_pre_insights_certification(jsonb) to service_role;');
  await db.exec(fn(certified, 'warehouse.register_export_job'));
  await db.exec(fn(certified, 'warehouse.prepare_export_download'));
  await db.exec('revoke all on function warehouse.register_export_job(jsonb),warehouse.prepare_export_download(jsonb) from public,anon; grant execute on function warehouse.register_export_job(jsonb),warehouse.prepare_export_download(jsonb) to authenticated,service_role;');
  await db.exec(policy(certified, 'warehouse_export_jobs_read'));
  await db.exec(policy(certified, 'warehouse_exports_read'));
  await db.exec(policy(original, 'warehouse_exports_orphan_cleanup'));
  if (fix.trim()) await db.exec(fix);
});
after(async () => { await db?.close(); });

test('certified Warehouse exports without analytics/finance and downloads the exact own artifact', async () => {
  await actor(); const p = payload(); const { rows } = await call('register_export_job', p);
  assert.equal(rows[0].result.created_by, A); assert.equal(rows[0].result.row_count, 2);
  const download = (await call('prepare_export_download', { export_id: p.id })).rows[0].result;
  assert.equal(download.storage_path, p.storage_path); assert.equal(download.checksum_sha256, p.checksum_sha256);
  assert.equal(download.expires_in, 60);
  await assert.rejects(call('register_export_job', p), /duplicate key/);
  assert.equal((await db.query('select count(*)::int as n from core.activity_log where entity_id=$1 and action=$2', [p.id, 'created'])).rows[0].n, 1);
});
test('read-only analytics, uncertified raw permission and anonymous identity do not grant export', async () => {
  for (const identity of [{ live: '', raw: 'warehouse:view_analytics' }, { live: '', raw: 'warehouse:register_exports' }, { uid: '', live: 'warehouse:register_exports' }]) {
    await actor(identity); await assert.rejects(call('register_export_job', payload()), /Not authorized/);
  }
});
test('certified Insights preparation retains the current generic export contract', async () => {
  await actor({ live: 'insights:prepare_exports' });
  assert.equal((await call('register_export_job', payload())).rows[0].result.created_by, A);
});
test('ID, type, path, checksum and correction validation remain enforced', async () => {
  await actor();
  for (const [change, message] of [
    [{ id: 'bad' }, /Invalid export id/], [{ export_type: 'raw_private' }, /Invalid export type/],
    [{ filename: 'free.csv' }, /Invalid governed export filename/],
    [{ storage_path: `exports/${B}/outside.csv` }, /outside the user scope/],
    [{ checksum_sha256: 'no' }, /valid SHA-256/], [{ corrected_from: 'missing' }, /Correction source/],
  ]) await assert.rejects(call('register_export_job', payload(change)), message);
});
test('corrections cannot supersede another creator without current review authority', async () => {
  const source = payload({ status: 'correction_required' });
  await db.query("insert into warehouse.export_jobs(id,export_type,filename,storage_path,checksum_sha256,row_count,created_by,status) values($1,$2,$3,$4,$5,2,$6,'correction_required')", [source.id, source.export_type, source.filename, `exports/${B}/other.csv`, source.checksum_sha256, B]);
  await actor(); await assert.rejects(call('register_export_job', payload({ corrected_from: source.id })), /Correction source/);
  assert.equal((await db.query('select status from warehouse.export_jobs where id=$1', [source.id])).rows[0].status, 'correction_required');
  await actor({ live: 'warehouse:register_exports,warehouse:review_exports' });
  await call('register_export_job', payload({ corrected_from: source.id }));
  assert.equal((await db.query('select status from warehouse.export_jobs where id=$1', [source.id])).rows[0].status, 'superseded');
});
test('downloads remain actor-bound and a certified reviewer need not hold analytics roles', async () => {
  await actor(); const p = payload(); await call('register_export_job', p);
  await actor({ uid: B }); await assert.rejects(call('prepare_export_download', { export_id: p.id }), /Not authorized/);
  await actor({ uid: B, live: 'warehouse:review_exports' });
  assert.equal((await call('prepare_export_download', { export_id: p.id })).rows[0].result.storage_path, p.storage_path);
});
test('private implementations retain their non-client EXECUTE boundary', async () => {
  const result = await db.query("select has_function_privilege('authenticated','warehouse.register_export_job_uncertified_impl(jsonb)','execute') as register,has_function_privilege('authenticated','warehouse.prepare_export_download_pre_insights_certification(jsonb)','execute') as download");
  assert.deepEqual(result.rows[0], { register: false, download: false });
});
test('a certified creator can clean only their own unregistered temporary export', async () => {
  await actor();
  await db.query('insert into storage.objects values ($1,$2,$3,$4),($5,$2,$6,$7)', ['own-orphan', 'warehouse-exports', `exports/${A}/orphan.csv`, A, 'other-orphan', `exports/${B}/orphan.csv`, B]);
  await db.exec('set role authenticated');
  try {
    assert.deepEqual((await db.query("select id from storage.objects where id in ('own-orphan','other-orphan')")).rows, [{ id: 'own-orphan' }]);
    assert.deepEqual((await db.query("delete from storage.objects where id in ('own-orphan','other-orphan') returning id")).rows, [{ id: 'own-orphan' }]);
  } finally { await db.exec('reset role'); }
  assert.equal((await db.query("select count(*)::int as n from storage.objects where id='other-orphan'")).rows[0].n, 1);
});
test('registered artifacts remain undeletable even when the registering job is hidden by RLS', async () => {
  await actor(); const p = payload(); await call('register_export_job', p);
  await db.query('insert into storage.objects values ($1,$2,$3,$4)', ['registered', 'warehouse-exports', p.storage_path, A]);
  await db.exec('set role authenticated');
  try { assert.equal((await db.query("delete from storage.objects where id='registered' returning id")).rows.length, 0); }
  finally { await db.exec('reset role'); }
  await db.query('update warehouse.export_jobs set created_by=$1 where id=$2', [B, p.id]);
  await db.exec('set role authenticated');
  try { assert.equal((await db.query("delete from storage.objects where id='registered' returning id")).rows.length, 0); }
  finally { await db.exec('reset role'); }
  assert.equal((await db.query("select count(*)::int as n from storage.objects where id='registered'")).rows[0].n, 1);
});
test('revoked export authority cannot read or remove temporary files through Storage', async () => {
  await actor({ live: '', raw: 'warehouse:register_exports' });
  await db.query('insert into storage.objects values ($1,$2,$3,$4)', ['revoked-orphan', 'warehouse-exports', `exports/${A}/revoked.csv`, A]);
  await db.exec('set role authenticated');
  try {
    assert.equal((await db.query("select id from storage.objects where id='revoked-orphan'")).rows.length, 0);
    assert.equal((await db.query("delete from storage.objects where id='revoked-orphan' returning id")).rows.length, 0);
  } finally { await db.exec('reset role'); }
});
test('the private orphan predicate cannot probe other actors and is not anonymously executable', async () => {
  await actor();
  assert.equal((await db.query('select private.warehouse_export_is_unregistered($1) as allowed', [`exports/${B}/unregistered.csv`])).rows[0].allowed, false);
  await actor({ uid: '' });
  assert.equal((await db.query('select private.warehouse_export_is_unregistered($1) as allowed', [`exports/${A}/unregistered.csv`])).rows[0].allowed, false);
  const grants = (await db.query("select has_function_privilege('anon','private.warehouse_export_is_unregistered(text)','execute') as anon,has_function_privilege('authenticated','private.warehouse_export_is_unregistered(text)','execute') as authenticated")).rows[0];
  assert.deepEqual(grants, { anon: false, authenticated: true });
});
test('revoked export authority cannot bypass SELECT filtering with unfiltered deletion', async () => {
  await actor({ live: '', raw: 'warehouse:register_exports' });
  await db.query('insert into storage.objects values ($1,$2,$3,$4)', ['revoked-unfiltered', 'warehouse-exports', `exports/${A}/revoked-unfiltered.csv`, A]);
  const before = (await db.query('select id from storage.objects order by id')).rows;
  await db.exec('set role authenticated');
  try { await db.exec('delete from storage.objects'); }
  finally { await db.exec('reset role'); }
  assert.deepEqual((await db.query('select id from storage.objects order by id')).rows, before);
});
test('an unexpected predecessor fails closed without rewriting its function definitions', async () => {
  const definition = async () => (await db.query("select pg_get_functiondef('warehouse.register_export_job_uncertified_impl(jsonb)'::regprocedure) as sql")).rows[0].sql;
  const before = await definition();
  await assert.rejects(db.exec(fix), /Unexpected export registration implementation/);
  assert.equal(await definition(), before);
});
