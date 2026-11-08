-- Direct test of the email-verification predicate (public.current_user_verified) in the DEVELOPMENT project.
--
-- Why this exists: with "Confirm email" ON, Supabase Auth refuses to issue a session to an unconfirmed user, so the
-- TypeScript script (scripts/verify-rls.ts) can only prove the sign-in is blocked, not that the SQL policies block
-- an unverified user. This script impersonates the unconfirmed user inside the database (role `authenticated` + JWT
-- claim `sub`) and checks the table and the private bucket, then repeats the same actions after confirming the
-- user INSIDE the same transaction as a positive control (so a pass cannot be an accident of a broken setup).
--
-- HOW: replace the placeholder email below with your UNCONFIRMED test user's email (do not commit the real one),
-- paste into the SQL Editor of `wearmyweek-dev`, Run. Success = an ERROR whose text starts with
-- 'UNVERIFIED PREDICATE CHECKS PASSED' (the intentional rollback). Any other error text = failure/INCONCLUSIVE.
-- The whole block is ONE transaction that always ends in a rollback: no rows, no objects, and the user's
-- confirmation state is unchanged afterwards (verify: email_confirmed_at is still null).
-- Never run this against staging/production.

do $$
declare
  test_email constant text := 'REPLACE-WITH-UNCONFIRMED-TEST-EMAIL';
  uid uuid;
  was_confirmed timestamptz;
  item uuid := gen_random_uuid();
  item2 uuid := gen_random_uuid();
  obj text;
  obj2 text;
  n int;
  blocked boolean;
  err text;
begin
  select u.id, u.email_confirmed_at into uid, was_confirmed from auth.users u where u.email = test_email;
  if uid is null then raise exception 'SETUP: no auth user with the email you put in test_email'; end if;
  if was_confirmed is not null then raise exception 'SETUP: that user is already confirmed; use an UNCONFIRMED test user'; end if;
  obj  := uid::text || '/' || item::text  || '/predicate-test.jpg';
  obj2 := uid::text || '/' || item2::text || '/predicate-test.jpg';

  -- privileged setup (editor role bypasses RLS): one row and one photo object owned by this user
  insert into public.wardrobe_items (id, user_id, data) values (item, uid, '{"name":"predicate-test"}');
  insert into storage.objects (bucket_id, name) values ('closet-photos', obj);

  -- ===== act as the UNVERIFIED user =====
  perform set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.wardrobe_items where id = item;
  if n <> 0 then raise exception 'UNVERIFIED CHECK FAILED: unverified user can read % own row(s)', n; end if;

  select count(*) into n from storage.objects where bucket_id = 'closet-photos' and name = obj;
  if n <> 0 then raise exception 'UNVERIFIED CHECK FAILED: unverified user can see its own photo object'; end if;

  blocked := false; err := null;
  begin
    insert into public.wardrobe_items (id, data) values (item2, '{"name":"predicate-test-2"}');
  exception when others then blocked := true; err := sqlerrm; end;
  if not blocked then raise exception 'UNVERIFIED CHECK FAILED: unverified user inserted a row'; end if;
  if err not ilike '%row-level security%' then raise exception 'INCONCLUSIVE: the row insert was blocked, but not by RLS: %', err; end if;

  update public.wardrobe_items set data = '{"name":"changed"}' where id = item;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'UNVERIFIED CHECK FAILED: unverified user updated a row'; end if;

  delete from public.wardrobe_items where id = item;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'UNVERIFIED CHECK FAILED: unverified user deleted a row'; end if;

  blocked := false; err := null;
  begin
    insert into storage.objects (bucket_id, name) values ('closet-photos', obj2);
  exception when others then blocked := true; err := sqlerrm; end;
  if not blocked then raise exception 'UNVERIFIED CHECK FAILED: unverified user created a photo object'; end if;
  if err not ilike '%row-level security%' then raise exception 'INCONCLUSIVE: the photo insert was blocked, but not by RLS: %', err; end if;

  -- ===== positive control: confirm the user inside this transaction, same actions must now work =====
  reset role;
  update auth.users set email_confirmed_at = now() where id = uid;
  set local role authenticated;

  select count(*) into n from public.wardrobe_items where id = item;
  if n <> 1 then raise exception 'CONTROL FAILED: a verified user cannot read its own row (found %), so the denial above proves nothing', n; end if;
  select count(*) into n from storage.objects where bucket_id = 'closet-photos' and name = obj;
  if n <> 1 then raise exception 'CONTROL FAILED: a verified user cannot see its own photo object (found %)', n; end if;
  insert into public.wardrobe_items (id, data) values (item2, '{"name":"predicate-test-2"}');
  update public.wardrobe_items set data = '{"name":"predicate-test-changed"}' where id = item;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'CONTROL FAILED: a verified user cannot update its own row, so the update denial above is not conclusive'; end if;
  delete from public.wardrobe_items where id = item2;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'CONTROL FAILED: a verified user cannot delete its own row, so the delete denial above is not conclusive'; end if;
  insert into public.wardrobe_items (id, data) values (item2, '{"name":"predicate-test-2"}');
  begin
    insert into storage.objects (bucket_id, name) values ('closet-photos', obj2);
  exception when others then
    raise exception 'CONTROL FAILED: a verified user cannot create a photo object (%), so the photo-insert denial above is not conclusive', sqlerrm;
  end;

  -- ===== always roll back =====
  -- Nothing is deleted or restored by hand (no direct deletes from storage.objects, Storage protections stay untouched).
  -- The block ends with an intentional exception, so Postgres rolls back EVERYTHING: the test rows, the test objects and
  -- the temporary confirmation of the user. The user stays unconfirmed even if this script is interrupted.
  reset role;
  raise exception 'UNVERIFIED PREDICATE CHECKS PASSED (denied while unconfirmed, allowed after confirmation). This error is the intentional ROLLBACK: nothing was kept.';
end
$$;
