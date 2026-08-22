-- MPIC Procurement Policy February 2025 alignment.
--
-- This is additive and deliberately leaves request route fields nullable until
-- the deterministic backfill in the next migration. Policy activation is the
-- only state transition that makes a profile effective.

create table if not exists procurement.policy_profiles (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version text not null,
  name text not null,
  relationship text not null,
  source_profile_id uuid references procurement.policy_profiles(id) on delete restrict,
  source_filename text not null,
  source_organization text not null,
  control_sources jsonb not null default '{}'::jsonb,
  formal_bid_amount numeric(14, 2),
  invite_target_min integer not null,
  invite_target_max integer not null,
  sealed_bid_minimum_responses integer not null,
  bid_window_working_days integer not null,
  max_extension_working_days integer not null,
  vendor_acknowledgement_hours integer not null,
  clarification_hours integer not null,
  tabulation_hours integer not null,
  technical_evaluation_working_days integer not null,
  po_acknowledgement_hours integer not null,
  repeat_order_max_amount numeric(14, 2) not null,
  repeat_order_max_age_days integer not null,
  petty_cash_max_amount numeric(14, 2) not null,
  po_invoice_threshold numeric(14, 2) not null,
  vendor_probation_months integer not null,
  status text not null default 'draft',
  effective_from timestamptz not null,
  effective_to timestamptz,
  document_hash text not null,
  created_by uuid not null references core.profiles(id) on delete restrict,
  last_modified_by uuid not null references core.profiles(id) on delete restrict,
  revision integer not null default 1,
  last_modified_at timestamptz not null default pg_catalog.now(),
  activated_by uuid references core.profiles(id) on delete restrict,
  activated_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint policy_profiles_relationship_check check (
    relationship in ('parent_source', 'mwell_operating')
  ),
  constraint policy_profiles_status_check check (
    status in ('draft', 'active', 'superseded', 'suspended')
  ),
  constraint policy_profiles_effective_window_check check (
    effective_to is null or effective_to > effective_from
  ),
  constraint policy_profiles_controls_check check (
    (formal_bid_amount is null or formal_bid_amount >= 0)
    and invite_target_min > 0
    and invite_target_max >= invite_target_min
    and sealed_bid_minimum_responses > 0
    and sealed_bid_minimum_responses <= invite_target_max
    and bid_window_working_days > 0
    and max_extension_working_days > 0
    and vendor_acknowledgement_hours > 0
    and clarification_hours > 0
    and tabulation_hours > 0
    and technical_evaluation_working_days > 0
    and po_acknowledgement_hours > 0
    and repeat_order_max_amount >= 0
    and repeat_order_max_age_days > 0
    and petty_cash_max_amount >= 0
    and po_invoice_threshold >= 0
    and vendor_probation_months > 0
  ),
  constraint policy_profiles_document_hash_check check (
    pg_catalog.length(pg_catalog.btrim(document_hash)) >= 32
  ),
  constraint policy_profiles_control_sources_check check (
    jsonb_typeof(control_sources) = 'object'
    and control_sources ?& array[
      'formalBidAmount', 'inviteTargetMin', 'inviteTargetMax',
      'sealedBidMinimumResponses', 'bidWindowWorkingDays', 'maxExtensionWorkingDays',
      'vendorAcknowledgementHours', 'clarificationHours', 'tabulationHours',
      'technicalEvaluationWorkingDays', 'poAcknowledgementHours', 'repeatOrderMaxAmount',
      'repeatOrderMaxAgeDays', 'pettyCashMaxAmount', 'poInvoiceThreshold',
      'vendorProbationMonths'
    ]
  ),
  constraint policy_profiles_relationship_controls_check check (
    (relationship = 'parent_source' and source_profile_id is null)
    or (
      relationship = 'mwell_operating'
      and formal_bid_amount is not null and formal_bid_amount > 0
      and source_profile_id is not null
    )
  ),
  constraint policy_profiles_revision_check check (revision > 0),
  constraint policy_profiles_last_modified_at_check check (last_modified_at >= created_at),
  constraint policy_profiles_revision_identity_check check (
    last_modified_by is not null
  ),
  unique (code, version),
  exclude using gist (
    tstzrange(effective_from, effective_to, '[)') with &&
  ) where (relationship = 'mwell_operating' and status = 'active')
);

create table if not exists procurement.policy_profile_events (
  id uuid primary key default gen_random_uuid(),
  policy_profile_id uuid not null references procurement.policy_profiles(id) on delete restrict,
  event_type text not null,
  actor_id uuid not null references core.profiles(id) on delete restrict,
  profile_actor_id uuid not null references core.profiles(id) on delete restrict,
  profile_revision integer not null,
  event_at timestamptz not null default pg_catalog.now(),
  detail jsonb not null default '{}'::jsonb,
  constraint policy_profile_events_type_check check (
    event_type in ('draft_saved', 'conflict_resolved', 'activated', 'superseded', 'suspended')
  ),
  constraint policy_profile_events_detail_check check (jsonb_typeof(detail) = 'object'),
  constraint policy_profile_events_revision_check check (profile_revision > 0)
);

create table if not exists procurement.policy_conflicts (
  id uuid primary key default gen_random_uuid(),
  policy_profile_id uuid not null references procurement.policy_profiles(id) on delete cascade,
  parent_rule text not null,
  local_rule text not null,
  impact text not null,
  status text not null default 'open',
  selected_mapping text,
  rationale text,
  created_by uuid not null references core.profiles(id) on delete restrict,
  resolved_by uuid references core.profiles(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  constraint policy_conflicts_status_check check (status in ('open', 'resolved', 'superseded')),
  constraint policy_conflicts_resolution_check check (
    (status = 'open' and selected_mapping is null and rationale is null and resolved_by is null and resolved_at is null)
    or (
      status <> 'open'
      and nullif(pg_catalog.btrim(selected_mapping), '') is not null
      and nullif(pg_catalog.btrim(rationale), '') is not null
      and resolved_by is not null
      and resolved_at is not null
    )
  )
);

create table if not exists procurement.solicitation_communications (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references procurement.requests(id) on delete cascade,
  policy_profile_id uuid references procurement.policy_profiles(id) on delete restrict,
  communication_type text not null,
  sent_at timestamptz not null default pg_catalog.now(),
  sent_by uuid not null references core.profiles(id) on delete restrict,
  audience text not null,
  content_hash text not null,
  detail jsonb not null default '{}'::jsonb,
  constraint solicitation_communications_type_check check (
    communication_type in ('invitation', 'clarification', 'extension', 'award_notice', 'failed_bid_notice')
  ),
  constraint solicitation_communications_detail_check check (jsonb_typeof(detail) = 'object')
);

create table if not exists procurement.policy_sla_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references procurement.requests(id) on delete cascade,
  policy_profile_id uuid not null references procurement.policy_profiles(id) on delete restrict,
  sla_type text not null,
  owner_id uuid references core.profiles(id) on delete restrict,
  due_at timestamptz not null,
  completed_at timestamptz,
  status text not null default 'open',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  constraint policy_sla_events_status_check check (status in ('open', 'completed', 'overdue', 'waived')),
  constraint policy_sla_events_detail_check check (jsonb_typeof(detail) = 'object')
);

create table if not exists legal.vendor_probation_reviews (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references core.vendors(id) on delete restrict,
  policy_profile_id uuid not null references procurement.policy_profiles(id) on delete restrict,
  due_at timestamptz not null,
  status text not null default 'open',
  opened_by uuid not null references core.profiles(id) on delete restrict,
  decided_by uuid references core.profiles(id) on delete restrict,
  decided_at timestamptz,
  decision text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint vendor_probation_reviews_status_check check (status in ('open', 'completed', 'overdue', 'cancelled')),
  constraint vendor_probation_reviews_decision_check check (
    decision is null or decision in ('pass', 'extend', 'revoke', 'suspend')
  ),
  constraint vendor_probation_reviews_evidence_check check (jsonb_typeof(evidence) = 'object')
);

-- Route columns are intentionally nullable while Task 4 backfills legacy rows.
alter table procurement.requests
  add column if not exists requirement_kind text,
  add column if not exists solicitation_type text,
  add column if not exists procurement_mode text,
  add column if not exists governance_tier text,
  add column if not exists policy_profile_id uuid references procurement.policy_profiles(id) on delete restrict,
  add column if not exists route_reasons jsonb;

alter table procurement.requests
  drop constraint if exists requests_requirement_kind_check,
  add constraint requests_requirement_kind_check check (
    requirement_kind is null or requirement_kind in ('materials', 'services')
  ),
  drop constraint if exists requests_solicitation_type_check,
  add constraint requests_solicitation_type_check check (
    solicitation_type is null or solicitation_type in ('rfq', 'rfp', 'none')
  ),
  drop constraint if exists requests_procurement_mode_check,
  add constraint requests_procurement_mode_check check (
    procurement_mode is null or procurement_mode in (
      'competitive_bidding', 'sole_source', 'repeat_order', 'emergency_purchase', 'petty_cash', 'approved_exception'
    )
  ),
  drop constraint if exists requests_governance_tier_check,
  add constraint requests_governance_tier_check check (
    governance_tier is null or governance_tier in ('standard', 'formal_bid', 'high_risk')
  ),
  drop constraint if exists requests_route_reasons_check,
  add constraint requests_route_reasons_check check (
    route_reasons is null or jsonb_typeof(route_reasons) = 'array'
  );

create index if not exists policy_profiles_active_effective_idx
  on procurement.policy_profiles (relationship, effective_from desc)
  where status = 'active';
create unique index if not exists policy_profiles_one_active_parent_source_code
  on procurement.policy_profiles (code)
  where relationship = 'parent_source' and status = 'active';
create index if not exists policy_conflicts_open_profile_idx
  on procurement.policy_conflicts (policy_profile_id, created_at)
  where status = 'open';
create index if not exists requests_policy_route_queue_idx
  on procurement.requests (status, governance_tier, procurement_mode, policy_profile_id)
  where policy_profile_id is not null;
create index if not exists policy_sla_events_due_queue_idx
  on procurement.policy_sla_events (status, due_at, owner_id)
  where status in ('open', 'overdue');
create index if not exists vendor_probation_reviews_due_queue_idx
  on legal.vendor_probation_reviews (status, due_at, vendor_id)
  where status in ('open', 'overdue');

alter table procurement.policy_profiles enable row level security;
alter table procurement.policy_profiles force row level security;
alter table procurement.policy_profile_events enable row level security;
alter table procurement.policy_profile_events force row level security;
alter table procurement.policy_conflicts enable row level security;
alter table procurement.policy_conflicts force row level security;
alter table procurement.solicitation_communications enable row level security;
alter table procurement.solicitation_communications force row level security;
alter table procurement.policy_sla_events enable row level security;
alter table procurement.policy_sla_events force row level security;
alter table legal.vendor_probation_reviews enable row level security;
alter table legal.vendor_probation_reviews force row level security;

create or replace function private.policy_profile_can_manage()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select core.has_live_cap('core', 'manage_rbac')
    or core.has_live_cap('legal', 'manage_doa')
$$;

create or replace function private.policy_profile_actor(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null and auth.role() = 'service_role' then
    begin
      v_actor := nullif(payload->>'actor_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'A valid attributable policy actor is required';
    end;
  end if;
  if v_actor is null or not exists (
    select 1 from core.profiles where id = v_actor and status = 'active'
  ) then
    raise exception 'A valid attributable policy actor is required';
  end if;
  return v_actor;
end;
$$;

create policy policy_profiles_active_read on procurement.policy_profiles
  for select to authenticated
  using (status = 'active' or private.policy_profile_can_manage());
create policy policy_profiles_governed_insert on procurement.policy_profiles
  for insert to authenticated
  with check (private.policy_profile_can_manage());
create policy policy_profiles_governed_update on procurement.policy_profiles
  for update to authenticated
  using (private.policy_profile_can_manage())
  with check (private.policy_profile_can_manage());
create policy policy_profile_events_manage_read on procurement.policy_profile_events
  for select to authenticated
  using (private.policy_profile_can_manage());
create policy policy_profile_events_governed_insert on procurement.policy_profile_events
  for insert to authenticated
  with check (private.policy_profile_can_manage());
create policy policy_conflicts_manage_read on procurement.policy_conflicts
  for select to authenticated
  using (private.policy_profile_can_manage());
create policy policy_conflicts_governed_update on procurement.policy_conflicts
  for update to authenticated
  using (private.policy_profile_can_manage())
  with check (private.policy_profile_can_manage());
create policy solicitation_communications_read on procurement.solicitation_communications
  for select to authenticated
  using (
    core.has_live_cap('procurement', 'view_dashboard')
    or private.policy_profile_can_manage()
  );
create policy policy_sla_events_read on procurement.policy_sla_events
  for select to authenticated
  using (
    core.has_live_cap('procurement', 'view_dashboard')
    or private.policy_profile_can_manage()
  );
create policy vendor_probation_reviews_read on legal.vendor_probation_reviews
  for select to authenticated
  using (
    core.has_live_cap('legal', 'review_accreditation')
    or core.has_live_cap('procurement', 'view_dashboard')
  );

grant select on procurement.policy_profiles, procurement.policy_profile_events,
  procurement.policy_conflicts, procurement.solicitation_communications,
  procurement.policy_sla_events to authenticated, service_role;
grant select on legal.vendor_probation_reviews to authenticated, service_role;
revoke insert, update, delete on procurement.policy_profiles,
  procurement.policy_profile_events, procurement.policy_conflicts,
  procurement.solicitation_communications, procurement.policy_sla_events from authenticated, service_role;
revoke insert, update, delete on legal.vendor_probation_reviews from authenticated, service_role;
revoke all on procurement.policy_profiles,
  procurement.policy_profile_events, procurement.policy_conflicts,
  procurement.solicitation_communications, procurement.policy_sla_events,
  legal.vendor_probation_reviews from service_role;
grant select on procurement.policy_profiles, procurement.policy_profile_events,
  procurement.policy_conflicts, procurement.solicitation_communications,
  procurement.policy_sla_events to service_role;
grant select on legal.vendor_probation_reviews to service_role;

create or replace function private.policy_profiles_controls_are_valid(
  p_profile procurement.policy_profiles
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (p_profile.formal_bid_amount is null or p_profile.formal_bid_amount >= 0)
    and p_profile.invite_target_min > 0
    and p_profile.invite_target_max >= p_profile.invite_target_min
    and p_profile.sealed_bid_minimum_responses > 0
    and p_profile.sealed_bid_minimum_responses <= p_profile.invite_target_max
    and p_profile.bid_window_working_days > 0
    and p_profile.max_extension_working_days > 0
    and p_profile.vendor_acknowledgement_hours > 0
    and p_profile.clarification_hours > 0
    and p_profile.tabulation_hours > 0
    and p_profile.technical_evaluation_working_days > 0
    and p_profile.po_acknowledgement_hours > 0
    and p_profile.repeat_order_max_amount >= 0
    and p_profile.repeat_order_max_age_days > 0
    and p_profile.petty_cash_max_amount >= 0
    and p_profile.po_invoice_threshold >= 0
    and p_profile.vendor_probation_months > 0
    and (
      p_profile.relationship = 'parent_source'
      or (
        p_profile.relationship = 'mwell_operating'
        and p_profile.formal_bid_amount is not null and p_profile.formal_bid_amount > 0
        and p_profile.source_profile_id is not null
      )
    )
$$;

create or replace function private.policy_profile_control_sources_are_complete(
  p_profile procurement.policy_profiles
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_source text;
  v_mpic_source constant text := 'MPIC Procurement Policy February2025.docx (February 2025)';
  v_mwell_source constant text := 'mWell Procurement Policy and Procedures - Revised Modern Visual Updated.docx (local operating policy)';
begin
  if jsonb_object_length(p_profile.control_sources) <> 16 or not (
    p_profile.control_sources ?& array[
      'formalBidAmount', 'inviteTargetMin', 'inviteTargetMax',
      'sealedBidMinimumResponses', 'bidWindowWorkingDays', 'maxExtensionWorkingDays',
      'vendorAcknowledgementHours', 'clarificationHours', 'tabulationHours',
      'technicalEvaluationWorkingDays', 'poAcknowledgementHours', 'repeatOrderMaxAmount',
      'repeatOrderMaxAgeDays', 'pettyCashMaxAmount', 'poInvoiceThreshold',
      'vendorProbationMonths'
    ]
  ) then
    return false;
  end if;
  for v_source in select value from pg_catalog.jsonb_each_text(p_profile.control_sources)
  loop
    if nullif(pg_catalog.btrim(v_source), '') is null then return false; end if;
    if p_profile.relationship = 'parent_source' and v_source <> v_mpic_source then
      return false;
    end if;
    if p_profile.relationship = 'mwell_operating'
      and v_source not in (v_mpic_source, v_mwell_source) then
      return false;
    end if;
  end loop;
  return p_profile.relationship <> 'mwell_operating'
    or p_profile.control_sources->>'formalBidAmount' = v_mwell_source;
end;
$$;

create or replace function private.policy_profile_source_lineage_is_valid(
  p_profile procurement.policy_profiles,
  p_require_active_parent boolean
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_parent procurement.policy_profiles;
begin
  if p_profile.relationship = 'parent_source' then
    return p_profile.source_profile_id is null
      and p_profile.source_filename = 'MPIC Procurement Policy February2025.docx'
      and p_profile.source_organization = 'MPIC';
  end if;
  if p_profile.relationship <> 'mwell_operating'
    or p_profile.source_profile_id is null
    or p_profile.source_filename <> 'mWell Procurement Policy and Procedures - Revised Modern Visual Updated.docx'
    or p_profile.source_organization <> 'Mwell' then
    return false;
  end if;
  select * into v_parent from procurement.policy_profiles
  where id = p_profile.source_profile_id;
  return found
    and v_parent.relationship = 'parent_source'
    and v_parent.code = 'MPIC-PROCUREMENT-2025-02'
    and v_parent.source_filename = 'MPIC Procurement Policy February2025.docx'
    and v_parent.source_organization = 'MPIC'
    and (not p_require_active_parent or v_parent.status = 'active');
end;
$$;

create or replace function private.policy_profile_validate_profile(
  p_profile procurement.policy_profiles,
  p_require_active_parent boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.policy_profiles_controls_are_valid(p_profile) then
    raise exception 'Policy profile numeric and relationship controls are invalid';
  end if;
  if not private.policy_profile_control_sources_are_complete(p_profile) then
    raise exception 'Policy profile control sources are incomplete or unrecognized';
  end if;
  if not private.policy_profile_source_lineage_is_valid(p_profile, p_require_active_parent) then
    raise exception 'Policy profile source lineage is invalid';
  end if;
end;
$$;

create or replace function procurement.prevent_policy_profile_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Policy profile events are immutable';
end;
$$;

drop trigger if exists policy_profile_events_immutable on procurement.policy_profile_events;
create trigger policy_profile_events_immutable
  before update or delete on procurement.policy_profile_events
  for each row execute function procurement.prevent_policy_profile_event_mutation();

create or replace function procurement.save_policy_profile(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile procurement.policy_profiles;
  v_profile_id uuid;
  v_actor uuid := private.policy_profile_actor(payload);
  v_controls jsonb := coalesce(payload->'controls', '{}'::jsonb);
begin
  if not private.policy_profile_can_manage() then
    raise exception 'Not authorized to manage procurement policy profiles';
  end if;
  if jsonb_typeof(payload) <> 'object' or jsonb_typeof(v_controls) <> 'object' then
    raise exception 'Policy profile and controls must be objects';
  end if;
  if nullif(pg_catalog.btrim(payload->>'code'), '') is null
    or nullif(pg_catalog.btrim(payload->>'version'), '') is null
    or nullif(pg_catalog.btrim(payload->>'name'), '') is null
    or nullif(pg_catalog.btrim(payload->>'source_filename'), '') is null
    or nullif(pg_catalog.btrim(payload->>'source_organization'), '') is null
    or nullif(pg_catalog.btrim(payload->>'document_hash'), '') is null then
    raise exception 'Code, version, name, source identity, and document hash are required';
  end if;
  begin
    v_profile_id := nullif(payload->>'id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid policy profile identity is required';
  end;

  if v_profile_id is not null then
    select * into v_profile from procurement.policy_profiles where id = v_profile_id for update;
    if not found then raise exception 'Policy profile not found'; end if;
    if v_profile.status <> 'draft' then
      raise exception 'Activated policy profiles are immutable; create a revision';
    end if;
  end if;

  if v_profile_id is null then
    insert into procurement.policy_profiles (
      code, version, name, relationship, source_profile_id, source_filename,
      source_organization, control_sources, formal_bid_amount, invite_target_min,
      invite_target_max, sealed_bid_minimum_responses, bid_window_working_days,
      max_extension_working_days, vendor_acknowledgement_hours, clarification_hours,
      tabulation_hours, technical_evaluation_working_days, po_acknowledgement_hours,
      repeat_order_max_amount, repeat_order_max_age_days, petty_cash_max_amount,
      po_invoice_threshold, vendor_probation_months, effective_from, effective_to,
      document_hash, created_by, last_modified_by
    ) values (
      pg_catalog.btrim(payload->>'code'), pg_catalog.btrim(payload->>'version'),
      pg_catalog.btrim(payload->>'name'), payload->>'relationship',
      nullif(payload->>'source_profile_id', '')::uuid, pg_catalog.btrim(payload->>'source_filename'),
      pg_catalog.btrim(payload->>'source_organization'), coalesce(payload->'control_sources', '{}'::jsonb),
      nullif(v_controls->>'formalBidAmount', '')::numeric,
      (v_controls->>'inviteTargetMin')::integer, (v_controls->>'inviteTargetMax')::integer,
      (v_controls->>'sealedBidMinimumResponses')::integer, (v_controls->>'bidWindowWorkingDays')::integer,
      (v_controls->>'maxExtensionWorkingDays')::integer, (v_controls->>'vendorAcknowledgementHours')::integer,
      (v_controls->>'clarificationHours')::integer, (v_controls->>'tabulationHours')::integer,
      (v_controls->>'technicalEvaluationWorkingDays')::integer, (v_controls->>'poAcknowledgementHours')::integer,
      (v_controls->>'repeatOrderMaxAmount')::numeric, (v_controls->>'repeatOrderMaxAgeDays')::integer,
      (v_controls->>'pettyCashMaxAmount')::numeric, (v_controls->>'poInvoiceThreshold')::numeric,
      (v_controls->>'vendorProbationMonths')::integer,
      (payload->>'effective_from')::timestamptz, nullif(payload->>'effective_to', '')::timestamptz,
      pg_catalog.btrim(payload->>'document_hash'), v_actor, v_actor
    ) returning * into v_profile;
  else
    update procurement.policy_profiles set
      code = pg_catalog.btrim(payload->>'code'), version = pg_catalog.btrim(payload->>'version'),
      name = pg_catalog.btrim(payload->>'name'), relationship = payload->>'relationship',
      source_profile_id = nullif(payload->>'source_profile_id', '')::uuid,
      source_filename = pg_catalog.btrim(payload->>'source_filename'),
      source_organization = pg_catalog.btrim(payload->>'source_organization'),
      control_sources = coalesce(payload->'control_sources', '{}'::jsonb),
      formal_bid_amount = nullif(v_controls->>'formalBidAmount', '')::numeric,
      invite_target_min = (v_controls->>'inviteTargetMin')::integer,
      invite_target_max = (v_controls->>'inviteTargetMax')::integer,
      sealed_bid_minimum_responses = (v_controls->>'sealedBidMinimumResponses')::integer,
      bid_window_working_days = (v_controls->>'bidWindowWorkingDays')::integer,
      max_extension_working_days = (v_controls->>'maxExtensionWorkingDays')::integer,
      vendor_acknowledgement_hours = (v_controls->>'vendorAcknowledgementHours')::integer,
      clarification_hours = (v_controls->>'clarificationHours')::integer,
      tabulation_hours = (v_controls->>'tabulationHours')::integer,
      technical_evaluation_working_days = (v_controls->>'technicalEvaluationWorkingDays')::integer,
      po_acknowledgement_hours = (v_controls->>'poAcknowledgementHours')::integer,
      repeat_order_max_amount = (v_controls->>'repeatOrderMaxAmount')::numeric,
      repeat_order_max_age_days = (v_controls->>'repeatOrderMaxAgeDays')::integer,
      petty_cash_max_amount = (v_controls->>'pettyCashMaxAmount')::numeric,
      po_invoice_threshold = (v_controls->>'poInvoiceThreshold')::numeric,
      vendor_probation_months = (v_controls->>'vendorProbationMonths')::integer,
      effective_from = (payload->>'effective_from')::timestamptz,
      effective_to = nullif(payload->>'effective_to', '')::timestamptz,
      document_hash = pg_catalog.btrim(payload->>'document_hash'),
      last_modified_by = v_actor, last_modified_at = pg_catalog.now(),
      revision = revision + 1, updated_at = pg_catalog.now()
    where id = v_profile_id returning * into v_profile;
  end if;

  perform private.policy_profile_validate_profile(v_profile, false);
  insert into procurement.policy_profile_events (
    policy_profile_id, event_type, actor_id, profile_actor_id, profile_revision, detail
  ) values (
    v_profile.id, 'draft_saved', v_actor, v_profile.last_modified_by, v_profile.revision,
    jsonb_build_object('version', v_profile.version, 'revision', v_profile.revision)
  );
  return to_jsonb(v_profile);
end;
$$;

create or replace function procurement.resolve_policy_conflict(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conflict procurement.policy_conflicts;
  v_profile procurement.policy_profiles;
  v_actor uuid := private.policy_profile_actor(payload);
  v_conflict_id uuid;
  v_mapping text := nullif(pg_catalog.btrim(payload->>'selected_mapping'), '');
  v_rationale text := nullif(pg_catalog.btrim(payload->>'rationale'), '');
begin
  if not private.policy_profile_can_manage() then
    raise exception 'Not authorized to resolve policy conflicts';
  end if;
  if v_mapping is null or v_rationale is null then
    raise exception 'A selected mapping and rationale are required';
  end if;
  begin
    v_conflict_id := nullif(payload->>'id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid policy conflict identity is required';
  end;
  if v_conflict_id is null then raise exception 'A valid policy conflict identity is required'; end if;
  select * into v_conflict from procurement.policy_conflicts where id = v_conflict_id for update;
  if not found or v_conflict.status <> 'open' then raise exception 'Open policy conflict not found'; end if;
  select * into v_profile from procurement.policy_profiles where id = v_conflict.policy_profile_id for update;
  if v_profile.last_modified_by is not distinct from v_actor then
    raise exception 'The latest policy profile modifier cannot resolve its own conflict';
  end if;
  update procurement.policy_conflicts set
    status = 'resolved', selected_mapping = v_mapping, rationale = v_rationale,
    resolved_by = v_actor, resolved_at = pg_catalog.now()
  where id = v_conflict.id returning * into v_conflict;
  insert into procurement.policy_profile_events (
    policy_profile_id, event_type, actor_id, profile_actor_id, profile_revision, detail
  ) values (
    v_profile.id, 'conflict_resolved', v_actor, v_profile.last_modified_by, v_profile.revision,
    jsonb_build_object('conflict_id', v_conflict.id, 'revision', v_profile.revision)
  );
  return to_jsonb(v_conflict);
end;
$$;

create or replace function procurement.activate_policy_profile(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile procurement.policy_profiles;
  v_actor uuid := private.policy_profile_actor(payload);
  v_profile_id uuid;
  v_superseded procurement.policy_profiles;
begin
  if not private.policy_profile_can_manage() then
    raise exception 'Not authorized to activate procurement policy profiles';
  end if;
  begin
    v_profile_id := nullif(payload->>'id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid policy profile identity is required';
  end;
  if v_profile_id is null then raise exception 'A valid policy profile identity is required'; end if;
  select * into v_profile from procurement.policy_profiles where id = v_profile_id for update;
  if not found then raise exception 'Policy profile not found'; end if;
  if v_profile.status <> 'draft' then raise exception 'Only draft policy profiles can be activated'; end if;
  if v_profile.last_modified_by is not distinct from v_actor then
    raise exception 'A separate policy checker must activate the profile';
  end if;
  if v_profile.effective_from > pg_catalog.statement_timestamp() then
    raise exception 'Future-effective profiles must remain draft until activation';
  end if;
  perform private.policy_profile_validate_profile(v_profile, true);
  perform 1 from procurement.policy_conflicts
    where policy_profile_id = v_profile.id and status = 'open'
    for update;
  if found then raise exception 'Unresolved conflicts block activation'; end if;

  -- Locks competing active profiles before superseding them in this transaction.
  if v_profile.relationship = 'mwell_operating' then
    for v_superseded in
      select * from procurement.policy_profiles
      where relationship = 'mwell_operating' and status = 'active' and id <> v_profile.id
      for update
    loop
      update procurement.policy_profiles set
        status = 'superseded',
        effective_to = least(coalesce(effective_to, v_profile.effective_from), v_profile.effective_from),
        updated_at = pg_catalog.now()
      where id = v_superseded.id;
      insert into procurement.policy_profile_events (
        policy_profile_id, event_type, actor_id, profile_actor_id, profile_revision, detail
      ) values (
        v_superseded.id, 'superseded', v_actor, v_superseded.last_modified_by,
        v_superseded.revision, jsonb_build_object('superseded_by', v_profile.id)
      );
    end loop;
  else
    for v_superseded in
      select * from procurement.policy_profiles
      where relationship = 'parent_source' and code = v_profile.code
        and status = 'active' and id <> v_profile.id
      for update
    loop
      update procurement.policy_profiles set
        status = 'superseded',
        effective_to = least(coalesce(effective_to, v_profile.effective_from), v_profile.effective_from),
        updated_at = pg_catalog.now()
      where id = v_superseded.id;
      insert into procurement.policy_profile_events (
        policy_profile_id, event_type, actor_id, profile_actor_id, profile_revision, detail
      ) values (
        v_superseded.id, 'superseded', v_actor, v_superseded.last_modified_by,
        v_superseded.revision, jsonb_build_object('superseded_by', v_profile.id)
      );
    end loop;
  end if;

  update procurement.policy_profiles set
    status = 'active', activated_by = v_actor, activated_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where id = v_profile.id returning * into v_profile;
  insert into procurement.policy_profile_events (
    policy_profile_id, event_type, actor_id, profile_actor_id, profile_revision, detail
  ) values (
    v_profile.id, 'activated', v_actor, v_profile.last_modified_by, v_profile.revision,
    jsonb_build_object('effective_from', v_profile.effective_from, 'revision', v_profile.revision)
  );
  return to_jsonb(v_profile);
end;
$$;

create or replace function procurement.get_effective_policy_profile(as_of timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_profile procurement.policy_profiles;
begin
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'Authentication required';
  end if;
  select * into v_profile from procurement.policy_profiles
  where relationship = 'mwell_operating'
    and status = 'active'
    and effective_from <= coalesce(as_of, pg_catalog.statement_timestamp())
    and (effective_to is null or effective_to > coalesce(as_of, pg_catalog.statement_timestamp()))
  order by effective_from desc
  limit 1;
  if not found then raise exception 'No effective Mwell operating policy profile exists'; end if;
  return to_jsonb(v_profile);
end;
$$;

revoke all on function private.policy_profile_can_manage() from public, anon, authenticated;
revoke all on function private.policy_profile_actor(jsonb) from public, anon, authenticated;
revoke all on function private.policy_profiles_controls_are_valid(procurement.policy_profiles) from public, anon, authenticated;
revoke all on function private.policy_profile_control_sources_are_complete(procurement.policy_profiles) from public, anon, authenticated;
revoke all on function private.policy_profile_source_lineage_is_valid(procurement.policy_profiles, boolean) from public, anon, authenticated;
revoke all on function private.policy_profile_validate_profile(procurement.policy_profiles, boolean) from public, anon, authenticated;
revoke all on function procurement.prevent_policy_profile_event_mutation() from public, anon, authenticated;
revoke all on function procurement.save_policy_profile(jsonb),
  procurement.activate_policy_profile(jsonb), procurement.resolve_policy_conflict(jsonb),
  procurement.get_effective_policy_profile(timestamptz)
from public, anon, authenticated;
grant execute on function procurement.save_policy_profile(jsonb),
  procurement.activate_policy_profile(jsonb), procurement.resolve_policy_conflict(jsonb),
  procurement.get_effective_policy_profile(timestamptz)
to authenticated, service_role;

-- Governed three-axis routing ------------------------------------------------
-- The live request key is text (including legacy req_* values), not UUID. The
-- helpers therefore accept text and lock the current request/profile pair.
alter table procurement.route_decisions
  add column if not exists solicitation_type text,
  add column if not exists procurement_mode text,
  add column if not exists governance_tier text,
  add column if not exists policy_profile_id uuid references procurement.policy_profiles(id) on delete restrict;

alter table procurement.route_decisions
  drop constraint if exists route_decisions_solicitation_type_check,
  add constraint route_decisions_solicitation_type_check check (
    solicitation_type is null or solicitation_type in ('rfq', 'rfp', 'none')
  ),
  drop constraint if exists route_decisions_procurement_mode_check,
  add constraint route_decisions_procurement_mode_check check (
    procurement_mode is null or procurement_mode in (
      'competitive_bidding', 'sole_source', 'repeat_order', 'emergency_purchase', 'petty_cash', 'approved_exception'
    )
  ),
  drop constraint if exists route_decisions_governance_tier_check,
  add constraint route_decisions_governance_tier_check check (
    governance_tier is null or governance_tier in ('standard', 'formal_bid', 'high_risk')
  );

create index if not exists procurement_route_decision_governed_lookup_idx
  on procurement.route_decisions (request_id, request_version desc, confirmed_at desc);

create or replace function private.policy_route_legacy_method(
  p_solicitation_type text,
  p_procurement_mode text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case p_procurement_mode
    when 'petty_cash' then 'petty_cash'
    when 'repeat_order' then 'repeat_order'
    when 'emergency_purchase' then 'emergency'
    when 'sole_source' then 'direct_award'
    when 'approved_exception' then 'direct_award'
    when 'competitive_bidding' then case when p_solicitation_type = 'rfp' then 'rfp' else 'rfq' end
  end
$$;

create or replace function private.policy_legacy_requirement_kind(
  p_category text,
  p_lines jsonb
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_evidence text := pg_catalog.lower(coalesce(p_lines::text, ''));
  v_kind text;
  v_requires_review boolean := false;
begin
  case p_category
    when 'services', 'subscription', 'construction', 'manpower', 'it_software' then v_kind := 'services';
    when 'goods', 'petty_cash' then v_kind := 'materials';
    when 'medical', 'marketing', 'capex', 'other' then
      v_requires_review := true;
      if v_evidence ~ '(consult|service|labor|installation|staffing|subscription|software|license)' then
        v_kind := 'services';
      elsif jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) = 'array' and jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 0 then
        v_kind := 'materials';
      end if;
  end case;
  return jsonb_build_object('requirement_kind', v_kind, 'requires_review', v_requires_review);
end;
$$;

create or replace function private.policy_normalized_risk_facts(p_compliance jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_source jsonb := coalesce(p_compliance->'riskFacts', p_compliance->'risk_facts', p_compliance, '{}'::jsonb);
  v_true_values constant text[] := array['true', '1', 'yes'];
begin
  if jsonb_typeof(v_source) <> 'object' then v_source := '{}'::jsonb; end if;
  return jsonb_build_object(
    'complex', lower(coalesce(v_source->>'complex', 'false')) = any(v_true_values),
    'technical', lower(coalesce(v_source->>'technical', 'false')) = any(v_true_values),
    'strategic', lower(coalesce(v_source->>'strategic', 'false')) = any(v_true_values),
    'highRisk', lower(coalesce(v_source->>'highRisk', v_source->>'high_risk', 'false')) = any(v_true_values),
    'dataSensitive', lower(coalesce(v_source->>'dataSensitive', v_source->>'data_sensitive', 'false')) = any(v_true_values),
    'importation', lower(coalesce(v_source->>'importation', 'false')) = any(v_true_values)
  );
end;
$$;

create or replace function private.policy_normalized_risk_reasons(p_compliance jsonb)
returns text[]
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare v_facts jsonb := private.policy_normalized_risk_facts(p_compliance); v_reasons text[] := '{}';
begin
  if coalesce((v_facts->>'complex')::boolean, false) then v_reasons := array_append(v_reasons, 'risk:complex'); end if;
  if coalesce((v_facts->>'technical')::boolean, false) then v_reasons := array_append(v_reasons, 'risk:technical'); end if;
  if coalesce((v_facts->>'strategic')::boolean, false) then v_reasons := array_append(v_reasons, 'risk:strategic'); end if;
  if coalesce((v_facts->>'highRisk')::boolean, false) then v_reasons := array_append(v_reasons, 'risk:high_risk'); end if;
  if coalesce((v_facts->>'dataSensitive')::boolean, false) then v_reasons := array_append(v_reasons, 'risk:data_sensitive'); end if;
  if coalesce((v_facts->>'importation')::boolean, false) then v_reasons := array_append(v_reasons, 'risk:importation'); end if;
  return v_reasons;
end;
$$;

create or replace function private.policy_legacy_route_mapping(
  p_method text,
  p_category text,
  p_lines jsonb,
  p_compliance jsonb,
  p_amount numeric,
  p_formal_bid_amount numeric
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_classification jsonb := private.policy_legacy_requirement_kind(p_category, p_lines);
  v_requirement_kind text := v_classification->>'requirement_kind';
  v_supported boolean := coalesce(p_method in ('rfq', 'rfp', 'direct_award', 'repeat_order', 'emergency', 'petty_cash'), false);
  v_mode text;
  v_solicitation text;
  v_tier text;
  v_reasons text[] := array['legacy_method:' || coalesce(p_method, 'missing')];
  v_risk_reasons text[] := private.policy_normalized_risk_reasons(p_compliance);
  v_requires_review boolean := coalesce((v_classification->>'requires_review')::boolean, false);
  v_compliance jsonb := case when jsonb_typeof(coalesce(p_compliance, '{}'::jsonb)) = 'object' then p_compliance else '{}'::jsonb end;
begin
  v_compliance := jsonb_set(v_compliance, '{riskFacts}', private.policy_normalized_risk_facts(p_compliance), true);
  v_reasons := v_reasons || v_risk_reasons;
  if p_method = 'small_purchase' then
    -- This legacy value has no governed three-axis equivalent.
    v_supported := false;
    v_requires_review := true;
  elsif not v_supported then
    v_requires_review := true;
  elsif p_formal_bid_amount is null or v_requirement_kind not in ('materials', 'services') then
    v_requires_review := true;
  end if;
  if v_requires_review then
    return jsonb_build_object(
      'requirement_kind', v_requirement_kind,
      'solicitation_type', null,
      'procurement_mode', null,
      'governance_tier', null,
      'requires_review', true,
      'reasons', to_jsonb(v_reasons || array['legacy_mapping_requires_review']),
      'compliance', v_compliance
    );
  end if;
  v_mode := case p_method
    when 'direct_award' then 'sole_source'
    when 'repeat_order' then 'repeat_order'
    when 'emergency' then 'emergency_purchase'
    when 'petty_cash' then 'petty_cash'
    else 'competitive_bidding'
  end;
  v_solicitation := case when v_mode = 'competitive_bidding'
    then case when v_requirement_kind = 'services' then 'rfp' else 'rfq' end
    else 'none' end;
  v_tier := case
    when cardinality(v_risk_reasons) > 0 then 'high_risk'
    when coalesce(p_amount, 0) >= p_formal_bid_amount then 'formal_bid'
    else 'standard'
  end;
  return jsonb_build_object(
    'requirement_kind', v_requirement_kind,
    'solicitation_type', v_solicitation,
    'procurement_mode', v_mode,
    'governance_tier', v_tier,
    'requires_review', false,
    'reasons', to_jsonb(v_reasons || array['legacy_mapping_deterministic', 'mode:' || v_mode, 'tier:' || v_tier]),
    'compliance', v_compliance
  );
end;
$$;

create or replace function private.policy_route_confirmation_input(
  p_payload jsonb,
  p_current_version integer
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare v_expected_version integer; v_requested_mode text;
begin
  if jsonb_typeof(p_payload) <> 'object' or nullif(pg_catalog.btrim(p_payload->>'request_id'), '') is null then
    raise exception 'A request identity is required';
  end if;
  begin
    v_expected_version := (p_payload->>'expected_route_version')::integer;
  exception when invalid_text_representation then
    raise exception 'expected_route_version must be an integer';
  end;
  if v_expected_version is null or v_expected_version <> p_current_version then
    raise exception 'Route confirmation is stale; reload the request before confirming';
  end if;
  v_requested_mode := nullif(pg_catalog.btrim(p_payload->>'requested_mode'), '');
  if v_requested_mode is not null and v_requested_mode not in (
    'competitive_bidding', 'sole_source', 'repeat_order', 'emergency_purchase', 'petty_cash', 'approved_exception'
  ) then
    raise exception 'Unsupported procurement mode';
  end if;
  -- Authority fields are deliberately excluded from the returned contract.
  return jsonb_build_object('request_id', p_payload->>'request_id', 'expected_route_version', v_expected_version, 'requested_mode', v_requested_mode);
end;
$$;

create or replace function private.policy_route_exception_contract(
  p_procurement_mode text,
  p_amount numeric,
  p_petty_cash_max_amount numeric,
  p_repeat_order_max_amount numeric,
  p_exception_type text
)
returns text[]
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare v_missing text[] := '{}';
begin
  if p_procurement_mode = 'competitive_bidding' then return v_missing; end if;
  if not coalesce((
    (p_procurement_mode = 'sole_source' and p_exception_type in ('direct_award', 'sole_supplier'))
    or (p_procurement_mode = 'repeat_order' and p_exception_type = 'repeat_continuity')
    or (p_procurement_mode = 'emergency_purchase' and p_exception_type = 'emergency')
    or (p_procurement_mode = 'petty_cash' and p_exception_type = 'petty_cash_non_accredited')
    or (p_procurement_mode = 'approved_exception' and p_exception_type in ('direct_award', 'sole_supplier', 'emergency', 'repeat_continuity', 'insufficient_bids', 'petty_cash_non_accredited'))
  ), false) then v_missing := array_append(v_missing, 'approved_exception_evidence'); end if;
  if p_procurement_mode = 'petty_cash' and p_amount > p_petty_cash_max_amount then v_missing := array_append(v_missing, 'petty_cash_amount_exceeds_policy'); end if;
  if p_procurement_mode = 'repeat_order' and p_amount > p_repeat_order_max_amount then v_missing := array_append(v_missing, 'repeat_order_amount_exceeds_policy'); end if;
  return v_missing;
end;
$$;

create or replace function private.policy_route_exception_is_eligible(
  p_request_id text,
  p_procurement_mode text,
  p_profile procurement.policy_profiles,
  p_amount numeric
)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_exception_type text;
begin
  select exception_pack.exception_type into v_exception_type
  from procurement.exception_packs exception_pack
    where exception_pack.request_id::text = p_request_id and exception_pack.status = 'approved'
  order by exception_pack.id
  limit 1;
  return private.policy_route_exception_contract(
    p_procurement_mode, p_amount, p_profile.petty_cash_max_amount,
    p_profile.repeat_order_max_amount, v_exception_type
  );
end;
$$;

create or replace function private.policy_derive_procurement_route(
  request_id text,
  requested_mode text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request procurement.requests;
  v_profile procurement.policy_profiles;
  v_requirement_kind text;
  v_mode text := coalesce(nullif(pg_catalog.btrim(requested_mode), ''), 'competitive_bidding');
  v_solicitation text;
  v_tier text;
  v_reasons text[] := '{}';
  v_blockers text[] := '{}';
  v_risk jsonb;
  v_risk_reasons text[];
begin
  select * into v_request from procurement.requests where id::text = request_id for update;
  if not found then raise exception 'Request not found'; end if;
  if v_request.estimated_amount is null or v_request.estimated_amount < 0 then
    v_blockers := array_append(v_blockers, 'estimated_amount_required');
  end if;
  if v_mode not in ('competitive_bidding', 'sole_source', 'repeat_order', 'emergency_purchase', 'petty_cash', 'approved_exception') then
    v_blockers := array_append(v_blockers, 'unsupported_procurement_mode');
  end if;
  select * into v_profile
  from procurement.policy_profiles
  where relationship = 'mwell_operating' and status = 'active'
    and effective_from <= pg_catalog.statement_timestamp()
    and (effective_to is null or effective_to > pg_catalog.statement_timestamp())
  order by effective_from desc
  limit 1
  for update;
  if not found then
    v_blockers := array_append(v_blockers, 'effective_policy_profile_required');
  end if;
  v_requirement_kind := v_request.requirement_kind;
  if v_requirement_kind not in ('materials', 'services') then
    v_blockers := array_append(v_blockers, 'requirement_kind_required');
  end if;
  if cardinality(v_blockers) > 0 then
    return jsonb_build_object('status', 'blocked', 'blockers', to_jsonb(v_blockers));
  end if;

  v_risk := private.policy_normalized_risk_facts(v_request.compliance);
  v_risk_reasons := private.policy_normalized_risk_reasons(v_request.compliance);
  v_solicitation := case when v_mode = 'competitive_bidding'
    then case when v_requirement_kind = 'services' then 'rfp' else 'rfq' end
    else 'none' end;
  if cardinality(v_risk_reasons) > 0 then
    v_tier := 'high_risk';
  elsif v_request.estimated_amount >= v_profile.formal_bid_amount then
    v_tier := 'formal_bid';
  else
    v_tier := 'standard';
  end if;
  v_blockers := private.policy_route_exception_is_eligible(v_request.id::text, v_mode, v_profile, v_request.estimated_amount);
  if cardinality(v_blockers) > 0 then
    return jsonb_build_object('status', 'blocked', 'blockers', to_jsonb(v_blockers));
  end if;
  v_reasons := array_append(v_reasons, case when v_requirement_kind = 'services' then 'service_requirement' else 'material_requirement' end);
  v_reasons := v_reasons || v_risk_reasons;
  v_reasons := array_append(v_reasons, 'mode:' || v_mode);
  v_reasons := array_append(v_reasons, 'tier:' || v_tier);
  return jsonb_build_object(
    'status', 'derived', 'request_id', v_request.id, 'policy_profile_id', v_profile.id,
    'solicitation_type', v_solicitation, 'procurement_mode', v_mode,
    'governance_tier', v_tier, 'reasons', to_jsonb(v_reasons)
  );
end;
$$;

create or replace function private.policy_confirm_route_decision(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request procurement.requests;
  v_route jsonb;
  v_decision procurement.route_decisions;
  v_expected_version integer;
  v_current_version integer;
  v_requested_mode text;
  v_confirmation jsonb;
begin
  if not (core.has_live_cap('procurement', 'manage_rfp') or core.has_live_cap('procurement', 'admin')) then
    raise exception 'Not authorized to confirm sourcing route';
  end if;
  if jsonb_typeof(payload) <> 'object' or nullif(pg_catalog.btrim(payload->>'request_id'), '') is null then
    raise exception 'A request identity is required';
  end if;
  select * into v_request from procurement.requests where id::text = payload->>'request_id' for update;
  if not found then raise exception 'Request not found'; end if;
  perform 1 from procurement.route_decisions
  where request_id = v_request.id
  for update;
  select coalesce(max(request_version), 0) into v_current_version
  from procurement.route_decisions where request_id = v_request.id;
  v_confirmation := private.policy_route_confirmation_input(payload, v_current_version);
  v_expected_version := (v_confirmation->>'expected_route_version')::integer;
  v_requested_mode := nullif(pg_catalog.btrim(v_confirmation->>'requested_mode'), '');
  -- Client-provided solicitation, tier, profile, and reasons are intentionally ignored.
  v_route := private.policy_derive_procurement_route(v_request.id::text, v_requested_mode);
  if v_route->>'status' <> 'derived' then
    raise exception 'Route cannot be confirmed: %', coalesce(v_route->'blockers', '[]'::jsonb);
  end if;
  insert into procurement.route_decisions(
    request_id, policy_version, request_version, method, reasons, risk_facts, status, confirmed_by,
    solicitation_type, procurement_mode, governance_tier, policy_profile_id
  ) values (
    v_request.id,
    (select code || ':' || version from procurement.policy_profiles where id = (v_route->>'policy_profile_id')::uuid),
    v_current_version + 1,
    private.policy_route_legacy_method(v_route->>'solicitation_type', v_route->>'procurement_mode'),
    array(select jsonb_array_elements_text(v_route->'reasons')),
    private.policy_normalized_risk_facts(v_request.compliance),
    'confirmed', auth.uid(),
    v_route->>'solicitation_type', v_route->>'procurement_mode', v_route->>'governance_tier', (v_route->>'policy_profile_id')::uuid
  ) returning * into v_decision;
  update procurement.requests set
    requirement_kind = case when requirement_kind in ('materials', 'services') then requirement_kind else null end,
    solicitation_type = v_route->>'solicitation_type',
    procurement_mode = v_route->>'procurement_mode',
    governance_tier = v_route->>'governance_tier',
    policy_profile_id = (v_route->>'policy_profile_id')::uuid,
    route_reasons = v_route->'reasons',
    sourcing_method = v_decision.method,
    sourcing_override = v_requested_mode is not null and v_requested_mode <> 'competitive_bidding',
    updated_at = pg_catalog.now()
  where id = v_request.id;
  return to_jsonb(v_decision) || jsonb_build_object('route', v_route);
end;
$$;

create or replace function procurement.confirm_route_decision(payload jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.policy_confirm_route_decision(payload) $$;

-- Deterministic legacy backfill. Ambiguous values are explicitly marked and
-- queued for Procurement review; the migration never grants them confirmed status.
with active_profile as (
  select id, code, version, formal_bid_amount
  from procurement.policy_profiles
  where relationship = 'mwell_operating' and status = 'active'
    and effective_from <= pg_catalog.statement_timestamp()
    and (effective_to is null or effective_to > pg_catalog.statement_timestamp())
  order by effective_from desc
  limit 1
), classified as (
  select request_row.id, request_row.requirement_kind as stored_requirement_kind,
    private.policy_legacy_route_mapping(
      request_row.sourcing_method, request_row.category, request_row.lines,
      request_row.compliance, request_row.estimated_amount, active_profile.formal_bid_amount
    ) as route_mapping,
    active_profile.id as policy_profile_id, active_profile.code || ':' || active_profile.version as policy_version,
    active_profile.formal_bid_amount
  from procurement.requests request_row
  left join active_profile on true
  where request_row.solicitation_type is null
    or request_row.procurement_mode is null
    or request_row.governance_tier is null
    or request_row.policy_profile_id is null
)
update procurement.requests request_row set
  requirement_kind = coalesce(classified.stored_requirement_kind, classified.route_mapping->>'requirement_kind'),
  solicitation_type = classified.route_mapping->>'solicitation_type',
  procurement_mode = classified.route_mapping->>'procurement_mode',
  governance_tier = classified.route_mapping->>'governance_tier',
  policy_profile_id = classified.policy_profile_id,
  route_reasons = classified.route_mapping->'reasons',
  compliance = classified.route_mapping->'compliance',
  updated_at = pg_catalog.now()
from classified
where request_row.id = classified.id;

update procurement.route_decisions decision set status = 'policy_decision_required'
from procurement.requests request_row
where decision.request_id = request_row.id
  and coalesce(request_row.route_reasons, '[]'::jsonb) ? 'legacy_mapping_requires_review'
  and decision.status = 'confirmed';

insert into core.policy_remediation_queue(module, entity_type, entity_id, policy_version, reason_code, details)
select 'procurement', 'request', request_row.id,
  coalesce(profile.code || ':' || profile.version, 'policy-profile-unavailable'),
  'legacy_mapping_requires_review',
  jsonb_build_object(
    'category', request_row.category,
    'sourcing_method', request_row.sourcing_method,
    'lines', request_row.lines,
    'normalized_risk_facts', coalesce(request_row.compliance->'riskFacts', '{}'::jsonb)
  )
from procurement.requests request_row
left join procurement.policy_profiles profile on profile.id = request_row.policy_profile_id
where profile.id is null
   or coalesce(request_row.route_reasons, '[]'::jsonb) ? 'legacy_mapping_requires_review'
on conflict do nothing;

-- Restore the effective public submission contract without editing historical
-- applied migrations. Preserve the newer privacy/collaborator work by layering
-- it around the historical governed implementation instead of replacing it.
alter function private.policy_submit_procurement_request(jsonb)
  rename to policy_submit_procurement_request_pre_route_governance;

create or replace function private.policy_submit_procurement_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request procurement.requests;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'An attributable requester is required';
  end if;
  if not core.has_live_cap('procurement', 'create_request') then
    raise exception 'Not authorized: procurement.create_request';
  end if;
  select * into v_request
  from procurement.requests
  where id = payload->>'id'
  for update;
  if not found then raise exception 'Request not found'; end if;
  perform private.assert_minimum_request_contract(to_jsonb(v_request));
  -- The pre-route implementation derives approval tiers from the confirmed
  -- decision and remains the authority for submission evidence validation.
  perform procurement.derive_approval_tiers(
    v_request.category,
    coalesce(v_request.estimated_amount, 0),
    coalesce(v_request.sourcing_method, 'rfq')
  );
  v_result := private.policy_submit_procurement_request_pre_route_governance(payload);
  insert into procurement.request_collaborators(
    request_id, user_id, access_level, reason, granted_by
  )
  select distinct
    v_request.id, step.assigned_user_id, 'approve', 'approval_assignment', auth.uid()
  from procurement.approval_steps step
  where step.request_id = v_request.id and step.assigned_user_id is not null
  on conflict(request_id, user_id) do update set
    access_level = excluded.access_level,
    reason = excluded.reason,
    granted_by = excluded.granted_by,
    granted_at = pg_catalog.now(),
    revoked_by = null,
    revoked_at = null;
  return v_result;
end;
$$;

create or replace function procurement.submit_request(payload jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.policy_submit_procurement_request(payload) $$;

revoke all on function private.policy_route_legacy_method(text, text) from public, anon, authenticated;
revoke all on function private.policy_legacy_requirement_kind(text, jsonb) from public, anon, authenticated;
revoke all on function private.policy_normalized_risk_facts(jsonb) from public, anon, authenticated;
revoke all on function private.policy_normalized_risk_reasons(jsonb) from public, anon, authenticated;
revoke all on function private.policy_legacy_route_mapping(text, text, jsonb, jsonb, numeric, numeric) from public, anon, authenticated;
revoke all on function private.policy_route_confirmation_input(jsonb, integer) from public, anon, authenticated;
revoke all on function private.policy_route_exception_contract(text, numeric, numeric, numeric, text) from public, anon, authenticated;
revoke all on function private.policy_route_exception_is_eligible(text, text, procurement.policy_profiles, numeric) from public, anon, authenticated;
revoke all on function private.policy_derive_procurement_route(text, text) from public, anon, authenticated;
revoke all on function private.policy_confirm_route_decision(jsonb) from public, anon, authenticated;
revoke all on function private.policy_submit_procurement_request_pre_route_governance(jsonb) from public, anon, authenticated;
revoke all on function private.policy_submit_procurement_request(jsonb) from public, anon, authenticated;
revoke all on function procurement.confirm_route_decision(jsonb) from public, anon;
revoke all on function procurement.submit_request(jsonb) from public, anon;
grant execute on function procurement.confirm_route_decision(jsonb), procurement.submit_request(jsonb) to authenticated, service_role;
