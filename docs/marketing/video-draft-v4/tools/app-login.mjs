// Opens a visible browser at the AgentFlow web app so a person can sign in once, then saves that
// session (cookies and local storage) for the screen captures and closes the window.
// The saved file works like being signed in until the session ends, so it goes outside the repo
// (the OS temp folder) by default. Delete it when the captures are done.
// Usage: node tools/app-login.mjs --url=https://af.example.com [--out=<file>] [--minutes=15]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const SIGNED_OUT_PAGE = /^\/(sign-in|sign-up|login|forgot|reset|verify)/;
const SESSION_COOKIE = /session[_-]?token/i;
const SETTLE_MS = 8000;

const url = arg("url");
if (!url) {
  throw new Error("--url is required, e.g. --url=https://af.example.com");
}
const base = new URL(url);
const out = path.resolve(arg("out") || path.join(os.tmpdir(), "af-video", "auth", "state.json"));
const minutes = Number(arg("minutes") || 15);

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto(new URL("/sign-in", base).href);
console.log(`Sign in at ${base.origin} in the browser window (waiting up to ${minutes} min).`);

const deadline = Date.now() + minutes * 60_000;
let offSince = null;
try {
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    if (await signedIn()) {
      await page.waitForLoadState("networkidle").catch(() => {
        // observability: a page that keeps polling never goes idle; the session is already set
      });
      fs.mkdirSync(path.dirname(out), { recursive: true });
      await context.storageState({ path: out });
      console.log(`Signed in at ${page.url()}. Session saved to ${out}`);
      await browser.close();
      process.exit(0);
    }
  }
  console.log("Timed out before sign-in finished; nothing was saved.");
} catch (error) {
  console.log(`The window closed before sign-in finished; nothing was saved. (${String(error).split("\n")[0]})`);
}
await browser.close().catch(() => {
  // observability: the browser is already gone when its window was closed by hand
});
process.exit(1);

// Signed in = off the sign-in pages with a session cookie, or off them for SETTLE_MS when the
// deployment names its cookie differently.
async function signedIn() {
  const off = !SIGNED_OUT_PAGE.test(new URL(page.url()).pathname);
  offSince = off ? (offSince ?? Date.now()) : null;
  if (!off) {
    return false;
  }
  const cookies = await context.cookies();
  return cookies.some((c) => SESSION_COOKIE.test(c.name)) || Date.now() - offSince >= SETTLE_MS;
}

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
