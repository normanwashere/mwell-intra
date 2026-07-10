-- Policy-aligned Vendor, Legal, Procurement, acceptance, and payment-readiness contract.
-- Additive only: existing evidence is preserved and incompatible open work is queued for review.

create extension if not exists pgcrypto;

alter table legal.signed_instruments
  add column if not exists document_hash text,
  add column if not exists signer_party text;
create unique index if not exists legal_signed_instrument_party_hash_idx
  on legal.signed_instruments(case_id, code, document_hash, signer_party)
  where revoked_at is null and document_hash is not null and signer_party is not null;

create table if not exists legal.policy_definitions (
  id text not null,
  version text not null,
  source_document text not null,
  owner text not null,
  effective_at timestamptz not null,
  definition jsonb not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (id, version)
);

create table if not exists legal.vendor_application_snapshots (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references legal.accreditation_cases(id) on delete restrict,
  vendor_id uuid not null references core.vendors(id) on delete restrict,
  policy_id text not null,
  policy_version text not null,
  payload jsonb not null,
  document_hash text not null,
  status text not null default 'draft',
  signed_by_name text,
  signed_by_title text,
  signed_at timestamptz,
  submitted_at timestamptz,
  created_by uuid not null default auth.uid() references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint vendor_application_hash_check check (document_hash ~ '^[0-9a-f]{64}$'),
  constraint vendor_application_status_check check (status in ('draft','submitted','superseded','policy_review_required')),
  foreign key (policy_id, policy_version) references legal.policy_definitions(id, version) on delete restrict
);

create table if not exists legal.vendor_technology_qualifications (
  id uuid primary key default gen_random_uuid(),
  application_snapshot_id uuid not null references legal.vendor_application_snapshots(id) on delete restrict,
  pool text not null,
  qualified boolean not null,
  remarks text not null default '',
  reviewed_by uuid references core.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  constraint vendor_technology_pool_check check (pool in ('nodejs','php_laravel','mobile')),
  unique (application_snapshot_id, pool)
);

create table if not exists legal.accreditation_dispositions (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references legal.accreditation_cases(id) on delete restrict,
  requirement_code text not null,
  disposition text not null,
  reason text not null,
  equivalent_document_id text references legal.accreditation_docs(id) on delete restrict,
  conditions jsonb not null default '{}'::jsonb,
  follow_up_due_at timestamptz,
  decided_by uuid not null default auth.uid() references core.profiles(id) on delete restrict,
  decided_at timestamptz not null default now(),
  constraint accreditation_disposition_check check (
    disposition in ('approved','correction_required','not_applicable','foreign_equivalent','temporary_clearance','waived')
  )
);

create table if not exists legal.instrument_documents (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references legal.accreditation_cases(id) on delete restrict,
  code text not null,
  template_version text not null,
  policy_version text not null,
  canonical_text text not null,
  fields jsonb not null,
  document_hash text not null,
  status text not null default 'awaiting_service_provider',
  executed_at timestamptz,
  expires_at timestamptz,
  definitive_agreement_executed_at timestamptz,
  storage_path text,
  created_by uuid not null default auth.uid() references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint instrument_document_hash_check check (document_hash ~ '^[0-9a-f]{64}$'),
  constraint instrument_document_status_check check (
    status in ('awaiting_service_provider','awaiting_mphtc','executed','expired','terminated','superseded','policy_review_required')
  ),
  unique (case_id, code, document_hash)
);

create table if not exists legal.instrument_signatures (
  id uuid primary key default gen_random_uuid(),
  instrument_document_id uuid not null references legal.instrument_documents(id) on delete restrict,
  document_hash text not null,
  signer_party text not null,
  signer_user_id uuid not null default auth.uid() references core.profiles(id) on delete restrict,
  signer_name text not null,
  signer_title text,
  signer_email text,
  signature_method text not null,
  signature_storage_path text,
  signed_at timestamptz not null default now(),
  signer_ua text,
  revoked_at timestamptz,
  revoked_by uuid references core.profiles(id) on delete restrict,
  constraint instrument_signature_hash_check check (document_hash ~ '^[0-9a-f]{64}$'),
  constraint instrument_signature_party_check check (signer_party in ('service_provider','mphtc')),
  constraint instrument_signature_method_check check (signature_method in ('drawn','typed')),
  unique (instrument_document_id, signer_party)
);

create table if not exists legal.instrument_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  instrument_document_id uuid not null references legal.instrument_documents(id) on delete restrict,
  document_hash text not null,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  due_at timestamptz,
  completed_at timestamptz,
  evidence_storage_path text,
  retention_basis text,
  actor_id uuid not null default auth.uid() references core.profiles(id) on delete restrict,
  constraint instrument_lifecycle_hash_check check (document_hash ~ '^[0-9a-f]{64}$'),
  constraint instrument_lifecycle_type_check check (
    event_type in ('definitive_agreement_executed','expired','terminated','return_or_destroy_requested','return_or_destroy_completed','retention_exception_recorded')
  )
);

create table if not exists procurement.route_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references procurement.requests(id) on delete restrict,
  policy_version text not null,
  request_version int not null default 1,
  method text not null,
  reasons text[] not null,
  risk_facts jsonb not null default '{}'::jsonb,
  status text not null default 'confirmed',
  confirmed_by uuid not null default auth.uid() references core.profiles(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  constraint route_method_check check (method in ('rfq','rfp','direct_award','repeat_order','emergency','petty_cash')),
  constraint route_status_check check (status in ('confirmed','superseded','policy_decision_required')),
  unique (request_id, request_version)
);

create table if not exists procurement.sourcing_events (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references procurement.requests(id) on delete restrict,
  route_decision_id uuid not null references procurement.route_decisions(id) on delete restrict,
  issued_at timestamptz,
  submission_deadline timestamptz,
  intended_responses int,
  clarification_log jsonb not null default '[]'::jsonb,
  status text not null default 'draft',
  created_by uuid not null default auth.uid() references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint sourcing_intended_responses_check check (intended_responses is null or intended_responses > 0),
  constraint sourcing_event_status_check check (status in ('draft','issued','closed','cancelled'))
);

create table if not exists procurement.sourcing_responses (
  id uuid primary key default gen_random_uuid(),
  sourcing_event_id uuid not null references procurement.sourcing_events(id) on delete restrict,
  vendor_id uuid not null references core.vendors(id) on delete restrict,
  invited_at timestamptz,
  received_at timestamptz,
  deadline_compliant boolean,
  proposal_storage_path text,
  commercial jsonb not null default '{}'::jsonb,
  technical jsonb not null default '{}'::jsonb,
  material_exceptions jsonb not null default '[]'::jsonb,
  unique (sourcing_event_id, vendor_id)
);

create table if not exists procurement.exception_packs (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references procurement.requests(id) on delete restrict,
  exception_type text not null,
  vendor_id uuid references core.vendors(id) on delete restrict,
  justification text not null,
  evidence jsonb not null default '{}'::jsonb,
  price_reasonableness text,
  accreditation_state text,
  risks_and_mitigations jsonb not null default '{}'::jsonb,
  finance_eligibility_confirmed boolean,
  non_recurring_non_split_attested boolean,
  procurement_head_reviewed_by uuid references core.profiles(id) on delete restrict,
  procurement_head_reviewed_at timestamptz,
  final_approval_step_id text references procurement.approval_steps(id) on delete restrict,
  status text not null default 'draft',
  constraint procurement_exception_type_check check (
    exception_type in ('direct_award','sole_supplier','emergency','repeat_continuity','insufficient_bids','petty_cash_non_accredited')
  ),
  constraint procurement_exception_status_check check (status in ('draft','under_review','approved','rejected','superseded'))
);

create table if not exists procurement.doa_matrices (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  source_document text not null,
  approved_by_name text not null,
  approved_at timestamptz not null,
  effective_at timestamptz not null,
  expires_at timestamptz,
  active boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists procurement.doa_assignments (
  id uuid primary key default gen_random_uuid(),
  matrix_id uuid not null references procurement.doa_matrices(id) on delete restrict,
  department text,
  category text,
  min_amount numeric(14,2) not null default 0,
  max_amount numeric(14,2),
  tier text not null,
  approver_user_id uuid not null references core.profiles(id) on delete restrict,
  active boolean not null default true,
  constraint doa_assignment_amount_check check (min_amount >= 0 and (max_amount is null or max_amount >= min_amount)),
  constraint doa_assignment_tier_check check (tier in ('dept_head','procurement_head','finance','legal','final_approver'))
);

create table if not exists procurement.financial_protection_requirements (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references procurement.requests(id) on delete restrict,
  protection_type text not null,
  trigger_basis text not null,
  required_amount numeric(14,2),
  required_percentage numeric(7,4),
  due_before text not null,
  status text not null default 'required',
  evidence_storage_path text,
  reviewed_by uuid references core.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  waiver_reason text,
  constraint financial_protection_type_check check (
    protection_type in ('payment_bond','down_payment_bond','performance_bond','warranty_bond','sblc','cari','eari','contractor_equipment','other_insurance')
  ),
  constraint financial_protection_status_check check (status in ('required','provided','approved','waived','expired','claim_pending','claimed'))
);

create table if not exists procurement.acceptance_packs (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id text not null references procurement.purchase_orders(id) on delete restrict,
  request_id text references procurement.requests(id) on delete restrict,
  warehouse_receipt_reference text,
  acceptance_type text not null,
  accepted_scope jsonb not null,
  exceptions jsonb not null default '[]'::jsonb,
  accepted_by uuid not null default auth.uid() references core.profiles(id) on delete restrict,
  accepted_at timestamptz not null default now(),
  document_hash text not null,
  status text not null default 'accepted',
  constraint acceptance_hash_check check (document_hash ~ '^[0-9a-f]{64}$'),
  constraint acceptance_type_check check (acceptance_type in ('goods_receipt','service_completion','technical_acceptance','partial_acceptance')),
  constraint acceptance_status_check check (status in ('accepted','accepted_with_exceptions','rejected','superseded'))
);

create table if not exists procurement.payment_readiness_packs (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id text not null references procurement.purchase_orders(id) on delete restrict,
  acceptance_pack_id uuid not null references procurement.acceptance_packs(id) on delete restrict,
  policy_version text not null,
  po_match boolean not null default false,
  invoice_or_si_storage_path text,
  milestone_support_storage_path text,
  tax_withholding_support_storage_path text,
  payment_terms jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  prepared_by uuid not null default auth.uid() references core.profiles(id) on delete restrict,
  prepared_at timestamptz not null default now(),
  finance_reviewed_by uuid references core.profiles(id) on delete restrict,
  finance_reviewed_at timestamptz,
  finance_note text,
  corrected_from uuid references procurement.payment_readiness_packs(id) on delete restrict,
  constraint payment_readiness_status_check check (status in ('draft','ready_for_finance','returned','accepted','released','superseded'))
);

create table if not exists core.policy_remediation_queue (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  entity_type text not null,
  entity_id text not null,
  policy_version text not null,
  reason_code text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  assigned_to uuid references core.profiles(id) on delete restrict,
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz not null default now(),
  constraint policy_remediation_status_check check (status in ('open','in_review','resolved','waived')),
  unique (module, entity_type, entity_id, policy_version, reason_code)
);

create index if not exists legal_vendor_application_case_idx on legal.vendor_application_snapshots(case_id, created_at desc);
create index if not exists legal_instrument_document_case_idx on legal.instrument_documents(case_id, code, created_at desc);
create index if not exists legal_instrument_signature_document_idx on legal.instrument_signatures(instrument_document_id, signed_at);
create index if not exists legal_instrument_lifecycle_due_idx on legal.instrument_lifecycle_events(due_at) where completed_at is null;
create index if not exists procurement_route_request_idx on procurement.route_decisions(request_id, request_version desc);
create index if not exists procurement_sourcing_request_idx on procurement.sourcing_events(request_id, created_at desc);
create index if not exists procurement_exception_request_idx on procurement.exception_packs(request_id, status);
create index if not exists procurement_acceptance_po_idx on procurement.acceptance_packs(purchase_order_id, accepted_at desc);
create index if not exists procurement_payment_readiness_po_idx on procurement.payment_readiness_packs(purchase_order_id, prepared_at desc);
create index if not exists core_policy_remediation_open_idx on core.policy_remediation_queue(module, status, created_at desc);

-- Seed controlling definitions without activating an unapproved DOA matrix.
insert into legal.policy_definitions(id, version, source_document, owner, effective_at, definition, active)
values (
  'vendor-accreditation', '2025', 'LGL004-Vendor Accreditation Form 2.0 (3).pdf',
  'Vendor Management Office / Legal', '2025-01-01T00:00:00Z',
  jsonb_build_object('policy_version','vendor-accreditation-v2025','entity_types',jsonb_build_array('sole_prop','partnership','corporation')),
  true
)
on conflict (id, version) do update set
  source_document = excluded.source_document,
  owner = excluded.owner,
  definition = excluded.definition;

-- Preserve old records and route open work for explicit review.
insert into core.policy_remediation_queue(module, entity_type, entity_id, policy_version, reason_code, details)
select 'legal', 'accreditation_case', c.id, 'vendor-accreditation-v2025', 'missing_policy_snapshot',
       jsonb_build_object('status', c.status)
from legal.accreditation_cases c
where c.status in ('draft','submitted','under_review','provisional','renewal_due')
  and not exists (select 1 from legal.vendor_application_snapshots s where s.case_id = c.id)
on conflict do nothing;

insert into core.policy_remediation_queue(module, entity_type, entity_id, policy_version, reason_code, details)
select 'procurement', 'request', r.id, 'procurement-policy-revised-2026', 'unsupported_route_or_doa',
       jsonb_build_object('status', r.status, 'sourcing_method', r.sourcing_method)
from procurement.requests r
where r.status in ('draft','submitted','under_review')
  and (r.sourcing_method = 'small_purchase' or not exists (
    select 1 from procurement.route_decisions d where d.request_id = r.id
  ))
on conflict do nothing;

-- Read policies: vendors see only records attached to their vendor; department users use scoped capabilities.
alter table legal.policy_definitions enable row level security;
alter table legal.policy_definitions force row level security;
alter table legal.vendor_application_snapshots enable row level security;
alter table legal.vendor_application_snapshots force row level security;
alter table legal.vendor_technology_qualifications enable row level security;
alter table legal.vendor_technology_qualifications force row level security;
alter table legal.accreditation_dispositions enable row level security;
alter table legal.accreditation_dispositions force row level security;
alter table legal.instrument_documents enable row level security;
alter table legal.instrument_documents force row level security;
alter table legal.instrument_signatures enable row level security;
alter table legal.instrument_signatures force row level security;
alter table legal.instrument_lifecycle_events enable row level security;
alter table legal.instrument_lifecycle_events force row level security;
alter table procurement.route_decisions enable row level security;
alter table procurement.route_decisions force row level security;
alter table procurement.sourcing_events enable row level security;
alter table procurement.sourcing_events force row level security;
alter table procurement.sourcing_responses enable row level security;
alter table procurement.sourcing_responses force row level security;
alter table procurement.exception_packs enable row level security;
alter table procurement.exception_packs force row level security;
alter table procurement.doa_matrices enable row level security;
alter table procurement.doa_matrices force row level security;
alter table procurement.doa_assignments enable row level security;
alter table procurement.doa_assignments force row level security;
alter table procurement.financial_protection_requirements enable row level security;
alter table procurement.financial_protection_requirements force row level security;
alter table procurement.acceptance_packs enable row level security;
alter table procurement.acceptance_packs force row level security;
alter table procurement.payment_readiness_packs enable row level security;
alter table procurement.payment_readiness_packs force row level security;

alter table core.policy_remediation_queue enable row level security;
alter table core.policy_remediation_queue force row level security;

create policy legal_policy_definitions_read on legal.policy_definitions
  for select to authenticated using (active or core.has_cap('legal','review_accreditation'));
create policy legal_vendor_applications_read on legal.vendor_application_snapshots
  for select to authenticated using (
    core.has_cap('legal','review_accreditation') or vendor_id = core.current_vendor_id()
  );
create policy legal_technology_qualifications_read on legal.vendor_technology_qualifications
  for select to authenticated using (
    exists (
      select 1 from legal.vendor_application_snapshots s
      where s.id = application_snapshot_id
        and (core.has_cap('legal','review_accreditation') or s.vendor_id = core.current_vendor_id())
    )
  );
create policy legal_dispositions_read on legal.accreditation_dispositions
  for select to authenticated using (
    core.has_cap('legal','review_accreditation') or exists (
      select 1 from legal.accreditation_cases c where c.id = case_id and c.vendor_id = core.current_vendor_id()
    )
  );
create policy legal_instrument_documents_read on legal.instrument_documents
  for select to authenticated using (
    core.has_cap('legal','review_accreditation') or exists (
      select 1 from legal.accreditation_cases c where c.id = case_id and c.vendor_id = core.current_vendor_id()
    )
  );
create policy legal_instrument_signatures_read on legal.instrument_signatures
  for select to authenticated using (
    exists (
      select 1 from legal.instrument_documents d join legal.accreditation_cases c on c.id = d.case_id
      where d.id = instrument_document_id
        and (core.has_cap('legal','review_accreditation') or c.vendor_id = core.current_vendor_id())
    )
  );
create policy legal_instrument_lifecycle_read on legal.instrument_lifecycle_events
  for select to authenticated using (
    exists (
      select 1 from legal.instrument_documents d join legal.accreditation_cases c on c.id = d.case_id
      where d.id = instrument_document_id
        and (core.has_cap('legal','review_accreditation') or c.vendor_id = core.current_vendor_id())
    )
  );

create policy procurement_route_read on procurement.route_decisions for select to authenticated
  using (core.has_module_role('procurement') or exists (select 1 from procurement.requests r where r.id = request_id and r.requester_id = auth.uid()));
create policy procurement_sourcing_events_read on procurement.sourcing_events for select to authenticated
  using (core.has_module_role('procurement'));
create policy procurement_sourcing_responses_read on procurement.sourcing_responses for select to authenticated
  using (core.has_module_role('procurement'));
create policy procurement_exception_packs_read on procurement.exception_packs for select to authenticated
  using (core.has_module_role('procurement') or core.has_cap('legal','review_accreditation'));
create policy procurement_doa_matrices_read on procurement.doa_matrices for select to authenticated
  using (core.has_module_role('procurement'));
create policy procurement_doa_assignments_read on procurement.doa_assignments for select to authenticated
  using (core.has_module_role('procurement'));
create policy procurement_financial_protection_read on procurement.financial_protection_requirements for select to authenticated
  using (core.has_module_role('procurement') or core.has_cap('legal','review_accreditation'));
create policy procurement_acceptance_read on procurement.acceptance_packs for select to authenticated
  using (core.has_module_role('procurement') or core.has_module_role('warehouse'));
create policy procurement_payment_readiness_read on procurement.payment_readiness_packs for select to authenticated
  using (core.has_module_role('procurement') or core.has_module_role('warehouse'));
create policy core_policy_remediation_read on core.policy_remediation_queue for select to authenticated
  using (core.has_cap('core','manage_users') or core.has_module_role(module));

-- Controlled commands. All wrappers delegate to private implementations with an empty search_path.
create or replace function private.policy_submit_vendor_application(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_case legal.accreditation_cases; v_snapshot legal.vendor_application_snapshots; v_hash text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_case from legal.accreditation_cases where id = payload->>'case_id' for update;
  if v_case.id is null then raise exception 'Accreditation case not found'; end if;
  if v_case.vendor_id <> core.current_vendor_id() and not core.has_cap('legal','review_accreditation') then
    raise exception 'Not authorized for this vendor';
  end if;
  if coalesce(payload#>>'{declaration,accepted}','false')::boolean is not true
     or coalesce(payload#>>'{declaration,verificationAuthorized}','false')::boolean is not true then
    raise exception 'Signed declaration and verification authorization are required';
  end if;
  v_hash := encode(digest(convert_to(payload::text, 'UTF8'), 'sha256'), 'hex');
  update legal.vendor_application_snapshots set status = 'superseded'
   where case_id = v_case.id and status in ('draft','submitted');
  insert into legal.vendor_application_snapshots(
    case_id,vendor_id,policy_id,policy_version,payload,document_hash,status,
    signed_by_name,signed_by_title,signed_at,submitted_at,created_by
  ) values (
    v_case.id,v_case.vendor_id,'vendor-accreditation','2025',payload->'application',v_hash,'submitted',
    payload#>>'{declaration,signerName}',payload#>>'{declaration,signerTitle}',now(),now(),auth.uid()
  ) returning * into v_snapshot;
  update legal.accreditation_cases set status = 'submitted', submitted_at = now(), updated_at = now() where id = v_case.id;
  insert into legal.case_timeline(case_id,actor_email,action,detail)
  values(v_case.id,auth.jwt()->>'email','policy_application_submitted','Vendor Accreditation Form v.2025 snapshot ' || v_hash);
  return to_jsonb(v_snapshot);
end;
$$;

create or replace function legal.submit_vendor_application(payload jsonb)
returns jsonb language sql security invoker
as $$ select private.policy_submit_vendor_application(payload) $$;

create or replace function private.policy_record_instrument_signature(payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_doc legal.instrument_documents; v_signature legal.instrument_signatures; v_party text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_doc from legal.instrument_documents where id = (payload->>'instrument_document_id')::uuid for update;
  if v_doc.id is null then raise exception 'Instrument not found'; end if;
  if payload->>'document_hash' <> v_doc.document_hash then raise exception 'Signature document hash mismatch'; end if;
  v_party := payload->>'signer_party';
  if v_party = 'service_provider' then
    if not exists (select 1 from legal.accreditation_cases c where c.id=v_doc.case_id and c.vendor_id=core.current_vendor_id()) then
      raise exception 'Not authorized as service provider';
    end if;
  elsif v_party = 'mphtc' then
    if not core.has_cap('legal','approve_accreditation') then raise exception 'Not authorized to countersign'; end if;
    if not exists (select 1 from legal.instrument_signatures s where s.instrument_document_id=v_doc.id and s.signer_party='service_provider' and s.revoked_at is null) then
      raise exception 'Service provider must sign first';
    end if;
  else raise exception 'Invalid signer party';
  end if;
  insert into legal.instrument_signatures(
    instrument_document_id,document_hash,signer_party,signer_user_id,signer_name,signer_title,signer_email,signature_method,signature_storage_path,signer_ua
  ) values (
    v_doc.id,v_doc.document_hash,v_party,auth.uid(),payload->>'signer_name',payload->>'signer_title',auth.jwt()->>'email',
    payload->>'signature_method',payload->>'signature_storage_path',payload->>'signer_ua'
  ) returning * into v_signature;
  update legal.instrument_documents set
    status = case when v_party='mphtc' then 'executed' else 'awaiting_mphtc' end,
    executed_at = case when v_party='mphtc' then now() else executed_at end,
    expires_at = case when v_party='mphtc' then now() + interval '2 years' else expires_at end
  where id=v_doc.id;
  return to_jsonb(v_signature);
end;
$$;

create or replace function legal.record_instrument_signature(payload jsonb)
returns jsonb language sql security invoker
as $$ select private.policy_record_instrument_signature(payload) $$;

create or replace function private.policy_sign_instrument_compat(payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_doc legal.instrument_documents; v_legacy legal.signed_instruments; v_hash text; v_party text;
begin
  v_hash := payload->>'document_hash';
  v_party := payload->>'signer_party';
  if v_hash is null or v_party is null then raise exception 'Governed instrument hash and signer party are required'; end if;
  if v_party = 'service_provider' then
    if encode(digest(convert_to(coalesce(payload->>'canonical_text',''),'UTF8'),'sha256'),'hex') <> v_hash then
      raise exception 'Canonical instrument hash mismatch';
    end if;
    insert into legal.instrument_documents(
      case_id,code,template_version,policy_version,canonical_text,fields,document_hash,status,created_by
    ) values (
      payload->>'case_id',payload->>'code',payload->>'template_version','mnda-tech-service-provider-2026',
      payload->>'canonical_text',coalesce(payload->'fields','{}'::jsonb),v_hash,'awaiting_service_provider',auth.uid()
    )
    on conflict (case_id,code,document_hash) do update set fields=excluded.fields
    returning * into v_doc;
  else
    select * into v_doc from legal.instrument_documents
    where case_id=payload->>'case_id' and code=payload->>'code' and document_hash=v_hash
    for update;
  end if;
  if v_doc.id is null then raise exception 'Governed instrument document not found'; end if;
  perform private.policy_record_instrument_signature(
    payload || jsonb_build_object('instrument_document_id',v_doc.id,'signature_storage_path',null)
  );
  insert into legal.signed_instruments(
    case_id,code,template_version,signer_name,signer_email,signer_title,signature_png,
    signature_method,signed_at,signer_ua,fields,document_hash,signer_party
  ) values (
    payload->>'case_id',payload->>'code',payload->>'template_version',payload->>'signer_name',
    coalesce(payload->>'signer_email',auth.jwt()->>'email'),payload->>'signer_title',payload->>'signature_png',
    payload->>'signature_method',now(),payload->>'signer_ua',payload->'fields',v_hash,v_party
  ) returning * into v_legacy;
  return to_jsonb(v_legacy);
end;
$$;

create or replace function legal.sign_instrument(payload jsonb)
returns jsonb language sql security invoker
as $$ select private.policy_sign_instrument_compat(payload) $$;

create or replace function private.policy_confirm_route_decision(payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_request procurement.requests; v_route procurement.route_decisions; v_method text; v_risk boolean;
begin
  if not core.has_cap('procurement','manage_rfp') and not core.has_cap('procurement','admin') then
    raise exception 'Not authorized to confirm sourcing route';
  end if;
  select * into v_request from procurement.requests where id=payload->>'request_id' for update;
  if v_request.id is null then raise exception 'Request not found'; end if;
  v_method := payload->>'method';
  v_risk := coalesce((payload#>>'{risk_facts,complex}')::boolean,false)
    or coalesce((payload#>>'{risk_facts,technical}')::boolean,false)
    or coalesce((payload#>>'{risk_facts,strategic}')::boolean,false)
    or coalesce((payload#>>'{risk_facts,high_risk}')::boolean,false)
    or coalesce((payload#>>'{risk_facts,data_sensitive}')::boolean,false);
  if v_method='small_purchase' then raise exception 'Unsupported sourcing method: small_purchase'; end if;
  if (coalesce(v_request.estimated_amount,0) >= 1000000 or v_risk) and v_method not in ('rfp','direct_award','emergency','repeat_order') then
    raise exception 'RFP or an approved exception is required';
  end if;
  if coalesce(v_request.estimated_amount,0) < 1000000 and not v_risk and v_method='rfp' then
    null; -- Procurement may choose RFP below threshold; the reason remains auditable.
  end if;
  insert into procurement.route_decisions(request_id,policy_version,request_version,method,reasons,risk_facts,status,confirmed_by)
  values(v_request.id,'procurement-policy-revised-2026',coalesce((payload->>'request_version')::int,1),v_method,
    array(select jsonb_array_elements_text(coalesce(payload->'reasons','[]'::jsonb))),coalesce(payload->'risk_facts','{}'::jsonb),'confirmed',auth.uid())
  returning * into v_route;
  update procurement.requests set sourcing_method=v_method,sourcing_override=true,updated_at=now() where id=v_request.id;
  return to_jsonb(v_route);
end;
$$;

create or replace function procurement.confirm_route_decision(payload jsonb)
returns jsonb language sql security invoker
as $$ select private.policy_confirm_route_decision(payload) $$;

create or replace function private.policy_record_acceptance_pack(payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_po procurement.purchase_orders; v_pack procurement.acceptance_packs; v_hash text;
begin
  select * into v_po from procurement.purchase_orders where id=payload->>'purchase_order_id' for update;
  if v_po.id is null then raise exception 'Purchase order not found'; end if;
  if not core.has_module_role('warehouse') and auth.uid() <> (select requester_id from procurement.requests where id=v_po.request_id) then
    raise exception 'Not authorized to record acceptance';
  end if;
  v_hash := encode(digest(convert_to((payload->'accepted_scope')::text,'UTF8'),'sha256'),'hex');
  insert into procurement.acceptance_packs(
    purchase_order_id,request_id,warehouse_receipt_reference,acceptance_type,accepted_scope,exceptions,accepted_by,document_hash,status
  ) values (
    v_po.id,v_po.request_id,payload->>'warehouse_receipt_reference',payload->>'acceptance_type',payload->'accepted_scope',
    coalesce(payload->'exceptions','[]'::jsonb),auth.uid(),v_hash,
    case when jsonb_array_length(coalesce(payload->'exceptions','[]'::jsonb))>0 then 'accepted_with_exceptions' else 'accepted' end
  ) returning * into v_pack;
  return to_jsonb(v_pack);
end;
$$;

create or replace function procurement.record_acceptance_pack(payload jsonb)
returns jsonb language sql security invoker
as $$ select private.policy_record_acceptance_pack(payload) $$;

create or replace function private.policy_review_payment_readiness(payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_pack procurement.payment_readiness_packs; v_status text;
begin
  if not core.has_cap('procurement','view_finance') and not core.has_cap('procurement','admin') then
    raise exception 'Not authorized to review payment readiness';
  end if;
  v_status := payload->>'status';
  if v_status not in ('returned','accepted','released') then raise exception 'Invalid Finance readiness decision'; end if;
  update procurement.payment_readiness_packs set
    status=v_status,finance_reviewed_by=auth.uid(),finance_reviewed_at=now(),finance_note=payload->>'note'
  where id=(payload->>'id')::uuid returning * into v_pack;
  if v_pack.id is null then raise exception 'Payment readiness pack not found'; end if;
  if v_status in ('accepted','released') and (
    not v_pack.po_match or v_pack.invoice_or_si_storage_path is null or
    v_pack.tax_withholding_support_storage_path is null
  ) then raise exception 'Payment readiness evidence is incomplete'; end if;
  return to_jsonb(v_pack);
end;
$$;

create or replace function procurement.review_payment_readiness(payload jsonb)
returns jsonb language sql security invoker
as $$ select private.policy_review_payment_readiness(payload) $$;

-- No direct authenticated writes. Reads remain constrained by RLS; commands use guarded functions.
revoke all on legal.policy_definitions, legal.vendor_application_snapshots, legal.vendor_technology_qualifications,
  legal.accreditation_dispositions, legal.instrument_documents, legal.instrument_signatures,
  legal.instrument_lifecycle_events from public, anon, authenticated;
grant select on legal.policy_definitions, legal.vendor_application_snapshots, legal.vendor_technology_qualifications,
  legal.accreditation_dispositions, legal.instrument_documents, legal.instrument_signatures,
  legal.instrument_lifecycle_events to authenticated;
grant all on legal.policy_definitions, legal.vendor_application_snapshots, legal.vendor_technology_qualifications,
  legal.accreditation_dispositions, legal.instrument_documents, legal.instrument_signatures,
  legal.instrument_lifecycle_events to service_role;

revoke all on procurement.route_decisions, procurement.sourcing_events, procurement.sourcing_responses,
  procurement.exception_packs, procurement.doa_matrices, procurement.doa_assignments,
  procurement.financial_protection_requirements, procurement.acceptance_packs,
  procurement.payment_readiness_packs from public, anon, authenticated;
grant select on procurement.route_decisions, procurement.sourcing_events, procurement.sourcing_responses,
  procurement.exception_packs, procurement.doa_matrices, procurement.doa_assignments,
  procurement.financial_protection_requirements, procurement.acceptance_packs,
  procurement.payment_readiness_packs to authenticated;
grant all on procurement.route_decisions, procurement.sourcing_events, procurement.sourcing_responses,
  procurement.exception_packs, procurement.doa_matrices, procurement.doa_assignments,
  procurement.financial_protection_requirements, procurement.acceptance_packs,
  procurement.payment_readiness_packs to service_role;

revoke all on core.policy_remediation_queue from public, anon, authenticated;
grant select on core.policy_remediation_queue to authenticated;
grant all on core.policy_remediation_queue to service_role;

revoke all on function private.policy_submit_vendor_application(jsonb) from public, anon;
revoke all on function legal.submit_vendor_application(jsonb) from public, anon;
grant execute on function legal.submit_vendor_application(jsonb) to authenticated, service_role;
revoke all on function private.policy_record_instrument_signature(jsonb) from public, anon;
revoke all on function legal.record_instrument_signature(jsonb) from public, anon;
grant execute on function legal.record_instrument_signature(jsonb) to authenticated, service_role;
revoke all on function private.policy_sign_instrument_compat(jsonb) from public, anon;
revoke all on function legal.sign_instrument(jsonb) from public, anon;
grant execute on function legal.sign_instrument(jsonb) to authenticated, service_role;
revoke all on function private.policy_confirm_route_decision(jsonb) from public, anon;
revoke all on function procurement.confirm_route_decision(jsonb) from public, anon;
grant execute on function procurement.confirm_route_decision(jsonb) to authenticated, service_role;
revoke all on function private.policy_record_acceptance_pack(jsonb) from public, anon;
revoke all on function procurement.record_acceptance_pack(jsonb) from public, anon;
grant execute on function procurement.record_acceptance_pack(jsonb) to authenticated, service_role;
revoke all on function private.policy_review_payment_readiness(jsonb) from public, anon;
revoke all on function procurement.review_payment_readiness(jsonb) from public, anon;
grant execute on function procurement.review_payment_readiness(jsonb) to authenticated, service_role;
