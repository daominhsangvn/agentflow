// Renders a motion clip of a real AgentFlow page for the video. The page loads with the demo data
// (tools/app-page.mjs); a clip script (tools/ui-clips/<clip>.js, after tools/ui-clips/kit.js) moves
// the page's own elements as a pure function of time; every frame is captured and encoded. The
// motion is the same on every run, and nothing on the server changes.
// Usage: node tools/ui-clip.mjs --clip=runs --url=https://af.example.com --api=https://af-api.example.com
//          --org=<slug> [--fps=30] [--dpr=2] [--out=assets/ui] [--preview=<file.mp4>] [--auth=<state.json>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { arg, goTo, openApp, required } from "./app-page.mjs";
import { findFfmpeg, runFfmpeg } from "./ffmpeg.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
// The page each clip films. Clips are encoded at 2560×1440 so the video can push in without blur.
const CLIPS = {
  runs: { route: "runs" },
  connections: { route: "connections" },
  workflows: { route: "workflows" },
  agents: { route: "agents" },
  home: { route: "dashboard" },
};
const SIZE = "2560:1440";

const name = required("clip");
const clip = CLIPS[name];
if (!clip) {
  throw new Error(`unknown clip "${name}"; known: ${Object.keys(CLIPS).join(", ")}`);
}
const appUrl = new URL(required("url"));
const apiUrl = new URL(required("api"));
const org = required("org");
const fps = Number(arg("fps") || 30);
const outDir = path.resolve(root, arg("out") || "assets/ui");
const framesDir = path.join(os.tmpdir(), "af-video", "frames", name);
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const app = await openApp({ appUrl, apiUrl, auth: arg("auth"), dpr: Number(arg("dpr") || 2) });
await goTo(app.page, appUrl, org, clip.route);
await app.freeze();
await app.page.addScriptTag({ path: path.join(here, "ui-clips", "kit.js") });
await app.page.addScriptTag({ path: path.join(here, "ui-clips", `${name}.js`) });
const duration = await app.page.evaluate(() => {
  window.__ui.prepare();
  return window.__ui.duration;
});
const frames = Math.round(duration * fps);
const started = Date.now();
for (let i = 0; i < frames; i++) {
  await app.page.evaluate((t) => window.__ui.render(t), i / fps);
  await app.page.screenshot({ path: path.join(framesDir, `${String(i).padStart(5, "0")}.jpg`), type: "jpeg", quality: 92 });
}
console.log(`${frames} frames in ${Math.round((Date.now() - started) / 1000)}s; demo data: ${[...app.served].sort().join(", ")}`);
if (app.errors.length > 0) {
  console.log(`page errors:\n${app.errors.join("\n")}`);
}
await app.browser.close();

const ffmpeg = findFfmpeg();
const input = ["-framerate", String(fps), "-i", path.join(framesDir, "%05d.jpg")];
const webm = path.join(outDir, `${name}.webm`);
// Short keyframe interval: the animatic seeks into the clip on every rendered frame.
runFfmpeg(ffmpeg, [...input, "-vf", `scale=${SIZE}:flags=lanczos`, "-c:v", "libvpx-vp9", "-crf", "20", "-b:v", "0", "-g", "15", "-row-mt", "1", "-pix_fmt", "yuv420p", webm]);
console.log(path.relative(root, webm));
const preview = arg("preview");
if (preview) {
  runFfmpeg(ffmpeg, [...input, "-vf", "scale=1920:1080:flags=lanczos", "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.resolve(preview)]);
  console.log(path.resolve(preview));
}
