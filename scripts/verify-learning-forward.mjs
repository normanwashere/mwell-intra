import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const FORWARD_BOUNDARY = '20260816210000_add_service_role_launch_verifier.sql';
const canonical = value => value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const normalize = value => value.replace(/\s+/g, ' ').trim().toLowerCase();
const unique = values => [...new Set(values)].sort();

// This is a closed source-program contract, not a general SQL interpreter.
// Digests retain literals and control flow; effects expose the reviewed ACL and
// call boundaries. New SQL requires review, including SQL in unrelated schemas.
export function forwardStatementContract(statement) {
  const sql = normalize(statement);
  let kind;
  let effect;
  if (/^create(?: or replace)? function\b/.test(sql)) {
    kind = 'function';
    const declaration = statement.split(/\bas\s+\$(?:[a-z_][a-z0-9_]*)?\$/i)[0];
    effect = {
      declaration: normalize(declaration),
      calls: unique([...sql.matchAll(/\b([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)\s*\(/g)].map(match => match[1])),
      liveCapabilities: unique([...sql.matchAll(/core\.has_live_cap\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/g)].map(match => `${match[1]}.${match[2]}`)),
    };
  } else if (/^(?:grant|revoke|alter default privileges)\b/.test(sql)) {
    kind = 'privilege';
    effect = sql;
  } else if (/^alter function\b/.test(sql)) {
    kind = 'function-transition';
    effect = sql;
  } else if (/^do\b/.test(sql)) {
    kind = 'dynamic-program';
    effect = unique([...sql.matchAll(/\b((?:core|private|learning|warehouse|procurement|legal|product|reporting)\.[a-z_][a-z0-9_]*)/g)].map(match => match[1]));
  } else {
    const prefix = sql.match(/^(begin|commit|notify|select|with|lock table|reset role|set(?: local)?|insert into|update|delete from|comment on (?:table|view|function)|create (?:unique )?index|drop index|create(?: or replace)? view|create (?:table|schema|role|domain)|alter (?:table|policy|role)|(?:create|drop) (?:trigger|policy))\b/);
    if (!prefix) throw new Error(`Unmodeled forward statement class: ${sql.slice(0,100)}`);
    kind = prefix[1];
    effect = sql.slice(0,160);
  }
  return { kind, sha256: digest(statement), effect };
}

function contractInventory() {
  return JSON.parse(readFileSync(new URL('./learning-forward-contract.json', import.meta.url), 'utf8'));
}

export function verifyLearningForwardProgram(migrations, helpers) {
  const { scanSql } = helpers;
  const contracts = contractInventory();
  const byName = new Map(migrations.map(entry => [entry.name, entry]));
  const expectedNames = new Set(contracts.map(entry => entry.name));
  const errors = [];
  if (expectedNames.size !== contracts.length || contracts.some((entry, index) => index && entry.name <= contracts[index - 1].name)) {
    errors.push('Reviewed forward contract inventory must be unique and strictly ordered.');
  }
  for (const entry of migrations) {
    if (entry.name >= FORWARD_BOUNDARY && !expectedNames.has(entry.name)) {
      errors.push(`Unreviewed forward migration ${entry.name}; no schema or timestamp exemption is allowed.`);
    }
  }
  for (const expected of contracts) {
    const actual = byName.get(expected.name);
    if (!actual) {
      errors.push(`Reviewed forward migration missing: ${expected.name}.`);
      continue;
    }
    let statements;
    try { statements = scanSql(canonical(actual.sql)); }
    catch (error) { errors.push(`${actual.name}: ${error.message}`); continue; }
    if (statements.length !== expected.statements.length) {
      errors.push(`${actual.name}: reviewed forward statement count/order changed (${statements.length}, expected ${expected.statements.length}).`);
    }
    for (const [index, statement] of statements.entries()) {
      const pinned = expected.statements[index];
      if (!pinned) continue;
      let current;
      try { current = forwardStatementContract(statement); }
      catch (error) { errors.push(`${actual.name}#${index + 1}: ${error.message}`); continue; }
      if (current.kind !== pinned.kind || JSON.stringify(current.effect) !== JSON.stringify(pinned.effect)) {
        errors.push(`${actual.name}#${index + 1}: reviewed forward ${pinned.kind} authority/effect contract drifted.`);
      }
      if (current.sha256 !== pinned.sha256) {
        errors.push(`${actual.name}#${index + 1}: reviewed forward ${pinned.kind} statement/control-flow digest drifted; review the exact authority effect.`);
      }
    }
  }
  errors.push(...validateLearningTransforms(byName, helpers));
  return errors;
}

function validateLearningTransforms(byName, { scanSql, parseFunctionDeclaration, functionBody }) {
  const errors = [];
  const sql = name => canonical(byName.get(name)?.sql ?? '');
  const require = (value, pattern, message) => { if (!pattern.test(value)) errors.push(message); };
  const vendorName = '20260912131000_vendor_certification_scope_authority.sql';
  const vendor = normalize(sql(vendorName));
  for (const [pattern, reason] of [
    [/invitation\.accepted_generation = invitation\.link_generation/, 'current invitation generation'],
    [/assignment\.status = 'completed'/, 'completed assignment'],
    [/completed\.requirement_version_id = required\.id/, 'exact requirement lineage'],
    [/certification\.status = 'active'/, 'active certification'],
    [/source_assignment\.id = certification\.source_role_assignment_id/, 'source role assignment'],
    [/source_capability\.cap = certification\.capability/, 'source capability'],
    [/source_role\.is_active/, 'active source role'],
    [/certification_scope\.profile_id = certification\.user_id/, 'retained employee department scope'],
    [/certification_scope\.effective_to >= current_date/, 'current employee scope'],
    [/certification\.audience = 'vendor'/, 'vendor-only alternative'],
    [/certification\.module = 'core'/, 'vendor module'],
    [/certification\.source_role = 'vendor_portal'/, 'vendor source role'],
    [/certification\.capability = 'submit_accreditation'/, 'vendor capability'],
    [/certification_department\.code = 'legal_compliance'/, 'Legal-owned vendor training'],
    [/profile\.kind = 'vendor' and profile\.status = 'active'/, 'active vendor profile'],
    [/invitation\.vendor_id = profile\.vendor_id/, 'exact invited vendor'],
    [/curriculum\.status = 'published'/, 'published curriculum'],
    [/curriculum\.expires_at > pg_catalog\.now\(\)/, 'current curriculum'],
    [/requirement\.status = 'published'/, 'published requirement'],
    [/requirement\.expires_at > pg_catalog\.now\(\)/, 'current requirement'],
    [/cardinality\(certification\.requirement_version_ids\) > 0/, 'nonempty requirement evidence'],
  ]) require(vendor, pattern, `Vendor certification authority lacks ${reason}.`);

  const planSource = sql('20260911171901_learning_authority_plan_reuse.sql');
  const plans = normalize(planSource);
  for (const signature of ['learning.is_certification_required(text,text)', 'learning.has_active_certification(uuid,text,text)', 'learning.has_active_emergency_exception(uuid,text,text)']) {
    if (!plans.includes(`'${signature}'`)) errors.push(`Plan reuse must target the exact ${signature} signature.`);
  }
  require(planSource, /v_expression\s*:=\s*pg_catalog\.regexp_replace\(v_source, ';\\s\*\$', ''\)/,
    'Plan reuse must preserve the original SELECT expression, not authorization results.');
  require(plans, /v_language <> 'sql' or v_source !~/, 'Plan reuse must reject an unexpected source language/expression.');
  require(plans, /execute v_definition/, 'Plan reuse must apply the preserved function definition.');

  const checkpoint = normalize(sql('20260912045335_align_assigned_training_checkpoints.sql'));
  require(checkpoint, /pg_catalog\.pg_get_functiondef\('learning\.my_learning_snapshot_base\(\)'::regprocedure\)/,
    'Checkpoint projection must target only snapshot_base, preserving the public authentication wrapper.');
  require(checkpoint, /\/ length\(marker\) <> 1/, 'Checkpoint projection must require exactly one source marker.');
  require(checkpoint, /requirement_version\.pass_rules->'required_checkpoints'/, 'Checkpoint projection must use the assigned requirement version.');

  const convergence = normalize(sql('20260816213000_converge_read_rpc_live_capabilities.sql'));
  require(convergence, /'core\.has_live_cap\('/, 'Read RPC convergence must strengthen to live capability authority.');
  require(convergence, /procedure\.prosecdef/, 'Read RPC convergence must restrict its catalog selection.');
  require(convergence, /has_function_privilege\('authenticated', procedure\.oid, 'execute'\)/, 'Read RPC convergence must select the authenticated executable boundary.');
  require(convergence, /join learning\.mutation_capability_rules rule/, 'Read RPC convergence must use declared mutation capability rules.');

  const sellerSource = sql('20260920030900_event_seller_learning_readiness.sql');
  const seller = normalize(sellerSource);
  require(seller, /language sql stable security invoker set search_path = ''/, 'Seller readiness must remain a STABLE invoker with empty search_path.');
  require(seller, /revoke all on function private\.event_seller_learning_ready\(\) from public, anon, authenticated, service_role/,
    'Seller readiness must deny client and service_role EXECUTE.');
  require(seller, /cv\.owner_id <> cv\.reviewer_id/, 'Seller readiness must require independent publication actors.');
  require(seller, /mapping\.department_id is null/, 'Seller readiness must require the exact department-free role mapping.');
  const sellerDeclaration = scanSql(sellerSource).find(statement => /^create or replace function private\.event_seller_learning_ready/i.test(statement));
  if (/\b(?:insert|update|delete|grant)\b/.test(functionBody(sellerDeclaration ?? ''))) errors.push('Seller readiness may not write certification, roles or privileges.');
  const custody = normalize(sql('20260920025525_gated_event_seller_custody.sql'));
  require(custody, /insert into learning\.mutation_capability_rules\(module,capability\) values \('events','record_event_outcome'\) on conflict do nothing/,
    'Seller mutation capability must register only the governed record_event_outcome capability.');

  // Replay direct Learning declarations, renames and ACL transitions. CREATE OR
  // REPLACE preserves owner/ACL; a rename carries them with the original body.
  const functions = new Map();
  for (const entry of [...byName.values()].sort((a,b) => a.name.localeCompare(b.name))) {
    for (const statement of scanSql(canonical(entry.sql))) {
      const value = normalize(statement);
      if (/^create(?: or replace)? function (?:learning\.|core\.has_live_cap\b)/.test(value)) {
        const metadata = parseFunctionDeclaration(statement);
        if (!metadata) { errors.push(`${entry.name}: Learning function metadata is not analyzable.`); continue; }
        const previous = functions.get(metadata.qualifiedName);
        functions.set(metadata.qualifiedName, { metadata, body: functionBody(statement),
          owner: previous?.owner ?? 'postgres', roles: previous?.roles ?? new Set(['public']) });
      }
      let match = value.match(/^alter function (learning\.[a-z_]+)\([^)]*\) rename to ([a-z_]+)$/);
      if (match) {
        const previous = functions.get(match[1]);
        if (!previous) errors.push(`Learning rename lacks its predecessor ${match[1]}.`);
        else { functions.delete(match[1]); functions.set(`learning.${match[2]}`, previous); }
      }
      match = value.match(/^alter function ((?:learning\.[a-z_]+|core\.has_live_cap))\([^)]*\) owner to ([a-z_]+)$/);
      if (match && functions.has(match[1])) functions.get(match[1]).owner = match[2];
      match = value.match(/^(grant execute|revoke (?:all(?: privileges)?|execute)) on function ((?:learning\.[a-z_]+|core\.has_live_cap))\([^)]*\) (?:to|from) (.+)$/);
      if (match && functions.has(match[2])) {
        for (const role of match[3].split(',').map(role => role.trim())) {
          if (match[1] === 'grant execute') functions.get(match[2]).roles.add(role);
          else functions.get(match[2]).roles.delete(role);
        }
      }
      if (entry.name === '20260911171901_learning_authority_plan_reuse.sql' && /^do\b/.test(value)) {
        for (const name of ['learning.is_certification_required', 'learning.has_active_certification', 'learning.has_active_emergency_exception']) {
          const previous = functions.get(name);
          if (!previous || previous.metadata.language !== 'sql' || !/^select exists\s*\(/.test(previous.body)) {
            errors.push(`Plan reuse predecessor is not the reviewed SELECT authority: ${name}.`);
            continue;
          }
          functions.set(name, { ...previous, metadata: { ...previous.metadata, language: 'plpgsql' },
            body: `begin return (${previous.body.replace(/;$/, '')}); end;` });
        }
      }
      if (entry.name === '20260912045335_align_assigned_training_checkpoints.sql' && /^do\b/.test(value)) {
        const previous = functions.get('learning.my_learning_snapshot_base');
        const marker = "'simulationid', requirement_version.simulation_id,";
        if (!previous || previous.body.split(marker).length !== 2 || previous.body.includes("'requiredcheckpointids'")) {
          errors.push('Checkpoint snapshot_base predecessor must have exactly one unchanged projection marker.');
        } else {
          functions.set('learning.my_learning_snapshot_base', { ...previous,
            body: previous.body.replace(marker, `${marker} 'requiredcheckpointids', requirement_version.pass_rules->'required_checkpoints',`) });
        }
      }
    }
  }
  const expectedRoles = new Map([
    ['learning.my_learning_snapshot', ['authenticated','service_role']],
    ['learning.my_learning_snapshot_base', []],
    ['learning.is_certification_required', ['service_role']],
    ['learning.has_active_certification', ['service_role']],
    ['learning.has_active_emergency_exception', ['service_role']],
    ['core.has_live_cap', ['authenticated','service_role']],
  ]);
  for (const [name, roles] of expectedRoles) {
    const fn = functions.get(name);
    if (!fn || fn.owner !== 'postgres' || JSON.stringify([...fn.roles].sort()) !== JSON.stringify(roles)) {
      errors.push(`Effective Learning owner/EXECUTE authority drifted for ${name}.`);
    }
    if (fn && (fn.metadata.securityMode !== 'definer' || fn.metadata.volatility !== 'stable' || JSON.stringify(fn.metadata.proconfig) !== '["search_path="]')) {
      errors.push(`Effective Learning function security metadata drifted for ${name}.`);
    }
    if (fn && fn.metadata.language !== (name === 'core.has_live_cap' ? 'sql' : 'plpgsql')) {
      errors.push(`Effective Learning language transformation drifted for ${name}.`);
    }
  }
  const wrapper = functions.get('learning.my_learning_snapshot')?.body ?? '';
  require(wrapper, /v_user_id is null/, 'Learning snapshot wrapper must authenticate before delegation.');
  require(wrapper, /learning\.my_learning_snapshot_base\(\)/, 'Learning snapshot wrapper must delegate to the retained guarded base.');
  const base = functions.get('learning.my_learning_snapshot_base')?.body ?? '';
  require(base, /v_user_id is null/, 'Learning snapshot base must retain authentication after checkpoint projection.');
  require(base, /'requiredcheckpointids', requirement_version\.pass_rules->'required_checkpoints'/,
    'Effective checkpoint projection must preserve assigned-version requirements.');
  const live = functions.get('core.has_live_cap')?.body ?? '';
  for (const dependency of ['core.has_cap', 'learning.is_certification_required', 'learning.has_active_certification', 'learning.has_active_emergency_exception']) {
    if (!live.includes(dependency)) errors.push(`Live capability authority must retain ${dependency}.`);
  }
  return errors;
}
