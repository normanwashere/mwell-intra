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
