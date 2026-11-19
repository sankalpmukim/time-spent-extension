/**
 * Quick unit tests for lib/shared.ts — run with:
 *   node --test --experimental-strip-types scripts/test-shared.mts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SETTINGS,
  dateKey,
  fontSizeFor,
  formatBadge,
  formatDuration,
  matchesSite,
  mergeTotals,
  normalizeHostInput,
  pruneTotals,
  resolveSite,
  originPatternsForSite,
  FONT_BASE_PX,
} from "../lib/shared.ts";

test("normalizeHostInput parses urls, hosts, and strips www", () => {
  assert.equal(normalizeHostInput("https://www.YouTube.com/watch?v=x"), "youtube.com");
  assert.equal(normalizeHostInput("WWW.Reddit.com/"), "reddit.com");
  assert.equal(normalizeHostInput("news.ycombinator.com"), "news.ycombinator.com");
  assert.equal(normalizeHostInput("not a url!!"), null);
});

test("normalizeHostInput rejects bare hostnames without a dot", () => {
  assert.equal(normalizeHostInput("localhost"), null);
  assert.equal(normalizeHostInput(""), null);
});

test("matchesSite handles subdomains", () => {
  const site = { host: "reddit.com", includeSubdomains: true, createdAt: 0 };
  assert.ok(matchesSite("reddit.com", site));
  assert.ok(matchesSite("www.reddit.com", site));
  assert.ok(matchesSite("old.reddit.com", site));
  assert.ok(!matchesSite("reddit.co", site));
  assert.ok(!matchesSite("notreddit.com", site));
  const exact = { host: "reddit.com", includeSubdomains: false, createdAt: 0 };
  assert.ok(!matchesSite("old.reddit.com", exact));
});

test("resolveSite finds first match", () => {
  const sites = [
    { host: "a.com", includeSubdomains: false, createdAt: 0 },
    { host: "b.com", includeSubdomains: true, createdAt: 0 },
  ];
  assert.equal(resolveSite("x.b.com", sites)?.host, "b.com");
  assert.equal(resolveSite("a.com", sites)?.host, "a.com");
  assert.equal(resolveSite("c.com", sites), null);
});

test("formatDuration", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(65), "1:05");
  assert.equal(formatDuration(3599), "59:59");
  assert.equal(formatDuration(3600), "1:00:00");
  assert.equal(formatDuration(7322), "2:02:02");
});

test("formatBadge", () => {
  assert.equal(formatBadge(30), "");
  assert.equal(formatBadge(60), "1m");
  assert.equal(formatBadge(5940), "99m");
  assert.equal(formatBadge(6000), "1h40");
  assert.equal(formatBadge(3600 * 12), "12h");
});

test("fontSizeFor grows linearly between thresholds then caps", () => {
  const s = { ...DEFAULT_SETTINGS, growAfterSec: 300, redAfterSec: 900 };
  assert.equal(fontSizeFor(0, s), FONT_BASE_PX);
  assert.equal(fontSizeFor(300, s), FONT_BASE_PX);
  const mid = fontSizeFor(600, s); // halfway
  assert.ok(mid > FONT_BASE_PX && mid < FONT_BASE_PX * 4);
  assert.ok(Math.abs(mid - FONT_BASE_PX * 2.5) < 0.01); // linear midpoint = base*(1+0.5*3)
  assert.equal(fontSizeFor(900, s), FONT_BASE_PX * 4);
  assert.equal(fontSizeFor(99999, s), FONT_BASE_PX * 4); // capped
});

test("mergeTotals keeps max per host/day", () => {
  const local = { "2026-11-19": { "reddit.com": 100 } };
  const remote = { "2026-11-19": { "reddit.com": 300, "x.com": 50 }, "2026-11-18": { "x.com": 10 } };
  const merged = mergeTotals(local, remote);
  assert.equal(merged["2026-11-19"]?.["reddit.com"], 300);
  assert.equal(merged["2026-11-19"]?.["x.com"], 50);
  assert.equal(merged["2026-11-18"]?.["x.com"], 10);
});

test("pruneTotals drops old days", () => {
  const old = dateKey(new Date(Date.now() - 120 * 86400_000));
  const recent = dateKey();
  const totals = { [old]: { "a.com": 1 }, [recent]: { "b.com": 2 } };
  const pruned = pruneTotals(totals);
  assert.equal(pruned[old], undefined);
  assert.equal(pruned[recent]?.["b.com"], 2);
});

test("originPatternsForSite", () => {
  assert.deepEqual(originPatternsForSite({ host: "a.com", includeSubdomains: true, createdAt: 0 }), [
    "*://a.com/*",
    "*://*.a.com/*",
  ]);
  assert.deepEqual(originPatternsForSite({ host: "a.com", includeSubdomains: false, createdAt: 0 }), [
    "*://a.com/*",
  ]);
});

test("dateKey uses local time", () => {
  const d = new Date(2026, 10, 19, 23, 59);
  assert.equal(dateKey(d), "2026-11-19");
});
