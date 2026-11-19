# Framework evaluation: Plasmo vs WXT

Decision made: **WXT** (v0.21.x). Evaluated 2026-11-19 for this project.

## Requirements that drove the evaluation

1. One codebase, three targets: Chrome/Chromium (MV3), Firefox desktop (MV2 or MV3), **Firefox for Android**.
2. A content script that is **not statically injected into `<all_urls>`** — it must be registered
   at runtime, per-site, only after the user opts in (per-site permission model).
3. Small per-page overhead (the overlay runs on third-party pages; no framework weight).
4. Options page can use React; bundling must keep React out of the content script.
5. Actively maintained toolchain (this is a long-lived published product).

## Findings

| Criterion | Plasmo 0.90.5 | WXT 0.21.5 |
| --- | --- | --- |
| Last release at evaluation | May 2025 (~18 months old) | Nov 2026 (active) |
| Community signal | ~350k dl/wk, 347 open issues, maintenance mode acknowledged by the community | ~430k dl/wk, active releases and docs |
| Bundler | Parcel (stuck on older majors; a known pain point in Plasmo issue tracker) | Vite 8 |
| Firefox target | `--target firefox` (MV2) | `-b firefox` (MV2 default), MV3 supported |
| Runtime-registered content scripts | Supported via CSUI but designed around static entrypoints; runtime registration requires reaching into build output paths | First-class: `defineContentScript({ registration: "runtime" })` builds the script to a stable path (`content-scripts/overlay.js`) and keeps it out of the manifest — exactly our per-site opt-in model |
| Content script without framework | Possible, but the tooling nudges you to CSUI (React-in-page) | Natural — plain TS entrypoint; React stays in the options page (231 kB chunk) while the overlay is 8.5 kB |
| Firefox Android | Works (MV2) | Works (MV2; we set `strict_min_version: 142` for the data-collection manifest key) |
| Dev DX | Good | Excellent: `wxt dev` auto-opens the browser, storage utilities, typed manifest config |

## Decision rationale

Plasmo pioneered this DX and its CSUI concept is genuinely nice, but by November 2026 it is
effectively unmaintained (last release May 2025, open issues piling up, Parcel staleness reported
by users). Building a new published product on a maintenance-mode bundler would put every future
browser-API migration on us. WXT is the community's chosen successor, is built on Vite, and
solves requirement #2 (runtime content-script registration for per-site opt-in) as a first-class
feature — which Plasmo has no equivalent for. The migration cost was zero since we started greenfield.

The overlay itself is dependency-free TypeScript (no React in content scripts), which removes the
main framework coupling; if WXT ever stalls, the entrypoints port to raw `webextension` manifests
in an afternoon.
