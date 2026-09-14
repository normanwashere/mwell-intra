import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile, link } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditPersonas } from './uat-audit-identities.mjs';
import { WMS_CHECKPOINTS, requiredWmsEvidence } from './wms-signoff-contract.mjs';
import * as replenishmentRunner from './wms-replenishment-signoff-live.mjs';
import { createManifest, validateManifest, prepareSql, readbackSql, cleanupInventorySql, prepare,
  assertRunPermission, assertActor, assertPayload, reconcile, executeJourney, newReport,
  classifyCliFailure, parseCliRows, main, authorizeBrowserRequest, reviewedReadRpc, createMcpReadback, MCP_BRIDGE_PROTOCOL, createPageErrorMonitor,
  fillRecommendationForm, captureUiFailure, DATABASE_FUNCTIONS, syntheticPdf, assertCanonicalPayload, inspectStorageUpload,
  assertStorageProof, validateBinding, verifyDraftLine, fillCanonicalWizard, databasePreflightSql } from './wms-replenishment-signoff-live.mjs';

const roles = ['operations_associate', 'procurement_lead'];
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const bindings = Object.fromEntries(roles.map((r, i) => [r, { id: ids[i], email: auditPersonas('checkpoint-v1').find(p => p.role === r).email }]));
const completionInputs = () => Object.fromEntries(['desktop1440', 'mobile390'].map(view => [view, { department: 'operations', costCenter: 'CC-1100',
  budgetCode: 'TEST-ONLY-NOT-FUNDING', neededBy: '2026-09-28', requirementKind: 'materials', unitPrice: 25,
  terms: Object.fromEntries(['acceptanceCriteria', 'deliveryTerms', 'paymentTerms', 'shippingTerms', 'validityPeriod', 'responseDeadline'].map(k => [k, `TEST ONLY ${k}; no actual purchase.`])) }]));
const databaseInputs = () => ({ migrationVersion: '20260913214911', functions: DATABASE_FUNCTIONS.map((signature, i) => ({ signature, md5: 'a'.repeat(32), owner: 'postgres', securityDefiner: true,
  config: ['search_path=""'], authenticated: [0, 3, 4].includes(i), anon: false, serviceRole: i !== 2, publicExecute: false })),
  roleGrants: [{ module: 'procurement', role: 'procurement_officer', cap: 'create_request' }], policyProfiles: [{ id: ids[0], md5: 'b'.repeat(32) }] });
const manifestOptions = () => ({ commit: 'a'.repeat(40), runId: '33333333-3333-4333-8333-333333333333', bindings, completion: completionInputs(), database: databaseInputs() });
const manifest = () => createManifest(manifestOptions());
const copy = structuredClone;
const ts = createRequire(import.meta.url)('typescript');
async function actualSource(ref) {
  const text = await readFile(new URL(`../../${ref}`, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(ref, text, ts.ScriptTarget.Latest, true, ref.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return { text, tree };
}
function sourceNode(tree, predicate) {
  const matches = []; const visit = node => { if (predicate(node)) matches.push(node); ts.forEachChild(node, visit); }; visit(tree);
  assert.equal(matches.length, 1, 'Actual source boundary must remain uniquely identifiable'); return matches[0];
}
function sourceEval(code, expression, scope = {}) {
  const compiled = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  return new Function(...Object.keys(scope), `${compiled.outputText}\nreturn (${expression});`)(...Object.values(scope));
}
test('actual wizard handleSubmit and repository requestPayload emission pass the exact guard with source defaults', async () => {
  const wizard = await actualSource('modules/procurement/src/pages/CreateRequestPage.tsx');
  const store = await actualSource('modules/procurement/src/localStore.ts');
  const attachmentsSource = await actualSource('modules/procurement/src/attachments.ts');
  const functionText = (s, name) => sourceNode(s.tree, n => ts.isFunctionDeclaration(n) && n.name?.text === name).getText(s.tree).replace(/^export /, '');
  const initializer = (s, name, match = () => true) => sourceNode(s.tree, n => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && match(n)).initializer.getText(s.tree);
  const defaults = {};
  for (const name of ['description', 'projectCode', 'philgeps', 'priceReasonableness', 'directAwardReason', 'riskFacts', 'routeConfirmed',
    'exceptionPack', 'importationPlan', 'evaluation', 'alternatives', 'riskIfNot', 'vendorId']) {
    const declaration = sourceNode(wizard.tree, n => ts.isVariableDeclaration(n) && ts.isArrayBindingPattern(n.name) && n.name.elements[0]?.name?.getText(wizard.tree) === name);
    assert(ts.isCallExpression(declaration.initializer) && declaration.initializer.expression.getText(wizard.tree) === 'useState');
    defaults[name] = sourceEval('', declaration.initializer.arguments[0].getText(wizard.tree));
  }
  const policy = {}, profiles = {};
  sourceEval((await actualSource('modules/procurement/src/policyRoute.ts')).text, 'exports', { exports: policy });
  sourceEval((await actualSource('modules/procurement/src/policyProfile.ts')).text, 'exports', { exports: profiles });
  const m = manifest();
  for (const c of m.cases) {
    const b = { requestId: `req_${ids[0]}`, uploads: [0, 1].map(i => uploadFixture(m, c, `req_${ids[0]}`, i)), payload: null, route: null };
    const route = policy.deriveProcurementRoute({ requirementKind: c.completion.requirementKind, category: 'goods', amount: 2 * c.completion.unitPrice,
      requestedMode: 'competitive_bidding', ...defaults.riskFacts }, profiles.MWELL_OPERATING_PROFILE).route;
    assert.equal(route.solicitationType, 'rfq'); let input; const navigation = [];
    const scope = { ...copy(defaults), submissionRef: { current: false }, completionStopped: false, canSaveDraft: true, canSubmit: false,
      route, requirementKind: c.completion.requirementKind, solicitationReady: true, routeEvidenceReady: true,
      lines: [{ description: c.productId, quantity: '2', uom: 'unit', unitPrice: String(c.completion.unitPrice) }], vendors: [],
      profile: { id: ids[1], name: 'Offline Procurement Lead', email: bindings.procurement_lead.email }, serverDraftId: undefined,
      replenishment: { id: ids[0], productId: c.productId, quantity: 2, rationale: c.rationale }, title: `Replenish ${c.productId}`,
      category: 'goods', department: c.completion.department, costCenter: c.completion.costCenter, budgetCode: c.completion.budgetCode,
      neededBy: c.completion.neededBy, needDesc: c.rationale, legacyProjection: policy.legacySourcingMethod(route), solicitationRequirements: c.completion.terms,
      attachments: c.documents.map(d => ({ file: new File([syntheticPdf(m.runId, c.viewport, d.kind)], d.filename, { type: d.mimeType }),
        filename: d.filename, mimeType: d.mimeType, sizeBytes: d.sizeBytes, kind: d.kind, uploadedByEmail: bindings.procurement_lead.email })),
      setSubmitting() {}, setCompletionStopped() {}, success() {}, error(message) { throw new Error(message); }, allowExitRef: { current: false },
      navigate: destination => navigation.push(destination), add: async value => { assert(!input, 'No duplicate add'); input = value; return { id: b.requestId }; } };
    await sourceEval(`${functionText(wizard, 'toNumber')}\n${functionText(wizard, 'handleSubmit')}`, 'handleSubmit({preventDefault(){}}, false)', scope);
    assert(input); assert.deepEqual(navigation, [`/requests/${b.requestId}`]);
    const metadataForRpc = sourceEval(functionText(attachmentsSource, 'attachmentMetadataForRpc'), 'attachmentMetadataForRpc');
    const uploaded = b.uploads.map((u, i) => ({ id: u.id, filename: c.documents[i].filename, mimeType: 'application/pdf', sizeBytes: u.sizeBytes,
      storagePath: u.path, sha256: u.sha256, uploadedAt: '2026-09-14T01:00:04.000Z', uploadedByEmail: bindings.procurement_lead.email, kind: u.kind }));
    const lines = sourceEval(functionText(store, 'newId'), initializer(store, 'lines', n => n.type?.getText(store.tree) === 'ProcurementRequestLine[]' && n.initializer?.getText(store.tree).startsWith('input.lines.map')), { input });
    const estimatedAmount = sourceEval(functionText(store, 'totalOf'), 'totalOf(lines)', { lines });
    const next = sourceEval(functionText(store, 'nowIso'), initializer(store, 'next', n => n.type?.getText(store.tree) === 'ProcurementRequest'),
      { input, lines, estimatedAmount, requestId: b.requestId, attachments: uploaded });
    const emitted = sourceEval('', initializer(store, 'requestPayload'), { next, attachments: uploaded, attachmentMetadataForRpc: metadataForRpc });
    const wire = JSON.parse(JSON.stringify(emitted));
    assert.equal(wire.compliance.intendedResponses, 3); assert(!('vendorsInvited' in wire.compliance)); assert(!('responsesReceived' in wire.compliance));
    assertCanonicalPayload(m, c, wire, b);
  }
});
test('canonical v2 rejects legacy fixtures and requires explicit completion and database bindings', () => {
  assert.throws(() => createManifest({ commit: 'a'.repeat(40), bindings, runId: '1390f33a-bec0-4400-b5b2-717359f2442d' }));
  assert.throws(() => createManifest({ commit: 'a'.repeat(40), bindings }));
});
test('test-only PDF bytes are deterministic and bound to full run, view and document kind', async () => {
  const { syntheticPdf } = await import('./wms-replenishment-signoff-live.mjs');
  assert.equal(typeof syntheticPdf, 'function');
  const run = '33333333-3333-4333-8333-333333333333';
  const bytes = syntheticPdf(run, 'desktop1440', 'spec');
  assert.deepEqual(bytes, syntheticPdf(run, 'desktop1440', 'spec'));
  assert.notDeepEqual(bytes, syntheticPdf(run, 'mobile390', 'spec'));
  assert.match(bytes.toString(), /TEST ONLY/); assert.match(bytes.toString(), /startxref/);
  assert.throws(() => syntheticPdf(run, '../foreign', 'spec'));
});
async function pdfPythonRuntime({ env = process.env, platform = process.platform, execute = promisify(execFile) } = {}) {
  const configured = Object.hasOwn(env, 'WMS_PDF_PYTHON');
  const executable = configured ? env.WMS_PDF_PYTHON : platform === 'win32' ? 'python' : 'python3';
  const failure = () => new Error('Required PDF parser unavailable. Set WMS_PDF_PYTHON to the absolute executable path of an approved Python 3 runtime with PyMuPDF installed. '
    + (configured ? 'The explicit interpreter is not replaced by a fallback. ' : `The default ${executable} on PATH must satisfy the same prerequisite. `)
    + 'Install PyMuPDF in that interpreter environment or select an existing approved runtime. No PDF checks are skipped.');
  if (configured && (typeof executable !== 'string' || !path.isAbsolute(executable))) throw failure();
  const probe = "import fitz,json,sys; assert callable(fitz.open) and callable(fitz.TOOLS.mupdf_warnings); print(json.dumps({'pythonMajor':sys.version_info.major,'pymupdf':fitz.VersionBind}))";
  try {
    const { stdout } = await execute(executable, ['-c', probe], { timeout: 10000, maxBuffer: 65536, encoding: 'utf8', shell: false, windowsHide: true });
    const result = JSON.parse(stdout);
    assert.equal(result.pythonMajor, 3);
    assert(typeof result.pymupdf === 'string' && /^[0-9][0-9A-Za-z.+-]{0,63}$/.test(result.pymupdf));
    return { executable, pymupdf: result.pymupdf };
  } catch { throw failure(); }
}

test('PDF runtime uses the explicit executable verbatim, including spaces, and probes PyMuPDF without a shell', async () => {
  const executable = path.resolve(tmpdir(), 'approved runtime', 'python.exe'), calls = [];
  const runtime = await pdfPythonRuntime({ env: { WMS_PDF_PYTHON: executable }, execute: async (...args) => {
    calls.push(args); return { stdout: JSON.stringify({ pythonMajor: 3, pymupdf: '1.26.4' }) };
  } });
  assert.deepEqual(runtime, { executable, pymupdf: '1.26.4' });
  assert.equal(calls.length, 1); assert.equal(calls[0][0], executable);
  assert.equal(calls[0][1][0], '-c'); assert.match(calls[0][1][1], /fitz\.VersionBind/);
  assert.equal(calls[0][2].shell, false); assert.equal(calls[0][2].windowsHide, true);
  assert.equal(calls[0][2].timeout, 10000); assert.equal(calls[0][2].maxBuffer, 65536);
});
for (const [platform, executable] of [['win32', 'python'], ['linux', 'python3'], ['darwin', 'python3']]) {
  test(`PDF runtime uses the standard ${platform} PATH executable, independent of Node's installation`, async () => {
    const calls = [];
    const runtime = await pdfPythonRuntime({ env: {}, platform, execute: async name => {
      calls.push(name); return { stdout: JSON.stringify({ pythonMajor: 3, pymupdf: '1.26.4' }) };
    } });
    assert.equal(runtime.executable, executable); assert.deepEqual(calls, [executable]);
  });
}
for (const configured of ['', 'python', 'relative/python.exe', '--version']) {
  test(`PDF runtime rejects invalid explicit configuration ${JSON.stringify(configured)} before execution`, async () => {
    let calls = 0;
    await assert.rejects(pdfPythonRuntime({ env: { WMS_PDF_PYTHON: configured }, execute: async () => { calls++; } }), /WMS_PDF_PYTHON.*absolute.*Python 3.*PyMuPDF/);
    assert.equal(calls, 0);
  });
}
for (const defect of ['missing-executable', 'missing-module', 'timeout', 'malformed-probe', 'python2', 'missing-pymupdf']) {
  test(`PDF runtime ${defect} fails actionably without skip, raw stderr or silently replacing an explicit interpreter`, async () => {
    const executable = path.resolve(tmpdir(), 'configured-python.exe'); let calls = 0;
    await assert.rejects(pdfPythonRuntime({ env: { WMS_PDF_PYTHON: executable }, execute: async () => {
      calls++;
      if (['missing-executable', 'missing-module', 'timeout'].includes(defect)) {
        throw Object.assign(new Error('PRIVATE_PROCESS_ERROR'), { code: defect === 'missing-executable' ? 'ENOENT' : 1, stderr: 'PRIVATE_STDERR' });
      }
      return { stdout: defect === 'malformed-probe' ? 'PRIVATE_STDOUT' : JSON.stringify({ pythonMajor: defect === 'python2' ? 2 : 3,
        pymupdf: defect === 'missing-pymupdf' ? null : '1.26.4' }) };
    } }), error => {
      assert.match(error.message, /WMS_PDF_PYTHON.*absolute.*Python 3.*PyMuPDF/);
      assert.match(error.message, /No PDF checks are skipped/); assert.doesNotMatch(error.message, /PRIVATE/); return true;
    });
    assert.equal(calls, 1);
  });
}

test('all four deterministic PDFs parse without repair and render visible text with MuPDF offline', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'wms-pdf-parse-')); t.after(() => rm(root, { recursive: true, force: true }));
  const { executable: python, pymupdf } = await pdfPythonRuntime();
  t.diagnostic(`Required Python 3/PyMuPDF ${pymupdf} verified; runtime selected by ${Object.hasOwn(process.env, 'WMS_PDF_PYTHON') ? 'explicit WMS_PDF_PYTHON' : 'platform PATH default'}.`);
  const script = "import fitz,json,sys; d=fitz.open(sys.argv[1]); p=d[0]; x=p.get_pixmap(); print(json.dumps({'pages':len(d),'repaired':d.is_repaired,'text':p.get_text(),'width':x.width,'height':x.height,'ink':sum(v<240 for v in x.samples),'warnings':fitz.TOOLS.mupdf_warnings()}))";
  const m = manifest();
  for (const c of m.cases) for (const d of c.documents) {
    const file = path.join(root, d.filename); await writeFile(file, syntheticPdf(m.runId, c.viewport, d.kind), { flag: 'wx' });
    const { stdout } = await promisify(execFile)(python, ['-c', script, file], { timeout: 20000, shell: false, windowsHide: true });
    const result = JSON.parse(stdout); assert.equal(result.pages, 1); assert.equal(result.repaired, false); assert.equal(result.warnings, '');
    assert.equal(result.width, 612); assert.equal(result.height, 792); assert(result.ink > 1000);
    assert(result.text.includes(m.runId)); assert(result.text.includes(`${c.viewport} ${d.kind}`)); assert(result.text.includes('TEST ONLY'));
  }
});
async function storageRequest(m, c, index = 0, requestId = `req_${ids[0]}`, bytes) {
  const u = uploadFixture(m, c, requestId, index), d = c.documents[index];
  const form = new FormData(); form.append('cacheControl', '3600'); form.append('', new File([bytes ?? syntheticPdf(m.runId, c.viewport, d.kind)], d.filename, { type: 'application/pdf' }));
  const encoded = new Request('https://offline.invalid', { method: 'POST', body: form });
  return { method: 'POST', url: `https://${m.project}.supabase.co/storage/v1/object/procurement-requests/${u.path}`,
    headers: { authorization: 'Bearer test-only-token', 'x-upsert': 'false', 'content-type': encoded.headers.get('content-type') }, bytes: Buffer.from(await encoded.arrayBuffer()) };
}
test('multipart upload guard binds exact generated IDs, PDF bytes and owner before Storage dispatch', async () => {
  const m = manifest(), c = m.cases[0], request = await storageRequest(m, c);
  const first = await inspectStorageUpload(m, c, roles[1], request, 'test-only-token', null);
  assert.equal(first.requestId, `req_${ids[0]}`); assert.equal(first.upload.path.split('/')[1], first.requestId);
  const binding = { requestId: first.requestId, uploads: [first.upload], payload: null, route: null };
  const second = await inspectStorageUpload(m, c, roles[1], await storageRequest(m, c, 1), 'test-only-token', binding);
  binding.uploads.push(second.upload); validateBinding(m, c, binding); assertStorageProof(m, c, binding, proofFixture(binding));
  await assert.rejects(inspectStorageUpload(m, c, roles[1], await storageRequest(m, c, 1), 'test-only-token', binding));
});
for (const defect of ['wrong-role', 'upsert', 'foreign-token', 'foreign-bucket', 'foreign-run', 'foreign-view', 'request-change', 'encoded-path', 'wrong-bytes', 'unknown-fields', 'delete']) {
  test(`Storage ${defect} is rejected before a request can be authorized`, async () => {
    const m = manifest(), c = m.cases[0]; let request = await storageRequest(m, c), role = roles[1], binding = null;
    if (defect === 'wrong-role') role = roles[0];
    if (defect === 'upsert') request.headers['x-upsert'] = 'true';
    if (defect === 'foreign-token') request.headers.authorization = 'Bearer foreign';
    if (defect === 'foreign-bucket') request.url = request.url.replace('/procurement-requests/', '/public/');
    if (defect === 'foreign-run') request.url = request.url.replace(m.runId, ids[1]);
    if (defect === 'foreign-view') request.url = request.url.replace('desktop1440', 'mobile390');
    if (defect === 'request-change') binding = { requestId: `req_${ids[1]}`, uploads: [], payload: null, route: null };
    if (defect === 'encoded-path') request.url = request.url.replace('/request/', '/request/%2e%2e/');
    if (defect === 'wrong-bytes') request = await storageRequest(m, c, 0, `req_${ids[0]}`, Buffer.from('%PDF-foreign'));
    if (defect === 'unknown-fields') { request.headers['content-type'] = 'application/json'; request.bytes = Buffer.from('{"unknown":true}'); }
    if (defect === 'delete') request.method = 'DELETE';
    await assert.rejects(inspectStorageUpload(m, c, role, request, 'test-only-token', binding));
  });
}
for (const defect of ['data-uri', 'unverified-hash', 'incomplete-list', 'foreign-owner', 'failed-upload']) test(`Storage proof ${defect} cannot credit a durable upload`, () => {
  const m = manifest(), c = m.cases[0], b = { requestId: `req_${ids[0]}`, uploads: [uploadFixture(m, c, `req_${ids[0]}`, 0)], payload: null, route: null };
  const p = proofFixture(b);
  if (defect === 'data-uri') p.path = 'data:application/pdf;base64,ZmFrZQ==';
  if (defect === 'unverified-hash') p.downloadSha256 = 'f'.repeat(64);
  if (defect === 'incomplete-list') p.listedNames = [];
  if (defect === 'foreign-owner') p.actorId = ids[0];
  if (defect === 'failed-upload') p.uploadStatus = 500;
  assert.throws(() => assertStorageProof(m, c, b, p));
});
function proof(m, role) {
  const caps = role === roles[0] ? { warehouse: ['view_inventory', 'recommend_replenishment'] }
    : { warehouse: ['view_inventory', 'view_procurement'], procurement: ['view_dashboard', 'manage_replenishment', 'create_request', 'manage_rfp'] };
  return { user: m.actors[role], profile: m.actors[role], capabilities: { userCapabilities: caps, roleCapabilities: caps } };
}
function initial(m, c) {
  return { runId: m.runId, view: c.viewport, dbDate: '2026-09-14', database: copy(m.database), rows: {
    products: [{ id: c.productId, sku: c.sku, name: c.productName, category: 'merchandise', serialized: false,
      item_class: 'merchandise', reorder_point: 2, unit_cost: 1, attributes: { signoffRun: m.runId, synthetic: true, viewport: c.viewport } }],
    recommendations: [], requests: [], activity: [], attachments: [], collaborators: [], intakeActors: [], storage: [], routeDecisions: [],
    requester: { ...m.actors[roles[1]], full_name: 'Offline Procurement Lead' }, bucket: { id: 'procurement-requests', public: false },
  }, blockers: Object.fromEntries(['stock', 'units', 'movements', 'reservations', 'holds', 'allocations', 'lots', 'purchaseOrders',
    'approvalSteps', 'approvalAudit', 'revisions', 'notifications', 'documents', 'actionEvidence'].map(k => [k, 0])) };
}
function payloadFixture(m, c, binding) {
  const f = c.completion;
  return { id: binding.requestId, title: `Replenish ${c.productId}`, department: f.department, cost_center: f.costCenter, budget_code: f.budgetCode,
    needed_by: f.neededBy, requester_name: 'Offline Procurement Lead', requester_email: m.actors[roles[1]].email,
    lines: [{ id: `rl_${ids[0]}`, description: c.productId, quantity: 2, uom: 'unit', unitPrice: f.unitPrice }], estimated_amount: 2 * f.unitPrice,
    category: 'goods', requirement_kind: f.requirementKind, requested_mode: 'competitive_bidding', sourcing_method: 'rfq', solicitation_requirements: copy(f.terms),
    justification: { need: c.rationale }, compliance: { vendorAccreditationRequired: true, routeConfirmed: false, policyVersion: 'procurement-policy-revised-2026',
      riskFacts: { comparable: true, complex: false, technical: false, strategic: false, highRisk: false, dataSensitive: false, importation: false }, intendedResponses: 3 },
    attachments: binding.uploads.map((u, i) => ({ id: u.id, filename: c.documents[i].filename, mime_type: 'application/pdf', size_bytes: u.sizeBytes,
      storage_path: u.path, sha256: u.sha256, uploaded_at: '2026-09-14T01:00:04.000Z', uploaded_by_email: m.actors[roles[1]].email, kind: u.kind })) };
}
function uploadFixture(m, c, requestId, i) {
  const d = c.documents[i], id = `att_${ids[i].replaceAll('-', '')}`;
  return { id, path: `request/${requestId}/${id}-${d.filename}`, kind: d.kind, sha256: d.sha256, sizeBytes: d.sizeBytes, actorId: ids[1] };
}
function proofFixture(binding) {
  const u = binding.uploads.at(-1);
  return { bucket: 'procurement-requests', path: u.path, actorId: u.actorId, uploadStatus: 200, downloadSha256: u.sha256, downloadSizeBytes: u.sizeBytes,
    listedNames: binding.uploads.map(u => u.path.split('/').at(-1)), source: 'authenticated-owner-sdk-download+complete-prefix-list' };
}
function uploadReceiptFixture(binding) {
  const u = binding.uploads.at(-1);
  return { bucket: 'procurement-requests', path: u.path, actorId: u.actorId, uploadStatus: 200, source: 'intercepted-browser-upload' };
}
function harness(m) {
  const states = Object.fromEntries(m.cases.map(c => [c.viewport, initial(m, c)]));
  const calls = [], records = [];
  let closed = 0, seq = 0;
  const adapter = {
    kind: 'offline-injected-harness',
    health: async () => ({ status: 'ok', commit: m.commit, deployment: { appEnv: 'uat', supabaseProjectRef: m.project } }),
    actor: async role => proof(m, role),
    read: async c => copy(states[c.viewport]),
    record: async row => records.push(copy(row)),
    capture: async (c, role, stage) => ({ ref: `${c.viewport}-${stage}.png`, sha256: 'f'.repeat(64), width: c.width, height: c.height, contentWidth: c.width, reviewed: false, actorId: m.actors[role].id }),
    close: async () => { closed += 1; },
    command: async (c, role, action, payload) => {
      calls.push([c.viewport, role, action]);
      const s = states[c.viewport], time = new Date(Date.UTC(2026, 8, 14, 1, 0, ++seq)).toISOString();
      if (action === 'recommend') s.rows.recommendations.push({ id: c.viewport === 'desktop1440' ? '44444444-4444-4444-8444-444444444444' : '55555555-5555-4555-8555-555555555555',
        ...payload, status: 'recommended', created_at: time, decided_by: null, decided_at: null, procurement_request_id: null, purchase_order_id: null, ordered_at: null, expected_arrival_at: null });
      const r = s.rows.recommendations[0]; delete r.action;
      if (action !== 'recommend') { r.status = action === 'accept' ? 'accepted' : 'handed_off'; r.decided_by = m.actors[role].id; r.decided_at = time; }
      if (action === 'handoff') {
        const p = payload.request; r.procurement_request_id = p.id;
        const q = { ...copy(p), requester_id: m.actors[role].id, status: 'draft', justification: { ...p.justification, replenishmentRecommendationId: r.id },
          compliance: { ...p.compliance, source: 'warehouse_replenishment' }, attachments: p.attachments.map(a => ({ id: a.id, filename: a.filename, mimeType: a.mime_type,
            sizeBytes: a.size_bytes, storagePath: a.storage_path, sha256: a.sha256, uploadedAt: a.uploaded_at, uploadedByEmail: a.uploaded_by_email, kind: a.kind })),
          core_vendor_id: null, vendor_name: null, description: null, project_code: null, submitted_at: null, decided_at: null, route_confirmed_at: null, route_confirmed_by: null,
          sourcing_override: false, route_version: 0 };
        delete q.requested_mode; s.rows.requests.push(q);
        s.rows.attachments = p.attachments.map(a => ({ ...a, request_id: p.id, uploaded_by: ids[1] }));
        s.rows.activity.push({ id: `created-${seq}`, module: 'procurement', entity_type: 'request', entity_id: p.id, actor: ids[1], action: 'created', created_at: time,
          detail: { title: p.title, attachment_count: 2 } });
      }
      s.rows.activity.push({ id: `audit-${seq}`, module: 'procurement', entity_type: 'replenishment_recommendation', entity_id: r.id,
        action, actor: m.actors[role].id, created_at: time, detail: { product_id: c.productId, status: r.status, procurement_request_id: r.procurement_request_id } });
      return { data: copy(r), error: null };
    },
    complete: async (c, role, recommendationId, hooks) => {
      const binding = { requestId: `req_${recommendationId}`, uploads: [], payload: null, route: null };
      for (let i = 0; i < 2; i++) {
        await hooks.beforeUpload(copy(binding)); const u = uploadFixture(m, c, binding.requestId, i);
        states[c.viewport].rows.storage.push({ id: ids[i], bucket_id: 'procurement-requests', name: u.path, owner_id: ids[1], metadata: { size: u.sizeBytes, mimetype: 'application/pdf' } });
        binding.uploads.push(u); await hooks.uploaded(copy(binding), uploadReceiptFixture(binding));
      }
      binding.payload = payloadFixture(m, c, binding); await hooks.beforeHandoff(copy(binding));
      return adapter.command(c, role, 'handoff', { id: recommendationId, action: 'handoff', request: binding.payload });
    },
    verifyEvidence: async (c, role, binding) => binding.uploads.map(u => ({ ...proofFixture(binding), path: u.path, downloadSha256: u.sha256, downloadSizeBytes: u.sizeBytes })),
    negative: async (c, role, payload) => {
      calls.push([c.viewport, role, `deny:${payload.action}`]);
      const status = states[c.viewport].rows.recommendations[0]?.status;
      const message = role === roles[0] && payload.action !== 'recommend' ? 'Not authorized: procurement.manage_replenishment'
        : role === roles[1] && payload.action === 'recommend' ? 'Not authorized: warehouse.recommend_replenishment'
          : payload.action === 'recommend' ? 'Replenishment recommendation was already accepted or handed off.'
            : payload.action === 'accept' ? 'Only a recommendation can be accepted' : 'Accept the recommendation before handoff';
      assert(status); return { data: null, error: { code: 'P0001', message } };
    },
    openRequest: async (c, role, request) => { calls.push([c.viewport, role, 'open-request']); return { requestId: request.id, path: `/procurement/requests/${request.id}`, actorId: m.actors[role].id }; },
    confirmRoute: async (c, role, payload) => {
      calls.push([c.viewport, role, 'confirm-route']); const q = states[c.viewport].rows.requests[0];
      const d = { id: ids[0], request_id: q.id, request_version: 1, method: 'rfq', status: 'confirmed', confirmed_by: ids[1], confirmed_at: '2026-09-14T01:02:00.000Z',
        risk_facts: copy(q.compliance.riskFacts), solicitation_type: 'rfq', procurement_mode: 'competitive_bidding', governance_tier: 'operating', policy_profile_id: ids[0], reasons: ['offline-only'] };
      assert.equal(payload.expected_route_version, 0); states[c.viewport].rows.routeDecisions.push(d);
      Object.assign(q, { solicitation_type: d.solicitation_type, procurement_mode: d.procurement_mode, governance_tier: d.governance_tier, policy_profile_id: d.policy_profile_id,
        route_reasons: d.reasons, route_version: 1, route_confirmed_at: d.confirmed_at, route_confirmed_by: d.confirmed_by }); q.compliance.routeConfirmed = true;
      return { data: { ...copy(d), route: { status: 'derived', solicitation_type: d.solicitation_type, procurement_mode: d.procurement_mode,
        governance_tier: d.governance_tier, policy_profile_id: d.policy_profile_id, reasons: d.reasons } }, error: null };
    },
    negativeRoute: async (c, role) => { calls.push([c.viewport, role, 'deny:stale-route']); return { data: null, error: { code: 'P0001', message: 'Route confirmation is stale; reload the request before confirming' } }; },
  };
  return { adapter, states, calls, records, closed: () => closed };
}

test('manifest is dedicated, exact, full-UUID owned and binds distinct approved existing identities', () => {
  const m = manifest(); assert.equal(validateManifest(copy(m)).kind, 'wms-replenishment');
  for (const change of [x => x.kind = 'wms-ecommerce-shipment', x => x.origin = 'https://elsewhere.invalid', x => x.cases[0].quantity = 99,
    x => x.cases[0].productId += "'", x => x.actors.procurement_lead.id = ids[0], x => x.actors.operations_associate.email = 'foreign@example.invalid']) {
    const bad = copy(m); change(bad); assert.throws(() => validateManifest(bad));
  }
});
test('prepare SQL seeds products only; discovery is read-only and never offers deletion', () => {
  const m = manifest(), sql = prepareSql(m);
  assert.equal((sql.match(/insert into warehouse.products/g) ?? []).length, 2);
  assert(sql.includes(m.runId)); assert(sql.includes('reorder_point'));
  assert(!/delete|truncate|cascade|update |insert into (?!warehouse.products)/i.test(sql));
  for (const text of [cleanupInventorySql(m), ...m.cases.map(c => readbackSql(m, c.viewport))]) {
    assert(text.includes('begin read only;')); assert(!/\b(delete|truncate|insert|update|alter|drop)\b/i.test(text));
  }
});
test('offline prepare creates exclusive artifacts; importing and invalid CLI cannot run adapters', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'wms-replen-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'prepared'); await prepare(folder, manifestOptions());
  assert.deepEqual((await readdir(folder)).sort(), [...manifest().cases.flatMap(c => c.documents.map(d => d.filename)), 'cleanup-inventory.sql', 'manifest.json', 'prepare.sql', 'readback-desktop1440.sql', 'readback-mobile390.sql'].sort());
  validateManifest(JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8')));
  await assert.rejects(prepare(folder, manifestOptions()));
  for (const args of [[], ['run', folder], ['seed', folder], ['prepare', folder, '--apply']]) await assert.rejects(main(args));
});
test('live execution requires all explicit target/run/CLI/password gates', () => {
  const m = manifest(), env = { APP_ENV: 'uat', AUDIT_MUTATIONS: 'true', AUDIT_PASSWORD: 'ephemeral', WMS_REPLENISHMENT_RUN_ID: m.runId,
    WMS_REPLENISHMENT_CLI_WORKDIR: path.resolve('linked'), WMS_REPLENISHMENT_CLI_EXCLUSIVE: 'approved' };
  assertRunPermission(m, env, true);
  assert.throws(() => assertRunPermission(m, env, false));
  for (const key of Object.keys(env)) assert.throws(() => assertRunPermission(m, { ...env, [key]: '' }, true));
});

test('MCP mode skips only CLI prerequisites and rejects unknown readback modes', () => {
  const m = manifest(), env = { APP_ENV: 'uat', AUDIT_MUTATIONS: 'true', AUDIT_PASSWORD: 'ephemeral', WMS_REPLENISHMENT_RUN_ID: m.runId };
  assertRunPermission(m, env, true, 'mcp');
  for (const key of Object.keys(env)) assert.throws(() => assertRunPermission(m, { ...env, [key]: '' }, true, 'mcp'));
  assert.throws(() => assertRunPermission(m, env, false, 'mcp'));
  assert.throws(() => assertRunPermission(m, env, true, 'unknown'));
  assert.throws(() => assertRunPermission(m, env, true, 'cli'));
});

function mcpResponse(request, snapshot) {
  return { request: copy(request), executedAt: request.requestedAt, completedAt: request.requestedAt,
    provenance: { kind: 'parent-mediated-mcp', trust: 'trusted-parent-not-cryptographic-proof', tool: 'supabase.execute_sql', executionRef: 'offline-fixture-only' }, snapshot };
}
async function bridgeHarness(t, respond) {
  const root = await mkdtemp(path.join(tmpdir(), 'wms-replen-mcp-')); t.after(() => rm(root, { recursive: true, force: true }));
  const m = manifest(), events = []; let time = Date.parse('2026-09-14T00:00:00.000Z');
  const read = await createMcpReadback(m, root, {
    now: () => time, monotonic: () => time, sleep: async ms => { time += ms; },
    record: async event => { events.push(copy(event)); if (event.kind === 'mcp-readback-pending' && respond) {
      assert.deepEqual(JSON.parse(await readFile(path.join(root, event.requestRef), 'utf8')), event.request);
      assert(!(await readdir(root)).includes(`${event.requestRef}.tmp`));
      const response = await respond(event.request, root);
      if (response !== undefined) await writeFile(path.join(root, event.request.responseRef), typeof response === 'string' ? response : JSON.stringify(response), { flag: 'wx' });
    } },
  });
  return { read, root, m, events };
}
test('MCP consumes bound responses before every injected business action and preserves the full journey', async t => {
  const m = manifest(), h = harness(m);
  const b = await bridgeHarness(t, request => mcpResponse(request, copy(h.states[request.view])));
  h.adapter.read = b.read;
  for (const name of ['command', 'negative', 'openRequest']) {
    const original = h.adapter[name]; h.adapter[name] = async (...args) => {
      const pending = b.events.filter(e => e.kind === 'mcp-readback-pending').at(-1).request;
      const receipt = JSON.parse(await readFile(path.join(b.root, pending.consumedRef), 'utf8'));
      assert.equal(receipt.request.nonce, pending.nonce); assert.match(receipt.responseSha256, /^[a-f0-9]{64}$/);
      return original(...args);
    };
  }
  const report = newReport(m, 'offline-injected-mcp-parent'); await executeJourney(m, h.adapter, report);
  assert.equal(report.complete, true); assert.equal(report.checks.length, 10); assert.equal(report.negatives.length, 16);
  const requests = b.events.filter(e => e.kind === 'mcp-readback-pending').map(e => e.request);
  assert.equal(new Set(requests.map(r => r.nonce)).size, requests.length);
  assert.deepEqual(requests.map(r => r.sequence), requests.map((_, i) => i + 1));
  assert.deepEqual(new Set(requests.map(r => r.stage)), new Set(['seeded', 'recommended', 'accepted', 'uploading', 'uploads_ready', 'handed_off', 'route_confirmed']));
  await assert.rejects(createMcpReadback(m, b.root), /EEXIST/);
});
for (const defect of ['run', 'project', 'commit', 'view', 'stage', 'version', 'binding', 'sequence', 'nonce', 'queryhash', 'requestedAt', 'stale', 'future', 'malformed', 'incomplete', 'extra', 'provenance', 'external-path', 'mutated-sql']) {
  test(`MCP ${defect} response fails before any injected business action and cannot resume`, async t => {
    const m = manifest(), h = harness(m);
    const b = await bridgeHarness(t, async (q, root) => {
      const r = mcpResponse(q, initial(m, m.cases.find(c => c.viewport === q.view)));
      if (defect === 'version') r.request.version = 1;
      if (defect === 'binding') r.request.binding = { requestId: `req_${ids[1]}`, uploads: [], payload: null, route: null };
      if (defect === 'run') r.request.runId = ids[0];
      if (defect === 'project') r.request.project = 'foreign';
      if (defect === 'commit') r.request.commit = 'b'.repeat(40);
      if (defect === 'view') r.request.view = 'mobile390';
      if (defect === 'stage') r.request.stage = 'recommended';
      if (defect === 'sequence') r.request.sequence++;
      if (defect === 'nonce') r.request.nonce = ids[0];
      if (defect === 'queryhash') r.request.querySha256 = '0'.repeat(64);
      if (defect === 'requestedAt') r.request.requestedAt = '2026-09-13T00:00:00.000Z';
      if (defect === 'stale') r.executedAt = '2026-09-13T23:59:59.999Z';
      if (defect === 'future') r.completedAt = '2026-09-15T00:00:00.000Z';
      if (defect === 'malformed') return '{invalid';
      if (defect === 'incomplete') delete r.snapshot.blockers.stock;
      if (defect === 'extra') r.approved = true;
      if (defect === 'provenance') r.provenance.trust = 'cryptographically-verified';
      if (defect === 'external-path') r.request.responseRef = '../outside.json';
      if (defect === 'mutated-sql') await writeFile(path.join(root, q.queryRef), 'select 1');
      return r;
    });
    h.adapter.read = b.read;
    await assert.rejects(executeJourney(m, h.adapter, newReport(m, h.adapter.kind)));
    assert.equal(h.calls.length, 0);
    await assert.rejects(b.read(m.cases[0], 'seeded'), /closed|failed/i);
    assert(!(await readdir(b.root)).some(name => name.endsWith('.consumed.json')));
  });
}
test('MCP timeout is bounded at 120 seconds, terminal, and leaves pending evidence without writes', async t => {
  const b = await bridgeHarness(t), h = harness(b.m); h.adapter.read = b.read;
  assert.equal(MCP_BRIDGE_PROTOCOL.timeoutMs, 120000);
  await assert.rejects(executeJourney(b.m, h.adapter, newReport(b.m, h.adapter.kind)), /timeout/i);
  assert.equal(h.calls.length, 0); assert.equal(b.events.filter(e => e.kind === 'mcp-readback-pending').length, 1);
  await assert.rejects(b.read(b.m.cases[0], 'seeded'), /closed|failed/i);
});
test('MCP reused response cannot satisfy the next request even for the same product/stage', async t => {
  let first;
  const b = await bridgeHarness(t, q => { first ??= mcpResponse(q, initial(manifest(), manifest().cases[0])); return first; });
  await b.read(b.m.cases[0], 'seeded');
  await assert.rejects(b.read(b.m.cases[0], 'seeded'));
  assert.equal((await readdir(b.root)).filter(name => name.endsWith('.consumed.json')).length, 1);
});

test('MCP rejects linked response files and an already-consumed receipt before continuation', async t => {
  for (const mode of ['hardlink', 'consumed']) {
    const b = await bridgeHarness(t, async (q, root) => {
      const response = mcpResponse(q, initial(manifest(), manifest().cases[0]));
      if (mode === 'hardlink') {
        const other = path.join(root, 'other.json'); await writeFile(other, JSON.stringify(response));
        await link(other, path.join(root, q.responseRef)); return undefined;
      }
      await writeFile(path.join(root, q.consumedRef), '{}'); return response;
    });
    await assert.rejects(b.read(b.m.cases[0], 'seeded'));
    await assert.rejects(b.read(b.m.cases[0], 'seeded'), /closed/);
  }
});

test('MCP concurrent reads close the bridge without issuing another request', async t => {
  let second;
  const b = await bridgeHarness(t, async q => {
    second = assert.rejects(b.read(b.m.cases[1], 'seeded'), /Concurrent/);
    return mcpResponse(q, initial(b.m, b.m.cases[0]));
  });
  await assert.rejects(b.read(b.m.cases[0], 'seeded'), /closed/); await second;
  assert.equal(b.events.filter(e => e.kind === 'mcp-readback-pending').length, 1);
});

test('read-only request-name lookup accepts PostgreSQL legacy/uppercase UUIDs without widening owned UUID proofs', () => {
  const legacy = '00000000-0000-0000-0000-000000000001', uppercase = 'ABCDEFAB-CDEF-ABCD-EFAB-CDEFABCDEFAB';
  const allowed = body => reviewedReadRpc('warehouse', 'department_request_actor_names', body, roles[0]);
  assert(allowed({ p_request_ids: [legacy, uppercase] }));
  for (const body of [{ p_request_ids: ['../foreign'] }, { p_request_ids: ['invalid'] }, { p_request_ids: [legacy], extra: true },
    { p_request_ids: Array(201).fill(legacy) }, { p_request_ids: [null] }]) assert.equal(allowed(body), false);
  assert.throws(() => createManifest({ commit: 'a'.repeat(40), runId: legacy, bindings }));
});

test('unhandled page errors are counted per page, hashed without raw messages and block final success', async () => {
  const events = [], monitor = createPageErrorMonitor(async row => events.push(row));
  const pages = [new EventEmitter(), new EventEmitter()];
  pages.forEach((page, i) => monitor.attach(page, { view: i ? 'mobile390' : 'desktop1440', actorId: ids[i] }));
  pages[0].emit('pageerror', new Error('private session token not for report'));
  pages[0].emit('pageerror', new Error('second error'));
  await assert.rejects(monitor.finish(), /Unhandled browser page errors/);
  const summary = events.find(e => e.kind === 'browser-pageerror-summary');
  assert.deepEqual(summary.pages.map(p => p.count), [2, 0]); assert.equal(summary.total, 2);
  assert(!JSON.stringify(events).includes('private session')); assert.match(events[0].messageSha256, /^[a-f0-9]{64}$/);
  const m = manifest(), h = harness(m); h.adapter.close = async () => monitor.finish();
  const report = newReport(m, h.adapter.kind); await assert.rejects(executeJourney(m, h.adapter, report)); assert.equal(report.complete, false);
});

test('pageerror summary states its observation boundary and recording failure cannot pass', async () => {
  const monitor = createPageErrorMonitor(async () => {}); monitor.attach(new EventEmitter(), { view: 'desktop1440', actorId: ids[0] });
  const summary = await monitor.finish(); assert.equal(summary.total, 0); assert.match(summary.scope, /not console or network/);
  const broken = createPageErrorMonitor(async () => { throw new Error('artifact persistence failed'); });
  const page = new EventEmitter(); broken.attach(page, { view: 'desktop1440', actorId: ids[0] }); page.emit('pageerror', new Error('hidden'));
  await assert.rejects(broken.finish());
});
test('effective actors reject foreign identity, raw-only grants and mixed decision authority', () => {
  const m = manifest(); for (const role of roles) assertActor(m, role, proof(m, role));
  for (const change of [x => x.user.id = ids[1], x => x.profile.email = 'foreign', x => x.capabilities.userCapabilities = {},
    x => x.capabilities.userCapabilities.procurement = ['manage_replenishment'], x => x.capabilities.userCapabilities.warehouse.push('view_procurement')]) {
    const p = copy(proof(m, roles[0])); change(p); assert.throws(() => assertActor(m, roles[0], p));
  }
});
test('actual adapter-driven journey executes both views, separate actors, negatives and linked draft view', async () => {
  const m = manifest(), h = harness(m), report = newReport(m, h.adapter.kind);
  await executeJourney(m, h.adapter, report);
  assert.equal(report.complete, true); assert.equal(report.globalWmsSignoff, false); assert.equal(report.cleanup.status, 'retained');
  assert.equal(report.bindings.length, 2); assert.equal(report.checks.length, 10); assert.equal(report.negatives.length, 16);
  assert.equal(h.closed(), 1);
  for (const c of m.cases) {
    assert.deepEqual(h.calls.filter(r => r[0] === c.viewport && !r[2].startsWith('deny:')).map(r => r.slice(1)),
      [[roles[0], 'recommend'], [roles[1], 'accept'], [roles[1], 'handoff'], [roles[1], 'open-request'], [roles[1], 'confirm-route']]);
    reconcile(m, c.viewport, h.states[c.viewport], 'route_confirmed', report.bindings.find(b => b.view === c.viewport).evidence);
  }
  assert(report.limits.some(x => /dismissal/i.test(x))); assert(report.limits.some(x => /revocation/i.test(x)));
});
test('full 94-gate contract is preserved and this basic report grants no synthetic coverage credit', () => {
  assert.equal(requiredWmsEvidence().length, 94); assert.equal(WMS_CHECKPOINTS.length, 48);
  const r = newReport(manifest(), 'offline-injected-harness');
  assert.equal(r.contractEvidenceEmitted, false); assert.equal(r.globalWmsSignoff, false);
  assert(r.limits.some(x => /concurrency/i.test(x))); assert(r.limits.some(x => /cleanup/i.test(x)));
});
test('payload validation rejects wrong actors, foreign records and unreviewed extra fields', () => {
  const m = manifest(), c = m.cases[0];
  const p = { action: 'recommend', product_id: c.productId, recommended_quantity: 2, on_hand: 0, reorder_point: 2, lead_time_days: 14, stockout_risk: 'critical', rationale: c.rationale };
  assertPayload(m, c, roles[0], 'recommend', p);
  for (const bad of [{ ...p, product_id: 'foreign' }, { ...p, idempotency_key: 'invented' }, { ...p, rationale: 'different' }]) assert.throws(() => assertPayload(m, c, roles[0], 'recommend', bad));
  assert.throws(() => assertPayload(m, c, roles[1], 'recommend', p));
});
test('canonical payload requires early request identity, exact accepted line, classification, estimate, private files and no extra authority', () => {
  const m = manifest(), c = m.cases[0], b = { requestId: `req_${ids[0]}`, uploads: [0, 1].map(i => uploadFixture(m, c, `req_${ids[0]}`, i)), payload: null, route: null };
  const p = payloadFixture(m, c, b); assertCanonicalPayload(m, c, p, b);
  for (const change of [p => p.id = `req_${ids[1]}`, p => p.requirement_kind = '', p => p.estimated_amount = 2,
    p => p.lines[0].quantity = 3, p => p.lines[0].description = 'foreign', p => p.justification.need = 'foreign', p => p.department = 'finance',
    p => p.compliance.routeConfirmed = true, p => p.status = 'approved', p => p.attachments[0].storage_path = 'data:application/pdf;base64,eA==',
    p => p.attachments[0].sha256 = 'f'.repeat(64), p => p.attachments[0].uploaded_by_email = 'foreign@invalid', p => p.vendor_id = ids[0]]) {
    const bad = copy(p); change(bad); assert.throws(() => assertCanonicalPayload(m, c, bad, b));
  }
  assert.throws(() => assertCanonicalPayload(m, c, p, null));
  assert.throws(() => assertCanonicalPayload(m, c, p, { ...b, uploads: b.uploads.slice(0, 1) }));
  assert.throws(() => assertPayload(m, c, roles[1], 'handoff', { action: 'handoff', id: ids[0] }, ids[0]));
});
test('canonical RFQ guard accepts the actual wizard intendedResponses default, not missing or arbitrary evaluation fields', async () => {
  const source = await readFile(new URL('../../modules/procurement/src/pages/CreateRequestPage.tsx', import.meta.url), 'utf8');
  assert.match(source, /useState<EvaluationMatrixValue>\(\{\s*intendedResponses: 3,\s*vendorsInvited: 0,\s*responsesReceived: 0,/);
  assert(source.includes('intendedResponses: evaluation.intendedResponses || undefined'));
  const m = manifest(), c = m.cases[0], b = { requestId: `req_${ids[0]}`, uploads: [0, 1].map(i => uploadFixture(m, c, `req_${ids[0]}`, i)), payload: null, route: null };
  const p = payloadFixture(m, c, b); p.compliance.intendedResponses = 3;
  assertCanonicalPayload(m, c, p, b);
  for (const change of [p => delete p.compliance.intendedResponses, p => p.compliance.intendedResponses = 4,
    p => p.compliance.vendorsInvited = 1, p => p.compliance.responsesReceived = 1]) {
    const bad = copy(p); change(bad); assert.throws(() => assertCanonicalPayload(m, c, bad, b));
  }
});
for (const defect of ['early-bind-artifact', 'initial-bound-read', 'second-upload-read', 'revoked-before-upload', 'premature-byte-proof', 'skip-early-bind', 'skip-handoff-hook']) {
  test(`completion ${defect} stops before the next upload/command and never reaches mobile`, async () => {
    const m = manifest(), h = harness(m), read = h.adapter.read, complete = h.adapter.complete;
    if (defect === 'early-bind-artifact') h.adapter.record = async e => { if (e.kind === 'early-request-binding') throw new Error('disk failure'); };
    if (['initial-bound-read', 'second-upload-read'].includes(defect)) h.adapter.read = async (c, stage, b) => {
      if (b && b.uploads.length === (defect === 'initial-bound-read' ? 0 : 1)) throw new Error('fresh database read failed'); return read(c, stage, b);
    };
    h.adapter.complete = async (c, role, id, hooks) => {
      if (defect === 'revoked-before-upload') h.adapter.actor = async r => ({ ...proof(m, r), capabilities: { userCapabilities: {}, roleCapabilities: {} } });
      const wrapped = { ...hooks };
      if (defect === 'premature-byte-proof') wrapped.uploaded = async (b, p) => hooks.uploaded(b, { ...p, downloadSha256: 'f'.repeat(64) });
      if (defect === 'skip-early-bind') wrapped.beforeUpload = async () => {};
      if (defect === 'skip-handoff-hook') wrapped.beforeHandoff = async () => { throw new Error('handoff intent not recorded'); };
      return complete(c, role, id, wrapped);
    };
    await assert.rejects(executeJourney(m, h.adapter, newReport(m, h.adapter.kind)));
    assert(!h.calls.some(c => c[0] === 'mobile390' || c[2] === 'handoff'));
    const expected = ['early-bind-artifact', 'initial-bound-read', 'revoked-before-upload'].includes(defect) ? 0 : defect === 'skip-handoff-hook' ? 2 : 1;
    assert.equal(h.states.desktop1440.rows.storage.length, expected);
  });
}
for (const defect of ['wrong-version', 'wrong-actor', 'submitted', 'extra-approval', 'lost-response', 'stale-replay-mutates']) {
  test(`separate route ${defect} cannot yield a successful journey or replay`, async () => {
    const m = manifest(), h = harness(m), confirm = h.adapter.confirmRoute;
    h.adapter.confirmRoute = async (...args) => {
      const result = await confirm(...args), s = h.states.desktop1440;
      if (defect === 'wrong-version') s.rows.requests[0].route_version = 2;
      if (defect === 'wrong-actor') s.rows.routeDecisions[0].confirmed_by = ids[0];
      if (defect === 'submitted') s.rows.requests[0].status = 'submitted';
      if (defect === 'extra-approval') s.blockers.approvalSteps = 1;
      if (defect === 'lost-response') throw new Error('route observation timed out');
      return result;
    };
    if (defect === 'stale-replay-mutates') { const denied = h.adapter.negativeRoute; h.adapter.negativeRoute = async (...args) => {
      const result = await denied(...args); h.states.desktop1440.rows.requests[0].budget_code = 'changed'; return result;
    }; }
    const report = newReport(m, h.adapter.kind); await assert.rejects(executeJourney(m, h.adapter, report));
    assert.equal(report.complete, false); assert.equal(h.calls.filter(c => c[2] === 'confirm-route').length, 1); assert(!h.calls.some(c => c[0] === 'mobile390'));
  });
}
test('readbacks reject altered deployment metadata, registered evidence, extra intake actors and unknown objects', async () => {
  const m = manifest(), h = harness(m), report = newReport(m, h.adapter.kind); await executeJourney(m, h.adapter, report);
  const c = m.cases[0], binding = report.bindings[0].evidence, original = h.states[c.viewport];
  for (const change of [s => s.database.functions[1].md5 = 'c'.repeat(32), s => s.database.functions[0].publicExecute = true,
    s => s.database.roleGrants.push({ module: 'procurement', role: 'foreign', cap: 'admin' }), s => s.rows.storage.push({ name: 'foreign' }),
    s => s.rows.attachments[0].uploaded_by = ids[0], s => s.rows.attachments[0].sha256 = 'f'.repeat(64),
    s => s.rows.collaborators.push({ user_id: ids[0] }), s => s.rows.routeDecisions.push(copy(s.rows.routeDecisions[0]))]) {
    const bad = copy(original); change(bad); assert.throws(() => reconcile(m, c.viewport, bad, 'route_confirmed', binding));
  }
});
for (const defect of ['missing-count', 'foreign-product', 'existing-record', 'wrong-build', 'same-actor']) test(`preflight ${defect} aborts before any business action`, async () => {
  const m = manifest(), h = harness(m);
  if (defect === 'missing-count') delete h.states.mobile390.blockers.stock;
  if (defect === 'foreign-product') h.states.mobile390.rows.products[0].attributes.signoffRun = ids[0];
  if (defect === 'existing-record') h.states.mobile390.rows.recommendations.push({ id: ids[0] });
  if (defect === 'wrong-build') h.adapter.health = async () => ({ status: 'ok', commit: 'b'.repeat(40), deployment: { appEnv: 'uat', supabaseProjectRef: m.project } });
  if (defect === 'same-actor') h.adapter.actor = async role => ({ ...proof(m, role), user: bindings.operations_associate });
  await assert.rejects(executeJourney(m, h.adapter, newReport(m, h.adapter.kind)));
  assert.equal(h.calls.length, 0); assert.equal(h.closed(), 1);
});
for (const defect of ['timeout-after-write', 'wrong-audit', 'wrong-draft', 'negative-mutated', 'revoked']) test(`${defect} fails closed without repeating a write or continuing to mobile`, async () => {
  const m = manifest(), h = harness(m), command = h.adapter.command;
  h.adapter.command = async (...args) => {
    const result = await command(...args);
    if (defect === 'timeout-after-write') throw new Error('Observation timeout');
    if (defect === 'wrong-audit') h.states.desktop1440.rows.activity[0].actor = ids[1];
    if (defect === 'wrong-draft' && args[2] === 'handoff') h.states.desktop1440.rows.requests[0].lines[0].quantity = 99;
    if (defect === 'revoked') h.adapter.actor = async role => ({ ...proof(m, role), capabilities: { userCapabilities: {}, roleCapabilities: {} } });
    return result;
  };
  if (defect === 'negative-mutated') { const deny = h.adapter.negative; h.adapter.negative = async (...args) => { const r = await deny(...args); h.states.desktop1440.blockers.stock = 1; return r; }; }
  const report = newReport(m, h.adapter.kind);
  await assert.rejects(executeJourney(m, h.adapter, report));
  assert.equal(report.complete, false); assert.equal(h.calls.filter(c => c[2] === 'recommend').length, 1);
  assert(!h.calls.some(c => c[0] === 'mobile390')); assert.equal(h.closed(), 1);
});
test('CLI parsing and safe failure categories reject ambiguous output without leaking stderr', () => {
  assert.deepEqual(parseCliRows('[{"snapshot":{}}]'), [{ snapshot: {} }]);
  assert.throws(() => parseCliRows('notice\n[]')); assert.throws(() => parseCliRows('{}'));
  const result = classifyCliFailure({ stderr: 'secret password authentication failed' }, 'select 1');
  assert.equal(result.category, 'AUTH'); assert(!JSON.stringify(result).includes('secret')); assert.match(result.querySha256, /^[a-f0-9]{64}$/);
});

test('browser guard permits one exact armed command and rejects foreign, repeated, direct-table, Storage and unknown writes', () => {
  const m = manifest(), c = m.cases[0], role = roles[0];
  const payload = { action: 'recommend', product_id: c.productId, recommended_quantity: 2, on_hand: 0, reorder_point: 2, lead_time_days: 14, stockout_risk: 'critical', rationale: c.rationale };
  const request = { method: 'POST', url: `https://${m.project}.supabase.co/rest/v1/rpc/manage_replenishment_recommendation`,
    headers: { 'content-profile': 'procurement', authorization: 'Bearer private-memory-token' }, body: { payload } };
  const armed = { key: `${c.viewport}:${role}`, payload, consumed: false };
  assert.equal(authorizeBrowserRequest(m, c, role, request, armed, 'private-memory-token'), 'command');
  for (const arm of [undefined, { ...armed, consumed: true }, { ...armed, key: `mobile390:${role}` }]) assert.throws(() => authorizeBrowserRequest(m, c, role, request, arm, 'private-memory-token'));
  for (const modify of [r => r.method = 'DELETE', r => r.url = 'https://foreign.invalid/write', r => r.url = `https://${m.project}.supabase.co/rest/v1/products`,
    r => r.url = `https://${m.project}.supabase.co/storage/v1/object/evidence/new`, r => r.url += '_unknown', r => r.headers.authorization = 'Bearer foreign',
    r => r.body.payload.product_id = 'foreign', r => r.body.payload.action = 'dismiss']) {
    const bad = copy(request); modify(bad); assert.throws(() => authorizeBrowserRequest(m, c, role, bad, armed, 'private-memory-token'));
  }
});
test('only exact own-user learning bootstrap is permitted and auth cannot change the bound email', () => {
  const m = manifest(), c = m.cases[0], role = roles[0];
  const r = { method: 'POST', url: `https://${m.project}.supabase.co/rest/v1/rpc/resolve_assignments`, headers: { 'content-profile': 'learning' }, body: {} };
  assert.equal(authorizeBrowserRequest(m, c, role, r), 'bootstrap');
  assert.throws(() => authorizeBrowserRequest(m, c, role, { ...r, body: { user_id: ids[1] } }));
  assert.throws(() => authorizeBrowserRequest(m, c, role, { ...r, url: r.url.replace('resolve_assignments', 'grant_certification') }));
  const auth = { ...r, url: `https://${m.project}.supabase.co/auth/v1/token?grant_type=password`, body: { email: m.actors[role].email } };
  assert.equal(authorizeBrowserRequest(m, c, role, auth), 'auth');
  assert.throws(() => authorizeBrowserRequest(m, c, role, { ...auth, body: { email: m.actors[roles[1]].email } }));
});
test('Procurement page read projections do not admit extra mutation parameters or decision RPCs', () => {
  assert(reviewedReadRpc('procurement', 'purchase_order_receipt_status', { payload: {} }, roles[1]));
  assert(reviewedReadRpc('procurement', 'review_open_purchase_orders', { payload: {} }, roles[1]));
  assert(reviewedReadRpc('procurement', 'purchase_order_lifecycle', { payload: { purchase_order_id: 'po_existing' } }, roles[1]));
  assert(reviewedReadRpc('procurement', 'commitment_readiness', { payload: { request_id: 'req_existing', vendor_id: null, phase: 'issue' } }, roles[1]));
  for (const name of ['close_purchase_order', 'confirm_route_decision', 'manage_replenishment_recommendation', 'unknown']) assert(!reviewedReadRpc('procurement', name, { payload: {} }, roles[1]));
  assert(!reviewedReadRpc('procurement', 'review_open_purchase_orders', { payload: { apply: true } }, roles[1]));
  assert(!reviewedReadRpc('procurement', 'review_open_purchase_orders', { payload: {} }, roles[0]));
});
test('route guard permits one separately armed confirmation but never submit, approve, creator or replay', () => {
  const m = manifest(), c = m.cases[0], role = roles[1], payload = { request_id: `req_${ids[0]}`, expected_route_version: 0, requested_mode: 'competitive_bidding' };
  const arm = { key: `${c.viewport}:${role}`, rpc: 'confirm_route_decision', payload, consumed: false };
  const request = { method: 'POST', url: `https://${m.project}.supabase.co/rest/v1/rpc/confirm_route_decision`, headers: { 'content-profile': 'procurement', authorization: 'Bearer offline' }, body: { payload } };
  assert.equal(authorizeBrowserRequest(m, c, role, request, arm, 'offline'), 'command');
  for (const name of ['submit_request', 'decide_request_step', 'create_request', 'manage_replenishment_recommendation', 'update_request']) {
    assert.throws(() => authorizeBrowserRequest(m, c, role, { ...request, url: request.url.replace('confirm_route_decision', name) }, arm, 'offline'));
  }
  assert.throws(() => authorizeBrowserRequest(m, c, role, request, { ...arm, consumed: true }, 'offline'));
  assert.throws(() => authorizeBrowserRequest(m, c, roles[0], request, { ...arm, key: `${c.viewport}:${roles[0]}` }, 'offline'));
});

function postRouteFixture() {
  const m = manifest(), c = m.cases[0], role = roles[1], requestId = `req_${ids[0]}`;
  const arm = { key: `${c.viewport}:${role}`, rpc: 'confirm_route_decision', consumed: true,
    payload: { request_id: requestId, expected_route_version: 0, requested_mode: 'competitive_bidding' } };
  const data = { id: ids[1], request_id: requestId, status: 'confirmed', request_version: 1, confirmed_by: m.actors[role].id,
    route: { status: 'derived', request_id: requestId, policy_profile_id: m.database.policyProfiles[0].id } };
  const context = { key: arm.key, actorId: m.actors[role].id, requestId, stage: 'route_confirmed', decisionId: data.id, routeVersion: 1 };
  const request = name => ({ method: 'POST', url: `https://${m.project}.supabase.co/rest/v1/rpc/${name}`,
    headers: { 'content-profile': 'procurement', authorization: 'Bearer offline-secret' }, body: { payload: { request_id: requestId } } });
  return { m, c, role, arm, data, context, request };
}
test('post-route reads require an actual successful bound confirmation response', () => {
  const f = postRouteFixture();
  assert.equal(typeof replenishmentRunner.confirmedRouteReadContext, 'function');
  assert.deepEqual(replenishmentRunner.confirmedRouteReadContext(f.m, f.c, f.role, f.arm, 200, f.data), f.context);
  for (const change of [x => { x.status = 400; }, x => { x.arm.consumed = false; }, x => { x.arm.key = `mobile390:${f.role}`; },
    x => { x.data.request_id = `req_${ids[1]}`; }, x => { x.data.request_version = 0; }, x => { x.data.status = 'draft'; },
    x => { x.data.confirmed_by = ids[0]; }, x => { x.data.route.status = 'blocked'; }, x => { x.data.route.policy_profile_id = ids[1]; }]) {
    const x = { arm: copy(f.arm), data: copy(f.data), status: 200 }; change(x);
    assert.throws(() => replenishmentRunner.confirmedRouteReadContext(f.m, f.c, f.role, x.arm, x.status, x.data));
  }
});
for (const name of ['sourcing_workspace']) {
  test(`post-route exact ${name} read cannot authorize another actor/request/stage or business RPC`, () => {
    const { m, c, role, context, request } = postRouteFixture(), r = request(name);
    assert.equal(authorizeBrowserRequest(m, c, role, r, undefined, 'offline-secret', context), 'post-route-read');
    for (const change of [x => { x.context = undefined; }, x => { x.context.stage = 'handed_off'; }, x => { x.context.key = `mobile390:${role}`; },
      x => { x.context.actorId = ids[0]; }, x => { x.r.body.payload.request_id = `req_${ids[1]}`; }, x => { x.r.body.payload.apply = true; },
      x => { x.r.body.extra = true; }, x => { x.r.body = []; }, x => { x.r.headers.authorization = 'Bearer wrong'; },
      x => { x.r.headers['content-profile'] = 'warehouse'; }, x => { x.role = roles[0]; }, x => { x.r.method = 'PATCH'; },
      x => { x.r.url = x.r.url.replace(m.project, 'other'); }]) {
      const x = { r: copy(r), role, context: copy(context) }; change(x);
      assert.throws(() => authorizeBrowserRequest(m, c, x.role, x.r, undefined, 'offline-secret', x.context));
    }
    for (const rpc of ['save_sourcing_event', 'submit_insufficient_bid_exception', 'review_insufficient_bid_exception', 'submit_request',
      'confirm_route_decision', 'record_sourcing_response', 'evaluation_workspace_rawcap_20260816_impl_d95c6a']) {
      assert.throws(() => authorizeBrowserRequest(m, c, role, request(rpc), undefined, 'offline-secret', context));
    }
  });
}
test('fresh post-route scope excludes dependent exception and variance-review reads', () => {
  const { m, c, role, context, request } = postRouteFixture();
  for (const name of ['insufficient_bid_exception', 'evaluation_workspace']) {
    assert.throws(() => authorizeBrowserRequest(m, c, role, request(name), undefined, 'offline-secret', context));
  }
});
test('post-route diagnostics retain RPC and argument keys but never private values or URLs', () => {
  const f = postRouteFixture(), r = f.request('evaluation_workspace');
  r.url += '?apikey=PRIVATE_QUERY'; r.body.payload.note = 'PRIVATE_BODY';
  assert.equal(typeof replenishmentRunner.browserRpcDiagnostic, 'function');
  const d = replenishmentRunner.browserRpcDiagnostic(r, f.context);
  assert.deepEqual(d, { method: 'POST', schema: 'procurement', rpc: 'evaluation_workspace', argumentKeys: ['payload'],
    payloadKeys: ['note', 'request_id'], requestIdMatches: true });
  assert(!JSON.stringify(d).match(/PRIVATE|offline-secret|https|req_111/));
  const malformed = replenishmentRunner.browserRpcDiagnostic({ ...r, body: ['PRIVATE_BODY'] }, f.context);
  assert.equal(malformed.argumentKeys, null);
});

test('post-route actual callback validates the fresh no-event response and forwards failures unchanged', async () => {
  const f = postRouteFixture(), source = await actualSource('scripts/qa/wms-replenishment-signoff-live.mjs');
  const registration = sourceNode(source.tree, n => ts.isCallExpression(n) && n.expression.getText(source.tree) === 'context.route');
  const valid = { event: null, requestId: f.context.requestId };
  const cases = [
    { status: 200, body: valid, accepted: true },
    { status: 400, body: { code: 'P0001', message: 'PRIVATE_ERROR_TOKEN' } },
    ...[{}, null, [], undefined, 'PRIVATE_ERROR_TOKEN', { event: null }, { requestId: f.context.requestId },
      { ...valid, requestId: `req_${ids[1]}` }, { ...valid, event: {} }, { ...valid, event: { id: ids[1] } },
      { ...valid, error: 'PRIVATE_ERROR_TOKEN' }, { ...valid, code: 'not-a-sqlstate' },
      { ...valid, message: 'PRIVATE_ERROR_TOKEN' }, { error: { message: 'PRIVATE_ERROR_TOKEN' } },
    ].map(body => ({ status: 200, body })),
    { status: 204, body: valid }, { status: 201, body: valid },
  ];
  for (const { status, body, accepted = false } of cases) {
    const events = [], guard = replenishmentRunner.createGuardFailureLatch(), pendingRoutes = new Set();
    let fetched = 0, fulfilled = 0, continued = 0, aborted = 0;
    const callback = sourceEval('', `(${registration.arguments[1].getText(source.tree)})`, {
      assert, ...f, key: f.context.key, confirmedRouteRead: f.context, armed: undefined, completion: null, token: 'offline-secret',
      guard, pendingRoutes, RPC: 'manage_replenishment_recommendation', authorizeBrowserRequest,
      browserRpcDiagnostic: replenishmentRunner.browserRpcDiagnostic,
      validPostRouteReadResponse: replenishmentRunner.validPostRouteReadResponse,
      record: async e => events.push(copy(e)),
    });
    const raw = f.request('sourcing_workspace');
    const response = { status: () => status, json: async () => { if (body === undefined) throw new SyntaxError('PRIVATE_ERROR_TOKEN'); return body; } };
    await callback({ request: () => ({ method: () => raw.method, url: () => raw.url, headers: () => raw.headers, postDataJSON: () => raw.body }),
      fetch: async options => { fetched++; assert.equal(options.maxRetries, 0); assert.equal(options.maxRedirects, 0); return response; },
      fulfill: async options => { fulfilled++; assert.equal(options.response, response); guard.throwIfFailed(); },
      continue: async () => { continued++; }, abort: async () => { aborted++; },
    });
    assert.equal(fetched, 1); assert.equal(fulfilled, 1); assert.equal(continued, 0); assert.equal(aborted, 0);
    assert.equal(pendingRoutes.size, 0);
    const observed = events.find(e => e.kind === 'post-route-read-response'); assert(observed);
    assert.equal(observed.status, status); assert.equal(observed.errorCode, status === 400 ? 'P0001' : null);
    assert(!JSON.stringify(events).includes('PRIVATE_ERROR_TOKEN'));
    if (accepted) guard.throwIfFailed();
    else await assert.rejects(guard.run(() => { throw new Error('Must not reach next UI assertion'); }), /Post-route read failed/,
      `Must reject HTTP ${status} body ${JSON.stringify(body)}`);
  }
});
test('post-route actual confirmation callback binds before releasing the response and never dispatches twice', async () => {
  const f = postRouteFixture(), source = await actualSource('scripts/qa/wms-replenishment-signoff-live.mjs');
  const registration = sourceNode(source.tree, n => ts.isCallExpression(n) && n.expression.getText(source.tree) === 'context.route');
  for (const status of [200, 400]) {
    const events = [], guard = replenishmentRunner.createGuardFailureLatch(); let dispatched = 0, fulfilled = 0, aborted = 0;
    const arm = { ...copy(f.arm), consumed: false };
    const boundary = sourceEval(`let confirmedRouteRead; const callback=${registration.arguments[1].getText(source.tree)};`,
      '({ callback, state:()=>confirmedRouteRead })', { assert, ...f, armed: arm, key: f.context.key, completion: null, token: 'offline-secret',
        guard, pendingRoutes: new Set(), RPC: 'manage_replenishment_recommendation', authorizeBrowserRequest,
        browserRpcDiagnostic: replenishmentRunner.browserRpcDiagnostic, confirmedRouteReadContext: replenishmentRunner.confirmedRouteReadContext,
        sha: value => createHash('sha256').update(value).digest('hex'), record: async e => events.push(copy(e)),
      });
    const raw = { ...f.request('confirm_route_decision'), body: { payload: copy(arm.payload) } };
    const route = { request: () => ({ method: () => raw.method, url: () => raw.url, headers: () => raw.headers, postDataJSON: () => raw.body }),
      fetch: async options => { dispatched++; assert.equal(options.maxRetries, 0); assert.equal(options.maxRedirects, 0);
        return { status: () => status, json: async () => status === 200 ? f.data : { code: 'P0001', message: 'PRIVATE_ERROR_TOKEN' } }; },
      fulfill: async () => {
        fulfilled++; guard.throwIfFailed();
        if (status === 200) {
          assert.deepEqual(boundary.state(), f.context);
          assert.equal(authorizeBrowserRequest(f.m, f.c, f.role, f.request('sourcing_workspace'), arm, 'offline-secret', boundary.state()), 'post-route-read');
        } else assert.equal(boundary.state(), undefined);
      }, abort: async () => { aborted++; }, continue: async () => { throw new Error('Confirmation must pass the response boundary'); },
    };
    await boundary.callback(route);
    assert.equal(dispatched, 1); assert.equal(fulfilled, 1);
    if (status === 400) assert.equal(boundary.state(), undefined);
    await boundary.callback(route); assert.equal(dispatched, 1); assert(aborted >= 1);
    assert(!JSON.stringify(events).includes('PRIVATE_ERROR_TOKEN'));
  }
});
test('post-route checkpoint waits for the bound sourcing response even when the confirmed badge is already visible', async () => {
  const f = postRouteFixture(), source = await actualSource('scripts/qa/wms-replenishment-signoff-live.mjs');
  const method = sourceNode(source.tree, n => ts.isPropertyAssignment(n) && n.name.getText(source.tree) === 'confirmRoute');
  const api = `https://${f.m.project}.supabase.co`, waits = [], stages = [], events = [];
  const guard = replenishmentRunner.createGuardFailureLatch();
  let clicked = 0, settled = false;
  const page = {
    url: () => `${f.m.origin}/procurement/requests/${f.context.requestId}`,
    waitForResponse: (predicate, options) => new Promise(resolve => { waits.push({ predicate, options, resolve }); }),
    getByRole: () => ({ click: async () => { clicked++; } }),
    getByLabel: () => ({}), getByText: () => ({ first: () => ({}) }),
  };
  const boundary = sourceEval(`let armed; const confirmRoute=${method.initializer.getText(source.tree)};`,
    '({confirmRoute, consume:()=>{armed.consumed=true;}})', {
      assert, m: f.m, ROLES: roles, api, pageFor: async () => page, validRequestId: value => value === f.context.requestId,
      guard, pendingRoutes: new Set(), record: async e => events.push(copy(e)),
      step: name => stages.push(name), expect: () => ({ toBeVisible: async () => {} }),
    });
  const running = boundary.confirmRoute(f.c, f.role, copy(f.arm.payload)).then(value => { settled = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  boundary.consume();
  const response = name => ({ request: () => ({ method: () => 'POST' }), url: () => `${api}/rest/v1/rpc/${name}`,
    status: () => 200, ok: () => true, json: async () => f.data });
  const confirmation = waits.find(w => w.predicate(response('confirm_route_decision')));
  assert(confirmation); confirmation.resolve(response('confirm_route_decision'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'Visible route and Draft labels cannot substitute for the actual sourcing read');
  const sourcing = waits.find(w => w.predicate(response('sourcing_workspace')));
  assert(sourcing); assert.equal(sourcing.options.timeout, 30000);
  assert(stages.includes('route.verify-sourcing-read'));
  sourcing.resolve(response('sourcing_workspace'));
  assert.deepEqual(await running, { data: f.data, error: null });
  assert.equal(clicked, 1); assert.equal(events.filter(e => e.action === 'confirm-route').length, 1);
});

test('post-route actual blocked callback records the offending RPC and argument keys with values omitted', async () => {
  const f = postRouteFixture(), source = await actualSource('scripts/qa/wms-replenishment-signoff-live.mjs');
  const registration = sourceNode(source.tree, n => ts.isCallExpression(n) && n.expression.getText(source.tree) === 'context.route');
  const events = [], guard = replenishmentRunner.createGuardFailureLatch();
  const callback = sourceEval('', `(${registration.arguments[1].getText(source.tree)})`, {
    assert, ...f, key: f.context.key, confirmedRouteRead: f.context, armed: undefined, completion: null, token: 'offline-secret',
    guard, pendingRoutes: new Set(), RPC: 'manage_replenishment_recommendation', authorizeBrowserRequest,
    browserRpcDiagnostic: replenishmentRunner.browserRpcDiagnostic, record: async e => events.push(copy(e)),
  });
  for (const name of ['save_sourcing_event', 'record_sourcing_response']) {
    const raw = f.request(name); raw.body.payload.note = 'PRIVATE_NOTE';
    await callback({ request: () => ({ method: () => raw.method, url: () => raw.url, headers: () => raw.headers, postDataJSON: () => raw.body }),
      abort: async () => {}, continue: async () => { throw new Error('No dispatch'); }, fetch: async () => { throw new Error('No fetch'); } });
  }
  assert.deepEqual(events.map(e => e.request.rpc), ['save_sourcing_event', 'record_sourcing_response']);
  assert(events.every(e => e.request.payloadKeys.join(',') === 'note,request_id'));
  assert(!JSON.stringify(events).match(/PRIVATE_NOTE|offline-secret/));
});
test('post-route insufficient-bid wrapper is VOLATILE but delegates the original stable read with live-cap admission', async t => {
  const { PGlite } = await import('@electric-sql/pglite'); const db = new PGlite(); t.after(() => db.close());
  const raw = (await readFile(new URL('../../supabase/migrations/20260804173000_insufficient_bid_exception_workflow.sql', import.meta.url), 'utf8'))
    .match(/create or replace function procurement\.insufficient_bid_exception\(payload jsonb\)[\s\S]*?end \$\$;/)[0];
  const convergence = await readFile(new URL('../../supabase/migrations/20260816090000_security_database_launch_blocker_convergence.sql', import.meta.url), 'utf8');
  const wrapper = convergence.match(/\$wrapper\$([\s\S]*?)\$wrapper\$/)[1];
  await db.exec(`create schema procurement; create schema core; create schema auth;
    create table procurement.requests(id text primary key,requester_id uuid);
    create table procurement.exception_packs(id text primary key,request_id text,exception_type text,status text);
    create function auth.uid() returns uuid language sql stable as $$ select '${ids[1]}'::uuid $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    create function core.has_cap(text,text) returns boolean language sql stable as $$ select false $$;
    create function core.has_live_cap(text,text) returns boolean language sql stable as $$ select $1='procurement' and $2='approve_award' and current_setting('test.live_cap',true)='yes' $$;
    insert into procurement.requests values('req_test','${ids[1]}');
    ${raw}
    alter function procurement.insufficient_bid_exception(jsonb) rename to insufficient_bid_exception_rawcap_20260816_impl_d95c6a;`);
  const formatted = await db.query('select format($1, $2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text) as sql',
    [wrapper, 'procurement', 'insufficient_bid_exception', 'procurement', 'approve_award', 'procurement.approve_award', 'procurement', 'insufficient_bid_exception_rawcap_20260816_impl_d95c6a']);
  await db.exec(formatted.rows[0].sql);
  const volatility = await db.query("select proname,provolatile from pg_proc where proname like 'insufficient_bid_exception%'");
  assert.equal(volatility.rows.find(r => r.proname === 'insufficient_bid_exception').provolatile, 'v');
  assert.equal(volatility.rows.find(r => r.proname.includes('_rawcap_')).provolatile, 's');
  const snapshot = () => db.query('select (select jsonb_agg(r) from procurement.requests r) as requests,(select jsonb_agg(p) from procurement.exception_packs p) as packs');
  const before = await snapshot();
  await db.exec("set test.live_cap='no'");
  await assert.rejects(db.query(`select procurement.insufficient_bid_exception('{"request_id":"req_test"}')`), /Not authorized: procurement.approve_award/);
  await db.exec("set test.live_cap='yes'");
  const result = await db.query(`select procurement.insufficient_bid_exception('{"request_id":"req_test"}') as value`);
  assert.equal(result.rows[0].value, null); assert.deepEqual((await snapshot()).rows, before.rows);
});
test('post-route source binding includes the restored no-event contract and generated read-wrapper chain', async () => {
  const source = await actualSource('scripts/qa/wms-replenishment-signoff-live.mjs');
  const declaration = sourceNode(source.tree, n => ts.isVariableDeclaration(n) && n.name.getText(source.tree) === 'sourceFiles');
  const refs = sourceEval('', declaration.initializer.getText(source.tree), { m: manifest() });
  for (const ref of ['modules/procurement/src/components/SourcingWorkspace.tsx',
    'supabase/migrations/20260914025434_restore_sourcing_evaluation_read_contract.sql',
    'supabase/migrations/20260804173000_insufficient_bid_exception_workflow.sql',
    'supabase/migrations/20260816090000_security_database_launch_blocker_convergence.sql',
    'supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql']) assert(refs.includes(ref));
});
test('actual intercepted handoff callback reserves before awaited preflight and overlapping requests never dispatch twice', async () => {
  const m = manifest(), c = m.cases[0], h = harness(m), original = h.adapter.complete; let bound;
  h.adapter.complete = async (c, role, id, hooks) => original(c, role, id, { ...hooks, beforeHandoff: async b => { bound = copy(b); throw new Error('offline boundary captured'); } });
  await assert.rejects(executeJourney(m, h.adapter, newReport(m, h.adapter.kind)), /offline boundary captured/);
  const snapshot = copy(h.states[c.viewport]); reconcile(m, c.viewport, snapshot, 'uploads_ready', bound);
  const source = await actualSource('scripts/qa/wms-replenishment-signoff-live.mjs');
  const registration = sourceNode(source.tree, n => ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
    && n.expression.expression.getText(source.tree) === 'context' && n.expression.name.text === 'route');
  const callback = registration.arguments[1].getText(source.tree);
  let release, reads = 0, dispatches = 0, aborted = 0; const barrier = new Promise(resolve => { release = resolve; });
  const completion = { key: `${c.viewport}:${roles[1]}`, recommendationId: snapshot.rows.recommendations[0].id,
    binding: { ...copy(bound), payload: null }, busy: false, sent: false, hooks: { beforeHandoff: async next => {
      reads++; assertCanonicalPayload(m, c, next.payload, next); reconcile(m, c.viewport, snapshot, 'uploads_ready', next); await barrier;
    } } };
  const events = [];
  const guard = replenishmentRunner.createGuardFailureLatch(), pendingRoutes = new Set();
  const boundary = sourceEval(`let armed, confirmedRouteRead; const callback=${callback};`, '({ callback, state:()=>({armed}) })',
    { assert, m, c, role: roles[1], key: completion.key, completion, token: 'offline-token', RPC: 'manage_replenishment_recommendation',
      guard, pendingRoutes,
      sameKeys: (value, keys) => assert.deepEqual(Object.keys(value).sort(), [...keys].sort()),
      assertCanonicalPayload, authorizeBrowserRequest, browserRpcDiagnostic: replenishmentRunner.browserRpcDiagnostic,
      record: async e => events.push(copy(e)) });
  const route = () => ({ request: () => ({ method: () => 'POST', url: () => `https://${m.project}.supabase.co/rest/v1/rpc/manage_replenishment_recommendation`,
    headers: () => ({ 'content-profile': 'procurement', authorization: 'Bearer offline-token' }),
    postDataJSON: () => ({ payload: { id: completion.recommendationId, action: 'handoff', request: copy(bound.payload) } }) }),
    continue: async () => { dispatches++; }, abort: async () => { aborted++; } });
  const first = boundary.callback(route()), second = boundary.callback(route());
  await Promise.resolve(); release(); await Promise.all([first, second]);
  assert(dispatches <= 1, 'Two exact requests must never dispatch two handoffs');
  assert.equal(reads, 1, 'Only the reserved request may reach fresh preflight');
  assert.equal(dispatches, 0, 'A concurrent blocked write closes the whole guarded attempt before first dispatch');
  assert.equal(aborted, 2); assert(completion.sent); assert.throws(() => guard.throwIfFailed()); assert.equal(pendingRoutes.size, 0);
  assert(!events.some(e => e.kind === 'browser-command'));
});
test('all three canonical wizard steps retain source-bound field selectors and completion controls', async () => {
  const s = await actualSource('modules/procurement/src/pages/CreateRequestPage.tsx'), elements = [];
  const visit = n => { if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) elements.push(n); ts.forEachChild(n, visit); }; visit(s.tree);
  const attr = (node, name) => node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(s.tree) === name)?.initializer?.getText(s.tree);
  const one = (name, value, tag) => {
    const matches = elements.filter(n => attr(n, name) === JSON.stringify(value) && (!tag || n.tagName.getText(s.tree) === tag));
    assert.equal(matches.length, 1, `${name}=${value} must remain unique in the actual ${tag ?? 'wizard'} source`); return matches[0];
  };
  one('title', 'Draft a purchase request');
  assert.equal(attr(one('name', 'category'), 'value'), '{c.code}');
  assert.equal(attr(one('name', 'requirement-kind'), 'value'), '{kind}');
  assert.equal(attr(one('id', 'title'), 'value'), '{title}');
  for (const [id, state] of [['department', 'department'], ['costCenter', 'costCenter']]) {
    const field = one('id', id, 'select'); assert.equal(attr(field, 'value'), `{${state}}`); assert(attr(field, 'disabled').includes("departmentDirectoryStatus !== 'ready'"));
  }
  for (const id of ['budgetCode', 'neededBy']) assert.equal(attr(one('id', id), 'value'), `{${id}}`);
  assert.equal(attr(one('id', 'neededBy'), 'type'), '"date"');
  assert.equal(attr(one('id', 'need-description'), 'readOnly'), '{!!replenishment}');
  for (const index of ['index', 'i']) for (const field of ['description', 'quantity', 'unit of measure', 'unit price']) {
    const label = '{`Line ${' + index + ' + 1} ' + field + '`}';
    const matches = elements.filter(n => attr(n, 'aria-label') === label); assert.equal(matches.length, 1, label);
    if (field !== 'unit price') assert.equal(attr(matches[0], 'readOnly'), '{!!replenishment}');
    else assert(attr(matches[0], 'onChange').includes('unitPrice'));
  }
  const rfq = sourceNode(s.tree, n => ts.isJsxElement(n) && n.openingElement.tagName.getText(s.tree) === 'section'
    && attr(n.openingElement, 'aria-labelledby') === '"rfq-brief-heading"');
  const fields = sourceNode(rfq, n => ts.isArrayLiteralExpression(n) && n.elements.every(e => ts.isArrayLiteralExpression(e)));
  assert.deepEqual(sourceEval('', fields.getText(s.tree)).map(([key]) => key), Object.keys(completionInputs().desktop1440.terms));
  assert(rfq.getText(s.tree).includes('id={`rfq-${key}`}'));
  const footer = sourceNode(s.tree, n => ts.isJsxElement(n) && attr(n.openingElement, 'aria-label') === '"Request actions"').getText(s.tree);
  assert(footer.includes('step < 3')); assert(footer.includes('onClick={goNext}')); assert(footer.includes('Continue'));
  assert(footer.includes("replenishment ? 'Create draft & complete handoff' : 'Save draft'"));
  assert(footer.includes('!replenishment && <Button')); assert(footer.includes('disabled={submitting || !canSaveDraft}'));
});

test('canonical wizard serializes actual single-file attachment JSX and handlers in both viewports', async t => {
  const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
  const { chromium, expect } = require('@playwright/test'), browser = await chromium.launch(); t.after(() => browser.close());
  const m = manifest(), wizard = await actualSource('modules/procurement/src/pages/CreateRequestPage.tsx'), source = wizard.text;
  const attachmentSource = await actualSource('modules/procurement/src/attachments.ts');
  const labelSource = await actualSource('modules/procurement/src/labels.ts');
  const attachmentSection = sourceNode(wizard.tree, n => ts.isJsxElement(n) && n.openingElement.tagName.getText(wizard.tree) === 'section'
    && n.getText(wizard.tree).includes('onChange={handleAttachmentPick}')).getText(wizard.tree);
  const declaration = (s, name) => sourceNode(s.tree, n => ts.isVariableDeclaration(n) && n.name.getText(s.tree) === name).getText(s.tree);
  const handler = (s, name) => sourceNode(s.tree, n => ts.isFunctionDeclaration(n) && n.name?.text === name).getText(s.tree).replace(/^export /, '');
  const inputNode = sourceNode(wizard.tree, n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(wizard.tree) === 'input'
    && n.attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(wizard.tree) === 'type' && p.initializer?.getText(wizard.tree) === '"file"'));
  assert(!inputNode.attributes.properties.some(p => ts.isJsxAttribute(p) && p.name.getText(wizard.tree) === 'multiple'));
  const attachmentHarness = ts.transpileModule(`
    const profile = ${JSON.stringify({ email: bindings.procurement_lead.email })};
    const ${declaration(wizard, 'KIND_OPTIONS')};
    const ${declaration(labelSource, 'ATTACHMENT_KIND_LABEL')};
    const ${declaration(attachmentSource, 'REQUEST_ATTACHMENT_MAX_BYTES')};
    const ${declaration(attachmentSource, 'REQUEST_ATTACHMENT_MIME_TYPES')};
    ${handler(attachmentSource, 'validateRequestAttachment')}
    let attachments = [], events = [];
    function error(message) { throw new Error(message); }
    function setAttachments(update) { attachments = update(attachments); events.push(attachments.map(a => ({name:a.filename,kind:a.kind}))); render(); }
    ${['handleAttachmentPick', 'removeAttachment', 'setAttachmentKind'].map(name => handler(wizard, name)).join('\n')}
    const Icon = () => document.createElement('span');
    function h(tag, props, ...children) {
      if (typeof tag === 'function') return tag(props);
      const el = document.createElement(tag);
      for (const [key, value] of Object.entries(props ?? {})) {
        if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
        else if (!['key','value'].includes(key) && value != null && value !== false) el.setAttribute(key === 'className' ? 'class' : key, value === true ? '' : String(value));
      }
      for (const child of children.flat(Infinity)) if (child != null && child !== false) el.append(child instanceof Node ? child : document.createTextNode(String(child)));
      if (props?.value != null) el.value = props.value;
      return el;
    }
    function render() { document.getElementById('actual-attachments').replaceChildren(${attachmentSection}); }
    window.readPickedDocuments = async () => ({ events, documents: await Promise.all(attachments.map(async a => ({ filename:a.filename,kind:a.kind,mimeType:a.mimeType,sizeBytes:a.sizeBytes,uploadedByEmail:a.uploadedByEmail,bytes:Array.from(new Uint8Array(await a.file.arrayBuffer())) }))) });
    render();
  `, { fileName: 'actual-attachment-boundary.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, jsxFactory: 'h' } }).outputText;
  for (const text of ['Create draft & complete handoff', 'name="requirement-kind"', 'id="need-description"', 'Document type for', 'Line ${index + 1} unit price']) assert(source.includes(text));
  const tableSource = await readFile(new URL('../../packages/ui/src/DataTable.tsx', import.meta.url), 'utf8');
  assert(tableSource.includes('sm:hidden')); assert(tableSource.includes('<dl')); assert(tableSource.includes('<dt')); assert(tableSource.includes('<dd'));
  for (const c of m.cases) {
    const page = await browser.newPage({ viewport: { width: c.width, height: c.height } }); await page.route('**/*', route => route.abort());
    const steps = [];
    await page.setContent(`<h1>Draft a purchase request</h1><input type="radio" name="category" value="goods"><input type="radio" name="requirement-kind" value="materials">
      <input id="title" value="Replenish ${c.productId}"><input aria-label="Line 1 description" readonly value="${c.productId}">
      <input aria-label="Line 1 quantity" readonly value="2"><input aria-label="Line 1 unit of measure" readonly value="unit">
      <input aria-label="Line 1 unit price" type="number"><div hidden><input aria-label="Line 1 unit price" type="number"></div>
      <button type="button">Continue</button><select id="department"><option value="operations">Operations</option></select>
      <select id="costCenter"><option value="CC-1100">CC-1100</option></select><input id="budgetCode"><input type="date" id="neededBy">
      <textarea id="need-description" readonly>${c.rationale}</textarea><div id="actual-attachments"></div>
      <h3>RFQ requirements</h3>${Object.keys(c.completion.terms).map(k => `<input id="rfq-${k}">`).join('')}<button>Create draft &amp; complete handoff</button>`);
    await page.addScriptTag({ content: attachmentHarness });
    await fillCanonicalWizard(page, m, c, expect, value => steps.push(value));
    assert.equal(await page.locator('#budgetCode').inputValue(), 'TEST-ONLY-NOT-FUNDING');
    assert.equal(await page.getByLabel('Add file', { exact: true }).evaluate(input => input.files.length), 0, 'Actual handler resets the single-file input');
    const picked = await page.evaluate(() => window.readPickedDocuments());
    assert.deepEqual(picked.events.map(rows => rows.map(r => r.kind)), [['other'], ['spec'], ['spec', 'other'], ['spec', 'budget']]);
    for (const [i, d] of c.documents.entries()) {
      assert.deepEqual(picked.documents[i], { filename: d.filename, kind: d.kind, mimeType: d.mimeType, sizeBytes: d.sizeBytes,
        uploadedByEmail: bindings.procurement_lead.email, bytes: [...syntheticPdf(m.runId, c.viewport, d.kind)] });
      await expect(page.getByRole('combobox', { name: `Document type for ${d.filename}`, exact: true })).toHaveValue(d.kind);
    }
    assert(steps.includes('completion.review-rfq-terms'));
    await page.setContent(`<style>@media(max-width:639px){table{display:none}}@media(min-width:640px){ul{display:none}}</style>
      <h2>Line items</h2><table><tr><td>${c.productId}</td><td>2 unit</td></tr></table>
      <ul><li><div class="card"><div>${c.productId}</div><dl><div><dt>Qty</dt><dd>2 unit</dd></div></dl></div></li></ul>`);
    await verifyDraftLine(page, c, expect);
    if (c.viewport === 'mobile390') { await page.locator('dd').evaluate(el => { el.textContent = '3 unit'; });
      await assert.rejects(verifyDraftLine(page, c, expect.configure({ timeout: 50 }))); }
    await page.close();
  }
});
test('changed completed desktop state during mobile blocks final completion', async () => {
  const m = manifest(), h = harness(m), openRequest = h.adapter.openRequest;
  h.adapter.openRequest = async (...args) => {
    const r = await openRequest(...args);
    if (args[0].viewport === 'mobile390') h.states.desktop1440.rows.requests[0].lines[0].quantity = 50;
    return r;
  };
  const report = newReport(m, h.adapter.kind); await assert.rejects(executeJourney(m, h.adapter, report)); assert.equal(report.complete, false);
});
test('closing failure cannot leave a successful report', async () => {
  const m = manifest(), h = harness(m); h.adapter.close = async () => { throw new Error('Browser did not close'); };
  const report = newReport(m, h.adapter.kind); await assert.rejects(executeJourney(m, h.adapter, report)); assert.equal(report.complete, false);
});
test('prefilled source-equivalent textarea reproduces exact-label miss; accessible textbox fill succeeds offline', async t => {
  const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
  const { chromium } = require('@playwright/test'), browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage(); await page.route('**/*', route => route.abort());
  const m = manifest(), c = m.cases[0], steps = [];
  const source = await readFile(new URL('../../modules/warehouse/src/components/InventoryRecommendationAction.tsx', import.meta.url), 'utf8');
  assert.match(source, /Rationale\s*<textarea/); assert(source.includes('Available inventory is below the minimum stock level.'));
  await page.setContent(`<div role="dialog" aria-label="Recommend replenishment"><p>${c.productName} - ${c.sku}</p>
    <label>Recommended quantity<input type="number" value="2"></label>
    <label>Planning assumption (days)<input type="number" value="14"></label>
    <label>Rationale<textarea>Available inventory is below the minimum stock level.</textarea></label></div>`);
  const dialog = page.getByRole('dialog', { name: 'Recommend replenishment', exact: true });
  assert.equal(await dialog.getByLabel('Rationale', { exact: true }).count(), 0, 'Original live selector mismatch must reproduce');
  await fillRecommendationForm(dialog, c, step => steps.push(step));
  assert.equal(await dialog.getByRole('textbox', { name: 'Rationale', exact: true }).inputValue(), c.rationale);
  assert.deepEqual(steps, ['recommend.fill-quantity', 'recommend.fill-planning-days', 'recommend.fill-rationale']);
  const root = await mkdtemp(path.join(tmpdir(), 'wms-replen-diagnostic-')); t.after(() => rm(root, { recursive: true, force: true }));
  const offlinePage = { url: () => `${m.origin}/warehouse/inventory/${c.productId}?token=never-retain`,
    evaluate: page.evaluate.bind(page), getByRole: page.getByRole.bind(page), locator: page.locator.bind(page) };
  const evidence = await captureUiFailure({ m, c, role: roles[0], page: offlinePage, step: 'recommend.fill-rationale', attempt: root });
  assert.equal(evidence.step, 'recommend.fill-rationale'); assert.equal(evidence.route, 'owned-inventory');
  assert.equal(evidence.body.dialogCount, 1); assert.match(evidence.screenshot.sha256, /^[a-f0-9]{64}$/);
  assert.equal((await readFile(path.join(root, evidence.screenshot.ref))).subarray(1, 4).toString(), 'PNG');
  assert(!JSON.stringify(evidence).includes('never-retain')); assert(!JSON.stringify(evidence).includes(c.rationale));
});

test('failure diagnostics never capture login/foreign pages or password-bearing body contents', async () => {
  const m = manifest(), c = m.cases[0];
  for (const url of [`${m.origin}/login?token=private`, 'https://foreign.invalid/?secret=private', `${m.origin}/warehouse/inventory/${c.productId}`]) {
    const page = { url: () => url, evaluate: async () => ({ bodyPresent: true, readyState: 'complete', passwordPresent: true, dialogCount: 0, inputCount: 2 }) };
    const evidence = await captureUiFailure({ m, c, role: roles[0], page, step: 'auth.fill-password', attempt: 'unused' });
    assert.equal(evidence.screenshot, null); assert(!JSON.stringify(evidence).includes('private'));
  }
});

test('canonical diagnostics bind the same owned form across steps and reject foreign or sensitive states without navigation', async t => {
  const { createCanonicalFormDiagnostic } = await import('./wms-replenishment-signoff-live.mjs');
  assert.equal(typeof createCanonicalFormDiagnostic, 'function');
  const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
  const { chromium, expect } = require('@playwright/test'), browser = await chromium.launch(); t.after(() => browser.close());
  const root = await mkdtemp(path.join(tmpdir(), 'wms-replen-form-diagnostic-')); t.after(() => rm(root, { recursive: true, force: true }));
  const m = manifest(), c = m.cases[0], recommendationId = ids[0];
  for (const defect of ['owned-step1', 'owned-step2', 'no-context', 'fabricated-context', 'foreign-origin', 'login', 'wrong-path', 'wrong-id', 'duplicate-query', 'extra-query', 'fragment',
    'password', 'wrong-title', 'wrong-product', 'wrong-quantity', 'wrong-unit', 'editable-line', 'wrong-heading', 'duplicate-form', 'other-actor', 'other-view', 'other-page',
    'step2-no-prior-proof', 'step2-wrong-need', 'step2-editable-need', 'step2-replaced-form', 'step3', 'unknown-step',
    'late-form-replacement', 'late-stale-handle', 'late-url', 'late-password']) {
    const realPage = await browser.newPage(); await realPage.route('**/*', route => route.abort());
    let url = `${m.origin}/procurement/requests/new?replenishment=${recommendationId}`, navigation = 0, screenshotDispatched = false;
    const wrapForm = locator => new Proxy(locator, { get(target, key) {
      if (key === 'filter') return (...args) => wrapForm(target.filter(...args));
      if (key === 'elementHandle') return async () => {
        if (defect === 'late-form-replacement') await realPage.locator('form').evaluate(form => {
          const replacement = form.cloneNode(true); replacement.querySelector('#title').value = 'foreign';
          replacement.append(document.createTextNode('FOREIGN-CANARY')); form.replaceWith(replacement);
        });
        if (defect === 'late-url') url = `${m.origin}/procurement/requests/new?replenishment=${ids[1]}`;
        if (defect === 'late-password') await realPage.locator('form').evaluate(form => {
          const input = document.createElement('input'); input.type = 'password'; form.append(input);
        });
        const handle = await target.elementHandle();
        if (defect === 'late-stale-handle') await realPage.locator('form').evaluate(form => form.replaceWith(form.cloneNode(true)));
        return new Proxy(handle, { get(element, prop) {
          if (prop === 'screenshot') return () => { screenshotDispatched = true; throw new Error('Intercepted unsafe screenshot; no file written'); };
          const value = Reflect.get(element, prop); return typeof value === 'function' ? value.bind(element) : value;
        } });
      };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const page = new Proxy(realPage, { get(target, key) {
      if (key === 'url') return () => url;
      if (key === 'locator' && defect.startsWith('late-')) return (...args) => args[0] === 'form' ? wrapForm(target.locator(...args)) : target.locator(...args);
      if (['goto', 'reload', 'goBack', 'goForward'].includes(key)) return () => { navigation++; throw new Error('Diagnostics must not navigate'); };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await realPage.setContent(`<h1>Draft a purchase request</h1><form><div id="step-one">
      <input type="radio" name="category" value="goods"><input type="radio" name="requirement-kind" value="materials">
      <input id="title" value="Replenish ${c.productId}"><input aria-label="Line 1 description" readonly value="${c.productId}">
      <input aria-label="Line 1 quantity" readonly value="2"><input aria-label="Line 1 unit of measure" readonly value="unit">
      <input aria-label="Line 1 unit price" type="number"></div><div id="step-two" hidden><textarea id="need-description" readonly>${c.rationale}</textarea>
      <select><option>private-field-option</option></select></div><button type="button" onclick="document.querySelector('#step-one').hidden=true;document.querySelector('#step-two').hidden=false">Continue</button></form>`);
    let canonical = createCanonicalFormDiagnostic({ m, c, role: roles[1], page, recommendationId });
    let step = 'completion.explicit-classification';
    if (defect === 'owned-step2' || defect.startsWith('step2-') && defect !== 'step2-no-prior-proof') {
      await assert.rejects(fillCanonicalWizard(page, m, c, expect, name => {
        step = name; if (name === 'completion.funding-and-owned-files') throw new Error('offline-stop-before-funding');
      }, canonical), /offline-stop-before-funding/);
    }
    if (defect === 'no-context') canonical = undefined;
    if (defect === 'fabricated-context') canonical = { recommendationId, step1Verified: true };
    if (defect === 'foreign-origin') url = url.replace(m.origin, 'https://foreign.invalid');
    if (defect === 'login') url = `${m.origin}/login`;
    if (defect === 'wrong-path') url = url.replace('/requests/new', '/requests/foreign');
    if (defect === 'wrong-id') url = url.replace(recommendationId, ids[1]);
    if (defect === 'duplicate-query') url += `&replenishment=${recommendationId}`;
    if (defect === 'extra-query') url += '&token=private';
    if (defect === 'fragment') url += '#private';
    if (defect === 'password') await realPage.locator('form').evaluate(form => { const input = document.createElement('input'); input.type = 'password'; form.append(input); });
    for (const [name, selector] of [['wrong-title', '#title'], ['wrong-product', '[aria-label="Line 1 description"]'], ['wrong-quantity', '[aria-label="Line 1 quantity"]'], ['wrong-unit', '[aria-label="Line 1 unit of measure"]']]) {
      if (defect === name) await realPage.locator(selector).evaluate(input => { input.value = 'foreign'; });
    }
    if (defect === 'editable-line') await realPage.locator('[aria-label="Line 1 quantity"]').evaluate(input => input.removeAttribute('readonly'));
    if (defect === 'wrong-heading') await realPage.locator('h1').evaluate(heading => { heading.textContent = 'Different workflow'; });
    if (defect === 'duplicate-form') await realPage.locator('form').evaluate(form => form.after(form.cloneNode(true)));
    if (defect === 'step2-no-prior-proof') { await realPage.getByRole('button', { name: 'Continue' }).click(); step = 'completion.funding-and-owned-files'; }
    if (defect === 'step2-wrong-need') await realPage.locator('#need-description').evaluate(input => { input.value = 'foreign'; });
    if (defect === 'step2-editable-need') await realPage.locator('#need-description').evaluate(input => input.removeAttribute('readonly'));
    if (defect === 'step2-replaced-form') await realPage.locator('form').evaluate(form => form.replaceWith(form.cloneNode(true)));
    if (defect === 'step3') step = 'completion.review-rfq-terms';
    if (defect === 'unknown-step') step = 'completion.unknown';
    const before = await readdir(root);
    const evidence = await captureUiFailure({ m, c: defect === 'other-view' ? m.cases[1] : c, role: defect === 'other-actor' ? roles[0] : roles[1],
      page: defect === 'other-page' ? new Proxy(page, {}) : page, step, attempt: root, canonical });
    assert.equal(navigation, 0);
    assert.equal(screenshotDispatched, false, defect);
    assert(!JSON.stringify(evidence).includes('private')); assert(!JSON.stringify(evidence).includes(c.rationale));
    if (defect.startsWith('owned-')) {
      assert.equal(evidence.captureStatus, 'captured-owned-surface', defect);
      assert.equal(evidence.screenshot.scope, `owned-canonical-form-${defect.slice(6)}`);
      assert.equal(evidence.screenshot.masked, true);
      assert.equal((await readFile(path.join(root, evidence.screenshot.ref))).subarray(1, 4).toString(), 'PNG');
    } else { assert.equal(evidence.screenshot, null, defect); assert.deepEqual(await readdir(root), before, defect); }
    await realPage.close();
  }
});

test('named failure diagnostics run before close without replay; diagnostic failure preserves the original failure', async () => {
  for (const broken of [false, true]) {
    const m = manifest(), h = harness(m), order = [];
    h.adapter.command = async () => { order.push('command'); throw new Error('locator.fill: Timeout 30000ms exceeded'); };
    h.adapter.diagnose = async () => { order.push('diagnose'); if (broken) throw new Error('private diagnostic error'); return { step: 'recommend.fill-rationale', screenshot: null }; };
    h.adapter.close = async () => { order.push('close'); };
    const report = newReport(m, h.adapter.kind);
    await assert.rejects(executeJourney(m, h.adapter, report), /locator.fill/);
    assert.deepEqual(order, ['command', 'diagnose', 'close']); assert.equal(report.complete, false);
    assert.equal(report.failures[0].details.uiFailure.step, broken ? undefined : 'recommend.fill-rationale');
    assert(!JSON.stringify(report).includes('private diagnostic error'));
  }
});

test('generated prerequisite and readback SQL execute against a local schema fixture only', async t => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create schema warehouse; create schema procurement; create schema core; create schema private; create schema storage;
    create table warehouse.products(id text primary key,sku text unique,name text,category text,serialized boolean,attributes jsonb,unit_cost integer,item_class text,reorder_point integer);
    create table procurement.replenishment_recommendations(id uuid,product_id text,procurement_request_id text);
    create table procurement.requests(id text,justification jsonb,lines jsonb,title text);
    create table core.activity_log(id uuid,created_at timestamptz,entity_id text,detail jsonb);
    create table core.notifications(entity_id text); create table core.documents(entity_id text);
    create table private.action_evidence(source_id text);
    create table storage.objects(id uuid,name text,bucket_id text,owner_id text,metadata jsonb);
    create table storage.buckets(id text,public boolean);
    create table core.role_capabilities(module text,role text,cap text);
    create table core.profiles(id uuid,full_name text,email text,status text);
    create table core.user_roles(user_id uuid,module text,role text);
    create table procurement.policy_profiles(id uuid);
    create table procurement.request_attachments(id text,request_id text,storage_path text);
    create table procurement.request_collaborators(user_id uuid,request_id text);
    create table procurement.route_decisions(id uuid,request_id text,request_version integer);
    create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text);
    create role authenticated; create role anon; create role service_role;`);
  for (const table of ['stock_levels', 'inventory_units', 'movements', 'fulfillment_reservations', 'inventory_holds', 'allocations', 'lots']) await db.exec(`create table warehouse.${table}(product_id text)`);
  for (const table of ['purchase_orders', 'approval_steps', 'approval_step_audit', 'request_revisions']) await db.exec(`create table procurement.${table}(request_id text)`);
  const m = manifest(); await db.exec(prepareSql(m));
  const metadata = await db.exec(databasePreflightSql(m.database.migrationVersion));
  assert.equal(metadata.flatMap(r => r.rows).find(r => r.database).database.functions.length, DATABASE_FUNCTIONS.length);
  for (const c of m.cases) {
    const results = await db.exec(readbackSql(m, c.viewport));
    const result = results.flatMap(r => r.rows).find(r => r.snapshot)?.snapshot;
    assert.equal(result.rows.products.length, 1); assert.deepEqual(result.rows.storage, []);
    assert.equal(result.database.functions.length, DATABASE_FUNCTIONS.length);
    assert.throws(() => reconcile(m, c.viewport, result, 'seeded'), /Database definitions/, 'Modeled tables do not fabricate deployed function proof');
  }
  await db.exec(cleanupInventorySql(m));
  assert.equal((await db.query('select count(*)::int as n from warehouse.products')).rows[0].n, 2, 'Discovery retained both products');
});

// RED baseline: runner 8487c6b2523f84e0b8631115a34db8e2225650120397cd2fc1782cf7730d0d43;
// prior tests 7b92426268615e9de82812b444fdc230abdc7ae35134881042cf9896b1aa123b.
// Isolated policy fixtures only; no retained live report is read or changed here.
async function registeredEvidencePolicyFixture(t) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(); t.after(() => db.close());
  const privacy = await readFile(new URL('../../supabase/migrations/20260815154702_procurement_finance_requester_privacy.sql', import.meta.url), 'utf8');
  const visibility = await readFile(new URL('../../supabase/migrations/20260826170000_procurement_request_operational_visibility.sql', import.meta.url), 'utf8');
  const policy = (name, table) => {
    const matches = [...privacy.matchAll(new RegExp(`create policy ${name} on ${table.replaceAll('.', '\\.')}[\\s\\S]*?;`, 'g'))];
    assert.equal(matches.length, 1); return matches[0][0];
  };
  const readAuthority = visibility.match(/create or replace function private\.can_read_procurement_request\(p_request_id text\)[\s\S]*?\$\$;/)[0];
  await db.exec(`create schema auth; create schema core; create schema private; create schema procurement; create schema storage;
    create role authenticated nologin;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function core.has_live_cap(m text,c text) returns boolean language sql as $$select m='procurement' and c='create_request'$$;
    create function storage.foldername(p text) returns text[] language sql as $$select (string_to_array(p,'/'))[1:array_length(string_to_array(p,'/'),1)-1]$$;
    create table procurement.requests(id text primary key,requester_id uuid);
    create table procurement.request_collaborators(request_id text,user_id uuid,revoked_at timestamptz);
    create table procurement.request_attachments(id text primary key,request_id text references procurement.requests(id),storage_path text);
    create table storage.objects(name text primary key,bucket_id text,owner_id text);
    ${readAuthority}
    alter table procurement.request_attachments enable row level security;
    alter table storage.objects enable row level security;
    ${policy('request_attachments_read', 'procurement.request_attachments')}
    ${policy('procurement_requests_auth_read', 'storage.objects')}
    ${policy('procurement_requests_auth_insert', 'storage.objects')}
    grant usage on schema auth,core,private,procurement,storage to authenticated;
    grant select on procurement.request_attachments to authenticated;
    grant select,insert on storage.objects to authenticated;`);
  const asActor = async (actorId, sql, values = []) => {
    await db.query("select set_config('test.actor',$1,false)", [actorId]); await db.exec('set role authenticated');
    try { return await db.query(sql, values); } finally { await db.exec('reset role'); }
  };
  return { db, asActor };
}

test('registered-evidence timing: actual Storage policy denies owner SELECT until an attachment is registered', async t => {
  const { db, asActor } = await registeredEvidencePolicyFixture(t);
  const m = manifest(), c = m.cases[0], requestId = `req_${ids[0]}`, u = uploadFixture(m, c, requestId, 0);
  await asActor(ids[1], 'insert into storage.objects values($1,$2,$3)', [u.path, 'procurement-requests', ids[1]]);
  const visible = actor => asActor(actor, 'select name from storage.objects where name=$1', [u.path]);
  assert.deepEqual((await visible(ids[1])).rows, [], 'Owner insert is not owner read authority');
  await db.query('insert into procurement.requests values($1,$2)', [requestId, ids[1]]);
  assert.deepEqual((await visible(ids[1])).rows, [], 'Request alone does not register this object');
  await db.query('insert into procurement.request_attachments values($1,$2,$3)', [u.id, requestId, u.path]);
  assert.deepEqual((await visible(ids[1])).rows, [{ name: u.path }]);
  assert.deepEqual((await visible(ids[0])).rows, [], 'Other actor does not inherit owner access');
});

test('registered-evidence timing: actual upload interceptor releases 200 without premature owner download or list', async t => {
  const { asActor } = await registeredEvidencePolicyFixture(t);
  const m = manifest(), c = m.cases[0], wire = await storageRequest(m, c), events = [];
  const source = await actualSource('scripts/qa/wms-replenishment-signoff-live.mjs');
  const call = sourceNode(source.tree, n => ts.isCallExpression(n) && n.expression.getText(source.tree) === 'context.route');
  let downloads = 0, lists = 0, dispatched = 0, fulfilled = 0, aborted = 0;
  const client = { storage: { from: () => ({ download: async objectPath => {
    downloads++; const result = await asActor(ids[1], 'select name from storage.objects where name=$1', [objectPath]);
    return result.rows.length ? { data: new Blob([syntheticPdf(m.runId, c.viewport, 'spec')]), error: null }
      : { data: null, error: { name: 'StorageApiError', status: 400, statusCode: '404', message: 'Object not found' } };
  } }) } };
  const completion = { key: 'desktop1440:procurement_lead', busy: false, sent: false, binding: null,
    hooks: { beforeUpload: async () => {}, uploaded: async () => {} } };
  const handler = sourceEval('', `(${call.arguments[1].getText(source.tree)})`, {
    assert, m, c, role: roles[1], key: completion.key, completion, token: 'test-only-token',
    guard: replenishmentRunner.createGuardFailureLatch(), pendingRoutes: new Set(),
    inspectStorageUpload, assertActor, actor: async role => proof(m, role), record: async event => events.push(copy(event)),
    clients: { [roles[1]]: client }, BUCKET: 'procurement-requests', syntheticPdf,
    completePrefixList: async () => { lists++; return []; },
  });
  await handler({ request: () => ({ method: () => wire.method, url: () => wire.url, headers: () => wire.headers, postDataBuffer: () => wire.bytes }),
    fetch: async () => { dispatched++; const u = completion.binding;
      const path = new URL(wire.url).pathname.split('/procurement-requests/')[1];
      assert(u.requestId); await asActor(ids[1], 'insert into storage.objects values($1,$2,$3)', [path, 'procurement-requests', ids[1]]);
      return { status: () => 200 }; },
    fulfill: async () => { fulfilled++; }, abort: async () => { aborted++; },
  });
  assert.equal(dispatched, 1); assert.equal(downloads, 0, 'Private read must wait for canonical registration');
  assert.equal(lists, 0); assert.equal(fulfilled, 1); assert.equal(aborted, 0);
  assert.equal(events.filter(e => e.kind === 'storage-upload-response').length, 1);
});

function deferredEvidenceHarness(m) {
  const h = harness(m), reads = [];
  h.adapter.verifyEvidence = async (c, role, binding) => {
    const s = h.states[c.viewport]; assert.equal(role, roles[1]);
    assert.equal(s.rows.requests.length, 1); assert.equal(s.rows.attachments.length, 2);
    assert.equal(s.rows.recommendations[0].status, 'handed_off');
    assert.equal(s.rows.routeDecisions.length, 0, 'Byte proof must precede route confirmation');
    assert.deepEqual(s.rows.attachments.map(a => a.storage_path).sort(), binding.uploads.map(u => u.path).sort());
    reads.push(c.viewport);
    return binding.uploads.map(u => ({ ...proofFixture(binding), path: u.path, downloadSha256: u.sha256, downloadSizeBytes: u.sizeBytes }));
  };
  return { ...h, reads };
}

test('registered-evidence timing: complete requires both owner byte proofs per view after persisted handoff', async () => {
  const m = manifest(), h = deferredEvidenceHarness(m), report = newReport(m, h.adapter.kind);
  await executeJourney(m, h.adapter, report);
  assert.deepEqual(h.reads, ['desktop1440', 'mobile390'], 'All four objects require post-registration byte verification');
  assert.equal(report.complete, true);
  for (const c of m.cases) assert.equal(h.calls.filter(x => x[0] === c.viewport && x[2] === 'handoff').length, 1);
});

for (const defect of ['download-denied', 'wrong-bytes', 'duplicate-last', 'missing-file', 'extra-prefix', 'foreign-owner']) {
  test(`registered-evidence timing: ${defect} blocks completion and route confirmation without replay`, async () => {
    const m = manifest(), h = deferredEvidenceHarness(m), verify = h.adapter.verifyEvidence;
    h.adapter.verifyEvidence = async (...args) => {
      const result = await verify(...args);
      if (defect === 'download-denied') throw new Error('Owner read unavailable');
      if (defect === 'wrong-bytes') result[0].downloadSha256 = 'f'.repeat(64);
      if (defect === 'duplicate-last') result[0] = copy(result[1]);
      if (defect === 'missing-file') result.pop();
      if (defect === 'extra-prefix') result[0].listedNames.push('unrelated.pdf');
      if (defect === 'foreign-owner') result[0].actorId = ids[0];
      return result;
    };
    const report = newReport(m, h.adapter.kind);
    await assert.rejects(executeJourney(m, h.adapter, report));
    assert.equal(report.complete, false); assert.equal(h.states.desktop1440.rows.storage.length, 2);
    assert.equal(h.calls.filter(x => x[2] === 'handoff').length, 1);
    assert(!h.calls.some(x => x[0] === 'mobile390' || x[2] === 'confirm-route'));
  });
}

test('guard failure latch: first failure interrupts a pending response and prevents later dispatch', async () => {
  assert.equal(typeof replenishmentRunner.createGuardFailureLatch, 'function');
  const latch = replenishmentRunner.createGuardFailureLatch(), first = new Error('First fixed guard failure');
  let dispatches = 0, started; const began = new Promise(resolve => { started = resolve; });
  const waiting = latch.run(() => { dispatches++; started(); return new Promise(() => {}); });
  const rejected = assert.rejects(waiting, error => error === first);
  await began;
  latch.fail(first); latch.fail(new Error('Later failure must not replace first'));
  await rejected;
  await assert.rejects(latch.run(() => { dispatches++; }), error => error === first);
  assert.equal(dispatches, 1);
});

test('guard failure latch: click failure propagates without waiting for a response or retrying', async () => {
  assert.equal(typeof replenishmentRunner.createGuardFailureLatch, 'function');
  const latch = replenishmentRunner.createGuardFailureLatch(), first = new Error('Upload guard blocked');
  let uploads = 0, handoffs = 0;
  await assert.rejects(latch.run(async () => { uploads++; latch.fail(first); await new Promise(() => {}); }), error => error === first);
  await assert.rejects(latch.run(() => { handoffs++; }), error => error === first);
  assert.equal(uploads, 1); assert.equal(handoffs, 0);
});

test('guard failure latch: actual route rejects response wait before blocked-event persistence finishes', async () => {
  const source = await actualSource('scripts/qa/wms-replenishment-signoff-live.mjs');
  const call = sourceNode(source.tree, n => ts.isCallExpression(n) && n.expression.getText(source.tree) === 'context.route');
  const guard = replenishmentRunner.createGuardFailureLatch(), pendingRoutes = new Set();
  let releaseRecord, eventStarted, aborted = 0, dispatched = 0;
  const recording = new Promise(resolve => { releaseRecord = resolve; });
  const began = new Promise(resolve => { eventStarted = resolve; });
  const callback = sourceEval('', `(${call.arguments[1].getText(source.tree)})`, {
    assert, guard, pendingRoutes, completion: null,
    record: async () => { eventStarted(); await recording; },
  });
  const waiting = guard.run(() => new Promise(() => {}));
  const rejected = assert.rejects(waiting, /Unarmed Storage write/);
  const route = () => ({ request: () => ({ method: () => 'POST', url: () => 'https://offline.invalid/storage/v1/object/procurement-requests/unknown' }),
    continue: async () => { dispatched++; }, fetch: async () => { dispatched++; }, abort: async () => { aborted++; } });
  const first = callback(route()); await began; await rejected;
  const second = callback(route());
  assert.equal(aborted, 0, 'Wait fails before logging/abort can finish'); assert.equal(dispatched, 0);
  releaseRecord(); await Promise.all([first, second]);
  assert.equal(aborted, 2); assert.equal(pendingRoutes.size, 0); assert.equal(dispatched, 0);
});

for (const defect of ['wrong-owner', 'wrong-size', 'extra-object']) test(`registered-evidence metadata: ${defect} stops after first upload without a handoff`, async () => {
  const m = manifest(), h = harness(m), complete = h.adapter.complete;
  h.adapter.complete = async (c, role, id, hooks) => complete(c, role, id, { ...hooks, uploaded: async (...args) => {
    const s = h.states[c.viewport];
    if (defect === 'wrong-owner') s.rows.storage[0].owner_id = ids[0];
    if (defect === 'wrong-size') s.rows.storage[0].metadata.size++;
    if (defect === 'extra-object') s.rows.storage.push({ ...s.rows.storage[0], id: ids[1], name: 'foreign' });
    return hooks.uploaded(...args);
  } });
  const report = newReport(m, h.adapter.kind); await assert.rejects(executeJourney(m, h.adapter, report));
  assert.equal(report.complete, false); assert.equal(h.states.desktop1440.rows.requests.length, 0);
  assert(!h.calls.some(x => x[0] === 'mobile390' || x[2] === 'handoff'));
});

for (const defect of [null, 'changed-byte', 'truncated-byte', 'denied-read', 'partial-list', 'extra-object', 'changed-actor']) {
  test(`registered-evidence bytes: ${defect ?? 'all four canonical files'} uses actual Blob bytes and exact full prefix`, async () => {
    assert.equal(typeof replenishmentRunner.verifyRegisteredStorageEvidence, 'function');
    const m = manifest(), allDownloads = [];
    for (const c of m.cases) {
      const requestId = `req_${ids[c.viewport === 'desktop1440' ? 0 : 1]}`;
      const binding = { requestId, uploads: [0, 1].map(i => uploadFixture(m, c, requestId, i)), payload: null, route: null };
      binding.payload = payloadFixture(m, c, binding);
      const client = {
        auth: { getUser: async () => ({ data: { user: { ...m.actors[roles[1]], id: defect === 'changed-actor' ? ids[0] : ids[1] } }, error: null }) },
        storage: { from: bucket => {
          assert.equal(bucket, 'procurement-requests');
          return {
            download: async objectPath => {
              const index = binding.uploads.findIndex(u => u.path === objectPath); assert(index >= 0, 'No unrelated object read');
              assert(!allDownloads.includes(objectPath), 'No automatic download retry'); allDownloads.push(objectPath);
              if (defect === 'denied-read') return { data: null, error: { status: 400, statusCode: '404', name: 'StorageApiError', message: 'PRIVATE_SIGNED_TOKEN_CANARY' } };
              let bytes = syntheticPdf(m.runId, c.viewport, c.documents[index].kind);
              if (defect === 'changed-byte') { bytes = Buffer.from(bytes); bytes[50] ^= 1; }
              if (defect === 'truncated-byte') bytes = bytes.subarray(0, bytes.length - 1);
              return { data: new Blob([bytes], { type: 'application/pdf' }), error: null };
            },
            list: async (prefix, options) => {
              assert.equal(prefix, `request/${requestId}`); assert.equal(options.offset, 0);
              const data = binding.uploads.map((u, i) => ({ id: ids[i], name: u.path.split('/').at(-1) }));
              if (defect === 'partial-list') data.pop();
              if (defect === 'extra-object') data.push({ id: ids[0], name: 'unrelated.pdf' });
              return { data, error: null };
            },
          };
        } },
      };
      const run = () => replenishmentRunner.verifyRegisteredStorageEvidence(m, c, binding, client);
      if (defect) {
        await assert.rejects(run(), error => {
          assert(!JSON.stringify({ message: error.message, details: error.safeDetails }).includes('PRIVATE_SIGNED_TOKEN_CANARY'));
          if (defect === 'denied-read') assert.deepEqual(error.safeDetails, { category: 'STORAGE_OWNER_DOWNLOAD', bucket: 'procurement-requests',
            path: binding.uploads[0].path, actorId: ids[1], status: 400, statusCode: 404, code: null, errorName: 'StorageApiError' });
          return true;
        });
        break;
      }
      const proofs = await run(); assert.equal(proofs.length, 2);
      assert.deepEqual(proofs.map(p => p.path).sort(), binding.uploads.map(u => u.path).sort());
      for (const p of proofs) {
        const u = binding.uploads.find(u => u.path === p.path);
        assert.equal(p.downloadSha256, u.sha256); assert.equal(p.downloadSizeBytes, u.sizeBytes);
        assert.deepEqual(p.listedNames.sort(), binding.uploads.map(u => u.path.split('/').at(-1)).sort());
      }
    }
    if (!defect) assert.equal(allDownloads.length, 4);
  });
}
