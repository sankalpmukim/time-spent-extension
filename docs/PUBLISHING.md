# Publishing & operations runbook

Everything below has already been executed once (Nov 19, 2026). This is the record + the repeatable path.

## Assets & identifiers

| Thing | Value |
| --- | --- |
| Extension ID (Firefox, gecko) | `time-spent@mukim.dev` |
| Extension ID (Chrome Web Store) | `fhnlllibaooecdllgedhalbkihljdmdh` |
| AMO listing | https://addons.mozilla.org/firefox/addon/time-spent1/ (pending review) |
| CWS listing | https://chromewebstore.google.com/detail/time-spent/fhnlllibaooecdllgedhalbkihljdmdh (pending re-review) |
| Convex prod | `watchful-salamander-923.convex.cloud` (HTTP: `…convex.site`) |
| Site (Cloudflare Worker) | `time-spent-site.sankalpmukim.workers.dev` (landing `/`, relay `/auth/`, policy `/privacy/`) |
| Google OAuth client (GIS) | `1022405705915-7vjg4ta2c0dgssu3lunnbq1isgr1dar6…` (Web app; JS origin = site URL) |
| Google OAuth client (CWS API) | `1022405705915-8prb7in7vkal4qlejmegabrgduk684om…` (Desktop app; loopback flow) |

## Secrets on this machine (gitignored)

- `.env` — `VITE_CONVEX_URL`, `VITE_AUTH_PAGE_URL` (baked into extension builds)
- `.env.amo` — AMO API key/secret (`web-ext sign`). JWT issuer `user:16866510:426`. Regenerate at
  https://addons.mozilla.org/developers/addon/api/key/ if lost.
- `.cws-tokens.json` — CWS API refresh token (scope `chromewebstore`)
- Convex env (prod): `GOOGLE_CLIENT_ID` via `pnpm exec convex env set --prod`

## Build & release

```sh
pnpm build && pnpm build:firefox          # → .output/chrome-mv3, .output/firefox-mv2
pnpm exec wxt zip && pnpm exec wxt zip -b firefox   # → .output/time-spent-<v>-{chrome,firefox}.zip + sources zip
```

Bump `version` in `package.json` before each release (WXT propagates it to the manifest).

### Firefox (AMO) — automated

```sh
source .env.amo
pnpm exec web-ext sign --source-dir .output/firefox-mv2 --channel listed \
  --api-key "$AMO_API_KEY" --api-secret "$AMO_API_SECRET" \
  --amo-metadata amo-metadata.json \
  --upload-source-code ".output/time-spent-<version>-sources.zip"
```

Notes learned the hard way:
- `amo-metadata.json` needs `version.license` (e.g. `"MIT"` — NOT top-level), and
  `categories: { firefox: ["other"] }` for a new listing. Valid category slugs only
  (no "productivity"/"tools"/"websites" for new submissions — `other` works).
- AMO rate-limits aggressively (~1 req/40s; a 429 tells you the wait).
- Attaching sources post-hoc: `node scripts/amo-upload-source.mjs` (uses the same key/secret).

### Chrome Web Store — upload via API, listing via dashboard

```sh
node scripts/cws-oauth.mjs   # one-time (or after token expiry): loopback OAuth, writes .cws-tokens.json
TOKEN=$(python3 -c "import json;print(json.load(open('.cws-tokens.json'))['access_token'])")
# new version upload:
curl -X POST "https://www.googleapis.com/upload/chromewebstore/v1.1/items" \
  -H "Authorization: Bearer $TOKEN" -H "x-goog-api-version: 2" \
  -H "Content-Type: application/zip" --data-binary @.output/time-spent-<v>-chrome.zip
# publish (after listing fields are complete):
curl -X POST "https://www.googleapis.com/chromewebstore/v1.1/items/fhnlllibaooecdllgedhalbkihljdmdh/publish" \
  -H "Authorization: Bearer $TOKEN" -H "x-goog-api-version: 2"
```

Listing details (description, category, screenshots, privacy disclosures) are dashboard-only:
https://chrome.google.com/webstore/devconsole/fhnlllibaooecdllgedhalbkihljdmdh/edit

**Rejection received & fixed (2026-11-19):** "Keyword spam" for the browser-name list
("Firefox desktop, Firefox for Android, Chrome, Edge, Brave, Arc") in the description.
Removed; description now avoids brand keyword stacking. Resubmitted same day.

### Site (Cloudflare)

```sh
./scripts/deploy-site.sh <GOOGLE_CLIENT_ID>   # rebuilds + injects client id + cf deploy
```

## Convex backend

```sh
pnpm exec convex dev --once    # dev push (local deployment per .env.local)
pnpm exec convex deploy        # prod push
```

## Verification quickstart (after approval)

1. Install from AMO on desktop Firefox and on Firefox for Android; install from CWS on Chrome.
2. Add `youtube.com` via options → confirm permission prompt → overlay appears top-right.
3. Focus the tab 65 s → badge shows `1m`, overlay `1:05`.
4. Set grow-after to 1 min temporarily → font grows; drag chip to bottom-left → snaps.
5. Sign in with Google on two browsers → totals merge to the max within ~1 min.
