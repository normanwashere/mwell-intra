import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationSql = readFileSync(
  fileURLToPath(
    new URL(
      "../supabase/migrations/20260812200000_learning_authority.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const registrySql = readFileSync(
  fileURLToPath(new URL("../packages/rbac/src/registry.ts", import.meta.url)),
  "utf8",
);
const mutationCapabilities = [
  ...registrySql.matchAll(/mutationCapability\('([^']+)',\s*'([^']+)'\)/g),
].map((match) => [match[1], match[2]]);

const ids = Object.freeze({
  user: "00000000-0000-0000-0000-000000000001",
  assignment: "00000000-0000-0000-0000-000000000002",
  department: "00000000-0000-0000-0000-000000000003",
  certification: "00000000-0000-0000-0000-000000000004",
  exception: "00000000-0000-0000-0000-000000000005",
  grantor: "00000000-0000-0000-0000-000000000006",
  approver: "00000000-0000-0000-0000-000000000007",
  curriculum: "00000000-0000-0000-0000-000000000008",
  requirement: "00000000-0000-0000-0000-000000000009",
  composition: "00000000-0000-0000-0000-000000000010",
});

async function createAuthorityDatabase() {
  const db = new PGlite();
  const mutationValues = mutationCapabilities
    .map(([module, capability]) => `('${module}', '${capability}')`)
    .join(",\n");
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema core;
    create schema learning;

    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role', true), '')
    $$;

    create table core.capabilities (
      module text not null,
      cap text not null,
      primary key (module, cap)
    );
    create table core.roles (
      module text not null,
      role text not null,
      is_active boolean not null,
      primary key (module, role)
    );
    create table core.role_capabilities (
      module text not null,
      role text not null,
      cap text not null,
      primary key (module, role, cap)
    );
    create table core.user_roles (
      id uuid primary key,
      user_id uuid not null,
      module text not null,
      role text not null
    );
    create table core.departments (
      id uuid primary key,
      is_active boolean not null
    );
    create table core.profile_department_scopes (
      id uuid primary key,
      profile_id uuid not null,
      department_id uuid not null,
      effective_from date not null,
      effective_to date
    );

    create table learning.certifications (
      id uuid primary key,
      user_id uuid not null,
      department_id uuid not null,
      source_role_assignment_id uuid not null,
      source_role text not null,
      module text not null,
      capability text not null,
      status text not null,
      effective_at timestamptz not null,
      expires_at timestamptz
    );
    create table learning.emergency_exceptions (
      id uuid primary key,
      user_id uuid not null,
      department_id uuid not null,
      audience text not null,
      module text not null,
      capability text not null,
      grantor_id uuid not null,
      approver_id uuid not null,
      effective_at timestamptz not null,
      expires_at timestamptz not null,
      status text not null,
      waives_legal_acknowledgment boolean not null
    );
    create table learning.curriculum_versions (
      id uuid primary key,
      audience text not null,
      status text not null,
      effective_at timestamptz,
      expires_at timestamptz
    );
    create table learning.requirement_versions (
      id uuid primary key,
      audience text not null,
      requirement_kind text not null,
      status text not null,
      waivable boolean not null,
      effective_at timestamptz,
      expires_at timestamptz
    );
    create table learning.curriculum_requirements (
      id uuid primary key,
      curriculum_version_id uuid not null,
      requirement_version_id uuid not null,
      audience text not null,
      mandatory boolean not null
    );
    create table learning.curriculum_capability_outcomes (
      id uuid primary key,
      curriculum_requirement_id uuid not null,
      curriculum_version_id uuid not null,
      requirement_version_id uuid not null,
      audience text not null,
      module text not null,
      capability text not null
    );
    create function learning.guard_authoritative_write_isolation()
    returns trigger language plpgsql as $$
    begin
      if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'READ COMMITTED required';
      end if;
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end;
    $$;
    create function core.has_cap(p_module text, p_cap text)
    returns boolean language sql stable security definer set search_path = '' as $$
      select coalesce(auth.role() = 'service_role', false) or exists (
        select 1
        from core.user_roles user_role
        join core.roles role_definition
          on role_definition.module = user_role.module
         and role_definition.role = user_role.role
         and role_definition.is_active
        join core.role_capabilities role_capability
          on role_capability.module = user_role.module
         and role_capability.role = user_role.role
        where user_role.user_id = auth.uid()
          and user_role.module = p_module
          and role_capability.cap = p_cap
      )
    $$;

    insert into core.capabilities(module, cap) values
      ${mutationValues},
      ('core', 'manage_own_accreditation_draft'),
      ('insights', 'prepare_exports'),
      ('warehouse', 'view_inventory');
    insert into core.roles(module, role, is_active)
      values ('warehouse', 'operator', true);
    insert into core.role_capabilities(module, role, cap) values
      ('warehouse', 'operator', 'view_inventory'),
      ('warehouse', 'operator', 'receive_stock');
    insert into core.user_roles(id, user_id, module, role) values
      ('${ids.assignment}', '${ids.user}', 'warehouse', 'operator');
    insert into core.departments(id, is_active)
      values ('${ids.department}', true);
    insert into core.profile_department_scopes(
      id, profile_id, department_id, effective_from, effective_to
    ) values (
      gen_random_uuid(), '${ids.user}', '${ids.department}',
      current_date - 1, null
    );

    grant usage on schema auth, core, learning to authenticated, service_role;
  `);
  await db.exec(migrationSql);
  for (const name of ["20260813203240_task_1_database_authority_remediation.sql", "20260815154702_procurement_finance_requester_privacy.sql"]) {
    const sql = readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
    const capabilities = sql.match(/insert into core\.capabilities\(module, cap\)[\s\S]*?;/i);
    assert.ok(capabilities, `Actual forward capabilities: ${name}`);
    await db.exec(capabilities[0]);
    const rules = sql.match(/insert into learning\.mutation_capability_rules\(module, capability\)[\s\S]*?;/i);
    assert.ok(rules, `Actual forward mutation rules: ${name}`);
    await db.exec(rules[0]);
  }
  return db;
}

async function asUser(db, expression) {
  await db.exec("set role authenticated");
  await db.exec(
    `select set_config('request.jwt.claim.sub', '${ids.user}', false)`,
  );
  await db.exec(
    "select set_config('request.jwt.claim.role', 'authenticated', false)",
  );
  try {
    return (await db.query(`select ${expression} as value`)).rows[0].value;
  } finally {
    await db.exec("reset role");
  }
}

test("projects read authority while withholding uncertified mutations", async () => {
  const db = await createAuthorityDatabase();
  try {
    assert.deepEqual(await asUser(db, "core.my_role_capabilities()"), {
      warehouse: ["receive_stock", "view_inventory"],
    });
    assert.deepEqual(await asUser(db, "core.my_capabilities()"), {
      warehouse: ["view_inventory"],
    });
  } finally {
    await db.close();
  }
});

function actualFunction(sql, name) {
  const start = sql.lastIndexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('as $$', start)) + 3);
}

const readMigration = name => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
async function installBoundaryCandidate(db) {
  await db.exec('set check_function_bodies=off; create schema if not exists warehouse; create schema if not exists procurement');
  for (const [name, migration] of [
    ['warehouse.cancel_purchase_order', '20260706092400_warehouse_rpcs'],
    ['procurement.acknowledge_purchase_order', '20260905090000_procurement_remediation'],
  ]) {
    if (!(await db.query('select to_regprocedure($1) found', [`${name}(jsonb)`])).rows[0].found)
      await db.exec(actualFunction(readMigration(migration), name));
  }
  // Reproduce the installed UAT ACLs, not PGlite's default PUBLIC execute grant.
  await db.exec(`revoke all on function warehouse.cancel_purchase_order(jsonb),procurement.acknowledge_purchase_order(jsonb) from public,anon,authenticated,service_role;
    grant execute on function warehouse.cancel_purchase_order(jsonb) to authenticated,service_role;
    grant execute on function procurement.acknowledge_purchase_order(jsonb) to authenticated;`);
  const fingerprint = async () => (await db.query(`select oid::regprocedure::text signature,proacl::text acl,
    proowner::regrole::text owner,prosecdef,proconfig,
    md5(coalesce(proacl::text,'')||'|'||proowner::regrole::text||'|'||prosecdef::text||'|'||coalesce(proconfig::text,'')) security_fingerprint
    from pg_proc where oid in ('warehouse.cancel_purchase_order(jsonb)'::regprocedure,
      'procurement.acknowledge_purchase_order(jsonb)'::regprocedure) order by 1`)).rows;
  const before = await fingerprint();
  assert.deepEqual(before.map(row => row.security_fingerprint), [
    '3c4d11dcf8faa1d9cdd8dc8695413f98', '7a431e17770fee2ed6c2aa66263b9a79',
  ], 'Fixture security fingerprints match read-only UAT inspection');
  const candidate = readMigration('20260906043800_gate_legacy_po_cancel_and_vendor_acknowledgement');
  await db.exec(candidate);
  assert.deepEqual(await fingerprint(), before, 'Candidate must preserve exact ACL/owner/security mode/search path');
  const definitions = async () => (await db.query(`select pg_get_functiondef(oid) definition from pg_proc
    where oid in ('warehouse.cancel_purchase_order(jsonb)'::regprocedure,
      'procurement.acknowledge_purchase_order(jsonb)'::regprocedure) order by oid`)).rows;
  const after = await definitions();
  await db.exec(candidate);
  assert.deepEqual(await definitions(), after, 'Reapplication must not duplicate or alter guards');
  assert.deepEqual(await fingerprint(), before);
}

async function publishCurrentPathway(db, module, role, capability, audience = 'internal') {
  await db.exec(`alter table core.user_roles add column effective_at timestamptz default now(), add column expires_at timestamptz;
    create table learning.role_curricula(module text,role text,department_id uuid,curriculum_version_id uuid,audience text,
      effective_at timestamptz,expires_at timestamptz);`);
  await db.query(`insert into learning.curriculum_versions values($1,$2,'published',now()-interval '1 day',null)`, [ids.curriculum, audience]);
  await db.query(`insert into learning.requirement_versions values($1,$2,'orientation','published',false,now()-interval '1 day',null)`, [ids.requirement, audience]);
  await db.query(`insert into learning.role_curricula values($1,$2,null,$3,$4,now()-interval '1 day',null)`, [module, role, ids.curriculum, audience]);
  await db.query(`insert into learning.curriculum_capability_outcomes values(gen_random_uuid(),$1,$2,$3,$4,$5,$6)`,
    [ids.composition, ids.curriculum, ids.requirement, audience, module, capability]);
  await db.exec(actualFunction(readMigration('20260816203000_scope_certification_pathways_to_assigned_roles'), 'learning.is_certification_required'));
}

async function certify(db, module, role, capability) {
  await db.query(`insert into learning.certifications(id,user_id,department_id,source_role_assignment_id,source_role,module,
    capability,status,effective_at,expires_at) select gen_random_uuid(),user_id,$1,id,role,module,$2,'active',now()-interval '1 minute',null
    from core.user_roles where user_id=$3 and module=$4 and role=$5`, [ids.department, capability, ids.user, module, role]);
}

test("read exploration never grants any registered mutation without certification", async () => {
  const db = await createAuthorityDatabase();
  try {
    for (const [module, capability] of mutationCapabilities) {
      await db.query(`insert into core.roles(module,role,is_active) values($1,'explorer',true) on conflict do nothing`, [module]);
      await db.query(`insert into core.role_capabilities(module,role,cap) values($1,'explorer',$2) on conflict do nothing`, [module, capability]);
      await db.query(`insert into core.user_roles(id,user_id,module,role) select gen_random_uuid(),$1,$2,'explorer'
        where not exists(select 1 from core.user_roles where user_id=$1 and module=$2 and role='explorer')`, [ids.user, module]);
      assert.equal(await asUser(db, `core.has_cap('${module}', '${capability}')`), true);
      assert.equal(await asUser(db, `core.has_live_cap('${module}', '${capability}')`), false, `${module}:${capability}`);
    }
    assert.equal(await asUser(db, "core.has_live_cap('warehouse', 'view_inventory')"), true);
    assert.equal((await db.query('select count(*)::int n from learning.certifications')).rows[0].n, 0);
  } finally { await db.close(); }
});

test("one certified role cannot lend credit to another module or a pending vendor mutation", async () => {
  const db = await createAuthorityDatabase();
  try {
    for (const [module, role, cap] of [['procurement','officer','author_po'], ['core','vendor','submit_accreditation']]) {
      await db.query('insert into core.roles values($1,$2,true)', [module, role]);
      await db.query('insert into core.role_capabilities values($1,$2,$3)', [module, role, cap]);
      await db.query('insert into core.user_roles values(gen_random_uuid(),$1,$2,$3)', [ids.user, module, role]);
    }
    await db.exec(`insert into learning.certifications(id,user_id,department_id,source_role_assignment_id,source_role,module,
      capability,status,effective_at,expires_at) values('${ids.certification}','${ids.user}','${ids.department}',
      '${ids.assignment}','operator','warehouse','receive_stock','active',now()-interval '1 minute',null)`);
    assert.equal(await asUser(db, "core.has_live_cap('warehouse','receive_stock')"), true);
    for (const [module, cap] of [['procurement','author_po'], ['core','submit_accreditation']]) {
      assert.equal(await asUser(db, `core.has_cap('${module}','${cap}')`), true);
      assert.equal(await asUser(db, `core.has_live_cap('${module}','${cap}')`), false);
    }
    assert.equal((await db.query('select count(*)::int n from learning.certifications')).rows[0].n, 1);
  } finally { await db.close(); }
});

test("actual vendor submission wrapper rejects uncertified direct RPC before its business handler", async () => {
  const db = await createAuthorityDatabase();
  try {
    await db.exec(`create schema private; create schema legal;
      create function private.policy_submit_vendor_application(jsonb) returns jsonb language plpgsql as $$
      begin raise exception 'BUSINESS HANDLER REACHED'; end; $$;
      insert into core.roles values('core','vendor',true);
      insert into core.role_capabilities values('core','vendor','submit_accreditation');
      insert into core.user_roles values(gen_random_uuid(),'${ids.user}','core','vendor');
      grant usage on schema legal to authenticated;`);
    const sql = readFileSync(new URL('../supabase/migrations/20260813203240_task_1_database_authority_remediation.sql', import.meta.url), 'utf8');
    await db.exec(actualFunction(sql, 'legal.submit_vendor_application'));
    await assert.rejects(asUser(db, "legal.submit_vendor_application('{}'::jsonb)"), /Not authorized: core.submit_accreditation/);
  } finally { await db.close(); }
});

test("legacy Warehouse cancellation: old read-only write is denied by candidate; certified exact Procurement authority succeeds", async () => {
  const db = await createAuthorityDatabase();
  try {
    await db.exec(`create schema warehouse;
      create table warehouse.purchase_orders(id text primary key,status text);
      insert into warehouse.purchase_orders values('legacy-open','open');
      insert into core.role_capabilities values('warehouse','operator','view_procurement');
      grant usage on schema warehouse to authenticated;`);
    const sql = readFileSync(new URL('../supabase/migrations/20260706092400_warehouse_rpcs.sql', import.meta.url), 'utf8');
    await db.exec(actualFunction(sql, 'warehouse.cancel_purchase_order'));
    assert.equal(await asUser(db, "core.has_live_cap('warehouse','receive_stock')"), false);
    // Red evidence: unchanged old RPC accepts read-only authority.
    assert.equal((await asUser(db, `warehouse.cancel_purchase_order('{"po_id":"legacy-open"}'::jsonb)`)).status, 'cancelled');
    assert.equal((await db.query('select count(*)::int n from learning.certifications')).rows[0].n, 0);
    await db.exec("update warehouse.purchase_orders set status='open'");
    await installBoundaryCandidate(db);
    await installBoundaryCandidate(db);
    const cancel = () => asUser(db, `warehouse.cancel_purchase_order('{"po_id":"legacy-open"}'::jsonb)`);
    await assert.rejects(cancel(), /certified Procurement PO cancellation/);
    await db.exec(`insert into core.roles values('procurement','procurement_officer',true);
      insert into core.role_capabilities values('procurement','procurement_officer','author_po'),('procurement','procurement_officer','cancel_purchase_order');
      insert into core.user_roles values(gen_random_uuid(),'${ids.user}','procurement','procurement_officer');`);
    await publishCurrentPathway(db, 'procurement', 'procurement_officer', 'author_po');
    await assert.rejects(cancel(), /certified Procurement PO cancellation/);
    await certify(db, 'warehouse', 'operator', 'receive_stock');
    await assert.rejects(cancel(), /certified Procurement PO cancellation/);
    assert.equal((await db.query('select status from warehouse.purchase_orders')).rows[0].status, 'open');
    assert.equal(await asUser(db, "core.has_live_cap('warehouse','view_procurement')"), true);
    await certify(db, 'procurement', 'procurement_officer', 'author_po');
    await db.exec("update learning.certifications set expires_at=now()-interval '1 second' where module='procurement'");
    await assert.rejects(cancel(), /certified Procurement PO cancellation/);
    await db.exec("update learning.certifications set expires_at=null where module='procurement'");
    await db.exec("delete from core.role_capabilities where cap='cancel_purchase_order'");
    await assert.rejects(cancel(), /certified Procurement PO cancellation/);
    await db.exec("insert into core.role_capabilities values('procurement','procurement_officer','cancel_purchase_order')");
    await db.exec("delete from core.role_capabilities where cap='view_procurement'");
    await assert.rejects(cancel(), /Not authorized: view_procurement/);
    await db.exec("insert into core.role_capabilities values('warehouse','operator','view_procurement')");
    await db.exec("update warehouse.purchase_orders set status='received'");
    await assert.rejects(cancel(), /fully received/);
    await db.exec("update warehouse.purchase_orders set status='open'");
    assert.equal((await cancel()).status, 'cancelled');
    await assert.rejects(cancel(), /already cancelled/);
  } finally { await db.close(); }
});

test("Vendor acknowledgement: candidate denies pending learning while retaining certified ownership/hash/revision checks", async () => {
  const db = await createAuthorityDatabase();
  try {
    await db.exec(`create schema private; create schema procurement; create schema legal;
      create table core.profiles(id uuid,vendor_id uuid,kind text,status text);
      create table legal.vendor_invites(auth_user_id uuid,vendor_id uuid,status text,accepted_generation integer,link_generation integer);
      insert into core.profiles values('${ids.user}','${ids.department}','vendor','active');
      insert into legal.vendor_invites values('${ids.user}','${ids.department}','accepted',1,1);
      create table procurement.requests(id text,solicitation_requirements jsonb);
      create table procurement.purchase_orders(id text,status text,core_vendor_id uuid,request_id text,po_number text,
        vendor_name text,lines jsonb,total numeric,expected_date date,issued_at timestamptz);
      create table procurement.purchase_order_lifecycle_state(purchase_order_id text,revision integer,acknowledged_at timestamptz,
        acknowledgement_reference text,updated_at timestamptz);
      create table procurement.purchase_order_lifecycle_events(purchase_order_id text,event_type text,expected_revision integer,
        resulting_revision integer,actor_id uuid,evidence_reference text,payload jsonb);
      create table procurement.purchase_order_closure_requests(id uuid,status text,decided_by uuid,purchase_order_id text);
      create function private.policy_po_lifecycle_projection(text) returns jsonb language sql as $$
        select to_jsonb(s) from procurement.purchase_order_lifecycle_state s where purchase_order_id=$1 $$;
      insert into procurement.requests values('request','{}');
      insert into procurement.purchase_orders values('po','issued','${ids.department}','request','PO','Vendor','[]',10,current_date,now());
      insert into procurement.purchase_order_lifecycle_state(purchase_order_id,revision) values('po',0);
      grant usage on schema procurement to authenticated;`);
    const read = name => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
    await db.exec(actualFunction(read('20260722180000_vendor_lifecycle_authority_remediation'), 'core.current_vendor_id'));
    await db.exec(actualFunction(read('20260822110000_mpic_procurement_policy_alignment'), 'private.policy_po_lifecycle_transition'));
    const remediation = read('20260905090000_procurement_remediation');
    await db.exec(actualFunction(remediation, 'procurement.vendor_purchase_order_acknowledgements'));
    await db.exec(actualFunction(remediation, 'procurement.acknowledge_purchase_order'));
    const documents = await asUser(db, "procurement.vendor_purchase_order_acknowledgements('{}'::jsonb)");
    const payload = { purchase_order_id: 'po', expected_revision: 0, document_hash: documents[0].documentHash, acknowledgement_reference: 'Reviewed' };
    await assert.rejects(asUser(db, `procurement.acknowledge_purchase_order('${JSON.stringify({ ...payload, document_hash: 'wrong' })}'::jsonb)`), /content changed/);
    // Red evidence from the actual old public RPC chain.
    await asUser(db, `procurement.acknowledge_purchase_order('${JSON.stringify(payload)}'::jsonb)`);
    assert.equal((await db.query('select revision from procurement.purchase_order_lifecycle_state')).rows[0].revision, 1);
    assert.equal((await db.query('select count(*)::int n from learning.certifications')).rows[0].n, 0);
    await db.exec(`update procurement.purchase_order_lifecycle_state set revision=0,acknowledged_at=null,acknowledgement_reference=null;
      delete from procurement.purchase_order_lifecycle_events;
      insert into core.roles values('core','vendor_portal',true);
      insert into core.role_capabilities values('core','vendor_portal','submit_accreditation');
      insert into core.user_roles values(gen_random_uuid(),'${ids.user}','core','vendor_portal');`);
    await publishCurrentPathway(db, 'core', 'vendor_portal', 'submit_accreditation', 'vendor');
    await installBoundaryCandidate(db);
    const acknowledge = (value = payload) => asUser(db, `procurement.acknowledge_purchase_order('${JSON.stringify(value)}'::jsonb)`);
    await assert.rejects(acknowledge(), /certified Vendor acknowledgement/);
    assert.equal((await asUser(db, "procurement.vendor_purchase_order_acknowledgements('{}'::jsonb)")).length, 1);
    await certify(db, 'warehouse', 'operator', 'receive_stock');
    await assert.rejects(acknowledge(), /certified Vendor acknowledgement/);
    assert.equal((await db.query('select count(*)::int n from procurement.purchase_order_lifecycle_events')).rows[0].n, 0);
    await certify(db, 'core', 'vendor_portal', 'submit_accreditation');
    await db.exec("update learning.certifications set expires_at=now()-interval '1 second' where module='core'");
    await assert.rejects(acknowledge(), /certified Vendor acknowledgement/);
    await db.exec("update learning.certifications set expires_at=null where module='core'");
    await db.exec("set role authenticated; select set_config('request.jwt.claim.sub','',false)");
    await assert.rejects(db.query('select procurement.acknowledge_purchase_order($1::jsonb)', [JSON.stringify(payload)]), /certified Vendor acknowledgement/);
    await db.exec('reset role');
    await db.exec("update legal.vendor_invites set accepted_generation=0");
    await assert.rejects(acknowledge(), /Vendor session is required/);
    await db.exec("update legal.vendor_invites set accepted_generation=1");
    await assert.rejects(acknowledge({ ...payload, document_hash: 'wrong' }), /content changed/);
    await assert.rejects(acknowledge({ ...payload, expected_revision: 9 }), /lifecycle changed/);
    await db.exec(`update procurement.purchase_orders set core_vendor_id='${ids.grantor}'`);
    await assert.rejects(acknowledge(), /content changed/);
    await db.exec(`update procurement.purchase_orders set core_vendor_id='${ids.department}'`);
    await acknowledge();
    assert.equal((await db.query('select revision from procurement.purchase_order_lifecycle_state')).rows[0].revision, 1);
    assert.equal((await db.query('select count(*)::int n from procurement.purchase_order_lifecycle_events')).rows[0].n, 1);
  } finally { await db.close(); }
});

test("activates only a current certification bound to the exact live role", async () => {
  const db = await createAuthorityDatabase();
  try {
    await db.exec(`
      insert into learning.certifications(
        id, user_id, department_id, source_role_assignment_id, source_role, module,
        capability, status, effective_at, expires_at
      ) values (
        '${ids.certification}', '${ids.user}', '${ids.department}', '${ids.assignment}', 'operator',
        'warehouse', 'receive_stock', 'active', now() - interval '1 minute',
        now() + interval '1 hour'
      );
    `);
    assert.equal(
      await asUser(db, "core.has_live_cap('warehouse', 'receive_stock')"),
      true,
    );

    await db.exec(`
      delete from core.profile_department_scopes
      where profile_id = '${ids.user}' and department_id = '${ids.department}'
    `);
    assert.equal(
      await asUser(db, "core.has_live_cap('warehouse', 'receive_stock')"),
      false,
    );
    await db.exec(`
      insert into core.profile_department_scopes(
        id, profile_id, department_id, effective_from, effective_to
      ) values (
        gen_random_uuid(), '${ids.user}', '${ids.department}',
        current_date - 1, null
      )
    `);

    await db.exec(`
      update core.profile_department_scopes
      set effective_to = current_date - 1
      where profile_id = '${ids.user}' and department_id = '${ids.department}'
    `);
    assert.equal(
      await asUser(db, "core.has_live_cap('warehouse', 'receive_stock')"),
      false,
    );
    await db.exec(`
      update core.profile_department_scopes
      set effective_to = null
      where profile_id = '${ids.user}' and department_id = '${ids.department}';
      update core.departments set is_active = false where id = '${ids.department}'
    `);
    assert.equal(
      await asUser(db, "core.has_live_cap('warehouse', 'receive_stock')"),
      false,
    );
    await db.exec(`
      update core.departments set is_active = true where id = '${ids.department}'
    `);

    await db.exec(`
      insert into core.roles(module, role, is_active)
        values ('warehouse', 'backup_operator', true);
      insert into core.role_capabilities(module, role, cap)
        values ('warehouse', 'backup_operator', 'receive_stock');
      insert into core.user_roles(id, user_id, module, role) values (
        gen_random_uuid(), '${ids.user}', 'warehouse', 'backup_operator'
      );
      delete from core.role_capabilities
      where module = 'warehouse'
        and role = 'operator'
        and cap = 'receive_stock';
    `);
    assert.equal(
      await asUser(db, "core.has_live_cap('warehouse', 'receive_stock')"),
      false,
    );

    await db.exec(`delete from core.user_roles where id = '${ids.assignment}'`);
    assert.equal(
      await asUser(db, "core.has_live_cap('warehouse', 'receive_stock')"),
      false,
    );
  } finally {
    await db.close();
  }
});

test("permits a bounded exception but never waives an effective policy", async () => {
  const db = await createAuthorityDatabase();
  try {
    await db.exec(`
      insert into learning.emergency_exceptions(
        id, user_id, department_id, audience, module, capability, grantor_id, approver_id,
        effective_at, expires_at, status, waives_legal_acknowledgment
      ) values (
        '${ids.exception}', '${ids.user}', '${ids.department}', 'internal', 'warehouse',
        'receive_stock', '${ids.grantor}', '${ids.approver}',
        now() - interval '1 minute', now() + interval '1 hour', 'active', false
      );
    `);
    assert.equal(
      await asUser(db, "core.has_live_cap('warehouse', 'receive_stock')"),
      true,
    );

    await db.exec(`
      delete from core.profile_department_scopes
      where profile_id = '${ids.user}' and department_id = '${ids.department}'
    `);
    assert.equal(
      await asUser(db, "core.has_live_cap('warehouse', 'receive_stock')"),
      false,
    );
    await db.exec(`
      insert into core.profile_department_scopes(
        id, profile_id, department_id, effective_from, effective_to
      ) values (
        gen_random_uuid(), '${ids.user}', '${ids.department}',
        current_date - 1, null
      )
    `);

    await db.exec(`
      update core.profile_department_scopes
      set effective_to = current_date - 1
      where profile_id = '${ids.user}' and department_id = '${ids.department}'
    `);
    assert.equal(
      await asUser(db, "core.has_live_cap('warehouse', 'receive_stock')"),
      false,
    );
    await db.exec(`
      update core.profile_department_scopes
      set effective_to = null
      where profile_id = '${ids.user}' and department_id = '${ids.department}';
      update core.departments set is_active = false where id = '${ids.department}'
    `);
    assert.equal(
      await asUser(db, "core.has_live_cap('warehouse', 'receive_stock')"),
      false,
    );
    await db.exec(`
      update core.departments set is_active = true where id = '${ids.department}'
    `);

    await db.exec(`
      insert into learning.curriculum_versions values (
        '${ids.curriculum}', 'internal', 'published',
        now() - interval '1 day', null
      );
      insert into learning.requirement_versions values (
        '${ids.requirement}', 'internal', 'policy', 'published', false,
        now() - interval '1 day', null
      );
      insert into learning.curriculum_requirements values (
        '${ids.composition}', '${ids.curriculum}', '${ids.requirement}',
        'internal', true
      );
      insert into learning.curriculum_capability_outcomes values (
        gen_random_uuid(), '${ids.composition}', '${ids.curriculum}',
        '${ids.requirement}', 'internal', 'warehouse', 'receive_stock'
      );
    `);
    assert.equal(
      await asUser(db, "core.has_live_cap('warehouse', 'receive_stock')"),
      false,
    );
  } finally {
    await db.close();
  }
});
