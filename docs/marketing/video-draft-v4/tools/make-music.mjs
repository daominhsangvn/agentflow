// Synthesizes the background-music bed audio/music.wav from the scene times in js/timeline.js.
// 1. Picks one tempo between 96 and 112 BPM (or --bpm) and a first-beat offset shorter than a beat
//    so that C2, C3, C8 and C9 start as close as possible to a beat, each on a downbeat. With only
//    4-beat bars a constant tempo misses the cuts by a few hundred ms, so the last bar before a cut
//    may have 3, 5 or 6 beats; the search takes such a bar only if it gains over 5 ms.
// 2. Lays the arrangement on that grid in C major / A minor, one chord per bar. C1: pad and sub-bass
//    on Am7 and F. C2: resolves to C, adds a bass pulse and a pluck arpeggio. C3-C7: Am7-F-C-G with
//    hats, then a light kick. A noise riser leads into C8, the fullest part. C9 resolves to C and
//    fades out, reaching silence at the end of the timeline.
// 3. Renders every part sample by sample (detuned-saw pad, sine bass, triangle pluck with ping-pong
//    delay, synthesized drums, Freeverb-style reverb) with seeded noise, so the same timeline always
//    gives the same file. The master is high-passed at 30 Hz, compressed, normalized to -1 dBFS.
// Usage: node tools/make-music.mjs                  (tempo chosen from the timeline)
//        node tools/make-music.mjs --bpm=104        (fixed tempo, only the offset is searched)
//        node tools/make-music.mjs --out=audio/music-test.wav
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const SR = 44_100;
const TAU = 2 * Math.PI;
const SEED = 20_261_121;
const BPM_MIN = 96;
const BPM_MAX = 112;
const BPM_PREFERRED = 104;
const OFFSET_STEP = 0.0001;
// Seconds of alignment error that one bar of other than 4 beats is worth.
const ODD_BAR_COST = 0.005;
// v4: the feature part (real app screens and the flow) starts at U1 and runs to C8.
const ALIGNED = ["C2", "U1", "C8", "C9"];
const ARG = /^--(out|bpm)=(.+)$/;
const PEAK_DBFS = -1;
const FADE_IN = 0.5;
const PAD_LEVEL = 0.185;
const PAD_RELEASE = 1.1;
// Cents per saw: the first three play left, the last three right.
const PAD_DETUNE = [-14, -4, 9, -9, 4, 14];
// Scales the pad's side signal (1 = left and right fully independent).
const PAD_WIDTH = 0.7;
const BASS_LEVEL = 0.15;
const PLUCK_LEVEL = 0.14;
const ECHO_LEVEL = 0.4;
const REVERB_RETURN = 0.8;
const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
// Pitch-drop sines: start and end Hz, pitch and amplitude time constants (s).
const KICK = { f0: 140, f1: 49, pitch: 0.035, decay: 0.17, gain: 0.34 };
const SOFT_KICK = { f0: 110, f1: 52, pitch: 0.03, decay: 0.11, gain: 0.17 };
const BOOM = { f0: 97, f1: 42, pitch: 0.12, decay: 0.55, gain: 0.22 };

// MIDI notes per chord: sine-bass root, pad voicing, pluck tones. The pad
// keeps G4 on top and moves its inner voices by step.
const CHORDS = {
  Am7: { root: 33, pad: [57, 60, 64, 67], arp: [69, 72, 76, 79] },
  F: { root: 29, pad: [57, 60, 65, 67], arp: [65, 69, 72, 76] },
  C: { root: 36, pad: [55, 60, 64, 67], arp: [67, 72, 76, 79] },
  G: { root: 31, pad: [55, 59, 62, 67], arp: [67, 71, 74, 79] },
  Gsus4: { root: 31, pad: [55, 60, 62, 67], arp: [67, 72, 74, 79] },
  Cadd9: { root: 36, pad: [48, 55, 64, 67, 74], arp: [64, 67, 72, 76, 79] },
};
// Per section (see the section function): scenes, pad level, pad low-pass (Hz),
// bass level, depth of the eighth-note bass pulse (0 holds the notes), pluck
// level (0 = none), pluck decay (s), chord loop.
const SECTIONS = {
  problem: section("C1", 0.5, 1100, 0.42, 0, 0, 0, "Am7 F"),
  lift: section("C2", 0.85, 1900, 0.7, 0.45, 0.85, 0.24, "C G Am7 F"),
  example: section("U1-U4", 0.72, 1700, 0.75, 0.5, 0.75, 0.2, "Am7 F C G"),
  full: section("C8", 1.1, 2400, 1.15, 0.6, 0.9, 0.18, "Am7 F C G"),
  resolve: section("C9", 1, 2000, 0.7, 0, 0.9, 0.8, "Cadd9"),
};
// Arpeggios: "sixteenth in the bar, index into the chord's pluck tones,
// velocity" triplets. C3-C7 alternate a rising bar and a falling answer.
const ARP_RISE = arp("0 0 1, 3 1 .72, 6 2 .82, 8 3 .9, 11 2 .7, 14 1 .76");
const ARPS = {
  lift: [ARP_RISE],
  example: [ARP_RISE, arp("0 3 .9, 3 2 .72, 6 1 .8, 10 0 .74, 14 2 .62")],
  full: [
    arp(
      "0 0 1, 2 1 .7, 4 2 .82, 6 3 .74, 8 0 .94, 10 1 .7, 12 2 .82, 14 3 .76"
    ),
  ],
};
// Closed-hat velocity per sixteenth of a beat: the offbeat is the accent.
const HAT_16 = [0.5, 0.28, 1, 0.34];
// Drum hits per bar, by section (see exampleHits and fullHits).
const DRUMS = {
  example: exampleHits,
  full: fullHits,
  resolve: (_, b) => (b.i === 0 ? [["kick", 0, 0.9]] : []),
};

const startedAt = performance.now();
const opts = parseArgs(process.argv.slice(2));
const timeline = readTimeline(path.join(root, "js", "timeline.js"));
const scenes = new Map(timeline.scenes.map((s) => [s.id, s]));
const missing = ["C1", ...ALIGNED].filter((id) => !scenes.has(id));
if (missing.length > 0) {
  throw new Error(`js/timeline.js has no scene ${missing.join(", ")}`);
}
const duration = timeline.duration;
const total = Math.round(duration * SR);
const song = arrange(chooseGrid(ALIGNED.map((id) => scenes.get(id).start)));
const mix = renderMix(song);
const compression = masterBus(mix, song);
const peakDb = writeWav(opts.out, mix);
report(song, mix, compression, peakDb);

function parseArgs(argv) {
  const parsed = { out: path.join(root, "audio", "music.wav"), bpm: null };
  for (const arg of argv) {
    const [, key, value] = ARG.exec(arg) ?? [];
    if (key === "out") {
      parsed.out = path.resolve(value);
    } else if (key === "bpm" && Number(value) >= 40 && Number(value) <= 240) {
      parsed.bpm = Number(value);
    } else {
      throw new Error(`bad argument ${arg} (use --out=<wav>, --bpm=<40-240>)`);
    }
  }
  return parsed;
}

function readTimeline(file) {
  const src = fs.readFileSync(file, "utf8");
  const start = src.indexOf("{", src.indexOf("window.TIMELINE"));
  const end = src.lastIndexOf("}");
  if (!src.includes("window.TIMELINE") || start < 0 || end < start) {
    throw new Error(`${file}: expected window.TIMELINE = {...};`);
  }
  return JSON.parse(src.slice(start, end + 1));
}

// Every tempo in 0.1 BPM steps (or --bpm) and every first-beat offset in
// 0.1 ms steps within one beat; the lowest key from gridKey wins.
function chooseGrid(boundaries) {
  const count = (BPM_MAX - BPM_MIN) * 10 + 1;
  const bpms = opts.bpm
    ? [opts.bpm]
    : Array.from({ length: count }, (_, k) => BPM_MIN + k / 10);
  let best = null;
  for (const bpm of bpms) {
    const beat = 60 / bpm;
    for (let k = 0; k * OFFSET_STEP < beat; k++) {
      const key = gridKey(boundaries, beat, k * OFFSET_STEP, bpm);
      if (key !== null && (!best || key < best.key)) {
        best = { bpm, offset: k * OFFSET_STEP, key };
      }
    }
  }
  if (!best) {
    throw new Error("no beat grid fits the timeline (scenes under 3 beats?)");
  }
  const beat = 60 / best.bpm;
  const marks = boundaries.map((t) => Math.round((t - best.offset) / beat));
  const errors = boundaries.map((t, i) => best.offset + marks[i] * beat - t);
  return { bpm: best.bpm, beat, offset: best.offset, marks, errors };
}

// One number that sorts by cost, then summed error, then distance from
// BPM_PREFERRED (errors in 0.1 ms units). cost = worst boundary error plus
// ODD_BAR_COST per section that is not a whole number of 4-beat bars.
// Sections need 3 beats; C9 needs a second to ring out.
function gridKey(boundaries, beat, offset, bpm) {
  let prev = 0;
  let max = 0;
  let sum = 0;
  let odd = 0;
  for (const t of boundaries) {
    const m = Math.round((t - offset) / beat);
    if (m - prev < 3) {
      return null;
    }
    odd += (m - prev) % 4 === 0 ? 0 : 1;
    const err = Math.abs(offset + m * beat - t);
    max = Math.max(max, err);
    sum += err;
    prev = m;
  }
  if (offset + prev * beat > duration - 1) {
    return null;
  }
  const cost = Math.round((max + ODD_BAR_COST * odd) * 1e4);
  const tempo = Math.round(Math.abs(bpm - BPM_PREFERRED) * 10);
  return cost * 1e9 + Math.round(sum * 1e4) * 1e3 + tempo;
}

// Splits every section into bars (see barLengths) and gives each bar a chord.
function arrange(grid) {
  const { beat, offset } = grid;
  const names = Object.keys(SECTIONS);
  const first = [0, ...grid.marks];
  const last = [...grid.marks, Math.ceil((duration - offset) / beat)];
  const bars = [];
  const starts = {};
  const time = {};
  names.forEach((section, k) => {
    starts[section] = bars.length;
    time[section] = offset + first[k] * beat;
    const lengths = barLengths(last[k] - first[k], section === "resolve");
    const len = lengths.length;
    let at = first[k];
    lengths.forEach((beats, i) => {
      const t = offset + at * beat;
      const i0 = Math.round(t * SR);
      const chord = chordFor(section, i, len);
      bars.push({ n: bars.length, t, i0, beats, section, i, len, chord });
      at += beats;
    });
  });
  // Layers inside the feature part enter on the bar nearest to the start of C3 and U3.
  const example = bars.filter((b) => b.section === "example");
  const nearest = (id) => {
    const at = scenes.get(id)?.start ?? time.example;
    const dist = (b) => Math.abs(b.t - at);
    return example.reduce((a, b) => (dist(b) < dist(a) ? b : a)).n;
  };
  const cues = { kick: nearest("C3"), hats16: nearest("U3") };
  // Bass, drums and pluck rest on the last beat of C8.
  return { ...grid, bars, starts, time, cues, stop: time.resolve - beat };
}

// 4-beat bars; the last bar of a section takes the remainder: 5 or 6 beats
// when one or two beats are left over, a 3-beat bar when three are. C9 only
// holds its chord, so it gets plain 4-beat bars.
function barLengths(beats, plain) {
  const q = Math.floor(beats / 4);
  const r = beats % 4;
  if (plain || r === 0) {
    return new Array(Math.ceil(beats / 4)).fill(4);
  }
  if (r === 3 || q === 0) {
    return [...new Array(q).fill(4), r];
  }
  return [...new Array(q - 1).fill(4), 4 + r];
}

// C8 always ends on G, so C9 lands as a V-I cadence; a G right before that
// bar becomes Gsus4.
function chordFor(section, i, len) {
  const { chords } = SECTIONS[section];
  const name = chords[i % chords.length];
  if (section !== "full") {
    return name;
  }
  if (i === len - 1) {
    return "G";
  }
  return i === len - 2 && name === "G" ? "Gsus4" : name;
}

// All parts add into one stereo bus and one reverb send. The drums go first:
// the C8 kick writes the envelope that ducks the pad and the bass.
function renderMix(s) {
  const buf = () => new Float32Array(total);
  const bus = { L: buf(), R: buf(), sendL: buf(), sendR: buf() };
  const duck = buf();
  for (const part of [renderDrums, renderPad, renderBass, renderPluck]) {
    part(s, bus, duck);
  }
  renderFx(s, bus);
  const wet = reverb(bus);
  for (let i = 0; i < total; i++) {
    bus.L[i] += wet.L[i];
    bus.R[i] += wet.R[i];
  }
  return bus;
}

function renderPad(s, bus, duck) {
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  const rng = rngFor("pad");
  for (const note of padNotes(s)) {
    sawNote(L, R, note, rng);
  }
  const t9 = s.time.resolve;
  const ring = (t) => (t - t9) / (duration - t9);
  // C1 opens slowly; C9 closes and gets quieter while the last chord rings.
  const cutoff = barCurve(s, 0.5, (b, t) => {
    const base =
      SECTIONS[b.section].cutoff * (1 + 0.06 * Math.sin(TAU * 0.08 * t));
    if (b.section === "problem") {
      return base * (1 + (0.4 * b.i) / Math.max(1, b.len - 1));
    }
    return b.section === "resolve" ? base * 0.45 ** ring(t) : base;
  });
  const gain = barCurve(s, 0.3, (b, t) => {
    const base = SECTIONS[b.section].pad;
    return b.section === "resolve" ? base * (1 - 0.45 * ring(t)) : base;
  });
  for (const x of [L, R]) {
    svf(x, "low", cutoff, 0.5412);
    svf(x, "low", cutoff, 1.3066);
  }
  for (let i = 0; i < total; i++) {
    const g = gain[i] * (1 - 0.15 * duck[i]);
    const mid = (L[i] + R[i]) * 0.5 * g;
    const side = (L[i] - R[i]) * 0.5 * g * PAD_WIDTH;
    bus.L[i] += mid + side;
    bus.R[i] += mid - side;
    bus.sendL[i] += 0.3 * (mid + side);
    bus.sendR[i] += 0.3 * (mid - side);
  }
}

// A note held from one chord to the next keeps sounding; the others release
// and new ones attack. C8 adds its two top notes an octave up, quieter.
function padNotes(s) {
  const notes = [];
  const active = new Map();
  for (const b of s.bars) {
    const t = b.n === 0 ? 0 : b.t;
    const { pad } = CHORDS[b.chord];
    const air = b.section === "full" ? pad.slice(-2) : [];
    const wanted = new Map(pad.map((m) => [m, 1]));
    for (const m of air) {
      wanted.set(m + 12, 0.4);
    }
    for (const [midi, note] of active) {
      if (!wanted.has(midi)) {
        note.end = t;
        notes.push(note);
        active.delete(midi);
      }
    }
    for (const [midi, gain] of wanted) {
      if (!active.has(midi)) {
        const attack = padAttack(b);
        active.set(midi, { midi, gain, start: t, end: duration, attack });
      }
    }
  }
  return [...notes, ...active.values()];
}

function padAttack(b) {
  if (b.n === 0) {
    return 1.8;
  }
  return b.section === "resolve" ? 0.12 : 0.35;
}

// Six detuned PolyBLEP saws, three per side, with a raised-cosine attack and
// an exponential release.
function sawNote(L, R, note, rng) {
  const f = mtof(note.midi);
  const i0 = Math.round(note.start * SR);
  const iRel = Math.min(total, Math.round(note.end * SR));
  const iEnd = Math.min(total, iRel + Math.round(PAD_RELEASE * SR));
  const att = Math.max(1, Math.round(note.attack * SR));
  const ph = PAD_DETUNE.map(() => rng());
  const inc = PAD_DETUNE.map((cents) => (f * 2 ** (cents / 1200)) / SR);
  const relDecay = Math.exp(-1 / (0.22 * SR));
  const g = (note.gain * PAD_LEVEL) / 3;
  let level = 0;
  let rel = 1;
  for (let i = i0; i < iEnd; i++) {
    if (i < iRel) {
      const k = i - i0;
      level = k < att ? 0.5 - 0.5 * Math.cos((Math.PI * k) / att) : 1;
    } else {
      rel *= relDecay;
    }
    const env = i < iRel ? level : (level * rel * (iEnd - i)) / (iEnd - iRel);
    let l = 0;
    let r = 0;
    for (let v = 0; v < 6; v++) {
      const p = ph[v] + inc[v];
      ph[v] = p >= 1 ? p - 1 : p;
      if (v < 3) {
        l += blepSaw(ph[v], inc[v]);
      } else {
        r += blepSaw(ph[v], inc[v]);
      }
    }
    L[i] += l * env * g;
    R[i] += r * env * g;
  }
}

function blepSaw(p, dt) {
  if (p < dt) {
    const x = p / dt;
    return 2 * p - 1 - (x + x - x * x - 1);
  }
  if (p > 1 - dt) {
    const x = (p - 1) / dt;
    return 2 * p - 1 - (x * x + x + x + 1);
  }
  return 2 * p - 1;
}

// Per-sample automation from a per-bar value, smoothed by a one-pole filter.
function barCurve(s, tau, valueAt) {
  const out = new Float32Array(total);
  const k = 1 - Math.exp(-1 / (tau * SR));
  let bi = 0;
  let y = valueAt(s.bars[0], 0);
  for (let i = 0; i < total; i++) {
    while (bi + 1 < s.bars.length && i >= s.bars[bi + 1].i0) {
      bi++;
    }
    y += (valueAt(s.bars[bi], i / SR) - y) * k;
    out[i] = y;
  }
  return out;
}

// One phase-continuous sine plus a little 2nd and 3rd harmonic for small
// speakers. Held in C1 and C9, an eighth-note pulse in between, ducked by the
// C8 kick, silent on the last beat of C8.
function renderBass(s, bus, duck) {
  const eighth = s.beat / 2;
  const kEnv = 1 - Math.exp(-1 / (0.007 * SR));
  const kGain = 1 - Math.exp(-1 / (0.08 * SR));
  const kGlide = 1 - Math.exp(-1 / (0.025 * SR));
  const roots = s.bars.map((b) => mtof(CHORDS[b.chord].root));
  let freq = roots[0];
  let phase = 0;
  let env = 1;
  let gain = 0;
  let bi = 0;
  for (let i = 0; i < total; i++) {
    while (bi + 1 < s.bars.length && i >= s.bars[bi + 1].i0) {
      bi++;
    }
    const b = s.bars[bi];
    const sec = SECTIONS[b.section];
    const t = i / SR;
    freq += (roots[bi] - freq) * kGlide;
    phase = (phase + freq / SR) % 1;
    const since = Math.max(0, t - b.t) % eighth;
    const pulse = 1 - sec.pulse * (1 - Math.exp(-since / 0.11));
    const target = t >= s.stop && t < s.time.resolve ? 0 : pulse;
    env += (target - env) * kEnv;
    gain += (sec.bass * Math.min(1, t / 1.5) - gain) * kGain;
    const x = TAU * phase;
    const y = Math.sin(x) + 0.16 * Math.sin(2 * x) + 0.05 * Math.sin(3 * x);
    const out = y * env * gain * BASS_LEVEL * (1 - 0.6 * duck[i]);
    bus.L[i] += out;
    bus.R[i] += out;
  }
}

function renderPluck(s, bus) {
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  const M = new Float32Array(total);
  const rng = rngFor("pluck");
  for (const b of s.bars) {
    const { pluck, decay } = SECTIONS[b.section];
    for (const [t, midi, vel, pan] of pluckNotes(s, b, rng)) {
      pluckNote([L, R, M], t, midi, vel * pluck, pan, decay);
    }
  }
  for (const x of [L, R, M]) {
    svf(x, "high", 180, Math.SQRT1_2);
    svf(x, "low", 3200, Math.SQRT1_2);
  }
  const echo = pingPong(M, s.beat * 0.75, 0.45);
  for (let i = 0; i < total; i++) {
    bus.L[i] += L[i] + ECHO_LEVEL * echo.L[i];
    bus.R[i] += R[i] + ECHO_LEVEL * echo.R[i];
    bus.sendL[i] += 0.28 * L[i] + 0.2 * echo.L[i];
    bus.sendR[i] += 0.28 * R[i] + 0.2 * echo.R[i];
  }
}

// [time, midi, velocity, pan] for one bar. A pattern longer than the bar is
// cut; a 5- or 6-beat bar repeats its start. C9 gets one upward strum.
function pluckNotes(s, b, rng) {
  const notes = [];
  if (!SECTIONS[b.section].pluck || (b.section === "resolve" && b.i > 0)) {
    return notes;
  }
  if (b.section === "resolve") {
    for (const [k, midi] of CHORDS.Cadd9.arp.entries()) {
      notes.push([b.t + 0.06 * k, midi, 0.62 + 0.08 * k, -0.3 + 0.15 * k]);
    }
    return notes;
  }
  const tones = CHORDS[b.chord].arp;
  const patterns = ARPS[b.section];
  for (const [start, idx, vel] of patterns[b.i % patterns.length]) {
    for (let step = start; step < 4 * b.beats; step += 16) {
      const t = b.t + (step * s.beat) / 4;
      if (t < s.stop || t >= s.time.resolve) {
        const v = vel * (0.94 + 0.12 * rng());
        notes.push([t, tones[idx], v, -0.25 + idx / 6]);
      }
    }
  }
  return notes;
}

// Band-limited triangle (odd harmonics 1, 3, 5, 7 at 1/n^2) with a short
// octave "tine" on the attack and an exponential decay.
function pluckNote([L, R, M], t, midi, vel, pan, decay) {
  const i0 = Math.round(t * SR);
  const len = Math.min(total - i0, Math.round((decay * 5 + 0.05) * SR));
  const dt = mtof(midi) / SR;
  const att = Math.round(0.003 * SR);
  const fall = Math.exp(-1 / (decay * SR));
  const tineFall = Math.exp(-1 / (0.05 * SR));
  const [gl, gr] = panGains(pan);
  let p = 0;
  let amp = PLUCK_LEVEL * vel;
  let tine = 0.2;
  for (let j = 0; j < len; j++) {
    p = (p + dt) % 1;
    const s1 = Math.sin(TAU * p);
    const c2 = 2 * (1 - 2 * s1 * s1);
    const s3 = c2 * s1 + s1;
    const s5 = c2 * s3 - s1;
    const s7 = c2 * s5 - s3;
    const tri = 0.81 * (s1 - s3 / 9 + s5 / 25 - s7 / 49);
    const env = amp * Math.min(1, j / att, (len - j) / 256);
    const y = (tri + tine * Math.sin(2 * TAU * p)) * env;
    amp *= fall;
    tine *= tineFall;
    L[i0 + j] += y * gl;
    R[i0 + j] += y * gr;
    M[i0 + j] += y;
  }
}

// Mono in; echoes alternate left and right, each one darker than the last.
function pingPong(input, delay, feedback) {
  const d = Math.round(delay * SR);
  const bl = new Float32Array(d);
  const br = new Float32Array(d);
  const L = new Float32Array(total);
  const R = new Float32Array(total);
  const aLp = 1 - Math.exp((-TAU * 2600) / SR);
  const aHp = 1 - Math.exp((-TAU * 350) / SR);
  let lp = 0;
  let low = 0;
  for (let i = 0; i < total; i++) {
    const k = i % d;
    L[i] = bl[k];
    R[i] = br[k];
    lp += (input[i] + R[i] * feedback - lp) * aLp;
    low += (lp - low) * aHp;
    bl[k] = lp - low;
    br[k] = L[i] * feedback;
  }
  return { L, R };
}

function renderDrums(s, bus, duck) {
  const rng = rngFor("drums");
  for (const b of s.bars) {
    for (const [kind, step, vel] of DRUMS[b.section]?.(s, b) ?? []) {
      const t = b.t + (step * s.beat) / 4;
      const v = vel * (0.92 + 0.16 * rng());
      if (kind === "clap") {
        clap(bus, t, v, rng);
      } else if (kind === "hat" || kind === "openHat") {
        hat(bus, t, v, kind === "openHat", rng);
      } else if (kind === "kick") {
        drop(bus, t, KICK, v, duck);
      } else {
        drop(bus, t, SOFT_KICK, v, null);
      }
    }
  }
}

// [kind, sixteenth in the bar, velocity] for one bar.
// C3-C7: eighth hats that grow through the section, sixteenth hats from C5,
// a light kick on 1 and 3 from C4 (only beat 1 in the riser bar).
function exampleHits(s, b) {
  const hits = [];
  const riserBar = b.n === s.starts.full - 1;
  const grow = 0.75 + (0.25 * b.i) / Math.max(1, b.len - 1);
  for (let k = 0; k < 4 * b.beats; k++) {
    if (b.n >= s.cues.hats16) {
      hits.push(["hat", k, HAT_16[k % 4] * grow]);
    } else if (k % 2 === 0) {
      hits.push(["hat", k, (k % 4 === 2 ? 1 : 0.5) * grow]);
    }
    if (b.n >= s.cues.kick && k % 8 === 0 && (k === 0 || !riserBar)) {
      hits.push(["softKick", k, k % 16 === 0 ? 1 : 0.85]);
    }
  }
  return hits;
}

// C8: four-on-the-floor, clap on 2 and 4, sixteenth hats with open offbeats;
// the last beat of C8 rests.
function fullHits(_s, b) {
  const hits = [];
  const steps = 4 * b.beats - (b.i === b.len - 1 ? 4 : 0);
  for (let k = 0; k < steps; k++) {
    if (k % 4 === 0) {
      hits.push(["kick", k, 1]);
    }
    if (k % 8 === 4) {
      hits.push(["clap", k, 1]);
    }
    hits.push(k % 4 === 2 ? ["openHat", k, 0.7] : ["hat", k, HAT_16[k % 4]]);
  }
  return hits;
}

// Sine with an exponential pitch drop and decay, slightly saturated (kicks
// and the low boom of the impacts). The C8 kick also writes the duck envelope.
function drop(bus, t, v, vel, duck) {
  const i0 = Math.round(t * SR);
  const len = Math.min(total - i0, Math.round(4 * v.decay * SR));
  let ph = 0;
  for (let j = 0; j < len; j++) {
    const tt = j / SR;
    ph += (v.f1 + (v.f0 - v.f1) * Math.exp(-tt / v.pitch)) / SR;
    const shape = Math.min(1, tt / 0.0015, (len - j) / 512);
    const env = v.gain * vel * Math.exp(-tt / v.decay) * shape;
    const y = Math.tanh(1.5 * Math.sin(TAU * ph)) * env;
    bus.L[i0 + j] += y;
    bus.R[i0 + j] += y;
    if (duck && tt < 0.4) {
      const d = Math.exp(-tt / 0.1) * Math.min(1, tt / 0.003);
      duck[i0 + j] = Math.max(duck[i0 + j], d);
    }
  }
}

// Three short noise bursts and a tail, band-passed around 1.1 kHz.
function clap(bus, t, vel, rng) {
  const burst = (tt, at, decay) =>
    tt < at ? 0 : Math.exp(-(tt - at) / decay) * Math.min(1, (tt - at) / 5e-4);
  const env = (tt) =>
    [0, 0.011, 0.022].reduce((e, at) => e + burst(tt, at, 0.0045), 0) +
    0.55 * burst(tt, 0.022, 0.085);
  const mixing = [0.2 * vel, 0, 0.22];
  noiseHit(bus, t, [0.4, env, "band 1100 .8, high 400"], mixing, rng);
}

// High-passed noise; the open hat rings longer and sits a little left.
function hat(bus, t, vel, open, rng) {
  const decay = open ? 0.09 : 0.02;
  const env = (tt) => Math.exp(-tt / decay) * Math.min(1, tt / 8e-4);
  const sound = [open ? 0.4 : 0.12, env, "high 7000, high 7000"];
  const mixing = open ? [0.05 * vel, -0.2, 0.06] : [0.085 * vel, 0.2, 0.06];
  noiseHit(bus, t, sound, mixing, rng);
}

// filters: "mode cutoff [q], ..." for svf, q defaulting to 0.707.
function noiseHit(bus, t, [seconds, env, filters], mixing, rng) {
  const x = new Float32Array(Math.round(seconds * SR));
  for (let j = 0; j < x.length; j++) {
    x[j] = (2 * rng() - 1) * env(j / SR);
  }
  for (const filter of filters.split(", ")) {
    const [mode, cutoff, q = Math.SQRT1_2] = filter.split(" ");
    svf(x, mode, Number(cutoff), Number(q));
  }
  taper(x, 256);
  mixInto(bus, x, t, mixing);
}

// Noise swells into C2, C8 and C9, and a soft impact on the C8 and C9
// downbeats (a low boom plus a low-passed noise thump).
function renderFx(s, bus) {
  const rng = rngFor("fx");
  const { lift, full, resolve } = s.time;
  riser(bus, [lift - 2 * s.beat, lift], [400, 2600, 0.05], rng);
  riser(bus, [s.bars[s.starts.full - 1].t, full], [300, 6500, 0.14], rng);
  riser(bus, [resolve - s.beat, resolve], [600, 4200, 0.06], rng);
  for (const t of [full, resolve]) {
    const level = t === full ? 1 : 0.5;
    drop(bus, t, BOOM, level, null);
    const env = (tt) => Math.exp(-tt / 0.16) * Math.min(1, tt / 0.002);
    noiseHit(bus, t, [1, env, "low 700"], [0.5 * level, 0, 0.6], rng);
  }
}

// White noise through a band-pass whose centre sweeps up exponentially,
// louder towards the end; independent noise left and right.
function riser(bus, [t0, t1], [f0, f1, gain], rng) {
  const i0 = Math.max(0, Math.round(t0 * SR));
  const len = Math.round(t1 * SR) - i0;
  const fc = new Float32Array(len).map((_, j) => f0 * (f1 / f0) ** (j / len));
  for (const side of ["L", "R"]) {
    const x = fc.map((_, j) => (2 * rng() - 1) * (j / len) ** 2 * gain);
    svf(x, "band", fc, 1.3);
    taper(x, 512);
    for (let j = 0; j < len; j++) {
      bus[side][i0 + j] += x[j];
      bus[`send${side}`][i0 + j] += 0.5 * x[j];
    }
  }
}

// Freeverb (8 damped combs and 4 allpasses per side, the right side 23
// samples longer) on the mono sum of the sends, with 22 ms pre-delay, a
// 250 Hz high-pass in and a 5.5 kHz low-pass out.
function reverb(bus) {
  const pre = Math.round(0.022 * SR);
  const input = new Float32Array(total);
  for (let i = pre; i < total; i++) {
    input[i] = (bus.sendL[i - pre] + bus.sendR[i - pre]) * 0.5;
  }
  svf(input, "high", 250, Math.SQRT1_2);
  const wet = { L: freeverb(input, 0), R: freeverb(input, 23) };
  for (const x of [wet.L, wet.R]) {
    svf(x, "low", 5500, Math.SQRT1_2);
  }
  scale([wet.L, wet.R], REVERB_RETURN);
  return wet;
}

function freeverb(input, extra) {
  const out = new Float32Array(total);
  const feedback = 0.8 * 0.28 + 0.7;
  const damp = 0.35 * 0.4;
  const sizes = [...COMBS, ...ALLPASSES].map((n) => n + extra);
  const lines = sizes.map((n) => new Float64Array(n));
  const at = new Int32Array(lines.length);
  const store = new Float64Array(COMBS.length);
  for (let i = 0; i < total; i++) {
    let acc = 0;
    for (let c = 0; c < lines.length; c++) {
      const buf = lines[c];
      const k = at[c];
      const y = buf[k];
      at[c] = k + 1 === buf.length ? 0 : k + 1;
      if (c < COMBS.length) {
        store[c] = y * (1 - damp) + store[c] * damp;
        buf[k] = input[i] * 0.015 + store[c] * feedback;
        acc += y;
      } else {
        buf[k] = acc + y * 0.5;
        acc = y - acc;
      }
    }
    out[i] = acc * 3;
  }
  return out;
}

// 30 Hz high-pass (4th-order Butterworth), a 2.5 dB dip at 2.5 kHz to leave
// room for the voice, compression, the fades, peak normalization.
function masterBus({ L, R }, s) {
  for (const x of [L, R]) {
    svf(x, "high", 30, 0.5412);
    svf(x, "high", 30, 1.3066);
    svf(x, "bell", 2500, 0.8, -2.5);
  }
  scale([L, R], 0.5 / peakOf(L, R));
  const reduction = compress(L, R);
  fades(L, R, s);
  scale([L, R], 10 ** (PEAK_DBFS / 20) / peakOf(L, R));
  if (!(L.every(Number.isFinite) && R.every(Number.isFinite))) {
    throw new Error("the mix contains NaN or infinite samples");
  }
  return reduction;
}

// Stereo-linked RMS compressor: 2:1 above -18 dBFS with a 6 dB soft knee
// (the mix peaks at -6 dBFS here), 15 ms attack, 250 ms release. Returns the
// deepest gain reduction in dB.
function compress(L, R) {
  const knee = 6;
  const aDet = Math.exp(-1 / (0.02 * SR));
  const aAtt = Math.exp(-1 / (0.015 * SR));
  const aRel = Math.exp(-1 / (0.25 * SR));
  let ms = 0;
  let gr = 0;
  let most = 0;
  for (let i = 0; i < L.length; i++) {
    ms = aDet * ms + (1 - aDet) * 0.5 * (L[i] * L[i] + R[i] * R[i]);
    const over = 10 * Math.log10(ms + 1e-12) + 18;
    let target = 0;
    if (over >= knee / 2) {
      target = -0.5 * over;
    } else if (over > -knee / 2) {
      target = (-0.5 * (over + knee / 2) ** 2) / (2 * knee);
    }
    const a = target < gr ? aAtt : aRel;
    gr = a * gr + (1 - a) * target;
    most = Math.min(most, gr);
    L[i] *= 10 ** (gr / 20);
    R[i] *= 10 ** (gr / 20);
  }
  return -most;
}

// 0.5 s fade-in. In C9 the last chord holds for a moment, then fades along
// (1 - x)^2, which reaches exactly zero on the last sample.
function fades(L, R, s) {
  const nIn = Math.round(FADE_IN * SR);
  for (let i = 0; i < nIn; i++) {
    const g = Math.sin((Math.PI / 2) * (i / nIn)) ** 2;
    L[i] *= g;
    R[i] *= g;
  }
  const t9 = s.time.resolve;
  const i0 = Math.round((t9 + Math.min(1, 0.18 * (duration - t9))) * SR);
  for (let i = i0; i < total; i++) {
    const g = (1 - (i - i0) / (total - 1 - i0)) ** 2;
    L[i] *= g;
    R[i] *= g;
  }
}

// 16-bit PCM, little-endian like every platform Node runs this on.
function writeWav(file, { L, R }) {
  const pcm = new Int16Array(total * 2);
  const to16 = (v) =>
    Math.max(-32_768, Math.min(32_767, Math.round(v * 32_767)));
  let peak = 0;
  for (let i = 0; i < total; i++) {
    pcm[2 * i] = to16(L[i]);
    pcm[2 * i + 1] = to16(R[i]);
    peak = Math.max(peak, Math.abs(pcm[2 * i]), Math.abs(pcm[2 * i + 1]));
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(36 + pcm.byteLength, 4);
  head.write("WAVEfmt ", 8, "ascii");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(2, 22);
  head.writeUInt32LE(SR, 24);
  head.writeUInt32LE(SR * 4, 28);
  head.writeUInt16LE(4, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36, "ascii");
  head.writeUInt32LE(pcm.byteLength, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([head, Buffer.from(pcm.buffer)]));
  return 20 * Math.log10(peak / 32_768);
}

function report(s, bus, reduction, peak) {
  const ms = (v) => `${v < 0 ? "-" : "+"}${Math.abs(v * 1000).toFixed(1)} ms`;
  const fit = opts.bpm ? "set by --bpm" : `best fit in ${BPM_MIN}-${BPM_MAX}`;
  const rows = sectionSpans(s).map(([name, from, to]) => {
    const bars = s.bars.filter((b) => b.section === name);
    const chords = bars.map(
      (b) => b.chord + (b.beats === 4 ? "" : `(${b.beats})`)
    );
    const rms = rmsDb(bus.L, bus.R, from, to).toFixed(1);
    return `${name.padEnd(8)} ${SECTIONS[name].scenes.padEnd(6)} ${s.time[name].toFixed(3).padStart(9)} ${String(s.starts[name]).padStart(4)} ${String(bars.length).padStart(5)} ${rms.padStart(11)}  ${chords.join(" ")}`;
  });
  const errors = ALIGNED.map((id, k) => `${id} ${ms(s.errors[k])}`);
  const worst = ms(Math.max(...s.errors.map(Math.abs))).slice(1);
  const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
  const lines = [
    `tempo ${s.bpm.toFixed(1)} BPM (${fit}), beat ${s.beat.toFixed(4)} s, first downbeat at ${s.offset.toFixed(4)} s`,
    "section  scenes  start (s)  bar  bars  rms (dBFS)  chords (beats if not 4)",
    ...rows,
    `alignment (section downbeat - scene start): ${errors.join(", ")}; worst ${worst}`,
    `cues: hats from bar ${s.starts.example}, light kick from bar ${s.cues.kick} (C3), sixteenth hats from bar ${s.cues.hats16} (U3), riser in bar ${s.starts.full - 1}`,
    `peak ${peak.toFixed(2)} dBFS, bus compression up to ${reduction.toFixed(1)} dB`,
    `wrote ${path.relative(process.cwd(), opts.out)}: ${duration} s, ${total} samples, 44.1 kHz 16-bit stereo, in ${seconds} s`,
  ];
  console.log(lines.join("\n"));
}

function sectionSpans(s) {
  const names = Object.keys(SECTIONS);
  return names.map((name, k) => {
    const from = k === 0 ? 0 : Math.round(s.time[name] * SR);
    const next = names[k + 1];
    const to = next ? Math.round(s.time[next] * SR) : total;
    return [name, from, to];
  });
}

function rmsDb(L, R, from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) {
    sum += L[i] * L[i] + R[i] * R[i];
  }
  return 10 * Math.log10(sum / (2 * Math.max(1, to - from)) + 1e-20);
}

function mixInto(bus, x, t, [gain, pan, send]) {
  const i0 = Math.round(t * SR);
  const [gl, gr] = panGains(pan).map((g) => g * gain);
  for (let j = 0; j < Math.min(x.length, total - i0); j++) {
    bus.L[i0 + j] += x[j] * gl;
    bus.R[i0 + j] += x[j] * gr;
    bus.sendL[i0 + j] += x[j] * gl * send;
    bus.sendR[i0 + j] += x[j] * gr * send;
  }
}

// Constant-power pan, -1 left to 1 right, unity gain on both sides at 0.
function panGains(pan) {
  const a = ((pan + 1) * Math.PI) / 4;
  return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2];
}

function taper(x, n) {
  for (let j = Math.max(0, x.length - n); j < x.length; j++) {
    x[j] *= (x.length - j) / n;
  }
}

// State-variable filter (Simper/Cytomic, trapezoidal), in place. mode is low,
// high, band (unity peak) or bell (gainDb at the cutoff). cutoff is a number or
// a per-sample array; coefficients follow it every 16 samples. (A constant
// cutoff becomes a one-element array: mixing numbers and arrays in the loop
// makes V8 run it three times slower.)
function svf(x, mode, cutoff, q, gainDb = 0) {
  const A = 10 ** (gainDb / 40);
  const k = mode === "bell" ? 1 / (q * A) : 1 / q;
  const mixes = {
    low: [0, 0, 1],
    high: [1, -k, -1],
    band: [0, k, 0],
    bell: [1, k * (A * A - 1), 0],
  };
  const [m0, m1, m2] = mixes[mode];
  const fcs = typeof cutoff === "number" ? Float32Array.of(cutoff) : cutoff;
  const every = fcs.length > 1 ? 16 : x.length;
  let ic1 = 0;
  let ic2 = 0;
  let a1 = 0;
  let a2 = 0;
  let a3 = 0;
  for (let i = 0; i < x.length; i++) {
    if (i % every === 0) {
      const g = Math.tan((Math.PI * fcs[fcs.length > 1 ? i : 0]) / SR);
      a1 = 1 / (1 + g * (g + k));
      a2 = g * a1;
      a3 = g * a2;
    }
    const v0 = x[i];
    const v3 = v0 - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    x[i] = m0 * v0 + m1 * v1 + m2 * v2;
  }
}

function peakOf(L, R) {
  let p = 1e-12;
  for (let i = 0; i < L.length; i++) {
    p = Math.max(p, Math.abs(L[i]), Math.abs(R[i]));
  }
  return p;
}

function scale(arrays, g) {
  for (const x of arrays) {
    for (let i = 0; i < x.length; i++) {
      x[i] *= g;
    }
  }
}

function mtof(m) {
  return 440 * 2 ** ((m - 69) / 12);
}

function arp(spec) {
  return spec.split(",").map((step) => step.trim().split(" ").map(Number));
}

// Park-Miller (Lehmer) generator, seeded from SEED and a label so that each
// part has its own noise. Exact in doubles: 48271 * (2^31 - 1) < 2^53.
function rngFor(label) {
  const modulus = 2_147_483_647;
  let x =
    [...label].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % modulus, SEED) ||
    1;
  return () => {
    x = (x * 48_271) % modulus;
    return x / modulus;
  };
}

function section(scenes, pad, cutoff, bass, pulse, pluck, decay, loop) {
  const chords = loop.split(" ");
  return { scenes, pad, cutoff, bass, pulse, pluck, decay, chords };
}
