-- UAT certification only. No business RPC, policy, ordinary-role grant or SMTP
-- behavior changes. The existing CI service-role channel invokes these guards.
alter function core.verify_security_database_launch_blockers()
  rename to verify_security_database_launch_blockers_pre_vendor_fixture;
revoke all on function core.verify_security_database_launch_blockers_pre_vendor_fixture()
  from public, anon, authenticated, service_role;

create function core.verify_security_database_launch_blockers()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb; selected jsonb; body_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required for launch verification' using errcode = '42501';
  end if;
  result := core.verify_security_database_launch_blockers_pre_vendor_fixture();
  if jsonb_typeof(result->'missing_objects') is distinct from 'array'
    or jsonb_typeof(result->'examples') is distinct from 'array'
    or jsonb_typeof(result->'raw_boundaries') is distinct from 'number' then
    raise exception 'Invalid prior launch verification response';
  end if;
  select jsonb_agg(to_jsonb(r) order by r.code) into selected
    from private.legal_tailored_requirement_set('{"entityType":"sole_prop","jurisdiction":"PH","category":"goods","riskTier":"low","contractType":"standard","handlesPersonalData":false,"technologyServiceProvider":false}'::jsonb) r;
  select encode(sha256(convert_to(replace(p.prosrc, chr(13)||chr(10), chr(10)), 'UTF8')), 'hex')
    into body_hash from pg_catalog.pg_proc p
    where p.oid = 'private.legal_tailored_requirement_set(jsonb)'::regprocedure;
  return result || jsonb_build_object('vendor_fixture_checklist', jsonb_build_object(
    'version', 1, 'function', 'private.legal_tailored_requirement_set',
    'functionBodySha256', body_hash, 'rows', selected));
end; $$;
alter function core.verify_security_database_launch_blockers() owner to postgres;
revoke all on function core.verify_security_database_launch_blockers() from public, anon, authenticated;
grant execute on function core.verify_security_database_launch_blockers() to service_role;

-- No API/table grant: only the fixed guarded RPC may create/read a receipt.
-- This is retained recovery evidence, not a business or certification record.
create table private.uat_vendor_fixture_cleanup_receipts (
  case_id text primary key,
  manifest_text text not null,
  manifest_sha256 text not null,
  receipt jsonb not null,
  committed_at timestamptz not null default now()
);
alter table private.uat_vendor_fixture_cleanup_receipts owner to postgres;
alter table private.uat_vendor_fixture_cleanup_receipts enable row level security;
revoke all on private.uat_vendor_fixture_cleanup_receipts from public, anon, authenticated, service_role;

create function core.cleanup_uat_vendor_application(payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' set lock_timeout = '2s' as $$
<<cleanup>>
declare
  manifest_text text := payload->>'manifestText';
  manifest_hash text := payload->>'sha256';
  manifest jsonb; intent jsonb; scope jsonb; case_id text; folder text;
  expected_id text; selected jsonb; actual jsonb; expected jsonb; item jsonb;
  current_case jsonb; receipt jsonb; storage_objects jsonb; prior private.uat_vendor_fixture_cleanup_receipts%rowtype;
  table_name text; field_name text; relation regclass; fk record; source_column text; target_column text;
  has_foreign boolean; deleted integer; snapshot jsonb := '{}'::jsonb;
  delete_tables constant text[] := array['accreditation_docs','vendor_application_snapshots','case_timeline','requirement_checklist_items','accreditation_cases'];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required for UAT fixture cleanup' using errcode = '42501';
  end if;
  if payload->>'mode' is null or payload->>'mode' not in ('execute','read')
    or manifest_text is null or octet_length(manifest_text) > 4194304
    or manifest_hash is distinct from encode(sha256(convert_to(manifest_text,'UTF8')),'hex') then
    raise exception 'Invalid bounded cleanup manifest';
  end if;
  manifest := manifest_text::jsonb;
  intent := manifest->'intent'; scope := intent->'scope'; case_id := intent#>>'{case,id}';
  if manifest->>'version' is distinct from '1' or manifest->>'bucket' is distinct from 'documents'
    or intent->>'version' is distinct from '1' or intent->>'kind' is distinct from 'synthetic-vendor-application-case'
    or intent->'certificationCredit' is distinct from 'false'::jsonb
    or scope->>'project' is distinct from 'kkoitlvydytdhlpxhuah'
    or coalesce(scope->>'runId','') !~ '^QA-[0-9]{8}-[A-F0-9]{8}$'
    or coalesce(scope->>'buildId','') !~ '^[a-f0-9]{40}$'
    or coalesce(scope->>'viewport','') not in ('desktop-1440','mobile-390')
    or (manifest->>'scopeText')::jsonb is distinct from scope then
    raise exception 'Invalid exact UAT fixture scope';
  end if;
  expected_id := 'qa_vendor_application_' || left(encode(sha256(convert_to(
    '["' || (scope->>'project') || '","' || (scope->>'runId') || '","' || (scope->>'viewport') || '","' || (scope->>'buildId') || '"]', 'UTF8')),'hex'),32);
  if case_id is distinct from expected_id
    or coalesce(intent#>>'{case,scope}','') !~ ('^SYNTHETIC QA ONLY ' || encode(sha256(convert_to(manifest->>'scopeText','UTF8')),'hex') || ' [a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
    or intent#>>'{case,vendor_name}' is distinct from (scope->>'runId') || '-' || (scope->>'viewport') || ' SYNTHETIC Application'
    or intent#>>'{vendor,legal_name}' is distinct from 'MWELL UAT Test Vendor'
    or intent#>>'{actor,profile,email}' is distinct from 'intra.test.vendor@mwell.com.ph'
    or intent#>>'{actor,profile,kind}' is distinct from 'vendor'
    or intent#>>'{actor,profile,status}' is distinct from 'active'
    or intent#>>'{legalActor,profile,email}' is distinct from 'intra.test.legal.lead@mwell.com.ph'
    or intent#>>'{legalActor,profile,kind}' is distinct from 'employee'
    or intent#>>'{legalActor,profile,status}' is distinct from 'active'
    or intent#>>'{case,contact_email}' is distinct from intent#>>'{actor,profile,email}'
    or intent#>>'{case,invited_by_email}' is distinct from intent#>>'{legalActor,profile,email}'
    or intent#>>'{case,invited_by_user_id}' is distinct from intent#>>'{legalActor,profile,id}'
    or intent#>>'{case,vendor_id}' is distinct from intent#>>'{vendor,id}'
    or intent#>>'{actor,profile,vendor_id}' is distinct from intent#>>'{vendor,id}'
    or intent#>>'{invite,vendor_id}' is distinct from intent#>>'{vendor,id}'
    or intent#>>'{invite,auth_user_id}' is distinct from intent#>>'{actor,profile,id}'
    or intent#>>'{invite,status}' is distinct from 'accepted'
    or coalesce((intent#>>'{invite,link_generation}')::integer,0) <= 0
    or intent#>'{invite,accepted_generation}' is distinct from intent#>'{invite,link_generation}'
    or intent#>>'{invite,case_id}' is not distinct from case_id
    or not coalesce((intent->'case') @> '{"status":"draft","entity_type":"sole_prop","jurisdiction":"PH","category":"goods","vendor_category":"goods","risk_tier":"low","contract_type":"standard","handles_personal_data":false,"technology_service_provider":false}'::jsonb, false) then
    raise exception 'Fixture provenance identity or case binding mismatch';
  end if;
  select jsonb_agg(to_jsonb(r) || jsonb_build_object('id',case_id||'_'||r.code,'case_id',case_id,'decision','pending') order by r.code)
    into selected from private.legal_tailored_requirement_set('{"entityType":"sole_prop","jurisdiction":"PH","category":"goods","riskTier":"low","contractType":"standard","handlesPersonalData":false,"technologyServiceProvider":false}'::jsonb) r;
  if intent->'checklist' is distinct from selected
    or jsonb_typeof(manifest->'snapshot') is distinct from 'object'
    or jsonb_typeof(manifest->'storagePaths') is distinct from 'array'
    or jsonb_array_length(manifest->'storagePaths') >= 100 then
    raise exception 'Fixture checklist or snapshot provenance mismatch';
  end if;
  folder := 'vendor/' || (intent#>>'{vendor,id}') || '/legal/accreditation/' || case_id || '/';
  for item in select value from jsonb_array_elements(manifest->'storagePaths') loop
    if jsonb_typeof(item) is distinct from 'string' or left(item#>>'{}',length(folder)) is distinct from folder
      or substring(item#>>'{}' from length(folder)+1) !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}_SYNTHETIC-QA-[A-Z0-9_]+[.]pdf$' then
      raise exception 'Foreign storage path in cleanup manifest';
    end if;
    if not exists(select 1 from jsonb_array_elements(selected) s where s->'instrument'='false'::jsonb
      and right(item#>>'{}',length('_SYNTHETIC-QA-'||(s->>'code')||'.pdf')) = '_SYNTHETIC-QA-'||(s->>'code')||'.pdf') then
      raise exception 'Unowned Storage requirement code';
    end if;
  end loop;
  select * into prior from private.uat_vendor_fixture_cleanup_receipts r where r.case_id = cleanup.case_id;
  if found then
    if prior.manifest_text is distinct from manifest_text or prior.manifest_sha256 is distinct from manifest_hash then
      raise exception 'Cleanup receipt belongs to another manifest';
    end if;
    -- Storage is deliberately outside the DB transaction. On every recovery
    -- read, reject replacement/unowned objects and newly introduced references.
    for item in select jsonb_build_object('id',o.id,'name',o.name,'ownerId',o.owner_id,
      'createdAt',o.created_at,'updatedAt',o.updated_at,'metadata',o.metadata)
      from storage.objects o where o.bucket_id='documents' and left(o.name,length(folder))=folder loop
      if not (prior.receipt->'storageObjects' @> jsonb_build_array(item)) then
        raise exception 'Storage object changed after committed cleanup'; end if;
    end loop;
    if exists(select 1 from legal.accreditation_docs d where manifest->'storagePaths' @> jsonb_build_array(d.storage_path))
      or exists(select 1 from legal.instrument_documents d where manifest->'storagePaths' @> jsonb_build_array(d.storage_path))
      or exists(select 1 from core.documents d where manifest->'storagePaths' @> jsonb_build_array(d.storage_path))
      or exists(select 1 from private.action_evidence d where manifest->'storagePaths' @> jsonb_build_array(d.storage_path)) then
      raise exception 'Foreign storage reference after committed cleanup';
    end if;
    return prior.receipt;
  end if;
  if payload->>'mode' = 'read' then return '{"receipt":null}'::jsonb; end if;
  -- No automatic retry on lock conflict. A new invocation first reads a receipt.
  if not pg_try_advisory_xact_lock(hashtextextended(case_id, 0)) then
    raise exception 'Fixture cleanup is already active' using errcode = '55P03';
  end if;
  select to_jsonb(v) into actual from core.vendors v where v.id = (intent#>>'{vendor,id}')::uuid for update nowait;
  if not coalesce(actual @> (intent->'vendor'),false) then raise exception 'Protected vendor binding changed'; end if;
  select to_jsonb(p) into actual from core.profiles p where p.id = (intent#>>'{actor,profile,id}')::uuid for update nowait;
  if not coalesce(actual @> (intent#>'{actor,profile}'),false) then raise exception 'Protected account binding changed'; end if;
  select to_jsonb(p) into actual from core.profiles p where p.id = (intent#>>'{legalActor,profile,id}')::uuid for update nowait;
  if not coalesce(actual @> (intent#>'{legalActor,profile}'),false) then raise exception 'Protected legal actor binding changed'; end if;
  select to_jsonb(i) into actual from legal.vendor_invites i where i.id = intent#>>'{invite,id}' for update nowait;
  if not coalesce(actual @> (intent->'invite'),false) then raise exception 'Protected invite binding changed'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'ownerId',o.owner_id,
    'createdAt',o.created_at,'updatedAt',o.updated_at,'metadata',o.metadata) order by o.name),'[]'::jsonb)
    into storage_objects from (select * from storage.objects s where s.bucket_id='documents'
      and left(s.name,length(folder))=folder order by s.name limit 100 for share nowait) o;
  if jsonb_array_length(storage_objects) <> jsonb_array_length(manifest->'storagePaths')
    or exists(select 1 from jsonb_array_elements(storage_objects) o
      where o->>'ownerId' is distinct from intent#>>'{actor,profile,id}'
        or not (manifest->'storagePaths' @> jsonb_build_array(o->>'name'))) then
    raise exception 'Storage ownership or manifest changed';
  end if;
  -- Lock parent first: its enforced FKs prevent concurrent child insertion.
  -- Existing child reviews lock their own rows, so lock and CAS those as well.
  foreach table_name in array array['accreditation_cases','requirement_checklist_items','accreditation_docs','vendor_application_snapshots','case_timeline'] loop
    -- Compatible with ordinary DML. Blocks concurrent DDL changing FK/cascade
    -- semantics between catalog inspection and deletion.
    execute format('lock table legal.%I in row exclusive mode nowait',table_name);
    if table_name <> 'accreditation_cases' and not exists(
      select 1 from pg_catalog.pg_constraint c
      join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and c.conkey=array[a.attnum]::smallint[]
      join pg_catalog.pg_attribute b on b.attrelid=c.confrelid and c.confkey=array[b.attnum]::smallint[]
      where c.contype='f' and c.convalidated and a.attname='case_id' and b.attname='id'
        and c.conrelid=format('legal.%I',table_name)::regclass and c.confrelid='legal.accreditation_cases'::regclass
    ) then raise exception 'Missing enforced case reference: %',table_name; end if;
    field_name := case when table_name = 'accreditation_cases' then 'id' else 'case_id' end;
    expected := manifest->'snapshot'->table_name;
    if jsonb_typeof(expected) is distinct from 'array' or jsonb_array_length(expected) >= 1000 then
      raise exception 'Missing or unbounded expected snapshot';
    end if;
    execute format('select coalesce(jsonb_agg(to_jsonb(t) order by t.id),''[]''::jsonb) from (select * from legal.%I where %I = $1 order by id limit 1000 for update nowait) t',table_name,field_name)
      into actual using case_id;
    if actual is distinct from expected then raise exception 'Concurrent fixture snapshot changed: %', table_name; end if;
    snapshot := snapshot || jsonb_build_object(table_name,actual);
  end loop;
  if jsonb_array_length(snapshot->'accreditation_cases') <> 1 then
    raise exception 'Exact case absent without committed cleanup receipt';
  end if;
  current_case := snapshot->'accreditation_cases'->0;
  if not coalesce((current_case - 'status') @> ((intent->'case') - 'status'),false)
    or coalesce(current_case->>'status','') not in ('draft','submitted')
    or current_case->>'decided_at' is not null or current_case->>'decided_by_email' is not null then
    raise exception 'Case changed or independently reviewed';
  end if;
  for item in select value from jsonb_array_elements(snapshot->'requirement_checklist_items') loop
    if not exists(select 1 from jsonb_array_elements(selected) s where item @> s)
      or item->>'reviewer_id' is not null or item->>'reviewer_email' is not null or item->>'reviewed_at' is not null
      or nullif(item->>'reviewer_note','') is not null then
      raise exception 'Unowned or reviewed checklist snapshot';
    end if;
  end loop;
  for item in select value from jsonb_array_elements(snapshot->'accreditation_docs') loop
    if item->>'vendor_id' is distinct from intent#>>'{vendor,id}'
      or item->>'uploaded_by_email' is distinct from 'intra.test.vendor@mwell.com.ph'
      or item->>'status' is distinct from 'submitted'
      or item->>'reviewer_note' is not null
      or not exists(select 1 from jsonb_array_elements(selected) s where s->>'id' = item->>'requirement_id' and s->'instrument' = 'false'::jsonb)
      or not (manifest->'storagePaths' @> jsonb_build_array(item->>'storage_path')) then
      raise exception 'Foreign or reviewed document snapshot';
    end if;
  end loop;
  for item in select value from jsonb_array_elements(snapshot->'vendor_application_snapshots') loop
    if item->>'created_by' is distinct from intent#>>'{actor,profile,id}'
      or item->>'vendor_id' is distinct from intent#>>'{vendor,id}'
      or coalesce(item->>'status','') not in ('draft','submitted','superseded') then raise exception 'Foreign application snapshot'; end if;
  end loop;
  for item in select value from jsonb_array_elements(snapshot->'case_timeline') loop
    if coalesce(item->>'actor_email','') not in ('intra.test.vendor@mwell.com.ph','intra.test.legal.lead@mwell.com.ph') then
      raise exception 'Foreign timeline snapshot'; end if;
  end loop;
  -- Inspect every incoming FK, including future schemas. Do not silently CASCADE
  -- or SET NULL on anything except the exact locked deletion set. Composite FKs
  -- require a reviewed extension instead of guessing their ownership semantics.
  foreach table_name in array delete_tables loop
    relation := format('legal.%I',table_name)::regclass;
    field_name := case when table_name = 'accreditation_cases' then 'id' else 'case_id' end;
    for fk in select c.*, n.nspname, r.relname from pg_catalog.pg_constraint c
      join pg_catalog.pg_class r on r.oid=c.conrelid join pg_catalog.pg_namespace n on n.oid=r.relnamespace
      where c.contype='f' and c.confrelid=relation loop
      if cardinality(fk.conkey) <> 1 or cardinality(fk.confkey) <> 1 or not fk.convalidated then
        raise exception 'Unreviewed foreign reference constraint'; end if;
      select attname into source_column from pg_catalog.pg_attribute where attrelid=fk.conrelid and attnum=fk.conkey[1];
      select attname into target_column from pg_catalog.pg_attribute where attrelid=fk.confrelid and attnum=fk.confkey[1];
      execute format('select exists(select 1 from %I.%I s join legal.%I t on s.%I=t.%I where t.%I=$1 %s)',
        fk.nspname,fk.relname,table_name,source_column,target_column,field_name,
        case when fk.nspname='legal' and fk.relname=any(delete_tables) and fk.relname<>'accreditation_cases'
          then 'and s.case_id is distinct from $1' else '' end) into has_foreign using case_id;
      if has_foreign then raise exception 'Foreign reference blocks cleanup: %.%',fk.nspname,fk.relname; end if;
    end loop;
  end loop;
  if exists(select 1 from legal.accreditation_docs d where d.case_id <> cleanup.case_id
      and manifest->'storagePaths' @> jsonb_build_array(d.storage_path))
    or exists(select 1 from legal.instrument_documents d where manifest->'storagePaths' @> jsonb_build_array(d.storage_path))
    or exists(select 1 from core.documents d where manifest->'storagePaths' @> jsonb_build_array(d.storage_path))
    or exists(select 1 from private.action_evidence d where manifest->'storagePaths' @> jsonb_build_array(d.storage_path)) then
    raise exception 'Foreign storage reference'; end if;
  foreach table_name in array delete_tables loop
    field_name := case when table_name='accreditation_cases' then 'id' else 'case_id' end;
    -- Full-row CAS is repeated at DELETE, not just at the preflight read.
    execute format('delete from legal.%I t where %I=$1 and exists(select 1 from jsonb_array_elements($2) e where to_jsonb(t)=e)',table_name,field_name)
      using case_id,snapshot->table_name;
    get diagnostics deleted = row_count;
    if deleted <> jsonb_array_length(snapshot->table_name) then raise exception 'Delete CAS changed: %',table_name; end if;
    execute format('select exists(select 1 from legal.%I where %I=$1)',table_name,field_name) into has_foreign using case_id;
    if has_foreign then raise exception 'Delete verification failed: %',table_name; end if;
  end loop;
  select to_jsonb(v) into actual from core.vendors v where v.id=(intent#>>'{vendor,id}')::uuid;
  if not coalesce(actual @> (intent->'vendor'),false) then raise exception 'Protected vendor changed during deletion'; end if;
  select to_jsonb(p) into actual from core.profiles p where p.id=(intent#>>'{actor,profile,id}')::uuid;
  if not coalesce(actual @> (intent#>'{actor,profile}'),false) then raise exception 'Protected account changed during deletion'; end if;
  select to_jsonb(p) into actual from core.profiles p where p.id=(intent#>>'{legalActor,profile,id}')::uuid;
  if not coalesce(actual @> (intent#>'{legalActor,profile}'),false) then raise exception 'Protected legal actor changed during deletion'; end if;
  select to_jsonb(i) into actual from legal.vendor_invites i where i.id=intent#>>'{invite,id}';
  if not coalesce(actual @> (intent->'invite'),false) then raise exception 'Protected invite changed during deletion'; end if;
  receipt := jsonb_build_object('version',1,'complete',true,'caseId',case_id,'manifestSha256',manifest_hash,
    'scope',scope,'databaseRemaining',0,'storageDeleted',false,'storageObjects',storage_objects,'certificationCredit',false);
  insert into private.uat_vendor_fixture_cleanup_receipts(case_id,manifest_text,manifest_sha256,receipt)
    values(case_id,manifest_text,manifest_hash,receipt);
  return receipt;
end; $$;
alter function core.cleanup_uat_vendor_application(jsonb) owner to postgres;
revoke all on function core.cleanup_uat_vendor_application(jsonb) from public, anon, authenticated;
grant execute on function core.cleanup_uat_vendor_application(jsonb) to service_role;
notify pgrst, 'reload schema';
