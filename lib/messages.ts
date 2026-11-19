import type { OverlayPosition, Settings, TrackedSite } from "./shared";

export interface OverlayState {
  site: TrackedSite | null;
  todaySeconds: number;
  settings: Settings;
}

export interface SyncState {
  signedIn: boolean;
  email?: string;
  name?: string;
  sessionToken?: string;
  lastPushAt?: number;
  lastPullAt?: number;
  lastError?: string;
}

export type BackgroundRequest =
  | { type: "getOverlayState"; host: string }
  | { type: "tick"; host: string; dateKey: string; deltaSeconds: number }
  | { type: "savePosition"; position: OverlayPosition }
  | { type: "resetPosition" }
  | { type: "addSite"; input: string; includeSubdomains?: boolean }
  | { type: "removeSite"; host: string }
  | { type: "updateThresholds"; growAfterSec: number; redAfterSec: number }
  | { type: "sync:login" }
  | { type: "sync:logout" }
  | { type: "sync:status" }
  | { type: "sync:now" };

export interface BackgroundResponse {
  overlay?: OverlayState;
  todaySeconds?: number;
  /** true when the site is no longer tracked — content script should remove its overlay */
  removed?: boolean;
  /** normalized host that was added, or null if input was rejected */
  added?: string | null;
  error?: string;
  sync?: SyncState;
}
