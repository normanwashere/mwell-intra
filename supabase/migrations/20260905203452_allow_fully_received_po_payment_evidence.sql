-- Receiving closes fully delivered POs before Finance payment. Restore the
-- issued/closed payment contract without reopening POs or admitting cancelled POs.
-- Patch only verified expressions so installed invoice, vendor, evidence, credit,
-- authority and payment controls are retained verbatim. Unexpected drift aborts.
do $migration$
declare
  change record;
  target regprocedure;
  definition text;
begin
  for change in select * from (values
    ('procurement.register_payment_document(jsonb)',
      'po.status<>''issued''', 'po.status not in (''issued'',''closed'')'),
    ('private.policy_prepare_invoice_payment_readiness_pre_sep05(jsonb)',
      'v_po.status<>''issued''', 'v_po.status not in (''issued'',''closed'')'),
    ('private.policy_payment_evidence_blockers(procurement.purchase_orders,procurement.requests,jsonb)',
      'p_po.status <> ''issued''', 'p_po.status not in (''issued'',''closed'')'),
    -- Restore the exact accepted quantity from the same immutable pack IDs
    -- selected for this readiness version, not from PO totals or caller input.
    ('private.policy_prepare_invoice_payment_readiness_pre_sep05(jsonb)',
      'v_po.id,v_ids[1],v_ids,0,v_po.acceptance_evidence_version',
      'v_po.id,v_ids[1],v_ids,(select coalesce(sum((scope_line->>''quantity'')::numeric),0) from procurement.acceptance_packs acceptance cross join lateral jsonb_array_elements(case when jsonb_typeof(acceptance.accepted_scope->''lines'')=''array'' then acceptance.accepted_scope->''lines'' else ''[]''::jsonb end) scope_line where acceptance.id=any(v_ids)),v_po.acceptance_evidence_version')
  ) as changes(signature, old_expression, new_expression)
  loop
    target := to_regprocedure(change.signature);
    if target is null then raise exception 'Required payment function missing: %', change.signature; end if;
    definition := pg_get_functiondef(target);
    if (length(definition)-length(replace(definition,change.old_expression,''))) / length(change.old_expression) <> 1 then
      raise exception 'Payment function changed; review before applying: %', change.signature;
    end if;
    execute replace(definition,change.old_expression,change.new_expression);
  end loop;
end;
$migration$;

-- CREATE OR REPLACE preserves function ownership, OIDs and existing ACLs. Public
-- entry points still delegate through the September document/invoice wrapper.
notify pgrst, 'reload schema';
