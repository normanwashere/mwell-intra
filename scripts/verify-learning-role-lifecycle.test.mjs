import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const authorityMigrationPath = fileURLToPath(
  new URL(
    "../supabase/migrations/20260812140000_learning_role_authority_lifecycle.sql",
    import.meta.url,
  ),
);
const lineageMigrationPath = fileURLToPath(
  new URL(
    "../supabase/migrations/20260812150000_learning_assignment_lineage_remediation.sql",
    import.meta.url,
  ),
);
const authorityMigrationSql = existsSync(authorityMigrationPath)
  ? readFileSync(authorityMigrationPath, "utf8")
  : "";
const lineageMigrationSql = existsSync(lineageMigrationPath)
  ? readFileSync(lineageMigrationPath, "utf8")
  : "";

async function createLifecycleDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;

    create schema core;
    create schema learning;
    create schema private;

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
      id text primary key,
      user_id text not null,
      module text not null,
      role text not null,
      note text
    );
    create table learning.certifications (
      id text primary key,
      user_id text not null,
      source_role_assignment_id text not null,
      module text not null,
      source_role text not null,
      capability text not null,
      status text not null,
      revoked_at timestamptz,
      superseded_at timestamptz
    );
    create table learning.curriculum_requirement_prerequisites (
      id text primary key
    );

    create function private.assert_learning_read_committed()
    returns void
    language plpgsql
    as $$
    begin
      if current_setting('transaction_isolation') <> 'read committed' then
        raise exception 'READ COMMITTED required';
      end if;
    end;
    $$;

    create function learning.guard_authoritative_write_isolation()
    returns trigger
    language plpgsql
    as $$
    begin
      perform private.assert_learning_read_committed();
      if tg_op = 'DELETE' then return old; end if;
      return new;
    end;
    $$;

    grant usage on schema core, learning, private to service_role;
    grant all privileges on table
      core.roles,
      core.role_capabilities,
      core.user_roles,
      learning.certifications
    to service_role;

    insert into core.roles(module, role, is_active) values
      ('warehouse', 'valid_role', true),
      ('warehouse', 'stale_inactive_role', false),
      ('warehouse', 'stale_missing_cap_role', true),
      ('warehouse', 'deactivate_role', true),
      ('warehouse', 'transient_deactivate_role', true),
      ('warehouse', 'remove_cap_role', true),
      ('warehouse', 'replace_caps_role', true),
      ('warehouse', 'other_role', true);
    insert into core.role_capabilities(module, role, cap) values
      ('warehouse', 'valid_role', 'receive_stock'),
      ('warehouse', 'stale_inactive_role', 'receive_stock'),
      ('warehouse', 'deactivate_role', 'receive_stock'),
      ('warehouse', 'transient_deactivate_role', 'receive_stock'),
      ('warehouse', 'remove_cap_role', 'receive_stock'),
      ('warehouse', 'replace_caps_role', 'receive_stock');
    insert into core.user_roles(id, user_id, module, role) values
      ('valid-assignment', 'valid-user', 'warehouse', 'valid_role'),
      ('stale-inactive-assignment', 'stale-inactive-user', 'warehouse', 'stale_inactive_role'),
      ('stale-missing-cap-assignment', 'stale-missing-cap-user', 'warehouse', 'stale_missing_cap_role'),
      ('deactivate-assignment', 'deactivate-user', 'warehouse', 'deactivate_role'),
      ('transient-deactivate-assignment', 'transient-deactivate-user', 'warehouse', 'transient_deactivate_role'),
      ('remove-cap-assignment', 'remove-cap-user', 'warehouse', 'remove_cap_role'),
      ('replace-caps-assignment', 'replace-caps-user', 'warehouse', 'replace_caps_role'),
      ('mismatched-user-assignment', 'different-user', 'warehouse', 'valid_role'),
      ('mismatched-module-assignment', 'mismatched-module-user', 'procurement', 'valid_role'),
      ('mismatched-role-assignment', 'mismatched-role-user', 'warehouse', 'other_role'),
      ('identity-update-assignment', 'identity-update-user', 'warehouse', 'valid_role'),
      ('delete-assignment', 'delete-user', 'warehouse', 'valid_role'),
      ('unrelated-update-assignment', 'unrelated-update-user', 'warehouse', 'valid_role');
    insert into learning.certifications(
      id, user_id, source_role_assignment_id, module, source_role,
      capability, status, revoked_at
    ) values
      ('valid-existing-cert', 'valid-user', 'valid-assignment', 'warehouse', 'valid_role', 'receive_stock', 'active', null),
      ('stale-inactive-cert', 'stale-inactive-user', 'stale-inactive-assignment', 'warehouse', 'stale_inactive_role', 'receive_stock', 'active', null),
      ('stale-missing-cap-cert', 'stale-missing-cap-user', 'stale-missing-cap-assignment', 'warehouse', 'stale_missing_cap_role', 'receive_stock', 'active', null),
      ('missing-assignment-cert', 'missing-assignment-user', 'missing-assignment', 'warehouse', 'valid_role', 'receive_stock', 'active', null),
      ('mismatched-user-cert', 'mismatched-user', 'mismatched-user-assignment', 'warehouse', 'valid_role', 'receive_stock', 'active', null),
      ('mismatched-module-cert', 'mismatched-module-user', 'mismatched-module-assignment', 'warehouse', 'valid_role', 'receive_stock', 'active', null),
      ('mismatched-role-cert', 'mismatched-role-user', 'mismatched-role-assignment', 'warehouse', 'valid_role', 'receive_stock', 'active', null),
      ('identity-update-cert', 'identity-update-user', 'identity-update-assignment', 'warehouse', 'valid_role', 'receive_stock', 'active', null),
      ('delete-cert', 'delete-user', 'delete-assignment', 'warehouse', 'valid_role', 'receive_stock', 'active', null),
      ('unrelated-update-cert', 'unrelated-update-user', 'unrelated-update-assignment', 'warehouse', 'valid_role', 'receive_stock', 'active', null),
      ('historical-revoked-cert', 'valid-user', 'valid-assignment', 'warehouse', 'valid_role', 'receive_stock', 'revoked', clock_timestamp());
  `);
  await db.exec(authorityMigrationSql);
  await db.exec(lineageMigrationSql);
  return db;
}

async function certification(db, id) {
  const result = await db.query(
    "select status, revoked_at, revocation_reason from learning.certifications where id = $1",
    [id],
  );
  return result.rows[0];
}

test("upgrades stale authority state and preserves final transactional behavior", async () => {
  assert.ok(
    authorityMigrationSql,
    "the monotonic role-authority lifecycle migration must exist",
  );
  assert.ok(
    lineageMigrationSql,
    "the later assignment-lineage remediation migration must exist",
  );
  const db = await createLifecycleDatabase();
  try {
    const reconciled = await db.query(`
      select id, status, revoked_at, revocation_reason
      from learning.certifications
      where id in (
        'valid-existing-cert',
        'stale-inactive-cert',
        'stale-missing-cap-cert',
        'missing-assignment-cert',
        'mismatched-user-cert',
        'mismatched-module-cert',
        'mismatched-role-cert',
        'historical-revoked-cert'
      )
      order by id;
    `);
    assert.deepEqual(
      reconciled.rows.map((row) => ({
        id: row.id,
        status: row.status,
        revoked: Boolean(row.revoked_at),
        reason: row.revocation_reason,
      })),
      [
        {
          id: "historical-revoked-cert",
          status: "revoked",
          revoked: true,
          reason: "system:historical_revocation_backfill",
        },
        {
          id: "mismatched-module-cert",
          status: "revoked",
          revoked: true,
          reason: "system:source_role_assignment_identity_mismatch",
        },
        {
          id: "mismatched-role-cert",
          status: "revoked",
          revoked: true,
          reason: "system:source_role_assignment_identity_mismatch",
        },
        {
          id: "mismatched-user-cert",
          status: "revoked",
          revoked: true,
          reason: "system:source_role_assignment_identity_mismatch",
        },
        {
          id: "missing-assignment-cert",
          status: "revoked",
          revoked: true,
          reason: "system:source_role_assignment_missing",
        },
        {
          id: "stale-inactive-cert",
          status: "revoked",
          revoked: true,
          reason: "system:source_role_inactive",
        },
        {
          id: "stale-missing-cap-cert",
          status: "revoked",
          revoked: true,
          reason: "system:source_role_capability_missing",
        },
        {
          id: "valid-existing-cert",
          status: "active",
          revoked: false,
          reason: null,
        },
      ],
    );

    const truncatePrivileges = await db.query(`
      select relation_name,
             has_table_privilege(
               'service_role',
               'core.' || relation_name,
               'TRUNCATE'
             ) as can_truncate
      from unnest(array['role_capabilities', 'roles', 'user_roles']) relation_name
      order by relation_name;
    `);
    assert.deepEqual(truncatePrivileges.rows, [
      { relation_name: "role_capabilities", can_truncate: false },
      { relation_name: "roles", can_truncate: false },
      { relation_name: "user_roles", can_truncate: false },
    ]);

    await db.exec("set role service_role");
    await assert.rejects(
      db.exec("truncate table core.role_capabilities"),
      /permission denied.*role_capabilities/i,
    );
    await db.exec("reset role");

    await db.exec(`
      insert into learning.certifications(
        id, user_id, source_role_assignment_id, module, source_role,
        capability, status
      ) values
        ('deactivate-cert', 'deactivate-user', 'deactivate-assignment', 'warehouse', 'deactivate_role', 'receive_stock', 'active'),
        ('transient-deactivate-cert', 'transient-deactivate-user', 'transient-deactivate-assignment', 'warehouse', 'transient_deactivate_role', 'receive_stock', 'active'),
        ('remove-cap-cert', 'remove-cap-user', 'remove-cap-assignment', 'warehouse', 'remove_cap_role', 'receive_stock', 'active'),
        ('replace-caps-cert', 'replace-caps-user', 'replace-caps-assignment', 'warehouse', 'replace_caps_role', 'receive_stock', 'active');
    `);

    await assert.rejects(
      db.exec(`
        insert into learning.certifications(
          id, user_id, source_role_assignment_id, module, source_role,
          capability, status
        ) values (
          'missing-cap-cert', 'deactivate-user', 'deactivate-assignment',
          'warehouse', 'deactivate_role', 'manage_inventory', 'active'
        );
      `),
      /capability is not granted/i,
    );

    await db.exec("begin isolation level serializable");
    await assert.rejects(
      db.exec(`
        insert into learning.certifications(
          id, user_id, source_role_assignment_id, module, source_role,
          capability, status
        ) values (
          'serializable-cert', 'deactivate-user', 'deactivate-assignment',
          'warehouse', 'deactivate_role', 'receive_stock', 'active'
        );
      `),
      /read committed required/i,
    );
    await db.exec("rollback");

    await db.exec("begin");
    await db.exec("set role service_role");
    await db.exec(`
      update core.roles
      set is_active = false
      where module = 'warehouse' and role = 'deactivate_role';
    `);
    await db.exec("reset role");
    assert.equal((await certification(db, "deactivate-cert")).status, "active");
    await db.exec("commit");
    const deactivated = await certification(db, "deactivate-cert");
    assert.equal(deactivated.status, "revoked");
    assert.ok(deactivated.revoked_at);
    assert.equal(deactivated.revocation_reason, "system:source_role_inactive");

    await db.exec(`
      update core.roles
      set is_active = true
      where module = 'warehouse' and role = 'deactivate_role';
    `);
    assert.equal(
      (await certification(db, "deactivate-cert")).status,
      "revoked",
    );

    await db.exec("begin");
    await db.exec(`
      update core.roles
      set is_active = false
      where module = 'warehouse' and role = 'transient_deactivate_role';
      update core.roles
      set is_active = true
      where module = 'warehouse' and role = 'transient_deactivate_role';
    `);
    await db.exec("commit");
    assert.equal(
      (await certification(db, "transient-deactivate-cert")).status,
      "active",
    );

    await db.exec(`
      delete from core.role_capabilities
      where module = 'warehouse'
        and role = 'remove_cap_role'
        and cap = 'receive_stock';
    `);
    const removedCapability = await certification(db, "remove-cap-cert");
    assert.equal(removedCapability.status, "revoked");
    assert.equal(
      removedCapability.revocation_reason,
      "system:source_role_capability_missing",
    );
    await db.exec(`
      insert into core.role_capabilities(module, role, cap)
      values ('warehouse', 'remove_cap_role', 'receive_stock');
    `);
    assert.equal(
      (await certification(db, "remove-cap-cert")).status,
      "revoked",
    );

    await db.exec("begin");
    await db.exec(`
      delete from core.role_capabilities
      where module = 'warehouse'
        and role = 'replace_caps_role'
        and cap = 'receive_stock';
      insert into core.role_capabilities(module, role, cap)
      values ('warehouse', 'replace_caps_role', 'receive_stock');
    `);
    await db.exec("commit");
    assert.equal(
      (await certification(db, "replace-caps-cert")).status,
      "active",
    );

    for (const [column, value] of [
      ["id", "replacement-assignment-id"],
      ["user_id", "replacement-user"],
      ["module", "procurement"],
      ["role", "other_role"],
    ]) {
      await assert.rejects(
        db.exec(`
          update core.user_roles
          set ${column} = '${value}'
          where id = 'identity-update-assignment';
        `),
        /role assignment identity is immutable/i,
        column,
      );
      assert.equal(
        (await certification(db, "identity-update-cert")).status,
        "active",
        column,
      );
    }

    await db.exec(`
      update core.user_roles
      set role = role
      where id = 'identity-update-assignment';
      update core.user_roles
      set note = 'supported unrelated change'
      where id = 'unrelated-update-assignment';
    `);
    assert.equal(
      (await certification(db, "identity-update-cert")).status,
      "active",
    );
    assert.equal(
      (await certification(db, "unrelated-update-cert")).status,
      "active",
    );

    await db.exec(`
      delete from core.user_roles where id = 'delete-assignment';
    `);
    const deletedAssignment = await certification(db, "delete-cert");
    assert.equal(deletedAssignment.status, "revoked");
    assert.ok(deletedAssignment.revoked_at);
    assert.equal(
      deletedAssignment.revocation_reason,
      "system:source_role_assignment_removed",
    );

    const history = await db.query(
      "select count(*)::integer as count from learning.certifications",
    );
    assert.equal(history.rows[0].count, 15);
  } finally {
    await db.close();
  }
});
