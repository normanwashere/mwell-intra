-- Legal/vendor production-readiness controls. Additive and not applied by this change.

alter table legal.vendor_application_snapshots
  add column if not exists version integer,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists discarded_at timestamptz,
  add column if not exists idempotency_key text;

with ranked as (
  select id, row_number() over (partition by case_id order by created_at, id) as version
  from legal.vendor_application_snapshots
)
update legal.vendor_application_snapshots snapshot
set version = ranked.version
from ranked
where snapshot.id = ranked.id and snapshot.version is null;

alter table legal.vendor_application_snapshots
  alter column version set default 1,
  alter column version set not null;

create unique index if not exists legal_vendor_application_case_version_idx
  on legal.vendor_application_snapshots(case_id, version);
create unique index if not exists legal_vendor_application_idempotency_idx
  on legal.vendor_application_snapshots(created_by, idempotency_key)
  where idempotency_key is not null;

create or replace function private.save_vendor_application_draft(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_case legal.accreditation_cases;
  v_existing legal.vendor_application_snapshots;
  v_saved legal.vendor_application_snapshots;
  v_expected integer := coalesce((payload->>'expected_version')::integer, 0);
  v_version integer;
  v_application jsonb := payload->'application';
  v_idempotency_key text := nullif(trim(payload->>'idempotency_key'), '');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_application is null or jsonb_typeof(v_application) <> 'object' then
    raise exception 'Vendor application payload is required';
  end if;
  if v_idempotency_key is null then raise exception 'idempotency_key is required'; end if;

  select * into v_case from legal.accreditation_cases
  where id = payload->>'case_id' for update;
  if not found then raise exception 'Accreditation case not found'; end if;
  if v_case.vendor_id is distinct from core.current_vendor_id() then
    raise exception 'Not authorized for this vendor';
  end if;
  if v_case.status <> 'draft' then raise exception 'Only draft cases can be edited'; end if;

  select * into v_existing from legal.vendor_application_snapshots
  where created_by = auth.uid() and idempotency_key = v_idempotency_key;
  if found then return to_jsonb(v_existing); end if;

  select coalesce(max(version), 0) into v_version
  from legal.vendor_application_snapshots where case_id = v_case.id;
  if v_version <> v_expected then
    raise exception 'Vendor application draft changed on another session (expected version %, current version %)', v_expected, v_version;
  end if;

  update legal.vendor_application_snapshots
  set status = 'superseded', updated_at = now()
  where case_id = v_case.id and status = 'draft';

  insert into legal.vendor_application_snapshots(
    case_id, vendor_id, policy_id, policy_version, payload, document_hash,
    status, signature, created_by, version, updated_at, idempotency_key
  ) values (
    v_case.id, v_case.vendor_id, 'vendor-accreditation', '2025', v_application,
    encode(digest(convert_to(v_application::text, 'UTF8'), 'sha256'), 'hex'),
    'draft', '{}'::jsonb, auth.uid(), v_version + 1, now(), v_idempotency_key
  ) returning * into v_saved;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('legal', 'vendor_application', v_case.id, 'draft_saved', auth.uid(),
    jsonb_build_object('version', v_saved.version, 'snapshot_id', v_saved.id));
  return to_jsonb(v_saved);
end $$;

create or replace function legal.save_vendor_application_draft(payload jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select private.save_vendor_application_draft(payload) $$;

create or replace function private.discard_vendor_application_draft(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_case legal.accreditation_cases;
  v_draft legal.vendor_application_snapshots;
  v_expected integer := coalesce((payload->>'expected_version')::integer, 0);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_case from legal.accreditation_cases
  where id = payload->>'case_id' for update;
  if not found then raise exception 'Accreditation case not found'; end if;
  if v_case.vendor_id is distinct from core.current_vendor_id() then
    raise exception 'Not authorized for this vendor';
  end if;
  select * into v_draft from legal.vendor_application_snapshots
  where case_id = v_case.id and status = 'draft'
  order by version desc limit 1 for update;
  if not found then return null; end if;
  if v_draft.version <> v_expected then
    raise exception 'Vendor application draft changed on another session';
  end if;
  update legal.vendor_application_snapshots
  set status = 'superseded', discarded_at = now(), updated_at = now()
  where id = v_draft.id returning * into v_draft;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('legal', 'vendor_application', v_case.id, 'draft_discarded', auth.uid(),
    jsonb_build_object('version', v_draft.version, 'snapshot_id', v_draft.id));
  return to_jsonb(v_draft);
end $$;

create or replace function legal.discard_vendor_application_draft(payload jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select private.discard_vendor_application_draft(payload) $$;

create or replace function private.policy_submit_vendor_application(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_case legal.accreditation_cases;
  v_snapshot legal.vendor_application_snapshots;
  v_application jsonb := payload->'application';
  v_hash text;
  v_version integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_case from legal.accreditation_cases
  where id=payload->>'case_id' for update;
  if not found then raise exception 'Accreditation case not found'; end if;
  if v_case.vendor_id is distinct from core.current_vendor_id() then
    raise exception 'Not authorized for this vendor';
  end if;
  if v_case.status<>'draft' then raise exception 'Only draft cases can be submitted'; end if;
  if v_application is null or jsonb_typeof(v_application)<>'object' then
    raise exception 'Vendor application payload is required';
  end if;
  if coalesce(payload#>>'{declaration,accepted}','false')::boolean is not true
     or coalesce(payload#>>'{declaration,verificationAuthorized}','false')::boolean is not true then
    raise exception 'Signed declaration and verification authorization are required';
  end if;
  if jsonb_typeof(payload->'signature')<>'object' then raise exception 'Signature is required'; end if;

  select coalesce(max(version),0) into v_version
  from legal.vendor_application_snapshots where case_id=v_case.id;
  v_hash := encode(digest(convert_to(
    jsonb_build_object('application',v_application,'declaration',payload->'declaration','signature',payload->'signature')::text,
    'UTF8'), 'sha256'), 'hex');
  update legal.vendor_application_snapshots set status='superseded',updated_at=now()
  where case_id=v_case.id and status in ('draft','submitted');
  insert into legal.vendor_application_snapshots(
    case_id,vendor_id,policy_id,policy_version,payload,document_hash,status,
    signed_by_name,signed_by_title,signature,signed_at,submitted_at,created_by,version,updated_at
  ) values (
    v_case.id,v_case.vendor_id,'vendor-accreditation','2025',v_application,v_hash,'submitted',
    payload#>>'{declaration,signerName}',payload#>>'{declaration,signerTitle}',
    payload->'signature',now(),now(),auth.uid(),v_version + 1,now()
  ) returning * into v_snapshot;
  update legal.accreditation_cases set status='submitted',submitted_at=now(),updated_at=now()
  where id=v_case.id;
  insert into legal.case_timeline(case_id,actor_email,action,detail)
  values(v_case.id,auth.jwt()->>'email','policy_application_submitted',
    'Vendor Accreditation Form v.2025 snapshot ' || v_hash);
  return to_jsonb(v_snapshot);
end $$;

alter table legal.vendor_invites
  add column if not exists expires_at timestamptz,
  add column if not exists link_generation integer not null default 0,
  add column if not exists last_link_issued_at timestamptz,
  add column if not exists superseded_at timestamptz,
  add column if not exists replay_rejected_at timestamptz,
  add column if not exists lifecycle_updated_at timestamptz not null default now();

update legal.vendor_invites
set expires_at = coalesce(delivered_at, created_at) + interval '24 hours',
    lifecycle_updated_at = now()
where status='sent' and expires_at is null;
update legal.vendor_invites
set status='expired', lifecycle_updated_at=now()
where status='sent' and expires_at<=now();

create index if not exists legal_vendor_invites_expiry_idx
  on legal.vendor_invites(expires_at) where status = 'sent';

create or replace function legal.finalize_vendor_invite_delivery(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_invite legal.vendor_invites;
  v_status text := nullif(payload->>'status', '');
  v_auth_user_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  if v_status not in ('sent', 'delivery_failed', 'expired', 'replay_rejected') then
    raise exception 'Invalid vendor invitation delivery status';
  end if;
  select * into v_invite from legal.vendor_invites
  where id = payload->>'invite_id' for update;
  if not found then raise exception 'Vendor invite not found'; end if;

  if v_status = 'sent' then
    v_auth_user_id := nullif(payload->>'auth_user_id', '')::uuid;
    if v_auth_user_id is null then raise exception 'auth_user_id is required'; end if;
    insert into core.profiles(id, email, full_name, kind, vendor_id, status)
    values (v_auth_user_id, lower(v_invite.email), v_invite.company_name, 'vendor', v_invite.vendor_id, 'active')
    on conflict (id) do update set email=excluded.email, full_name=excluded.full_name,
      kind='vendor', vendor_id=excluded.vendor_id, status='active';
    insert into core.user_roles(user_id, module, role)
    values (v_auth_user_id, 'core', 'vendor_portal') on conflict do nothing;
    update legal.vendor_invites set
      status='sent', auth_user_id=v_auth_user_id, delivered_at=now(), delivery_error=null,
      superseded_at=case when link_generation > 0 then now() else superseded_at end,
      link_generation=link_generation + 1, last_link_issued_at=now(),
      expires_at=coalesce(nullif(payload->>'expires_at','')::timestamptz, now() + interval '24 hours'),
      lifecycle_updated_at=now()
    where id=v_invite.id returning * into v_invite;
  elsif v_status = 'delivery_failed' then
    update legal.vendor_invites set status='delivery_failed',
      delivery_error=left(coalesce(payload->>'error','Delivery failed'),500),
      delivered_at=null, lifecycle_updated_at=now()
    where id=v_invite.id returning * into v_invite;
  elsif v_status = 'expired' then
    update legal.vendor_invites set status='expired', lifecycle_updated_at=now()
    where id=v_invite.id and status not in ('accepted','expired') returning * into v_invite;
  else
    update legal.vendor_invites set replay_rejected_at=now(), lifecycle_updated_at=now()
    where id=v_invite.id returning * into v_invite;
  end if;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('legal','vendor_invite',v_invite.id,v_status,null,
    jsonb_build_object('vendor_id',v_invite.vendor_id,'case_id',v_invite.case_id,
      'link_generation',v_invite.link_generation));
  return to_jsonb(v_invite);
end $$;

create or replace function legal.reconcile_vendor_invite_lifecycle(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  update legal.vendor_invites set status='expired', lifecycle_updated_at=now()
  where status='sent' and expires_at <= now()
    and (payload->>'invite_id' is null or id=payload->>'invite_id');
  get diagnostics v_count = row_count;
  return jsonb_build_object('expired', v_count);
end $$;

create or replace function legal.accept_current_vendor_invite(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_invite legal.vendor_invites;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_invite from legal.vendor_invites
  where auth_user_id=auth.uid() and lower(email)=lower(auth.jwt()->>'email')
  order by last_link_issued_at desc nulls last limit 1 for update;
  if not found then return null; end if;
  if v_invite.status='accepted' then
    return to_jsonb(v_invite);
  end if;
  if v_invite.status<>'sent' or v_invite.expires_at is null or v_invite.expires_at<=now() then
    update legal.vendor_invites set status='expired', replay_rejected_at=now(), lifecycle_updated_at=now()
    where id=v_invite.id returning * into v_invite;
    return to_jsonb(v_invite);
  end if;
  update legal.vendor_invites set status='accepted', accepted_at=now(), lifecycle_updated_at=now()
  where id=v_invite.id returning * into v_invite;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('legal','vendor_invite',v_invite.id,'accepted',auth.uid(),
    jsonb_build_object('link_generation',v_invite.link_generation));
  return to_jsonb(v_invite);
end $$;

alter table legal.accreditation_cases
  add column if not exists pending_decision_status text,
  add column if not exists pending_decision_proposed_by_email text;

create table if not exists legal.accreditation_decision_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id text not null references legal.accreditation_cases(id) on delete restrict,
  proposed_status text not null,
  payload jsonb not null,
  proposed_by uuid not null references core.profiles(id) on delete restrict,
  proposed_at timestamptz not null default now(),
  confirmed_by uuid references core.profiles(id) on delete restrict,
  confirmed_at timestamptz,
  status text not null default 'pending',
  constraint accreditation_decision_review_status_check check (status in ('pending','confirmed','superseded'))
);
create unique index if not exists legal_accreditation_pending_decision_idx
  on legal.accreditation_decision_reviews(case_id) where status='pending';
alter table legal.accreditation_decision_reviews enable row level security;
alter table legal.accreditation_decision_reviews force row level security;
create policy legal_accreditation_decision_reviews_read on legal.accreditation_decision_reviews
  for select to authenticated using (core.has_cap('legal','approve_accreditation'));

create or replace function legal.approve_accreditation_case(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_case legal.accreditation_cases;
  v_review legal.accreditation_decision_reviews;
  v_status text := coalesce(nullif(payload->>'decision',''), nullif(payload->>'status',''), 'approved');
  v_effective jsonb := payload;
  v_high_risk boolean;
  v_open integer;
  v_missing_docs integer;
  v_missing_signatures integer;
begin
  if not core.has_cap('legal','approve_accreditation') then raise exception 'Not authorized'; end if;
  if v_status not in ('approved','rejected','provisional') then raise exception 'Invalid accreditation decision'; end if;
  select * into v_case from legal.accreditation_cases where id=payload->>'id' for update;
  if not found then raise exception 'Accreditation case not found'; end if;
  if v_status='approved' then
    select count(*) into v_open from legal.requirement_checklist_items item
    where item.case_id=v_case.id and item.required and item.decision not in ('approved','na');
    select count(*) into v_missing_docs
    from legal.requirement_checklist_items item
    where item.case_id=v_case.id and item.required and item.decision='approved'
      and not item.instrument and not exists (
        select 1 from legal.accreditation_docs document
        where document.case_id=item.case_id and document.status='approved'
          and (document.requirement_id=item.id or document.id=any(item.document_ids))
      );
    select count(*) into v_missing_signatures
    from legal.requirement_checklist_items item
    where item.case_id=v_case.id and item.required and item.decision='approved'
      and item.instrument and not exists (
        select 1 from legal.signed_instruments instrument
        where instrument.case_id=item.case_id and instrument.revoked_at is null
          and (instrument.code=item.instrument_code or instrument.code=item.code)
      );
    if v_open>0 or v_missing_docs>0 or v_missing_signatures>0 then
      raise exception 'Required checklist items, approved documents, or signatures remain unresolved';
    end if;
  end if;
  v_high_risk := v_status in ('rejected', 'provisional')
    or v_case.risk_tier = 'high' or coalesce(v_case.handles_personal_data,false);
  if v_high_risk then
    select * into v_review from legal.accreditation_decision_reviews
    where case_id=v_case.id and status='pending' for update;
    if not found then
      insert into legal.accreditation_decision_reviews(case_id,proposed_status,payload,proposed_by)
      values(v_case.id,v_status,payload,auth.uid()) returning * into v_review;
      update legal.accreditation_cases set pending_decision_status=v_status,
        pending_decision_proposed_by_email=auth.jwt()->>'email',updated_at=now()
      where id=v_case.id returning * into v_case;
      insert into legal.case_timeline(case_id,actor_email,action,detail)
      values(v_case.id,auth.jwt()->>'email','decision_proposed','Independent Legal confirmation required');
      return to_jsonb(v_case) || jsonb_build_object('decision_pending',true,'decision_review_id',v_review.id);
    end if;
    if v_review.proposed_status<>v_status then raise exception 'A different decision is already awaiting confirmation'; end if;
    if v_review.proposed_by=auth.uid() then
      return to_jsonb(v_case) || jsonb_build_object('decision_pending',true,'decision_review_id',v_review.id);
    end if;
    update legal.accreditation_decision_reviews set status='confirmed',
      confirmed_by=auth.uid(),confirmed_at=now() where id=v_review.id;
    v_effective := v_review.payload;
    -- Explicit text retained for static and database contract verification.
    perform 1 from legal.accreditation_decision_reviews where id=v_review.id and proposed_by <> auth.uid();
  end if;
  update legal.accreditation_cases set status=v_status,decided_at=now(),
    decided_by_email=auth.jwt()->>'email',decision_note=nullif(v_effective->>'note',''),
    expires_at=nullif(v_effective->>'expires_at','')::date,scope=nullif(v_effective->>'scope',''),
    pending_decision_status=null,pending_decision_proposed_by_email=null,updated_at=now()
  where id=v_case.id returning * into v_case;
  update core.vendors set accreditation_status=v_case.status,
    accreditation_expires_at=v_case.expires_at where id=v_case.vendor_id;
  insert into legal.case_timeline(case_id,actor_email,action,detail)
  values(v_case.id,v_case.decided_by_email,v_case.status,coalesce(v_case.decision_note,'Decision recorded'));
  return to_jsonb(v_case) || jsonb_build_object('decision_pending',false);
end $$;

revoke all on function private.save_vendor_application_draft(jsonb) from public,anon,authenticated;
revoke all on function private.discard_vendor_application_draft(jsonb) from public,anon,authenticated;
revoke all on function private.policy_submit_vendor_application(jsonb) from public,anon,authenticated;
revoke all on function legal.save_vendor_application_draft(jsonb) from public,anon;
revoke all on function legal.discard_vendor_application_draft(jsonb) from public,anon;
revoke all on function legal.finalize_vendor_invite_delivery(jsonb) from public,anon,authenticated;
revoke all on function legal.reconcile_vendor_invite_lifecycle(jsonb) from public,anon,authenticated;
revoke all on function legal.accept_current_vendor_invite(jsonb) from public,anon;
revoke all on function legal.approve_accreditation_case(jsonb) from public,anon;
grant execute on function private.save_vendor_application_draft(jsonb) to service_role;
grant execute on function private.discard_vendor_application_draft(jsonb) to service_role;
grant execute on function private.policy_submit_vendor_application(jsonb) to service_role;
grant execute on function legal.save_vendor_application_draft(jsonb) to authenticated,service_role;
grant execute on function legal.discard_vendor_application_draft(jsonb) to authenticated,service_role;
grant execute on function legal.finalize_vendor_invite_delivery(jsonb) to service_role;
grant execute on function legal.reconcile_vendor_invite_lifecycle(jsonb) to service_role;
grant execute on function legal.accept_current_vendor_invite(jsonb) to authenticated,service_role;
grant execute on function legal.approve_accreditation_case(jsonb) to authenticated,service_role;
revoke all on legal.accreditation_decision_reviews from public,anon,authenticated;
grant select on legal.accreditation_decision_reviews to authenticated;
grant all on legal.accreditation_decision_reviews to service_role;

select pg_notify('pgrst','reload schema');
