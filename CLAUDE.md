# Wear My Week (CLAUDE.md)

**Goal:** a personal wardrobe planner for iPhone/Android. It learns what is in my closet from photos and suggests outfits (only from my own clothes) based on my phone calendar: today + the next 6 days.

**Hebrew + RTL everywhere.** All UI strings are Hebrew. Use `rowDir`/`text()` from `src/ui.ts` for rows and text (works whether or not the OS already flipped layout). Warm off-white background (`src/theme.ts`), large photos, 3 tabs: היום / השבוע / הארון שלי.

## Run
```
nvm use   # Node 22 (see .nvmrc; engines >=22 <23, same as CI)
npm ci
npm run typecheck      # tsc
npm test               # planner/classifier tests (node:test via tsx)
npx expo start         # scan the QR with Expo Go (phone + computer on same network); add --tunnel if needed
npm run web            # browser preview
npx expo export --platform web   # static build in dist/
```
Note: `npx expo install` needs api.expo.dev; in the cloud sandbox it is blocked, so versions were pinned from `node_modules/expo/bundledNativeModules.json`.

## Photo recognition (server) and weather
- `server/index.ts` is a tiny Node proxy (`ANTHROPIC_API_KEY=... npm run server`; optional `PORT`, `ALLOWED_ORIGIN`, `RECOGNITION_MODEL`, `RECOGNITION_TOKEN`). The key lives only there. The app reads the public URL from `EXPO_PUBLIC_RECOGNITION_URL` (build time; no secrets). Without it the editor says recognition is not configured and manual tagging is used.
- The app asks consent before every upload and explains what is sent (one resized photo, nothing else). Every failure (offline, server error, not a garment) falls back to manual entry.
- Prompt + output validation live in `src/tagging/schema.ts` (shared by server, client and tests). Fields below confidence 0.6 are flagged "לבדיקה".
- Weather: `src/weather/weather.ts` uses Open-Meteo hourly forecast (no key) for the chosen city, else a per-city seasonal estimate, plus a per-day manual override. Weather only ranks outfits after occasion/dressiness filtering; cold evenings add a layer (outerwear), flagged missing if the closet has none.

## Editor rules (recognition fix)
- A NEW item starts with nothing chosen (no default חולצות/לבן). Category and color are required to save; unrecognized fields stay empty and are flagged "לבדיקה"; empty dressiness/occasions fall back to category defaults only at save time, with a visible hint.
- The editor pings `GET /health` of the recognition server and says in Hebrew why analysis is unavailable (not configured in this build / server not responding / server has no API key).
- Recognition tags the MAIN foreground item (prompt in `src/tagging/schema.ts`), may return a brand/model guess (caption/logo/shape) that is only a suggestion until the user taps אישור, and flags `multiple` when several garments are visible. Uploads keep the longer edge at 1400px.
- The deployed Pages build only has recognition if repo variable `RECOGNITION_URL` (https) was set when the workflow ran; the workflow prints a warning when it is empty.

## Adding items: photo, product link, receipt
- `src/components/AddItemSheet.tsx` offers צילום או גלריה / הדבקת קישור למוצר / סריקת קבלה; all three end in the same editable tag editor (`ItemEditor`).
- Link: `server` POST `/product` fetches a public HTTPS page (`server/safeFetch.ts`: https only, no credentials, port 443, DNS result must be public, every redirect re-validated, size/time limits) and `src/import/parseProduct.ts` reads JSON-LD Product / Open Graph (name, image, color, reference). Blocked/removed/empty pages keep the link and continue with a screenshot or manual entry.
- Receipt: `src/import/receipt.ts` parses item lines (Zara style `NNNN/NNN/NNN` references), tries `https://www.zara.com/il/he/-pNNNNNNNN.html`, and labels each line matched / uncertain / unmatched. Text can be pasted on-device (iPhone Live Text copy); photos go to `/receipt` only after a crop+consent step. Only the confirmed items (with store/url/reference) are saved; a receipt fingerprint (hash) warns about re-scans.
- The receipt format and Zara page structure are ASSUMED from fixtures; a real cropped Zara receipt and real pages are still needed to verify them.
- Native calendar: `src/calendar/native.ts` (expo-calendar legacy API, lazy-required) + `CalendarSheet` (permission, choose calendars). Events are mapped by `mapEvents.ts`, merged with manual events (`CompositeCalendarProvider`) and classified on-device. Phone-only; Safari uses manual events.
- Real-service check (not possible from the cloud sandbox): `ANTHROPIC_API_KEY=... npm run verify:services -- --product <url> photo.jpg`.

## Architecture
- `src/logic/` pure TS: `classify.ts` (HE/EN title -> occasion), `recommend.ts` (eligibility by occasion/dressiness/availability, rank by weather fit + color compatibility + favorites - recency, layers for cold/cool evenings, missing-piece reporting, saved outfits flagged stale), `week.ts` (provider -> 7 DayPlans).
- `src/calendar/provider.ts`: `CalendarProvider` seam: `ManualCalendarProvider` (typed-in events) + the phone calendar. The demo closet/calendar no longer exist in the product; they live only in `tests/fixtures/demo.ts` as test data.
- `src/tagging/tagger.ts`: `Tagger` seam. Today: manual tags only.
- `src/storage/persist.ts`: per-account local cache in AsyncStorage (`wmw:v2:<user id>`, `AppData` v2). The old `wmw:v1` blob is never read, imported or deleted. Photos are copied to the app document dir (native) or stored as data URI (web); sign-out wipes the account's cache and photo copies.

## Privacy rules
Never commit real photos, calendar exports, `.env*`, keys or certificates (see `.gitignore`). Photos stay on device. If image recognition uses an external service: ask before sending a photo, keep credentials on a server, never in the app.

## Next milestone: device + real-service verification
1. Verify native calendar on a real iPhone/Android (permission prompt, calendar list, refresh after moving an event).
2. Deploy `server/` somewhere reachable, set `RECOGNITION_URL`, and evaluate real-photo accuracy (leggings, dresses). Weather and recognition were only tested with mocked services in the sandbox.
3. Device verification on real iPhone/Android (camera, permissions, RTL on a Hebrew-locale device, photo persistence).

## Accounts + cloud sync (Supabase) — milestone 1
- **Sign-in is required.** `App.tsx` renders `AuthScreen` until `useAuth().status === 'signedIn'` (email + password, email must be verified). `AppProvider` is keyed by user id, so an account switch drops all in-memory data. A new account starts empty (`emptyAppData`); no demo or browser data is imported.
- **Client-safe config only:** `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`; `src/cloud/config.ts` rejects service-role / `sb_secret_` keys). Never put a service key in the app, repo or CI. Pages builds read the repo variables `SUPABASE_URL` / `SUPABASE_ANON_KEY`.
- **Backend (`supabase/`):** versioned migrations, table `wardrobe_items` (client-generated uuid id, `data` jsonb tags/availability, `photo_path`, `deleted_at` tombstone), private bucket `closet-photos` with object path `{user_id}/{item_id}/{photo_id}.jpg`. Owner-only RLS for select/insert/update/delete on both, each also requiring a verified email (`current_user_verified()`). Setup + dashboard settings (Confirm email ON): `supabase/README.md`. Catalog check: `supabase/tests/rls_policies.sql`.
- **Sync (`src/cloud/engine.ts`, pure + tested in `tests/cloud-sync.test.ts`):** changes are queued per item in `AppData.sync.pending` (persisted), pushed as idempotent upserts, then changes from other devices are pulled (cursor + 5s overlap). Photo first, row second; the photo path is fixed per attempt so a retry after "photo uploaded, row failed" reuses the same object. Deletes are tombstones. Unsent local edits win over pulled rows. Failures show "לא נשמר בענן" (per tile + `AccountBar`) and retry with backoff, on foreground, or on tap. Photos from other devices load through 1h signed URLs (`useItemPhoto`).
- **Synced now:** items (tags, availability, brand, source) and their photos. **Still local per account:** saved outfits/choices, history, manual events, settings (a later sync milestone).
- **Verification record (project `wearmyweek-dev`, anon key + two synthetic confirmed accounts):**
  - LIVE, run by Claude Code: both migrations applied in order (user ran them in the SQL Editor; each returned "Success"); `supabase/tests/rls_policies.sql` completed without error; `npm run verify:rls` = 32 passed, 0 failed (owner access, cross-session read, B and anon denied for rows and photos, updates/deletes by B leave A's data intact, constraints, private bucket).
  - USER-REPORTED manual browser tests (not run by Claude Code): (1) an item and its photo appeared in a second isolated session of account A; (2) switching to account B showed an empty wardrobe; (3) saving offline showed "לא נשמר בענן"; (4) after reconnecting the item synced exactly once, without duplication.
  - SIMULATED: 13 sync-engine tests against an in-memory fake (`tests/cloud-sync.test.ts`).
  - PENDING: unverified-email denial (`TEST_UNVERIFIED_*` not configured, so `verify:rls` skips it; it relies on "Confirm email" being ON in the dashboard); physical iPhone/Android devices (camera, permissions, RTL, native build); email-verification deep link; account deletion; staging/prod projects.

## Architecture decision (confirmed): hybrid Supabase + own backend
- **Supabase** owns Auth, PostgreSQL and private photo Storage. The app reads and writes its own wardrobe directly through Supabase under owner-only RLS (what exists today in `supabase/` and `src/cloud/`).
- **Our backend** (`server/`, evolving from the current proxy) owns: AI recognition through Gemini, product-link and receipt imports, per-user quotas, recommendation generation, and background work.
- **Secrets stay on the backend** (Gemini and any other provider keys, never in the app). The app only ever holds the Supabase URL + anon key.
- **Every backend request is authenticated with the caller's Supabase access token**, verified server-side, and every user resource is ownership-checked (by the verified user id, never by an id the client sends). Quotas are per verified user and are enforced BEFORE any provider call.
- **Recommendations:** reuse the existing pure TypeScript logic in `src/logic/` (move/share it, do not rewrite). Generated plans are cached per user and refreshed when relevant wardrobe data, events, weather or preferences change.
- **Calendar:** authorization stays optional and separate from sign-in. Events are read on the device today. Do NOT introduce server-side calendar storage (tokens, events) without the owner's explicit approval first.
- Consequence for existing code: `/analyze`, `/product`, `/receipt` are unauthenticated today and must not be exposed publicly (nor given a real provider key) until the token check and quotas exist.

## Git and environments workflow (confirmed)
**Environments: dev, staging, prod.** Same variable names everywhere; only the values differ. Each environment has its OWN Supabase project, backend deployment/configuration and credentials. Nothing is shared between them (no shared keys, buckets, users or databases).

| | dev | staging | prod |
|---|---|---|---|
| Supabase project | `wearmyweek-dev` (exists, migrations applied) | its own project (to provision) | its own project (to provision) |
| Backend | local / dev deployment | its own deployment + provider keys | its own deployment + provider keys |
| App builds | local `.env`, Expo Go / `development` EAS profile | `preview` EAS profile (internal) | `production` EAS profile (stores) |
| Test accounts | synthetic, `.env.verify` | synthetic only | none; never run `verify:rls` against prod |

- **App config (public values only):** `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_RECOGNITION_URL`. Local dev reads `.env`; staging/prod values live in the build system (EAS environment variables per profile, GitHub Environments `staging`/`production`), never in Git. Local files `.env`, `.env.verify`, `.env.staging`, `.env.production` are git-ignored (`.env.*`); only `.env.example` is tracked. Planned (not implemented): `EXPO_PUBLIC_APP_ENV=dev|staging|prod` so the app and logs can show which environment a build points at.
- **Backend secrets** (Gemini key, service-role/JWT secrets, quota store credentials) exist only in each environment's backend secret store. A service-role key never enters the app, the repo, chat or logs.
- **Before running anything against a project, verify the target** (project ref/URL). `verify:rls` refuses unless `SUPABASE_URL` matches `EXPECT_PROJECT_REF`.
- **Branches and commits:** work on feature branches off `main` (`feature/…`, `fix/…`), focused commits, no direct commits to `main`. Do not merge a branch with unresolved blockers.
- **Every PR states:** (1) what changed and why, (2) migrations included (file names, and which environments they were applied to), (3) ACTUAL verification results (commands run and outcomes; label live vs simulated vs pending), (4) remaining gaps and known risks.
- **Promotion order is dev -> staging -> prod.** A release uses the SAME reviewed source commit in every environment. Because `EXPO_PUBLIC_*` values are inlined at build time, each environment may need its own build of that commit; that is expected, but the source must not differ. Tag the release commit (`vMAJOR.MINOR.PATCH`). Record for EVERY build: environment, source SHA, build identifier (EAS build id per platform, or the GitHub Actions run id for web), plus the migration versions applied per environment and who verified what. Keep that record in the release notes of the tag.
- **Migrations are immutable once applied to any shared project.** `20261106000000_wardrobe_items.sql` and `20261106000100_closet_photos_storage.sql` are applied in dev and must not be edited. Corrections are NEW timestamped migrations. Apply to staging then prod only from the promoted commit, and run `supabase/tests/rls_policies.sql` after each.
- **GitHub Pages web preview (`pages.yml`) is manual only** (`workflow_dispatch`, input `environment` = `staging` or `production`). It reads its configuration from the selected GitHub Environment and fails with a clear error if `APP_ENV` (must equal the selected environment), `SUPABASE_URL` (https, `*.supabase.co`) or `SUPABASE_ANON_KEY` is missing or inconsistent. It has no dev fallback; define these variables ONLY on the GitHub Environment (GitHub would otherwise silently use a repo-level variable of the same name, so delete any old repo-level `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`RECOGNITION_URL`), and does not set `EXPO_PUBLIC_RECOGNITION_URL` (recognition endpoints stay off for the web build until backend authentication and quotas exist). Never point the public site at `wearmyweek-dev`.
- **Changing the workflow does NOT unpublish anything already published.** A Pages site that an earlier run deployed stays live (and keeps whatever configuration it was built with) until it is removed: repo Settings > Pages > "Unpublish site", or delete the `github-pages` deployment. Check Settings > Pages for an existing site.

## Ordered plan (current)
1. **Live Supabase verification on `wearmyweek-dev`: done except the items marked PENDING in the verification record above** (unverified-email test, physical devices). This was the gate for everything below.
2. **Backend authentication + quotas (plan, then build):** verify Supabase JWTs on the backend (JWKS / auth endpoint), per-user ownership checks, a quota store and limits (per user per day/month, per endpoint), clean error codes the app can show in Hebrew, no provider call before auth + quota pass, server tests with fake tokens. Replace `RECOGNITION_TOKEN` style shared secrets.
3. **Real Gemini evaluation, then integration:** evaluate Gemini Flash-Lite on real photos (leggings, dresses, shoes, multi-item shots) against the existing validation in `src/tagging/schema.ts`; decide model by accuracy and cost; integrate behind the authenticated, quota-limited endpoint; keep the separate AI-analysis consent in the app.
4. **Recommendations on the backend:** move/share `src/logic/` with the backend, cache generated plans per user, invalidation on wardrobe/events/weather/preference changes; the app keeps a local fallback until this is proven.
5. **Imports on the backend:** product link and receipt flows behind the same auth + quotas (SSRF-safe fetch already in `server/safeFetch.ts`).
6. **Sync of saved outfits, preferences, history** (still local per account today).
7. **Sign-in extras:** Google/Apple sign-in, email-verification deep link (`scheme` + redirect URL), optional Google Calendar authorization (separate from sign-in; approval needed before any server-side calendar storage).
8. **Release requirements (tracked, not done):** native EAS builds on real iPhone/Android (`eas.json` profiles exist; no EAS project id yet), in-app account deletion (App Store requirement; must also delete storage objects, which the `auth.users` cascade does not), privacy policy URL, App Store privacy labels and Play Data Safety (wardrobe photos sync to private cloud storage; opt-in analysis sends a photo to the backend and the AI provider), final bundle identifier (`app.wearmyweek.dev` is a placeholder), Play closed-test requirement, background-work and quota abuse monitoring.
