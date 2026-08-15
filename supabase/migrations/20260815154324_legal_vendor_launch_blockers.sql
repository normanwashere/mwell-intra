-- Legal/vendor launch blockers. Forward-only and intentionally isolated from
-- the shared authority remediation migration.

alter table legal.accreditation_cases
  add column if not exists invited_by_user_id uuid references core.profiles(id) on delete restrict,
  add column if not exists technology_service_provider boolean not null default false;

alter table legal.requirement_checklist_items
  add column if not exists reviewer_id uuid references core.profiles(id) on delete restrict,
  add column if not exists policy_id text,
  add column if not exists policy_version text,
  add column if not exists policy_section text;

create or replace function private.legal_tailored_requirement_set(profile jsonb)
returns table(
  code text,
  requirement text,
  description text,
  authority text,
  evidence_format text,
  requirement_group text,
  required boolean,
  instrument boolean,
  instrument_code text,
  template_version text,
  policy_id text,
  policy_version text,
  policy_section text
)
language sql
stable
security definer
set search_path = ''
as $$
  with requirements(
    code, requirement, description, authority, evidence_format,
    requirement_group, entity_types, personal_data_only, technology_only
  ) as (
    values
      ('PH_SEC_REG_ARTICLES_BYLAWS','SEC registration, Articles of Incorporation and By-Laws','Current SEC registration and governing documents.','SEC','pdf','statutory',array['corporation']::text[],false,false),
      ('PH_SECRETARY_CERT','Notarized Secretary''s Certificate or Board Resolution','Authority of the representative signing for the corporation.','Notary / Consular','pdf','governance',array['corporation']::text[],false,false),
      ('PH_GIS','Updated General Information Sheet','Current SEC ownership and officer information.','SEC','pdf','ownership',array['corporation']::text[],false,false),
      ('PH_EXPERTISE_CERTS','Certifications demonstrating expertise','Current certifications relevant to the proposed service.','Vendor','pdf','quality',array['corporation']::text[],false,false),
      ('PH_CLIENT_PORTFOLIO','Portfolio of clients and completed projects with contact details','Experience and reference evidence.','Vendor','pdf','quality',array['corporation']::text[],false,false),
      ('PH_DTI_REG','Registration of Trade Name with DTI','Current DTI registration for a sole proprietor.','DTI','pdf','statutory',array['sole_prop']::text[],false,false),
      ('PH_CLIENT_LIST','Client list and current or past transaction proof with contact details','Experience and reference evidence.','Vendor','pdf','quality',array['sole_prop','partnership']::text[],false,false),
      ('PH_SEC_REG','SEC Certificate of Registration','Current SEC registration for a partnership.','SEC','pdf','statutory',array['partnership']::text[],false,false),
      ('PH_PARTNERSHIP_ARTICLES','Articles of Partnership','Current partnership governing document.','SEC','pdf','governance',array['partnership']::text[],false,false),
      ('PH_PARTNERSHIP_RESOLUTION','Notarized Partnership Resolution','Authority of the representative signing for the partnership.','Notary / Consular','pdf','governance',array['partnership']::text[],false,false),
      ('PH_BIR_2303','BIR Certificate of Registration (Form 2303)','Current tax registration.','BIR','pdf','tax',array['corporation','sole_prop','partnership']::text[],false,false),
      ('PH_MAYORS_PERMIT','Business Permit / Mayor''s Permit','Current local authority to operate.','LGU','pdf','statutory',array['corporation','sole_prop','partnership']::text[],false,false),
      ('PH_AFS_3Y','Audited Financial Statements for the last three years','Financial capacity evidence required by LGL004.','Vendor','pdf','financial',array['corporation','sole_prop','partnership']::text[],false,false),
      ('PH_COMPANY_PROFILE','Company profile','Business, ownership, service, and contact overview.','Vendor','pdf','business_profile',array['corporation','sole_prop','partnership']::text[],false,false),
      ('PH_BANK_PROOF','Bank details / proof of bank account','Validated settlement account evidence.','Insurer / Bank','pdf','financial',array['corporation','sole_prop','partnership']::text[],false,false),
      ('PH_OFFICIAL_RECEIPT','Photocopy of Official Receipt','Tax invoice or official receipt evidence.','BIR','pdf','tax',array['corporation','sole_prop','partnership']::text[],false,false),
      ('PH_PRIVACY_COMPLIANCE','Privacy Impact Assessment or data privacy compliance evidence','Required when the provider will process personal data.','NPC','pdf','privacy',array['corporation','sole_prop','partnership']::text[],true,false),
      ('PH_CYBERSECURITY_POLICIES','Cybersecurity policies','Security policy, access control, incident response, and secure delivery evidence.','Vendor','any','quality',array['corporation','sole_prop','partnership']::text[],false,true)
  ), selected as (
    select r.*
    from requirements r
    where profile->>'entityType' = any(r.entity_types)
      and (not r.personal_data_only or coalesce((profile->>'handlesPersonalData')::boolean,false))
      and (not r.technology_only or coalesce((profile->>'technologyServiceProvider')::boolean,false))
  )
  select
    selected.code, selected.requirement, selected.description,
    selected.authority, selected.evidence_format, selected.requirement_group,
    true, false, null::text, null::text,
    'vendor-accreditation', '2025', 'LGL004 sections A-C'
  from selected
  union all
  select
    case when coalesce((profile->>'technologyServiceProvider')::boolean,false)
      then 'SIGN_MNDA_TECH' else 'SIGN_NDA_STANDARD' end,
    case when coalesce((profile->>'technologyServiceProvider')::boolean,false)
      then 'Technology Service Provider Mutual Non-Disclosure Agreement'
      else 'Standard Non-Disclosure Agreement' end,
    'Approved confidentiality instrument selected from the declared service type.',
    'mWell Legal', 'signed', 'legal_instruments', true, true,
    case when coalesce((profile->>'technologyServiceProvider')::boolean,false)
      then 'nda_mutual' else 'nda_one_way' end,
    case when coalesce((profile->>'technologyServiceProvider')::boolean,false)
      then 'MNDA-Tech-Service-Provider-2026.07.10' else '2026.07.01' end,
    'vendor-accreditation', '2025', 'LGL004 declaration and approved Legal instrument'
  where profile->>'entityType' in ('corporation','sole_prop','partnership');
$$;

revoke all on function private.legal_tailored_requirement_set(jsonb) from public, anon, authenticated;
grant execute on function private.legal_tailored_requirement_set(jsonb) to service_role;

create or replace function legal.invite_vendor(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor core.vendors;
  v_invite legal.vendor_invites;
  v_case legal.accreditation_cases;
  v_command legal.vendor_invite_commands;
  v_idempotency_key text := nullif(pg_catalog.btrim(payload->>'idempotency_key'), '');
  v_request_hash text;
  v_checklist_count integer := 0;
  v_profile jsonb := coalesce(payload->'profile', '{}'::jsonb);
begin
  if auth.role() <> 'service_role' and not core.has_live_cap('legal', 'manage_checklist') then
    raise exception 'Not authorized: legal.manage_checklist';
  end if;
  if auth.uid() is null then
    raise exception 'An attributable inviter is required';
  end if;
  if jsonb_typeof(v_profile->'technologyServiceProvider') is distinct from 'boolean' then
    raise exception 'Technology service provider classification is required before tailoring';
  end if;
  if v_profile->>'entityType' not in ('corporation','sole_prop','partnership') then
    raise exception 'A supported legal entity type is required';
  end if;
  if v_idempotency_key is null or v_idempotency_key !~ '^[A-Za-z0-9_-]{12,128}$' then
    raise exception 'A valid idempotency key is required';
  end if;

  v_request_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'email', lower(pg_catalog.btrim(payload->>'email')),
    'company_name', pg_catalog.btrim(payload->>'company_name'),
    'category', nullif(payload->>'category', ''),
    'profile', v_profile,
    'origin_country', nullif(payload->>'origin_country', '')
  )::text, 'UTF8'), 'sha256'), 'hex');

  insert into legal.vendor_invite_commands(actor_id, idempotency_key, request_hash)
  values (auth.uid(), v_idempotency_key, v_request_hash)
  on conflict (actor_id, idempotency_key) do nothing;

  select * into v_command
  from legal.vendor_invite_commands command
  where command.actor_id = auth.uid() and command.idempotency_key = v_idempotency_key
  for update;
  if v_command.request_hash <> v_request_hash then
    raise exception 'Idempotency key reused with different content';
  end if;
  if v_command.invite_id is not null then
    select * into v_invite from legal.vendor_invites where id = v_command.invite_id;
    select * into v_case from legal.accreditation_cases where id = v_invite.case_id;
    select count(*) into v_checklist_count from legal.requirement_checklist_items where case_id = v_case.id;
    if v_checklist_count = 0 then raise exception 'No authoritative checklist requirements resolved'; end if;
    select * into v_vendor from core.vendors where id = v_invite.vendor_id;
    return jsonb_build_object('invite',to_jsonb(v_invite),'case',to_jsonb(v_case),'vendor',to_jsonb(v_vendor),'idempotent_replay',true);
  end if;

  if exists (
    select 1 from core.profiles profile
    where lower(profile.email) = lower(pg_catalog.btrim(payload->>'email'))
      and (profile.kind = 'employee' or profile.status = 'active')
  ) then raise exception 'This email already belongs to an active account'; end if;

  insert into core.vendors(legal_name, category, accreditation_status, owner_module)
  values (payload->>'company_name', nullif(payload->>'category',''), 'draft', 'legal')
  returning * into v_vendor;

  insert into legal.accreditation_cases(
    vendor_id,vendor_name,category,jurisdiction,origin_country,entity_type,
    vendor_category,risk_tier,contract_type,expected_annual_spend,
    handles_personal_data,technology_service_provider,contact_email,
    invited_by_email,invited_by_user_id
  ) values (
    v_vendor.id,v_vendor.legal_name,nullif(payload->>'category',''),
    v_profile->>'jurisdiction',nullif(payload->>'origin_country',''),
    v_profile->>'entityType',v_profile->>'category',v_profile->>'riskTier',
    v_profile->>'contractType',v_profile->>'spendBand',
    coalesce((v_profile->>'handlesPersonalData')::boolean,false),
    (v_profile->>'technologyServiceProvider')::boolean,
    lower(payload->>'email'),coalesce(payload->>'actor',auth.jwt()->>'email'),auth.uid()
  ) returning * into v_case;

  insert into legal.requirement_checklist_items(
    case_id,code,requirement,description,authority,evidence_format,
    requirement_group,required,instrument,instrument_code,template_version,
    policy_id,policy_version,policy_section
  )
  select v_case.id, tailored.code, tailored.requirement, tailored.description,
    tailored.authority, tailored.evidence_format, tailored.requirement_group,
    tailored.required, tailored.instrument, tailored.instrument_code,
    tailored.template_version, tailored.policy_id, tailored.policy_version,
    tailored.policy_section
  from private.legal_tailored_requirement_set(v_profile) tailored;
  get diagnostics v_checklist_count = row_count;
  if v_checklist_count = 0 then
    raise exception 'No authoritative checklist requirements resolved';
  end if;

  insert into legal.vendor_invites(email,company_name,category,created_by_email,vendor_id,case_id,profile,status)
  values(lower(payload->>'email'),payload->>'company_name',nullif(payload->>'category',''),
    coalesce(payload->>'actor',auth.jwt()->>'email'),v_vendor.id,v_case.id,v_profile,'pending_delivery')
  returning * into v_invite;
  update legal.vendor_invite_commands set invite_id=v_invite.id where id=v_command.id;
  insert into legal.case_timeline(case_id,actor_email,action,detail)
  values(v_case.id,v_invite.created_by_email,'created','Case opened with ' || v_checklist_count || ' policy requirements');
  return jsonb_build_object('invite',to_jsonb(v_invite),'case',to_jsonb(v_case),'vendor',to_jsonb(v_vendor),'idempotent_replay',false);
end;
$$;

revoke all on function legal.invite_vendor(jsonb) from public, anon;
grant execute on function legal.invite_vendor(jsonb) to authenticated, service_role;

create or replace function legal.submit_vendor_application(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_checklist_count integer;
begin
  if auth.role() <> 'service_role' and not core.has_live_cap('core','submit_accreditation') then
    raise exception 'Not authorized: core.submit_accreditation';
  end if;
  select count(*) into v_checklist_count
  from legal.requirement_checklist_items
  where case_id = payload->>'case_id';
  if v_checklist_count = 0 then
    raise exception 'Authoritative checklist is empty; accreditation submission is blocked';
  end if;
  return private.policy_submit_vendor_application(payload);
end;
$$;

alter function legal.review_checklist_item(jsonb)
  rename to review_checklist_item_pre_legal_launch;

create or replace function legal.review_checklist_item(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item legal.requirement_checklist_items;
  v_case legal.accreditation_cases;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'An attributable evidence reviewer is required'; end if;
  if auth.role() <> 'service_role' and not core.has_live_cap('legal','review_accreditation') then
    raise exception 'Not authorized: legal.review_accreditation';
  end if;
  select * into v_item from legal.requirement_checklist_items
  where id=coalesce(nullif(payload->>'id',''),nullif(payload->>'item_id','')) for update;
  if not found then raise exception 'Checklist item not found'; end if;
  select * into v_case from legal.accreditation_cases where id=v_item.case_id;
  if v_case.invited_by_user_id is not distinct from auth.uid() then
    raise exception 'The inviter cannot review accreditation evidence';
  end if;
  v_result := legal.review_checklist_item_pre_legal_launch(payload);
  update legal.requirement_checklist_items set reviewer_id=auth.uid(),updated_at=now()
  where id=v_item.id;
  select to_jsonb(item) into v_result from legal.requirement_checklist_items item where item.id=v_item.id;
  return v_result;
end;
$$;

alter function legal.update_accreditation_doc_status(jsonb)
  rename to update_accreditation_doc_status_pre_legal_launch;

create or replace function legal.update_accreditation_doc_status(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document legal.accreditation_docs;
  v_case legal.accreditation_cases;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'An attributable document reviewer is required'; end if;
  if auth.role() <> 'service_role' and not core.has_live_cap('legal','review_accreditation') then
    raise exception 'Not authorized: legal.review_accreditation';
  end if;
  select * into v_document from legal.accreditation_docs where id=payload->>'doc_id' for update;
  if not found then raise exception 'Accreditation document not found'; end if;
  select * into v_case from legal.accreditation_cases where id=v_document.case_id;
  if v_case.invited_by_user_id is not distinct from auth.uid() then
    raise exception 'The inviter cannot review accreditation evidence';
  end if;
  v_result := legal.update_accreditation_doc_status_pre_legal_launch(payload);
  if v_document.requirement_id is not null then
    update legal.requirement_checklist_items set reviewer_id=auth.uid(),updated_at=now()
    where id=v_document.requirement_id;
  end if;
  return v_result;
end;
$$;

alter function legal.approve_accreditation_case(jsonb)
  rename to approve_accreditation_case_pre_legal_launch;

create or replace function legal.approve_accreditation_case(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case legal.accreditation_cases;
  v_status text := coalesce(nullif(payload->>'decision',''),nullif(payload->>'status',''),'approved');
  v_checklist_count integer;
  v_expiry date;
begin
  if auth.uid() is null then raise exception 'An attributable accreditation decider is required'; end if;
  if auth.role() <> 'service_role' and not core.has_live_cap('legal','approve_accreditation') then
    raise exception 'Not authorized: legal.approve_accreditation';
  end if;
  select * into v_case from legal.accreditation_cases where id=payload->>'id' for update;
  if not found then raise exception 'Accreditation case not found'; end if;
  select count(*) into v_checklist_count from legal.requirement_checklist_items where case_id=v_case.id;
  if v_checklist_count=0 then
    raise exception 'Authoritative checklist is empty; accreditation decision is blocked';
  end if;
  if v_case.invited_by_user_id is not distinct from auth.uid() then
    raise exception 'The inviter cannot decide the accreditation case';
  end if;
  if v_status in ('approved','provisional') and exists (
    select 1 from legal.requirement_checklist_items
    where case_id=v_case.id and required and decision in ('approved','na') and reviewer_id is null
  ) then
    raise exception 'Required evidence must have an attributable reviewer before decision';
  end if;
  if exists (
    select 1 from legal.requirement_checklist_items
    where case_id=v_case.id and reviewer_id is not distinct from auth.uid()
  ) then
    raise exception 'The evidence reviewer cannot decide the accreditation case';
  end if;
  if nullif(pg_catalog.btrim(coalesce(payload->>'note',payload->>'decision_note')),'') is null then
    raise exception 'A decision rationale is required';
  end if;
  if v_status='provisional' then
    v_expiry := coalesce(nullif(payload->>'expires_at','')::date,current_date + 60);
    payload := jsonb_set(payload,'{expires_at}',to_jsonb(v_expiry::text),true);
  elsif v_status='approved' then
    v_expiry := coalesce(nullif(payload->>'expires_at','')::date,current_date + 365);
    payload := jsonb_set(payload,'{expires_at}',to_jsonb(v_expiry::text),true);
  elsif v_status='rejected' then
    payload := payload - 'expires_at';
  end if;
  payload := jsonb_set(payload,'{note}',to_jsonb(pg_catalog.btrim(coalesce(payload->>'note',payload->>'decision_note'))),true);
  return legal.approve_accreditation_case_pre_legal_launch(payload);
end;
$$;

create or replace function procurement.save_doa_matrix(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'An attributable DOA maker is required'; end if;
  if auth.role()<>'service_role'
    and not core.has_live_cap('core','manage_rbac')
    and not core.has_live_cap('legal','manage_doa')
  then raise exception 'Not authorized to draft a DOA matrix'; end if;
  return private.policy_save_doa_matrix(payload);
end;
$$;

create or replace function procurement.activate_doa_matrix(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_created_by uuid;
begin
  if auth.uid() is null then raise exception 'An attributable DOA checker is required'; end if;
  if auth.role()<>'service_role'
    and not core.has_live_cap('core','manage_rbac')
    and not core.has_live_cap('legal','manage_doa')
  then raise exception 'Not authorized to activate a DOA matrix'; end if;
  select created_by into v_created_by from procurement.doa_matrices
  where id=(payload->>'matrix_id')::uuid for update;
  if not found then raise exception 'DOA matrix not found'; end if;
  if v_created_by is not distinct from auth.uid() then
    raise exception 'A separate DOA checker must activate the matrix';
  end if;
  return private.policy_activate_doa_matrix(payload);
end;
$$;

revoke all on function legal.submit_vendor_application(jsonb),
  legal.review_checklist_item_pre_legal_launch(jsonb),legal.review_checklist_item(jsonb),
  legal.update_accreditation_doc_status_pre_legal_launch(jsonb),legal.update_accreditation_doc_status(jsonb),
  legal.approve_accreditation_case_pre_legal_launch(jsonb),legal.approve_accreditation_case(jsonb),
  procurement.save_doa_matrix(jsonb),procurement.activate_doa_matrix(jsonb)
from public, anon;
revoke all on function legal.review_checklist_item_pre_legal_launch(jsonb),
  legal.update_accreditation_doc_status_pre_legal_launch(jsonb),
  legal.approve_accreditation_case_pre_legal_launch(jsonb)
from authenticated;
grant execute on function legal.submit_vendor_application(jsonb),legal.review_checklist_item(jsonb),
  legal.update_accreditation_doc_status(jsonb),legal.approve_accreditation_case(jsonb),
  procurement.save_doa_matrix(jsonb),procurement.activate_doa_matrix(jsonb)
to authenticated, service_role;

alter table legal.vendor_lifecycle_reviews
  drop constraint if exists vendor_lifecycle_reviews_review_type_check;
alter table legal.vendor_lifecycle_reviews
  add constraint vendor_lifecycle_reviews_review_type_check check (
    review_type in ('renewal','document_expiry','performance','reassessment','suspension','offboarding','reinstatement')
  );

create or replace function legal.manage_vendor_lifecycle_review(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review legal.vendor_lifecycle_reviews;
  v_vendor core.vendors;
  v_action text := payload->>'action';
  v_actor uuid := auth.uid();
  v_expiry date;
begin
  if v_actor is null then raise exception 'An attributable lifecycle actor is required'; end if;
  if auth.role()<>'service_role' and not core.has_live_cap('legal','review_accreditation') then
    raise exception 'Not authorized: legal.review_accreditation';
  end if;
  if v_action='open' then
    if payload->>'review_type' not in ('renewal','document_expiry','performance','reassessment','suspension','offboarding','reinstatement')
      or nullif(pg_catalog.btrim(payload->>'reason'),'') is null
    then raise exception 'Review type and reason are required'; end if;
    select * into v_vendor from core.vendors where id=(payload->>'vendor_id')::uuid for update;
    if not found then raise exception 'Vendor not found'; end if;
    if payload->>'review_type'='reinstatement' and v_vendor.accreditation_status not in ('suspended','offboarded') then
      raise exception 'Only suspended or offboarded vendors can enter reinstatement';
    end if;
    insert into legal.vendor_lifecycle_reviews(
      vendor_id,review_type,status,due_date,risk_rating,score,reason,evidence_url,opened_by
    ) values (
      v_vendor.id,payload->>'review_type','open',nullif(payload->>'due_date','')::date,
      nullif(payload->>'risk_rating',''),nullif(payload->>'score','')::numeric,
      pg_catalog.btrim(payload->>'reason'),nullif(pg_catalog.btrim(payload->>'evidence_url'),''),v_actor
    ) returning * into v_review;
  else
    select * into v_review from legal.vendor_lifecycle_reviews
    where id=(payload->>'id')::uuid for update;
    if not found then raise exception 'Vendor lifecycle review not found'; end if;
    if v_action='start' then
      if v_review.status<>'open' then raise exception 'Only an open review can be started'; end if;
      v_review.status:='under_review';
    elsif v_action in ('approve','reject') then
      if v_review.status<>'under_review' then raise exception 'Start the review before a decision'; end if;
      if auth.role()<>'service_role' and not core.has_live_cap('legal','approve_accreditation') then
        raise exception 'Legal decision authority is required';
      end if;
      if nullif(pg_catalog.btrim(payload->>'decision_note'),'') is null then
        raise exception 'A decision rationale is required';
      end if;
      if v_review.opened_by is not distinct from v_actor then
        raise exception 'A separate Legal actor must decide the lifecycle review';
      end if;
      v_review.status:=case v_action when 'approve' then 'approved' else 'rejected' end;
    elsif v_action='complete' then
      if v_review.status<>'approved' then raise exception 'Only an approved review can be completed'; end if;
      if auth.role()<>'service_role' and not core.has_live_cap('legal','approve_accreditation') then
        raise exception 'Legal decision authority is required';
      end if;
      if v_review.review_type in ('renewal','reinstatement') then
        v_expiry:=nullif(payload->>'expires_at','')::date;
        if v_expiry is null or v_expiry<=current_date then
          raise exception 'A future accreditation expiry is required';
        end if;
      end if;
      v_review.status:='completed';
    elsif v_action='cancel' then
      if v_review.status not in ('open','under_review') then raise exception 'A decided review cannot be cancelled'; end if;
      if auth.role()<>'service_role' and not core.has_live_cap('legal','approve_accreditation') then
        raise exception 'Legal decision authority is required';
      end if;
      v_review.status:='cancelled';
    else
      raise exception 'Unsupported vendor lifecycle action';
    end if;

    update legal.vendor_lifecycle_reviews set
      status=v_review.status,
      decision_note=coalesce(nullif(pg_catalog.btrim(payload->>'decision_note'),''),decision_note),
      decided_by=case when v_review.status in ('approved','rejected','completed','cancelled') then v_actor else decided_by end,
      decided_at=case when v_review.status in ('approved','rejected','completed','cancelled') then now() else decided_at end
    where id=v_review.id returning * into v_review;

    if v_review.status='completed' then
      if v_review.review_type='suspension' then
        update core.vendors set accreditation_status='suspended' where id=v_review.vendor_id;
      elsif v_review.review_type='offboarding' then
        update core.vendors set accreditation_status='offboarded' where id=v_review.vendor_id;
        update core.profiles set status='disabled' where vendor_id=v_review.vendor_id and kind='vendor';
      elsif v_review.review_type in ('renewal','reinstatement') then
        update core.vendors set accreditation_status='approved',accreditation_expires_at=v_expiry
        where id=v_review.vendor_id;
        update core.profiles set status='active' where vendor_id=v_review.vendor_id and kind='vendor';
        update legal.accreditation_cases set status='approved',expires_at=v_expiry,updated_at=now()
        where id=(select c.id from legal.accreditation_cases c where c.vendor_id=v_review.vendor_id order by c.created_at desc limit 1)
          and status in ('renewal_due','expired','approved','provisional');
      end if;
    end if;
  end if;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('legal','vendor_lifecycle_review',v_review.id,v_action,v_actor,
    jsonb_build_object('vendor_id',v_review.vendor_id,'review_type',v_review.review_type,'status',v_review.status));
  return to_jsonb(v_review);
end;
$$;

revoke all on function legal.manage_vendor_lifecycle_review(jsonb) from public, anon;
grant execute on function legal.manage_vendor_lifecycle_review(jsonb) to authenticated, service_role;

-- Converge Legal evidence storage to a private bucket. Browser clients receive
-- no service credential and no raw object read policy; the authenticated API
-- authorizes the record and creates a five-minute signed URL server-side.
insert into storage.buckets(id,name,public)
values ('documents', 'documents', false)
on conflict (id) do update set public=false;

drop policy if exists documents_auth_read on storage.objects;
drop policy if exists documents_auth_write on storage.objects;
drop policy if exists documents_legal_vendor_insert on storage.objects;
create policy documents_legal_vendor_insert on storage.objects
for insert to authenticated
with check (
  bucket_id='documents'
  and (
    core.has_live_cap('legal','manage_documents')
    or (
      core.has_any_cap('submit_documents')
      and core.is_vendor()
      and (storage.foldername(name))[1]='vendor'
      and (storage.foldername(name))[2]=core.current_vendor_id()::text
    )
  )
);

create table if not exists legal.document_access_audit(
  id uuid primary key default gen_random_uuid(),
  document_id text not null references legal.accreditation_docs(id) on delete restrict,
  case_id text not null references legal.accreditation_cases(id) on delete restrict,
  actor_id uuid references core.profiles(id) on delete restrict,
  actor_role text not null,
  purpose text not null,
  prepared_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table legal.document_access_audit enable row level security;
alter table legal.document_access_audit force row level security;
drop policy if exists legal_document_access_audit_read on legal.document_access_audit;
create policy legal_document_access_audit_read on legal.document_access_audit
for select to authenticated using (core.has_live_cap('legal','manage_documents'));

create or replace function legal.prepare_document_signed_access(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_document legal.accreditation_docs;
  v_audit legal.document_access_audit;
  v_purpose text:=nullif(pg_catalog.btrim(payload->>'purpose'),'');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_purpose is null then raise exception 'Document access purpose is required'; end if;
  select * into v_document from legal.accreditation_docs
  where id=payload->>'document_id' for share;
  if not found or nullif(v_document.storage_path,'') is null then
    raise exception 'Accreditation document with private storage is required';
  end if;
  if not core.has_live_cap('legal','manage_documents')
    and v_document.vendor_id is distinct from core.current_vendor_id()
  then raise exception 'Not authorized for this accreditation document'; end if;
  insert into legal.document_access_audit(document_id,case_id,actor_id,actor_role,purpose,expires_at)
  values(v_document.id,v_document.case_id,auth.uid(),auth.role(),v_purpose,now()+interval '300 seconds')
  returning * into v_audit;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('legal','accreditation_document',v_document.id,'signed_access_prepared',auth.uid(),
    jsonb_build_object('access_audit_id',v_audit.id,'purpose',v_purpose));
  return jsonb_build_object('storage_path',v_document.storage_path,'expires_in', 300,'access_audit_id',v_audit.id);
end;
$$;

revoke all on function legal.prepare_document_signed_access(jsonb) from public, anon;
grant execute on function legal.prepare_document_signed_access(jsonb) to authenticated, service_role;
revoke all on legal.document_access_audit from public, anon, authenticated;
grant select on legal.document_access_audit to authenticated;

select pg_notify('pgrst','reload schema');
