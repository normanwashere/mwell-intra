-- Audit vocabulary only. No restoration, business-row mutation or access change.
-- Execute through the transaction-scoped migration runner.
set local lock_timeout = '3s';
set local statement_timeout = '30s';
do $migration$
declare
  expected_check pg_catalog.pg_constraint;
  operation_column smallint;
begin
  -- Hold the same DDL lock through inspection and replacement of the check.
  lock table private.uat_admin_reset_archives in access exclusive mode;
  select attnum into operation_column from pg_catalog.pg_attribute
    where attrelid='private.uat_admin_reset_archives'::regclass
      and attname='operation' and not attisdropped;
  select * into expected_check from pg_catalog.pg_constraint
    where conrelid='private.uat_admin_reset_archives'::regclass
      and conname='uat_admin_reset_archives_operation_check';
  if not found or expected_check.contype<>'c'
    or not expected_check.convalidated or not expected_check.conislocal
    or expected_check.connoinherit
    or expected_check.conkey is distinct from array[operation_column]::smallint[]
    or pg_catalog.pg_get_constraintdef(expected_check.oid) is distinct from
      'CHECK ((operation = ANY (ARRAY[''reset550''::text, ''seed''::text])))'
    or (select count(*) from pg_catalog.pg_constraint
      where conrelid='private.uat_admin_reset_archives'::regclass
        and contype='c' and operation_column=any(conkey))<>1 then
    raise exception 'UAT archive operation constraint drift';
  end if;
  alter table private.uat_admin_reset_archives
    drop constraint uat_admin_reset_archives_operation_check,
    add constraint uat_admin_reset_archives_operation_check
      check (operation in ('reset550','seed','restore_test_issued_units'));
end;
$migration$;
