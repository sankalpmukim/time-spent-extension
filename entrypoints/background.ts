import { browser } from "wxt/browser";
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  type Settings,
  type Totals,
  type TrackedSite,
  dateKey,
  formatBadge,
  matchPatternsForSite,
  originPatternsForSite,
  pruneTotals,
  resolveSite,
} from "../lib/shared";
import type { BackgroundRequest, BackgroundResponse, OverlayState, SyncState } from "../lib/messages";
import { getSettings, getTotals, setSettings, setTotals, getSyncState, setSyncState } from "../lib/storage";
import { syncLogin, syncLogout, syncNow, syncStatus, syncTick, markDirty } from "../lib/sync";

/* ------------------------------------------------------------------ */
/* Storage helpers are in lib/storage.ts                               */
/* ------------------------------------------------------------------ */

const CONTENT_SCRIPT_ID = "overlay-cs";
const CONTENT_SCRIPT_PATH = "/content-scripts/overlay.js";

/** browser.action (MV3) / browser.browserAction (MV2) */
function actionApi(): typeof browser.action {
  const b = browser as unknown as Record<string, unknown>;
  return (b.action ?? b.browserAction) as typeof browser.action;
}

/* ------------------------------------------------------------------ */
/* Dynamic content-script registration (per-site opt-in)               */
/* ------------------------------------------------------------------ */

async function grantedOrigins(): Promise<Set<string>> {
  const all = await browser.permissions.getAll();
  return new Set(all.origins ?? []);
}

/** Patterns for every tracked site that the user has actually granted. */
async function grantedMatchPatterns(): Promise<string[]> {
  const settings = await getSettings();
  const granted = await grantedOrigins();
  const patterns = new Set<string>();
  for (const site of settings.sites) {
    for (const p of matchPatternsForSite(site)) {
      if (granted.has(p)) patterns.add(p);
    }
  }
  return [...patterns];
}

let mv2Unregister: (() => Promise<void>) | null = null;

export async function reregisterContentScripts(): Promise<void> {
  const matches = await grantedMatchPatterns();

  // MV3 (Chrome + Firefox MV3): scripting.registerContentScripts
  const scripting = (browser as unknown as { scripting?: any }).scripting;
  if (scripting?.registerContentScripts) {
    try {
      await scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    } catch {
      /* not registered yet */
    }
    if (matches.length === 0) return;
    await scripting.registerContentScripts([
      {
        id: CONTENT_SCRIPT_ID,
        js: [CONTENT_SCRIPT_PATH],
        matches,
        runAt: "document_end",
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
    return;
  }

  // MV2 (Firefox): browser.contentScripts.register (does not persist across restarts)
  const contentScripts = (browser as unknown as { contentScripts?: any }).contentScripts;
  if (mv2Unregister) {
    try {
      await mv2Unregister();
    } catch {
      /* ignore */
    }
    mv2Unregister = null;
  }
  if (!contentScripts || matches.length === 0) return;
  const handle = await contentScripts.register({
    matches,
    js: [{ file: CONTENT_SCRIPT_PATH }],
    runAt: "document_end",
    allFrames: false,
  });
  mv2Unregister = () => handle.unregister();
}

/** Inject the overlay into tabs of a just-added site that are already open. */
async function injectIntoExistingTabs(site: TrackedSite): Promise<void> {
  const patterns = matchPatternsForSite(site);
  let tabs: { id?: number }[];
  try {
    tabs = await browser.tabs.query({ url: patterns });
  } catch {
    return;
  }
  const scripting = (browser as unknown as { scripting?: any }).scripting;
  for (const tab of tabs) {
    if (tab.id == null) continue;
    try {
      if (scripting?.executeScript) {
        await scripting.executeScript({ target: { tabId: tab.id }, files: [CONTENT_SCRIPT_PATH] });
      } else {
        await (browser as unknown as { tabs: any }).tabs.executeScript(tab.id, { file: CONTENT_SCRIPT_PATH });
      }
    } catch {
      /* tab may not be scriptable (chrome://, web store…) */
    }
  }
}

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

function updateBadge(tabId: number | undefined, seconds: number, settings: Settings) {
  if (tabId == null) return;
  const api = actionApi();
  try {
    api.setBadgeText({ tabId, text: formatBadge(seconds) });
    api.setBadgeBackgroundColor({
      tabId,
      color: seconds >= settings.redAfterSec ? "#d92b2b" : "#3d3d43",
    });
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Site management                                                     */
/* ------------------------------------------------------------------ */

function normalizeIncludeSubdomains(includeSubdomains?: boolean): boolean {
  return includeSubdomains !== false;
}

async function addSiteCore(
  rawInput: string,
  includeSubdomains: boolean,
  opts: { permissionAlreadyGranted?: boolean; fromGesture?: boolean },
): Promise<BackgroundResponse> {
  const { normalizeHostInput } = await import("../lib/shared");
  const host = normalizeHostInput(rawInput);
  if (!host) return { added: null, error: "That doesn't look like a website address." };

  const settings = await getSettings();
  if (settings.sites.some((s) => s.host === host)) return { added: host };

  const site: TrackedSite = { host, includeSubdomains, createdAt: Date.now() };
  const patterns = originPatternsForSite(site);
  const granted = await grantedOrigins();
  const missing = patterns.filter((p) => !granted.has(p));
  if (missing.length > 0) {
    let ok = false;
    if (opts.permissionAlreadyGranted !== true) {
      try {
        ok = await browser.permissions.request({ origins: missing });
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      return {
        added: null,
        error: `Permission for ${host} was not granted, so it can't be tracked.`,
      };
    }
  }

  settings.sites.push(site);
  await setSettings(settings);
  await reregisterContentScripts();
  await injectIntoExistingTabs(site);
  return { added: host };
}

async function removeSiteCore(host: string): Promise<BackgroundResponse> {
  const settings = await getSettings();
  const site = settings.sites.find((s) => s.host === host);
  if (!site) return {};
  const patterns = matchPatternsForSite(site);

  // clear badges on that site's tabs while we still hold permission to find them
  try {
    const tabs = await browser.tabs.query({ url: patterns });
    for (const tab of tabs) {
      if (tab.id != null) actionApi().setBadgeText({ tabId: tab.id, text: "" });
    }
  } catch {
    /* ignore */
  }

  settings.sites = settings.sites.filter((s) => s.host !== host);
  await setSettings(settings);

  // drop origin permissions no other tracked site needs
  const stillNeeded = new Set(settings.sites.flatMap(originPatternsForSite));
  const toRemove = patterns.filter((p) => !stillNeeded.has(p));
  if (toRemove.length > 0) {
    try {
      await browser.permissions.remove({ origins: toRemove });
    } catch {
      /* ignore */
    }
  }
  await reregisterContentScripts();
  return {};
}

/* ------------------------------------------------------------------ */
/* Message router                                                      */
/* ------------------------------------------------------------------ */

async function handleMessage(
  msg: BackgroundRequest,
  sender: Browser.runtime.MessageSender,
): Promise<BackgroundResponse> {
  switch (msg.type) {
    case "getOverlayState": {
      const settings = await getSettings();
      const site = resolveSite(msg.host, settings.sites);
      const totals = await getTotals();
      const today = site ? (totals[dateKey()]?.[site.host] ?? 0) : 0;
      const state: OverlayState = { site, todaySeconds: today, settings };
      return { overlay: state };
    }

    case "tick": {
      if (!Number.isFinite(msg.deltaSeconds) || msg.deltaSeconds <= 0) return {};
      const delta = Math.min(60, Math.floor(msg.deltaSeconds)); // sanity clamp
      const day = /^\d{4}-\d{2}-\d{2}$/.test(msg.dateKey) ? msg.dateKey : dateKey();
      const settings = await getSettings();
      const site = resolveSite(msg.host, settings.sites);
      if (!site) return { removed: true };
      const totals = await getTotals();
      const dayTotals = { ...(totals[day] ?? {}) };
      const newTotal = (dayTotals[site.host] ?? 0) + delta;
      dayTotals[site.host] = newTotal;
      const next: Totals = pruneTotals({ ...totals, [day]: dayTotals });
      await setTotals(next);
      markDirty();
      updateBadge(sender.tab?.id, newTotal, settings);
      return { todaySeconds: newTotal };
    }

    case "savePosition": {
      const settings = await getSettings();
      settings.position = msg.position;
      await setSettings(settings);
      return {};
    }

    case "resetPosition": {
      const settings = await getSettings();
      settings.position = DEFAULT_SETTINGS.position;
      await setSettings(settings);
      return {};
    }

    case "addSite":
      return addSiteCore(msg.input, normalizeIncludeSubdomains(msg.includeSubdomains), {
        permissionAlreadyGranted: true,
      });

    case "removeSite":
      return removeSiteCore(msg.host);

    case "updateThresholds": {
      const grow = Math.max(0, Math.floor(msg.growAfterSec));
      const red = Math.max(grow + 60, Math.floor(msg.redAfterSec));
      const settings = await getSettings();
      settings.growAfterSec = grow;
      settings.redAfterSec = red;
      await setSettings(settings);
      return {};
    }

    case "sync:status":
      return { sync: await syncStatus() };

    case "sync:login":
      return { sync: await syncLogin() };

    case "sync:logout":
      return { sync: await syncLogout() };

    case "sync:now": {
      await syncNow();
      return { sync: await syncStatus() };
    }

    default:
      return { error: "Unknown message" };
  }
}

/* ------------------------------------------------------------------ */
/* Wiring                                                              */
/* ------------------------------------------------------------------ */

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: BackgroundRequest, sender, sendResponse) => {
    handleMessage(msg, sender).then(sendResponse);
    return true; // async response
  });

  browser.runtime.onInstalled.addListener((details) => {
    reregisterContentScripts();
    if (details.reason === "install") {
      browser.runtime.openOptionsPage();
    }
  });

  browser.runtime.onStartup?.addListener(() => {
    reregisterContentScripts();
    syncNow().catch(() => {});
  });

  // toolbar click opens settings (works on Android Firefox too)
  actionApi().onClicked.addListener(() => {
    browser.runtime.openOptionsPage();
  });

  // right-click → track this site
  browser.contextMenus.create({
    id: "ts-track-page",
    title: "Track time on this site",
    contexts: ["page"],
  });
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== "ts-track-page") return;
    const url = info.pageUrl ?? tab?.url;
    let host: string | null = null;
    if (url) {
      try {
        host = new URL(url).hostname;
      } catch {
        host = null;
      }
    }
    if (!host) {
      browser.runtime.openOptionsPage();
      return;
    }
    const res = await addSiteCore(host, true, { fromGesture: true });
    if (!res.added && res.error) {
      // no gesture-safe permission path available → let the user add it in settings
      await browser.tabs.create({ url: browser.runtime.getURL(`/options.html?add=${encodeURIComponent(host)}`) });
    }
  });

  // periodic sync + safety net for dynamic registration
  browser.alarms.create("ts-sync", { periodInMinutes: 1, delayInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "ts-sync") {
      syncTick().catch(() => {});
    }
  });
});
