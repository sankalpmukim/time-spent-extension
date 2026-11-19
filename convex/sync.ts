/**
 * Per-day time totals sync. Push merges with max() so recorded time can
 * only grow — you cannot cheat by clearing one browser or device.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SECONDS_PER_DAY = 86400;
const MAX_HOSTS_PER_DAY = 500;

export type DayMap = Record<string, Record<string, number>>;

function sanitizeDays(days: unknown): DayMap {
  const out: DayMap = {};
  if (typeof days !== "object" || days === null) return out;
  for (const [date, hosts] of Object.entries(days as Record<string, unknown>)) {
    if (!DATE_RE.test(date)) continue;
    if (typeof hosts !== "object" || hosts === null) continue;
    const clean: Record<string, number> = {};
    for (const [host, seconds] of Object.entries(hosts as Record<string, unknown>)) {
      if (host.length === 0 || host.length > 253) continue;
      if (typeof seconds !== "number" || !Number.isFinite(seconds)) continue;
      clean[host] = Math.min(Math.max(0, Math.floor(seconds)), MAX_SECONDS_PER_DAY);
    }
    if (Object.keys(clean).length > 0) out[date] = clean;
  }
  return out;
}

function dateNDaysAgo(n: number, now: number): string {
  const d = new Date(now - n * 86400_000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const upsertDays = internalMutation({
  args: {
    userId: v.id("users"),
    days: v.record(v.string(), v.record(v.string(), v.number())),
  },
  returns: v.object({ ok: v.boolean(), written: v.number() }),
  handler: async (ctx, args) => {
    const days = sanitizeDays(args.days);
    const now = Date.now();
    let written = 0;

    for (const [date, hosts] of Object.entries(days)) {
      const entries = Object.entries(hosts).slice(0, MAX_HOSTS_PER_DAY);
      for (const [host, seconds] of entries) {
        const existing = await ctx.db
          .query("dailyTotals")
          .withIndex("by_user_date_host", (q) =>
            q.eq("userId", args.userId).eq("date", date).eq("host", host),
          )
          .unique();
        if (existing) {
          if (seconds > existing.seconds) {
            await ctx.db.patch(existing._id, { seconds, updatedAt: now });
            written++;
          }
        } else {
          await ctx.db.insert("dailyTotals", {
            userId: args.userId,
            date,
            host,
            seconds,
            updatedAt: now,
          });
          written++;
        }
      }
    }
    return { ok: true, written };
  },
});

export const pullDays = internalQuery({
  args: { userId: v.id("users"), days: v.number(), now: v.number() },
  returns: v.object({ days: v.record(v.string(), v.record(v.string(), v.number())) }),
  handler: async (ctx, args) => {
    const n = Math.min(Math.max(1, Math.floor(args.days)), 90);
    const from = dateNDaysAgo(n, args.now);
    const rows = await ctx.db
      .query("dailyTotals")
      .withIndex("by_user_date_host", (q) => q.eq("userId", args.userId).gte("date", from))
      .take(10000);
    const out: DayMap = {};
    for (const row of rows) {
      (out[row.date] ??= {})[row.host] = row.seconds;
    }
    return { days: out };
  },
});
