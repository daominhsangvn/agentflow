// Captures stills of the animatic for review.
// Usage: node tools/shoot.mjs --t=1.5,12,40 [--lang=vi] [--scenes] [--out=shots]
//   --scenes  adds one still near the middle of every scene
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const arg = (name, fallback = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const lang = arg("lang", "en");
const outDir = path.join(root, arg("out", "shots"));
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") {
    errors.push(m.text());
  }
});
await page.goto(`${pathToFileURL(path.join(root, "index.html")).href}?capture=1&lang=${lang}`);
await page.evaluate(() => window.__ready);

const times = (arg("t", "") || "").split(",").filter(Boolean).map(Number);
if (process.argv.includes("--scenes")) {
  const scenes = await page.evaluate(() => window.TIMELINE.scenes);
  for (const s of scenes) {
    times.push(Math.round(((s.start + s.end) / 2) * 100) / 100);
  }
}
for (const t of times) {
  await page.evaluate(async (tt) => {
    window.__render(tt);
    await window.__settle?.();
  }, t);
  const file = path.join(outDir, `${lang}-${t.toFixed(2).padStart(6, "0")}.png`);
  await page.screenshot({ path: file });
  console.log(file);
}
if (errors.length) {
  console.log("PAGE ERRORS:\n" + errors.join("\n"));
}
await browser.close();
