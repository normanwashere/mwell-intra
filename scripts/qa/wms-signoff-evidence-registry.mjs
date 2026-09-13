import assert from 'node:assert/strict';
import { WMS_CHECKPOINTS } from './wms-signoff-contract.mjs';

const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const inbound = 'scripts/qa/wms-inbound-signoff-live.mjs';
const ecommerce = 'scripts/qa/wms-ecommerce-signoff-live.mjs';
const department = 'scripts/qa/wms-department-signoff-live.mjs';
const returns = 'scripts/qa/wms-returns-signoff-live.mjs';

// These are reviewed source leads, NOT aliases for passed contract checks.
const coverage = {
  'receiving.receive': [inbound, 'Accepted bulk receipt only; exception and complete contract evidence adapters missing.'],
  'receiving.exceptions': [inbound, 'Short/over/damaged/duplicate exception matrix missing.'],
  'receiving.inspect': [inbound, 'Accepted bulk QC only; rejected/quarantine and exact lot/serial branches missing.'],
  'receiving.putaway': [inbound, 'Accepted bulk putaway and held-transfer denial; full lot/serial ledger proof missing.'],
  'ecommerce.request': [ecommerce, 'UI intake/allocation exists; full ATP assertion adapter missing.'],
  'ecommerce.pick': [ecommerce, 'UI scanned pick/wrong-bin denial exists; held-stock branch missing.'],
  'ecommerce.pack': [ecommerce, 'UI courier/waybill packing exists; full pack/audit assertion adapter missing.'],
  'ecommerce.release': [ecommerce, 'Independent release and reconciliation exist; denial readbacks need dedicated adapter.'],
  'ecommerce.receipt': [ecommerce, 'Receipt material adapter implemented; trusted collection integration and injected-failure cleanup adapter missing.'],
  'ecommerce.exceptions': [ecommerce, 'Tracking replay/conflict/failed-delivery exists; partial/short/cancel matrix missing.'],
  'department.request': [department, 'Request/approval uses API; full authorization/ATP adapter missing.'],
  'department.pick': [department, 'UI scanned pick exists; held-stock branch missing.'],
  'department.pack': [department, 'UI handover packing exists; full audit/evidence adapter missing.'],
  'department.release': [department, 'Independent release exists; full invariant adapter missing.'],
  'department.receipt': [department, 'Requester acknowledgment exists; equivalent durable private Storage byte proof missing.'],
  'department.exceptions': [department, 'Partial/short/cancel/retry and handover recovery matrix missing.'],
  'replacement.request': [returns, 'Replacement-linked demand exists; complete ATP adapter missing.'],
  'replacement.pick': [returns, 'Replacement pick exists; held-stock branch missing.'],
  'replacement.pack': [returns, 'Replacement pack exists; complete invariant adapter missing.'],
  'replacement.release': [returns, 'Independent replacement release exists; complete invariant adapter missing.'],
  'replacement.receipt': [returns, 'Actual shipment POD exists; replacement-specific provenance/cleanup adapter missing.'],
  'replacement.exceptions': [returns, 'Full partial/short/cancel/retry/recovery matrix missing.'],
  'returns.intake': [returns, 'Linked nonserialized physical intake with provisional hold and held-transfer denial is implemented in source; serialized identity coverage and full evidence adapter missing. No live outcome credited.'],
  'returns.disposition': [returns, 'Hold inspection, independent release as accepted and relocation are implemented in source; direct-accepted, nonaccepted disposition and serialized matrix plus full evidence adapter missing. No live outcome credited.'],
  'returns.case-resolution': [returns, 'Replacement only; refund/vendor_return/re_kit/write_off coverage missing.'],
  'returns.closure': [returns, 'Customer closure exists; shared POD reference and branch-aware cleanup adapter missing.'],
  'inventory.reconcile': [ecommerce, 'Isolated bulk inventory only; lot/serial/export/audit parity missing.'],
  'inventory.count-adjust-transfer': [null, 'Count, independent adjustment approval and transfer matrix missing.'],
  'inventory.master-data': [null, 'Governed import/duplicate/routing/pricing live matrix missing.'],
  'roles.single.warehouse_operator': [null, 'Single isolated warehouse_operator assignment proof missing.'],
  'roles.single.warehouse_supervisor': [null, 'Single isolated warehouse_supervisor assignment proof missing.'],
  'roles.single.logistics_supervisor': [null, 'Single isolated logistics_supervisor assignment proof missing.'],
  'roles.single.operations': [null, 'Single isolated operations assignment proof missing.'],
  'roles.single.finance': [null, 'Single isolated finance assignment proof missing.'],
  'roles.single.bi_analyst': [null, 'Single isolated bi_analyst assignment proof missing.'],
  'roles.single.business_unit': [null, 'Single isolated business_unit assignment proof missing.'],
  'roles.single.marketing': [null, 'Single isolated marketing assignment proof missing.'],
  'roles.single.procurement': [null, 'Single isolated procurement assignment proof missing.'],
  'roles.single.pricing': [null, 'Single isolated pricing assignment proof missing.'],
  'roles.single.warehouse_admin': [null, 'Single isolated warehouse_admin assignment proof missing.'],
  'roles.multi': [null, 'Multi-role guard, session refresh and cross-boundary matrix missing.'],
  'roles.no-warehouse-access': [null, 'Complete anonymous/non-WMS no-leak/no-write adapter missing.'],
  'concurrency.races': [null, 'Owned reservation/hold/release/receipt/return/count race runner missing.'],
  'recovery.failures': [null, 'Complete fault/timeout/session recovery matrix missing; historical continuations are not fresh runs.'],
  'recovery.cleanup': [null, 'Injected-failure cleanup and unrelated-data invariance runner missing.'],
};
assert.deepEqual(Object.keys(coverage).sort(), WMS_CHECKPOINTS.map(c => c.id).sort(), 'Registry must track the entire contract');

export const WMS_EVIDENCE_REGISTRY = freeze(WMS_CHECKPOINTS.map(c => ({
  checkpoint: c.id, checks: [...c.checks], views: [...c.views], operation: c.operation ?? null,
  sourceRunner: coverage[c.id][0], sourceCoverage: coverage[c.id][0] ? 'partial' : 'missing',
  artifactAdapter: c.id === 'ecommerce.receipt' ? 'ecommerce-receipt-v1' : null,
  contractReady: false,
  blockers: [coverage[c.id][1], 'No approved full-contract collector and verified injected-failure cleanup binding.'],
})));

export const EVIDENCE_SOURCE_FILES = freeze([
  ecommerce, 'scripts/qa/wms-ecommerce-cleanup.mjs', 'scripts/qa/wms-signoff-contract.mjs',
  'scripts/qa/wms-signoff-evidence-registry.mjs', 'scripts/qa/wms-signoff-evidence.mjs',
]);

export const WMS_EVIDENCE_LIMITS = freeze([
  'Offline integrity and selected business-invariant verification only; no network, SQL execution or fixture cleanup.',
  'Saved observation and source hashes must be selected independently by the coordinator, never trusted from submitted evidence.',
  'Hashes prove byte identity, not live execution or author honesty. No signing service or new credential is required.',
  'Existing reports need saved complete-query/actual-role records and independent visual/cleanup reviews; absent records fail closed. Never relabel historical artifacts.',
  'Only fresh complete ecommerce shipment receipt material has an adapter. Other checkpoints and injected-failure cleanup remain unsupported.',
  'No contract evidence is emitted yet. Hardware/pilot gates remain separate and pending; parent review is required before CI integration.',
  'Use an immutable local evidence root during verification. Concurrent privileged filesystem replacement is outside this offline trust boundary.',
]);

export const WMS_EVIDENCE_FORMAT = freeze({
  commands: ['node scripts/qa/wms-signoff-evidence.mjs registry',
    'node scripts/qa/wms-signoff-evidence.mjs verify EVIDENCE_ROOT INDEX_REF COORDINATOR_TRUST_FILE TRUST_SHA256'],
  exitPolicy: 'registry is informational. verify exits 1 while ANY full-contract slot is unsupported/missing, even if artifact material verifies.',
  descriptor: { ref: 'relative/path/inside/evidence-root', sha256: '64 lowercase hex characters', byteLength: 'positive actual file length' },
  coordinatorTrust: {
    version: 1, kind: 'wms-evidence-trust', scope: { runId: 'full UUID', buildId: '40-character deployed SHA', environment: 'uat' },
    origin: 'https://mwell-intra-uat.vercel.app', project: 'kkoitlvydytdhlpxhuah', notBefore: 'UTC start', notAfter: 'UTC end',
    records: { capture: ['independently selected capture-record SHA256'], review: ['independent visual-review record SHA256'], cleanup: ['independent cleanup-observation record SHA256'] },
    sourceHashes: 'Exact map for EVIDENCE_SOURCE_FILES, reviewed separately from submitted artifacts. No private key or credential.',
  },
  index: { version: 1, kind: 'wms-signoff-evidence-index', scope: 'exact coordinator scope', humanGates: [],
    entries: [{ checkpoint: 'ecommerce.receipt', view: 'desktop1440 or mobile390', capture: 'descriptor', visualReview: 'descriptor', cleanup: 'descriptor' }] },
  capture: 'wms-ecommerce-receipt-capture: scope/project/origin/observedAt, sources map, original manifest/report, exhaustive reportFiles map, command, actual authority records, two complete-query observations, screenshots, both fixtures, two saved authorized downloads. All file values are descriptors.',
  review: 'wms-visual-review: exact captureSha256 and scope, reviewer/observedAt, each exact screenshot descriptor with actorId, outcome and actual review notes.',
  cleanup: 'wms-cleanup-observation: exact captureSha256/scope, original receipt/isolation, Storage API and subsequent DB artifacts, generator-exact postcleanup SQL, complete count result, separate execution record with exit/errors/warnings and SQL/result hashes, and both byte-matching archives.',
  examples: 'wms-signoff-evidence.test.mjs packet() is an executable synthetic format example, NOT a live attestation or a template to fill with assumed observations.',
  missingSources: 'Existing reports alone are insufficient where actual-role, complete-read, saved-download, visual review or independent cleanup records are absent. Report the gap; do not manufacture supplemental proof.',
});
