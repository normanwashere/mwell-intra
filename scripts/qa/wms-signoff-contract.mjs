import { isDeepStrictEqual } from 'node:util';

const views = Object.freeze(['desktop1440', 'mobile390']);
const warehouseRoles = Object.freeze([
  'warehouse_operator', 'warehouse_supervisor', 'logistics_supervisor', 'operations',
  'finance', 'bi_analyst', 'business_unit', 'marketing', 'procurement', 'pricing', 'warehouse_admin',
]);

function checkpoint(id, checks, options = {}) {
  return Object.freeze({
    id, views, ...options, checks: Object.freeze(checks),
    ...(options.roles ? { roles: Object.freeze(options.roles) } : {}),
  });
}

// Each named check is an invariant the live runner must evaluate against a fresh
// persisted read, not a DOM assertion, RPC response or workflow-name alias.
export const WMS_CHECKPOINTS = Object.freeze([
  checkpoint('receiving.receive', ['po-line-identity-and-quantities', 'receipt-audit-actor', 'pending-stock-not-available'], { journey: 'inbound' }),
  checkpoint('receiving.exceptions', ['short-over-damaged-duplicate-receipts', 'exception-evidence-and-resolution', 'stock-ledger-reconciled']),
  checkpoint('receiving.inspect', ['accepted-rejected-quarantined-quantities', 'exact-lot-serial-holds', 'inspection-audit-and-evidence'], { journey: 'inbound' }),
  checkpoint('receiving.putaway', ['accepted-stock-location', 'held-stock-not-pickable', 'serial-lot-quantity-ledger-reconciled'], { journey: 'inbound' }),
  ...['ecommerce', 'department', 'replacement'].flatMap(flow => [
    checkpoint(`${flow}.request`, ['source-request-linked', flow === 'department' ? 'authorized-approval-and-reservation' : 'authorized-demand-and-reservation', 'available-to-promise-reconciled'], { journey: flow === 'replacement' ? 'returns' : flow }),
    checkpoint(`${flow}.pick`, ['exact-source-and-quantity-picked', 'held-stock-blocked', 'picker-audit'], { journey: flow === 'replacement' ? 'returns' : flow }),
    checkpoint(`${flow}.pack`, ['all-lines-packed', 'handover-or-courier-evidence', 'packer-audit'], { journey: flow === 'replacement' ? 'returns' : flow }),
    checkpoint(`${flow}.release`, ['packer-release-denied', 'independent-from-packer-release-persisted', 'single-stock-issue-and-audit'], { journey: flow === 'replacement' ? 'returns' : flow }),
    checkpoint(`${flow}.receipt`, flow === 'department'
      ? ['requester-or-authorized-non-releaser-acknowledgment', 'handover-only-shipments-require-tracking', 'acknowledgment-reference-evidence-and-actor', 'release-not-treated-as-receipt']
      : ['authorized-shipment-tracking-actor', 'delivered-completed-status-and-proof-of-delivery', 'release-not-treated-as-delivery'],
    { journey: flow === 'replacement' ? 'returns' : flow,
      operation: Object.freeze(flow === 'department'
        ? { rpc: 'warehouse.advance_fulfillment_order', action: 'acknowledge_receipt' }
        : { rpc: 'warehouse.update_shipment_tracking', action: 'confirm_delivery' }) }),
    checkpoint(`${flow}.exceptions`, ['partial-short-cancel-and-retry', 'duplicate-submission-idempotent', 'failed-delivery-or-handover-recovery', 'stock-ledger-reconciled']),
  ]),
  checkpoint('returns.intake', ['return-source-quantity-serial-and-optional-allocation-identity', 'quarantine-first-pending-inspection', 'pending-holds-block-availability'], { journey: 'physical-return' }),
  checkpoint('returns.disposition', ['authorized-return-quality-inspection', 'accepted-damaged-hold-vendor_return-unavailable', 'accepted-releases-provisional-hold-nonaccepted-remains-held', 'holds-and-ledger-reconciled'], { journey: 'physical-return' }),
  checkpoint('returns.case-resolution', ['replacement-refund-vendor_return-re_kit-write_off', 'resolution-authority-quarantine-bin-and-branch-evidence', 'replacement-order-and-confirmed-destination', 'case-resolution-not-physical-restock'], { journey: 'returns' }),
  checkpoint('returns.closure', ['resolved-case-and-customer-service-ownership', 'customer-resolution-reference-and-closure-evidence', 'customer-closure-not-physical-restock'], { journey: 'returns' }),
  checkpoint('inventory.reconcile', ['on-hand-reserved-held-available', 'serial-lot-location-traceability', 'ledger-export-audit-parity']),
  checkpoint('inventory.count-adjust-transfer', ['cycle-count-and-independent-approval', 'adjustment-and-transfer-ledger', 'unauthorized-adjustments-denied']),
  checkpoint('inventory.master-data', ['authorized-import-and-validation', 'duplicate-import-recovery', 'location-product-routing-and-pricing-boundaries']),
  checkpoint('replenishment.recommend', ['effective-recommendation-authority-without-procurement-view-grant', 'saved-product-quantity-rationale-and-actor', 'accepted-and-handed-off-snapshots-not-overwritten', 'read-failure-and-revoked-permission-denied'],
    { journey: 'replenishment', operation: Object.freeze({ rpc: 'procurement.manage_replenishment_recommendation', action: 'recommend' }) }),
  checkpoint('replenishment.accept', ['procurement-management-authority-required', 'recommendation-to-accepted-transition-and-audit', 'unauthorized-and-invalid-state-decisions-denied', 'dismissal-branch-on-separate-fixture'],
    { journey: 'replenishment', operation: Object.freeze({ rpc: 'procurement.manage_replenishment_recommendation', action: 'accept' }) }),
  checkpoint('replenishment.handoff', ['procurement-management-authority-required', 'linked-draft-request-quantity-rationale-and-actor', 'duplicate-handoff-does-not-create-second-request', 'no-stock-movement-or-purchase-order-implied'],
    { journey: 'replenishment', operation: Object.freeze({ rpc: 'procurement.manage_replenishment_recommendation', action: 'handoff' }) }),
  ...warehouseRoles.map(role => checkpoint(`roles.single.${role}`,
    ['allowed-capabilities-and-persisted-grants', 'forbidden-direct-api-mutations-denied', 'cross-department-and-record-isolation'],
    { roles: [role], isolatedRole: true })),
  checkpoint('roles.multi', ['combined-grants-readback', 'no-packer-release-or-existing-self-approval-guard-bypass', 'module-and-department-boundaries', 'role-switch-session-refresh'],
    { roles: ['warehouse_operator', 'warehouse_supervisor'] }),
  checkpoint('roles.no-warehouse-access', ['unauthenticated-api-denied', 'non-wms-role-denied', 'no-data-leak-or-mutation']),
  checkpoint('concurrency.races', ['parallel-reservation-no-oversell', 'hold-versus-pick-release-serialized', 'duplicate-release-receipt-return-idempotent', 'count-versus-stock-mutation-reconciled'],
    { views: Object.freeze(['service']) }),
  checkpoint('recovery.failures', ['read-failure-not-empty-success', 'write-timeout-requery-before-retry', 'session-expiry-reentry', 'reload-resumes-persisted-work', 'no-duplicate-stock-or-audit']),
  checkpoint('recovery.cleanup', ['injected-mid-journey-failure', 'finally-cleanup-executed', 'run-owned-records-and-stock-reconciled', 'unrelated-records-unchanged'],
    { views: Object.freeze(['service']) }),
]);

export const WMS_HUMAN_GATES = Object.freeze([
  Object.freeze({ id: 'hardware', checks: Object.freeze([
    'physical-scanners-and-camera', 'floor-network-loss-recovery',
    'real-device-touch-and-accessibility', 'physical-stock-custody-reconciliation',
  ]), conditionalChecks: Object.freeze(['label-printers-and-rescan']) }),
  Object.freeze({ id: 'pilot', checks: Object.freeze([
    'named-real-users-all-wms-roles', 'receiving-through-putaway', 'both-fulfillment-channels',
    'packer-independent-release-and-channel-specific-completion', 'returns-disposition-replacement', 'multi-role-and-denial-cases',
    'exceptions-concurrency-recovery', 'training-support-and-rollback', 'defects-closed-and-owner-approval',
  ]) }),
]);

/** Fresh checkpoint/view manifest. No legacy workflow names count as aliases. */
export function requiredWmsEvidence() {
  return WMS_CHECKPOINTS.flatMap(item => item.views.map(view => ({ checkpoint: item.id, view })));
}

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const strings = value => Array.isArray(value) && value.length > 0 && value.every(nonempty)
  && new Set(value).size === value.length;
const sameScope = (actual, expected) => ['runId', 'buildId', 'environment', 'view']
  .every(key => nonempty(expected[key]) && actual?.[key] === expected[key]);
const keyOf = row => `${row?.checkpoint}:${row?.view}`;

/**
 * Pure evidence-manifest validation; does not execute flows or verify artifact bytes.
 * See the signoff plan for the JSON shape and the runner's trust obligations.
 * Scope must be independently supplied by the release coordinator, not inferred
 * from the submitted evidence. Missing, failed or ambiguous data never earns credit.
 */
export function evaluateWmsSignoff(input = {}) {
  const { scope, evidence, humanGates = [] } = input ?? {};
  const failures = [];
  const humanFailures = [];
  const requirements = requiredWmsEvidence();
  const requiredKeys = new Set(requirements.map(keyOf));
  const byKey = new Map();
  const validKeys = new Set();
  if (!['runId', 'buildId', 'environment'].every(key => nonempty(scope?.[key]))) {
    failures.push('scope: explicit runId, buildId and environment required');
  }
  if (!Array.isArray(evidence)) failures.push('evidence: array required');
  for (const row of Array.isArray(evidence) ? evidence : []) {
    const key = keyOf(row);
    if (!requiredKeys.has(key)) {
      failures.push(`${key}: unknown checkpoint/view; legacy workflows earn no credit`);
      continue;
    }
    if (byKey.has(key)) {
      failures.push(`${key}: duplicate evidence`);
      validKeys.delete(key);
      // Retain duplicates so neither the first nor the last row earns credit.
      byKey.get(key).push(row);
    } else byKey.set(key, [row]);
  }
  for (const requirement of requirements) {
    const key = keyOf(requirement);
    const rows = byKey.get(key);
    if (!rows) { failures.push(`${key}: missing evidence`); continue; }
    if (rows.length !== 1) continue;
    const row = rows[0];
    const item = WMS_CHECKPOINTS.find(candidate => candidate.id === row.checkpoint);
    const expectedScope = { ...scope, view: requirement.view };
    const start = failures.length;
    const require = (condition, message) => { if (!condition) failures.push(`${key}: ${message}`); };
    require(row.status === 'passed' && row.kind === 'live', 'passed live checkpoint required; surface-only evidence rejected');
    if (item.operation) require(isDeepStrictEqual(row.operation, item.operation), 'channel-specific completion RPC/action required');
    require(sameScope(row.scope, expectedScope), 'incorrect evidence scope');
    require(nonempty(row.journeyId) && nonempty(row.actionRef), 'journeyId and actionRef required');
    require(nonempty(row.actor?.id) && strings(row.actor?.roles), 'actor identity and distinct role assignments required');
    if (item.roles) {
      require(Array.isArray(row.actor?.roles) && item.roles.every(role => row.actor.roles.includes(role)), 'required WMS actor roles missing');
      if (item.isolatedRole) require(isDeepStrictEqual(row.actor?.roles, item.roles), 'single-role evidence must isolate its WMS grant');
    }
    const readback = row.readback;
    require(sameScope(readback?.scope, expectedScope), 'incorrect readback scope');
    require(readback?.source === 'persisted-requery' && nonempty(readback?.ref), 'fresh persisted readback required');
    require(strings(readback?.entityIds) && nonempty(readback?.actorId)
      && readback.actorId === row.actor?.id, 'persisted entity identities and authenticated actor required');
    const assertions = Array.isArray(readback?.assertions) ? readback.assertions : [];
    require(assertions.length === item.checks.length
      && new Set(assertions.map(assertion => assertion?.check)).size === item.checks.length
      && item.checks.every(check => assertions.some(assertion => assertion?.check === check
        && assertion.expected === true && assertion.actual === true)),
    'all named persisted invariants must explicitly expect and observe true exactly once');
    if (requirement.view !== 'service') {
      const screenshot = row.screenshot;
      require(sameScope(screenshot?.scope, expectedScope), 'incorrect screenshot scope');
      require(nonempty(screenshot?.ref) && screenshot?.reviewed === true
        && screenshot.width === (requirement.view === 'desktop1440' ? 1440 : 390)
        && Number.isInteger(screenshot.height) && screenshot.height > 0,
      'reviewed UI screenshot with required viewport dimensions required');
    }
    const cleanup = row.cleanup;
    require(sameScope(cleanup?.scope, expectedScope), 'incorrect cleanup scope');
    require(cleanup?.status === 'verified' && nonempty(cleanup?.ref) && nonempty(cleanup?.failurePath)
      && Array.isArray(cleanup?.residualEntityIds) && cleanup.residualEntityIds.length === 0,
    'verified failure cleanup with no residual run-owned fixtures required');
    if (failures.length === start) validKeys.add(key);
  }

  // Link steps per viewport; screenshots from unrelated orders cannot form a chain.
  for (const view of views) {
    for (const journey of ['inbound', 'ecommerce', 'department', 'returns', 'physical-return', 'replenishment']) {
      const keys = WMS_CHECKPOINTS.filter(item => item.journey === journey).map(item => `${item.id}:${view}`);
      const ids = keys.map(key => byKey.get(key)?.[0]?.journeyId);
      if (ids.some(id => !nonempty(id)) || new Set(ids).size !== 1) {
        failures.push(`${journey}:${view}: continuous journey identity required`);
        keys.forEach(key => validKeys.delete(key));
      }
    }
    for (const flow of ['ecommerce', 'department', 'replacement']) {
      const releaseKey = `${flow}.release:${view}`;
      const release = byKey.get(releaseKey)?.[0];
      const packerId = byKey.get(`${flow}.pack:${view}`)?.[0]?.actor?.id;
      if (!nonempty(release?.actor?.id) || !nonempty(packerId) || packerId === release.actor.id) {
        failures.push(`${releaseKey}: release actor must be independent of packer`);
        validKeys.delete(releaseKey);
      }
      if (flow === 'department') {
        const receiptKey = `${flow}.receipt:${view}`;
        const receiptActorId = byKey.get(receiptKey)?.[0]?.actor?.id;
        if (!nonempty(receiptActorId) || receiptActorId === release?.actor?.id) {
          failures.push(`${receiptKey}: acknowledgment actor must differ from releaser`);
          validKeys.delete(receiptKey);
        }
      }
    }
  }

  const pendingHumanGates = [];
  if (!Array.isArray(humanGates)) humanFailures.push('humanGates: array required');
  const humans = Array.isArray(humanGates) ? humanGates : [];
  for (const row of humans) {
    if (!WMS_HUMAN_GATES.some(gate => gate.id === row?.id)) humanFailures.push('unknown human gate');
  }
  for (const gate of WMS_HUMAN_GATES) {
    const rows = humans.filter(row => row?.id === gate.id);
    const row = rows[0];
    const requiredChecks = [...gate.checks];
    if (gate.id === 'hardware' && row?.printersInUse === true) requiredChecks.push(...gate.conditionalChecks);
    const hardwareScopeValid = gate.id !== 'hardware' || row?.printersInUse === true
      || (row?.printersInUse === false && nonempty(row.printerNotApplicableReason));
    const passed = rows.length === 1 && row.status === 'passed'
      && hardwareScopeValid
      && nonempty(scope?.buildId) && row.buildId === scope.buildId
      && nonempty(scope?.environment) && row.environment === scope.environment
      && nonempty(row.reviewer) && nonempty(row.evidenceRef)
      && nonempty(row.completedAt) && Number.isFinite(Date.parse(row.completedAt))
      && strings(row.checks) && isDeepStrictEqual([...row.checks].sort(), requiredChecks.sort());
    if (!passed) {
      pendingHumanGates.push(gate.id);
      if (rows.length > 0) humanFailures.push(`${gate.id}: incomplete, duplicate or incorrect-scope human attestation`);
    }
  }
  const automatedPassed = failures.length === 0;
  return {
    automatedPassed,
    productionReady: automatedPassed && pendingHumanGates.length === 0 && humanFailures.length === 0,
    requiredCount: requirements.length, acceptedCount: validKeys.size,
    failures, pendingHumanGates, humanFailures,
  };
}
