# Fantasy Studio — Phase 0 Audit Report
*22 July 2026 · read-only audit · no code changed*

## 0. Reality check — where the brief and the code disagree

You asked me to trust the code and tell you. Here's what's different:

1. **`www.fantasystudio.in` is served by Vercel, not GitHub Pages.** Live response headers say `server: Vercel` (apex `fantasystudio.in` 308-redirects to `www` correctly). Meanwhile the GitHub Pages mirror at `fantasystudio4-hub.github.io/fantasy-studio-website/` is **also live** (HTTP 200, no redirect), fed by `.github/workflows/deploy-pages.yml` (force-push `main → gh-pages`). Two copies of the site are publicly served, and the canonical tag on *both* points to the github.io copy. Search engines are being told the mirror is the real site.
2. **The Firebase project is `fantasy-studio-web-f7813`** (not `fantasy-studio-web`).
3. **Footer year is already dynamic** — `$('#year').textContent = new Date().getFullYear()` at index.html:2790. Nothing to fix.
4. **The hero "Est. — 14 Years of Artistry" is not a rendering bug.** The copy is authored exactly like that at index.html:1067: `Est.` followed by an em-dash and no year. Renders "as designed" — but reads like a placeholder. Needs a year ("Est. 2012 — 14 Years of Artistry") or drop "Est.".
5. **There is no on-page portfolio gallery.** The Portfolio section is an Instagram CTA card; the masonry/filter CSS (index.html:566–587) is dead code from a removed gallery. Related: **the entire public site contains zero `<img>` elements** — a photography studio with no photographs.
6. **A fourth surface lives in the repo:** the LensCal PWA (`/lenscal/`), sharing the same Firebase project, with its own unpublished rules file. Out of scope for this overhaul but it matters for security (below).
7. Client login is already built and shipped (phone-OTP + Google + phone-link), and admin already has most of the Phase-3 roadmap (leads pipeline, bookings, payments, delivery pipeline, config publishing, offline-first). The brief undersells the current state — Phase 2/3 are polish-and-harden jobs, not builds.

---

## 1. Issues, ranked

### CRITICAL

**C1 · Firestore security rules are unversioned, unauditable, and there is no admin role anywhere in code.**
The only rules file in the repo is `lenscal/firestore.rules` (covers only `lenscal_*`). Rules for `leads`, `packages`, `config`, `phoneIndex` exist only in the Firebase console. From code:
- Admin UI gate is just `onAuthStateChanged` → any signed-in user (admin/index.html:749). No custom claims, no allowlist.
- Client portal relies on a rule matching `clientPhone` to the auth token's phone (implied by admin/index.html:1230 comment and client's forced token refresh) — but we can't verify it.
- The same Firebase project also serves LensCal, which has **open sign-up**. If the console rules for `leads`/`packages`/`config` are anything like `request.auth != null`, any LensCal user or any Google-sign-in client can read/write your leads, packages, payment history and rewrite the live site config.
**Action (needs your approval before any change):** export the live rules from the console, commit them to the repo, review together, then add an `isAdmin` custom claim + per-collection least-privilege rules. This is the first thing to do in Phase 3 — arguably before Phase 1.

**C2 · Canonical/OG/sitemap all point to the github.io mirror, and the mirror is live in parallel.**
index.html:20 (canonical), :28–34 (og:url, og:image, twitter:image), :52 (LocalBusiness image), sitemap.xml, robots.txt — all `fantasystudio4-hub.github.io`. Combined with the live mirror, this actively sabotages `www.fantasystudio.in` in search. Fix = rewrite all absolute URLs to `https://www.fantasystudio.in/` **and** kill or redirect the github.io mirror (Pages can't 301 to an external domain; options: add `<link rel=canonical>`-only divergence, a meta-refresh + canonical variant on gh-pages, or disable Pages if Vercel is the deploy target — decide together).

### HIGH

**H1 · Admin Config tab can silently wipe live site config.** `loadConfig()` falls back to `DEFAULTS` on any load error with no error surface (admin/index.html:1001); "Save All" rebuilds the whole `config/site` doc from the DOM (1093–1136). Edit-while-offline-or-denied → publish defaults over live pricing. Also last-write-wins between two devices.
**H2 · Optimistic writes mask permission failures.** `settle()` (admin/index.html:719) treats *denied* the same as *queued offline* — UI says "saved · will sync" for writes that will never land.
**H3 · No real photography anywhere.** For the "this studio is on another level in 5 seconds" goal, the absence of even a curated set of 8–12 optimized images (hero film strip, portfolio wall, about texture) is the single biggest conversion gap. Instagram-only portfolio adds friction and an exit ramp.
**H4 · Client portal error state lies.** A transient network/permission failure on package load renders the **"No bookings found for your number"** empty state (client/index.html:432) with only a 3.2s toast distinguishing it. No retry button. A real client on flaky data will believe their booking vanished.
**H5 · OTP flow gaps.** No resend button/cooldown (dead end if SMS doesn't arrive), no `autocomplete="one-time-code"` (no Android/iOS SMS autofill), no auto-submit on 6th digit. `#recaptcha-box` is dead markup.
**H6 · Unpinned, SRI-less CDN dependencies.** Firebase SDK (gstatic), jsPDF (cdnjs), and Noto fonts from `jsdelivr/...@main` (a moving branch — admin/pdf-template.js:44). A CDN change silently alters/breaks PDFs; compromise = code execution in admin context.
**H7 · Hero "Est. —" placeholder copy** (see §0.4). Front-and-center on the most-viewed line of the site.

### MEDIUM

**M1 · SEO schema thin.** LocalBusiness lacks `url`, `geo`, `openingHours`, `aggregateRating`; no `og:site_name`; sitemap is one URL (fine for a one-pager, but wrong domain); no structured data for the client/admin surfaces to be excluded (`noindex` is present — good).
**M2 · Duplicate quote numbers possible** when two offline devices allocate simultaneously (local fallback of `allocQuoteNo`, admin:1283); editor-PDF for a never-saved package has no quote number at all (2224–2229).
**M3 · Admin "Refresh" buttons don't refetch** — they re-render the existing snapshot (831, 1309). Misleading on stale cache.
**M4 · Preset editor is a raw JSON textarea** (admin:1047) with no schema validation — valid-JSON-wrong-shape breaks the public builder's Quick Start.
**M5 · Client portal has no manifest of its own** — "Add to Home Screen" from `/client/` installs the *marketing site* PWA. Admin has one; client doesn't.
**M6 · +91 hardcoded** in client login (four places) — NRI clients (common for Hyderabad weddings) cannot log in, and the error doesn't say why.
**M7 · Offline edge cases.** First-ever offline visit to admin = blank screen (un-caught dynamic `import()`); offline admin navigation can fall back to the cached *public homepage* (sw.js:55). Client portal offline shows the misleading empty state (H4).
**M8 · Accessibility gaps** (site is otherwise strong): burger lacks `aria-expanded`; mobile menu and quote sheet lack focus traps (lead modal has one — pattern exists); toast close 20px / burger 28px tap targets; `phoneIndex` existence oracle is a privacy note (any visitor can test if a number is a client — accepted trade-off, documenting it).
**M9 · Admin uses blocking `confirm()` in 8 places** — jarring in an installed PWA; the toast-with-action undo pattern already used elsewhere is the house style to extend.
**M10 · Concurrent-edit clobber window:** editor "Save" overwrites `totals` wholesale; a payment recorded on another phone during a hand-edited-advance save is silently lost (admin:2169–2176).

### LOW

- Testimonials look authored, not sourced ("Priya & Rohan, Banjara Hills") — consider pulling real Google reviews (with names' consent) for authenticity; fake-seeming reviews undercut premium positioning.
- Copy inconsistency: hero/stats say **1500+ weddings**, About prose says "hundreds of celebrations".
- Dead CSS: masonry/filter/`.m-item`/`.stars svg`; duplicated `.promo-remove` rule; empty `.nav.scrolled .nav-cta{}` rule.
- Three font families (Playfair, Cormorant, Jost) — could drop Cormorant weights or subset for a faster first paint.
- Client greeting uses first package's `clientName` with no `orderBy` — card order is arbitrary with multiple bookings.
- Admin trash list has no skeleton on first open; calendar has no loading state (renders an empty month).
- `googleads`/doubleclick pings load with GA — fine, just noting they're the only third-party weight.

---

## 2. What's already excellent — protected list (do not regress)

- **Package Builder core**: state machine, per-event services with qty, live totals with count-up, presets ↔ custom chip, compare modal, dup-date warning, past-date block, album min-15 snap logic, promo whitelist, localStorage resume + welcome-back, share-link encode/decode (verified round-trip in browser), popup-safe WhatsApp open, jsPDF with print fallback. **All click-tested working.**
- Remote config pipeline: Firestore `config/site` live-overrides prices/presets/FAQs/testimonials (verified live: cinematography ₹14,000 override is in effect).
- Admin offline-first discipline (persistent cache, queued-write toasts, export guards), soft-delete + trash + undo, transactional quote counter & payment removal, phone back-gesture nav, learned rates.
- Client portal: named Firebase app (client session doesn't evict admin session), pre-OTP known-client check that fails open, journey timeline filtered to services actually sold, systematic `esc()` XSS hygiene (all three surfaces — no gaps found).
- A11y/motion foundation: skip link, `:focus-visible`, `prefers-reduced-motion` fully respected, 16px inputs (no iOS zoom), safe-area insets, scrollspy, 360px layout has zero horizontal overflow.
- Perf: DOMContentLoaded ~380ms local, no render-blocking JS, lazy jsPDF, tiny payload. Lighthouse ≥90 is realistic with minor font work.

---

## 3. Proposed plan (awaiting your approval)

**Phase 0.5 — Security first (small, surgical):**
1. Export live Firestore rules → commit to repo → review with you.
2. Propose rules diff: admin custom claim, per-collection least privilege, client `packages` read scoped to own phone, `phoneIndex` get-only, config write admin-only. **Shown as a diff, applied only after your approval.**

**Phase 1 — Public site (SEO + polish + conversion):**
1. Domain hygiene: all absolute URLs → `https://www.fantasystudio.in/`; sitemap/robots; decide mirror strategy (recommend: keep Vercel as canonical target, neutralize gh-pages).
2. Hero copy fix (needs the real founding year from you — "Est. 2012"?); 1500+/hundreds consistency.
3. Real imagery: you supply 10–15 best frames; I do WebP/AVIF pipeline, blur-up placeholders, lazy loading, an editorial portfolio wall (grid exists in dead CSS — resurrect properly).
4. Schema upgrades (LocalBusiness geo/url/hours, og:site_name), pin CDN deps + SRI.
5. Micro-polish: aria-expanded, focus traps for menu/sheet, tap targets, dead CSS removal.
6. Lighthouse pass to ≥90 across the board.

**Phase 2 — Client portal:**
1. Truthful error state + retry; OTP resend with cooldown; `one-time-code` autofill; auto-submit.
2. Own manifest + icons ("Fantasy Studio — My Wedding" installable app).
3. Payment view against 50/40/10 (display-only), newest-first ordering, +91/NRI decision (needs your call: support international numbers or show a clear message).

**Phase 3 — Admin hardening + completion:**
1. Config safety: load-error banner (never silent defaults), field-level merge on Save, validation for the preset JSON.
2. Honest write feedback (distinguish queued vs denied); real Refresh; quote-number reconciliation; replace `confirm()` with in-style sheets.
3. Dashboard completeness per your roadmap (upcoming shoots / pending deliveries / pending payments / new leads cards — most exist; fill gaps).

Each phase = small commits, phone test checklist at the end.

**Open questions for you:**
1. Founding year for "Est. ____"?
2. Vercel is the real host — keep GitHub Pages mirror at all, or shut it off?
3. Can you supply 10–15 hero/portfolio photos (or should I pull from Instagram exports)?
4. NRI clients: support non-+91 login, or out of scope?
5. OK to start with the security-rules export/review as step one?
