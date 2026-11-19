import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    googleSub: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    picture: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_googleSub", ["googleSub"]),

  sessions: defineTable({
    /** sha256 of the bearer token handed to the extension */
    tokenHash: v.string(),
    userId: v.id("users"),
    createdAt: v.number(),
    expiresAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_userId", ["userId"]),

  /** one row per (user, day, tracked host): total seconds, merged with max() */
  dailyTotals: defineTable({
    userId: v.id("users"),
    /** local YYYY-MM-DD of the user's device */
    date: v.string(),
    /** canonical tracked host, e.g. "reddit.com" */
    host: v.string(),
    seconds: v.number(),
    updatedAt: v.number(),
  }).index("by_user_date_host", ["userId", "date", "host"]),
});
