import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile, link } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditPersonas } from './uat-audit-identities.mjs';
import { WMS_CHECKPOINTS, requiredWmsEvidence } from './wms-signoff-contract.mjs';
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
test('all four deterministic PDFs parse without repair and render visible text with MuPDF offline', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'wms-pdf-parse-')); t.after(() => rm(root, { recursive: true, force: true }));
  const python = process.env.WMS_PDF_PYTHON ?? path.resolve(path.dirname(process.execPath), '../../python/python.exe');
  const script = "import fitz,json,sys; d=fitz.open(sys.argv[1]); p=d[0]; x=p.get_pixmap(); print(json.dumps({'pages':len(d),'repaired':d.is_repaired,'text':p.get_text(),'width':x.width,'height':x.height,'ink':sum(v<240 for v in x.samples),'warnings':fitz.TOOLS.mupdf_warnings()}))";
  const m = manifest();
  for (const c of m.cases) for (const d of c.documents) {
    const file = path.join(root, d.filename); await writeFile(file, syntheticPdf(m.runId, c.viewport, d.kind), { flag: 'wx' });
    const { stdout } = await promisify(execFile)(python, ['-c', script, file], { timeout: 20000, windowsHide: true });
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
        binding.uploads.push(u); await hooks.uploaded(copy(binding), proofFixture(binding));
      }
      binding.payload = payloadFixture(m, c, binding); await hooks.beforeHandoff(copy(binding));
      return adapter.command(c, role, 'handoff', { id: recommendationId, action: 'handoff', request: binding.payload });
    },
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
for (const defect of ['early-bind-artifact', 'initial-bound-read', 'second-upload-read', 'revoked-before-upload', 'bad-download', 'skip-early-bind', 'skip-handoff-hook']) {
  test(`completion ${defect} stops before the next upload/command and never reaches mobile`, async () => {
    const m = manifest(), h = harness(m), read = h.adapter.read, complete = h.adapter.complete;
    if (defect === 'early-bind-artifact') h.adapter.record = async e => { if (e.kind === 'early-request-binding') throw new Error('disk failure'); };
    if (['initial-bound-read', 'second-upload-read'].includes(defect)) h.adapter.read = async (c, stage, b) => {
      if (b && b.uploads.length === (defect === 'initial-bound-read' ? 0 : 1)) throw new Error('fresh database read failed'); return read(c, stage, b);
    };
    h.adapter.complete = async (c, role, id, hooks) => {
      if (defect === 'revoked-before-upload') h.adapter.actor = async r => ({ ...proof(m, r), capabilities: { userCapabilities: {}, roleCapabilities: {} } });
      const wrapped = { ...hooks };
      if (defect === 'bad-download') wrapped.uploaded = async (b, p) => hooks.uploaded(b, { ...p, downloadSha256: 'f'.repeat(64) });
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
  const boundary = sourceEval(`let armed, guardError; const callback=${callback};`, '({ callback, state:()=>({armed,guardError}) })',
    { assert, m, c, role: roles[1], key: completion.key, completion, token: 'offline-token', RPC: 'manage_replenishment_recommendation',
      sameKeys: (value, keys) => assert.deepEqual(Object.keys(value).sort(), [...keys].sort()),
      assertCanonicalPayload, authorizeBrowserRequest, record: async e => events.push(copy(e)) });
  const route = () => ({ request: () => ({ method: () => 'POST', url: () => `https://${m.project}.supabase.co/rest/v1/rpc/manage_replenishment_recommendation`,
    headers: () => ({ 'content-profile': 'procurement', authorization: 'Bearer offline-token' }),
    postDataJSON: () => ({ payload: { id: completion.recommendationId, action: 'handoff', request: copy(bound.payload) } }) }),
    continue: async () => { dispatches++; }, abort: async () => { aborted++; } });
  const first = boundary.callback(route()), second = boundary.callback(route());
  await Promise.resolve(); release(); await Promise.all([first, second]);
  assert(dispatches <= 1, 'Two exact requests must never dispatch two handoffs');
  assert.equal(reads, 1, 'Only the reserved request may reach fresh preflight');
  assert.equal(dispatches, 0, 'A concurrent blocked write closes the whole guarded attempt before first dispatch');
  assert.equal(aborted, 2); assert(completion.sent); assert(boundary.state().guardError);
  assert(!events.some(e => e.kind === 'browser-command'));
});
test('canonical wizard and real responsive draft selectors exercise visible inputs/cards offline', async t => {
  const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
  const { chromium, expect } = require('@playwright/test'), browser = await chromium.launch(); t.after(() => browser.close());
  const m = manifest(), source = await readFile(new URL('../../modules/procurement/src/pages/CreateRequestPage.tsx', import.meta.url), 'utf8');
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
      <textarea id="need-description" readonly>${c.rationale}</textarea><input type="file" multiple>
      ${c.documents.map(d => `<select aria-label="Document type for ${d.filename}"><option value="spec">Specification</option><option value="budget">Budget</option></select>`).join('')}
      <h3>RFQ requirements</h3>${Object.keys(c.completion.terms).map(k => `<input id="rfq-${k}">`).join('')}<button>Create draft &amp; complete handoff</button>`);
    await fillCanonicalWizard(page, m, c, expect, value => steps.push(value));
    assert.equal(await page.locator('#budgetCode').inputValue(), 'TEST-ONLY-NOT-FUNDING');
    assert.equal(await page.locator('input[type=file]').evaluate(input => input.files.length), 2);
    const bytes = await page.locator('input[type=file]').evaluate(async input => Array.from(new Uint8Array(await input.files[0].arrayBuffer())));
    assert.deepEqual(Buffer.from(bytes), syntheticPdf(m.runId, c.viewport, 'spec'));
    assert.equal(steps.length, 3);
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
