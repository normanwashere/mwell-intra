import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../../../supabase/migrations/20260822110000_mpic_procurement_policy_alignment.sql', import.meta.url), 'utf8');
const task6Start = migration.indexOf('-- Task 6: competitive sourcing is governed by the effective profile');
if (task6Start < 0) throw new Error('Governed sourcing migration boundary is missing');
// Keep the entire tail: later Legal eligibility and best-value triggers are
// part of the effective sourcing contract, not optional fixture exclusions.
const task6 = migration.slice(task6Start);
const procurementActor = '81000000-0000-0000-0000-000000000001';
const reviewerActor = '81000000-0000-0000-0000-000000000002';
const operationsActor = '81000000-0000-0000-0000-000000000003';
const vendorActor = '81000000-0000-0000-0000-000000000004';
const additionalVendorActor = '81000000-0000-0000-0000-000000000005';
const requestId = '81000000-0000-0000-0000-000000000010';
const eventDeadline = '2030-01-15T00:00:00.000Z';
const vendorIds = ['81000000-0000-0000-0000-000000000011', '81000000-0000-0000-0000-000000000012', '81000000-0000-0000-0000-000000000013', '81000000-0000-0000-0000-000000000014', '81000000-0000-0000-0000-000000000015'];

function json(value: unknown) { return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`; }

export class GovernedSourcingPglite {
  readonly db = new PGlite();
  readonly requestId = requestId;
  readonly vendorIds = vendorIds;
  private closed = false;

  async start() {
    await this.db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema core; create schema procurement; create schema private; create schema legal; create schema extensions; create schema test;
      create table test.actor_context(id uuid primary key, manage boolean not null, review boolean not null, vendor_id uuid);
      create function auth.uid() returns uuid language sql stable as $$ select id from test.actor_context limit 1 $$;
      create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
      create function core.has_live_cap(domain text, cap text) returns boolean language sql stable as $$ select case when domain = 'procurement' and cap in ('manage_rfp', 'admin') then manage when domain = 'procurement' and cap in ('approve_award') then review else false end from test.actor_context limit 1 $$;
      create function core.current_vendor_id() returns uuid language sql stable as $$ select vendor_id from test.actor_context limit 1 $$;
      create function extensions.digest(bytea, text) returns bytea language sql immutable as $$ select decode('00', 'hex') $$;
      create function procurement.insufficient_bid_exception(jsonb) returns jsonb language sql stable as $$ select null::jsonb $$;
      create table core.profiles(id uuid primary key, vendor_id uuid, status text not null default 'active');
      create table core.vendors(id uuid primary key, legal_name text, accreditation_status text default 'approved', accreditation_expires_at timestamptz);
      create table procurement.policy_profiles(id uuid primary key, code text, version text, name text, relationship text, status text, invite_target_min integer, invite_target_max integer, sealed_bid_minimum_responses integer, bid_window_working_days integer, max_extension_calendar_days integer, vendor_acknowledgement_hours integer, clarification_hours integer, tabulation_hours integer, technical_evaluation_working_days integer, po_acknowledgement_hours integer, formal_bid_amount numeric, repeat_order_max_amount numeric, repeat_order_max_age_days integer, petty_cash_max_amount numeric, po_invoice_threshold numeric, vendor_probation_months integer);
      create table procurement.requests(id text primary key, requester_id uuid, policy_profile_id uuid, core_vendor_id uuid, vendor_name text, updated_at timestamptz default now(), status text default 'draft', estimated_amount numeric default 100, department text default 'Operations', category text default 'goods', procurement_mode text default 'competitive_bidding', requirement_kind text default 'materials', compliance jsonb default '{}'::jsonb, lines jsonb default '[]'::jsonb);
      create table procurement.route_decisions(id uuid primary key default gen_random_uuid(), request_id text not null references procurement.requests(id), status text, request_version integer, solicitation_type text, procurement_mode text, governance_tier text, policy_profile_id uuid);
      create table procurement.exception_packs(id uuid primary key default gen_random_uuid(), request_id text references procurement.requests(id), exception_type text, justification text, evidence jsonb default '{}'::jsonb, price_reasonableness text, procurement_head_reviewed_by uuid, procurement_head_reviewed_at timestamptz, status text);
      create table procurement.sourcing_events(id uuid primary key default gen_random_uuid(), request_id text not null references procurement.requests(id), route_decision_id uuid not null references procurement.route_decisions(id), issued_at timestamptz, submission_deadline timestamptz, intended_responses integer, clarification_log jsonb default '[]'::jsonb, status text default 'draft', selected_vendor_id uuid, closure_note text, closed_at timestamptz, created_by uuid, created_at timestamptz default now());
      create table procurement.sourcing_responses(id uuid primary key default gen_random_uuid(), sourcing_event_id uuid not null references procurement.sourcing_events(id), vendor_id uuid not null references core.vendors(id), invited_at timestamptz, received_at timestamptz, deadline_compliant boolean, proposal_storage_path text, commercial jsonb default '{}'::jsonb, technical jsonb default '{}'::jsonb, material_exceptions jsonb default '[]'::jsonb, unique(sourcing_event_id, vendor_id));
      create table procurement.solicitation_communications(id uuid primary key default gen_random_uuid(), request_id text not null, policy_profile_id uuid, communication_type text not null, sent_by uuid, sent_at timestamptz not null default statement_timestamp(), audience text, content_hash text not null, detail jsonb not null default '{}'::jsonb);
      create table procurement.policy_sla_events(id uuid primary key default gen_random_uuid(), request_id text, policy_profile_id uuid, sla_type text, owner_id uuid, due_at timestamptz, completed_at timestamptz, status text, detail jsonb);
      create table procurement.policy_profile_events(id uuid primary key default gen_random_uuid());
      create table procurement.policy_conflicts(id uuid primary key default gen_random_uuid());
      -- Structural predecessors match the disposable policy migration suite.
      -- These empty tables do not replace any sourcing/award authority function.
      create table procurement.purchase_orders(id text primary key, request_id text references procurement.requests(id), core_vendor_id uuid references core.vendors(id), po_number text, vendor_name text, status text default 'draft', total numeric default 0, lines jsonb default '[]'::jsonb, issued_at timestamptz, acceptance_evidence_version integer default 1, actor_id uuid references core.profiles(id), updated_at timestamptz default now());
      create table procurement.acceptance_packs(id uuid primary key default gen_random_uuid(), purchase_order_id text, status text, exceptions jsonb default '[]'::jsonb, accepted_at timestamptz default statement_timestamp());
      create table procurement.payment_readiness_packs(id uuid primary key default gen_random_uuid(), purchase_order_id text, status text, invoice_amount numeric default 0, released_amount numeric default 0, accepted_amount numeric default 0, purchase_order_amount numeric default 0, acceptance_pack_ids uuid[], acceptance_evidence_version integer, evidence_stale boolean default false);
      create table procurement.payment_releases(id uuid primary key default gen_random_uuid(), payment_readiness_pack_id uuid, purchase_order_id text, amount numeric, payment_reference text unique, payment_method text, paid_at date, status text default 'posted');
      create table procurement.receipt_status_fixture(purchase_order_id text primary key, outstanding_quantity numeric default 0, rejected_or_quarantined_quantity numeric default 0);
      create view procurement.v_purchase_order_receipt_status as select * from procurement.receipt_status_fixture;
      create table procurement.doa_matrices(id uuid primary key default gen_random_uuid(), version text, department text, status text default 'active', active boolean default true, effective_at timestamptz default now(), expires_at timestamptz);
      create table procurement.doa_assignments(id uuid primary key default gen_random_uuid(), matrix_id uuid references procurement.doa_matrices(id), department text, category text, min_amount numeric default 0, max_amount numeric, tier text, approver_user_id uuid references core.profiles(id), active boolean default true);
      create table legal.accreditation_cases(id text primary key, vendor_id uuid references core.vendors(id), jurisdiction text);
      create table legal.accreditation_dispositions(id uuid primary key default gen_random_uuid(), case_id text references legal.accreditation_cases(id), disposition text, reason text default 'fixture', conditions jsonb default '{}'::jsonb, follow_up_due_at timestamptz, decided_by uuid references core.profiles(id), decided_at timestamptz default statement_timestamp());
      create table legal.vendor_probation_reviews(id uuid primary key default gen_random_uuid(), vendor_id uuid not null references core.vendors(id), policy_profile_id uuid not null references procurement.policy_profiles(id), due_at timestamptz not null, status text not null default 'open', opened_by uuid not null references core.profiles(id), decided_by uuid references core.profiles(id), decided_at timestamptz, decision text, evidence jsonb not null default '{}'::jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), check(status in ('open','completed','overdue','cancelled')), check(decision is null or decision in ('pass','extend','revoke','suspend')), check(jsonb_typeof(evidence) = 'object'));
      create function private.policy_submit_procurement_request(jsonb) returns jsonb language sql as $$ select '{}'::jsonb $$;
      grant usage on schema procurement to service_role;
      grant all on procurement.sourcing_events, procurement.sourcing_responses, procurement.solicitation_communications, procurement.policy_sla_events, procurement.policy_profile_events, procurement.policy_conflicts to service_role;
      insert into core.profiles(id, vendor_id) values ('${procurementActor}', null), ('${reviewerActor}', null), ('${operationsActor}', null), ('${vendorActor}', '${vendorIds[0]}'), ('${additionalVendorActor}', '${vendorIds[3]}');
      insert into procurement.policy_profiles values ('81000000-0000-0000-0000-000000000020', 'MWELL-TEST', '1', 'Mwell test', 'mwell_operating', 'active', 3, 4, 3, 7, 7, 24, 48, 48, 5, 48, 1000000, 250000, 365, 2000, 50000, 6);
      insert into procurement.requests(id, requester_id, policy_profile_id) values ('${requestId}', '${procurementActor}', '81000000-0000-0000-0000-000000000020');
      insert into procurement.route_decisions(request_id, status, request_version, solicitation_type, procurement_mode, governance_tier, policy_profile_id) values ('${requestId}', 'confirmed', 1, 'rfq', 'competitive_bidding', 'standard', '81000000-0000-0000-0000-000000000020');
      insert into core.vendors(id, legal_name) values ${vendorIds.map((id, index) => `('${id}', 'Governed vendor ${index + 1}')`).join(',')};
      insert into test.actor_context values ('${procurementActor}', true, false, null);
      alter table procurement.policy_profiles add column control_sources jsonb not null default '{}'::jsonb;
      alter table procurement.policy_profiles add column effective_from timestamptz default now();
      alter table procurement.policy_profiles add column effective_to timestamptz;
      alter table procurement.requests add column solicitation_requirements jsonb default '{}'::jsonb;
      alter table procurement.requests add column cost_center text;
      alter table procurement.requests add column route_version integer default 1;
    `);
    await this.db.exec(task6);
  }

  async rpc(actor: 'procurement' | 'reviewer' | 'operations' | 'vendor' | 'vendor-additional', name: string, payload: Record<string, unknown>) {
    const actors = { procurement: [procurementActor, true, false, null], reviewer: [reviewerActor, false, true, null], operations: [operationsActor, false, false, null], vendor: [vendorActor, false, false, vendorIds[0]], 'vendor-additional': [additionalVendorActor, false, false, vendorIds[3]] } as const;
    const [id, manage, review, vendorId] = actors[actor];
    await this.db.exec(`delete from test.actor_context; insert into test.actor_context values ('${id}', ${manage}, ${review}, ${vendorId ? `'${vendorId}'` : 'null'});`);
    const allowed = new Set(['save_sourcing_event', 'invite_sourcing_vendors', 'acknowledge_sourcing_invitation', 'record_sourcing_response', 'record_solicitation_communication', 'transition_sourcing_event', 'submit_insufficient_bid_exception', 'review_insufficient_bid_exception', 'sourcing_workspace', 'save_commercial_tabulation', 'submit_technical_evaluation', 'submit_award_recommendation']);
    if (!allowed.has(name)) throw new Error(`Unsupported governed RPC: ${name}`);
    const result = await this.db.query<{ result: unknown }>(`select procurement.${name}(${json(payload)}) as result`);
    return result.rows[0]?.result;
  }

  async close() { if (!this.closed) { this.closed = true; await this.db.close(); } }
}

export const governedSourcing = { eventDeadline, procurementActor, reviewerActor, operationsActor, vendorActor, additionalVendorActor };
