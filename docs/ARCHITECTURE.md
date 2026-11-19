# Architecture

## Extension (one codebase → three targets)

```
┌────────────────────────── Browser ──────────────────────────┐
│                                                             │
│  Overlay content script          Background service worker  │
│  (only on tracked sites,         (single writer)            │
│   registered at runtime)                                      │
│                                                             │
│  tick 1s ──visible+focused?──▶ pending++ ──batch 5s──▶ tick msg ─┐
│  render size/color/pulse                                         │
│  drag → snap corner ───────────▶ savePosition msg                │
│  storage.onChanged ◀──────────── settings/totals updates         │
│                                                                  ▼
│                                              browser.storage.local
│                                              settings · totals · syncState
│                                                             │
│  Options page (React)  ◀── messages: addSite/removeSite/     │
│   sites, thresholds,     updateThresholds/sync:* ────────────┘
│   preview, sync sign-in
└─────────────────────────────────────────────────────────────┘
```

### Per-site opt-in injection

- Manifest declares **no** host permissions at install — only `optional_host_permissions: *://*/*`
  (MV3) / `optional_permissions` (MV2).
- Adding a site: options page requests `permissions.request({ origins })` **inside the click
  gesture** (required by Chrome), then the background:
  1. stores the site in settings,
  2. re-registers the content script via `scripting.registerContentScripts` (MV3, persistent) or
     `contentScripts.register` (Firefox MV2, re-registered on startup),
  3. injects into already-open tabs of that host via `executeScript` / `tabs.executeScript`.
- Removing a site unregisters, clears badges, and drops the now-unneeded origin permissions.
- Because permissions are filtered through `permissions.getAll()` at registration time, a revoked
  permission degrades to "no injection" rather than an error.

### Time accounting

- The content script owns the clock: a second counts only when the tab is visible **and** the
  window focused (`document.hasFocus()`). Clock tampering is ineffective: ticks come from
  `setInterval`, not wall-clock deltas.
- The background is the single writer to `totals[dateKey][siteHost]`; batches are clamped to ≤60 s.
- Day key is the user's local calendar day; day rollover mid-session flushes the old day and
  restarts at zero.
- Totals are pruned to 90 days.

### Overlay

- Shadow DOM (closed), all styling via CSSOM property assignment — immune to page CSP, no
  `<style>` injection; pulse via WAAPI (`Element.animate`).
- Font: 18 px base; from `growAfterSec` to `redAfterSec` it grows **linearly** to 4×; at
  `redAfterSec` the text turns `#ff453a` with a glow and pulse. Capped at 4× so pages stay usable.
- Positioning: anchored to a corner with fixed margins; drag ends by snapping to the nearest of
  the four corners. No hide/pause affordance exists by design.
- Fullscreen: the host element re-parents into `document.fullscreenElement` so the counter stays
  visible in video fullscreen.
- Top-frame only (`allFrames: false`).

## Sync engine (opt-in)

- Sign-in: `browser.identity.launchWebAuthFlow` opens the hosted relay
  (`site/public/auth/`) with `?redirect=<identity.getRedirectURL()>`. The relay renders the Google
  Identity Services button; on credential it redirects to the extension's identity URL with
  `#id_token=…`. The relay validates the redirect target against
  `*.chromiumapp.org` / `*.extensions.mozilla.org` (no open redirect).
- The background posts the ID token to `POST {CONVEX}/api/auth/login`; the backend verifies it
  with `jose` against Google's JWKS (issuer + audience checks, `email_verified`), upserts the
  user, and returns a 64-hex-char opaque token. Only `sha256(token)` is stored server-side.
- Push: last 7 days of absolute totals, at most every 2 min when dirty (1-minute alarm).
- Pull: last 14 days, every 10 min or on demand.
- **Merge rule: `max(local, remote)` everywhere** (client `mergeTotals`, server upsert). Recorded
  time can only grow — clearing storage on one device can't reset the merged total.

## Convex backend

- `users` (googleSub unique), `sessions` (tokenHash unique, 180-day rolling), `dailyTotals`
  (index `userId+date+host`).
- All functions internal; the only public surface is HTTP actions in `convex/http.ts`
  (`/api/auth/login|logout`, `/api/sync/push|pull`, `/api/me`) authenticated by the bearer token.
- Server-side clamps: date regex, ≤86 400 s/day, ≤500 hosts/day, host length ≤253.

## Site (Cloudflare Workers static assets)

- `site/public/index.html` — landing page.
- `site/public/auth/` — GIS sign-in relay (client ID injected at deploy time; it's a public value).
- `site/public/privacy/` — privacy policy.
- Deploy: `scripts/deploy-site.sh <client-id>` (cf CLI, Vite build).
