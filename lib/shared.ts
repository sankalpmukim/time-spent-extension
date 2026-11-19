/**
 * Shared core logic used by the content script, background, and options page.
 * Pure TypeScript — no browser APIs, no DOM. Safe to import everywhere.
 */

export type Corner = "tl" | "tr" | "bl" | "br";

export interface OverlayPosition {
  corner: Corner;
  /** px from the left (tl/bl) or right (tr/br) viewport edge */
  marginX: number;
  /** px from the top (tl/tr) or bottom (bl/br) viewport edge */
  marginY: number;
}

export interface TrackedSite {
  /** canonical host string, e.g. "reddit.com" — also the sync/totals bucket key */
  host: string;
  includeSubdomains: boolean;
  createdAt: number;
}

export interface Settings {
  sites: TrackedSite[];
  /** seconds today after which the font starts growing linearly */
  growAfterSec: number;
  /** seconds today after which the text turns red and pulses */
  redAfterSec: number;
  position: OverlayPosition;
}

export type Totals = Record<string, Record<string, number>>;

export const DEFAULT_SETTINGS: Settings = {
  sites: [],
  growAfterSec: 5 * 60,
  redAfterSec: 30 * 60,
  position: { corner: "tr", marginX: 16, marginY: 16 },
};

/** Base and max overlay font size in px. Growth is linear between thresholds. */
export const FONT_BASE_PX = 18;
export const FONT_MAX_SCALE = 4;

export const STORAGE_KEYS = {
  settings: "settings",
  totals: "totals",
  sync: "syncState",
} as const;

/** How many days of totals to keep locally. */
export const KEEP_DAYS = 90;

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

/** Local-timezone YYYY-MM-DD key for a Date (defaults to now). */
export function dateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ------------------------------------------------------------------ */
/* Host matching                                                       */
/* ------------------------------------------------------------------ */

/**
 * Normalize user input like "https://www.youtube.com/watch?x=1",
 * "WWW.YouTube.com" or "youtube.com/" into a bare lowercase host.
 * Returns null for input that doesn't look like a hostname.
 */
export function normalizeHostInput(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) {
    try {
      s = new URL(s).hostname;
    } catch {
      return null;
    }
  }
  // strip path/query/fragment leftovers if no protocol was given
  s = s.split("/")[0] ?? s;
  s = s.split("?")[0] ?? s;
  s = s.split("#")[0] ?? s;
  s = s.split(":")[0] ?? s;
  s = s.replace(/\.+$/, "");
  if (s.startsWith("www.")) s = s.slice(4);
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) {
    return null;
  }
  return s;
}

/** Does a page hostname belong to this tracked site? */
export function matchesSite(host: string, site: TrackedSite): boolean {
  const h = host.toLowerCase();
  const s = site.host.toLowerCase();
  return h === s || (site.includeSubdomains && h.endsWith("." + s));
}

/** Find the tracked site a page hostname belongs to, if any. */
export function resolveSite(host: string, sites: TrackedSite[]): TrackedSite | null {
  for (const site of sites) {
    if (matchesSite(host, site)) return site;
  }
  return null;
}

/** Origin permission patterns to request for a tracked site. */
export function originPatternsForSite(site: TrackedSite): string[] {
  const pats = [`*://${site.host}/*`];
  if (site.includeSubdomains) pats.push(`*://*.${site.host}/*`);
  return pats;
}

/** Match patterns for dynamic content-script registration. */
export function matchPatternsForSite(site: TrackedSite): string[] {
  return originPatternsForSite(site);
}

/* ------------------------------------------------------------------ */
/* Display                                                             */
/* ------------------------------------------------------------------ */

/** M:SS or H:MM:SS */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Compact badge text: "5m", "59m", "1h40", "12h" */
export function formatBadge(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return "";
  const m = Math.floor(s / 60);
  if (m < 100) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 10) {
    const rem = String(m % 60).padStart(2, "0").slice(0, 2);
    return `${h}h${rem}`;
  }
  return `${h}h`;
}

/**
 * Font size in px: constant base until growAfterSec, then grows linearly
 * until redAfterSec where it reaches FONT_MAX_SCALE × base, then capped.
 */
export function fontSizeFor(seconds: number, settings: Settings): number {
  const { growAfterSec, redAfterSec } = settings;
  if (seconds <= growAfterSec) return FONT_BASE_PX;
  const window = Math.max(1, redAfterSec - growAfterSec);
  const progress = Math.min(1, (seconds - growAfterSec) / window);
  return FONT_BASE_PX * (1 + progress * (FONT_MAX_SCALE - 1));
}

/* ------------------------------------------------------------------ */
/* Totals helpers                                                      */
/* ------------------------------------------------------------------ */

export function todaySecondsFor(totals: Totals, bucket: string, key = dateKey()): number {
  return totals[key]?.[bucket] ?? 0;
}

/** Merge remote days into local totals using max() — anti-cheat: time never decreases. */
export function mergeTotals(local: Totals, remoteDays: Record<string, Record<string, number>>): Totals {
  const out: Totals = { ...local };
  for (const [day, entries] of Object.entries(remoteDays)) {
    const merged = { ...(out[day] ?? {}) };
    for (const [host, seconds] of Object.entries(entries)) {
      merged[host] = Math.max(merged[host] ?? 0, seconds);
    }
    out[day] = merged;
  }
  return out;
}

/** Drop days older than KEEP_DAYS. Returns the input unchanged if nothing to prune. */
export function pruneTotals(totals: Totals): Totals {
  const cutoff = dateKey(new Date(Date.now() - KEEP_DAYS * 86400_000));
  const keys = Object.keys(totals).filter((k) => k < cutoff);
  if (keys.length === 0) return totals;
  const out = { ...totals };
  for (const k of keys) delete out[k];
  return out;
}
