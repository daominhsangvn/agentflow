// Finds a full ffmpeg (libx264, libvpx-vp9, aac): --ffmpeg=<path>, FFMPEG, ffmpeg on PATH, or the
// winget install. Playwright's bundled ffmpeg is not enough for these encoders.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const LINE_BREAK = /\r?\n/;

export function findFfmpeg() {
  const flag = process.argv.find((a) => a.startsWith("--ffmpeg="));
  const explicit = flag ? flag.slice("--ffmpeg=".length) : process.env.FFMPEG;
  if (explicit) {
    return explicit;
  }
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["ffmpeg"], { encoding: "utf8" });
  if (which.status === 0 && which.stdout.trim()) {
    return which.stdout.split(LINE_BREAK)[0].trim();
  }
  const winget = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Links", "ffmpeg.exe");
  if (fs.existsSync(winget)) {
    return winget;
  }
  throw new Error("ffmpeg not found: install it (winget install --id Gyan.FFmpeg -e) or pass --ffmpeg=<path>");
}

export function runFfmpeg(ffmpeg, args) {
  const run = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  if (run.status !== 0) {
    throw new Error(`ffmpeg exited with ${run.status}`);
  }
}
