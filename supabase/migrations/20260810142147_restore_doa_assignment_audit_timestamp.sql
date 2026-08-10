-- Restore the audit timestamp expected by DOA administration. Historical
-- assignments inherit their matrix creation time so revision evidence remains
-- meaningful instead of appearing to have been created during this repair.

alter table procurement.doa_assignments
  add column if not exists created_at timestamptz;

update procurement.doa_assignments assignment
set created_at = coalesce(matrix.created_at, now())
from procurement.doa_matrices matrix
where matrix.id = assignment.matrix_id
  and assignment.created_at is null;

alter table procurement.doa_assignments
  alter column created_at set default now(),
  alter column created_at set not null;

comment on column procurement.doa_assignments.created_at is
  'Immutable audit timestamp for the DOA assignment revision.';

notify pgrst, 'reload schema';
