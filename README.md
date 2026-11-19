# Time Spent

A shame counter for your doomscrolling. **Time Spent** puts big, impossible-to-miss digits in the corner of every website you choose to track, showing exactly how long you've been on it today.

- Off by default — you pick the sites (youtube.com, reddit.com, x.com…). Only those get a counter.
- Counts only while the tab is **visible and the window focused**. Switch away and the clock stops.
- After your first threshold, the font **grows linearly** the more you scroll.
- After your second threshold, the text **turns red and pulses**.
- **Drag** the counter to any corner. There is deliberately **no hide button** — that's the point.
- **Local-first**: works with zero accounts. Opt-in **Sign in with Google** sync merges your daily totals across Firefox, Chrome, and Firefox on Android — always keeping the *larger* number, so clearing one browser doesn't reset anything.

| Store | Status |
| --- | --- |
| Firefox Add-ons (desktop + Android) | Submitted, in review — [listing](https://addons.mozilla.org/firefox/addon/time-spent1/) |
| Chrome Web Store (Chrome/Edge/Brave/Arc) | Submitted, in review — [listing](https://chromewebstore.google.com/detail/time-spent/fhnlllibaooecdllgedhalbkihljdmdh) |

Landing page: https://time-spent-site.sankalpmukim.workers.dev · Privacy: [/privacy](https://time-spent-site.sankalpmukim.workers.dev/privacy)

## Repository layout

```
├── entrypoints/
│   ├── background.ts        # service worker: site mgmt, dynamic CS registration, badge, sync engine
│   ├── overlay.content.ts   # the counter: ticking, sizing, red pulse, drag + corner snap (8.5 kB, no React)
│   └── options/             # React settings UI: sites, thresholds + live preview, sync sign-in
├── lib/
│   ├── shared.ts            # pure core logic (host matching, formatting, sizing, max-merge) — unit tested
│   ├── storage.ts           # storage.local wrappers (settings / totals / sync state)
│   ├── sync.ts              # opt-in sync engine (runs in background)
│   └── messages.ts          # typed content-script ⇄ background message contract
├── convex/                  # backend: Google ID-token auth, sessions, daily-total max-merge
├── site/                    # landing page + Google sign-in relay (Cloudflare Workers static assets)
├── scripts/                 # icon generator, site deploy, CWS oauth, AMO source upload, tests
└── docs/                    # Plasmo vs WXT evaluation, architecture, publishing runbook
```

## Development

```sh
pnpm install
pnpm dev              # Chrome, hot reload
pnpm dev:firefox      # Firefox
pnpm test             # unit tests for the core logic
pnpm build            # → .output/chrome-mv3
pnpm build:firefox    # → .output/firefox-mv2 (also works on Firefox for Android)
```

Configuration lives in `.env` (see `.env.example`): `VITE_CONVEX_URL` (sync backend) and
`VITE_AUTH_PAGE_URL` (sign-in relay). The extension is fully functional with both empty — sync
simply reports "not configured".

## How time is counted

The overlay content script ticks once per second. A second is added only when
`document.visibilityState === "visible" && document.hasFocus()` — an unfocused window doesn't
count, a background tab doesn't count, another app on top doesn't count. Ticks are batched to the
background service worker (single writer) every 5 s and on tab-hide, keyed by local calendar day.
Totals are kept 90 days locally. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Sync (opt-in)

Sign in with Google → the relay page (`site/public/auth/`) uses Google Identity Services, hands
the ID token to the extension via `browser.identity.launchWebAuthFlow`, and the Convex backend
verifies it against Google's JWKS and mints an opaque session token (only a SHA-256 hash is
stored). Devices push absolute per-day totals; the server and every client merge with
`max(existing, incoming)` — recorded time can only grow. See the
[privacy policy](https://time-spent-site.sankalpmukim.workers.dev/privacy).

## License

MIT
