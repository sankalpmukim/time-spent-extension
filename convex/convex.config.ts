import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
  env: {
    /** Google OAuth client ID (Google Identity Services audience) */
    GOOGLE_CLIENT_ID: v.optional(v.string()),
  },
});

export default app;
