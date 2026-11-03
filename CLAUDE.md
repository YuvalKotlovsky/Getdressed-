# Wear My Week (CLAUDE.md)

**Goal:** a personal wardrobe planner for iPhone/Android. It learns what is in my closet from photos and suggests outfits (only from my own clothes) based on my phone calendar: today + the next 6 days.

**Hebrew + RTL everywhere.** All UI strings are Hebrew. Use `rowDir`/`text()` from `src/ui.ts` for rows and text (works whether or not the OS already flipped layout). Warm off-white background (`src/theme.ts`), large photos, 3 tabs: היום / השבוע / הארון שלי.

## Run
```
npm install
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
- `src/calendar/provider.ts`: `CalendarProvider` seam. Today: `DemoCalendarProvider` (sample week, relative to today) and `ManualCalendarProvider` (events typed in for "my closet").
- `src/tagging/tagger.ts`: `Tagger` seam. Today: manual tags only.
- `src/storage/persist.ts`: AsyncStorage (one JSON blob `wmw:v1`); photos copied to the app document dir (native) or stored as data URI (web). Demo and "mine" data are fully separate (`AppData.demo` / `AppData.mine`).

## Privacy rules
Never commit real photos, calendar exports, `.env*`, keys or certificates (see `.gitignore`). Photos stay on device. If image recognition uses an external service: ask before sending a photo, keep credentials on a server, never in the app.

## Next milestone: device + real-service verification
1. Verify native calendar on a real iPhone/Android (permission prompt, calendar list, refresh after moving an event).
2. Deploy `server/` somewhere reachable, set `RECOGNITION_URL`, and evaluate real-photo accuracy (leggings, dresses). Weather and recognition were only tested with mocked services in the sandbox.
3. Device verification on real iPhone/Android (camera, permissions, RTL on a Hebrew-locale device, photo persistence).
