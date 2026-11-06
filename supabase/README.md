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
