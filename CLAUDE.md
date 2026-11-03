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

## Architecture
- `src/logic/` pure TS: `classify.ts` (HE/EN title -> occasion), `recommend.ts` (eligibility by occasion/dressiness/availability, rank by color compatibility + favorites - recency, missing-piece reporting, saved outfits flagged stale), `week.ts` (provider -> 7 DayPlans).
- `src/calendar/provider.ts`: `CalendarProvider` seam. Today: `DemoCalendarProvider` (sample week, relative to today) and `ManualCalendarProvider` (events typed in for "my closet").
- `src/tagging/tagger.ts`: `Tagger` seam. Today: manual tags only.
- `src/storage/persist.ts`: AsyncStorage (one JSON blob `wmw:v1`); photos copied to the app document dir (native) or stored as data URI (web). Demo and "mine" data are fully separate (`AppData.demo` / `AppData.mine`).

## Privacy rules
Never commit real photos, calendar exports, `.env*`, keys or certificates (see `.gitignore`). Photos stay on device. If image recognition uses an external service: ask before sending a photo, keep credentials on a server, never in the app.

## Next milestone: native calendar access + photo recognition
1. `NativeCalendarProvider` with `expo-calendar`: request access on the "חיבור ליומן" tap, let the user pick calendars, read events locally, keep per-event occasion/dressiness corrections (already stored in `occasionOverrides`). Declining keeps the manual flow.
2. `RecognitionTagger`: consent prompt -> server endpoint -> suggested category/color/dressiness/occasions that the user confirms/corrects in `ItemEditor` (corrections are the saved tags).
3. Device verification on real iPhone/Android (camera, permissions, RTL on a Hebrew-locale device, photo persistence).
