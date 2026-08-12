import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath = fileURLToPath(
  new URL(
    "../supabase/migrations/20260812140000_learning_role_authority_lifecycle.sql",
    import.meta.url,
  ),
);
const migrationSql = existsSync(migrationPath)
  ? readFileSync(migrationPath, "utf8")
  : "";

function lifecycleDdl(source) {
  const lockFunctionStatement = source.match(
    /create or replace function private\.lock_certification_role_authority\(\)[\s\S]*?\n\$\$;/i,
  )?.[0];
  const functionStatement = source.match(
    /create or replace function private\.revoke_certifications_for_role_authority_loss\(\)[\s\S]*?\n\$\$;/i,
  )?.[0];
  const lockTriggerStatement = source.match(
    /create trigger learning_certifications_lock_role_authority[\s\S]*?;/i,
  )?.[0];
  const triggerStatements = [
    ...source.matchAll(
      /create constraint trigger learning_role_(?:deactivation|capability_removal)_revoke[\s\S]*?;/gi,
    ),
  ].map((match) => match[0]);
  assert.ok(lockFunctionStatement, "missing certification authority lock");
  assert.ok(functionStatement, "missing role-authority revocation function");
  assert.ok(lockTriggerStatement, "missing certification authority trigger");
  assert.equal(
    triggerStatements.length,
    2,
    "missing deferred lifecycle triggers",
  );
  return [
    lockFunctionStatement,
    functionStatement,
    lockTriggerStatement,
    ...triggerStatements,
  ].join("\n");
}

async function createLifecycleDatabase() {
  const db = new PGlite();
  await db.exec(`
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
      role text not null
    );
    create table learning.certifications (
      id text primary key,
      user_id text not null,
      source_role_assignment_id text not null,
      module text not null,
      source_role text not null,
      capability text not null,
      status text not null,
      revoked_at timestamptz
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
  `);
  await db.exec(lifecycleDdl(migrationSql));
  return db;
}

async function certification(db, id) {
  const result = await db.query(
    "select status, revoked_at from learning.certifications where id = $1",
    [id],
  );
  return result.rows[0];
}

test("reconciles role-bundle authority from final transactional state", async () => {
  assert.ok(
    migrationSql,
    "the monotonic role-authority lifecycle migration must exist",
  );
  const db = await createLifecycleDatabase();
  try {
    await db.exec(`
      insert into core.roles(module, role, is_active) values
        ('warehouse', 'deactivate_role', true),
        ('warehouse', 'transient_deactivate_role', true),
        ('warehouse', 'remove_cap_role', true),
        ('warehouse', 'replace_caps_role', true);
      insert into core.role_capabilities(module, role, cap) values
        ('warehouse', 'deactivate_role', 'receive_stock'),
        ('warehouse', 'transient_deactivate_role', 'receive_stock'),
        ('warehouse', 'remove_cap_role', 'receive_stock'),
        ('warehouse', 'replace_caps_role', 'receive_stock');
      insert into core.user_roles(id, user_id, module, role) values
        ('deactivate-assignment', 'deactivate-user', 'warehouse', 'deactivate_role'),
        ('transient-deactivate-assignment', 'transient-deactivate-user', 'warehouse', 'transient_deactivate_role'),
        ('remove-cap-assignment', 'remove-cap-user', 'warehouse', 'remove_cap_role'),
        ('replace-caps-assignment', 'replace-caps-user', 'warehouse', 'replace_caps_role');
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
    await db.exec(`
      update core.roles
      set is_active = false
      where module = 'warehouse' and role = 'deactivate_role';
    `);
    assert.equal((await certification(db, "deactivate-cert")).status, "active");
    await db.exec("commit");
    const deactivated = await certification(db, "deactivate-cert");
    assert.equal(deactivated.status, "revoked");
    assert.ok(deactivated.revoked_at);

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
    assert.equal(
      (await certification(db, "remove-cap-cert")).status,
      "revoked",
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

    const history = await db.query(
      "select count(*)::integer as count from learning.certifications",
    );
    assert.equal(history.rows[0].count, 4);
  } finally {
    await db.close();
  }
});
