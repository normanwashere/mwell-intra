-- Mwell Intra — core write RPCs (SECURITY DEFINER, capability-gated)
--
-- Every core write goes through one of these (spec §6.2: server is
-- authoritative; direct table writes are revoked in the RLS migration). Each RPC:
--   * begins with a capability gate — core.has_any_cap('<cap>') for the
--     cross-cutting core resources, or core.has_cap('<module>','<cap>') where a
--     single owning module applies; and
--   * appends a core.activity_log row where the change is material (spec §6.3;
--     RA 10173 access logging, spec §9). `actor` is always forced to auth.uid()
--     so it cannot be forged by the client.
-- The RPC envelope is db.rpc(fn, { payload }) (spec §6.7).
--
-- Re-runnable: create-or-replace functions + idempotent grant loop.

-- ===========================================================================
-- Identity / RBAC administration
-- ===========================================================================

-- Create or update a profile. Gate: manage_rbac (identity administration).
-- Profiles are normally provisioned from Supabase Auth signup; this RPC lets an
-- admin backfill/correct core profile fields. id must equal the auth user id.
create or replace function core.upsert_profile(payload jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare v core.profiles; v_id uuid;
begin
  if not core.has_any_cap('manage_rbac') then raise exception 'Not authorized: manage_rbac'; end if;
  v_id := (payload->>'id')::uuid;
  if v_id is null then raise exception 'profile id (= auth.users.id) is required'; end if;
  insert into core.profiles (id, email, full_name, title, kind, vendor_id, status)
  values (
    v_id,
    payload->>'email',
    payload->>'full_name',
    payload->>'title',
    coalesce(nullif(payload->>'kind',''), 'employee'),
    nullif(payload->>'vendor_id','')::uuid,
    coalesce(nullif(payload->>'status',''), 'active')
  )
  on conflict (id) do update set
    email     = coalesce(excluded.email, core.profiles.email),
    full_name = coalesce(excluded.full_name, core.profiles.full_name),
    title     = coalesce(excluded.title, core.profiles.title),
    kind      = coalesce(nullif(payload->>'kind',''), core.profiles.kind),
    vendor_id = case when payload ? 'vendor_id' then nullif(payload->>'vendor_id','')::uuid else core.profiles.vendor_id end,
    status    = coalesce(nullif(payload->>'status',''), core.profiles.status)
  returning * into v;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('core', 'profile', v.id, 'upserted', auth.uid(),
          jsonb_build_object('email', v.email, 'kind', v.kind, 'status', v.status));
  return to_jsonb(v);
end; $$;

-- Grant a scoped (module, role) to a user. Gate: manage_rbac.
create or replace function core.assign_user_role(payload jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare v core.user_roles;
begin
  if not core.has_any_cap('manage_rbac') then raise exception 'Not authorized: manage_rbac'; end if;
  if not exists (
    select 1 from core.roles r
    where r.module = payload->>'module' and r.role = payload->>'role'
  ) then
    raise exception 'Unknown role %/% (not in core.roles)', payload->>'module', payload->>'role';
  end if;
  insert into core.user_roles (user_id, module, role)
  values ((payload->>'user_id')::uuid, payload->>'module', payload->>'role')
  on conflict (user_id, module, role) do nothing
  returning * into v;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('core', 'user_role', (payload->>'user_id')::uuid, 'role_granted', auth.uid(),
          jsonb_build_object('module', payload->>'module', 'role', payload->>'role'));
  return jsonb_build_object(
    'user_id', payload->>'user_id', 'module', payload->>'module', 'role', payload->>'role'
  );
end; $$;

-- Revoke a scoped (module, role) from a user. Gate: manage_rbac.
create or replace function core.revoke_user_role(payload jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
begin
  if not core.has_any_cap('manage_rbac') then raise exception 'Not authorized: manage_rbac'; end if;
  delete from core.user_roles
  where user_id = (payload->>'user_id')::uuid
    and module = payload->>'module'
    and role = payload->>'role';
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('core', 'user_role', (payload->>'user_id')::uuid, 'role_revoked', auth.uid(),
          jsonb_build_object('module', payload->>'module', 'role', payload->>'role'));
  return jsonb_build_object('ok', true);
end; $$;

-- ===========================================================================
-- Vendor master (spec §4.3) — Legal owns the record; accreditation is separate.
-- ===========================================================================

-- Create or update a vendor's descriptive fields. Gate: manage_vendors.
-- Does NOT touch accreditation_status (that is set_accreditation_status only).
create or replace function core.upsert_vendor(payload jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare v core.vendors; v_id uuid;
begin
  if not core.has_any_cap('manage_vendors') then raise exception 'Not authorized: manage_vendors'; end if;
  v_id := nullif(payload->>'id','')::uuid;
  if v_id is null then
    insert into core.vendors (legal_name, trade_name, tin, category, owner_module)
    values (
      payload->>'legal_name', payload->>'trade_name', payload->>'tin', payload->>'category',
      coalesce(nullif(payload->>'owner_module',''), 'legal')
    )
    returning * into v;
  else
    update core.vendors set
      legal_name   = coalesce(payload->>'legal_name', legal_name),
      trade_name   = coalesce(payload->>'trade_name', trade_name),
      tin          = coalesce(payload->>'tin', tin),
      category     = coalesce(payload->>'category', category),
      owner_module = coalesce(nullif(payload->>'owner_module',''), owner_module)
    where id = v_id
    returning * into v;
    if v.id is null then raise exception 'Vendor not found: %', v_id; end if;
  end if;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('core', 'vendor', v.id, case when v_id is null then 'created' else 'updated' end, auth.uid(),
          jsonb_build_object('legal_name', v.legal_name, 'category', v.category));
  return to_jsonb(v);
end; $$;

-- Transition a vendor's accreditation lifecycle. Gate: manage_accreditation
-- (Legal-owned, spec §4.3/§7). Logs a status_changed audit row.
create or replace function core.set_accreditation_status(payload jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare v core.vendors; v_new text; v_old text;
begin
  if not core.has_any_cap('manage_accreditation') then raise exception 'Not authorized: manage_accreditation'; end if;
  v_new := payload->>'accreditation_status';
  if v_new is null or v_new not in
    ('draft','submitted','under_review','approved','rejected','expired','renewal_due') then
    raise exception 'Invalid accreditation_status: %', coalesce(v_new, '(null)');
  end if;
  select accreditation_status into v_old from core.vendors where id = (payload->>'vendor_id')::uuid;
  if v_old is null then raise exception 'Vendor not found: %', payload->>'vendor_id'; end if;
  update core.vendors set
    accreditation_status = v_new,
    accreditation_expires_at =
      case when payload ? 'accreditation_expires_at'
           then nullif(payload->>'accreditation_expires_at','')::date
           else accreditation_expires_at end
  where id = (payload->>'vendor_id')::uuid
  returning * into v;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('legal', 'vendor', v.id, 'status_changed', auth.uid(),
          jsonb_build_object('from', v_old, 'to', v_new,
                             'expires_at', v.accreditation_expires_at));
  return to_jsonb(v);
end; $$;

-- ===========================================================================
-- Documents (spec §4.4, ADR-002 #1)
-- ===========================================================================

-- Register a document version (metadata only; the file lives in Storage).
-- Gate: manage_documents (internal) OR submit_documents (vendor-tier upload).
-- Vendor-tier callers may only register documents for their OWN vendor record.
create or replace function core.register_document(payload jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare v core.documents; v_entity_type text; v_entity_id uuid;
begin
  if not (core.has_any_cap('manage_documents') or core.has_any_cap('submit_documents')) then
    raise exception 'Not authorized: manage_documents';
  end if;
  v_entity_type := payload->>'entity_type';
  v_entity_id := (payload->>'entity_id')::uuid;
  if v_entity_type is null or v_entity_id is null then
    raise exception 'entity_type and entity_id are required';
  end if;
  -- Vendor-tier lockdown: can only attach to their own vendor record.
  if core.is_vendor() then
    if v_entity_type <> 'vendor' or v_entity_id is distinct from core.current_vendor_id() then
      raise exception 'Vendors may only register documents for their own vendor record.';
    end if;
  end if;
  insert into core.documents (entity_type, entity_id, doc_type, storage_path, version, status, expires_at, uploaded_by)
  values (
    v_entity_type, v_entity_id, payload->>'doc_type', payload->>'storage_path',
    coalesce((payload->>'version')::int, 1),
    coalesce(nullif(payload->>'status',''), 'submitted'),
    nullif(payload->>'expires_at','')::date,
    auth.uid()
  )
  returning * into v;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values (
    coalesce(nullif(payload->>'module',''), 'core'), 'document', v.id, 'created', auth.uid(),
    jsonb_build_object('entity_type', v.entity_type, 'entity_id', v.entity_id,
                       'doc_type', v.doc_type, 'version', v.version, 'storage_path', v.storage_path)
  );
  return to_jsonb(v);
end; $$;

-- ===========================================================================
-- Approvals (spec §4.5)
-- ===========================================================================

-- Open a pending approval step. Gate: manage_approvals (workflow authoring).
create or replace function core.create_approval_step(payload jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare v core.approvals;
begin
  if not core.has_any_cap('manage_approvals') then raise exception 'Not authorized: manage_approvals'; end if;
  insert into core.approvals (entity_type, entity_id, step, approver_role, sla_due_at)
  values (
    payload->>'entity_type', (payload->>'entity_id')::uuid,
    coalesce((payload->>'step')::int, 1),
    payload->>'approver_role',
    nullif(payload->>'sla_due_at','')::timestamptz
  )
  returning * into v;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('core', v.entity_type, v.entity_id, 'approval_requested', auth.uid(),
          jsonb_build_object('approval_id', v.id, 'step', v.step, 'approver_role', v.approver_role));
  return to_jsonb(v);
end; $$;

-- Record a decision on a pending approval step. Gate: record_approval.
create or replace function core.record_approval_decision(payload jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare v core.approvals; v_decision text;
begin
  if not core.has_any_cap('record_approval') then raise exception 'Not authorized: record_approval'; end if;
  v_decision := payload->>'decision';
  if v_decision is null or v_decision not in ('approved','rejected') then
    raise exception 'Decision must be approved or rejected, got %', coalesce(v_decision, '(null)');
  end if;
  update core.approvals set
    decision   = v_decision,
    decided_by = auth.uid(),
    decided_at = now(),
    note       = payload->>'note'
  where id = (payload->>'approval_id')::uuid and decision = 'pending'
  returning * into v;
  if v.id is null then raise exception 'Approval step not found or already decided: %', payload->>'approval_id'; end if;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('core', v.entity_type, v.entity_id, v_decision, auth.uid(),
          jsonb_build_object('approval_id', v.id, 'step', v.step, 'note', v.note));
  return to_jsonb(v);
end; $$;

-- ===========================================================================
-- Activity log + notifications
-- ===========================================================================

-- Append a cross-module audit row (spec §6.3). Callable by any authenticated
-- user; `actor` is forced to auth.uid() so it cannot be forged. Modules call
-- this to log material state changes not already logged by a dedicated RPC.
create or replace function core.log_activity(payload jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare v core.activity_log;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if (payload->>'module') is null or (payload->>'entity_type') is null
     or (payload->>'entity_id') is null or (payload->>'action') is null then
    raise exception 'module, entity_type, entity_id and action are required';
  end if;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values (
    payload->>'module', payload->>'entity_type', (payload->>'entity_id')::uuid,
    payload->>'action', auth.uid(), payload->'detail'
  )
  returning * into v;
  return to_jsonb(v);
end; $$;

-- Enqueue a notification for a user. Gate: manage_notifications (jobs/admins).
create or replace function core.enqueue_notification(payload jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare v core.notifications;
begin
  if not core.has_any_cap('manage_notifications') then raise exception 'Not authorized: manage_notifications'; end if;
  insert into core.notifications (user_id, kind, entity_type, entity_id)
  values (
    (payload->>'user_id')::uuid, payload->>'kind',
    payload->>'entity_type', nullif(payload->>'entity_id','')::uuid
  )
  returning * into v;
  return to_jsonb(v);
end; $$;

-- Mark one of the caller's OWN notifications read. Self-scoped (no cap).
create or replace function core.mark_notification_read(payload jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare v core.notifications;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update core.notifications set read_at = coalesce(read_at, now())
  where id = (payload->>'notification_id')::uuid and user_id = auth.uid()
  returning * into v;
  if v.id is null then raise exception 'Notification not found for current user.'; end if;
  return to_jsonb(v);
end; $$;

-- ===========================================================================
-- Grants — every RPC: never anon; authenticated + service_role may execute.
-- ===========================================================================
do $$
declare fn text;
begin
  foreach fn in array array[
    'upsert_profile', 'assign_user_role', 'revoke_user_role',
    'upsert_vendor', 'set_accreditation_status',
    'register_document',
    'create_approval_step', 'record_approval_decision',
    'log_activity', 'enqueue_notification', 'mark_notification_read'
  ]
  loop
    execute format('revoke all on function core.%I(jsonb) from public, anon;', fn);
    execute format('grant execute on function core.%I(jsonb) to authenticated, service_role;', fn);
  end loop;
end $$;

notify pgrst, 'reload schema';
