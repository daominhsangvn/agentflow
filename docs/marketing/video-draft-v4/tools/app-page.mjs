// Opens the live AgentFlow web app with the demo data, for the screen tools (capture-app.mjs,
// ui-clip.mjs). The API responses the pages read come from tools/app-demo-data.mjs (status and
// headers stay real, so CORS still passes); every non-GET request and every live event stream is
// aborted, so nothing on the server changes and no real data is pushed into the page.
// The page runs on Playwright's clock; freeze() stops it, so no timer in the app (refetch,
// "3 min ago" tickers) can redraw a page while it is being filmed.
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { demoResponse, hasDemo } from "./app-demo-data.mjs";

const READS = new Set(["GET", "HEAD", "OPTIONS"]);
export const DEMO_ORG = "Acme";

export async function openApp({ appUrl, apiUrl, auth, dpr = 2, theme = "dark" }) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    storageState: path.resolve(auth || path.join(os.tmpdir(), "af-video", "auth", "state.json")),
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: dpr,
    colorScheme: theme,
  });
  const served = new Set();
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (!READS.has(request.method()) || request.headers().accept?.includes("text/event-stream")) {
      return route.abort();
    }
    const u = new URL(request.url());
    const isApi = u.origin === apiUrl.origin || (u.origin === appUrl.origin && u.pathname.startsWith("/api/"));
    if (!isApi || request.method() !== "GET" || !hasDemo(u.pathname)) {
      return route.continue();
    }
    const real = await route.fetch();
    const demo = demoResponse(u.pathname, await real.json().catch(() => null));
    if (demo === undefined) {
      return route.fulfill({ response: real });
    }
    served.add(u.pathname);
    return route.fulfill({ response: real, json: demo });
  });
  const page = await context.newPage();
  await page.clock.install();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).split("\n")[0]));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("Failed to load resource")) {
      errors.push(m.text().split("\n").slice(0, 3).join(" | ").slice(0, 400));
    }
  });
  return {
    browser,
    page,
    served,
    errors,
    freeze: async () => {
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 50));
    },
  };
}

// Opens an org page and waits until its data has rendered.
export async function goTo(page, appUrl, org, route) {
  await page.goto(new URL(`/${org}/${route}`, appUrl).href, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {
    // observability: pages that poll never go idle; the fixed wait below still lets them render
  });
  await page.waitForTimeout(2000);
  await showOrgAs(page, DEMO_ORG);
}

// The org switcher in the sidebar footer reads the org name from the session token, which the
// tools must not alter, so the name is swapped on the page instead.
export async function showOrgAs(page, name) {
  await page.evaluate((orgName) => {
    const footer = document.querySelector('[data-sidebar="footer"]') || document.querySelector("aside");
    for (const el of footer ? footer.querySelectorAll("*") : []) {
      if (el.children.length === 0 && el.textContent.trim() === "AgentFlow") {
        el.textContent = orgName;
      }
    }
  }, name);
}

export function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

export function required(name) {
  const value = arg(name);
  if (!value) {
    throw new Error(`--${name} is required`);
  }
  return value;
}
