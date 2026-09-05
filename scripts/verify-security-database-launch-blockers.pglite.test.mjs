import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { verifySecurityDatabaseLaunchBlockers } from "./verify-security-database-launch-blockers.mjs";
import { QUALITY_CHAIN_CONTRACT_SQL } from "./quality-inspection-chain-contract.mjs";
import { installActualQualityChain, installPriorReadVerifier, verifierMigration } from "./quality-inspection-verifier-fixture.mjs";

const MIGRATION = resolve(
  import.meta.dirname,
  "../supabase/migrations/20260816090000_security_database_launch_blocker_convergence.sql",
);
const migrationSql = readFileSync(MIGRATION, "utf8");

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const DEPARTMENT_ID = "22222222-2222-4222-8222-222222222222";
const ROLE_ASSIGNMENT_ID = "33333333-3333-4333-8333-333333333333";
const ASSIGNMENT_A = "44444444-4444-4444-8444-444444444444";
const ASSIGNMENT_B = "55555555-5555-4555-8555-555555555555";

test("convergence migration executes and enforces critical launch contracts", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create schema core;
      create schema learning;
      create schema warehouse;
      create schema procurement;
      create schema legal;
      create schema private;

      create function auth.role() returns text language sql stable
        as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

      create table core.profiles(
        id uuid primary key,
        email text not null unique,
        kind text not null default 'employee',
        status text not null default 'active'
      );
      create table core.departments(id uuid primary key, name text, is_active boolean default true);
      create table core.roles(
        module text not null,
        role text not null,
        label text not null,
        is_active boolean not null default true,
        primary key(module, role)
      );
      create table core.capabilities(module text, cap text, primary key(module, cap));
      create table core.role_capabilities(
        module text,
        role text,
        cap text,
        primary key(module, role, cap)
      );
      create table core.user_roles(
        user_id uuid not null references core.profiles(id),
        module text not null,
        role text not null,
        id uuid not null default gen_random_uuid(),
        primary key(user_id, module, role)
      );
      create table core.role_change_evidence(
        id uuid primary key default gen_random_uuid(),
        user_id uuid,
        module text,
        role text,
        action text,
        approval_reference text,
        reason text,
        effective_at timestamptz,
        expires_at timestamptz,
        changed_by uuid
      );
      create table core.activity_log(
        module text,
        entity_type text,
        entity_id text,
        action text,
        actor uuid,
        detail jsonb
      );

      create function core.lock_role_bundle_keys(text, text) returns void
        language sql as $$ select $$;
      create function core.sync_user_role_claims(uuid) returns jsonb
        language sql as $$ select '{}'::jsonb $$;
      create function core.has_cap(p_module text, p_cap text) returns boolean
        language sql stable security definer set search_path = '' as $$
          select exists (
            select 1
            from core.user_roles role_assignment
            join core.role_capabilities role_capability
              on role_capability.module = role_assignment.module
             and role_capability.role = role_assignment.role
            where role_assignment.user_id = auth.uid()
              and role_assignment.module = p_module
              and role_capability.cap = p_cap
          )
        $$;
      create function core.has_live_cap(p_module text, p_cap text) returns boolean
        language sql stable security definer set search_path = ''
        as $$ select core.has_cap(p_module, p_cap) $$;

      create table warehouse.receipts(
        id text primary key,
        quality_status text,
        created_at timestamptz default now()
      );
      create table warehouse.cycle_counts(
        id text primary key,
        status text,
        submitted_at timestamptz,
        created_at timestamptz default now()
      );
      create table warehouse.events(
        id text primary key,
        name text,
        start_date date
      );
      create table procurement.requests(
        id text primary key,
        title text,
        status text,
        updated_at timestamptz default now()
      );
      create table procurement.payment_readiness_packs(
        id uuid primary key,
        purchase_order_id text,
        status text,
        prepared_at timestamptz default now()
      );
      create table legal.accreditation_cases(
        id text primary key,
        status text,
        submitted_at timestamptz,
        created_at timestamptz default now()
      );

      create table learning.mutation_capability_rules(
        module text,
        capability text,
        primary key(module, capability)
      );
      create table learning.assignments(
        id uuid primary key,
        user_id uuid not null,
        profile_kind text not null,
        department_id uuid not null,
        curriculum_version_id uuid not null,
        audience text not null,
        source_type text not null,
        source_id uuid not null,
        status text not null,
        completed_at timestamptz,
        blocked_reason text,
        superseded_by_id uuid,
        created_at timestamptz default now()
      );
      create table learning.certifications(
        id uuid primary key default gen_random_uuid(),
        user_id uuid not null,
        assignment_id uuid not null,
        evidence_references jsonb not null default '[]'::jsonb
      );
      create function learning.noop_guard() returns trigger language plpgsql as $$
      begin
        if tg_op = 'DELETE' then return old; end if;
        return new;
      end $$;
      create trigger learning_assignments_read_committed_guard
        before insert or update or delete on learning.assignments
        for each row execute function learning.noop_guard();
      create trigger learning_assignments_lifecycle_guard
        before insert or update or delete on learning.assignments
        for each row execute function learning.noop_guard();
      create trigger learning_certifications_read_committed_guard
        before insert or update or delete on learning.certifications
        for each row execute function learning.noop_guard();
      create trigger learning_certifications_lifecycle_guard
        before update or delete on learning.certifications
        for each row execute function learning.noop_guard();
      create function learning.evaluate_certifications() returns jsonb
        language sql as $$ select '{}'::jsonb $$;

      create table private.learning_assessment_answer_keys(
        id uuid primary key default gen_random_uuid(),
        created_by uuid,
        updated_by uuid
      );

      insert into core.profiles(id, email) values ('${ADMIN_ID}', 'admin@example.test');
      insert into core.departments(id, name) values ('${DEPARTMENT_ID}', 'Operations');
      insert into core.roles(module, role, label) values
        ('core', 'platform_admin', 'Platform administrator'),
        ('warehouse', 'operations', 'Operations');
      insert into core.capabilities(module, cap) values
        ('core', 'manage_rbac'), ('warehouse', 'issue_items');
      insert into core.role_capabilities(module, role, cap) values
        ('core', 'platform_admin', 'manage_rbac'),
        ('warehouse', 'operations', 'issue_items');
      insert into core.user_roles(user_id, module, role, id) values
        ('${ADMIN_ID}', 'core', 'platform_admin', gen_random_uuid()),
        ('${ADMIN_ID}', 'warehouse', 'operations', '${ROLE_ASSIGNMENT_ID}');
      insert into learning.mutation_capability_rules(module, capability)
        values ('warehouse', 'issue_items');

      create function warehouse.raw_mutation(payload jsonb) returns jsonb
      language plpgsql security definer set search_path = '' as $$
      begin
        if not core.has_cap('warehouse', 'issue_items') then
          raise exception 'raw authority denied';
        end if;
        return payload;
      end $$;
      grant execute on function warehouse.raw_mutation(jsonb) to authenticated;

      insert into learning.assignments(
        id, user_id, profile_kind, department_id, curriculum_version_id,
        audience, source_type, source_id, status, completed_at, created_at
      ) values
        ('${ASSIGNMENT_A}', '${ADMIN_ID}', 'employee', '${DEPARTMENT_ID}',
         '66666666-6666-4666-8666-666666666666', 'internal', 'role',
         '${ROLE_ASSIGNMENT_ID}', 'completed', now() - interval '1 day', now() - interval '1 day'),
        ('${ASSIGNMENT_B}', '${ADMIN_ID}', 'employee', '${DEPARTMENT_ID}',
         '66666666-6666-4666-8666-666666666666', 'internal', 'role',
         '${ROLE_ASSIGNMENT_ID}', 'completed', now(), now());
      insert into learning.certifications(user_id, assignment_id, evidence_references)
        values ('${ADMIN_ID}', '${ASSIGNMENT_B}', '[{"type":"test"}]'::jsonb);

      select set_config('request.jwt.claim.sub', '${ADMIN_ID}', false);
      select set_config('request.jwt.claim.role', 'authenticated', false);
    `);

    await db.exec(migrationSql);
    await installActualQualityChain(db);
    await installPriorReadVerifier(db);
    assert(verifierMigration.includes(QUALITY_CHAIN_CONTRACT_SQL.trim()), "local and installed verifier pin exactly the same chain");
    await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
    const priorSummary = (await db.query("select core.verify_security_database_launch_blockers() result")).rows[0].result;
    assert((await db.query("select core.verify_launch_read_contracts() result")).rows[0].result.missing_grants.includes("warehouse.inspect_quality exact PO-line delegate"), "actual pre-repair validator falsely rejects current chain");
    await db.exec(verifierMigration);
    assert.deepEqual((await db.query("select core.verify_security_database_launch_blockers() result")).rows[0].result, priorSummary, "all existing security checks retained");
    assert.deepEqual((await db.query("select core.verify_launch_read_contracts() result")).rows[0].result.missing_grants, []);
    assert.equal((await db.query(`select (${QUALITY_CHAIN_CONTRACT_SQL}) ok`)).rows[0].ok, true, "actual migrated bodies match reviewed UAT fingerprints");

    const definitions = (await db.query("select oid::regprocedure::text signature,pg_get_functiondef(oid) body from pg_proc where oid in ('warehouse.inspect_quality(jsonb)'::regprocedure,'private.warehouse_inspect_quality_v3(jsonb)'::regprocedure)")).rows;
    const publicBody = definitions.find(row=>row.signature==='warehouse.inspect_quality(jsonb)').body;
    const v3Body = definitions.find(row=>row.signature==='private.warehouse_inspect_quality_v3(jsonb)').body;
    const rejectChain = async () => {
      assert.equal((await db.query(`select (${QUALITY_CHAIN_CONTRACT_SQL}) ok`)).rows[0].ok, false);
      assert((await db.query("select core.verify_security_database_launch_blockers() result")).rows[0].result.missing_objects.includes("warehouse.inspect_quality exact PO-line delegate"));
      assert((await db.query("select core.verify_launch_read_contracts() result")).rows[0].result.missing_grants.includes("warehouse.inspect_quality exact PO-line delegate"));
      await assert.rejects(verifySecurityDatabaseLaunchBlockers(sql=>db.query(sql)), /exact PO-line delegate/);
    };
    for (const changed of [
      publicBody.replace('return private.warehouse_inspect_quality_v3(payload);','return private.warehouse_inspect_quality_v2(payload);'),
      publicBody.replace('return private.warehouse_inspect_quality_v3(payload);','return private.warehouse_inspect_quality(payload);'),
      publicBody.replace('then return private.inspect_return_intake(payload); end if;', 'then return private.warehouse_inspect_quality_v3(payload); end if;'),
      publicBody.replace("not core.has_live_cap('warehouse', 'inspect_quality')", "false"),
    ]) {
      assert.notEqual(changed,publicBody);
      await db.exec(changed); await rejectChain(); await db.exec(publicBody);
    }
    for (const marker of ['inspection.procurement_po_line_id = v_line_id','v_inspection.quantity <> v_quantity','v_receipt.received_by = auth.uid()']) {
      const changed=v3Body.replace(marker,'false'); assert.notEqual(changed,v3Body);
      await db.exec(changed); await rejectChain(); await db.exec(v3Body);
    }
    await db.exec('grant execute on function private.warehouse_inspect_quality_v3(jsonb) to authenticated');
    await rejectChain();
    await db.exec('revoke execute on function private.warehouse_inspect_quality_v3(jsonb) from authenticated');
    await db.exec('grant execute on function private.inspect_return_intake(jsonb) to authenticated');
    await rejectChain();
    await db.exec('revoke execute on function private.inspect_return_intake(jsonb) from authenticated');
    assert.equal((await db.query("select has_function_privilege('authenticated','core.verify_security_database_launch_blockers()','EXECUTE') ok")).rows[0].ok,false);
    await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");

    const verification = await verifySecurityDatabaseLaunchBlockers((sql) =>
      db.query(sql),
    );
    assert.deepEqual(verification, { rawBoundaries: 0, missingObjects: [] });

    const columns = await db.query(`
      select column_name
      from information_schema.columns
      where table_schema = 'core' and table_name = 'v_my_work'
      order by ordinal_position
    `);
    assert.equal(columns.rows.length, 12);

    const wrapper = await db.query(`
      select pg_catalog.pg_get_functiondef('warehouse.raw_mutation(jsonb)'::regprocedure) as definition
    `);
    assert.match(
      wrapper.rows[0].definition,
      /core\.has_live_cap\('warehouse', 'issue_items'\)/i,
    );
    const wrappedCall = await db.query(
      `select warehouse.raw_mutation('{"verified":true}'::jsonb) as result`,
    );
    assert.deepEqual(wrappedCall.rows[0].result, { verified: true });

    const implementationGrant = await db.query(`
      select pg_catalog.has_function_privilege(
        'authenticated',
        procedure.oid,
        'EXECUTE'
      ) as authenticated_can_execute
      from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'warehouse'
        and procedure.proname like 'raw_mutation_rawcap_20260816_impl_%'
    `);
    assert.equal(implementationGrant.rows.length, 1);
    assert.equal(implementationGrant.rows[0].authenticated_can_execute, false);

    const completed = await db.query(`
      select count(*)::integer as count
      from learning.assignments
      where status = 'completed'
    `);
    assert.equal(completed.rows[0].count, 1);

    await assert.rejects(
      db.exec(`
        delete from core.user_roles
        where user_id = '${ADMIN_ID}'
          and module = 'core'
          and role = 'platform_admin'
      `),
      /direct platform administrator removal is denied/i,
    );

    await assert.rejects(
      db.exec(
        `update core.profiles set status = 'disabled' where id = '${ADMIN_ID}'`,
      ),
      /last effective platform administrator/i,
    );
  } finally {
    await db.close();
  }
});
