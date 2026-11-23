// Builds the animatic timeline from tools/script.json.
// 1. Synthesizes the English scratch VO, one WAV per scene (Windows speech engine, tools/tts.ps1).
// 2. Sizes every scene: max(planned duration, VO offset + VO length + gap).
// 3. Writes audio/vo-en.wav (all lines placed on the timeline) and js/timeline.js, including the
//    start time of every spoken word (scene.words: [time, word]) so scenes can anchor to words.
// Usage: node tools/make-vo.mjs            (with audio)
//        node tools/make-vo.mjs --no-audio (timeline only, VO length estimated from word count)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const cfg = JSON.parse(fs.readFileSync(path.join(here, "script.json"), "utf8"));
const noAudio = process.argv.includes("--no-audio");
const linesDir = path.join(root, "audio", "lines");
const DEFAULT_OFFSET = 0.3;
const SAMPLE_RATE = 22050;
// The voice reports word positions (SpeakProgress AudioPosition) at its native 16 kHz even though
// the WAV is written at 22.05 kHz; scaled by this, they match the speech onsets in the audio.
const ENGINE_RATE = 16000;

const round3 = (v) => Math.round(v * 1000) / 1000;

function synthesize() {
  fs.mkdirSync(linesDir, { recursive: true });
  const manifest = cfg.scenes.map((s) => ({
    text: s.tts || s.en,
    path: path.join(linesDir, `${s.id}.wav`),
  }));
  const manifestPath = path.join(linesDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(here, "tts.ps1"),
      "-Manifest",
      manifestPath,
      "-Voice",
      cfg.voice,
      "-Rate",
      String(cfg.rate),
    ],
    { stdio: "inherit" }
  );
}

function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${file} is not a WAV file`);
  }
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      fmt = {
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      data = buf.subarray(body, body + size);
    }
    offset = body + size + (size % 2);
  }
  if (!fmt || !data) {
    throw new Error(`${file}: missing fmt or data chunk`);
  }
  if (fmt.channels !== 1 || fmt.bits !== 16 || fmt.sampleRate !== SAMPLE_RATE) {
    throw new Error(`${file}: expected 16-bit mono ${SAMPLE_RATE} Hz`);
  }
  const samples = new Int16Array(data.length / 2);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = data.readInt16LE(i * 2);
  }
  return samples;
}

// Returns the line without leading/trailing silence and the sample it now starts at.
function trimSilence(samples) {
  const threshold = 180;
  let start = 0;
  let end = samples.length - 1;
  while (start < end && Math.abs(samples[start]) < threshold) start++;
  while (end > start && Math.abs(samples[end]) < threshold) end--;
  const pad = Math.round(0.03 * SAMPLE_RATE);
  const from = Math.max(0, start - pad);
  return { pcm: samples.subarray(from, Math.min(samples.length, end + pad)), from };
}

// Word start times (seconds into the trimmed line) from tts.ps1's <id>.words.json.
function readWords(id, text, trimmedFrom, voDur) {
  const file = path.join(linesDir, `${id}.words.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`${file} is missing; rerun without --no-audio`);
  }
  const shift = trimmedFrom / SAMPLE_RATE;
  const words = JSON.parse(fs.readFileSync(file, "utf8")).map((w) => [
    Math.max(0, (w.t * ENGINE_RATE) / SAMPLE_RATE - shift),
    text.slice(w.c, w.c + w.n),
  ]);
  const last = words.at(-1);
  if (!last || last[0] > voDur) {
    throw new Error(`${id}: word times run past the line (${last?.[0]}s > ${voDur}s); check ENGINE_RATE`);
  }
  return words;
}

// Without audio: spread the words over the estimated line length by character count.
function estimateWords(text, voDur) {
  const words = text.split(/\s+/).filter(Boolean);
  const total = words.reduce((n, w) => n + w.length + 1, 0);
  let chars = 0;
  return words.map((w) => {
    const at = (chars / total) * voDur;
    chars += w.length + 1;
    return [at, w];
  });
}

function writeWav(file, samples) {
  const header = Buffer.alloc(44);
  const dataBytes = samples.length * 2;
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  const body = Buffer.alloc(dataBytes);
  for (let i = 0; i < samples.length; i++) {
    body.writeInt16LE(samples[i], i * 2);
  }
  fs.writeFileSync(file, Buffer.concat([header, body]));
}

if (!noAudio) {
  synthesize();
}

let cursor = 0;
const scenes = [];
const clips = [];
for (const s of cfg.scenes) {
  const voOffset = s.voOffset ?? DEFAULT_OFFSET;
  const text = s.tts || s.en;
  let voDur;
  let words;
  if (noAudio) {
    voDur = s.en.split(/\s+/).length / 2.4;
    words = estimateWords(text, voDur);
  } else {
    const { pcm, from } = trimSilence(readWav(path.join(linesDir, `${s.id}.wav`)));
    voDur = pcm.length / SAMPLE_RATE;
    words = readWords(s.id, text, from, voDur);
    clips.push({ at: cursor + voOffset, pcm });
  }
  const length = Math.max(s.planned, voOffset + voDur + (cfg.gapAfter ?? 0.5));
  scenes.push({
    id: s.id,
    title: s.title,
    start: round3(cursor),
    end: round3(cursor + length),
    voStart: round3(cursor + voOffset),
    voDur: round3(voDur),
    en: s.en,
    vi: s.vi,
    ...(s.clip ? { clip: s.clip } : {}),
    words: words.map(([at, w]) => [round3(cursor + voOffset + at), w]),
  });
  cursor += length;
}
const duration = round3(cursor);

if (!noAudio) {
  const total = new Int16Array(Math.ceil(duration * SAMPLE_RATE) + SAMPLE_RATE);
  for (const clip of clips) {
    total.set(clip.pcm, Math.round(clip.at * SAMPLE_RATE));
  }
  writeWav(path.join(root, "audio", "vo-en.wav"), total);
}

const timeline = {
  generated: new Date().toISOString(),
  voice: noAudio ? null : cfg.voice,
  audio: noAudio ? null : "audio/vo-en.wav",
  duration,
  scenes,
};
fs.writeFileSync(
  path.join(root, "js", "timeline.js"),
  `// Generated by tools/make-vo.mjs from tools/script.json. Do not edit by hand.\nwindow.TIMELINE = ${JSON.stringify(timeline, null, 2)};\n`,
  "utf8"
);
console.log(`timeline: ${scenes.length} scenes, ${duration}s${noAudio ? " (no audio)" : ", audio/vo-en.wav"}`);
for (const s of scenes) {
  console.log(`${s.id.padEnd(4)} ${String(s.start).padStart(7)} → ${String(s.end).padStart(7)}  vo ${s.voDur}s`);
}
