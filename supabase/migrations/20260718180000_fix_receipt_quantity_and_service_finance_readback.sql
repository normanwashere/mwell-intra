-- Trusted service verification must observe the same cross-module Finance
-- projection that authenticated Finance users see.
create or replace function core.has_any_cap(p_cap text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.role() = 'service_role', false) or exists (
    select 1
    from core.user_roles ur
    join core.roles r
      on r.module = ur.module
     and r.role = ur.role
     and r.is_active = true
    join core.role_capabilities rc
      on rc.module = ur.module
     and rc.role = ur.role
    where ur.user_id = auth.uid()
      and rc.cap = p_cap
  );
$$;

-- PO quantities are numeric in Procurement and serialize as values such as
-- "1.0000" in the governed receipt facts. Normalize through numeric before
-- converting the already-validated whole quantity to Warehouse's integer unit.
do $$
declare
  target constant regprocedure :=
    'private.warehouse_receive_procurement_po_exception(jsonb)'::regprocedure;
  definition text := pg_get_functiondef(target);
  corrected_definition text;
begin
  corrected_definition := replace(
    definition,
    '(v_input->>''ordered_quantity_at_request'')::integer',
    '(v_input->>''ordered_quantity_at_request'')::numeric::integer'
  );

  if corrected_definition = definition then
    if position(
      '(v_input->>''ordered_quantity_at_request'')::numeric::integer'
      in definition
    ) > 0 then
      return;
    end if;
    raise exception 'Unable to normalize governed receipt ordered quantity';
  end if;

  execute corrected_definition;
end;
$$;
