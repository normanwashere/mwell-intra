import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Local-only: no Supabase client, credentials, network, or persistent database.
// RED: VENDOR_UPLOAD_BASELINE=1 node --test --test-name-pattern="own-case upload" <this file>
const migrations = new URL('../supabase/migrations/', import.meta.url);
const read = name => readFileSync(new URL(`${name}.sql`, migrations), 'utf8');
function definition(file, name) {
  const source = read(file);
  const start = source.indexOf(`create or replace function ${name}(`);
  assert.notEqual(start, -1, `${file}: ${name}`);
  const end = source.indexOf('$$;', start);
  assert.notEqual(end, -1, `${file}: function terminator`);
  return source.slice(start, end + 3);
}
const delegate = 'upload_accreditation_doc_rawcap_20260816_impl_58a7e4';
// pg_get_functiondef read-only on kkoitlvydytdhlpxhuah, 2026-09-21 (CI202).
const actualOldWrapper = `
  create or replace function legal.upload_accreditation_doc(payload jsonb)
  returns jsonb language plpgsql security definer set search_path = '' as $$
  begin
    if auth.role() <> 'service_role'
       and not core.has_live_cap('legal', 'review_accreditation') then
      raise exception 'Not authorized: %', 'legal.review_accreditation';
    end if;
    return legal.${delegate}(payload);
  end;
  $$;
`;
const forward = () => {
  const files = readdirSync(migrations).filter(name => name.endsWith('_vendor_document_upload_authorization.sql'));
  assert.equal(files.length, 1, 'exactly one forward upload migration');
  return readFileSync(new URL(files[0], migrations), 'utf8');
};
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [vendorUser, legalUser, vendor, foreignVendor, vendorRole, legalRole, department, curriculum, requirement] =
  [1, 2, 3, 4, 5, 6, 7, 8, 9].map(id);
const payload = { case_id: 'own', vendor_id: vendor, requirement_id: 'own_req',
  doc_type: 'PH_DTI_REG', filename: 'registration.pdf', mime_type: 'application/pdf',
  size_bytes: 42, storage_path: 'legal/accreditation/own/registration.pdf' };

async function setup() {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth; create schema core; create schema legal; create schema learning; create schema private;
      create role authenticated; create role anon; create role service_role;
      grant usage on schema auth,core,legal to authenticated,anon,service_role;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.uid',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$
        select nullif(current_setting('test.role',true),'') $$;
      create function auth.jwt() returns jsonb language sql stable as $$
        select jsonb_build_object('email','upload-test@example.invalid') $$;
      create table core.profiles(id uuid primary key,kind text,status text,vendor_id uuid);
      create table core.user_roles(id uuid,user_id uuid,module text,role text,effective_at timestamptz,expires_at timestamptz);
      create table core.roles(module text,role text,is_active boolean);
      create table core.role_capabilities(module text,role text,cap text);
      create table core.departments(id uuid,code text,is_active boolean);
      create table core.profile_department_scopes(profile_id uuid,department_id uuid,effective_from date,effective_to date);
      create table legal.vendor_invites(auth_user_id uuid,vendor_id uuid,status text,accepted_generation int,link_generation int);
      create table learning.mutation_capability_rules(module text,capability text);
      create table learning.role_curricula(module text,role text,department_id uuid,curriculum_version_id uuid,
        audience text,effective_at timestamptz,expires_at timestamptz);
      create table learning.curriculum_versions(id uuid,audience text,status text,effective_at timestamptz,expires_at timestamptz);
      create table learning.requirement_versions(id uuid,audience text,status text,effective_at timestamptz,expires_at timestamptz,
        requirement_kind text,waivable boolean);
      create table learning.curriculum_capability_outcomes(curriculum_version_id uuid,audience text,module text,capability text,
        requirement_version_id uuid,curriculum_requirement_id uuid);
      create table learning.curriculum_requirements(id uuid,curriculum_version_id uuid,requirement_version_id uuid,audience text,mandatory boolean);
      create table learning.certifications(user_id uuid,department_id uuid,source_role_assignment_id uuid,source_role text,
        module text,capability text,status text,effective_at timestamptz,expires_at timestamptz,audience text,
        assignment_id uuid,curriculum_version_id uuid,requirement_version_ids uuid[]);
      create table learning.assignments(id uuid,user_id uuid,department_id uuid,profile_kind text,audience text,
        source_type text,source_id uuid,status text,curriculum_version_id uuid);
      create table learning.assignment_requirements(assignment_id uuid,user_id uuid,department_id uuid,audience text,
        requirement_version_id uuid,status text);
      create table learning.emergency_exceptions(user_id uuid,department_id uuid,module text,capability text,audience text,
        status text,effective_at timestamptz,expires_at timestamptz,grantor_id uuid,approver_id uuid,waives_legal_acknowledgment boolean);
      create table legal.accreditation_cases(id text primary key,vendor_id uuid not null,status text default 'draft',
        submitted_at timestamptz,updated_at timestamptz);
      create table legal.requirement_checklist_items(id text primary key,case_id text references legal.accreditation_cases,
        document_ids text[] not null default '{}',updated_at timestamptz,decision text default 'pending');
      create table legal.accreditation_docs(id text primary key default gen_random_uuid()::text,
        case_id text references legal.accreditation_cases,vendor_id uuid,requirement_id text references legal.requirement_checklist_items,
        doc_type text,filename text,mime_type text,size_bytes bigint,storage_path text,data_url text,status text,
        version int,uploaded_by_email text,expires_at date);
      create table legal.case_timeline(id bigint generated always as identity,case_id text,actor_email text,action text,detail text);
      alter table legal.accreditation_cases enable row level security;
      alter table legal.requirement_checklist_items enable row level security;
      alter table legal.accreditation_docs enable row level security;
      insert into core.profiles values('${vendorUser}','vendor','active','${vendor}'),('${legalUser}','employee','active',null);
      insert into core.roles values('core','vendor_portal',true),('legal','legal_lead',true);
      insert into core.user_roles values
        ('${vendorRole}','${vendorUser}','core','vendor_portal',now()-interval '2 days',null),
        ('${legalRole}','${legalUser}','legal','legal_lead',now()-interval '2 days',null);
      insert into core.role_capabilities values
        ('core','vendor_portal','submit_documents'),('core','vendor_portal','submit_accreditation'),
        ('legal','legal_lead','review_accreditation'),('legal','legal_lead','submit_documents');
      insert into legal.vendor_invites values('${vendorUser}','${vendor}','accepted',1,1);
      insert into legal.accreditation_cases(id,vendor_id) values('own','${vendor}'),('foreign','${foreignVendor}'),('own_other','${vendor}');
      insert into legal.requirement_checklist_items(id,case_id) values('own_req','own'),('foreign_req','foreign'),('own_other_req','own_other');
      insert into learning.mutation_capability_rules values('core','submit_accreditation'),('legal','review_accreditation');
      insert into core.departments values('${department}','legal_compliance',true);
      insert into core.profile_department_scopes values('${legalUser}','${department}',current_date-1,null);
      insert into learning.curriculum_versions values('${curriculum}','internal','published',now()-interval '1 day',null);
      insert into learning.requirement_versions values('${requirement}','internal','published',now()-interval '1 day',null,'assessment',false);
      insert into learning.role_curricula values
        ('legal','legal_lead',null,'${curriculum}','internal',now()-interval '1 day',null),
        ('core','vendor_portal',null,'${curriculum}','internal',now()-interval '1 day',null);
      insert into learning.curriculum_capability_outcomes values
        ('${curriculum}','internal','legal','review_accreditation','${requirement}',null),
        ('${curriculum}','internal','core','submit_accreditation','${requirement}',null);
      insert into learning.certifications(user_id,department_id,source_role_assignment_id,source_role,module,capability,status,effective_at,audience)
        values('${legalUser}','${department}','${legalRole}','legal_lead','legal','review_accreditation','active',now()-interval '1 day','internal');
    `);
    for (const [file, names] of [
      ['20260816090000_security_database_launch_blocker_convergence', ['core.has_cap', 'core.has_any_cap']],
      ['20260722180000_vendor_lifecycle_authority_remediation', ['core.current_vendor_id', 'core.is_vendor']],
      ['20260816203000_scope_certification_pathways_to_assigned_roles', ['learning.is_certification_required']],
      ['20260912131000_vendor_certification_scope_authority', ['learning.has_active_certification']],
      ['20260812200000_learning_authority', ['learning.has_active_emergency_exception', 'core.has_live_cap']],
      ['20260710093000_p0_p1_production_readiness_fixes', ['legal.upload_accreditation_doc']],
      ['20260815154324_legal_vendor_launch_blockers', ['legal.submit_vendor_application']],
      ['20260709152000_live_intra_cutover_contract', ['legal.submit_accreditation_case']],
    ]) {
      for (const name of names) await db.exec(definition(file, name));
    }
    await db.exec(`
      alter function legal.upload_accreditation_doc(jsonb) rename to ${delegate};
      revoke all on function legal.${delegate}(jsonb) from public,anon,authenticated;
      grant execute on function legal.${delegate}(jsonb) to service_role;
      ${actualOldWrapper}
      revoke all on function legal.upload_accreditation_doc(jsonb) from public,anon;
      grant execute on function legal.upload_accreditation_doc(jsonb) to authenticated,service_role;
    `);
    return db;
  } catch (error) { await db.close(); throw error; }
}
async function useDb(run, apply = true) {
  const db = await setup();
  try {
    if (apply && process.env.VENDOR_UPLOAD_BASELINE !== '1') await db.exec(forward());
    await run(db);
  } finally { await db.close(); }
}
async function actor(db, user = vendorUser, role = 'authenticated') {
  await db.query("select set_config('test.uid',$1,false),set_config('test.role',$2,false)", [user, role]);
  await db.exec(`set local role ${role}`);
}
const upload = (db, input = payload, fn = 'upload_accreditation_doc') =>
  db.query(`select legal.${fn}($1::jsonb) as doc`, [JSON.stringify(input)]);
async function snapshot(db) {
  return (await db.query(`select
    (select jsonb_agg(d order by id) from legal.accreditation_docs d) docs,
    (select jsonb_agg(c order by id) from legal.accreditation_cases c) cases,
    (select jsonb_agg(r order by id) from legal.requirement_checklist_items r) checklist,
    (select jsonb_agg(t order by id) from legal.case_timeline t) timeline`)).rows;
}
async function denied(db, { sql = '', input = payload, user = vendorUser, role = 'authenticated',
  fn = 'upload_accreditation_doc', message = /Not authorized|not accessible|mismatch|not found|permission denied/ } = {}) {
  const before = await snapshot(db);
  await db.exec('begin');
  try {
    if (sql) await db.exec(sql);
    await actor(db, user, role);
    await db.exec('savepoint attempt');
    await assert.rejects(upload(db, input, fn), error => {
      assert.ok(['P0001', '42501', '22P02'].includes(error.code), error.message);
      assert.match(error.message, message);
      return true;
    });
    await db.exec('rollback to savepoint attempt; reset role');
    assert.deepEqual(await snapshot(db), before, 'denial must not write document, checklist, timeline or case');
  } finally { await db.exec('rollback'); }
}

test('own-case upload works without Legal authority or vendor certification', () => useDb(async db => {
  await db.exec('begin');
  try {
    await actor(db);
    const caps = (await db.query(`select core.is_vendor() vendor,core.has_live_cap('core','submit_documents') upload,
      core.has_live_cap('legal','review_accreditation') review,core.has_live_cap('core','submit_accreditation') submit`)).rows[0];
    assert.deepEqual(caps, { vendor: true, upload: true, review: false, submit: false });
    const first = (await upload(db)).rows[0].doc;
    assert.equal(first.vendor_id, vendor);
    assert.equal(first.case_id, 'own');
    assert.equal(first.requirement_id, 'own_req');
    assert.equal(first.status, 'submitted');
    assert.equal(first.storage_path, payload.storage_path);
    assert.equal(first.version, 1);
    const second = (await upload(db, { ...payload, vendor_id: '' })).rows[0].doc;
    assert.equal(second.version, 2);
    assert.equal(second.vendor_id, vendor);
    await assert.rejects(db.query('select legal.submit_vendor_application($1::jsonb)', [JSON.stringify(payload)]),
      /Not authorized: core.submit_accreditation/);
    // A failed statement aborts its transaction; side effects are inspected below in a fresh attempt.
  } finally { await db.exec('rollback'); }
  await db.exec('begin');
  try {
    await actor(db);
    const doc = (await upload(db)).rows[0].doc;
    await db.exec('reset role');
    assert.deepEqual((await db.query("select document_ids,decision from legal.requirement_checklist_items where id='own_req'")).rows,
      [{ document_ids: [doc.id], decision: 'pending' }]);
    assert.deepEqual((await db.query("select document_ids from legal.requirement_checklist_items where id='foreign_req'")).rows,
      [{ document_ids: [] }]);
    assert.deepEqual((await db.query('select status,submitted_at from legal.accreditation_cases where id=\'own\'')).rows,
      [{ status: 'draft', submitted_at: null }]);
    assert.deepEqual((await db.query('select action from legal.case_timeline')).rows, [{ action: 'doc_uploaded' }]);
  } finally { await db.exec('rollback'); }
}));

test('vendor payload cannot select a foreign case, vendor, or unrelated requirement', () => useDb(async db => {
  for (const input of [
    { ...payload, case_id: 'foreign', requirement_id: 'foreign_req', vendor_id: foreignVendor },
    { ...payload, case_id: 'foreign' },
    { ...payload, vendor_id: foreignVendor },
    { ...payload, requirement_id: 'foreign_req' },
    { ...payload, requirement_id: 'own_other_req' },
    { ...payload, requirement_id: 'missing' },
    { ...payload, case_id: 'missing' },
    { ...payload, case_id: null },
    {}, null,
  ]) await denied(db, { input });
  await denied(db, { input: { ...payload, vendor_id: 'not-a-uuid' }, message: /invalid input syntax for type uuid/ });
  await db.exec('begin');
  try {
    await actor(db);
    for (const requirement_id of [undefined, null, '']) {
      const doc = (await upload(db, { ...payload, vendor_id: undefined, requirement_id })).rows[0].doc;
      assert.equal(doc.vendor_id, vendor);
      assert.equal(doc.requirement_id, null, 'unbound optional documents remain supported');
    }
  } finally { await db.exec('rollback'); }
}));

test('current role and invite authority deny expired, revoked, inactive and wrong-vendor callers', () => useDb(async db => {
  for (const sql of [
    `update core.user_roles set expires_at=now()-interval '1 day' where user_id='${vendorUser}'`,
    `update core.user_roles set effective_at=now()+interval '1 day' where user_id='${vendorUser}'`,
    `delete from core.user_roles where user_id='${vendorUser}'`,
    "delete from core.role_capabilities where module='core' and cap='submit_documents'",
    "update core.role_capabilities set module='other' where module='core' and cap='submit_documents'",
    `delete from core.role_capabilities where module='core' and cap='submit_documents';
      insert into core.roles values('other','uploader',true);
      insert into core.user_roles values('${id(90)}','${vendorUser}','other','uploader',now()-interval '1 day',null);
      insert into core.role_capabilities values('other','uploader','submit_documents')`,
    "update core.roles set is_active=false where module='core'",
    `update core.profiles set status='inactive' where id='${vendorUser}'`,
    `update core.profiles set kind='employee' where id='${vendorUser}'`,
    `update core.profiles set vendor_id='${foreignVendor}' where id='${vendorUser}'`,
    `update core.profiles set vendor_id=null where id='${vendorUser}'`,
    "update legal.vendor_invites set status='revoked'",
    'update legal.vendor_invites set accepted_generation=0',
    'delete from legal.vendor_invites',
  ]) await denied(db, { sql });
  await denied(db, { user: '' });
}));

test('effective Legal review path and its raw submit_documents requirement are preserved', () => useDb(async db => {
  await db.exec('begin');
  try {
    await actor(db, legalUser);
    assert.equal((await db.query("select core.has_live_cap('legal','review_accreditation') allowed")).rows[0].allowed, true);
    for (const [case_id, vendor_id, requirement_id] of [['own', vendor, 'own_req'], ['foreign', foreignVendor, 'foreign_req']]) {
      const doc = (await upload(db, { ...payload, case_id, vendor_id, requirement_id })).rows[0].doc;
      assert.equal(doc.case_id, case_id);
      assert.equal(doc.vendor_id, vendor_id);
    }
  } finally { await db.exec('rollback'); }
  for (const sql of [
    "update learning.certifications set status='revoked'",
    "update learning.certifications set expires_at=now()-interval '1 day'",
    `update core.user_roles set expires_at=now()-interval '1 day' where user_id='${legalUser}'`,
    "update core.roles set is_active=false where module='legal'",
    "delete from core.role_capabilities where module='legal' and cap='submit_documents'",
  ]) await denied(db, { user: legalUser, sql });
}));

test('internal delegate is unavailable to API callers and service behavior is preserved', () => useDb(async db => {
  for (const role of ['authenticated', 'anon']) await denied(db, { role, fn: delegate, message: /permission denied for function/ });
  await denied(db, { role: 'anon', message: /permission denied for function/ });
  await db.exec('begin');
  try {
    await actor(db, '', 'service_role');
    const input = { ...payload, case_id: 'foreign', vendor_id: foreignVendor, requirement_id: 'foreign_req' };
    assert.equal((await upload(db, input)).rows[0].doc.vendor_id, foreignVendor);
    assert.equal((await upload(db, input, delegate)).rows[0].doc.version, 2);
  } finally { await db.exec('rollback'); }
}));

test('forward SQL changes only the upload wrapper, preserving ACLs, raw body, and later submission', () => useDb(async db => {
  const catalog = async () => (await db.query(`select n.nspname,p.proname,p.prosrc,p.proacl,p.proowner,p.prosecdef,p.proconfig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('legal','core','learning','private') order by n.nspname,p.proname`)).rows;
  const before = await catalog();
  const data = await snapshot(db);
  const authority = (await db.query('select * from core.role_capabilities order by module,role,cap')).rows;
  await db.exec(forward());
  const after = await catalog();
  const other = rows => rows.filter(row => row.proname !== 'upload_accreditation_doc');
  assert.deepEqual(other(after), other(before));
  const wrapper = rows => rows.find(row => row.proname === 'upload_accreditation_doc');
  assert.deepEqual({ ...wrapper(after), prosrc: '' }, { ...wrapper(before), prosrc: '' });
  assert.deepEqual(await snapshot(db), data);
  assert.deepEqual((await db.query('select * from core.role_capabilities order by module,role,cap')).rows, authority);
  await db.exec(forward());
  assert.deepEqual(await catalog(), after, 'reapplying is idempotent');
}, false));

test('migration follows the installed delegate suffix and refuses unsafe delegate drift', () => useDb(async db => {
  const otherDelegate = 'upload_accreditation_doc_rawcap_20260816_impl_abcdef';
  await db.exec(`alter function legal.${delegate}(jsonb) rename to ${otherDelegate};
    ${actualOldWrapper.replaceAll(delegate, otherDelegate)}`);
  await db.exec(forward());
  await db.exec('begin');
  try {
    await actor(db);
    assert.equal((await upload(db)).rows[0].doc.vendor_id, vendor);
  } finally { await db.exec('rollback'); }
  for (const [sql, message] of [
    [`grant execute on function legal.${otherDelegate}(jsonb) to authenticated`, /unavailable to API callers/],
    [`grant execute on function legal.${otherDelegate}(jsonb) to public`, /unavailable to API callers/],
    [`drop function legal.${otherDelegate}(jsonb)`, /delegate is missing/],
    [actualOldWrapper.replace(`legal.${delegate}(payload)`, 'private.unexpected_upload(payload)'), /Unexpected accreditation upload wrapper/],
  ]) {
    await db.exec('begin');
    try {
      await db.exec(sql);
      await assert.rejects(db.exec(forward()), message);
    } finally { await db.exec('rollback'); }
  }
}, false));
