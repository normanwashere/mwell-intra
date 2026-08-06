-- Repair the retained certification request after its obsolete QA owner was retired.
update procurement.requests as request
set
  requester_id = profile.id,
  requester_name = profile.full_name,
  requester_email = profile.email
from core.profiles as profile
where request.requester_id is null
  and lower(request.requester_email) = 'intra.test.proc.requester@mwell.com.ph'
  and lower(profile.email) = 'intra.test.employee@mwell.com.ph';

-- Keep request existence and request ownership as separate authorization states.
create or replace function procurement.commitment_readiness(payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_requester_id uuid;
  v_request_found boolean := false;
  v_has_control_access boolean := false;
begin
  select request.requester_id
    into v_requester_id
  from procurement.requests as request
  where request.id = payload->>'request_id';

  v_request_found := found;
  if not v_request_found then
    raise exception 'Procurement request not found';
  end if;

  v_has_control_access :=
    core.has_cap('procurement','view_dashboard')
    or core.has_cap('procurement','author_po')
    or core.has_cap('procurement','approve_award');

  if v_requester_id is null and not v_has_control_access then
    raise exception 'Procurement request has no active owner';
  end if;

  if v_requester_id is not null
     and auth.uid() <> v_requester_id
     and not v_has_control_access then
    raise exception 'Not authorized to view commitment readiness';
  end if;

  return private.procurement_commitment_readiness(
    payload->>'request_id',
    nullif(payload->>'vendor_id','')::uuid,
    coalesce(nullif(payload->>'phase',''), 'issue')
  ) || jsonb_build_object(
    'canRecordAcceptance',
    coalesce(auth.uid() = v_requester_id, false) or exists (
      select 1
      from procurement.acceptance_reviewer_assignments as assignment
      where assignment.request_id = payload->>'request_id'
        and assignment.reviewer_id = auth.uid()
        and assignment.superseded_at is null
    )
  );
end;
$$;

revoke all on function procurement.commitment_readiness(jsonb) from public, anon;
grant execute on function procurement.commitment_readiness(jsonb) to authenticated, service_role;
