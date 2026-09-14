import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareVendorApplicationCase, cleanupVendorApplicationCase, loadAuthoritativeVendorChecklist, verifyVendorApplicationSubmission,
  runVendorApplicationUi, runLegalApplicationHandoffUi } from './vendor-application-fixture.mjs';

const scope = { runId: 'QA-20260905-00003C1F', viewport: 'desktop-1440', buildId: 'a'.repeat(40), project: 'kkoitlvydytdhlpxhuah' };
const env = { APP_ENV: 'uat', NEXT_PUBLIC_SUPABASE_URL: `https://${scope.project}.supabase.co`,
  SUPABASE_PROJECT_REF: scope.project, PRODUCTION_SUPABASE_PROJECT_REF: 'z'.repeat(20), POLICY_ALLOW_TEST_MUTATIONS: 'true' };
const vendorId = '10000000-0000-4000-8000-000000000001';
const vendorUser = '20000000-0000-4000-8000-000000000001';
const legalUser = '30000000-0000-4000-8000-000000000001';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'vendor-case-fixture-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('vendor-case-fixture-'));
    return rm(root, { recursive: true, force: true });
  });
  const tables = new Map(Object.entries({
    'core.vendors': [{ id: vendorId, legal_name: 'MWELL UAT Test Vendor', accreditation_status: 'draft', owner_module: 'legal' }],
    'core.profiles': [{ id: vendorUser, email: 'intra.test.vendor@mwell.com.ph', kind: 'vendor', status: 'active', vendor_id: vendorId },
      { id: legalUser, email: 'intra.test.legal.lead@mwell.com.ph', kind: 'employee', status: 'active', vendor_id: null }],
    'legal.vendor_invites': [{ id: 'accepted-existing', auth_user_id: vendorUser, vendor_id: vendorId, status: 'accepted', link_generation: 2, accepted_generation: 2, case_id: 'existing-case' }],
    'legal.accreditation_cases': [{ id: 'existing-case', vendor_id: vendorId, vendor_name: 'MWELL UAT Test Vendor', status: 'under_review' }],
    'legal.requirement_checklist_items': [{ id: 'existing-item', case_id: 'existing-case', code: 'PH_DTI_REG', decision: 'accepted' }],
  }));
  const calls = [], blobs = new Set(), receipts = new Map();
  const faults = {};
  function clientFor(userId) {
    return {
      auth: { async getUser() { return { data: { user: { id: userId, email: tables.get('core.profiles').find(p => p.id === userId)?.email } }, error: null }; } },
      schema(schema) { return {
        async rpc(name, args) {
          if (name === 'verify_security_database_launch_blockers') {
            assert.equal(schema, 'core');
            const policy = await loadAuthoritativeVendorChecklist();
            if (faults.livePolicyUnavailable) return { data: null, error: { message: 'verifier not installed' } };
            const rows = structuredClone(policy.rows);
            if (faults.livePolicyMismatch) rows[0].required = false;
            if (faults.livePolicyPartial) rows.pop();
            return { data: { missing_objects: [], vendor_fixture_checklist: { version: 1,
              function: 'private.legal_tailored_requirement_set', functionBodySha256: faults.livePolicyBody ? '0'.repeat(64) : policy.functionBodySha256, rows } }, error: null };
          }
          if (name === 'cleanup_uat_vendor_application') {
            assert.equal(schema, 'core');
            if (faults.missingCleanupRpc) return { data: null, error: { message: 'cleanup RPC not installed' } };
            const { mode, manifestText, sha256 } = args.payload;
            const manifest = JSON.parse(manifestText), id = manifest.intent.case.id;
            if (mode === 'read') {
              calls.push({ operation: 'receipt-read' });
              if (faults.receiptRead && receipts.has(id)) throw new Error('receipt read unavailable');
              return { data: receipts.get(id) ?? { receipt: null }, error: null };
            }
            calls.push({ operation: 'atomic-cleanup' });
            if (faults.delete) throw new Error('unknown atomic delete transport outcome');
            if (faults.concurrentReview) tables.get('legal.requirement_checklist_items').find(row => row.case_id === id).decision = 'accepted';
            for (const [table, expected] of Object.entries(manifest.snapshot)) {
              const actual = (tables.get(`legal.${table}`) ?? []).filter(row => row[table === 'accreditation_cases' ? 'id' : 'case_id'] === id)
                .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
              assert.deepEqual(actual, expected, 'concurrent snapshot changed');
            }
            for (const table of Object.keys(manifest.snapshot)) tables.set(`legal.${table}`, (tables.get(`legal.${table}`) ?? [])
              .filter(row => row[table === 'accreditation_cases' ? 'id' : 'case_id'] !== id));
            const receipt = { version: 1, complete: true, caseId: id, manifestSha256: sha256, scope: manifest.intent.scope,
              databaseRemaining: 0, storageDeleted: false, certificationCredit: false };
            receipts.set(id, receipt);
            if (faults.commitThenDisconnect) throw new Error('unknown committed transport outcome');
            return { data: receipt, error: null };
          }
          if (name === 'current_vendor_id') return { data: vendorId, error: null };
          if (name === 'my_learning_snapshot') return { data: faults.malformedLearning ? null : { curricula: [], progress: [], certifications: [], lockedCapabilities: [], refreshedAt: new Date().toISOString() }, error: null };
          if (name === 'my_capability_snapshot') return { data: { roleCapabilities: { core: ['submit_documents', 'manage_own_accreditation_draft', 'submit_accreditation'], legal: ['manage_checklist', 'review_accreditation'] },
            userCapabilities: { core: ['submit_documents', 'manage_own_accreditation_draft', ...(!faults.learningDenied ? ['submit_accreditation'] : [])], legal: ['manage_checklist', 'review_accreditation'] } }, error: null };
          if (name === 'submit_vendor_application') {
            assert.equal(schema, 'legal');
            assert.equal(args.payload.idempotency_key, 'synthetic-ui-command-only');
            const snapshot = tables.get('legal.vendor_application_snapshots').find(row => row.case_id === args.payload.case_id);
            return { data: { snapshot, replayed: !faults.badReplay }, error: null };
          }
          throw new Error(`Unexpected RPC ${name}`);
        },
        from(table) {
          const key = `${schema}.${table}`, predicates = [];
          let operation = 'read', payload, single = false;
          const q = {
            select() { return q; }, abortSignal() { return q; }, limit() { return q; },
            eq(k, v) { predicates.push(row => row[k] === v); return q; },
            in(k, values) { predicates.push(row => values.includes(row[k])); return q; },
            single() { single = true; return q; },
            insert(value) { operation = 'insert'; payload = Array.isArray(value) ? value : [value]; return q; },
            delete() { operation = 'delete'; return q; },
            async then(resolve, reject) { try {
              const rows = tables.get(key) ?? [];
              if (faults.read === key && operation === 'read') return resolve({ data: null, error: { message: 'denied' } });
              const matched = rows.filter(row => predicates.every(p => p(row)));
              if (faults.ownCaseRead && userId === vendorUser && key === 'legal.accreditation_cases' && operation === 'read')
                return resolve({ data: [], error: null });
              calls.push({ key, operation, payload, matched: structuredClone(matched) });
              if (operation === 'insert') {
                assert.ok(!payload.some(row => rows.some(old => old.id === row.id)), 'insert only');
                tables.set(key, [...rows, ...structuredClone(payload)]);
                if (faults.insert === key) throw new Error('unknown insert transport outcome');
                return resolve({ data: structuredClone(payload), error: null });
              }
              if (operation === 'delete') {
                if (faults.delete === key) throw new Error('unknown delete transport outcome');
                tables.set(key, rows.filter(row => !matched.includes(row)));
              }
              resolve({ data: single ? matched[0] : structuredClone(matched), count: matched.length, error: null });
            } catch (error) { reject(error); } },
          };
          return q;
        },
      }; },
      storage: { from(bucket) { assert.equal(bucket, 'documents'); return {
        async list(folder) { calls.push({ operation: 'storage-list', folder });
          if (faults.storage) return { data: null, error: { message: 'storage denied' } };
          return { data: [...blobs].filter(p => p.startsWith(`${folder}/`)).map(p => ({ id: p, name: p.slice(folder.length + 1) })), error: null };
        },
        async remove(paths) { calls.push({ operation: 'storage-delete', paths });
          if (faults.storageRemove) return { error: { message: 'Storage removal failed' } };
          paths.forEach(p => blobs.delete(p)); return { error: null }; },
      }; } },
    };
  }
  const options = { client: clientFor(null), vendorClient: clientFor(vendorUser), legalClient: clientFor(legalUser),
    scope, env, file: path.join(root, 'vendor-case.json') };
  return { options, calls, tables, faults, blobs };
}

function submissionRow(intent) {
  return { id: vendorUser, case_id: intent.case.id, vendor_id: vendorId, created_by: vendorUser,
    status: 'submitted', version: 2, document_hash: 'b'.repeat(64), policy_id: 'vendor-accreditation', policy_version: '2025',
    signature: { method: 'typed', dataUrl: 'data:image/png;base64,c3ludGhldGlj', signerName: 'SYNTHETIC QA Signatory' },
    signed_at: '2026-09-14T00:00:00Z', submitted_at: '2026-09-14T00:00:00Z' };
}

function uiDriver(h, intent, fault) {
  const events = [], captures = [];
  const items = intent.checklist.filter(row => !row.instrument);
  let current, file, resolveResponse, responsePredicate;
  const node = (role, name) => ({
    async click() {
      events.push({ role, name });
      if (String(name).endsWith('upload document')) current = items.find(item => name.startsWith(item.requirement));
      if (name === 'Upload document') {
        assert.ok(current && file);
        const doc = { id: `doc_${current.code}`, case_id: intent.case.id, vendor_id: vendorId, requirement_id: current.id,
          uploaded_by_email: 'intra.test.vendor@mwell.com.ph', filename: file.name, mime_type: 'application/pdf',
          size_bytes: file.buffer.length, status: 'submitted', version: 1,
          storage_path: `vendor/${vendorId}/legal/accreditation/${intent.case.id}/${vendorUser}_${file.name}` };
        h.tables.set('legal.accreditation_docs', [...(h.tables.get('legal.accreditation_docs') ?? []), doc]);
        h.blobs.add(doc.storage_path);
      }
      if (name === 'Sign and submit') {
        const snapshot = submissionRow(intent);
        const response = { url: () => 'https://kkoitlvydytdhlpxhuah.supabase.co/rest/v1/rpc/submit_vendor_application',
          request: () => ({ postDataJSON: () => ({ payload: { case_id: intent.case.id, expected_version: 1, idempotency_key: 'synthetic-ui-command-only' } }) }),
          ok: () => fault !== 'rejected', json: async () => ({ snapshot }) };
        assert.equal(responsePredicate(response), true);
        if (fault !== 'missingReadback') {
          h.tables.set('legal.vendor_application_snapshots', [snapshot]);
          h.tables.get('legal.accreditation_cases')[1].status = 'submitted';
        }
        resolveResponse(response);
      }
    },
    async setInputFiles(value) { file = value; assert.match(value.buffer.toString(), /SYNTHETIC QA ONLY/); },
    async fill() {}, async check() {}, async waitFor() {},
    async isDisabled() { return fault !== 'missingValidation'; },
    async count() { return fault === 'editableAfterSubmit' ? 1 : 0; },
    async inputValue() { return fault === 'missingLegalUi' ? '' : 'SYNTHETIC QA Signatory'; },
    first() { return this; }, filter() { return this; }, locator(selector) { return node('locator', selector); },
    getByRole(r, options) { return node(r, options.name); },
  });
  const page = {
    getByRole: (role, options = {}) => node(role, options.name), locator: selector => node('locator', selector),
    getByText: name => node('text', name), getByPlaceholder: name => node('placeholder', name),
    async goto() {}, async reload() {}, async waitForURL() {},
    waitForResponse(predicate) { responsePredicate = predicate; return new Promise(resolve => { resolveResponse = resolve; }); },
  };
  return { page, events, captures, captureState: async label => { captures.push(label); } };
}

test('actual UI orchestration submits only after eight owned synthetic uploads and gives Legal the exact readback', async t => {
  const h = await fixture(t), intent = await prepareVendorApplicationCase(h.options), ui = uiDriver(h, intent);
  const submission = await runVendorApplicationUi({ ...ui, client: h.options.vendorClient, intent, origin: 'https://mwell-intra-uat.vercel.app' });
  assert.equal(submission.inputs.length, 8);
  assert.ok(submission.inputs.every(row => /^[a-f0-9]{64}$/.test(row.inputSha256)));
  assert.equal(ui.events.filter(row => row.name === 'Sign and submit').length, 1);
  const handoff = await runLegalApplicationHandoffUi({ ...ui, client: h.options.legalClient, intent, submission, origin: 'https://mwell-intra-uat.vercel.app' });
  assert.equal(handoff.handoffCheckpoint.snapshotId, submission.applicationCheckpoint.snapshotId);
  assert.equal(handoff.handoffCheckpoint.readerId, legalUser);
  assert.equal(ui.captures.at(-1), 'legal reads exact submitted synthetic application');
  assert.equal((await cleanupVendorApplicationCase(h.options)).complete, true);
  assert.equal(h.blobs.size, 0);
  assert.equal(h.tables.get('legal.accreditation_cases')[0].id, 'existing-case');
});

for (const fault of ['missingValidation', 'rejected', 'missingReadback', 'editableAfterSubmit', 'badReplay']) {
  test(`actual UI orchestration cannot report completion for ${fault}`, async t => {
    const h = await fixture(t), intent = await prepareVendorApplicationCase(h.options), ui = uiDriver(h, intent, fault);
    if (fault === 'badReplay') h.faults.badReplay = true;
    await assert.rejects(runVendorApplicationUi({ ...ui, client: h.options.vendorClient, intent, origin: 'https://mwell-intra-uat.vercel.app' }));
    assert.ok(!ui.captures.includes('submitted current version readback'));
    if (fault === 'missingValidation') assert.ok(!ui.events.some(row => row.name === 'Sign and submit'));
  });
}

test('Legal handoff does not credit an unhydrated UI even when the database readback is valid', async t => {
  const h = await fixture(t), intent = await prepareVendorApplicationCase(h.options), ui = uiDriver(h, intent, 'missingLegalUi');
  const submission = await runVendorApplicationUi({ ...ui, client: h.options.vendorClient, intent, origin: 'https://mwell-intra-uat.vercel.app' });
  await assert.rejects(runLegalApplicationHandoffUi({ ...ui, client: h.options.legalClient, intent, submission, origin: 'https://mwell-intra-uat.vercel.app' }), /not hydrated/);
  assert.ok(!ui.captures.includes('legal reads exact submitted synthetic application'));
});

test('checklist executes the installed-policy source, including the required instrument', async () => {
  const policy = await loadAuthoritativeVendorChecklist();
  assert.equal(policy.rows.length, 9);
  assert.equal(new Set(policy.rows.map(row => row.code)).size, 9);
  assert.ok(policy.rows.every(row => row.required && row.policy_version === '2025'));
  assert.equal(policy.rows.find(row => row.instrument).code, 'SIGN_NDA_STANDARD');
  assert.match(policy.sourceSha256, /^[a-f0-9]{64}$/);
});

test('insert-only prerequisite records intent first and case-only cleanup preserves reusable vendor/account/invite/other case', async t => {
  const h = await fixture(t);
  const before = structuredClone([...h.tables]);
  const intent = await prepareVendorApplicationCase(h.options);
  assert.deepEqual(JSON.parse(await readFile(h.options.file, 'utf8')), intent);
  assert.equal(intent.certificationCredit, false);
  assert.equal(intent.checklist.length, 9);
  assert.equal(h.tables.get('legal.accreditation_cases').length, 2);
  assert.ok(h.calls.filter(c => c.operation === 'insert').every(c => ['legal.accreditation_cases', 'legal.requirement_checklist_items'].includes(c.key)));
  const report = await cleanupVendorApplicationCase(h.options);
  assert.equal(report.complete, true);
  for (const [key, rows] of before) assert.deepEqual(h.tables.get(key), rows, key);
  assert.ok(!h.calls.some(c => c.operation === 'delete' && /core\.|vendor_invites/.test(c.key)));
});

for (const fault of ['learningDenied', 'malformedLearning', 'generation', 'foreignVendor', 'wrongIdentity', 'existingCase',
  'livePolicyUnavailable', 'livePolicyMismatch', 'livePolicyPartial', 'livePolicyBody', 'missingCleanupRpc']) {
  test(`preflight rejects ${fault} before any fixture mutation`, async t => {
    const h = await fixture(t);
    if (fault === 'learningDenied') h.faults.learningDenied = true;
    if (fault === 'malformedLearning') h.faults.malformedLearning = true;
    if (fault.startsWith('livePolicy')) h.faults[fault] = true;
    if (fault === 'missingCleanupRpc') h.faults.missingCleanupRpc = true;
    if (fault === 'generation') h.tables.get('legal.vendor_invites')[0].accepted_generation = 1;
    if (fault === 'foreignVendor') h.tables.get('core.profiles')[0].vendor_id = legalUser;
    if (fault === 'wrongIdentity') h.tables.get('core.profiles')[0].email = 'someone@example.com';
    if (fault === 'existingCase') {
      const intent = await prepareVendorApplicationCase(h.options);
      h.calls.length = 0;
      h.options.file += '.other';
      assert.ok(intent.case.id);
    }
    await assert.rejects(prepareVendorApplicationCase(h.options));
    assert.ok(!h.calls.some(c => ['insert', 'delete', 'storage-delete'].includes(c.operation)));
  });
}

test('ordinary vendor must read the exact new case before any application UI can be dispatched', async t => {
  const h = await fixture(t);
  h.faults.ownCaseRead = true;
  await assert.rejects(prepareVendorApplicationCase(h.options), /binding missing/);
  assert.ok(!h.calls.some(c => c.operation === 'storage-delete'));
  assert.equal((await cleanupVendorApplicationCase(h.options)).complete, true, 'failed ordinary read retains cleanup provenance');
});

test('both setup and cleanup reject unapproved or non-UAT targets without any RPC or table mutation', async t => {
  const h = await fixture(t);
  for (const changed of [{ APP_ENV: 'production' }, { POLICY_ALLOW_TEST_MUTATIONS: 'false' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://foreign.supabase.co' }, { SUPABASE_PROJECT_REF: 'foreign' }]) {
    const options = { ...h.options, env: { ...env, ...changed } };
    await assert.rejects(prepareVendorApplicationCase(options));
    await assert.rejects(cleanupVendorApplicationCase(options));
  }
  assert.equal(h.calls.length, 0);
});

test('an incorrect checklist manifest version or source pin rejects before fixture writes', async t => {
  const h = await fixture(t);
  for (const checklistManifest of [{ version: 999 }, { version: 1, sourceSha256: '0'.repeat(64) }]) {
    await assert.rejects(prepareVendorApplicationCase({ ...h.options, checklistManifest }), /manifest/);
  }
  assert.ok(!h.calls.some(call => call.operation === 'insert'));
});

for (const field of ['buildId', 'project', 'viewport', 'runId']) {
  test(`foreign cleanup ${field} is denied without deletion`, async t => {
    const h = await fixture(t);
    await prepareVendorApplicationCase(h.options);
    await assert.rejects(cleanupVendorApplicationCase({ ...h.options, scope: { ...scope, [field]: field === 'viewport' ? 'mobile-390' : 'foreign' } }));
    assert.ok(!h.calls.some(c => c.operation === 'delete'));
  });
}

for (const fault of ['foreignCase', 'foreignDocument', 'unrelatedInvite', 'unexpectedChecklist', 'storageRead', 'missingProof']) {
  test(`case cleanup rejects ${fault} before deleting rows or objects`, async t => {
    const h = await fixture(t), intent = await prepareVendorApplicationCase(h.options);
    if (fault === 'foreignCase') h.tables.get('legal.accreditation_cases')[1].vendor_id = legalUser;
    if (fault === 'foreignDocument') h.tables.set('legal.accreditation_docs', [{ id: 'bad', case_id: intent.case.id, vendor_id: vendorId, storage_path: 'vendor/foreign/legal/accreditation/other/file.pdf' }]);
    if (fault === 'unrelatedInvite') h.tables.get('legal.vendor_invites').push({ id: 'foreign', case_id: intent.case.id });
    if (fault === 'unexpectedChecklist') h.tables.get('legal.requirement_checklist_items').push({ id: 'foreign', case_id: intent.case.id });
    if (fault === 'storageRead') h.faults.storage = true;
    if (fault === 'missingProof') h.options.file += '.absent';
    await assert.rejects(cleanupVendorApplicationCase(h.options));
    assert.ok(!h.calls.some(c => c.operation === 'delete' || c.operation === 'storage-delete'));
  });
}

test('unknown checklist insertion outcome has recoverable durable intent and is never retried', async t => {
  const h = await fixture(t);
  h.faults.insert = 'legal.requirement_checklist_items';
  await assert.rejects(prepareVendorApplicationCase(h.options), /unknown/);
  assert.equal(h.calls.filter(c => c.operation === 'insert' && c.key.endsWith('checklist_items')).length, 1);
  assert.equal((await cleanupVendorApplicationCase(h.options)).complete, true);
});

test('unknown delete outcome stops, leaving parent and storage evidence discoverable', async t => {
  const h = await fixture(t);
  await prepareVendorApplicationCase(h.options);
  h.faults.delete = 'legal.accreditation_docs';
  await assert.rejects(cleanupVendorApplicationCase(h.options), /unknown/);
  assert.equal(h.calls.filter(c => c.operation === 'atomic-cleanup').length, 1);
  assert.equal(h.tables.get('legal.accreditation_cases').length, 2);
});

for (const fault of ['concurrentReview', 'receiptRead', 'commitThenDisconnect', 'storageRemove']) {
  test(`cleanup ${fault} retains the manifest and never claims completion`, async t => {
    const h = await fixture(t), intent = await prepareVendorApplicationCase(h.options);
    h.blobs.add(`vendor/${vendorId}/legal/accreditation/${intent.case.id}/${vendorUser}_SYNTHETIC-QA-PH_DTI_REG.pdf`);
    h.faults[fault] = true;
    await assert.rejects(cleanupVendorApplicationCase(h.options));
    const archive = await readFile(`${h.options.file}.cleanup.json`, 'utf8');
    assert.equal(h.blobs.size, 1);
    h.faults[fault] = false;
    if (fault === 'concurrentReview') await assert.rejects(cleanupVendorApplicationCase(h.options), /no committed receipt/);
    else assert.equal((await cleanupVendorApplicationCase(h.options)).complete, true);
    assert.equal(await readFile(`${h.options.file}.cleanup.json`, 'utf8'), archive, 'recovery never rewrites evidence');
    assert.equal(h.calls.filter(c => c.operation === 'atomic-cleanup').length, 1, 'recovery must not replay DB mutation');
  });
}

test('database cleanup must commit and be read back before any Storage deletion', async t => {
  const h = await fixture(t), intent = await prepareVendorApplicationCase(h.options);
  h.blobs.add(`vendor/${vendorId}/legal/accreditation/${intent.case.id}/${vendorUser}_SYNTHETIC-QA-PH_DTI_REG.pdf`);
  await cleanupVendorApplicationCase(h.options);
  const storageIndex = h.calls.findIndex(c => c.operation === 'storage-delete');
  const dbIndex = h.calls.findIndex(c => c.operation === 'atomic-cleanup');
  assert.ok(dbIndex >= 0 && storageIndex > dbIndex, 'Storage cannot precede atomic DB cleanup');
  const archive = JSON.parse(await readFile(`${h.options.file}.cleanup.json`, 'utf8'));
  assert.equal(archive.manifest.storagePaths.length, 1);
});

for (const fault of [null, 'wrongAuthor', 'wrongCase', 'wrongVersion', 'wrongHash', 'unsigned', 'missingDocument', 'wrongUploader', 'missingSnapshot']) {
  test(`persisted application readback ${fault ?? 'passes exact signed current version'}`, async t => {
    const h = await fixture(t), intent = await prepareVendorApplicationCase(h.options);
    const saved = { id: vendorUser, case_id: intent.case.id, vendor_id: vendorId, created_by: vendorUser,
      status: 'submitted', version: 2, document_hash: 'b'.repeat(64), policy_id: 'vendor-accreditation', policy_version: '2025',
      signature: { method: 'typed', dataUrl: 'data:image/png;base64,c3ludGhldGlj', signerName: 'SYNTHETIC QA Signatory' },
      signed_at: '2026-09-14T00:00:00Z', submitted_at: '2026-09-14T00:00:00Z' };
    const responseSnapshot = structuredClone(saved);
    h.tables.get('legal.accreditation_cases')[1].status = 'submitted';
    h.tables.set('legal.vendor_application_snapshots', [saved]);
    h.tables.set('legal.accreditation_docs', intent.checklist.filter(r => !r.instrument).map(r => ({ id: `doc_${r.code}`, case_id: intent.case.id,
      requirement_id: r.id, vendor_id: vendorId, status: 'submitted', version: 1, mime_type: 'application/pdf', size_bytes: 100,
      uploaded_by_email: 'intra.test.vendor@mwell.com.ph', storage_path: `vendor/${vendorId}/legal/accreditation/${intent.case.id}/${vendorUser}_SYNTHETIC-QA-${r.code}.pdf` })));
    if (fault === 'wrongAuthor') saved.created_by = legalUser;
    if (fault === 'wrongCase') saved.case_id = 'foreign';
    if (fault === 'wrongVersion') saved.version = 3;
    if (fault === 'wrongHash') saved.document_hash = 'c'.repeat(64);
    if (fault === 'unsigned') saved.signature = {};
    if (fault === 'missingDocument') h.tables.get('legal.accreditation_docs').pop();
    if (fault === 'wrongUploader') h.tables.get('legal.accreditation_docs')[0].uploaded_by_email = 'other@example.com';
    if (fault === 'missingSnapshot') h.tables.set('legal.vendor_application_snapshots', []);
    const read = () => verifyVendorApplicationSubmission({ client: h.options.vendorClient, intent, responseSnapshot });
    if (fault) await assert.rejects(read());
    else { const result = await read(); assert.equal(result.matched, 1); assert.equal(result.documentCount, 8); }
  });
}
