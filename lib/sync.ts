/**
 * Optional, opt-in sync engine. Runs only in the background context.
 *
 * All time data lives in browser.storage.local. When the user signs in with
 * Google, absolute per-day totals are pushed to the Convex backend and remote
 * totals are merged locally with a max() strategy — across devices the
 * recorded time can only grow, never shrink (anti-cheat).
 */
import { browser } from "wxt/browser";
import { dateKey, mergeTotals } from "./shared";
import type { SyncState } from "./messages";
import { getSyncState, getTotals, setSyncState, setTotals } from "./storage";

const CONVEX_URL = (import.meta.env.VITE_CONVEX_URL ?? "").replace(/\/+$/, "");
const AUTH_PAGE_URL = (import.meta.env.VITE_AUTH_PAGE_URL ?? "").replace(/\/+$/, "");

const PUSH_WINDOW_DAYS = 7;
const PULL_WINDOW_DAYS = 14;
const PUSH_EVERY_MS = 2 * 60_000;
const PULL_EVERY_MS = 10 * 60_000;

let dirty = false;
let pullTicks = 0;

export function markDirty(): void {
  dirty = true;
}

function authHeaders(state: SyncState): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${state.sessionToken ?? ""}`,
  };
}

/* ------------------------------------------------------------------ */
/* Login / logout                                                      */
/* ------------------------------------------------------------------ */

function extractParam(url: string, key: string): string | null {
  try {
    const u = new URL(url);
    const hash = u.hash.startsWith("#") ? u.hash.slice(1) : u.hash;
    if (hash) {
      const params = new URLSearchParams(hash);
      const v = params.get(key);
      if (v) return v;
    }
    const q = u.searchParams.get(key);
    return q ?? null;
  } catch {
    return null;
  }
}

export async function syncLogin(): Promise<SyncState> {
  let state = await getSyncState();
  if (!CONVEX_URL) {
    state = { ...state, signedIn: false, lastError: "Sync is not configured in this build." };
    await setSyncState(state);
    return state;
  }
  try {
    const redirect = browser.identity.getRedirectURL();
    const authUrl = `${AUTH_PAGE_URL}?redirect=${encodeURIComponent(redirect)}`;
    const respUrl = await browser.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
    const idToken = respUrl ? extractParam(respUrl, "id_token") : null;
    if (!idToken) throw new Error("No credential returned from sign-in page.");

    const res = await fetch(`${CONVEX_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ googleIdToken: idToken }),
    });
    if (!res.ok) throw new Error(`Login failed (${res.status})`);
    const data = (await res.json()) as { token: string; email?: string; name?: string };

    state = {
      signedIn: true,
      sessionToken: data.token,
      email: data.email,
      name: data.name,
      lastError: undefined,
    };
    await setSyncState(state);
    await syncNow();
    return await getSyncState();
  } catch (err) {
    state = {
      ...(await getSyncState()),
      lastError: err instanceof Error ? err.message : "Sign-in failed.",
    };
    await setSyncState(state);
    return state;
  }
}

export async function syncLogout(): Promise<SyncState> {
  const state = await getSyncState();
  if (state.sessionToken && CONVEX_URL) {
    try {
      await fetch(`${CONVEX_URL}/api/auth/logout`, {
        method: "POST",
        headers: authHeaders(state),
      });
    } catch {
      /* best effort */
    }
  }
  const next: SyncState = { signedIn: false };
  await setSyncState(next);
  return next;
}

export async function syncStatus(): Promise<SyncState> {
  const state = await getSyncState();
  // don't leak the token to the options page
  const { sessionToken, ...rest } = state;
  return rest as SyncState;
}

/* ------------------------------------------------------------------ */
/* Push / pull                                                         */
/* ------------------------------------------------------------------ */

async function push(state: SyncState): Promise<void> {
  const totals = await getTotals();
  const days: Record<string, Record<string, number>> = {};
  for (let i = 0; i < PUSH_WINDOW_DAYS; i++) {
    const key = dateKey(new Date(Date.now() - i * 86400_000));
    if (totals[key]) days[key] = totals[key];
  }
  if (Object.keys(days).length === 0) return;
  const res = await fetch(`${CONVEX_URL}/api/sync/push`, {
    method: "POST",
    headers: authHeaders(state),
    body: JSON.stringify({ days }),
  });
  if (!res.ok) throw new Error(`Push failed (${res.status})`);
}

async function pull(state: SyncState): Promise<void> {
  const res = await fetch(`${CONVEX_URL}/api/sync/pull?days=${PULL_WINDOW_DAYS}`, {
    headers: authHeaders(state),
  });
  if (!res.ok) throw new Error(`Pull failed (${res.status})`);
  const data = (await res.json()) as { days: Record<string, Record<string, number>> };
  const local = await getTotals();
  const merged = mergeTotals(local, data.days ?? {});
  await setTotals(merged);
}

/** Push/pull now (manual or post-login). */
export async function syncNow(): Promise<void> {
  const state = await getSyncState();
  if (!state.signedIn || !state.sessionToken || !CONVEX_URL) return;
  try {
    await push(state);
    state.lastPushAt = Date.now();
    dirty = false;
    await pull(state);
    state.lastPullAt = Date.now();
    state.lastError = undefined;
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : "Sync failed.";
  }
  await setSyncState(state);
}

/** Periodic alarm entry point: cheap cadence, full round every ~10 min. */
export async function syncTick(): Promise<void> {
  const state = await getSyncState();
  if (!state.signedIn || !state.sessionToken || !CONVEX_URL) return;
  const now = Date.now();
  const shouldPush = dirty || now - (state.lastPushAt ?? 0) > PUSH_EVERY_MS;
  const shouldPull = now - (state.lastPullAt ?? 0) > PULL_EVERY_MS;
  if (!shouldPush && !shouldPull) return;
  try {
    if (shouldPush) {
      await push(state);
      state.lastPushAt = Date.now();
      dirty = false;
    }
    if (shouldPull) {
      await pull(state);
      state.lastPullAt = Date.now();
    }
    state.lastError = undefined;
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : "Sync failed.";
  }
  await setSyncState(state);
}
