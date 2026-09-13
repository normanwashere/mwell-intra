import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, open, unlink, realpath, lstat, link } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPersonas } from './uat-audit-identities.mjs';
import { captureCheckpointViewport, assertDeniedUnchanged, assertHealth } from './wms-ecommerce-signoff-live.mjs';

export const TARGET = Object.freeze({ origin: 'https://mwell-intra-uat.vercel.app', project: 'kkoitlvydytdhlpxhuah' });
const ROLES = ['operations_associate', 'procurement_lead'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const RPC = 'manage_replenishment_recommendation';
const sha = value => createHash('sha256').update(value).digest('hex');
const sqlValue = value => `'${String(value).replaceAll("'", "''")}'`;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const sameKeys = (value, keys) => assert.deepEqual(Object.keys(value ?? {}).sort(), [...keys].sort(), 'Unexpected or missing fields');
const dayAfter = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const STAGES = ['seeded', 'recommended', 'accepted', 'uploading', 'uploads_ready', 'handed_off', 'route_confirmed'];
const BUCKET = 'procurement-requests';
const RISK = { comparable: true, complex: false, technical: false, strategic: false, highRisk: false, dataSensitive: false, importation: false };
export const DATABASE_FUNCTIONS = [
  'procurement.manage_replenishment_recommendation(jsonb)',
  'procurement.manage_replenishment_recommendation_uncertified_impl(jsonb)',
  'private.create_replenishment_request(procurement.replenishment_recommendations,jsonb)',
  'procurement.create_request(jsonb)',
  'procurement.confirm_route_decision(jsonb)',
  'private.policy_confirm_route_decision(jsonb)',
];
export function syntheticPdf(runId, view, kind) {
  assert(UUID.test(runId) && ['desktop1440', 'mobile390'].includes(view) && ['spec', 'budget'].includes(kind));
  const lines = ['TEST ONLY - NOT A PURCHASE OR FUNDING AUTHORIZATION', runId, `${view} ${kind}`, 'Synthetic signoff evidence. No real supplier or expenditure.'];
  const stream = `BT /F1 10 Tf 35 760 Td ${lines.map((line, i) => `${i ? '0 -20 Td ' : ''}(${line}) Tj`).join('\n')} ET\n`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`];
  let body = '%PDF-1.4\n', offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(body);
  body += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(body, 'ascii');
}
function completionInput(value) {
  sameKeys(value, ['department', 'costCenter', 'budgetCode', 'neededBy', 'requirementKind', 'unitPrice', 'terms']);
  for (const key of ['department', 'costCenter', 'budgetCode']) assert(typeof value[key] === 'string' && /^[A-Za-z0-9 _.-]{1,100}$/.test(value[key]), `Explicit reviewed ${key} required`);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(value.neededBy) && dayAfter(value.neededBy, 0) === value.neededBy);
  assert(['materials', 'services'].includes(value.requirementKind), 'Explicit classification required');
  assert(Number.isFinite(value.unitPrice) && value.unitPrice > 0 && value.unitPrice <= 1000 && Number.isInteger(value.unitPrice * 100), 'Small explicit synthetic estimate required');
  sameKeys(value.terms, ['acceptanceCriteria', 'deliveryTerms', 'paymentTerms', 'shippingTerms', 'validityPeriod', 'responseDeadline']);
  for (const text of Object.values(value.terms)) assert(typeof text === 'string' && /^[\x20-\x7e]{5,200}$/.test(text), 'Explicit RFQ planning terms required');
  return structuredClone(value);
}
function databaseContract(value) {
  sameKeys(value, ['functions', 'roleGrants', 'policyProfiles', 'migrationVersion']);
  assert(/^\d{14}$/.test(value.migrationVersion), 'Reviewed applied migration version required');
  assert.equal(value.functions?.length, DATABASE_FUNCTIONS.length);
  value.functions.forEach((f, i) => {
    sameKeys(f, ['signature', 'md5', 'owner', 'securityDefiner', 'config', 'authenticated', 'anon', 'serviceRole', 'publicExecute']);
    assert.equal(f.signature, DATABASE_FUNCTIONS[i]); assert(/^[a-f0-9]{32}$/.test(f.md5)); assert.equal(f.securityDefiner, true);
    assert(typeof f.owner === 'string' && f.owner.length > 0 && Array.isArray(f.config));
    assert.equal(f.anon, false); assert.equal(f.publicExecute, false);
    assert.equal(f.authenticated, [0, 3, 4].includes(i)); assert.equal(typeof f.serviceRole, 'boolean');
    if (i === 2) assert.equal(f.serviceRole, false);
  });
  assert(Array.isArray(value.roleGrants) && value.roleGrants.length > 0);
  for (const r of value.roleGrants) { sameKeys(r, ['module', 'role', 'cap']); assert(['warehouse', 'procurement'].includes(r.module)); assert(typeof r.role === 'string' && typeof r.cap === 'string'); }
  assert(Array.isArray(value.policyProfiles) && value.policyProfiles.length > 0);
  for (const p of value.policyProfiles) { sameKeys(p, ['id', 'md5']); assert(UUID.test(p.id) && /^[a-f0-9]{32}$/.test(p.md5)); }
  return structuredClone(value);
}
const LIMITS = [
  'Basic two-actor replenishment journey only; no full WMS certification or contract evidence emitted.',
  'Separate dismissal fixture, actual permission revocation and injected live read-failure coverage are absent.',
  'Concurrency, timeout recovery, automatic replay and resume coverage are absent.',
  'Existing Operations Associate is a combined-role account, not isolated Operations role proof.',
  'Fixtures are retained. No cleanup execution, unknown-reference clearance, Storage cleanup receipt or zero-residue claim.',
  'No demand forecast, supplier selection, approval of purchasing documents, purchase order, physical stock or SMTP delivery.',
  'Own-user learning bootstrap may run through governed app APIs; recorded separately, no grant/training bypass or identity cleanup.',
  'Screenshots require independent human review; hardware and pilot gates remain pending.',
  'Route confirmation is separate and leaves a draft. Routing submission and approvals are not executed. Two-session lock race remains unproven.',
  'PDFs are synthetic test documents, not real specifications or budget authority. No private-viewer audit coverage claimed.',
];

export function createManifest({ commit, bindings, completion, database, runId = randomUUID() } = {}) {
  assert(UUID.test(runId), 'Canonical full run UUID required');
  assert.notEqual(runId, '1390f33a-bec0-4400-b5b2-717359f2442d', 'Historical legacy fixture cannot be replayed');
  sameKeys(completion, ['desktop1440', 'mobile390']);
  database = databaseContract(database);
  assert(typeof commit === 'string' && /^[a-f0-9]{40}$/.test(commit), 'Exact deployed commit required');
  sameKeys(bindings, ROLES);
  const actors = {};
  for (const role of ROLES) {
    const binding = bindings[role]; sameKeys(binding, ['id', 'email']);
    assert(UUID.test(binding.id), 'Explicit actor UUID required');
    assert.equal(binding.email, auditPersonas('checkpoint-v1').find(p => p.role === role).email, 'Existing checkpoint persona email required');
    actors[role] = { id: binding.id, email: binding.email };
  }
  assert.notEqual(actors[ROLES[0]].id, actors[ROLES[1]].id, 'Separate business actors required');
  return freeze({ version: 2, kind: 'wms-replenishment', ...TARGET, runId, commit, actors, database,
    actorBindingsSha256: sha(JSON.stringify(actors)), retention: 'retain-until-separate-reviewed-cleanup',
    cases: [{ viewport: 'desktop1440', width: 1440, height: 1000 }, { viewport: 'mobile390', width: 390, height: 844 }].map(view => {
      const productId = `wms-replen-${runId}-${view.viewport}`;
      return { ...view, productId, sku: productId.toUpperCase(), productName: `Synthetic replenishment ${runId} ${view.viewport}`,
        quantity: 2, minimum: 2, available: 0, planningDays: 14,
        rationale: `Synthetic replenishment signoff ${runId} ${view.viewport}; no physical purchase.`,
        completion: completionInput(completion[view.viewport]),
        documents: ['spec', 'budget'].map(kind => { const bytes = syntheticPdf(runId, view.viewport, kind);
          return { kind, filename: `${runId}-${view.viewport}-${kind}.pdf`, mimeType: 'application/pdf', sizeBytes: bytes.length, sha256: sha(bytes) }; }) };
    }) });
}
export function validateManifest(input) {
  assert.equal(input?.version, 2, 'Only fresh canonical v2 manifests are supported');
  const expected = createManifest({ commit: input?.commit, runId: input?.runId, bindings: input?.actors, database: input?.database,
    completion: Object.fromEntries((input?.cases ?? []).map(c => [c.viewport, c.completion])) });
  assert.deepEqual(input, expected, 'Foreign or modified replenishment manifest'); return expected;
}
function selected(m, view) { const c = m.cases.find(c => c.viewport === view); assert(c, 'Unknown viewport'); return c; }
function productProof(m, c) { return { signoffRun: m.runId, synthetic: true, viewport: c.viewport }; }
function recommendationPayload(c) {
  return { action: 'recommend', product_id: c.productId, recommended_quantity: c.quantity, on_hand: c.available,
    reorder_point: c.minimum, lead_time_days: c.planningDays, stockout_risk: 'critical', rationale: c.rationale };
}
export function prepareSql(input) {
  const m = validateManifest(input);
  return `-- OFFLINE product prerequisite for UAT ${m.project}; build ${m.commit}; run ${m.runId}.
-- Parent review and separate execution required. Opening inventory is zero.
begin;
${m.cases.map(c => `insert into warehouse.products(id,sku,name,category,serialized,attributes,unit_cost,item_class,reorder_point)
values(${sqlValue(c.productId)},${sqlValue(c.sku)},${sqlValue(c.productName)},'merchandise',false,${sqlValue(JSON.stringify(productProof(m, c)))}::jsonb,1,'merchandise',${c.minimum});`).join('\n')}
commit;
`;
}
const BLOCKERS = {
  stock: ['warehouse.stock_levels', 'product_id'], units: ['warehouse.inventory_units', 'product_id'],
  movements: ['warehouse.movements', 'product_id'], reservations: ['warehouse.fulfillment_reservations', 'product_id'],
  holds: ['warehouse.inventory_holds', 'product_id'], allocations: ['warehouse.allocations', 'product_id'], lots: ['warehouse.lots', 'product_id'],
  purchaseOrders: ['procurement.purchase_orders', 'request_id'], approvalSteps: ['procurement.approval_steps', 'request_id'],
  approvalAudit: ['procurement.approval_step_audit', 'request_id'], revisions: ['procurement.request_revisions', 'request_id'],
};
const BLOCKER_KEYS = [...Object.keys(BLOCKERS), 'notifications', 'documents', 'actionEvidence'];
function validRequestId(id) { return typeof id === 'string' && id.startsWith('req_') && UUID.test(id.slice(4)); }
export function validateBinding(m, c, binding) {
  if (binding === null) return;
  sameKeys(binding, ['requestId', 'uploads', 'payload', 'route']); assert(validRequestId(binding.requestId), 'Early bound browser-generated request UUID required');
  assert(Array.isArray(binding.uploads) && binding.uploads.length <= 2);
  binding.uploads.forEach((u, i) => {
    sameKeys(u, ['id', 'path', 'kind', 'sha256', 'sizeBytes', 'actorId']);
    const d = c.documents[i]; assert(/^att_[a-f0-9]{32}$/.test(u.id));
    assert.equal(u.path, `request/${binding.requestId}/${u.id}-${d.filename}`);
    for (const key of ['kind', 'sha256', 'sizeBytes']) assert.equal(u[key], d[key]);
    assert.equal(u.actorId, m.actors[ROLES[1]].id);
  });
  assert.equal(new Set(binding.uploads.map(u => u.id)).size, binding.uploads.length);
  if (binding.payload !== null) assertCanonicalPayload(m, c, binding.payload, binding);
  if (binding.route !== null) {
    assert(binding.payload); sameKeys(binding.route, ['payload', 'response']);
    assert.deepEqual(binding.route.payload, { request_id: binding.requestId, expected_route_version: 0, requested_mode: 'competitive_bidding' });
    assert(binding.route.response && UUID.test(binding.route.response.id));
  }
}
function databaseExpression(version) {
  assert(/^\d{14}$/.test(version), 'Exact reviewed migration version required');
  return `jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('signature',f.signature,'md5',md5(pg_get_functiondef(p.oid)),
  'owner',pg_get_userbyid(p.proowner),'securityDefiner',p.prosecdef,'config',p.proconfig,
  'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
  'serviceRole',has_function_privilege('service_role',p.oid,'EXECUTE'),
  'publicExecute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')) order by f.ordinal)
  from unnest(array[${DATABASE_FUNCTIONS.map(sqlValue).join(',')}]) with ordinality f(signature,ordinal)
  left join pg_proc p on p.oid=to_regprocedure(f.signature)),
 'roleGrants',(select coalesce(jsonb_agg(jsonb_build_object('module',module,'role',role,'cap',cap) order by module,role,cap),'[]') from core.role_capabilities
  where module in ('warehouse','procurement')),
 'policyProfiles',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'md5',md5(to_jsonb(p)::text)) order by id),'[]') from procurement.policy_profiles p),
 'migrationVersion',(select version from supabase_migrations.schema_migrations where version=${sqlValue(version)}))`;
}
export function databasePreflightSql(version) {
  return `begin read only;\nset local statement_timeout='20s';\nselect ${databaseExpression(version)} as database;\ncommit;\n`;
}
export function readbackSql(input, view, binding = null) {
  const m = validateManifest(input), c = selected(m, view), p = sqlValue(c.productId);
  validateBinding(m, c, binding);
  const requestId = binding ? sqlValue(binding.requestId) : 'null';
  return `begin read only;
set local row_security=off;
set local lock_timeout='5s';
set local statement_timeout='20s';
with products as (select * from warehouse.products where id=${p} or sku=${sqlValue(c.sku)}),
recommendations as (select * from procurement.replenishment_recommendations where product_id=${p}),
requests as (select * from procurement.requests where id=${requestId} or id in (select procurement_request_id from recommendations)
 or justification->>'replenishmentRecommendationId' in (select id::text from recommendations)
 or strpos(lines::text,${p})>0 or title=${sqlValue(`Replenish ${c.productId}`)}),
entities as (select ${p} as id union select id::text from recommendations union select id from requests union select ${requestId}::text where ${requestId}::text is not null)
select jsonb_build_object('runId',${sqlValue(m.runId)},'view',${sqlValue(view)},'dbDate',current_date::text,
'database',${databaseExpression(m.database.migrationVersion)},
'rows',jsonb_build_object(
 'products',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from products r),
 'recommendations',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from recommendations r),
 'requests',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from requests r),
 'attachments',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from procurement.request_attachments r where request_id in (select id from entities)
   or strpos(storage_path,${sqlValue(m.runId)})>0 and strpos(storage_path,${sqlValue(view === 'desktop1440' ? 'mobile390' : 'desktop1440')})=0),
 'collaborators',(select coalesce(jsonb_agg(to_jsonb(r) order by user_id),'[]') from procurement.request_collaborators r where request_id in (select id from entities)),
 'routeDecisions',(select coalesce(jsonb_agg(to_jsonb(r) order by request_version,id),'[]') from procurement.route_decisions r where request_id in (select id from entities)),
 'intakeActors',(select coalesce(jsonb_agg(id order by id),'[]') from (select distinct p.id from core.user_roles r join core.profiles p on p.id=r.user_id and p.status='active'
   where r.module='procurement' and r.role in ('procurement_officer','admin') and p.id<>${sqlValue(m.actors[ROLES[1]].id)}::uuid) x),
 'requester',(select jsonb_build_object('id',id,'full_name',full_name,'email',email) from core.profiles where id=${sqlValue(m.actors[ROLES[1]].id)}::uuid),
 'storage',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'bucket_id',bucket_id,'name',name,'owner_id',owner_id,'metadata',metadata) order by name),'[]') from storage.objects
   where strpos(name,${sqlValue(m.runId)})>0 and strpos(name,${sqlValue(view === 'desktop1440' ? 'mobile390' : 'desktop1440')})=0
    or ${requestId}::text is not null and starts_with(name,'request/'||${requestId}::text||'/')),
 'bucket',(select jsonb_build_object('id',id,'public',public) from storage.buckets where id='procurement-requests'),
 'activity',(select coalesce(jsonb_agg(to_jsonb(r) order by created_at,id),'[]') from core.activity_log r
   where entity_id::text in (select id from entities) or detail->>'product_id'=${p})),
'blockers',jsonb_build_object(
 ${Object.entries(BLOCKERS).map(([key, [table, column]]) => `${sqlValue(key)},(select count(*) from ${table} where ${column}${column === 'product_id' ? `=${p}` : ' in (select id from requests)'})`).join(',\n ')},
 'notifications',(select count(*) from core.notifications where entity_id::text in (select id from entities)),
 'documents',(select count(*) from core.documents where entity_id::text in (select id from entities)),
 'actionEvidence',(select count(*) from private.action_evidence where source_id::text in (select id from entities)))) as snapshot;
commit;
`;
}
export function cleanupInventorySql(input) {
  const m = validateManifest(input);
  return `-- Retained fixture discovery only. Not a cleanup authorization or exhaustive reference clearance.
-- Expected dependencies: recommendation -> product/profile/request; request justification -> recommendation.
-- Parent must independently review discovered FK/JSON/trigger/evidence branches and writer isolation.
${m.cases.map(c => readbackSql(m, c.viewport)).join('\n')}
begin read only;
select n.nspname as schema, c.relname as relation, c.relkind as kind from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname !~ '^pg_' and n.nspname<>'information_schema' and c.relkind in ('r','p','m','f') order by 1,2;
select conname, conrelid::regclass::text as child, confrelid::regclass::text as parent, pg_get_constraintdef(oid) as definition
 from pg_constraint where contype='f' and confrelid in ('warehouse.products'::regclass,'procurement.replenishment_recommendations'::regclass,'procurement.requests'::regclass);
select tgrelid::regclass::text as relation,tgname,pg_get_triggerdef(oid) as definition from pg_trigger
 where not tgisinternal and tgrelid in ('warehouse.products'::regclass,'procurement.replenishment_recommendations'::regclass,'procurement.requests'::regclass);
commit;
`;
}
export async function prepare(folder, options) {
  const m = createManifest(options);
  folder = path.resolve(folder); await mkdir(path.dirname(folder), { recursive: true }); await mkdir(folder);
  const files = [['manifest.json', JSON.stringify(m, null, 2)], ['prepare.sql', prepareSql(m)], ['cleanup-inventory.sql', cleanupInventorySql(m)],
    ...m.cases.map(c => [`readback-${c.viewport}.sql`, readbackSql(m, c.viewport)])];
  for (const [name, body] of files) await writeFile(path.join(folder, name), body, { flag: 'wx', mode: 0o600 });
  for (const c of m.cases) for (const d of c.documents) await writeFile(path.join(folder, d.filename), syntheticPdf(m.runId, c.viewport, d.kind), { flag: 'wx', mode: 0o600 });
  return m;
}
export function assertRunPermission(input, env, apply, mode = 'cli') {
  const m = validateManifest(input);
  assert(['cli', 'mcp'].includes(mode), 'Unknown readback mode');
  assert.equal(apply, true, 'Explicit run --apply required'); assert.equal(env.APP_ENV, 'uat');
  assert.equal(env.AUDIT_MUTATIONS, 'true'); assert.equal(env.WMS_REPLENISHMENT_RUN_ID, m.runId);
  assert(typeof env.AUDIT_PASSWORD === 'string' && env.AUDIT_PASSWORD.length > 0, 'Secure AUDIT_PASSWORD required');
  if (mode === 'cli') {
    assert(typeof env.WMS_REPLENISHMENT_CLI_WORKDIR === 'string' && path.isAbsolute(env.WMS_REPLENISHMENT_CLI_WORKDIR), 'Explicit linked CLI workdir required');
    assert.equal(env.WMS_REPLENISHMENT_CLI_EXCLUSIVE, 'approved', 'Parent-coordinated exclusive linked CLI window required');
  }
}
export function assertActor(m, role, proof) {
  assert(ROLES.includes(role), 'Unknown business actor');
  for (const source of ['user', 'profile']) for (const key of ['id', 'email']) assert.equal(proof?.[source]?.[key], m.actors[role][key], `Actor ${source} binding mismatch`);
  const live = proof.capabilities?.userCapabilities, raw = proof.capabilities?.roleCapabilities;
  assert(live && raw && Array.isArray(live.warehouse) && Array.isArray(raw.warehouse), 'Complete effective actor snapshot required');
  const required = role === ROLES[0] ? [['warehouse', 'view_inventory'], ['warehouse', 'recommend_replenishment']]
    : [['warehouse', 'view_inventory'], ['warehouse', 'view_procurement'], ['procurement', 'view_dashboard'], ['procurement', 'manage_replenishment'], ['procurement', 'create_request'], ['procurement', 'manage_rfp']];
  for (const [module, cap] of required) assert(live[module]?.includes(cap), `Missing effective ${role}:${module}.${cap}`);
  if (role === ROLES[0]) {
    assert(!live.warehouse.includes('view_procurement') && !raw.warehouse.includes('view_procurement'), 'Operations must not gain Procurement page access');
    assert(!live.procurement?.includes('manage_replenishment') && !raw.procurement?.includes('manage_replenishment'), 'Recommender must not manage this recommendation');
  } else assert(!live.warehouse.includes('recommend_replenishment') && !raw.warehouse.includes('recommend_replenishment'), 'Separate management persona required');
  return { id: m.actors[role].id, email: m.actors[role].email, capabilities: proof.capabilities, source: 'auth.getUser+own-core.profiles+core.my_capability_snapshot' };
}
export function assertPayload(m, c, role, action, payload, recordId) {
  assert.deepEqual(c, selected(m, c.viewport));
  assert.equal(role, action === 'recommend' ? ROLES[0] : ROLES[1], 'Wrong action actor');
  assert(['recommend', 'accept', 'handoff'].includes(action), 'Unreviewed UI action');
  if (action === 'recommend') assert.deepEqual(payload, recommendationPayload(c), 'Recommendation payload changed');
  else { assert(UUID.test(recordId), 'Exact bound recommendation UUID required'); assert.equal(action, 'accept', 'Bare handoff is no longer authorized'); assert.deepEqual(payload, { id: recordId, action }, 'Decision payload changed'); }
  return freeze(structuredClone(payload));
}
export function assertCanonicalPayload(m, c, p, binding) {
  assert(binding && validRequestId(binding.requestId) && binding.uploads.length === 2, 'Both early-bound uploads required before handoff');
  sameKeys(p, ['id', 'title', 'department', 'cost_center', 'budget_code', 'needed_by', 'requester_name', 'requester_email', 'lines',
    'estimated_amount', 'category', 'requirement_kind', 'requested_mode', 'sourcing_method', 'solicitation_requirements', 'justification', 'attachments', 'compliance']);
  const f = c.completion;
  for (const [key, value] of Object.entries({ id: binding.requestId, title: `Replenish ${c.productId}`, department: f.department,
    cost_center: f.costCenter, budget_code: f.budgetCode, needed_by: f.neededBy, requester_email: m.actors[ROLES[1]].email,
    estimated_amount: c.quantity * f.unitPrice, category: 'goods', requirement_kind: f.requirementKind, requested_mode: 'competitive_bidding', sourcing_method: 'rfq' })) assert.equal(p[key], value, `Canonical payload mismatch: ${key}`);
  assert(typeof p.requester_name === 'string' && p.requester_name.length > 0);
  assert.equal(p.lines.length, 1); const l = p.lines[0];
  assert(typeof l.id === 'string' && l.id.startsWith('rl_') && UUID.test(l.id.slice(3)), 'Actual browser line UUID required');
  assert.deepEqual(l, { id: l.id, description: c.productId, quantity: c.quantity, uom: 'unit', unitPrice: f.unitPrice });
  assert.deepEqual(p.justification, { need: c.rationale }); assert.deepEqual(p.solicitation_requirements, f.terms);
  assert.deepEqual(p.compliance, { vendorAccreditationRequired: true, routeConfirmed: false, policyVersion: 'procurement-policy-revised-2026', riskFacts: RISK, intendedResponses: 3 });
  assert.equal(p.attachments.length, 2);
  p.attachments.forEach((a, i) => {
    const u = binding.uploads[i], d = c.documents[i];
    assert(typeof a.uploaded_at === 'string' && Number.isFinite(Date.parse(a.uploaded_at)));
    assert.deepEqual(a, { id: u.id, filename: d.filename, mime_type: d.mimeType, size_bytes: d.sizeBytes, storage_path: u.path,
      sha256: d.sha256, uploaded_at: a.uploaded_at, uploaded_by_email: m.actors[ROLES[1]].email, kind: d.kind });
  });
  return p;
}
export async function inspectStorageUpload(m, c, role, request, token, binding) {
  assert.equal(role, ROLES[1]); assert.equal(request.method, 'POST');
  const url = new URL(request.url); assert.equal(url.origin, `https://${m.project}.supabase.co`); assert.equal(url.search, '');
  assert.equal(request.headers.authorization, `Bearer ${token}`); assert(typeof token === 'string' && token.length > 0);
  assert.equal(request.headers['x-upsert'], 'false', 'Storage overwrite is forbidden');
  const prefix = `/storage/v1/object/${BUCKET}/`; assert(url.pathname.startsWith(prefix));
  const objectPath = url.pathname.slice(prefix.length); assert.equal(decodeURIComponent(objectPath), objectPath, 'Encoded paths refused');
  const parts = objectPath.split('/'); assert.equal(parts.length, 3); assert.equal(parts[0], 'request'); assert(validRequestId(parts[1]));
  const index = binding?.uploads.length ?? 0; assert(index < 2, 'Repeated upload refused');
  const d = c.documents[index], attachmentId = parts[2].slice(0, 36);
  assert(/^att_[a-f0-9]{32}$/.test(attachmentId)); assert.equal(parts[2], `${attachmentId}-${d.filename}`);
  if (binding) { validateBinding(m, c, binding); assert.equal(parts[1], binding.requestId, 'Request identity changed between uploads'); }
  assert(Buffer.isBuffer(request.bytes) && request.bytes.length < 65536, 'Bounded multipart upload required');
  const form = await new Response(request.bytes, { headers: { 'content-type': request.headers['content-type'] } }).formData();
  assert.deepEqual([...form.keys()], ['cacheControl', ''], 'Unknown Storage form fields');
  assert.equal(form.get('cacheControl'), '3600'); const file = form.get('');
  assert(file instanceof File && file.type === d.mimeType);
  const bytes = Buffer.from(await file.arrayBuffer()); assert.deepEqual(bytes, syntheticPdf(m.runId, c.viewport, d.kind), 'Foreign or changed PDF bytes');
  assert.equal(sha(bytes), d.sha256); assert.equal(bytes.length, d.sizeBytes);
  return { requestId: parts[1], upload: { id: attachmentId, path: objectPath, kind: d.kind, sha256: d.sha256, sizeBytes: d.sizeBytes, actorId: m.actors[role].id } };
}
export function assertStorageProof(m, c, binding, proof) {
  sameKeys(proof, ['bucket', 'path', 'actorId', 'uploadStatus', 'downloadSha256', 'downloadSizeBytes', 'listedNames', 'source']);
  const u = binding.uploads.at(-1); assert(u);
  assert.equal(proof.bucket, BUCKET); assert.equal(proof.path, u.path); assert.equal(proof.actorId, m.actors[ROLES[1]].id);
  assert.equal(proof.uploadStatus, 200); assert.equal(proof.downloadSha256, u.sha256); assert.equal(proof.downloadSizeBytes, u.sizeBytes);
  assert.deepEqual([...proof.listedNames].sort(), binding.uploads.map(u => u.path.split('/').at(-1)).sort());
  assert.equal(proof.source, 'authenticated-owner-sdk-download+complete-prefix-list');
}
export function reviewedReadRpc(schema, name, body, role) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const keys = (value, expected) => object(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
  if (keys(body, []) && (schema === 'core' && name === 'my_capability_snapshot' || schema === 'learning' && name === 'my_learning_snapshot'
    || schema === 'warehouse' && name === 'list_stock_change_requests')) return true;
  if (schema === 'warehouse' && name === 'department_request_actor_names') return keys(body, ['p_request_ids'])
    && Array.isArray(body.p_request_ids) && body.p_request_ids.length <= 200
    && body.p_request_ids.every(value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value));
  if (schema !== 'procurement' || role !== ROLES[1] || !keys(body, ['payload'])) return false;
  const p = body.payload;
  // RequestDetailPage's usePurchaseOrders mounts these capability-checked read
  // projections for the actor's existing PO list. None is a decision command.
  if (['purchase_order_receipt_status', 'review_open_purchase_orders', 'payment_readiness_staleness_work_items'].includes(name)) return keys(p, []);
  if (name === 'purchase_order_lifecycle') return keys(p, ['purchase_order_id']) && id(p.purchase_order_id);
  if (name === 'commitment_readiness') return keys(p, ['request_id', 'vendor_id', 'phase']) && id(p.request_id)
    && (p.vendor_id === null || UUID.test(p.vendor_id)) && ['award', 'issue'].includes(p.phase);
  return false;
}
export function authorizeBrowserRequest(m, c, role, request, armed, token) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return 'read';
  const url = new URL(request.url), api = `https://${m.project}.supabase.co`;
  assert.equal(url.origin, api, 'Non-UAT mutation blocked'); assert.equal(request.method, 'POST', 'Unreviewed request method');
  const body = request.body;
  if (url.pathname === '/auth/v1/token') {
    assert(['password', 'refresh_token'].includes(url.searchParams.get('grant_type')), 'Unreviewed auth operation');
    if (url.searchParams.get('grant_type') === 'password') assert.equal(body?.email, m.actors[role].email, 'Browser login email differs from binding');
    return 'auth';
  }
  assert(url.pathname.startsWith('/rest/v1/rpc/'), 'Direct table or Storage write blocked');
  const schema = request.headers['content-profile'], name = url.pathname.split('/').at(-1);
  if (reviewedReadRpc(schema, name, body, role)) return 'read';
  if (schema === 'learning' && ['resolve_assignments', 'evaluate_certifications'].includes(name)
    && body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0) return 'bootstrap';
  assert.equal(schema, 'procurement', 'Unreviewed mutation schema'); assert.equal(name, armed?.rpc ?? RPC, 'Unreviewed mutation RPC');
  assert([RPC, 'confirm_route_decision'].includes(name), 'Only reviewed business commands');
  if (name === 'confirm_route_decision') assert.equal(role, ROLES[1], 'Only the bound route manager can confirm');
  assert(armed && armed.key === `${c.viewport}:${role}` && !armed.consumed, 'Unarmed or repeated recommendation command');
  sameKeys(body, ['payload']); assert.deepEqual(body.payload, armed.payload, 'UI intent changed');
  assert(typeof token === 'string' && token.length > 0 && request.headers.authorization === `Bearer ${token}`, 'Browser command is not the verified sign-in session');
  return 'command';
}
export function reconcile(input, view, s, stage, binding = null) {
  const m = validateManifest(input), c = selected(m, view);
  assert(STAGES.includes(stage)); validateBinding(m, c, binding);
  sameKeys(s, ['runId', 'view', 'dbDate', 'database', 'rows', 'blockers']); assert.equal(s.runId, m.runId); assert.equal(s.view, view);
  assert.deepEqual(s.database, m.database, 'Database definitions, ACL, grants, policy or rollout version changed');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(s.dbDate) && dayAfter(s.dbDate, 0) === s.dbDate, 'Database date required');
  sameKeys(s.rows, ['products', 'recommendations', 'requests', 'activity', 'attachments', 'collaborators', 'intakeActors', 'requester', 'storage', 'bucket', 'routeDecisions']);
  for (const [key, rows] of Object.entries(s.rows)) if (!['requester', 'bucket'].includes(key)) assert(Array.isArray(rows), 'Complete row arrays required');
  assert.deepEqual(s.rows.bucket, { id: BUCKET, public: false }, 'Private Storage bucket required');
  sameKeys(s.rows.requester, ['id', 'full_name', 'email']); assert.equal(s.rows.requester.id, m.actors[ROLES[1]].id); assert.equal(s.rows.requester.email, m.actors[ROLES[1]].email);
  assert(typeof s.rows.requester.full_name === 'string' && s.rows.requester.full_name.length > 0);
  assert(s.rows.intakeActors.every(id => UUID.test(id) && id !== s.rows.requester.id)); assert.equal(new Set(s.rows.intakeActors).size, s.rows.intakeActors.length);
  assert(c.completion.neededBy > s.dbDate, 'Frozen need-by date must remain future');
  sameKeys(s.blockers, BLOCKER_KEYS); for (const [key, count] of Object.entries(s.blockers)) assert.equal(count, 0, `Unexpected ${key} residue`);
  assert.equal(s.rows.products.length, 1, 'Exactly one product prerequisite required');
  const product = s.rows.products[0];
  for (const [key, value] of Object.entries({ id: c.productId, sku: c.sku, name: c.productName, category: 'merchandise', serialized: false,
    reorder_point: c.minimum, item_class: 'merchandise', unit_cost: 1 })) assert.equal(product[key], value, `Product proof mismatch: ${key}`);
  assert.deepEqual(product.attributes, productProof(m, c), 'Full UUID product ownership proof required');
  const confirmed = stage === 'route_confirmed', handedOff = confirmed || stage === 'handed_off';
  const businessStage = confirmed ? 'handed_off' : ['uploading', 'uploads_ready'].includes(stage) ? 'accepted' : stage;
  const count = ['seeded', 'recommended', 'accepted', 'handed_off'].indexOf(businessStage);
  const uploads = binding?.uploads ?? [];
  if (stage === 'uploading') assert.equal(uploads.length, 1);
  else if (['uploads_ready', 'handed_off', 'route_confirmed'].includes(stage)) assert.equal(uploads.length, 2);
  else assert.equal(uploads.length, 0, 'Unexpected uploads before canonical completion');
  assert.equal(s.rows.storage.length, uploads.length, 'Unknown or missing Storage objects');
  for (const u of uploads) {
    const matches = s.rows.storage.filter(o => o.name === u.path); assert.equal(matches.length, 1);
    const o = matches[0]; assert(UUID.test(o.id)); assert.equal(o.bucket_id, BUCKET); assert.equal(o.owner_id, u.actorId);
    assert.equal(o.metadata?.size, u.sizeBytes); assert.equal(o.metadata?.mimetype, 'application/pdf');
  }
  assert.equal(s.rows.attachments.length, handedOff ? 2 : 0, 'Unexpected registered evidence');
  assert.equal(s.rows.collaborators.length, handedOff ? s.rows.intakeActors.length : 0, 'Unexpected intake collaborator set');
  assert.equal(s.rows.routeDecisions.length, confirmed ? 1 : 0, 'Unexpected route decision set');
  assert.equal(s.rows.recommendations.length, count ? 1 : 0, 'Unexpected recommendation set');
  assert.equal(s.rows.requests.length, handedOff ? 1 : 0, 'Unexpected request set');
  assert.equal(s.rows.activity.length, count + (handedOff ? 1 : 0), 'Unexpected audit set');
  if (!count) return { stage, productId: c.productId };
  const r = s.rows.recommendations[0]; assert(UUID.test(r.id), 'Persisted recommendation UUID required'); assert.equal(r.status, businessStage);
  const { action: ignored, ...fields } = recommendationPayload(c); void ignored;
  for (const [key, value] of Object.entries(fields)) assert.equal(r[key], value, `Recommendation mismatch: ${key}`);
  for (const key of ['purchase_order_id', 'ordered_at', 'expected_arrival_at']) assert.equal(r[key], null, `Unexpected downstream ${key}`);
  assert(Number.isFinite(Date.parse(r.created_at)), 'Recommendation creation time required');
  assert.equal(r.decided_by, stage === 'recommended' ? null : m.actors[ROLES[1]].id);
  if (stage === 'recommended') assert.equal(r.decided_at, null);
  else assert(Date.parse(r.decided_at) >= Date.parse(r.created_at), 'Decision chronology invalid');
  const actions = ['recommend', 'accept', 'handoff'].slice(0, count);
  assert.equal(new Set(s.rows.activity.map(a => a.id)).size, s.rows.activity.length, 'Duplicate audit rows');
  for (const [index, action] of actions.entries()) {
    const logs = s.rows.activity.filter(a => a.action === action); assert.equal(logs.length, 1, 'Missing or duplicate action audit');
    const a = logs[0]; assert.equal(a.module, 'procurement'); assert.equal(a.entity_type, 'replenishment_recommendation'); assert.equal(a.entity_id, r.id);
    assert.equal(a.actor, m.actors[index === 0 ? ROLES[0] : ROLES[1]].id, 'Wrong audit actor');
    assert(Number.isFinite(Date.parse(a.created_at)), 'Audit timestamp required');
    assert.deepEqual(a.detail, { product_id: c.productId, status: ['recommended', 'accepted', 'handed_off'][index], procurement_request_id: action === 'handoff' ? r.procurement_request_id : null });
  }
  if (!handedOff) assert.equal(r.procurement_request_id, null);
  else {
    assert(binding?.payload, 'Pre-command canonical payload binding required');
    const q = s.rows.requests[0], p = binding.payload; assert(validRequestId(q.id), 'Canonical request UUID format required'); assert.equal(q.id, binding.requestId);
    assert.equal(r.procurement_request_id, q.id);
    for (const key of ['title', 'department', 'cost_center', 'budget_code', 'needed_by', 'estimated_amount', 'category', 'requirement_kind', 'sourcing_method']) assert.equal(q[key], p[key], `Draft mismatch: ${key}`);
    assert.equal(q.status, 'draft'); assert.equal(q.requester_id, m.actors[ROLES[1]].id); assert.equal(q.requester_email, s.rows.requester.email);
    assert.equal(q.requester_name, s.rows.requester.full_name); assert.equal(p.requester_name, s.rows.requester.full_name);
    assert.deepEqual(q.lines, p.lines); assert.deepEqual(q.solicitation_requirements, p.solicitation_requirements);
    assert.deepEqual(q.justification, { need: c.rationale, replenishmentRecommendationId: r.id });
    assert.deepEqual(q.compliance, { ...p.compliance, source: 'warehouse_replenishment', routeConfirmed: confirmed });
    for (const key of ['core_vendor_id', 'vendor_name', 'submitted_at', 'decided_at', 'description', 'project_code', ...(!confirmed ? ['route_confirmed_at', 'route_confirmed_by'] : [])]) assert.equal(q[key], null, `Unexpected draft ${key}`);
    assert.equal(q.route_version, confirmed ? 1 : 0);
    if (confirmed) {
      assert(binding.route, 'Captured separate route response required'); const d = s.rows.routeDecisions[0], result = binding.route.response;
      const { route, ...decision } = result; assert.deepEqual(d, decision, 'Route response differs from persisted decision');
      assert.equal(d.request_id, q.id); assert.equal(d.request_version, 1); assert.equal(d.status, 'confirmed');
      assert.equal(d.confirmed_by, s.rows.requester.id); assert.equal(d.method, 'rfq'); assert.deepEqual(d.risk_facts, RISK);
      assert.equal(d.solicitation_type, 'rfq'); assert.equal(d.procurement_mode, 'competitive_bidding');
      assert(m.database.policyProfiles.some(p => p.id === d.policy_profile_id)); assert.equal(route.status, 'derived');
      for (const key of ['solicitation_type', 'procurement_mode', 'governance_tier', 'policy_profile_id']) { assert.equal(q[key], d[key]); assert.equal(route[key], d[key]); }
      assert.deepEqual(q.route_reasons, d.reasons); assert.deepEqual(route.reasons, d.reasons);
      assert.equal(q.route_confirmed_by, d.confirmed_by); assert.equal(Date.parse(q.route_confirmed_at), Date.parse(d.confirmed_at));
      assert(Number.isFinite(Date.parse(d.confirmed_at))); assert.equal(q.sourcing_override, false);
    } else assert.equal(binding.route, null);
    const attached = p.attachments.map(a => ({ id: a.id, filename: a.filename, mimeType: a.mime_type, sizeBytes: a.size_bytes, storagePath: a.storage_path,
      sha256: a.sha256, uploadedAt: a.uploaded_at, uploadedByEmail: a.uploaded_by_email, kind: a.kind }));
    // PostgreSQL serializes timestamptz differently from the browser's ISO Z.
    const dates = rows => rows.map(a => ({ ...a, uploadedAt: new Date(a.uploadedAt).toISOString() }));
    assert.deepEqual(dates(q.attachments), dates(attached));
    for (const a of p.attachments) {
      const rows = s.rows.attachments.filter(row => row.id === a.id); assert.equal(rows.length, 1);
      for (const [key, value] of Object.entries({ ...a, request_id: q.id, uploaded_by: m.actors[ROLES[1]].id })) {
        if (key === 'uploaded_at') assert.equal(Date.parse(rows[0][key]), Date.parse(value)); else assert.equal(rows[0][key], value, `Attachment mismatch: ${key}`);
      }
    }
    for (const id of s.rows.intakeActors) {
      const rows = s.rows.collaborators.filter(row => row.user_id === id); assert.equal(rows.length, 1);
      for (const [key, value] of Object.entries({ request_id: q.id, access_level: 'manage', reason: 'system_intake_assignment', granted_by: s.rows.requester.id, revoked_by: null, revoked_at: null })) assert.equal(rows[0][key], value);
      assert(Number.isFinite(Date.parse(rows[0].granted_at)));
    }
    const created = s.rows.activity.filter(a => a.action === 'created'); assert.equal(created.length, 1);
    for (const [key, value] of Object.entries({ module: 'procurement', entity_type: 'request', entity_id: q.id, actor: s.rows.requester.id })) assert.equal(created[0][key], value);
    assert.deepEqual(created[0].detail, { title: q.title, attachment_count: 2 });
    assert(Number.isFinite(Date.parse(created[0].created_at)));
  }
  return { stage, productId: c.productId, recommendationId: r.id, requestId: r.procurement_request_id };
}
export function newReport(m, source) {
  return { version: 2, kind: 'wms-replenishment-canonical-journey', source, runId: m.runId, commit: m.commit, target: TARGET,
    startedAt: new Date().toISOString(), complete: false, smtpIndependent: true, globalWmsSignoff: false, contractEvidenceEmitted: false,
    limits: [...LIMITS], cleanup: { status: 'retained', allResidueVerified: false }, humanGates: 'pending',
    actors: {}, checks: [], negatives: [], bindings: [], failures: [] };
}
export async function executeJourney(input, adapter, report = newReport(input, adapter.kind)) {
  const m = validateManifest(input);
  async function health() { const value = await adapter.health(); assertHealth(value, m); report.lastHealth = value; }
  async function actor(role) { const value = assertActor(m, role, await adapter.actor(role)); report.actors[role] = value; return value; }
  const record = value => adapter.record(value, report);
  try {
    await health(); for (const role of ROLES) await actor(role);
    const dates = new Set();
    // Both fixtures must be pristine before the first business write in either view.
    for (const c of m.cases) { const s = await adapter.read(c, 'seeded'); reconcile(m, c.viewport, s, 'seeded'); dates.add(s.dbDate); await record({ kind: 'seed-readback', view: c.viewport, snapshot: s }); }
    assert.equal(dates.size, 1); const dbDate = [...dates][0];
    for (const c of m.cases) {
      let stage = 'seeded', binding, evidenceBinding = null;
      const read = async () => { const s = await adapter.read(c, stage, evidenceBinding); assert.equal(s.dbDate, dbDate, 'Database date changed; stop rather than revise frozen intent'); reconcile(m, c.viewport, s, stage, evidenceBinding); return s; };
      async function capture(role, name, snapshot) {
        const screenshot = await adapter.capture(c, role, name);
        assert(typeof screenshot.ref === 'string' && path.basename(screenshot.ref) === screenshot.ref && screenshot.ref.endsWith('.png'));
        assert(SHA.test(screenshot.sha256)); assert.equal(screenshot.width, c.width); assert.equal(screenshot.height, c.height);
        assert(screenshot.contentWidth <= c.width + 1, 'Viewport overflow'); assert.equal(screenshot.actorId, m.actors[role].id); assert.equal(screenshot.reviewed, false);
        report.checks.push({ view: c.viewport, stage: name, actorId: m.actors[role].id, screenshot, readback: snapshot });
        await record({ kind: 'checkpoint', checkpoint: report.checks.at(-1) });
      }
      async function command(role, action, nextStage) {
        await health(); await actor(role); await read();
        const payload = action === 'recommend' ? recommendationPayload(c) : { id: binding.recommendationId, action };
        assertPayload(m, c, role, action, payload, binding?.recommendationId);
        await record({ kind: 'intent', view: c.viewport, role, action, payload });
        const result = await adapter.command(c, role, action, payload);
        assert(!result.error && result.data, 'UI command failed or response missing; no automatic retry');
        const snapshot = await adapter.read(c, nextStage); assert.equal(snapshot.dbDate, dbDate);
        const next = reconcile(m, c.viewport, snapshot, nextStage);
        if (binding) assert.equal(next.recommendationId, binding.recommendationId, 'Recommendation identity changed');
        assert.deepEqual(result.data, snapshot.rows.recommendations[0], 'RPC result differs from persisted recommendation');
        binding = next; stage = nextStage;
        await capture(role, stage, snapshot);
      }
      async function deny(role, payload, expected) {
        await health(); await actor(role); await record({ kind: 'negative-intent', view: c.viewport, role, payload });
        const message = await assertDeniedUnchanged(read, async () => {
          const result = await adapter.negative(c, role, payload, stage, evidenceBinding);
          assert.equal(result.error?.code, 'P0001', 'Negative must reach the governed RPC exception'); return result;
        }, expected);
        report.negatives.push({ view: c.viewport, role, actorId: m.actors[role].id, payload, message, snapshot: await read() });
        await record({ kind: 'negative-result', result: report.negatives.at(-1) });
      }
      await command(ROLES[0], 'recommend', 'recommended');
      const decision = action => ({ id: binding.recommendationId, action });
      await deny(ROLES[0], decision('accept'), /Not authorized: procurement.manage_replenishment/);
      await deny(ROLES[0], decision('handoff'), /Not authorized: procurement.manage_replenishment/);
      await deny(ROLES[1], recommendationPayload(c), /Not authorized: warehouse.recommend_replenishment/);
      await deny(ROLES[1], decision('handoff'), /Accept the recommendation before handoff/);
      await command(ROLES[1], 'accept', 'accepted');
      await deny(ROLES[0], recommendationPayload(c), /already accepted or handed off/i);
      const hooks = {
        beforeUpload: async next => {
          validateBinding(m, c, next);
          if (evidenceBinding) assert.deepEqual(next, evidenceBinding, 'Upload context changed');
          else { assert.equal(next.uploads.length, 0); assert.equal(next.payload, null); evidenceBinding = structuredClone(next); await record({ kind: 'early-request-binding', view: c.viewport, binding: evidenceBinding }); }
          await health(); await actor(ROLES[1]); await read();
        },
        uploaded: async (next, proof) => {
          validateBinding(m, c, next); assert.equal(next.requestId, evidenceBinding.requestId);
          assert.deepEqual(next.uploads.slice(0, -1), evidenceBinding.uploads); assert.equal(next.uploads.length, evidenceBinding.uploads.length + 1);
          assertStorageProof(m, c, next, proof);
          evidenceBinding = structuredClone(next); stage = next.uploads.length === 2 ? 'uploads_ready' : 'uploading';
          await record({ kind: 'verified-private-upload', view: c.viewport, binding: evidenceBinding, proof });
        },
        beforeHandoff: async next => {
          validateBinding(m, c, next); assert.deepEqual({ ...next, payload: null }, evidenceBinding);
          assert(next.payload && stage === 'uploads_ready');
          await health(); await actor(ROLES[1]); const before = await read();
          assert.equal(next.payload.requester_name, before.rows.requester.full_name);
          evidenceBinding = structuredClone(next);
          await record({ kind: 'canonical-handoff-intent', view: c.viewport, recommendationId: binding.recommendationId, binding: evidenceBinding });
        },
      };
      const completed = await adapter.complete(c, ROLES[1], binding.recommendationId, hooks);
      assert(evidenceBinding?.payload && !completed.error && completed.data, 'Canonical completion was not verified; no replay');
      stage = 'handed_off'; const handed = await read();
      assert.deepEqual(completed.data, handed.rows.recommendations[0]); binding = reconcile(m, c.viewport, handed, stage, evidenceBinding);
      await capture(ROLES[1], stage, handed);
      await deny(ROLES[0], recommendationPayload(c), /already accepted or handed off/i);
      await deny(ROLES[1], decision('handoff'), /Accept the recommendation before handoff/);
      await health(); await actor(ROLES[1]); const before = await read();
      const opened = await adapter.openRequest(c, ROLES[1], before.rows.requests[0]);
      assert.deepEqual(opened, { requestId: binding.requestId, path: `/procurement/requests/${binding.requestId}`, actorId: m.actors[ROLES[1]].id });
      assert.deepEqual(await read(), before, 'Opening draft changed business records');
      await capture(ROLES[1], 'draft-opened', before);
      await health(); await actor(ROLES[1]); assert.deepEqual(await read(), before);
      const routePayload = { request_id: binding.requestId, expected_route_version: 0, requested_mode: 'competitive_bidding' };
      await record({ kind: 'route-confirmation-intent', view: c.viewport, payload: routePayload });
      const routeResult = await adapter.confirmRoute(c, ROLES[1], routePayload);
      assert(!routeResult.error && routeResult.data, 'Separate route confirmation failed; do not replay');
      evidenceBinding.route = { payload: routePayload, response: structuredClone(routeResult.data) };
      stage = 'route_confirmed'; const confirmed = await read(); assertRouteOnlyChange(before, confirmed);
      await capture(ROLES[1], stage, confirmed);
      await health(); await actor(ROLES[1]);
      await record({ kind: 'negative-route-stale-intent', view: c.viewport, payload: routePayload });
      const staleMessage = await assertDeniedUnchanged(read, async () => {
        const result = await adapter.negativeRoute(c, ROLES[1], routePayload);
        assert.equal(result.error?.code, 'P0001'); return result;
      }, /Route confirmation is stale; reload the request before confirming/);
      report.negatives.push({ view: c.viewport, role: ROLES[1], actorId: m.actors[ROLES[1]].id, rpc: 'confirm_route_decision', payload: routePayload, message: staleMessage, snapshot: await read() });
      await record({ kind: 'negative-result', result: report.negatives.at(-1) });
      binding = reconcile(m, c.viewport, confirmed, stage, evidenceBinding);
      report.bindings.push({ view: c.viewport, ...binding, evidence: evidenceBinding }); await record({ kind: 'binding', binding: report.bindings.at(-1) });
    }
    for (const c of m.cases) {
      const evidence = report.bindings.find(b => b.view === c.viewport).evidence;
      const snapshot = await adapter.read(c, 'route_confirmed', evidence); reconcile(m, c.viewport, snapshot, 'route_confirmed', evidence);
      assert.deepEqual(snapshot, report.checks.find(row => row.view === c.viewport && row.stage === 'route_confirmed').readback, 'Completed viewport changed before final reconciliation');
      await record({ kind: 'final-readback', view: c.viewport, snapshot });
    }
    await health(); report.complete = true; await record({ kind: 'basic-journey-complete' }); return report;
  } catch (error) {
    if (adapter.diagnose) {
      let uiFailure;
      try { uiFailure = await adapter.diagnose(error); }
      catch { uiFailure = { status: 'diagnostics-unavailable', screenshot: null }; }
      error.safeDetails = { ...error.safeDetails, uiFailure };
    }
    report.complete = false; report.failures.push({ message: error.message.split('\n')[0], ...(error.safeDetails ? { details: error.safeDetails } : {}) });
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    try { const summary = await adapter.close(); if (summary) report.browserPageErrors = summary; } catch (error) { report.complete = false; throw error; }
  }
}
export function assertRouteOnlyChange(before, after) {
  const strip = snapshot => {
    const s = structuredClone(snapshot); s.rows.routeDecisions = [];
    for (const q of s.rows.requests) {
      for (const key of ['solicitation_type', 'procurement_mode', 'governance_tier', 'policy_profile_id', 'route_reasons', 'route_version',
        'route_confirmed_at', 'route_confirmed_by', 'updated_at']) delete q[key];
      q.compliance.routeConfirmed = false;
    }
    return s;
  };
  assert.deepEqual(strip(after), strip(before), 'Route confirmation changed unrelated records, evidence or request fields');
}

export function classifyCliFailure(error, sql) {
  const text = [error?.code, error?.message, error?.stderr].filter(v => typeof v === 'string').join('\n').slice(0, 32768);
  const category = error?.killed || /ETIMEDOUT|57014|55P03|timed out|timeout/i.test(text) ? 'TIMEOUT'
    : /28P01|28000|authentication|not logged in|access token|login role/i.test(text) ? 'AUTH'
      : /SQLSTATE|syntax error|permission denied|does not exist/i.test(text) ? 'SQL' : 'OTHER';
  return { category, querySha256: sha(sql) };
}
export function parseCliRows(stdout) {
  assert(typeof stdout === 'string' && Buffer.byteLength(stdout) <= 4194304, 'Bounded CLI JSON required');
  const result = JSON.parse(stdout);
  if (!Array.isArray(result)) { sameKeys(result, ['boundary', 'rows', 'warning']); assert(typeof result.boundary === 'string' && typeof result.warning === 'string'); }
  const rows = Array.isArray(result) ? result : result.rows; assert(Array.isArray(rows) && rows.every(r => r && typeof r === 'object' && !Array.isArray(r))); return rows;
}

// Parent publishes the response atomically to responseRef, never by supplying a
// path to the runner. Echo request verbatim; execute its exact queryRef freshly.
export const MCP_BRIDGE_PROTOCOL = freeze({ version: 2, timeoutMs: 120000,
  pending: 'ATTEMPT/mcp-read-*-*.request.json without the matching .consumed.json',
  responseKeys: ['request', 'executedAt', 'completedAt', 'provenance', 'snapshot'],
  provenance: { kind: 'parent-mediated-mcp', trust: 'trusted-parent-not-cryptographic-proof', tool: 'supabase.execute_sql', executionRef: 'Actual parent MCP invocation/result reference' },
  instructions: 'Echo the entire request object. Use fresh ISO UTC executedAt/completedAt. snapshot is the single SQL result snapshot object, not its rows wrapper. Publish once inside the same attempt; no retry or resume.',
});

export function validateMcpResponse(m, request, response, now = Date.now()) {
  sameKeys(response, MCP_BRIDGE_PROTOCOL.responseKeys);
  assert.deepEqual(response.request, request, 'MCP response request binding mismatch');
  sameKeys(response.provenance, ['kind', 'trust', 'tool', 'executionRef']);
  for (const key of ['kind', 'trust', 'tool']) assert.equal(response.provenance[key], MCP_BRIDGE_PROTOCOL.provenance[key], 'MCP provenance mismatch');
  assert(typeof response.provenance.executionRef === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(response.provenance.executionRef), 'Actual bounded MCP execution reference required');
  const timestamp = value => {
    assert(typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'Canonical ISO UTC timestamp required');
    return Date.parse(value);
  };
  const requested = timestamp(request.requestedAt), executed = timestamp(response.executedAt), completed = timestamp(response.completedAt);
  assert(executed >= requested && completed >= executed && completed <= now && now - requested < MCP_BRIDGE_PROTOCOL.timeoutMs, 'Stale, future or expired MCP response');
  reconcile(m, request.view, response.snapshot, request.stage, request.binding ?? null);
  return response.snapshot;
}

export async function createMcpReadback(input, attempt, options = {}) {
  const m = validateManifest(input), now = options.now ?? Date.now, monotonic = options.monotonic ?? (() => performance.now());
  const wait = options.sleep ?? sleep, record = options.record ?? (async () => {});
  const directory = await lstat(attempt); assert(directory.isDirectory() && !directory.isSymbolicLink(), 'Plain attempt directory required');
  const root = await realpath(attempt);
  await writeFile(path.join(root, 'mcp-bridge.json'), JSON.stringify({ version: 2, runId: m.runId, project: m.project, commit: m.commit,
    provenance: MCP_BRIDGE_PROTOCOL.provenance, resumed: false }), { flag: 'wx', mode: 0o600 });
  let sequence = 0, busy = false, failed = false;
  async function localBytes(ref) {
    assert(path.basename(ref) === ref, 'Attempt-local filename required');
    assert.equal(await realpath(attempt), root, 'Attempt directory changed');
    const file = path.join(root, ref), info = await lstat(file);
    assert(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= 4194304, 'Plain bounded attempt artifact required');
    assert.equal(await realpath(file), file, 'External artifact path refused');
    const handle = await open(file, 'r');
    try {
      const stat = await handle.stat(); assert(stat.isFile() && stat.nlink === 1 && stat.size <= 4194304, 'Invalid response artifact');
      const bytes = await handle.readFile(); assert(bytes.length <= 4194304, 'Oversized response'); return bytes;
    } finally { await handle.close(); }
  }
  return async (c, stage, binding = null) => {
    assert(!failed, 'MCP bridge closed after failure; no resume');
    if (busy) { failed = true; throw new Error('Concurrent MCP read refused; bridge closed'); }
    busy = true;
    try {
      assert.deepEqual(c, selected(m, c.viewport)); assert(STAGES.includes(stage), 'Exact readback stage required'); validateBinding(m, c, binding);
      const start = monotonic(), sql = readbackSql(m, c.viewport, binding), nonce = randomUUID();
      const stem = `mcp-read-${String(++sequence).padStart(4, '0')}-${nonce}`;
      const request = freeze({ version: 2, kind: 'wms-replenishment-mcp-readback', runId: m.runId, project: m.project, commit: m.commit,
        view: c.viewport, stage, binding: structuredClone(binding), sequence, nonce, querySha256: sha(sql), requestedAt: new Date(now()).toISOString(),
        queryRef: `${stem}.sql`, responseRef: `${stem}.response.json`, consumedRef: `${stem}.consumed.json` });
      const requestRef = `${stem}.request.json`, requestBody = JSON.stringify(request, null, 2);
      await writeFile(path.join(root, request.queryRef), sql, { flag: 'wx', mode: 0o600 });
      const pendingTemp = path.join(root, `${requestRef}.tmp`);
      await writeFile(pendingTemp, requestBody, { flag: 'wx', mode: 0o600 });
      // Atomic publication without replacing an existing request artifact.
      await link(pendingTemp, path.join(root, requestRef)); await unlink(pendingTemp);
      await record({ kind: 'mcp-readback-pending', requestRef, request });
      const checkDeadline = () => {
        assert(!failed, 'MCP bridge closed');
        if (monotonic() - start >= MCP_BRIDGE_PROTOCOL.timeoutMs) throw Object.assign(new Error('MCP readback timeout; no retry or resume'),
          { safeDetails: { category: 'MCP_TIMEOUT', sequence, querySha256: request.querySha256 } });
      };
      for (;;) {
        checkDeadline(); let bytes;
        try { bytes = await localBytes(request.responseRef); }
        catch (error) { if (error.code !== 'ENOENT') throw error; await wait(Math.min(200, MCP_BRIDGE_PROTOCOL.timeoutMs - (monotonic() - start))); continue; }
        assert.equal(sha(await localBytes(request.queryRef)), request.querySha256, 'Published SQL changed');
        assert.equal(sha(await localBytes(requestRef)), sha(requestBody), 'Published request changed');
        const response = JSON.parse(bytes.toString('utf8')); validateMcpResponse(m, request, response, now()); checkDeadline();
        // Durable one-shot consumption precedes return to any business command.
        const consumed = { request, responseSha256: sha(bytes), consumedAt: new Date(now()).toISOString(), provenance: response.provenance };
        await writeFile(path.join(root, request.consumedRef), JSON.stringify(consumed, null, 2), { flag: 'wx', mode: 0o600 });
        await record({ kind: 'parent-mediated-database-read', requestRef, responseRef: request.responseRef, consumedRef: request.consumedRef,
          ...consumed, snapshot: response.snapshot });
        checkDeadline(); return response.snapshot;
      }
    } catch (error) { failed = true; throw error; }
    finally { busy = false; }
  };
}

export async function fillRecommendationForm(dialog, c, step = () => {}) {
  step('recommend.fill-quantity'); await dialog.getByLabel('Recommended quantity', { exact: true }).fill(String(c.quantity));
  step('recommend.fill-planning-days'); await dialog.getByLabel('Planning assumption (days)', { exact: true }).fill(String(c.planningDays));
  step('recommend.fill-rationale'); await dialog.getByRole('textbox', { name: 'Rationale', exact: true }).fill(c.rationale);
}
export async function fillCanonicalWizard(page, m, c, expect, step = () => {}) {
  step('completion.explicit-classification');
  await expect(page.getByRole('heading', { name: 'Draft a purchase request', exact: true })).toBeVisible();
  await page.locator('input[name="category"][value="goods"]').check();
  await page.locator(`input[name="requirement-kind"][value="${c.completion.requirementKind}"]`).check();
  await expect(page.locator('#title')).toHaveValue(`Replenish ${c.productId}`);
  for (const [label, value] of [['description', c.productId], ['quantity', String(c.quantity)], ['unit of measure', 'unit']]) {
    const field = page.locator(`[aria-label="Line 1 ${label}"]:visible`); await expect(field).toHaveCount(1); await expect(field).toHaveValue(value); await expect(field).toHaveAttribute('readonly', '');
  }
  await page.locator('[aria-label="Line 1 unit price"]:visible').fill(String(c.completion.unitPrice));
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  step('completion.funding-and-owned-files');
  await page.locator('select#department').selectOption(c.completion.department);
  await page.locator('select#costCenter').selectOption(c.completion.costCenter);
  await page.locator('#budgetCode').fill(c.completion.budgetCode);
  await page.locator('#neededBy').fill(c.completion.neededBy);
  await expect(page.locator('#need-description')).toHaveValue(c.rationale);
  await expect(page.locator('#need-description')).toHaveAttribute('readonly', '');
  await page.locator('input[type="file"]').setInputFiles(c.documents.map(d => ({ name: d.filename, mimeType: d.mimeType, buffer: syntheticPdf(m.runId, c.viewport, d.kind) })));
  for (const d of c.documents) await page.getByRole('combobox', { name: `Document type for ${d.filename}`, exact: true }).selectOption(d.kind);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  step('completion.review-rfq-terms');
  await expect(page.getByRole('heading', { name: 'RFQ requirements', exact: true })).toBeVisible();
  for (const [key, value] of Object.entries(c.completion.terms)) await page.locator(`#rfq-${key}`).fill(value);
  await expect(page.getByRole('button', { name: 'Save & submit', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create draft & complete handoff', exact: true })).toBeEnabled();
}
export async function verifyDraftLine(page, c, expect) {
  if (c.viewport === 'desktop1440') {
    const line = page.getByRole('row').filter({ has: page.getByRole('cell', { name: c.productId, exact: true }) });
    await expect(line).toHaveCount(1); await expect(line.getByRole('cell', { name: `${c.quantity} unit`, exact: true })).toBeVisible();
  } else {
    const line = page.locator('ul:visible > li > .card').filter({ has: page.getByText(c.productId, { exact: true }) });
    await expect(line).toHaveCount(1);
    const qty = line.locator('dl > div').filter({ has: page.locator('dt').getByText('Qty', { exact: true }) });
    await expect(qty.locator('dd')).toHaveText(`${c.quantity} unit`);
  }
}

export async function captureUiFailure({ m, c, role, page, step, attempt }) {
  const evidence = { step, view: c.viewport, actorId: m.actors[role].id, route: 'other', body: null, screenshot: null };
  try {
    const url = new URL(page.url());
    if (url.origin === m.origin) evidence.route = url.pathname === '/login' ? 'login'
      : url.pathname === `/warehouse/inventory/${encodeURIComponent(c.productId)}` ? 'owned-inventory'
        : url.pathname === '/warehouse/procurement' ? 'warehouse-procurement' : 'other';
    // Structural observations only: no body text, HTML, URL query, field values or credentials.
    evidence.body = await page.evaluate(() => ({ bodyPresent: !!document.body, readyState: document.readyState,
      passwordPresent: !!document.querySelector('input[type="password"]'), dialogCount: document.querySelectorAll('[role="dialog"]').length,
      inputCount: document.querySelectorAll('input,textarea').length }));
    if (evidence.body.passwordPresent || step.startsWith('auth.') || !['owned-inventory', 'warehouse-procurement'].includes(evidence.route)) {
      evidence.captureStatus = 'skipped-sensitive-or-unowned-page'; return evidence;
    }
    let scope;
    if (evidence.route === 'owned-inventory') {
      scope = page.getByRole('dialog', { name: 'Recommend replenishment', exact: true });
      if (await scope.getByText(`${c.productName} - ${c.sku}`, { exact: true }).count() !== 1) {
        evidence.captureStatus = 'skipped-unbound-dialog'; return evidence;
      }
    } else scope = page.locator('section[aria-labelledby="replenishment-control-title"] .card')
      .filter({ has: page.getByText(c.productName, { exact: true }) });
    if (await scope.count() !== 1 || !await scope.isVisible()) { evidence.captureStatus = 'skipped-unavailable-owned-surface'; return evidence; }
    const ref = `failure-${c.viewport}-${role}-${randomUUID()}.png`;
    await scope.screenshot({ path: path.join(attempt, ref), timeout: 5000, animations: 'disabled',
      mask: [page.locator('input,textarea,[contenteditable],img,canvas,video,iframe')], maskColor: '#202020' });
    evidence.screenshot = { ref, sha256: sha(await readFile(path.join(attempt, ref))), scope: evidence.route === 'owned-inventory' ? 'owned-recommendation-dialog' : 'owned-replenishment-card', masked: true };
    evidence.captureStatus = 'captured-owned-surface';
  } catch { evidence.captureStatus = 'capture-unavailable'; }
  return evidence;
}

export function createPageErrorMonitor(record) {
  const pages = []; let queue = Promise.resolve(), recordingFailed = false;
  return {
    attach(page, binding) {
      const row = { ...binding, count: 0 }; pages.push(row);
      page.on('pageerror', error => {
        row.count++;
        const event = { kind: 'unhandled-browser-pageerror', ...binding, messageSha256: sha(String(error?.message ?? error)) };
        queue = queue.then(() => record(event)).catch(() => { recordingFailed = true; });
      });
    },
    async finish() {
      await queue;
      const summary = { kind: 'browser-pageerror-summary', scope: 'Unhandled pageerror events only; not console or network errors',
        pages: pages.map(row => ({ ...row })), total: pages.reduce((sum, row) => sum + row.count, 0) };
      await record(summary); assert(!recordingFailed, 'Pageerror evidence persistence failed');
      assert.equal(summary.total, 0, 'Unhandled browser page errors prevent successful signoff'); return summary;
    },
  };
}

async function liveAdapter(m, env, attempt, record, mode) {
  const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
  const rootRequire = createRequire(new URL('../../package.json', import.meta.url));
  const { chromium, expect } = require('@playwright/test');
  const { createClient } = require('@supabase/supabase-js');
  const execute = promisify(execFile), api = `https://${m.project}.supabase.co`;
  const clients = {}, pages = new Map(), contexts = [];
  const pageErrors = createPageErrorMonitor(record);
  let browser, armed, guardError, activeUi, completion, sqlBusy = false, number = 0;
  function step(name, page, c, role) { activeUi = { step: name, page, c, role }; }
  const cliRoot = mode === 'cli' ? await realpath(env.WMS_REPLENISHMENT_CLI_WORKDIR) : null;
  const mcpRead = mode === 'mcp' ? await createMcpReadback(m, attempt, { record }) : null;
  async function checkLink() {
    assert.equal((await readFile(path.join(cliRoot, 'supabase', '.temp', 'project-ref'), 'utf8')).trim(), m.project, 'Linked CLI target mismatch');
  }
  if (mode === 'cli') await checkLink();
  const safeEnv = Object.fromEntries(Object.entries(env).filter(([key, value]) => /^(SYSTEMROOT|WINDIR|COMSPEC|PATH|PATHEXT|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR|USERNAME|COMPUTERNAME|OS)$/i.test(key) && typeof value === 'string'));
  async function read(c, stage, binding = null) {
    assert(!guardError, guardError);
    if (mcpRead) { const snapshot = await mcpRead(c, stage, binding); assert(!guardError, guardError); return snapshot; }
    assert(!sqlBusy, 'Concurrent linked CLI query refused'); sqlBusy = true;
    const sql = readbackSql(m, c.viewport, binding), ref = `query-${++number}-${sha(sql)}.sql`;
    try {
      await checkLink(); await writeFile(path.join(attempt, ref), sql, { flag: 'wx', mode: 0o600 });
      let stdout;
      try {
        ({ stdout } = await execute(process.execPath, [rootRequire.resolve('supabase/dist/supabase.js'), 'db', 'query', '--linked', '--file', path.join(attempt, ref),
          '--workdir', cliRoot, '--output', 'json', '--log-level', 'none'], { cwd: cliRoot, env: safeEnv, encoding: 'utf8', timeout: 60000, maxBuffer: 4194304, windowsHide: true }));
      } catch (error) { throw Object.assign(new Error('Read-only linked CLI query failed; no retry'), { safeDetails: classifyCliFailure(error, sql) }); }
      await checkLink(); let rows;
      try { rows = parseCliRows(stdout); } catch { throw Object.assign(new Error('Read-only CLI result is incomplete or malformed'), { safeDetails: { category: 'OUTPUT', querySha256: sha(sql) } }); }
      assert.equal(rows.length, 1, 'Exactly one snapshot result required'); sameKeys(rows[0], ['snapshot']);
      await record({ kind: 'independent-database-read', view: c.viewport, queryRef: ref, querySha256: sha(sql), snapshot: rows[0].snapshot });
      return rows[0].snapshot;
    } finally { sqlBusy = false; }
  }
  async function actor(role) {
    if (!clients[role]) {
      const client = createClient(api, 'sb_publishable_7YRN3Sg0Cm8QRoDt6IszlA_yAuRD5u9', { auth: { persistSession: false, autoRefreshToken: true },
        global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([AbortSignal.timeout(20000), init?.signal].filter(Boolean)) }) } });
      clients[role] = client;
      const login = await client.auth.signInWithPassword({ email: m.actors[role].email, password: env.AUDIT_PASSWORD });
      assert(!login.error && login.data.user?.id === m.actors[role].id, 'Ordinary API login identity mismatch');
    }
    const client = clients[role], user = await client.auth.getUser();
    assert(!user.error && user.data.user, 'Authenticated actor verification failed');
    const profile = await client.schema('core').from('profiles').select('id,email').eq('id', m.actors[role].id).single();
    const caps = await client.schema('core').rpc('my_capability_snapshot');
    assert(!profile.error && !caps.error, 'Actor profile/capability readback failed');
    return { user: { id: user.data.user.id, email: user.data.user.email }, profile: profile.data, capabilities: caps.data };
  }
  async function pageFor(c, role) {
    const key = `${c.viewport}:${role}`; if (pages.has(key)) return pages.get(key);
    browser ??= await chromium.launch();
    const context = await browser.newContext({ viewport: { width: c.width, height: c.height }, isMobile: c.viewport === 'mobile390', hasTouch: c.viewport === 'mobile390', serviceWorkers: 'block', reducedMotion: 'reduce' });
    contexts.push(context); let token;
    await context.route('**/*', async route => {
      const request = route.request(); if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
      try {
        if (new URL(request.url()).pathname.startsWith('/storage/')) {
          assert(completion && completion.key === key && !completion.busy && !completion.sent, 'Unarmed Storage write');
          completion.busy = true;
          const candidate = await inspectStorageUpload(m, c, role, { method: request.method(), url: request.url(), headers: request.headers(), bytes: request.postDataBuffer() }, token, completion.binding);
          completion.binding ??= { requestId: candidate.requestId, uploads: [], payload: null, route: null };
          await completion.hooks.beforeUpload(structuredClone(completion.binding));
          assertActor(m, role, await actor(role)); assert(!guardError, guardError);
          await record({ kind: 'storage-upload-intent', view: c.viewport, requestId: candidate.requestId, upload: candidate.upload, upsert: false });
          // Fetch once under the route guard, verify durable bytes before releasing
          // the response that lets the app proceed to its next upload/command.
          const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 30000 });
          await record({ kind: 'storage-upload-response', view: c.viewport, actorId: m.actors[role].id, path: candidate.upload.path,
            status: response.status(), source: 'intercepted-browser-upload', automaticRetry: false });
          assert.equal(response.status(), 200, 'Upload outcome uncertain or failed; retain evidence, never retry');
          completion.binding.uploads.push(candidate.upload);
          const download = await clients[role].storage.from(BUCKET).download(candidate.upload.path);
          assert(!download.error && download.data, 'Authenticated owner download failed');
          const bytes = Buffer.from(await download.data.arrayBuffer());
          assert.deepEqual(bytes, syntheticPdf(m.runId, c.viewport, candidate.upload.kind));
          const names = await completePrefixList(clients[role], completion.binding.requestId);
          const proof = { bucket: BUCKET, path: candidate.upload.path, actorId: m.actors[role].id, uploadStatus: response.status(), downloadSha256: sha(bytes),
            downloadSizeBytes: bytes.length, listedNames: names, source: 'authenticated-owner-sdk-download+complete-prefix-list' };
          await completion.hooks.uploaded(structuredClone(completion.binding), proof);
          completion.busy = false; return route.fulfill({ response });
        }
        const body = request.postDataJSON(), schema = request.headers()['content-profile'], name = new URL(request.url()).pathname.split('/').at(-1);
        if (schema === 'procurement' && name === RPC && body?.payload?.action === 'handoff' && completion) {
          assert(completion.key === key && !completion.busy && !completion.sent);
          completion.sent = true;
          sameKeys(body, ['payload']); sameKeys(body.payload, ['id', 'action', 'request']); assert.equal(body.payload.id, completion.recommendationId);
          assertCanonicalPayload(m, c, body.payload.request, completion.binding);
          completion.binding.payload = structuredClone(body.payload.request);
          await completion.hooks.beforeHandoff(structuredClone(completion.binding));
          assert(!guardError, guardError);
          armed = { key, payload: structuredClone(body.payload), consumed: false };
        }
        const kind = authorizeBrowserRequest(m, c, role, { method: request.method(), url: request.url(), headers: request.headers(), body }, armed, token);
        if (kind === 'read' || kind === 'auth') return route.continue();
        if (kind === 'bootstrap') {
          await record({ kind: 'own-learning-bootstrap', view: c.viewport, actorId: m.actors[role].id, schema, rpc: name, parameters: {} }); return route.continue();
        }
        armed.consumed = true;
        await record({ kind: 'browser-command', view: c.viewport, actorId: m.actors[role].id, schema, rpc: name, payload: body.payload });
        return route.continue();
      } catch (error) { guardError = error.message.split('\n')[0]; await record({ kind: 'blocked-browser-mutation', reason: guardError }); return route.abort('blockedbyclient'); }
    });
    const page = await context.newPage(); pageErrors.attach(page, { view: c.viewport, actorId: m.actors[role].id }); page.setDefaultTimeout(30000);
    step('auth.navigate', page, c, role); await page.goto(`${m.origin}/login?redirect=%2Fwarehouse%2Finventory`);
    step('auth.fill-email', page, c, role); await page.locator('#email').fill(m.actors[role].email);
    step('auth.fill-password', page, c, role); await page.locator('#password').fill(env.AUDIT_PASSWORD);
    const loginWait = page.waitForResponse(r => r.request().method() === 'POST' && r.url() === `${api}/auth/v1/token?grant_type=password`);
    const userWait = page.waitForResponse(r => r.request().method() === 'GET' && r.url() === `${api}/auth/v1/user`);
    loginWait.catch(() => {}); userWait.catch(() => {});
    step('auth.submit', page, c, role); await page.getByRole('button', { name: /^sign in$/i }).click();
    step('auth.verify-identity', page, c, role);
    const login = await loginWait; assert.equal(login.status(), 200); const session = await login.json();
    assert.equal(session.user?.id, m.actors[role].id); assert(typeof session.access_token === 'string' && session.access_token.length > 0); token = session.access_token;
    const verified = await userWait; assert.equal(verified.status(), 200); assert.equal((await verified.json()).id, m.actors[role].id);
    assert.equal((await verified.request().allHeaders()).authorization, `Bearer ${token}`);
    await page.waitForURL(url => url.pathname !== '/login');
    assert(!guardError, guardError); await record({ kind: 'browser-identity', view: c.viewport, actorId: m.actors[role].id, source: 'password-login+auth.getUser' });
    pages.set(key, page); return page;
  }
  async function ownedCard(page, c) {
    const section = page.locator('section[aria-labelledby="replenishment-control-title"]');
    const card = section.locator('.card').filter({ has: page.getByText(c.productName, { exact: true }) });
    await expect(card).toHaveCount(1); return card;
  }
  async function completePrefixList(client, requestId) {
    assert(validRequestId(requestId)); const names = [];
    for (let offset = 0; offset <= 1000; offset += 100) {
      const result = await client.storage.from(BUCKET).list(`request/${requestId}`, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
      assert(!result.error && Array.isArray(result.data), 'Complete authenticated prefix list required');
      for (const row of result.data) { assert(UUID.test(row.id) && typeof row.name === 'string' && !row.name.includes('/')); names.push(row.name); }
      if (result.data.length < 100) { assert.equal(new Set(names).size, names.length); return names; }
    }
    throw new Error('Prefix inventory exceeds bounded owned scope');
  }
  return {
    kind: mode === 'mcp' ? 'ordinary-user-ui+trusted-parent-mediated-mcp' : 'ordinary-user-ui+independent-readonly-cli', record, read, actor,
    health: async () => { const r = await fetch(`${m.origin}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(20000) }); assert(r.ok, 'UAT health unavailable'); return r.json(); },
    command: async (c, role, action, payload) => {
      const page = await pageFor(c, role); assert(!guardError, guardError); let button;
      if (action === 'recommend') {
        step('recommend.navigate-product', page, c, role);
        await page.goto(`${m.origin}/warehouse/inventory/${encodeURIComponent(c.productId)}`);
        step('recommend.verify-product', page, c, role);
        await expect(page.getByRole('heading', { name: c.productName, exact: true })).toBeVisible();
        step('recommend.open-sheet', page, c, role);
        await page.getByRole('button', { name: 'Recommend replenishment', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Recommend replenishment' });
        step('recommend.verify-empty-status', page, c, role);
        await expect(dialog.getByText('No active recommendation', { exact: true })).toBeVisible();
        await fillRecommendationForm(dialog, c, name => step(name, page, c, role));
        button = dialog.getByRole('button', { name: 'Save recommendation', exact: true });
      } else {
        step(`${action}.navigate-procurement`, page, c, role);
        await page.goto(`${m.origin}/warehouse/procurement`);
        step(`${action}.verify-owned-card`, page, c, role);
        const card = await ownedCard(page, c);
        await expect(card.getByText(action === 'accept' ? 'recommended' : 'accepted', { exact: true })).toBeVisible();
        button = card.getByRole('button', { name: action === 'accept' ? 'Accept' : 'Hand off to Procurement', exact: true });
      }
      assert(!guardError, guardError); armed = { key: `${c.viewport}:${role}`, payload: structuredClone(payload), consumed: false };
      const waiting = page.waitForResponse(r => r.request().method() === 'POST' && r.url() === `${api}/rest/v1/rpc/${RPC}`, { timeout: 600000 }); waiting.catch(() => {});
      try {
        step(`${action}.submit`, page, c, role); await button.click();
        step(`${action}.response`, page, c, role); const response = await waiting;
        assert(!guardError, guardError); assert(armed.consumed, 'No exact UI command captured');
        const data = await response.json(); await record({ kind: 'browser-response', view: c.viewport, actorId: m.actors[role].id, action, status: response.status(), data });
        assert(response.ok(), 'UI RPC failed; inspect retained response, no retry');
        step(`${action}.verify-saved-status`, page, c, role);
        if (action === 'recommend') await expect(page.getByText('Recommendation saved', { exact: true })).toBeVisible();
        else await expect((await ownedCard(page, c)).getByText(action === 'accept' ? 'accepted' : 'handed_off', { exact: true })).toBeVisible();
        return { data, error: null };
      } finally { armed = undefined; }
    },
    complete: async (c, role, recommendationId, hooks) => {
      assert.equal(role, ROLES[1]); assert(!completion, 'No completion replay');
      const page = await pageFor(c, role); step('completion.open-wizard', page, c, role);
      const card = await ownedCard(page, c), link = card.getByRole('link', { name: 'Complete Procurement request', exact: true });
      await expect(link).toHaveAttribute('href', `/procurement/requests/new?replenishment=${recommendationId}`); await link.click();
      await page.waitForURL(url => url.origin === m.origin && url.pathname === '/procurement/requests/new' && url.search === `?replenishment=${recommendationId}`);
      await fillCanonicalWizard(page, m, c, expect, name => step(name, page, c, role));
      const ref = `${c.viewport}-canonical-wizard-before-upload.png`;
      const geometry = await captureCheckpointViewport(page, path.join(attempt, ref));
      await record({ kind: 'wizard-inputs-before-upload', view: c.viewport, actorId: m.actors[role].id, recommendationId,
        screenshot: { ref, sha256: sha(await readFile(path.join(attempt, ref))), ...geometry, reviewed: false } });
      completion = { key: `${c.viewport}:${role}`, recommendationId, hooks, binding: null, busy: false, sent: false };
      const waiting = page.waitForResponse(r => r.request().method() === 'POST' && r.url() === `${api}/rest/v1/rpc/${RPC}`, { timeout: 600000 }); waiting.catch(() => {});
      try {
        step('completion.submit-draft-only', page, c, role); await page.getByRole('button', { name: 'Create draft & complete handoff', exact: true }).click();
        step('completion.canonical-response', page, c, role); const response = await waiting;
        assert(!guardError, guardError); assert(completion.sent && armed?.consumed); const data = await response.json();
        await record({ kind: 'browser-response', view: c.viewport, actorId: m.actors[role].id, action: 'canonical-handoff', status: response.status(), data });
        assert(response.ok(), 'Canonical handoff failed; no retry'); assert.equal(data.procurement_request_id, completion.binding.requestId);
        await page.waitForURL(url => url.origin === m.origin && url.pathname === `/procurement/requests/${completion.binding.requestId}`);
        return { data, error: null };
      } finally { completion = undefined; armed = undefined; }
    },
    negative: async (c, role, payload, stage, binding) => {
      const s = await read(c, stage, binding), r = s.rows.recommendations[0]; assert(r && UUID.test(r.id));
      if (payload.action === 'recommend') assert.deepEqual(payload, recommendationPayload(c));
      else { sameKeys(payload, ['id', 'action']); assert.equal(payload.id, r.id); assert(['accept', 'handoff'].includes(payload.action)); }
      const result = await clients[role].schema('procurement').rpc(RPC, { payload });
      await record({ kind: 'negative-rpc-response', view: c.viewport, actorId: m.actors[role].id, payload,
        data: result.data, error: result.error ? { code: result.error.code, message: result.error.message } : null });
      return result;
    },
    confirmRoute: async (c, role, payload) => {
      const page = await pageFor(c, role); assert.equal(role, ROLES[1]);
      assert(validRequestId(payload.request_id)); assert.deepEqual(payload, { request_id: payload.request_id, expected_route_version: 0, requested_mode: 'competitive_bidding' });
      assert.equal(new URL(page.url()).pathname, `/procurement/requests/${payload.request_id}`);
      armed = { key: `${c.viewport}:${role}`, rpc: 'confirm_route_decision', payload: structuredClone(payload), consumed: false };
      const waiting = page.waitForResponse(r => r.request().method() === 'POST' && r.url() === `${api}/rest/v1/rpc/confirm_route_decision`); waiting.catch(() => {});
      try {
        step('route.confirm-separately', page, c, role); await page.getByRole('button', { name: 'Confirm procurement route', exact: true }).click();
        const response = await waiting; assert(!guardError, guardError); assert(armed.consumed); const data = await response.json();
        await record({ kind: 'browser-response', view: c.viewport, actorId: m.actors[role].id, action: 'confirm-route', status: response.status(), data });
        assert(response.ok(), 'Route confirmation failed; do not replay');
        step('route.verify-still-draft', page, c, role); await expect(page.getByLabel('Confirmed procurement route', { exact: true })).toBeVisible();
        await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();
        return { data, error: null };
      } finally { armed = undefined; }
    },
    negativeRoute: async (c, role, payload) => {
      assert.equal(role, ROLES[1]); assert(validRequestId(payload.request_id));
      assert.deepEqual(payload, { request_id: payload.request_id, expected_route_version: 0, requested_mode: 'competitive_bidding' });
      const result = await clients[role].schema('procurement').rpc('confirm_route_decision', { payload });
      await record({ kind: 'negative-rpc-response', view: c.viewport, actorId: m.actors[role].id, rpc: 'confirm_route_decision', payload,
        data: result.data, error: result.error ? { code: result.error.code, message: result.error.message } : null }); return result;
    },
    openRequest: async (c, role, request) => {
      const page = await pageFor(c, role); step('draft.verify-link', page, c, role); await page.goto(`${m.origin}/warehouse/procurement`); const card = await ownedCard(page, c);
      const link = card.getByRole('link', { name: 'Open Procurement request', exact: true });
      const destination = `/procurement/requests/${request.id}`; await expect(link).toHaveAttribute('href', destination);
      step('draft.open-link', page, c, role); await link.click(); await page.waitForURL(url => url.origin === m.origin && url.pathname === destination);
      step('draft.verify-content', page, c, role);
      await expect(page.getByRole('heading', { name: request.title, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Line items', exact: true })).toBeVisible();
      await verifyDraftLine(page, c, expect);
      await expect(page.getByText(/legacy request is missing its requirement classification/i)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Confirm procurement route', exact: true })).toBeVisible();
      await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();
      assert(!guardError, guardError);
      step('draft.ordinary-readback', page, c, role);
      const own = await clients[role].schema('procurement').from('requests').select('*').eq('id', request.id).single();
      assert(!own.error); assert.deepEqual(own.data, request, 'Ordinary requester read differs from independent draft');
      await record({ kind: 'ordinary-draft-read', view: c.viewport, actorId: m.actors[role].id, row: own.data });
      return { requestId: request.id, path: destination, actorId: m.actors[role].id };
    },
    capture: async (c, role, stage) => {
      assert(!guardError, guardError); const page = await pageFor(c, role), ref = `${c.viewport}-${stage}.png`;
      step(`checkpoint.${stage}`, page, c, role);
      const geometry = await captureCheckpointViewport(page, path.join(attempt, ref));
      return { ref, sha256: sha(await readFile(path.join(attempt, ref))), ...geometry, actorId: m.actors[role].id, reviewed: false };
    },
    diagnose: async error => {
      if (!activeUi) return { status: 'no-browser-step', screenshot: null };
      const evidence = await captureUiFailure({ m, attempt, ...activeUi });
      await record({ kind: 'ui-failure-diagnostic', ...evidence, errorMessageSha256: sha(String(error.message)) }); return evidence;
    },
    close: async () => {
      try { await browser?.close(); const summary = await pageErrors.finish(); assert(!guardError, guardError); return summary; }
      finally { for (const client of Object.values(clients)) client.auth.stopAutoRefresh(); }
    },
  };
}

export async function run(folder, env = process.env, apply = false, mode = 'cli') {
  folder = await realpath(folder); const m = validateManifest(JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8')));
  assertRunPermission(m, env, apply, mode);
  for (const c of m.cases) for (const d of c.documents) {
    const file = path.join(folder, d.filename), info = await lstat(file);
    assert(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size === d.sizeBytes, 'Plain prepared PDF fixture required');
    assert.deepEqual(await readFile(file), syntheticPdf(m.runId, c.viewport, d.kind), 'Prepared PDF changed');
  }
  const lockPath = path.join(folder, 'run.lock'), lock = await open(lockPath, 'wx');
  const attempt = path.join(folder, `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  const report = newReport(m, mode === 'mcp' ? 'ordinary-user-ui+trusted-parent-mediated-mcp' : 'ordinary-user-ui+independent-readonly-cli'); let index = 0;
  report.readbackMode = mode;
  if (mode === 'mcp') report.readbackTrust = MCP_BRIDGE_PROTOCOL;
  const persist = () => writeFile(path.join(attempt, 'results.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  let queue = Promise.resolve();
  const record = async value => {
    const ref = `event-${String(++index).padStart(4, '0')}.json`, body = JSON.stringify({ recordedAt: new Date().toISOString(), ...value }, null, 2);
    queue = queue.then(async () => { await writeFile(path.join(attempt, ref), body, { flag: 'wx', mode: 0o600 });
      report.artifacts ??= []; report.artifacts.push({ ref, sha256: sha(body) }); await persist(); });
    return queue;
  };
  try {
    await mkdir(attempt); await writeFile(path.join(attempt, 'manifest.json'), JSON.stringify(m, null, 2), { flag: 'wx' });
    const sourceFiles = ['scripts/qa/wms-replenishment-signoff-live.mjs', 'scripts/qa/wms-ecommerce-signoff-live.mjs', 'scripts/qa/uat-audit-identities.mjs',
      'scripts/qa/live-e2e-scenarios.mjs', 'scripts/qa/wms-signoff-contract.mjs', 'modules/warehouse/src/components/InventoryRecommendationAction.tsx',
      'modules/warehouse/src/components/ReplenishmentControlPanel.tsx', 'modules/procurement/src/localStore.ts', 'modules/procurement/src/pages/RequestDetailPage.tsx',
      'modules/procurement/src/pages/CreateRequestPage.tsx', 'modules/procurement/src/replenishmentRequest.ts', 'modules/procurement/src/attachments.ts',
      'modules/procurement/src/policyRoute.ts', 'modules/procurement/src/policyProfile.ts',
      `supabase/migrations/${m.database.migrationVersion}_govern_replenishment_request_completion.sql`,
      'supabase/migrations/20260710041319_govern_procurement_attachments.sql', 'supabase/migrations/20260815154702_procurement_finance_requester_privacy.sql',
      'supabase/migrations/20260816223000_deduplicate_procurement_intake_collaborators.sql',
      'supabase/migrations/20260816183000_reconcile_launch_authority_and_learning.sql', 'supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql',
      'supabase/migrations/20260911080134_restore_ownerless_commitment_readiness.sql', 'supabase/migrations/20260717143000_task3_receipt_authority_forward_convergence.sql',
      'supabase/migrations/20260804201000_fix_replenishment_procurement_handoff.sql',
      'supabase/migrations/20260813203240_task_1_database_authority_remediation.sql', 'supabase/migrations/20260913175711_align_replenishment_action_authority_and_snapshot.sql'];
    report.sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async ref => [ref, sha(await readFile(new URL(`../../${ref}`, import.meta.url)))])));
    report.deployedSourceChecks = [];
    for (const ref of sourceFiles.filter(ref => ref.startsWith('modules/') || ref.startsWith('supabase/'))) {
      const { stdout } = await promisify(execFile)('git', ['show', `${m.commit}:${ref}`], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', maxBuffer: 4194304, windowsHide: true });
      const local = await readFile(new URL(`../../${ref}`, import.meta.url), 'utf8');
      assert.equal(sha(local.replaceAll('\r\n', '\n')), sha(stdout.replaceAll('\r\n', '\n')), 'Local reviewed application/schema source differs from selected deployed commit');
      report.deployedSourceChecks.push({ ref, commit: m.commit, normalizedSha256: sha(stdout.replaceAll('\r\n', '\n')) });
    }
    await persist();
    await executeJourney(m, await liveAdapter(m, env, attempt, record, mode), report);
  } catch (error) {
    report.complete = false;
    if (!report.failures.length) report.failures.push({ message: error.message.split('\n')[0], ...(error.safeDetails ? { details: error.safeDetails } : {}) });
  } finally {
    report.finishedAt = new Date().toISOString();
    try { await queue.catch(() => {}); await persist(); await writeFile(path.join(attempt, 'cleanup-inventory.sql'), cleanupInventorySql(m), { flag: 'wx' }); }
    finally { await lock.close(); await unlink(lockPath); }
  }
  return { attempt, report };
}
export async function main(args) {
  const [command, folder, ...options] = args; assert(folder, 'Folder required');
  if (command === 'prepare') {
    assert(options.length === 8 || options.length === 10, 'prepare NEW_FOLDER --commit SHA --bindings FILE --completion FILE --database FILE [--run-id NEW_UUID]');
    const flags = {}; for (let i = 0; i < options.length; i += 2) { assert(['--commit', '--bindings', '--completion', '--database', '--run-id'].includes(options[i]) && !flags[options[i]] && options[i + 1]); flags[options[i]] = options[i + 1]; }
    assert(flags['--commit'] && flags['--bindings'] && flags['--completion'] && flags['--database']);
    const m = await prepare(folder, { commit: flags['--commit'], bindings: JSON.parse(await readFile(flags['--bindings'], 'utf8')),
      completion: JSON.parse(await readFile(flags['--completion'], 'utf8')), database: JSON.parse(await readFile(flags['--database'], 'utf8')),
      ...(flags['--run-id'] ? { runId: flags['--run-id'] } : {}) });
    return { folder: path.resolve(folder), runId: m.runId, preparedOffline: true, seeded: false };
  }
  assert(command === 'run' && options[0] === '--apply' && (options.length === 1 || options.length === 3 && options[1] === '--readback' && ['cli', 'mcp'].includes(options[2])),
    'run FOLDER --apply [--readback cli|mcp]; no seeding, cleanup or resume command');
  const { attempt, report } = await run(folder, process.env, true, options[2] ?? 'cli');
  if (!report.complete) process.exitCode = 1;
  return { attempt, complete: report.complete, cleanup: report.cleanup, failures: report.failures };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(result => console.log(JSON.stringify(result, null, 2))).catch(() => {
    console.error('Replenishment command failed. Check arguments, permissions and retained attempt artifacts. No automatic retry.'); process.exitCode = 1;
  });
}
