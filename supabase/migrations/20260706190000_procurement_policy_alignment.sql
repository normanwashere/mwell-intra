-- Mwell Intra — procurement policy alignment (Step 3b)
--
-- Extends the Step-3a procurement schema (migration 20260706110000) to match
-- the mWell Procurement Policy and Procedures (revised visual draft, May
-- 2026). The client already writes these fields into localStorage; this
-- migration lands the corresponding columns + tables so the live cutover can
-- read them back through core-data mappers.
--
-- Additions:
--   1. procurement.requests
--        + category, sourcing_method, sourcing_override
--        + cost_center, project_code, budget_code
--        + need_description, alternatives_considered, risk_if_not_procured
--        + philgeps_reference, direct_award_reason, price_reasonableness
--        + vendor_accreditation_required, rfp_quorum_met
--   2. procurement.approval_steps   — multi-tier ladder (dept_head →
--        procurement_head → finance → legal → final_approver).
--   3. procurement.request_attachments — attachment metadata (files stay in
--      Storage; this table is the metadata + evidence trail).
--
-- Re-runnable: create if not exists + create-or-replace functions.
--
-- Policy references throughout use the mWell Procurement Policy section
-- numbers:
--   §3  Roles and Responsibilities (approver tiers)
--   §5  Sourcing Strategy (RFQ / RFP thresholds)
--   §6  Purchase Request Requirements (attachments)
--   §7  Vendor Accreditation
--   §9  Award Recommendation (justification)
--   §11 Exceptions (Direct Award / Emergency)
--
-- TODO(rpc-follow-up): downstream RPC edits are intentionally NOT in this
-- migration. Update procurement.create_request + procurement.submit_request
-- (and add procurement.decide_request_step) in a follow-up so the payload
-- accepts the new columns and manages the approval-steps table. Search for
-- the "STEP-3B-RPC-HOOK" markers below when landing that work.

set search_path to procurement, core, public;

-- ---------------------------------------------------------------------------
-- 1) procurement.requests column additions
-- ---------------------------------------------------------------------------
alter table procurement.requests
  add column if not exists category                     text,
  add column if not exists sourcing_method              text,
  add column if not exists sourcing_override            boolean not null default false,
  add column if not exists cost_center                  text,
  add column if not exists project_code                 text,
  add column if not exists budget_code                  text,
  add column if not exists need_description             text,
  add column if not exists alternatives_considered      text,
  add column if not exists risk_if_not_procured         text,
  add column if not exists philgeps_reference           text,
  add column if not exists direct_award_reason          text,
  add column if not exists price_reasonableness         text,
  add column if not exists vendor_accreditation_required boolean not null default false,
  add column if not exists rfp_quorum_met                boolean;

-- Enumerated values (kept as text + CHECK constraint so future policy
-- additions don't need a migration to add a new value).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'requests_category_check'
  ) then
    alter table procurement.requests
      add constraint requests_category_check check (
        category is null or category in (
          'goods', 'services', 'subscription', 'capex', 'construction',
          'manpower', 'marketing', 'it_software', 'medical', 'petty_cash', 'other'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'requests_sourcing_method_check'
  ) then
    alter table procurement.requests
      add constraint requests_sourcing_method_check check (
        sourcing_method is null or sourcing_method in (
          'petty_cash', 'small_purchase', 'rfq', 'rfp',
          'direct_award', 'repeat_order', 'emergency'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'requests_direct_award_reason_check'
  ) then
    alter table procurement.requests
      add constraint requests_direct_award_reason_check check (
        direct_award_reason is null or direct_award_reason in (
          'sole_supplier', 'emergency', 'repeat_continuity', 'other'
        )
      );
  end if;
end $$;

create index if not exists requests_category_idx        on procurement.requests (category);
create index if not exists requests_sourcing_method_idx on procurement.requests (sourcing_method);
create index if not exists requests_cost_center_idx     on procurement.requests (cost_center);

-- ---------------------------------------------------------------------------
-- 2) procurement.approval_steps — multi-tier ladder
-- ---------------------------------------------------------------------------
create table if not exists procurement.approval_steps (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references procurement.requests(id) on delete cascade,
  step_order     int  not null check (step_order > 0),
  tier           text not null,
  status         text not null default 'pending',
  label          text,
  approver_id    uuid references core.profiles(id),
  decided_at     timestamptz,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint approval_steps_tier_check check (
    tier in ('dept_head', 'procurement_head', 'finance', 'legal', 'final_approver')
  ),
  constraint approval_steps_status_check check (
    status in ('pending', 'approved', 'rejected', 'skipped')
  ),
  unique (request_id, step_order)
);

create index if not exists approval_steps_request_idx    on procurement.approval_steps (request_id);
create index if not exists approval_steps_status_idx     on procurement.approval_steps (status);
create index if not exists approval_steps_tier_idx       on procurement.approval_steps (tier);
create index if not exists approval_steps_next_pending_idx
  on procurement.approval_steps (request_id, step_order)
  where status = 'pending';

alter table procurement.approval_steps enable row level security;

drop policy if exists read_approval_steps on procurement.approval_steps;
create policy read_approval_steps on procurement.approval_steps for select to authenticated
  using (
    core.has_cap('procurement', 'view_dashboard')
    or exists (
      select 1 from procurement.requests r
      where r.id = request_id and r.requester_id = auth.uid()
    )
  );

grant select on procurement.approval_steps to authenticated, service_role;
grant all    on procurement.approval_steps to service_role;
revoke insert, update, delete on procurement.approval_steps from authenticated;

-- ---------------------------------------------------------------------------
-- 3) procurement.request_attachments — metadata table
-- ---------------------------------------------------------------------------
-- Files themselves land in the `procurement-requests` Storage bucket (created
-- by the cross-module wiring migration); this table carries the metadata +
-- provenance so RLS can gate reads without hitting Storage APIs.
create table if not exists procurement.request_attachments (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references procurement.requests(id) on delete cascade,
  filename       text not null,
  mime_type      text not null,
  size_bytes     bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  storage_path   text, -- object path in Storage; null while the preview build
                      -- still holds base64 client-side
  kind           text,
  uploaded_by    uuid references core.profiles(id),
  uploaded_at    timestamptz not null default now(),
  constraint request_attachments_kind_check check (
    kind is null or kind in ('budget', 'previous_cost', 'spec', 'quote', 'brochure', 'other')
  ),
  constraint request_attachments_mime_check check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  )
);

create index if not exists request_attachments_request_idx on procurement.request_attachments (request_id);

alter table procurement.request_attachments enable row level security;

drop policy if exists read_request_attachments on procurement.request_attachments;
create policy read_request_attachments on procurement.request_attachments for select to authenticated
  using (
    core.has_cap('procurement', 'view_dashboard')
    or exists (
      select 1 from procurement.requests r
      where r.id = request_id and r.requester_id = auth.uid()
    )
  );

grant select on procurement.request_attachments to authenticated, service_role;
grant all    on procurement.request_attachments to service_role;
revoke insert, update, delete on procurement.request_attachments from authenticated;

-- ---------------------------------------------------------------------------
-- 4) Activity-log hint helper
-- ---------------------------------------------------------------------------
-- Convenience wrapper the follow-up RPC edits will use to log ladder events
-- (submit / advance / terminal). SECURITY DEFINER + capability check so the
-- caller doesn't need direct write access on core.activity_log.
create or replace function procurement.log_request_event(
  p_request_id uuid,
  p_action     text,
  p_detail     jsonb
) returns void
language plpgsql security definer set search_path = procurement, core, public as $$
begin
  if p_request_id is null or p_action is null then
    raise exception 'log_request_event requires request_id + action';
  end if;
  -- Read-side capability so the log wrapper can't be used by an anonymous
  -- caller — writes still route through the module's existing RPCs.
  if not core.has_cap('procurement', 'view_dashboard') then
    raise exception 'Not authorized: procurement.view_dashboard';
  end if;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('procurement', 'request', p_request_id, p_action, auth.uid(),
          coalesce(p_detail, '{}'::jsonb));
end; $$;

revoke all on function procurement.log_request_event(uuid, text, jsonb) from public, anon;
grant execute on function procurement.log_request_event(uuid, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) STEP-3B-RPC-HOOK markers
-- ---------------------------------------------------------------------------
-- Follow-up work to edit the existing RPCs — intentionally deferred so this
-- migration ships schema-only, matching the guardrails of the task:
--
--   * procurement.create_request(payload)
--       — pick up: category, sourcing_method, cost_center, project_code,
--         budget_code, need_description, alternatives_considered,
--         risk_if_not_procured, philgeps_reference, direct_award_reason,
--         price_reasonableness, vendor_accreditation_required, rfp_quorum_met.
--       — also insert rows into procurement.request_attachments when the
--         payload carries an `attachments` array (Storage upload happens on
--         the client; RPC records the metadata).
--
--   * procurement.submit_request(payload)
--       — compute the approval ladder from category + amount + sourcing_
--         method (mirror the TS `buildApprovalSteps` derivation) and insert
--         one row per tier into procurement.approval_steps.
--       — call procurement.log_request_event(id, 'submitted', {...ladder}).
--
--   * (new) procurement.decide_request_step(payload)
--       — accept `step_id`, `decision`, optional `note`; verify the caller's
--         module role maps to the pending step's tier; mark the step decided
--         and advance status to 'under_review' or terminal 'approved' /
--         'rejected' accordingly.
--       — call procurement.log_request_event(id, 'step_decided', {...}).
--
-- Until those RPC edits ship, the client keeps writing through localStorage
-- while the tables above stay ready for the cutover.
