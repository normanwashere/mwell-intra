import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { assertApprovedMutationTarget } from '../lib/target-environment.mjs';
import { assertDeterministicAuditRunId } from './uat-ci-run-id.mjs';
import { evidencePdf } from './payment-audit-evidence.mjs';

const PROJECT = 'kkoitlvydytdhlpxhuah';
const EMAIL = 'intra.test.vendor@mwell.com.ph';
const LEGAL_EMAIL = 'intra.test.legal.lead@mwell.com.ph';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
const check = (ok, message) => { if (!ok) throw new Error(message); };
const PROFILE = Object.freeze({ entityType: 'sole_prop', jurisdiction: 'PH', category: 'goods', riskTier: 'low',
  contractType: 'standard', handlesPersonalData: false, technologyServiceProvider: false });
const policyFile = new URL('../../supabase/migrations/20260815154324_legal_vendor_launch_blockers.sql', import.meta.url);
const policyStart = 'create or replace function private.legal_tailored_requirement_set(profile jsonb)';
export const VENDOR_CHECKLIST_MANIFEST = Object.freeze({ version: 1, policyId: 'vendor-accreditation', policyVersion: '2025',
  migrationVersion: '20260815154324',
  sourceSha256: '4ed03ca4dc21a9d50c37b3e9a26163595fc4d330512c4f65538cdc8cbd164728',
  rowsSha256: '0f934381d654879f1efb8744c917f259d146b77417c4e6178cc11e36ec92876d' });
let policyPromise;

export function extractAuthoritativeVendorChecklistSql(source) {
  // Normalize before locating the LF delimiter so CRLF cannot leave a trailing CR.
  source = source.replaceAll('\r\n', '\n');
  check(!source.includes('\r'), 'Authoritative checklist source contains lone carriage return');
  const start = source.indexOf(policyStart), end = source.indexOf('\nrevoke all on function private.legal_tailored_requirement_set', start);
  check(start >= 0 && end > start, 'Authoritative checklist source not found');
  const sql = source.slice(start, end);
  check(hash(sql) === VENDOR_CHECKLIST_MANIFEST.sourceSha256, 'Checklist manifest SQL source pin mismatch');
  return sql;
}

// Execute the real, pure SQL policy selector locally, not a hand-maintained
// shortened checklist. This is source-derived fixture evidence, not a live DDL attestation.
export async function loadAuthoritativeVendorChecklist() {
  policyPromise ??= (async () => {
    const source = await readFile(policyFile, 'utf8');
    const sql = extractAuthoritativeVendorChecklistSql(source);
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite();
    try {
      await db.exec(`create schema private; ${sql}`);
      const { rows } = await db.query('select * from private.legal_tailored_requirement_set($1::jsonb) order by code', [JSON.stringify(PROFILE)]);
      check(rows.length > 0 && rows.every(row => row.required === true) && rows.some(row => row.instrument === true), 'Incomplete authoritative checklist');
      check(digest(rows) === VENDOR_CHECKLIST_MANIFEST.rowsSha256, 'Checklist manifest selected-row pin mismatch');
      const body = (await db.query("select prosrc from pg_proc where oid='private.legal_tailored_requirement_set(jsonb)'::regprocedure")).rows[0].prosrc;
      return { rows, profile: PROFILE, sourceSha256: hash(sql), functionBodySha256: hash(body.replaceAll('\r\n', '\n')),
        source: '20260815154324_legal_vendor_launch_blockers.sql:private.legal_tailored_requirement_set' };
    } finally { await db.close(); }
  })();
  return structuredClone(await policyPromise);
}

function validateScope(scope, env) {
  assertDeterministicAuditRunId(scope?.runId);
  check(['desktop-1440', 'mobile-390'].includes(scope.viewport) && /^[a-f0-9]{40}$/.test(scope.buildId)
    && scope.project === PROJECT, 'Vendor fixture requires exact UAT run/build/viewport/project');
  assertApprovedMutationTarget({ appEnv: env.APP_ENV, supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    expectedProjectRef: PROJECT, productionProjectRef: env.PRODUCTION_SUPABASE_PROJECT_REF,
    mutationsRequested: true, mutationsApproved: env.POLICY_ALLOW_TEST_MUTATIONS === 'true' });
  check(env.SUPABASE_PROJECT_REF === PROJECT, 'Vendor fixture project mismatch');
}

export function vendorApplicationCaseId(scope) {
  return `qa_vendor_application_${digest([scope.project, scope.runId, scope.viewport, scope.buildId]).slice(0, 32)}`;
}

async function rows(client, schema, table, field, value, select = '*') {
  const { data, error } = await client.schema(schema).from(table).select(select).eq(field, value).limit(1000)
    .abortSignal(AbortSignal.timeout(15000));
  check(!error && Array.isArray(data) && data.length < 1000, `${schema}.${table} bounded readback unavailable`);
  return data;
}

async function one(client, schema, table, field, value, select) {
  const data = await rows(client, schema, table, field, value, select);
  check(data.length === 1, `${schema}.${table} exact binding missing or duplicate`);
  return data[0];
}

async function rpc(client, schema, name, args = {}) {
  const request = client.schema(schema).rpc(name, args);
  const { data, error } = await (typeof request.abortSignal === 'function' ? request.abortSignal(AbortSignal.timeout(15000)) : request);
  check(!error && data !== undefined && data !== null, `${schema}.${name} verification failed`);
  return data;
}

async function actor(client, email, kind, caps) {
  const { data, error } = await client.auth.getUser();
  const user = data?.user;
  check(!error && UUID.test(user?.id) && user.email === email, 'Ordinary actor identity mismatch');
  const profile = await one(client, 'core', 'profiles', 'id', user.id, 'id,email,kind,status,vendor_id');
  check(profile.email === email && profile.kind === kind && profile.status === 'active', 'Active actor profile required');
  const snapshot = await rpc(client, 'core', 'my_capability_snapshot');
  const learning = await rpc(client, 'learning', 'my_learning_snapshot');
  check(['curricula', 'progress', 'certifications', 'lockedCapabilities'].every(key => Array.isArray(learning[key]))
    && Number.isFinite(Date.parse(learning.refreshedAt)), 'Malformed learning prerequisite readback');
  const capabilities = [];
  for (const [module, capability] of caps) {
    check(Array.isArray(snapshot.roleCapabilities?.[module]) && snapshot.roleCapabilities[module].includes(capability)
      && Array.isArray(snapshot.userCapabilities?.[module]) && snapshot.userCapabilities[module].includes(capability),
      `Effective ${module}.${capability} missing; no training bypass permitted`);
    capabilities.push({ module, capability, raw: true, effective: true,
      learningLocks: learning.lockedCapabilities.filter(row => row.capability?.module === module && row.capability?.capability === capability) });
  }
  return { profile, capabilities, learning: { refreshedAt: learning.refreshedAt,
    assignedCurricula: learning.curricula.length, certificationRecords: learning.certifications.length, certificationCredit: false } };
}

export async function verifyVendorApplicationActor(client, legal = false) {
  return legal ? actor(client, LEGAL_EMAIL, 'employee', [['legal', 'manage_checklist'], ['legal', 'review_accreditation']])
    : actor(client, EMAIL, 'vendor', [['core', 'submit_documents'], ['core', 'manage_own_accreditation_draft'], ['core', 'submit_accreditation']]);
}

async function preservedBindings(client, intent) {
  const vendor = await one(client, 'core', 'vendors', 'id', intent.vendor.id, 'id,legal_name,accreditation_status,owner_module');
  const profile = await one(client, 'core', 'profiles', 'id', intent.actor.profile.id, 'id,email,kind,status,vendor_id');
  const invite = await one(client, 'legal', 'vendor_invites', 'id', intent.invite.id,
    'id,auth_user_id,vendor_id,status,link_generation,accepted_generation,case_id');
  check(isDeepStrictEqual(vendor, intent.vendor) && isDeepStrictEqual(profile, intent.actor.profile)
    && isDeepStrictEqual(invite, intent.invite), 'Protected vendor/account/accepted invite changed; stop for review');
}

async function persistIntent(file, intent) {
  await mkdir(path.dirname(file), { recursive: true });
  const handle = await open(file, 'wx');
  try { await handle.writeFile(`${JSON.stringify(intent)}\n`); await handle.sync(); } finally { await handle.close(); }
}

export async function prepareVendorApplicationCase({ client, vendorClient, legalClient, scope, env = process.env, file,
  checklistManifest = VENDOR_CHECKLIST_MANIFEST }) {
  validateScope(scope, env);
  check(isDeepStrictEqual(checklistManifest, VENDOR_CHECKLIST_MANIFEST), 'Exact reviewed checklist manifest required');
  const vendorActor = await verifyVendorApplicationActor(vendorClient);
  const legalActor = await verifyVendorApplicationActor(legalClient, true);
  const vendorId = await rpc(vendorClient, 'core', 'current_vendor_id');
  check(UUID.test(vendorId) && vendorActor.profile.vendor_id === vendorId, 'Authoritative vendor binding mismatch');
  const vendor = await one(client, 'core', 'vendors', 'id', vendorId, 'id,legal_name,accreditation_status,owner_module');
  check(vendor.legal_name === 'MWELL UAT Test Vendor', 'Only the existing synthetic vendor is permitted');
  const invites = await rows(client, 'legal', 'vendor_invites', 'auth_user_id', vendorActor.profile.id,
    'id,auth_user_id,vendor_id,status,link_generation,accepted_generation,case_id');
  const accepted = invites.filter(row => row.vendor_id === vendorId && row.status === 'accepted'
    && Number.isInteger(row.link_generation) && row.link_generation > 0 && row.accepted_generation === row.link_generation);
  check(accepted.length === 1, 'Exact accepted-invite generation binding required; do not create or reset invitations');
  const policy = await loadAuthoritativeVendorChecklist();
  // Existing exposed CI verifier, not an unexposed private-schema REST call.
  // An unapplied/older verifier fails before any fixture mutation.
  const verified = await rpc(client, 'core', 'verify_security_database_launch_blockers');
  const live = verified.vendor_fixture_checklist;
  check(Array.isArray(verified.missing_objects) && verified.missing_objects.length === 0
    && live?.version === 1 && live.function === 'private.legal_tailored_requirement_set'
    && live.functionBodySha256 === policy.functionBodySha256, 'Live checklist verifier/source body pin mismatch');
  const liveRows = live.rows;
  check(Array.isArray(liveRows) && liveRows.every(row => typeof row?.code === 'string')
    && isDeepStrictEqual([...liveRows].sort((a, b) => a.code.localeCompare(b.code)), policy.rows),
  'Live selected checklist does not match the exact reviewed manifest; no fixture writes');
  const liveReadback = { selectedRowsSha256: VENDOR_CHECKLIST_MANIFEST.rowsSha256, verifiedAt: new Date().toISOString(),
    function: 'private.legal_tailored_requirement_set', functionBodySha256: live.functionBodySha256,
    transport: 'core.verify_security_database_launch_blockers', liveDdlVerified: false };
  const id = vendorApplicationCaseId(scope);
  check((await rows(client, 'legal', 'accreditation_cases', 'id', id)).length === 0, 'Run case already exists; no reset or reuse');
  check((await rows(client, 'legal', 'requirement_checklist_items', 'case_id', id)).length === 0, 'Existing checklist cannot be reused');
  const caseRow = { id, vendor_id: vendorId, vendor_name: `${scope.runId}-${scope.viewport} SYNTHETIC Application`,
    contact_email: EMAIL, invited_by_email: LEGAL_EMAIL, invited_by_user_id: legalActor.profile.id,
    status: 'draft', entity_type: PROFILE.entityType, jurisdiction: PROFILE.jurisdiction, category: PROFILE.category,
    vendor_category: PROFILE.category, risk_tier: PROFILE.riskTier, contract_type: PROFILE.contractType,
    handles_personal_data: false, technology_service_provider: false,
    scope: `SYNTHETIC QA ONLY ${digest(scope)} ${randomUUID()}` };
  const checklist = policy.rows.map(row => ({ ...row, id: `${id}_${row.code}`, case_id: id, decision: 'pending' }));
  const intent = { version: 1, kind: 'synthetic-vendor-application-case', scope, case: caseRow, checklist,
    policy: { source: policy.source, sourceSha256: policy.sourceSha256, profile: policy.profile,
      manifest: checklistManifest, liveReadback },
    actor: vendorActor, legalActor, vendor, invite: accepted[0], createdAt: new Date().toISOString(), certificationCredit: false };
  await persistIntent(file, intent);
  await preservedBindings(client, intent);
  // A read-only probe verifies the actual cleanup transport and rejects a
  // namespace with an earlier committed receipt before creating anything.
  const probeText = JSON.stringify({ version: 1, intent, scopeText: JSON.stringify(scope),
    bucket: 'documents', storagePaths: [], snapshot: {} });
  const probe = await rpc(client, 'core', 'cleanup_uat_vendor_application', {
    payload: { mode: 'read', manifestText: probeText, sha256: hash(probeText) },
  });
  check(probe.receipt === null, 'Previously used fixture namespace cannot be recreated');
  // Intent is durable before either insert. Never retry an ambiguous insert;
  // the same intent supports exact case-only cleanup after a partial setup.
  for (const [table, payload] of [['accreditation_cases', caseRow], ['requirement_checklist_items', checklist]]) {
    const { error } = await client.schema('legal').from(table).insert(payload).abortSignal(AbortSignal.timeout(15000));
    check(!error, `Synthetic ${table} insert failed; retained intent requires cleanup`);
  }
  const saved = await one(client, 'legal', 'accreditation_cases', 'id', id);
  check(Object.entries(caseRow).every(([key, value]) => isDeepStrictEqual(saved[key], value)), 'Case fixture readback mismatch');
  const savedChecklist = await rows(client, 'legal', 'requirement_checklist_items', 'case_id', id);
  check(savedChecklist.length === checklist.length && checklist.every(item => savedChecklist.some(row =>
    Object.entries(item).every(([key, value]) => isDeepStrictEqual(row[key], value)))), 'Checklist fixture readback mismatch');
  const ownCase = await one(vendorClient, 'legal', 'accreditation_cases', 'id', id);
  const ownChecklist = await rows(vendorClient, 'legal', 'requirement_checklist_items', 'case_id', id);
  check(ownCase.vendor_id === vendorId && ownCase.scope === caseRow.scope
    && ownChecklist.length === checklist.length && checklist.every(item => ownChecklist.some(row =>
      Object.entries(item).every(([key, value]) => isDeepStrictEqual(row[key], value)))),
  'Ordinary vendor cannot read the exact owned case/checklist; no UI upload permitted');
  return intent;
}

async function loadIntent(file, scope) {
  const stat = await lstat(file);
  check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 65536, 'Invalid vendor case provenance file');
  const intent = JSON.parse(await readFile(file, 'utf8'));
  const policy = await loadAuthoritativeVendorChecklist();
  check(intent.version === 1 && intent.kind === 'synthetic-vendor-application-case' && isDeepStrictEqual(intent.scope, scope)
    && intent.case?.id === vendorApplicationCaseId(scope) && intent.certificationCredit === false,
  'Vendor case provenance scope mismatch');
  check(intent.policy?.sourceSha256 === policy.sourceSha256 && isDeepStrictEqual(intent.policy.profile, policy.profile), 'Checklist policy provenance mismatch');
  check(isDeepStrictEqual(intent.policy.manifest, VENDOR_CHECKLIST_MANIFEST)
    && intent.policy.liveReadback?.selectedRowsSha256 === VENDOR_CHECKLIST_MANIFEST.rowsSha256
    && intent.policy.liveReadback.function === 'private.legal_tailored_requirement_set'
    && intent.policy.liveReadback.functionBodySha256 === policy.functionBodySha256
    && intent.policy.liveReadback.transport === 'core.verify_security_database_launch_blockers'
    && intent.policy.liveReadback.liveDdlVerified === false && Number.isFinite(Date.parse(intent.policy.liveReadback.verifiedAt)),
  'Exact checklist manifest/live selected-row provenance required');
  check(intent.vendor?.legal_name === 'MWELL UAT Test Vendor' && UUID.test(intent.vendor?.id)
    && intent.actor?.profile?.id === intent.invite?.auth_user_id && intent.actor.profile.email === EMAIL
    && intent.actor.profile.vendor_id === intent.vendor.id && intent.case.vendor_id === intent.vendor.id
    && intent.invite.vendor_id === intent.vendor.id && intent.invite.status === 'accepted'
    && Number.isInteger(intent.invite.link_generation) && intent.invite.link_generation > 0
    && intent.invite.accepted_generation === intent.invite.link_generation
    && intent.case.invited_by_user_id === intent.legalActor?.profile?.id && intent.case.invited_by_email === LEGAL_EMAIL
    && /^SYNTHETIC QA ONLY [a-f0-9]{64} [a-f0-9-]{36}$/.test(intent.case.scope), 'Vendor case provenance identity mismatch');
  check(isDeepStrictEqual(intent.checklist, policy.rows.map(row => ({ ...row, id: `${intent.case.id}_${row.code}`, case_id: intent.case.id, decision: 'pending' }))), 'Checklist provenance altered');
  return intent;
}

const CLEANUP_TABLES = ['accreditation_docs', 'vendor_application_snapshots', 'case_timeline', 'requirement_checklist_items', 'accreditation_cases'];
const byId = list => [...list].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const validStorageName = name => /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}_SYNTHETIC-QA-[A-Z0-9_]+\.pdf$/.test(name);

async function listCaseStorage(client, intent) {
  const folder = `vendor/${intent.vendor.id}/legal/accreditation/${intent.case.id}`;
  const { data, error } = await client.storage.from('documents').list(folder, { limit: 100, offset: 0 });
  check(!error && Array.isArray(data) && data.length < 100 && data.every(row => row.id && validStorageName(row.name)),
    'Storage discovery unavailable or outside fixture scope');
  check(data.every(row => intent.checklist.some(item => !item.instrument && row.name.endsWith(`_SYNTHETIC-QA-${item.code}.pdf`))),
    'Unowned Storage requirement code');
  return data.map(row => `${folder}/${row.name}`).sort();
}

async function captureCleanupManifest(client, intent) {
  await preservedBindings(client, intent);
  const id = intent.case.id;
  const cases = await rows(client, 'legal', 'accreditation_cases', 'id', id);
  check(cases.length <= 1 && cases.every(row => Object.entries(intent.case).every(([key, value]) =>
    key === 'status' ? ['draft', 'submitted'].includes(row.status) : isDeepStrictEqual(row[key], value))),
  'Case binding changed or an independent review occurred; do not delete');
  // A newly linked invitation, decision or instrument is outside this fixture's
  // submission/handoff scope. Never cascade it or infer ownership from the case.
  for (const table of ['vendor_invites', 'accreditation_decision_reviews', 'accreditation_dispositions', 'signed_instruments', 'instrument_documents'])
    check((await rows(client, 'legal', table, 'case_id', id)).length === 0, `Foreign ${table} reference blocks case cleanup`);
  const checklist = await rows(client, 'legal', 'requirement_checklist_items', 'case_id', id);
  check(checklist.every(row => intent.checklist.some(item => Object.entries(item).every(([key, value]) => isDeepStrictEqual(row[key], value)))
    && !row.reviewer_id && !row.reviewer_email), 'Unowned or reviewed checklist blocks cleanup');
  const docs = await rows(client, 'legal', 'accreditation_docs', 'case_id', id);
  const folder = `vendor/${intent.vendor.id}/legal/accreditation/${id}`;
  check(docs.every(row => row.vendor_id === intent.vendor.id && row.uploaded_by_email === EMAIL
    && intent.checklist.some(item => item.id === row.requirement_id && !item.instrument)
    && typeof row.storage_path === 'string' && row.storage_path.startsWith(`${folder}/`)
    && validStorageName(row.storage_path.slice(folder.length + 1))), 'Foreign document binding blocks case cleanup');
  const snapshots = await rows(client, 'legal', 'vendor_application_snapshots', 'case_id', id);
  check(snapshots.every(row => row.created_by === intent.actor.profile.id), 'Foreign application author blocks cleanup');
  const timeline = await rows(client, 'legal', 'case_timeline', 'case_id', id);
  check(timeline.every(row => [EMAIL, LEGAL_EMAIL].includes(row.actor_email)), 'Foreign timeline actor blocks cleanup');
  const storagePaths = await listCaseStorage(client, intent);
  check(docs.every(row => storagePaths.includes(row.storage_path)), 'Document object missing before cleanup; preserve database evidence');
  return { version: 1, intent, scopeText: JSON.stringify(intent.scope), bucket: 'documents', storagePaths,
    snapshot: { accreditation_docs: byId(docs), vendor_application_snapshots: byId(snapshots), case_timeline: byId(timeline),
      requirement_checklist_items: byId(checklist), accreditation_cases: byId(cases) } };
}

export async function cleanupVendorApplicationCase({ client, scope, env = process.env, file }) {
  validateScope(scope, env);
  const intent = await loadIntent(file, scope);
  const archiveFile = `${file}.cleanup.json`;
  let archive, created = false;
  try {
    const stat = await lstat(archiveFile);
    check(stat.isFile() && !stat.isSymbolicLink() && stat.size < 4194304, 'Invalid cleanup manifest archive');
    archive = JSON.parse(await readFile(archiveFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const manifest = await captureCleanupManifest(client, intent);
    const manifestText = JSON.stringify(manifest);
    check(Buffer.byteLength(manifestText) < 2000000, 'Cleanup manifest exceeds bounded evidence size');
    archive = { manifest, manifestText, sha256: hash(manifestText) };
    check(Buffer.byteLength(JSON.stringify(archive)) < 4194304, 'Cleanup archive exceeds recoverable evidence size');
    await persistIntent(archiveFile, archive);
    created = true;
  }
  check(isDeepStrictEqual(archive.manifest?.intent, intent) && archive.manifestText === JSON.stringify(archive.manifest)
    && archive.sha256 === hash(archive.manifestText), 'Cleanup manifest binding/hash mismatch');
  const args = mode => ({ payload: { mode, manifestText: archive.manifestText, sha256: archive.sha256 } });
  let receipt = await rpc(client, 'core', 'cleanup_uat_vendor_application', args('read'));
  if (receipt.receipt === null) {
    // An archived invocation may have an unknown outcome. Never automatically
    // replay it, even if a later read has no receipt. Retain it for review.
    check(created, 'Prior cleanup has no committed receipt; stop for explicit recovery review, no replay');
    await rpc(client, 'core', 'cleanup_uat_vendor_application', args('execute'));
    receipt = await rpc(client, 'core', 'cleanup_uat_vendor_application', args('read'));
  }
  check(receipt.version === 1 && receipt.complete === true && receipt.caseId === intent.case.id
    && receipt.manifestSha256 === archive.sha256 && isDeepStrictEqual(receipt.scope, scope)
    && receipt.databaseRemaining === 0 && receipt.storageDeleted === false && receipt.certificationCredit === false,
  'Exact committed database cleanup receipt required before Storage deletion');
  const id = intent.case.id;
  for (const table of CLEANUP_TABLES)
    check((await rows(client, 'legal', table, table === 'accreditation_cases' ? 'id' : 'case_id', id)).length === 0,
      `${table} cleanup remaining rows`);
  await preservedBindings(client, intent);
  const paths = await listCaseStorage(client, intent);
  check(paths.every(value => archive.manifest.storagePaths.includes(value)), 'Unarchived Storage object; stop for recovery review');
  for (const storagePath of archive.manifest.storagePaths) {
    for (const table of ['accreditation_docs', 'instrument_documents'])
      check((await rows(client, 'legal', table, 'storage_path', storagePath)).length === 0, 'Foreign live Storage reference blocks removal');
  }
  if (paths.length) {
    const { error } = await client.storage.from('documents').remove(paths);
    check(!error, 'Case storage removal failed; retain durable manifest and committed receipt for recovery');
  }
  check((await listCaseStorage(client, intent)).length === 0, 'Case storage removal readback failed');
  await preservedBindings(client, intent);
  return { entity: 'legal.synthetic-vendor-application-case', caseId: id, complete: true, remaining: 0,
    storagePaths: archive.manifest.storagePaths, cleanupManifestSha256: archive.sha256, databaseReceipt: receipt,
    protectedVendorId: intent.vendor.id, protectedAccountId: intent.actor.profile.id,
    preservedInviteId: intent.invite.id, certificationCredit: false };
}

export async function verifyVendorApplicationSubmission({ client, intent, responseSnapshot }) {
  const savedCase = await one(client, 'legal', 'accreditation_cases', 'id', intent.case.id);
  check(savedCase.status === 'submitted' && savedCase.vendor_id === intent.vendor.id && savedCase.scope === intent.case.scope,
    'Submitted case readback mismatch');
  const snapshots = await rows(client, 'legal', 'vendor_application_snapshots', 'case_id', intent.case.id);
  const submitted = snapshots.filter(row => row.status === 'submitted');
  check(submitted.length === 1 && snapshots.every(row => Number.isInteger(row.version) && row.version <= responseSnapshot?.version),
    'Current submitted application missing, duplicate or stale');
  const snapshot = submitted[0];
  check(snapshot.id === responseSnapshot?.id && snapshot.version === responseSnapshot.version
    && Number.isInteger(snapshot.version) && snapshot.version > 0 && snapshot.vendor_id === intent.vendor.id
    && snapshot.created_by === intent.actor.profile.id && snapshot.document_hash === responseSnapshot.document_hash
    && /^[a-f0-9]{64}$/.test(snapshot.document_hash) && snapshot.policy_id === 'vendor-accreditation' && snapshot.policy_version === '2025'
    && snapshot.signature?.method === 'typed' && snapshot.signature?.signerName === 'SYNTHETIC QA Signatory'
    && snapshot.signature?.dataUrl?.startsWith('data:image/png;base64,') && Number.isFinite(Date.parse(snapshot.signed_at))
    && Number.isFinite(Date.parse(snapshot.submitted_at)), 'Signed application version/author/hash readback mismatch');
  const docs = await rows(client, 'legal', 'accreditation_docs', 'case_id', intent.case.id);
  const folder = `vendor/${intent.vendor.id}/legal/accreditation/${intent.case.id}/`;
  for (const item of intent.checklist.filter(row => !row.instrument)) {
    const current = docs.filter(row => row.requirement_id === item.id && row.status === 'submitted');
    check(current.length === 1 && current[0].vendor_id === intent.vendor.id && current[0].uploaded_by_email === EMAIL
      && current[0].mime_type === 'application/pdf' && Number(current[0].size_bytes) > 0
      && Number.isInteger(current[0].version) && current[0].version > 0
      && current[0].storage_path?.startsWith(folder) && current[0].storage_path.endsWith(`_SYNTHETIC-QA-${item.code}.pdf`),
    'Current synthetic document readback missing or foreign');
  }
  return { matched: 1, caseId: intent.case.id, vendorId: intent.vendor.id, actorId: snapshot.created_by,
    snapshotId: snapshot.id, version: snapshot.version, documentHash: snapshot.document_hash,
    documentCount: intent.checklist.filter(row => !row.instrument).length,
    pendingScope: ['Legal instrument signing', 'Legal review/approval decision', 'SMTP delivery'], certificationCredit: false };
}

export async function runVendorApplicationUi({ page, client, intent, captureState, origin }) {
  check(origin === 'https://mwell-intra-uat.vercel.app', 'Vendor application UI is restricted to fixed UAT origin');
  const verifiedActor = await verifyVendorApplicationActor(client);
  check(verifiedActor.profile.id === intent.actor.profile.id && await rpc(client, 'core', 'current_vendor_id') === intent.vendor.id,
    'Vendor session changed before UI submission');
  const casePath = `${origin}/vendor/cases/${encodeURIComponent(intent.case.id)}`;
  await page.goto(casePath, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.getByRole('heading', { name: intent.case.vendor_name, exact: true, level: 1 }).waitFor({ timeout: 15000 });
  const inputs = [];
  for (const item of intent.checklist.filter(row => !row.instrument)) {
    await page.getByRole('button', { name: `${item.requirement} \u2014 upload document`, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    const buffer = evidencePdf('SYNTHETIC QA ONLY', item.code, intent.case.id);
    const filename = `SYNTHETIC-QA-${item.code}.pdf`;
    await dialog.locator('input[type="file"]').setInputFiles({ name: filename, mimeType: 'application/pdf', buffer });
    await dialog.getByRole('button', { name: 'Upload document', exact: true }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 20000 });
    const saved = await rows(client, 'legal', 'accreditation_docs', 'case_id', intent.case.id);
    const owned = saved.filter(row => row.requirement_id === item.id && row.status === 'submitted');
    check(owned.length === 1 && owned[0].vendor_id === intent.vendor.id && owned[0].uploaded_by_email === EMAIL
      && Number(owned[0].size_bytes) === buffer.length && owned[0].filename === filename
      && owned[0].storage_path?.startsWith(`vendor/${intent.vendor.id}/legal/accreditation/${intent.case.id}/`),
    'Uploaded synthetic PDF readback mismatch');
    inputs.push({ requirementId: item.id, documentId: owned[0].id, storagePath: owned[0].storage_path,
      inputSha256: hash(buffer), bytes: buffer.length });
  }
  await captureState('synthetic documents persisted');
  await page.getByRole('link', { name: 'Complete accreditation form', exact: true }).click();
  await page.waitForURL(`${casePath}/application`, { timeout: 15000 });
  const submit = page.getByRole('button', { name: 'Sign and submit', exact: true });
  check(await submit.isDisabled(), 'Blank application validation guard missing');
  const field = label => page.locator('label').filter({ has: page.locator('span').filter({ hasText: label }) }).locator('input, textarea');
  for (const [label, value] of [
    ['Company trade name', 'SYNTHETIC QA Vendor'], ['Company contact number', '09000000000'],
    ['Business address', 'SYNTHETIC QA ONLY - no physical business address'], ['Date of incorporation', '2025-01-01'],
    ['Place of incorporation', 'SYNTHETIC QA'], ['TIN', '000-000-000-000'], ['Company email', EMAIL],
    ['Website', 'https://example.invalid'], ['Fax number', '000000000'], ['CEO / President / Owner / Partner', 'SYNTHETIC QA Owner'],
    ['Principal email', EMAIL], ['Principal contact number', '09000000000'], ['General correspondence contact', 'SYNTHETIC QA Contact'],
    ['Correspondence email', EMAIL], ['Correspondence contact number', '09000000000'], ['Products or services', 'SYNTHETIC QA GOODS ONLY'],
  ]) await field(label).fill(value);
  for (const label of ['Manpower count and expertise', 'Qualifications or certifications', 'Completed projects'])
    await page.getByRole('textbox', { name: new RegExp(`^${label}`) }).fill('SYNTHETIC QA ONLY - simulated experience, not a real credential');
  await page.getByRole('checkbox', { name: /^I certify that the information/ }).check();
  await page.getByRole('radio', { name: 'No', exact: true }).check();
  await page.getByRole('checkbox', { name: /^I authorize MPHTC/ }).check();
  await page.getByRole('textbox', { name: 'Authorized signatory', exact: true }).fill('SYNTHETIC QA Signatory');
  await page.getByRole('textbox', { name: 'Designation', exact: true }).fill('SYNTHETIC QA ONLY');
  await page.getByRole('tab', { name: 'Type', exact: true }).click();
  await page.getByPlaceholder('e.g. Marta Ramos', { exact: true }).fill('SYNTHETIC QA Signatory');
  await page.getByText('Saved securely', { exact: true }).waitFor({ timeout: 20000 });
  await captureState('synthetic signed application before submit');
  await verifyVendorApplicationActor(client);
  const [response] = await Promise.all([page.waitForResponse(response => {
    if (new URL(response.url()).pathname !== '/rest/v1/rpc/submit_vendor_application') return false;
    try { return response.request().postDataJSON()?.payload?.case_id === intent.case.id; } catch { return false; }
  }, { timeout: 20000 }), submit.click()]);
  check(response.ok(), 'Ordinary UI application submission rejected');
  const saved = await response.json();
  const checkpoint = await verifyVendorApplicationSubmission({ client, intent, responseSnapshot: saved.snapshot });
  const submittedPayload = response.request().postDataJSON()?.payload;
  check(submittedPayload?.case_id === intent.case.id && typeof submittedPayload.idempotency_key === 'string'
    && submittedPayload.idempotency_key.length >= 12 && submittedPayload.expected_version === checkpoint.version - 1,
  'Exact UI submission command is required for the governed replay probe');
  const beforeReplay = await rows(client, 'legal', 'vendor_application_snapshots', 'case_id', intent.case.id);
  await verifyVendorApplicationActor(client);
  const replay = await rpc(client, 'legal', 'submit_vendor_application', { payload: submittedPayload });
  check(replay.replayed === true && replay.snapshot?.id === checkpoint.snapshotId && replay.snapshot.version === checkpoint.version
    && replay.snapshot.document_hash === checkpoint.documentHash, 'Exact UI command replay was not idempotent');
  const afterReplay = await rows(client, 'legal', 'vendor_application_snapshots', 'case_id', intent.case.id);
  const byId = list => [...list].sort((a, b) => a.id.localeCompare(b.id));
  check(isDeepStrictEqual(byId(beforeReplay), byId(afterReplay)), 'Replay changed persisted application evidence');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.getByRole('heading', { name: intent.case.vendor_name, exact: true, level: 1 }).waitFor({ timeout: 15000 });
  await page.getByText('Submitted', { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 });
  check(await page.getByRole('button', { name: 'Sign and submit', exact: true }).count() === 0, 'Submitted application remains editable');
  const reloaded = await verifyVendorApplicationSubmission({ client, intent, responseSnapshot: saved.snapshot });
  check(isDeepStrictEqual(checkpoint, reloaded), 'Submitted application changed after reload');
  await captureState('submitted current version readback');
  return { ok: true, applicationCheckpoint: checkpoint, responseSnapshot: { id: saved.snapshot.id, version: saved.snapshot.version,
    document_hash: saved.snapshot.document_hash }, inputs, validationGuard: true,
    replayCheckpoint: { replayed: true, snapshotId: checkpoint.snapshotId, version: checkpoint.version, unchanged: true,
      commandKeySha256: hash(submittedPayload.idempotency_key) }, certificationCredit: false };
}

export async function runLegalApplicationHandoffUi({ page, client, intent, submission, captureState, origin }) {
  check(origin === 'https://mwell-intra-uat.vercel.app' && submission?.ok === true, 'Verified application submission required before Legal handoff');
  const reader = await verifyVendorApplicationActor(client, true);
  check(reader.profile.id === intent.legalActor.profile.id, 'Legal handoff actor mismatch');
  await page.goto(`${origin}/legal/cases/${encodeURIComponent(intent.case.id)}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.getByRole('heading', { name: intent.case.vendor_name, exact: true, level: 1 }).waitFor({ timeout: 15000 });
  await page.getByRole('link', { name: 'Review accreditation form', exact: true }).click();
  await page.waitForURL(`**/legal/cases/${intent.case.id}/application`, { timeout: 15000 });
  await page.getByText('Submitted', { exact: true }).first().waitFor({ state: 'visible', timeout: 15000 });
  const checkpoint = await verifyVendorApplicationSubmission({ client, intent, responseSnapshot: submission.responseSnapshot });
  await page.getByRole('textbox', { name: 'Authorized signatory', exact: true }).waitFor({ state: 'visible', timeout: 15000 });
  check(await page.getByRole('textbox', { name: 'Authorized signatory', exact: true }).inputValue() === 'SYNTHETIC QA Signatory', 'Legal UI signed application not hydrated');
  await captureState('legal reads exact submitted synthetic application');
  return { ok: true, handoffCheckpoint: { ...checkpoint, readerId: reader.profile.id }, certificationCredit: false };
}
