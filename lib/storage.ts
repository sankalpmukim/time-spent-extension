import { browser } from "wxt/browser";
import { DEFAULT_SETTINGS, STORAGE_KEYS, type Settings, type Totals } from "./shared";
import type { SyncState } from "./messages";

export async function getSettings(): Promise<Settings> {
  const obj = await browser.storage.local.get(STORAGE_KEYS.settings);
  const stored = (obj?.[STORAGE_KEYS.settings] ?? {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    position: { ...DEFAULT_SETTINGS.position, ...(stored.position ?? {}) },
    sites: stored.sites ?? [],
  };
}

export async function setSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.settings]: settings });
}

export async function getTotals(): Promise<Totals> {
  const obj = await browser.storage.local.get(STORAGE_KEYS.totals);
  return (obj?.[STORAGE_KEYS.totals] ?? {}) as Totals;
}

export async function setTotals(totals: Totals): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.totals]: totals });
}

export async function getSyncState(): Promise<SyncState> {
  const obj = await browser.storage.local.get(STORAGE_KEYS.sync);
  return (obj?.[STORAGE_KEYS.sync] ?? { signedIn: false }) as SyncState;
}

export async function setSyncState(state: SyncState): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.sync]: state });
}
