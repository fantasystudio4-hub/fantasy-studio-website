# LensCal — setup & launch checklist

LensCal lives at **`/lenscal/`** on the same site as the studio homepage and
reuses the same Firebase project (`fantasy-studio-web-f7813`) via the shared
`firebase-config.js`. All its Firestore collections are prefixed `lenscal_`
so nothing touches the studio's `leads`/`config` data.

## One-time Firebase console setup (5 minutes)

1. **Enable auth providers** — [Firebase console](https://console.firebase.google.com/project/fantasy-studio-web-f7813/authentication/providers) → Authentication → Sign-in method:
   - **Email/Password** → Enable. (Works immediately, no billing.)
   - **Phone** → Enable. ⚠️ Phone OTP SMS requires the Blaze (pay-as-you-go)
     plan. Until then the login screen's email fallback works fine, and you
     can add **test phone numbers** under Phone provider settings to demo OTP.
2. **Publish Firestore rules** — Firestore Database → Rules: keep the studio's
   existing `leads`/`config` blocks and add everything from
   [`firestore.rules`](firestore.rules) inside the same
   `match /databases/{database}/documents { … }` wrapper → Publish.
3. **Authorized domains** — Authentication → Settings → Authorized domains:
   make sure your production domain (e.g. `fantasystudio.site`) is listed
   (localhost already is).

That's it — no indexes to create (queries are designed to use built-ins),
no Storage, no Cloud Functions.

## Run locally

```sh
python3 -m http.server 8000        # from the repo root
# open http://localhost:8000/lenscal/
```

## What's built (MVP scope)

| Feature | Status |
| --- | --- |
| Phone OTP + email fallback, profile onboarding | ✅ |
| Calendar engine (`availabilityService`) — configurable slots/statuses, real-time sync | ✅ |
| My Calendar: tap-to-cycle 🟢🔴🟡, full-day, multi-date select, private notes, "unconfirmed" styling | ✅ |
| Network: add by phone, invite links, mutual accept, groups, free-tier 10-connection cap | ✅ |
| Find Crew: date+slot → distance-sorted 🟢 list, role/group/distance chips, WhatsApp deep links | ✅ |
| Map view: Leaflet + OpenStreetMap, area-level pins, tap → WhatsApp | ✅ |
| Urgent broadcast: targets only 🟢 connections for that date+slot, nearest-first, "I'm in", auto-expiry | ✅ |
| AI search bar: built-in Hinglish parser; optional Claude API key (Profile → AI search) for smarter parsing | ✅ |
| PWA: manifest + service worker + branded icons, installable | ✅ |
| Plans: `plan` field + `canAccess()` gate ready — flip `PAYWALL_ENFORCED` in `js/config.js` to enable Pro | ✅ (dormant) |

## Privacy model

- Users share **area-level location only**: their locality's centroid
  (geocoded once via OpenStreetMap Nominatim), stored as lat/lng + geohash.
- Live GPS, when the browser permits it, is used **only on-device** as the
  searcher's origin for distance sorting — it is never uploaded.
- Profile → Location sharing **Off** removes the user from distance sort
  and the map entirely.
- Slot notes are for the owner's eyes in the UI; per-day rate is private
  by default.

## Deliberately not built yet

- **Push notifications (FCM)** for broadcasts — broadcasts are real-time
  in-app via Firestore listeners. FCM needs a VAPID key + a
  `firebase-messaging-sw.js`; wire it into `broadcastService.postBroadcast`
  when ready.
- **Paywall UI** — architecture is ready (`planService.canAccess`).
- **Geohash radius queries** — `locationService.geohashQueryBounds` exists
  (geofire-common-compatible) but networks are small enough to distance-sort
  client-side for now.

## Architecture map

```
js/config.js                 slots, statuses, roles, plans, collections (all data-driven)
js/firebase.js               single Firebase init; re-exports primitives
js/services/
  availabilityService.js     THE calendar engine — one doc per user-date
  locationService.js         geohash + haversine + Nominatim + privacy rules
  networkService.js          connections (mutual accept) + groups
  searchService.js           Find Crew composition + WhatsApp links
  broadcastService.js        urgent broadcasts, availability-targeted
  aiSearchService.js         NL → filter (Claude API or local Hinglish parser)
  planService.js             canAccess() feature gate
  authService.js / userService.js
js/ui/                       views only — zero direct Firestore access
```
