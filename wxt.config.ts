import { defineConfig } from "wxt";

export default defineConfig({
  hooks: {
    // WXT normalizes options_ui.open_in_tab to false; we want a full tab
    // (better UX, and the only reliable surface on Firefox for Android).
    "build:manifestGenerated": (_wxt, manifest) => {
      if (manifest.options_ui) {
        manifest.options_ui.open_in_tab = true;
      }
    },
  },
  // manifest version follows the target: chrome -> MV3, firefox -> MV2
  manifest: ({ browser, manifestVersion }) => ({
    name: "Time Spent",
    description:
      "Big, unmissable digits showing how long you've been on a website today. Local-first; optional cross-device sync.",
    permissions: ["storage", "alarms", "contextMenus", "identity"],
    ...(manifestVersion === 3
      ? { optional_host_permissions: ["*://*/*"] }
      : { optional_permissions: ["*://*/*"] }),
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
    action: {
      default_title: "Time Spent — settings",
    },
    icons: {
      "16": "icon/16.png",
      "19": "icon/19.png",
      "32": "icon/32.png",
      "48": "icon/48.png",
      "64": "icon/64.png",
      "96": "icon/96.png",
      "128": "icon/128.png",
    },
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "time-spent@mukim.dev",
              strict_min_version: "142.0",
              // Required for new Firefox add-ons since Nov 2025. Core extension
              // collects nothing; optional sync uploads per-site time (browsing
              // activity) and the Google account email when the user opts in.
              data_collection_permissions: {
                required: ["browsingActivity", "personallyIdentifyingInfo"],
              },
            },
          },
        }
      : {}),
  }),
});
