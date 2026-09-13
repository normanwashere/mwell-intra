import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditPersonas } from './uat-audit-identities.mjs';

const PROJECT = 'kkoitlvydytdhlpxhuah';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export const ROLE_ROSTER = freeze([
  { key: 'op', warehouseRoles: ['warehouse_operator'] },
  { key: 'sup', warehouseRoles: ['warehouse_supervisor'] },
  { key: 'log', warehouseRoles: ['logistics_supervisor'] },
  { key: 'ops', warehouseRoles: ['operations'] },
  { key: 'price', warehouseRoles: ['pricing'] },
  { key: 'admin', warehouseRoles: ['warehouse_admin'] },
  { key: 'multi', warehouseRoles: ['warehouse_operator', 'warehouse_supervisor'] },
]);
const sha = value => createHash('sha256').update(value).digest('hex');
const sql = value => `'${String(value).replaceAll("'", "''")}'`;
const exactKeys = (value, keys) => {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Object required');
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'Unknown/missing fields; credentials are not accepted');
};
const approval = ref => assert(typeof ref === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(ref), 'Explicit simple approval reference required');

export function createRoleManifest(options) {
  assert(options && typeof options === 'object' && !Array.isArray(options));
  const { runId, buildId, effectiveFrom, baseline = null, departments = Object.fromEntries(ROLE_ROSTER.map(r => [r.key, null])) } = options;
  for (const key of Object.keys(options)) assert(['runId', 'buildId', 'effectiveFrom', 'baseline', 'departments'].includes(key), 'Unknown option; no credentials or target overrides');
  assert(UUID.test(runId), 'Explicit full run UUID required');
  assert(typeof buildId === 'string' && /^[a-f0-9]{40}$/.test(buildId), 'Explicit reviewed build SHA required');
  assert(typeof effectiveFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)
    && Number.isFinite(Date.parse(effectiveFrom)) && new Date(effectiveFrom).toISOString().slice(0, 10) === effectiveFrom, 'Explicit valid effective date required');
  if (baseline !== null) {
    exactKeys(baseline, ['roles', 'approvalRef']); assert.deepEqual(baseline.roles, ['staff'], 'Only explicitly approved core.staff baseline supported'); approval(baseline.approvalRef);
  }
  exactKeys(departments, ROLE_ROSTER.map(r => r.key));
  for (const department of Object.values(departments)) if (department !== null) {
    exactKeys(department, ['id', 'code', 'approvalRef']); assert(UUID.test(department.id), 'Approved department UUID required');
    assert(typeof department.code === 'string' && /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)*$/.test(department.code) && department.code.length <= 120, 'Invalid department code');
    approval(department.approvalRef);
  }
  const namespace = `wms.roles.${runId}.`;
  return freeze({ version: 1, kind: 'wms-role-provision-plan', project: PROJECT, environment: 'uat',
    origin: 'https://mwell-intra-uat.vercel.app', runId, buildId, effectiveFrom, namespace, baseline: structuredClone(baseline),
    identities: ROLE_ROSTER.map(r => ({ key: r.key, warehouseRoles: [...r.warehouseRoles], email: `${namespace}${r.key}@mwell.com.ph`,
      fullName: `Synthetic WMS role ${runId} ${r.key}`, authUserId: null, department: structuredClone(departments[r.key]) })) });
}

export function validateRoleManifest(input) {
  const expected = createRoleManifest({ runId: input?.runId, buildId: input?.buildId, effectiveFrom: input?.effectiveFrom,
    baseline: input?.baseline, departments: Object.fromEntries((input?.identities ?? []).map(i => [i.key, i.department])) });
  assert.deepEqual(input, expected, 'Manifest roster/namespace/target changed');
  return expected;
}

const REVIEWS = freeze([
  'Parent approval of seven new identities, core baseline, existing active departments, member scopes and effective date; approval references are not independently verified by this generator.',
  'Independent live connection identity and exact UAT build verification. SQL target literals are expected values, not proof of the connected project.',
  'Fresh collision preflight immediately before any future Auth creation; stop on any match, including unexpected same-run namespace identities. A saved snapshot is not a concurrency fence.',
  'Review installed Auth/profile/role/scope triggers, functions, constraints, RLS and defaults. Unknown automatic profile creation or grant side effects must block, not trigger an upsert/reconciliation.',
  'Separately approve Auth enrollment, secure credential delivery and email confirmation policy. No password or email_confirm flag is generated.',
  'Bind returned Auth UUIDs only from successful NEW account creation. Assert each is absent from pre-existing identity snapshots and from all core profiles/roles/scopes before core inserts. Unexpected auto-created rows require review.',
  'Review new-account-only claim synchronization and fresh-session postconditions. Existing core.sync_user_role_claims updates Auth metadata; it is not executed or silently treated as an insert here.',
  'Preserve all existing identity/grant/department-scope rows; compare exact checkpoint-v1 snapshots before/after. Never retire obsolete users or reconcile the existing roster.',
  'Complete ordinary governed onboarding and user-session capability/UI/RPC tests. No learning, certification, emergency-exception, auth impersonation or SMTP-delivery bypass is planned.',
  'Review recovery for partial Auth/core creation before provisioning. Do not retry account creation on ambiguity; stop and inspect. This plan implements neither live execution nor automatic cleanup.',
]);

function preflightSql(m) {
  const candidates = m.identities.map((i, ordinal) => `(${ordinal},${sql(i.key)},${sql(i.email)},${i.department ? `${sql(i.department.id)}::uuid,${sql(i.department.code)}` : 'null::uuid,null::text'})`).join(',\n');
  const roles = [['core', 'staff'], ...[...new Set(ROLE_ROSTER.flatMap(r => r.warehouseRoles))].map(r => ['warehouse', r])];
  const protectedEmails = auditPersonas('checkpoint-v1').map(p => sql(p.email.toLowerCase())).join(',');
  const namespace = `left(lower(btrim(email)),${m.namespace.length})=${sql(m.namespace)}`;
  return `-- OFFLINE GENERATED READBACK ONLY. Expected UAT ${PROJECT}; independently verify the connection.
-- No credential columns. No provisioning permission or writer fence is established by this query.
begin read only;
set local row_security=off;
set local statement_timeout='30s';
set local lock_timeout='1s';
with candidates(ordinal,key,email,department_id,department_code) as (values ${candidates}),
required_roles(module,role) as (values ${roles.map(([module, role]) => `(${sql(module)},${sql(role)})`).join(',')}),
protected as (select id from core.profiles where lower(btrim(email)) in (${protectedEmails}))
select jsonb_build_object(
 'version',1,'kind','wms-role-preflight','project',${sql(PROJECT)},'runId',${sql(m.runId)},'buildId',${sql(m.buildId)},
 'manifestSha256',${sql(sha(JSON.stringify(m)))},'observedAt',clock_timestamp(),
 'candidates',(select jsonb_agg(jsonb_build_object('key',c.key,
   'authCollisions',(select count(*) from auth.users u where lower(btrim(u.email))=c.email),
   'profileCollisions',(select count(*) from core.profiles p where lower(btrim(p.email))=c.email)) order by c.ordinal) from candidates c),
 'namespaceAuthCount',(select count(*) from auth.users where ${namespace}),
 'namespaceProfileCount',(select count(*) from core.profiles where ${namespace}),
 'roles',(select jsonb_agg(jsonb_build_object('module',r.module,'role',r.role,'activeMatches',
   (select count(*) from core.roles x where x.module=r.module and x.role=r.role and x.is_active)) order by r.module,r.role) from required_roles r),
 'departments',(select jsonb_agg(jsonb_build_object('key',c.key,'id',c.department_id,'code',c.department_code,'activeMatches',
   (select count(*) from core.departments d where d.id=c.department_id and d.code=c.department_code and d.is_active)) order by c.ordinal) from candidates c),
 'protectedProfiles',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'kind',p.kind,'status',p.status) order by p.id),'[]'::jsonb)
   from core.profiles p where p.id in (select id from protected)),
 'protectedRoles',(select coalesce(jsonb_agg(to_jsonb(r) order by r.user_id,r.module,r.role),'[]'::jsonb) from core.user_roles r where r.user_id in (select id from protected)),
 'protectedScopes',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'profile_id',s.profile_id,'department_id',s.department_id,'scope_type',s.scope_type,
   'effective_from',s.effective_from,'effective_to',s.effective_to) order by s.id),'[]'::jsonb) from core.profile_department_scopes s where s.profile_id in (select id from protected)),
 'columns',(select coalesce(jsonb_agg(jsonb_build_object('schema',table_schema,'table',table_name,'column',column_name,'type',data_type,'nullable',is_nullable,'default',column_default)
   order by table_schema,table_name,ordinal_position),'[]'::jsonb) from information_schema.columns
   where (table_schema='core' and table_name in ('profiles','roles','user_roles','departments','profile_department_scopes')) or (table_schema='auth' and table_name='users' and column_name in ('id','email'))),
 'constraints',(select coalesce(jsonb_agg(jsonb_build_object('table',c.conrelid::regclass::text,'name',c.conname,'definition',pg_catalog.pg_get_constraintdef(c.oid)) order by c.conrelid,c.conname),'[]'::jsonb)
   from pg_catalog.pg_constraint c where c.conrelid in ('auth.users'::regclass,'core.profiles'::regclass,'core.roles'::regclass,'core.user_roles'::regclass,'core.departments'::regclass,'core.profile_department_scopes'::regclass)),
 'triggers',(select coalesce(jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'enabled',t.tgenabled,
   'definition',pg_catalog.pg_get_triggerdef(t.oid),'function',t.tgfoid::regprocedure::text,'functionDefinition',pg_catalog.pg_get_functiondef(t.tgfoid)) order by t.tgrelid,t.tgname),'[]'::jsonb)
   from pg_catalog.pg_trigger t where not t.tgisinternal and t.tgrelid in ('auth.users'::regclass,'core.profiles'::regclass,'core.user_roles'::regclass,'core.profile_department_scopes'::regclass))
) as preflight;
commit;
`;
}

export function generateRolePlan(input) {
  const m = validateRoleManifest(input);
  const unresolvedDecisions = [!m.baseline && 'core baseline role approval', ...m.identities.filter(i => !i.department).map(i => `department approval: ${i.key}`)].filter(Boolean);
  const intendedInserts = m.identities.map(i => {
    const id = `$new-auth-user:${i.key}`;
    return { key: i.key,
      authCreate: { transport: 'review-required-auth-admin-create', email: i.email, fullName: i.fullName, credentialsIncluded: false,
        kind: 'employee', roleClaims: m.baseline ? { core: m.baseline.roles, warehouse: i.warehouseRoles } : null },
      profile: { id, email: i.email, full_name: i.fullName, title: `Synthetic WMS ${i.key}`, kind: 'employee', vendor_id: null, status: 'active' },
      warehouseRoleRows: i.warehouseRoles.map(role => ({ user_id: id, module: 'warehouse', role })),
      baselineRoleRows: m.baseline ? m.baseline.roles.map(role => ({ user_id: id, module: 'core', role })) : null,
      profileDepartmentScope: i.department ? { profile_id: id, department_id: i.department.id, scope_type: 'member', effective_from: m.effectiveFrom, effective_to: null } : null,
      preconditions: ['Auth email and UUID newly created for this manifest only', 'No matching profile/role/scope exists', 'Plain insert only; any conflict stops the whole attempt'],
    };
  });
  const preflight = preflightSql(m);
  return { version: 1, kind: 'wms-role-insert-review', project: PROJECT, runId: m.runId, buildId: m.buildId,
    manifestSha256: sha(JSON.stringify(m)), executable: false, liveProvisioningPerformed: false,
    unresolvedDecisions, intendedInserts, requiredReviews: [...REVIEWS], preflightSql: preflight, preflightSqlSha256: sha(preflight),
    allowedNewCoreTables: ['core.profiles', 'core.user_roles', 'core.profile_department_scopes'],
    sourceBasis: ['supabase/migrations/20260706090000_core_schema_identity.sql', 'supabase/migrations/20260706090100_core_rbac.sql',
      'supabase/migrations/20260714175057_core_organization_extensibility.sql', 'scripts/qa/provision-uat-intra-test-users.mjs'],
    limits: ['Profile employee/active and member scope follow existing schema/provisioner patterns, subject to explicit parent review.',
      'No direct Auth SQL, existing-account changes, upserts, deletion, department creation, role-registry changes or onboarding writes.',
      'Checkpoint-v1 snapshot protects that known roster, not a universal snapshot of all UAT users. Future executor must accept only newly returned Auth IDs.',
      'Catalog output is for independent review, not an automatically approved schema allowlist. Unhandled constraints/triggers/defaults remain blocking.',
      'Absent or stale observations never authorize execution. No executor, credentials, secret reads, network client or CI dispatch is implemented.'],
  };
}

export function assessRolePreflight(input, result) {
  const m = validateRoleManifest(input);
  for (const [key, value] of Object.entries({ version: 1, kind: 'wms-role-preflight', project: PROJECT, runId: m.runId, buildId: m.buildId,
    manifestSha256: sha(JSON.stringify(m)) })) assert.equal(result?.[key], value, `Preflight ${key} mismatch`);
  assert(typeof result.observedAt === 'string' && Number.isFinite(Date.parse(result.observedAt)), 'Observation timestamp required');
  const count = value => assert(Number.isSafeInteger(value) && value >= 0, 'Complete numeric count required');
  assert.equal(result.candidates?.length, 7); assert.deepEqual(result.candidates.map(r => r.key), m.identities.map(i => i.key));
  for (const r of result.candidates) { count(r.authCollisions); count(r.profileCollisions); }
  count(result.namespaceAuthCount); count(result.namespaceProfileCount);
  const collisionFree = result.namespaceAuthCount === 0 && result.namespaceProfileCount === 0 && result.candidates.every(r => r.authCollisions === 0 && r.profileCollisions === 0);
  const expectedRoles = ['core:staff', ...[...new Set(ROLE_ROSTER.flatMap(r => r.warehouseRoles))].map(r => `warehouse:${r}`)].sort();
  assert(Array.isArray(result.roles)); assert.deepEqual(result.roles.map(r => `${r.module}:${r.role}`).sort(), expectedRoles);
  for (const r of result.roles) count(r.activeMatches);
  assert.equal(result.departments?.length, 7);
  for (const [index, row] of result.departments.entries()) {
    const i = m.identities[index]; assert.equal(row.key, i.key); assert.equal(row.id, i.department?.id ?? null); assert.equal(row.code, i.department?.code ?? null); count(row.activeMatches);
  }
  for (const key of ['protectedProfiles', 'protectedRoles', 'protectedScopes', 'columns', 'constraints', 'triggers']) assert(Array.isArray(result[key]), `Missing ${key} inventory`);
  assert(result.columns.length > 0 && result.constraints.length > 0, 'Catalog inventory missing');
  return { collisionFree, catalogCandidatesMatch: result.roles.every(r => r.activeMatches === 1) && result.departments.every(r => r.activeMatches === 1),
    protectedProfileCount: result.protectedProfiles.length, unresolvedDecisions: generateRolePlan(m).unresolvedDecisions,
    executable: false, observedAt: result.observedAt, remainingReviews: [...REVIEWS],
    note: 'Assessment of supplied readback only; this does not authenticate its origin, approve catalog branches or establish fresh concurrency isolation.' };
}

export async function writeRolePlan(directory, options) {
  const manifest = createRoleManifest(options); const plan = generateRolePlan(manifest);
  const root = path.resolve(directory); await mkdir(root, { recursive: false });
  for (const [name, body] of [['manifest.json', JSON.stringify(manifest, null, 2)], ['plan.json', JSON.stringify(plan, null, 2)], ['preflight.sql', plan.preflightSql]]) {
    await writeFile(path.join(root, name), body, { flag: 'wx' });
  }
  return { directory: root, runId: manifest.runId, manifestSha256: plan.manifestSha256, preflightSqlSha256: plan.preflightSqlSha256, executable: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, first, second, ...extra] = process.argv.slice(2);
    assert(!extra.length && first && second && ['prepare', 'assess'].includes(command),
      'Usage: prepare NEW_DIRECTORY OPTIONS_JSON | assess MANIFEST_JSON SAVED_PREFLIGHT_JSON (offline only)');
    const load = async file => { const bytes = await readFile(path.resolve(file)); assert(bytes.length <= 2 * 1024 * 1024, 'Input too large'); return JSON.parse(bytes); };
    const result = command === 'prepare' ? await writeRolePlan(first, await load(second)) : assessRolePreflight(await load(first), await load(second));
    console.log(JSON.stringify(result, null, 2));
    if (command === 'assess' && (!result.collisionFree || !result.catalogCandidatesMatch || result.unresolvedDecisions.length)) process.exitCode = 1;
  } catch (error) { console.error(`Offline role plan rejected: ${error.message.split('\n')[0]}`); process.exitCode = 1; }
}
