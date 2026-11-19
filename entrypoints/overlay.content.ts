/**
 * The overlay. Injected ONLY into sites the user explicitly tracks
 * (registered dynamically by the background, never globally).
 *
 * - Counts seconds while the tab is visible AND the window is focused.
 * - Displays today's total in big monospace digits.
 * - Font grows linearly between the two thresholds, then caps.
 * - Text turns red + pulses after the second threshold.
 * - Draggable; snaps to the nearest viewport corner. No hide option.
 */
import { browser } from "wxt/browser";
import {
  STORAGE_KEYS,
  type Corner,
  type OverlayPosition,
  type Settings,
  type Totals,
  dateKey,
  fontSizeFor,
  formatDuration,
  resolveSite,
} from "../lib/shared";
import type { BackgroundRequest, BackgroundResponse } from "../lib/messages";

export default defineContentScript({
  registration: "runtime",
  main() {
    void initOverlay();
  },
});

async function send(msg: BackgroundRequest): Promise<BackgroundResponse | null> {
  try {
    return (await browser.runtime.sendMessage(msg)) as BackgroundResponse;
  } catch {
    return null;
  }
}

async function initOverlay(): Promise<void> {
  if (window.top !== window) return; // top frame only
  const host = location.hostname;
  if (!host) return;

  const res = await send({ type: "getOverlayState", host });
  const overlay = res?.overlay;
  if (!overlay?.site) return;

  let bucket = overlay.site.host;
  let settings: Settings = overlay.settings;
  let todaySeconds = overlay.todaySeconds;
  let pending = 0;
  let currentDay = dateKey();
  let teardownFn: (() => void) | null = null;
  let pulseAnim: Animation | null = null;

  /* ---------------------------------------------------------------- */
  /* DOM                                                              */
  /* ---------------------------------------------------------------- */

  const container = document.createElement("div");
  container.setAttribute("data-time-spent", "");
  const style = container.style;
  style.setProperty("all", "initial");
  style.position = "fixed";
  style.top = "0";
  style.left = "0";
  style.width = "0";
  style.height = "0";
  style.zIndex = "2147483647";
  style.pointerEvents = "none";

  const shadow = container.attachShadow({ mode: "closed" });

  const chip = document.createElement("div");
  const cs = chip.style;
  cs.position = "absolute";
  cs.display = "inline-block";
  cs.padding = "0.32em 0.6em";
  cs.background = "rgba(13, 13, 16, 0.86)";
  cs.color = "#ffffff";
  cs.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
  cs.fontWeight = "700";
  cs.fontVariantNumeric = "tabular-nums";
  cs.letterSpacing = "0.02em";
  cs.lineHeight = "1";
  cs.borderRadius = "0.35em";
  cs.boxShadow = "0 2px 14px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(255,255,255,0.14)";
  cs.cursor = "grab";
  cs.userSelect = "none";
  cs.webkitUserSelect = "none";
  cs.touchAction = "none";
  cs.pointerEvents = "auto";
  cs.whiteSpace = "nowrap";
  cs.fontSize = "18px";
  chip.title = `Time on ${bucket} today — drag me to a corner`;

  const label = document.createElement("span");
  chip.appendChild(label);
  shadow.appendChild(chip);

  const mountPoint = () => document.fullscreenElement ?? document.documentElement;
  mountPoint().appendChild(container);

  /* ---------------------------------------------------------------- */
  /* Rendering                                                        */
  /* ---------------------------------------------------------------- */

  function applyPosition(pos: OverlayPosition): void {
    cs.left = pos.corner === "tl" || pos.corner === "bl" ? `${pos.marginX}px` : "auto";
    cs.right = pos.corner === "tr" || pos.corner === "br" ? `${pos.marginX}px` : "auto";
    cs.top = pos.corner === "tl" || pos.corner === "tr" ? `${pos.marginY}px` : "auto";
    cs.bottom = pos.corner === "bl" || pos.corner === "br" ? `${pos.marginY}px` : "auto";
  }

  function setPulse(on: boolean): void {
    if (on && !pulseAnim) {
      try {
        pulseAnim = chip.animate(
          [
            { transform: "scale(1)", filter: "brightness(1)" },
            { transform: "scale(1.07)", filter: "brightness(1.25)" },
          ],
          { duration: 900, iterations: Infinity, direction: "alternate", easing: "ease-in-out" },
        );
      } catch {
        /* animation unsupported — static red is fine */
      }
    } else if (!on && pulseAnim) {
      pulseAnim.cancel();
      pulseAnim = null;
      cs.transform = "";
      cs.filter = "";
    }
  }

  function render(): void {
    const total = todaySeconds + pending;
    label.textContent = formatDuration(total);
    cs.fontSize = `${fontSizeFor(total, settings)}px`;
    const red = total >= settings.redAfterSec;
    cs.color = red ? "#ff453a" : "#ffffff";
    cs.textShadow = red ? "0 0 14px rgba(255,69,58,0.9)" : "none";
    setPulse(red);
  }

  /* ---------------------------------------------------------------- */
  /* Ticking                                                          */
  /* ---------------------------------------------------------------- */

  let flushing = false;
  async function flush(): Promise<void> {
    if (flushing || pending <= 0) return;
    flushing = true;
    const delta = pending;
    pending = 0;
    try {
      const res = await send({ type: "tick", host, dateKey: currentDay, deltaSeconds: delta });
      if (res?.removed) {
        teardown();
        return;
      }
      if (res && typeof res.todaySeconds === "number") {
        todaySeconds = res.todaySeconds;
      }
    } finally {
      flushing = false;
      render();
    }
  }

  const timer = setInterval(() => {
    const day = dateKey();
    if (day !== currentDay) {
      void flush();
      currentDay = day;
      todaySeconds = 0;
      pending = 0;
    }
    const active = document.visibilityState === "visible" && document.hasFocus();
    if (active) {
      pending++;
      render();
    }
    if (pending >= 5) void flush();
  }, 1000);

  const onVisibility = () => {
    if (document.visibilityState !== "visible") void flush();
  };
  document.addEventListener("visibilitychange", onVisibility, true);
  window.addEventListener("pagehide", () => void flush(), { capture: true });

  /* ---------------------------------------------------------------- */
  /* Dragging (with corner snap)                                       */
  /* ---------------------------------------------------------------- */

  interface DragState {
    startX: number;
    startY: number;
  }
  let drag: DragState | null = null;

  chip.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    drag = { startX: e.clientX, startY: e.clientY };
    try {
      chip.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    cs.cursor = "grabbing";
  });

  chip.addEventListener("pointermove", (e) => {
    if (!drag) return;
    e.stopPropagation();
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    drag = { startX: e.clientX, startY: e.clientY };
    if (dx === 0 && dy === 0) return;
    const rect = chip.getBoundingClientRect();
    const left = Math.min(Math.max(rect.left + dx, 0), window.innerWidth - rect.width);
    const top = Math.min(Math.max(rect.top + dy, 0), window.innerHeight - rect.height);
    cs.left = `${left}px`;
    cs.top = `${top}px`;
    cs.right = "auto";
    cs.bottom = "auto";
  });

  function endDrag(e: PointerEvent): void {
    if (!drag) return;
    drag = null;
    cs.cursor = "grab";
    e.stopPropagation();
    // snap to the nearest corner
    const r = chip.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const corners: Array<[Corner, number]> = [
      ["tl", Math.hypot(cx, cy)],
      ["tr", Math.hypot(window.innerWidth - cx, cy)],
      ["bl", Math.hypot(cx, window.innerHeight - cy)],
      ["br", Math.hypot(window.innerWidth - cx, window.innerHeight - cy)],
    ];
    corners.sort((a, b) => a[1] - b[1]);
    const corner = corners[0]?.[0] ?? "tr";
    const position: OverlayPosition = { corner, marginX: 16, marginY: 16 };
    settings = { ...settings, position };
    applyPosition(position);
    void send({ type: "savePosition", position });
  }

  chip.addEventListener("pointerup", endDrag);
  chip.addEventListener("pointercancel", endDrag);
  chip.addEventListener("contextmenu", (e) => e.preventDefault());

  /* ---------------------------------------------------------------- */
  /* React to settings / totals changes                                */
  /* ---------------------------------------------------------------- */

  const onStorageChanged = (
    changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
    area: string,
  ) => {
    if (area !== "local") return;
    const settingsChange = changes[STORAGE_KEYS.settings];
    if (settingsChange?.newValue) {
      const next = settingsChange.newValue as Settings;
      if (!resolveSite(host, next.sites)) {
        teardown();
        return;
      }
      settings = next;
      applyPosition(settings.position);
      render();
    }
    const totalsChange = changes[STORAGE_KEYS.totals];
    if (totalsChange?.newValue) {
      const totals = totalsChange.newValue as Totals;
      const remote = totals[currentDay]?.[bucket] ?? 0;
      if (remote > todaySeconds) {
        todaySeconds = remote;
        render();
      }
    }
  };
  browser.storage.onChanged.addListener(onStorageChanged);

  // keep the overlay visible in fullscreen (e.g. YouTube)
  const onFullscreenChange = () => {
    if (container.isConnected) mountPoint().appendChild(container);
  };
  document.addEventListener("fullscreenchange", onFullscreenChange, true);

  /* ---------------------------------------------------------------- */
  /* Teardown                                                         */
  /* ---------------------------------------------------------------- */

  function teardown(): void {
    if (teardownFn) return;
    teardownFn = () => {};
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility, true);
    document.removeEventListener("fullscreenchange", onFullscreenChange, true);
    try {
      browser.storage.onChanged.removeListener(onStorageChanged);
    } catch {
      /* context may be gone */
    }
    setPulse(false);
    container.remove();
  }

  applyPosition(settings.position);
  render();
}
