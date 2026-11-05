import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const ROOT = resolve(import.meta.dirname, '..');
const MIGRATIONS = resolve(ROOT, 'supabase', 'migrations');

function effectiveFunctions(sources) {
  const definitions = new Map();
  const name = '(?:procurement\\.(?:decide_request_step\\w*|request_decision_eligibility)|legal\\.approve_accreditation_case\\w*)';
  const operation = new RegExp(`create\\s+or\\s+replace\\s+function\\s+(${name})\\s*\\(\\s*payload\\s+jsonb\\s*\\)|alter\\s+function\\s+(${name})\\s*\\(\\s*jsonb\\s*\\)\\s+rename\\s+to\\s+(\\w+)`, 'gi');
  // Renames preserve the body at that point in history, not the later wrapper.
  for (const { file, sql } of sources) {
    operation.lastIndex = 0;
    let match;
    while ((match = operation.exec(sql))) {
      if (match[1]) {
        const end = sql.indexOf('$$;', operation.lastIndex);
        assert.notEqual(end, -1, `${file}: unterminated ${match[1]}`);
        definitions.set(match[1], { file, sql: sql.slice(match.index, end + 3) });
        operation.lastIndex = end + 3;
      } else {
        assert.ok(definitions.has(match[2]), `${file}: missing rename source ${match[2]}`);
        definitions.set(`${match[2].split('.')[0]}.${match[3]}`, definitions.get(match[2]));
        definitions.delete(match[2]);
      }
    }
  }
  return definitions;
}

const definitions = effectiveFunctions(readdirSync(MIGRATIONS).filter(name => name.endsWith('.sql')).sort()
  .map(file => ({ file, sql: readFileSync(resolve(MIGRATIONS, file), 'utf8') })));

function effectiveFunction(qualifiedName, functions = definitions) {
  const definition = functions.get(qualifiedName);
  assert.ok(definition, `No effective definition found for ${qualifiedName}`);
  return definition;
}

function expectPattern(definition, pattern, message) {
  assert.match(definition.sql, pattern, `${definition.file}: ${message}`);
}

function assertProcurement(functions = definitions) {
  const wrapper = effectiveFunction('procurement.decide_request_step', functions);
  const eligibility = effectiveFunction('procurement.request_decision_eligibility', functions);
  const definition = effectiveFunction('procurement.decide_request_step_uncertified_impl', functions);

  expectPattern(wrapper, /eligibility\s*:=\s*procurement\.request_decision_eligibility\([\s\S]*if not coalesce\(\(eligibility->>'canDecide'\)::boolean,false\) then raise exception[\s\S]*return procurement\.decide_request_step_uncertified_impl\(payload\)/i, 'public wrapper must reject ineligible callers before delegating');
  expectPattern(eligibility, /core\.has_live_cap\('procurement',\s*'approve_request'\)/i, 'must retain live certification, not only assigned capability');
  expectPattern(definition, /core\.has_cap\('procurement',\s*'approve_request'\)/i, 'must retain the procurement approval capability gate');
  expectPattern(definition, /v_decision\s+not\s+in\s*\(\s*'approved'\s*,\s*'rejected'\s*\)/i, 'must reject decisions outside the closed enum');
  expectPattern(definition, /v_req\.status\s+not\s+in\s*\(\s*'submitted'\s*,\s*'under_review'\s*\)/i, 'must reject requests outside an approval state');
  expectPattern(definition, /status\s*=\s*'pending'[\s\S]*order\s+by\s+step_order[\s\S]*limit\s+1[\s\S]*for\s+update/i, 'must lock and decide only the next pending step');
  expectPattern(definition, /if\s+v_step\.assigned_user_id\s+is\s+distinct\s+from\s+auth\.uid\(\)\s+then\s+raise exception/i, 'must reject both missing and different named assignees');
  expectPattern(eligibility, /if not private\.has_current_procurement_tier\(s\.tier\) then[\s\S]*'canDecide',false/i, 'must require the current approval tier');
  expectPattern(eligibility, /case\s+s\.tier[\s\S]*when\s+'legal'[\s\S]*when\s+'dept_head'[\s\S]*when\s+'procurement_head'[\s\S]*when\s+'finance'[\s\S]*when\s+'final_approver'[\s\S]*else false end/i, 'must explicitly gate every pending tier and deny unknown tiers');
  expectPattern(eligibility, /s\.tier='final_approver' and not private\.procurement_final_doa_matches\(r,s\) then/i, 'final approval must still match current DOA');
  expectPattern(definition, /for update;[\s\S]*v_eligibility\s*:=\s*procurement\.request_decision_eligibility\([\s\S]*if not coalesce\(\(v_eligibility->>'canDecide'\)::boolean,false\) then\s*raise exception/i, 'must recheck eligibility after locking');
  expectPattern(definition, /v_req\.requester_id\s*=\s*auth\.uid\(\)/i, 'must prevent requester self-approval');
  expectPattern(definition, /v_decision\s*=\s*'approved'[\s\S]*signature_png[\s\S]*signer_name[\s\S]*signature_method/i, 'must require a complete signature for approval');
  for (const item of [wrapper, eligibility, definition]) expectPattern(item, /set\s+search_path\s*=\s*''/i, 'must pin the security-definer search path');
}

function legalImplementation(functions) {
  const wrapper = effectiveFunction('legal.approve_accreditation_case', functions);
  const certification = effectiveFunction('legal.approve_accreditation_case_pre_legal_launch', functions);
  expectPattern(wrapper, /not core\.has_live_cap\('legal',\s*'approve_accreditation'\)\s*then\s*raise exception/i, 'public Legal gate must retain live capability enforcement');
  expectPattern(wrapper, /return legal\.approve_accreditation_case_pre_legal_launch\(payload\)/i, 'public Legal wrapper must delegate to its governed predecessor');
  expectPattern(certification, /return legal\.approve_accreditation_case_uncertified_impl\(payload\)/i, 'certification wrapper must delegate to the preserved decision implementation');
  const definition = effectiveFunction('legal.approve_accreditation_case_uncertified_impl', functions);
  for (const item of [wrapper, certification, definition]) expectPattern(item, /set\s+search_path\s*=\s*''/i, 'must pin each delegated search path');
  return definition;
}

function assertLegalApplication(functions = definitions) {
  const definition = legalImplementation(functions);
  expectPattern(definition, /core\.has_cap\('legal',\s*'approve_accreditation'\)/i, 'must retain the Legal approval capability gate');
  expectPattern(definition, /v_case\.status\s+not\s+in\s*\(\s*'submitted'\s*,\s*'under_review'\s*\)/i, 'must reject draft and terminal accreditation cases');
  expectPattern(definition, /from\s+legal\.vendor_application_snapshots[\s\S]*case_id\s*=\s*v_case\.id[\s\S]*order\s+by\s+version\s+desc[\s\S]*limit\s+1/i, 'must resolve the current application snapshot deterministically');
  expectPattern(definition, /v_snapshot\.status\s*<>\s*'submitted'/i, 'must require the current application snapshot to be submitted');
}

function assertLegalEvidence(functions = definitions) {
  const definition = legalImplementation(functions);

  expectPattern(definition, /from\s+legal\.accreditation_docs\s+candidate[\s\S]*order\s+by\s+candidate\.version\s+desc\s*,\s*candidate\.uploaded_at\s+desc[\s\S]*limit\s+1/i, 'must resolve the current document deterministically');
  expectPattern(definition, /current_document\.status\s*<>\s*'approved'/i, 'must treat a current non-approved document as missing evidence');
  assert.doesNotMatch(
    definition.sql,
    /not\s+exists\s*\([\s\S]*from\s+legal\.accreditation_docs\s+document[\s\S]*document\.status\s*=\s*'approved'[\s\S]*document\.requirement_id\s*=\s*item\.id[\s\S]*\)/i,
    `${definition.file}: must not accept any historical approved document`,
  );
}

test('effective procurement step decisions enforce ordered, assigned, signed authority', () => assertProcurement());
test('effective Legal accreditation decisions require a current submitted application', () => assertLegalApplication());
test('effective Legal evidence checks approve only the latest document version', () => assertLegalEvidence());

test('rename resolution preserves the historical body across wrappers and LF/CRLF', () => {
  for (const newline of ['\n', '\r\n']) {
    const source = [
      "create or replace function legal.approve_accreditation_case(payload jsonb) returns jsonb as $$ begin return '1'::jsonb; end; $$;",
      'alter function legal.approve_accreditation_case(jsonb) rename to approve_accreditation_case_uncertified_impl;',
      'create or replace function legal.approve_accreditation_case(payload jsonb) returns jsonb as $$ begin return legal.approve_accreditation_case_uncertified_impl(payload); end; $$;',
      'alter function legal.approve_accreditation_case(jsonb) rename to approve_accreditation_case_pre_legal_launch;',
    ].join(newline);
    const found = effectiveFunctions([{ file: 'synthetic.sql', sql: source }]);
    assert.equal(found.has('legal.approve_accreditation_case'), false);
    assert.match(found.get('legal.approve_accreditation_case_uncertified_impl').sql, /return '1'/);
    assert.match(found.get('legal.approve_accreditation_case_pre_legal_launch').sql, /return legal\.approve_accreditation_case_uncertified_impl/);
  }
});

test('authority assertions reject removed delegated guards and broken wrapper links', () => {
  const cases = [
    ['procurement.decide_request_step', 'procurement.request_decision_eligibility', assertProcurement],
    ['procurement.request_decision_eligibility', 'core.has_live_cap', assertProcurement],
    ['procurement.request_decision_eligibility', 'private.has_current_procurement_tier', assertProcurement],
    ['procurement.request_decision_eligibility', 'private.procurement_final_doa_matches', assertProcurement],
    ['procurement.decide_request_step_uncertified_impl', 'v_step.assigned_user_id', assertProcurement],
    ['procurement.decide_request_step_uncertified_impl', "v_req.requester_id=auth.uid()", assertProcurement],
    ['procurement.decide_request_step_uncertified_impl', 'signature_png', assertProcurement],
    ['procurement.decide_request_step_uncertified_impl', 'for update', assertProcurement],
    ['legal.approve_accreditation_case', 'core.has_live_cap', assertLegalApplication],
    ['legal.approve_accreditation_case', 'return legal.approve_accreditation_case_pre_legal_launch', assertLegalApplication],
    ['legal.approve_accreditation_case_pre_legal_launch', 'return legal.approve_accreditation_case_uncertified_impl', assertLegalEvidence],
    ['legal.approve_accreditation_case_uncertified_impl', "v_snapshot.status <> 'submitted'", assertLegalApplication],
    ['legal.approve_accreditation_case_uncertified_impl', 'candidate.version desc', assertLegalEvidence],
    ['legal.approve_accreditation_case_uncertified_impl', "current_document.status <> 'approved'", assertLegalEvidence],
  ];
  for (const [name, guard, verify] of cases) {
    const functions = new Map(definitions);
    const original = functions.get(name);
    assert.ok(original.sql.includes(guard), `mutation must remove a real guard: ${guard}`);
    functions.set(name, { ...original, sql: original.sql.replaceAll(guard, 'REMOVED_GUARD') });
    assert.throws(() => verify(functions), undefined, `must detect removal of ${guard}`);
  }
});
