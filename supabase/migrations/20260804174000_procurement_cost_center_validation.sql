-- Keep request department and cost center aligned with the governed directory.

create or replace function private.validate_procurement_request_cost_center()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if nullif(trim(new.department),'') is null or nullif(trim(new.cost_center),'') is null then
    return new;
  end if;
  if not exists(
    select 1 from core.departments department
    join core.department_cost_centers cost_center on cost_center.department_id=department.id
    where department.code=new.department and department.is_active
      and cost_center.code=new.cost_center and cost_center.is_active
  ) then raise exception 'Select an active cost center for the chosen department'; end if;
  return new;
end $$;

drop trigger if exists validate_procurement_request_cost_center on procurement.requests;
create trigger validate_procurement_request_cost_center
before insert or update of department,cost_center on procurement.requests
for each row execute function private.validate_procurement_request_cost_center();

revoke all on function private.validate_procurement_request_cost_center() from public,anon,authenticated;
grant execute on function private.validate_procurement_request_cost_center() to service_role;
