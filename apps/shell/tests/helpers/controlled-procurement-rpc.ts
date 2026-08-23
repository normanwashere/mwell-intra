import type { BrowserContext, Route } from '@playwright/test';

export const CONTROLLED_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
export const CONTROLLED_ANON_KEY = 'controlled-rpc-anon-key';

export type ActorKey = 'procurement' | 'vendor' | 'unrelatedVendor' | 'admin' | 'legal' | 'legalMaker' | 'legalDecider' | 'operations' | 'deptHead' | 'finance' | 'financeNoCapability' | 'unrelated' | 'exceptionReviewer' | 'exceptionFinance' | 'exceptionDoa';
type Actor = {
  id: string;
  email: string;
  name: string;
  title: string;
  roles: Record<string, string[]>;
  capabilities: Record<string, string[]>;
  kind?: 'employee' | 'vendor';
  vendorId?: string;
};

const ACTORS: Record<ActorKey, Actor> = {
  procurement: {
    id: 'controlled-procurement',
    email: 'procurement.controlled@mwell.test',
    name: 'Controlled Procurement Officer',
    title: 'Procurement Officer',
    roles: { core: ['staff'], procurement: ['procurement_officer'] },
    capabilities: {
      core: ['view_directory', 'view_vendors', 'view_documents', 'view_approvals'],
      procurement: ['view_dashboard', 'create_request', 'manage_rfp', 'manage_request_collaborators', 'cancel_request', 'author_po', 'manage_vendors', 'approve_request'],
    },
  },
  vendor: {
    id: 'controlled-awarded-vendor', email: 'vendor.controlled@mwell.test', name: 'Controlled Awarded Vendor', title: 'Vendor Contact', kind: 'vendor', vendorId: 'vendor-1',
    roles: { core: ['vendor_portal'] }, capabilities: { core: ['vendor_portal'] },
  },
  unrelatedVendor: {
    id: 'controlled-unrelated-vendor', email: 'vendor.unrelated@mwell.test', name: 'Controlled Unrelated Vendor', title: 'Vendor Contact', kind: 'vendor', vendorId: 'vendor-2',
    roles: { core: ['vendor_portal'] }, capabilities: { core: ['vendor_portal'] },
  },
  admin: {
    id: 'controlled-admin',
    email: 'admin.controlled@mwell.test',
    name: 'Controlled Platform Administrator',
    title: 'Platform Administrator',
    roles: { core: ['platform_admin', 'staff'] },
    capabilities: {
      core: ['view_directory', 'manage_rbac', 'view_vendors', 'manage_vendors', 'manage_accreditation', 'view_documents', 'manage_documents', 'view_approvals', 'manage_approvals', 'record_approval', 'view_audit', 'manage_notifications'],
    },
  },
  legal: {
    id: 'controlled-legal',
    email: 'legal.controlled@mwell.test',
    name: 'Controlled Legal Administrator',
    title: 'Legal & Compliance Lead',
    roles: { core: ['staff'], legal: ['admin'] },
    capabilities: {
      core: ['view_directory', 'view_vendors', 'view_documents', 'view_approvals'],
      legal: ['view_dashboard', 'review_accreditation', 'manage_checklist', 'approve_accreditation', 'manage_documents', 'manage_doa', 'admin'],
    },
  },
  legalMaker: {
    id: 'controlled-legal-maker', email: 'legal.maker.controlled@mwell.test', name: 'Controlled Legal Maker', title: 'Vendor Management Officer',
    roles: { core: ['staff'], legal: ['reviewer'] }, capabilities: { core: ['view_directory', 'view_vendors'], legal: ['view_dashboard', 'review_accreditation'] },
  },
  legalDecider: {
    id: 'controlled-legal-decider', email: 'legal.decider.controlled@mwell.test', name: 'Controlled Legal Decider', title: 'Legal Approver',
    roles: { core: ['staff'], legal: ['approver'] }, capabilities: { core: ['view_directory', 'view_vendors'], legal: ['view_dashboard', 'approve_accreditation'] },
  },
  operations: {
    id: 'controlled-operations',
    email: 'operations.controlled@mwell.test',
    name: 'Controlled Operations Requester',
    title: 'Operations Associate',
    roles: { core: ['staff'], procurement: ['requester'] },
    capabilities: {
      core: ['view_directory', 'view_vendors', 'view_documents', 'view_approvals'],
      procurement: ['view_dashboard', 'create_request', 'cancel_request'],
    },
  },
  deptHead: {
    id: 'controlled-department-head', email: 'department.head.controlled@mwell.test', name: 'Controlled Department Head', title: 'Operations Department Head',
    roles: { core: ['staff'], procurement: ['approver'] },
    capabilities: { core: ['view_directory', 'view_vendors'], procurement: ['final_approve_po'] },
  },
  finance: {
    id: 'controlled-finance', email: 'finance.controlled@mwell.test', name: 'Controlled Finance Controller', title: 'Finance Controller',
    roles: { core: ['staff'], finance: ['controller'], procurement: ['finance'] },
    capabilities: { core: ['view_directory', 'view_vendors'], procurement: ['view_finance', 'accept_payment_readiness', 'release_payment'] },
  },
  financeNoCapability: {
    id: 'controlled-finance-no-capability', email: 'finance.no-capability.controlled@mwell.test', name: 'Controlled Finance Without Capability', title: 'Finance Controller',
    roles: { core: ['staff'], finance: ['controller'] },
    capabilities: { core: ['view_directory', 'view_vendors'] },
  },
  unrelated: {
    id: 'controlled-unrelated', email: 'unrelated.controlled@mwell.test', name: 'Controlled Unrelated Employee', title: 'Customer Service Associate',
    roles: { core: ['staff'], operations: ['customer_service'] },
    capabilities: { core: ['view_directory'] },
  },
  exceptionReviewer: {
    id: 'controlled-exception-procurement-reviewer', email: 'exception.procurement.reviewer@mwell.test', name: 'Controlled Exception Procurement Reviewer', title: 'Procurement Review Lead',
    roles: { core: ['staff'], procurement: ['procurement_officer'] },
    capabilities: { core: ['view_directory', 'view_vendors'], procurement: ['view_dashboard', 'approve_award'] },
  },
  exceptionFinance: {
    id: 'controlled-exception-finance-reviewer', email: 'exception.finance.reviewer@mwell.test', name: 'Controlled Exception Finance Reviewer', title: 'Finance Controller',
    roles: { core: ['staff'], procurement: ['finance'] },
    capabilities: { core: ['view_directory', 'view_vendors'], procurement: ['view_dashboard', 'view_finance'] },
  },
  exceptionDoa: {
    id: 'controlled-exception-doa-reviewer', email: 'exception.doa.reviewer@mwell.test', name: 'Controlled Exception DOA Reviewer', title: 'Operations Approver',
    roles: { core: ['staff'], procurement: ['admin'] },
    capabilities: { core: ['view_directory', 'view_vendors'], procurement: ['view_dashboard'] },
  },
};

type RpcCall = {
  actor: string;
  schema: string;
  name: string;
  payload: Record<string, unknown>;
};

type ControlledExceptionState = {
  pack: null | {
    id: string;
    status: 'under_review' | 'approved' | 'rejected' | 'superseded';
    revision: number;
    evidence: Record<string, unknown>;
    priceReasonableness: string;
    submittedBy: string;
  };
  history: Array<{ stage: string; decision: string; actorId: string; decidedAt: string; note: string; revision: number }>;
  blockers: string[];
  failWorkspaceOnce: boolean;
  failSubmitOnce: boolean;
};

type FixtureProfile = {
  id: string;
  code: string;
  version: string;
  name: string;
  relationship: 'parent_source' | 'mwell_operating';
  source_profile_id: string | null;
  source_filename: string;
  source_organization: string;
  control_sources: Record<string, string>;
  status: 'draft' | 'active' | 'superseded';
  effective_from: string;
  created_by: string;
  last_modified_by: string;
  activated_by: string | null;
  [key: string]: unknown;
};

const CONTROL_SOURCES = Object.fromEntries([
  'formalBidAmount', 'inviteTargetMin', 'inviteTargetMax', 'sealedBidMinimumResponses',
  'bidWindowWorkingDays', 'maxExtensionWorkingDays', 'vendorAcknowledgementHours',
  'clarificationHours', 'tabulationHours', 'technicalEvaluationWorkingDays',
  'poAcknowledgementHours', 'repeatOrderMaxAmount', 'repeatOrderMaxAgeDays',
  'pettyCashMaxAmount', 'poInvoiceThreshold', 'vendorProbationMonths',
].map((key) => [key, 'MPIC Procurement Policy February2025.docx']));

function controls(): Record<string, number> {
  return {
    formal_bid_amount: 1_000_000,
    invite_target_min: 3,
    invite_target_max: 4,
    sealed_bid_minimum_responses: 3,
    bid_window_working_days: 7,
    max_extension_working_days: 7,
    vendor_acknowledgement_hours: 24,
    clarification_hours: 48,
    tabulation_hours: 48,
    technical_evaluation_working_days: 5,
    po_acknowledgement_hours: 48,
    repeat_order_max_amount: 250_000,
    repeat_order_max_age_days: 365,
    petty_cash_max_amount: 2_000,
    po_invoice_threshold: 50_000,
    vendor_probation_months: 6,
  };
}

function actorForToken(headers: Record<string, string>): Actor {
  const token = headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
  return Object.values(ACTORS).find((actor) => token === `controlled-${actor.id}`) ?? ACTORS.operations;
}

function userFor(actor: Actor) {
  return {
    id: actor.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: actor.email,
    email_confirmed_at: '2026-08-22T00:00:00.000Z',
    app_metadata: { roles: actor.roles, kind: actor.kind ?? 'employee', vendorId: actor.vendorId },
    user_metadata: { name: actor.name, title: actor.title },
    created_at: '2026-08-22T00:00:00.000Z',
    updated_at: '2026-08-22T00:00:00.000Z',
  };
}

function sessionFor(actor: Actor) {
  return {
    access_token: `controlled-${actor.id}`,
    refresh_token: `controlled-refresh-${actor.id}`,
    expires_in: 86_400,
    expires_at: Math.floor(Date.now() / 1000) + 86_400,
    token_type: 'bearer',
    user: userFor(actor),
  };
}

function response(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });
}

function failure(route: Route, message: string, status = 400) {
  return response(route, { message, code: 'P0001' }, status);
}

export class ControlledProcurementRpcFixture {
  readonly calls: RpcCall[] = [];
  readonly requestId = 'controlled-request-0001';
  readonly parentProfileId = '10000000-0000-4000-8000-000000000001';
  readonly activeProfileId = '10000000-0000-4000-8000-000000000002';
  readonly conflictId = '10000000-0000-4000-8000-000000000003';
  readonly request: Record<string, unknown>;
  readonly profiles: FixtureProfile[];
  readonly events: Array<Record<string, unknown>> = [];
  readonly conflicts: Array<Record<string, unknown>> = [{
    id: '10000000-0000-4000-8000-000000000003',
    parent_rule: 'Formal-bid source threshold',
    local_rule: 'Operating response window',
    impact: 'A documented mapping is required before the revision can activate.',
    status: 'open',
    created_at: '2026-08-22T00:00:00.000Z',
  }];
  sourcing: {
    id: string;
    status: 'draft' | 'issued' | 'response_closed' | 'failed_bid' | 'evaluation' | 'awarded' | 'cancelled';
    submissionDeadline?: string;
    intendedResponses?: number;
    packageVersion?: string;
    packageHash?: string;
    selectedVendorId?: string;
    closureNote?: string;
    responses: Array<Record<string, unknown>>;
  } | null = null;
  commercialTabulations: Array<Record<string, unknown>> = [];
  technicalEvaluations: Array<Record<string, unknown>> = [];
  awardRecommendation: Record<string, unknown> | null = null;
  varianceDecisions: Array<Record<string, unknown>> = [];
  exception: ControlledExceptionState = {
    pack: null,
    history: [],
    blockers: ['approved_exception_pack_required'],
    failWorkspaceOnce: false,
    failSubmitOnce: false,
  };
  purchaseOrder: Record<string, unknown> | null = null;
  lifecycle: Record<string, unknown> | null = null;
  monitoring: Array<Record<string, unknown>> = [];
  task10: { acceptance: boolean; prepared: boolean; accepted: boolean; released: boolean; closureRequested: boolean; closed: boolean; vendorCurrent: boolean; legalRevision: number; clearanceOpened: boolean } | null = null;
  private readonly varianceAssignments = [
    { actorId: ACTORS.deptHead.id, stage: 'department_head' as const, assignmentId: 'controlled-department_head-assignment' },
    { actorId: ACTORS.finance.id, stage: 'finance' as const, assignmentId: 'controlled-finance-assignment' },
    { actorId: ACTORS.financeNoCapability.id, stage: 'finance' as const, assignmentId: 'controlled-finance-no-capability-assignment' },
  ];

  constructor() {
    this.request = {
      id: this.requestId,
      title: 'Controlled route and sourcing verification',
      description: 'Stateful controlled-RPC browser evidence.',
      department: 'Operations',
      cost_center: 'OPS-001',
      budget_code: 'GL-5100',
      needed_by: '2026-10-15',
      status: 'draft',
      requester_id: ACTORS.procurement.id,
      requester_name: ACTORS.procurement.name,
      requester_email: ACTORS.procurement.email,
      estimated_amount: 250_000,
      category: 'goods',
      requirement_kind: 'materials',
      sourcing_method: 'rfq',
      solicitation_type: 'rfq',
      procurement_mode: 'competitive_bidding',
      governance_tier: 'formal_bid',
      policy_profile_id: this.activeProfileId,
      route_reasons: ['material_requirement', 'tier:formal_bid'],
      route_version: 0,
      lines: [{ id: 'controlled-line-1', description: 'Serialized cold-chain device', quantity: 1, uom: 'ea', unitPrice: 250_000 }],
      solicitation_requirements: {
        acceptanceCriteria: 'Match the approved serialised specification.',
        deliveryTerms: 'Deliver to Pasig warehouse.',
        paymentTerms: 'Net 30 after accepted receipt.',
        shippingTerms: 'DAP Pasig.',
        validityPeriod: '30 calendar days.',
        responseDeadline: '2026-09-30',
      },
      attachments: ['spec', 'budget', 'previous_cost', 'quote'].map((kind) => ({
        id: `controlled-${kind}`,
        kind,
        filename: `${kind}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        uploadedAt: '2026-08-22T00:00:00.000Z',
      })),
      compliance: { routeConfirmed: false },
      created_at: '2026-08-22T00:00:00.000Z',
    };
    this.profiles = [
      {
        id: this.parentProfileId,
        code: 'MPIC-PROCUREMENT-2025-02',
        version: '2025.02',
        name: 'MPIC Procurement Policy February 2025',
        relationship: 'parent_source',
        source_profile_id: null,
        source_filename: 'MPIC Procurement Policy February2025.docx',
        source_organization: 'MPIC',
        control_sources: CONTROL_SOURCES,
        status: 'active',
        effective_from: '2026-01-01T00:00:00+08:00',
        created_by: ACTORS.admin.id,
        last_modified_by: ACTORS.admin.id,
        activated_by: ACTORS.admin.id,
        ...controls(),
      },
      {
        id: this.activeProfileId,
        code: 'MWELL-CONTROLLED-OPERATING',
        version: '2026.08',
        name: 'Mwell controlled operating policy',
        relationship: 'mwell_operating',
        source_profile_id: this.parentProfileId,
        source_filename: 'mWell Procurement Policy and Procedures - Revised Modern Visual Updated.docx',
        source_organization: 'Mwell',
        control_sources: CONTROL_SOURCES,
        status: 'active',
        effective_from: '2026-08-01T00:00:00+08:00',
        created_by: ACTORS.admin.id,
        last_modified_by: ACTORS.admin.id,
        activated_by: ACTORS.legal.id,
        ...controls(),
      },
    ];
  }

  /** A compact, server-shaped record for testing the restricted variance UI. */
  preparePendingVariance() {
    this.sourcing = {
      id: 'controlled-sourcing-event',
      status: 'evaluation',
      submissionDeadline: '2026-09-30T04:00:00.000Z',
      intendedResponses: 3,
      packageVersion: 'RFQ-CONTROLLED-v1',
      packageHash: 'a'.repeat(64),
      responses: ['vendor-1', 'vendor-2', 'vendor-3'].map((vendorId, index) => ({
        id: `response-${vendorId}`,
        vendorId,
        vendorName: ['Acme Medical Supplies, Inc.', 'North Star Logistics Corp.', 'TechBridge IT Solutions, Inc.'][index]!,
        receivedAt: '2026-08-22T04:00:00.000Z',
        deadlineCompliant: true,
        commercial: { amount: 200_000 + index * 10_000 },
      })),
    };
    this.commercialTabulations = [{
      id: 'controlled-tabulation-1',
      version: 1,
      status: 'submitted',
      escalationStatus: 'on_track',
      responseClosedAt: '2026-08-22T03:00:00.000Z',
      dueAt: '2026-08-24T03:00:00.000Z',
      submittedAt: '2026-08-22T04:00:00.000Z',
      submittedByName: ACTORS.procurement.name,
      evidenceReference: 'controlled-commercial-tabulation-v1.pdf',
      comments: 'Controlled comparable commercial record.',
      entries: this.sourcing!.responses.map((response) => ({ vendorId: response.vendorId, quotedAmount: response.commercial?.amount, evidenceReference: 'controlled-proposal.pdf' })),
    }];
    this.technicalEvaluations = this.sourcing!.responses.map((response, index) => ({
      id: `controlled-technical-${response.vendorId}-1`,
      sourcingEventId: this.sourcing!.id,
      vendorId: response.vendorId,
      version: 1,
      dueAt: '2026-08-29T03:00:00.000Z',
      submittedAt: '2026-08-22T04:00:00.000Z',
      reviewerName: ACTORS.procurement.name,
      criteria: [],
      totalScore: 95 - index * 5,
      evidenceReference: `controlled-technical-${response.vendorId}.pdf`,
      comments: 'Controlled technical evidence.',
      status: 'submitted',
      escalationStatus: 'on_track',
    }));
    this.awardRecommendation = {
      id: 'controlled-award-recommendation-1',
      sourcingEventId: this.sourcing.id,
      version: 1,
      evaluatedVendorId: 'vendor-1',
      recommendedVendorId: 'vendor-2',
      rationale: 'Documented best-value rationale.',
      commercialTabulationId: 'controlled-tabulation-1',
      technicalEvaluationId: 'controlled-technical-vendor-2-1',
      riskEvidenceReference: 'controlled-risk-review-v1.pdf',
      varianceJustification: 'Lifecycle value and contracted support justify the variance.',
      createdBy: ACTORS.procurement.id,
      status: 'pending_variance',
    };
    this.varianceDecisions = [];
  }

  prepareExceptionWorkspace() {
    Object.assign(this.request, {
      title: 'Controlled petty-cash exception',
      description: 'Stateful exception-workspace browser evidence.',
      requester_id: ACTORS.procurement.id,
      requester_name: ACTORS.procurement.name,
      requester_email: ACTORS.procurement.email,
      estimated_amount: 1_500,
      sourcing_method: 'petty_cash',
      solicitation_type: 'none',
      procurement_mode: 'petty_cash',
      governance_tier: 'standard',
      route_reasons: ['controlled_exception_fixture'],
      route_version: 1,
      compliance: { routeConfirmed: true },
    });
    this.exception = {
      pack: null,
      history: [],
      blockers: ['approved_exception_pack_required'],
      failWorkspaceOnce: false,
      failSubmitOnce: false,
    };
  }

  prepareTask9PurchaseOrder() {
    this.purchaseOrder = { id: 'controlled-po-task-9', po_number: 'PO-CONTROLLED-009', core_vendor_id: 'vendor-1', vendor_name: 'Acme Medical Supplies, Inc.', status: 'issued', total: 1000, lines: [{ id: 'line-1', description: 'Controlled clinical supply', quantity: 1, receivedQuantity: 0 }], created_at: '2026-08-22T00:00:00.000Z', updated_at: '2026-08-22T00:00:00.000Z' };
    this.lifecycle = { purchaseOrderId: 'controlled-po-task-9', revision: 2, issuedAt: '2026-08-22T00:00:00.000Z', sentAt: '2026-08-22T00:00:00.000Z', acknowledgementDueAt: '2026-08-24T00:00:00.000Z', acknowledgementStatus: 'pending', deliveryNoticeStatus: 'pending', qualityRecoveryStatus: 'payment_hold', closureStatus: 'blocked' };
    this.monitoring = [{ id: 'controlled-po-task-9:weekly', purchaseOrderId: 'controlled-po-task-9', kind: 'quality_recovery', owner: 'Procurement', ageHours: 52, dueAt: '2026-08-24T00:00:00.000Z', nextAction: 'Maintain vendor notice, RMA, credit, and payment hold' }];
  }

  prepareTask10PurchaseOrder() {
    this.sourcing = { id: 'controlled-sourcing-10', status: 'draft', submissionDeadline: '2026-09-30T04:00:00.000Z', intendedResponses: 3, packageVersion: 'RFQ-CONTROLLED-010-v1', packageHash: 'a'.repeat(64), responses: [] };
    this.purchaseOrder = { id: 'controlled-po-task-10', po_number: 'PO-CONTROLLED-010', request_id: this.requestId, core_vendor_id: 'vendor-1', vendor_name: 'Acme Medical Supplies, Inc.', status: 'approved', total: 1000, origin: 'procurement', actor_email: ACTORS.procurement.email, expected_date: '2026-09-01', notes: 'Controlled issued PO evidence.', source_award_status: 'approved', lines: [{ id: 'line-1', description: 'Governed clinical supply', quantity: 1, receivedQuantity: 1, uom: 'ea', unitPrice: 1000 }], created_at: '2026-08-22T00:00:00.000Z', updated_at: '2026-08-22T00:00:00.000Z' };
    this.request.requester_id = ACTORS.operations.id;
    this.request.requester_email = ACTORS.operations.email;
    this.request.status = 'draft';
    this.request.compliance = { routeConfirmed: true };
    this.lifecycle = null;
    this.task10 = { acceptance: false, prepared: false, accepted: false, released: false, closureRequested: false, closed: false, vendorCurrent: false, legalRevision: 0, clearanceOpened: false };
  }

  failNextExceptionSubmit() {
    this.exception.failSubmitOnce = true;
  }

  failNextExceptionWorkspaceLoad() {
    this.exception.failWorkspaceOnce = true;
  }

  markExceptionStale() {
    if (!this.exception.pack) throw new Error('An exception pack is required before it can become stale.');
    this.exception.pack.status = 'approved';
    this.exception.blockers = ['policy_profile_changed_restart_exception'];
  }

  callsNamed(name: string) {
    return this.calls.filter((call) => call.name === name);
  }

  private log(actor: Actor, schema: string, name: string, payload: Record<string, unknown>) {
    this.calls.push({ actor: actor.id, schema, name, payload });
  }

  profileById(id: string) {
    return this.profiles.find((profile) => profile.id === id) ?? null;
  }

  private profileRows() {
    return this.profiles.map((profile) => ({ ...profile }));
  }

  private effectiveProfile() {
    return this.profiles.find((profile) => profile.status === 'active' && profile.relationship === 'mwell_operating')!;
  }

  private workspace() {
    return {
      event: this.sourcing
        ? {
            id: this.sourcing.id,
            status: this.sourcing.status,
            submissionDeadline: this.sourcing.submissionDeadline,
            intendedResponses: this.sourcing.intendedResponses,
            packageVersion: this.sourcing.packageVersion,
            packageHash: this.sourcing.packageHash,
            selectedVendorId: this.sourcing.selectedVendorId,
            closureNote: this.sourcing.closureNote,
            responses: this.sourcing.responses,
          }
        : null,
    };
  }

  private hasCapability(actor: Actor, module: string, capability: string) {
    return actor.capabilities[module]?.includes(capability) === true;
  }

  private canReadSourcing(actor: Actor) {
    return this.hasCapability(actor, 'procurement', 'view_dashboard')
      || this.hasCapability(actor, 'procurement', 'manage_rfp')
      || this.hasCapability(actor, 'procurement', 'approve_award');
  }

  private varianceEligibility(actor: Actor) {
    const departmentApproved = this.varianceDecisions.some((decision) => decision.decisionType === 'department_head' && decision.decision === 'approved');
    const nextStage = this.awardRecommendation?.status === 'pending_variance' ? (departmentApproved ? 'finance' : 'department_head') : undefined;
    const assignment = this.varianceAssignments.find((candidate) => candidate.actorId === actor.id && candidate.stage === nextStage);
    const canReview = Boolean(
      assignment &&
      actor.id !== this.awardRecommendation?.createdBy &&
      (nextStage !== 'finance' || this.hasCapability(actor, 'procurement', 'view_finance')),
    );
    return {
      nextStage,
      canReview,
      doaMatrixId: assignment ? 'controlled-doa' : undefined,
      doaMatrixVersion: assignment ? 'OPS-2026.08' : undefined,
      doaAssignmentId: assignment?.assignmentId,
    };
  }

  private evaluationWorkspace(eligibility: ReturnType<ControlledProcurementRpcFixture['varianceEligibility']>) {
    return {
      request: {
        id: this.requestId,
        title: this.request.title,
        department: this.request.department,
        costCenter: this.request.cost_center,
        category: this.request.category,
        estimatedAmount: this.request.estimated_amount,
        status: this.request.status,
      },
      event: this.workspace().event,
      commercialTabulations: this.commercialTabulations.map((item) => ({ ...item })),
      technicalEvaluations: this.technicalEvaluations.map((item) => ({ ...item })),
      awardRecommendation: this.awardRecommendation ? { ...this.awardRecommendation } : null,
      varianceDecisions: this.varianceDecisions.map((item) => ({ ...item })),
      varianceEligibility: eligibility,
    };
  }

  private exceptionWorkspace(actor: Actor) {
    const pack = this.exception.pack;
    const procurementApproved = this.exception.history.some((item) => item.stage === 'procurement' && item.decision === 'approved');
    const financeApproved = this.exception.history.some((item) => item.stage === 'finance' && item.decision === 'approved');
    return {
      requestId: this.requestId,
      mode: 'petty_cash',
      profile: {
        id: this.activeProfileId,
        code: 'MWELL-CONTROLLED-OPERATING',
        version: '2026.08',
        repeatOrderMaxAmount: 250_000,
        repeatOrderMaxAgeDays: 365,
        pettyCashMaxAmount: 2_000,
      },
      pack: pack ? {
        id: pack.id,
        status: pack.status,
        revision: pack.revision,
        evidence: pack.evidence,
        priceReasonableness: pack.priceReasonableness,
      } : null,
      blockers: this.exception.blockers,
      history: this.exception.history,
      actions: {
        canSubmit: actor.id === ACTORS.procurement.id,
        canProcurementReview: actor.id === ACTORS.exceptionReviewer.id && pack?.status === 'under_review' && !procurementApproved,
        canFinanceReview: actor.id === ACTORS.exceptionFinance.id && pack?.status === 'under_review' && procurementApproved && !financeApproved,
        canDoaReview: actor.id === ACTORS.exceptionDoa.id && pack?.status === 'under_review' && procurementApproved && financeApproved,
      },
      recovery: this.exception.blockers.some((blocker) => blocker.endsWith('_restart_exception'))
        ? 'The active policy changed. Submit a new pack using the current request state.'
        : 'This controlled fixture is ready for the next independent decision.',
    };
  }

  private handleExceptionRpc(route: Route, actor: Actor, name: string, payload: Record<string, unknown>) {
    if (name === 'exception_workspace') {
      if (payload.request_id !== this.requestId) return failure(route, 'Request not found', 404);
      if (this.exception.failWorkspaceOnce) {
        this.exception.failWorkspaceOnce = false;
        return failure(route, 'Controlled workspace refresh failure');
      }
      return response(route, this.exceptionWorkspace(actor));
    }
    if (name === 'submit_policy_exception_pack') {
      if (actor.id !== ACTORS.procurement.id) return failure(route, 'Procurement authority is required to submit an exception pack', 403);
      if (this.exception.failSubmitOnce) {
        this.exception.failSubmitOnce = false;
        return failure(route, 'Controlled server validation failed; correct the evidence and try again.');
      }
      if (payload.request_id !== this.requestId || payload.mode !== 'petty_cash' || Number(payload.expected_route_version) !== Number(this.request.route_version)) return failure(route, 'The request route changed; refresh before submitting exception evidence');
      const evidence = (payload.evidence && typeof payload.evidence === 'object' ? payload.evidence : {}) as Record<string, unknown>;
      if (evidence.splitPurchase === true || evidence.recurring === true || evidence.receiptPresent !== true || evidence.liquidationRecorded !== true) return failure(route, 'Petty cash requires the controlled receipt, liquidation, and non-split attestations.');
      const id = `controlled-exception-pack-${this.exception.history.length + 1}`;
      this.exception.pack = { id, status: 'under_review', revision: 1, evidence, priceReasonableness: String(payload.price_reasonableness ?? ''), submittedBy: actor.id };
      this.exception.history = [{ stage: 'submitted', decision: 'submitted', actorId: actor.id, decidedAt: '2026-08-23T01:00:00.000Z', note: String(payload.justification ?? ''), revision: 1 }];
      this.exception.blockers = [];
      return response(route, { ...this.exception.pack });
    }
    if (name === 'review_policy_exception_pack') {
      const pack = this.exception.pack;
      if (!pack || payload.id !== pack.id || pack.status !== 'under_review') return failure(route, 'An exception awaiting review is required');
      if (Number(payload.expected_revision) !== pack.revision) return failure(route, 'The exception pack changed; refresh before deciding');
      if (!String(payload.note ?? '').trim()) return failure(route, 'A decision and review note are required');
      const stage = String(payload.stage ?? '');
      const expectedActor = stage === 'procurement' ? ACTORS.exceptionReviewer.id : stage === 'finance' ? ACTORS.exceptionFinance.id : stage === 'doa' ? ACTORS.exceptionDoa.id : '';
      const procurementApproved = this.exception.history.some((item) => item.stage === 'procurement' && item.decision === 'approved');
      const financeApproved = this.exception.history.some((item) => item.stage === 'finance' && item.decision === 'approved');
      if (actor.id !== expectedActor || (stage === 'finance' && !procurementApproved) || (stage === 'doa' && (!procurementApproved || !financeApproved))) return failure(route, 'The server did not find active independent authority for this decision', 403);
      const decision = String(payload.decision ?? '');
      if (decision !== 'approved' && decision !== 'rejected') return failure(route, 'A decision is required');
      this.exception.history.push({ stage, decision, actorId: actor.id, decidedAt: `2026-08-23T01:0${this.exception.history.length}:00.000Z`, note: String(payload.note), revision: pack.revision });
      pack.revision += 1;
      if (decision === 'rejected') pack.status = 'rejected';
      if (stage === 'doa' && decision === 'approved') pack.status = 'approved';
      return response(route, { ...pack });
    }
    return null;
  }

  async handle(route: Route) {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, content-profile, accept-profile', 'access-control-allow-methods': 'GET, POST, OPTIONS' } });
    }
    const url = new URL(request.url());
    const actor = actorForToken(request.headers());
    if (url.pathname.startsWith('/auth/v1/')) {
      this.log(actor, 'auth', `${request.method().toLowerCase()}:${url.pathname}`, request.postData() ? JSON.parse(request.postData()!) as Record<string, unknown> : {});
      if (url.pathname.endsWith('/token') && request.method() === 'POST') {
        const body = JSON.parse(request.postData() || '{}') as { email?: string };
        const matched = Object.values(ACTORS).find((candidate) => candidate.email === body.email);
        return matched ? response(route, sessionFor(matched)) : failure(route, 'Invalid login credentials', 400);
      }
      if (url.pathname.endsWith('/user')) return response(route, userFor(actor));
      return response(route, {});
    }
    if (!url.pathname.startsWith('/rest/v1/')) return route.continue();
    const relative = url.pathname.slice('/rest/v1/'.length);
    if (relative.startsWith('rpc/')) {
      const schema = request.headers()['content-profile'] ?? request.headers()['accept-profile'] ?? 'public';
      const name = relative.slice('rpc/'.length);
      const raw = request.postData() ? JSON.parse(request.postData()!) : {};
      const payload = (raw.payload && typeof raw.payload === 'object' ? raw.payload : raw) as Record<string, unknown>;
      this.log(actor, schema, name, payload);
      return this.handleRpc(route, actor, schema, name, payload);
    }
    const table = relative.split('/')[0]!;
    this.log(actor, request.headers()['accept-profile'] ?? 'public', `read:${table}`, Object.fromEntries(url.searchParams));
    const rows = this.rowsFor(table, url);
    const single = request.headers().accept?.includes('application/vnd.pgrst.object+json');
    return response(route, single ? (rows[0] ?? null) : rows);
  }

  private rowsFor(table: string, url: URL): Array<Record<string, unknown>> {
    const filtered = <T extends Record<string, unknown>>(rows: T[]) => {
      const id = url.searchParams.get('id');
      if (!id?.startsWith('eq.')) return rows;
      return rows.filter((row) => String(row.id) === id.slice(3));
    };
    if (table === 'requests') return filtered([{ ...this.request }]);
    if (table === 'purchase_orders') return this.purchaseOrder ? filtered([{ ...this.purchaseOrder }]) : [];
    if (table === 'approval_steps') return [];
    if (table === 'acceptance_packs') return this.task10?.acceptance ? [{ id: 'controlled-acceptance-10', purchase_order_id: 'controlled-po-task-10', request_id: this.requestId, acceptance_type: 'goods_receipt', accepted_scope: { summary: 'Warehouse receipt accepted against the governed PO.', lines: [{ po_line_id: 'line-1', quantity: 1 }] }, accepted_amount: 1000, exceptions: [], accepted_by_email: ACTORS.operations.email, accepted_at: '2026-08-23T00:00:00.000Z', status: 'accepted' }] : [];
    if (table === 'payment_readiness_packs') return this.task10?.prepared ? [{ id: 'controlled-payment-10', purchase_order_id: 'controlled-po-task-10', acceptance_pack_id: 'controlled-acceptance-10', acceptance_pack_ids: ['controlled-acceptance-10'], accepted_quantity: 1, po_match: true, invoice_or_si_storage_path: 'private/invoice-10.pdf', milestone_support_storage_path: 'private/acceptance-10.pdf', tax_withholding_support_storage_path: 'private/tax-10.pdf', invoice_number: 'SI-CONTROLLED-010', invoice_date: '2026-08-23', due_date: '2026-09-23', invoice_amount: 1000, tax_amount: 100, withholding_amount: 20, purchase_order_amount: 1000, accepted_amount: 1000, released_amount: this.task10.released ? 1000 : 0, status: this.task10.released ? 'released' : this.task10.accepted ? 'accepted' : 'ready_for_finance', prepared_by_email: ACTORS.procurement.email, prepared_at: '2026-08-23T00:00:00.000Z', finance_reviewed_by_email: this.task10.accepted ? ACTORS.finance.email : undefined, finance_reviewed_at: this.task10.accepted ? '2026-08-23T00:00:00.000Z' : undefined, finance_note: this.task10.accepted ? 'Controlled three-way match accepted.' : undefined, evidence_stale: false }] : [];
    if (table === 'vendor_lifecycle_reviews') return [];
    if (table === 'vendor_probation_reviews') return this.task10 ? [{ id: 'controlled-review-10', vendor_id: 'vendor-1', revision: this.task10.legalRevision }] : [];
    if (table === 'vendors') return [
      { id: 'vendor-1', legal_name: 'Acme Medical Supplies, Inc.', accreditation_status: 'approved' },
      { id: 'vendor-2', legal_name: 'North Star Logistics Corp.', accreditation_status: 'approved' },
      { id: 'vendor-3', legal_name: 'TechBridge IT Solutions, Inc.', accreditation_status: 'approved' },
      { id: 'vendor-4', legal_name: 'Pacific Clinical Devices, Inc.', accreditation_status: 'approved' },
    ];
    if (table === 'policy_profiles') return filtered(this.profileRows());
    if (table === 'policy_conflicts') return this.conflicts.map((conflict) => ({ ...conflict }));
    if (table === 'policy_profile_events') return this.events.map((event) => ({ ...event }));
    if (table === 'profiles') return Object.values(ACTORS).map((actor) => ({ id: actor.id, full_name: actor.name, title: actor.title, kind: actor.kind ?? 'employee', vendor_id: actor.vendorId, status: 'active' }));
    if (table === 'doa_matrices') return [{ id: 'controlled-doa', department: 'Operations', version: 'OPS-2026.08', status: 'active', active: true, effective_at: '2026-08-01', source_document: 'Controlled fixture' }];
    if (table === 'department_request_options') return [{ department_code: 'Operations', department_name: 'Operations', cost_center_code: 'OPS-001', cost_center_name: 'Operations' }];
    return [];
  }

  private handleRpc(route: Route, actor: Actor, schema: string, name: string, payload: Record<string, unknown>) {
    if (schema === 'core' && name === 'my_capability_snapshot') {
      return response(route, { roleCapabilities: actor.capabilities, userCapabilities: actor.capabilities });
    }
    if (schema === 'learning' && (name === 'resolve_assignments' || name === 'my_learning_snapshot')) {
      return response(route, { curricula: [], progress: [], certifications: [], lockedCapabilities: [], refreshedAt: '2026-08-22T00:00:00.000Z' });
    }
    if (schema === 'legal' && this.task10) {
      if (name === 'vendor_eligibility_projection') return response(route, [{ vendor_id: 'vendor-1', vendor_name: 'Acme Medical Supplies, Inc.', status: this.task10.vendorCurrent ? 'temporary_clearance' : 'expired', eligible: this.task10.vendorCurrent, authority: 'Legal/VMO', decision: this.task10.vendorCurrent ? 'temporary_clearance' : 'expired', review_due_at: '2026-08-22T00:00:00.000Z' }]);
      if (name === 'record_vendor_probation_review') {
        if (actor.id !== ACTORS.legalMaker.id || Number(payload.expected_revision) !== this.task10.legalRevision) return failure(route, 'Legal maker authority and current revision are required', 403);
        this.task10.legalRevision += 1;
        return response(route, { revision: this.task10.legalRevision, replayed: false, status: 'completed' });
      }
      if (name === 'open_vendor_temporary_clearance') {
        if (actor.id !== ACTORS.legalMaker.id || Number(payload.expected_revision) !== 0 || payload.scope !== 'goods' || !String(payload.evidence_reference ?? '').trim() || !String(payload.notice_reference ?? '').trim()) return failure(route, 'Legal maker scope, evidence, notice, and current revision are required', 403);
        this.task10.clearanceOpened = true;
        return response(route, { id: 'controlled-clearance-10', revision: 1, status: 'pending', replayed: false });
      }
      if (name === 'decide_vendor_temporary_clearance') {
        if (actor.id !== ACTORS.legalDecider.id || !this.task10.clearanceOpened || payload.clearance_id !== 'controlled-clearance-10' || Number(payload.expected_revision) !== 1 || payload.decision !== 'approve') return failure(route, 'Independent Legal clearance decision authority is required', 403);
        this.task10.vendorCurrent = true;
        return response(route, { id: 'controlled-clearance-10', revision: 2, status: 'approved', replayed: false });
      }
      if (name === 'record_vendor_eligibility_decision') {
        if (actor.id !== ACTORS.legalDecider.id || Number(payload.expected_revision) !== 0) return failure(route, 'Independent Legal decision authority is required', 403);
        this.task10.vendorCurrent = true;
        return response(route, { status: 'approved', decision: 'pass', replayed: false, revision: 1 });
      }
      return failure(route, 'Controlled Legal RPC is not available', 404);
    }
    if (schema !== 'procurement') return response(route, null);

    if (this.task10) {
      const isProcurement = actor.id === ACTORS.procurement.id;
      const isFinance = actor.id === ACTORS.finance.id;
      if (name === 'record_acceptance_pack') {
        if (actor.id !== ACTORS.operations.id || payload.purchase_order_id !== this.purchaseOrder?.id) return failure(route, 'Requester or Warehouse acceptance authority is required', 403);
        this.task10.acceptance = true;
        return response(route, { id: 'controlled-acceptance-10', status: 'accepted', accepted_amount: 1000 });
      }
      if (name === 'acceptance_work_items') {
        if (this.purchaseOrder?.status !== 'issued' || actor.id !== ACTORS.operations.id) {
          return response(route, []);
        }
        return response(route, [{
          purchase_order_id: this.purchaseOrder.id,
          po_number: this.purchaseOrder.po_number,
          request_id: this.purchaseOrder.request_id,
          status: this.purchaseOrder.status,
          warehouse_receipt_reference: 'WRH-CONTROLLED-010',
          qc_status: 'accepted',
          lines: [{
            poLineId: 'line-1',
            description: 'Governed clinical supply',
            uom: 'ea',
            orderedQuantity: 1,
            qcAcceptedQuantity: 1,
            rejectedOrQuarantinedQuantity: 0,
            warehouseReceiptId: 'WRH-CONTROLLED-010',
            qcInspectionIds: ['QC-CONTROLLED-010'],
          }],
        }]);
      }
      if (name === 'purchase_order_receipt_status') return response(route, this.purchaseOrder && ['issued', 'closed'].includes(String(this.purchaseOrder.status)) ? [{ purchase_order_id: this.purchaseOrder.id, ordered_quantity: 1, accepted_quantity: 1, rejected_or_quarantined_quantity: 0, outstanding_quantity: 0, latest_qc_status: 'accepted', latest_receipt_reference: 'WRH-CONTROLLED-010', accepted_lines: [{ po_line_id: 'line-1', accepted_quantity: 1 }] }] : []);
      if (name === 'commitment_readiness') return response(route, {
        ready: true,
        phase: this.purchaseOrder?.status === 'closed' ? 'closed' : 'issue',
        blockers: [],
        evidence: [],
        requirements: [],
        protections: [],
        canRecordAcceptance: actor.id === ACTORS.operations.id,
      });
      if (name === 'payment_readiness_staleness_work_items') return response(route, []);
      if (name === 'purchase_order_closure_work_items') return response(route, actor.id === ACTORS.deptHead.id && this.task10.closureRequested && !this.task10.closed ? [{ closure_request_id: 'controlled-closure-10', purchase_order_id: 'controlled-po-task-10', po_number: 'PO-CONTROLLED-010', closure_reason: 'Controlled obligations complete.', requested_by_name: ACTORS.procurement.name, requested_at: '2026-08-23T00:00:00.000Z' }] : []);
      if (name === 'evaluation_workspace') return response(route, { commercialTabulations: [], technicalEvaluations: [], awardRecommendation: null, varianceDecisions: [] });
      if (name === 'prepare_invoice_payment_readiness') {
        if (!isProcurement || !this.task10.acceptance || !this.task10.vendorCurrent) return failure(route, 'Current Legal eligibility and acceptance evidence are required', 403);
        this.task10.prepared = true;
        return response(route, { id: 'controlled-payment-10', status: 'ready_for_finance', invoice_amount: 1000 });
      }
      if (name === 'review_payment_readiness') {
        if (!isFinance || !this.task10.prepared || payload.status !== 'accepted') return failure(route, 'Finance acceptance authority is required', 403);
        this.task10.accepted = true;
        return response(route, { id: 'controlled-payment-10', status: 'accepted' });
      }
      if (name === 'release_payment') {
        if (!isFinance || !this.task10.accepted) return failure(route, 'Finance release authority is required', 403);
        this.task10.released = true;
        return response(route, { pack: { id: 'controlled-payment-10', status: 'released' }, closureRequired: true });
      }
      if (name === 'request_purchase_order_closure') {
        if (!isProcurement || !this.task10.released) return failure(route, 'Procurement closure authority and Finance release are required', 403);
        this.task10.closureRequested = true;
        return response(route, { id: 'controlled-closure-10', status: 'pending', replayed: false });
      }
      if (name === 'approve_purchase_order_closure') {
        if (actor.id !== ACTORS.deptHead.id || !this.task10.closureRequested) return failure(route, 'Independent closure approver authority is required', 403);
        this.task10.closed = true;
        this.purchaseOrder = { ...this.purchaseOrder!, status: 'closed' };
        this.lifecycle = { ...this.lifecycle!, closureStatus: 'closed' };
        this.monitoring = [];
        return response(route, { id: 'controlled-closure-10', status: 'approved', closureStatus: 'closed', replayed: false });
      }
      if (name === 'invite_sourcing_vendors') {
        if (!isProcurement || !this.task10.vendorCurrent || !this.sourcing) return failure(route, 'Legal/VMO vendor eligibility is not current', 403);
        const vendorId = String((Array.isArray(payload.vendor_ids) ? payload.vendor_ids : [])[0] ?? '');
        if (vendorId !== 'vendor-1') return failure(route, 'Controlled vendor is required');
        if (!this.sourcing.responses.some((item) => item.vendorId === vendorId)) this.sourcing.responses.push({ id: 'response-vendor-1', vendorId, vendorName: 'Acme Medical Supplies, Inc.', invitedAt: '2026-08-23T00:00:00.000Z' });
        this.request.status = 'approved';
        return response(route, { recipient_count: this.sourcing.responses.length });
      }
      if (name === 'issue_purchase_order') {
        if (!isProcurement || !this.task10.vendorCurrent || payload.id !== this.purchaseOrder?.id || this.purchaseOrder.status !== 'approved') return failure(route, 'Legal/VMO vendor eligibility is not current', 403);
        this.purchaseOrder = { ...this.purchaseOrder, status: 'issued', updated_at: '2026-08-23T00:00:00.000Z' };
        this.lifecycle = { purchaseOrderId: this.purchaseOrder.id, revision: 4, issuedAt: '2026-08-23T00:00:00.000Z', acknowledgementStatus: 'acknowledged', deliveryNoticeStatus: 'recorded', qualityRecoveryStatus: 'resolved', closureStatus: 'ready' };
        return response(route, { ...this.purchaseOrder });
      }
    }

    if (name === 'vendor_purchase_order_acknowledgements') return actor.vendorId === 'vendor-1' && this.purchaseOrder && this.lifecycle ? response(route, [{ id: this.purchaseOrder.id, poNumber: this.purchaseOrder.po_number, vendorName: this.purchaseOrder.vendor_name, lifecycle: this.lifecycle }]) : response(route, []);
    if (name === 'purchase_order_lifecycle') return this.lifecycle ? response(route, { ...this.lifecycle }) : failure(route, 'PO lifecycle not found', 404);
    if (name === 'review_open_purchase_orders') return actor.id === ACTORS.procurement.id ? response(route, this.monitoring) : failure(route, 'Procurement monitoring authority is required', 403);
    if (name === 'acknowledge_purchase_order') {
      if (actor.id !== ACTORS.vendor.id || payload.purchase_order_id !== this.purchaseOrder?.id || Number(payload.expected_revision) !== Number(this.lifecycle?.revision)) return failure(route, 'Only the awarded vendor may acknowledge this PO', 403);
      this.lifecycle = { ...this.lifecycle!, revision: Number(this.lifecycle!.revision) + 1, acknowledgedAt: '2026-08-23T00:00:00.000Z', acknowledgementStatus: 'acknowledged' };
      return response(route, { ...this.lifecycle, replayed: false });
    }
    if (name === 'record_vendor_delivery_notice') {
      if (actor.id !== ACTORS.procurement.id || Number(payload.expected_revision) !== Number(this.lifecycle?.revision)) return failure(route, 'Procurement authority is required', 403);
      this.lifecycle = { ...this.lifecycle!, revision: Number(this.lifecycle!.revision) + 1, deliveryNoticeStatus: 'recorded' };
      this.monitoring = [{ ...this.monitoring[0]!, kind: 'quality_recovery', nextAction: 'Maintain vendor notice, RMA, credit, and payment hold' }];
      return response(route, { ...this.lifecycle, replayed: false });
    }

    if (name === 'exception_workspace' || name === 'submit_policy_exception_pack' || name === 'review_policy_exception_pack') {
      return this.handleExceptionRpc(route, actor, name, payload);
    }

    if (name === 'confirm_route_decision') {
      if (!actor.capabilities.procurement?.includes('manage_rfp')) return failure(route, 'Not authorized to confirm procurement route', 403);
      if (payload.request_id !== this.requestId || payload.expected_route_version !== 0) return failure(route, 'Stale route version');
      this.request.route_version = 1;
      this.request.route_confirmed_at = '2026-08-22T01:00:00.000Z';
      this.request.route_confirmed_by_email = actor.email;
      this.request.compliance = { ...(this.request.compliance as Record<string, unknown>), routeConfirmed: true };
      return response(route, { status: 'confirmed', route: {
        solicitation_type: this.request.solicitation_type,
        procurement_mode: this.request.procurement_mode,
        governance_tier: this.request.governance_tier,
        policy_profile_id: this.request.policy_profile_id,
        reasons: this.request.route_reasons,
      } });
    }
    if (name === 'submit_request') {
      if (payload.id !== this.requestId) return failure(route, 'Unknown request');
      if (!(this.request.compliance as Record<string, unknown>).routeConfirmed || this.sourcing?.status !== 'awarded') return failure(route, 'Confirmed sourcing must be awarded before submission');
      this.request.status = 'submitted';
      this.request.submitted_at = '2026-08-22T02:00:00.000Z';
      return response(route, { ...this.request });
    }
    if (name === 'sourcing_workspace') {
      if (payload.request_id !== this.requestId || !this.canReadSourcing(actor)) {
        return failure(route, 'No procurement sourcing access is assigned to this account.', 403);
      }
      return response(route, this.workspace());
    }
    if (name === 'insufficient_bid_exception') return response(route, null);
    if (name === 'evaluation_workspace') {
      const eligibility = this.varianceEligibility(actor);
      if (payload.request_id !== this.requestId || !eligibility.canReview) return failure(route, 'No governed variance decision is assigned to this account for this request.', 403);
      return response(route, this.evaluationWorkspace(eligibility));
    }
    if (name === 'save_sourcing_event') {
      this.sourcing ??= { id: 'controlled-sourcing-event', status: 'draft', responses: [] };
      this.sourcing.submissionDeadline = String(payload.submission_deadline ?? '');
      this.sourcing.intendedResponses = Number(payload.intended_responses ?? 3);
      this.sourcing.packageVersion = String(payload.package_version ?? '');
      this.sourcing.packageHash = String(payload.package_hash ?? '');
      return response(route, this.workspace());
    }
    if (name === 'invite_sourcing_vendors') {
      if (!this.sourcing) return failure(route, 'Sourcing event is required');
      for (const value of Array.isArray(payload.vendor_ids) ? payload.vendor_ids : []) {
        const vendorId = String(value);
        const vendor = this.rowsFor('vendors', new URL(`${CONTROLLED_SUPABASE_URL}/rest/v1/vendors`)).find((item) => item.id === vendorId);
        this.sourcing.responses.push({ id: `response-${vendorId}`, vendorId, vendorName: String(vendor?.legal_name ?? vendorId), invitedAt: '2026-08-22T01:05:00.000Z' });
      }
      return response(route, { recipient_count: this.sourcing.responses.length });
    }
    if (name === 'record_sourcing_response') {
      if (!this.sourcing) return failure(route, 'Sourcing event is required');
      const vendorId = String(payload.vendor_id);
      const existing = this.sourcing.responses.find((item) => item.vendorId === vendorId);
      if (!existing) return failure(route, 'Only an invited vendor may submit a response');
      Object.assign(existing, { receivedAt: String(payload.received_at), deadlineCompliant: true, proposalReference: String(payload.proposal_storage_path ?? ''), commercial: payload.commercial, technical: payload.technical });
      return response(route, existing);
    }
    if (name === 'record_solicitation_communication') {
      if (!this.sourcing || this.sourcing.status !== 'issued') return failure(route, 'Sourcing event is not available for communication');
      if (payload.communication_type === 'clarification' && (!payload.question || !payload.answer)) return failure(route, 'Clarification question and answer are required');
      return response(route, { notification_group_id: 'controlled-equal-notice', recipient_count: this.sourcing.responses.length });
    }
    if (name === 'save_commercial_tabulation') {
      if (!this.sourcing || this.sourcing.status !== 'evaluation') return failure(route, 'Controlled evaluation is required before tabulation');
      if (!String(payload.evidence_reference ?? '').trim()) return failure(route, 'Tabulation evidence is required');
      const entries = Array.isArray(payload.entries) ? payload.entries : [];
      if (entries.length !== this.sourcing.responses.filter((item) => item.receivedAt).length) return failure(route, 'Every usable response must be tabulated');
      const tabulation = {
        id: `controlled-tabulation-${this.commercialTabulations.length + 1}`,
        version: this.commercialTabulations.length + 1,
        status: 'submitted',
        escalationStatus: 'on_track',
        dueAt: '2026-08-24T00:00:00.000Z',
        evidenceReference: String(payload.evidence_reference),
        comments: String(payload.comments ?? ''),
        entries,
      };
      this.commercialTabulations.forEach((item) => { item.status = 'superseded'; });
      this.commercialTabulations.push(tabulation);
      return response(route, tabulation);
    }
    if (name === 'submit_technical_evaluation') {
      if (!this.sourcing || this.sourcing.status !== 'evaluation') return failure(route, 'Controlled evaluation is required');
      if (this.commercialTabulations.at(-1)?.status !== 'submitted') return failure(route, 'Commercial tabulation is required');
      const vendorId = String(payload.vendor_id ?? '');
      const criteria = Array.isArray(payload.criteria) ? payload.criteria as Array<Record<string, unknown>> : [];
      if (!this.sourcing.responses.some((item) => item.vendorId === vendorId && item.receivedAt) || criteria.length !== 9 || !String(payload.evidence_reference ?? '').trim()) return failure(route, 'Complete technical evidence is required');
      const totalScore = criteria.reduce((sum, criterion) => sum + Number(criterion.score ?? 0), 0) / criteria.length;
      const evaluation = {
        id: `controlled-technical-${vendorId}-${this.technicalEvaluations.filter((item) => item.vendorId === vendorId).length + 1}`,
        version: this.technicalEvaluations.filter((item) => item.vendorId === vendorId).length + 1,
        vendorId,
        totalScore,
        status: 'submitted',
        escalationStatus: 'on_track',
        dueAt: '2026-08-29T00:00:00.000Z',
        evidenceReference: String(payload.evidence_reference),
        comments: String(payload.comments ?? ''),
        criteria,
      };
      this.technicalEvaluations.filter((item) => item.vendorId === vendorId).forEach((item) => { item.status = 'superseded'; });
      this.technicalEvaluations.push(evaluation);
      return response(route, evaluation);
    }
    if (name === 'submit_award_recommendation') {
      if (!this.sourcing || this.sourcing.status !== 'evaluation') return failure(route, 'Controlled evaluation is required');
      const evaluatedVendorId = String(payload.evaluated_vendor_id ?? '');
      const recommendedVendorId = String(payload.recommended_vendor_id ?? '');
      const top = [...this.technicalEvaluations].filter((item) => item.status === 'submitted').sort((left, right) => Number(right.totalScore) - Number(left.totalScore))[0];
      if (!top || top.vendorId !== evaluatedVendorId || !recommendedVendorId || !String(payload.rationale ?? '').trim() || !payload.commercial_tabulation_id || !payload.technical_evaluation_id || !String(payload.risk_evidence_reference ?? '').trim()) return failure(route, 'Complete best-value evidence is required');
      const variance = evaluatedVendorId !== recommendedVendorId;
      if (variance && !String(payload.variance_justification ?? '').trim()) return failure(route, 'Written variance justification is required');
      this.awardRecommendation = {
        id: 'controlled-award-recommendation-1',
        version: 1,
        evaluatedVendorId,
        recommendedVendorId,
        rationale: String(payload.rationale),
        commercialTabulationId: String(payload.commercial_tabulation_id),
        technicalEvaluationId: String(payload.technical_evaluation_id),
        riskEvidenceReference: String(payload.risk_evidence_reference),
        createdBy: actor.id,
        status: variance ? 'pending_variance' : 'approved',
      };
      return response(route, this.awardRecommendation);
    }
    if (name === 'review_recommendation_variance') {
      if (!this.awardRecommendation || this.awardRecommendation.status !== 'pending_variance') return failure(route, 'A pending variance recommendation is required');
      const eligibility = this.varianceEligibility(actor);
      if (!eligibility.canReview || !eligibility.nextStage) return failure(route, 'The server did not find active independent variance authority', 403);
      const expectedStage = eligibility.nextStage;
      if (Number(payload.expected_version) !== Number(this.awardRecommendation.version) || !String(payload.note ?? '').trim()) return failure(route, 'The variance recommendation has changed; refresh before deciding');
      this.varianceDecisions.push({ id: `controlled-variance-${expectedStage}`, awardRecommendationId: this.awardRecommendation.id, decisionType: expectedStage, decision: String(payload.decision), rationale: String(payload.note), decidedByName: actor.name, decidedAt: '2026-08-22T05:00:00.000Z', doaMatrixVersion: 'OPS-2026.08', doaAssignmentId: `controlled-${expectedStage}-assignment` });
      this.awardRecommendation.version = Number(this.awardRecommendation.version) + 1;
      this.awardRecommendation.status = payload.decision === 'rejected' ? 'rejected' : expectedStage === 'finance' ? 'approved' : 'pending_variance';
      return response(route, this.awardRecommendation);
    }
    if (name === 'transition_sourcing_event') {
      if (!this.sourcing) return failure(route, 'Sourcing event is required');
      if (payload.action === 'issue') this.sourcing.status = 'issued';
      if (payload.action === 'response_closed') {
        if (this.sourcing.responses.filter((item) => item.receivedAt).length < 3) return failure(route, 'Three received responses are required');
        this.sourcing.status = 'response_closed';
      }
      if (payload.action === 'evaluation') {
        if (this.sourcing.status !== 'response_closed') return failure(route, 'Response closure is required before evaluation');
        this.sourcing.status = 'evaluation';
      }
      if (payload.action === 'award') {
        if (this.sourcing.status !== 'evaluation') return failure(route, 'Controlled evaluation is required before award');
        if (this.sourcing.responses.filter((item) => item.receivedAt).length < 3) return failure(route, 'Three received responses are required');
        if (this.awardRecommendation?.status !== 'approved' || this.awardRecommendation.recommendedVendorId !== payload.selected_vendor_id) return failure(route, 'An approved best-value recommendation is required before award');
        this.sourcing.status = 'awarded';
        this.sourcing.selectedVendorId = String(payload.selected_vendor_id);
        this.sourcing.closureNote = String(payload.closure_note);
      }
      if (payload.action === 'failed_bid') this.sourcing.status = 'failed_bid';
      if (payload.action === 'source_additional_and_requote') {
        const vendorId = String(payload.vendor_id);
        const vendor = this.rowsFor('vendors', new URL(`${CONTROLLED_SUPABASE_URL}/rest/v1/vendors`)).find((item) => item.id === vendorId);
        if (this.sourcing.responses.some((item) => item.vendorId === vendorId)) return failure(route, 'Select an additional vendor who has not already been invited');
        this.sourcing.responses.push({ id: `response-${vendorId}`, vendorId, vendorName: String(vendor?.legal_name ?? vendorId), invitedAt: '2026-08-22T01:10:00.000Z' });
        this.sourcing.status = 'issued';
        this.sourcing.submissionDeadline = String(payload.submission_deadline);
        this.sourcing.packageVersion = String(payload.package_version);
        this.sourcing.packageHash = String(payload.package_hash);
      }
      if (payload.action === 'cancel') this.sourcing.status = 'cancelled';
      return response(route, this.workspace());
    }
    if (name === 'get_effective_policy_profile') return response(route, this.effectiveProfile());
    if (name === 'save_policy_profile') {
      if (!(actor.capabilities.core?.includes('manage_rbac') || actor.capabilities.legal?.includes('manage_doa'))) return failure(route, 'Not authorized to save a policy profile', 403);
      if (payload.source_profile_id !== this.parentProfileId) return failure(route, 'Governed parent source profile is required');
      const profile: FixtureProfile = {
        id: '10000000-0000-4000-8000-000000000004',
        code: String(payload.code),
        version: String(payload.version),
        name: String(payload.name),
        relationship: 'mwell_operating',
        source_profile_id: this.parentProfileId,
        source_filename: String(payload.source_filename),
        source_organization: String(payload.source_organization),
        control_sources: (payload.control_sources ?? CONTROL_SOURCES) as Record<string, string>,
        status: 'draft',
        effective_from: String(payload.effective_from),
        created_by: actor.id,
        last_modified_by: actor.id,
        activated_by: null,
        ...controls(),
      };
      this.profiles.push(profile);
      this.events.unshift({ id: 'event-draft-saved', policy_profile_id: profile.id, event_type: 'draft_saved', actor_id: actor.id, profile_actor_id: actor.id, event_at: '2026-08-22T03:00:00.000Z' });
      return response(route, profile);
    }
    if (name === 'resolve_policy_conflict') {
      if (!(actor.capabilities.core?.includes('manage_rbac') || actor.capabilities.legal?.includes('manage_doa'))) return failure(route, 'Not authorized to resolve a policy conflict', 403);
      const conflict = this.conflicts.find((item) => item.id === payload.id);
      if (!conflict) return failure(route, 'Recorded policy conflict not found');
      conflict.status = 'resolved';
      this.events.unshift({ id: 'event-conflict-resolved', policy_profile_id: '10000000-0000-4000-8000-000000000004', event_type: 'conflict_resolved', actor_id: actor.id, profile_actor_id: actor.id, event_at: '2026-08-22T03:05:00.000Z' });
      return response(route, { ...conflict });
    }
    if (name === 'activate_policy_profile') {
      const profile = this.profileById(String(payload.id));
      if (!profile) return failure(route, 'Policy profile not found');
      if (!(actor.capabilities.core?.includes('manage_rbac') || actor.capabilities.legal?.includes('manage_doa'))) return failure(route, 'Not authorized to activate a policy profile', 403);
      if (profile.last_modified_by === actor.id) return failure(route, 'A separate policy checker must activate the profile');
      if (this.conflicts.some((item) => item.status === 'open')) return failure(route, 'Resolve recorded policy conflicts before activation');
      for (const candidate of this.profiles) {
        if (candidate.id !== profile.id && candidate.relationship === 'mwell_operating' && candidate.status === 'active') candidate.status = 'superseded';
      }
      profile.status = 'active';
      profile.activated_by = actor.id;
      this.events.unshift({ id: 'event-activated', policy_profile_id: profile.id, event_type: 'activated', actor_id: actor.id, profile_actor_id: actor.id, event_at: '2026-08-22T03:10:00.000Z' });
      return response(route, { ...profile });
    }
    if (name === 'purchase_order_receipt_status' || name === 'payment_readiness_staleness_work_items' || name === 'commitment_readiness') return response(route, []);
    return response(route, null);
  }
}

export async function installControlledRpc(context: BrowserContext, fixture: ControlledProcurementRpcFixture, actor: ActorKey) {
  await context.route(`${CONTROLLED_SUPABASE_URL}/**`, (route) => fixture.handle(route));
  await context.route('**/rest/v1/**', (route) => fixture.handle(route));
}

export function actor(key: ActorKey) {
  return ACTORS[key];
}
