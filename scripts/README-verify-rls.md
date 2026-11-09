# verify-rls.ts

Live cross-account check (anon key + pre-created verified users). Exit 0 = all passed, 1 = failure, 2 = PENDING (not configured, nothing verified).

Setup: a Supabase project (or `supabase start`) with both migrations applied and "Confirm email" ON; two users (A, B) created and email-verified (dashboard "Auto confirm" or Mailpit link); optionally a third user left unconfirmed.

```
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon> \
TEST_A_EMAIL=a@example.test TEST_A_PASSWORD=... TEST_B_EMAIL=b@example.test TEST_B_PASSWORD=... \
[TEST_UNVERIFIED_EMAIL=... TEST_UNVERIFIED_PASSWORD=...] [TEST_B_EXPECT_EMPTY=1] \
npx tsx scripts/verify-rls.ts
```

Never use the service-role key (the script refuses it). Use throwaway test accounts.
