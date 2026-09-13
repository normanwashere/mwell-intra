import { createHash } from 'node:crypto';
import { readFile, open, realpath, lstat } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRoleManifest, generateRolePlan, assessRolePreflight } from './wms-role-provision-plan.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const REVIEWED_CATALOG = 'e0f2cfa63d9ed0bf0b3c84c44c1753c9b97cd2a0639f606cda9ed8cf294d6771';
const canonical = x => Array.isArray(x) ? `[${x.map(canonical).join(',')}]` : x && typeof x === 'object'
  ? `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}` : JSON.stringify(x);
const bytesHash = x => createHash('sha256').update(x).digest('hex');
export const digest = x => bytesHash(canonical(x));
export const catalogDigest = r => digest({ columns: r.columns, constraints: r.constraints, triggers: r.triggers });
class Refusal extends Error {}
const requireFact = (ok, code) => { if (!ok) throw new Refusal(code); };
const equal = (a, b, code) => requireFact(isDeepStrictEqual(a, b), code);
const at = x => { requireFact(typeof x === 'string' && Number.isFinite(Date.parse(x)), 'invalid-timestamp'); return Date.parse(x); };
const sort = rows => [...rows].sort((a, b) => canonical(a).localeCompare(canonical(b)));
const claims = i => ({ core: ['staff'], warehouse: [...i.warehouseRoles] });

export const CORE_SQL = Object.freeze({
  profiles: `insert into core.profiles(id,email,full_name,title,kind,vendor_id,status)
select id,email,full_name,title,kind,vendor_id,status from jsonb_to_recordset($1::jsonb)
as x(id uuid,email text,full_name text,title text,kind text,vendor_id uuid,status text)`,
  roles: `insert into core.user_roles(user_id,module,role)
select user_id,module,role from jsonb_to_recordset($1::jsonb) as x(user_id uuid,module text,role text)`,
  scopes: `insert into core.profile_department_scopes(profile_id,department_id,scope_type,effective_from,effective_to)
select profile_id,department_id,scope_type,effective_from,effective_to from jsonb_to_recordset($1::jsonb)
as x(profile_id uuid,department_id uuid,scope_type text,effective_from date,effective_to date)`,
});

function reviewedInputs(input, baseline) {
  let m; let assessment;
  try { m = validateRoleManifest(input); assessment = assessRolePreflight(m, baseline); }
  catch { throw new Refusal('invalid-manifest-or-baseline'); }
  requireFact(assessment.collisionFree && assessment.catalogCandidatesMatch && !assessment.unresolvedDecisions.length, 'baseline-unresolved-or-colliding');
  requireFact(assessment.protectedProfileCount === 11 && new Set(baseline.protectedProfiles.map(p => p.id)).size === 11, 'incomplete-protected-roster');
  requireFact(catalogDigest(baseline) === REVIEWED_CATALOG, 'unreviewed-catalog');
  return m;
}

export async function prepareRoleExecution(input, baseline) {
  const m = reviewedInputs(input, baseline); const plan = generateRolePlan(m);
  return {
    version: 1, kind: 'wms-role-executor-review', manifestSha256: digest(m), catalogSha256: REVIEWED_CATALOG,
    preflightSql: plan.preflightSql, coreSql: CORE_SQL,
    sqlParameters: 'One JSON array per INSERT, derived only from seven journaled newly returned Auth UUIDs and the validated manifest.',
    authRequests: m.identities.map(i => ({ method: 'POST', path: '/auth/v1/admin/users',
      body: { email: i.email, password: '<ephemeral runtime only>', email_confirm: true, role: 'authenticated',
        app_metadata: { kind: 'employee', roles: claims(i), signoffRun: m.runId },
        user_metadata: { full_name: i.fullName, signoffRun: m.runId, signoffRoleKey: i.key } } })),
    claimSync: 'not-used: exact claims supplied at new Auth creation and verified afterward',
    approvalTemplate: { version: 1, kind: 'wms-role-execution-approval', project: m.project, runId: m.runId, buildId: m.buildId,
      manifestSha256: digest(m), baselineSha256: digest(baseline), catalogSha256: REVIEWED_CATALOG,
      executorSha256: bytesHash(await readFile(fileURLToPath(import.meta.url))),
      plannerSha256: bytesHash(await readFile(new URL('./wms-role-provision-plan.mjs', import.meta.url))),
      sqlSha256: digest({ preflight: plan.preflightSql, core: CORE_SQL }),
      reviewed: false, reviewer: '', approvedAt: '', expiresAt: '', ddlPaused: false, namespaceExclusive: false,
      emailConfirmation: 'synthetic-admin-fixture-only', humanPilotApproval: false },
    limits: [
      'Review output is not execution permission. Parent must independently pin the completed approval digest.',
      'Permanent local attempt marker prevents same-directory replay, not other machines or copied plans. Parent must own and drain this exact namespace and pause DDL.',
      'Auth creation and core transaction are not atomic. Ambiguous outcomes stop permanently; no retry, Auth deletion or existing-account reconciliation.',
      'Claims precede core inserts during setup; no sessions or transaction tests may use these accounts before independent postchecks and ordinary governed onboarding.',
      'Catalog pin covers the saved identity tables and trigger functions, not every schema, policy, external hook or concurrent writer.',
      'Protected comparison covers the saved eleven tester projections, not a universal user inventory or writer fence.',
      'No SMTP delivery, human pilot, governed certification or fresh user-session capability result is claimed.',
    ],
  };
}

async function approved(m, baseline, approval, expectedHash, now) {
  const { approvalTemplate: template } = await prepareRoleExecution(m, baseline);
  requireFact(HASH.test(expectedHash) && digest(approval) === expectedHash, 'approval-hash-mismatch');
  requireFact(approval && isDeepStrictEqual(Object.keys(approval).sort(), Object.keys(template).sort()), 'approval-fields');
  for (const key of Object.keys(template).filter(k => !['reviewed', 'reviewer', 'approvedAt', 'expiresAt', 'ddlPaused', 'namespaceExclusive'].includes(k))) {
    equal(approval[key], template[key], 'approval-scope-or-source-mismatch');
  }
  requireFact(approval.reviewed === true && approval.ddlPaused === true && approval.namespaceExclusive === true
    && typeof approval.reviewer === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(approval.reviewer), 'explicit-reviewed-isolation-required');
  const start = at(approval.approvedAt); const end = at(approval.expiresAt); const current = now().getTime();
  requireFact(start >= at(baseline.observedAt) && start <= current && current <= end && end - start <= 3600000, 'approval-expired-or-invalid');
}

function checkFresh(m, baseline, fresh, bindings, core, now) {
  let assessment; try { assessment = assessRolePreflight(m, fresh); } catch { throw new Refusal('invalid-fresh-preflight'); }
  requireFact(assessment.catalogCandidatesMatch, 'inactive-role-or-department');
  requireFact(Math.abs(now().getTime() - at(fresh.observedAt)) <= 30000, 'stale-preflight');
  requireFact(catalogDigest(fresh) === REVIEWED_CATALOG, 'catalog-drift');
  for (const key of ['protectedProfiles', 'protectedRoles', 'protectedScopes']) equal(fresh[key], baseline[key], 'protected-roster-drift');
  equal(fresh.namespaceAuthCount, bindings.length, 'namespace-collision');
  equal(fresh.namespaceProfileCount, core ? 7 : 0, 'unexpected-profile');
  for (const c of fresh.candidates) {
    equal(c.authCollisions, bindings.some(b => b.key === c.key) ? 1 : 0, 'candidate-collision');
    equal(c.profileCollisions, core ? 1 : 0, 'unexpected-profile');
  }
}

function checkUser(m, identity, user, started, now, id) {
  requireFact(UUID.test(user?.id) && (!id || user.id === id), 'invalid-returned-auth-id');
  equal(user.role, 'authenticated', 'unexpected-auth-role');
  equal(user.email, identity.email, 'unexpected-auth-email');
  requireFact(at(user.created_at) >= at(started) - 1000 && at(user.created_at) <= now().getTime() + 1000, 'auth-not-new');
  requireFact(at(user.email_confirmed_at) >= at(started) - 1000, 'synthetic-confirmation-missing');
  equal(user.app_metadata?.roles, claims(identity), 'unexpected-auth-claims');
  equal(user.app_metadata?.kind, 'employee', 'unexpected-auth-kind');
  equal(user.app_metadata?.signoffRun, m.runId, 'unexpected-auth-run');
  for (const [k, v] of Object.entries({ full_name: identity.fullName, signoffRun: m.runId, signoffRoleKey: identity.key })) {
    equal(user.user_metadata?.[k], v, 'unexpected-auth-metadata');
  }
}

function rowsFor(m, bindings) {
  requireFact(bindings.length === 7 && new Set(bindings.map(b => b.id)).size === 7, 'seven-new-bindings-required');
  const profiles = [], roles = [], scopes = [];
  for (const i of m.identities) {
    const b = bindings.find(b => b.key === i.key); requireFact(UUID.test(b?.id), 'invalid-new-binding');
    profiles.push({ id: b.id, email: i.email, full_name: i.fullName, title: `Synthetic WMS ${i.key}`, kind: 'employee', vendor_id: null, status: 'active' });
    for (const [module, values] of Object.entries(claims(i))) for (const role of values) roles.push({ user_id: b.id, module, role });
    scopes.push({ profile_id: b.id, department_id: i.department.id, scope_type: 'member', effective_from: m.effectiveFrom, effective_to: null });
  }
  return { profiles, roles, scopes };
}

async function writeEvent(root, ordinal, value) {
  const h = await open(path.join(root, `${String(ordinal).padStart(3, '0')}-${value.event}.json`), 'wx', 0o600);
  try { await h.writeFile(JSON.stringify(value, null, 2)); await h.sync(); } finally { await h.close(); }
}

// Clients are deliberately injected. Only the explicit run CLI constructs the live adapter.
export async function executeRoleProvision({ directory, manifest, baseline, approval, approvalSha256, password, clients, now = () => new Date() }) {
  const m = reviewedInputs(manifest, baseline);
  await approved(m, baseline, approval, approvalSha256, now);
  requireFact(typeof password === 'string' && password.length >= 16 && password.length <= 128
    && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password), 'invalid-ephemeral-password');
  requireFact(!(await lstat(directory)).isSymbolicLink(), 'attempt-directory-link');
  const root = await realpath(directory); let lock;
  try { lock = await open(path.join(root, 'role-provision-attempt.lock'), 'wx', 0o600); }
  catch { throw new Refusal('attempt-already-exists-or-unwritable'); }
  const startedAt = now().toISOString(); const bindings = [], observedAuthIds = []; let sequence = 0, phase = 'preflight', dbOutcome = 'not-started';
  const assertCurrentApproval = () => requireFact(now().getTime() <= at(approval.expiresAt), 'approval-expired');
  const emit = async (event, details = {}) => writeEvent(root, sequence++, { version: 1, event, runId: m.runId,
    project: m.project, buildId: m.buildId, at: now().toISOString(), ...details });
  const fresh = async core => {
    assertCurrentApproval();
    equal(await clients.target(), { project: m.project, origin: m.origin, database: 'postgres', role: 'postgres' }, 'wrong-live-target');
    const health = await clients.health();
    requireFact(health?.status === 'ok' && health.commit === m.buildId && health.deployment?.appEnv === 'uat'
      && health.deployment.supabaseProjectRef === m.project, 'wrong-live-build');
    const read = await clients.preflight(); checkFresh(m, baseline, read, bindings, core, now);
    await emit('preflight', { core, observedAt: read.observedAt, snapshotSha256: digest(read), catalogSha256: catalogDigest(read),
      protectedSha256: digest([read.protectedProfiles, read.protectedRoles, read.protectedScopes]), namespaceAuthCount: read.namespaceAuthCount });
  };
  try {
    await lock.writeFile(JSON.stringify({ runId: m.runId, manifestSha256: digest(m), approvalSha256, startedAt })); await lock.sync();
    await emit('started', { manifestSha256: digest(m), approvalSha256, baselineSha256: digest(baseline) });
    await fresh(false);
    const oldIds = await clients.authIds();
    requireFact(Array.isArray(oldIds) && oldIds.every(id => UUID.test(id)) && new Set(oldIds).size === oldIds.length, 'incomplete-auth-id-inventory');
    for (const p of baseline.protectedProfiles) requireFact(oldIds.includes(p.id), 'protected-auth-id-missing');
    await emit('auth-inventory', { count: oldIds.length, sha256: digest(sort(oldIds)) });
    for (const identity of m.identities) {
      await fresh(false);
      await clients.assertNewCoreAbsent(bindings.map(b => b.id));
      await emit('auth-intent', { key: identity.key, email: identity.email });
      assertCurrentApproval();
      phase = 'auth-outcome-unknown';
      const user = await clients.createUser({ email: identity.email, password, email_confirm: true, role: 'authenticated',
        app_metadata: { kind: 'employee', roles: claims(identity), signoffRun: m.runId },
        user_metadata: { full_name: identity.fullName, signoffRun: m.runId, signoffRoleKey: identity.key } });
      // Persist even an unexpected well-formed UUID before validating the remainder of the response.
      if (UUID.test(user?.id)) {
        observedAuthIds.push({ key: identity.key, id: user.id });
        await emit('auth-returned', { key: identity.key, observedAuthId: user.id });
      }
      phase = 'auth-response-rejected';
      checkUser(m, identity, user, startedAt, now);
      requireFact(!oldIds.includes(user.id) && !bindings.some(b => b.id === user.id), 'returned-existing-auth-id');
      bindings.push({ key: identity.key, id: user.id });
      await clients.assertNewCoreAbsent(bindings.map(b => b.id));
      checkUser(m, identity, await clients.getUser(user.id), startedAt, now, user.id);
      await emit('auth-bound', { key: identity.key, id: user.id });
    }
    phase = 'core-preflight'; await fresh(false);
    const rows = rowsFor(m, bindings); await emit('core-insert-plan', { bindings, rows, sqlSha256: digest(CORE_SQL) });
    dbOutcome = 'transaction-not-committed'; await clients.begin();
    await clients.lockReferences(bindings.map(b => b.id));
    await fresh(false); await clients.assertNewCoreAbsent(bindings.map(b => b.id));
    for (const i of m.identities) {
      const id = bindings.find(b => b.key === i.key).id; checkUser(m, i, await clients.getUser(id), startedAt, now, id);
    }
    assertCurrentApproval();
    phase = 'core-insert'; await clients.insertCore(rows);
    const verifyCore = async () => {
      const read = await clients.coreReadback(bindings.map(b => b.id));
      for (const key of ['profiles', 'roles', 'scopes']) equal(sort(read[key]), sort(rows[key]), 'core-readback-mismatch');
      await emit('core-readback', { rows: read, sha256: digest(read) });
    };
    await verifyCore(); await fresh(true);
    await emit('commit-intent', { bindings });
    assertCurrentApproval();
    phase = 'commit-outcome-unknown'; dbOutcome = 'unknown';
    await clients.commit(); dbOutcome = 'committed'; await emit('commit-returned');
    phase = 'postcommit-verification'; await fresh(true); await verifyCore();
    for (const i of m.identities) {
      const id = bindings.find(b => b.key === i.key).id; checkUser(m, i, await clients.getUser(id), startedAt, now, id);
    }
    const result = { status: 'provisioned-awaiting-governed-onboarding', bindings, dbOutcome,
      smtpVerified: false, humanPilotApproved: false, userSessionCapabilitiesVerified: false };
    await emit('completed', result); return result;
  } catch (error) {
    const category = error instanceof Refusal ? error.message : phase;
    // Never serialize backend errors, headers, response bodies, password or database URL.
    try { await emit('stopped', { category, phase, dbOutcome, bindings, observedAuthIds, automaticRetry: false, automaticCleanup: false }); } catch { /* Retain prior durable intent; no more remote calls. */ }
    const refusal = new Refusal(`role-provision-stopped:${category};phase=${phase};db=${dbOutcome}`);
    refusal.inventory = { runId: m.runId, observedAuthIds, bindings, dbOutcome }; throw refusal;
  } finally {
    // Disconnect aborts an uncommitted transaction. An ambiguous COMMIT is never replayed.
    try { await clients.close(); } catch { /* Nothing here authorizes retry. */ }
    await lock.close();
  }
}

export function validateDatabaseUrl(raw, input) {
  const m = validateRoleManifest(input); let url;
  try { url = new URL(raw); } catch { throw new Refusal('invalid-database-target'); }
  const direct = url.hostname === `db.${m.project}.supabase.co` && url.username === 'postgres';
  const pooler = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) && url.username === `postgres.${m.project}`;
  requireFact(['postgres:', 'postgresql:'].includes(url.protocol) && (direct || pooler) && !!url.password
    && url.pathname === '/postgres' && !url.search && !url.hash && ['', '5432', '6543'].includes(url.port), 'invalid-database-target');
  return { project: m.project, origin: m.origin, database: 'postgres', role: 'postgres' };
}

export function createNetworkClients(input, env) {
  const m = validateRoleManifest(input);
  requireFact(env?.APP_ENV === 'uat' && env.AUDIT_MUTATIONS === 'true' && env.POLICY_ALLOW_TEST_MUTATIONS === 'true'
    && env.WMS_ROLE_RUN_ID === m.runId && env.WMS_ROLE_BUILD_ID === m.buildId, 'explicit-live-guards-required');
  const target = validateDatabaseUrl(env.WMS_ROLE_DATABASE_URL, m);
  requireFact(typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' && env.SUPABASE_SERVICE_ROLE_KEY.length > 20, 'ephemeral-admin-key-required');
  let db;
  const connect = async () => {
    if (!db) {
      const { Client } = createRequire(new URL('../../package.json', import.meta.url))('pg');
      db = new Client({ connectionString: env.WMS_ROLE_DATABASE_URL, ssl: { rejectUnauthorized: true },
        connectionTimeoutMillis: 15000, query_timeout: 30000, statement_timeout: 25000,
        application_name: `wms-role-${m.runId}`, options: '-c row_security=off -c lock_timeout=1000' });
      await db.connect();
    }
    return db;
  };
  const query = async (sql, parameters = []) => (await (await connect()).query(sql, parameters)).rows;
  const auth = async (suffix, method = 'GET', body) => {
    const response = await fetch(`https://${m.project}.supabase.co/auth/v1/admin/users${suffix}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(20000), cache: 'no-store',
      headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    requireFact(response.ok, `auth-http-${response.status}`);
    const value = await response.json(); return value.user ?? value;
  };
  const sql = generateRolePlan(m).preflightSql;
  const start = sql.indexOf('with candidates('); const end = sql.lastIndexOf('commit;');
  requireFact(start > 0 && end > start, 'preflight-framing-changed');
  const readSql = sql.slice(start, end);
  return {
    async target() {
      const [row] = await query('select current_database() as database,current_user as role');
      equal(row, { database: 'postgres', role: 'postgres' }, 'wrong-database-principal'); return target;
    },
    async health() {
      const response = await fetch(`${m.origin}/api/health`, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      requireFact(response.ok, 'health-unavailable'); return response.json();
    },
    async preflight() { const rows = await query(readSql); requireFact(rows.length === 1, 'preflight-result-shape'); return rows[0].preflight; },
    async authIds() { return (await query('select id from auth.users order by id')).map(r => r.id); },
    createUser: body => auth('', 'POST', body),
    getUser: id => { requireFact(UUID.test(id), 'invalid-auth-get-id'); return auth(`/${id}`); },
    async assertNewCoreAbsent(ids) {
      requireFact(ids.every(id => UUID.test(id)), 'invalid-core-probe-id');
      const [r] = await query(`select
        (select count(*)::integer from core.profiles where id=any($1::uuid[]) or lower(btrim(email))=any($2::text[])) as profiles,
        (select count(*)::integer from core.user_roles where user_id=any($1::uuid[])) as roles,
        (select count(*)::integer from core.profile_department_scopes where profile_id=any($1::uuid[])) as scopes`, [ids, m.identities.map(i => i.email)]);
      equal(r, { profiles: 0, roles: 0, scopes: 0 }, 'existing-core-rows');
    },
    async begin() { await query('begin isolation level read committed'); },
    async lockReferences(ids) {
      await query('lock table core.profiles,core.user_roles,core.profile_department_scopes in row exclusive mode nowait');
      const users = await query('select id from auth.users where id=any($1::uuid[]) for update', [ids]);
      equal(sort(users.map(r => r.id)), sort(ids), 'missing-new-auth');
      const roles = await query(`select module,role from core.roles where (module='core' and role='staff')
        or (module='warehouse' and role=any($1::text[])) for share`, [[...new Set(m.identities.flatMap(i => i.warehouseRoles))]]);
      requireFact(roles.length === 7, 'missing-role-catalog');
      const departments = [...new Set(m.identities.map(i => i.department.id))];
      requireFact((await query('select id from core.departments where id=any($1::uuid[]) for share', [departments])).length === departments.length, 'missing-department');
    },
    async insertCore(rows) { for (const key of ['profiles', 'roles', 'scopes']) await query(CORE_SQL[key], [JSON.stringify(rows[key])]); },
    async coreReadback(ids) {
      const [r] = await query(`select
        (select coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'full_name',full_name,'title',title,'kind',kind,'vendor_id',vendor_id,'status',status)),'[]') from core.profiles where id=any($1::uuid[])) as profiles,
        (select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'module',module,'role',role)),'[]') from core.user_roles where user_id=any($1::uuid[])) as roles,
        (select coalesce(jsonb_agg(jsonb_build_object('profile_id',profile_id,'department_id',department_id,'scope_type',scope_type,'effective_from',effective_from,'effective_to',effective_to)),'[]') from core.profile_department_scopes where profile_id=any($1::uuid[])) as scopes,
        (select count(*)::integer from core.user_roles where user_id=any($1::uuid[]) and (expires_at is not null or effective_at>clock_timestamp() or id is null)) as invalid_roles`, [ids]);
      requireFact(r.invalid_roles === 0, 'invalid-new-role-defaults'); delete r.invalid_roles; return r;
    },
    async commit() { await query('commit'); },
    async close() { if (db) await db.end(); },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, directory, approvalFile, approvalSha256, ...extra] = process.argv.slice(2);
    requireFact(directory && !extra.length && (command === 'prepare' && !approvalFile || command === 'run' && approvalFile && HASH.test(approvalSha256)),
      'usage: prepare PLAN_DIRECTORY | run PLAN_DIRECTORY REVIEWED_APPROVAL_JSON APPROVAL_CANONICAL_SHA256');
    const load = async name => { const bytes = await readFile(name); requireFact(bytes.length < 2 * 1024 * 1024, 'input-too-large'); return JSON.parse(bytes); };
    const manifest = await load(path.join(directory, 'manifest.json'));
    const raw = await load(path.join(directory, 'live-preflight-raw.json')); const baseline = raw.rows?.[0]?.preflight;
    if (command === 'prepare') console.log(JSON.stringify(await prepareRoleExecution(manifest, baseline), null, 2));
    else {
      const approval = await load(approvalFile);
      console.log(JSON.stringify(await executeRoleProvision({ directory, manifest, baseline, approval, approvalSha256,
        password: process.env.WMS_ROLE_PASSWORD, clients: createNetworkClients(manifest, process.env) }), null, 2));
    }
  } catch (error) {
    console.error(error instanceof Refusal ? error.message : 'role-provision-failed: sanitized input/transport/storage error; inspect retained journal, never retry blindly');
    if (error instanceof Refusal && error.inventory) console.error(JSON.stringify(error.inventory));
    process.exitCode = 1;
  }
}
