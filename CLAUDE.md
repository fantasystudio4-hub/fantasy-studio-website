# Fantasy Studio website — working rules

Static site for a wedding photography studio in Hyderabad, plus the admin panel,
the client / crew / partner portals and the pages the store app loads. **No build
step**: the files in this repo are exactly what the browser runs.

## The one fact that shapes everything

**Vercel deploys this repo root as-is. Every tracked file is public** at
`https://www.fantasystudio.in/<path>` unless `.vercelignore` excludes it.
Before adding any file, decide whether it may be public. Tooling, tests, `*.md`,
`*.rules` and `_demo-data.js` are excluded already — keep it that way, and add a
pattern (with its `**/` twin) for anything new that must not ship.

## Map

| Path | What it is |
| --- | --- |
| `index.html`, `builder/` | Public home page and package builder. Prices, packages, promo codes and the lead writer live in **`catalog.js`** (a classic script of global `var`s, not a module). |
| `admin/` | Owner's panel. `app.js` (~17.6k lines, one ES module), `pdf-template.js` (quote PDF), `_demo-data.js` (fixtures, localhost only), `portfolio/`. |
| `client/`, `team/`, `studio/` | Client area, crew page, partner studio portal — each one HTML file with an inline `<script type="module">`. |
| `start/`, `profile/`, `get/` | Store-app entry, profile step, `/app` store redirect. |
| `fs-shared.js` | **Rules two screens must answer identically**: crew pay (`payFee`…`payUpcoming`, `payState`), a partner's account (`jobPhase`, `jobBalance`), `esc`, `inr`, `todayISO`, `STUDIO_PHONE`. Pure functions, no imports. |
| `fs-auth.js` | The one sign-in shared by the portals (session, `db`, roles, OTP box). |
| `app-shell.js/.css` | Store-app tab bar and native glue (`window.FSApp`). |
| `avail.js/.css` | Availability calendar. |
| `sw.js` | Service worker (network-first for app code; offline fallback). |
| `firestore.rules`, `storage.rules` | **The security boundary.** Deployed separately (see below). |
| `tests/`, `types/`, `eslint.config.js`, `tsconfig.json` | Dev tooling only — never deployed. |

Cloud Functions, the Capacitor app and the emulator/site test harnesses live in
the separate, gitignored `app/` repo (`app/backend/functions`,
`app/backend/rules-test`, `app/backend/site-tests`).

## Conventions

- **Files**: lowercase, hyphenated (`fs-shared.js`). Shared files at the root;
  a page's code lives in its own folder's `index.html`.
- **Names**: `camelCase` functions and variables, `UPPER_CASE` constants and
  caps (`MAX_QTY`, `LEAD_LIMITS`, `EJOBS_CAP`), `_leading` for module-private
  state (`_asgsFresh`, `_ejUnsub`). Listener handles are `_xxxUnsub`.
- **Firebase SDK**: `https://www.gstatic.com/firebasejs/10.12.2/…` everywhere.
  Bump **every** URL and the admin CSP in `vercel.json` together
  (`tests/sdk-version.test.js` enforces one version).
- **Comments** explain *why* and record the owner's decisions with a date
  ("owner, 1 Nov 2026"). Keep that style; never delete such a note silently.

## Rules that prevent the bugs this codebase has had

1. **Escape every value that goes into `innerHTML`** with `esc()` — names,
   notes, messages, ids. Numbers via `inr()`. Use `textContent` when you can.
2. **One copy of a shared rule.** If two pages must agree (money, dates,
   phases), put the function in `fs-shared.js` and import it. Do not paste a
   copy "kept in step by hand"; the tests fail if one reappears.
3. **Writes report the truth.** In the admin, wrap writes in `settle()` and
   tell the owner with `settleMsg()`; never show success on `'denied'`, and only
   update the local copy for what the server took. A fire-and-forget write ends
   in `.catch(()=>{})` — a `try/catch` around an un-awaited promise catches
   nothing.
4. **Never write back a whole list built from this device's copy** when anyone
   else can write that field. Use `arrayUnion` / `increment`. If a full
   overwrite is unavoidable (Settings › Save All), re-read first and **refuse**
   when the doc moved *or the re-read failed*.
5. **Money records are never deleted or moved implicitly.** A crew row with pay
   recorded (`payGot(a) > 0`) is not freed by Trash, not purged, and not
   reassigned to another member. Client `payments[]` likewise.
6. **Public writes (leads, reviews) must fit `firestore.rules`.** Limits live
   in `catalog.js` `LEAD_LIMITS` and are tested against the rules. Write under a
   client-minted id (`newDocId`) so a retry can never make a duplicate.
7. **Buttons that write get a busy guard** that is released in `finally`, not a
   fixed timeout.
8. **Storage**: every `localStorage` / `sessionStorage` access in `try/catch`.
9. **Dates**: `todayISO()` is the device's calendar. Anything shared with the
   morning brief or the crew's call times is India time (`+05:30`) — don't mix
   the two in one comparison.
10. **Rules**: a LIST query must be provable from its own filter (`==` for `==`,
    `x in list` for `array-contains`). `isAdmin()` requires a verified Google
    sign-in — keep both clauses (`tests/rules.test.js`).

## Adding a feature

1. Find the page's section and the nearest existing pattern; follow it.
2. Shared logic → `fs-shared.js` (pure) with a test in `tests/`.
3. A new **static import** or new app file: add it to `APP_CODE` in `sw.js`,
   bump `CACHE`, and — if the crew page imports it — to `NEED` in
   `team/index.html` (offline start).
4. New Firestore field/collection: update `firestore.rules`, test it on the
   emulator (`app/backend/rules-test/run.sh firestore.rules <old rules>`), and
   note that it needs a rules deploy.
5. Changed `admin/app.js` or `app.css`: bump the `?v=` in `admin/index.html`.
6. Check it in the browser: `/admin/?demo`, `/client/?demo`, `/team/?demo`,
   `/studio/?demo` on the local server (`.claude/launch.json`). **Unregister the
   service worker and clear caches first**, or you test stale files. The demo
   refuses writes. The public forms on localhost write to the **live** project —
   don't submit them.

## Before committing

```bash
npm install          # once: dev tools + turns on the pre-commit hook
npm run check        # lint + type-check + format check + tests (≈2 s)
```

The pre-commit hook (`.githooks/pre-commit`) runs `npm run check`. Also run
`node --test` in `app/backend/site-tests` (with `ADMIN_APP_JS=<this repo>/admin/app.js`)
when you touch `admin/app.js` — those tests slice functions out of it by marker.

- `npm run lint` — ESLint over every `.js` and inline `<script>` (bugs, not style).
- `npm run typecheck` — `tsc --checkJs` on the shared modules listed in
  `tsconfig.json`. Add a file there once it type-checks clean.
- `npm run format` — Prettier, for the tooling files only; site code keeps its
  hand-written style.

## Contributing

- Work on a branch, never directly on `main`. One fix per commit; the message
  says what was wrong, the failing case, what changed and how it was checked.
- **Deploying is a separate, explicit step**: commit, report, and stop. The
  owner says "deploy" to push `main` (Vercel). Rules and Functions are deployed
  separately with the Firebase CLI (`firebase deploy --only firestore:rules`,
  `--only storage`, `--only functions:<name>`).
- Don't change behaviour in a cleanup. If unsure whether something is a bug or
  a decision, ask the owner.
