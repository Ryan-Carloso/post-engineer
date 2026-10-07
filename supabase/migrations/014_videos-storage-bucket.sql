-- 014: durable archive for final videos in Supabase Storage.
--
-- Engine disk is ephemeral: a container restart wipes every generated
-- file. The final video (final-1.mp4) is archived to the private `videos`
-- bucket at {user_id}/{persona_id|faceless}/{task_id}/final-1.mp4.
-- The user_id path prefix is what the RLS policies below match on, so
-- every object is scoped to its owning user.

insert into storage.buckets (id, name, public)
values ('videos', 'videos', false)
on conflict (id) do nothing;

-- Users read only their own folder prefix. The engine uploads and mints
-- signed URLs with the service-role key (bypasses RLS); these policies
-- gate direct user-JWT access to Storage.
create policy "videos_select_own"
on storage.objects for select
using (
  bucket_id = 'videos'
  and split_part(name, '/', 1) = auth.uid()::text
);

create policy "videos_insert_own"
on storage.objects for insert
with check (
  bucket_id = 'videos'
  and split_part(name, '/', 1) = auth.uid()::text
);

create policy "videos_update_own"
on storage.objects for update
using (
  bucket_id = 'videos'
  and split_part(name, '/', 1) = auth.uid()::text
);

create policy "videos_delete_own"
on storage.objects for delete
using (
  bucket_id = 'videos'
  and split_part(name, '/', 1) = auth.uid()::text
);
