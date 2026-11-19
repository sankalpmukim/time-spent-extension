import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    "name": "time-spent-site",
    "compatibilityDate": "2026-09-25",
    "observability": {
      "enabled": true
    }
  }
});
