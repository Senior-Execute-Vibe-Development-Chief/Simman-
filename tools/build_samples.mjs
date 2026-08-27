// Build the Lab's RECORDED INSTRUMENT bank from two CC0 sample libraries.
//
//   node tools/build_samples.mjs            # sparse-fetch + decode + encode + emit
//   node tools/build_samples.mjs --emit     # no network: re-encode from what is
//                                           #   already checked out
//   node tools/build_samples.mjs --dry      # report the plan and the coverage only
//
// WHY THESE TWO LIBRARIES. Both are Versilian's and both are CC0 — public
// domain, no attribution required, redistribution explicitly permitted — which
// is what lets the bank be committed to this repo and inlined into a
// single-file artifact at all. Philharmonia's set is free to use but restricts
// redistribution; Wikimedia Commons is per-file CC-BY-SA and would need a
// credit line per sample (which is exactly why build_ipa_audio.mjs carries a
// SOURCES.tsv and this does not).
//
//   VCSL       github.com/sgossner/VCSL        4231 samples, 103 instruments
//   VSCO 2 CE  github.com/sgossner/VSCO-2-CE   orchestral
//
// VCSL is organised by HORNBOSTEL-SACHS — aerophones, chordophones,
// idiophones, membranophones, split by how the thing is driven — which is the
// same taxonomy `musicInstruments.js` uses to decide what a body IS. That is
// why the mapping below is nearly one-to-one and needs no judgement calls: the
// engine's `lamella` family is a plucked clamped tongue, and VCSL's plucked
// idiophones are five real mbiras.
//
// WHAT IS MAPPED IS THE FAMILY, NOT THE INSTRUMENT. There is no "oud" sample
// here and there should not be: a people in this world invents its bodies from
// the materials it has, and most of what it invents has no name and no
// recording. So each FAMILY gets one real recording of a real instrument in
// that family, and everything the engine derives on top — material, frame,
// size, tuning — still applies. That is also the honest limit of this bank,
// and it is worth stating plainly: a bronze bar set and a wooden one now both
// start from a recorded balafon. The synthesis path stays switchable precisely
// so that cost can be heard rather than argued about.

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createContext, runInContext } from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "assets", "instr-audio");
const MANIFEST = join(ROOT, "src", "sim", "musicSampleManifest.js");
const DRY = process.argv.includes("--dry");
const EMIT_ONLY = process.argv.includes("--emit");

const REPOS = {
  vcsl: { dir: "/home/user/sgossner/vcsl", url: "https://github.com/sgossner/vcsl" },
  vsco: { dir: "/home/user/sgossner/vsco2", url: "https://github.com/sgossner/VSCO-2-CE" },
};

// ── the mapping: one real body per engine family ─────────────────────────
//
// `sub` is the articulation folder — a struck body wants its ordinary stroke
// and a driven one wants its plain sustain, because what the engine asks for
// is a NOTE, and the vibrato, tremolo and staccato variants are performances
// of one. `kind` mirrors the family's own kind so the encoder knows whether it
// has to leave a loopable steady state behind.
const MAP = {
  luteNeck:    { repo: "vcsl", dir: "Chordophones/Composite Chordophones/Strumstick/Finger",
                 kind: "pluck",   src: "Strumstick", why: "a fretted, necked, plucked string — the family's own definition" },
  lyre:        { repo: "vcsl", dir: "Chordophones/Zithers/Dan Tranh/Normal",
                 kind: "pluck",   src: "Dan Tranh", why: "open strings, one per pitch, plucked" },
  bowed:       { repo: "vsco", dir: "Strings/Solo Violin/Arco Vib",
                 kind: "sustain", src: "Solo Violin", why: "a bow keeping the mode driven" },
  fluteOpen:   { repo: "vsco", dir: "Woodwinds/Flute/susNV",
                 kind: "sustain", src: "Flute", why: "open tube, edge-blown, full harmonic series" },
  pipeStopped: { repo: "vcsl", dir: "Aerophones/Edge-blown Aerophones/Ocarina, Typical/Sustains/Sus",
                 kind: "sustain", src: "Ocarina", why: "a stopped vessel — odd-harmonic, hollow" },
  reedPipe:    { repo: "vsco", dir: "Woodwinds/Oboe/Sus",
                 kind: "sustain", src: "Oboe", why: "a conical reed, full series, buzzing" },
  horn:        { repo: "vsco", dir: "Brass/F Horn/sus",
                 kind: "sustain", src: "F Horn", why: "lip-driven, sounds its own harmonic series" },
  barSet:      { repo: "vcsl", dir: "Idiophones/Struck Idiophones/Balafon/Traditional Mallet",
                 kind: "struck",  src: "Balafon", why: "tuned bars over gourd resonators" },
  lamella:     { repo: "vcsl", dir: "Idiophones/Plucked Idiophones/Mbira dzaVadzimu Nyamaropa, Zimbabwe, Low B",
                 kind: "pluck",   src: "Mbira dzaVadzimu", why: "a plucked clamped tongue — the family, exactly" },
  bell:        { repo: "vcsl", dir: "Idiophones/Struck Idiophones/Tubular Bells 1",
                 kind: "struck",  src: "Tubular Bells", why: "a cast profile with tuned partials" },
  gong:        { repo: "vcsl", dir: "Idiophones/Struck Idiophones/Gong 1",
                 kind: "struck",  src: "Gong", why: "a flat plate, dense inharmonic modes", unpitched: true },
  drum:        { repo: "vcsl", dir: "Membranophones/Struck Membranophones/Darbuka",
                 kind: "struck",  src: "Darbuka", why: "a single-headed struck membrane", unpitched: true },
  frameDrum:   { repo: "vcsl", dir: "Membranophones/Struck Membranophones/Frame Drum",
                 kind: "struck",  src: "Frame Drum", why: "a hand-struck frame membrane", unpitched: true },
  clappers:    { repo: "vcsl", dir: "Idiophones/Struck Idiophones/Claves",
                 kind: "struck",  src: "Claves", why: "two solid bodies struck together", unpitched: true },
  claps:       { repo: "vcsl", dir: "Idiophones/Struck Idiophones/Claps",
                 kind: "struck",  src: "Claps", why: "hands", unpitched: true },
};

// ── note names to hertz ──────────────────────────────────────────────────
// The libraries label at standard pitch, so this is only ever used to work out
// HOW FAR a sample has to be shifted to reach the pitch a culture's scale
// asked for — never to impose twelve-tone anything on the music.
const PC = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6,
  Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const NOTE_RE = /(?:^|[_\-. ])([A-G][#b]?)(-?\d)(?![0-9])/;
function hzOf(name) {
  const m = NOTE_RE.exec(name);
  if (!m) return null;
  const pc = PC[m[1]];
  if (pc == null) return null;
  return 440 * Math.pow(2, (pc - 9) / 12 + (parseInt(m[2], 10) - 4));
}
// loudest-first, so a family with several dynamics per pitch keeps the one
// with the most spectrum in it and the encoder is not choosing by filename
const DYN_RANK = ["fff", "ff", "f", "vl3", "v3", "mf", "vl2", "v2", "mp", "vl1", "v1", "p", "pp", "ppp"];
function dynOf(name) {
  const low = name.toLowerCase();
  for (let i = 0; i < DYN_RANK.length; i++) {
    if (new RegExp("[_\\-.]" + DYN_RANK[i] + "(?:[_\\-.]|$)", "i").test(low)) return i;
  }
  return DYN_RANK.length;
}

// ── WAV ──────────────────────────────────────────────────────────────────
// Written out rather than depended on: these are plain RIFF/PCM files at 16 or
// 24 bits, and a parser for exactly that is thirty lines.
function decodeWav(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let p = 12, fmt = null, data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString("ascii", p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const body = p + 8;
    if (id === "fmt ") {
      fmt = { format: buf.readUInt16LE(body), ch: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === "data") {
      data = buf.subarray(body, Math.min(buf.length, body + size));
    }
    p = body + size + (size & 1);
  }
  if (!fmt || !data) return null;
  if (fmt.format !== 1 && fmt.format !== 0xFFFE && fmt.format !== 3) return null;
  const bytes = fmt.bits >> 3;
  const frames = Math.floor(data.length / (bytes * fmt.ch));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < fmt.ch; c++) {
      const o = (i * fmt.ch + c) * bytes;
      let v;
      if (fmt.format === 3 && fmt.bits === 32) v = data.readFloatLE(o);
      else if (fmt.bits === 16) v = data.readInt16LE(o) / 32768;
      else if (fmt.bits === 24) v = ((data[o] | (data[o + 1] << 8) | (data[o + 2] << 24 >> 8))) / 8388608;
      else if (fmt.bits === 32) v = data.readInt32LE(o) / 2147483648;
      else if (fmt.bits === 8) v = (data[o] - 128) / 128;
      else v = 0;
      acc += v;
    }
    out[i] = acc / fmt.ch;                       // to mono: the bank is placed by the engine
  }
  return { pcm: out, rate: fmt.rate };
}

/** Trim the silent lead-in, cap the length, and fade the tail so a cut does not click. */
function shape(pcm, rate, kind) {
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak < 1e-5) return null;
  // the onset is where it first clears sixty decibels under its own peak —
  // measured, not a fixed offset, because these were edited by different hands
  const gate = peak * 0.001;
  let s = 0;
  while (s < pcm.length && Math.abs(pcm[s]) < gate) s++;
  s = Math.max(0, s - Math.round(rate * 0.004));           // keep the attack itself
  // A DRIVEN BODY HAS TO LOOP. The engine holds drones for ten seconds and no
  // sane bank ships ten-second samples, so a sustain keeps enough steady state
  // to loop inside; a struck or plucked one is its own whole decay.
  const capSecs = kind === "sustain" ? 2.6 : 3.2;
  let n = Math.min(pcm.length - s, Math.round(rate * capSecs));
  const cut = pcm.subarray(s, s + n).slice();
  const fade = Math.min(Math.round(rate * 0.05), cut.length >> 2);
  for (let i = 0; i < fade; i++) cut[cut.length - 1 - i] *= i / fade;
  let p2 = 0;
  for (let i = 0; i < cut.length; i++) p2 = Math.max(p2, Math.abs(cut[i]));
  const g = p2 > 0 ? 0.97 / p2 : 1;
  for (let i = 0; i < cut.length; i++) cut[i] *= g;
  return { pcm: cut, rate, peak };
}

// lamejs ships its modules expecting browser globals (MPEGMode, Lame,
// BitStream are referenced across files without importing them), so `import
// "lamejs"` throws on the first encoder. Its own prebuilt bundle does not have
// that problem — run it once in a VM context with a window-ish global and take
// the encoder out.
let LAME = null;
function lame() {
  if (LAME) return LAME;
  const path = join(ROOT, "node_modules", "lamejs", "lame.min.js");
  if (!existsSync(path)) throw new Error("lamejs missing — run `npm install` first");
  const ctx = { console, Math, Date, Object, Array, String, Number, Error, TypeError,
    Int8Array, Int16Array, Int32Array, Uint8Array, Uint32Array, Float32Array, Float64Array,
    isNaN, parseInt, parseFloat };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  createContext(ctx);
  runInContext(readFileSync(path, "utf8"), ctx);
  LAME = ctx.lamejs;
  return LAME;
}

async function encodeMp3(pcm, rate, kbps) {
  const enc = new (lame().Mp3Encoder)(1, rate, kbps);
  const i16 = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]));
    i16[i] = v < 0 ? v * 32768 : v * 32767;
  }
  const out = [];
  const BLOCK = 1152;
  for (let i = 0; i < i16.length; i += BLOCK) {
    const chunk = i16.subarray(i, Math.min(i + BLOCK, i16.length));
    const b = enc.encodeBuffer(chunk);
    if (b.length) out.push(Buffer.from(b));
  }
  const last = enc.flush();
  if (last.length) out.push(Buffer.from(last));
  return Buffer.concat(out);
}

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 });
}

function ensureRepo(key) {
  const r = REPOS[key];
  if (existsSync(join(r.dir, ".git"))) return;
  console.log(`  cloning ${r.url} (blobless) …`);
  sh("git", ["clone", "--depth", "1", "--filter=blob:none", "--no-checkout", r.url, r.dir], ROOT);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const fams = Object.keys(MAP);
  if (!EMIT_ONLY && !DRY) {
    // fetch every mapped folder in ONE sparse set per repo, so git resolves the
    // blobs in a single pass instead of once per family
    for (const key of Object.keys(REPOS)) {
      const dirs = fams.filter(f => MAP[f].repo === key).map(f => MAP[f].dir + "/*");
      if (!dirs.length) continue;
      ensureRepo(key);
      console.log(`  ${key}: fetching ${dirs.length} folders …`);
      sh("git", ["sparse-checkout", "init", "--no-cone"], REPOS[key].dir);
      sh("git", ["sparse-checkout", "set", ...dirs], REPOS[key].dir);
      sh("git", ["checkout", "HEAD"], REPOS[key].dir);
    }
  }

  const bank = {};
  let files = 0, bytes = 0;
  for (const fam of fams) {
    const m = MAP[fam];
    const dir = join(REPOS[m.repo].dir, m.dir);
    if (!existsSync(dir)) { console.log(`  ${fam.padEnd(12)} MISSING ${m.dir}`); continue; }
    const all = readdirSync(dir).filter(f => /\.(wav|ogg|mp3)$/i.test(f));
    // one entry per pitch, the loudest take of it
    const best = new Map();
    for (const f of all) {
      if (!/\.wav$/i.test(f)) continue;
      const hz = m.unpitched ? 0 : hzOf(f);
      if (hz == null) continue;
      const key = m.unpitched ? f : Math.round(hz * 100);
      const prev = best.get(key);
      if (!prev || dynOf(f) < dynOf(prev.f)) best.set(key, { f, hz: hz || 0 });
    }
    const picks = [...best.values()].sort((a, b) => a.hz - b.hz)
      .filter((_, i, arr) => !m.unpitched || i < 6);          // percussion: a handful of strokes
    const entries = [];
    for (const p of picks) {
      const raw = decodeWav(readFileSync(join(dir, p.f)));
      if (!raw) { console.log(`    ! undecodable ${p.f}`); continue; }
      const sh2 = shape(raw.pcm, raw.rate, m.kind);
      if (!sh2) continue;
      const name = `${fam}_${m.unpitched ? entries.length : Math.round(p.hz)}.mp3`;
      if (!DRY) {
        const mp3 = await encodeMp3(sh2.pcm, sh2.rate, m.kind === "sustain" ? 72 : 64);
        writeFileSync(join(OUT_DIR, name), mp3);
        bytes += mp3.length;
      }
      files++;
      entries.push({ hz: +p.hz.toFixed(2), file: name, secs: +(sh2.pcm.length / sh2.rate).toFixed(3) });
    }
    bank[fam] = { src: m.src, why: m.why, kind: m.kind, unpitched: !!m.unpitched, samples: entries };
    console.log(`  ${fam.padEnd(12)} ${String(entries.length).padStart(3)} samples  ${m.src}`);
  }

  if (DRY) { console.log(`\n  dry run: ${files} samples would be written`); return; }

  const gen = Object.entries(bank).map(([fam, b]) =>
    `  ${fam}: { src: ${JSON.stringify(b.src)}, kind: ${JSON.stringify(b.kind)}, ` +
    `unpitched: ${b.unpitched}, samples: [\n` +
    b.samples.map(s => `    { hz: ${s.hz}, secs: ${s.secs}, file: ${JSON.stringify(s.file)} },`).join("\n") +
    `\n  ] },`).join("\n");
  writeFileSync(MANIFEST, `// GENERATED by tools/build_samples.mjs — do not edit by hand.
//
// One real recording per instrument FAMILY, from two CC0 (public domain)
// libraries by Versilian Studios: VCSL (github.com/sgossner/VCSL) and
// VSCO 2 Community Edition (github.com/sgossner/VSCO-2-CE). CC0 imposes no
// attribution requirement; the credit here is courtesy, and the licence is
// what makes redistributing these inside a single-file artifact lawful.
//
// \`hz\` is the pitch the sample was RECORDED at, so the player knows how far to
// shift it — never a pitch the music is snapped to. Everything the engine
// derives (material, frame, size, scale, tuning) still applies on top.

export const SAMPLE_BANK = {
${gen}
};
export const SAMPLE_CREDIT =
  "Recorded instruments: Versilian Community Sample Library and VSCO 2 " +
  "Community Edition, by Versilian Studios LLC — released CC0 (public domain).";
`);
  console.log(`\n  wrote ${files} samples, ${(bytes / 1048576).toFixed(2)} MB → assets/instr-audio/`);
  console.log(`  wrote ${MANIFEST.replace(ROOT + "/", "")}`);
}
main().catch(e => { console.error(e); process.exit(1); });
