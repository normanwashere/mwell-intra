import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const MIGRATIONS = resolve(ROOT, 'supabase', 'migrations');

function effectiveFunction(qualifiedName) {
  const signature = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+${qualifiedName.replace('.', '\\.')}\\s*\\(\\s*payload\\s+jsonb\\s*\\)`,
    'gi',
  );
  let effective = null;

  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    const source = readFileSync(resolve(MIGRATIONS, file), 'utf8');
    for (const match of source.matchAll(signature)) {
      const start = match.index ?? 0;
      const end = source.indexOf('$$;', start);
      assert.notEqual(end, -1, `${file}: unterminated ${qualifiedName} definition`);
      effective = { file, sql: source.slice(start, end + 3) };
    }
  }

  assert.ok(effective, `No effective definition found for ${qualifiedName}`);
  return effective;
}

function expectPattern(definition, pattern, message) {
  assert.match(definition.sql, pattern, `${definition.file}: ${message}`);
}

test('effective procurement step decisions enforce ordered, assigned, signed authority', () => {
  const definition = effectiveFunction('procurement.decide_request_step');

  expectPattern(definition, /core\.has_cap\('procurement',\s*'approve_request'\)/i, 'must retain the procurement approval capability gate');
  expectPattern(definition, /v_decision\s+not\s+in\s*\(\s*'approved'\s*,\s*'rejected'\s*\)/i, 'must reject decisions outside the closed enum');
  expectPattern(definition, /v_req\.status\s+not\s+in\s*\(\s*'submitted'\s*,\s*'under_review'\s*\)/i, 'must reject requests outside an approval state');
  expectPattern(definition, /status\s*=\s*'pending'[\s\S]*order\s+by\s+step_order[\s\S]*limit\s+1[\s\S]*for\s+update/i, 'must lock and decide only the next pending step');
  expectPattern(definition, /assigned_user_id\s+is\s+not\s+null[\s\S]*assigned_user_id\s*(?:<>|is\s+distinct\s+from)\s*auth\.uid\(\)/i, 'must enforce a named DOA assignee when present');
  expectPattern(definition, /case\s+v_step\.tier[\s\S]*when\s+'dept_head'[\s\S]*when\s+'procurement_head'[\s\S]*when\s+'finance'[\s\S]*when\s+'legal'[\s\S]*when\s+'final_approver'/i, 'must enforce the pending step tier');
  expectPattern(definition, /v_req\.requester_id\s*=\s*auth\.uid\(\)/i, 'must prevent requester self-approval');
  expectPattern(definition, /v_decision\s*=\s*'approved'[\s\S]*signature_png[\s\S]*signer_name[\s\S]*signature_method/i, 'must require a complete signature for approval');
  expectPattern(definition, /set\s+search_path\s*=\s*''/i, 'must pin the security-definer search path');
});

test('effective Legal accreditation decisions require a current submitted application', () => {
  const definition = effectiveFunction('legal.approve_accreditation_case');

  expectPattern(definition, /core\.has_cap\('legal',\s*'approve_accreditation'\)/i, 'must retain the Legal approval capability gate');
  expectPattern(definition, /v_case\.status\s+not\s+in\s*\(\s*'submitted'\s*,\s*'under_review'\s*\)/i, 'must reject draft and terminal accreditation cases');
  expectPattern(definition, /from\s+legal\.vendor_application_snapshots[\s\S]*case_id\s*=\s*v_case\.id[\s\S]*order\s+by\s+version\s+desc[\s\S]*limit\s+1/i, 'must resolve the current application snapshot deterministically');
  expectPattern(definition, /v_snapshot\.status\s*<>\s*'submitted'/i, 'must require the current application snapshot to be submitted');
});

test('effective Legal evidence checks approve only the latest document version', () => {
  const definition = effectiveFunction('legal.approve_accreditation_case');

  expectPattern(definition, /from\s+legal\.accreditation_docs\s+candidate[\s\S]*order\s+by\s+candidate\.version\s+desc\s*,\s*candidate\.uploaded_at\s+desc[\s\S]*limit\s+1/i, 'must resolve the current document deterministically');
  expectPattern(definition, /current_document\.status\s*<>\s*'approved'/i, 'must treat a current non-approved document as missing evidence');
  assert.doesNotMatch(
    definition.sql,
    /not\s+exists\s*\([\s\S]*from\s+legal\.accreditation_docs\s+document[\s\S]*document\.status\s*=\s*'approved'[\s\S]*document\.requirement_id\s*=\s*item\.id[\s\S]*\)/i,
    `${definition.file}: must not accept any historical approved document`,
  );
});
