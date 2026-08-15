import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const MIGRATIONS = resolve(ROOT, 'supabase', 'migrations');
const SUFFIX = '_procurement_finance_requester_privacy.sql';

function migration() {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(SUFFIX));
  assert.equal(files.length, 1, 'add exactly one forward requester-privacy migration');
  return {
    file: files[0],
    sql: readFileSync(resolve(MIGRATIONS, files[0]), 'utf8'),
  };
}

function functionBody(sql, qualifiedName) {
  const start = sql.indexOf(`create or replace function ${qualifiedName}`);
  assert.notEqual(start, -1, `missing ${qualifiedName}`);
  const end = sql.indexOf('$$;', start);
  assert.notEqual(end, -1, `unterminated ${qualifiedName}`);
  return sql.slice(start, end + 3);
}

function policyBody(sql, policyName) {
  const start = sql.indexOf(`create policy ${policyName}`);
  assert.notEqual(start, -1, `missing policy ${policyName}`);
  const end = sql.indexOf(';', start);
  return sql.slice(start, end + 1);
}

test('uses one forward-only migration without rewriting shared authority history', () => {
  const { file, sql } = migration();
  assert.match(file, /^20\d{12}_procurement_finance_requester_privacy\.sql$/);
  assert.match(sql, /forward-only/i);
  assert.doesNotMatch(sql, /supabase_migrations|delete\s+from\s+core\.capabilities/i);
});

test('request and attachment SELECT policies allow only owner or explicit collaborator', () => {
  const { sql } = migration();
  assert.match(sql, /create table if not exists procurement\.request_collaborators/i);
  assert.match(sql, /create or replace function private\.can_read_procurement_request/i);

  for (const policy of [
    'procurement_requests_read',
    'procurement_steps_read',
    'request_attachments_read',
    'procurement_requests_auth_read',
  ]) {
    const body = policyBody(sql, policy);
    assert.match(body, /can_read_procurement_request/i, `${policy} must use row grants`);
    assert.doesNotMatch(body, /has_(live_)?cap|has_module_role|view_dashboard/i);
  }

  const helper = functionBody(sql, 'private.can_read_procurement_request');
  assert.match(helper, /requester_id\s*=\s*auth\.uid\(\)/i);
  assert.match(helper, /from procurement\.request_collaborators/i);
  assert.match(helper, /user_id\s*=\s*auth\.uid\(\)/i);
  assert.match(helper, /revoked_at is null/i);

  for (const [policy, table] of [
    ['read_requests', 'procurement.requests'],
    ['read_approval_steps', 'procurement.approval_steps'],
    ['read_request_attachments', 'procurement.request_attachments'],
  ]) {
    assert.match(
      sql,
      new RegExp(`drop policy if exists ${policy} on ${table.replace('.', '\\.')}`, 'i'),
      `legacy permissive policy ${policy} must be removed`,
    );
  }
});

test('create and submit require live certification and the minimum request contract', () => {
  const { sql } = migration();
  for (const name of ['procurement.create_request', 'procurement.submit_request']) {
    const body = functionBody(sql, name);
    assert.match(body, /core\.has_live_cap\('procurement',\s*'create_request'\)/i);
    assert.doesNotMatch(body, /core\.has_cap\('procurement',\s*'create_request'\)/i);
  }

  const contract = functionBody(sql, 'private.assert_minimum_request_contract');
  for (const required of [
    'department',
    'cost_center',
    'needed_by',
    'estimated_amount',
    'budget_code',
    'project_code',
    'spec',
    'budget',
  ])
    assert.match(contract, new RegExp(required, 'i'));
  assert.match(contract, /jsonb_array_length\(.*lines/i);
});

test('PO authoring and final approval are separately certified and require different actors', () => {
  const { sql } = migration();
  assert.match(sql, /\('procurement',\s*'final_approve_po'\)/i);
  const approve = functionBody(sql, 'procurement.approve_purchase_order');
  assert.match(approve, /core\.has_live_cap\('procurement',\s*'final_approve_po'\)/i);
  assert.match(approve, /authored_by\s*=\s*auth\.uid\(\)|v_po\.authored_by\s*=\s*auth\.uid\(\)/i);
  assert.match(approve, /final_approved_by\s*=\s*auth\.uid\(\)/i);
  assert.doesNotMatch(approve, /has_live_cap\('procurement',\s*'author_po'\)/i);

  const issue = functionBody(sql, 'procurement.issue_purchase_order');
  assert.match(issue, /core\.has_live_cap\('procurement',\s*'author_po'\)/i);
});

test('Finance acceptance and payment release use split capabilities and different actors', () => {
  const { sql } = migration();
  assert.match(sql, /\('procurement',\s*'accept_payment_readiness'\)/i);
  const accept = functionBody(sql, 'procurement.review_payment_readiness');
  assert.match(accept, /core\.has_live_cap\('procurement',\s*'accept_payment_readiness'\)/i);
  const release = functionBody(sql, 'procurement.release_payment');
  assert.match(release, /core\.has_live_cap\('procurement',\s*'release_payment'\)/i);
  assert.match(
    release,
    /finance_reviewed_by\s*=\s*auth\.uid\(\)|v_pack\.finance_reviewed_by\s*=\s*auth\.uid\(\)/i,
  );
  assert.match(release, /different Finance actor/i);
});

test('request cancellation is idempotent, versioned, non-destructive, and blocks downstream commitments', () => {
  const { sql } = migration();
  const cancel = functionBody(sql, 'procurement.cancel_request');
  assert.match(cancel, /core\.has_live_cap\('procurement',\s*'cancel_request'\)/i);
  assert.match(cancel, /idempotency_key/i);
  assert.match(cancel, /expected_version/i);
  assert.match(cancel, /purchase_orders/i);
  assert.match(cancel, /sourcing_events/i);
  assert.match(cancel, /approval_steps[\s\S]*status\s*=\s*'skipped'/i);
  assert.match(cancel, /cancellation_reason/i);
  assert.doesNotMatch(
    cancel,
    /delete\s+from\s+procurement\.(requests|approval_steps|purchase_orders)/i,
  );
});

test('Finance close binds real source and evidence records and exposes actor lineage', () => {
  const { sql } = migration();
  const manage = functionBody(sql, 'core.manage_finance_close_entry');
  assert.match(sql, /source_record_type text/i);
  assert.match(sql, /source_record_id text/i);
  assert.match(sql, /evidence_record_type text/i);
  assert.match(sql, /evidence_record_id text/i);
  assert.match(manage, /private\.assert_finance_close_binding/i);
  assert.match(sql, /create or replace function private\.assert_finance_close_binding/i);
  const binding = functionBody(sql, 'private.assert_finance_close_binding');
  assert.match(binding, /evidence does not belong to the selected Finance source/i);
  assert.match(binding, /request_attachment[\s\S]*request_id/i);
  assert.match(binding, /payment_readiness_pack[\s\S]*purchase_order_id/i);
  assert.match(binding, /payment_release[\s\S]*payment_readiness_pack_id/i);
  assert.match(
    sql,
    /create view core\.finance_close_entry_lineage[\s\S]*security_invoker\s*=\s*true/i,
  );
  for (const actor of ['prepared_by', 'posted_by', 'reconciled_by'])
    assert.match(sql, new RegExp(actor, 'i'));
});
