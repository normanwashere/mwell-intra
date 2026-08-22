import type { BrowserContext, Route } from '@playwright/test';

export const CONTROLLED_SUPABASE_URL = 'http://127.0.0.1:54321';
export const CONTROLLED_ANON_KEY = 'controlled-rpc-anon-key';

type ActorKey = 'procurement' | 'admin' | 'legal' | 'operations';
type Actor = {
  id: string;
  email: string;
  name: string;
  title: string;
  roles: Record<string, string[]>;
  capabilities: Record<string, string[]>;
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
};

type RpcCall = {
  actor: string;
  schema: string;
  name: string;
  payload: Record<string, unknown>;
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
    app_metadata: { roles: actor.roles, kind: 'employee' },
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

  async handle(route: Route) {
    const request = route.request();
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
    if (table === 'approval_steps' || table === 'purchase_orders' || table === 'acceptance_packs') return [];
    if (table === 'vendors') return [
      { id: 'vendor-1', legal_name: 'Acme Medical Supplies, Inc.', accreditation_status: 'approved' },
      { id: 'vendor-2', legal_name: 'North Star Logistics Corp.', accreditation_status: 'approved' },
      { id: 'vendor-3', legal_name: 'TechBridge IT Solutions, Inc.', accreditation_status: 'approved' },
      { id: 'vendor-4', legal_name: 'Pacific Clinical Devices, Inc.', accreditation_status: 'approved' },
    ];
    if (table === 'policy_profiles') return filtered(this.profileRows());
    if (table === 'policy_conflicts') return this.conflicts.map((conflict) => ({ ...conflict }));
    if (table === 'policy_profile_events') return this.events.map((event) => ({ ...event }));
    if (table === 'profiles') return Object.values(ACTORS).map((actor) => ({ id: actor.id, full_name: actor.name, title: actor.title, kind: 'employee', status: 'active' }));
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
    if (schema !== 'procurement') return response(route, null);

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
    if (name === 'sourcing_workspace') return response(route, this.workspace());
    if (name === 'insufficient_bid_exception') return response(route, null);
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
}

export function actor(key: ActorKey) {
  return ACTORS[key];
}
