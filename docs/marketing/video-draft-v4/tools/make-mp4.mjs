// Turns a rendered WebM (tools/render-webm.mjs) into an MP4 (H.264 + AAC) with the music
// (audio/music.wav, tools/make-music.mjs). v4 has no voice-over: both languages get the same music,
// brought to a set loudness (ffmpeg ebur128), so a new music track needs no tuning.
// Needs a full ffmpeg (libx264, aac): --ffmpeg=<path>, FFMPEG, ffmpeg on PATH, or the winget install.
// Usage: node tools/make-mp4.mjs [--lang=en|vi] [--music=audio/music.wav] [--no-music]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findFfmpeg, runFfmpeg } from "./ffmpeg.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const MUSIC_LUFS = -16;
const LUFS_LINE = /I:\s+(-?[\d.]+) LUFS/;

const ffmpeg = findFfmpeg();
const musicFile = process.argv.includes("--no-music")
  ? null
  : path.resolve(root, arg("music") || "audio/music.wav");
if (musicFile && !fs.existsSync(musicFile)) {
  throw new Error(`${musicFile} is missing: run node tools/make-music.mjs, or pass --no-music`);
}
const gain = musicFile ? gainTo(MUSIC_LUFS, musicFile) : null;
const langs = arg("lang") ? [arg("lang")] : ["en", "vi"];
for (const lang of langs) {
  mux(lang);
}

function mux(lang) {
  const video = path.join(root, "out", `agentflow-explainer-${lang}.webm`);
  const out = path.join(root, "out", `agentflow-explainer-${lang}.mp4`);
  if (!fs.existsSync(video)) {
    throw new Error(`${video} is missing: run node tools/render-webm.mjs --lang=${lang} first`);
  }
  const inputs = ["-i", video];
  const audioArgs = [];
  if (musicFile) {
    inputs.push("-i", musicFile);
    // apad: the audio never ends before the video, so -shortest cuts at the last video frame.
    const chain = `[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=${gain}dB,alimiter=limit=0.89:level=false,apad[a]`;
    audioArgs.push("-filter_complex", chain, "-map", "0:v", "-map", "[a]", "-c:a", "aac", "-b:a", "192k");
  }
  runFfmpeg(ffmpeg, [
    ...inputs,
    ...audioArgs,
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-shortest",
    "-movflags",
    "+faststart",
    out,
  ]);
  console.log(`${path.relative(root, out)} · ${musicFile ? "music" : "no sound"}`);
}

// dB that brings a file's integrated loudness to target LUFS.
function gainTo(target, file) {
  const run = spawnSync(ffmpeg, ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"], {
    encoding: "utf8",
  });
  const summary = run.stderr.slice(run.stderr.lastIndexOf("Summary:"));
  const m = LUFS_LINE.exec(summary);
  if (run.status !== 0 || !m) {
    throw new Error(`could not measure the loudness of ${file}`);
  }
  return (target - Number(m[1])).toFixed(2);
}

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
