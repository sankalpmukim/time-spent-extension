import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

http.route({
  path: "/api/auth/login",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    let body: { googleIdToken?: unknown };
    try {
      body = (await request.json()) as { googleIdToken?: unknown };
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }
    if (typeof body.googleIdToken !== "string" || body.googleIdToken.length === 0) {
      return json(400, { error: "googleIdToken is required" });
    }
    try {
      const result = await ctx.runAction(internal.auth.loginWithGoogle, {
        googleIdToken: body.googleIdToken,
      });
      return json(200, result);
    } catch (err) {
      return json(401, { error: err instanceof Error ? err.message : "Login failed" });
    }
  }),
});

http.route({
  path: "/api/auth/logout",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = bearer(request);
    if (!token) return json(401, { error: "Missing bearer token" });
    await ctx.runMutation(internal.auth.deleteSessionByToken, { token });
    return json(200, { ok: true });
  }),
});

http.route({
  path: "/api/sync/push",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const token = bearer(request);
    if (!token) return json(401, { error: "Missing bearer token" });
    const user = await ctx.runQuery(internal.auth.getUserByToken, { token, now: Date.now() });
    if (!user) return json(401, { error: "Invalid or expired session" });

    let body: { days?: unknown };
    try {
      body = (await request.json()) as { days?: unknown };
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }
    const days = body.days;
    if (typeof days !== "object" || days === null) {
      return json(400, { error: "days must be an object" });
    }
    await ctx.runMutation(internal.auth.touchSession, { token });
    const result = await ctx.runMutation(internal.sync.upsertDays, {
      userId: user.userId,
      days: days as Record<string, Record<string, number>>,
    });
    void result;
    return json(200, { ok: true });
  }),
});

http.route({
  path: "/api/sync/pull",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const token = bearer(request);
    if (!token) return json(401, { error: "Missing bearer token" });
    const user = await ctx.runQuery(internal.auth.getUserByToken, { token, now: Date.now() });
    if (!user) return json(401, { error: "Invalid or expired session" });

    const url = new URL(request.url);
    const days = Number(url.searchParams.get("days") ?? "14");
    const result = await ctx.runQuery(internal.sync.pullDays, {
      userId: user.userId,
      days: Number.isFinite(days) ? days : 14,
      now: Date.now(),
    });
    return json(200, result);
  }),
});

http.route({
  path: "/api/me",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const token = bearer(request);
    if (!token) return json(401, { error: "Missing bearer token" });
    const user = await ctx.runQuery(internal.auth.getUserByToken, { token, now: Date.now() });
    if (!user) return json(401, { error: "Invalid or expired session" });
    return json(200, { email: user.email, name: user.name });
  }),
});

export default http;
