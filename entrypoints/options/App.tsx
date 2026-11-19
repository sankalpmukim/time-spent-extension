import { useCallback, useEffect, useMemo, useState } from "react";
import { browser } from "wxt/browser";
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  type Settings,
  type Totals,
  dateKey,
  fontSizeFor,
  formatDuration,
  normalizeHostInput,
  originPatternsForSite,
} from "../../lib/shared";
import type { BackgroundRequest, BackgroundResponse, SyncState } from "../../lib/messages";

/* ------------------------------------------------------------------ */
/* Messaging + storage hooks                                           */
/* ------------------------------------------------------------------ */

async function send(msg: BackgroundRequest): Promise<BackgroundResponse | null> {
  try {
    return (await browser.runtime.sendMessage(msg)) as BackgroundResponse;
  } catch {
    return null;
  }
}

function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    browser.storage.local.get(STORAGE_KEYS.settings).then((obj) => {
      const stored = (obj?.[STORAGE_KEYS.settings] ?? {}) as Partial<Settings>;
      setSettings({
        ...DEFAULT_SETTINGS,
        ...stored,
        position: { ...DEFAULT_SETTINGS.position, ...(stored.position ?? {}) },
        sites: stored.sites ?? [],
      });
    });
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      const change = changes[STORAGE_KEYS.settings];
      if (area === "local" && change?.newValue) {
        const next = change.newValue as Settings;
        setSettings({ ...DEFAULT_SETTINGS, ...next, position: { ...DEFAULT_SETTINGS.position, ...next.position } });
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);
  return settings;
}

function useTotals() {
  const [totals, setTotals] = useState<Totals>({});
  useEffect(() => {
    browser.storage.local.get(STORAGE_KEYS.totals).then((obj) => {
      setTotals((obj?.[STORAGE_KEYS.totals] ?? {}) as Totals);
    });
    const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      const change = changes[STORAGE_KEYS.totals];
      if (area === "local" && change?.newValue) {
        setTotals(change.newValue as Totals);
      }
    };
    browser.storage.onChanged.addListener(listener);
    return () => browser.storage.onChanged.removeListener(listener);
  }, []);
  return totals;
}

function useSyncState() {
  const [sync, setSync] = useState<SyncState | null>(null);
  const refresh = useCallback(async () => {
    const res = await send({ type: "sync:status" });
    setSync(res?.sync ?? { signedIn: false });
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { sync, refresh };
}

/* ------------------------------------------------------------------ */
/* Small components                                                    */
/* ------------------------------------------------------------------ */

function relTime(ts?: number): string {
  if (!ts) return "never";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

const QUICK_SITES = [
  "youtube.com",
  "x.com",
  "reddit.com",
  "instagram.com",
  "tiktok.com",
  "facebook.com",
  "news.ycombinator.com",
  "linkedin.com",
  "twitch.tv",
  "threads.net",
];

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

function SitesTab({ settings, totals }: { settings: Settings; totals: Totals }) {
  const [input, setInput] = useState(() => {
    const params = new URLSearchParams(location.search);
    const add = params.get("add");
    return add ? decodeURIComponent(add) : "";
  });
  const [includeSubdomains, setIncludeSubdomains] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const today = dateKey();
  const todayEntries = useMemo(() => {
    const day = totals[today] ?? {};
    return Object.entries(day).sort((a, b) => b[1] - a[1]);
  }, [totals, today]);

  const weekSeconds = useMemo(() => {
    const sums: Record<string, number> = {};
    for (let i = 0; i < 7; i++) {
      const key = dateKey(new Date(Date.now() - i * 86400_000));
      for (const [host, sec] of Object.entries(totals[key] ?? {})) {
        sums[host] = (sums[host] ?? 0) + sec;
      }
    }
    return sums;
  }, [totals]);

  const todayGrandTotal = todayEntries.reduce((acc, [, sec]) => acc + sec, 0);

  async function addSite(rawInput: string) {
    setError(null);
    const host = normalizeHostInput(rawInput);
    if (!host) {
      setError("That doesn't look like a website address. Try e.g. reddit.com");
      return;
    }
    if (settings.sites.some((s) => s.host === host)) {
      setError(`${host} is already tracked.`);
      return;
    }
    setBusy(true);
    try {
      // must be requested from a user gesture in THIS page
      const patterns = originPatternsForSite({ host, includeSubdomains, createdAt: 0 });
      const granted = await browser.permissions.request({ origins: patterns }).catch(() => false);
      if (!granted) {
        setError(`Permission for ${host} was not granted, so it can't be tracked.`);
        return;
      }
      const res = await send({ type: "addSite", input: host, includeSubdomains });
      if (res?.error) setError(res.error);
      else setInput("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="card">
        <h3>Track a website</h3>
        <p className="muted">
          Time Spent is off by default. Add a site and the big counter appears in the corner of every
          page on it — for the rest of the day.
        </p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void addSite(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="youtube.com"
            autoFocus
            spellCheck={false}
            autoCapitalize="none"
          />
          <button type="submit" className="primary" disabled={busy}>
            Track
          </button>
        </form>
        <label className="check">
          <input
            type="checkbox"
            checked={includeSubdomains}
            onChange={(e) => setIncludeSubdomains(e.target.checked)}
          />
          include subdomains (<code>*.host.com</code>)
        </label>
        {error && <p className="error">{error}</p>}
        <div className="chips">
          {QUICK_SITES.filter((s) => !settings.sites.some((t) => t.host === s)).map((s) => (
            <button key={s} className="chip" onClick={() => void addSite(s)} disabled={busy}>
              + {s}
            </button>
          ))}
        </div>
      </div>

      {settings.sites.length === 0 ? (
        <div className="card">
          <p className="muted">Nothing tracked yet. Add a site above to start the reckoning.</p>
        </div>
      ) : (
        <div className="card">
          <div className="row spread">
            <h3>Tracked sites</h3>
            <span className="grandtotal">
              today&nbsp;
              <strong>{formatDuration(todayGrandTotal)}</strong>
            </span>
          </div>
          <ul className="site-list">
            {[...settings.sites]
              .sort((a, b) => (weekSeconds[b.host] ?? 0) - (weekSeconds[a.host] ?? 0))
              .map((site) => {
                const todaySec = totals[today]?.[site.host] ?? 0;
                const red = todaySec >= settings.redAfterSec;
                return (
                  <li key={site.host} className="site-row">
                    <div className="site-info">
                      <span className="site-host">{site.host}</span>
                      <span className="muted small">
                        {site.includeSubdomains ? "incl. subdomains · " : ""}
                        7d: {formatDuration(weekSeconds[site.host] ?? 0)}
                      </span>
                    </div>
                    <span className={"site-today" + (red ? " red" : "")}>{formatDuration(todaySec)}</span>
                    <button
                      className="danger"
                      title={`Stop tracking ${site.host}`}
                      onClick={() => void send({ type: "removeSite", host: site.host })}
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      )}
    </section>
  );
}

function DisplayTab({ settings }: { settings: Settings }) {
  const [growMin, setGrowMin] = useState(String(Math.round(settings.growAfterSec / 60)));
  const [redMin, setRedMin] = useState(String(Math.round(settings.redAfterSec / 60)));
  const [sample, setSample] = useState(Math.round(settings.growAfterSec / 2));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGrowMin(String(Math.round(settings.growAfterSec / 60)));
    setRedMin(String(Math.round(settings.redAfterSec / 60)));
  }, [settings.growAfterSec, settings.redAfterSec]);

  const grow = Number(growMin) * 60;
  const red = Number(redMin) * 60;
  const valid = Number.isFinite(grow) && Number.isFinite(red) && grow >= 0 && red > grow;

  async function save() {
    if (!valid) {
      setError("Both must be minutes, and the red threshold must be larger than the grow one.");
      return;
    }
    setError(null);
    await send({ type: "updateThresholds", growAfterSec: grow, redAfterSec: red });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  const previewSize = fontSizeFor(sample, {
    ...settings,
    growAfterSec: Number.isFinite(grow) ? grow : settings.growAfterSec,
    redAfterSec: Number.isFinite(red) && red > (Number.isFinite(grow) ? grow : 0) ? red : settings.redAfterSec,
  });

  return (
    <section>
      <div className="card">
        <h3>Thresholds</h3>
        <p className="muted">
          The counter sits at its base size until <strong>grows after</strong>. From there it grows
          linearly until <strong>turns red after</strong>, where it caps at 4× size, turns red and
          pulses.
        </p>
        <div className="row">
          <label>
            grows after (min)
            <input
              type="number"
              min={0}
              value={growMin}
              onChange={(e) => setGrowMin(e.target.value)}
            />
          </label>
          <label>
            turns red after (min)
            <input type="number" min={1} value={redMin} onChange={(e) => setRedMin(e.target.value)} />
          </label>
          <button className="primary" onClick={() => void save()}>
            Save
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {saved && <p className="ok">Saved ✓</p>}
      </div>

      <div className="card">
        <h3>Preview</h3>
        <div className="preview-area">
          <span
            className="preview-chip"
            style={{
              fontSize: `${previewSize}px`,
              color: sample >= (Number.isFinite(red) ? red : Infinity) ? "#ff453a" : "#fff",
            }}
          >
            {formatDuration(sample)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(3600, (Number.isFinite(red) ? red : 3600) * 1.2)}
          step={15}
          value={sample}
          onChange={(e) => setSample(Number(e.target.value))}
        />
        <p className="muted small">
          Drag to feel it: {formatDuration(sample)} → {Math.round(previewSize)}px text
        </p>
      </div>

      <div className="card">
        <h3>Overlay position</h3>
        <p className="muted">
          Currently snapped to the <strong>{settings.position.corner.toUpperCase()}</strong> corner.
          You can drag the counter on any page; it snaps to the nearest corner. There is
          deliberately no way to hide it while a site is tracked.
        </p>
        <button onClick={() => void send({ type: "resetPosition" })}>Reset to top-right</button>
      </div>
    </section>
  );
}

function SyncTab() {
  const { sync, refresh } = useSyncState();
  const [busy, setBusy] = useState(false);
  const configured = sync !== null && sync.signedIn !== undefined;

  return (
    <section>
      <div className="card">
        <h3>Sync across browsers &amp; devices</h3>
        <p className="muted">
          Everything works locally with zero accounts. Sync is opt-in: sign in with Google and your
          daily totals are merged across every browser and device you use (phone included). Merging
          always keeps the <em>larger</em> value — you can't cheat by clearing one browser.
        </p>
        {sync?.signedIn ? (
          <>
            <div className="sync-user">
              <div>
                <strong>{sync.name ?? sync.email}</strong>
                {sync.name && sync.email ? <div className="muted small">{sync.email}</div> : null}
              </div>
              <button
                className="danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  await send({ type: "sync:logout" });
                  await refresh();
                  setBusy(false);
                }}
              >
                Sign out
              </button>
            </div>
            <p className="muted small">
              last push {relTime(sync.lastPushAt)} · last pull {relTime(sync.lastPullAt)}
              {sync.lastError ? ` · error: ${sync.lastError}` : ""}
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await send({ type: "sync:now" });
                await refresh();
                setBusy(false);
              }}
            >
              Sync now
            </button>
          </>
        ) : (
          <>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await send({ type: "sync:login" });
                await refresh();
                setBusy(false);
              }}
            >
              {busy ? "Waiting for Google…" : "Sign in with Google"}
            </button>
            {sync?.lastError && <p className="error">{sync.lastError}</p>}
            {!configured && <p className="muted small">Sync backend not reachable in this build.</p>}
          </>
        )}
      </div>
    </section>
  );
}

function AboutTab() {
  const version = browser.runtime.getManifest().version;
  return (
    <section>
      <div className="card">
        <h3>About</h3>
        <p>
          <strong>Time Spent</strong> v{version}
        </p>
        <p className="muted">
          A shame counter for your doomscrolling. Local-first: all data lives in your browser's
          storage unless you opt into sync. Time only counts while the tab is visible and the
          window focused — switch away and the clock stops.
        </p>
        <p className="muted small">
          Works on Firefox (desktop + Android), Chrome, Edge, Brave, and other Chromium browsers.
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

type Tab = "sites" | "display" | "sync" | "about";

export default function App() {
  const settings = useSettings();
  const totals = useTotals();
  const [tab, setTab] = useState<Tab>("sites");

  const today = dateKey();
  const trackedTotal = useMemo(
    () => settings.sites.reduce((acc, s) => acc + (totals[today]?.[s.host] ?? 0), 0),
    [settings.sites, totals, today],
  );

  return (
    <div className="app">
      <header>
        <h1>
          Time&nbsp;Spent{" "}
          {settings.sites.length > 0 && (
            <span className={"header-total" + (trackedTotal >= settings.redAfterSec ? " red" : "")}>
              {formatDuration(trackedTotal)}
            </span>
          )}
        </h1>
        <nav>
          {(["sites", "display", "sync", "about"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
              {t === "sites" ? "Sites" : t === "display" ? "Display" : t === "sync" ? "Sync" : "About"}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {tab === "sites" && <SitesTab settings={settings} totals={totals} />}
        {tab === "display" && <DisplayTab settings={settings} />}
        {tab === "sync" && <SyncTab />}
        {tab === "about" && <AboutTab />}
      </main>
    </div>
  );
}
