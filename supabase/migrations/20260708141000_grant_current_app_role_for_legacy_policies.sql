-- Mwell Intra - allow scoped legacy RLS policies to evaluate current role.
--
-- public.procurement_requests now gates on private.current_app_role(). Grant
-- execute to authenticated callers so RLS evaluates the allow-list instead of
-- failing with a function permission error. The function is SECURITY DEFINER
-- and returns only the caller's legacy public.profiles.role.

grant execute on function private.current_app_role() to authenticated;

notify pgrst, 'reload schema';
