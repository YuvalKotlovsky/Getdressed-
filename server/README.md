# Authenticated photo analysis (`POST /v1/analyze-photo`)

Flow: app -> `Authorization: Bearer <Supabase access token>` + one photo -> server verifies the session with Supabase Auth (`/auth/v1/user`, email must be verified) -> user id comes ONLY from that session -> request validated (size, magic bytes, ownership of a stored photo) -> **durable per-user quota consumed in the database** (`consume_ai_quota`, migration `20261116000000`) -> Gemini -> normalized tag suggestion (`src/tagging/schema.ts`) -> the editor shows it for the user to review and edit.

Body: exactly one of `{ "image": "<base64 jpeg|png|webp, decoded <= 1.5 MB>" }` or `{ "photoPath": "<user id>/<item id>/<photo id>.jpg" }` (an already-synced photo; the folder must be the caller's own id, and storage RLS applies again because the server reads it with the caller's token).

Errors (all JSON `{error}`): 401 `unauthorized`, 403 `email_not_verified` / `forbidden`, 400 `bad_request`/`bad_image`, 413 `too_large`, 415 `bad_media`, 404 `not_found`, 422 `not_garment`, 429 `quota_exceeded` (+`scope`: day|month|global) / `busy` / `rate_limited`, 502 `upstream`/`invalid`, 503 `not_configured` / `quota_unavailable` (fails closed) / `auth_unavailable`.

Cost rules: nothing that fails validation consumes quota; a provider failure stays counted (no free retries); one request at a time per user (single instance); output capped at 500 tokens; 20 s provider timeout. Default limits 20/day, 200/month per user, 500/day for the whole project (`AI_PER_DAY`, `AI_PER_MONTH`, `AI_GLOBAL_PER_DAY`).

The old unauthenticated `/analyze`, `/receipt`, `/product` routes are OFF unless `ALLOW_LEGACY_UNAUTHENTICATED=1` (and never in production).

## Local run (development project, mocked or real provider)
```
SUPABASE_URL=https://<dev ref>.supabase.co SUPABASE_ANON_KEY=<public key> \
GEMINI_API_KEY=<only for the real test> ALLOWED_ORIGIN=http://localhost:8081 npm run server
# app: EXPO_PUBLIC_RECOGNITION_URL=http://localhost:8787 npx expo start --web
```
Without `GEMINI_API_KEY` the server answers 503 `not_configured` and the editor says analysis is unavailable (manual entry works).

## Tests
- `npx tsx --test tests/photo-analysis.test.ts` (mock Gemini + fake Supabase): sessions, ownership, limits, quota, fail-closed, HTTP, client error mapping.
- LIVE against dev, mocked provider: `npx tsx --env-file=.env.verify scripts/verify-photo-analysis.ts` (then delete the synthetic users' `ai_usage` rows with admin tooling).

## Steps for a REAL Gemini test (separate decision; not done)
1. Owner creates a Gemini API key for a dev-only project/billing cap and exports it only in the local shell running the server.
2. Start the server as above; sign in to the app against the dev project; take 15-30 real photos (leggings, dresses, shoes, multi-item shots).
3. Compare suggestions with the existing validation rules and record accuracy, latency and token cost per call (the Gemini response includes usage metadata; logging it is a TODO before any public use).
4. Confirm the model id (`GEMINI_MODEL`; default `gemini-2.5-flash-lite` is an assumption to verify against the current Gemini model list) and that `responseMimeType: application/json` is honoured.
5. Only then decide on deployment: an HTTPS host, per-environment secrets, global budget alert/kill switch, and the remaining items in CLAUDE.md "Requirements before ANY Gemini call".
