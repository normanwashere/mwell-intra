import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { loadAuthoritativeVendorChecklist, vendorApplicationCaseId } from './vendor-application-fixture.mjs';

const migration = await readFile(new URL('../../supabase/migrations/20260914053733_uat_vendor_fixture_atomic_cleanup.sql', import.meta.url), 'utf8');
const cutover = await readFile(new URL('../../supabase/migrations/20260709152000_live_intra_cutover_contract.sql', import.meta.url), 'utf8');
const policySource = await readFile(new URL('../../supabase/migrations/20260815154324_legal_vendor_launch_blockers.sql', import.meta.url), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const scope = { runId: 'QA-20260914-00003C1F', viewport: 'desktop-1440', buildId: 'a'.repeat(40), project: 'kkoitlvydytdhlpxhuah' };
const vendorId = '10000000-0000-4000-8000-000000000001';
const actorId = '20000000-0000-4000-8000-000000000001';
const legalId = '30000000-0000-4000-8000-000000000001';
const tables = ['accreditation_docs', 'vendor_application_snapshots', 'case_timeline', 'requirement_checklist_items', 'accreditation_cases'];
const createTable = name => cutover.match(new RegExp(`create table if not exists legal\\.${name} \\([\\s\\S]*?\\n\\);`))[0];

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema core; create schema legal; create schema private; create schema auth; create schema storage;
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role', true)$$;
    create table core.vendors(id uuid primary key, legal_name text, accreditation_status text, owner_module text);
    create table core.profiles(id uuid primary key, email text, kind text, status text, vendor_id uuid);
    create table core.documents(id uuid primary key, storage_path text);
    create table private.action_evidence(id uuid primary key, storage_path text);
    create table storage.objects(id uuid primary key, bucket_id text, name text, owner_id text,
      created_at timestamptz default now(), updated_at timestamptz default now(), metadata jsonb default '{}');
    create function core.verify_security_database_launch_blockers() returns jsonb language sql as $$select '{"raw_boundaries":1,"examples":[],"missing_objects":[]}'::jsonb$$;
    ${['accreditation_cases', 'requirement_checklist_items', 'vendor_invites', 'accreditation_docs', 'case_timeline', 'signed_instruments'].map(createTable).join('\n')}
    alter table legal.accreditation_cases add invited_by_user_id uuid, add technology_service_provider boolean;
    alter table legal.requirement_checklist_items add reviewer_id uuid, add policy_id text, add policy_version text, add policy_section text;
    alter table legal.vendor_invites add auth_user_id uuid, add link_generation integer, add accepted_generation integer;
    create table legal.vendor_application_snapshots(id uuid primary key, case_id text references legal.accreditation_cases(id) on delete restrict,
      created_by uuid, vendor_id uuid, version integer, status text, updated_at timestamptz default now());
    create table legal.instrument_documents(id uuid primary key, case_id text references legal.accreditation_cases(id) on delete restrict, storage_path text);
    ${policySource.slice(policySource.indexOf('create or replace function private.legal_tailored_requirement_set'), policySource.indexOf('\nrevoke all on function private.legal_tailored_requirement_set'))}
    ${migration}
    select set_config('request.jwt.claim.role', 'service_role', false);`);
  const policy = await loadAuthoritativeVendorChecklist();
  const id = vendorApplicationCaseId(scope);
  const intent = { version: 1, kind: 'synthetic-vendor-application-case', scope, certificationCredit: false,
    vendor: { id: vendorId, legal_name: 'MWELL UAT Test Vendor', accreditation_status: 'draft', owner_module: 'legal' },
    actor: { profile: { id: actorId, email: 'intra.test.vendor@mwell.com.ph', kind: 'vendor', status: 'active', vendor_id: vendorId } },
    legalActor: { profile: { id: legalId, email: 'intra.test.legal.lead@mwell.com.ph', kind: 'employee', status: 'active', vendor_id: null } },
    invite: { id: 'accepted-existing', auth_user_id: actorId, vendor_id: vendorId, status: 'accepted', link_generation: 2, accepted_generation: 2, case_id: 'existing-case' },
    case: { id, vendor_id: vendorId, vendor_name: `${scope.runId}-${scope.viewport} SYNTHETIC Application`, contact_email: 'intra.test.vendor@mwell.com.ph',
      invited_by_email: 'intra.test.legal.lead@mwell.com.ph', invited_by_user_id: legalId, status: 'draft',
      entity_type: 'sole_prop', jurisdiction: 'PH', category: 'goods', vendor_category: 'goods', risk_tier: 'low', contract_type: 'standard',
      handles_personal_data: false, technology_service_provider: false,
      scope: `SYNTHETIC QA ONLY ${hash(JSON.stringify(scope))} 40000000-0000-4000-8000-000000000001` },
    checklist: policy.rows.map(row => ({ ...row, id: `${id}_${row.code}`, case_id: id, decision: 'pending' })) };
  async function insert(table, row) {
    const keys = Object.keys(row);
    await db.query(`insert into ${table} (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
  }
  await insert('core.vendors', intent.vendor);
  await insert('core.profiles', intent.actor.profile);
  await insert('core.profiles', intent.legalActor.profile);
  await insert('legal.accreditation_cases', { id: 'existing-case', vendor_id: vendorId, vendor_name: 'Existing protected case', status: 'under_review' });
  await insert('legal.vendor_invites', { ...intent.invite, email: intent.actor.profile.email, company_name: intent.vendor.legal_name });
  await insert('legal.accreditation_cases', intent.case);
  for (const row of intent.checklist) await insert('legal.requirement_checklist_items', row);
  const snapshot = {};
  for (const table of tables) snapshot[table] = (await db.query(`select to_jsonb(t) as row from legal.${table} t where ${table === 'accreditation_cases' ? 'id' : 'case_id'} = $1 order by id`, [id])).rows.map(row => row.row);
  const manifest = { version: 1, intent, scopeText: JSON.stringify(scope), snapshot, storagePaths: [], bucket: 'documents' };
  const invoke = async (mode = 'execute', value = manifest) => {
    const manifestText = JSON.stringify(value);
    return (await db.query('select core.cleanup_uat_vendor_application($1::jsonb) as result', [JSON.stringify({ mode, manifestText, sha256: hash(manifestText) })])).rows[0].result;
  };
  return { db, intent, manifest, invoke, insert, id };
}

test('migration installs the bounded cleanup transport and keeps verifier checks', async t => {
  const h = await fixture(t);
  const result = (await h.db.query('select core.verify_security_database_launch_blockers() as result')).rows[0].result;
  assert.equal(result.raw_boundaries, 1);
  assert.deepEqual(result.missing_objects, []);
  assert.equal(result.vendor_fixture_checklist.rows.length, 9);
  assert.match(result.vendor_fixture_checklist.functionBodySha256, /^[a-f0-9]{64}$/);
  const acl = (await h.db.query(`select has_function_privilege('anon', 'core.cleanup_uat_vendor_application(jsonb)', 'execute') as anon,
    has_function_privilege('authenticated', 'core.cleanup_uat_vendor_application(jsonb)', 'execute') as authenticated,
    has_function_privilege('service_role', 'core.cleanup_uat_vendor_application(jsonb)', 'execute') as service`)).rows[0];
  assert.deepEqual(acl, { anon: false, authenticated: false, service: true });
});

test('atomic exact-case deletion returns a durable receipt without touching protected case/account/invite', async t => {
  const h = await fixture(t);
  const result = await h.invoke();
  assert.equal(result.complete, true);
  assert.equal(result.caseId, h.id);
  assert.deepEqual(await h.invoke('read'), result);
  assert.deepEqual(await h.invoke(), result);
  assert.equal((await h.db.query('select count(*)::int as n from legal.accreditation_cases')).rows[0].n, 1);
  assert.equal((await h.db.query('select count(*)::int as n from core.profiles')).rows[0].n, 2);
  assert.equal((await h.db.query('select count(*)::int as n from legal.vendor_invites')).rows[0].n, 1);
});

for (const change of ['review', 'timestamp', 'foreign-child', 'foreign-reference', 'protected-profile', 'snapshot-author', 'missing-fk']) {
  test(`interleaved ${change} after snapshot aborts before deleting any fixture rows`, async t => {
    const h = await fixture(t);
    if (change === 'review') await h.db.query("update legal.requirement_checklist_items set decision='accepted', reviewer_id=$1 where case_id=$2", [legalId, h.id]);
    if (change === 'timestamp') await h.db.query("update legal.accreditation_cases set updated_at=updated_at+interval '1 second' where id=$1", [h.id]);
    if (change === 'foreign-child') await h.insert('legal.case_timeline', { id: 'foreign', case_id: h.id, action: 'review', actor_email: 'other@example.com' });
    if (change === 'foreign-reference') {
      await h.db.exec('create table legal.future_reference(id text primary key, parent text references legal.accreditation_cases(id) on delete cascade)');
      await h.db.query("insert into legal.future_reference values ('foreign',$1)", [h.id]);
    }
    if (change === 'protected-profile') await h.db.query("update core.profiles set status='inactive' where id=$1", [actorId]);
    if (change === 'snapshot-author') await h.insert('legal.vendor_application_snapshots', { id: legalId, case_id: h.id, created_by: legalId, version: 1 });
    if (change === 'missing-fk') await h.db.exec('alter table legal.case_timeline drop constraint case_timeline_case_id_fkey');
    await assert.rejects(h.invoke(), /changed|reference|snapshot|binding/i);
    assert.equal((await h.db.query('select count(*)::int as n from legal.requirement_checklist_items')).rows[0].n, 9);
    assert.equal((await h.db.query('select count(*)::int as n from legal.accreditation_cases')).rows[0].n, 2);
    assert.deepEqual(await h.invoke('read'), { receipt: null });
  });
}

test('case-only partial setup is cleanup-safe, and a foreign recovery manifest is rejected', async t => {
  const h = await fixture(t);
  await h.db.query('delete from legal.requirement_checklist_items where case_id=$1', [h.id]);
  h.manifest.snapshot.requirement_checklist_items = [];
  assert.equal((await h.invoke()).complete, true);
  const other = structuredClone(h.manifest);
  other.intent.case.scope = other.intent.case.scope.replace('40000000-', '50000000-');
  await assert.rejects(h.invoke('execute', other), /another manifest/);
});

test('an absent case without a receipt is never certified as a successful cleanup', async t => {
  const h = await fixture(t);
  await h.db.query('delete from legal.accreditation_cases where id=$1', [h.id]);
  for (const table of tables) h.manifest.snapshot[table] = [];
  await assert.rejects(h.invoke(), /absent without committed cleanup receipt/);
  assert.deepEqual(await h.invoke('read'), { receipt: null });
});

test('receipt table is private and the RPC retains postgres ownership with an empty search path', async t => {
  const h = await fixture(t);
  const row = (await h.db.query(`select pg_get_userbyid(proowner) as owner, prosecdef, proconfig
    from pg_proc where oid='core.cleanup_uat_vendor_application(jsonb)'::regprocedure`)).rows[0];
  assert.equal(row.owner, 'postgres');
  assert.equal(row.prosecdef, true);
  assert.ok(row.proconfig.includes('search_path=""'));
  assert.ok(row.proconfig.includes('lock_timeout=2s'));
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const granted = (await h.db.query("select has_table_privilege($1, 'private.uat_vendor_fixture_cleanup_receipts', 'SELECT,INSERT,UPDATE,DELETE') as granted", [role])).rows[0].granted;
    assert.equal(granted, false);
  }
});

test('storage orphans remain bounded to reviewed case and selected document codes', async t => {
  const h = await fixture(t);
  h.manifest.storagePaths = [`vendor/${vendorId}/legal/accreditation/${h.id}/${actorId}_SYNTHETIC-QA-FOREIGN.pdf`];
  await assert.rejects(h.invoke(), /Storage requirement code/);
});

for (const fault of ['wrong-owner', 'foreign-reference', 'replaced-after-commit', 'recover-missing-object']) {
  test(`Storage ${fault} is checked by the real SQL receipt path`, async t => {
    const h = await fixture(t);
    const name = `vendor/${vendorId}/legal/accreditation/${h.id}/${actorId}_SYNTHETIC-QA-PH_DTI_REG.pdf`;
    h.manifest.storagePaths = [name];
    await h.insert('storage.objects', { id: actorId, bucket_id: 'documents', name, owner_id: fault === 'wrong-owner' ? legalId : actorId });
    if (fault === 'foreign-reference') await h.insert('core.documents', { id: legalId, storage_path: name });
    if (['wrong-owner', 'foreign-reference'].includes(fault)) {
      await assert.rejects(h.invoke(), /ownership|reference/i);
      assert.equal((await h.db.query('select count(*)::int as n from legal.requirement_checklist_items')).rows[0].n, 9);
    } else {
      assert.equal((await h.invoke()).storageObjects.length, 1);
      if (fault === 'replaced-after-commit') {
        await h.db.query("update storage.objects set updated_at=updated_at+interval '1 second' where id=$1", [actorId]);
        await assert.rejects(h.invoke('read'), /Storage object changed/);
      } else {
        await h.db.query('delete from storage.objects where id=$1', [actorId]);
        assert.equal((await h.invoke('read')).complete, true);
      }
    }
  });
}

test('a delete-trigger protected-binding change rolls back the entire cleanup', async t => {
  const h = await fixture(t);
  await h.db.exec(`create function legal.mutate_protected_test() returns trigger language plpgsql as $$begin
    update core.vendors set accreditation_status='approved' where id=old.vendor_id; return old; end;$$;
    create trigger mutate_protected_test before delete on legal.accreditation_cases for each row execute function legal.mutate_protected_test();`);
  await assert.rejects(h.invoke(), /Protected vendor changed during deletion/);
  assert.equal((await h.db.query('select accreditation_status from core.vendors')).rows[0].accreditation_status, 'draft');
  assert.equal((await h.db.query('select count(*)::int as n from legal.requirement_checklist_items')).rows[0].n, 9);
});

test('late delete failure rolls back earlier child deletes and the receipt', async t => {
  const h = await fixture(t);
  await h.db.exec(`create function legal.reject_test_delete() returns trigger language plpgsql as $$begin raise exception 'injected late delete failure'; end;$$;
    create trigger reject_test_delete before delete on legal.accreditation_cases for each row execute function legal.reject_test_delete();`);
  await assert.rejects(h.invoke(), /injected late/);
  assert.equal((await h.db.query('select count(*)::int as n from legal.requirement_checklist_items')).rows[0].n, 9);
  assert.deepEqual(await h.invoke('read'), { receipt: null });
});

for (const role of ['anon', 'authenticated', '']) {
  test(`cleanup denies ${role || 'absent actor'} even with owner SQL transport`, async t => {
    const h = await fixture(t);
    await h.db.query("select set_config('request.jwt.claim.role',$1,false)", [role]);
    await assert.rejects(h.invoke(), /Service role/);
  });
}

for (const key of ['project', 'buildId', 'viewport', 'runId']) {
  test(`cleanup denies forged ${key} scope`, async t => {
    const h = await fixture(t), foreign = structuredClone(h.manifest);
    foreign.intent.scope[key] = key === 'buildId' ? 'b'.repeat(40) : 'foreign';
    foreign.scopeText = JSON.stringify(foreign.intent.scope);
    await assert.rejects(h.invoke('execute', foreign), /scope|provenance/i);
  });
}
