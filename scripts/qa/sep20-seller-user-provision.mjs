import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Server-side, one synthetic identity only. Imports and --prepare are offline.
export const RUN_ID = 'sep20-uat-seller-2026-09-20';
export const PROJECT = 'kkoitlvydytdhlpxhuah';
export const ORIGIN = 'https://mwell-intra-uat.vercel.app';
export const EMAIL = 'intra.seller.uat.sep20@mwell.com.ph';
export const DISPLAY_NAME = 'UAT Event Seller Sep20';
const RUN_DIRECTORY = fileURLToPath(new URL('./sep20-seller-user-run/', import.meta.url));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{40}$/;
const PAGE_SIZE = 100;
const MAX_USERS = 2000;
const MARKETING_ID = '7e55e54e-86cd-4157-9fdb-7616be83e340';
const roles = () => ({ events: ['seller'] });
const departmentScopes = () => [{ departmentId: MARKETING_ID, departmentCode: 'marketing',
  scopeType: 'member', effectiveFrom: '2026-09-20', effectiveTo: null }];
const stamp = () => new Date().toISOString();
class Refusal extends Error {}
const requireThat = (condition, code) => { if (!condition) throw new Refusal(code); };
const failureCode = error => error instanceof Refusal ? error.message : 'UNEXPECTED_FAILURE';

export function createManifest(deployedSha) {
  requireThat(typeof deployedSha === 'string' && SHA.test(deployedSha), 'DEPLOYED_SHA_REQUIRED');
  return { version: 1, runId: RUN_ID, project: PROJECT, origin: ORIGIN, deployedSha,
    email: EMAIL, displayName: DISPLAY_NAME, roles: roles(), departmentScopes: departmentScopes(),
    operationalWrites: 'none', smtp: false, passwordSource: 'AUDIT_PASSWORD environment only' };
}

export function validateManifest(value) {
  requireThat(value && typeof value.deployedSha === 'string' && SHA.test(value.deployedSha), 'MANIFEST_REFUSED');
  requireThat(isDeepStrictEqual(value, createManifest(value.deployedSha)), 'MANIFEST_REFUSED');
  return value;
}

async function plainDirectory(directory) {
  const resolved = path.resolve(directory);
  const stat = await lstat(resolved);
  requireThat(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(resolved) === resolved, 'DIRECTORY_REFUSED');
  return resolved;
}

async function durable(file, value, existsCode = 'ARTIFACT_EXISTS') {
  let handle;
  try { handle = await open(file, 'wx', 0o600); }
  catch (error) { throw new Refusal(error.code === 'EEXIST' ? existsCode : 'ARTIFACT_WRITE_FAILED'); }
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  catch { throw new Refusal('ARTIFACT_WRITE_FAILED'); }
  finally { await handle.close(); }
}

async function loadManifest(directory) {
  const file = path.join(directory, 'manifest.json');
  try {
    const stat = await lstat(file);
    requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.size < 16384, 'MANIFEST_REFUSED');
    return validateManifest(JSON.parse(await readFile(file, 'utf8')));
  } catch { throw new Refusal('MANIFEST_REFUSED'); }
}

export async function prepareSellerRun(deployedSha, { runDirectory = RUN_DIRECTORY } = {}) {
  const manifest = createManifest(deployedSha);
  await mkdir(runDirectory, { recursive: true });
  const directory = await plainDirectory(runDirectory);
  await durable(path.join(directory, 'manifest.json'), manifest, 'MANIFEST_EXISTS');
  return manifest;
}

function approval(manifest, options) {
  requireThat(options.apply === true && options.allowCliCredential === true && options.confirmRun === RUN_ID
    && options.releaseAfterRlsFix === manifest.deployedSha, 'APPROVAL_REQUIRED');
}

async function acquireAdministrativeCredential(manifest, options, invoke) {
  approval(manifest, options);
  try {
    if (!invoke) {
      const launcher = createRequire(import.meta.url).resolve('supabase/dist/supabase.js');
      invoke = async args => {
        const env = { ...process.env };
        for (const key of ['AUDIT_PASSWORD', 'SUPABASE_CLI_BINARY_OVERRIDE', 'NODE_OPTIONS', 'NODE_DEBUG', 'DEBUG']) delete env[key];
        const result = await promisify(execFile)(process.execPath, [launcher, ...args],
          { windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024, env });
        return result.stdout;
      };
    }
    // Existing authenticated CLI credential only; stdout/errors never reach artifacts or logs.
    const data = JSON.parse(await invoke(['projects', 'api-keys', '--project-ref', PROJECT, '--reveal', '--output', 'json', '--log-level', 'none']));
    requireThat(Array.isArray(data), 'CREDENTIAL_REFUSED');
    const candidates = data.filter(r => r.name === 'service_role' && typeof r.api_key === 'string');
    requireThat(candidates.length === 1, 'CREDENTIAL_REFUSED');
    const credential = candidates[0].api_key;
    const parts = credential.split('.');
    requireThat(parts.length === 3, 'CREDENTIAL_REFUSED');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    requireThat(claims.role === 'service_role' && claims.ref === PROJECT
      && (claims.exp === undefined || claims.exp > Date.now() / 1000), 'CREDENTIAL_REFUSED');
    return credential;
  } catch { throw new Refusal('CREDENTIAL_REFUSED'); }
}

async function requestJson(fetcher, url, init = {}) {
  try {
    const response = await fetcher(url, { ...init, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) });
    requireThat(response.ok, 'REQUEST_FAILED');
    return { data: await response.json(), headers: response.headers };
  } catch { throw new Refusal('REQUEST_FAILED'); }
}

async function verifyHealth(manifest, fetcher) {
  const { data } = await requestJson(fetcher, `${ORIGIN}/api/health`);
  requireThat(data?.status === 'ok' && data.commit === manifest.deployedSha
    && data.deployment?.appEnv === 'uat' && data.deployment.supabaseProjectRef === PROJECT, 'HEALTH_REFUSED');
}

function backend(credential, fetcher) {
  const request = (route, { method = 'GET', body, core = false } = {}) => requestJson(fetcher,
    `https://${PROJECT}.supabase.co${route}`, { method,
      headers: { apikey: credential, Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json',
        ...(core ? { 'Accept-Profile': 'core', 'Content-Profile': 'core', Prefer: method === 'GET' ? 'count=exact' : 'return=representation' } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const authUser = async (route, options) => {
    const { data } = await request(route, options);
    return data?.user ?? data;
  };
  const coreRows = async (table, filters) => {
    const query = new URLSearchParams({ select: '*', ...filters, limit: String(PAGE_SIZE) });
    const { data, headers } = await request(`/rest/v1/${table}?${query}`, { core: true });
    const count = headers.get('content-range')?.split('/')[1];
    requireThat(typeof count === 'string' && /^\d+$/.test(count) && Array.isArray(data)
      && data.length < PAGE_SIZE && Number(count) === data.length, 'CORE_READ_INCOMPLETE');
    return data;
  };
  return {
    async inventory() {
      const ids = new Set();
      let expected;
      for (let page = 1; page <= MAX_USERS / PAGE_SIZE; page++) {
        const { data, headers } = await request(`/auth/v1/admin/users?page=${page}&per_page=${PAGE_SIZE}`);
        const total = headers.get('x-total-count');
        requireThat(typeof total === 'string' && /^\d+$/.test(total), 'INVENTORY_INCOMPLETE');
        const count = Number(total);
        expected ??= count;
        requireThat(count === expected && count <= MAX_USERS && Array.isArray(data?.users)
          && data.users.length === Math.min(PAGE_SIZE, count - ids.size), 'INVENTORY_INCOMPLETE');
        for (const user of data.users) {
          requireThat(UUID.test(user.id) && !ids.has(user.id), 'INVENTORY_INCOMPLETE');
          requireThat(typeof user.email !== 'string' || user.email.trim().toLowerCase() !== EMAIL, 'EXISTING_IDENTITY');
          ids.add(user.id);
        }
        if (ids.size === count) return ids;
      }
      throw new Refusal('INVENTORY_INCOMPLETE');
    },
    async roleCatalog() {
      const definitions = await coreRows('roles', { module: 'eq.events', role: 'eq.seller' });
      const caps = await coreRows('role_capabilities', { module: 'eq.events', role: 'eq.seller' });
      requireThat(definitions.length === 1 && definitions[0].module === 'events' && definitions[0].role === 'seller'
        && definitions[0].is_active === true && caps.every(c => c.module === 'events' && c.role === 'seller')
        && isDeepStrictEqual(caps.map(c => c.cap).sort(), ['record_event_outcome', 'view_event_custody']), 'ROLE_REFUSED');
    },
    async marketingDepartment() {
      const rows = await coreRows('departments', { id: `eq.${MARKETING_ID}`, code: 'eq.marketing' });
      requireThat(rows.length === 1 && rows[0].id === MARKETING_ID && rows[0].code === 'marketing'
        && rows[0].name === 'Marketing' && rows[0].is_active === true, 'DEPARTMENT_REFUSED');
    },
    profilesByEmail: () => coreRows('profiles', { email: `ilike.${EMAIL}` }),
    async coreIdentity(id) {
      return {
        profiles: await coreRows('profiles', { id: `eq.${id}` }),
        roles: await coreRows('user_roles', { user_id: `eq.${id}` }),
        scopes: await coreRows('profile_department_scopes', { profile_id: `eq.${id}` }),
      };
    },
    createUser: password => authUser('/auth/v1/admin/users', { method: 'POST', body: {
      email: EMAIL, password, email_confirm: true, role: 'authenticated',
      app_metadata: { kind: 'employee', roles: roles(), synthetic: true, uatRunId: RUN_ID },
      user_metadata: { full_name: DISPLAY_NAME, synthetic: true, uatRunId: RUN_ID },
    } }),
    getUser: id => authUser(`/auth/v1/admin/users/${id}`),
    insertProfile: profile => request('/rest/v1/profiles', { method: 'POST', core: true, body: profile }),
    insertRole: id => request('/rest/v1/user_roles', { method: 'POST', core: true, body: [{ user_id: id, module: 'events', role: 'seller' }] }),
    insertMarketingMember: id => request('/rest/v1/profile_department_scopes', { method: 'POST', core: true, body: [expectedMemberScope(id)] }),
  };
}

function validateAuth(user, priorIds, startedAt) {
  const recent = value => typeof value === 'string' && Date.parse(value) >= Date.parse(startedAt) - 1000
    && Date.parse(value) <= Date.now() + 1000;
  requireThat(user && UUID.test(user.id) && !priorIds.has(user.id) && user.email === EMAIL
    && user.role === 'authenticated' && recent(user.created_at) && recent(user.email_confirmed_at)
    && isDeepStrictEqual(user.app_metadata?.roles, roles()) && user.app_metadata.kind === 'employee'
    && user.app_metadata.synthetic === true && user.app_metadata.uatRunId === RUN_ID
    && user.user_metadata?.full_name === DISPLAY_NAME && user.user_metadata.synthetic === true
    && user.user_metadata.uatRunId === RUN_ID, 'AUTH_READBACK_REFUSED');
}

function expectedProfile(id) {
  return { id, email: EMAIL, full_name: DISPLAY_NAME, title: 'Synthetic UAT Event Seller', kind: 'employee', vendor_id: null, status: 'active' };
}

function expectedMemberScope(id) {
  return { profile_id: id, department_id: MARKETING_ID, scope_type: 'member', effective_from: '2026-09-20', effective_to: null };
}

function validateCore(identity, id, scopeRequired = true) {
  const expected = expectedProfile(id);
  const member = expectedMemberScope(id);
  requireThat(identity.profiles.length === 1
    && Object.entries(expected).every(([k, v]) => identity.profiles[0][k] === v)
    && identity.roles.length === 1 && identity.roles[0].user_id === id && identity.roles[0].module === 'events'
    && identity.roles[0].role === 'seller' && UUID.test(identity.roles[0].id)
    && Number.isFinite(Date.parse(identity.roles[0].effective_at)) && Date.parse(identity.roles[0].effective_at) <= Date.now() + 1000
    && identity.roles[0].expires_at === null
    && (scopeRequired ? identity.scopes.length === 1 && UUID.test(identity.scopes[0].id)
      && Object.entries(member).every(([k, v]) => identity.scopes[0][k] === v) : identity.scopes.length === 0), 'CORE_READBACK_REFUSED');
}

export async function provisionSeller(options, { env = process.env, invokeCli, fetcher = fetch } = {}) {
  const directory = await plainDirectory(options.runDirectory ?? RUN_DIRECTORY);
  const manifest = await loadManifest(directory);
  approval(manifest, options);
  requireThat(typeof env.AUDIT_PASSWORD === 'string' && env.AUDIT_PASSWORD.length >= 8, 'AUDIT_PASSWORD_REQUIRED');
  const startedAt = stamp();
  const manifestSha256 = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  const scope = { runId: RUN_ID, project: PROJECT, deployedSha: manifest.deployedSha, manifestSha256 };
  const artifact = (name, data) => durable(path.join(directory, name), { ...scope, ...data });
  // Never remove this marker, even for a failed/unknown response. Reconciliation is manual and read-only.
  await durable(path.join(directory, 'attempt.json'), { ...scope, startedAt, parentReleasedAfterRlsFix: true }, 'ATTEMPT_EXISTS');
  let stage = 'preflight';
  let userId;
  let identityWritesMayHaveOccurred = false;
  try {
    await verifyHealth(manifest, fetcher);
    const credential = await acquireAdministrativeCredential(manifest, options, invokeCli);
    const api = backend(credential, fetcher);
    const priorIds = await api.inventory();
    requireThat((await api.profilesByEmail()).length === 0, 'EXISTING_IDENTITY');
    await api.roleCatalog();
    await api.marketingDepartment();
    await verifyHealth(manifest, fetcher);
    stage = 'auth-create';
    await artifact('auth-create-intent.json', { at: stamp(), email: EMAIL });
    identityWritesMayHaveOccurred = true;
    const user = await api.createUser(env.AUDIT_PASSWORD);
    if (typeof user?.id === 'string' && UUID.test(user.id)) {
      userId = user.id;
      await artifact('auth-created.json', { at: stamp(), userId });
    }
    validateAuth(user, priorIds, startedAt);
    const reread = await api.getUser(userId);
    validateAuth(reread, priorIds, startedAt);
    requireThat(reread.id === userId, 'AUTH_READBACK_REFUSED');
    const absent = await api.coreIdentity(userId);
    requireThat(absent.profiles.length === 0 && absent.roles.length === 0 && absent.scopes.length === 0
      && (await api.profilesByEmail()).length === 0, 'EXISTING_IDENTITY');
    stage = 'profile-insert';
    await artifact('profile-insert-intent.json', { at: stamp(), userId });
    await api.insertProfile(expectedProfile(userId));
    stage = 'role-insert';
    await artifact('role-insert-intent.json', { at: stamp(), userId });
    await api.insertRole(userId);
    validateCore(await api.coreIdentity(userId), userId, false);
    await api.marketingDepartment();
    stage = 'department-member-insert';
    await artifact('department-member-insert-intent.json', { at: stamp(), userId, departmentScopes: departmentScopes() });
    await api.insertMarketingMember(userId);
    stage = 'readback';
    const finalUser = await api.getUser(userId);
    validateAuth(finalUser, priorIds, startedAt);
    requireThat(finalUser.id === userId, 'AUTH_READBACK_REFUSED');
    validateCore(await api.coreIdentity(userId), userId);
    await api.roleCatalog();
    await api.marketingDepartment();
    await verifyHealth(manifest, fetcher);
    const receipt = { ...scope, status: 'verified', userId, email: EMAIL, displayName: DISPLAY_NAME,
      roles: roles(), departmentScopes: departmentScopes(), startedAt, finishedAt: stamp(), operationalWrites: 0, smtp: false,
      proof: 'Auth admin and core identity readback only; no sign-in, learning completion, or event assignment claimed' };
    await artifact('receipt.json', receipt);
    return receipt;
  } catch (error) {
    const code = failureCode(error);
    await artifact('failure.json', { status: 'stopped', stage, code, userId, identityWritesMayHaveOccurred,
      operationalWrites: 0, smtp: false, at: stamp(), retry: 'forbidden; inspect identity read-only without deleting the attempt marker' });
    throw new Refusal(code);
  }
}

async function main(args) {
  if (args.length === 0 || isDeepStrictEqual(args, ['--help'])) {
    console.log('Offline: --prepare --sha FULL_DEPLOYED_SHA\nLive (parent release only): --apply --allow-cli-credential --confirm-run ' + RUN_ID
      + ' --release-after-rls-fix FULL_DEPLOYED_SHA\nPassword: AUDIT_PASSWORD environment only. Fixed manifest/attempt directory: ' + RUN_DIRECTORY);
    return;
  }
  if (args.length === 3 && args[0] === '--prepare' && args[1] === '--sha') {
    console.log(JSON.stringify(await prepareSellerRun(args[2]), null, 2));
    return;
  }
  requireThat(args.length === 6 && args[0] === '--apply' && args[1] === '--allow-cli-credential'
    && args[2] === '--confirm-run' && args[4] === '--release-after-rls-fix', 'CLI_ARGUMENTS_REFUSED');
  console.log(JSON.stringify(await provisionSeller({ apply: true, allowCliCredential: true, confirmRun: args[3], releaseAfterRlsFix: args[5] }), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(JSON.stringify({ status: 'refused', code: failureCode(error) })); process.exitCode = 1; });
}
