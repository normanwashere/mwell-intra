insert into storage.buckets (id, name, public) values ('evidence', 'evidence', false) on conflict (id) do nothing;

drop policy if exists evidence_auth_read on storage.objects;
create policy evidence_auth_read on storage.objects for select to authenticated using (bucket_id = 'evidence');

drop policy if exists evidence_auth_write on storage.objects;
create policy evidence_auth_write on storage.objects for insert to authenticated with check (bucket_id = 'evidence');

drop policy if exists evidence_auth_delete on storage.objects;
create policy evidence_auth_delete on storage.objects for delete to authenticated using (bucket_id = 'evidence');
