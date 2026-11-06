# Supabase backend (Wear My Week)

Contents: `config.toml` (local dev), `migrations/` (table `wardrobe_items`, private bucket `closet-photos`, RLS), `tests/rls_policies.sql` (catalog check).

Security model: every row and every photo is owned by `auth.uid()` AND requires a verified email (`public.current_user_verified()`). Only `authenticated` has access; `anon` has nothing.

## Hosted dev project

1. Create a project at supabase.com (note the project ref and database password).
2. Dashboard > Authentication > Providers > Email: **Confirm email ON** (required; policies also check `email_confirmed_at`), minimum password length 8+ (10+ recommended). Do not enable anonymous sign-ins.
3. Dashboard > Authentication > URL Configuration: set Site URL (placeholder: `https://YOUR-SITE`) and Redirect URLs (placeholders: your app deep link such as `YOURSCHEME://auth/callback`, and the Expo dev URL such as `exp://YOUR-LAN-IP:8081`).
4. Dashboard > Authentication > Rate Limits: keep email sending, sign-in and sign-up limits low. The built-in SMTP is for testing only; configure custom SMTP before real users.
5. Apply migrations: either `supabase link --project-ref <ref>` then `supabase db push`, or paste the two files from `migrations/` into the SQL editor in order (`20261106000000_...` first).
6. Run the catalog check (below).
7. Dashboard > Project Settings > API: copy the Project URL and the **anon** key.

## Local CLI

```
supabase start        # needs Docker
supabase db reset     # applies migrations from scratch
```
`supabase status` prints the local API URL and anon key. Local email confirmation mails appear in Mailpit (URL shown by `supabase status`).

## Keys: what goes where

- App (build-time, public): `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` only.
- The **service_role key and the database password must NEVER be in the app, the repo or any `EXPO_PUBLIC_*` variable.** The anon key is safe only because RLS is enforced.
- Never commit `.env*` files (see `.gitignore`).

## Catalog check

Paste `tests/rls_policies.sql` into the SQL editor, or run `psql "<db url>" -f supabase/tests/rls_policies.sql` (local DB URL: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`). It raises an exception with a clear message on failure and prints `NOTICE: ALL RLS CATALOG CHECKS PASSED` on success. Run it after every migration.

This is a static check of the catalog only. The cross-account behavioural test (user A cannot read or write user B's rows or photos, unverified users are blocked) is the TypeScript script `scripts/verify-rls.ts`, owned by the QA reviewer.

## Notes

- Sync cursor: `updated_at` is set by the server with `clock_timestamp()`. Clients should re-read with a small overlap (for example cursor minus a few seconds) and dedupe by `id` to avoid missing rows committed out of order.
- Photo path contract: `{user_id}/{item_id}/{photo_id}.jpg`; `wardrobe_items.photo_path` must start with `{user_id}/{item_id}/`. Storage policies check only the first folder (user id).
- Deleting a user cascades to their rows; storage objects are not deleted automatically.

## Live verification runbook (development project only)

Do these in order. Nothing below needs the service-role key or the database password to leave the dashboard.

1. **Create the project** (supabase.com > New project). Name it e.g. `wearmyweek-dev`. Write down the **Reference ID** (Project Settings > General). Production must be a different project.
2. **Auth settings** (Authentication > Sign In / Providers): Email provider on, **Confirm email ON**, **Allow anonymous sign-ins OFF**, minimum password length 8 or more. Leave Google/Apple off for now.
3. **Apply the migrations** in the SQL editor of THIS project (check the project name and ref in the dashboard header first): paste and run `migrations/20261106000000_wardrobe_items.sql`, then `migrations/20261106000100_closet_photos_storage.sql`. Then paste and run `tests/rls_policies.sql`; the result must say `ALL RLS CATALOG CHECKS PASSED`.
4. **Create two synthetic test users** (Authentication > Users > Add user > Create new user, tick **Auto Confirm User**), e.g. `wmw-test-a@example.com` and `wmw-test-b@example.com`, with passwords you generate. Optional third user left unconfirmed for the unverified check (do not tick Auto Confirm).
5. **App config:** create `.env` (git-ignored) with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` (Project Settings > API: Project URL and the **anon / publishable** key only).
6. **Verification config:** create `.env.verify` (git-ignored, separate from `.env`) with `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `EXPECT_PROJECT_REF`, `TEST_A_EMAIL`, `TEST_A_PASSWORD`, `TEST_B_EMAIL`, `TEST_B_PASSWORD` (see `.env.example`). Then `npm run verify:rls`. Exit 0 = all passed, 1 = failures, 2 = pending. The script refuses to run if the URL does not match `EXPECT_PROJECT_REF`.
7. **Two isolated browser sessions:** `npm run web`; open the app in a normal window and in a private window (separate storage). Sign in as A in one and B in the other, add an item with a photo as A, and confirm it appears for A in a second A session, never for B. Offline: DevTools > Network > Offline, save an item (it shows "לא נשמר בענן"), go back online, and confirm exactly one copy exists in both sessions.
