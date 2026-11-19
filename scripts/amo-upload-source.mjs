/**
 * Attaches the sources zip to the pending AMO version (retry-safe).
 * Uses the AMO v5 API with a JWT minted from the key/secret in .env.amo.
 *
 *   AMO_ADDON_ID=time-spent@mukim.dev AMO_VERSION=0.1.0 node scripts/amo-upload-source.mjs
 */
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";

const env = Object.fromEntries(
  readFileSync(".env.amo", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);

const ADDON_ID = process.env.AMO_ADDON_ID ?? "time-spent@mukim.dev";
const VERSION = process.env.AMO_VERSION ?? "0.1.0";
const SOURCES = process.env.AMO_SOURCES ?? `.output/time-spent-${VERSION}-sources.zip`;
const BASE = "https://addons.mozilla.org/api/v5";

async function jwt() {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    iss: env.AMO_API_KEY,
    jti: crypto.randomUUID(),
    iat: issuedAt,
    exp: issuedAt + 60,
  };
  const key = new TextEncoder().encode(env.AMO_API_SECRET);
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).sign(key);
}

const token = await jwt();
const headers = { Authorization: `JWT ${token}`, "Content-Type": "application/json" };

// find the version id
const detailRes = await fetch(`${BASE}/addons/addon/${encodeURIComponent(ADDON_ID)}/all_versions/`, {
  headers,
});
const detail = await detailRes.json();
if (!detailRes.ok) {
  console.error("lookup failed:", JSON.stringify(detail).slice(0, 300));
  process.exit(1);
}
const version = (detail.results ?? []).find((v) => v.version === VERSION);
if (!version) {
  console.error(`version ${VERSION} not found; existing:`, (detail.results ?? []).map((v) => v.version));
  process.exit(1);
}
console.log("version id:", version.id, "| channel:", version.channel);

const form = new FormData();
form.set("source", new Blob([readFileSync(SOURCES)], { type: "application/zip" }), "sources.zip");
form.set("upload", ""); // empty keeps the existing upload

const patchRes = await fetch(`${BASE}/addons/addon/${encodeURIComponent(ADDON_ID)}/versions/${version.id}/`, {
  method: "PATCH",
  headers: { Authorization: `JWT ${await jwt()}` },
  body: form,
});
const patchBody = await patchRes.text();
console.log("PATCH", patchRes.status, patchBody.slice(0, 300));
if (patchRes.ok) console.log("SOURCE_ATTACHED_OK");
