-- Governed Knowledge Base quality feedback. Personal bookmarks and history stay
-- in the browser; feedback requiring content-owner action is retained centrally.

create table if not exists core.knowledge_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_id text not null,
  content_title text not null,
  content_type text not null,
  content_owner text,
  feedback text not null check (feedback in ('helpful', 'needs_improvement', 'outdated')),
  page_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, content_id)
);

create index if not exists knowledge_feedback_owner_status_idx
  on core.knowledge_feedback (content_owner, feedback, updated_at desc);

alter table core.knowledge_feedback enable row level security;

drop policy if exists read_own_or_audit_knowledge_feedback on core.knowledge_feedback;
create policy read_own_or_audit_knowledge_feedback on core.knowledge_feedback
  for select to authenticated
  using (user_id = auth.uid() or core.has_any_cap('view_audit'));

drop policy if exists create_own_knowledge_feedback on core.knowledge_feedback;
create policy create_own_knowledge_feedback on core.knowledge_feedback
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists update_own_knowledge_feedback on core.knowledge_feedback;
create policy update_own_knowledge_feedback on core.knowledge_feedback
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on core.knowledge_feedback from anon;
grant select, insert, update on core.knowledge_feedback to authenticated;
grant all on core.knowledge_feedback to service_role;
