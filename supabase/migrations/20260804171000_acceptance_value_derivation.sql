-- Derive accepted commercial value from governed acceptance evidence so
-- goods, services, and milestones share one server-computed invoice gate.

create or replace function private.derive_procurement_acceptance_value()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.accepted_amount is not null then return new; end if;
  if new.acceptance_type='goods_receipt' then
    select coalesce(sum((scope_line->>'quantity')::numeric * coalesce(line.unit_price,0)),0)
      into new.accepted_amount
    from jsonb_array_elements(case when jsonb_typeof(new.accepted_scope->'lines')='array'
      then new.accepted_scope->'lines' else '[]'::jsonb end) scope_line
    join procurement.purchase_order_lines line
      on line.id=scope_line->>'poLineId' and line.purchase_order_id=new.purchase_order_id;
  else
    new.accepted_amount:=coalesce((new.accepted_scope->>'acceptedAmount')::numeric,0);
  end if;
  return new;
end $$;

drop trigger if exists derive_procurement_acceptance_value on procurement.acceptance_packs;
create trigger derive_procurement_acceptance_value
before insert or update of accepted_scope,accepted_amount on procurement.acceptance_packs
for each row execute function private.derive_procurement_acceptance_value();

update procurement.acceptance_packs set accepted_amount=null where accepted_amount is null;

revoke all on function private.derive_procurement_acceptance_value() from public,anon,authenticated;
grant execute on function private.derive_procurement_acceptance_value() to service_role;
