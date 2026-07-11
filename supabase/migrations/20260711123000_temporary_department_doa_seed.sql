-- Temporary launch matrices. Replace each through Admin/Legal with an approved
-- revision before financial production use.

do $$
declare
  v_department text;
  v_matrix_id uuid;
  v_dept_head uuid;
  v_procurement_head uuid;
  v_legal uuid;
  v_finance uuid;
  v_final uuid;
begin
  select id into v_dept_head from core.profiles where lower(email)='intra.test.proc.approver@mwell.com.ph';
  select id into v_procurement_head from core.profiles where lower(email)='intra.test.proc.officer@mwell.com.ph';
  select id into v_legal from core.profiles where lower(email)='intra.test.legal.reviewer@mwell.com.ph';
  select id into v_finance from core.profiles where lower(email)='intra.test.proc.finance@mwell.com.ph';
  select id into v_final from core.profiles where lower(email)='intra.test.proc.admin@mwell.com.ph';
  if v_dept_head is null or v_procurement_head is null or v_legal is null or v_finance is null or v_final is null then
    raise exception 'Temporary DOA approver profiles are incomplete';
  end if;

  foreach v_department in array array[
    'IT Operations', 'Operations', 'Marketing', 'Finance', 'Legal',
    'Procurement', 'Human Resources', 'Sales', 'Medical Operations'
  ] loop
    update procurement.doa_matrices set active=false, status='superseded', updated_at=now()
      where lower(department)=lower(v_department) and active;
    insert into procurement.doa_matrices(
      version, department, source_document, approved_by_name, approved_at,
      effective_at, active, status, created_by, activated_by, activated_at
    ) values (
      'TEMP-2026-07-' || upper(replace(v_department,' ', '-')),
      v_department,
      'Temporary launch matrix - replace with approved department DOA',
      'Temporary configuration by Platform Administration', now(), now(), true,
      'active', v_final, v_final, now()
    ) on conflict (version) do update set
      department=excluded.department, source_document=excluded.source_document,
      effective_at=excluded.effective_at, active=true, status='active',
      activated_by=excluded.activated_by, activated_at=excluded.activated_at,
      updated_at=now()
    returning id into v_matrix_id;

    delete from procurement.doa_assignments where matrix_id=v_matrix_id;
    insert into procurement.doa_assignments(
      matrix_id, department, category, min_amount, max_amount, tier, approver_user_id, active
    ) values
      (v_matrix_id,v_department,null,0,null,'dept_head',v_dept_head,true),
      (v_matrix_id,v_department,null,0,null,'procurement_head',v_procurement_head,true),
      (v_matrix_id,v_department,null,0,null,'legal',v_legal,true),
      (v_matrix_id,v_department,null,0,null,'finance',v_finance,true),
      (v_matrix_id,v_department,null,0,null,'final_approver',v_final,true);
    insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
    values('procurement','doa_matrix',v_matrix_id::text,'temporary_doa_seeded',v_final,
      jsonb_build_object('department',v_department,'temporary',true));
  end loop;
end $$;
