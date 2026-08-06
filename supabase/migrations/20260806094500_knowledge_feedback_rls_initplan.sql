-- Evaluate the caller identity once per statement on Knowledge feedback RLS.

drop policy if exists read_own_or_audit_knowledge_feedback
  on core.knowledge_feedback;
create policy read_own_or_audit_knowledge_feedback
  on core.knowledge_feedback
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or core.has_any_cap('view_audit')
  );

drop policy if exists create_own_knowledge_feedback
  on core.knowledge_feedback;
create policy create_own_knowledge_feedback
  on core.knowledge_feedback
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists update_own_knowledge_feedback
  on core.knowledge_feedback;
create policy update_own_knowledge_feedback
  on core.knowledge_feedback
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
