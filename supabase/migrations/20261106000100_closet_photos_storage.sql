-- Private bucket for closet photos.
-- Object path contract: {user_id}/{item_id}/{photo_id}.jpg
-- Depends on public.current_user_verified() from the previous migration.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('closet-photos', 'closet-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg'];

-- RLS is already enabled on storage.objects by Supabase.
-- Explicit privileges for the authenticated role (independent of the "expose new tables" project setting).
-- Row access is still limited by the owner-only policies below; anon gets no policy and therefore no rows.
-- Wrapped so a restricted migration role cannot break the migration; if it did, the NOTICE says so and
-- supabase/tests/rls_policies.sql fails until the grants exist.
do $$
begin
  grant usage on schema storage to authenticated;
  grant select, insert, update, delete on table storage.objects to authenticated;
exception when insufficient_privilege then
  raise notice 'Could not grant on storage.objects (insufficient privilege). Run the grants as the project owner, then re-run supabase/tests/rls_policies.sql.';
end
$$;

drop policy if exists "closet_photos_select_own" on storage.objects;
create policy "closet_photos_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'closet-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.current_user_verified())
  );

drop policy if exists "closet_photos_insert_own" on storage.objects;
create policy "closet_photos_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'closet-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.current_user_verified())
  );

drop policy if exists "closet_photos_update_own" on storage.objects;
create policy "closet_photos_update_own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'closet-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.current_user_verified())
  )
  with check (
    bucket_id = 'closet-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.current_user_verified())
  );

drop policy if exists "closet_photos_delete_own" on storage.objects;
create policy "closet_photos_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'closet-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.current_user_verified())
  );
