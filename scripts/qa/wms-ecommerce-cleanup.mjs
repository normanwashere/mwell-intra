import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from './wms-ecommerce-signoff-live.mjs';

// Offline only. No database client, environment credentials or Storage executor.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
// Reviewed against UAT pg_namespace/pg_class on 2026-09-13. Module names are
// not necessarily schemas: finance rows are in core; events also live in public.
const BUSINESS_SCHEMAS = ['core', 'learning', 'legal', 'private', 'procurement', 'product', 'public', 'warehouse'];
const MANDATORY_SCHEMAS = ['core', 'private', 'public', 'storage', 'warehouse'];
const INFRA_RELATIONS = {
  auth: ['audit_log_entries','custom_oauth_providers','flow_state','identities','instances','mfa_amr_claims','mfa_challenges','mfa_factors',
    'oauth_authorizations','oauth_client_states','oauth_clients','oauth_consents','one_time_tokens','refresh_tokens','saml_providers','saml_relay_states',
    'schema_migrations','sessions','sso_domains','sso_providers','users','webauthn_challenges','webauthn_credentials'],
  extensions: [], graphql: [], graphql_public: [], pgbouncer: [],
  realtime: ['messages','schema_migrations','subscription'], supabase_migrations: ['schema_migrations'], vault: ['secrets'],
  storage: ['buckets','buckets_analytics','buckets_vectors','migrations','objects','s3_multipart_uploads','s3_multipart_uploads_parts','vector_indexes'],
};
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const j = value => `${q(JSON.stringify(value))}::jsonb`;
const oneOf = (column, values) => values.length ? `${column} in (${values.map(q).join(',')})` : 'false';
const any = values => values.length ? `(${values.join(' or ')})` : 'false';
const prefix = (column, value) => `left(${column},${value.length})=${q(value)}`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isUuid = value => typeof value === 'string' && UUID.test(value);
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value));

const schemaPolicy = () => structuredClone({ version: 1, mandatorySchemas: MANDATORY_SCHEMAS, reviewedBusinessSchemas: BUSINESS_SCHEMAS,
  reviewedInfrastructureRelations: INFRA_RELATIONS, scannedRelationKinds: ['r','p','m'], rejectedRelationKinds: ['f'],
  systemSchemaExclusions: ['pg_*','information_schema'], unknownSchemas: 'fail-closed', storage: 'separate exact-object checks; never SQL deletion' });
const nonSystemSchema = column => `(${column} !~ '^pg_' and ${column}<>'information_schema')`;
const businessSchema = column => `(${nonSystemSchema(column)} and not (${oneOf(column, Object.keys(INFRA_RELATIONS))}))`;
function schemaCoverageGuard(severity) {
  return `do $ecom_schema_coverage$ declare ns record; rel record; allowed jsonb:=${j(INFRA_RELATIONS)}; begin
 if (select count(*) from pg_namespace where ${oneOf('nspname', MANDATORY_SCHEMAS)})<>${MANDATORY_SCHEMAS.length}
 then raise ${severity} 'Incomplete mandatory application schema coverage'; end if;
 for ns in select nspname from pg_namespace where ${nonSystemSchema('nspname')} loop
  if not (${oneOf('ns.nspname', [...BUSINESS_SCHEMAS, ...Object.keys(INFRA_RELATIONS)])}) then
   raise ${severity} 'Unreviewed application schema %; explicit classification required',ns.nspname;
  end if;
 end loop;
 for rel in select n.nspname,c.relname,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where ${nonSystemSchema('n.nspname')} and c.relkind in ('r','p','m','f') loop
  if allowed ? rel.nspname then
   if not ((allowed->rel.nspname) ? rel.relname) or rel.relkind<>(case when rel.nspname='realtime' and rel.relname='messages' then 'p' else 'r' end) then
    raise ${severity} 'Unreviewed infrastructure relation %.% (%); explicit classification required',rel.nspname,rel.relname,rel.relkind;
   end if;
  elsif rel.relkind='f' then
   raise ${severity} 'Unreviewed foreign relation %.%; remote coverage cannot be assumed',rel.nspname,rel.relname;
  end if;
 end loop;
end; $ecom_schema_coverage$;`;
}
function schemaInventorySql() {
  return `(select coalesce(jsonb_agg(jsonb_build_object('schema',ns.nspname,
 'classification',case when ns.nspname='storage' then 'storage' when ${oneOf('ns.nspname', Object.keys(INFRA_RELATIONS))} then 'infrastructure'
 when ${oneOf('ns.nspname', BUSINESS_SCHEMAS)} then 'business' else 'unreviewed' end,
 'relations',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind) order by c.relname),'[]'::jsonb)
 from pg_class c where c.relnamespace=ns.oid and c.relkind in ('r','p','m','f'))) order by ns.nspname),'[]'::jsonb)
 from pg_namespace ns where ${nonSystemSchema('ns.nspname')})`;
}

export function validateEcommerceSchemaCoverage(receipt) {
  assert.deepEqual(receipt.schemaPolicy, schemaPolicy(), 'Schema classification policy mismatch');
  const inventory = receipt.schemaInventory; assert(Array.isArray(inventory), 'Complete discovered schema inventory required');
  const names = inventory.map(ns => ns.schema);
  assert.equal(new Set(names).size, names.length, 'Duplicate schema inventory');
  for (const mandatory of MANDATORY_SCHEMAS) assert(names.includes(mandatory), 'Incomplete mandatory schema inventory');
  const scanned = []; const relations = [];
  for (const ns of inventory) {
    const classification = ns.schema === 'storage' ? 'storage' : Object.hasOwn(INFRA_RELATIONS, ns.schema) ? 'infrastructure'
      : BUSINESS_SCHEMAS.includes(ns.schema) ? 'business' : null;
    assert(classification && ns.classification === classification, 'Unreviewed schema/classification');
    assert(Array.isArray(ns.relations) && new Set(ns.relations.map(r => r.name)).size === ns.relations.length, 'Incomplete/duplicate relation inventory');
    if (classification === 'business') scanned.push(ns.schema);
    for (const r of ns.relations) {
      assert(typeof r.name === 'string' && r.name.length > 0, 'Invalid relation name');
      if (classification === 'business') {
        assert(['r','p','m'].includes(r.kind), 'Unreviewed foreign relation coverage'); relations.push(`${ns.schema}.${r.name}`);
      } else assert(INFRA_RELATIONS[ns.schema].includes(r.name)
        && r.kind === (ns.schema === 'realtime' && r.name === 'messages' ? 'p' : 'r'), 'Unreviewed infrastructure relation');
    }
  }
  assert.deepEqual([...receipt.scannedSchemas].sort(), scanned.sort(), 'Incomplete discovered business schema scan');
  assert.deepEqual([...receipt.scannedRelations].sort(), relations.sort(), 'Incomplete discovered business relation scan');
}

function validateBindings(m, bindings) {
  assert(Array.isArray(bindings) && bindings.length <= m.cases.length, 'Explicit ecommerce bindings array required');
  const seen = new Set([m.runId]);
  return bindings.map(b => {
    const c = m.cases.find(c => c.viewport === b.view);
    assert(c && isUuid(b.orderId) && b.reference === c.reference && b.productId === c.productId, 'Invalid or foreign ecommerce binding');
    assert(!seen.has(b.view) && !seen.has(b.orderId), 'Duplicate ecommerce binding');
    seen.add(b.view); seen.add(b.orderId);
    return { ...c, orderId: b.orderId };
  });
}

function storagePrefixes(bound) {
  return bound.flatMap(c => [`delivery-${c.orderId}/`, `fulfillment/${c.orderId}/`, `acknowledgment-${c.orderId}/`]);
}

// This is an external operational attestation, not a database-enforced writer fence.
function validateIsolation(m, bound, receipt) {
  if (receipt === undefined) return null;
  assert(receipt?.version === 1 && receipt.kind === 'wms-ecommerce-cleanup-isolation', 'Separate scoped isolation receipt required');
  for (const key of ['runId', 'project', 'commit']) assert.equal(receipt[key], m[key], `Isolation receipt ${key} scope mismatch`);
  assert.deepEqual(receipt.orderIds, bound.map(c => c.orderId), 'Isolation receipt order bindings mismatch');
  for (const key of ['scopeWritersStopped', 'inFlightWorkDrained', 'schemaChangesPaused', 'holdThroughPostcleanup']) {
    assert.equal(receipt[key], true, `Isolation receipt requires ${key}`);
  }
  assert(timestamp(receipt.verifiedAt), 'Isolation verification timestamp required');
  assert(typeof receipt.evidenceRef === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(receipt.evidenceRef), 'Invalid isolation evidence reference');
  return structuredClone(receipt);
}

function validStoragePrincipal(record, project) {
  if (record?.principal === undefined) return isUuid(record?.actorId);
  if (Object.hasOwn(record, 'actorId')) return false;
  try {
    assert.deepEqual(record.principal, { kind: 'service_role', project, credentialSource: 'authenticated-supabase-cli' });
    return true;
  } catch { return false; }
}

export function isVerifiedStorageAbsence(record) {
  return (record?.httpStatus === 404 && ['NoSuchKey', 'not_found'].includes(record.storageErrorCode))
    || (record?.httpStatus === 400 && record.storageErrorCode === 'NoSuchKey'
      && (record.storageStatusCode === '404' || record.storageStatusCode === 404));
}

function validateReceipt(m, bound, receipt, fixtures) {
  if (receipt === undefined) return null;
  assert([1, 2].includes(receipt?.version) && receipt.kind === 'wms-ecommerce-storage-cleanup', 'Separate ecommerce Storage cleanup receipt required');
  for (const key of ['runId', 'project', 'commit']) assert.equal(receipt[key], m[key], `Storage receipt ${key} scope mismatch`);
  for (const key of ['runStopped', 'bindingsComplete', 'inventoryComplete']) assert.equal(receipt[key], true, `Storage receipt requires ${key}`);
  assert(typeof receipt.evidenceRef === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(receipt.evidenceRef), 'Invalid receipt evidence reference');
  const inventory = receipt.inventory;
  assert(inventory?.source === 'authenticated-storage-list' && validStoragePrincipal(inventory, m.project) && timestamp(inventory.verifiedAt), 'Authenticated Storage inventory receipt required');
  assert.deepEqual(inventory.remainingPaths, [], 'Storage inventory is not empty');
  assert.deepEqual(inventory.prefixes, storagePrefixes(bound), 'Complete exact order-prefix Storage inventory required');
  assert(Array.isArray(receipt.objects), 'Storage object receipts required');
  const seen = new Set();
  for (const object of receipt.objects) {
    const c = bound.find(c => c.viewport === object.view && c.orderId === object.orderId);
    const parts = typeof object.path === 'string' ? object.path.split('/') : [];
    assert(c && object.bucket === 'evidence' && parts.length === 3 && parts[0] === `delivery-${c.orderId}` && parts[1] === '0'
      && parts[2].endsWith('.png') && isUuid(parts[2].slice(0, -4)), 'Foreign or unreviewed Storage object path');
    assert(!seen.has(object.path), 'Duplicate Storage object receipt'); seen.add(object.path);
    assert.equal(object.status, 'deleted-and-verified', 'A live POD verification is not a deletion receipt');
    const bytes = fixtures?.[c.viewport];
    assert(bytes instanceof Uint8Array && bytes.byteLength > 0, 'Actual local synthetic fixture bytes required');
    assert.deepEqual(object.fixture, { ref: `${c.viewport}-synthetic-pod.png`, sha256: sha256(bytes), byteLength: bytes.byteLength }, 'Fixture hash mismatch');
    assert(Array.isArray(object.downloads) && object.downloads.length === 2, 'Two authenticated hash-verified Storage downloads required');
    const actors = new Set();
    for (const d of object.downloads) {
      assert(d.source === 'authenticated-storage-download' && isUuid(d.actorId) && d.principal === undefined && timestamp(d.verifiedAt), 'Real user authenticated download evidence required');
      assert(!actors.has(d.actorId), 'Independent download actors required'); actors.add(d.actorId);
      assert.equal(d.sha256, object.fixture.sha256, 'Downloaded Storage hash mismatch');
      assert.equal(d.byteLength, bytes.byteLength, 'Downloaded Storage size mismatch');
    }
    const deletion = object.deletion; const absence = object.absence;
    assert(deletion?.source === 'authenticated-storage-remove' && validStoragePrincipal(deletion, m.project) && timestamp(deletion.deletedAt)
      && Number.isInteger(deletion.httpStatus) && deletion.httpStatus >= 200 && deletion.httpStatus < 300, 'Successful separate authenticated Storage removal required');
    assert(absence?.source === 'authenticated-storage-download' && validStoragePrincipal(absence, m.project)
      && (receipt.version === 2 ? isVerifiedStorageAbsence(absence) : absence.httpStatus === 404) && timestamp(absence.verifiedAt),
      'Authenticated post-delete not-found verification required; access denial is not absence');
    for (const d of object.downloads) assert(Date.parse(d.verifiedAt) <= Date.parse(deletion.deletedAt), 'Hash verification must precede deletion');
    assert(Date.parse(deletion.deletedAt) <= Date.parse(absence.verifiedAt) && Date.parse(absence.verifiedAt) <= Date.parse(inventory.verifiedAt), 'Storage receipt chronology invalid');
  }
  const administrative = inventory.principal || receipt.objects.some(o => o.deletion.principal || o.absence.principal);
  if (administrative || receipt.version === 2) {
    assert.equal(receipt.version, 2, 'Administrative operations require version 2 receipt');
    const db = receipt.databaseVerification;
    assert(db?.source === 'independent-readonly-sql' && timestamp(db.verifiedAt), 'Independent subsequent DB verification required');
    for (const key of ['runId', 'project', 'commit']) assert.equal(db[key], m[key], `DB verification ${key} mismatch`);
    assert(Date.parse(db.verifiedAt) >= Date.parse(inventory.verifiedAt), 'DB verification must be subsequent to API verification');
    assert.deepEqual(db.remainingObjects, [], 'DB Storage absence not verified');
    assert.deepEqual(db.expectedPaths, receipt.objects.map(o => o.path), 'DB verification paths mismatch');
    assert(/^[a-f0-9]{64}$/.test(db.apiReceiptSha256), 'API receipt digest required');
    assert(typeof db.evidenceRef === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(db.evidenceRef), 'Invalid DB evidence reference');
  }
  return structuredClone(receipt);
}

function lineProof(column, c) {
  return `(jsonb_typeof(${column})='array' and jsonb_array_length(${column})=1
    and ${column}->0->>'productId'=${q(c.productId)} and ${column}->0->'quantity'='${c.requestedQuantity}'::jsonb
    and ((${column}->0) - array['productId','quantity','pickedQuantity','pickedSerialNumbers','pickBinId','unitPrice','discountAmount'])='{}'::jsonb
    and (${column}->0->>'pickBinId' is null or ${column}->0->>'pickBinId'=${q(c.binId)})
    and coalesce(${column}->0->'pickedSerialNumbers','[]'::jsonb)='[]'::jsonb
    and coalesce(jsonb_typeof(${column}->0->'unitPrice'),'null') in ('number','null')
    and coalesce(jsonb_typeof(${column}->0->'discountAmount'),'null') in ('number','null')
    and (${column}->0->>'pickedQuantity' is null or ${column}->0->'pickedQuantity' in ('0'::jsonb,'${c.requestedQuantity}'::jsonb)))`;
}

function eventProof(column) {
  return `(jsonb_typeof(${column})='array' and not exists(
    select 1 from jsonb_array_elements(${column}) e where jsonb_typeof(e)<>'object'
      or (e-array['status','occurredAt','actor','reference','reason','evidenceUrl'])<>'{}'::jsonb
      or exists(select 1 from jsonb_each(e) v where jsonb_typeof(v.value) in ('array','object'))))`;
}

function scopeFor(m, bound) {
  const products = m.cases.map(c => c.productId); const locations = m.cases.map(c => c.locationId); const bins = m.cases.map(c => c.binId);
  const orders = bound.map(c => c.orderId); const references = m.cases.map(c => c.reference);
  const entities = [...products, ...locations, ...bins, ...orders];
  const tokens = [...entities, ...references, m.runId];
  const jsonProduct = column => any(products.map(id => `${column} @> ${j([{ productId: id }])}`));
  const entityProof = any([['fulfillment_order', orders], ['product', products], ['location', locations], ['storage_area', bins]]
    .map(([type, ids]) => `(r.entity_type=${q(type)} and ${oneOf('r.entity_id::text', ids)})`));
  const commandCandidate = any([oneOf("r.response->>'id'", orders), ...m.cases.map(c => prefix('r.idempotency_key', `${m.runId}-${c.viewport}-`))]);
  const commandProof = any(bound.map(c => `((r.response->>'id'=${q(c.orderId)} or ${prefix('r.idempotency_key', `${m.runId}-${c.viewport}-`)})
    and (r.response->>'id' is null or r.response->>'id'=${q(c.orderId)})
    and (r.response->>'source' is null or r.response->>'source'='ecommerce')
    and (r.response->>'external_reference' is null or r.response->>'external_reference'=${q(c.reference)})
    and (r.response->>'source_location_id' is null or r.response->>'source_location_id'=${q(c.locationId)})
    and (r.response->>'source_bin_id' is null or r.response->>'source_bin_id'=${q(c.binId)})
    and r.response->>'parent_order_id' is null and r.response->>'event_id' is null and r.response->>'third_party_location_id' is null
    and (r.response->'lines' is null or ${lineProof("r.response->'lines'", c)})
    and coalesce(r.response->'packaging','[]'::jsonb)='[]'::jsonb
    and (r.response->'delivery_address' is null or r.response->'delivery_address'=${j(c.address)}
      or (r.command_name='create_fulfillment_order' and r.response->>'status'='received'
        and r.response->>'id'=${q(c.orderId)} and r.response->>'source'='ecommerce'
        and r.response->>'external_reference'=${q(c.reference)} and r.response->>'source_location_id'=${q(c.locationId)}
        and jsonb_typeof(r.response->'lines')='array' and r.response->'delivery_address'='null'::jsonb))
    and (r.response->'shipment_events' is null or ${eventProof("r.response->'shipment_events'")})
    and not exists(select 1 from jsonb_each(r.response) v where v.key not in ('lines','packaging','delivery_address','shipment_events')
      and jsonb_typeof(v.value) in ('array','object'))
    and (r.response is null or (jsonb_typeof(r.response)='object' and
      (r.response-array(select attname::text from pg_attribute where attrelid='warehouse.fulfillment_orders'::regclass and attnum>0 and not attisdropped))='{}'::jsonb)))`));
  const target = (entity, candidates, proof) => ({ entity, candidates, proof });
  const targets = [
    target('core.notifications', oneOf('r.entity_id::text', entities), entityProof),
    target('core.activity_log', oneOf('r.entity_id::text', entities), `(r.module='warehouse' and ${entityProof}
      and (r.detail is null or (jsonb_typeof(r.detail)='object' and (r.detail-array['source','external_reference','status','shipment_status','tracking_reference','failure_reason'])='{}'::jsonb
      and not exists(select 1 from jsonb_each(r.detail) d where jsonb_typeof(d.value) in ('array','object')))))`),
    target('warehouse.command_log', commandCandidate, `(${commandProof} and r.command_name in ('create_fulfillment_order','advance_fulfillment_order','advance_fulfillment_order_v2','advance_fulfillment_order_v3','update_shipment_tracking'))`),
    target('warehouse.fulfillment_reservations', any([oneOf('r.order_id::text', orders), oneOf('r.product_id', products), oneOf('r.location_id', locations), oneOf('r.bin_id', bins)]),
      any(bound.map(c => `(r.order_id='${c.orderId}'::uuid and r.product_id=${q(c.productId)} and r.quantity=${c.requestedQuantity}
        and (r.location_id is null or r.location_id=${q(c.locationId)}) and (r.bin_id is null or r.bin_id=${q(c.binId)}) and r.status in ('active','released'))`))),
    target('warehouse.fulfillment_orders', any([oneOf('r.id::text', orders), oneOf('r.external_reference', references), oneOf('r.source_location_id', locations), oneOf('r.source_bin_id', bins), jsonProduct('r.lines'), jsonProduct('r.packaging')]),
      any(bound.map(c => `(r.id='${c.orderId}'::uuid and r.source='ecommerce' and r.delivery_method='shipment' and r.external_reference=${q(c.reference)}
        and r.order_notes=${q(c.notes)} and r.source_location_id=${q(c.locationId)} and (r.source_bin_id is null or r.source_bin_id=${q(c.binId)})
        and r.parent_order_id is null and r.event_id is null and r.third_party_location_id is null and ${lineProof('r.lines', c)}
        and r.packaging='[]'::jsonb and r.delivery_address=${j(c.address)} and r.status in ('received','allocated','picking','packing','ready','released','completed')
        and ${eventProof('r.shipment_events')})`))),
    target('warehouse.movements', any([oneOf('r.product_id', products), oneOf('r.reference', orders),
      ...['from_location_id','to_location_id'].map(k => oneOf(`r.${k}`, locations)), ...['from_bin_id','to_bin_id'].map(k => oneOf(`r.${k}`, bins))]),
      any(bound.map(c => `(r.product_id=${q(c.productId)} and r.reference=${q(c.orderId)} and r.type='fulfillment_release' and r.quantity=${c.requestedQuantity}
        and r.from_location_id=${q(c.locationId)} and r.from_bin_id=${q(c.binId)} and r.to_location_id is null and r.to_bin_id is null
        and r.lot_id is null and r.serial_number is null and r.event_id is null and coalesce(r.evidence_urls,'[]'::jsonb)='[]'::jsonb)`))),
    target('warehouse.stock_levels', any([oneOf('r.product_id', products), oneOf('r.location_id', locations), oneOf('r.bin_id', bins)]),
      any(m.cases.map(c => `(r.product_id=${q(c.productId)} and r.location_id=${q(c.locationId)} and r.bin_id=${q(c.binId)} and r.lot_id is null and r.quantity in (${c.openingQuantity},${c.openingQuantity-c.requestedQuantity}))`))),
    target('warehouse.storage_areas', any([oneOf('r.id', bins), oneOf('r.location_id', locations)]),
      any(m.cases.map(c => `(r.id=${q(c.binId)} and r.location_id=${q(c.locationId)} and r.code=${q(c.binCode)} and r.zone='WMS-SIGNOFF')`))),
    target('warehouse.locations', oneOf('r.id', locations), any(m.cases.map(c => `(r.id=${q(c.locationId)} and r.name=${q(c.productName)} and r.type='warehouse')`))),
    target('warehouse.products', any([oneOf('r.id', products), `r.attributes->>'signoffRun'=${q(m.runId)}`]),
      any(m.cases.map(c => `(r.id=${q(c.productId)} and r.sku=${q(c.sku)} and r.name=${q(c.productName)} and r.category='merchandise' and r.item_class='sellable_sku'
        and r.serialized=false and r.attributes=${j({ signoffRun: m.runId, synthetic: true })})`))),
  ];
  return { targets, products, locations, bins, orders, entities, tokens, bound };
}

function evidenceCte(scope) {
  const sources = scope.targets.map(t => `select ${q(t.entity)} as entity,r.id::text as id,to_jsonb(r) as document from ${t.entity} r where ${t.candidates}`).join('\n union all ');
  // FulfillmentPage confirm_pack generates the empty-reference fallback for
  // shipments; SupabaseRepository forwards it and the lifecycle RPC stores it.
  // Recognize only that exact field/order shape, never a URI prefix or POD alias.
  return `with recursive evidence_roots as (${sources}), evidence_tree(entity,id,root,value,is_evidence,field_path) as (
    select entity,id,document,document,false,array[]::text[] from evidence_roots union all
    select t.entity,t.id,t.root,child.value,t.is_evidence or child.key ~* '(evidence|storage.?path)',t.field_path || child.key
    from evidence_tree t cross join lateral (
      select key,value from jsonb_each(case when jsonb_typeof(t.value)='object' then t.value else '{}'::jsonb end)
      union all select '',value from jsonb_array_elements(case when jsonb_typeof(t.value)='array' then t.value else '[]'::jsonb end)
    ) child
  ), evidence_values as (
    select distinct entity,id,root,field_path,value #>> '{}' as path from evidence_tree
    where is_evidence and jsonb_typeof(value)='string' and value #>> '{}'<>''
  ), evidence as (
    select e.entity,e.id,e.field_path,e.path,case
      when e.entity='warehouse.fulfillment_orders' and e.field_path=array['handover_evidence_url']::text[]
        and ${oneOf('e.id', scope.orders)} and e.path='intra://handover/' || e.id || '/'
        and e.root->>'source'='ecommerce' and e.root->>'delivery_method'='shipment'
        and e.root->>'status' in ('ready','released','completed') and e.root->>'handover_reference' is null then 'internal-reference'
      when e.entity='warehouse.command_log' and e.field_path=array['response','handover_evidence_url']::text[]
        and ${oneOf("e.root->'response'->>'id'", scope.orders)}
        and e.path='intra://handover/' || (e.root->'response'->>'id') || '/'
        and e.root->'response'->>'handover_reference' is null
        and exists(select 1 from warehouse.fulfillment_orders o where o.id::text=e.root->'response'->>'id'
          and o.source='ecommerce' and o.delivery_method='shipment' and o.status in ('ready','released','completed')
          and o.handover_reference is null) then 'internal-reference'
      else 'storage-or-unhandled' end as kind from evidence_values e
  )`;
}

function storageWhere(scope) {
  return any(scope.tokens.map(token => `strpos(r.name,${q(token)})>0`));
}

function fkGuard(scope, severity, captured = false) {
  const definitions = scope.targets.map((t, rank) => ({ ...t, rank }));
  return `do $ecom_fk$ declare targets jsonb:=${j(definitions)}; parent jsonb; child jsonb; fk record; joins text; exclusion text; n bigint;
begin
 for parent in select value from jsonb_array_elements(targets) loop
  for fk in select * from pg_constraint where contype='f' and confrelid=(parent->>'entity')::regclass loop
   select string_agg(format('c.%I=p.%I',ca.attname,pa.attname),' and ' order by k.ordinality) into joins
   from unnest(fk.conkey,fk.confkey) with ordinality k(cnum,pnum,ordinality)
   join pg_attribute ca on ca.attrelid=fk.conrelid and ca.attnum=k.cnum join pg_attribute pa on pa.attrelid=fk.confrelid and pa.attnum=k.pnum;
   select value into child from jsonb_array_elements(targets) where (value->>'entity')::regclass=fk.conrelid and (value->>'rank')::int<(parent->>'rank')::int;
   exclusion:='false';
   if child is not null then
    exclusion:=format('exists(select 1 from %s r where r.id::text=c.id::text and (%s))',fk.conrelid::regclass,child->>'proof');
    ${captured ? "exclusion:=format('(%s) and exists(select 1 from pg_temp.wms_ecom_cleanup_rows s where s.entity=%L and s.id=c.id::text)',exclusion,child->>'entity');" : ''}
   end if;
   execute format('select count(*) from %s c join (select * from %s r where %s) p on %s where not (%s)',fk.conrelid::regclass,fk.confrelid::regclass,parent->>'candidates',joins,exclusion) into n;
   if n>0 then raise ${severity} 'Unhandled FK branch % on %: % row(s); no implicit deletion or nulling authorized',fk.conname,fk.conrelid::regclass,n; end if;
  end loop;
 end loop;
end; $ecom_fk$;`;
}

function guards(m, scope, receipt, severity, captured = false, storagePreflight = false) {
  const definitions = j(scope.targets);
  const tables = scope.targets.map(t => `${q(t.entity)}::regclass`).join(',');
  const knownJson = { 'warehouse.products': ['attributes'], 'warehouse.fulfillment_orders': ['lines','packaging','delivery_address','shipment_events'],
    'warehouse.command_log': ['response'], 'warehouse.movements': ['evidence_urls'], 'core.activity_log': ['detail'] };
  return `do $ecom_scope$ declare t jsonb; n bigint; col record; o warehouse.fulfillment_orders; issued boolean; expected integer;
begin
 ${m.cases.map(c => `if not exists(select 1 from warehouse.products where id=${q(c.productId)} and attributes->>'signoffRun'=${q(m.runId)}) then raise ${severity} 'Missing full UUID product ownership proof: ${c.productId}'; end if;`).join('\n ')}
 for t in select value from jsonb_array_elements(${definitions}) loop
  execute format('select count(*) from %s r where (%s) and (%s) is not true',(t->>'entity')::regclass,t->>'candidates',t->>'proof') into n;
  if n>0 then raise ${severity} 'Out-of-scope ownership/lineage in %: % row(s)',t->>'entity',n; end if;
  for col in select attname from pg_attribute where attrelid=(t->>'entity')::regclass and attnum>0 and not attisdropped and atttypid in ('json'::regtype,'jsonb'::regtype) loop
   if not coalesce((${j(knownJson)}->(t->>'entity')) ? col.attname,false) then
    execute format('select count(*) from %s r where (%s) and r.%I is not null and r.%I::jsonb not in (''{}''::jsonb,''[]''::jsonb,''null''::jsonb)',(t->>'entity')::regclass,t->>'candidates',col.attname,col.attname) into n;
    if n>0 then raise ${severity} 'Unhandled JSON column %.%',t->>'entity',col.attname; end if;
   end if;
  end loop;
 end loop;
 ${m.cases.map(c => {
    const b = scope.bound.find(b => b.viewport === c.viewport);
    return `o:=null;
 ${b ? `select * into o from warehouse.fulfillment_orders where id='${b.orderId}'::uuid;` : ''}
 issued:=coalesce(o.status in ('released','completed'),false);
 expected:=case when issued then ${c.openingQuantity-c.requestedQuantity} else ${c.openingQuantity} end;
 if (select count(*) from warehouse.stock_levels where product_id=${q(c.productId)})<>1
   or (select sum(quantity) from warehouse.stock_levels where product_id=${q(c.productId)})<>expected then raise ${severity} 'Stock reconciliation failed: ${c.productId}'; end if;
 if (select count(*) from warehouse.movements where product_id=${q(c.productId)})<>(case when issued then 1 else 0 end) then raise ${severity} 'Movement reconciliation failed: ${c.productId}'; end if;
 expected:=case when o.status in ('allocated','picking','packing','ready','released','completed') then 1 else 0 end;
 if (select count(*) from warehouse.fulfillment_reservations where product_id=${q(c.productId)})<>expected
   or exists(select 1 from warehouse.fulfillment_reservations where product_id=${q(c.productId)} and status<>case when issued then 'released' else 'active' end) then raise ${severity} 'Reservation reconciliation failed: ${c.productId}'; end if;
 if o.status='completed' and (o.proof_of_delivery_reference is distinct from ${q(c.podReference)} or o.proof_of_delivery_evidence_url is null) then raise ${severity} 'Missing completed POD evidence'; end if;`;
  }).join('\n ')}
 if exists(select 1 from pg_trigger t where t.tgrelid in (${tables}) and not t.tgisinternal and (t.tgtype::int & 8)<>0
   and not(t.tgrelid='warehouse.locations'::regclass and t.tgname='trg_prevent_location_delete_with_stock' and md5(pg_get_functiondef(t.tgfoid))='d82111a319452f784dac63603dd62bec')) then raise ${severity} 'Unreviewed DELETE trigger'; end if;
 if exists(select 1 from pg_rewrite where ev_class in (${tables}) and ev_type='4') then raise ${severity} 'Unreviewed DELETE rule'; end if;
end; $ecom_scope$;
${fkGuard(scope, severity, captured)}
${referenceGuards(scope, receipt, severity, true, storagePreflight)}`;
}

function referenceGuards(scope, receipt, severity, excludeOwned = true, storagePreflight = false) {
  const definitions = j(scope.targets);
  const paths = receipt?.objects.map(o => o.path) ?? [];
  return `${schemaCoverageGuard(severity)}
do $ecom_references$ declare rel record; target jsonb; exclusion text; n bigint;
begin
 for rel in select c.oid from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
   where ${businessSchema('ns.nspname')} and c.relkind in ('r','p','m') loop
  select value into target from jsonb_array_elements(${definitions}) where (value->>'entity')::regclass=rel.oid;
  exclusion:=${excludeOwned ? "coalesce(target->>'candidates','false')" : "'false'"};
  -- Serialized JSON substring matching is deliberately conservative: it catches
  -- nested values, object keys and embedded references, at the cost of false positives.
  execute format('select count(*) from %s r where (%s) is not true and exists(select 1 from jsonb_array_elements_text($1) token where strpos(to_jsonb(r)::text,token)>0)',rel.oid::regclass,exclusion) into n using ${j(scope.tokens)};
  if n>0 then raise ${severity} 'Unhandled JSON or scalar reference in %: % row(s)',rel.oid::regclass,n; end if;
 end loop;
end; $ecom_references$;
do $ecom_evidence$ declare n bigint;
begin
 select count(*) into n from storage.objects r where (${storageWhere(scope)})${storagePreflight ? ` and (r.bucket_id='evidence' and ${oneOf('r.name', paths)}) is not true` : ''};
 if n>0 then raise ${severity} '${storagePreflight ? 'Unexpected preflight Storage objects' : 'Unhandled Storage objects remain; separate Storage API cleanup required'}: %',n; end if;
 ${evidenceCte(scope)} select count(*) into n from evidence e where e.kind<>'internal-reference' and not (${oneOf('e.path', paths)});
 if n>0 then raise ${severity} 'Unhandled evidence or missing hash-verified Storage deletion receipt: %',n; end if;
 ${scope.bound.map(c => `if exists(select 1 from warehouse.fulfillment_orders where id='${c.orderId}'::uuid and proof_of_delivery_evidence_url is not null
   and not (${oneOf('proof_of_delivery_evidence_url', receipt?.objects.filter(o => o.orderId === c.orderId).map(o => o.path) ?? [])})) then raise ${severity} 'POD path does not match this order Storage receipt'; end if;`).join('\n ')}
end; $ecom_evidence$;`;
}

export function generateEcommerceStorageReferencePreflight(input, { bindings, objects, isolationReceipt, scopeSha256 } = {}) {
  assert(input?.kind === 'wms-ecommerce-shipment', 'Only ecommerce manifests accepted');
  const m = validateManifest(input); const bound = validateBindings(m, bindings);
  const isolation = validateIsolation(m, bound, isolationReceipt); assert(isolation, 'Scoped isolation required before reference preflight');
  assert(/^[a-f0-9]{64}$/.test(scopeSha256), 'Attempt scope digest required');
  assert.equal(bound.length, m.cases.length, 'Completed bindings required');
  assert.equal(objects?.length, bound.length, 'Exact POD object scope required');
  for (const [i, object] of objects.entries()) {
    const parts = typeof object.path === 'string' ? object.path.split('/') : [];
    assert(object.orderId === bound[i].orderId && object.bucket === 'evidence' && parts.length === 3
      && parts[0] === `delivery-${bound[i].orderId}` && parts[1] === '0' && parts[2].endsWith('.png')
      && isUuid(parts[2].slice(0, -4)), 'Foreign POD reference scope');
  }
  const scope = scopeFor(m, bound);
  scope.tokens = [...new Set([...scope.tokens, ...objects.flatMap(o => [o.path, o.path.split('/').at(-1)])])];
  // This is a live-object allowlist for read-only preflight, NOT a deletion receipt.
  const checks = guards(m, scope, { objects }, 'exception', false, true);
  const context = { version: 1, kind: 'wms-ecommerce-storage-reference-preflight', source: 'independent-readonly-sql',
    runId: m.runId, project: m.project, commit: m.commit, scopeSha256,
    isolationReceiptSha256: sha256(JSON.stringify(isolation)), policySha256: sha256(checks),
    bindings, expectedPaths: objects.map(o => o.path), schemaPolicy: schemaPolicy(),
    referenceChecksPassed: true, foreignReferences: [] };
  return { context, sql: `-- Independently verify the connection is UAT ${m.project} before execution.
-- Expected project is a literal, not connection authentication. Archive this result.
-- Stop/drain all run-scoped writers and pause DDL BEFORE this scan; hold through postcleanup.
-- No global writer locks. Coverage: reviewed app schemas, FK references and literal scalar/JSON tokens;
-- not encoded/remote references. Any error means no valid preflight receipt. Never ignore exceptions.
begin isolation level repeatable read read only;
set local row_security=off;
set local lock_timeout='1s';
set local statement_timeout='60s';
${schemaCoverageGuard('exception')}
${checks}
select ${j(context)} || jsonb_build_object(
 'verifiedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'schemaInventory',${schemaInventorySql()},
 'scannedSchemas',(select coalesce(jsonb_agg(ns.nspname order by ns.nspname),'[]'::jsonb) from pg_namespace ns where ${businessSchema('ns.nspname')}),
 'scannedRelations',(select coalesce(jsonb_agg(ns.nspname || '.' || c.relname order by ns.nspname,c.relname),'[]'::jsonb)
 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ${businessSchema('ns.nspname')} and c.relkind in ('r','p','m')),
 'ownedRows',jsonb_build_object(${scope.targets.map(t => `${q(t.entity)},(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from ${t.entity} r where ${t.candidates})`).join(',')}),
 'storageObjects',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'bucket',r.bucket_id,'path',r.name,
 'created_at',r.created_at,'updated_at',r.updated_at,'size',(r.metadata->>'size')::bigint,'mimetype',r.metadata->>'mimetype') order by r.name),'[]'::jsonb)
 from storage.objects r where ${storageWhere(scope)})) as verification;
commit;
` };
}

function cleanupLimits() {
  return { allResidueVerified: false, scannedApplicationSchemas: 'catalog-discovered business schemas, including public', schemaPolicy: schemaPolicy(), storageDeletion: 'external-only',
    receiptAuthenticity: 'not independently verified offline', unknownBranches: 'fail-closed for visible references; no implicit deletion',
    maintenanceWindowRequired: false, scopedWriterQuiescenceRequired: true, schemaChangesPausedRequired: true,
    lockPolicy: 'ROW EXCLUSIVE on ten delete-target tables; captured candidate rows FOR UPDATE NOWAIT',
    concurrentUnconstrainedReferencesPrevented: false, automaticRetry: false,
    scanLimits: 'Read-committed pre/post scans of discovered business tables/materialized views; unknown schemas and foreign/infrastructure relations require review. No encoded or remote-reference coverage; classified infrastructure content is excluded except exact Storage checks. Scans consume resources and ACCESS SHARE locks can delay DDL.',
    isolationLimits: 'Stop and drain ALL writers for this run, including retries, jobs and Storage uploads, through independent postcleanup. Other runs may continue. No automatic fence against late non-FK/JSON/Storage writes.' };
}

function reportSql(m, scope, receipt, rows, isolation) {
  return `${evidenceCte(scope)}, counts as (
 ${scope.targets.map(t => `select ${q(t.entity)} as entity,count(*)::bigint as remaining from ${t.entity} r where ${t.candidates}`).join('\n union all ')}
)
select jsonb_build_object('runId',${q(m.runId)},'project',${q(m.project)},'manifestCommit',${q(m.commit)},
 'counts',(select jsonb_object_agg(entity,remaining) from counts),'databaseRowsRemaining',(select sum(remaining) from counts),
 'evidence',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from evidence e),
 'storageObjects',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'bucket',r.bucket_id,'path',r.name)),'[]'::jsonb) from storage.objects r where ${storageWhere(scope)}),
 'receiptSha256',${receipt ? q(sha256(JSON.stringify(receipt))) : 'null'},'allResidueVerified',false,
 'isolationReceiptSha256',${isolation ? q(sha256(JSON.stringify(isolation))) : 'null'},
 'limits',${j(cleanupLimits())},'schemaInventory',${schemaInventorySql()}
 ${rows ? `,'rows',jsonb_build_object(${scope.targets.map(t => `${q(t.entity)},(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from ${t.entity} r where ${t.candidates})`).join(',')})` : ''}) as report;`;
}

export function generateEcommerceCleanup(input, { bindings, storageReceipt, fixtures, isolationReceipt } = {}) {
  assert(input?.kind === 'wms-ecommerce-shipment', 'Only ecommerce shipment manifests are accepted; department manifests forbidden');
  const m = validateManifest(input); const bound = validateBindings(m, bindings);
  const receipt = validateReceipt(m, bound, storageReceipt, fixtures); const scope = scopeFor(m, bound);
  const isolation = validateIsolation(m, bound, isolationReceipt);
  const ready = receipt !== null && isolation !== null;
  const header = `-- OFFLINE GENERATED: UAT ${m.project} ONLY. Run ${m.runId}; commit ${m.commit}.
-- Independently verify connection and archive readback. Stop and drain ALL writers for this run (UI, RPC, jobs, retries, Storage).
-- Keep this run quiescent through independent postcleanup; unrelated runs may continue. Pause schema changes during cleanup.
-- Row locks cannot fence unconstrained JSON/scalar references or Storage uploads. SERIALIZABLE/advisory locks do not fix that.
-- Execute as a whole transaction with stop-on-error. Any guard/timeout/permission error requires ROLLBACK, never bypass.
-- Never auto-retry: inspect fresh readback and renew isolation/Storage verification first. Receipts are external attestations.
-- No Storage SQL or identity/role mutations. Unknown branches require separate source review.
`;
  const preamble = `set local row_security=off;\nset local lock_timeout='1s';\nset local statement_timeout='60s';\nset local idle_in_transaction_session_timeout='60s';\n`;
  const blocked = `do $blocked$ begin raise exception '${!receipt ? 'Separate authenticated hash-verified Storage cleanup receipt' : 'Separate scoped writer-drain isolation receipt'} required before database deletion'; end; $blocked$;`;
  // ROW EXCLUSIVE is compatible with ordinary DML, but protects target metadata
  // against conflicting DDL. Parent-first row locks stop normal FK/key-share races.
  const locks = `-- No application-schema-wide writer locks. NOWAIT fails instead of queuing behind busy fixtures/DDL.
${scope.targets.map(t => t.entity).sort().map(entity => `lock table ${entity} in row exclusive mode nowait;`).join('\n')}
create temporary table wms_ecom_cleanup_rows(entity text not null,id text not null,primary key(entity,id)) on commit drop;
${[...scope.targets].reverse().map(t => `with locked as materialized (
 select r.id::text as id from ${t.entity} r where ${t.candidates} order by r.id for update of r nowait
) insert into pg_temp.wms_ecom_cleanup_rows select ${q(t.entity)},id from locked;`).join('\n')}
-- ecom:locked
`;
  const deletes = `do $ecom_delete$ declare n bigint; begin
${scope.targets.map(t => `delete from ${t.entity} r where (${t.proof})
 and exists(select 1 from pg_temp.wms_ecom_cleanup_rows s where s.entity=${q(t.entity)} and s.id=r.id::text);
get diagnostics n = row_count;
if n<>(select count(*) from pg_temp.wms_ecom_cleanup_rows where entity=${q(t.entity)}) then raise exception 'Captured delete set changed in ${t.entity}'; end if;`).join('\n')}
end; $ecom_delete$;`;
  return {
    readyForIndependentExecution: ready,
    limits: cleanupLimits(),
    readbackSql: `${header}begin read only;\n${preamble}${guards(m, scope, receipt, 'warning')}\n${reportSql(m, scope, receipt, true, isolation)}\ncommit;\n`,
    cleanupSql: `${header}begin isolation level read committed;\n${preamble}${ready ? `${locks}\n${guards(m, scope, receipt, 'exception', true)}
-- ecom:verified
${deletes}
-- ecom:deleted
do $ecom_post$ begin
 ${scope.targets.map(t => `if exists(select 1 from ${t.entity} r where ${t.candidates}) then raise exception 'Post-delete residue in ${t.entity}'; end if;`).join('\n ')}
end; $ecom_post$;
${referenceGuards(scope, receipt, 'exception', false)}
${reportSql(m, scope, receipt, false, isolation)}` : blocked}\ncommit;\n`,
    postcleanupSql: `${header}begin read only;\n${preamble}${referenceGuards(scope, receipt, 'warning', false)}\n${reportSql(m, scope, receipt, false, isolation)}\ncommit;\n`,
  };
}

export async function writeEcommerceCleanup(manifestPath, options) {
  const resolved = path.resolve(manifestPath);
  const manifest = JSON.parse(await readFile(resolved, 'utf8'));
  const generated = generateEcommerceCleanup(manifest, options);
  const files = [['pre-cleanup-readback.sql', generated.readbackSql], ['cleanup.sql', generated.cleanupSql], ['postcleanup.sql', generated.postcleanupSql]]
    .map(([name, sql]) => ({ file: path.join(path.dirname(resolved), name), sql }));
  for (const { file } of files) {
    let exists = true;
    try { await access(file); } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
    assert(!exists, `Output already exists; refusing overwrite: ${file}`);
  }
  for (const { file, sql } of files) await writeFile(file, sql, { flag: 'wx' });
  return { files: files.map(f => f.file), readyForIndependentExecution: generated.readyForIndependentExecution, limits: generated.limits };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [manifestPath, contextPath, fixtureDirectory, ...extra] = process.argv.slice(2);
  assert(manifestPath && contextPath && !extra.length, 'Usage: node wms-ecommerce-cleanup.mjs MANIFEST CONTEXT_JSON [FIXTURE_DIRECTORY]');
  const context = JSON.parse(await readFile(contextPath, 'utf8'));
  const fixtures = {};
  if (context.storageReceipt?.objects?.length) {
    assert(fixtureDirectory, 'Actual synthetic fixture directory required for hash verification');
    // Only fixed runner-generated PNG basenames can be read from this directory.
    for (const view of ['desktop1440', 'mobile390']) {
      if (context.storageReceipt.objects.some(o => o.view === view)) fixtures[view] = await readFile(path.join(path.resolve(fixtureDirectory), `${view}-synthetic-pod.png`));
    }
  }
  const result = await writeEcommerceCleanup(manifestPath, { bindings: context.bindings, storageReceipt: context.storageReceipt, isolationReceipt: context.isolationReceipt, fixtures });
  console.log(JSON.stringify({ ...result, executedLiveSql: false }, null, 2));
}
