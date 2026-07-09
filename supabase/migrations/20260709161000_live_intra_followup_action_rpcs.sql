-- Follow-up controlled actions for the live Intra cutover.

create or replace function legal.send_accreditation_reminder(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = legal, core, public
as $$
declare
  v legal.accreditation_cases;
begin
  if not core.has_cap('legal', 'review_accreditation') then
    raise exception 'Not authorized: legal.review_accreditation';
  end if;

  update legal.accreditation_cases
     set last_reminder_at = now(),
         updated_at = now()
   where id = payload->>'id'
   returning * into v;

  if v.id is null then
    raise exception 'Accreditation case not found';
  end if;

  insert into legal.case_timeline(case_id, actor_email, action, detail)
  values (
    v.id,
    coalesce(payload->>'actor_email', auth.jwt() ->> 'email'),
    'reminder_sent',
    'Reminder sent to ' || coalesce(v.contact_email, v.vendor_name)
  );

  return to_jsonb(v);
end;
$$;

create or replace function procurement.cancel_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = procurement, core, public
as $$
declare
  v procurement.requests;
begin
  update procurement.requests
     set status = 'cancelled',
         updated_at = now()
   where id = payload->>'id'
     and (
       requester_id = auth.uid()
       or core.has_cap('procurement', 'admin')
     )
   returning * into v;

  if v.id is null then
    raise exception 'Request not found or not cancellable by this user';
  end if;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('procurement', 'request', v.id, 'cancelled', auth.uid(), '{}'::jsonb);

  return to_jsonb(v);
end;
$$;

do $$
begin
  revoke all on function legal.send_accreditation_reminder(jsonb) from public, anon;
  grant execute on function legal.send_accreditation_reminder(jsonb) to authenticated, service_role;

  revoke all on function procurement.cancel_request(jsonb) from public, anon;
  grant execute on function procurement.cancel_request(jsonb) to authenticated, service_role;
end $$;

select pg_notify('pgrst', 'reload schema');
