// Turns a rendered WebM (tools/render-webm.mjs) into an MP4 (H.264 + AAC) with sound.
// EN: the scratch voice-over (audio/vo-en.wav) over the music (audio/music.wav, tools/make-music.mjs).
//     The music dips while a line is spoken; the dips come from the VO lines in js/timeline.js, so the
//     music holds still through short pauses inside a line.
// VI: the music alone, since the scratch voice is English only.
// Levels are set by measured loudness (ffmpeg ebur128), so a new voice or music track needs no tuning.
// Needs a full ffmpeg (libx264, aac): --ffmpeg=<path>, FFMPEG, ffmpeg on PATH, or the winget install.
// Usage: node tools/make-mp4.mjs [--lang=en|vi] [--music=audio/music.wav] [--no-music]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const VO_LUFS = -16;
const BED_LUFS = -23;
const SOLO_LUFS = -18;
const DUCK_DB = -7;
const DUCK_RAMP = 0.35;
const LUFS_LINE = /I:\s+(-?[\d.]+) LUFS/;
const LINE_BREAK = /\r?\n/;

const ffmpeg = findFfmpeg();
const timeline = readTimeline();
const musicFile = process.argv.includes("--no-music")
  ? null
  : path.resolve(root, arg("music") || "audio/music.wav");
if (musicFile && !fs.existsSync(musicFile)) {
  throw new Error(
    `${musicFile} is missing: run node tools/make-music.mjs, or pass --no-music`
  );
}
const langs = arg("lang") ? [arg("lang")] : ["en", "vi"];
for (const lang of langs) {
  mux(lang);
}

function mux(lang) {
  const video = path.join(root, "out", `agentflow-explainer-${lang}.webm`);
  const out = path.join(root, "out", `agentflow-explainer-${lang}.mp4`);
  if (!fs.existsSync(video)) {
    throw new Error(
      `${video} is missing: run node tools/render-webm.mjs --lang=${lang} first`
    );
  }
  const inputs = ["-i", video];
  const chains = [];
  const stems = [];
  if (lang === "en") {
    const vo = path.join(root, "audio", "vo-en.wav");
    inputs.push("-i", vo);
    chains.push(`[1:a]${stereo48k()},volume=${gainTo(VO_LUFS, vo)}dB[vo]`);
    stems.push("[vo]");
  }
  if (musicFile) {
    const index = inputs.length / 2;
    inputs.push("-i", musicFile);
    const duck =
      lang === "en" ? `,volume='${duckExpression()}':eval=frame` : "";
    const target = lang === "en" ? BED_LUFS : SOLO_LUFS;
    chains.push(
      `[${index}:a]${stereo48k()},volume=${gainTo(target, musicFile)}dB${duck}[bed]`
    );
    stems.push("[bed]");
  }
  const audioArgs = [];
  if (stems.length > 0) {
    const mixed =
      stems.length === 2
        ? `${stems.join("")}amix=inputs=2:duration=longest:normalize=0,`
        : stems[0];
    // apad: the audio never ends before the video, so -shortest cuts at the last video frame.
    chains.push(`${mixed}alimiter=limit=0.89:level=false,apad[a]`);
    audioArgs.push(
      "-filter_complex",
      chains.join(";"),
      "-map",
      "0:v",
      "-map",
      "[a]",
      "-c:a",
      "aac",
      "-b:a",
      "192k"
    );
  }
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
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
  ];
  const run = spawnSync(ffmpeg, args, { stdio: "inherit" });
  if (run.status !== 0) {
    throw new Error(`ffmpeg exited with ${run.status} for ${lang}`);
  }
  const sound =
    stems.length === 0
      ? "no sound"
      : stems.map((s) => (s === "[vo]" ? "voice-over" : "music")).join(" + ");
  console.log(`${path.relative(root, out)} · ${sound}`);
}

function stereo48k() {
  return "aresample=48000,aformat=channel_layouts=stereo";
}

// dB that brings a file's integrated loudness to target LUFS.
function gainTo(target, file) {
  const run = spawnSync(
    ffmpeg,
    [
      "-hide_banner",
      "-nostats",
      "-i",
      file,
      "-af",
      "ebur128",
      "-f",
      "null",
      "-",
    ],
    {
      encoding: "utf8",
    }
  );
  const summary = run.stderr.slice(run.stderr.lastIndexOf("Summary:"));
  const m = LUFS_LINE.exec(summary);
  if (run.status !== 0 || !m) {
    throw new Error(`could not measure the loudness of ${file}`);
  }
  return (target - Number(m[1])).toFixed(2);
}

// Music gain over time: 1, dipping to DUCK_DB from DUCK_RAMP before each VO line to DUCK_RAMP after it.
function duckExpression() {
  const r = DUCK_RAMP;
  const terms = timeline.scenes.map((s) => {
    const a = (s.voStart - r).toFixed(3);
    const b = (s.voStart + s.voDur + r).toFixed(3);
    return `clip((t-(${a}))/${r},0,1)*clip(((${b})-t)/${r},0,1)`;
  });
  const inLine = terms.reduce((acc, term) => `max(${acc},${term})`);
  return `1-${(1 - 10 ** (DUCK_DB / 20)).toFixed(4)}*${inLine}`;
}

function readTimeline() {
  const src = fs.readFileSync(path.join(root, "js", "timeline.js"), "utf8");
  return JSON.parse(src.slice(src.indexOf("{"), src.lastIndexOf("}") + 1));
}

function findFfmpeg() {
  const explicit = arg("ffmpeg") || process.env.FFMPEG;
  if (explicit) {
    return explicit;
  }
  const which = spawnSync(
    process.platform === "win32" ? "where" : "which",
    ["ffmpeg"],
    { encoding: "utf8" }
  );
  if (which.status === 0 && which.stdout.trim()) {
    return which.stdout.split(LINE_BREAK)[0].trim();
  }
  const winget = path.join(
    process.env.LOCALAPPDATA || "",
    "Microsoft",
    "WinGet",
    "Links",
    "ffmpeg.exe"
  );
  if (fs.existsSync(winget)) {
    return winget;
  }
  throw new Error(
    "ffmpeg not found: install it (winget install --id Gyan.FFmpeg -e) or pass --ffmpeg=<path>"
  );
}

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
