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
- **Live verification is pending until run against a real dev project:** `scripts/verify-rls.ts` (two verified test accounts, anon key only) and `supabase/tests/rls_policies.sql`. No Supabase project, CLI or Docker was available when this was written, so the migrations were never executed.

## Next milestones
1. Run migrations + `verify-rls.ts` on a dev Supabase project; two-device test (add item + photo on device 1, appears on device 2; account B sees nothing).
2. Google/Apple sign-in; optional Google Calendar authorization (separate from sign-in); email-verification deep link (`scheme` + redirect URL).
3. Sync saved outfits, preferences, history.
4. Recognition (Gemini Flash-Lite candidate, pending real-image evaluation): the server must verify the Supabase access token and enforce per-user quotas BEFORE calling the model. Today `/analyze`, `/product`, `/receipt` are unauthenticated.
5. Release requirements (tracked, not done): native EAS builds on real iPhone/Android (`eas.json` profiles exist; no EAS project id yet), in-app account deletion (App Store requirement; must also delete storage objects, which the `auth.users` cascade does not), privacy policy URL, App Store privacy labels and Play Data Safety (photos go to the cloud and, if used, to the recognition model), fix the permission text that says photos stay on the device, final bundle identifier (`app.wearmyweek.dev` is a placeholder), Play closed-test requirement.
