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
  errors.push(...validateExportAuthority(byName, helpers));
  errors.push(...validateAllocationReturnBalance(byName, helpers));
  errors.push(...validateTransferAuthority(byName, helpers));
  return errors;
}

function validateTransferAuthority(byName, { scanSql, functionBody }) {
  const source = canonical(byName.get('20261105141930_serialized_transfer_quantity_identity.sql')?.sql ?? '');
  const statements = scanSql(source);
  const declarations = statements.filter(statement => /^create(?: or replace)? function\b/i.test(statement));
  const declaration = declarations[0] ?? '';
  const body = normalize(functionBody(declaration));
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  require(declarations.length === 1 && /^create or replace function private\.warehouse_transfer_pre_lot_putaway\(payload jsonb\)/i.test(declaration),
    'Transfer remediation must replace only the private implementation, retaining all public/offline/lot wrappers.');
  require(/returns jsonb language plpgsql security definer set search_path = '' as \$\$/.test(normalize(declaration)),
    'Transfer implementation must retain SECURITY DEFINER and empty search_path.');
  const predecessor = normalize(statements[1] ?? '');
  require(statements[0]?.toLowerCase() === 'begin' && statements.at(-1)?.toLowerCase() === 'commit' &&
    predecessor.includes(normalize(`if (select md5(replace(prosrc, chr(13), '')) from pg_proc
      where oid = to_regprocedure('private.warehouse_transfer_pre_lot_putaway(jsonb)'))
      is distinct from '50973cd87f9aacaae2582b4480be732d' then
      raise exception 'Transfer predecessor definition drifted; review the live function before applying';`)),
  'Transfer must atomically reject any change to the exact reviewed predecessor before replacement.');
  const firstWrite = body.indexOf('update warehouse.inventory_units');
  const beforeWrite = (snippet, message) => {
    const index = body.indexOf(normalize(snippet));
    require(index >= 0 && firstWrite > index, message);
  };
  beforeWrite("if not core.has_cap('warehouse', 'transfer_stock') then raise exception 'Not authorized: transfer_stock'; end if;",
    'Transfer must retain the base capability guard inside the unchanged live-capability wrapper chain.');
  beforeWrite('v_actor := warehouse.authoritative_actor();', 'Transfer must derive the authoritative actor.');
  beforeWrite("payload := jsonb_set(payload, '{movement}', warehouse.force_actor_on_object(v_movement, v_actor));",
    'Transfer must overwrite spoofed movement identity with the authoritative actor.');
  for (const snippet of ["v_movement->>'type' is distinct from 'transfer'", "jsonb_typeof(v_movement->'quantity') is distinct from 'number'",
    "(v_movement->>'quantity') !~ '^[1-9][0-9]*$'", "(v_movement->>'quantity')::numeric > 2147483647"]) {
    beforeWrite(snippet, 'Transfer movement must require a positive integer with the exact transfer type before writes.');
  }
  for (const snippet of ['v_quantity <> v_expected', 'v_expected <> (select count(distinct id) from unnest(v_unit_ids) id)']) {
    beforeWrite(snippet, 'Transfer quantity must equal the distinct unit count before writes.');
  }
  beforeWrite("v_command->'quantity' is distinct from v_movement->'quantity'", 'Transfer command must match the movement quantity.');
  beforeWrite("v_unit.product_id is distinct from v_movement->>'product_id'", 'Transfer must verify every selected unit product.');
  beforeWrite("if v_unit.status <> 'in_stock' or v_unit.location_id is distinct from v_from_location_id or v_unit.bin_id is distinct from v_from_bin_id then",
    'Transfer must retain in-stock status and exact source location/bin checks.');
  beforeWrite("active_hold.status = 'active' and active_hold.product_id = v_unit.product_id and active_hold.location_id = v_unit.location_id and active_hold.bin_id is not distinct from v_unit.bin_id and active_hold.lot_id is not distinct from v_unit.lot_id and active_hold.serial_number = v_unit.serial_number",
    'Transfer must preserve the exact serialized hold identity.');
  beforeWrite('if v_updated <> v_expected then', 'Transfer must verify all selected units exist before writes.');
  beforeWrite('perform private.lock_warehouse_products(v_product_ids);', 'Transfer must preserve product lock ordering.');
  beforeWrite('where unit.id = any(v_unit_ids) order by unit.id for update', 'Transfer must preserve ordered unit row locks.');
  beforeWrite("is distinct from (select array_agg(serial order by serial) from jsonb_array_elements_text(v_command->'serialNumbers') serial)",
    'Transfer must compare exact selected serial identities before writes.');
  require(body.includes(normalize("elsif exists (select 1 from warehouse.products p where p.id = v_movement->>'product_id' and p.serialized) then raise exception 'Serialized transfer requires exact unit IDs';")),
    'Transfer serialized products must require exact unit IDs.');
  require(body.includes('v_to_quantity <> v_from_quantity or v_quantity <> v_from_quantity'),
    'Transfer bulk movement and stock deltas must retain equal quantity.');
  require(body.includes('if v_source_quantity - v_held_quantity < v_from_quantity then'),
    'Transfer bulk stock must retain active hold availability checks.');
  require(body.includes("if v_to_delta ? 'lot_id' and nullif(v_to_delta->>'lot_id', '') is distinct from v_lot_id then"),
    'Transfer must retain exact source/destination lot identity.');
  const privileges = statements.filter(statement => /^(?:grant|revoke)\b/i.test(statement)).map(normalize);
  require(JSON.stringify(privileges) === JSON.stringify([
    'revoke all on function private.warehouse_transfer_pre_lot_putaway(jsonb) from public, anon, authenticated',
    'grant execute on function private.warehouse_transfer_pre_lot_putaway(jsonb) to service_role',
  ]), 'Transfer private implementation EXECUTE must deny clients and retain service_role only.');
  return errors;
}

function validateAllocationReturnBalance(byName, { scanSql, functionBody }) {
  const source = canonical(byName.get('20261105135318_warehouse_allocation_return_balance.sql')?.sql ?? '');
  const statements = scanSql(source);
  const declaration = statements.find(statement => /^create or replace function warehouse\.allocation_return_balance\(/i.test(statement)) ?? '';
  const body = normalize(functionBody(declaration));
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  require(/^create or replace function warehouse\.allocation_return_balance\(p_allocation_id text\) returns jsonb language plpgsql stable security definer set search_path = '' as \$\$/.test(normalize(declaration)),
    'Allocation return projection must retain its exact signature, STABLE security definer and empty search_path.');
  require(body.includes(normalize(`begin
    if auth.uid() is null or core.has_live_cap('warehouse','manage_returns') is distinct from true then
      raise exception 'Not authorized: warehouse.manage_returns';
    end if;
    select * into allocation from warehouse.allocations where id=p_allocation_id;`)),
  'Allocation return projection must authenticate with fail-closed live capability before lookup.');
  require(body.includes('if not found then raise exception \'allocation not found\'; end if;'),
    'Allocation return projection must reject missing allocations.');
  require(body.includes('if exists(select 1 from private.event_custody_sessions where event_id=allocation.event_id) then'),
    'Allocation return projection must delegate all custody sessions, including disabled sessions.');
  require(body.includes('balance := private.event_allocation_remaining(allocation.id);'),
    'Allocation return projection must delegate the exact resolved allocation to the actual custody helper.');
  const outputs = [...body.matchAll(/return (jsonb_build_object\([\s\S]*?\));/g)].map(match => match[1]);
  require(outputs.length === 2 && outputs[0] === normalize(`jsonb_build_object('allocation_id',allocation.id,
    'issued_units',balance->'issued_units','returned_units',balance->'returned_units',
    'remaining_units',balance->'remaining_units')`),
  'Allocation return projection must expose quantity-only custody results with the helper remaining balance.');
  require(body.includes(normalize(`select coalesce(sum((line->>'quantity')::bigint),0) into returned
    from warehouse.returns r cross join lateral jsonb_array_elements(r.lines) line
    where r.event_id=allocation.event_id and line->>'allocationId'=allocation.id;`)),
  'Allocation return ordinary projection must preserve exact event and allocation lineage.');
  require(body.includes("if returned<0 or returned>allocation.quantity then raise exception 'allocation return balance is invalid'; end if;"),
    'Allocation return projection must reject an invalid ordinary balance.');
  require(outputs[1] === normalize(`jsonb_build_object('allocation_id',allocation.id,'issued_units',allocation.quantity,
    'returned_units',returned,'remaining_units',allocation.quantity-returned)`),
  'Allocation return ordinary projection must preserve quantity-only issued-minus-returned remaining arithmetic.');
  require(!/\b(?:insert|update|delete|truncate|execute|perform|grant|revoke)\b/.test(body),
    'Allocation return projection must remain read-only without dynamic commands or mutations.');
  const privileges = statements.filter(statement => /^(?:grant|revoke)\b/i.test(statement)).map(normalize);
  require(JSON.stringify(privileges) === JSON.stringify([
    'revoke all on function warehouse.allocation_return_balance(text) from public,anon',
    'grant execute on function warehouse.allocation_return_balance(text) to authenticated,service_role',
  ]), 'Allocation return EXECUTE must retain authenticated/service roles and deny public/anon.');
  return errors;
}

function validateExportAuthority(byName, { scanSql, functionBody }) {
  const source = canonical(byName.get('20261105134446_warehouse_export_command_authority.sql')?.sql ?? '');
  const errors = [];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const statements = scanSql(source);
  const program = statements.find(statement => /^do\b/i.test(statement)) ?? '';
  const guards = [...program.matchAll(/new_guard := \$new\$([\s\S]*?)\$new\$/g)].map(match => normalize(match[1]));
  require(guards[0] === normalize(`if auth.uid() is null or not (
    coalesce(core.has_live_cap('warehouse', 'register_exports'), false)
    or coalesce(core.has_live_cap('insights', 'prepare_exports'), false)
  ) then`), 'Export registration must require authenticated, fail-closed live capability authority.');
  require(guards[1] === normalize(`if auth.uid() is null or not (
    coalesce(core.has_live_cap('warehouse', 'review_exports'), false)
    or (v_job.created_by = auth.uid() and (
      (v_job.export_type = 'insights_snapshot' and coalesce(core.has_live_cap('insights', 'prepare_exports'), false))
      or (v_job.export_type <> 'insights_snapshot' and coalesce(core.has_live_cap('warehouse', 'register_exports'), false))
    ))
  ) then`), 'Export download must retain certified reviewer or exact owner and export type authority.');
  require(normalize(program.match(/\$scope\$([\s\S]*?)\$scope\$/)?.[1] ?? '') ===
    "and (source.created_by = auth.uid() or coalesce(core.has_live_cap('warehouse', 'review_exports'), false))",
  'Export correction must require the owner or a certified reviewer.');
  require((program.match(/<> length\(old_guard\)/g) ?? []).length === 2 &&
    program.includes('<> length(correction_guard)'), 'Export transformation must require exact single predecessor markers.');
  for (const name of ['warehouse.register_export_job_uncertified_impl(jsonb)', 'warehouse.prepare_export_download_pre_insights_certification(jsonb)']) {
    require(program.includes(`pg_catalog.pg_get_functiondef('${name}'::regprocedure)`), `Export transformation must preserve the exact private implementation ${name}.`);
  }
  const helper = statements.find(statement => /^create function private\.warehouse_export_is_unregistered\(/i.test(statement)) ?? '';
  require(/returns boolean language sql stable security definer set search_path = ''/.test(normalize(helper)),
    'Export orphan predicate must be a STABLE security definer with empty search_path.');
  require(normalize(functionBody(helper)) === normalize(`select coalesce(auth.uid() is not null
    and p_path like 'exports/' || auth.uid()::text || '/%'
    and not exists (select 1 from warehouse.export_jobs job where job.storage_path = p_path), false);`).replace(/;$/, ''),
  'Export orphan predicate must require the caller own path and global job absence, never RLS-relative absence.');
  const privileges = statements.filter(statement => /^(?:grant|revoke)\b/i.test(statement)).map(normalize);
  require(JSON.stringify(privileges) === JSON.stringify([
    'revoke all on function private.warehouse_export_is_unregistered(text) from public, anon, authenticated, service_role',
    'grant execute on function private.warehouse_export_is_unregistered(text) to authenticated',
  ]), 'Export orphan EXECUTE must be authenticated-only; private implementation ACLs must be preserved.');
  const read = statements.find(statement => /^create policy warehouse_exports_own_temporary_read\b/i.test(statement)) ?? '';
  require(normalize(read) === normalize(`create policy warehouse_exports_own_temporary_read on storage.objects
    for select to authenticated using (
      bucket_id = 'warehouse-exports' and owner_id = auth.uid()::text
      and (coalesce(core.has_live_cap('warehouse', 'register_exports'), false)
        or coalesce(core.has_live_cap('insights', 'prepare_exports'), false))
      and private.warehouse_export_is_unregistered(name)
    )`), 'Export temporary read must retain bucket, owner, live capability and global unregistered scope.');
  const remove = statements.find(statement => /^create policy warehouse_exports_orphan_cleanup\b/i.test(statement)) ?? '';
  require(normalize(remove) === normalize(`create policy warehouse_exports_orphan_cleanup on storage.objects
    for delete to authenticated using (
      bucket_id = 'warehouse-exports' and owner_id = auth.uid()::text
      and (coalesce(core.has_live_cap('warehouse', 'register_exports'), false)
        or coalesce(core.has_live_cap('insights', 'prepare_exports'), false))
      and private.warehouse_export_is_unregistered(name)
    )`), 'Export temporary delete must directly retain bucket, owner, live capability and global unregistered scope.');
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
