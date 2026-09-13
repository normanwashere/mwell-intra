import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Offline SQL generation only. The executor must independently verify the UAT
// connection, stop the run, archive readback, and review each deletion batch.
const PROJECT = 'kkoitlvydytdhlpxhuah';
const ORIGIN = 'https://mwell-intra-uat.vercel.app';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const VIEWS = ['desktop-1440', 'mobile-390'];
const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const list = values => values.map(literal).join(', ');
const any = parts => `(${parts.join(' or ')})`;
const inList = (column, values) => `${column} in (${list(values)})`;
const prefix = (column, value) => `left(${column}, ${value.length}) = ${literal(value)}`;

function validateManifest(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'Invalid manifest');
  const m = structuredClone(input);
  assert(typeof m.runId === 'string' && UUID.test(m.runId), 'Manifest runId must be a canonical UUID');
  assert(m.project === PROJECT && m.origin === ORIGIN, 'Manifest target scope is not the reviewed UAT project');
  assert(typeof m.commit === 'string' && /^[a-f0-9]{40}$/.test(m.commit), 'Invalid manifest commit');
  assert(Array.isArray(m.cases) && m.cases.length === VIEWS.length, 'Manifest requires both viewports');
  const seen = new Set([m.runId]);
  const views = new Set();
  for (const c of m.cases) {
    assert(c && VIEWS.includes(c.viewport) && !views.has(c.viewport), 'Invalid or duplicate manifest viewport');
    views.add(c.viewport);
    const id = `wms-${m.runId.slice(0, 8)}-${c.viewport}`;
    for (const [key, expected] of Object.entries({ productId: id, locationId: `${id}-loc`, binId: `${id}-bin`,
      binCode: `WMS-${m.runId.slice(0, 8)}-${c.viewport}`, sku: id.toUpperCase(), productName: `WMS signoff ${c.viewport}` })) {
      assert.equal(c[key], expected, `Manifest ${key} scope must match run prefix and viewport`);
    }
    for (const key of ['orderId', 'requestId']) {
      assert(typeof c[key] === 'string' && UUID.test(c[key]), `Manifest ${key} must be a canonical UUID`);
      assert(!seen.has(c[key]), 'Duplicate manifest identity');
      seen.add(c[key]);
    }
    for (const key of ['openingQuantity', 'requestedQuantity']) {
      assert(Number.isSafeInteger(c[key]) && c[key] > 0 && c[key] <= 2147483647, `Invalid manifest ${key} quantity`);
    }
    assert(c.requestedQuantity <= c.openingQuantity, 'Requested quantity exceeds opening quantity');
  }
  m.cases.sort((a, b) => VIEWS.indexOf(a.viewport) - VIEWS.indexOf(b.viewport));
  return m;
}

function storagePrefixes(m) {
  return m.cases.flatMap(c => [`acknowledgment-${c.orderId}/`, `fulfillment/${c.orderId}/`, `delivery-${c.orderId}/`]);
}

function validateStorageVerification(value, m) {
  if (value === undefined) return null;
  assert(value && value.runId === m.runId && value.project === m.project, 'Storage verification scope mismatch');
  assert(value.inventoryComplete === true && Array.isArray(value.objects), 'Storage verification requires complete inventory');
  for (const key of ['verifiedBy', 'evidenceRef']) {
    assert(typeof value[key] === 'string' && /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,299}$/.test(value[key]), `Invalid storage verification ${key}`);
  }
  assert(typeof value.verifiedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.verifiedAt)
    && Number.isFinite(Date.parse(value.verifiedAt)), 'Invalid storage verification time');
  const paths = new Set();
  for (const object of value.objects) {
    assert(object?.bucket === 'evidence' && object.status === 'deleted-and-verified', 'Storage cleanup must be separately verified');
    assert(typeof object.path === 'string' && /^[A-Za-z0-9._/-]+$/.test(object.path)
      && object.path.split('/').every(part => part && part !== '.' && part !== '..')
      && storagePrefixes(m).some(start => object.path.startsWith(start)), 'Storage object scope is not run-owned');
    assert(!paths.has(object.path), 'Duplicate storage verification object');
    paths.add(object.path);
  }
  return structuredClone(value);
}

function buildScope(m) {
  const products = m.cases.map(c => c.productId);
  const locations = m.cases.map(c => c.locationId);
  const bins = m.cases.map(c => c.binId);
  const orders = m.cases.map(c => c.orderId);
  const requests = m.cases.map(c => c.requestId);
  const entities = [...orders, ...requests, ...products, ...locations, ...bins];
  const jsonProducts = column => any(products.map(id => `${column} @> ${literal(JSON.stringify([{ productId: id }]))}::jsonb`));
  const lineProof = c => `jsonb_typeof(r.lines) = 'array' and jsonb_array_length(r.lines) = 1
      and r.lines->0->>'productId' = ${literal(c.productId)} and r.lines->0->'quantity' = '${c.requestedQuantity}'::jsonb`;
  const entityProof = any([
    `(r.entity_type = 'fulfillment_order' and ${inList('r.entity_id::text', orders)})`,
    `(r.entity_type = 'department_stock_request' and ${inList('r.entity_id::text', requests)})`,
    `(r.entity_type = 'product' and ${inList('r.entity_id::text', products)})`,
    `(r.entity_type = 'location' and ${inList('r.entity_id::text', locations)})`,
    `(r.entity_type = 'storage_area' and ${inList('r.entity_id::text', bins)})`,
  ]);
  const keyScope = any(m.cases.map(c => prefix('r.idempotency_key', `${m.runId}-${c.viewport}-`)));
  const commandScope = `(${inList("r.response->>'id'", [...orders, ...requests])} or ${keyScope})`;
  const commandProof = any(m.cases.map(c => `(
    (${inList("r.response->>'id'", [c.orderId, c.requestId])} or ${prefix('r.idempotency_key', `${m.runId}-${c.viewport}-`)})
    and (r.response->>'id' is null or ${inList("r.response->>'id'", [c.orderId, c.requestId])})
    and (r.response->>'fulfillment_order_id' is null or r.response->>'fulfillment_order_id' = ${literal(c.orderId)})
  )`));
  const target = (entity, candidates, proof = candidates) => ({ entity, candidates, proof });
  const targets = [
    target('core.notifications', inList('r.entity_id::text', entities), entityProof),
    target('core.activity_log', inList('r.entity_id::text', entities), `(r.module = 'warehouse' and ${entityProof})`),
    target('warehouse.command_log', commandScope, `(${commandScope} and ${commandProof}
      and r.command_name in ('create_department_stock_request','decide_department_stock_request',
        'advance_fulfillment_order','advance_fulfillment_order_v2','advance_fulfillment_order_v3'))`),
    target('warehouse.fulfillment_reservations', any([inList('r.order_id::text', orders), inList('r.product_id', products), inList('r.location_id', locations), inList('r.bin_id', bins)]),
      any(m.cases.map(c => `(r.order_id = '${c.orderId}'::uuid and r.product_id = '${c.productId}'
        and (r.location_id is null or r.location_id = '${c.locationId}')
        and (r.bin_id is null or r.bin_id = '${c.binId}') and r.quantity = ${c.requestedQuantity})`))),
    target('warehouse.department_stock_requests', any([inList('r.id::text', requests), inList('r.fulfillment_order_id::text', orders), jsonProducts('r.lines')]),
      any(m.cases.map(c => `(r.id = '${c.requestId}'::uuid and r.purpose = 'Synthetic WMS signoff ${m.runId}'
        and ${lineProof(c)} and r.event_id is null and (r.fulfillment_order_id is null or r.fulfillment_order_id = '${c.orderId}'::uuid))`))),
    target('warehouse.fulfillment_orders', any([inList('r.id::text', orders), inList('r.source_location_id', locations), inList('r.source_bin_id', bins), jsonProducts('r.lines'), jsonProducts('r.packaging')]),
      any(m.cases.map(c => `(r.id = '${c.orderId}'::uuid and r.source = 'department_request' and r.external_reference = 'REQ-${c.requestId}'
        and ${lineProof(c)} and r.packaging = '[]'::jsonb and r.parent_order_id is null and r.event_id is null
        and r.third_party_location_id is null and (r.source_location_id is null or r.source_location_id = '${c.locationId}')
        and (r.source_bin_id is null or r.source_bin_id = '${c.binId}'))`))),
    target('warehouse.movements', any([inList('r.product_id', products), inList('r.reference', [...orders, ...requests]),
      ...['from_location_id', 'to_location_id'].map(key => inList(`r.${key}`, locations)), ...['from_bin_id', 'to_bin_id'].map(key => inList(`r.${key}`, bins))]),
      any(m.cases.map(c => `(r.product_id = '${c.productId}' and r.reference = '${c.orderId}' and r.type = 'fulfillment_release'
        and r.from_location_id = '${c.locationId}' and r.from_bin_id = '${c.binId}' and r.to_location_id is null and r.to_bin_id is null
        and r.lot_id is null and r.serial_number is null and r.event_id is null and r.quantity = ${c.requestedQuantity})`))),
    target('warehouse.stock_levels', any([inList('r.product_id', products), inList('r.location_id', locations), inList('r.bin_id', bins)]),
      any(m.cases.map(c => `(r.product_id = '${c.productId}' and r.location_id = '${c.locationId}' and r.bin_id = '${c.binId}'
        and r.lot_id is null and r.quantity between 0 and ${c.openingQuantity})`))),
    target('warehouse.storage_areas', any([inList('r.id', bins), inList('r.location_id', locations)]),
      any(m.cases.map(c => `(r.id = '${c.binId}' and r.location_id = '${c.locationId}' and r.code = '${c.binCode}' and r.zone = 'WMS-SIGNOFF')`))),
    target('warehouse.locations', inList('r.id', locations),
      any(m.cases.map(c => `(r.id = '${c.locationId}' and r.name = ${literal(c.productName)} and r.type = 'warehouse')`))),
    target('warehouse.products', any([inList('r.id', products), `r.attributes->>'signoffRun' = '${m.runId}'`]),
      any(m.cases.map(c => `(r.id = '${c.productId}' and r.sku = '${c.sku}' and r.attributes->>'signoffRun' = '${m.runId}' and r.attributes->'synthetic' = 'true'::jsonb)`))),
  ];
  return { targets, products, locations, bins, orders, requests, entities, commandScope };
}

function evidenceCte(m, scope) {
  const ownedOrders = inList('r.id::text', scope.orders);
  const ownedMovements = scope.targets.find(t => t.entity === 'warehouse.movements').candidates;
  const knownPrefix = any(storagePrefixes(m).map(start => prefix('storage_path', start)));
  return `with recursive evidence_source(entity, document) as (
    select 'order:' || r.id::text, to_jsonb(r) from warehouse.fulfillment_orders r where ${ownedOrders}
    union all select 'command:' || r.id::text, r.response from warehouse.command_log r where ${scope.commandScope}
    union all select 'movement:' || r.id::text, to_jsonb(r) from warehouse.movements r where ${ownedMovements}
  ), evidence_tree(entity, value, is_evidence) as (
    select entity, document, false from evidence_source
    union all
    select t.entity, child.value, t.is_evidence or child.key ~* 'evidence'
    from evidence_tree t cross join lateral (
      select key,value from jsonb_each(case when jsonb_typeof(t.value) = 'object' then t.value else '{}'::jsonb end)
      union all select '',value from jsonb_array_elements(case when jsonb_typeof(t.value) = 'array' then t.value else '[]'::jsonb end)
    ) child
  ), evidence_values as (
    select distinct entity, value #>> '{}' as value from evidence_tree
    where is_evidence and jsonb_typeof(value) = 'string' and value #>> '{}' <> ''
  ), evidence_paths as (
    select *, case when left(value,9) = 'evidence/' then substring(value from 10) else value end as storage_path from evidence_values
  ), evidence as (
    select *, case
      when value ~* '^data:image/(png|jpe?g|gif|webp);base64,[a-z0-9+/=[:space:]]+$' then 'inline-data'
      when ${any(scope.orders.map(id => prefix('value', `intra://handover/${id}/`)))} then 'internal-reference'
      when ${knownPrefix} and storage_path ~ '^[A-Za-z0-9._/-]+$' and storage_path !~ '(^|/)\\.\\.?(/|$)' and storage_path !~ '//' then 'storage'
      else 'unhandled' end as kind
    from evidence_paths
  )`;
}

function storageWhere(m) {
  return `(r.bucket_id = 'evidence' and ${any(storagePrefixes(m).map(start => prefix('r.name', start)))})`;
}

function evidenceRegistrations(scope) {
  // These tables are intentionally not deletion targets. An independent evidence
  // cleanup must handle any matching registration before business rows disappear.
  return `select 'core.documents' as entity, r.id::text as id, r.storage_path from core.documents r
    where ${inList('r.entity_id::text', scope.entities)}
    union all select 'private.action_evidence', r.id::text, r.storage_path from private.action_evidence r
    where ${inList('r.source_id::text', scope.entities)}`;
}

function fkGuard(scope, fail) {
  const definitions = literal(JSON.stringify(scope.targets.map((target, rank) => ({ ...target, rank }))));
  return `do $wms_fk_guard$
declare targets jsonb := ${definitions}::jsonb; parent jsonb; child jsonb; fk record;
  join_sql text; child_exclusion text; n bigint;
begin
  for parent in select value from jsonb_array_elements(targets) loop
    for fk in select * from pg_catalog.pg_constraint where contype = 'f' and confrelid = (parent->>'entity')::regclass loop
      select string_agg(format('c.%I = p.%I', ca.attname, pa.attname), ' and ' order by k.ordinality)
      into join_sql from unnest(fk.conkey, fk.confkey) with ordinality k(child_num,parent_num,ordinality)
      join pg_catalog.pg_attribute ca on ca.attrelid = fk.conrelid and ca.attnum = k.child_num
      join pg_catalog.pg_attribute pa on pa.attrelid = fk.confrelid and pa.attnum = k.parent_num;
      select value into child from jsonb_array_elements(targets)
        where (value->>'entity')::regclass = fk.conrelid and (value->>'rank')::int < (parent->>'rank')::int;
      child_exclusion := 'false';
      if child is not null then
        child_exclusion := format('exists(select 1 from %s r where r.id::text = c.id::text and (%s))', fk.conrelid::regclass, child->>'proof');
      end if;
      execute format('select count(*) from %s c join (select * from %s r where %s) p on %s where not (%s)',
        fk.conrelid::regclass, fk.confrelid::regclass, parent->>'candidates', join_sql, child_exclusion) into n;
      if n > 0 then raise ${fail ? 'exception' : 'warning'} 'Unhandled FK branch % on % -> %: % row(s); no cascade or nulling is authorized',
        fk.conname, fk.conrelid::regclass, fk.confrelid::regclass, n; end if;
    end loop;
  end loop;
end;
$wms_fk_guard$;`;
}

function cleanupGuards(m, scope, verification) {
  const definitions = literal(JSON.stringify(scope.targets));
  const proofs = m.cases.map(c => `if not exists (select 1 from warehouse.products where id = '${c.productId}' and attributes->>'signoffRun' = '${m.runId}') then
    raise exception 'Missing full-UUID product ownership proof: ${c.productId}'; end if;`).join('\n  ');
  const tableOids = scope.targets.map(t => `${literal(t.entity)}::regclass`).join(',');
  const storageVerified = verification?.objects.map(object => object.path) ?? [];
  const verificationPredicate = storageVerified.length ? inList('storage_path', storageVerified) : 'false';
  const looseRefs = Object.entries({ product_id: scope.products, warehouse_product_id: scope.products,
    location_id: scope.locations, source_location_id: scope.locations, from_location_id: scope.locations, to_location_id: scope.locations,
    bin_id: scope.bins, source_bin_id: scope.bins, from_bin_id: scope.bins, to_bin_id: scope.bins,
    order_id: scope.orders, fulfillment_order_id: scope.orders, source_order_id: scope.orders, replacement_order_id: scope.orders,
    request_id: scope.requests }).map(([column, ids]) => ({ column, ids }));
  return `do $wms_scope_guard$
declare t jsonb; n bigint;
begin
  ${proofs}
  for t in select value from jsonb_array_elements(${definitions}::jsonb) loop
    execute format('select count(*) from %s r where (%s) and (%s) is not true',
      (t->>'entity')::regclass, t->>'candidates', t->>'proof') into n;
    if n <> 0 then raise exception 'Out-of-scope ownership/lineage in %: % row(s)', t->>'entity', n; end if;
    -- Row locks also prevent a new FK child from acquiring a key-share lock.
    execute format('select 1 from %s r where %s for update', (t->>'entity')::regclass, t->>'candidates');
  end loop;
  if exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid in (${tableOids})
    and not t.tgisinternal and (t.tgtype::int & 8) <> 0
    and not (t.tgrelid = 'warehouse.locations'::regclass and t.tgname = 'trg_prevent_location_delete_with_stock'
      and md5(pg_get_functiondef(t.tgfoid)) = 'd82111a319452f784dac63603dd62bec')) then
    raise exception 'Unreviewed DELETE trigger; cleanup refused';
  end if;
  if exists (select 1 from pg_catalog.pg_rewrite where ev_class in (${tableOids}) and ev_type = '4') then
    raise exception 'Unreviewed DELETE rule; cleanup refused';
  end if;
end;
$wms_scope_guard$;
${fkGuard(scope, true)}
do $wms_loose_reference_guard$
declare ref jsonb; col record; n bigint;
begin
  for ref in select value from jsonb_array_elements(${literal(JSON.stringify(looseRefs))}::jsonb) loop
    for col in select c.oid, a.attname from pg_catalog.pg_class c
      join pg_catalog.pg_namespace ns on ns.oid = c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where ns.nspname in ('warehouse','procurement','product') and c.relkind in ('r','p')
      and c.oid not in (${tableOids}) and a.attname = ref->>'column' loop
      execute format('select count(*) from %s where %I::text in (select jsonb_array_elements_text($1))', col.oid::regclass, col.attname)
        into n using ref->'ids';
      if n > 0 then raise exception 'Unhandled logical reference %.%: % row(s)', col.oid::regclass, col.attname, n; end if;
    end loop;
  end loop;
end;
$wms_loose_reference_guard$;
do $wms_evidence_guard$
declare n bigint;
begin
  select count(*) into n from storage.objects r where ${storageWhere(m)};
  if n <> 0 then raise exception 'Separate storage cleanup required: % run-scoped object(s) still exist, including possible orphan uploads', n; end if;
  select count(*) into n from (${evidenceRegistrations(scope)}) registered;
  if n <> 0 then raise exception 'Unhandled evidence registrations require separately reviewed cleanup: %', n; end if;
  ${evidenceCte(m, scope)} select count(*) into n from evidence where kind = 'unhandled';
  if n <> 0 then raise exception 'Unhandled evidence URL/path; preserve readback and review before cleanup'; end if;
  ${evidenceCte(m, scope)} select count(*) into n from evidence where kind = 'storage' and not (${verificationPredicate});
  if n <> 0 then raise exception 'Persisted evidence requires separately verified storage cleanup receipt for each exact path'; end if;
end;
$wms_evidence_guard$;`;
}

function countQuery(m, scope, verification, includeRows) {
  const counts = scope.targets.map(t => `select '${t.entity}' as entity, count(*)::bigint as remaining from ${t.entity} r where ${t.candidates}`).join('\n    union all ');
  const rows = includeRows ? `,
    'rows', jsonb_build_object(${scope.targets.map(t => {
      const projection = t.entity === 'warehouse.command_log'
        ? `to_jsonb(r) - 'response' || jsonb_build_object('response_id',r.response->>'id')`
        : t.entity === 'warehouse.fulfillment_orders'
          ? `to_jsonb(r) - 'acknowledgement_evidence_url' - 'handover_evidence_url' - 'proof_of_delivery_evidence_url'`
          : 'to_jsonb(r)';
      return `${literal(t.entity)}, (select coalesce(jsonb_agg(${projection} order by r.id), '[]'::jsonb) from ${t.entity} r where ${t.candidates})`;
    }).join(',\n      ')})` : '';
  return `${evidenceCte(m, scope)}, counts as (${counts})
select jsonb_build_object(
    'runId', '${m.runId}', 'project', '${m.project}', 'manifestCommit', '${m.commit}',
    'counts', (select jsonb_object_agg(entity, remaining) from counts),
    'databaseRowsRemaining', (select sum(remaining) from counts),
    'evidence', (select coalesce(jsonb_agg(jsonb_build_object('entity',entity,'kind',kind,
      'value',case when kind = 'inline-data' then '[inline image omitted]' else value end)), '[]'::jsonb) from evidence),
    'storageObjects', (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'bucket',r.bucket_id,'path',r.name)), '[]'::jsonb)
      from storage.objects r where ${storageWhere(m)}),
    'storageObjectsRemaining', (select count(*) from storage.objects r where ${storageWhere(m)}),
    'unhandledEvidenceRegistrations', (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from (${evidenceRegistrations(scope)}) e),
    'separateStorageVerification', ${literal(JSON.stringify(verification))}::jsonb,
    'allResidueVerified', false,
    'limitation', 'Counts cover only manifest-owned database rows and known evidence paths. Separate storage/API verification and review of unknown or non-FK JSON references remain required; this is not global zero-residue certification.'${rows}
) as report;`;
}

export function generateDepartmentCleanup(input, { storageVerification } = {}) {
  const m = validateManifest(input);
  const verification = validateStorageVerification(storageVerification, m);
  const scope = buildScope(m);
  const header = `-- OFFLINE GENERATED: UAT ${m.project} (${m.origin}) ONLY.
-- Run ${m.runId}; manifest commit ${m.commit}.
-- Stop run activity; independently verify connection and archive pre-cleanup readback.
-- Never disable governance triggers or bypass a guard to make cleanup pass.
-- Storage API deletion is NOT performed here. Preserve separate verification receipts.
-- Execute each file as a whole transaction with stop-on-error; failure requires ROLLBACK.
`;
  const deletes = scope.targets.map(t => `delete from ${t.entity} r where ${t.proof};`).join('\n');
  const emptyCheck = scope.targets.map(t => `if exists (select 1 from ${t.entity} r where ${t.candidates}) then
    raise exception 'Post-delete residue in ${t.entity}; transaction rolled back'; end if;`).join('\n  ');
  return {
    readbackSql: `${header}begin read only;\nset local row_security = off;\n${fkGuard(scope, false)}\n${countQuery(m, scope, verification, true)}\ncommit;\n`,
    cleanupSql: `${header}begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
set local row_security = off;
-- Fail on RLS filtering instead of silently hiding dependencies. This does not grant privileges.
lock table ${scope.targets.map(t => t.entity).join(', ')} in share row exclusive mode;
lock table core.documents, private.action_evidence in share mode;
${cleanupGuards(m, scope, verification)}
${deletes}
do $wms_post_guard$ begin
  ${emptyCheck}
end; $wms_post_guard$;
${countQuery(m, scope, verification, false)}
commit;
`,
    postcleanupSql: `${header}begin read only;\nset local row_security = off;\n${countQuery(m, scope, verification, false)}\ncommit;\n`,
  };
}

export async function writeDepartmentCleanup(manifestPath, options = {}) {
  const resolved = path.resolve(manifestPath);
  const m = JSON.parse(await readFile(resolved, 'utf8'));
  const scripts = generateDepartmentCleanup(m, options);
  const files = [
    ['pre-cleanup-readback.sql', scripts.readbackSql],
    ['cleanup.sql', scripts.cleanupSql],
    ['postcleanup.sql', scripts.postcleanupSql],
  ].map(([name, sql]) => ({ file: path.join(path.dirname(resolved), name), sql }));
  for (const { file } of files) {
    let exists = true;
    try { await access(file); } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
    assert(!exists, `Output already exists; refusing to overwrite ${file}`);
  }
  for (const { file, sql } of files) await writeFile(file, sql, { flag: 'wx' });
  return files.map(({ file }) => file);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifestPath, verificationPath, ...extra] = process.argv.slice(2);
  assert(manifestPath && extra.length === 0, 'Usage: node scripts/qa/wms-department-cleanup.mjs manifest.json [storage-verification.json]');
  const storageVerification = verificationPath ? JSON.parse(await readFile(verificationPath, 'utf8')) : undefined;
  const files = await writeDepartmentCleanup(manifestPath, { storageVerification });
  console.log(JSON.stringify({ generated: files, executedLiveSql: false }, null, 2));
}
