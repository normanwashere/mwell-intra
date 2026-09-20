import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCOPE = Object.freeze({
  date: '2026-09-21', commit: '9ec7311f9062c2c185682db21a5f9bddc7b72943',
  deploymentId: 'dpl_FqVCxKFPyosoguY2ScEkErQaNMk5',
  origin: 'https://mwell-intra-uat.vercel.app', project: 'kkoitlvydytdhlpxhuah',
  outputRoot: 'C:/Users/NormanArisDeocareza/Projects/mwell-intra-warehouse/outputs/sep21-hotspot-retest',
});
const actors = [
  { role: 'operations_associate', email: 'intra.test.operations.associate@mwell.com.ph',
    routes: ['receiving', 'returns', 'fulfillment', 'cycle-counts'] },
  { role: 'operations_lead', email: 'intra.test.operations.lead@mwell.com.ph',
    routes: ['receiving', 'cycle-counts'] },
];
export const PLAN = Object.freeze([[320, 720], [360, 800], [390, 844]].flatMap(([width, height]) =>
  actors.flatMap(actor => actor.routes.map(route => Object.freeze({
    role: actor.role, email: actor.email, route: `/warehouse/${route}`, width, height,
  })))));
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const empty = value => onlyKeys(value, []);
const sha256 = value => createHash('sha256').update(value).digest('hex');

export function manilaDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function assertGate(env, now = new Date()) {
  assert.equal(env.APP_ENV, 'uat', 'Explicit APP_ENV=uat required');
  assert.equal(env.AUDIT_MUTATIONS, 'false', 'Explicit AUDIT_MUTATIONS=false required');
  assert(typeof env.AUDIT_PASSWORD === 'string' && env.AUDIT_PASSWORD.length > 0, 'Ephemeral AUDIT_PASSWORD required');
  assert.equal(manilaDate(now), SCOPE.date, 'Approved Manila date expired');
}
export function assertHealth(health) {
  assert.equal(health?.status, 'ok', 'UAT health is not healthy');
  assert.equal(health?.commit, SCOPE.commit, 'Canonical commit changed');
  assert.equal(health?.deployment?.appEnv, 'uat', 'Wrong app environment');
  assert.equal(health?.deployment?.supabaseProjectRef, SCOPE.project, 'Wrong backend');
}
export function assertOutputRoot(value) {
  assert.equal(value.replaceAll('\\', '/').toLowerCase(), SCOPE.outputRoot.toLowerCase(), 'Use only the approved output root');
}
export function assertIdentity(user, actor) {
  assert(actors.some(known => known.role === actor.role && known.email === actor.email), 'Unknown actor');
  assert.equal(user?.email, actor.email, 'Wrong signed-in account');
  assert(uuid(user?.id), 'Missing authenticated UUID');
}
const caseKey = item => `${item.role}:${item.route}:${item.width}:${item.height}:${item.email}`;
export function assertComplete(results) {
  assert.deepEqual(results.map(caseKey).sort(), PLAN.map(caseKey).sort(), 'Incomplete or expanded scope');
  assert(results.every(item => item.ok && item.screenshots?.length > 0), 'Failed or missing evidence');
}

// Only reads plus the approved argumentless, auth.uid-bound learning bootstrap.
// resolve_assignments synchronizes existing evidence; certificate evaluation stays blocked.
function allowedRpc(schema, name, body) {
  if ((schema === 'core' && name === 'my_capability_snapshot') ||
      (schema === 'learning' && ['my_learning_snapshot', 'resolve_assignments'].includes(name))) return empty(body);
  if (schema !== 'warehouse') return false;
  if (['procurement_receipt_exception_work_items', 'procurement_receipt_excess_work_items', 'stock_conversion_workspace'].includes(name)) {
    return onlyKeys(body, ['payload']) && empty(body.payload);
  }
  if (name === 'department_request_actor_names') {
    return onlyKeys(body, ['p_request_ids']) && Array.isArray(body.p_request_ids) &&
      body.p_request_ids.length <= 200 && body.p_request_ids.every(uuid);
  }
  if (name === 'list_stock_change_requests') {
    const query = body.payload;
    return onlyKeys(body, ['payload']) && onlyKeys(query, ['limit', 'status', 'search', 'cursor']) &&
      Number.isInteger(query.limit) && query.limit >= 1 && query.limit <= 200 &&
      ['status', 'search', 'cursor'].every(key => query[key] === undefined || (typeof query[key] === 'string' && query[key].length <= 1000));
  }
  return false;
}

export function requestAllowed(request, { actor, password, loginAllowed = false } = {}) {
  const known = actors.find(item => item.role === actor?.role && item.email === actor?.email);
  if (!known) return false;
  let url;
  try { url = new URL(request.url); } catch { return false; }
  if (url.username || url.password) return false;
  const method = request.method.toUpperCase();
  const isRead = ['GET', 'HEAD'].includes(method);
  // Storage signing reads an existing evidence object; it is not upload signing.
  // The resulting token is permitted only on that exact backend evidence-read endpoint.
  if (url.origin === `https://${SCOPE.project}.supabase.co` &&
      /^\/storage\/v1\/object\/sign\/evidence\/(?:[a-z0-9_-][a-z0-9._-]*\/)+[a-z0-9_-][a-z0-9._-]*$/i.test(url.pathname)) {
    if (method === 'POST') return !url.search && onlyKeys(request.body, ['expiresIn']) &&
      [300, 3600].includes(request.body.expiresIn);
    return isRead && url.searchParams.size === 1 && url.searchParams.has('token') &&
      /^[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+$/i.test(url.searchParams.get('token'));
  }
  if ([...url.searchParams.keys()].some(key => /token|password|secret|apikey|authorization/i.test(key))) return false;
  if (url.origin === SCOPE.origin) {
    if (!isRead) return false;
    if (url.pathname === '/') return request.resourceType === 'fetch' &&
      [...url.searchParams.keys()].every(key => key === '_rsc');
    if (url.pathname === '/_next/image') return request.resourceType === 'image' &&
      url.searchParams.size === (url.searchParams.has('dpl') ? 4 : 3) &&
      new Set(url.searchParams.keys()).size === url.searchParams.size &&
      (!url.searchParams.has('dpl') || url.searchParams.get('dpl') === SCOPE.deploymentId) &&
      url.searchParams.get('url') === '/mwell-wordmark.png' &&
      [...url.searchParams.keys()].every(key => ['url', 'w', 'q', 'dpl'].includes(key)) &&
      /^\d+$/.test(url.searchParams.get('w')) && Number(url.searchParams.get('w')) >= 1 && Number(url.searchParams.get('w')) <= 4096 &&
      /^\d+$/.test(url.searchParams.get('q')) && Number(url.searchParams.get('q')) >= 1 && Number(url.searchParams.get('q')) <= 100;
    if (url.pathname === '/login') {
      const receivingRedirect = url.searchParams.get('redirect') === '/warehouse/receiving';
      if (new Set(url.searchParams.keys()).size !== url.searchParams.size) return false;
      if (request.resourceType === 'fetch') return method === 'GET' &&
        [...url.searchParams.keys()].every(key => ['redirect', '_rsc'].includes(key)) &&
        (!url.searchParams.has('redirect') || receivingRedirect);
      return loginAllowed && [...url.searchParams.keys()].every(key => key === 'redirect') && receivingRedirect;
    }
    if (known.routes.some(route => url.pathname === `/warehouse/${route}`)) return [...url.searchParams.keys()].every(key => key === '_rsc');
    if (url.pathname === '/api/health') return !url.search;
    return request.resourceType !== 'document' &&
      (url.pathname.startsWith('/_next/static/') || /^\/(?:favicon\.ico|manifest\.webmanifest|icons\/[^/]+\.(?:png|svg)|[^/]+\.(?:png|svg|woff2?))$/.test(url.pathname)) && !url.search;
  }
  if (url.origin !== `https://${SCOPE.project}.supabase.co`) return false;
  if (url.pathname === '/auth/v1/token') {
    const body = request.body;
    return loginAllowed && method === 'POST' && url.search === '?grant_type=password' &&
      onlyKeys(body, ['email', 'password', 'gotrue_meta_security']) && body.email === known.email &&
      typeof password === 'string' && password.length > 0 && body.password === password &&
      (body.gotrue_meta_security === undefined || empty(body.gotrue_meta_security));
  }
  if (url.pathname === '/auth/v1/user') return isRead && !url.search;
  const schema = request.schema || 'public';
  const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
  if (rpc) return method === 'POST' && !url.search && allowedRpc(schema, rpc[1], request.body ?? {});
  if (/^\/rest\/v1\/[a-z_]+$/.test(url.pathname)) {
    return isRead && ['core', 'warehouse', 'procurement', 'product', 'learning', 'public'].includes(schema);
  }
  return isRead && /^\/storage\/v1\/object\/(?:public|authenticated)\//.test(url.pathname) && !url.search;
}

export function safeRequestShape(request) {
  const url = new URL(request.url);
  const safeQuery = {};
  const publicKeys = ['url', 'w', 'q', 'dpl', 'redirect', '_rsc'];
  if (url.origin === SCOPE.origin && ['/login', '/_next/image'].includes(url.pathname)) {
    for (const [key, value] of url.searchParams) {
      if (!publicKeys.includes(key)) continue;
      const safe = (key === 'url' && value === '/mwell-wordmark.png') ||
        (key === 'dpl' && value === SCOPE.deploymentId) ||
        (key === 'redirect' && value === '/warehouse/receiving') ||
        (['w', 'q'].includes(key) && /^\d{1,4}$/.test(value));
      safeQuery[key] = safe ? value : '[present]';
    }
  }
  return { resourceType: request.resourceType,
    queryKeys: [...url.searchParams.keys()].map(key => publicKeys.includes(key) ? key : '[other]'), safeQuery };
}

export async function loadAuditHelpers(output) {
  const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
  const ts = require('typescript');
  const source = await readFile(new URL('./full-intra-live-e2e.mjs', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('audit.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const names = ['pageAudit', 'auditKeyboardAndHotspots', 'routeReadinessSnapshot',
    'describeRouteStructureProblems', 'waitForMeaningfulRoute', 'routeEvidenceToken',
    'captureScrollableEvidenceForPage', 'captureRouteEvidence'];
  const hashes = {};
  const definitions = names.map(name => {
    const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
    assert(node, `Missing actual harness helper: ${name}`);
    const text = node.getText(ast);
    hashes[name] = sha256(text);
    return text;
  });
  const helpers = new Function('mkdir', 'path', 'auditEvidenceDir',
    `${definitions.join('\n')}\nreturn {${names.join(',')}};`)(mkdir, path, path.join(output, 'evidence'));
  return { helpers, hashes };
}

// Reports contain audit geometry, not auth responses, request bodies, headers or page input values.
function cleanReport(value) {
  if (typeof value === 'string') return value.replace(/https?:\/\/[^\s"'<>]+/g, raw => {
    try { const url = new URL(raw); return url.origin + url.pathname; } catch { return '[URL omitted]'; }
  }).replace(/([?&](?:access_token|refresh_token|token|apikey|signature)=)[^&\s]*/gi, '$1[redacted]');
  if (Array.isArray(value)) return value.map(cleanReport);
  if (object(value)) return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^(?:password|cookies?|authorization|access_token|refresh_token|headers)$/i.test(key))
    .map(([key, item]) => [key, cleanReport(item)]));
  return value;
}

async function run(outputArgument) {
  assertGate(process.env);
  assertOutputRoot(outputArgument);
  await mkdir(outputArgument, { recursive: true });
  assertOutputRoot(await realpath(outputArgument));
  const output = await mkdtemp(path.join(outputArgument, 'attempt-'));
  const reportFile = path.join(output, 'report.json');
  const { helpers, hashes } = await loadAuditHelpers(output);
  const report = { scope: SCOPE, plan: PLAN, startedAt: new Date().toISOString(),
    runnerSha256: sha256(await readFile(new URL(import.meta.url))), helperSha256: hashes,
    method: 'Ordinary UI password sign-in and self-scoped learning bootstrap synchronization; route probes and evidence reads; no business workflow commands or persona reconciliation',
    bootstrapPolicy: 'Only argumentless learning.resolve_assignments for the two existing actors; may synchronize existing completion evidence. No manual learning completion or certificate evaluation calls are permitted.',
    health: [], results: [], blockedRequests: [], readErrors: [], pass: false };
  const save = () => writeFile(reportFile, JSON.stringify(cleanReport(report), null, 2));
  await save();
  const healthCheck = async label => {
    assertGate(process.env);
    const response = await fetch(`${SCOPE.origin}/api/health`, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    assert(response.ok, 'Canonical health request failed');
    const health = await response.json();
    assertHealth(health);
    report.health.push({ label, checkedAt: new Date().toISOString(), commit: health.commit,
      status: health.status, appEnv: health.deployment.appEnv, project: health.deployment.supabaseProjectRef });
  };
  let browser;
  let timedOut = false;
  let timer;
  try {
    await healthCheck('start');
    const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
    browser = await require('@playwright/test').chromium.launch({ headless: true });
    timer = setTimeout(() => { timedOut = true; void browser.close(); }, 15 * 60_000);
    for (const width of [320, 360, 390]) for (const actor of actors) {
      const cases = PLAN.filter(item => item.role === actor.role && item.width === width);
      const context = await browser.newContext({ viewport: { width, height: cases[0].height },
        isMobile: true, hasTouch: true, reducedMotion: 'reduce', serviceWorkers: 'block' });
      let loginAllowed = true;
      let identity = null;
      let authFailure = false;
      let activeRoute = '/login';
      const requestLabel = request => {
        const url = new URL(request.url());
        return { role: actor.role, width, route: activeRoute, method: request.method(),
          ...safeRequestShape({ url: request.url(), resourceType: request.resourceType() }),
          destination: url.origin === SCOPE.origin ? 'app' : url.origin === `https://${SCOPE.project}.supabase.co` ? 'uat-backend' : 'external',
          path: url.pathname, schema: request.headers()['content-profile'] || request.headers()['accept-profile'] || null };
      };
      try {
        await context.routeWebSocket('**/*', socket => socket.close());
        await context.route('**/*', async route => {
          const request = route.request();
          let body;
          try { body = request.postDataJSON(); } catch { body = null; }
          const descriptor = { url: request.url(), method: request.method(), body, resourceType: request.resourceType(),
            schema: request.headers()['content-profile'] || request.headers()['accept-profile'] };
          if (manilaDate() !== SCOPE.date || !requestAllowed(descriptor, { actor, password: process.env.AUDIT_PASSWORD, loginAllowed })) {
            report.blockedRequests.push(requestLabel(request));
            return route.abort('blockedbyclient');
          }
          if (new URL(request.url()).pathname === '/auth/v1/token') {
            loginAllowed = false;
            try {
              const response = await route.fetch({ maxRedirects: 0 });
              assert(response.ok());
              const data = await response.json();
              assertIdentity(data.user, actor);
              identity = { role: actor.role, email: data.user.email, id: data.user.id };
              await route.fulfill({ response });
            } catch {
              authFailure = true;
              await route.abort('failed');
            }
            return;
          }
          await route.continue();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(20_000);
        page.on('response', response => {
          if (response.status() >= 400) report.readErrors.push({ ...requestLabel(response.request()), status: response.status() });
        });
        await page.goto(`${SCOPE.origin}/login?redirect=%2Fwarehouse%2Freceiving`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.locator('#email').fill(actor.email);
        await page.locator('#password').fill(process.env.AUDIT_PASSWORD);
        await page.getByRole('button', { name: /^sign in$/i }).click();
        await page.waitForURL(url => url.origin === SCOPE.origin && url.pathname === '/warehouse/receiving', { timeout: 30_000 });
        assert(identity && !authFailure, 'Exact-account sign-in not confirmed');
        for (const item of cases) {
          await healthCheck(`${item.role}:${item.width}:${item.route}`);
          activeRoute = item.route;
          const result = { ...item, actorId: identity.id, ok: false, screenshots: [], problems: [] };
          report.results.push(result);
          try {
            await page.goto(SCOPE.origin + item.route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            await helpers.waitForMeaningfulRoute(page);
            assert.equal(new URL(page.url()).pathname, item.route);
            const audit = await helpers.pageAudit(page);
            const headings = { receiving: 'Receiving', returns: 'Returns receiving', fulfillment: 'Pick & Pack', 'cycle-counts': 'Cycle Counts' };
            assert.deepEqual(audit.h1, [headings[item.route.split('/').at(-1)]], 'Wrong route-owned heading');
            const { text: ignoredText, ...visual } = audit;
            void ignoredText;
            result.visual = visual;
            result.readiness = await helpers.routeReadinessSnapshot(page);
            result.problems.push(...helpers.describeRouteStructureProblems(result.readiness));
            result.keyboardHotspots = await helpers.auditKeyboardAndHotspots(page);
            const keyboard = result.keyboardHotspots;
            if (audit.horizontalOverflow || audit.overlaps.length || audit.deadLinks.length || audit.unlabeledControls.length) result.problems.push('Rendered layout/control findings');
            if (keyboard.undersizedTargets.length || keyboard.interceptedTargets.length || keyboard.focusEscapedDialog ||
                (keyboard.focusableCount > 0 && !keyboard.focusAfterTab?.tag)) result.problems.push('Keyboard/hotspot findings');
          } catch { result.problems.push('Route load, heading, or audit did not complete'); }
          try {
            result.screenshots = (await helpers.captureRouteEvidence(page, {
              role: item.role, viewport: `mobile-${item.width}`, route: item.route, state: 'retest',
            })).map(file => path.resolve(file));
          } catch { result.problems.push('Persistent screenshot capture failed'); }
          if (report.blockedRequests.length || report.readErrors.length) result.problems.push('Network guard blocked a request or a read failed; inspect report');
          result.ok = result.problems.length === 0;
          await save();
          console.log(JSON.stringify({ role: item.role, width: item.width, route: item.route, ok: result.ok,
            intercepted: result.keyboardHotspots?.interceptedTargets.length ?? null, screenshots: result.screenshots.length }));
        }
      } finally { await context.close(); }
    }
    await healthCheck('finish');
    assertComplete(report.results);
    assert.equal(report.blockedRequests.length, 0);
    assert.equal(report.readErrors.length, 0);
    report.pass = true;
  } catch {
    report.failure = timedOut ? 'Bounded 15-minute audit expired' : 'Preflight, authentication, request guard, or route evidence failed; inspect bounded report';
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    await browser?.close();
    report.finishedAt = new Date().toISOString();
    await save();
    console.log(JSON.stringify({ pass: report.pass, completed: report.results.length, report: reportFile }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, 'Supply only the fixed output root');
  await run(process.argv[2]);
}
