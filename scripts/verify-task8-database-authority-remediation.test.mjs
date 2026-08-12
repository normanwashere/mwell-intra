import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260812220000_task8_database_authority_remediation.sql",
  import.meta.url,
);

async function migrationSource() {
  return readFile(migrationUrl, "utf8");
}

function functionDefinition(sql, qualifiedName) {
  const start = sql.indexOf(`create or replace function ${qualifiedName}`);
  assert.notEqual(start, -1, `missing ${qualifiedName}`);
  const end = sql.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `unterminated ${qualifiedName}`);
  return sql.slice(start, end + 4);
}

test("receive_stock requires effective certified authority before any write", async () => {
  const sql = await migrationSource();
  const body = functionDefinition(sql, "warehouse.receive_stock");
  const authority = body.indexOf(
    "core.has_live_cap('warehouse', 'receive_stock')",
  );
  const firstWrite = body.search(/\b(?:insert|update|delete)\s+(?:into|from)?\s*/i);

  assert.notEqual(authority, -1);
  assert.ok(authority < firstWrite, "effective authority must precede writes");
  assert.doesNotMatch(body, /core\.has_cap\('warehouse',\s*'receive_stock'\)/);
  assert.match(body, /warehouse\.authoritative_actor\(\)/);
  assert.match(body, /\{receipt,created_at\}/);
  assert.match(body, /\{receipt,quality_status\}/);
  assert.match(body, /warehouse\.register_evidence_docs/);
  assert.match(
    sql,
    /revoke all on function warehouse\.receive_stock\(jsonb\)\s+from public, anon/i,
  );
  assert.match(
    sql,
    /grant execute on function warehouse\.receive_stock\(jsonb\)\s+to authenticated, service_role/i,
  );
});

test("receive_stock denies a raw role and permits certified authority in PGlite", async () => {
  const sql = await migrationSource();
  const receiveStock = functionDefinition(sql, "warehouse.receive_stock");
  const db = new PGlite();

  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create schema core;
      create schema warehouse;

      create function auth.uid() returns uuid language sql stable as $$
        select '00000000-0000-0000-0000-000000000001'::uuid
      $$;
      create function auth.role() returns text language sql stable as $$
        select 'authenticated'::text
      $$;
      create function core.has_cap(text, text) returns boolean
      language sql stable as $$ select true $$;
      create function core.has_live_cap(text, text) returns boolean
      language sql stable as $$
        select coalesce(
          current_setting('test.certified', true),
          'false'
        ) = 'true'
      $$;

      create table warehouse.lots (id text primary key);
      create table warehouse.inventory_units (id text primary key);
      create table warehouse.stock_levels (
        product_id text not null,
        location_id text not null,
        bin_id text not null,
        lot_id text not null,
        quantity integer not null,
        primary key (product_id, location_id, bin_id, lot_id)
      );
      create table warehouse.movements (
        id text primary key,
        actor_id text
      );
      create table warehouse.receipts (
        id text primary key,
        created_at timestamptz,
        quality_status text,
        created_by text,
        evidence_urls text[]
      );
      create function warehouse.authoritative_actor() returns text
      language sql stable as $$ select 'server-actor'::text $$;
      create function warehouse.force_actor_on_object(jsonb, text) returns jsonb
      language sql immutable as $$
        select jsonb_set($1, '{created_by}', to_jsonb($2), true)
      $$;
      create function warehouse.force_actor_on_array(jsonb, text) returns jsonb
      language sql immutable as $$ select $1 $$;
      create function warehouse.register_evidence_docs(text, text, text[])
      returns void language sql as $$ select $$;
    `);
    await db.exec(receiveStock);

    const payload = JSON.stringify({
      lots: [],
      units: [],
      stock_deltas: [],
      movements: [],
      receipt: { id: "receipt-1", evidence_urls: [] },
    }).replaceAll("'", "''");

    await assert.rejects(
      db.query(`select warehouse.receive_stock('${payload}'::jsonb)`),
      /Not authorized: receive_stock/,
    );
    assert.equal(
      (await db.query("select count(*)::int as count from warehouse.receipts"))
        .rows[0].count,
      0,
    );

    await db.exec("select set_config('test.certified', 'true', false)");
    await db.query(`select warehouse.receive_stock('${payload}'::jsonb)`);
    const receipt = (
      await db.query(
        "select id, created_by, quality_status from warehouse.receipts",
      )
    ).rows[0];
    assert.deepEqual(receipt, {
      id: "receipt-1",
      created_by: "server-actor",
      quality_status: "pending",
    });
  } finally {
    await db.close();
  }
});

test("policy acknowledgment persists only the matching canonical published hash", async () => {
  const sql = await migrationSource();
  const body = functionDefinition(sql, "learning.acknowledge_policy");
  const canonicalLookup = body.indexOf("source_reference->>'evidence_hash'");
  const firstIdempotentReturn = body.indexOf(
    "return pg_catalog.to_jsonb(v_acknowledgment)",
  );

  assert.match(
    body,
    /source_reference->>'controlled_document_id'\s*=\s*v_document_id/i,
  );
  assert.match(
    body,
    /source_reference->>'controlled_document_version'\s*=\s*v_document_version/i,
  );
  assert.match(body, /internal\.warehouse\.receiving-custody-policy\.v1/);
  assert.match(body, /OPS-WH-RCV-001/);
  assert.match(body, /'4\.2'/);
  assert.match(
    body,
    /9b13c375513649ddab0af15ce7188a22fcbcefe7d861a7002e759cefb88e0cc0/,
  );
  assert.match(
    body,
    /requirement\.requirement_key\s*=\s*v_canonical_requirement_key/i,
  );
  assert.match(
    body,
    /source_reference->>'evidence_hash'/i,
  );
  assert.ok(
    canonicalLookup >= 0 && canonicalLookup < firstIdempotentReturn,
    "idempotent replay must validate canonical evidence before returning",
  );
  assert.match(body, /v_published_evidence_hash\s*!~\s*'\^\[a-f0-9\]\{64\}\$'/i);
  assert.match(
    body,
    /v_published_evidence_hash\s*<>\s*v_canonical_evidence_hash/i,
  );
  assert.match(
    body,
    /v_submitted_evidence_hash\s*<>\s*v_canonical_evidence_hash/i,
  );
  assert.match(
    body,
    /insert into learning\.policy_acknowledgments[\s\S]*?v_canonical_evidence_hash/i,
  );
  assert.doesNotMatch(
    body,
    /insert into learning\.policy_acknowledgments[\s\S]*?v_submitted_evidence_hash[\s\S]*?on conflict/i,
  );
  assert.match(
    body,
    /where acknowledgment\.user_id = v_user_id[\s\S]*?acknowledgment\.evidence_hash = v_canonical_evidence_hash[\s\S]*?if not found then[\s\S]*?Existing policy acknowledgment is not bound to canonical evidence/i,
  );
  assert.match(
    sql,
    /revoke all on function learning\.acknowledge_policy\(jsonb\)\s+from public, anon/i,
  );
  assert.match(
    sql,
    /grant execute on function learning\.acknowledge_policy\(jsonb\)\s+to authenticated, service_role/i,
  );
});

test("policy acknowledgment rejects arbitrary evidence and stores canonical evidence in PGlite", async () => {
  const sql = await migrationSource();
  const acknowledgePolicy = functionDefinition(
    sql,
    "learning.acknowledge_policy",
  );
  const db = new PGlite();
  const userId = "00000000-0000-0000-0000-000000000001";
  const departmentId = "00000000-0000-0000-0000-000000000002";
  const curriculumId = "00000000-0000-0000-0000-000000000003";
  const assignmentId = "00000000-0000-0000-0000-000000000004";
  const requirementVersionId = "00000000-0000-0000-0000-000000000005";
  const assignmentRequirementId = "00000000-0000-0000-0000-000000000006";
  const canonicalHash =
    "9b13c375513649ddab0af15ce7188a22fcbcefe7d861a7002e759cefb88e0cc0";
  const arbitraryHash = "b".repeat(64);

  try {
    await db.exec(`
      create schema auth;
      create schema core;
      create schema private;
      create schema learning;

      create function auth.uid() returns uuid language sql stable as $$
        select '${userId}'::uuid
      $$;
      create function private.assert_learning_read_committed()
      returns void language sql stable as $$ select $$;
      create function private.lock_learning_curriculum_graph(uuid[])
      returns void language sql as $$ select $$;

      create table core.roles (
        module text not null,
        role text not null,
        is_active boolean not null,
        primary key (module, role)
      );
      create table core.user_roles (
        id uuid primary key,
        user_id uuid not null,
        module text not null,
        role text not null
      );
      create table core.activity_log (
        id bigint generated always as identity primary key,
        module text not null,
        entity_type text not null,
        entity_id uuid not null,
        action text not null,
        actor uuid not null,
        detail jsonb not null
      );
      create table learning.assignments (
        id uuid primary key,
        user_id uuid not null,
        department_id uuid not null,
        audience text not null,
        curriculum_version_id uuid not null,
        source_type text not null,
        source_id uuid,
        status text not null,
        completed_at timestamptz,
        blocked_reason text
      );
      create table learning.assignment_requirements (
        id uuid primary key,
        assignment_id uuid not null,
        user_id uuid not null,
        requirement_version_id uuid not null,
        status text not null,
        completed_at timestamptz,
        progress jsonb not null default '{}'::jsonb
      );
      create table learning.requirements (
        id uuid primary key,
        requirement_key text not null unique
      );
      create table learning.requirement_versions (
        id uuid primary key,
        requirement_id uuid not null,
        audience text not null,
        requirement_kind text not null,
        status text not null,
        effective_at timestamptz,
        expires_at timestamptz,
        source_references jsonb not null
      );
      create table learning.curriculum_requirement_prerequisites (
        curriculum_version_id uuid not null,
        requirement_version_id uuid not null,
        prerequisite_requirement_version_id uuid not null,
        audience text not null
      );
      create table learning.curriculum_requirements (
        curriculum_version_id uuid not null,
        requirement_version_id uuid not null,
        audience text not null,
        mandatory boolean not null
      );
      create table learning.policy_acknowledgments (
        id uuid primary key default gen_random_uuid(),
        assignment_requirement_id uuid not null,
        user_id uuid not null,
        department_id uuid not null,
        audience text not null,
        requirement_version_id uuid not null,
        controlled_document_id text not null,
        controlled_document_version text not null,
        accepted_at timestamptz not null,
        evidence_hash text not null,
        actor_id uuid not null,
        created_at timestamptz not null default now(),
        unique (
          user_id,
          requirement_version_id,
          controlled_document_id,
          controlled_document_version
        )
      );

      insert into learning.assignments(
        id, user_id, department_id, audience, curriculum_version_id,
        source_type, status
      ) values (
        '${assignmentId}', '${userId}', '${departmentId}', 'internal',
        '${curriculumId}', 'manual', 'in_progress'
      );
      insert into learning.requirements values (
        '${requirementVersionId}',
        'internal.warehouse.receiving-custody-policy.v1'
      );
      insert into learning.requirement_versions values (
        '${requirementVersionId}', '${requirementVersionId}', 'internal',
        'policy', 'published',
        now() - interval '1 hour', null,
        jsonb_build_array(jsonb_build_object(
          'controlled_document_id', 'OPS-WH-RCV-001',
          'controlled_document_version', '4.2',
          'evidence_hash', '${canonicalHash}'
        ))
      );
      insert into learning.assignment_requirements(
        id, assignment_id, user_id, requirement_version_id, status
      ) values (
        '${assignmentRequirementId}', '${assignmentId}', '${userId}',
        '${requirementVersionId}', 'in_progress'
      );
    `);
    await db.exec(acknowledgePolicy);

    const command = (hash, idempotencyKey) =>
      JSON.stringify({
        assignment_requirement_id: assignmentRequirementId,
        controlled_document_id: "OPS-WH-RCV-001",
        controlled_document_version: "4.2",
        evidence_hash: hash,
        idempotency_key: idempotencyKey,
      }).replaceAll("'", "''");

    await assert.rejects(
      db.query(
        `select learning.acknowledge_policy('${command(arbitraryHash, "00000000-0000-0000-0000-000000000007")}'::jsonb)`,
      ),
      /Evidence hash does not match the published controlled document/,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int as count from learning.policy_acknowledgments",
        )
      ).rows[0].count,
      0,
    );

    await db.exec(`
      update learning.requirements
      set requirement_key = 'internal.warehouse.other-policy.v1'
      where id = '${requirementVersionId}'
    `);
    await assert.rejects(
      db.query(
        `select learning.acknowledge_policy('${command(canonicalHash, "00000000-0000-0000-0000-000000000008")}'::jsonb)`,
      ),
      /canonical receiving custody policy must be published and effective/i,
    );
    await db.exec(`
      update learning.requirements
      set requirement_key = 'internal.warehouse.receiving-custody-policy.v1'
      where id = '${requirementVersionId}'
    `);

    await db.exec(`
      update learning.requirement_versions
      set source_references = jsonb_build_array(jsonb_build_object(
        'controlled_document_id', 'OPS-WH-RCV-001',
        'controlled_document_version', '4.2'
      ))
      where id = '${requirementVersionId}'
    `);
    await assert.rejects(
      db.query(
        `select learning.acknowledge_policy('${command(canonicalHash, "00000000-0000-0000-0000-000000000008")}'::jsonb)`,
      ),
      /Published controlled document is missing a canonical evidence hash/,
    );

    await db.exec(`
      update learning.requirement_versions
      set source_references = jsonb_build_array(
        jsonb_build_object(
          'controlled_document_id', 'OPS-WH-RCV-001',
          'controlled_document_version', '4.2',
          'evidence_hash', '${canonicalHash}'
        ),
        jsonb_build_object(
          'controlled_document_id', 'OPS-WH-RCV-001',
          'controlled_document_version', '4.2',
          'evidence_hash', '${canonicalHash}'
        )
      )
      where id = '${requirementVersionId}'
    `);
    await assert.rejects(
      db.query(
        `select learning.acknowledge_policy('${command(canonicalHash, "00000000-0000-0000-0000-000000000009")}'::jsonb)`,
      ),
      /Acknowledgment does not match one canonical published controlled document/,
    );

    await db.exec(`
      update learning.requirement_versions
      set source_references = jsonb_build_array(jsonb_build_object(
        'controlled_document_id', 'OPS-WH-RCV-001',
        'controlled_document_version', '4.2',
        'evidence_hash', '${canonicalHash}'
      ))
      where id = '${requirementVersionId}'
    `);

    await db.query(
      `select learning.acknowledge_policy('${command(canonicalHash, "00000000-0000-0000-0000-000000000010")}'::jsonb)`,
    );
    assert.deepEqual(
      (
        await db.query(
          "select evidence_hash from learning.policy_acknowledgments",
        )
      ).rows[0],
      { evidence_hash: canonicalHash },
    );

    await db.query(
      `select learning.acknowledge_policy('${command(canonicalHash, "00000000-0000-0000-0000-000000000011")}'::jsonb)`,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::int as count from learning.policy_acknowledgments",
        )
      ).rows[0].count,
      1,
    );
  } finally {
    await db.close();
  }
});
