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
  event_at timestamptz not null default pg_catalog.now(),
  detail jsonb not null default '{}'::jsonb,
  constraint policy_profile_events_type_check check (
    event_type in ('draft_saved', 'conflict_resolved', 'activated', 'superseded', 'suspended')
  ),
  constraint policy_profile_events_detail_check check (jsonb_typeof(detail) = 'object')
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
grant all on procurement.policy_profiles, procurement.policy_profile_events,
  procurement.policy_conflicts, procurement.solicitation_communications,
  procurement.policy_sla_events to service_role;
grant all on legal.vendor_probation_reviews to service_role;
revoke insert, update, delete on procurement.policy_profiles,
  procurement.policy_profile_events, procurement.policy_conflicts,
  procurement.solicitation_communications, procurement.policy_sla_events from authenticated;
revoke insert, update, delete on legal.vendor_probation_reviews from authenticated;

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
      document_hash, created_by
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
      pg_catalog.btrim(payload->>'document_hash'), v_actor
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
      document_hash = pg_catalog.btrim(payload->>'document_hash'), updated_at = pg_catalog.now()
    where id = v_profile_id returning * into v_profile;
  end if;

  insert into procurement.policy_profile_events (policy_profile_id, event_type, actor_id, detail)
  values (v_profile.id, 'draft_saved', v_actor, jsonb_build_object('version', v_profile.version));
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
  if v_profile.created_by is not distinct from v_actor then
    raise exception 'The policy profile maker cannot resolve its own conflict';
  end if;
  update procurement.policy_conflicts set
    status = 'resolved', selected_mapping = v_mapping, rationale = v_rationale,
    resolved_by = v_actor, resolved_at = pg_catalog.now()
  where id = v_conflict.id returning * into v_conflict;
  insert into procurement.policy_profile_events (policy_profile_id, event_type, actor_id, detail)
  values (v_profile.id, 'conflict_resolved', v_actor, jsonb_build_object('conflict_id', v_conflict.id));
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
  v_superseded_id uuid;
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
  if v_profile.created_by is not distinct from v_actor then
    raise exception 'A separate policy checker must activate the profile';
  end if;
  if v_profile.effective_from > pg_catalog.statement_timestamp() then
    raise exception 'Future-effective profiles must remain draft until activation';
  end if;
  if not private.policy_profiles_controls_are_valid(v_profile) then
    raise exception 'Policy profile numeric controls are invalid';
  end if;
  perform 1 from procurement.policy_conflicts
    where policy_profile_id = v_profile.id and status = 'open'
    for update;
  if found then raise exception 'Unresolved conflicts block activation'; end if;

  -- Locks competing active profiles before superseding them in this transaction.
  if v_profile.relationship = 'mwell_operating' then
    for v_superseded_id in
      select id from procurement.policy_profiles
      where relationship = 'mwell_operating' and status = 'active' and id <> v_profile.id
      for update
    loop
      update procurement.policy_profiles set
        status = 'superseded',
        effective_to = least(coalesce(effective_to, v_profile.effective_from), v_profile.effective_from),
        updated_at = pg_catalog.now()
      where id = v_superseded_id;
      insert into procurement.policy_profile_events (policy_profile_id, event_type, actor_id, detail)
      values (v_superseded_id, 'superseded', v_actor, jsonb_build_object('superseded_by', v_profile.id));
    end loop;
  else
    for v_superseded_id in
      select id from procurement.policy_profiles
      where relationship = 'parent_source' and code = v_profile.code
        and status = 'active' and id <> v_profile.id
      for update
    loop
      update procurement.policy_profiles set
        status = 'superseded',
        effective_to = least(coalesce(effective_to, v_profile.effective_from), v_profile.effective_from),
        updated_at = pg_catalog.now()
      where id = v_superseded_id;
      insert into procurement.policy_profile_events (policy_profile_id, event_type, actor_id, detail)
      values (v_superseded_id, 'superseded', v_actor, jsonb_build_object('superseded_by', v_profile.id));
    end loop;
  end if;

  update procurement.policy_profiles set
    status = 'active', activated_by = v_actor, activated_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where id = v_profile.id returning * into v_profile;
  insert into procurement.policy_profile_events (policy_profile_id, event_type, actor_id, detail)
  values (v_profile.id, 'activated', v_actor, jsonb_build_object('effective_from', v_profile.effective_from));
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
revoke all on function procurement.prevent_policy_profile_event_mutation() from public, anon, authenticated;
revoke all on function procurement.save_policy_profile(jsonb),
  procurement.activate_policy_profile(jsonb), procurement.resolve_policy_conflict(jsonb),
  procurement.get_effective_policy_profile(timestamptz)
from public, anon, authenticated;
grant execute on function procurement.save_policy_profile(jsonb),
  procurement.activate_policy_profile(jsonb), procurement.resolve_policy_conflict(jsonb),
  procurement.get_effective_policy_profile(timestamptz)
to authenticated, service_role;
