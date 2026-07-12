-- DOA configuration is readable by procurement users and the two roles allowed
-- to administer department matrices: platform administrators and Legal admins.

drop policy if exists procurement_doa_matrices_read on procurement.doa_matrices;
create policy procurement_doa_matrices_read on procurement.doa_matrices
for select to authenticated
using (
  core.has_module_role('procurement')
  or core.has_cap('core', 'manage_rbac')
  or core.has_cap('legal', 'manage_doa')
);

drop policy if exists procurement_doa_assignments_read on procurement.doa_assignments;
create policy procurement_doa_assignments_read on procurement.doa_assignments
for select to authenticated
using (
  core.has_module_role('procurement')
  or core.has_cap('core', 'manage_rbac')
  or core.has_cap('legal', 'manage_doa')
);

notify pgrst, 'reload schema';
