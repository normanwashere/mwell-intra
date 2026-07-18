-- Approval groups were added after the original core service-role grants.
-- CI certification must be able to prepare and restore isolated approval fixtures.
grant all on table core.approval_groups to service_role;
