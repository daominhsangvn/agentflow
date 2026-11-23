// Captures screens of the real AgentFlow web app with demo data, as stills for the video.
// The pages are the live ones; the API responses they read are replaced with the demo data in
// tools/app-demo-data.mjs (status and headers stay real, so CORS still passes), and every non-GET
// request is aborted, so nothing on the server changes. Needs a session from tools/app-login.mjs.
// Usage: node tools/capture-app.mjs --url=https://af.example.com --api=https://af-api.example.com
//          --org=<slug> [--shots=home,agents] [--auth=<state.json>] [--out=assets/app] [--theme=dark]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { demoResponse, hasDemo } from "./app-demo-data.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const READS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEMO_ORG = "Acme";

// Each shot: the page to open and what to tidy before the capture.
const SHOTS = {
  home: { path: "dashboard" },
  agents: { path: "agents" },
  connections: { path: "connections" },
  workflows: { path: "workflows" },
  runs: { path: "runs" },
};

const appUrl = new URL(required("url"));
const apiUrl = new URL(required("api"));
const org = required("org");
const auth = path.resolve(arg("auth") || path.join(os.tmpdir(), "af-video", "auth", "state.json"));
const outDir = path.resolve(root, arg("out") || "assets/app");
const names = (arg("shots") || Object.keys(SHOTS).join(",")).split(",");
const theme = arg("theme") || "dark";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: auth,
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
  colorScheme: theme,
});
const served = new Set();
await context.route("**/*", async (route) => {
  const request = route.request();
  if (!READS.has(request.method())) {
    return route.abort();
  }
  // Live event streams (agent status) would push real data over the demo data, and never end.
  if (request.headers().accept?.includes("text/event-stream")) {
    return route.abort();
  }
  const u = new URL(request.url());
  const isApi = u.origin === apiUrl.origin || (u.origin === appUrl.origin && u.pathname.startsWith("/api/auth/"));
  if (!isApi || request.method() !== "GET" || !hasDemo(u.pathname)) {
    return route.continue();
  }
  const real = await route.fetch();
  const realJson = await real.json().catch(() => null);
  const demo = demoResponse(u.pathname, realJson);
  if (demo === undefined) {
    return route.fulfill({ response: real });
  }
  served.add(u.pathname);
  return route.fulfill({ response: real, json: demo });
});

const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).split("\n")[0]));
page.on("console", (m) => {
  if (m.type() === "error") {
    errors.push(m.text().split("\n").slice(0, 3).join(" | ").slice(0, 400));
  }
});
for (const name of names) {
  const shot = SHOTS[name];
  if (!shot) {
    throw new Error(`unknown shot "${name}"; known: ${Object.keys(SHOTS).join(", ")}`);
  }
  await page.goto(new URL(`/${org}/${shot.path}`, appUrl).href, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
    // observability: pages that poll never go idle; the fixed wait below still lets them render
  });
  await page.waitForTimeout(2000);
  await showOrgAs(page, DEMO_ORG);
  if (shot.prepare) {
    await shot.prepare(page);
  }
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(path.relative(root, file));
}
console.log(`demo data served for: ${[...served].sort().join(", ") || "nothing"}`);
if (errors.length > 0) {
  console.log(`page errors:\n${errors.join("\n")}`);
}
await browser.close();

// The org switcher in the sidebar footer reads the org name from the session token, which the
// capture must not alter, so the name is swapped on the page instead.
async function showOrgAs(target, name) {
  await target.evaluate((orgName) => {
    const footer = document.querySelector('[data-sidebar="footer"]') || document.querySelector("aside");
    for (const el of footer ? footer.querySelectorAll("*") : []) {
      if (el.children.length === 0 && el.textContent.trim() === "AgentFlow") {
        el.textContent = orgName;
      }
    }
  }, name);
}

function required(name) {
  const value = arg(name);
  if (!value) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
