// Renders the animatic to a silent WebM (VP8), frame by frame, so the motion is exact.
// Frames come from window.__render(t) in headless Chromium and are piped as JPEG into ffmpeg.
// Playwright's bundled ffmpeg is enough (it has mjpeg in, VP8/WebM out, but no audio codecs);
// to add the voice-over, mux audio/vo-en.wav afterwards with a full ffmpeg (see README.md).
// Usage: node tools/render-webm.mjs [--lang=en|vi] [--fps=30] [--from=0] [--to=<end>]
//                                   [--out=out/agentflow-explainer-<lang>.webm] [--ffmpeg=<path>]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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
const fps = Number(arg("fps", "30"));
const out = path.resolve(root, arg("out", path.join("out", `agentflow-explainer-${lang}.webm`)));
const ffmpeg = findFfmpeg();
fs.mkdirSync(path.dirname(out), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${pathToFileURL(path.join(root, "index.html")).href}?capture=1&lang=${lang}`);
await page.evaluate(() => window.__ready);
const duration = await page.evaluate(() => window.__duration);
const from = Number(arg("from", "0"));
const to = Math.min(Number(arg("to", String(duration))), duration);
const frames = Math.max(1, Math.round((to - from) * fps));

const enc = spawn(
  ffmpeg,
  [
    ["-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg"],
    ["-i", "pipe:0", "-an", "-c:v", "vp8", "-b:v", "6M", "-crf", "8", "-qmin", "2", "-qmax", "40"],
    ["-deadline", "good", "-cpu-used", "4", "-threads", String(Math.min(8, os.cpus().length))],
    ["-y", out],
  ].flat(),
  { stdio: ["pipe", "inherit", "inherit"] }
);
const encoded = new Promise((resolve, reject) => {
  enc.on("error", reject);
  enc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
});

const started = Date.now();
let nextReport = 0;
for (let i = 0; i < frames; i++) {
  await page.evaluate((tt) => window.__render(tt), from + i / fps);
  const jpg = await page.screenshot({ type: "jpeg", quality: 92 });
  if (!enc.stdin.write(jpg)) {
    await new Promise((resolve) => enc.stdin.once("drain", resolve));
  }
  if (i / frames >= nextReport) {
    console.log(`${Math.round((i / frames) * 100)}% · frame ${i}/${frames} · ${elapsed()}`);
    nextReport += 0.1;
  }
}
enc.stdin.end();
await encoded;
await browser.close();
const mb = (fs.statSync(out).size / 1e6).toFixed(1);
console.log(`done · ${out} · ${mb} MB · ${frames} frames @ ${fps} fps · ${elapsed()}`);
if (errors.length) {
  console.log(`PAGE ERRORS:\n${errors.join("\n")}`);
}

function elapsed() {
  return `${Math.round((Date.now() - started) / 1000)}s`;
}

function findFfmpeg() {
  const explicit = arg("ffmpeg") || process.env.FFMPEG;
  if (explicit) {
    return explicit;
  }
  const base = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "ms-playwright")
    : path.join(os.homedir(), ".cache", "ms-playwright");
  const names = ["ffmpeg-win64.exe", "ffmpeg-linux", "ffmpeg-mac"];
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => d.startsWith("ffmpeg-")) : [];
  for (const dir of dirs.sort().reverse()) {
    for (const name of names) {
      const candidate = path.join(base, dir, name);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return "ffmpeg";
}
