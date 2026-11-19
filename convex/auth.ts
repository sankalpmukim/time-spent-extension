/**
 * Google ID-token login + opaque session tokens.
 *
 * Flow: the extension opens the hosted sign-in page (Cloudflare Pages),
 * Google Identity Services returns an ID token to that page, the page
 * redirects back to the extension with the token, and the extension posts
 * it here. We verify the token against Google's JWKS, upsert the user,
 * and mint a long-lived opaque session token (only its sha256 is stored).
 */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, env } from "./_generated/server";
import { internal } from "./_generated/api";
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

export interface GoogleIdentity {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not configured");
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
  });
  const sub = typeof payload.sub === "string" ? payload.sub : null;
  if (!sub) throw new Error("Token has no subject");
  const email = typeof payload.email === "string" && payload.email_verified !== false
    ? payload.email
    : undefined;
  return {
    sub,
    email,
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
  };
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ */
/* Registered functions                                                */
/* ------------------------------------------------------------------ */

/** Called by the HTTP layer. Verifies the Google token, returns a session token. */
export const loginWithGoogle = internalAction({
  args: { googleIdToken: v.string() },
  returns: v.object({
    token: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const identity = await verifyGoogleIdToken(args.googleIdToken);

    const raw = new Uint8Array(32);
    crypto.getRandomValues(raw);
    const token = [...raw].map((b) => b.toString(16).padStart(2, "0")).join("");
    const tokenHash = await sha256Hex(token);
    const now = Date.now();

    await ctx.runMutation(internal.auth.upsertUserAndCreateSession, {
      googleSub: identity.sub,
      email: identity.email,
      name: identity.name,
      picture: identity.picture,
      tokenHash,
      now,
      ttlMs: SESSION_TTL_MS,
    });

    return { token, email: identity.email, name: identity.name };
  },
});

export const upsertUserAndCreateSession = internalMutation({
  args: {
    googleSub: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    picture: v.optional(v.string()),
    tokenHash: v.string(),
    now: v.number(),
    ttlMs: v.number(),
  },
  returns: v.id("users"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_googleSub", (q) => q.eq("googleSub", args.googleSub))
      .unique();
    let userId;
    if (existing) {
      await ctx.db.patch(existing._id, {
        email: args.email,
        name: args.name,
        picture: args.picture,
      });
      userId = existing._id;
    } else {
      userId = await ctx.db.insert("users", {
        googleSub: args.googleSub,
        email: args.email,
        name: args.name,
        picture: args.picture,
        createdAt: args.now,
      });
    }
    await ctx.db.insert("sessions", {
      tokenHash: args.tokenHash,
      userId,
      createdAt: args.now,
      expiresAt: args.now + args.ttlMs,
      lastSeenAt: args.now,
    });
    return userId;
  },
});

/** Resolve a raw bearer token to a user id + profile, or null. */
export const getUserByToken = internalQuery({
  args: { token: v.string(), now: v.number() },
  returns: v.union(
    v.object({
      userId: v.id("users"),
      email: v.optional(v.string()),
      name: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.token);
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!session || session.expiresAt < args.now) return null;
    const user = await ctx.db.get(session.userId);
    if (!user) return null;
    return { userId: user._id, email: user.email, name: user.name };
  },
});

export const deleteSessionByToken = internalMutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.token);
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (session) await ctx.db.delete(session._id);
    return null;
  },
});

/** Rolling refresh: keep extending expiry while the device keeps syncing. */
export const touchSession = internalMutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const tokenHash = await sha256Hex(args.token);
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (session) {
      const now = Date.now();
      await ctx.db.patch(session._id, {
        lastSeenAt: now,
        expiresAt: now + 180 * 86400_000,
      });
    }
    return null;
  },
});
