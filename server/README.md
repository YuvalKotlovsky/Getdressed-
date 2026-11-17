# Authenticated photo analysis (`POST /v1/analyze-photo`)

Flow: app -> `Authorization: Bearer <Supabase access token>` + one photo -> server verifies the session with Supabase Auth (`/auth/v1/user`, email must be verified) -> user id comes ONLY from that session -> request validated (size, magic bytes, ownership of a stored photo) -> **durable per-user quota consumed in the database** (`consume_ai_quota`, migration `20261116000000`) -> Gemini -> normalized tag suggestion (`src/tagging/schema.ts`) -> the editor shows it for the user to review and edit.

Body: exactly one of `{ "image": "<base64 jpeg|png|webp, decoded <= 1.5 MB>" }` or `{ "photoPath": "<user id>/<item id>/<photo id>.jpg" }` (an already-synced photo; the folder must be the caller's own id, and storage RLS applies again because the server reads it with the caller's token).

Errors (all JSON `{error}`): 401 `unauthorized`, 403 `email_not_verified` / `forbidden`, 400 `bad_request`/`bad_image`, 413 `too_large`, 415 `bad_media`, 404 `not_found`, 422 `not_garment`, 429 `quota_exceeded` (+`scope`: day|month|global) / `busy` / `rate_limited`, 502 `upstream`/`invalid`, 503 `not_configured` / `quota_unavailable` (fails closed) / `auth_unavailable`.

Cost rules: nothing that fails validation consumes quota; a provider failure stays counted (no free retries); one request at a time per user (single instance); output capped at 500 tokens; 20 s provider timeout. Limits are FIXED in the database table `ai_quota_limits` (20/day and 200/month per user, 500/day for the whole project) and cannot be chosen or read by callers; change them with admin tooling only. `consume_ai_quota(kind)` takes no limits, so a user calling it directly can never exceed their own daily cap and cannot inflate the project-wide count beyond it. Many fake accounts could still drain the global ceiling: pair it with sign-up abuse controls before any public launch.

HTTP hardening: the session is verified BEFORE the body is read (anonymous callers cannot make the server buffer a body), body cap 2.6 MB (Content-Length and streaming), 20 simultaneous requests, header/request timeouts, per-IP limiter keyed by the socket address (`TRUST_PROXY_HOPS=n` trusts the n rightmost X-Forwarded-For entries behind your own proxy) with bounded memory, and the legacy routes bind to loopback only.

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

## Quota is server-only (migration `20261117000000`)
`consume_ai_quota` needs the caller's JWT (whose quota) AND the header `x-ai-server-key` (proof that the call comes from this backend). The database stores only the SHA-256 of that key in `ai_quota_server_keys` (no policies, no grants); with no key stored every call is refused. A verified user calling the RPC directly is refused (`42501`) and consumes nothing.

Set it up once per environment (dev now; staging/prod later, each with its OWN key):
```
KEY=$(openssl rand -hex 32)                          # keep it ONLY in the backend's secret store / a git-ignored file
printf 'AI_QUOTA_SERVER_KEY=%s\n' "$KEY" >> .env.verify   # dev tests also need it (the file is git-ignored)
HASH=$(printf %s "$KEY" | shasum -a 256 | cut -d' ' -f1)
supabase db query --remote=<DEV REF> --yes "insert into public.ai_quota_server_keys (id, key_sha256) values (1, '$HASH') on conflict (id) do update set key_sha256 = excluded.key_sha256"
```
Rotate by repeating with a new key (the old one stops working immediately). Always check the printed `Target:` shows the intended project.

## Gemini: what the code uses (checked against Google's official docs on 2026-11-16)
- **Model:** `gemini-3.5-flash-lite` is the current stable Flash-Lite ("Stable", latest update July 2026, no shutdown date announced; `gemini-3.1-flash-lite` is stable until 2027-05-07; `gemini-2.5-flash-lite` is still served but Google says new projects should use 3.5 Flash-Lite). Source: aistudio.google.com/docs/models, /docs/models/gemini-3.5-flash-lite, /docs/deprecations.
- **Endpoint:** the Interactions API, `POST https://generativelanguage.googleapis.com/v1beta/interactions` ("generally available and the recommended interface for all new projects"; `generateContent` is "legacy but fully supported"). Key in the `x-goog-api-key` header. Image as `{"type":"image","data":"<base64>","mime_type":"image/jpeg"}` (inline requests up to 20 MB). Source: /docs/interactions-overview, /docs/migrate-to-interactions, /docs/image-understanding.
- **Structured output:** `response_format: {"type":"text","mime_type":"application/json","schema":{...}}` with the JSON Schema in `src/tagging/schema.ts` (`RECOGNITION_JSON_SCHEMA`; enum/nullable-as-type-array are documented as supported). Google states the output is syntactically valid JSON and that values must still be validated, which `normalizeRecognition` does. Source: /docs/structured-output.
- **Thinking/limits:** `generation_config.thinking_level: "minimal"` (documented as the default for 3.5 Flash-Lite) and `max_output_tokens: 1024`, which INCLUDES thinking tokens (a hit cap returns status `incomplete`, treated as an upstream error). `store: false` so Google does not keep the interaction. `temperature` is not listed for the Interactions API and is not sent.
- **Usage:** response `usage.total_input_tokens / total_output_tokens / total_thought_tokens / total_tokens` (confirmed on the thinking/tokens pages; the exact placement in a real response is what the pilot confirms). Images over 384 px are tiled into 768x768 tiles at 258 tokens each (a 1400x1050 photo = 4 tiles = 1032 tokens).
- **Price (paid Standard tier, per 1M tokens, as printed 2026-11-16):** input $0.30 (text/image), output $2.50 including thinking tokens. **Free tier:** free of charge BUT content is used to improve Google's products; paid tier: not used. Use a paid-tier key for real clothing photos.
- **Not confirmed from official pages:** a worked inline-image Interactions curl with `usage` in the response, and `generateContent` support for `gemini-3.5-flash-lite` (not used here). The pilot is the first real check of the request/response shape.

## Billing controls (official Google docs, read 2026-11-17; none of these pages shows its own date)
Distinguish **hard stops** from **alerts**:
- **Prepaid credit = the practical hard stop.** Paid tier means linking a billing account and prepaying a minimum of **$5** (billing page). "The Gemini API will only serve requests if you have a positive Prepay credit balance"; at zero balance requests fail with **HTTP 402** and all keys on that billing account stop. Latency: overages are possible during the roughly **10 minute** billing pipeline delay. For a $0.007 pilot, a $5 prepay is already a hard ceiling of $5 on what can ever be spent; the docs do not say whether unspent prepaid credit is refundable (check before paying).
- **AI Studio project spend cap** (Spend page > "Monthly spend cap"): labelled **Experimental**; billing data can lag up to ~10 minutes, so "you may experience overages beyond your project cap". The page does not say it blocks requests, only that overages can occur.
- **Cloud Billing "spend cap" budget** (separate type from a normal budget; Gemini API, service `generativelanguage.googleapis.com`, one project + one service, monthly): "usage of your specified services is automatically paused for the remainder of the budget period"; new requests are paused. Enforcement "isn't instantaneous" and you stay responsible for overage from reporting latency. An existing alerts-only budget cannot be converted; create a spend-cap budget.
- **Budget ALERTS do not cap anything:** "Setting an alerts-only budget doesn't automatically cap Google Cloud ... usage or spending." (First notification can take hours.) Programmatically disabling billing via Pub/Sub is mentioned, but that page was not read.
- **Quotas:** rate limits are per project (not per key); the docs do not say a customer can lower the RPD quota. Tier-1 paid limits for this model are not stated on the rate-limits page (see AI Studio). Tier 1 also has a monthly usage cap of $250 at the billing-account level.
- **Keys** have no billing settings of their own (they inherit the project's limits): restrict a key to the Gemini API, create it as an "auth key" (default for new AI Studio keys since 2026-05-28; unrestricted standard keys are rejected), rotate by creating a new key, deploying, then disabling the old one.
- **Pilot protection in this repo (independent of Google):** hard cap of 5 outbound calls (see below).
- **Free tier alternative:** no billing needed, but "Used to improve our products: Yes" (paid: No). Only use it with non-personal test photos.

## Configure a server-side DEV key (steps; nothing here has been run with a real key)
1. In Google AI Studio create a key in a DEV-only project. Decide the money control first (see above): paid tier with the $5 prepay minimum (hard stop at zero) and, if you like, the project spend cap or a Cloud Billing spend-cap budget as extra layers. Restrict the key to the Gemini API.
2. Store the key LOCALLY without it appearing in chat, logs, shell history or Git. In a terminal on your machine (zsh), paste when prompted (nothing is echoed):
```
read -rs "K?Gemini API key: "; echo
( umask 077; printf 'GEMINI_API_KEY=%s\nGEMINI_MODEL=gemini-3.5-flash-lite\nPILOT_MAX_CALLS=5\n' "$K" > .env.pilot ); unset K
git check-ignore .env.pilot && echo "ignored by Git: OK"     # must print the path and OK
```
`.env.*` is git-ignored; the scripts never print the key (the adapter sends it only in the `x-goog-api-key` header). Do not paste the key into chat. If it leaks, disable it in AI Studio and create a new one.
3. Run the server locally against the dev project: `npx tsx --env-file=.env.verify --env-file=.env.pilot server/index.ts` (needs `SUPABASE_URL`, `SUPABASE_ANON_KEY` (public key), `AI_QUOTA_SERVER_KEY`; set `ALLOWED_ORIGIN=http://localhost:8081` for a local web build). The server logs one JSON usage line per provider call (latency and tokens, no user id, no photo).

## Dev pilot (5 photos, cap enforced in code) - NOT RUN
Photos stay in the git-ignored `/pilot/` folder: 5 representative photos (leggings, a dress, the clog that was misclassified as a shirt, plus two more such as a shoe pair and a multi-item shot). Prepare each like the app does (longest edge 1400 px, JPEG, under 1.5 MB): `sips -Z 1400 -s format jpeg in.heic --out pilot/leggings.jpg`. Create `pilot/manifest.json`: `[{"file":"leggings.jpg","expect":{"category":"activewear"}}, {"file":"dress.jpg","expect":{"category":"dress"}}, {"file":"clog.jpg","expect":{"category":"shoes","note":"clog, was misclassified as a shirt"}}, ...]`.
- **Dry run (no call):** `npx tsx --env-file=.env.verify --env-file=.env.pilot scripts/gemini-pilot.ts`
- **Live:** same command with `--confirm`.
- **Maximum calls: 5** (`PILOT_MAX_CALLS`, hard ceiling 8 in code). Enforced by: the manifest may not list more photos than the cap; a persisted counter `pilot/.calls` is incremented BEFORE every provider call and the script refuses at the cap, so reruns cannot exceed it; no retries; one call at a time; dev project only; the database quota (20/day) applies on top; plus the budget cap you set on the key at Google.
- **Estimated cost:** about 2,000 input tokens per call (about 1,032 image tokens for a 1400x1050 photo + about 900 prompt tokens) and about 300 output tokens: roughly $0.0014 per call, about $0.007 for 5 calls, under $0.02 even if every call were twice as large.
- **Recorded per photo** (to `pilot/results-<time>.json`, git-ignored): the suggested tags and flagged fields, HTTP status/error, latency, token usage and estimated cost, next to the expected category.
- **After the pilot:** compare with `expect`, decide on the model/thinking level, then (separate decision) wire the cost logging into a real monitor before any deployment.
