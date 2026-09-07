#!/usr/bin/env node
import { fileURLToPath } from 'node:url';

// Review manifest only. No SQL, connections, approval identities or publication mode.
export function prepareLearningMappingCorrections(projectRef) {
  if (projectRef !== 'kkoitlvydytdhlpxhuah') throw new Error('Only reviewed UAT is supported');
  return {
    projectRef,
    status: 'blocked_pending_independent_content_review',
    executablePublication: false,
    preserve: ['published versions and graph', 'existing role grants', 'all learner evidence', 'business authorization checks'],
    corrections: [
      {
        module: 'warehouse', role: 'warehouse_operator', capability: 'inspect_quality',
        curriculum: 'internal.warehouse.warehouse_operator.receiving-certification.v1',
        observedVersion: 1, proposedVersion: 2,
        existingOutcome: 'receive_stock',
        requirement: 'internal.role.warehouse.warehouse_operator.capability-practice.v1',
        simulation: 'warehouse-receiving-v1',
        action: 'Review independent inspection content coverage; create a new draft curriculum version preserving receiving policy, assessment, prerequisites and receive_stock. Add only inspect_quality after review; version the requirement too if content or pass rules change.',
      },
      ...['finance', 'admin'].map((role) => ({
        module: 'procurement', role, capability: 'review_payment_readiness',
        curriculum: `internal.role.procurement.${role}.capability-practice.v1.curriculum`,
        observedVersion: 1, proposedVersion: 2,
        requirement: `internal.role.procurement.${role}.capability-practice.v1`,
        simulation: role === 'finance' ? 'finance-independent-review-v1' : 'procurement-evidence-routing-v1',
        action: 'Review payment-readiness content coverage; create a new draft curriculum version preserving all existing outcomes and edges. Add only review_payment_readiness after review; version the requirement too if content or pass rules change.',
      })),
      {
        module: 'core', role: 'vendor_portal', capability: null,
        curriculum: 'vendor.role.core.vendor_portal.capability-practice.v1.curriculum',
        observedVersion: 1, proposedVersion: 2,
        requirement: 'vendor.vendor_representative.evidence-and-acknowledgments.v1',
        requirementVersion: 1, kind: 'attestation', simulation: 'vendor-evidence-review-v1',
        action: 'Create the missing requirement as draft; reconcile candidate prerequisite graph before independent review. Current local practice requires evidence, so the earlier orientation-only practice edge is not equivalent. Preserve submit_accreditation outcome on practice only.',
      },
    ],
    excluded: [{ module: 'procurement', role: 'procurement_officer', capability: 'review_payment_readiness',
      reason: 'Neither local nor UAT role grants this capability. Do not grant through a mapping correction.' }],
    activation: 'Separately review effective role mappings and existing-user assignment impact. No resets, automatic grandfathering, or title-based credit claims.',
    approval: 'Existing published review metadata does not approve new outcomes or prerequisites. Actual independent review is required; simulation is not human approval.',
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) throw new Error('Provide the explicit UAT project reference');
  process.stdout.write(`${JSON.stringify(prepareLearningMappingCorrections(process.argv[2]), null, 2)}\n`);
}
