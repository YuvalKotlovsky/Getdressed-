-- Static catalog checks for RLS / storage / constraints.
-- Run in the Supabase SQL editor or: psql "$DB_URL" -f supabase/tests/rls_policies.sql
-- Read-only. Raises an exception on the first failure.

do $$
declare
  r record;
  n int;
  cmd_name text;
  b record;
begin
  -- 1. Every table in public has RLS enabled and forced.
  for r in
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    if not r.relrowsecurity then
      raise exception 'RLS CHECK FAILED: public.% does not have row level security enabled', r.relname;
    end if;
    if not r.relforcerowsecurity then
      raise exception 'RLS CHECK FAILED: public.% does not FORCE row level security', r.relname;
    end if;
  end loop;

  if not exists (
    select 1 from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relname = 'wardrobe_items'
  ) then
    raise exception 'RLS CHECK FAILED: public.wardrobe_items does not exist';
  end if;

  -- 2. No policy (public schema, or storage.objects) grants to anon / public.
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where (schemaname = 'public' or (schemaname = 'storage' and tablename = 'objects'))
      and roles && array['anon', 'public']::name[]
      and (
        schemaname = 'public'
        or coalesce(qual, '') || coalesce(with_check, '') like '%closet-photos%'
      )
  loop
    raise exception 'RLS CHECK FAILED: policy % on %.% applies to anon/public',
      r.policyname, r.schemaname, r.tablename;
  end loop;

  if has_table_privilege('anon', 'public.wardrobe_items', 'select,insert,update,delete')
     or has_table_privilege('anon', 'public.wardrobe_items', 'select')
     or has_table_privilege('anon', 'public.wardrobe_items', 'insert')
     or has_table_privilege('anon', 'public.wardrobe_items', 'update')
     or has_table_privilege('anon', 'public.wardrobe_items', 'delete') then
    raise exception 'RLS CHECK FAILED: anon has table privileges on public.wardrobe_items';
  end if;

  if has_function_privilege('anon', 'public.current_user_verified()', 'execute') then
    raise exception 'RLS CHECK FAILED: anon can execute public.current_user_verified()';
  end if;
  if not has_function_privilege('authenticated', 'public.current_user_verified()', 'execute') then
    raise exception 'RLS CHECK FAILED: authenticated cannot execute public.current_user_verified()';
  end if;

  -- 3. wardrobe_items policies: all four commands, authenticated only, verified required.
  foreach cmd_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    select count(*) into n
    from pg_policies
    where schemaname = 'public' and tablename = 'wardrobe_items'
      and cmd = cmd_name
      and roles = array['authenticated']::name[]
      and coalesce(qual, '') || coalesce(with_check, '') like '%current_user_verified%'
      and coalesce(qual, '') || coalesce(with_check, '') like '%auth.uid()%';
    if n < 1 then
      raise exception 'RLS CHECK FAILED: no authenticated-only % policy with ownership + current_user_verified on public.wardrobe_items', cmd_name;
    end if;
  end loop;

  select count(*) into n
  from pg_policies
  where schemaname = 'public' and tablename = 'wardrobe_items'
    and cmd = 'UPDATE'
    and qual is not null and with_check is not null;
  if n < 1 then
    raise exception 'RLS CHECK FAILED: UPDATE policy on public.wardrobe_items needs both USING and WITH CHECK';
  end if;

  -- 4. Storage policies for the bucket.
  foreach cmd_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    select count(*) into n
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd = cmd_name
      and roles = array['authenticated']::name[]
      and coalesce(qual, '') || coalesce(with_check, '') like '%closet-photos%'
      and coalesce(qual, '') || coalesce(with_check, '') like '%foldername%'
      and coalesce(qual, '') || coalesce(with_check, '') like '%current_user_verified%';
    if n < 1 then
      raise exception 'RLS CHECK FAILED: no authenticated-only % storage policy for bucket closet-photos (folder ownership + verified)', cmd_name;
    end if;
  end loop;

  select count(*) into n
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and cmd = 'UPDATE'
    and coalesce(qual, '') like '%closet-photos%'
    and coalesce(with_check, '') like '%closet-photos%';
  if n < 1 then
    raise exception 'RLS CHECK FAILED: storage UPDATE policy for closet-photos needs both USING and WITH CHECK';
  end if;

  -- 5. Bucket is private with limits.
  select * into b from storage.buckets where id = 'closet-photos';
  if not found then
    raise exception 'RLS CHECK FAILED: bucket closet-photos does not exist';
  end if;
  if b.public then
    raise exception 'RLS CHECK FAILED: bucket closet-photos is public';
  end if;
  if b.file_size_limit is distinct from 5242880 then
    raise exception 'RLS CHECK FAILED: bucket closet-photos file_size_limit is %, expected 5242880', b.file_size_limit;
  end if;
  if b.allowed_mime_types is distinct from array['image/jpeg']::text[] then
    raise exception 'RLS CHECK FAILED: bucket closet-photos allowed_mime_types is %, expected {image/jpeg}', b.allowed_mime_types;
  end if;

  -- 6. Check constraints exist on wardrobe_items.
  for r in
    select x.name
    from unnest(array[
      'wardrobe_items_data_is_object',
      'wardrobe_items_data_size',
      'wardrobe_items_photo_path_own_folder',
      'wardrobe_items_photo_path_length',
      'wardrobe_items_photo_path_no_traversal'
    ]) as x(name)
  loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.wardrobe_items'::regclass
        and contype = 'c'
        and conname = r.name
    ) then
      raise exception 'RLS CHECK FAILED: check constraint % missing on public.wardrobe_items', r.name;
    end if;
  end loop;

  -- 7. Triggers exist.
  for r in
    select x.name
    from unnest(array[
      'wardrobe_items_set_updated_at_ins',
      'wardrobe_items_set_updated_at_upd',
      'wardrobe_items_lock_user_id'
    ]) as x(name)
  loop
    if not exists (
      select 1 from pg_trigger
      where tgrelid = 'public.wardrobe_items'::regclass
        and not tgisinternal
        and tgname = r.name
    ) then
      raise exception 'RLS CHECK FAILED: trigger % missing on public.wardrobe_items', r.name;
    end if;
  end loop;

  raise notice 'ALL RLS CATALOG CHECKS PASSED';
end
$$;
