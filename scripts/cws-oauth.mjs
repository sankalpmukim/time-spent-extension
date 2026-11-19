/**
 * One-shot helper: obtains a Google OAuth token for the Chrome Web Store API
 * using the loopback redirect flow with an existing Desktop OAuth client,
 * then (optionally) uploads and publishes the extension zip.
 *
 * Env:
 *   CWS_CLIENT_ID, CWS_CLIENT_SECRET  (from GCP "Desktop" OAuth client)
 *   CWS_SCOPE (default chromewebstore)
 *   OUTPUT=/path  where to write refresh_token.json
 *
 * 1) prints the consent URL, waits on http://127.0.0.1:17171/oauth2callback
 * 2) exchanges the code, prints + saves refresh/access tokens
 */
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const CLIENT_ID = process.env.CWS_CLIENT_ID;
const CLIENT_SECRET = process.env.CWS_CLIENT_SECRET;
const SCOPE = process.env.CWS_SCOPE ?? "https://www.googleapis.com/auth/chromewebstore";
const PORT = 17171;
const REDIRECT = `http://127.0.0.1:${PORT}/oauth2callback`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("CWS_CLIENT_ID / CWS_CLIENT_SECRET required");
  process.exit(1);
}

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth?` +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });

console.log("AUTH_URL:");
console.log(authUrl);

const code = await new Promise((resolve, reject) => {
  const srv = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    if (url.pathname !== "/oauth2callback") {
      res.writeHead(404).end();
      return;
    }
    const err = url.searchParams.get("error");
    if (err) {
      res.writeHead(200, { "Content-Type": "text/html" }).end(`<h2>Sign-in failed: ${err}</h2>`);
      srv.close();
      reject(new Error(err));
      return;
    }
    const c = url.searchParams.get("code");
    res.writeHead(200, { "Content-Type": "text/html" }).end(
      `<h2>&#10003; Token captured — you can close this tab.</h2>`,
    );
    srv.close();
    resolve(c);
  });
  srv.listen(PORT, "127.0.0.1");
  setTimeout(() => reject(new Error("timeout waiting for oauth callback")), 300000);
});

const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT,
    grant_type: "authorization_code",
  }),
});
const tokens = await tokenRes.json();
if (!tokenRes.ok) {
  console.error("token exchange failed:", tokens);
  process.exit(1);
}
const out = {
  refresh_token: tokens.refresh_token,
  access_token: tokens.access_token,
  expires_in: tokens.expires_in,
  scope: tokens.scope,
};
if (process.env.OUTPUT) writeFileSync(process.env.OUTPUT, JSON.stringify(out, null, 2));
console.log("TOKENS_WRITTEN", process.env.OUTPUT ?? "(stdout only)");
console.log(JSON.stringify(out));
