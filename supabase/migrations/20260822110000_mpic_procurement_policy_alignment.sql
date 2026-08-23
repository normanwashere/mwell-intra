-- Canonical Mwell procurement policy alignment with incorporated MPIC controls.
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
  source_document_status text not null default 'draft_for_review',
  control_sources jsonb not null default '{}'::jsonb,
  formal_bid_amount numeric(14, 2),
  invite_target_min integer not null,
  invite_target_max integer not null,
  sealed_bid_minimum_responses integer not null,
  bid_window_working_days integer not null,
  max_extension_calendar_days integer not null,
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
  constraint policy_profiles_source_document_status_check check (
    source_document_status in ('draft_for_review', 'approved')
  ),
  constraint policy_profiles_active_source_approved_check check (
    status <> 'active' or source_document_status = 'approved'
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
    and max_extension_calendar_days > 0
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
      'sealedBidMinimumResponses', 'bidWindowWorkingDays', 'maxExtensionCalendarDays',
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
  request_id text not null references procurement.requests(id) on delete cascade,
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
  request_id text references procurement.requests(id) on delete cascade,
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
  using (
    status = 'active'
    or core.has_live_cap('core', 'manage_rbac')
    or core.has_live_cap('legal', 'manage_doa')
  );
create policy policy_profiles_governed_insert on procurement.policy_profiles
  for insert to authenticated
  with check (
    core.has_live_cap('core', 'manage_rbac')
    or core.has_live_cap('legal', 'manage_doa')
  );
create policy policy_profiles_governed_update on procurement.policy_profiles
  for update to authenticated
  using (
    core.has_live_cap('core', 'manage_rbac')
    or core.has_live_cap('legal', 'manage_doa')
  )
  with check (
    core.has_live_cap('core', 'manage_rbac')
    or core.has_live_cap('legal', 'manage_doa')
  );
create policy policy_profile_events_manage_read on procurement.policy_profile_events
  for select to authenticated
  using (
    core.has_live_cap('core', 'manage_rbac')
    or core.has_live_cap('legal', 'manage_doa')
  );
create policy policy_profile_events_governed_insert on procurement.policy_profile_events
  for insert to authenticated
  with check (
    core.has_live_cap('core', 'manage_rbac')
    or core.has_live_cap('legal', 'manage_doa')
  );
create policy policy_conflicts_manage_read on procurement.policy_conflicts
  for select to authenticated
  using (
    core.has_live_cap('core', 'manage_rbac')
    or core.has_live_cap('legal', 'manage_doa')
  );
create policy policy_conflicts_governed_update on procurement.policy_conflicts
  for update to authenticated
  using (
    core.has_live_cap('core', 'manage_rbac')
    or core.has_live_cap('legal', 'manage_doa')
  )
  with check (
    core.has_live_cap('core', 'manage_rbac')
    or core.has_live_cap('legal', 'manage_doa')
  );
create policy solicitation_communications_read on procurement.solicitation_communications
  for select to authenticated
  using (
    core.has_live_cap('procurement', 'view_dashboard')
    or core.has_live_cap('core', 'manage_rbac')
    or core.has_live_cap('legal', 'manage_doa')
  );
create policy policy_sla_events_read on procurement.policy_sla_events
  for select to authenticated
  using (
    core.has_live_cap('procurement', 'view_dashboard')
    or core.has_live_cap('core', 'manage_rbac')
    or core.has_live_cap('legal', 'manage_doa')
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
    and p_profile.max_extension_calendar_days > 0
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
  v_mwell_source constant text := 'mWell Procurement Policy and Procedures - Revised Modern Visual - Word Updated.docx (canonical Mwell requirements source)';
begin
  if jsonb_object_length(p_profile.control_sources) <> 16 or not (
    p_profile.control_sources ?& array[
      'formalBidAmount', 'inviteTargetMin', 'inviteTargetMax',
      'sealedBidMinimumResponses', 'bidWindowWorkingDays', 'maxExtensionCalendarDays',
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
    or p_profile.source_filename <> 'mWell Procurement Policy and Procedures - Revised Modern Visual - Word Updated.docx'
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
      source_organization, source_document_status, control_sources, formal_bid_amount, invite_target_min,
      invite_target_max, sealed_bid_minimum_responses, bid_window_working_days,
      max_extension_calendar_days, vendor_acknowledgement_hours, clarification_hours,
      tabulation_hours, technical_evaluation_working_days, po_acknowledgement_hours,
      repeat_order_max_amount, repeat_order_max_age_days, petty_cash_max_amount,
      po_invoice_threshold, vendor_probation_months, effective_from, effective_to,
      document_hash, created_by, last_modified_by
    ) values (
      pg_catalog.btrim(payload->>'code'), pg_catalog.btrim(payload->>'version'),
      pg_catalog.btrim(payload->>'name'), payload->>'relationship',
      nullif(payload->>'source_profile_id', '')::uuid, pg_catalog.btrim(payload->>'source_filename'),
      pg_catalog.btrim(payload->>'source_organization'), coalesce(nullif(payload->>'source_document_status', ''), 'draft_for_review'), coalesce(payload->'control_sources', '{}'::jsonb),
      nullif(v_controls->>'formalBidAmount', '')::numeric,
      (v_controls->>'inviteTargetMin')::integer, (v_controls->>'inviteTargetMax')::integer,
      (v_controls->>'sealedBidMinimumResponses')::integer, (v_controls->>'bidWindowWorkingDays')::integer,
      (v_controls->>'maxExtensionCalendarDays')::integer, (v_controls->>'vendorAcknowledgementHours')::integer,
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
      source_document_status = coalesce(nullif(payload->>'source_document_status', ''), 'draft_for_review'),
      control_sources = coalesce(payload->'control_sources', '{}'::jsonb),
      formal_bid_amount = nullif(v_controls->>'formalBidAmount', '')::numeric,
      invite_target_min = (v_controls->>'inviteTargetMin')::integer,
      invite_target_max = (v_controls->>'inviteTargetMax')::integer,
      sealed_bid_minimum_responses = (v_controls->>'sealedBidMinimumResponses')::integer,
      bid_window_working_days = (v_controls->>'bidWindowWorkingDays')::integer,
      max_extension_calendar_days = (v_controls->>'maxExtensionCalendarDays')::integer,
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
  if v_profile.source_document_status <> 'approved' then
    raise exception 'The controlled source document must be approved before profile activation';
  end if;
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
  if not found then return null; end if;
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

-- Request rows are the read model used by the client. Keep the latest
-- governed decision projection here atomically so refresh cannot strand a
-- successfully confirmed request behind an obsolete local compliance flag.
alter table procurement.requests
  add column if not exists route_version integer not null default 0,
  add column if not exists route_confirmed_at timestamptz,
  add column if not exists route_confirmed_by uuid references core.profiles(id) on delete restrict,
  add column if not exists solicitation_requirements jsonb not null default '{}'::jsonb;

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
    else
      v_kind := null;
      v_requires_review := true;
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
    'comparable', lower(coalesce(v_source->>'comparable', 'true')) = any(v_true_values),
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
  -- Historical records preserve their stored RFQ/RFP projection. Requirement
  -- kind must not retroactively rewrite an auditable solicitation decision.
  v_solicitation := case when v_mode = 'competitive_bidding'
    then case when p_method = 'rfp' then 'rfp' else 'rfq' end
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

create or replace function private.policy_normalize_solicitation_requirements(
  p_requirements jsonb,
  p_solicitation_type text
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_requirements jsonb := coalesce(p_requirements, '{}'::jsonb);
  v_key text;
  v_required text[] := case p_solicitation_type
    when 'rfq' then array['acceptanceCriteria', 'deliveryTerms', 'paymentTerms', 'shippingTerms', 'validityPeriod', 'responseDeadline']
    when 'rfp' then array['scopeOfWork', 'evaluationApproach', 'responseDeadline']
    else array[]::text[] end;
begin
  if jsonb_typeof(v_requirements) <> 'object' then
    raise exception 'Solicitation requirements must be an object';
  end if;
  foreach v_key in array v_required loop
    if nullif(pg_catalog.btrim(v_requirements->>v_key), '') is null then
      raise exception 'Missing required % solicitation requirement', v_key;
    end if;
  end loop;
  return jsonb_strip_nulls(v_requirements);
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
  v_solicitation := case when v_mode = 'competitive_bidding' then
    case when
      v_request.estimated_amount >= v_profile.formal_bid_amount
      or not coalesce((v_risk->>'comparable')::boolean, true)
      or coalesce((v_risk->>'complex')::boolean, false)
      or coalesce((v_risk->>'technical')::boolean, false)
      or coalesce((v_risk->>'strategic')::boolean, false)
      or coalesce((v_risk->>'highRisk')::boolean, false)
      or coalesce((v_risk->>'dataSensitive')::boolean, false)
    then 'rfp' else 'rfq' end
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
  if not coalesce((v_risk->>'comparable')::boolean, true) then
    v_reasons := array_append(v_reasons, 'scope:not_comparable');
  end if;
  v_reasons := array_append(v_reasons, 'solicitation:' || v_solicitation);
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
  v_requirements jsonb;
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
  v_requirements := private.policy_normalize_solicitation_requirements(
    v_request.solicitation_requirements, v_route->>'solicitation_type'
  );
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
    route_version = v_decision.request_version,
    route_confirmed_at = v_decision.confirmed_at,
    route_confirmed_by = v_decision.confirmed_by,
    solicitation_requirements = v_requirements,
    compliance = jsonb_set(
      coalesce(compliance, '{}'::jsonb), '{routeConfirmed}', 'true'::jsonb, true
    ),
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

-- New request callers must classify the requirement explicitly. Keep the
-- existing hardened attachment/create implementation intact, then persist the
-- only route input the requester may author. Solicitation, mode, tier, profile
-- and reasons are deliberately left for private.policy_derive_procurement_route.
alter function procurement.create_request(jsonb)
  rename to create_request_pre_policy_route;

create or replace function procurement.create_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requirement_kind text := nullif(pg_catalog.btrim(payload->>'requirement_kind'), '');
  v_requested_mode text := coalesce(nullif(pg_catalog.btrim(payload->>'requested_mode'), ''), 'competitive_bidding');
  v_solicitation_type text;
  v_profile procurement.policy_profiles;
  v_risk jsonb;
  v_requirements jsonb;
  v_created jsonb;
  v_request procurement.requests;
begin
  if jsonb_typeof(payload) <> 'object' then
    raise exception 'Request payload must be an object';
  end if;
  if v_requirement_kind not in ('materials', 'services') then
    raise exception 'An explicit requirement_kind of materials or services is required';
  end if;
  if v_requested_mode not in ('competitive_bidding', 'sole_source', 'repeat_order', 'emergency_purchase', 'petty_cash', 'approved_exception') then
    raise exception 'Unsupported procurement mode';
  end if;
  v_created := procurement.create_request_pre_policy_route(payload);
  select * into v_request
  from procurement.requests
  where id::text = v_created->>'id'
  for update;
  if not found then
    raise exception 'Created request could not be loaded for route classification';
  end if;

  select * into v_profile
  from procurement.policy_profiles
  where relationship = 'mwell_operating' and status = 'active'
    and effective_from <= pg_catalog.statement_timestamp()
    and (effective_to is null or effective_to > pg_catalog.statement_timestamp())
  order by effective_from desc
  limit 1;
  if not found then raise exception 'An effective Mwell policy profile is required'; end if;
  v_risk := private.policy_normalized_risk_facts(v_request.compliance);
  v_solicitation_type := case when v_requested_mode = 'competitive_bidding' then
    case when
      v_request.estimated_amount >= v_profile.formal_bid_amount
      or not coalesce((v_risk->>'comparable')::boolean, true)
      or coalesce((v_risk->>'complex')::boolean, false)
      or coalesce((v_risk->>'technical')::boolean, false)
      or coalesce((v_risk->>'strategic')::boolean, false)
      or coalesce((v_risk->>'highRisk')::boolean, false)
      or coalesce((v_risk->>'dataSensitive')::boolean, false)
    then 'rfp' else 'rfq' end
    else 'none' end;
  v_requirements := private.policy_normalize_solicitation_requirements(payload->'solicitation_requirements', v_solicitation_type);

  update procurement.requests
  set requirement_kind = v_requirement_kind,
      solicitation_requirements = v_requirements,
      updated_at = pg_catalog.now()
  where id = v_request.id
  returning * into v_request;
  return to_jsonb(v_request);
end;
$$;

revoke all on function procurement.create_request_pre_policy_route(jsonb) from public, anon, authenticated;
revoke all on function procurement.create_request(jsonb) from public, anon;
grant execute on function procurement.create_request(jsonb) to authenticated, service_role;

revoke all on function private.policy_route_legacy_method(text, text) from public, anon, authenticated;
revoke all on function private.policy_legacy_requirement_kind(text, jsonb) from public, anon, authenticated;
revoke all on function private.policy_normalized_risk_facts(jsonb) from public, anon, authenticated;
revoke all on function private.policy_normalized_risk_reasons(jsonb) from public, anon, authenticated;
revoke all on function private.policy_legacy_route_mapping(text, text, jsonb, jsonb, numeric, numeric) from public, anon, authenticated;
revoke all on function private.policy_route_confirmation_input(jsonb, integer) from public, anon, authenticated;
revoke all on function private.policy_normalize_solicitation_requirements(jsonb, text) from public, anon, authenticated;
revoke all on function private.policy_route_exception_contract(text, numeric, numeric, numeric, text) from public, anon, authenticated;
revoke all on function private.policy_route_exception_is_eligible(text, text, procurement.policy_profiles, numeric) from public, anon, authenticated;
revoke all on function private.policy_derive_procurement_route(text, text) from public, anon, authenticated;
revoke all on function private.policy_confirm_route_decision(jsonb) from public, anon, authenticated;
revoke all on function private.policy_submit_procurement_request_pre_route_governance(jsonb) from public, anon, authenticated;
revoke all on function private.policy_submit_procurement_request(jsonb) from public, anon, authenticated;
revoke all on function procurement.confirm_route_decision(jsonb) from public, anon;
revoke all on function procurement.submit_request(jsonb) from public, anon;
grant execute on function procurement.confirm_route_decision(jsonb), procurement.submit_request(jsonb) to authenticated, service_role;

-- Task 6: competitive sourcing is governed by the effective profile rather
-- than a user-entered quote target. These additions are intentionally
-- additive because the migration is applied as one UAT release.
alter table procurement.sourcing_events
  add column if not exists original_submission_deadline timestamptz,
  add column if not exists package_version text,
  add column if not exists package_hash text,
  add column if not exists failed_bid_reason text;

-- Preserve the pre-Task-6 deadline as the immutable extension baseline before
-- any governed RPC becomes callable. A missing legacy deadline is unsafe: it
-- would let later extensions establish their own cap.
update procurement.sourcing_events
set original_submission_deadline = submission_deadline
where original_submission_deadline is null
  and submission_deadline is not null;

do $$
begin
  if exists (
    select 1
    from procurement.sourcing_events
    where original_submission_deadline is null
  ) then
    raise exception 'Every governed sourcing event needs its original submission deadline before Task 6 controls are exposed';
  end if;
end;
$$;

alter table procurement.sourcing_events
  alter column original_submission_deadline set not null;

alter table procurement.sourcing_events
  drop constraint if exists sourcing_event_status_check,
  add constraint sourcing_event_status_check check (
    status in ('draft', 'issued', 'response_closed', 'failed_bid', 'evaluation', 'awarded', 'cancelled')
  ),
  drop constraint if exists sourcing_event_failed_bid_reason_check,
  add constraint sourcing_event_failed_bid_reason_check check (
    failed_bid_reason is null or failed_bid_reason in (
      'insufficient_responses', 'non_compliant_submissions',
      'all_technically_non_compliant', 'implausible_pricing'
    )
  );

alter table procurement.sourcing_responses
  add column if not exists invitation_delivered_at timestamptz,
  add column if not exists invitation_acknowledged_at timestamptz,
  add column if not exists current_invitation_communication_id uuid,
  add column if not exists current_invitation_group_id uuid,
  add column if not exists current_invitation_package_version text,
  add column if not exists current_invitation_package_hash text;

alter table procurement.solicitation_communications
  drop constraint if exists solicitation_communications_type_check,
  add constraint solicitation_communications_type_check check (
    communication_type in ('invitation', 'invitation_acknowledgement', 'clarification', 'extension', 'requote', 'award_notice', 'failed_bid_notice')
  );

create index if not exists solicitation_communications_request_group_idx
  on procurement.solicitation_communications(request_id, (detail->>'notificationGroupId'));

create unique index if not exists solicitation_communications_acknowledgement_once_idx
  on procurement.solicitation_communications ((detail->>'acknowledgedCommunicationId'))
  where communication_type = 'invitation_acknowledgement';

create or replace function private.policy_sourcing_can_manage()
returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    core.has_live_cap('procurement', 'manage_rfp')
    or core.has_live_cap('procurement', 'admin')
  )
$$;

create or replace function private.policy_sourcing_can_review()
returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    core.has_live_cap('procurement', 'approve_award')
    or core.has_live_cap('procurement', 'admin')
  )
$$;

create or replace function private.policy_add_working_days(p_from timestamptz, p_days integer)
returns timestamptz
language plpgsql immutable set search_path = '' as $$
declare v_day timestamptz := p_from; v_remaining integer := p_days;
begin
  if p_days < 0 then raise exception 'Working days cannot be negative'; end if;
  while v_remaining > 0 loop
    v_day := v_day + interval '1 day';
    if extract(isodow from v_day) < 6 then v_remaining := v_remaining - 1; end if;
  end loop;
  return v_day;
end;
$$;

create or replace function private.policy_sourcing_profile(p_request_id text)
returns procurement.policy_profiles
language plpgsql stable security definer set search_path = '' as $$
declare v_profile procurement.policy_profiles;
begin
  select profile.* into v_profile
  from procurement.requests request_row
  join procurement.policy_profiles profile on profile.id = request_row.policy_profile_id
  where request_row.id::text = p_request_id;
  if not found or v_profile.relationship <> 'mwell_operating' or v_profile.status <> 'active' then
    raise exception 'An active Mwell operating policy profile is required for sourcing';
  end if;
  return v_profile;
end;
$$;

create or replace function private.policy_sourcing_approved_exception(p_request_id text, p_phase text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from procurement.exception_packs pack
    where pack.request_id::text = p_request_id
      and pack.exception_type = 'insufficient_bids'
      and pack.status = 'approved'
      and coalesce(pack.evidence->>'phase', 'evaluation') = p_phase
      and pack.evidence->>'createdBy' is distinct from pack.evidence->>'reviewedBy'
  )
$$;

create or replace function procurement.save_sourcing_event(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_route procurement.route_decisions; v_event procurement.sourcing_events; v_profile procurement.policy_profiles;
  v_deadline timestamptz := nullif(jsonb_extract_path_text(payload, 'submission_deadline'), '')::timestamptz;
  v_target integer := nullif(jsonb_extract_path_text(payload, 'intended_responses'), '')::integer;
  v_request_id text := jsonb_extract_path_text(payload, 'request_id');
  v_package_version text := jsonb_extract_path_text(payload, 'package_version');
  v_package_hash text := jsonb_extract_path_text(payload, 'package_hash');
begin
  if not private.policy_sourcing_can_manage() then raise exception 'Not authorized to manage sourcing'; end if;
  if jsonb_typeof(payload) <> 'object' or nullif(btrim(v_request_id), '') is null then raise exception 'A request identity is required'; end if;
  v_profile := private.policy_sourcing_profile(v_request_id);
  select * into v_route from procurement.route_decisions
    where request_id::text = v_request_id and status = 'confirmed'
    order by request_version desc limit 1 for update;
  if not found or v_route.solicitation_type not in ('rfq', 'rfp') or v_route.procurement_mode <> 'competitive_bidding' then
    raise exception 'A confirmed competitive RFQ or RFP route is required';
  end if;
  if v_target not in (v_profile.invite_target_min, v_profile.invite_target_max) then
    raise exception 'Invitation target must be % or %', v_profile.invite_target_min, v_profile.invite_target_max;
  end if;
  if v_deadline is null or v_deadline <= statement_timestamp() then raise exception 'A future submission deadline is required'; end if;
  if nullif(btrim(v_package_version), '') is null or nullif(btrim(v_package_hash), '') is null then
    raise exception 'Package version and package hash are required';
  end if;
  select * into v_event from procurement.sourcing_events
    where request_id::text = v_request_id and status <> 'cancelled'
    order by created_at desc limit 1 for update;
  if found and v_event.status <> 'draft' then raise exception 'Only a draft sourcing event can be edited'; end if;
  if found then
    update procurement.sourcing_events set submission_deadline = v_deadline, intended_responses = v_target,
      package_version = btrim(v_package_version), package_hash = btrim(v_package_hash)
    where id = v_event.id returning * into v_event;
  else
    insert into procurement.sourcing_events(
      request_id, route_decision_id, submission_deadline, original_submission_deadline,
      intended_responses, package_version, package_hash, clarification_log
    ) values (
      v_route.request_id, v_route.id, v_deadline, v_deadline, v_target,
      btrim(v_package_version), btrim(v_package_hash), '[]'::jsonb
    ) returning * into v_event;
  end if;
  return to_jsonb(v_event);
end;
$$;

create or replace function procurement.invite_sourcing_vendors(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_event procurement.sourcing_events; v_profile procurement.policy_profiles; v_group uuid := gen_random_uuid();
  v_vendor_ids uuid[]; v_count integer; v_duplicate integer; v_vendor_id uuid; v_communication_id uuid;
begin
  if not private.policy_sourcing_can_manage() then raise exception 'Not authorized to manage sourcing'; end if;
  select * into v_event from procurement.sourcing_events where id = (payload->>'sourcing_event_id')::uuid for update;
  if not found or v_event.status <> 'draft' then raise exception 'Vendors can only be invited while the sourcing event is in controlled invitation state'; end if;
  v_profile := private.policy_sourcing_profile(v_event.request_id::text);
  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[]) into v_vendor_ids from jsonb_array_elements_text(coalesce(payload->'vendor_ids', '[]'::jsonb));
  if cardinality(v_vendor_ids) is null or cardinality(v_vendor_ids) = 0 then raise exception 'At least one vendor is required'; end if;
  select count(*) into v_count from core.vendors vendor where vendor.id = any(v_vendor_ids)
    and vendor.accreditation_status = 'approved' and (vendor.accreditation_expires_at is null or vendor.accreditation_expires_at > statement_timestamp());
  if v_count <> cardinality(v_vendor_ids) then raise exception 'Only currently accredited vendors may be invited'; end if;
  select count(*) into v_duplicate from procurement.sourcing_responses response where response.sourcing_event_id = v_event.id and response.vendor_id = any(v_vendor_ids);
  if v_duplicate > 0 then raise exception 'Each vendor may receive a controlled invitation only once'; end if;
  foreach v_vendor_id in array v_vendor_ids loop
    insert into procurement.sourcing_responses(sourcing_event_id, vendor_id, invited_at, invitation_delivered_at)
    values(v_event.id, v_vendor_id, statement_timestamp(), statement_timestamp());
    insert into procurement.solicitation_communications(request_id, policy_profile_id, communication_type, sent_by, audience, content_hash, detail)
    values(
      v_event.request_id, v_profile.id, 'invitation', auth.uid(), v_vendor_id::text,
      encode(extensions.digest(convert_to(jsonb_build_object('type', 'invitation', 'group', v_group, 'vendor', v_vendor_id, 'version', v_event.package_version, 'hash', v_event.package_hash, 'deadline', v_event.submission_deadline)::text, 'UTF8'), 'sha256'), 'hex'),
      jsonb_build_object('notificationGroupId', v_group, 'recipientVendorId', v_vendor_id, 'packageVersion', v_event.package_version, 'packageHash', v_event.package_hash, 'submissionDeadline', v_event.submission_deadline, 'sentAt', statement_timestamp(), 'deliveredAt', statement_timestamp())
    ) returning id into v_communication_id;
    update procurement.sourcing_responses
    set current_invitation_communication_id = v_communication_id,
      current_invitation_group_id = v_group,
      current_invitation_package_version = v_event.package_version,
      current_invitation_package_hash = v_event.package_hash,
      invitation_acknowledged_at = null
    where sourcing_event_id = v_event.id and vendor_id = v_vendor_id;
  end loop;
  return jsonb_build_object('notification_group_id', v_group, 'recipient_count', cardinality(v_vendor_ids));
end;
$$;

create or replace function procurement.acknowledge_sourcing_invitation(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_response procurement.sourcing_responses; v_event procurement.sourcing_events; v_vendor_id uuid := (payload->>'vendor_id')::uuid;
  v_communication procurement.solicitation_communications; v_acknowledgement procurement.solicitation_communications;
  v_communication_id uuid := (payload->>'communication_id')::uuid; v_group_id uuid := (payload->>'notification_group_id')::uuid;
  v_package_version text := nullif(btrim(payload->>'package_version'), ''); v_package_hash text := nullif(btrim(payload->>'package_hash'), '');
begin
  if auth.uid() is null or core.current_vendor_id() is distinct from v_vendor_id then raise exception 'Only the invited vendor may acknowledge this invitation'; end if;
  select response.* into v_response from procurement.sourcing_responses response where response.sourcing_event_id = (payload->>'sourcing_event_id')::uuid and response.vendor_id = v_vendor_id for update;
  if not found then raise exception 'Controlled invitation not found'; end if;
  select * into v_event from procurement.sourcing_events where id = v_response.sourcing_event_id;
  if v_communication_id is null or v_group_id is null or v_package_version is null or v_package_hash is null then raise exception 'Current communication, notification group, package version, and package hash are required'; end if;
  if v_response.current_invitation_communication_id is distinct from v_communication_id
    or v_response.current_invitation_group_id is distinct from v_group_id
    or v_response.current_invitation_package_version is distinct from v_package_version
    or v_response.current_invitation_package_hash is distinct from v_package_hash then
    raise exception 'Acknowledgement must match the vendor current controlled invitation package';
  end if;
  select * into v_communication from procurement.solicitation_communications communication
  where communication.id = v_communication_id
    and communication.request_id = v_event.request_id
    and communication.communication_type in ('invitation', 'requote')
    and communication.detail->>'recipientVendorId' = v_vendor_id::text
    and communication.detail->>'notificationGroupId' = v_group_id::text
    and communication.detail->>'packageVersion' = v_package_version
    and communication.detail->>'packageHash' = v_package_hash;
  if not found then raise exception 'Current invitation delivery evidence not found'; end if;
  select * into v_acknowledgement from procurement.solicitation_communications acknowledgement
  where acknowledgement.communication_type = 'invitation_acknowledgement'
    and acknowledgement.detail->>'acknowledgedCommunicationId' = v_communication_id::text
    and acknowledgement.detail->>'recipientVendorId' = v_vendor_id::text;
  if found then
    return jsonb_build_object('sourcing_event_id', v_response.sourcing_event_id, 'vendor_id', v_vendor_id, 'communication_id', v_communication_id, 'notification_group_id', v_group_id, 'package_version', v_package_version, 'package_hash', v_package_hash, 'acknowledged_at', coalesce(v_acknowledgement.detail->>'acknowledgedAt', v_acknowledgement.sent_at::text), 'replayed', true);
  end if;
  insert into procurement.solicitation_communications(request_id, policy_profile_id, communication_type, sent_by, audience, content_hash, detail)
  values(
    v_event.request_id, v_communication.policy_profile_id, 'invitation_acknowledgement', auth.uid(), 'governed-audit',
    encode(extensions.digest(convert_to(jsonb_build_object('type', 'invitation_acknowledgement', 'communication', v_communication_id, 'group', v_group_id, 'vendor', v_vendor_id, 'version', v_package_version, 'hash', v_package_hash)::text, 'UTF8'), 'sha256'), 'hex'),
    jsonb_build_object('acknowledgedCommunicationId', v_communication_id, 'notificationGroupId', v_group_id, 'recipientVendorId', v_vendor_id, 'packageVersion', v_package_version, 'packageHash', v_package_hash, 'acknowledgedAt', statement_timestamp())
  ) returning * into v_acknowledgement;
  update procurement.sourcing_responses set invitation_acknowledged_at = v_acknowledgement.sent_at where id = v_response.id;
  return jsonb_build_object('sourcing_event_id', v_response.sourcing_event_id, 'vendor_id', v_vendor_id, 'communication_id', v_communication_id, 'notification_group_id', v_group_id, 'package_version', v_package_version, 'package_hash', v_package_hash, 'acknowledged_at', v_acknowledgement.sent_at, 'replayed', false);
end;
$$;

create or replace function procurement.record_sourcing_response(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_event procurement.sourcing_events; v_response procurement.sourcing_responses; v_vendor core.vendors; v_received timestamptz;
begin
  if not private.policy_sourcing_can_manage() then raise exception 'Not authorized to manage sourcing'; end if;
  select * into v_event from procurement.sourcing_events where id = (payload->>'sourcing_event_id')::uuid for update;
  if not found or v_event.status <> 'issued' then raise exception 'Issue the event before recording a response'; end if;
  select * into v_vendor from core.vendors where id = (payload->>'vendor_id')::uuid;
  if not found then raise exception 'Vendor not found'; end if;
  v_received := nullif(payload->>'received_at', '')::timestamptz;
  if v_received is null then raise exception 'Use the governed invitation command before issue'; end if;
  if not exists(select 1 from procurement.sourcing_responses prior where prior.sourcing_event_id = v_event.id and prior.vendor_id = v_vendor.id and prior.invited_at is not null) then raise exception 'Only an invited vendor may submit a response'; end if;
  if nullif(btrim(payload->>'proposal_storage_path'), '') is null then raise exception 'A proposal evidence reference is required'; end if;
  update procurement.sourcing_responses set received_at = v_received, deadline_compliant = v_received <= v_event.submission_deadline,
    proposal_storage_path = btrim(payload->>'proposal_storage_path'), commercial = coalesce(payload->'commercial', '{}'::jsonb), technical = coalesce(payload->'technical', '{}'::jsonb), material_exceptions = coalesce(payload->'material_exceptions', '[]'::jsonb)
  where sourcing_event_id = v_event.id and vendor_id = v_vendor.id returning * into v_response;
  return to_jsonb(v_response);
end;
$$;

create or replace function procurement.record_solicitation_communication(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_event procurement.sourcing_events; v_profile procurement.policy_profiles; v_type text := payload->>'communication_type';
  v_group uuid := gen_random_uuid(); v_extension integer := coalesce((payload->>'extension_calendar_days')::integer, 0);
  v_new_deadline timestamptz; v_extension_cap timestamptz; v_count integer;
begin
  if not private.policy_sourcing_can_manage() then raise exception 'Not authorized to manage sourcing'; end if;
  select * into v_event from procurement.sourcing_events where id = (payload->>'sourcing_event_id')::uuid for update;
  if not found or v_event.status not in ('issued', 'response_closed', 'evaluation', 'failed_bid') then raise exception 'Sourcing event is not available for communication'; end if;
  v_profile := private.policy_sourcing_profile(v_event.request_id::text);
  select count(*) into v_count from procurement.sourcing_responses where sourcing_event_id = v_event.id and invited_at is not null;
  if v_count = 0 then raise exception 'At least one invited vendor is required'; end if;
  if v_type = 'clarification' then
    if nullif(btrim(payload->>'question'), '') is null or nullif(btrim(payload->>'answer'), '') is null then raise exception 'Clarification question and answer are required'; end if;
  elsif v_type = 'extension' then
    if v_extension < 1 or v_extension > v_profile.max_extension_calendar_days then raise exception 'Extension must be between 1 and % calendar days', v_profile.max_extension_calendar_days; end if;
    v_new_deadline := v_event.submission_deadline + pg_catalog.make_interval(days => v_extension);
    v_extension_cap := v_event.original_submission_deadline + pg_catalog.make_interval(days => v_profile.max_extension_calendar_days);
    if v_new_deadline > v_extension_cap then raise exception 'Cumulative extension cannot exceed % calendar days from the original submission deadline', v_profile.max_extension_calendar_days; end if;
    update procurement.sourcing_events set submission_deadline = v_new_deadline, status = 'issued', failed_bid_reason = null where id = v_event.id;
  else raise exception 'Unsupported solicitation communication'; end if;
  insert into procurement.solicitation_communications(
    request_id, policy_profile_id, communication_type, sent_by, audience, content_hash, detail
  ) select v_event.request_id, v_profile.id, v_type, auth.uid(), response.vendor_id::text,
    encode(extensions.digest(convert_to(jsonb_build_object('type', v_type, 'question', payload->>'question', 'answer', payload->>'answer', 'deadline', v_new_deadline)::text, 'UTF8'), 'sha256'), 'hex'),
    jsonb_build_object('notificationGroupId', v_group, 'recipientVendorId', response.vendor_id,
      'question', nullif(btrim(payload->>'question'), ''), 'answer', nullif(btrim(payload->>'answer'), ''),
      'extensionCalendarDays', case when v_type = 'extension' then v_extension else null end,
      'submissionDeadline', v_new_deadline, 'packageVersion', v_event.package_version, 'packageHash', v_event.package_hash)
  from procurement.sourcing_responses response where response.sourcing_event_id = v_event.id and response.invited_at is not null;
  return jsonb_build_object('notification_group_id', v_group, 'recipient_count', v_count, 'submission_deadline', v_new_deadline);
end;
$$;

create or replace function procurement.transition_sourcing_event(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_event procurement.sourcing_events; v_profile procurement.policy_profiles; v_action text := payload->>'action';
  v_invited integer; v_accredited integer; v_usable integer; v_min_deadline timestamptz; v_requote_deadline timestamptz; v_extension_cap timestamptz; v_group uuid := gen_random_uuid(); v_has_exception boolean; v_vendor core.vendors; v_response procurement.sourcing_responses; v_communication_id uuid;
begin
  if not private.policy_sourcing_can_manage() then raise exception 'Not authorized to manage sourcing'; end if;
  select * into v_event from procurement.sourcing_events where id = (payload->>'id')::uuid for update;
  if not found then raise exception 'Sourcing event not found'; end if;
  v_profile := private.policy_sourcing_profile(v_event.request_id::text);
  select count(*), count(*) filter(where vendor.accreditation_status = 'approved' and (vendor.accreditation_expires_at is null or vendor.accreditation_expires_at > statement_timestamp())), count(*) filter(where response.received_at is not null and response.deadline_compliant is distinct from false)
    into v_invited, v_accredited, v_usable
  from procurement.sourcing_responses response join core.vendors vendor on vendor.id = response.vendor_id
  where response.sourcing_event_id = v_event.id and response.invited_at is not null;
  if v_action = 'issue' then
    v_has_exception := private.policy_sourcing_approved_exception(v_event.request_id::text, 'pre_issue');
    if v_event.status <> 'draft' then raise exception 'Only a draft event can be issued'; end if;
    if v_event.package_version is null or v_event.package_hash is null then raise exception 'Controlled package evidence is required'; end if;
    if v_event.submission_deadline is null then raise exception 'A submission deadline is required'; end if;
    v_min_deadline := private.policy_add_working_days(statement_timestamp(), v_profile.bid_window_working_days);
    if v_event.submission_deadline < v_min_deadline then raise exception 'Submission deadline must allow at least % working days', v_profile.bid_window_working_days; end if;
    if v_accredited < v_profile.invite_target_min and not v_has_exception then raise exception 'At least % accredited invitees or an approved pre-issue exception is required', v_profile.invite_target_min; end if;
    update procurement.sourcing_events set status = 'issued', issued_at = statement_timestamp() where id = v_event.id returning * into v_event;
  elsif v_action = 'response_closed' then
    if v_event.status <> 'issued' then raise exception 'Only an issued event can close responses'; end if;
    if statement_timestamp() < v_event.submission_deadline then raise exception 'The submission deadline has not passed'; end if;
    update procurement.sourcing_events set status = case when v_usable < v_profile.sealed_bid_minimum_responses then 'failed_bid' else 'response_closed' end,
      failed_bid_reason = case when v_usable < v_profile.sealed_bid_minimum_responses then 'insufficient_responses' else null end
    where id = v_event.id returning * into v_event;
  elsif v_action = 'failed_bid' then
    if v_event.status not in ('issued', 'response_closed', 'evaluation') then raise exception 'This event cannot be marked failed'; end if;
    if payload->>'failed_bid_reason' not in ('insufficient_responses', 'non_compliant_submissions', 'all_technically_non_compliant', 'implausible_pricing') then raise exception 'A valid failed-bid reason is required'; end if;
    update procurement.sourcing_events set status = 'failed_bid', failed_bid_reason = payload->>'failed_bid_reason' where id = v_event.id returning * into v_event;
    insert into procurement.solicitation_communications(request_id, policy_profile_id, communication_type, sent_by, audience, content_hash, detail)
    values(v_event.request_id, v_profile.id, 'failed_bid_notice', auth.uid(), 'governed-audit', encode(extensions.digest(convert_to(v_event.id::text || ':' || (payload->>'failed_bid_reason'), 'UTF8'), 'sha256'), 'hex'), jsonb_build_object('failedBidReason', payload->>'failed_bid_reason'));
  elsif v_action = 'source_additional_and_requote' then
    if v_event.status <> 'failed_bid' then raise exception 'Failed-bid recovery is required before sourcing additional vendors'; end if;
    select * into v_vendor from core.vendors where id = (payload->>'vendor_id')::uuid;
    if not found or v_vendor.accreditation_status <> 'approved' or (v_vendor.accreditation_expires_at is not null and v_vendor.accreditation_expires_at <= statement_timestamp()) then raise exception 'Only an additional currently accredited vendor may be requoted'; end if;
    if exists(select 1 from procurement.sourcing_responses response where response.sourcing_event_id = v_event.id and response.vendor_id = v_vendor.id) then raise exception 'Select an additional vendor who has not already been invited'; end if;
    v_requote_deadline := nullif(payload->>'submission_deadline', '')::timestamptz;
    if v_requote_deadline is null or v_requote_deadline <= v_event.submission_deadline then raise exception 'A later requote deadline is required'; end if;
    v_extension_cap := v_event.original_submission_deadline + pg_catalog.make_interval(days => v_profile.max_extension_calendar_days);
    if v_requote_deadline > v_extension_cap then raise exception 'Requote deadline cannot exceed % calendar days from the original submission deadline', v_profile.max_extension_calendar_days; end if;
    if nullif(btrim(payload->>'package_version'), '') is null or nullif(btrim(payload->>'package_hash'), '') is null or (btrim(payload->>'package_version') = v_event.package_version and btrim(payload->>'package_hash') = v_event.package_hash) then raise exception 'A new controlled package version or hash is required for requote'; end if;
    insert into procurement.sourcing_responses(sourcing_event_id, vendor_id, invited_at, invitation_delivered_at) values(v_event.id, v_vendor.id, statement_timestamp(), statement_timestamp());
    update procurement.sourcing_events set status = 'issued', failed_bid_reason = null, submission_deadline = v_requote_deadline, package_version = btrim(payload->>'package_version'), package_hash = btrim(payload->>'package_hash') where id = v_event.id returning * into v_event;
    for v_response in
      select * from procurement.sourcing_responses response
      where response.sourcing_event_id = v_event.id and response.invited_at is not null
    loop
      insert into procurement.solicitation_communications(request_id, policy_profile_id, communication_type, sent_by, audience, content_hash, detail)
      values(
        v_event.request_id, v_profile.id, 'requote', auth.uid(), v_response.vendor_id::text,
        encode(extensions.digest(convert_to(jsonb_build_object('type', 'requote', 'event', v_event.id, 'group', v_group, 'vendor', v_response.vendor_id, 'version', v_event.package_version, 'hash', v_event.package_hash, 'deadline', v_event.submission_deadline)::text, 'UTF8'), 'sha256'), 'hex'),
        jsonb_build_object('notificationGroupId', v_group, 'recipientVendorId', v_response.vendor_id, 'packageVersion', v_event.package_version, 'packageHash', v_event.package_hash, 'submissionDeadline', v_event.submission_deadline, 'sentAt', statement_timestamp(), 'deliveredAt', statement_timestamp())
      ) returning id into v_communication_id;
      update procurement.sourcing_responses
      set current_invitation_communication_id = v_communication_id,
        current_invitation_group_id = v_group,
        current_invitation_package_version = v_event.package_version,
        current_invitation_package_hash = v_event.package_hash,
        invitation_acknowledged_at = null
      where id = v_response.id;
    end loop;
  elsif v_action = 'evaluation' then
    v_has_exception := private.policy_sourcing_approved_exception(v_event.request_id::text, 'evaluation');
    if v_event.status not in ('response_closed', 'failed_bid') then raise exception 'Response closure or failed-bid recovery is required before evaluation'; end if;
    if v_usable < v_profile.sealed_bid_minimum_responses and not v_has_exception then raise exception '% usable responses or an approved evaluation exception are required before sealed-bid opening', v_profile.sealed_bid_minimum_responses; end if;
    update procurement.sourcing_events set status = 'evaluation' where id = v_event.id returning * into v_event;
  elsif v_action = 'award' then
    v_has_exception := private.policy_sourcing_approved_exception(v_event.request_id::text, 'evaluation');
    if v_event.status <> 'evaluation' then raise exception 'Controlled evaluation is required before award'; end if;
    if v_usable < v_profile.sealed_bid_minimum_responses and not v_has_exception then raise exception '% usable responses or an approved evaluation exception are required before award', v_profile.sealed_bid_minimum_responses; end if;
    if not exists(select 1 from procurement.sourcing_responses response where response.sourcing_event_id = v_event.id and response.vendor_id = (payload->>'selected_vendor_id')::uuid and response.received_at is not null and response.deadline_compliant is distinct from false) then raise exception 'Select a compliant vendor with a usable response'; end if;
    if nullif(btrim(payload->>'closure_note'), '') is null then raise exception 'Award rationale is required'; end if;
    update procurement.sourcing_events set status = 'awarded', selected_vendor_id = (payload->>'selected_vendor_id')::uuid, closure_note = btrim(payload->>'closure_note'), closed_at = statement_timestamp() where id = v_event.id returning * into v_event;
    update procurement.requests request_row set core_vendor_id = v_event.selected_vendor_id, vendor_name = vendor.legal_name, updated_at = statement_timestamp() from core.vendors vendor where request_row.id = v_event.request_id and vendor.id = v_event.selected_vendor_id;
  elsif v_action = 'cancel' then
    if v_event.status = 'awarded' then raise exception 'An awarded sourcing event cannot be cancelled'; end if;
    update procurement.sourcing_events set status = 'cancelled', closure_note = nullif(btrim(payload->>'closure_note'), ''), closed_at = statement_timestamp() where id = v_event.id returning * into v_event;
  else raise exception 'Unsupported sourcing transition'; end if;
  return to_jsonb(v_event);
end;
$$;

create or replace function procurement.submit_insufficient_bid_exception(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_event procurement.sourcing_events; v_pack procurement.exception_packs; v_profile procurement.policy_profiles; v_usable integer; v_phase text := coalesce(nullif(btrim(payload->>'phase'), ''), 'evaluation');
begin
  if not private.policy_sourcing_can_manage() then raise exception 'Not authorized to submit a sourcing exception'; end if;
  select * into v_event from procurement.sourcing_events where id = (payload->>'sourcing_event_id')::uuid for update;
  if not found or v_event.status not in ('draft', 'failed_bid', 'response_closed') then raise exception 'A draft, response-closed, or failed-bid sourcing event is required'; end if;
  if v_phase not in ('pre_issue', 'evaluation') then raise exception 'Exception phase must be pre_issue or evaluation'; end if;
  v_profile := private.policy_sourcing_profile(v_event.request_id::text);
  select count(*) filter(where received_at is not null and deadline_compliant is distinct from false) into v_usable from procurement.sourcing_responses where sourcing_event_id = v_event.id;
  if v_phase = 'evaluation' and v_usable >= v_profile.sealed_bid_minimum_responses then raise exception 'The sealed-bid response minimum has already been met'; end if;
  if length(btrim(coalesce(payload->>'justification', ''))) < 20 or length(btrim(coalesce(payload->>'price_reasonableness', ''))) < 10 then raise exception 'Detailed justification and price reasonableness are required'; end if;
  update procurement.exception_packs set status = 'superseded' where request_id = v_event.request_id and exception_type = 'insufficient_bids' and status in ('draft', 'under_review', 'rejected') and coalesce(evidence->>'phase', 'evaluation') = v_phase;
  insert into procurement.exception_packs(request_id, exception_type, justification, evidence, price_reasonableness, status)
  values(v_event.request_id, 'insufficient_bids', btrim(payload->>'justification'), jsonb_build_object('sourcingEventId', v_event.id, 'phase', v_phase, 'usableResponses', v_usable, 'createdBy', auth.uid(), 'createdAt', statement_timestamp()), btrim(payload->>'price_reasonableness'), 'under_review') returning * into v_pack;
  return to_jsonb(v_pack);
end;
$$;

-- Task 9 fix round 1: issue-time authoritative lifecycle initialization.
create table if not exists procurement.purchase_order_lifecycle_state (
 purchase_order_id text primary key references procurement.purchase_orders(id) on delete restrict, revision integer not null default 1,
 sent_at timestamptz, acknowledged_at timestamptz, acknowledgement_due_at timestamptz, acknowledgement_reference text,
 delivery_notice_at timestamptz, delivery_notice_reference text, quality_recovery_status text not null default 'none', closure_status text not null default 'open',
 closed_at timestamptz, closed_by uuid references core.profiles(id), closure_reason text, updated_at timestamptz not null default statement_timestamp());
create table if not exists procurement.purchase_order_lifecycle_events (
 id uuid primary key default gen_random_uuid(), purchase_order_id text not null references procurement.purchase_orders(id) on delete restrict, event_type text not null,
 expected_revision integer not null, resulting_revision integer not null, actor_id uuid not null references core.profiles(id), evidence_reference text, payload jsonb not null default '{}'::jsonb, recorded_at timestamptz not null default statement_timestamp());
create or replace function private.policy_po_issue_lifecycle()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status='issued' and old.status is distinct from 'issued' then
    insert into procurement.purchase_order_lifecycle_state(purchase_order_id,revision,sent_at,acknowledgement_due_at)
    values(new.id,1,new.issued_at,new.issued_at + interval '48 hours') on conflict (purchase_order_id) do nothing;
    insert into procurement.purchase_order_lifecycle_events(purchase_order_id,event_type,expected_revision,resulting_revision,actor_id,evidence_reference,payload)
    values(new.id,'sent',1,2,coalesce(new.actor_id,auth.uid()),'issued_at',jsonb_build_object('issuedAt',new.issued_at)) on conflict do nothing;
  end if; return new;
end;
$$;
revoke execute on function private.policy_po_issue_lifecycle() from public, anon, authenticated;
drop trigger if exists purchase_order_issue_lifecycle on procurement.purchase_orders;
create trigger purchase_order_issue_lifecycle after update of status on procurement.purchase_orders for each row execute function private.policy_po_issue_lifecycle();
insert into procurement.purchase_order_lifecycle_state(purchase_order_id,revision,sent_at,acknowledgement_due_at)
select id,1,issued_at,issued_at + interval '48 hours' from procurement.purchase_orders where status='issued' and issued_at is not null on conflict (purchase_order_id) do nothing;

create or replace function procurement.review_open_purchase_orders(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 if not (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','view_dashboard') or core.has_live_cap('procurement','admin')) then raise exception 'Procurement monitoring authority is required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',po.id||':weekly','purchaseOrderId',po.id,'kind',case when state.acknowledged_at is null and statement_timestamp()>=po.issued_at+interval '48 hours' then 'vendor_acknowledgement_overdue' when state.acknowledged_at is null and statement_timestamp()>=po.issued_at+interval '47 hours' then 'vendor_acknowledgement_due_soon' else 'open_po' end,'owner','Procurement','dueAt',po.issued_at+interval '48 hours','ageHours',floor(extract(epoch from statement_timestamp()-po.issued_at)/3600),'nextAction',case when state.acknowledged_at is null and statement_timestamp()>=po.issued_at+interval '48 hours' then 'Escalate vendor acknowledgement' when state.acknowledged_at is null and statement_timestamp()>=po.issued_at+interval '47 hours' then 'Prepare vendor acknowledgement escalation' else 'Confirm delivery and receiving handoff' end)) from procurement.purchase_orders po left join procurement.purchase_order_lifecycle_state state on state.purchase_order_id=po.id where po.status='issued'),'[]'::jsonb);
end;
$$;

create table if not exists procurement.purchase_order_closure_requests (
 id uuid primary key default gen_random_uuid(), purchase_order_id text not null references procurement.purchase_orders(id), expected_revision integer not null, closure_reason text not null, requested_by uuid not null references core.profiles(id), requested_at timestamptz not null default statement_timestamp(), status text not null default 'pending', decided_by uuid references core.profiles(id), decided_at timestamptz, unique(purchase_order_id,expected_revision,requested_by,closure_reason));
alter table procurement.purchase_order_closure_requests enable row level security;
alter table procurement.purchase_order_closure_requests force row level security;
revoke all on procurement.purchase_order_closure_requests from public, anon, authenticated, service_role;

create or replace function procurement.request_purchase_order_closure(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_state procurement.purchase_order_lifecycle_state; v_request procurement.purchase_order_closure_requests;
begin
 if auth.uid() is null or not (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','admin')) then raise exception 'Procurement closure authority is required'; end if;
 select * into v_state from procurement.purchase_order_lifecycle_state where purchase_order_id=payload->>'purchase_order_id' for update;
 if not found or v_state.revision<>(payload->>'expected_revision')::integer then raise exception 'The PO lifecycle changed; refresh before closure'; end if;
 if nullif(btrim(payload->>'closure_reason'),'') is null then raise exception 'A governed closure reason is required'; end if;
 select * into v_request from procurement.purchase_order_closure_requests where purchase_order_id=payload->>'purchase_order_id' and expected_revision=(payload->>'expected_revision')::integer and requested_by=auth.uid() and closure_reason=btrim(payload->>'closure_reason');
 if found then return to_jsonb(v_request)||jsonb_build_object('replayed',true); end if;
 insert into procurement.purchase_order_closure_requests(purchase_order_id,expected_revision,closure_reason,requested_by) values(payload->>'purchase_order_id',(payload->>'expected_revision')::integer,btrim(payload->>'closure_reason'),auth.uid()) returning * into v_request;
 return to_jsonb(v_request)||jsonb_build_object('replayed',false);
end;
$$;

create or replace function procurement.approve_purchase_order_closure(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_request procurement.purchase_order_closure_requests; v_po procurement.purchase_orders; v_blocked boolean;
begin
 if auth.uid() is null or not (core.has_live_cap('procurement','final_approve_po') or core.has_live_cap('procurement','admin')) then raise exception 'Independent PO closure approver authority is required'; end if;
 select * into v_request from procurement.purchase_order_closure_requests where id=(payload->>'closure_request_id')::uuid for update;
 if not found or v_request.status<>'pending' then raise exception 'A pending closure request is required'; end if;
 if v_request.requested_by=auth.uid() then raise exception 'Closure maker and checker must be different actors'; end if;
 select * into v_po from procurement.purchase_orders where id=v_request.purchase_order_id for update;
 v_blocked:=not exists(select 1 from procurement.acceptance_packs p where p.purchase_order_id=v_po.id and p.status='accepted' and jsonb_array_length(p.exceptions)=0) or exists(select 1 from procurement.v_purchase_order_receipt_status r where r.purchase_order_id::text=v_po.id and (r.outstanding_quantity>0 or r.rejected_or_quarantined_quantity>0)) or exists(select 1 from procurement.payment_readiness_packs p where p.purchase_order_id=v_po.id and p.status not in ('released','superseded'));
 if v_blocked then raise exception 'Closure is blocked by receipt, acceptance, quality, RMA, credit, payment hold, or unpaid Finance state'; end if;
 update procurement.purchase_order_closure_requests set status='approved',decided_by=auth.uid(),decided_at=statement_timestamp() where id=v_request.id;
 return jsonb_build_object('closureRequestId',v_request.id,'approved',true);
end;
$$;
create or replace function procurement.close_purchase_order(payload jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$ begin raise exception 'Direct closure is retired; request governed closure'; end; $$;
revoke all on function procurement.close_purchase_order(jsonb) from public, anon, authenticated, service_role;
revoke all on function procurement.request_purchase_order_closure(jsonb),procurement.approve_purchase_order_closure(jsonb) from public, anon;
grant execute on function procurement.request_purchase_order_closure(jsonb),procurement.approve_purchase_order_closure(jsonb) to authenticated;

create or replace function procurement.review_insufficient_bid_exception(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pack procurement.exception_packs; v_decision text := payload->>'decision';
begin
  if not private.policy_sourcing_can_review() then raise exception 'Not authorized to review a sourcing exception'; end if;
  if v_decision not in ('approved', 'rejected') then raise exception 'Decision must be approved or rejected'; end if;
  select * into v_pack from procurement.exception_packs where id = (payload->>'id')::uuid and exception_type = 'insufficient_bids' for update;
  if not found or v_pack.status <> 'under_review' then raise exception 'Exception is not awaiting review'; end if;
  if v_pack.evidence->>'createdBy' = auth.uid()::text then raise exception 'The exception author cannot approve their own request'; end if;
  if nullif(btrim(payload->>'note'), '') is null then raise exception 'A review note is required'; end if;
  update procurement.exception_packs set status = v_decision, procurement_head_reviewed_by = auth.uid(), procurement_head_reviewed_at = statement_timestamp(),
    evidence = evidence || jsonb_build_object('reviewNote', btrim(payload->>'note'), 'reviewedBy', auth.uid(), 'reviewedAt', statement_timestamp())
  where id = v_pack.id returning * into v_pack;
  return to_jsonb(v_pack);
end;
$$;

create or replace function procurement.sourcing_workspace(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_request procurement.requests; v_event procurement.sourcing_events; v_profile procurement.policy_profiles; v_responses jsonb; v_comms jsonb;
begin
  select * into v_request from procurement.requests where id::text = payload->>'request_id';
  if not found then raise exception 'Request not found'; end if;
  if v_request.requester_id <> auth.uid() and not core.has_live_cap('procurement', 'view_dashboard') and not private.policy_sourcing_can_manage() and not private.policy_sourcing_can_review() then raise exception 'Not authorized to view sourcing'; end if;
  v_profile := private.policy_sourcing_profile(v_request.id::text);
  select * into v_event from procurement.sourcing_events where request_id = v_request.id and status <> 'cancelled' order by created_at desc limit 1;
  if not found then return jsonb_build_object('requestId', v_request.id, 'event', null); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', response.id, 'vendorId', response.vendor_id, 'vendorName', vendor.legal_name, 'accredited', vendor.accreditation_status = 'approved' and (vendor.accreditation_expires_at is null or vendor.accreditation_expires_at > statement_timestamp()), 'invitedAt', response.invited_at, 'receivedAt', response.received_at, 'deadlineCompliant', response.deadline_compliant, 'proposalReference', response.proposal_storage_path, 'commercial', response.commercial, 'technical', response.technical) order by vendor.legal_name), '[]'::jsonb) into v_responses from procurement.sourcing_responses response join core.vendors vendor on vendor.id = response.vendor_id where response.sourcing_event_id = v_event.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', communication.id,
    'communicationType', communication.communication_type,
    'notificationGroupId', communication.detail->>'notificationGroupId',
    'packageVersion', communication.detail->>'packageVersion',
    'packageHash', communication.detail->>'packageHash',
    'sentAt', communication.detail->>'sentAt',
    'deliveredAt', communication.detail->>'deliveredAt',
    'acknowledgedAt', acknowledgement.detail->>'acknowledgedAt',
    'acknowledgementState', case
      when communication.communication_type not in ('invitation', 'requote') then null
      when response.current_invitation_communication_id is distinct from communication.id then 'superseded'
      when acknowledgement.id is not null then 'acknowledged'
      when communication.sent_at + make_interval(hours => v_profile.vendor_acknowledgement_hours) < statement_timestamp() then 'overdue'
      else 'pending'
    end,
    'clarificationState', case when communication.communication_type = 'clarification' and communication.sent_at + make_interval(hours => v_profile.clarification_hours) < statement_timestamp() then 'overdue' when communication.communication_type = 'clarification' then 'answered' else null end
  ) order by communication.sent_at desc), '[]'::jsonb) into v_comms
  from procurement.solicitation_communications communication
  left join procurement.sourcing_responses response
    on response.sourcing_event_id = v_event.id
    and response.vendor_id::text = communication.detail->>'recipientVendorId'
  left join lateral (
    select acknowledgement.*
    from procurement.solicitation_communications acknowledgement
    where acknowledgement.communication_type = 'invitation_acknowledgement'
      and acknowledgement.detail->>'acknowledgedCommunicationId' = communication.id::text
      and acknowledgement.detail->>'recipientVendorId' = communication.detail->>'recipientVendorId'
    order by acknowledgement.sent_at desc
    limit 1
  ) acknowledgement on true
  where communication.request_id = v_request.id
    and communication.communication_type <> 'invitation_acknowledgement';
  return jsonb_build_object('requestId', v_request.id, 'event', jsonb_build_object('id', v_event.id, 'status', v_event.status, 'submissionDeadline', v_event.submission_deadline, 'originalSubmissionDeadline', v_event.original_submission_deadline, 'intendedResponses', v_event.intended_responses, 'packageVersion', v_event.package_version, 'packageHash', v_event.package_hash, 'failedBidReason', v_event.failed_bid_reason, 'selectedVendorId', v_event.selected_vendor_id, 'closureNote', v_event.closure_note, 'responses', v_responses, 'communications', v_comms, 'policyControlSources', coalesce(v_profile.control_sources,'{}'::jsonb), 'policyControls', jsonb_build_object('formalBidAmount', v_profile.formal_bid_amount, 'inviteTargetMin', v_profile.invite_target_min, 'inviteTargetMax', v_profile.invite_target_max, 'sealedBidMinimumResponses', v_profile.sealed_bid_minimum_responses, 'bidWindowWorkingDays', v_profile.bid_window_working_days, 'maxExtensionCalendarDays', v_profile.max_extension_calendar_days, 'vendorAcknowledgementHours', v_profile.vendor_acknowledgement_hours, 'clarificationHours', v_profile.clarification_hours, 'tabulationHours', v_profile.tabulation_hours, 'technicalEvaluationWorkingDays', v_profile.technical_evaluation_working_days, 'poAcknowledgementHours', v_profile.po_acknowledgement_hours, 'repeatOrderMaxAmount', v_profile.repeat_order_max_amount, 'repeatOrderMaxAgeDays', v_profile.repeat_order_max_age_days, 'pettyCashMaxAmount', v_profile.petty_cash_max_amount, 'poInvoiceThreshold', v_profile.po_invoice_threshold, 'vendorProbationMonths', v_profile.vendor_probation_months)));
end;
$$;

revoke all on function private.policy_sourcing_can_manage(), private.policy_sourcing_can_review(), private.policy_add_working_days(timestamptz, integer), private.policy_sourcing_profile(text), private.policy_sourcing_approved_exception(text, text) from public, anon, authenticated;
revoke all on function procurement.invite_sourcing_vendors(jsonb), procurement.acknowledge_sourcing_invitation(jsonb), procurement.record_solicitation_communication(jsonb) from public, anon;

-- Governed sourcing data is writeable only by its security-definer commands.
-- In particular, a CI-only service credential cannot forge a response,
-- acknowledgement, communication, deadline, or audit event by table access.
revoke insert, update, delete on procurement.sourcing_events,
  procurement.sourcing_responses,
  procurement.solicitation_communications,
  procurement.policy_sla_events,
  procurement.policy_profile_events,
  procurement.policy_conflicts
from authenticated, service_role;

grant execute on function procurement.save_sourcing_event(jsonb), procurement.invite_sourcing_vendors(jsonb), procurement.acknowledge_sourcing_invitation(jsonb), procurement.record_sourcing_response(jsonb), procurement.record_solicitation_communication(jsonb), procurement.transition_sourcing_event(jsonb), procurement.sourcing_workspace(jsonb), procurement.submit_insufficient_bid_exception(jsonb), procurement.review_insufficient_bid_exception(jsonb), procurement.insufficient_bid_exception(jsonb) to authenticated, service_role;

-- Task 7: tabulation and best-value controls are versioned evidence, not an
-- automatic selection or final award. All dates are persisted in UTC while working
-- day decisions use Asia/Manila and the configured holiday calendar.
create table if not exists procurement.policy_holidays (
  holiday_date date primary key,
  label text not null,
  active boolean not null default true,
  created_by uuid references core.profiles(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now()
);

alter table procurement.sourcing_events
  add column if not exists response_closed_at timestamptz;

create table if not exists procurement.commercial_tabulations (
  id uuid primary key default gen_random_uuid(),
  sourcing_event_id uuid not null references procurement.sourcing_events(id) on delete restrict,
  version integer not null,
  response_closed_at timestamptz not null,
  due_at timestamptz not null,
  submitted_at timestamptz not null default pg_catalog.now(),
  submitted_by uuid not null references core.profiles(id) on delete restrict,
  entries jsonb not null,
  evidence_reference text not null,
  comments text,
  status text not null default 'submitted',
  escalation_status text not null default 'on_track',
  constraint commercial_tabulations_version_check check (version > 0),
  constraint commercial_tabulations_entries_check check (jsonb_typeof(entries) = 'array' and jsonb_array_length(entries) > 0),
  constraint commercial_tabulations_evidence_check check (nullif(pg_catalog.btrim(evidence_reference), '') is not null),
  constraint commercial_tabulations_status_check check (status in ('draft', 'submitted', 'superseded')),
  constraint commercial_tabulations_escalation_check check (escalation_status in ('on_track', 'overdue', 'escalated')),
  unique (sourcing_event_id, version)
);

create table if not exists procurement.technical_evaluations (
  id uuid primary key default gen_random_uuid(),
  sourcing_event_id uuid not null references procurement.sourcing_events(id) on delete restrict,
  vendor_id uuid not null references core.vendors(id) on delete restrict,
  version integer not null,
  due_at timestamptz not null,
  submitted_at timestamptz not null default pg_catalog.now(),
  reviewer_id uuid not null references core.profiles(id) on delete restrict,
  criteria jsonb not null,
  total_score numeric(8, 2) not null,
  evidence_reference text not null,
  comments text,
  status text not null default 'submitted',
  escalation_status text not null default 'on_track',
  constraint technical_evaluations_version_check check (version > 0),
  constraint technical_evaluations_criteria_check check (jsonb_typeof(criteria) = 'array' and jsonb_array_length(criteria) = 9),
  constraint technical_evaluations_score_check check (total_score >= 0 and total_score <= 100),
  constraint technical_evaluations_evidence_check check (nullif(pg_catalog.btrim(evidence_reference), '') is not null),
  constraint technical_evaluations_status_check check (status in ('draft', 'submitted', 'superseded')),
  constraint technical_evaluations_escalation_check check (escalation_status in ('on_track', 'overdue', 'escalated')),
  unique (sourcing_event_id, vendor_id, version)
);

create table if not exists procurement.award_recommendations (
  id uuid primary key default gen_random_uuid(),
  sourcing_event_id uuid not null references procurement.sourcing_events(id) on delete restrict,
  evaluated_vendor_id uuid not null references core.vendors(id) on delete restrict,
  recommended_vendor_id uuid not null references core.vendors(id) on delete restrict,
  commercial_tabulation_id uuid not null references procurement.commercial_tabulations(id) on delete restrict,
  technical_evaluation_id uuid not null references procurement.technical_evaluations(id) on delete restrict,
  rationale text not null,
  risk_evidence_reference text,
  variance_justification text,
  status text not null,
  revision integer not null default 1,
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint award_recommendations_rationale_check check (nullif(pg_catalog.btrim(rationale), '') is not null),
  constraint award_recommendations_variance_check check (
    evaluated_vendor_id = recommended_vendor_id
    or nullif(pg_catalog.btrim(variance_justification), '') is not null
  ),
  constraint award_recommendations_status_check check (status in ('draft', 'pending_variance', 'approved', 'rejected', 'superseded')),
  constraint award_recommendations_revision_check check (revision > 0)
);

create table if not exists procurement.award_recommendation_variance_decisions (
  id uuid primary key default gen_random_uuid(),
  award_recommendation_id uuid not null references procurement.award_recommendations(id) on delete restrict,
  decision_type text not null,
  decision text not null,
  rationale text not null,
  doa_matrix_id uuid references procurement.doa_matrices(id) on delete restrict,
  doa_assignment_id uuid references procurement.doa_assignments(id) on delete restrict,
  decided_by uuid not null references core.profiles(id) on delete restrict,
  decided_at timestamptz not null default pg_catalog.now(),
  constraint award_recommendation_variance_type_check check (decision_type in ('department_head', 'finance')),
  constraint award_recommendation_variance_decision_check check (decision in ('approved', 'rejected')),
  constraint award_recommendation_variance_rationale_check check (nullif(pg_catalog.btrim(rationale), '') is not null),
  unique (award_recommendation_id, decision_type)
);

create index if not exists commercial_tabulations_event_status_idx
  on procurement.commercial_tabulations(sourcing_event_id, status, version desc);
create index if not exists technical_evaluations_event_vendor_idx
  on procurement.technical_evaluations(sourcing_event_id, vendor_id, status, version desc);
create index if not exists award_recommendations_event_status_idx
  on procurement.award_recommendations(sourcing_event_id, status, revision desc);

create or replace function private.policy_add_manila_working_days(p_from timestamptz, p_days integer)
returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare v_date date := (p_from at time zone 'Asia/Manila')::date;
  v_time time := (p_from at time zone 'Asia/Manila')::time;
  v_remaining integer := p_days;
begin
  if p_days < 0 then raise exception 'Working days cannot be negative'; end if;
  while v_remaining > 0 loop
    v_date := v_date + 1;
    if extract(isodow from v_date) < 6 and not exists (
      select 1 from procurement.policy_holidays holiday
      where holiday.holiday_date = v_date and holiday.active
    ) then v_remaining := v_remaining - 1; end if;
  end loop;
  return ((v_date::timestamp + v_time) at time zone 'Asia/Manila');
end;
$$;

create or replace function private.policy_sourcing_response_closed_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'response_closed' and old.status is distinct from 'response_closed' then
    new.response_closed_at := coalesce(new.response_closed_at, statement_timestamp());
  end if;
  return new;
end;
$$;

drop trigger if exists policy_sourcing_response_closed_stamp on procurement.sourcing_events;
create trigger policy_sourcing_response_closed_stamp
before update on procurement.sourcing_events
for each row execute function private.policy_sourcing_response_closed_stamp();

create or replace function private.policy_evaluation_event(p_sourcing_event_id uuid)
returns procurement.sourcing_events language plpgsql security definer set search_path = '' as $$
declare v_event procurement.sourcing_events;
begin
  select * into v_event from procurement.sourcing_events where id = p_sourcing_event_id for update;
  if not found or v_event.status <> 'evaluation' then raise exception 'Controlled evaluation must be open'; end if;
  if v_event.response_closed_at is null then raise exception 'Response closure evidence is required before evaluation'; end if;
  return v_event;
end;
$$;

create or replace function private.policy_variance_doa_assignment(
  p_request procurement.requests,
  p_tier text
)
returns procurement.doa_assignments language plpgsql stable security definer set search_path = '' as $$
declare v_assignment procurement.doa_assignments;
begin
  select assignment.* into v_assignment
  from procurement.doa_assignments assignment
  join procurement.doa_matrices matrix on matrix.id = assignment.matrix_id
  join core.profiles approver on approver.id = assignment.approver_user_id
  where matrix.active and matrix.status = 'active'
    and matrix.effective_at <= statement_timestamp()
    and (matrix.expires_at is null or matrix.expires_at > statement_timestamp())
    and assignment.active and assignment.approver_user_id = auth.uid()
    and assignment.tier = p_tier
    and lower(assignment.department) = lower(p_request.department)
    and (assignment.category is null or assignment.category = p_request.category)
    and coalesce(p_request.estimated_amount, 0) >= assignment.min_amount
    and (assignment.max_amount is null or coalesce(p_request.estimated_amount, 0) <= assignment.max_amount)
    and approver.status = 'active'
  order by matrix.effective_at desc, assignment.min_amount desc limit 1;
  if not found then raise exception 'An active Department DOA assignment is required for this variance decision'; end if;
  return v_assignment;
end;
$$;

create or replace function private.policy_evaluation_criteria_are_valid(p_criteria jsonb)
returns boolean language sql immutable security definer set search_path = '' as $$
  select jsonb_typeof(p_criteria) = 'array'
    and jsonb_array_length(p_criteria) = 9
    and (select count(distinct item->>'criterion') from jsonb_array_elements(p_criteria) item) = 9
    and (select bool_and(
      item->>'criterion' in ('technicalCompliance', 'quality', 'leadTime', 'totalLifecycleCost', 'warranty', 'support', 'price', 'paymentTerms', 'training')
      and coalesce((item->>'score')::numeric, -1) between 0 and 100
      and nullif(btrim(item->>'evidence_reference'), '') is not null
    ) from jsonb_array_elements(p_criteria) item)
$$;

create or replace function procurement.save_commercial_tabulation(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_event procurement.sourcing_events; v_profile procurement.policy_profiles; v_version integer; v_due timestamptz;
  v_entries jsonb := coalesce(payload->'entries', '[]'::jsonb); v_tabulation procurement.commercial_tabulations;
begin
  if not private.policy_sourcing_can_manage() then raise exception 'Not authorized to save commercial tabulation'; end if;
  v_event := private.policy_evaluation_event((payload->>'sourcing_event_id')::uuid);
  v_profile := private.policy_sourcing_profile(v_event.request_id::text);
  if jsonb_typeof(v_entries) <> 'array' or jsonb_array_length(v_entries) = 0 then raise exception 'Commercial tabulation entries are required'; end if;
  if nullif(btrim(payload->>'evidence_reference'), '') is null then raise exception 'Commercial tabulation evidence is required'; end if;
  if exists (
    select 1 from procurement.sourcing_responses response
    where response.sourcing_event_id = v_event.id and response.received_at is not null and response.deadline_compliant is distinct from false
      and not exists (select 1 from jsonb_array_elements(v_entries) item where item->>'vendor_id' = response.vendor_id::text)
  ) then raise exception 'The tabulation must include every usable response'; end if;
  -- The event row is already locked by policy_evaluation_event, serializing
  -- versions without attempting an illegal aggregate FOR UPDATE.
  select coalesce(max(version), 0) + 1 into v_version from procurement.commercial_tabulations where sourcing_event_id = v_event.id;
  v_due := v_event.response_closed_at + make_interval(hours => v_profile.tabulation_hours);
  update procurement.commercial_tabulations set status = 'superseded' where sourcing_event_id = v_event.id and status = 'submitted';
  insert into procurement.commercial_tabulations(sourcing_event_id, version, response_closed_at, due_at, submitted_by, entries, evidence_reference, comments, escalation_status)
  values(v_event.id, v_version, v_event.response_closed_at, v_due, auth.uid(), v_entries, btrim(payload->>'evidence_reference'), nullif(btrim(payload->>'comments'), ''), case when statement_timestamp() > v_due then 'overdue' else 'on_track' end)
  returning * into v_tabulation;
  insert into procurement.policy_sla_events(request_id, policy_profile_id, sla_type, owner_id, due_at, completed_at, status, detail)
  values(v_event.request_id, v_profile.id, 'commercial_tabulation', auth.uid(), v_due, v_tabulation.submitted_at, case when v_tabulation.escalation_status = 'on_track' then 'completed' else 'overdue' end, jsonb_build_object('commercialTabulationId', v_tabulation.id, 'version', v_version));
  return to_jsonb(v_tabulation);
end;
$$;

create or replace function procurement.submit_technical_evaluation(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_event procurement.sourcing_events; v_profile procurement.policy_profiles; v_due timestamptz; v_version integer;
  v_criteria jsonb := coalesce(payload->'criteria', '[]'::jsonb); v_evaluation procurement.technical_evaluations;
begin
  if not private.policy_sourcing_can_manage() then raise exception 'Not authorized to submit technical evaluation'; end if;
  v_event := private.policy_evaluation_event((payload->>'sourcing_event_id')::uuid);
  v_profile := private.policy_sourcing_profile(v_event.request_id::text);
  if not exists(select 1 from procurement.commercial_tabulations tabulation where tabulation.sourcing_event_id = v_event.id and tabulation.status = 'submitted') then raise exception 'A submitted commercial tabulation is required'; end if;
  if not exists(select 1 from procurement.sourcing_responses response where response.sourcing_event_id = v_event.id and response.vendor_id = (payload->>'vendor_id')::uuid and response.received_at is not null and response.deadline_compliant is distinct from false) then raise exception 'Technical evaluation requires a compliant received response'; end if;
  if not private.policy_evaluation_criteria_are_valid(v_criteria) then raise exception 'Every best-value criterion needs a score and evidence reference'; end if;
  if nullif(btrim(payload->>'evidence_reference'), '') is null then raise exception 'Technical evaluation evidence is required'; end if;
  select coalesce(max(version), 0) + 1 into v_version from procurement.technical_evaluations where sourcing_event_id = v_event.id and vendor_id = (payload->>'vendor_id')::uuid;
  v_due := private.policy_add_manila_working_days(v_event.response_closed_at, v_profile.technical_evaluation_working_days);
  update procurement.technical_evaluations set status = 'superseded' where sourcing_event_id = v_event.id and vendor_id = (payload->>'vendor_id')::uuid and status = 'submitted';
  insert into procurement.technical_evaluations(sourcing_event_id, vendor_id, version, due_at, reviewer_id, criteria, total_score, evidence_reference, comments, escalation_status)
  values(v_event.id, (payload->>'vendor_id')::uuid, v_version, v_due, auth.uid(), v_criteria, (select avg((item->>'score')::numeric) from jsonb_array_elements(v_criteria) item), btrim(payload->>'evidence_reference'), nullif(btrim(payload->>'comments'), ''), case when statement_timestamp() > v_due then 'overdue' else 'on_track' end)
  returning * into v_evaluation;
  insert into procurement.policy_sla_events(request_id, policy_profile_id, sla_type, owner_id, due_at, completed_at, status, detail)
  values(v_event.request_id, v_profile.id, 'technical_evaluation', auth.uid(), v_due, v_evaluation.submitted_at, case when v_evaluation.escalation_status = 'on_track' then 'completed' else 'overdue' end, jsonb_build_object('technicalEvaluationId', v_evaluation.id, 'vendorId', v_evaluation.vendor_id, 'version', v_version));
  return to_jsonb(v_evaluation);
end;
$$;

create or replace function procurement.submit_award_recommendation(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_event procurement.sourcing_events; v_request procurement.requests; v_tabulation procurement.commercial_tabulations;
  v_technical procurement.technical_evaluations; v_evaluated uuid; v_recommendation procurement.award_recommendations;
  v_risk_required boolean; v_status text;
begin
  if not private.policy_sourcing_can_manage() then raise exception 'Not authorized to submit award recommendation'; end if;
  v_event := private.policy_evaluation_event((payload->>'sourcing_event_id')::uuid);
  select * into v_request from procurement.requests where id = v_event.request_id for update;
  select * into v_tabulation from procurement.commercial_tabulations where id = (payload->>'commercial_tabulation_id')::uuid and sourcing_event_id = v_event.id and status = 'submitted';
  if not found then raise exception 'A current commercial tabulation is required'; end if;
  select * into v_technical from procurement.technical_evaluations where id = (payload->>'technical_evaluation_id')::uuid and sourcing_event_id = v_event.id and vendor_id = (payload->>'recommended_vendor_id')::uuid and status = 'submitted';
  if not found then raise exception 'A submitted technical evaluation for the recommended vendor is required'; end if;
  select vendor_id into v_evaluated from procurement.technical_evaluations
  where sourcing_event_id = v_event.id and status = 'submitted' order by total_score desc, submitted_at asc limit 1;
  if v_evaluated is null or v_evaluated <> (payload->>'evaluated_vendor_id')::uuid then raise exception 'The evaluated vendor must be the top submitted technical evaluation'; end if;
  if nullif(btrim(payload->>'rationale'), '') is null then raise exception 'Recommendation rationale is required'; end if;
  v_risk_required := coalesce((v_request.compliance->'riskFacts'->>'complex')::boolean, false)
    or coalesce((v_request.compliance->'riskFacts'->>'technical')::boolean, false)
    or coalesce((v_request.compliance->'riskFacts'->>'strategic')::boolean, false)
    or coalesce((v_request.compliance->'riskFacts'->>'highRisk')::boolean, false)
    or coalesce((v_request.compliance->'riskFacts'->>'dataSensitive')::boolean, false)
    or coalesce((v_request.compliance->'riskFacts'->>'importation')::boolean, false);
  if v_risk_required and nullif(btrim(payload->>'risk_evidence_reference'), '') is null then raise exception 'Applicable risk evidence is required'; end if;
  if v_evaluated <> (payload->>'recommended_vendor_id')::uuid and nullif(btrim(payload->>'variance_justification'), '') is null then raise exception 'Written variance justification is required'; end if;
  v_status := case when v_evaluated = (payload->>'recommended_vendor_id')::uuid then 'approved' else 'pending_variance' end;
  update procurement.award_recommendations set status = 'superseded', updated_at = statement_timestamp() where sourcing_event_id = v_event.id and status in ('draft', 'pending_variance', 'approved');
  insert into procurement.award_recommendations(sourcing_event_id, evaluated_vendor_id, recommended_vendor_id, commercial_tabulation_id, technical_evaluation_id, rationale, risk_evidence_reference, variance_justification, status, created_by)
  values(v_event.id, v_evaluated, (payload->>'recommended_vendor_id')::uuid, v_tabulation.id, v_technical.id, btrim(payload->>'rationale'), nullif(btrim(payload->>'risk_evidence_reference'), ''), nullif(btrim(payload->>'variance_justification'), ''), v_status, auth.uid()) returning * into v_recommendation;
  return to_jsonb(v_recommendation);
end;
$$;

create or replace function procurement.review_recommendation_variance(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_recommendation procurement.award_recommendations; v_event procurement.sourcing_events; v_request procurement.requests;
  v_assignment procurement.doa_assignments; v_decision_type text; v_decision text := payload->>'decision'; v_has_department boolean;
begin
  select * into v_recommendation from procurement.award_recommendations where id = (payload->>'award_recommendation_id')::uuid for update;
  if not found or v_recommendation.status <> 'pending_variance' then raise exception 'A pending variance recommendation is required'; end if;
  if coalesce((payload->>'expected_version')::integer, -1) <> v_recommendation.revision then raise exception 'The variance recommendation has changed; refresh before deciding'; end if;
  if v_recommendation.created_by = auth.uid() then raise exception 'The recommendation author cannot approve their own variance'; end if;
  if v_decision not in ('approved', 'rejected') or nullif(btrim(payload->>'note'), '') is null then raise exception 'A decision and written decision note are required'; end if;
  select * into v_event from procurement.sourcing_events where id = v_recommendation.sourcing_event_id;
  select * into v_request from procurement.requests where id = v_event.request_id;
  select exists(select 1 from procurement.award_recommendation_variance_decisions where award_recommendation_id = v_recommendation.id and decision_type = 'department_head' and decision = 'approved') into v_has_department;
  if not v_has_department then
    v_decision_type := 'department_head';
    v_assignment := private.policy_variance_doa_assignment(v_request, 'dept_head');
  else
    v_decision_type := 'finance';
    if not (core.has_live_cap('procurement', 'view_finance') or core.has_live_cap('procurement', 'admin')) then raise exception 'Controller or Finance authority is required for variance approval'; end if;
    v_assignment := private.policy_variance_doa_assignment(v_request, 'finance');
  end if;
  if exists(select 1 from procurement.award_recommendation_variance_decisions where award_recommendation_id = v_recommendation.id and decision_type = v_decision_type) then raise exception 'This variance decision was already recorded'; end if;
  insert into procurement.award_recommendation_variance_decisions(award_recommendation_id, decision_type, decision, rationale, doa_matrix_id, doa_assignment_id, decided_by)
  values(v_recommendation.id, v_decision_type, v_decision, btrim(payload->>'note'), v_assignment.matrix_id, v_assignment.id, auth.uid());
  update procurement.award_recommendations set status = case when v_decision = 'rejected' then 'rejected' when v_decision_type = 'finance' then 'approved' else 'pending_variance' end,
    revision = revision + 1, updated_at = statement_timestamp() where id = v_recommendation.id returning * into v_recommendation;
  return to_jsonb(v_recommendation);
end;
$$;

create or replace function private.policy_award_requires_recommendation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'awarded' and old.status is distinct from 'awarded' and not exists (
    select 1 from procurement.award_recommendations recommendation
    where recommendation.sourcing_event_id = new.id
      and recommendation.status = 'approved'
      and recommendation.recommended_vendor_id = new.selected_vendor_id
  ) then raise exception 'An approved best-value recommendation is required before award'; end if;
  return new;
end;
$$;

drop trigger if exists policy_award_requires_recommendation on procurement.sourcing_events;
create trigger policy_award_requires_recommendation
before update on procurement.sourcing_events
for each row execute function private.policy_award_requires_recommendation();

alter table procurement.policy_holidays enable row level security;
alter table procurement.policy_holidays force row level security;
alter table procurement.commercial_tabulations enable row level security;
alter table procurement.commercial_tabulations force row level security;
alter table procurement.technical_evaluations enable row level security;
alter table procurement.technical_evaluations force row level security;
alter table procurement.award_recommendations enable row level security;
alter table procurement.award_recommendations force row level security;
alter table procurement.award_recommendation_variance_decisions enable row level security;
alter table procurement.award_recommendation_variance_decisions force row level security;

create policy policy_holidays_read on procurement.policy_holidays for select to authenticated using (
  core.has_live_cap('core', 'manage_rbac')
  or core.has_live_cap('legal', 'manage_doa')
  or core.has_live_cap('procurement', 'view_dashboard')
);
create policy commercial_tabulations_read on procurement.commercial_tabulations for select to authenticated using (private.policy_sourcing_can_manage() or private.policy_sourcing_can_review() or core.has_live_cap('procurement', 'view_dashboard'));
create policy technical_evaluations_read on procurement.technical_evaluations for select to authenticated using (private.policy_sourcing_can_manage() or private.policy_sourcing_can_review() or core.has_live_cap('procurement', 'view_dashboard'));
create policy award_recommendations_read on procurement.award_recommendations for select to authenticated using (private.policy_sourcing_can_manage() or private.policy_sourcing_can_review() or core.has_live_cap('procurement', 'view_dashboard'));
create policy award_recommendation_variance_decisions_read on procurement.award_recommendation_variance_decisions for select to authenticated using (private.policy_sourcing_can_manage() or private.policy_sourcing_can_review() or core.has_live_cap('procurement', 'view_finance'));

revoke all on procurement.policy_holidays, procurement.commercial_tabulations, procurement.technical_evaluations, procurement.award_recommendations, procurement.award_recommendation_variance_decisions from public, anon, authenticated, service_role;
grant select on procurement.policy_holidays, procurement.commercial_tabulations, procurement.technical_evaluations, procurement.award_recommendations, procurement.award_recommendation_variance_decisions to authenticated, service_role;
revoke all on function private.policy_add_manila_working_days(timestamptz, integer), private.policy_sourcing_response_closed_stamp(), private.policy_evaluation_event(uuid), private.policy_variance_doa_assignment(procurement.requests, text), private.policy_evaluation_criteria_are_valid(jsonb), private.policy_award_requires_recommendation() from public, anon, authenticated;
revoke all on function procurement.save_commercial_tabulation(jsonb), procurement.submit_technical_evaluation(jsonb), procurement.submit_award_recommendation(jsonb), procurement.review_recommendation_variance(jsonb) from public, anon;
grant execute on function procurement.save_commercial_tabulation(jsonb), procurement.submit_technical_evaluation(jsonb), procurement.submit_award_recommendation(jsonb), procurement.review_recommendation_variance(jsonb) to authenticated, service_role;

create or replace function procurement.evaluation_workspace(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_event procurement.sourcing_events; v_tabulations jsonb; v_evaluations jsonb; v_recommendation jsonb; v_variances jsonb;
begin
  perform procurement.sourcing_workspace(payload);
  select * into v_event from procurement.sourcing_events event where event.request_id::text = payload->>'request_id' and event.status <> 'cancelled' order by event.created_at desc limit 1;
  if not found then return jsonb_build_object('commercialTabulations', '[]'::jsonb, 'technicalEvaluations', '[]'::jsonb, 'awardRecommendation', null, 'varianceDecisions', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', tabulation.id, 'sourcingEventId', tabulation.sourcing_event_id, 'version', tabulation.version, 'responseClosedAt', tabulation.response_closed_at, 'dueAt', tabulation.due_at, 'submittedAt', tabulation.submitted_at, 'entries', tabulation.entries, 'evidenceReference', tabulation.evidence_reference, 'comments', tabulation.comments, 'status', tabulation.status, 'escalationStatus', tabulation.escalation_status) order by tabulation.version desc), '[]'::jsonb) into v_tabulations
  from procurement.commercial_tabulations tabulation where tabulation.sourcing_event_id = v_event.id;
  select coalesce(jsonb_agg(jsonb_build_object('id', evaluation.id, 'sourcingEventId', evaluation.sourcing_event_id, 'vendorId', evaluation.vendor_id, 'version', evaluation.version, 'dueAt', evaluation.due_at, 'submittedAt', evaluation.submitted_at, 'criteria', evaluation.criteria, 'totalScore', evaluation.total_score, 'evidenceReference', evaluation.evidence_reference, 'comments', evaluation.comments, 'status', evaluation.status, 'escalationStatus', evaluation.escalation_status) order by evaluation.vendor_id, evaluation.version desc), '[]'::jsonb) into v_evaluations
  from procurement.technical_evaluations evaluation where evaluation.sourcing_event_id = v_event.id;
  select jsonb_build_object('id', recommendation.id, 'sourcingEventId', recommendation.sourcing_event_id, 'evaluatedVendorId', recommendation.evaluated_vendor_id, 'recommendedVendorId', recommendation.recommended_vendor_id, 'rationale', recommendation.rationale, 'commercialTabulationId', recommendation.commercial_tabulation_id, 'technicalEvaluationId', recommendation.technical_evaluation_id, 'riskEvidenceReference', recommendation.risk_evidence_reference, 'varianceJustification', recommendation.variance_justification, 'status', recommendation.status, 'version', recommendation.revision, 'createdAt', recommendation.created_at) into v_recommendation
  from procurement.award_recommendations recommendation where recommendation.sourcing_event_id = v_event.id and recommendation.status <> 'superseded' order by recommendation.created_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('id', decision.id, 'awardRecommendationId', decision.award_recommendation_id, 'decisionType', decision.decision_type, 'decision', decision.decision, 'rationale', decision.rationale, 'decidedAt', decision.decided_at) order by decision.decided_at), '[]'::jsonb) into v_variances
  from procurement.award_recommendation_variance_decisions decision
  where v_recommendation is not null and decision.award_recommendation_id = (v_recommendation->>'id')::uuid;
  return jsonb_build_object('commercialTabulations', v_tabulations, 'technicalEvaluations', v_evaluations, 'awardRecommendation', v_recommendation, 'varianceDecisions', v_variances);
end;
$$;

-- Task 8: exception decisions are deliberately stored separately from the
-- requester evidence. Recomputing this record at every live transition keeps
-- a client checkbox from becoming an approval authority.
create table if not exists procurement.exception_doa_decisions (
  exception_pack_id uuid primary key references procurement.exception_packs(id) on delete restrict,
  decision text not null check (decision in ('approved', 'rejected')),
  rationale text not null,
  doa_matrix_id uuid not null references procurement.doa_matrices(id) on delete restrict,
  doa_assignment_id uuid not null references procurement.doa_assignments(id) on delete restrict,
  decided_by uuid not null references core.profiles(id) on delete restrict,
  decided_at timestamptz not null default statement_timestamp()
);
alter table procurement.exception_doa_decisions enable row level security;
alter table procurement.exception_doa_decisions force row level security;
revoke all on procurement.exception_doa_decisions from public, anon, authenticated;
grant select on procurement.exception_doa_decisions to authenticated;
grant all on procurement.exception_doa_decisions to service_role;

create or replace function private.policy_exception_pack_blockers(
  p_request_id text,
  p_mode text,
  p_profile procurement.policy_profiles,
  p_amount numeric
)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare v_pack procurement.exception_packs; v_evidence jsonb; v_blockers text[] := '{}';
begin
  if p_mode = 'competitive_bidding' then return v_blockers; end if;
  select * into v_pack from procurement.exception_packs
  where request_id::text = p_request_id and status = 'approved'
  order by procurement_head_reviewed_at desc nulls last, id desc limit 1;
  if not found then return array['approved_exception_pack_required']; end if;
  v_evidence := coalesce(v_pack.evidence, '{}'::jsonb);
  if v_pack.procurement_head_reviewed_by is null or v_pack.procurement_head_reviewed_at is null then
    v_blockers := array_append(v_blockers, 'procurement_review_required');
  end if;
  if not exists (select 1 from procurement.exception_doa_decisions decision where decision.exception_pack_id = v_pack.id and decision.decision = 'approved') then
    v_blockers := array_append(v_blockers, 'active_doa_approval_required');
  end if;
  if p_mode = 'sole_source' then
    if v_pack.exception_type not in ('direct_award', 'sole_supplier') then v_blockers := array_append(v_blockers, 'sole_source_pack_type_required'); end if;
    if coalesce(v_evidence->>'soleSourceBasis', '') not in ('only_acceptable_source','compatibility','specialization','unique_capability','manufacturer','authorized_distributor') then v_blockers := array_append(v_blockers, 'sole_source_basis_required'); end if;
    if jsonb_typeof(v_evidence->'evidenceReferences') <> 'array' or jsonb_array_length(v_evidence->'evidenceReferences') = 0 then v_blockers := array_append(v_blockers, 'sole_source_evidence_required'); end if;
    if nullif(btrim(v_pack.price_reasonableness), '') is null then v_blockers := array_append(v_blockers, 'price_reasonableness_required'); end if;
  elsif p_mode = 'repeat_order' then
    if v_pack.exception_type <> 'repeat_continuity' then v_blockers := array_append(v_blockers, 'repeat_order_pack_type_required'); end if;
    if coalesce((v_evidence->>'samePrice')::boolean, false) is not true then v_blockers := array_append(v_blockers, 'repeat_same_price_required'); end if;
    if coalesce((v_evidence->>'sameTerms')::boolean, false) is not true then v_blockers := array_append(v_blockers, 'repeat_same_terms_required'); end if;
    if coalesce((v_evidence->>'sameVendor')::boolean, false) is not true then v_blockers := array_append(v_blockers, 'repeat_same_vendor_required'); end if;
    if coalesce((v_evidence->>'sameConsiderations')::boolean, false) is not true then v_blockers := array_append(v_blockers, 'repeat_same_considerations_required'); end if;
    if coalesce((v_evidence->>'priorCompetitiveAward')::boolean, false) is not true then v_blockers := array_append(v_blockers, 'prior_competitive_award_required'); end if;
    if nullif(v_evidence->>'priorRequestId', '') is null or nullif(v_evidence->>'priorSourcingEventId', '') is null or nullif(v_evidence->>'priorAwardId', '') is null or nullif(v_evidence->>'priorPurchaseOrderId', '') is null then v_blockers := array_append(v_blockers, 'prior_competitive_links_required'); end if;
    if coalesce((v_evidence->>'priorAwardAgeDays')::numeric, p_profile.repeat_order_max_age_days + 1) > p_profile.repeat_order_max_age_days then v_blockers := array_append(v_blockers, 'repeat_source_age_exceeds_policy'); end if;
    if p_amount > p_profile.repeat_order_max_amount then v_blockers := array_append(v_blockers, 'repeat_amount_exceeds_policy'); end if;
    if coalesce((v_evidence->>'materialScopeChange')::boolean, false) then v_blockers := array_append(v_blockers, 'repeat_material_scope_change'); end if;
  elsif p_mode = 'emergency_purchase' then
    if v_pack.exception_type <> 'emergency' then v_blockers := array_append(v_blockers, 'emergency_pack_type_required'); end if;
    if coalesce(v_evidence->>'emergencyBasis', '') not in ('life_safety','environmental','serious_disruption') then v_blockers := array_append(v_blockers, 'qualifying_emergency_basis_required'); end if;
    if nullif(v_evidence->>'authorityReference', '') is null then v_blockers := array_append(v_blockers, 'emergency_authority_required'); end if;
    if nullif(v_evidence->>'commitmentTimestamp', '') is null then v_blockers := array_append(v_blockers, 'emergency_commitment_timestamp_required'); end if;
    if coalesce((v_evidence->>'minimizedVerbalCommitment')::boolean, false) is not true then v_blockers := array_append(v_blockers, 'minimized_verbal_commitment_required'); end if;
    if nullif(v_evidence->>'retrospectivePoDueAt', '') is null then v_blockers := array_append(v_blockers, 'retrospective_po_due_required'); end if;
  elsif p_mode = 'petty_cash' then
    if v_pack.exception_type <> 'petty_cash_non_accredited' then v_blockers := array_append(v_blockers, 'petty_cash_pack_type_required'); end if;
    if p_amount > p_profile.petty_cash_max_amount then v_blockers := array_append(v_blockers, 'petty_cash_amount_exceeds_policy'); end if;
    if coalesce((v_evidence->>'splitPurchase')::boolean, false) then v_blockers := array_append(v_blockers, 'petty_cash_split_purchase'); end if;
    if coalesce((v_evidence->>'recurring')::boolean, false) then v_blockers := array_append(v_blockers, 'petty_cash_recurring_purchase'); end if;
    if nullif(v_evidence->>'financeReviewedBy', '') is null then v_blockers := array_append(v_blockers, 'governed_finance_eligibility_required'); end if;
    if coalesce((v_evidence->>'receiptPresent')::boolean, false) is not true then v_blockers := array_append(v_blockers, 'petty_cash_receipt_required'); end if;
    if coalesce((v_evidence->>'liquidationRecorded')::boolean, false) is not true then v_blockers := array_append(v_blockers, 'petty_cash_liquidation_required'); end if;
  elsif p_mode = 'approved_exception' then
    if nullif(v_evidence->>'approvedExceptionPackId', '') is null then v_blockers := array_append(v_blockers, 'approved_exception_reference_required'); end if;
    if jsonb_typeof(v_evidence->'evidenceReferences') <> 'array' or jsonb_array_length(v_evidence->'evidenceReferences') = 0 then v_blockers := array_append(v_blockers, 'approved_exception_evidence_required'); end if;
  else v_blockers := array_append(v_blockers, 'unsupported_procurement_mode');
  end if;
  return v_blockers;
end;
$$;

create or replace function private.policy_route_exception_is_eligible(
  p_request_id text, p_procurement_mode text, p_profile procurement.policy_profiles, p_amount numeric
)
returns text[] language sql stable security definer set search_path = '' as $$
  select private.policy_exception_pack_blockers(p_request_id, p_procurement_mode, p_profile, p_amount)
$$;

create or replace function procurement.submit_policy_exception_pack(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_request procurement.requests; v_pack procurement.exception_packs; v_mode text := payload->>'mode'; v_type text;
begin
  if auth.uid() is null or not private.policy_sourcing_can_manage() then raise exception 'Procurement authority is required to submit an exception pack'; end if;
  select * into v_request from procurement.requests where id::text = payload->>'request_id' for update;
  if not found or v_request.status <> 'draft' then raise exception 'A draft request is required'; end if;
  if v_mode not in ('sole_source','repeat_order','emergency_purchase','petty_cash','approved_exception') then raise exception 'Unsupported exception mode'; end if;
  v_type := case v_mode when 'sole_source' then 'direct_award' when 'repeat_order' then 'repeat_continuity' when 'emergency_purchase' then 'emergency' when 'petty_cash' then 'petty_cash_non_accredited' else 'direct_award' end;
  update procurement.exception_packs set status = 'superseded' where request_id::text = v_request.id::text and status in ('draft','under_review','rejected');
  insert into procurement.exception_packs(request_id, exception_type, justification, evidence, price_reasonableness, status)
  values(v_request.id, v_type, coalesce(nullif(btrim(payload->>'justification'),''), 'Pending policy exception evidence'), coalesce(payload->'evidence','{}'::jsonb) || jsonb_build_object('submittedBy',auth.uid(),'submittedAt',statement_timestamp(),'mode',v_mode), nullif(btrim(payload->>'price_reasonableness'),''), 'under_review') returning * into v_pack;
  return to_jsonb(v_pack);
end;
$$;

create or replace function procurement.review_policy_exception_pack(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pack procurement.exception_packs; v_request procurement.requests; v_assignment procurement.doa_assignments; v_stage text := payload->>'stage'; v_decision text := payload->>'decision';
begin
  select * into v_pack from procurement.exception_packs where id = (payload->>'id')::uuid for update;
  if not found or v_pack.status <> 'under_review' then raise exception 'An exception awaiting review is required'; end if;
  if v_decision not in ('approved','rejected') or nullif(btrim(payload->>'note'),'') is null then raise exception 'A decision and review note are required'; end if;
  select * into v_request from procurement.requests where id::text = v_pack.request_id::text for share;
  if v_stage = 'procurement' then
    if not private.policy_sourcing_can_review() or v_pack.evidence->>'submittedBy' = auth.uid()::text then raise exception 'An independent Procurement reviewer is required'; end if;
    update procurement.exception_packs set procurement_head_reviewed_by = auth.uid(), procurement_head_reviewed_at = statement_timestamp(), status = case when v_decision = 'rejected' then 'rejected' else 'under_review' end, evidence = evidence || jsonb_build_object('procurementReviewNote',btrim(payload->>'note'),'procurementReviewedBy',auth.uid()) where id=v_pack.id returning * into v_pack;
  elsif v_stage = 'finance' then
    if v_pack.exception_type <> 'petty_cash' and v_pack.exception_type <> 'petty_cash_non_accredited' then raise exception 'Finance eligibility applies only to petty cash'; end if;
    if not (core.has_live_cap('procurement','view_finance') or core.has_live_cap('procurement','admin')) then raise exception 'Finance authority is required'; end if;
    update procurement.exception_packs set status = case when v_decision = 'rejected' then 'rejected' else 'under_review' end, evidence = evidence || jsonb_build_object('financeReviewedBy',auth.uid(),'financeReviewNote',btrim(payload->>'note')) where id=v_pack.id returning * into v_pack;
  elsif v_stage = 'doa' then
    if v_pack.procurement_head_reviewed_by is null then raise exception 'Independent Procurement review is required before DOA'; end if;
    v_assignment := private.policy_variance_doa_assignment(v_request, 'final_approver');
    insert into procurement.exception_doa_decisions(exception_pack_id,decision,rationale,doa_matrix_id,doa_assignment_id,decided_by) values(v_pack.id,v_decision,btrim(payload->>'note'),v_assignment.matrix_id,v_assignment.id,auth.uid()) on conflict(exception_pack_id) do nothing;
    update procurement.exception_packs set status = case when v_decision = 'approved' then 'approved' else 'rejected' end where id=v_pack.id returning * into v_pack;
  else raise exception 'Review stage must be procurement, finance, or doa'; end if;
  return to_jsonb(v_pack);
end;
$$;

-- Task 10 fix round 1 terminal controls. These overrides deliberately sit after
-- all earlier compatibility definitions so the live public RPCs have one gate.
alter table legal.vendor_probation_reviews
  add column if not exists completed_by uuid references core.profiles(id) on delete restrict;

create table if not exists legal.vendor_eligibility_decisions (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references core.vendors(id) on delete restrict,
  probation_review_id uuid references legal.vendor_probation_reviews(id) on delete restrict,
  status text not null,
  decision text,
  scope text,
  effective_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz,
  evidence_reference text not null,
  notice_reference text not null,
  revision integer not null default 1,
  opened_by uuid not null references core.profiles(id) on delete restrict,
  decided_by uuid not null references core.profiles(id) on delete restrict,
  decided_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  constraint vendor_eligibility_decisions_status_check check (
    status in ('approved', 'probation', 'provisional', 'expired', 'suspended', 'rejected', 'temporary_clearance')
  ),
  constraint vendor_eligibility_decisions_decision_check check (
    decision is null or decision in ('pass', 'extend', 'revoke', 'suspend')
  ),
  constraint vendor_eligibility_decisions_window_check check (
    expires_at is null or expires_at > effective_at
  ),
  constraint vendor_eligibility_decisions_evidence_check check (
    pg_catalog.length(pg_catalog.btrim(evidence_reference)) > 0
    and pg_catalog.length(pg_catalog.btrim(notice_reference)) > 0
  )
);

create table if not exists legal.vendor_temporary_clearances (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references core.vendors(id) on delete restrict,
  request_id text,
  scope text not null,
  amount_limit numeric,
  effective_at timestamptz not null,
  expires_at timestamptz not null,
  evidence_reference text not null,
  notice_reference text not null,
  status text not null default 'pending',
  revision integer not null default 1,
  made_by uuid not null references core.profiles(id) on delete restrict,
  decided_by uuid references core.profiles(id) on delete restrict,
  decided_at timestamptz,
  legacy_disposition_id uuid unique references legal.accreditation_dispositions(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  constraint vendor_temporary_clearances_window_check check (expires_at > effective_at),
  constraint vendor_temporary_clearances_status_check check (status in ('pending', 'approved', 'revoked')),
  constraint vendor_temporary_clearances_amount_check check (amount_limit is null or amount_limit >= 0)
);
alter table legal.vendor_temporary_clearances enable row level security;
alter table legal.vendor_temporary_clearances force row level security;
create policy vendor_temporary_clearances_legal_or_procurement_read on legal.vendor_temporary_clearances
  for select to authenticated using (
    core.has_live_cap('legal', 'review_accreditation')
    or core.has_live_cap('procurement', 'view_dashboard')
  );
revoke all on legal.vendor_temporary_clearances from public, anon, authenticated, service_role;
grant select on legal.vendor_temporary_clearances to authenticated;

-- Preserve the former Legal authority deterministically before the stricter
-- request gate consumes it. The source disposition stays intact as evidence.
insert into legal.vendor_temporary_clearances(
  vendor_id, request_id, scope, amount_limit, effective_at, expires_at,
  evidence_reference, notice_reference, status, revision, made_by, decided_by,
  decided_at, legacy_disposition_id
)
select
  c.vendor_id,
  nullif(d.conditions->>'request_id', ''),
  coalesce(nullif(pg_catalog.btrim(d.conditions->>'category'), ''), '*'),
  nullif(d.conditions->>'max_amount', '')::numeric,
  coalesce(nullif(d.conditions->>'valid_from', '')::timestamptz, d.decided_at),
  coalesce(nullif(d.conditions->>'valid_until', '')::timestamptz, d.follow_up_due_at),
  'legacy-disposition:' || d.id::text,
  'legacy-disposition-notice:' || d.id::text,
  'approved', 1, d.decided_by, d.decided_by, d.decided_at, d.id
from legal.accreditation_dispositions d
join legal.accreditation_cases c on c.id = d.case_id
where d.disposition = 'temporary_clearance'
  and coalesce((d.conditions->>'approved')::boolean, false) is true
  and coalesce(nullif(d.conditions->>'valid_until', '')::timestamptz, d.follow_up_due_at) is not null
on conflict (legacy_disposition_id) do nothing;

create or replace function private.policy_request_vendor_eligibility_projection(
  p_vendor_id uuid,
  p_request procurement.requests,
  p_as_of timestamptz default statement_timestamp()
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_vendor core.vendors;
  v_decision legal.vendor_eligibility_decisions;
  v_clearance legal.vendor_temporary_clearances;
  v_now timestamptz := coalesce(p_as_of, statement_timestamp());
  v_core_expired boolean := false;
  v_current boolean := false;
begin
  select * into v_vendor from core.vendors where id = p_vendor_id;
  if not found then raise exception 'Vendor not found'; end if;
  v_core_expired := v_vendor.accreditation_expires_at is not null and v_vendor.accreditation_expires_at < v_now::date;
  select * into v_decision from legal.vendor_eligibility_decisions
    where vendor_id = p_vendor_id and effective_at <= v_now
    order by decided_at desc, revision desc limit 1;
  select * into v_clearance from legal.vendor_temporary_clearances
    where vendor_id = p_vendor_id and status = 'approved'
      and effective_at <= v_now and expires_at > v_now
      and (request_id is null or request_id = p_request.id::text)
      and (scope = '*' or pg_catalog.lower(scope) = pg_catalog.lower(pg_catalog.btrim(p_request.category)))
      and (amount_limit is null or coalesce(p_request.estimated_amount, 0) <= amount_limit)
    order by decided_at desc nulls last, revision desc, id desc limit 1;
  v_current := v_decision.id is not null and (v_decision.expires_at is null or v_decision.expires_at > v_now);
  if v_decision.status in ('suspended', 'rejected') and v_current then
    return jsonb_build_object('eligible', false, 'status', v_decision.status, 'current', true, 'authority', 'Legal/VMO');
  end if;
  if v_clearance.id is not null then
    return jsonb_build_object('eligible', true, 'status', 'temporary_clearance', 'current', true, 'scopeEligible', true, 'authority', 'Legal/VMO', 'clearanceId', v_clearance.id, 'revision', v_clearance.revision, 'expiresAt', v_clearance.expires_at);
  end if;
  if v_core_expired then
    return jsonb_build_object('eligible', false, 'status', 'expired', 'current', false, 'scopeEligible', false, 'authority', 'Legal/VMO', 'expiresAt', v_vendor.accreditation_expires_at);
  end if;
  if v_current and v_decision.status in ('approved', 'probation') then
    return jsonb_build_object('eligible', true, 'status', v_decision.status, 'current', true, 'scopeEligible', true, 'authority', 'Legal/VMO', 'decisionId', v_decision.id, 'revision', v_decision.revision);
  end if;
  return jsonb_build_object('eligible', v_vendor.accreditation_status = 'approved', 'status', case when v_vendor.accreditation_status = 'approved' then 'approved' else coalesce(v_vendor.accreditation_status, 'rejected') end, 'current', v_vendor.accreditation_status = 'approved', 'scopeEligible', v_vendor.accreditation_status = 'approved', 'authority', 'Legal/VMO');
end;
$$;

create or replace function private.policy_vendor_eligibility_projection(
  p_vendor_id uuid, p_scope text, p_as_of timestamptz
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_vendor core.vendors; v_request procurement.requests; v_projection jsonb; v_as_of timestamptz := coalesce(p_as_of, statement_timestamp());
begin
  select * into v_vendor from core.vendors where id = p_vendor_id;
  if not found then raise exception 'Vendor not found'; end if;
  select * into v_request from procurement.requests where category is not distinct from p_scope order by updated_at desc nulls last limit 1;
  if found then return private.policy_request_vendor_eligibility_projection(p_vendor_id, v_request, v_as_of); end if;
  if v_vendor.accreditation_expires_at is not null and v_vendor.accreditation_expires_at < v_as_of::date then
    return jsonb_build_object('vendorId', p_vendor_id, 'status', 'expired', 'eligible', false, 'current', false, 'scopeEligible', false, 'authority', 'Legal/VMO', 'expiresAt', v_vendor.accreditation_expires_at);
  end if;
  return jsonb_build_object('vendorId', p_vendor_id, 'status', case when v_vendor.accreditation_status = 'approved' then 'approved' else coalesce(v_vendor.accreditation_status, 'rejected') end, 'eligible', v_vendor.accreditation_status = 'approved', 'current', v_vendor.accreditation_status = 'approved', 'scopeEligible', v_vendor.accreditation_status = 'approved', 'authority', 'Legal/VMO');
end;
$$;

create or replace function private.policy_assert_request_vendor_eligible(p_vendor_id uuid, p_request_id text, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_request procurement.requests; v_projection jsonb;
begin
  if p_action not in ('invite', 'issue_purchase_order', 'prepare_payment') then raise exception 'Unsupported vendor eligibility action'; end if;
  select * into v_request from procurement.requests where id::text = p_request_id for share;
  if not found then raise exception 'Request not found'; end if;
  v_projection := private.policy_request_vendor_eligibility_projection(p_vendor_id, v_request, statement_timestamp());
  if coalesce((v_projection->>'eligible')::boolean, false) is not true then raise exception 'Legal/VMO vendor eligibility is not current, approved, and scoped for this request'; end if;
end;
$$;

create or replace function legal.record_vendor_probation_review(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_review legal.vendor_probation_reviews; v_expected integer := coalesce(nullif(payload->>'expected_revision','')::integer,-1); v_projection jsonb;
begin
  if v_actor is null or not core.has_live_cap('legal','review_accreditation') then raise exception 'Legal/VMO probation review authority is required'; end if;
  select * into v_review from legal.vendor_probation_reviews where id=(payload->>'probation_review_id')::uuid for update;
  if not found then raise exception 'Probation review not found'; end if;
  if v_expected <> v_review.revision then
    if v_review.completed_by=v_actor and v_review.status='completed'
      and v_review.po_win_rate=(payload->>'po_win_rate')::numeric
      and v_review.delivery_commitment_rate=(payload->>'delivery_commitment_rate')::numeric
      and v_review.return_or_rejection_count=(payload->>'return_or_rejection_count')::integer
      and v_review.document_timeliness_rate=(payload->>'document_timeliness_rate')::numeric
      and v_review.evidence_reference=pg_catalog.btrim(payload->>'evidence_reference')
      and v_review.notice_reference=pg_catalog.btrim(payload->>'notice_reference') then return to_jsonb(v_review)||jsonb_build_object('replayed',true); end if;
    raise exception 'Probation review changed; refresh before retrying';
  end if;
  if nullif(pg_catalog.btrim(payload->>'evidence_reference'),'') is null or nullif(pg_catalog.btrim(payload->>'notice_reference'),'') is null then raise exception 'Evidence and issued notice references are required'; end if;
  if nullif(payload->>'po_win_rate','') is null or nullif(payload->>'delivery_commitment_rate','') is null or nullif(payload->>'return_or_rejection_count','') is null or nullif(payload->>'document_timeliness_rate','') is null then raise exception 'All six-month probation metrics are required'; end if;
  if (payload->>'po_win_rate')::numeric not between 0 and 1 or (payload->>'delivery_commitment_rate')::numeric not between 0 and 1 or (payload->>'document_timeliness_rate')::numeric not between 0 and 1 or (payload->>'return_or_rejection_count')::integer < 0 then raise exception 'Probation metrics must be valid non-negative rates and counts'; end if;
  update legal.vendor_probation_reviews set status='completed',po_win_rate=(payload->>'po_win_rate')::numeric,delivery_commitment_rate=(payload->>'delivery_commitment_rate')::numeric,return_or_rejection_count=(payload->>'return_or_rejection_count')::integer,document_timeliness_rate=(payload->>'document_timeliness_rate')::numeric,evidence_reference=pg_catalog.btrim(payload->>'evidence_reference'),notice_reference=pg_catalog.btrim(payload->>'notice_reference'),completed_by=v_actor,revision=revision+1,updated_at=statement_timestamp() where id=v_review.id returning to_jsonb(legal.vendor_probation_reviews.*)||jsonb_build_object('replayed',false) into v_projection;
  return v_projection;
end;
$$;

create or replace function legal.record_vendor_eligibility_decision(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_review legal.vendor_probation_reviews; v_prior legal.vendor_eligibility_decisions; v_expected integer:=coalesce(nullif(payload->>'expected_revision','')::integer,-1); v_decision text:=nullif(pg_catalog.btrim(payload->>'decision'),''); v_status text; v_result jsonb;
begin
  if v_actor is null or not core.has_live_cap('legal','approve_accreditation') then raise exception 'Legal/VMO decision authority is required'; end if;
  select * into v_review from legal.vendor_probation_reviews where id=(payload->>'probation_review_id')::uuid for update;
  if not found or v_review.status<>'completed' then raise exception 'A completed probation review is required'; end if;
  if coalesce(v_review.completed_by,v_review.opened_by)=v_actor then raise exception 'Probation review maker and decision actor must be different'; end if;
  if v_decision not in ('pass','extend','revoke','suspend') then raise exception 'Pass, extend, revoke, or suspend decision is required'; end if;
  if nullif(pg_catalog.btrim(payload->>'evidence_reference'),'') is null or nullif(pg_catalog.btrim(payload->>'notice_reference'),'') is null then raise exception 'Evidence and issued notice references are required'; end if;
  if v_decision='pass' and (coalesce(v_review.po_win_rate,-1)<.2 or coalesce(v_review.delivery_commitment_rate,-1)<>1 or coalesce(v_review.return_or_rejection_count,1)<>0 or coalesce(v_review.document_timeliness_rate,-1)<>1) then raise exception 'A pass requires 20%% PO win rate, 100%% delivery and documents, and zero returns/rejections'; end if;
  select * into v_prior from legal.vendor_eligibility_decisions where probation_review_id=v_review.id order by revision desc limit 1 for update;
  if found and v_expected<>v_prior.revision then
    if v_prior.decided_by=v_actor and v_prior.decision=v_decision and v_prior.evidence_reference=pg_catalog.btrim(payload->>'evidence_reference') and v_prior.notice_reference=pg_catalog.btrim(payload->>'notice_reference') then return to_jsonb(v_prior)||jsonb_build_object('replayed',true); end if;
    raise exception 'Vendor eligibility decision changed; refresh before retrying';
  elsif not found and v_expected<>0 then raise exception 'Vendor eligibility decision changed; refresh before retrying'; end if;
  v_status:=case v_decision when 'pass' then 'approved' when 'extend' then 'probation' when 'revoke' then 'rejected' else 'suspended' end;
  insert into legal.vendor_eligibility_decisions(vendor_id,probation_review_id,status,decision,evidence_reference,notice_reference,revision,opened_by,decided_by)
  values(v_review.vendor_id,v_review.id,v_status,v_decision,pg_catalog.btrim(payload->>'evidence_reference'),pg_catalog.btrim(payload->>'notice_reference'),coalesce(v_prior.revision,0)+1,coalesce(v_review.completed_by,v_review.opened_by),v_actor)
  returning to_jsonb(legal.vendor_eligibility_decisions.*)||jsonb_build_object('replayed',false) into v_result;
  return v_result;
end;
$$;

create or replace function legal.open_vendor_temporary_clearance(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_clearance legal.vendor_temporary_clearances; v_expected integer:=coalesce(nullif(payload->>'expected_revision','')::integer,-1); v_result jsonb;
begin
  if v_actor is null or not core.has_live_cap('legal','review_accreditation') then raise exception 'Legal/VMO temporary-clearance maker authority is required'; end if;
  if v_expected<>0 then raise exception 'Temporary clearance changed; refresh before retrying'; end if;
  if nullif(pg_catalog.btrim(payload->>'scope'),'') is null or nullif(payload->>'effective_at','') is null or nullif(payload->>'expires_at','') is null or nullif(pg_catalog.btrim(payload->>'evidence_reference'),'') is null or nullif(pg_catalog.btrim(payload->>'notice_reference'),'') is null then raise exception 'Scope, effective date, expiry, evidence, and notice are required'; end if;
  insert into legal.vendor_temporary_clearances(vendor_id,request_id,scope,amount_limit,effective_at,expires_at,evidence_reference,notice_reference,made_by)
  values((payload->>'vendor_id')::uuid,nullif(payload->>'request_id',''),pg_catalog.btrim(payload->>'scope'),nullif(payload->>'amount_limit','')::numeric,(payload->>'effective_at')::timestamptz,(payload->>'expires_at')::timestamptz,pg_catalog.btrim(payload->>'evidence_reference'),pg_catalog.btrim(payload->>'notice_reference'),v_actor)
  returning to_jsonb(legal.vendor_temporary_clearances.*)||jsonb_build_object('replayed',false) into v_result;
  return v_result;
end;
$$;

create or replace function legal.decide_vendor_temporary_clearance(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_clearance legal.vendor_temporary_clearances; v_expected integer:=coalesce(nullif(payload->>'expected_revision','')::integer,-1); v_decision text:=nullif(pg_catalog.btrim(payload->>'decision'),''); v_result jsonb;
begin
  if v_actor is null or not core.has_live_cap('legal','approve_accreditation') then raise exception 'Legal/VMO temporary-clearance decision authority is required'; end if;
  select * into v_clearance from legal.vendor_temporary_clearances where id=(payload->>'clearance_id')::uuid for update;
  if not found then raise exception 'Temporary clearance not found'; end if;
  if v_expected<>v_clearance.revision then
    if v_clearance.decided_by=v_actor and v_clearance.status=(case when v_decision='approve' then 'approved' else 'revoked' end) then return to_jsonb(v_clearance)||jsonb_build_object('replayed',true); end if;
    raise exception 'Temporary clearance changed; refresh before retrying';
  end if;
  if v_clearance.made_by=v_actor then raise exception 'Temporary clearance maker and decision actor must be different'; end if;
  if v_decision not in ('approve','revoke') then raise exception 'Approve or revoke decision is required'; end if;
  update legal.vendor_temporary_clearances set status=case when v_decision='approve' then 'approved' else 'revoked' end,decided_by=v_actor,decided_at=statement_timestamp(),revision=revision+1 where id=v_clearance.id returning to_jsonb(legal.vendor_temporary_clearances.*)||jsonb_build_object('replayed',false) into v_result;
  return v_result;
end;
$$;

do $$ begin
  if to_regprocedure('procurement.prepare_invoice_payment_readiness(jsonb)') is not null then execute 'alter function procurement.prepare_invoice_payment_readiness(jsonb) rename to prepare_invoice_payment_readiness_pre_task_10_fix'; end if;
end $$;
alter table procurement.payment_readiness_packs
  add column if not exists foreign_vendor_evidence_storage_path text;
create or replace function private.policy_prepare_invoice_payment_readiness(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_po procurement.purchase_orders; v_request procurement.requests; v_pack procurement.payment_readiness_packs; v_ids uuid[]; v_accepted numeric; v_prior numeric; v_invoice numeric; v_corrected uuid; v_blockers text[];
begin
  if not (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','admin')) then raise exception 'Not authorized to prepare payment'; end if;
  select * into v_po from procurement.purchase_orders where id=payload->>'purchase_order_id' for update;
  if not found or v_po.status<>'issued' then raise exception 'An issued purchase order is required'; end if;
  select * into v_request from procurement.requests where id::text=v_po.request_id::text for share;
  if not found then raise exception 'Request not found'; end if;
  perform private.policy_assert_request_vendor_eligible(v_po.core_vendor_id,v_request.id::text,'prepare_payment');
  v_blockers:=private.policy_payment_evidence_blockers(v_po,v_request,payload);
  if cardinality(v_blockers)>0 then raise exception 'Payment readiness evidence is incomplete: %',array_to_string(v_blockers,'; '); end if;
  v_invoice:=(payload->>'invoice_amount')::numeric;
  if exists(select 1 from procurement.payment_readiness_packs prior join procurement.purchase_orders prior_po on prior_po.id=prior.purchase_order_id where prior_po.core_vendor_id=v_po.core_vendor_id and pg_catalog.lower(prior.invoice_number)=pg_catalog.lower(payload->>'invoice_number') and prior.purchase_order_id<>v_po.id and prior.status<>'superseded') then raise exception 'Duplicate vendor invoice number'; end if;
  select array_agg(pack.id order by pack.accepted_at,pack.id),coalesce(sum(coalesce(pack.accepted_amount,0)),0) into v_ids,v_accepted from procurement.acceptance_packs pack where pack.purchase_order_id=v_po.id and pack.status='accepted' and coalesce(jsonb_array_length(pack.exceptions),0)=0;
  if coalesce(cardinality(v_ids),0)=0 then raise exception 'Acceptance evidence is required'; end if;
  update procurement.payment_readiness_packs set evidence_stale=true,status='returned' where purchase_order_id=v_po.id and status in ('ready_for_finance','accepted') and acceptance_evidence_version is distinct from v_po.acceptance_evidence_version;
  select coalesce(sum(prior.invoice_amount),0) into v_prior from procurement.payment_readiness_packs prior where prior.purchase_order_id=v_po.id and prior.status in ('accepted','released') and not coalesce(prior.evidence_stale,false);
  if v_invoice>v_accepted-v_prior or v_invoice>v_po.total-v_prior then raise exception 'Invoice exceeds the accepted unpaid value'; end if;
  v_corrected:=nullif(payload->>'corrected_from','')::uuid;
  if v_corrected is not null then
    select * into v_pack from procurement.payment_readiness_packs
      where id=v_corrected and purchase_order_id=v_po.id for update;
    if not found then raise exception 'Corrected Finance readiness pack not found for this purchase order'; end if;
    if v_pack.status<>'returned'
       and not (v_pack.status in ('accepted','released') and v_pack.evidence_stale) then
      raise exception 'Only returned or finalized stale Finance evidence may be replaced';
    end if;
  elsif exists (
    select 1 from procurement.payment_readiness_packs stale_pack
    where stale_pack.purchase_order_id=v_po.id
      and stale_pack.status in ('accepted','released') and stale_pack.evidence_stale
  ) then
    raise exception 'A replacement for finalized stale Finance evidence must identify corrected_from';
  end if;
  update procurement.payment_readiness_packs set status='superseded' where purchase_order_id=v_po.id and status in ('draft','returned','ready_for_finance');
  insert into procurement.payment_readiness_packs(purchase_order_id,acceptance_pack_id,acceptance_pack_ids,accepted_quantity,acceptance_evidence_version,policy_version,po_match,invoice_or_si_storage_path,milestone_support_storage_path,tax_withholding_support_storage_path,foreign_vendor_evidence_storage_path,invoice_number,invoice_date,due_date,invoice_amount,tax_amount,withholding_amount,purchase_order_amount,accepted_amount,variance_amount,status,corrected_from)
  values(v_po.id,v_ids[1],v_ids,0,v_po.acceptance_evidence_version,'request-bound-policy-profile',true,payload->>'invoice_or_si_storage_path',payload->>'milestone_support_storage_path',payload->>'tax_withholding_support_storage_path',nullif(pg_catalog.btrim(payload->>'foreign_vendor_evidence_storage_path'),''),payload->>'invoice_number',(payload->>'invoice_date')::date,nullif(payload->>'due_date','')::date,v_invoice,coalesce((payload->>'tax_amount')::numeric,0),coalesce((payload->>'withholding_amount')::numeric,0),v_po.total,v_accepted,v_accepted-v_prior-v_invoice,'ready_for_finance',v_corrected) returning * into v_pack;
  return to_jsonb(v_pack);
end;
$$;
create or replace function procurement.prepare_invoice_payment_readiness(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$ begin return private.policy_prepare_invoice_payment_readiness(payload); end; $$;
revoke all on function private.policy_request_vendor_eligibility_projection(uuid,procurement.requests,timestamptz), private.policy_prepare_invoice_payment_readiness(jsonb) from public, anon, authenticated, service_role;
do $$ begin
  revoke all on function procurement.prepare_invoice_payment_readiness_pre_task_10_fix(jsonb) from public, anon, authenticated, service_role;
exception when undefined_function then null;
end $$;
revoke all on function legal.record_vendor_probation_review(jsonb), legal.open_vendor_temporary_clearance(jsonb), legal.decide_vendor_temporary_clearance(jsonb), procurement.prepare_invoice_payment_readiness(jsonb) from public, anon;
grant execute on function legal.record_vendor_probation_review(jsonb), legal.open_vendor_temporary_clearance(jsonb), legal.decide_vendor_temporary_clearance(jsonb), procurement.prepare_invoice_payment_readiness(jsonb) to authenticated;

-- Task 9 terminal override. This is intentionally last: previous additive
-- compatibility sections define the same RPC names during upgrade.
create or replace function private.policy_po_lifecycle_transition(p_purchase_order_id text,p_expected_revision integer,p_event_type text,p_reference text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_state procurement.purchase_order_lifecycle_state; v_po procurement.purchase_orders; v_event procurement.purchase_order_lifecycle_events; v_request procurement.purchase_order_closure_requests;
begin
 if auth.uid() is null then raise exception 'Authenticated actor is required'; end if;
 select * into v_po from procurement.purchase_orders where id=p_purchase_order_id for update;
 if not found or v_po.status<>'issued' then raise exception 'An issued purchase order is required'; end if;
 select * into v_state from procurement.purchase_order_lifecycle_state where purchase_order_id=p_purchase_order_id for update;
 if not found then raise exception 'PO lifecycle is missing; refresh after governed issue'; end if;
 if p_expected_revision<>v_state.revision then
   select * into v_event from procurement.purchase_order_lifecycle_events where purchase_order_id=p_purchase_order_id and event_type=p_event_type and expected_revision=p_expected_revision and actor_id=auth.uid() and evidence_reference is not distinct from nullif(pg_catalog.btrim(p_reference),'');
   if found then return private.policy_po_lifecycle_projection(p_purchase_order_id)||jsonb_build_object('replayed',true); end if;
   raise exception 'The PO lifecycle changed; refresh before retrying';
 end if;
 if nullif(pg_catalog.btrim(p_reference),'') is null then raise exception 'A governed evidence reference is required'; end if;
 if p_event_type='vendor_acknowledged' then
   if core.current_vendor_id()::text is distinct from v_po.core_vendor_id::text then raise exception 'Only the awarded vendor may acknowledge this PO'; end if;
   update procurement.purchase_order_lifecycle_state set acknowledged_at=statement_timestamp(),acknowledgement_reference=pg_catalog.btrim(p_reference),revision=revision+1,updated_at=statement_timestamp() where purchase_order_id=p_purchase_order_id returning * into v_state;
 elsif p_event_type='delivery_notice' then
   if not (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','admin')) then raise exception 'Procurement authority is required'; end if;
   update procurement.purchase_order_lifecycle_state set delivery_notice_at=statement_timestamp(),delivery_notice_reference=pg_catalog.btrim(p_reference),revision=revision+1,updated_at=statement_timestamp() where purchase_order_id=p_purchase_order_id returning * into v_state;
 elsif p_event_type='closed' then
   select * into v_request from procurement.purchase_order_closure_requests where id=(p_payload->>'closureRequestId')::uuid for update;
   if not found or v_request.status<>'approved' or v_request.decided_by<>auth.uid() or v_request.purchase_order_id<>p_purchase_order_id then raise exception 'Approved independent closure request is required'; end if;
   update procurement.purchase_order_lifecycle_state set revision=revision+1,closed_at=statement_timestamp(),closed_by=auth.uid(),closure_reason=pg_catalog.btrim(p_reference),closure_status='closed',updated_at=statement_timestamp() where purchase_order_id=p_purchase_order_id returning * into v_state;
   update procurement.purchase_orders set status='closed',updated_at=statement_timestamp() where id=p_purchase_order_id;
 else raise exception 'Unsupported PO lifecycle event'; end if;
 insert into procurement.purchase_order_lifecycle_events(purchase_order_id,event_type,expected_revision,resulting_revision,actor_id,evidence_reference,payload) values(p_purchase_order_id,p_event_type,p_expected_revision,v_state.revision,auth.uid(),pg_catalog.btrim(p_reference),coalesce(p_payload,'{}'::jsonb));
 return private.policy_po_lifecycle_projection(p_purchase_order_id)||jsonb_build_object('replayed',false);
end;
$$;
revoke all on function private.policy_po_lifecycle_transition(text,integer,text,text,jsonb) from public, anon, authenticated;

-- Task 10 terminal controls. Legal/VMO owns vendor state; Procurement only
-- consumes the projection and cannot assert invitation, PO, or payment readiness.
alter table legal.vendor_probation_reviews
  add column if not exists po_win_rate numeric,
  add column if not exists delivery_commitment_rate numeric,
  add column if not exists return_or_rejection_count integer,
  add column if not exists document_timeliness_rate numeric,
  add column if not exists evidence_reference text,
  add column if not exists notice_reference text,
  add column if not exists revision integer not null default 1;

create table if not exists legal.vendor_eligibility_decisions (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references core.vendors(id) on delete restrict,
  probation_review_id uuid references legal.vendor_probation_reviews(id) on delete restrict,
  status text not null,
  decision text,
  scope text,
  effective_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz,
  evidence_reference text not null,
  notice_reference text not null,
  revision integer not null default 1,
  opened_by uuid not null references core.profiles(id) on delete restrict,
  decided_by uuid not null references core.profiles(id) on delete restrict,
  decided_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  constraint vendor_eligibility_decisions_status_check check (
    status in ('approved', 'probation', 'provisional', 'expired', 'suspended', 'rejected', 'temporary_clearance')
  ),
  constraint vendor_eligibility_decisions_decision_check check (
    decision is null or decision in ('pass', 'extend', 'revoke', 'suspend')
  ),
  constraint vendor_eligibility_decisions_window_check check (
    expires_at is null or expires_at > effective_at
  ),
  constraint vendor_eligibility_decisions_evidence_check check (
    pg_catalog.length(pg_catalog.btrim(evidence_reference)) > 0
    and pg_catalog.length(pg_catalog.btrim(notice_reference)) > 0
  )
);

create table if not exists legal.vendor_sample_custody_events (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references core.vendors(id) on delete restrict,
  purchase_order_id text references procurement.purchase_orders(id) on delete restrict,
  purpose text not null,
  custodian_id uuid not null references core.profiles(id) on delete restrict,
  evaluation_reference text not null,
  disposition text not null,
  mwell_requested boolean not null default false,
  evidence_reference text not null,
  revision integer not null default 1,
  recorded_by uuid not null references core.profiles(id) on delete restrict,
  recorded_at timestamptz not null default statement_timestamp(),
  constraint vendor_sample_custody_events_disposition_check check (
    disposition in ('returned', 'consumed_in_evaluation', 'retained', 'destroyed', 'released_to_vendor')
  ),
  constraint vendor_sample_custody_events_mwell_po_check check (
    not mwell_requested or purchase_order_id is not null
  )
);

create index if not exists vendor_eligibility_decisions_vendor_decided_idx
  on legal.vendor_eligibility_decisions(vendor_id, decided_at desc, revision desc);
create index if not exists vendor_sample_custody_events_vendor_idx
  on legal.vendor_sample_custody_events(vendor_id, recorded_at desc);

alter table legal.vendor_eligibility_decisions enable row level security;
alter table legal.vendor_eligibility_decisions force row level security;
alter table legal.vendor_sample_custody_events enable row level security;
alter table legal.vendor_sample_custody_events force row level security;

create policy vendor_eligibility_decisions_legal_or_procurement_read on legal.vendor_eligibility_decisions
  for select to authenticated using (
    core.has_live_cap('legal', 'review_accreditation')
    or core.has_live_cap('procurement', 'view_dashboard')
  );
create policy vendor_sample_custody_events_legal_or_procurement_read on legal.vendor_sample_custody_events
  for select to authenticated using (
    core.has_live_cap('legal', 'review_accreditation')
    or core.has_live_cap('procurement', 'view_dashboard')
  );

revoke all on legal.vendor_eligibility_decisions, legal.vendor_sample_custody_events
  from public, anon, authenticated, service_role;
grant select on legal.vendor_eligibility_decisions, legal.vendor_sample_custody_events to authenticated;

create or replace function private.policy_vendor_eligibility_projection(
  p_vendor_id uuid,
  p_scope text,
  p_as_of timestamptz
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_vendor core.vendors;
  v_decision legal.vendor_eligibility_decisions;
  v_status text;
  v_as_of timestamptz := coalesce(p_as_of, statement_timestamp());
  v_scope_ok boolean := false;
  v_current boolean := false;
begin
  select * into v_vendor from core.vendors where id = p_vendor_id;
  if not found then raise exception 'Vendor not found'; end if;
  select * into v_decision
    from legal.vendor_eligibility_decisions
    where vendor_id = p_vendor_id and effective_at <= v_as_of
    order by decided_at desc, revision desc
    limit 1;
  v_status := coalesce(v_decision.status, case
    when v_vendor.accreditation_status in ('approved', 'provisional') then v_vendor.accreditation_status
    when v_vendor.accreditation_status in ('suspended', 'rejected', 'expired') then v_vendor.accreditation_status
    else 'rejected'
  end);
  v_scope_ok := v_decision.scope is null or nullif(pg_catalog.btrim(p_scope), '') is not null
    and pg_catalog.lower(pg_catalog.btrim(v_decision.scope)) = pg_catalog.lower(pg_catalog.btrim(p_scope));
  v_current := v_decision.expires_at is null or v_decision.expires_at > v_as_of;
  return jsonb_build_object(
    'vendorId', p_vendor_id,
    'status', v_status,
    'scope', v_decision.scope,
    'effectiveAt', v_decision.effective_at,
    'expiresAt', v_decision.expires_at,
    'authority', 'Legal/VMO',
    'eligible', case
      when v_status in ('approved', 'probation') then v_current
      when v_status = 'temporary_clearance' then v_current and v_scope_ok
      else false
    end,
    'scopeEligible', v_scope_ok,
    'current', v_current,
    'decisionId', v_decision.id,
    'revision', coalesce(v_decision.revision, 0)
  );
end;
$$;

create or replace function private.policy_assert_request_vendor_eligible(
  p_vendor_id uuid,
  p_request_id text,
  p_action text
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_request procurement.requests; v_projection jsonb;
begin
  if p_action not in ('invite', 'issue_purchase_order', 'prepare_payment') then
    raise exception 'Unsupported vendor eligibility action';
  end if;
  select * into v_request from procurement.requests where id = p_request_id for share;
  if not found then raise exception 'Request not found'; end if;
  v_projection := private.policy_vendor_eligibility_projection(p_vendor_id, v_request.category, statement_timestamp());
  if coalesce((v_projection->>'eligible')::boolean, false) is not true then
    raise exception 'Legal/VMO vendor eligibility is not current, approved, and scoped for this request';
  end if;
end;
$$;

create or replace function private.policy_payment_evidence_blockers(
  p_po procurement.purchase_orders,
  p_request procurement.requests,
  p_payload jsonb
)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  v_profile procurement.policy_profiles;
  v_invoice numeric := nullif(p_payload->>'invoice_amount', '')::numeric;
  v_accepted numeric := 0;
  v_is_foreign boolean := false;
  v_blockers text[] := '{}'::text[];
begin
  -- client-provided payment readiness is intentionally ignored.
  select * into v_profile from procurement.policy_profiles where id = p_request.policy_profile_id;
  if not found or v_profile.relationship <> 'mwell_operating' or v_profile.status <> 'active' then
    v_blockers := array_append(v_blockers, 'Request-bound active policy profile is required');
  end if;
  select coalesce(sum(accepted_amount), 0) into v_accepted
    from procurement.acceptance_packs
    where purchase_order_id = p_po.id and status = 'accepted' and coalesce(jsonb_array_length(exceptions), 0) = 0;
  if nullif(pg_catalog.btrim(p_payload->>'invoice_number'), '') is null
    or nullif(pg_catalog.btrim(p_payload->>'invoice_or_si_storage_path'), '') is null then
    v_blockers := array_append(v_blockers, 'Invoice, OR, or SI evidence is required');
  end if;
  if v_invoice is null or v_invoice <= 0 then
    v_blockers := array_append(v_blockers, 'A positive itemized invoice amount is required');
  elsif v_invoice > p_po.total or (v_accepted > 0 and v_invoice > v_accepted) then
    v_blockers := array_append(v_blockers, 'Amount and quantity must match governed PO and acceptance records');
  end if;
  if nullif(pg_catalog.btrim(p_payload->>'milestone_support_storage_path'), '') is null or v_accepted <= 0 then
    v_blockers := array_append(v_blockers, 'Receipt or acceptance evidence is required');
  end if;
  if nullif(pg_catalog.btrim(p_payload->>'tax_withholding_support_storage_path'), '') is null then
    v_blockers := array_append(v_blockers, 'Tax and withholding support is required');
  end if;
  select exists(
    select 1 from legal.accreditation_cases c
    where c.vendor_id = p_po.core_vendor_id and coalesce(c.jurisdiction, 'PH') <> 'PH'
  ) into v_is_foreign;
  if v_is_foreign and nullif(pg_catalog.btrim(p_payload->>'foreign_vendor_evidence_storage_path'), '') is null then
    v_blockers := array_append(v_blockers, 'Foreign-vendor tax, withholding, and payment-control evidence is required');
  end if;
  if v_profile.id is not null and v_invoice is not null and v_invoice >= v_profile.po_invoice_threshold
    and p_po.id is null then
    v_blockers := array_append(v_blockers, 'Purchase order evidence is required at or above the request-bound threshold');
  end if;
  return v_blockers;
end;
$$;

create or replace function legal.record_vendor_eligibility_decision(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_review legal.vendor_probation_reviews; v_prior legal.vendor_eligibility_decisions; v_result jsonb;
  v_decision text := nullif(pg_catalog.btrim(payload->>'decision'), ''); v_status text;
  v_expected integer := coalesce(nullif(payload->>'expected_revision', '')::integer, -1);
begin
  if v_actor is null or not core.has_live_cap('legal', 'approve_accreditation') then
    raise exception 'Legal/VMO decision authority is required';
  end if;
  select * into v_review from legal.vendor_probation_reviews where id = (payload->>'probation_review_id')::uuid for update;
  if not found or v_review.status <> 'completed' then raise exception 'A completed probation review is required'; end if;
  if v_review.opened_by = v_actor then raise exception 'Probation review maker and decision actor must be different'; end if;
  if v_decision not in ('pass', 'extend', 'revoke', 'suspend') then raise exception 'Pass, extend, revoke, or suspend decision is required'; end if;
  if nullif(pg_catalog.btrim(payload->>'evidence_reference'), '') is null or nullif(pg_catalog.btrim(payload->>'notice_reference'), '') is null then
    raise exception 'Evidence and issued notice references are required';
  end if;
  if v_decision = 'pass' and (
    coalesce(v_review.po_win_rate, -1) < .2 or coalesce(v_review.delivery_commitment_rate, -1) <> 1
    or coalesce(v_review.return_or_rejection_count, 1) <> 0 or coalesce(v_review.document_timeliness_rate, -1) <> 1
  ) then raise exception 'A pass requires 20%% PO win rate, 100%% delivery and documents, and zero returns/rejections'; end if;
  select * into v_prior from legal.vendor_eligibility_decisions where probation_review_id = v_review.id order by revision desc limit 1 for update;
  if found and v_expected <> v_prior.revision then
    if v_prior.decided_by = v_actor and v_prior.decision = v_decision
      and v_prior.evidence_reference = pg_catalog.btrim(payload->>'evidence_reference')
      and v_prior.notice_reference = pg_catalog.btrim(payload->>'notice_reference') then
      return to_jsonb(v_prior) || jsonb_build_object('replayed', true);
    end if;
    raise exception 'Vendor eligibility decision changed; refresh before retrying';
  elsif not found and v_expected <> 0 then raise exception 'Vendor eligibility decision changed; refresh before retrying'; end if;
  v_status := case v_decision when 'pass' then 'approved' when 'extend' then 'probation' when 'revoke' then 'rejected' else 'suspended' end;
  insert into legal.vendor_eligibility_decisions(vendor_id, probation_review_id, status, decision, scope, expires_at, evidence_reference, notice_reference, revision, opened_by, decided_by)
  values(v_review.vendor_id, v_review.id, v_status, v_decision, nullif(pg_catalog.btrim(payload->>'scope'), ''), nullif(payload->>'expires_at', '')::timestamptz,
    pg_catalog.btrim(payload->>'evidence_reference'), pg_catalog.btrim(payload->>'notice_reference'), coalesce(v_prior.revision, 0) + 1, v_review.opened_by, v_actor)
  returning to_jsonb(legal.vendor_eligibility_decisions.*) || jsonb_build_object('replayed', false) into v_result;
  update core.vendors set accreditation_status = v_status, accreditation_expires_at = case when v_status in ('approved', 'probation') then nullif(payload->>'expires_at', '')::date else accreditation_expires_at end where id = v_review.vendor_id;
  return v_result;
end;
$$;

create or replace function legal.record_vendor_sample_custody(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_event legal.vendor_sample_custody_events; v_expected integer := coalesce(nullif(payload->>'expected_revision', '')::integer, -1); v_result jsonb;
begin
  if v_actor is null or not core.has_live_cap('legal', 'review_accreditation') then raise exception 'Legal/VMO sample custody authority is required'; end if;
  if nullif(pg_catalog.btrim(payload->>'purpose'), '') is null or nullif(payload->>'custodian_id', '') is null
    or nullif(pg_catalog.btrim(payload->>'evaluation_reference'), '') is null or nullif(pg_catalog.btrim(payload->>'disposition'), '') is null
    or nullif(pg_catalog.btrim(payload->>'evidence_reference'), '') is null then
    raise exception 'Sample purpose, custodian, evaluation, disposition, and an Mwell-requested PO link are required';
  end if;
  if coalesce((payload->>'mwell_requested')::boolean, false) and nullif(payload->>'purchase_order_id', '') is null then
    raise exception 'Sample purpose, custodian, evaluation, disposition, and an Mwell-requested PO link are required';
  end if;
  if nullif(payload->>'id', '') is not null then
    select * into v_event from legal.vendor_sample_custody_events where id = (payload->>'id')::uuid for update;
    if not found then raise exception 'Sample custody event not found'; end if;
    if v_expected <> v_event.revision then
      if v_event.recorded_by = v_actor and v_event.evidence_reference = pg_catalog.btrim(payload->>'evidence_reference') then return to_jsonb(v_event) || jsonb_build_object('replayed', true); end if;
      raise exception 'Sample custody event changed; refresh before retrying';
    end if;
  elsif v_expected <> 0 then raise exception 'Sample custody event changed; refresh before retrying'; end if;
  insert into legal.vendor_sample_custody_events(vendor_id,purchase_order_id,purpose,custodian_id,evaluation_reference,disposition,mwell_requested,evidence_reference,recorded_by)
  values((payload->>'vendor_id')::uuid,nullif(payload->>'purchase_order_id',''),pg_catalog.btrim(payload->>'purpose'),(payload->>'custodian_id')::uuid,pg_catalog.btrim(payload->>'evaluation_reference'),pg_catalog.btrim(payload->>'disposition'),coalesce((payload->>'mwell_requested')::boolean,false),pg_catalog.btrim(payload->>'evidence_reference'),v_actor)
  returning to_jsonb(legal.vendor_sample_custody_events.*) || jsonb_build_object('replayed', false) into v_result;
  return v_result;
end;
$$;

create or replace function legal.vendor_eligibility_projection(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_vendor_id uuid := nullif(payload->>'vendor_id', '')::uuid; v_scope text := nullif(pg_catalog.btrim(payload->>'scope'), '');
begin
  -- Legal/VMO is the only authority for this read-only Procurement projection.
  if auth.uid() is null or not (core.has_live_cap('legal', 'review_accreditation') or core.has_live_cap('procurement', 'view_dashboard') or core.has_live_cap('procurement', 'author_po')) then raise exception 'Legal or Procurement read authority is required'; end if;
  if v_vendor_id is not null then return private.policy_vendor_eligibility_projection(v_vendor_id, v_scope, statement_timestamp()); end if;
  return coalesce((select jsonb_agg(private.policy_vendor_eligibility_projection(v.id, null, statement_timestamp()) order by v.legal_name) from core.vendors v), '[]'::jsonb);
end;
$$;

create or replace function legal.open_vendor_probation_on_accreditation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_profile procurement.policy_profiles;
begin
  if new.accreditation_status = 'approved' and (tg_op = 'INSERT' or old.accreditation_status is distinct from 'approved') and auth.uid() is not null then
    select * into v_profile from procurement.policy_profiles where relationship = 'mwell_operating' and status = 'active' and effective_from <= current_date and (effective_to is null or effective_to >= current_date) order by effective_from desc limit 1;
    if found and not exists(select 1 from legal.vendor_probation_reviews r where r.vendor_id = new.id and r.status in ('open','overdue')) then
      insert into legal.vendor_probation_reviews(vendor_id,policy_profile_id,due_at,opened_by,evidence)
      values(new.id,v_profile.id,statement_timestamp() + make_interval(months => v_profile.vendor_probation_months),auth.uid(),jsonb_build_object('source','accreditation approval'));
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists vendor_probation_on_accreditation on core.vendors;
create trigger vendor_probation_on_accreditation after insert or update of accreditation_status on core.vendors
for each row execute function legal.open_vendor_probation_on_accreditation();

do $$ begin
  if to_regprocedure('procurement.invite_sourcing_vendors(jsonb)') is not null then
    execute 'alter function procurement.invite_sourcing_vendors(jsonb) rename to invite_sourcing_vendors_pre_task_10';
  end if;
end $$;
create or replace function procurement.invite_sourcing_vendors(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_event procurement.sourcing_events; v_vendor_id uuid;
begin
  select * into v_event from procurement.sourcing_events where id = (payload->>'sourcing_event_id')::uuid for update;
  if not found then raise exception 'Sourcing event not found'; end if;
  for v_vendor_id in select value::uuid from jsonb_array_elements_text(coalesce(payload->'vendor_ids','[]'::jsonb)) loop
    perform private.policy_assert_request_vendor_eligible(v_vendor_id, v_event.request_id::text, 'invite');
  end loop;
  return procurement.invite_sourcing_vendors_pre_task_10(payload);
end;
$$;

do $$ begin
  if to_regprocedure('procurement.issue_purchase_order(jsonb)') is not null then
    execute 'alter function procurement.issue_purchase_order(jsonb) rename to issue_purchase_order_pre_task_10';
  end if;
end $$;
create or replace function procurement.issue_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_po procurement.purchase_orders;
begin
  select * into v_po from procurement.purchase_orders where id = payload->>'id' for share;
  if not found then raise exception 'Purchase order not found'; end if;
  perform private.policy_assert_request_vendor_eligible(v_po.core_vendor_id, v_po.request_id::text, 'issue_purchase_order');
  return procurement.issue_purchase_order_pre_task_10(payload);
end;
$$;

do $$ begin
  if to_regprocedure('procurement.prepare_payment_readiness(jsonb)') is not null then
    execute 'alter function procurement.prepare_payment_readiness(jsonb) rename to prepare_payment_readiness_pre_task_10';
  end if;
end $$;
create or replace function procurement.prepare_payment_readiness(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_po procurement.purchase_orders; v_request procurement.requests; v_blockers text[];
begin
  -- client-provided payment readiness is intentionally ignored; records are rechecked below.
  select * into v_po from procurement.purchase_orders where id = payload->>'purchase_order_id' for update;
  if not found then raise exception 'Purchase order not found'; end if;
  select * into v_request from procurement.requests where id = v_po.request_id for share;
  if not found then raise exception 'Request not found'; end if;
  perform private.policy_assert_request_vendor_eligible(v_po.core_vendor_id, v_request.id::text, 'prepare_payment');
  v_blockers := private.policy_payment_evidence_blockers(v_po, v_request, payload);
  if cardinality(v_blockers) > 0 then raise exception 'Payment readiness evidence is incomplete: %', array_to_string(v_blockers, '; '); end if;
  return procurement.prepare_payment_readiness_pre_task_10(payload);
end;
$$;

revoke all on function private.policy_vendor_eligibility_projection(uuid,text,timestamptz), private.policy_assert_request_vendor_eligible(uuid,text,text), private.policy_payment_evidence_blockers(procurement.purchase_orders,procurement.requests,jsonb) from public, anon, authenticated;
do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'legal.open_vendor_probation_on_accreditation()',
    'procurement.invite_sourcing_vendors_pre_task_10(jsonb)',
    'procurement.issue_purchase_order_pre_task_10(jsonb)',
    'procurement.prepare_payment_readiness_pre_task_10(jsonb)'
  ] loop
    begin
      execute format('revoke all on function %s from public, anon, authenticated, service_role', v_signature);
    exception when undefined_function then null;
    end;
  end loop;
end $$;
revoke all on function legal.record_vendor_eligibility_decision(jsonb), legal.record_vendor_sample_custody(jsonb), legal.vendor_eligibility_projection(jsonb), procurement.invite_sourcing_vendors(jsonb), procurement.issue_purchase_order(jsonb), procurement.prepare_payment_readiness(jsonb) from public, anon;
grant execute on function legal.record_vendor_eligibility_decision(jsonb), legal.record_vendor_sample_custody(jsonb), legal.vendor_eligibility_projection(jsonb), procurement.invite_sourcing_vendors(jsonb), procurement.issue_purchase_order(jsonb), procurement.prepare_payment_readiness(jsonb) to authenticated;
-- Task 10 terminal controls end.

create or replace function procurement.review_open_purchase_orders(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 if not (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','view_dashboard') or core.has_live_cap('procurement','admin')) then raise exception 'Procurement monitoring authority is required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',state.purchase_order_id||':weekly','purchaseOrderId',state.purchase_order_id,'kind',case when state.acknowledged_at is null and statement_timestamp()>=state.sent_at+interval '48 hours' then 'vendor_acknowledgement_overdue' when state.acknowledged_at is null and statement_timestamp()>=state.sent_at+interval '47 hours' then 'vendor_acknowledgement_due_soon' when receipt.rejected_or_quarantined_quantity>0 then 'quality_recovery' when receipt.outstanding_quantity>0 then 'open_receipt' else 'open_po' end,'owner','Procurement','dueAt',state.acknowledgement_due_at,'ageHours',floor(extract(epoch from statement_timestamp()-state.sent_at)/3600),'lastNoticeAt',state.delivery_notice_at,'nextAction',case when state.acknowledged_at is null and statement_timestamp()>=state.sent_at+interval '48 hours' then 'Escalate vendor acknowledgement' when state.acknowledged_at is null and statement_timestamp()>=state.sent_at+interval '47 hours' then 'Prepare vendor acknowledgement escalation' when receipt.rejected_or_quarantined_quantity>0 then 'Maintain vendor notice, RMA, credit, and payment hold' when receipt.outstanding_quantity>0 then 'Confirm delivery and receiving handoff' else 'Request governed closure' end)) from procurement.purchase_order_lifecycle_state state join procurement.purchase_orders po on po.id=state.purchase_order_id left join procurement.v_purchase_order_receipt_status receipt on receipt.purchase_order_id::text=po.id where po.status='issued'),'[]'::jsonb);
end;
$$;

create or replace function procurement.purchase_order_closure_work_items(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (core.has_live_cap('procurement','final_approve_po') or core.has_live_cap('procurement','admin')) then
    raise exception 'Independent PO closure approver authority is required';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'closure_request_id', closure.id,
      'purchase_order_id', closure.purchase_order_id,
      'po_number', po.po_number,
      'closure_reason', closure.closure_reason,
      'requested_by_name', coalesce(profile.full_name, profile.email),
      'requested_at', closure.requested_at
    ) order by closure.requested_at asc)
    from procurement.purchase_order_closure_requests closure
    join procurement.purchase_orders po on po.id = closure.purchase_order_id
    left join core.profiles profile on profile.id = closure.requested_by
    where closure.status = 'pending'
  ), '[]'::jsonb);
end;
$$;

create or replace function procurement.close_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$ begin raise exception 'Direct closure is retired; request governed closure'; end; $$;
revoke all on function procurement.close_purchase_order(jsonb) from public, anon, authenticated, service_role;
revoke all on function procurement.review_open_purchase_orders(jsonb) from public, anon;
grant execute on function procurement.review_open_purchase_orders(jsonb) to authenticated;

-- Task 9 fix round 1 final definitions. This block deliberately follows the
-- compatibility definitions above so an applied migration cannot retain an
-- older direct-close or lazy lifecycle implementation.
create or replace function private.policy_po_issue_lifecycle()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := coalesce(new.actor_id, auth.uid());
begin
  if new.status = 'issued' and old.status is distinct from 'issued' then
    if new.issued_at is null or v_actor is null then raise exception 'An issued PO requires authoritative issued_at and actor'; end if;
    insert into procurement.purchase_order_lifecycle_state(purchase_order_id,revision,sent_at,acknowledgement_due_at)
    values(new.id,2,new.issued_at,new.issued_at + interval '48 hours')
    on conflict (purchase_order_id) do nothing;
    insert into procurement.purchase_order_lifecycle_events(purchase_order_id,event_type,expected_revision,resulting_revision,actor_id,evidence_reference,payload)
    values(new.id,'sent',1,2,v_actor,'issued_at',jsonb_build_object('issuedAt',new.issued_at))
    on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.policy_po_issue_lifecycle() from public, anon, authenticated;
drop trigger if exists purchase_order_issue_lifecycle on procurement.purchase_orders;
create trigger purchase_order_issue_lifecycle after update of status on procurement.purchase_orders for each row execute function private.policy_po_issue_lifecycle();
insert into procurement.purchase_order_lifecycle_state(purchase_order_id,revision,sent_at,acknowledgement_due_at)
select po.id,2,po.issued_at,po.issued_at + interval '48 hours'
from procurement.purchase_orders po where po.status='issued' and po.issued_at is not null
on conflict (purchase_order_id) do update set revision=2, sent_at=excluded.sent_at, acknowledgement_due_at=excluded.acknowledgement_due_at;
insert into procurement.purchase_order_lifecycle_events(purchase_order_id,event_type,expected_revision,resulting_revision,actor_id,evidence_reference,payload)
select po.id,'sent',1,2,po.actor_id,'issued_at',jsonb_build_object('issuedAt',po.issued_at,'backfilled',true)
from procurement.purchase_orders po where po.status='issued' and po.issued_at is not null and po.actor_id is not null
on conflict do nothing;

create or replace function private.policy_po_lifecycle_transition(p_purchase_order_id text, p_expected_revision integer, p_event_type text, p_reference text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_state procurement.purchase_order_lifecycle_state; v_po procurement.purchase_orders; v_event procurement.purchase_order_lifecycle_events; v_request procurement.purchase_order_closure_requests;
begin
  if auth.uid() is null then raise exception 'Authenticated actor is required'; end if;
  select * into v_po from procurement.purchase_orders where id=p_purchase_order_id for update;
  if not found or v_po.status <> 'issued' then raise exception 'An issued purchase order is required'; end if;
  select * into v_state from procurement.purchase_order_lifecycle_state where purchase_order_id=p_purchase_order_id for update;
  if not found then raise exception 'PO lifecycle is missing; refresh after governed issue'; end if;
  if p_expected_revision <> v_state.revision then
    select * into v_event from procurement.purchase_order_lifecycle_events where purchase_order_id=p_purchase_order_id and event_type=p_event_type and expected_revision=p_expected_revision and actor_id=auth.uid() and evidence_reference is not distinct from nullif(pg_catalog.btrim(p_reference),'');
    if found then return private.policy_po_lifecycle_projection(p_purchase_order_id) || jsonb_build_object('replayed',true); end if;
    raise exception 'The PO lifecycle changed; refresh before retrying';
  end if;
  if nullif(pg_catalog.btrim(p_reference),'') is null then raise exception 'A governed evidence reference is required'; end if;
  if p_event_type='vendor_acknowledged' then
    if core.current_vendor_id()::text <> v_po.core_vendor_id::text then raise exception 'Only the awarded vendor may acknowledge this PO'; end if;
    update procurement.purchase_order_lifecycle_state set acknowledged_at=statement_timestamp(),acknowledgement_reference=pg_catalog.btrim(p_reference),revision=revision+1,updated_at=statement_timestamp() where purchase_order_id=p_purchase_order_id returning * into v_state;
  elsif p_event_type='delivery_notice' then
    if not (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','admin')) then raise exception 'Procurement authority is required'; end if;
    update procurement.purchase_order_lifecycle_state set delivery_notice_at=statement_timestamp(),delivery_notice_reference=pg_catalog.btrim(p_reference),revision=revision+1,updated_at=statement_timestamp() where purchase_order_id=p_purchase_order_id returning * into v_state;
  elsif p_event_type='closed' then
    select * into v_request from procurement.purchase_order_closure_requests where id=(p_payload->>'closureRequestId')::uuid for update;
    if not found or v_request.status <> 'approved' or v_request.decided_by <> auth.uid() or v_request.purchase_order_id <> p_purchase_order_id then raise exception 'Approved independent closure request is required'; end if;
    update procurement.purchase_order_lifecycle_state set revision=revision+1,closed_at=statement_timestamp(),closed_by=auth.uid(),closure_reason=pg_catalog.btrim(p_reference),closure_status='closed',updated_at=statement_timestamp() where purchase_order_id=p_purchase_order_id returning * into v_state;
    update procurement.purchase_orders set status='closed',updated_at=statement_timestamp() where id=p_purchase_order_id;
  else raise exception 'Unsupported PO lifecycle event'; end if;
  insert into procurement.purchase_order_lifecycle_events(purchase_order_id,event_type,expected_revision,resulting_revision,actor_id,evidence_reference,payload) values(p_purchase_order_id,p_event_type,p_expected_revision,v_state.revision,auth.uid(),pg_catalog.btrim(p_reference),coalesce(p_payload,'{}'::jsonb));
  return private.policy_po_lifecycle_projection(p_purchase_order_id) || jsonb_build_object('replayed',false);
end;
$$;
revoke all on function private.policy_po_lifecycle_transition(text,integer,text,text,jsonb) from public, anon, authenticated;

create or replace function procurement.purchase_order_lifecycle(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_po procurement.purchase_orders;
begin
  select * into v_po from procurement.purchase_orders where id=payload->>'purchase_order_id';
  if not found then raise exception 'Purchase order not found'; end if;
  if not (
    core.has_live_cap('procurement','author_po')
    or core.has_live_cap('procurement','view_dashboard')
    or core.has_live_cap('procurement','admin')
    or (
      core.current_vendor_id() is not null
      and core.current_vendor_id()::text = v_po.core_vendor_id::text
    )
  ) then raise exception 'Not authorized to view PO lifecycle'; end if;
  return private.policy_po_lifecycle_projection(v_po.id) || jsonb_build_object('purchaseOrderId',v_po.id,'issuedAt',v_po.issued_at);
end;
$$;

create or replace function procurement.review_open_purchase_orders(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','view_dashboard') or core.has_live_cap('procurement','admin')) then raise exception 'Procurement monitoring authority is required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',state.purchase_order_id||':weekly','purchaseOrderId',state.purchase_order_id,'kind',case when state.acknowledged_at is null and statement_timestamp()>=state.sent_at+interval '48 hours' then 'vendor_acknowledgement_overdue' when state.acknowledged_at is null and statement_timestamp()>=state.sent_at+interval '47 hours' then 'vendor_acknowledgement_due_soon' when receipt.rejected_or_quarantined_quantity>0 then 'quality_recovery' when receipt.outstanding_quantity>0 then 'open_receipt' else 'open_po' end,'owner','Procurement','dueAt',state.acknowledgement_due_at,'ageHours',floor(extract(epoch from statement_timestamp()-state.sent_at)/3600),'lastNoticeAt',state.delivery_notice_at,'nextAction',case when state.acknowledged_at is null and statement_timestamp()>=state.sent_at+interval '48 hours' then 'Escalate vendor acknowledgement' when state.acknowledged_at is null and statement_timestamp()>=state.sent_at+interval '47 hours' then 'Prepare vendor acknowledgement escalation' when receipt.rejected_or_quarantined_quantity>0 then 'Maintain vendor notice, RMA, credit, and payment hold' when receipt.outstanding_quantity>0 then 'Confirm delivery and receiving handoff' else 'Request governed closure' end)) from procurement.purchase_order_lifecycle_state state join procurement.purchase_orders po on po.id=state.purchase_order_id left join procurement.v_purchase_order_receipt_status receipt on receipt.purchase_order_id::text=po.id where po.status='issued'),'[]'::jsonb);
end;
$$;

create or replace function procurement.request_purchase_order_closure(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_state procurement.purchase_order_lifecycle_state; v_request procurement.purchase_order_closure_requests; v_reason text:=nullif(pg_catalog.btrim(payload->>'closure_reason'),''); v_expected integer;
begin
  if auth.uid() is null or not (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','admin')) then raise exception 'Procurement closure authority is required'; end if;
  begin v_expected := (payload->>'expected_revision')::integer; exception when others then raise exception 'expected_revision is required'; end;
  if v_reason is null then raise exception 'A governed closure reason is required'; end if;
  select * into v_state from procurement.purchase_order_lifecycle_state where purchase_order_id=payload->>'purchase_order_id' for update;
  if not found or v_state.revision<>v_expected then raise exception 'The PO lifecycle changed; refresh before closure'; end if;
  select * into v_request from procurement.purchase_order_closure_requests where purchase_order_id=payload->>'purchase_order_id' and expected_revision=v_expected and requested_by=auth.uid() order by requested_at desc limit 1 for update;
  if found then
    if v_request.closure_reason <> v_reason then raise exception 'Closure reason changed; refresh and submit a new governed request'; end if;
    return to_jsonb(v_request)||jsonb_build_object('replayed',true);
  end if;
  insert into procurement.purchase_order_closure_requests(purchase_order_id,expected_revision,closure_reason,requested_by) values(payload->>'purchase_order_id',v_expected,v_reason,auth.uid()) returning * into v_request;
  return to_jsonb(v_request)||jsonb_build_object('replayed',false);
end;
$$;

create or replace function procurement.approve_purchase_order_closure(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_request procurement.purchase_order_closure_requests; v_po procurement.purchase_orders; v_state procurement.purchase_order_lifecycle_state; v_terminal jsonb;
begin
  if auth.uid() is null or not (core.has_live_cap('procurement','final_approve_po') or core.has_live_cap('procurement','admin')) then raise exception 'Independent PO closure approver authority is required'; end if;
  select * into v_request from procurement.purchase_order_closure_requests where id=(payload->>'closure_request_id')::uuid for update;
  if not found then raise exception 'Closure request not found'; end if;
  if v_request.status='approved' and v_request.decided_by=auth.uid() then return jsonb_build_object('closureRequestId',v_request.id,'approved',true,'replayed',true); end if;
  if v_request.status<>'pending' then raise exception 'A pending closure request is required'; end if;
  if v_request.requested_by=auth.uid() then raise exception 'Closure maker and checker must be different actors'; end if;
  select * into v_po from procurement.purchase_orders where id=v_request.purchase_order_id for update;
  select * into v_state from procurement.purchase_order_lifecycle_state where purchase_order_id=v_po.id for update;
  if not found or v_state.revision<>v_request.expected_revision then raise exception 'The PO lifecycle changed; refresh before closure approval'; end if;
  if exists(select 1 from procurement.v_purchase_order_receipt_status r where r.purchase_order_id::text=v_po.id and (coalesce(r.outstanding_quantity,0)>0 or coalesce(r.rejected_or_quarantined_quantity,0)>0)) or not exists(select 1 from procurement.acceptance_packs p where p.purchase_order_id=v_po.id and p.status='accepted' and coalesce(jsonb_array_length(p.exceptions),0)=0) or v_state.quality_recovery_status not in ('none','resolved') or exists(select 1 from procurement.payment_readiness_packs p where p.purchase_order_id=v_po.id and p.status not in ('released','superseded')) then raise exception 'Closure is blocked by receipt, acceptance, quality, quarantine, replacement, RMA, credit, payment hold, or unpaid Finance state'; end if;
  update procurement.purchase_order_closure_requests set status='approved',decided_by=auth.uid(),decided_at=statement_timestamp() where id=v_request.id;
  v_terminal:=private.policy_po_lifecycle_transition(v_po.id,v_state.revision,'closed',v_request.closure_reason,jsonb_build_object('closureRequestId',v_request.id));
  return v_terminal || jsonb_build_object('closureRequestId',v_request.id,'approved',true,'replayed',false);
end;
$$;

create or replace function procurement.close_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$ begin raise exception 'Direct closure is retired; request governed closure'; end; $$;
revoke all on function procurement.close_purchase_order(jsonb) from public, anon, authenticated, service_role;
revoke all on function procurement.purchase_order_lifecycle(jsonb), procurement.review_open_purchase_orders(jsonb), procurement.request_purchase_order_closure(jsonb), procurement.approve_purchase_order_closure(jsonb), procurement.purchase_order_closure_work_items(jsonb) from public, anon;
grant execute on function procurement.purchase_order_lifecycle(jsonb), procurement.review_open_purchase_orders(jsonb), procurement.request_purchase_order_closure(jsonb), procurement.approve_purchase_order_closure(jsonb), procurement.purchase_order_closure_work_items(jsonb) to authenticated;

create or replace function procurement.commitment_readiness(payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_requester_id uuid; v_readiness jsonb; v_requirement jsonb;
begin
  select requester_id into v_requester_id from procurement.requests where id=payload->>'request_id';
  if v_requester_id is null then raise exception 'Procurement request not found'; end if;
  if auth.uid()<>v_requester_id and not core.has_live_cap('procurement','view_dashboard') and not core.has_live_cap('procurement','author_po') and not core.has_live_cap('procurement','approve_award') then raise exception 'Not authorized to view commitment readiness'; end if;
  v_readiness:=private.procurement_commitment_readiness(payload->>'request_id',nullif(payload->>'vendor_id','')::uuid,coalesce(nullif(payload->>'phase',''),'issue'));
  v_requirement:=coalesce((select jsonb_agg(jsonb_build_object('kind',coalesce(item->>'controlCode','required_control'),'label',coalesce(item->>'controlCode','Required control'),'status',case when item->>'reviewStatus'='approved' then 'present' else 'missing' end,'basis',coalesce(v_readiness->>'route','policy route'),'source','Governed policy evidence','owner','Procurement','recovery',case when item->>'reviewStatus'='approved' then 'No action required.' else 'Provide current approved evidence before issue.' end)) from jsonb_array_elements(coalesce(v_readiness->'evidence','[]'::jsonb)) item),'[]'::jsonb) || coalesce((select jsonb_agg(jsonb_build_object('kind','blocker:'||replace(value,' ','_'),'label',value,'status','missing','basis',coalesce(v_readiness->>'route','policy route'),'source','Server commitment predicate','owner','Procurement','recovery','Resolve this server-derived blocker before issue.')) from jsonb_array_elements_text(coalesce(v_readiness->'blockers','[]'::jsonb)) value),'[]'::jsonb);
  return v_readiness || jsonb_build_object('requirements',v_requirement,'canRecordAcceptance',auth.uid()=v_requester_id or exists(select 1 from procurement.acceptance_reviewer_assignments assignment where assignment.request_id=payload->>'request_id' and assignment.reviewer_id=auth.uid() and assignment.superseded_at is null));
end;
$$;
revoke all on function procurement.commitment_readiness(jsonb) from public, anon;
grant execute on function procurement.commitment_readiness(jsonb) to authenticated, service_role;

create or replace function private.policy_exception_award_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_request procurement.requests; v_profile procurement.policy_profiles; v_blockers text[];
begin
  if new.status = 'awarded' and old.status is distinct from 'awarded' then
    select * into v_request from procurement.requests where id = new.request_id;
    if v_request.procurement_mode <> 'competitive_bidding' then
      select * into v_profile from procurement.policy_profiles where id = v_request.policy_profile_id;
      v_blockers := private.policy_exception_pack_blockers(v_request.id::text, v_request.procurement_mode, v_profile, v_request.estimated_amount);
      if cardinality(v_blockers) > 0 then raise exception 'Exception evidence is incomplete before award: %', array_to_string(v_blockers, ', '); end if;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists policy_exception_award_guard on procurement.sourcing_events;
create trigger policy_exception_award_guard before update on procurement.sourcing_events for each row execute function private.policy_exception_award_guard();

create or replace function private.policy_exception_po_issue_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_request procurement.requests; v_profile procurement.policy_profiles; v_blockers text[];
begin
  if new.status = 'issued' and old.status is distinct from 'issued' then
    select * into v_request from procurement.requests where id = new.request_id;
    if v_request.procurement_mode <> 'competitive_bidding' then
      select * into v_profile from procurement.policy_profiles where id = v_request.policy_profile_id;
      v_blockers := private.policy_exception_pack_blockers(v_request.id::text, v_request.procurement_mode, v_profile, v_request.estimated_amount);
      if cardinality(v_blockers) > 0 then raise exception 'Exception evidence is incomplete before PO issue: %', array_to_string(v_blockers, ', '); end if;
    end if;
  end if;
  return new;
end;
$$;
do $$
begin
  -- PGlite contract fixtures intentionally omit the PO table. In a deployed
  -- application schema the guard is installed on the governed table.
  if to_regclass('procurement.purchase_orders') is not null then
    execute 'drop trigger if exists policy_exception_po_issue_guard on procurement.purchase_orders';
    execute 'create trigger policy_exception_po_issue_guard before update on procurement.purchase_orders for each row execute function private.policy_exception_po_issue_guard()';
  end if;
end;
$$;

revoke all on function private.policy_exception_pack_blockers(text,text,procurement.policy_profiles,numeric), private.policy_exception_award_guard(), private.policy_exception_po_issue_guard(), private.policy_route_exception_is_eligible(text,text,procurement.policy_profiles,numeric) from public, anon, authenticated;
revoke all on function procurement.submit_policy_exception_pack(jsonb), procurement.review_policy_exception_pack(jsonb) from public, anon;
grant execute on function procurement.submit_policy_exception_pack(jsonb), procurement.review_policy_exception_pack(jsonb) to authenticated, service_role;

revoke all on function procurement.evaluation_workspace(jsonb) from public, anon;
grant execute on function procurement.evaluation_workspace(jsonb) to authenticated, service_role;

-- Task 8 strict review remediation -------------------------------------------------
-- A requester may author evidence, but never authoritative eligibility or review
-- state. The immutable binding below makes a reviewed pack unusable when the
-- request, route version, effective profile, or referenced transaction changes.
alter table procurement.exception_packs
  add column if not exists mode text,
  add column if not exists submitted_by uuid references core.profiles(id) on delete restrict,
  add column if not exists submitted_at timestamptz,
  add column if not exists request_version integer,
  add column if not exists policy_profile_id uuid references procurement.policy_profiles(id) on delete restrict,
  add column if not exists route_decision_id uuid references procurement.route_decisions(id) on delete restrict,
  add column if not exists request_fingerprint text,
  add column if not exists evidence_fingerprint text,
  add column if not exists immutable_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists revision integer not null default 1,
  add column if not exists approved_exception_source_id uuid references procurement.exception_packs(id) on delete restrict;

alter table procurement.exception_packs
  drop constraint if exists procurement_exception_pack_mode_check,
  add constraint procurement_exception_pack_mode_check check (
    mode is null or mode in ('sole_source','repeat_order','emergency_purchase','petty_cash','approved_exception')
  ),
  drop constraint if exists procurement_exception_pack_revision_check,
  add constraint procurement_exception_pack_revision_check check (revision > 0);

create index if not exists exception_packs_governed_binding_idx
  on procurement.exception_packs(request_id, status, mode, request_version desc, revision desc);

create table if not exists procurement.exception_pack_reviews (
  id uuid primary key default gen_random_uuid(),
  exception_pack_id uuid not null references procurement.exception_packs(id) on delete restrict,
  stage text not null check (stage in ('procurement','finance')),
  decision text not null check (decision in ('approved','rejected')),
  rationale text not null check (nullif(pg_catalog.btrim(rationale), '') is not null),
  decided_by uuid not null references core.profiles(id) on delete restrict,
  expected_revision integer not null,
  decided_at timestamptz not null default statement_timestamp(),
  unique(exception_pack_id, stage)
);
alter table procurement.exception_pack_reviews enable row level security;
alter table procurement.exception_pack_reviews force row level security;
revoke all on procurement.exception_pack_reviews from public, anon, authenticated;
grant select on procurement.exception_pack_reviews to authenticated;
grant all on procurement.exception_pack_reviews to service_role;

alter table procurement.exception_doa_decisions
  add column if not exists expected_revision integer,
  add column if not exists pack_revision integer;

create or replace function private.policy_exception_active_profile()
returns procurement.policy_profiles
language plpgsql stable security definer set search_path = '' as $$
declare v_profile procurement.policy_profiles;
begin
  select * into v_profile from procurement.policy_profiles
  where relationship = 'mwell_operating' and status = 'active'
    and effective_from <= statement_timestamp()
    and (effective_to is null or effective_to > statement_timestamp())
  order by effective_from desc limit 1;
  if not found then raise exception 'An effective operating policy profile is required'; end if;
  return v_profile;
end;
$$;

create or replace function private.policy_exception_request_fingerprint(
  p_request procurement.requests,
  p_mode text,
  p_profile_id uuid,
  p_request_version integer
)
returns text
language sql immutable security definer set search_path = '' as $$
  select md5(jsonb_build_object(
    'requestId', p_request.id::text,
    'mode', p_mode,
    'profileId', p_profile_id,
    'requestVersion', p_request_version,
    'amount', coalesce(p_request.estimated_amount, 0),
    'vendorId', p_request.core_vendor_id,
    'lines', coalesce(p_request.lines, '[]'::jsonb),
    'scope', coalesce(p_request.solicitation_requirements, '{}'::jsonb),
    'category', p_request.category,
    'department', p_request.department
  )::text)
$$;

create or replace function private.policy_exception_evidence_fingerprint(p_evidence jsonb)
returns text language sql immutable security definer set search_path = '' as $$
  select md5(coalesce(p_evidence, '{}'::jsonb)::text)
$$;

create or replace function private.policy_exception_repeat_snapshot(
  p_request procurement.requests,
  p_evidence jsonb,
  p_profile procurement.policy_profiles
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_prior_request procurement.requests;
  v_event procurement.sourcing_events;
  v_award procurement.award_recommendations;
  v_po record;
  v_request_id text := nullif(pg_catalog.btrim(p_evidence->>'priorRequestId'), '');
  v_event_id uuid;
  v_award_id uuid;
  v_po_id text := nullif(pg_catalog.btrim(p_evidence->>'priorPurchaseOrderId'), '');
  v_award_at timestamptz;
  v_terms_same boolean;
  v_scope_same boolean;
  v_considerations_same boolean;
begin
  begin v_event_id := (p_evidence->>'priorSourcingEventId')::uuid; exception when invalid_text_representation then raise exception 'Prior sourcing event reference is invalid'; end;
  begin v_award_id := (p_evidence->>'priorAwardId')::uuid; exception when invalid_text_representation then raise exception 'Prior award reference is invalid'; end;
  if v_request_id is null or v_po_id is null then raise exception 'Prior request, sourcing event, award, and PO references are required'; end if;

  select * into v_prior_request from procurement.requests where id::text = v_request_id for share;
  if not found then raise exception 'Prior request was not found'; end if;
  select * into v_event from procurement.sourcing_events where id = v_event_id for share;
  if not found or v_event.request_id::text <> v_prior_request.id::text then raise exception 'Prior sourcing event is not linked to the prior request'; end if;
  select * into v_award from procurement.award_recommendations where id = v_award_id for share;
  if not found or v_award.sourcing_event_id <> v_event.id or v_award.status <> 'approved' then raise exception 'Prior competitive award is not approved for the referenced sourcing event'; end if;
  if v_event.status <> 'awarded' then raise exception 'Prior sourcing event was not competitively awarded'; end if;
  select po.* into v_po from procurement.purchase_orders po where po.id::text = v_po_id for share;
  if not found or v_po.request_id::text <> v_prior_request.id::text then raise exception 'Prior PO is not linked to the prior request'; end if;
  if v_po.status not in ('issued', 'closed') then raise exception 'Prior repeat-order PO must be issued or closed'; end if;
  if v_award.recommended_vendor_id <> v_po.core_vendor_id or v_po.core_vendor_id is distinct from p_request.core_vendor_id then raise exception 'Repeat order must use the same awarded vendor'; end if;
  v_award_at := coalesce(v_event.closed_at, v_event.created_at);
  if v_award_at < statement_timestamp() - make_interval(days => p_profile.repeat_order_max_age_days) then raise exception 'Prior competitive award is older than the active policy limit'; end if;
  if coalesce(p_request.estimated_amount, 0) > p_profile.repeat_order_max_amount then raise exception 'Repeat amount exceeds the active policy limit'; end if;
  v_terms_same := coalesce(p_request.solicitation_requirements->>'paymentTerms','') = coalesce(v_prior_request.solicitation_requirements->>'paymentTerms','')
    and coalesce(p_request.solicitation_requirements->>'deliveryTerms','') = coalesce(v_prior_request.solicitation_requirements->>'deliveryTerms','')
    and coalesce(p_request.solicitation_requirements->>'shippingTerms','') = coalesce(v_prior_request.solicitation_requirements->>'shippingTerms','');
  v_scope_same := coalesce(p_request.lines, '[]'::jsonb) = coalesce(v_prior_request.lines, '[]'::jsonb);
  v_considerations_same := coalesce(p_request.category,'') = coalesce(v_prior_request.category,'')
    and coalesce(p_request.department,'') = coalesce(v_prior_request.department,'')
    and coalesce(p_request.cost_center,'') = coalesce(v_prior_request.cost_center,'');
  if not v_terms_same then raise exception 'Repeat order terms differ from the competitively awarded source'; end if;
  if not v_scope_same then raise exception 'Repeat order scope differs from the competitively awarded source'; end if;
  if not v_considerations_same then raise exception 'Repeat order commercial considerations differ from the competitively awarded source'; end if;
  if coalesce(p_request.estimated_amount, 0) <> coalesce(v_po.total, 0) then raise exception 'Repeat order price differs from the prior PO'; end if;
  return jsonb_build_object(
    'priorRequestId', v_prior_request.id, 'priorSourcingEventId', v_event.id,
    'priorAwardId', v_award.id, 'priorPurchaseOrderId', v_po.id,
    'awardAt', v_award_at, 'vendorId', v_po.core_vendor_id, 'amount', v_po.total,
    'samePrice', true, 'sameTerms', true, 'sameVendor', true,
    'sameConsiderations', true, 'materialScopeChange', false, 'competitiveAward', true
  );
end;
$$;

create or replace function private.policy_exception_submission_snapshot(
  p_request procurement.requests,
  p_mode text,
  p_evidence jsonb,
  p_profile procurement.policy_profiles
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_source procurement.exception_packs;
  v_commitment timestamptz;
  v_due timestamptz;
  v_max_retro_window interval := interval '30 days';
begin
  if p_mode = 'sole_source' then
    if coalesce(p_evidence->>'soleSourceBasis','') not in ('only_acceptable_source','compatibility','specialization','unique_capability','manufacturer','authorized_distributor') then raise exception 'An evidence-backed sole-source basis is required'; end if;
    if jsonb_typeof(p_evidence->'evidenceReferences') <> 'array' or jsonb_array_length(p_evidence->'evidenceReferences') = 0 then raise exception 'Sole-source evidence references are required'; end if;
  elsif p_mode = 'repeat_order' then
    return jsonb_build_object('repeatOrder', private.policy_exception_repeat_snapshot(p_request, p_evidence, p_profile));
  elsif p_mode = 'emergency_purchase' then
    if coalesce(p_evidence->>'emergencyBasis','') not in ('life_safety','environmental','serious_disruption') then raise exception 'A qualifying emergency basis is required'; end if;
    if nullif(pg_catalog.btrim(p_evidence->>'authorityReference'),'') is null then raise exception 'Emergency authority evidence is required'; end if;
    if coalesce((p_evidence->>'minimizedVerbalCommitment')::boolean, false) is not true then raise exception 'Minimized verbal commitment must be recorded'; end if;
    begin v_commitment := (p_evidence->>'commitmentTimestamp')::timestamptz; exception when others then raise exception 'Emergency commitment timestamp is invalid'; end;
    begin v_due := (p_evidence->>'retrospectivePoDueAt')::timestamptz; exception when others then raise exception 'Retrospective PO due date is invalid'; end;
    if v_commitment >= v_due then raise exception 'Retrospective PO due date must be after the emergency commitment'; end if;
    if v_due > v_commitment + v_max_retro_window then raise exception 'Retrospective PO due date exceeds the 30-day policy window'; end if;
    return jsonb_build_object('emergency', jsonb_build_object('basis',p_evidence->>'emergencyBasis','authorityReference',p_evidence->>'authorityReference','commitmentAt',v_commitment,'retrospectivePoDueAt',v_due,'policyWindowDays',30));
  elsif p_mode = 'petty_cash' then
    if coalesce(p_request.estimated_amount,0) > p_profile.petty_cash_max_amount then raise exception 'Petty-cash amount exceeds the active policy limit'; end if;
    if coalesce((p_evidence->>'splitPurchase')::boolean,false) or coalesce((p_evidence->>'recurring')::boolean,false) then raise exception 'Split or recurring purchases are not eligible for petty cash'; end if;
    if coalesce((p_evidence->>'receiptPresent')::boolean,false) is not true or coalesce((p_evidence->>'liquidationRecorded')::boolean,false) is not true then raise exception 'Petty cash requires receipt or invoice evidence and liquidation'; end if;
  elsif p_mode = 'approved_exception' then
    begin select * into v_source from procurement.exception_packs where id = (p_evidence->>'approvedExceptionPackId')::uuid for share; exception when invalid_text_representation then raise exception 'Approved exception reference is invalid'; end;
    if not found or v_source.status <> 'approved' or v_source.immutable_snapshot = '{}'::jsonb or v_source.request_fingerprint is null then raise exception 'Approved exception must reference an immutable approved eligible pack'; end if;
    if v_source.id::text = coalesce(p_evidence->>'currentPackId','') then raise exception 'An exception pack cannot approve itself'; end if;
    return jsonb_build_object('approvedExceptionSourceId', v_source.id, 'approvedExceptionSourceRevision', v_source.revision);
  else raise exception 'Unsupported exception mode'; end if;
  return jsonb_build_object(
    'mode', p_mode,
    'requestId', p_request.id,
    'amount', coalesce(p_request.estimated_amount, 0),
    'vendorId', p_request.core_vendor_id,
    'evidenceFingerprint', private.policy_exception_evidence_fingerprint(p_evidence)
  );
end;
$$;

create or replace function private.policy_exception_pack_blockers(
  p_request_id text,
  p_mode text,
  p_profile procurement.policy_profiles,
  p_amount numeric
)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare v_pack procurement.exception_packs; v_request procurement.requests; v_blockers text[] := '{}'; v_fingerprint text; v_finance_required boolean;
begin
  if p_mode = 'competitive_bidding' then return v_blockers; end if;
  select * into v_request from procurement.requests where id::text = p_request_id;
  if not found then return array['request_not_found']; end if;
  select * into v_pack from procurement.exception_packs
  where request_id::text = p_request_id and mode = p_mode and status = 'approved'
  order by revision desc, submitted_at desc nulls last limit 1;
  if not found then return array['approved_exception_pack_required']; end if;
  if v_pack.policy_profile_id is distinct from p_profile.id then v_blockers := array_append(v_blockers, 'policy_profile_changed_restart_exception'); end if;
  if v_pack.request_version is distinct from v_request.route_version then v_blockers := array_append(v_blockers, 'request_route_changed_restart_exception'); end if;
  v_fingerprint := private.policy_exception_request_fingerprint(v_request, p_mode, p_profile.id, v_request.route_version);
  if v_pack.request_fingerprint is distinct from v_fingerprint then v_blockers := array_append(v_blockers, 'request_evidence_changed_restart_exception'); end if;
  if v_pack.submitted_by is null or v_pack.procurement_head_reviewed_by is null then v_blockers := array_append(v_blockers, 'independent_procurement_review_required'); end if;
  v_finance_required := p_mode = 'petty_cash';
  if v_finance_required and not exists(select 1 from procurement.exception_pack_reviews review where review.exception_pack_id=v_pack.id and review.stage='finance' and review.decision='approved') then v_blockers := array_append(v_blockers, 'independent_finance_review_required'); end if;
  if not exists(select 1 from procurement.exception_doa_decisions decision where decision.exception_pack_id=v_pack.id and decision.decision='approved') then v_blockers := array_append(v_blockers, 'active_doa_approval_required'); end if;
  return v_blockers;
end;
$$;

create or replace function procurement.submit_policy_exception_pack(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_request procurement.requests; v_pack procurement.exception_packs; v_mode text := payload->>'mode'; v_type text; v_profile procurement.policy_profiles; v_snapshot jsonb; v_evidence jsonb; v_expected_version integer; v_fingerprint text;
begin
  if auth.uid() is null or not private.policy_sourcing_can_manage() then raise exception 'Procurement authority is required to submit an exception pack'; end if;
  select * into v_request from procurement.requests where id::text = payload->>'request_id' for update;
  if not found or v_request.status <> 'draft' then raise exception 'A draft request is required'; end if;
  if v_mode not in ('sole_source','repeat_order','emergency_purchase','petty_cash','approved_exception') then raise exception 'Unsupported exception mode'; end if;
  begin v_expected_version := (payload->>'expected_route_version')::integer; exception when others then raise exception 'expected_route_version is required'; end;
  if v_expected_version <> v_request.route_version then raise exception 'The request route changed; refresh before submitting exception evidence'; end if;
  v_profile := private.policy_exception_active_profile();
  v_evidence := coalesce(payload->'evidence','{}'::jsonb) - 'procurementReviewed' - 'financeReviewed' - 'doaApproved' - 'samePrice' - 'sameTerms' - 'sameVendor' - 'sameConsiderations' - 'priorCompetitiveAward' - 'priorAwardAgeDays' - 'materialScopeChange';
  v_snapshot := private.policy_exception_submission_snapshot(v_request, v_mode, v_evidence, v_profile);
  v_fingerprint := private.policy_exception_request_fingerprint(v_request,v_mode,v_profile.id,v_request.route_version);
  v_type := case v_mode when 'sole_source' then 'direct_award' when 'repeat_order' then 'repeat_continuity' when 'emergency_purchase' then 'emergency' when 'petty_cash' then 'petty_cash_non_accredited' else 'direct_award' end;
  update procurement.exception_packs set status='superseded', revision=revision+1 where request_id::text=v_request.id::text and status in ('draft','under_review','rejected','approved');
  insert into procurement.exception_packs(request_id,exception_type,mode,justification,evidence,price_reasonableness,status,submitted_by,submitted_at,request_version,policy_profile_id,request_fingerprint,evidence_fingerprint,immutable_snapshot,approved_exception_source_id)
  values(v_request.id,v_type,v_mode,coalesce(nullif(btrim(payload->>'justification'),''),'Pending policy exception evidence'),v_evidence,nullif(btrim(payload->>'price_reasonableness'),''),'under_review',auth.uid(),statement_timestamp(),v_request.route_version,v_profile.id,v_fingerprint,private.policy_exception_evidence_fingerprint(v_evidence),v_snapshot,case when v_mode='approved_exception' then (v_snapshot->>'approvedExceptionSourceId')::uuid else null end)
  returning * into v_pack;
  return to_jsonb(v_pack);
end;
$$;

-- Task 9 fix round 2: vendor-safe acknowledgement list and payment release
-- deliberately leave an issued PO open for the independent closure workflow.
create or replace function procurement.vendor_purchase_order_acknowledgements(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or core.current_vendor_id() is null then raise exception 'Vendor session is required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',po.id,'poNumber',po.po_number,'vendorName',po.vendor_name,'lifecycle',private.policy_po_lifecycle_projection(po.id)) order by po.issued_at desc) from procurement.purchase_orders po where po.status='issued' and po.core_vendor_id=core.current_vendor_id()),'[]'::jsonb);
end;
$$;

create or replace function procurement.release_payment(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_pack procurement.payment_readiness_packs; v_release procurement.payment_releases; v_total numeric;
begin
 if not core.has_live_cap('procurement','view_finance') and not core.has_live_cap('procurement','admin') then raise exception 'Not authorized to release payment'; end if;
 select * into v_pack from procurement.payment_readiness_packs where id=(payload->>'payment_readiness_pack_id')::uuid for update;
 if not found or v_pack.status<>'accepted' then raise exception 'Finance acceptance is required before release'; end if;
 if (payload->>'amount')::numeric<=0 or (payload->>'amount')::numeric>v_pack.invoice_amount-v_pack.released_amount then raise exception 'Release amount exceeds the unpaid invoice balance'; end if;
 if nullif(trim(payload->>'payment_reference'),'') is null or nullif(payload->>'paid_at','') is null then raise exception 'Payment reference and date are required'; end if;
 insert into procurement.payment_releases(payment_readiness_pack_id,purchase_order_id,amount,payment_reference,payment_method,paid_at) values(v_pack.id,v_pack.purchase_order_id,(payload->>'amount')::numeric,payload->>'payment_reference',payload->>'payment_method',(payload->>'paid_at')::date) returning * into v_release;
 select coalesce(sum(amount),0) into v_total from procurement.payment_releases where payment_readiness_pack_id=v_pack.id and status='posted';
 update procurement.payment_readiness_packs set released_amount=v_total,status=case when v_total>=invoice_amount then 'released' else 'accepted' end where id=v_pack.id returning * into v_pack;
 return jsonb_build_object('pack',to_jsonb(v_pack),'release',to_jsonb(v_release),'closureRequired',v_pack.status='released');
end;
$$;
revoke all on function procurement.vendor_purchase_order_acknowledgements(jsonb), procurement.release_payment(jsonb) from public, anon;
grant execute on function procurement.vendor_purchase_order_acknowledgements(jsonb), procurement.release_payment(jsonb) to authenticated;

create or replace function procurement.review_policy_exception_pack(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pack procurement.exception_packs; v_request procurement.requests; v_profile procurement.policy_profiles; v_assignment procurement.doa_assignments; v_stage text:=payload->>'stage'; v_decision text:=payload->>'decision'; v_expected integer; v_prior_actor uuid; v_existing procurement.exception_pack_reviews; v_fingerprint text;
begin
  if auth.uid() is null then raise exception 'Authenticated reviewer is required'; end if;
  begin v_expected := (payload->>'expected_revision')::integer; exception when others then raise exception 'expected_revision is required'; end;
  select * into v_pack from procurement.exception_packs where id=(payload->>'id')::uuid for update;
  if not found then raise exception 'Exception pack not found'; end if;
  if v_decision not in ('approved','rejected') or nullif(btrim(payload->>'note'),'') is null then raise exception 'A decision and review note are required'; end if;
  if v_expected <> v_pack.revision then
    if v_stage in ('procurement','finance') then select * into v_existing from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage=v_stage; if found and v_existing.expected_revision=v_expected and v_existing.decided_by=auth.uid() and v_existing.decision=v_decision and v_existing.rationale=btrim(payload->>'note') then return to_jsonb(v_pack); end if; end if;
    if v_stage='doa' and exists(select 1 from procurement.exception_doa_decisions where exception_pack_id=v_pack.id and expected_revision=v_expected and decided_by=auth.uid() and decision=v_decision and rationale=btrim(payload->>'note')) then return to_jsonb(v_pack); end if;
    raise exception 'The exception pack changed; refresh before deciding';
  end if;
  if v_pack.status <> 'under_review' then raise exception 'An exception awaiting review is required'; end if;
  select * into v_request from procurement.requests where id::text=v_pack.request_id::text for share;
  v_profile := private.policy_exception_active_profile();
  v_fingerprint := private.policy_exception_request_fingerprint(v_request,v_pack.mode,v_profile.id,v_request.route_version);
  if v_pack.policy_profile_id is distinct from v_profile.id or v_pack.request_version is distinct from v_request.route_version or v_pack.request_fingerprint is distinct from v_fingerprint then
    update procurement.exception_packs set status='superseded',revision=revision+1 where id=v_pack.id returning * into v_pack;
    raise exception 'The request, route, or policy changed; submit a new exception pack';
  end if;
  if v_stage='procurement' then
    if not private.policy_sourcing_can_review() then raise exception 'Independent Procurement reviewer authority is required'; end if;
    if auth.uid()=v_pack.submitted_by then raise exception 'Submitter cannot review the same exception'; end if;
    if exists(select 1 from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='procurement') then raise exception 'Procurement review was already recorded'; end if;
    insert into procurement.exception_pack_reviews(exception_pack_id,stage,decision,rationale,decided_by,expected_revision) values(v_pack.id,v_stage,v_decision,btrim(payload->>'note'),auth.uid(),v_expected);
    update procurement.exception_packs set procurement_head_reviewed_by=auth.uid(),procurement_head_reviewed_at=statement_timestamp(),status=case when v_decision='rejected' then 'rejected' else 'under_review' end,revision=revision+1 where id=v_pack.id returning * into v_pack;
  elsif v_stage='finance' then
    if v_pack.mode <> 'petty_cash' then raise exception 'Finance eligibility applies only to petty cash'; end if;
    if not (core.has_live_cap('procurement','view_finance') or core.has_live_cap('procurement','admin')) then raise exception 'Finance authority is required'; end if;
    select decided_by into v_prior_actor from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='procurement';
    if v_prior_actor is null then raise exception 'Independent Procurement review is required before Finance'; end if;
    if auth.uid() in (v_pack.submitted_by,v_prior_actor) then raise exception 'Finance reviewer must be independent from submitter and Procurement reviewer'; end if;
    if exists(select 1 from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='finance') then raise exception 'Finance review was already recorded'; end if;
    insert into procurement.exception_pack_reviews(exception_pack_id,stage,decision,rationale,decided_by,expected_revision) values(v_pack.id,v_stage,v_decision,btrim(payload->>'note'),auth.uid(),v_expected);
    update procurement.exception_packs set status=case when v_decision='rejected' then 'rejected' else 'under_review' end,revision=revision+1 where id=v_pack.id returning * into v_pack;
  elsif v_stage='doa' then
    select decided_by into v_prior_actor from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='procurement';
    if v_prior_actor is null then raise exception 'Independent Procurement review is required before DOA'; end if;
    if v_pack.mode='petty_cash' and not exists(select 1 from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='finance' and decision='approved') then raise exception 'Independent Finance review is required before DOA'; end if;
    if auth.uid()=v_pack.submitted_by or auth.uid()=v_prior_actor or exists(select 1 from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='finance' and decided_by=auth.uid()) then raise exception 'DOA actor must be independent from submitter and prior reviewers'; end if;
    v_assignment := private.policy_variance_doa_assignment(v_request,'final_approver');
    if exists(select 1 from procurement.exception_doa_decisions where exception_pack_id=v_pack.id) then raise exception 'DOA decision was already recorded'; end if;
    insert into procurement.exception_doa_decisions(exception_pack_id,decision,rationale,doa_matrix_id,doa_assignment_id,decided_by,expected_revision,pack_revision) values(v_pack.id,v_decision,btrim(payload->>'note'),v_assignment.matrix_id,v_assignment.id,auth.uid(),v_expected,v_expected);
    update procurement.exception_packs set status=case when v_decision='approved' then 'approved' else 'rejected' end,revision=revision+1 where id=v_pack.id returning * into v_pack;
  else raise exception 'Review stage must be procurement, finance, or doa'; end if;
  return to_jsonb(v_pack);
end;
$$;

-- Task 9 terminal override: must remain at physical migration end.
create or replace function private.policy_po_lifecycle_transition(p_purchase_order_id text,p_expected_revision integer,p_event_type text,p_reference text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_state procurement.purchase_order_lifecycle_state; v_po procurement.purchase_orders; v_event procurement.purchase_order_lifecycle_events; v_request procurement.purchase_order_closure_requests;
begin
 if auth.uid() is null then raise exception 'Authenticated actor is required'; end if;
 select * into v_po from procurement.purchase_orders where id=p_purchase_order_id for update;
 if not found or v_po.status<>'issued' then raise exception 'An issued purchase order is required'; end if;
 select * into v_state from procurement.purchase_order_lifecycle_state where purchase_order_id=p_purchase_order_id for update;
 if not found then raise exception 'PO lifecycle is missing; refresh after governed issue'; end if;
 if p_expected_revision<>v_state.revision then
   select * into v_event from procurement.purchase_order_lifecycle_events where purchase_order_id=p_purchase_order_id and event_type=p_event_type and expected_revision=p_expected_revision and actor_id=auth.uid() and evidence_reference is not distinct from nullif(pg_catalog.btrim(p_reference),'');
   if found then return private.policy_po_lifecycle_projection(p_purchase_order_id)||jsonb_build_object('replayed',true); end if;
   raise exception 'The PO lifecycle changed; refresh before retrying';
 end if;
 if nullif(pg_catalog.btrim(p_reference),'') is null then raise exception 'A governed evidence reference is required'; end if;
 if p_event_type='vendor_acknowledged' then
   if core.current_vendor_id()::text is distinct from v_po.core_vendor_id::text then raise exception 'Only the awarded vendor may acknowledge this PO'; end if;
   update procurement.purchase_order_lifecycle_state set acknowledged_at=statement_timestamp(),acknowledgement_reference=pg_catalog.btrim(p_reference),revision=revision+1,updated_at=statement_timestamp() where purchase_order_id=p_purchase_order_id returning * into v_state;
 elsif p_event_type='delivery_notice' then
   if not (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','admin')) then raise exception 'Procurement authority is required'; end if;
   update procurement.purchase_order_lifecycle_state set delivery_notice_at=statement_timestamp(),delivery_notice_reference=pg_catalog.btrim(p_reference),revision=revision+1,updated_at=statement_timestamp() where purchase_order_id=p_purchase_order_id returning * into v_state;
 elsif p_event_type='closed' then
   select * into v_request from procurement.purchase_order_closure_requests where id=(p_payload->>'closureRequestId')::uuid for update;
   if not found or v_request.status<>'approved' or v_request.decided_by<>auth.uid() or v_request.purchase_order_id<>p_purchase_order_id then raise exception 'Approved independent closure request is required'; end if;
   update procurement.purchase_order_lifecycle_state set revision=revision+1,closed_at=statement_timestamp(),closed_by=auth.uid(),closure_reason=pg_catalog.btrim(p_reference),closure_status='closed',updated_at=statement_timestamp() where purchase_order_id=p_purchase_order_id returning * into v_state;
   update procurement.purchase_orders set status='closed',updated_at=statement_timestamp() where id=p_purchase_order_id;
 else raise exception 'Unsupported PO lifecycle event'; end if;
 insert into procurement.purchase_order_lifecycle_events(purchase_order_id,event_type,expected_revision,resulting_revision,actor_id,evidence_reference,payload) values(p_purchase_order_id,p_event_type,p_expected_revision,v_state.revision,auth.uid(),pg_catalog.btrim(p_reference),coalesce(p_payload,'{}'::jsonb));
 return private.policy_po_lifecycle_projection(p_purchase_order_id)||jsonb_build_object('replayed',false);
end;
$$;
revoke all on function private.policy_po_lifecycle_transition(text,integer,text,text,jsonb) from public, anon, authenticated;

create or replace function procurement.review_open_purchase_orders(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 if not (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','view_dashboard') or core.has_live_cap('procurement','admin')) then raise exception 'Procurement monitoring authority is required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',state.purchase_order_id||':weekly','purchaseOrderId',state.purchase_order_id,'kind',case when state.acknowledged_at is null and statement_timestamp()>=state.sent_at+interval '48 hours' then 'vendor_acknowledgement_overdue' when state.acknowledged_at is null and statement_timestamp()>=state.sent_at+interval '47 hours' then 'vendor_acknowledgement_due_soon' when receipt.rejected_or_quarantined_quantity>0 then 'quality_recovery' when receipt.outstanding_quantity>0 then 'open_receipt' else 'open_po' end,'owner','Procurement','dueAt',state.acknowledgement_due_at,'ageHours',floor(extract(epoch from statement_timestamp()-state.sent_at)/3600),'lastNoticeAt',state.delivery_notice_at,'nextAction',case when state.acknowledged_at is null and statement_timestamp()>=state.sent_at+interval '48 hours' then 'Escalate vendor acknowledgement' when state.acknowledged_at is null and statement_timestamp()>=state.sent_at+interval '47 hours' then 'Prepare vendor acknowledgement escalation' when receipt.rejected_or_quarantined_quantity>0 then 'Maintain vendor notice, RMA, credit, and payment hold' when receipt.outstanding_quantity>0 then 'Confirm delivery and receiving handoff' else 'Request governed closure' end)) from procurement.purchase_order_lifecycle_state state join procurement.purchase_orders po on po.id=state.purchase_order_id left join procurement.v_purchase_order_receipt_status receipt on receipt.purchase_order_id::text=po.id where po.status='issued'),'[]'::jsonb);
end;
$$;
create or replace function procurement.close_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$ begin raise exception 'Direct closure is retired; request governed closure'; end; $$;
revoke all on function procurement.close_purchase_order(jsonb) from public, anon, authenticated, service_role;
revoke all on function procurement.review_open_purchase_orders(jsonb) from public, anon;
grant execute on function procurement.review_open_purchase_orders(jsonb) to authenticated;

create or replace function procurement.exception_workspace(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_request procurement.requests; v_profile procurement.policy_profiles; v_pack procurement.exception_packs; v_mode text; v_blockers text[]; v_assignment procurement.doa_assignments; v_can_view boolean; v_can_submit boolean; v_can_procurement boolean; v_can_finance boolean; v_can_doa boolean; v_history jsonb;
begin
  select * into v_request from procurement.requests where id::text=payload->>'request_id';
  if not found then raise exception 'Request not found'; end if;
  v_mode := coalesce(v_request.procurement_mode, nullif(payload->>'mode',''));
  if v_mode is null or v_mode='competitive_bidding' then return jsonb_build_object('requestId',v_request.id,'mode','competitive_bidding','notApplicable',true); end if;
  v_can_view := auth.uid()=v_request.requester_id or private.policy_sourcing_can_manage() or private.policy_sourcing_can_review() or core.has_live_cap('procurement','view_finance') or core.has_live_cap('procurement','admin');
  if not v_can_view then begin v_assignment := private.policy_variance_doa_assignment(v_request,'final_approver'); v_can_view := v_assignment.approver_user_id=auth.uid(); exception when others then v_can_view := false; end; end if;
  if not v_can_view then raise exception 'Not authorized to view this governed exception workspace'; end if;
  v_profile := private.policy_exception_active_profile();
  select * into v_pack from procurement.exception_packs where request_id::text=v_request.id::text and mode=v_mode order by submitted_at desc nulls last, revision desc limit 1;
  v_blockers := private.policy_exception_pack_blockers(v_request.id::text,v_mode,v_profile,v_request.estimated_amount);
  v_can_submit := private.policy_sourcing_can_manage() and v_request.status='draft';
  v_can_procurement := v_pack.id is not null and v_pack.status='under_review' and private.policy_sourcing_can_review() and auth.uid()<>v_pack.submitted_by and not exists(select 1 from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='procurement');
  v_can_finance := v_pack.id is not null and v_pack.status='under_review' and v_pack.mode='petty_cash' and (core.has_live_cap('procurement','view_finance') or core.has_live_cap('procurement','admin')) and auth.uid()<>v_pack.submitted_by and not exists(select 1 from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='procurement' and decided_by=auth.uid()) and exists(select 1 from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='procurement' and decision='approved') and not exists(select 1 from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='finance');
  begin v_assignment := private.policy_variance_doa_assignment(v_request,'final_approver'); v_can_doa := v_pack.id is not null and v_pack.status='under_review' and v_assignment.approver_user_id=auth.uid() and auth.uid()<>v_pack.submitted_by and auth.uid()<>coalesce((select decided_by from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='procurement'),gen_random_uuid()) and not exists(select 1 from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='finance' and decided_by=auth.uid()) and exists(select 1 from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='procurement' and decision='approved') and (v_pack.mode<>'petty_cash' or exists(select 1 from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='finance' and decision='approved')) and not exists(select 1 from procurement.exception_doa_decisions where exception_pack_id=v_pack.id); exception when others then v_can_doa := false; end;
  select coalesce(jsonb_agg(item order by item->>'decidedAt'),'[]'::jsonb) into v_history from (
    select jsonb_build_object('stage','submitted','decision','submitted','actorId',v_pack.submitted_by,'decidedAt',v_pack.submitted_at,'note',v_pack.justification,'revision',1) item where v_pack.id is not null
    union all select jsonb_build_object('stage',review.stage,'decision',review.decision,'actorId',review.decided_by,'decidedAt',review.decided_at,'note',review.rationale,'revision',review.expected_revision) from procurement.exception_pack_reviews review where review.exception_pack_id=v_pack.id
    union all select jsonb_build_object('stage','doa','decision',decision.decision,'actorId',decision.decided_by,'decidedAt',decision.decided_at,'note',decision.rationale,'revision',decision.expected_revision) from procurement.exception_doa_decisions decision where decision.exception_pack_id=v_pack.id
  ) history;
  return jsonb_build_object('requestId',v_request.id,'mode',v_mode,'profile',jsonb_build_object('id',v_profile.id,'code',v_profile.code,'version',v_profile.version,'repeatOrderMaxAmount',v_profile.repeat_order_max_amount,'repeatOrderMaxAgeDays',v_profile.repeat_order_max_age_days,'pettyCashMaxAmount',v_profile.petty_cash_max_amount),'pack',case when v_pack.id is null then null else jsonb_build_object('id',v_pack.id,'status',v_pack.status,'revision',v_pack.revision,'mode',v_pack.mode,'submittedBy',v_pack.submitted_by,'submittedAt',v_pack.submitted_at,'evidence',v_pack.evidence,'snapshot',v_pack.immutable_snapshot,'priceReasonableness',v_pack.price_reasonableness) end,'blockers',to_jsonb(v_blockers),'history',v_history,'actions',jsonb_build_object('canSubmit',v_can_submit,'canProcurementReview',v_can_procurement,'canFinanceReview',v_can_finance,'canDoaReview',v_can_doa),'recovery',case when cardinality(v_blockers)>0 then 'Resolve the listed server blockers or submit a new pack after a request, route, or policy change.' else 'This pack is currently eligible for the next independent decision.' end);
end;
$$;

revoke all on function private.policy_exception_active_profile(), private.policy_exception_request_fingerprint(procurement.requests,text,uuid,integer), private.policy_exception_evidence_fingerprint(jsonb), private.policy_exception_repeat_snapshot(procurement.requests,jsonb,procurement.policy_profiles), private.policy_exception_submission_snapshot(procurement.requests,text,jsonb,procurement.policy_profiles), private.policy_exception_pack_blockers(text,text,procurement.policy_profiles,numeric) from public, anon, authenticated;
revoke all on function procurement.exception_workspace(jsonb) from public, anon;
grant execute on function procurement.submit_policy_exception_pack(jsonb), procurement.review_policy_exception_pack(jsonb), procurement.exception_workspace(jsonb) to authenticated, service_role;

-- Rebind the route gate after replacing the strict pack implementation. This
-- keeps every pre-confirmation, award, and PO transition on the same
-- authoritative binding predicate.
create or replace function private.policy_route_exception_is_eligible(
  p_request_id text,
  p_procurement_mode text,
  p_profile procurement.policy_profiles,
  p_amount numeric
)
returns text[] language sql stable security definer set search_path = '' as $$
  select private.policy_exception_pack_blockers(p_request_id, p_procurement_mode, p_profile, p_amount)
$$;
revoke all on function private.policy_route_exception_is_eligible(text,text,procurement.policy_profiles,numeric) from public, anon, authenticated;

-- Task 7 strict review fixes: every formal close is evidenced, evidence
-- revisions invalidate recommendations, and variance roles are server-led.
create or replace function private.policy_sourcing_response_closed_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'issued' and new.status in ('response_closed', 'failed_bid') then
    new.response_closed_at := coalesce(new.response_closed_at, statement_timestamp());
  end if;
  return new;
end;
$$;

create or replace function private.policy_can_view_variance_request(p_request procurement.requests)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1
    from procurement.doa_assignments assignment
    join procurement.doa_matrices matrix on matrix.id = assignment.matrix_id
    join core.profiles approver on approver.id = assignment.approver_user_id
    where matrix.active and matrix.status = 'active'
      and matrix.effective_at <= statement_timestamp()
      and (matrix.expires_at is null or matrix.expires_at > statement_timestamp())
      and assignment.active and assignment.approver_user_id = auth.uid()
      and assignment.tier in ('dept_head', 'finance')
      and lower(assignment.department) = lower(p_request.department)
      and (assignment.category is null or assignment.category = p_request.category)
      and coalesce(p_request.estimated_amount, 0) >= assignment.min_amount
      and (assignment.max_amount is null or coalesce(p_request.estimated_amount, 0) <= assignment.max_amount)
      and approver.status = 'active'
      and (assignment.tier <> 'finance' or core.has_live_cap('procurement', 'view_finance') or core.has_live_cap('procurement', 'admin'))
  )
$$;

create or replace function private.policy_variance_review_eligibility(
  p_request procurement.requests,
  p_recommendation procurement.award_recommendations
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_stage text; v_assignment_id uuid; v_matrix_id uuid; v_matrix_version text; v_actor uuid := auth.uid();
  v_department text; v_category text; v_amount numeric; v_department_decider uuid; v_can_review boolean := false;
begin
  if p_recommendation.status <> 'pending_variance' then return jsonb_build_object('canReview', false); end if;
  select request.department, request.category, request.estimated_amount
    into v_department, v_category, v_amount
  from procurement.requests request where request.id = p_request.id;
  select decided_by into v_department_decider from procurement.award_recommendation_variance_decisions
  where award_recommendation_id = p_recommendation.id and decision_type = 'department_head' and decision = 'approved';
  v_stage := case when v_department_decider is null then 'department_head' else 'finance' end;
  -- Select scalar authority references for the read model. The conditions
  -- mirror the write resolver so the page cannot advertise a decision the
  -- decision RPC would reject.
  select assignment.id, assignment.matrix_id, matrix.version
    into v_assignment_id, v_matrix_id, v_matrix_version
  from procurement.doa_assignments assignment
  join procurement.doa_matrices matrix on matrix.id = assignment.matrix_id
  join core.profiles approver on approver.id = assignment.approver_user_id
  where matrix.active and matrix.status = 'active'
    and matrix.effective_at <= statement_timestamp()
    and (matrix.expires_at is null or matrix.expires_at > statement_timestamp())
    and assignment.active and assignment.approver_user_id = v_actor
    and assignment.tier = case when v_stage = 'department_head' then 'dept_head' else 'finance' end
    and lower(assignment.department) = lower(v_department)
    and (assignment.category is null or assignment.category = v_category)
    and coalesce(v_amount, 0) >= assignment.min_amount
    and (assignment.max_amount is null or coalesce(v_amount, 0) <= assignment.max_amount)
    and approver.status = 'active'
  order by matrix.effective_at desc, assignment.min_amount desc limit 1;
  if v_assignment_id is not null then
    v_can_review := v_actor <> p_recommendation.created_by
      and (v_stage <> 'finance' or (core.has_live_cap('procurement', 'view_finance') or core.has_live_cap('procurement', 'admin')))
      and (v_stage <> 'finance' or v_actor <> v_department_decider);
  end if;
  return jsonb_build_object(
    'nextStage', v_stage,
    'canReview', v_can_review,
    'doaMatrixId', v_matrix_id,
    'doaMatrixVersion', v_matrix_version,
    'doaAssignmentId', v_assignment_id
  );
end;
$$;

create or replace function procurement.save_commercial_tabulation(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_event procurement.sourcing_events; v_profile procurement.policy_profiles; v_version integer; v_due timestamptz;
  v_entries jsonb := coalesce(payload->'entries', '[]'::jsonb); v_tabulation procurement.commercial_tabulations;
begin
  if not private.policy_sourcing_can_manage() then raise exception 'Not authorized to save commercial tabulation'; end if;
  v_event := private.policy_evaluation_event((payload->>'sourcing_event_id')::uuid);
  v_profile := private.policy_sourcing_profile(v_event.request_id::text);
  if jsonb_typeof(v_entries) <> 'array' or jsonb_array_length(v_entries) = 0 then raise exception 'Commercial tabulation entries are required'; end if;
  if nullif(btrim(payload->>'evidence_reference'), '') is null then raise exception 'Commercial tabulation evidence is required'; end if;
  if exists (select 1 from procurement.sourcing_responses response where response.sourcing_event_id = v_event.id and response.received_at is not null and response.deadline_compliant is distinct from false and not exists (select 1 from jsonb_array_elements(v_entries) item where item->>'vendor_id' = response.vendor_id::text)) then raise exception 'The tabulation must include every usable response'; end if;
  select coalesce(max(version), 0) + 1 into v_version from procurement.commercial_tabulations where sourcing_event_id = v_event.id;
  v_due := v_event.response_closed_at + make_interval(hours => v_profile.tabulation_hours);
  update procurement.commercial_tabulations set status = 'superseded' where sourcing_event_id = v_event.id and status = 'submitted';
  update procurement.award_recommendations set status = 'superseded', updated_at = statement_timestamp() where sourcing_event_id = v_event.id and status in ('pending_variance', 'approved');
  insert into procurement.commercial_tabulations(sourcing_event_id, version, response_closed_at, due_at, submitted_by, entries, evidence_reference, comments, escalation_status)
  values(v_event.id, v_version, v_event.response_closed_at, v_due, auth.uid(), v_entries, btrim(payload->>'evidence_reference'), nullif(btrim(payload->>'comments'), ''), case when statement_timestamp() > v_due then 'overdue' else 'on_track' end) returning * into v_tabulation;
  insert into procurement.policy_sla_events(request_id, policy_profile_id, sla_type, owner_id, due_at, completed_at, status, detail)
  values(v_event.request_id, v_profile.id, 'commercial_tabulation', auth.uid(), v_due, v_tabulation.submitted_at, case when v_tabulation.escalation_status = 'on_track' then 'completed' else 'overdue' end, jsonb_build_object('commercialTabulationId', v_tabulation.id, 'version', v_version));
  return to_jsonb(v_tabulation);
end;
$$;

create or replace function procurement.submit_technical_evaluation(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_event procurement.sourcing_events; v_profile procurement.policy_profiles; v_due timestamptz; v_version integer;
  v_criteria jsonb := coalesce(payload->'criteria', '[]'::jsonb); v_evaluation procurement.technical_evaluations;
begin
  if not private.policy_sourcing_can_manage() then raise exception 'Not authorized to submit technical evaluation'; end if;
  v_event := private.policy_evaluation_event((payload->>'sourcing_event_id')::uuid);
  v_profile := private.policy_sourcing_profile(v_event.request_id::text);
  if not exists(select 1 from procurement.commercial_tabulations tabulation where tabulation.sourcing_event_id = v_event.id and tabulation.status = 'submitted') then raise exception 'A submitted commercial tabulation is required'; end if;
  if not exists(select 1 from procurement.sourcing_responses response where response.sourcing_event_id = v_event.id and response.vendor_id = (payload->>'vendor_id')::uuid and response.received_at is not null and response.deadline_compliant is distinct from false) then raise exception 'Technical evaluation requires a compliant received response'; end if;
  if not private.policy_evaluation_criteria_are_valid(v_criteria) then raise exception 'Every best-value criterion needs a score and evidence reference'; end if;
  if nullif(btrim(payload->>'evidence_reference'), '') is null then raise exception 'Technical evaluation evidence is required'; end if;
  select coalesce(max(version), 0) + 1 into v_version from procurement.technical_evaluations where sourcing_event_id = v_event.id and vendor_id = (payload->>'vendor_id')::uuid;
  v_due := private.policy_add_manila_working_days(v_event.response_closed_at, v_profile.technical_evaluation_working_days);
  update procurement.technical_evaluations set status = 'superseded' where sourcing_event_id = v_event.id and vendor_id = (payload->>'vendor_id')::uuid and status = 'submitted';
  update procurement.award_recommendations set status = 'superseded', updated_at = statement_timestamp() where sourcing_event_id = v_event.id and status in ('pending_variance', 'approved');
  insert into procurement.technical_evaluations(sourcing_event_id, vendor_id, version, due_at, reviewer_id, criteria, total_score, evidence_reference, comments, escalation_status)
  values(v_event.id, (payload->>'vendor_id')::uuid, v_version, v_due, auth.uid(), v_criteria, (select avg((item->>'score')::numeric) from jsonb_array_elements(v_criteria) item), btrim(payload->>'evidence_reference'), nullif(btrim(payload->>'comments'), ''), case when statement_timestamp() > v_due then 'overdue' else 'on_track' end) returning * into v_evaluation;
  insert into procurement.policy_sla_events(request_id, policy_profile_id, sla_type, owner_id, due_at, completed_at, status, detail)
  values(v_event.request_id, v_profile.id, 'technical_evaluation', auth.uid(), v_due, v_evaluation.submitted_at, case when v_evaluation.escalation_status = 'on_track' then 'completed' else 'overdue' end, jsonb_build_object('technicalEvaluationId', v_evaluation.id, 'vendorId', v_evaluation.vendor_id, 'version', v_version));
  return to_jsonb(v_evaluation);
end;
$$;

create or replace function procurement.submit_award_recommendation(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_event procurement.sourcing_events; v_request procurement.requests; v_tabulation procurement.commercial_tabulations;
  v_technical procurement.technical_evaluations; v_evaluated uuid; v_recommendation procurement.award_recommendations; v_risk_required boolean; v_status text;
begin
  if not private.policy_sourcing_can_manage() then raise exception 'Not authorized to submit award recommendation'; end if;
  v_event := private.policy_evaluation_event((payload->>'sourcing_event_id')::uuid);
  select * into v_request from procurement.requests where id = v_event.request_id for update;
  select * into v_tabulation from procurement.commercial_tabulations where id = (payload->>'commercial_tabulation_id')::uuid and sourcing_event_id = v_event.id and status = 'submitted';
  if not found then raise exception 'A current commercial tabulation is required'; end if;
  if exists (select 1 from procurement.sourcing_responses response where response.sourcing_event_id = v_event.id and response.received_at is not null and response.deadline_compliant is distinct from false and not exists (select 1 from procurement.technical_evaluations evaluation where evaluation.sourcing_event_id = v_event.id and evaluation.vendor_id = response.vendor_id and evaluation.status = 'submitted')) then raise exception 'A submitted technical evaluation is required for every usable response'; end if;
  select * into v_technical from procurement.technical_evaluations where id = (payload->>'technical_evaluation_id')::uuid and sourcing_event_id = v_event.id and vendor_id = (payload->>'recommended_vendor_id')::uuid and status = 'submitted';
  if not found then raise exception 'A submitted technical evaluation for the recommended vendor is required'; end if;
  select vendor_id into v_evaluated from procurement.technical_evaluations where sourcing_event_id = v_event.id and status = 'submitted' order by total_score desc, submitted_at asc limit 1;
  if v_evaluated is null or v_evaluated <> (payload->>'evaluated_vendor_id')::uuid then raise exception 'The evaluated vendor must be the top submitted technical evaluation'; end if;
  if nullif(btrim(payload->>'rationale'), '') is null then raise exception 'Recommendation rationale is required'; end if;
  v_risk_required := coalesce((v_request.compliance->'riskFacts'->>'complex')::boolean, false) or coalesce((v_request.compliance->'riskFacts'->>'technical')::boolean, false) or coalesce((v_request.compliance->'riskFacts'->>'strategic')::boolean, false) or coalesce((v_request.compliance->'riskFacts'->>'highRisk')::boolean, false) or coalesce((v_request.compliance->'riskFacts'->>'dataSensitive')::boolean, false) or coalesce((v_request.compliance->'riskFacts'->>'importation')::boolean, false);
  if v_risk_required and nullif(btrim(payload->>'risk_evidence_reference'), '') is null then raise exception 'Applicable risk evidence is required'; end if;
  if v_evaluated <> (payload->>'recommended_vendor_id')::uuid and nullif(btrim(payload->>'variance_justification'), '') is null then raise exception 'Written variance justification is required'; end if;
  v_status := case when v_evaluated = (payload->>'recommended_vendor_id')::uuid then 'approved' else 'pending_variance' end;
  update procurement.award_recommendations set status = 'superseded', updated_at = statement_timestamp() where sourcing_event_id = v_event.id and status in ('draft', 'pending_variance', 'approved');
  insert into procurement.award_recommendations(sourcing_event_id, evaluated_vendor_id, recommended_vendor_id, commercial_tabulation_id, technical_evaluation_id, rationale, risk_evidence_reference, variance_justification, status, created_by)
  values(v_event.id, v_evaluated, (payload->>'recommended_vendor_id')::uuid, v_tabulation.id, v_technical.id, btrim(payload->>'rationale'), nullif(btrim(payload->>'risk_evidence_reference'), ''), nullif(btrim(payload->>'variance_justification'), ''), v_status, auth.uid()) returning * into v_recommendation;
  return to_jsonb(v_recommendation);
end;
$$;

create or replace function procurement.review_recommendation_variance(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_recommendation procurement.award_recommendations; v_event procurement.sourcing_events; v_request procurement.requests; v_assignment procurement.doa_assignments; v_decision_type text; v_decision text := payload->>'decision'; v_department_decider uuid;
begin
  select * into v_recommendation from procurement.award_recommendations where id = (payload->>'award_recommendation_id')::uuid for update;
  if not found or v_recommendation.status <> 'pending_variance' then raise exception 'A pending variance recommendation is required'; end if;
  if coalesce((payload->>'expected_version')::integer, -1) <> v_recommendation.revision then raise exception 'The variance recommendation has changed; refresh before deciding'; end if;
  if v_recommendation.created_by = auth.uid() then raise exception 'The recommendation author cannot approve their own variance'; end if;
  if v_decision not in ('approved', 'rejected') or nullif(btrim(payload->>'note'), '') is null then raise exception 'A decision and written decision note are required'; end if;
  select * into v_event from procurement.sourcing_events where id = v_recommendation.sourcing_event_id;
  select * into v_request from procurement.requests where id = v_event.request_id;
  select decided_by into v_department_decider from procurement.award_recommendation_variance_decisions where award_recommendation_id = v_recommendation.id and decision_type = 'department_head' and decision = 'approved';
  if v_department_decider is null then
    v_decision_type := 'department_head'; v_assignment := private.policy_variance_doa_assignment(v_request, 'dept_head');
  else
    v_decision_type := 'finance';
    if auth.uid() = v_department_decider then raise exception 'Finance approval must be independent from the Department Head decision'; end if;
    if not (core.has_live_cap('procurement', 'view_finance') or core.has_live_cap('procurement', 'admin')) then raise exception 'Controller or Finance authority is required for variance approval'; end if;
    v_assignment := private.policy_variance_doa_assignment(v_request, 'finance');
  end if;
  if exists(select 1 from procurement.award_recommendation_variance_decisions where award_recommendation_id = v_recommendation.id and decision_type = v_decision_type) then raise exception 'This variance decision was already recorded'; end if;
  insert into procurement.award_recommendation_variance_decisions(award_recommendation_id, decision_type, decision, rationale, doa_matrix_id, doa_assignment_id, decided_by) values(v_recommendation.id, v_decision_type, v_decision, btrim(payload->>'note'), v_assignment.matrix_id, v_assignment.id, auth.uid());
  update procurement.award_recommendations set status = case when v_decision = 'rejected' then 'rejected' when v_decision_type = 'finance' then 'approved' else 'pending_variance' end, revision = revision + 1, updated_at = statement_timestamp() where id = v_recommendation.id returning * into v_recommendation;
  return to_jsonb(v_recommendation);
end;
$$;

create or replace function private.policy_award_requires_recommendation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'awarded' and old.status is distinct from 'awarded' and not exists (
    select 1 from procurement.award_recommendations recommendation
    join procurement.commercial_tabulations tabulation on tabulation.id = recommendation.commercial_tabulation_id and tabulation.status = 'submitted'
    join procurement.technical_evaluations selected_evaluation on selected_evaluation.id = recommendation.technical_evaluation_id and selected_evaluation.status = 'submitted' and selected_evaluation.vendor_id = recommendation.recommended_vendor_id
    where recommendation.sourcing_event_id = new.id and recommendation.status = 'approved' and recommendation.recommended_vendor_id = new.selected_vendor_id
      and not exists (select 1 from procurement.sourcing_responses response where response.sourcing_event_id = new.id and response.received_at is not null and response.deadline_compliant is distinct from false and not exists (select 1 from procurement.technical_evaluations evaluation where evaluation.sourcing_event_id = new.id and evaluation.vendor_id = response.vendor_id and evaluation.status = 'submitted'))
      and recommendation.evaluated_vendor_id = (select evaluation.vendor_id from procurement.technical_evaluations evaluation where evaluation.sourcing_event_id = new.id and evaluation.status = 'submitted' order by evaluation.total_score desc, evaluation.submitted_at asc limit 1)
  ) then raise exception 'A current approved best-value recommendation with complete technical evidence is required before award'; end if;
  return new;
end;
$$;

create or replace function procurement.sourcing_workspace(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_request procurement.requests; v_event procurement.sourcing_events; v_profile procurement.policy_profiles; v_responses jsonb; v_comms jsonb;
begin
  -- Sourcing evidence is visible only to Procurement sourcing readers. A
  -- request-scoped DOA assignment is deliberately not a sourcing-read grant;
  -- variance reviewers receive their narrow evidence model from
  -- evaluation_workspace after its current-stage server admission.
  if not (
    core.has_live_cap('procurement', 'view_dashboard')
    or private.policy_sourcing_can_manage()
    or private.policy_sourcing_can_review()
  ) then
    raise exception 'No procurement sourcing access is assigned to this account.';
  end if;
  select * into v_request from procurement.requests where id::text = payload->>'request_id';
  if not found then raise exception 'Request not found'; end if;
  v_profile := private.policy_sourcing_profile(v_request.id::text);
  select * into v_event from procurement.sourcing_events where request_id = v_request.id and status <> 'cancelled' order by created_at desc limit 1;
  if not found then return jsonb_build_object('requestId', v_request.id, 'event', null); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', response.id, 'vendorId', response.vendor_id, 'vendorName', vendor.legal_name, 'accredited', vendor.accreditation_status = 'approved' and (vendor.accreditation_expires_at is null or vendor.accreditation_expires_at > statement_timestamp()), 'invitedAt', response.invited_at, 'receivedAt', response.received_at, 'deadlineCompliant', response.deadline_compliant, 'proposalReference', response.proposal_storage_path, 'commercial', response.commercial, 'technical', response.technical) order by vendor.legal_name), '[]'::jsonb) into v_responses from procurement.sourcing_responses response join core.vendors vendor on vendor.id = response.vendor_id where response.sourcing_event_id = v_event.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', communication.id,
    'communicationType', communication.communication_type,
    'notificationGroupId', communication.detail->>'notificationGroupId',
    'packageVersion', communication.detail->>'packageVersion',
    'packageHash', communication.detail->>'packageHash',
    'sentAt', communication.detail->>'sentAt',
    'deliveredAt', communication.detail->>'deliveredAt',
    'acknowledgedAt', acknowledgement.detail->>'acknowledgedAt',
    'acknowledgementState', case
      when communication.communication_type not in ('invitation', 'requote') then null
      when response.current_invitation_communication_id is distinct from communication.id then 'superseded'
      when acknowledgement.id is not null then 'acknowledged'
      when communication.sent_at + make_interval(hours => v_profile.vendor_acknowledgement_hours) < statement_timestamp() then 'overdue'
      else 'pending'
    end,
    'clarificationState', case when communication.communication_type = 'clarification' and communication.sent_at + make_interval(hours => v_profile.clarification_hours) < statement_timestamp() then 'overdue' when communication.communication_type = 'clarification' then 'answered' else null end
  ) order by communication.sent_at desc), '[]'::jsonb) into v_comms
  from procurement.solicitation_communications communication
  left join procurement.sourcing_responses response on response.sourcing_event_id = v_event.id and response.vendor_id::text = communication.detail->>'recipientVendorId'
  left join lateral (
    select acknowledgement.* from procurement.solicitation_communications acknowledgement
    where acknowledgement.communication_type = 'invitation_acknowledgement'
      and acknowledgement.detail->>'acknowledgedCommunicationId' = communication.id::text
      and acknowledgement.detail->>'recipientVendorId' = communication.detail->>'recipientVendorId'
    order by acknowledgement.sent_at desc limit 1
  ) acknowledgement on true
  where communication.request_id = v_request.id and communication.communication_type <> 'invitation_acknowledgement';
  return jsonb_build_object('requestId', v_request.id, 'event', jsonb_build_object('id', v_event.id, 'status', v_event.status, 'submissionDeadline', v_event.submission_deadline, 'originalSubmissionDeadline', v_event.original_submission_deadline, 'intendedResponses', v_event.intended_responses, 'packageVersion', v_event.package_version, 'packageHash', v_event.package_hash, 'failedBidReason', v_event.failed_bid_reason, 'selectedVendorId', v_event.selected_vendor_id, 'closureNote', v_event.closure_note, 'responses', v_responses, 'communications', v_comms, 'policyControlSources', coalesce(v_profile.control_sources,'{}'::jsonb), 'policyControls', jsonb_build_object('formalBidAmount', v_profile.formal_bid_amount, 'inviteTargetMin', v_profile.invite_target_min, 'inviteTargetMax', v_profile.invite_target_max, 'sealedBidMinimumResponses', v_profile.sealed_bid_minimum_responses, 'bidWindowWorkingDays', v_profile.bid_window_working_days, 'maxExtensionCalendarDays', v_profile.max_extension_calendar_days, 'vendorAcknowledgementHours', v_profile.vendor_acknowledgement_hours, 'clarificationHours', v_profile.clarification_hours, 'tabulationHours', v_profile.tabulation_hours, 'technicalEvaluationWorkingDays', v_profile.technical_evaluation_working_days, 'poAcknowledgementHours', v_profile.po_acknowledgement_hours, 'repeatOrderMaxAmount', v_profile.repeat_order_max_amount, 'repeatOrderMaxAgeDays', v_profile.repeat_order_max_age_days, 'pettyCashMaxAmount', v_profile.petty_cash_max_amount, 'poInvoiceThreshold', v_profile.po_invoice_threshold, 'vendorProbationMonths', v_profile.vendor_probation_months)));
end;
$$;

create or replace function procurement.evaluation_workspace(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_event procurement.sourcing_events; v_request procurement.requests; v_tabulations jsonb; v_evaluations jsonb; v_recommendation jsonb; v_variances jsonb; v_recommendation_row procurement.award_recommendations; v_eligibility jsonb;
begin
  perform procurement.sourcing_workspace(payload);
  select * into v_event from procurement.sourcing_events event where event.request_id::text = payload->>'request_id' and event.status <> 'cancelled' order by event.created_at desc limit 1;
  if not found then return jsonb_build_object('commercialTabulations', '[]'::jsonb, 'technicalEvaluations', '[]'::jsonb, 'awardRecommendation', null, 'varianceDecisions', '[]'::jsonb, 'varianceEligibility', jsonb_build_object('canReview', false)); end if;
  select * into v_request from procurement.requests where id = v_event.request_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', tabulation.id, 'sourcingEventId', tabulation.sourcing_event_id, 'version', tabulation.version, 'responseClosedAt', tabulation.response_closed_at, 'dueAt', tabulation.due_at, 'submittedAt', tabulation.submitted_at, 'submittedByName', coalesce(submitter.full_name, tabulation.submitted_by::text), 'entries', tabulation.entries, 'evidenceReference', tabulation.evidence_reference, 'comments', tabulation.comments, 'status', tabulation.status, 'escalationStatus', tabulation.escalation_status) order by tabulation.version desc), '[]'::jsonb) into v_tabulations from procurement.commercial_tabulations tabulation left join core.profiles submitter on submitter.id = tabulation.submitted_by where tabulation.sourcing_event_id = v_event.id;
  select coalesce(jsonb_agg(jsonb_build_object('id', evaluation.id, 'sourcingEventId', evaluation.sourcing_event_id, 'vendorId', evaluation.vendor_id, 'version', evaluation.version, 'dueAt', evaluation.due_at, 'submittedAt', evaluation.submitted_at, 'reviewerName', coalesce(reviewer.full_name, evaluation.reviewer_id::text), 'criteria', evaluation.criteria, 'totalScore', evaluation.total_score, 'evidenceReference', evaluation.evidence_reference, 'comments', evaluation.comments, 'status', evaluation.status, 'escalationStatus', evaluation.escalation_status) order by evaluation.vendor_id, evaluation.version desc), '[]'::jsonb) into v_evaluations from procurement.technical_evaluations evaluation left join core.profiles reviewer on reviewer.id = evaluation.reviewer_id where evaluation.sourcing_event_id = v_event.id;
  select * into v_recommendation_row from procurement.award_recommendations recommendation where recommendation.sourcing_event_id = v_event.id and recommendation.status <> 'superseded' order by recommendation.created_at desc limit 1;
  if found then v_recommendation := jsonb_build_object('id', v_recommendation_row.id, 'sourcingEventId', v_recommendation_row.sourcing_event_id, 'evaluatedVendorId', v_recommendation_row.evaluated_vendor_id, 'recommendedVendorId', v_recommendation_row.recommended_vendor_id, 'rationale', v_recommendation_row.rationale, 'commercialTabulationId', v_recommendation_row.commercial_tabulation_id, 'technicalEvaluationId', v_recommendation_row.technical_evaluation_id, 'riskEvidenceReference', v_recommendation_row.risk_evidence_reference, 'varianceJustification', v_recommendation_row.variance_justification, 'status', v_recommendation_row.status, 'version', v_recommendation_row.revision, 'createdAt', v_recommendation_row.created_at); v_eligibility := private.policy_variance_review_eligibility(v_request, v_recommendation_row); else v_recommendation := null; v_eligibility := jsonb_build_object('canReview', false); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', decision.id, 'awardRecommendationId', decision.award_recommendation_id, 'decisionType', decision.decision_type, 'decision', decision.decision, 'rationale', decision.rationale, 'decidedByName', coalesce(decider.full_name, decision.decided_by::text), 'decidedAt', decision.decided_at, 'doaMatrixId', decision.doa_matrix_id, 'doaMatrixVersion', matrix.version, 'doaAssignmentId', decision.doa_assignment_id) order by decision.decided_at), '[]'::jsonb) into v_variances from procurement.award_recommendation_variance_decisions decision left join core.profiles decider on decider.id = decision.decided_by left join procurement.doa_matrices matrix on matrix.id = decision.doa_matrix_id where v_recommendation_row is not null and decision.award_recommendation_id = v_recommendation_row.id;
  return jsonb_build_object('commercialTabulations', v_tabulations, 'technicalEvaluations', v_evaluations, 'awardRecommendation', v_recommendation, 'varianceDecisions', v_variances, 'varianceEligibility', v_eligibility);
end;
$$;

revoke all on function private.policy_can_view_variance_request(procurement.requests), private.policy_variance_review_eligibility(procurement.requests, procurement.award_recommendations) from public, anon, authenticated;

-- Task 7 re-review: DOA reviewers enter only this server-scoped detail model.
-- It deliberately contains enough request and evaluation context to decide the
-- variance without granting a client route to request lists or sourcing tools.
create or replace function procurement.evaluation_workspace(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_event procurement.sourcing_events; v_request procurement.requests; v_responses jsonb; v_tabulations jsonb; v_evaluations jsonb; v_recommendation jsonb; v_variances jsonb; v_recommendation_row procurement.award_recommendations; v_eligibility jsonb;
begin
  select * into v_request from procurement.requests request where request.id::text = payload->>'request_id';
  if not found then
    raise exception 'No governed variance decision is assigned to this account for this request.';
  end if;
  select * into v_event from procurement.sourcing_events event where event.request_id = v_request.id and event.status <> 'cancelled' order by event.created_at desc limit 1;
  if not found then
    raise exception 'No governed variance decision is assigned to this account for this request.';
  end if;
  select * into v_recommendation_row
    from procurement.award_recommendations recommendation
    where recommendation.sourcing_event_id = v_event.id and recommendation.status <> 'superseded'
    order by recommendation.created_at desc
    limit 1;
  if not found then
    raise exception 'No governed variance decision is assigned to this account for this request.';
  end if;
  v_eligibility := private.policy_variance_review_eligibility(v_request, v_recommendation_row);
  if not coalesce((v_eligibility->>'canReview')::boolean, false) then
    raise exception 'No governed variance decision is assigned to this account for this request.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('vendorId', response.vendor_id, 'vendorName', vendor.legal_name, 'receivedAt', response.received_at, 'deadlineCompliant', response.deadline_compliant, 'commercial', response.commercial) order by vendor.legal_name), '[]'::jsonb)
    into v_responses
    from procurement.sourcing_responses response join core.vendors vendor on vendor.id = response.vendor_id
    where response.sourcing_event_id = v_event.id;
  select coalesce(jsonb_agg(jsonb_build_object('id', tabulation.id, 'sourcingEventId', tabulation.sourcing_event_id, 'version', tabulation.version, 'responseClosedAt', tabulation.response_closed_at, 'dueAt', tabulation.due_at, 'submittedAt', tabulation.submitted_at, 'submittedByName', coalesce(submitter.full_name, tabulation.submitted_by::text), 'entries', tabulation.entries, 'evidenceReference', tabulation.evidence_reference, 'comments', tabulation.comments, 'status', tabulation.status, 'escalationStatus', tabulation.escalation_status) order by tabulation.version desc), '[]'::jsonb)
    into v_tabulations
    from procurement.commercial_tabulations tabulation left join core.profiles submitter on submitter.id = tabulation.submitted_by
    where tabulation.sourcing_event_id = v_event.id;
  select coalesce(jsonb_agg(jsonb_build_object('id', evaluation.id, 'sourcingEventId', evaluation.sourcing_event_id, 'vendorId', evaluation.vendor_id, 'version', evaluation.version, 'dueAt', evaluation.due_at, 'submittedAt', evaluation.submitted_at, 'reviewerName', coalesce(reviewer.full_name, evaluation.reviewer_id::text), 'criteria', evaluation.criteria, 'totalScore', evaluation.total_score, 'evidenceReference', evaluation.evidence_reference, 'comments', evaluation.comments, 'status', evaluation.status, 'escalationStatus', evaluation.escalation_status) order by evaluation.vendor_id, evaluation.version desc), '[]'::jsonb)
    into v_evaluations
    from procurement.technical_evaluations evaluation left join core.profiles reviewer on reviewer.id = evaluation.reviewer_id
    where evaluation.sourcing_event_id = v_event.id;
  v_recommendation := jsonb_build_object('id', v_recommendation_row.id, 'sourcingEventId', v_recommendation_row.sourcing_event_id, 'evaluatedVendorId', v_recommendation_row.evaluated_vendor_id, 'recommendedVendorId', v_recommendation_row.recommended_vendor_id, 'rationale', v_recommendation_row.rationale, 'commercialTabulationId', v_recommendation_row.commercial_tabulation_id, 'technicalEvaluationId', v_recommendation_row.technical_evaluation_id, 'riskEvidenceReference', v_recommendation_row.risk_evidence_reference, 'varianceJustification', v_recommendation_row.variance_justification, 'status', v_recommendation_row.status, 'version', v_recommendation_row.revision, 'createdAt', v_recommendation_row.created_at);
  select coalesce(jsonb_agg(jsonb_build_object('id', decision.id, 'awardRecommendationId', decision.award_recommendation_id, 'decisionType', decision.decision_type, 'decision', decision.decision, 'rationale', decision.rationale, 'decidedByName', coalesce(decider.full_name, decision.decided_by::text), 'decidedAt', decision.decided_at, 'doaMatrixId', decision.doa_matrix_id, 'doaMatrixVersion', matrix.version, 'doaAssignmentId', decision.doa_assignment_id) order by decision.decided_at), '[]'::jsonb)
    into v_variances
    from procurement.award_recommendation_variance_decisions decision
    left join core.profiles decider on decider.id = decision.decided_by
    left join procurement.doa_matrices matrix on matrix.id = decision.doa_matrix_id
    where decision.award_recommendation_id = v_recommendation_row.id;
  return jsonb_build_object(
    'request', jsonb_build_object('id', v_request.id, 'title', v_request.title, 'department', v_request.department, 'costCenter', v_request.cost_center, 'category', v_request.category, 'estimatedAmount', v_request.estimated_amount, 'status', v_request.status),
    'event', jsonb_build_object('id', v_event.id, 'status', v_event.status, 'responses', v_responses),
    'commercialTabulations', v_tabulations,
    'technicalEvaluations', v_evaluations,
    'awardRecommendation', v_recommendation,
    'varianceDecisions', v_variances,
    'varianceEligibility', v_eligibility
  );
end;
$$;

-- Task 8 fix round 2: an approved exception first binds to the pending request
-- revision. Route confirmation is the only operation that may atomically bind it
-- to the resulting route decision. Other request, profile, evidence, or source
-- changes remain invalidating events.
create or replace function private.policy_exception_pack_binding_blockers(
  p_pack procurement.exception_packs,
  p_request procurement.requests,
  p_profile procurement.policy_profiles
)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_blockers text[] := '{}';
  v_fingerprint text;
  v_route procurement.route_decisions;
  v_repeat_snapshot jsonb;
  v_source procurement.exception_packs;
begin
  if p_pack.policy_profile_id is distinct from p_profile.id then
    v_blockers := array_append(v_blockers, 'policy_profile_changed_restart_exception');
  end if;

  if p_pack.route_decision_id is null then
    if p_pack.request_version is distinct from p_request.route_version then
      v_blockers := array_append(v_blockers, 'request_route_changed_restart_exception');
    end if;
  else
    select * into v_route
    from procurement.route_decisions
    where request_id = p_request.id and status = 'confirmed'
    order by request_version desc
    limit 1;
    if not found
      or v_route.id is distinct from p_pack.route_decision_id
      or v_route.request_version is distinct from p_request.route_version
      or v_route.procurement_mode is distinct from p_pack.mode
      or v_route.policy_profile_id is distinct from p_pack.policy_profile_id
      or p_pack.request_version is distinct from p_request.route_version then
      v_blockers := array_append(v_blockers, 'request_route_changed_restart_exception');
    end if;
  end if;

  v_fingerprint := private.policy_exception_request_fingerprint(
    p_request, p_pack.mode, p_profile.id, p_request.route_version
  );
  if p_pack.request_fingerprint is distinct from v_fingerprint then
    v_blockers := array_append(v_blockers, 'request_evidence_changed_restart_exception');
  end if;

  if p_pack.mode = 'repeat_order' then
    begin
      v_repeat_snapshot := private.policy_exception_repeat_snapshot(p_request, p_pack.evidence, p_profile);
      if (p_pack.immutable_snapshot->'repeatOrder') is distinct from v_repeat_snapshot then
        v_blockers := array_append(v_blockers, 'repeat_order_source_changed_restart_exception');
      end if;
    exception when others then
      v_blockers := array_append(v_blockers, 'repeat_order_source_changed_restart_exception');
    end;
  elsif p_pack.mode = 'approved_exception' then
    select * into v_source from procurement.exception_packs where id = p_pack.approved_exception_source_id;
    if not found
      or v_source.status <> 'approved'
      or v_source.immutable_snapshot = '{}'::jsonb
      or v_source.revision is distinct from (p_pack.immutable_snapshot->>'approvedExceptionSourceRevision')::integer then
      v_blockers := array_append(v_blockers, 'approved_exception_source_changed_restart_exception');
    end if;
  end if;
  return v_blockers;
end;
$$;

-- This security-definer helper is internal to the route and exception guards.
-- Keep it non-callable by browser/API roles even if PostgreSQL's default
-- PUBLIC EXECUTE behavior changes around adjacent function definitions.
revoke execute on function private.policy_exception_pack_binding_blockers(procurement.exception_packs,procurement.requests,procurement.policy_profiles) from public, anon, authenticated;

-- Task 9: PO commitment lifecycle. The state is a server projection; callers
-- submit only references and an expected revision, never acceptance or quality claims.
create table if not exists procurement.purchase_order_lifecycle_state (
  purchase_order_id text primary key references procurement.purchase_orders(id) on delete restrict,
  revision integer not null default 1 check (revision > 0),
  sent_at timestamptz,
  acknowledged_at timestamptz,
  acknowledgement_due_at timestamptz,
  acknowledgement_reference text,
  delivery_notice_at timestamptz,
  delivery_notice_reference text,
  quality_recovery_status text not null default 'none' check (quality_recovery_status in ('none','vendor_notice','replacement_rma','payment_hold','resolved')),
  closure_status text not null default 'open' check (closure_status in ('open','ready','blocked','closed')),
  closed_at timestamptz,
  closed_by uuid references core.profiles(id) on delete restrict,
  closure_reason text,
  updated_at timestamptz not null default statement_timestamp()
);

create table if not exists procurement.purchase_order_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id text not null references procurement.purchase_orders(id) on delete restrict,
  event_type text not null check (event_type in ('sent','vendor_acknowledged','delivery_notice','weekly_review','quality_recovery','closed')),
  expected_revision integer not null check (expected_revision > 0),
  resulting_revision integer not null check (resulting_revision > expected_revision),
  actor_id uuid not null references core.profiles(id) on delete restrict,
  evidence_reference text,
  payload jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default statement_timestamp(),
  unique (purchase_order_id, event_type, expected_revision, actor_id, evidence_reference)
);

alter table procurement.purchase_order_lifecycle_state enable row level security;
alter table procurement.purchase_order_lifecycle_state force row level security;
alter table procurement.purchase_order_lifecycle_events enable row level security;
alter table procurement.purchase_order_lifecycle_events force row level security;
revoke all on procurement.purchase_order_lifecycle_state, procurement.purchase_order_lifecycle_events from public, anon, authenticated, service_role;

create policy purchase_order_lifecycle_state_governed_read on procurement.purchase_order_lifecycle_state for select to authenticated
using (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','view_dashboard') or core.has_live_cap('procurement','admin') or core.current_vendor_id()::text = (select po.core_vendor_id::text from procurement.purchase_orders po where po.id = purchase_order_id));
create policy purchase_order_lifecycle_events_governed_read on procurement.purchase_order_lifecycle_events for select to authenticated
using (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','view_dashboard') or core.has_live_cap('procurement','admin') or core.current_vendor_id()::text = (select po.core_vendor_id::text from procurement.purchase_orders po where po.id = purchase_order_id));

create or replace function private.policy_po_lifecycle_projection(p_purchase_order_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_state procurement.purchase_order_lifecycle_state; v_receipt record; v_payment_hold boolean := false; v_ack_status text; v_delivery_status text; v_closure text;
begin
  select * into v_state from procurement.purchase_order_lifecycle_state where purchase_order_id = p_purchase_order_id;
  if not found then return null; end if;
  select * into v_receipt from procurement.v_purchase_order_receipt_status where purchase_order_id::text = p_purchase_order_id;
  v_payment_hold := coalesce(v_receipt.rejected_or_quarantined_quantity, 0) > 0;
  v_ack_status := case when v_state.acknowledged_at is not null then 'acknowledged' when v_state.acknowledgement_due_at < statement_timestamp() then 'overdue' else 'pending' end;
  v_delivery_status := case when v_state.delivery_notice_at is not null then 'recorded' when v_state.acknowledgement_due_at < statement_timestamp() and coalesce(v_receipt.outstanding_quantity, 0) > 0 then 'late' else 'pending' end;
  v_closure := case when v_state.closed_at is not null then 'closed' when v_payment_hold or coalesce(v_receipt.outstanding_quantity, 0) > 0 then 'blocked' else 'ready' end;
  return jsonb_build_object('revision', v_state.revision, 'sentAt', v_state.sent_at, 'acknowledgedAt', v_state.acknowledged_at, 'acknowledgementDueAt', v_state.acknowledgement_due_at, 'acknowledgementStatus', v_ack_status, 'deliveryNoticeStatus', v_delivery_status, 'qualityRecoveryStatus', case when v_payment_hold then 'payment_hold' else v_state.quality_recovery_status end, 'closureStatus', v_closure);
end;
$$;
revoke execute on function private.policy_po_lifecycle_projection(text) from public, anon, authenticated;

create or replace function private.policy_po_lifecycle_transition(p_purchase_order_id text, p_expected_revision integer, p_event_type text, p_reference text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_state procurement.purchase_order_lifecycle_state; v_po procurement.purchase_orders; v_event procurement.purchase_order_lifecycle_events; v_projection jsonb;
begin
  if auth.uid() is null then raise exception 'Authenticated actor is required'; end if;
  select * into v_po from procurement.purchase_orders where id = p_purchase_order_id for update;
  if not found or v_po.status <> 'issued' then raise exception 'An issued purchase order is required'; end if;
  select * into v_state from procurement.purchase_order_lifecycle_state where purchase_order_id = p_purchase_order_id for update;
  if not found then
    -- Existing issued POs remain operable after this additive migration. The
    -- canonical issue timestamp is unavailable on older rows, so the first
    -- governed lifecycle command starts the same 48-hour control window.
    insert into procurement.purchase_order_lifecycle_state(purchase_order_id,sent_at,acknowledgement_due_at)
    values (p_purchase_order_id, statement_timestamp(), statement_timestamp() + interval '48 hours')
    returning * into v_state;
  end if;
  if p_expected_revision <> v_state.revision then
    select * into v_event from procurement.purchase_order_lifecycle_events where purchase_order_id=p_purchase_order_id and event_type=p_event_type and expected_revision=p_expected_revision and actor_id=auth.uid() and evidence_reference is not distinct from p_reference;
    if found then return private.policy_po_lifecycle_projection(p_purchase_order_id) || jsonb_build_object('replayed', true); end if;
    raise exception 'The PO lifecycle changed; refresh before retrying';
  end if;
  if nullif(pg_catalog.btrim(p_reference),'') is null then raise exception 'A governed evidence reference is required'; end if;
  if p_event_type='vendor_acknowledged' then
    if core.current_vendor_id()::text is distinct from v_po.core_vendor_id::text then raise exception 'Only the awarded vendor may acknowledge this PO'; end if;
    update procurement.purchase_order_lifecycle_state set acknowledged_at=statement_timestamp(), acknowledgement_reference=pg_catalog.btrim(p_reference), revision=revision+1, updated_at=statement_timestamp() where purchase_order_id=p_purchase_order_id returning * into v_state;
  elsif p_event_type='delivery_notice' then
    if not (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','admin')) then raise exception 'Procurement authority is required'; end if;
    update procurement.purchase_order_lifecycle_state set delivery_notice_at=statement_timestamp(), delivery_notice_reference=pg_catalog.btrim(p_reference), revision=revision+1, updated_at=statement_timestamp() where purchase_order_id=p_purchase_order_id returning * into v_state;
  else raise exception 'Unsupported PO lifecycle event'; end if;
  insert into procurement.purchase_order_lifecycle_events(purchase_order_id,event_type,expected_revision,resulting_revision,actor_id,evidence_reference,payload) values(p_purchase_order_id,p_event_type,p_expected_revision,v_state.revision,auth.uid(),pg_catalog.btrim(p_reference),coalesce(p_payload,'{}'::jsonb));
  return private.policy_po_lifecycle_projection(p_purchase_order_id) || jsonb_build_object('replayed', false);
end;
$$;
revoke execute on function private.policy_po_lifecycle_transition(text,integer,text,text,jsonb) from public, anon, authenticated;

create or replace function procurement.acknowledge_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return private.policy_po_lifecycle_transition(payload->>'purchase_order_id', (payload->>'expected_revision')::integer, 'vendor_acknowledged', payload->>'acknowledgement_reference');
end;
$$;
create or replace function procurement.record_vendor_delivery_notice(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return private.policy_po_lifecycle_transition(payload->>'purchase_order_id', (payload->>'expected_revision')::integer, 'delivery_notice', payload->>'delivery_notice_reference');
end;
$$;
create or replace function procurement.review_open_purchase_orders(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','view_dashboard') or core.has_live_cap('procurement','admin')) then raise exception 'Procurement monitoring authority is required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', state.purchase_order_id || ':weekly', 'kind', case when state.acknowledged_at is null and state.acknowledgement_due_at < statement_timestamp() then 'vendor_acknowledgement_overdue' when receipt.rejected_or_quarantined_quantity > 0 then 'quality_recovery' when receipt.outstanding_quantity > 0 then 'open_receipt' else 'open_po' end, 'owner', 'Procurement', 'dueAt', state.acknowledgement_due_at, 'ageHours', floor(extract(epoch from statement_timestamp()-state.sent_at)/3600), 'lastNoticeAt', state.delivery_notice_at, 'nextAction', case when receipt.rejected_or_quarantined_quantity > 0 then 'Maintain vendor notice, RMA, and payment hold' when state.acknowledged_at is null then 'Escalate vendor acknowledgement' when receipt.outstanding_quantity > 0 then 'Confirm delivery and receiving handoff' else 'Request governed closure' end)) from procurement.purchase_order_lifecycle_state state join procurement.purchase_orders po on po.id=state.purchase_order_id left join procurement.v_purchase_order_receipt_status receipt on receipt.purchase_order_id::text=po.id where po.status='issued'), '[]'::jsonb);
end;
$$;
create or replace function procurement.close_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_state procurement.purchase_order_lifecycle_state; v_po procurement.purchase_orders; v_projection jsonb;
begin
  if not (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','admin')) then raise exception 'Procurement closure authority is required'; end if;
  select * into v_po from procurement.purchase_orders where id=payload->>'purchase_order_id' for update; if not found or v_po.status <> 'issued' then raise exception 'An issued purchase order is required'; end if;
  select * into v_state from procurement.purchase_order_lifecycle_state where purchase_order_id=v_po.id for update; if not found or v_state.revision <> (payload->>'expected_revision')::integer then raise exception 'The PO lifecycle changed; refresh before closure'; end if;
  v_projection:=private.policy_po_lifecycle_projection(v_po.id); if v_projection->>'closureStatus' <> 'ready' then raise exception 'PO closure is blocked by outstanding receiving, quality, RMA, credit, or payment-hold recovery'; end if;
  if nullif(pg_catalog.btrim(payload->>'closure_reason'),'') is null then raise exception 'A governed closure reason is required'; end if;
  update procurement.purchase_order_lifecycle_state set revision=revision+1, closed_at=statement_timestamp(), closed_by=auth.uid(), closure_reason=pg_catalog.btrim(payload->>'closure_reason'), closure_status='closed', updated_at=statement_timestamp() where purchase_order_id=v_po.id returning * into v_state;
  update procurement.purchase_orders set status='closed', updated_at=statement_timestamp() where id=v_po.id;
  insert into procurement.purchase_order_lifecycle_events(purchase_order_id,event_type,expected_revision,resulting_revision,actor_id,evidence_reference,payload) values(v_po.id,'closed',(payload->>'expected_revision')::integer,v_state.revision,auth.uid(),pg_catalog.btrim(payload->>'closure_reason'),'{}'::jsonb);
  return private.policy_po_lifecycle_projection(v_po.id);
end;
$$;
revoke all on function procurement.acknowledge_purchase_order(jsonb), procurement.record_vendor_delivery_notice(jsonb), procurement.review_open_purchase_orders(jsonb), procurement.close_purchase_order(jsonb) from public, anon;
grant execute on function procurement.acknowledge_purchase_order(jsonb), procurement.record_vendor_delivery_notice(jsonb), procurement.review_open_purchase_orders(jsonb), procurement.close_purchase_order(jsonb) to authenticated;

create or replace function private.policy_exception_pack_blockers(
  p_request_id text,
  p_mode text,
  p_profile procurement.policy_profiles,
  p_amount numeric
)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_pack procurement.exception_packs;
  v_request procurement.requests;
  v_blockers text[] := '{}';
begin
  if p_mode = 'competitive_bidding' then return v_blockers; end if;
  select * into v_request from procurement.requests where id::text = p_request_id;
  if not found then return array['request_not_found']; end if;
  select * into v_pack from procurement.exception_packs
  where request_id::text = p_request_id and mode = p_mode and status = 'approved'
  order by submitted_at desc nulls last, revision desc
  limit 1;
  if not found then return array['approved_exception_pack_required']; end if;

  v_blockers := private.policy_exception_pack_binding_blockers(v_pack, v_request, p_profile);
  if v_pack.submitted_by is null or v_pack.procurement_head_reviewed_by is null then
    v_blockers := array_append(v_blockers, 'independent_procurement_review_required');
  end if;
  if p_mode = 'petty_cash' and not exists (
    select 1 from procurement.exception_pack_reviews review
    where review.exception_pack_id = v_pack.id and review.stage = 'finance' and review.decision = 'approved'
  ) then
    v_blockers := array_append(v_blockers, 'independent_finance_review_required');
  end if;
  if not exists (
    select 1 from procurement.exception_doa_decisions decision
    where decision.exception_pack_id = v_pack.id and decision.decision = 'approved'
  ) then
    v_blockers := array_append(v_blockers, 'active_doa_approval_required');
  end if;
  return v_blockers;
end;
$$;

create or replace function private.policy_confirm_route_decision(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_request procurement.requests;
  v_rebound_request procurement.requests;
  v_route jsonb;
  v_decision procurement.route_decisions;
  v_pack procurement.exception_packs;
  v_profile procurement.policy_profiles;
  v_expected_version integer;
  v_current_version integer;
  v_requested_mode text;
  v_confirmation jsonb;
  v_requirements jsonb;
begin
  if not (core.has_live_cap('procurement', 'manage_rfp') or core.has_live_cap('procurement', 'admin')) then
    raise exception 'Not authorized to confirm sourcing route';
  end if;
  if jsonb_typeof(payload) <> 'object' or nullif(pg_catalog.btrim(payload->>'request_id'), '') is null then
    raise exception 'A request identity is required';
  end if;
  select * into v_request from procurement.requests where id::text = payload->>'request_id' for update;
  if not found then raise exception 'Request not found'; end if;
  perform 1 from procurement.route_decisions where request_id = v_request.id for update;
  select coalesce(max(request_version), 0) into v_current_version from procurement.route_decisions where request_id = v_request.id;
  v_confirmation := private.policy_route_confirmation_input(payload, v_current_version);
  v_expected_version := (v_confirmation->>'expected_route_version')::integer;
  v_requested_mode := nullif(pg_catalog.btrim(v_confirmation->>'requested_mode'), '');
  v_route := private.policy_derive_procurement_route(v_request.id::text, v_requested_mode);
  if v_route->>'status' <> 'derived' then raise exception 'Route cannot be confirmed: %', coalesce(v_route->'blockers', '[]'::jsonb); end if;
  v_requirements := private.policy_normalize_solicitation_requirements(v_request.solicitation_requirements, v_route->>'solicitation_type');
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
    route_version = v_decision.request_version,
    route_confirmed_at = v_decision.confirmed_at,
    route_confirmed_by = v_decision.confirmed_by,
    solicitation_requirements = v_requirements,
    compliance = jsonb_set(coalesce(compliance, '{}'::jsonb), '{routeConfirmed}', 'true'::jsonb, true),
    sourcing_method = v_decision.method,
    sourcing_override = v_requested_mode is not null and v_requested_mode <> 'competitive_bidding',
    updated_at = pg_catalog.now()
  where id = v_request.id
  returning * into v_rebound_request;

  if v_decision.procurement_mode <> 'competitive_bidding' then
    select * into v_pack from procurement.exception_packs
    where request_id = v_request.id
      and mode = v_decision.procurement_mode
      and status = 'approved'
      and route_decision_id is null
      and request_version = v_current_version
      and policy_profile_id = v_decision.policy_profile_id
    order by submitted_at desc nulls last, revision desc
    limit 1
    for update;
    if not found then raise exception 'Approved exception evidence must remain current before route confirmation'; end if;
    select * into v_profile from procurement.policy_profiles where id = v_decision.policy_profile_id;
    if cardinality(private.policy_exception_pack_binding_blockers(v_pack, v_request, v_profile)) > 0 then
      raise exception 'The approved exception changed; submit a new exception pack';
    end if;
    update procurement.exception_packs set
      route_decision_id = v_decision.id,
      request_version = v_decision.request_version,
      request_fingerprint = private.policy_exception_request_fingerprint(v_rebound_request, v_pack.mode, v_decision.policy_profile_id, v_decision.request_version),
      revision = revision + 1
    where id = v_pack.id;
  end if;
  return to_jsonb(v_decision) || jsonb_build_object('route', v_route);
end;
$$;

-- Task 10 fix round 1 terminal override. All later definitions are PO-only.
create or replace function private.policy_vendor_eligibility_projection(p_vendor_id uuid,p_scope text,p_as_of timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_vendor core.vendors; v_request procurement.requests; v_as_of timestamptz:=coalesce(p_as_of,statement_timestamp());
begin
 select * into v_vendor from core.vendors where id=p_vendor_id;
 if not found then raise exception 'Vendor not found'; end if;
 select * into v_request from procurement.requests where category is not distinct from p_scope order by updated_at desc nulls last limit 1;
 if found then return private.policy_request_vendor_eligibility_projection(p_vendor_id,v_request,v_as_of); end if;
 if v_vendor.accreditation_expires_at is not null and v_vendor.accreditation_expires_at<v_as_of::date then return jsonb_build_object('vendorId',p_vendor_id,'status','expired','eligible',false,'current',false,'scopeEligible',false,'authority','Legal/VMO','expiresAt',v_vendor.accreditation_expires_at); end if;
 return jsonb_build_object('vendorId',p_vendor_id,'status',case when v_vendor.accreditation_status='approved' then 'approved' else coalesce(v_vendor.accreditation_status,'rejected') end,'eligible',v_vendor.accreditation_status='approved','current',v_vendor.accreditation_status='approved','scopeEligible',v_vendor.accreditation_status='approved','authority','Legal/VMO');
end;
$$;
create or replace function private.policy_assert_request_vendor_eligible(p_vendor_id uuid,p_request_id text,p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_request procurement.requests; v_projection jsonb;
begin
 if p_action not in ('invite','issue_purchase_order','prepare_payment') then raise exception 'Unsupported vendor eligibility action'; end if;
 select * into v_request from procurement.requests where id::text=p_request_id for share;
 if not found then raise exception 'Request not found'; end if;
 v_projection:=private.policy_request_vendor_eligibility_projection(p_vendor_id,v_request,statement_timestamp());
 if coalesce((v_projection->>'eligible')::boolean,false) is not true then raise exception 'Legal/VMO vendor eligibility is not current, approved, and scoped for this request'; end if;
end;
$$;
create or replace function legal.record_vendor_eligibility_decision(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=auth.uid(); v_review legal.vendor_probation_reviews; v_prior legal.vendor_eligibility_decisions; v_expected integer:=coalesce(nullif(payload->>'expected_revision','')::integer,-1); v_decision text:=nullif(pg_catalog.btrim(payload->>'decision'),''); v_status text; v_result jsonb;
begin
 if v_actor is null or not core.has_live_cap('legal','approve_accreditation') then raise exception 'Legal/VMO decision authority is required'; end if;
 select * into v_review from legal.vendor_probation_reviews where id=(payload->>'probation_review_id')::uuid for update;
 if not found or v_review.status<>'completed' then raise exception 'A completed probation review is required'; end if;
 if coalesce(v_review.completed_by,v_review.opened_by)=v_actor then raise exception 'Probation review maker and decision actor must be different'; end if;
 if v_decision not in ('pass','extend','revoke','suspend') then raise exception 'Pass, extend, revoke, or suspend decision is required'; end if;
 if nullif(pg_catalog.btrim(payload->>'evidence_reference'),'') is null or nullif(pg_catalog.btrim(payload->>'notice_reference'),'') is null then raise exception 'Evidence and issued notice references are required'; end if;
 if v_decision='pass' and (coalesce(v_review.po_win_rate,-1)<.2 or coalesce(v_review.delivery_commitment_rate,-1)<>1 or coalesce(v_review.return_or_rejection_count,1)<>0 or coalesce(v_review.document_timeliness_rate,-1)<>1) then raise exception 'A pass requires 20%% PO win rate, 100%% delivery and documents, and zero returns/rejections'; end if;
 select * into v_prior from legal.vendor_eligibility_decisions where probation_review_id=v_review.id order by revision desc limit 1 for update;
 if found and v_expected<>v_prior.revision then if v_prior.decided_by=v_actor and v_prior.decision=v_decision and v_prior.evidence_reference=pg_catalog.btrim(payload->>'evidence_reference') and v_prior.notice_reference=pg_catalog.btrim(payload->>'notice_reference') then return to_jsonb(v_prior)||jsonb_build_object('replayed',true); end if; raise exception 'Vendor eligibility decision changed; refresh before retrying'; elsif not found and v_expected<>0 then raise exception 'Vendor eligibility decision changed; refresh before retrying'; end if;
 v_status:=case v_decision when 'pass' then 'approved' when 'extend' then 'probation' when 'revoke' then 'rejected' else 'suspended' end;
 insert into legal.vendor_eligibility_decisions(vendor_id,probation_review_id,status,decision,evidence_reference,notice_reference,revision,opened_by,decided_by) values(v_review.vendor_id,v_review.id,v_status,v_decision,pg_catalog.btrim(payload->>'evidence_reference'),pg_catalog.btrim(payload->>'notice_reference'),coalesce(v_prior.revision,0)+1,coalesce(v_review.completed_by,v_review.opened_by),v_actor) returning to_jsonb(legal.vendor_eligibility_decisions.*)||jsonb_build_object('replayed',false) into v_result;
 return v_result;
end;
$$;

-- The public invoice endpoint delegates here. Every readiness predicate is
-- recomputed from the locked request/PO/acceptance state and its bound profile.
create or replace function private.policy_payment_evidence_blockers(
  p_po procurement.purchase_orders,
  p_request procurement.requests,
  p_payload jsonb
)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  v_profile procurement.policy_profiles;
  v_invoice numeric := nullif(p_payload->>'invoice_amount', '')::numeric;
  v_accepted numeric := 0;
  v_is_foreign boolean := false;
  v_blockers text[] := '{}'::text[];
begin
  select * into v_profile from procurement.policy_profiles
    where id = p_request.policy_profile_id
      and relationship = 'mwell_operating'
      and status = 'active'
      and effective_from <= statement_timestamp()
      and (effective_to is null or effective_to > statement_timestamp());
  if not found then
    v_blockers := array_append(v_blockers, 'Request-bound active policy profile is required');
  end if;
  select coalesce(sum(accepted_amount), 0) into v_accepted
    from procurement.acceptance_packs
    where purchase_order_id = p_po.id
      and status = 'accepted'
      and coalesce(jsonb_array_length(exceptions), 0) = 0;
  if nullif(pg_catalog.btrim(p_payload->>'invoice_number'), '') is null
    or nullif(pg_catalog.btrim(p_payload->>'invoice_or_si_storage_path'), '') is null then
    v_blockers := array_append(v_blockers, 'Invoice, OR, or SI evidence is required');
  end if;
  if v_invoice is null or v_invoice <= 0 then
    v_blockers := array_append(v_blockers, 'A positive itemized invoice amount is required');
  elsif p_po.request_id is distinct from p_request.id or v_invoice > p_po.total or v_invoice > v_accepted then
    v_blockers := array_append(v_blockers, 'Amount and quantity must match governed PO and acceptance records');
  end if;
  if nullif(pg_catalog.btrim(p_payload->>'milestone_support_storage_path'), '') is null or v_accepted <= 0 then
    v_blockers := array_append(v_blockers, 'Receipt or acceptance evidence is required');
  end if;
  if nullif(pg_catalog.btrim(p_payload->>'tax_withholding_support_storage_path'), '') is null
    or coalesce(nullif(p_payload->>'tax_amount', '')::numeric, 0) < 0
    or coalesce(nullif(p_payload->>'withholding_amount', '')::numeric, 0) < 0
    or coalesce(nullif(p_payload->>'tax_amount', '')::numeric, 0) + coalesce(nullif(p_payload->>'withholding_amount', '')::numeric, 0) > coalesce(v_invoice, 0) then
    v_blockers := array_append(v_blockers, 'Tax and withholding support is required');
  end if;
  select exists(
    select 1 from legal.accreditation_cases c
    where c.vendor_id = p_po.core_vendor_id and coalesce(c.jurisdiction, 'PH') <> 'PH'
  ) into v_is_foreign;
  if v_is_foreign and nullif(pg_catalog.btrim(p_payload->>'foreign_vendor_evidence_storage_path'), '') is null then
    v_blockers := array_append(v_blockers, 'Foreign-vendor tax, withholding, and payment-control evidence is required');
  end if;
  if v_profile.id is not null and v_invoice is not null and v_invoice >= v_profile.po_invoice_threshold
    and (p_po.status <> 'issued' or p_po.request_id is null or p_po.total < v_invoice) then
    v_blockers := array_append(v_blockers, 'Purchase order evidence is required at or above the request-bound threshold');
  end if;
  return v_blockers;
end;
$$;
revoke all on function private.policy_payment_evidence_blockers(procurement.purchase_orders,procurement.requests,jsonb) from public, anon, authenticated, service_role;
revoke all on function procurement.prepare_invoice_payment_readiness(jsonb) from public, anon, service_role;
grant execute on function procurement.prepare_invoice_payment_readiness(jsonb) to authenticated;

-- Finance cannot accept or release a pack once the accepted evidence set changes.
-- A stale finalized pack remains immutable evidence and is replaced through the
-- corrected_from preparation path above; it is never silently payable.
create or replace function private.policy_assert_payment_pack_current(
  p_pack procurement.payment_readiness_packs
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_po procurement.purchase_orders;
  v_acceptance_pack_ids uuid[];
begin
  select * into v_po from procurement.purchase_orders
    where id=p_pack.purchase_order_id for share;
  if not found then raise exception 'Purchase order not found'; end if;
  select array_agg(acceptance.id order by acceptance.accepted_at,acceptance.id)
    into v_acceptance_pack_ids
  from procurement.acceptance_packs acceptance
  where acceptance.purchase_order_id=p_pack.purchase_order_id
    and acceptance.status='accepted'
    and coalesce(jsonb_array_length(acceptance.exceptions),0)=0;
  if coalesce(p_pack.evidence_stale,false)
     or p_pack.acceptance_evidence_version is distinct from v_po.acceptance_evidence_version
     or p_pack.acceptance_pack_ids is distinct from v_acceptance_pack_ids then
    update procurement.payment_readiness_packs
      set evidence_stale=true
      where id=p_pack.id and not evidence_stale;
    raise exception 'Payment evidence is stale; prepare a governed correction';
  end if;
end;
$$;
revoke all on function private.policy_assert_payment_pack_current(procurement.payment_readiness_packs) from public, anon, authenticated, service_role;

create or replace function procurement.review_payment_readiness(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_pack procurement.payment_readiness_packs;
  v_status text:=payload->>'status';
begin
  if not (core.has_live_cap('procurement','view_finance') or core.has_live_cap('procurement','admin')) then
    raise exception 'Not authorized to review payment readiness';
  end if;
  if v_status not in ('returned','accepted') then
    raise exception 'Invalid Finance readiness decision';
  end if;
  select * into v_pack from procurement.payment_readiness_packs
    where id=(payload->>'id')::uuid for update;
  if not found then raise exception 'Payment readiness pack not found'; end if;
  if v_status='accepted' then
    perform private.policy_assert_payment_pack_current(v_pack);
    if v_pack.status<>'ready_for_finance' then
      raise exception 'Payment readiness pack cannot transition from %',v_pack.status;
    end if;
    if not v_pack.po_match or v_pack.invoice_or_si_storage_path is null
       or v_pack.milestone_support_storage_path is null
       or v_pack.tax_withholding_support_storage_path is null then
      raise exception 'Payment readiness evidence is incomplete';
    end if;
  elsif v_pack.status not in ('ready_for_finance','accepted') then
    raise exception 'Payment readiness pack cannot transition from %',v_pack.status;
  end if;
  update procurement.payment_readiness_packs
    set status=v_status,finance_reviewed_by=auth.uid(),finance_reviewed_at=statement_timestamp(),finance_note=payload->>'note'
    where id=v_pack.id returning * into v_pack;
  return to_jsonb(v_pack);
end;
$$;

create or replace function procurement.release_payment(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_pack procurement.payment_readiness_packs; v_release procurement.payment_releases; v_total numeric;
begin
 if not core.has_live_cap('procurement','view_finance') and not core.has_live_cap('procurement','admin') then raise exception 'Not authorized to release payment'; end if;
 select * into v_pack from procurement.payment_readiness_packs where id=(payload->>'payment_readiness_pack_id')::uuid for update;
 if not found or v_pack.status<>'accepted' then raise exception 'Finance acceptance is required before release'; end if;
 perform private.policy_assert_payment_pack_current(v_pack);
 if (payload->>'amount')::numeric<=0 or (payload->>'amount')::numeric>v_pack.invoice_amount-v_pack.released_amount then raise exception 'Release amount exceeds the unpaid invoice balance'; end if;
 if nullif(trim(payload->>'payment_reference'),'') is null or nullif(payload->>'paid_at','') is null then raise exception 'Payment reference and date are required'; end if;
 insert into procurement.payment_releases(payment_readiness_pack_id,purchase_order_id,amount,payment_reference,payment_method,paid_at) values(v_pack.id,v_pack.purchase_order_id,(payload->>'amount')::numeric,payload->>'payment_reference',payload->>'payment_method',(payload->>'paid_at')::date) returning * into v_release;
 select coalesce(sum(amount),0) into v_total from procurement.payment_releases where payment_readiness_pack_id=v_pack.id and status='posted';
 update procurement.payment_readiness_packs set released_amount=v_total,status=case when v_total>=invoice_amount then 'released' else 'accepted' end where id=v_pack.id returning * into v_pack;
 return jsonb_build_object('pack',to_jsonb(v_pack),'release',to_jsonb(v_release),'closureRequired',v_pack.status='released');
end;
$$;
revoke all on function procurement.review_payment_readiness(jsonb), procurement.release_payment(jsonb) from public, anon, service_role;
grant execute on function procurement.review_payment_readiness(jsonb), procurement.release_payment(jsonb) to authenticated;

-- Task 9 terminal override: this location is after all lifecycle compatibility
-- definitions; do not move it above Task 9's additive tables and RPCs.
create or replace function private.policy_po_lifecycle_transition(p_purchase_order_id text,p_expected_revision integer,p_event_type text,p_reference text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_state procurement.purchase_order_lifecycle_state; v_po procurement.purchase_orders; v_event procurement.purchase_order_lifecycle_events; v_request procurement.purchase_order_closure_requests;
begin
 if auth.uid() is null then raise exception 'Authenticated actor is required'; end if;
 select * into v_po from procurement.purchase_orders where id=p_purchase_order_id for update;
 if not found or v_po.status<>'issued' then raise exception 'An issued purchase order is required'; end if;
 select * into v_state from procurement.purchase_order_lifecycle_state where purchase_order_id=p_purchase_order_id for update;
 if not found then raise exception 'PO lifecycle is missing; refresh after governed issue'; end if;
 if p_expected_revision<>v_state.revision then
   select * into v_event from procurement.purchase_order_lifecycle_events where purchase_order_id=p_purchase_order_id and event_type=p_event_type and expected_revision=p_expected_revision and actor_id=auth.uid() and evidence_reference is not distinct from nullif(pg_catalog.btrim(p_reference),'');
   if found then return private.policy_po_lifecycle_projection(p_purchase_order_id)||jsonb_build_object('replayed',true); end if;
   raise exception 'The PO lifecycle changed; refresh before retrying';
 end if;
 if nullif(pg_catalog.btrim(p_reference),'') is null then raise exception 'A governed evidence reference is required'; end if;
 if p_event_type='vendor_acknowledged' then
   if core.current_vendor_id()::text is distinct from v_po.core_vendor_id::text then raise exception 'Only the awarded vendor may acknowledge this PO'; end if;
   update procurement.purchase_order_lifecycle_state set acknowledged_at=statement_timestamp(),acknowledgement_reference=pg_catalog.btrim(p_reference),revision=revision+1,updated_at=statement_timestamp() where purchase_order_id=p_purchase_order_id returning * into v_state;
 elsif p_event_type='delivery_notice' then
   if not (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','admin')) then raise exception 'Procurement authority is required'; end if;
   update procurement.purchase_order_lifecycle_state set delivery_notice_at=statement_timestamp(),delivery_notice_reference=pg_catalog.btrim(p_reference),revision=revision+1,updated_at=statement_timestamp() where purchase_order_id=p_purchase_order_id returning * into v_state;
 elsif p_event_type='closed' then
   select * into v_request from procurement.purchase_order_closure_requests where id=(p_payload->>'closureRequestId')::uuid for update;
   if not found or v_request.status<>'approved' or v_request.decided_by<>auth.uid() or v_request.purchase_order_id<>p_purchase_order_id then raise exception 'Approved independent closure request is required'; end if;
   update procurement.purchase_order_lifecycle_state set revision=revision+1,closed_at=statement_timestamp(),closed_by=auth.uid(),closure_reason=pg_catalog.btrim(p_reference),closure_status='closed',updated_at=statement_timestamp() where purchase_order_id=p_purchase_order_id returning * into v_state;
   update procurement.purchase_orders set status='closed',updated_at=statement_timestamp() where id=p_purchase_order_id;
 else raise exception 'Unsupported PO lifecycle event'; end if;
 insert into procurement.purchase_order_lifecycle_events(purchase_order_id,event_type,expected_revision,resulting_revision,actor_id,evidence_reference,payload) values(p_purchase_order_id,p_event_type,p_expected_revision,v_state.revision,auth.uid(),pg_catalog.btrim(p_reference),coalesce(p_payload,'{}'::jsonb));
 return private.policy_po_lifecycle_projection(p_purchase_order_id)||jsonb_build_object('replayed',false);
end;
$$;
revoke all on function private.policy_po_lifecycle_transition(text,integer,text,text,jsonb) from public, anon, authenticated;

create or replace function procurement.review_open_purchase_orders(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 if not (core.has_live_cap('procurement','author_po') or core.has_live_cap('procurement','view_dashboard') or core.has_live_cap('procurement','admin')) then raise exception 'Procurement monitoring authority is required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',state.purchase_order_id||':weekly','purchaseOrderId',state.purchase_order_id,'kind',case when state.acknowledged_at is null and statement_timestamp()>=state.sent_at+interval '48 hours' then 'vendor_acknowledgement_overdue' when state.acknowledged_at is null and statement_timestamp()>=state.sent_at+interval '47 hours' then 'vendor_acknowledgement_due_soon' when receipt.rejected_or_quarantined_quantity>0 then 'quality_recovery' when receipt.outstanding_quantity>0 then 'open_receipt' else 'open_po' end,'owner','Procurement','dueAt',state.acknowledgement_due_at,'ageHours',floor(extract(epoch from statement_timestamp()-state.sent_at)/3600),'lastNoticeAt',state.delivery_notice_at,'nextAction',case when state.acknowledged_at is null and statement_timestamp()>=state.sent_at+interval '48 hours' then 'Escalate vendor acknowledgement' when state.acknowledged_at is null and statement_timestamp()>=state.sent_at+interval '47 hours' then 'Prepare vendor acknowledgement escalation' when receipt.rejected_or_quarantined_quantity>0 then 'Maintain vendor notice, RMA, credit, and payment hold' when receipt.outstanding_quantity>0 then 'Confirm delivery and receiving handoff' else 'Request governed closure' end)) from procurement.purchase_order_lifecycle_state state join procurement.purchase_orders po on po.id=state.purchase_order_id left join procurement.v_purchase_order_receipt_status receipt on receipt.purchase_order_id::text=po.id where po.status='issued'),'[]'::jsonb);
end;
$$;
create or replace function procurement.close_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$ begin raise exception 'Direct closure is retired; request governed closure'; end; $$;
revoke all on function procurement.close_purchase_order(jsonb) from public, anon, authenticated, service_role;
revoke all on function procurement.review_open_purchase_orders(jsonb) from public, anon;
grant execute on function procurement.review_open_purchase_orders(jsonb) to authenticated;

create or replace function procurement.review_policy_exception_pack(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pack procurement.exception_packs; v_request procurement.requests; v_profile procurement.policy_profiles; v_assignment procurement.doa_assignments; v_stage text:=payload->>'stage'; v_decision text:=payload->>'decision'; v_expected integer; v_prior_actor uuid; v_existing procurement.exception_pack_reviews; v_binding_blockers text[];
begin
  if auth.uid() is null then raise exception 'Authenticated reviewer is required'; end if;
  begin v_expected := (payload->>'expected_revision')::integer; exception when others then raise exception 'expected_revision is required'; end;
  select * into v_pack from procurement.exception_packs where id=(payload->>'id')::uuid for update;
  if not found then raise exception 'Exception pack not found'; end if;
  if v_decision not in ('approved','rejected') or nullif(btrim(payload->>'note'),'') is null then raise exception 'A decision and review note are required'; end if;
  if v_expected <> v_pack.revision then
    if v_stage in ('procurement','finance') then select * into v_existing from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage=v_stage; if found and v_existing.expected_revision=v_expected and v_existing.decided_by=auth.uid() and v_existing.decision=v_decision and v_existing.rationale=btrim(payload->>'note') then return to_jsonb(v_pack); end if; end if;
    if v_stage='doa' and exists(select 1 from procurement.exception_doa_decisions where exception_pack_id=v_pack.id and expected_revision=v_expected and decided_by=auth.uid() and decision=v_decision and rationale=btrim(payload->>'note')) then return to_jsonb(v_pack); end if;
    raise exception 'The exception pack changed; refresh before deciding';
  end if;
  if v_pack.status <> 'under_review' then raise exception 'An exception awaiting review is required'; end if;
  select * into v_request from procurement.requests where id::text=v_pack.request_id::text for share;
  v_profile := private.policy_exception_active_profile();
  v_binding_blockers := private.policy_exception_pack_binding_blockers(v_pack, v_request, v_profile);
  if cardinality(v_binding_blockers) > 0 then
    update procurement.exception_packs set status='superseded',revision=revision+1 where id=v_pack.id returning * into v_pack;
    raise exception 'The request, route, policy, or source changed; submit a new exception pack';
  end if;
  if v_stage='procurement' then
    if not private.policy_sourcing_can_review() then raise exception 'Independent Procurement reviewer authority is required'; end if;
    if auth.uid()=v_pack.submitted_by then raise exception 'Submitter cannot review the same exception'; end if;
    if exists(select 1 from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='procurement') then raise exception 'Procurement review was already recorded'; end if;
    insert into procurement.exception_pack_reviews(exception_pack_id,stage,decision,rationale,decided_by,expected_revision) values(v_pack.id,v_stage,v_decision,btrim(payload->>'note'),auth.uid(),v_expected);
    update procurement.exception_packs set procurement_head_reviewed_by=auth.uid(),procurement_head_reviewed_at=statement_timestamp(),status=case when v_decision='rejected' then 'rejected' else 'under_review' end,revision=revision+1 where id=v_pack.id returning * into v_pack;
  elsif v_stage='finance' then
    if v_pack.mode <> 'petty_cash' then raise exception 'Finance eligibility applies only to petty cash'; end if;
    if not (core.has_live_cap('procurement','view_finance') or core.has_live_cap('procurement','admin')) then raise exception 'Finance authority is required'; end if;
    select decided_by into v_prior_actor from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='procurement';
    if v_prior_actor is null then raise exception 'Independent Procurement review is required before Finance'; end if;
    if auth.uid() in (v_pack.submitted_by,v_prior_actor) then raise exception 'Finance reviewer must be independent from submitter and Procurement reviewer'; end if;
    if exists(select 1 from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='finance') then raise exception 'Finance review was already recorded'; end if;
    insert into procurement.exception_pack_reviews(exception_pack_id,stage,decision,rationale,decided_by,expected_revision) values(v_pack.id,v_stage,v_decision,btrim(payload->>'note'),auth.uid(),v_expected);
    update procurement.exception_packs set status=case when v_decision='rejected' then 'rejected' else 'under_review' end,revision=revision+1 where id=v_pack.id returning * into v_pack;
  elsif v_stage='doa' then
    select decided_by into v_prior_actor from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='procurement';
    if v_prior_actor is null then raise exception 'Independent Procurement review is required before DOA'; end if;
    if v_pack.mode='petty_cash' and not exists(select 1 from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='finance' and decision='approved') then raise exception 'Independent Finance review is required before DOA'; end if;
    if auth.uid()=v_pack.submitted_by or auth.uid()=v_prior_actor or exists(select 1 from procurement.exception_pack_reviews where exception_pack_id=v_pack.id and stage='finance' and decided_by=auth.uid()) then raise exception 'DOA actor must be independent from submitter and prior reviewers'; end if;
    v_assignment := private.policy_variance_doa_assignment(v_request,'final_approver');
    if exists(select 1 from procurement.exception_doa_decisions where exception_pack_id=v_pack.id) then raise exception 'DOA decision was already recorded'; end if;
    insert into procurement.exception_doa_decisions(exception_pack_id,decision,rationale,doa_matrix_id,doa_assignment_id,decided_by,expected_revision,pack_revision) values(v_pack.id,v_decision,btrim(payload->>'note'),v_assignment.matrix_id,v_assignment.id,auth.uid(),v_expected,v_expected);
    update procurement.exception_packs set status=case when v_decision='approved' then 'approved' else 'rejected' end,revision=revision+1 where id=v_pack.id returning * into v_pack;
  else raise exception 'Review stage must be procurement, finance, or doa'; end if;
  return to_jsonb(v_pack);
end;
$$;
