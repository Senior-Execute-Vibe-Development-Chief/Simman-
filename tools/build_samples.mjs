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
const UA = "Simman-worldsim-asset-fetch/1.0 (open-source hobby worldsim; one-off asset build)";

const REPOS = {
  vcsl: { dir: "/home/user/sgossner/vcsl", url: "https://github.com/sgossner/vcsl" },
  vsco: { dir: "/home/user/sgossner/vsco2", url: "https://github.com/sgossner/VSCO-2-CE" },
  // CC0, and the only openly-licensed recording of a bowed skin-membrane
  // fiddle anyone has published: a cheap erhu, close-miked in stereo, long and
  // short and sul tasto. Its readme says it was played by "someone who's more
  // of a violinist", which is audible and is still an erhu.
  erhu: { dir: "/home/user/sfzinstruments/aliexpress-erhu",
          url: "https://github.com/sfzinstruments/aliexpress-erhu", full: true },
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
  // ── the eight families the engine did not have until now ──
  struckString:{ repo: "vcsl", dir: "Chordophones/Zithers/Grand Piano, Steinway B/Sus", every: 2,
                 kind: "struck",  src: "Grand Piano", why: "a struck box zither — the santur's own machine, at the end of its history" },
  freeReed:    { repo: "vcsl", dir: "Aerophones/Free Aerophones/Harmonica-Hohner-Special20-C/Sustains/Normal",
                 kind: "sustain", src: "Harmonica", why: "a tongue swinging THROUGH a slot at its own frequency" },
  clappers:    { repo: "vcsl", dir: "Idiophones/Struck Idiophones/Claves",
                 kind: "struck",  src: "Claves", why: "two solid bodies struck together", unpitched: true },
  rattle:      { repo: "vcsl", dir: "Idiophones/Struck Idiophones/Shaker, Large",
                 kind: "struck",  src: "Shaker", why: "a vessel struck from inside, many times a second", unpitched: true },
  scraper:     { repo: "vcsl", dir: "Idiophones/Struck Idiophones/Guiro",
                 kind: "struck",  src: "Guiro", why: "a train of impacts as the scraper crosses the notches", unpitched: true },
  slitDrum:    { repo: "vcsl", dir: "Idiophones/Struck Idiophones/Slit Drum",
                 kind: "struck",  src: "Slit Drum", why: "cantilever tongues cut into a hollowed log", unpitched: true },
  panpipe:     { gm: "pan_flute", lo: "C4", hi: "C7", every: 3,
                 kind: "sustain", src: "pan_flute", why: "a raft of stopped pipes, one per pitch" },
  // `musicalBow` has no openly-licensed recording anywhere I could find, so it
  // plays MODELLED. That is not a gap to apologise for — it is what the
  // modelled path is for, and a people that invents a body nobody has ever
  // recorded is the normal case here rather than the odd one.
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


// ── THE NAMED BANK: real instruments, for the BENCH only ─────────────────
//
// Everything above is mapped by FAMILY, because a people in this world invents
// bodies that have no name. This second bank is the opposite and is walled off
// for the same reason `musicTraditions.js` is: these are the actual instruments
// five real traditions actually use, and NOTHING a derived people can reach
// ever touches them. Only a pinned tradition names an instrument, so only a
// pinned tradition can play one.
//
// That is what makes it worth having. The bench exists to tell two bugs apart —
// a scale that is wrong and a sound that is wrong — and it can only do that if
// the sound is not in question. A real koto playing miyako-bushi through this
// composer either sounds Japanese or it does not, and whichever it is, that is
// a fact about the composer rather than about the synthesis.
//
// SOURCE AND LICENCE. FluidR3_GM, via the pre-rendered per-note MP3s at
// gleitz.github.io/midi-js-soundfonts — Creative Commons Attribution 3.0,
// which permits redistribution WITH CREDIT. That credit is in
// CREDITS-instr-audio.md and in the Lab's own footer, and it is a real
// obligation rather than the courtesy the CC0 bank gets. Its sibling font
// MusyngKite is deliberately NOT used: it is Attribution-ShareAlike, and a
// share-alike asset would reach back into this repository's own licence.
//
// WHERE THERE IS NO RECORDING, the substitute is by ACOUSTIC CLASS and says so.
// A sheng and a reed organ are both free reeds; a ney and a pan pipe are both
// end-blown rim flutes; an oud and a nylon-strung guitar are both gut-ish
// short-necked lutes. Those are honest neighbours. A substitute that is only
// vaguely similar is left out and the family bank plays instead, because a
// wrong instrument is worse than a generic one.
// WHAT EACH RECORDING IS ACTUALLY MADE OF ─────────────────────────────────
//
// A fact about the instrument in front of the microphone, in the same category
// as the pitch it was playing: a balafon has wooden bars over gourds, a
// strumstick has steel strings on wood, a nylon-strung guitar is the nearest
// thing anyone still records to a gut-strung lute, an mbira has iron tongues.
//
// This is what lets a DERIVED people reach the right recording. The engine
// already goes region -> what grows and can be mined there -> what can be built
// -> family and material; matching a recording on that material is the last
// step of the same chain, and it is rendering rather than fitting. "This people
// built a gut-strung lute on a wooden box, and here is a recording of one" is a
// measurement. "A people in a desert plays an oud" would be a script, and is
// not what happens here — nothing below knows where anything is.
const RECORDED_MAT = {
  Strumstick: "iron", "Dan Tranh": "iron", "Solo Violin": "gut", Flute: "iron",
  Ocarina: "clay", Oboe: "reed", "F Horn": "bronze", Balafon: "wood",
  "Mbira dzaVadzimu": "iron", "Tubular Bells": "bronze", Gong: "bronze",
  Darbuka: "hide", "Frame Drum": "hide", Claves: "wood", Claps: "none",
  "Grand Piano": "iron", Harmonica: "bronze", Shaker: "wood", Guiro: "gourd",
  "Slit Drum": "wood",
  // and the named bank's bodies, which a derived people may also reach —
  // the RECORDING is a measurement of a material, whatever the instrument on
  // it is called
  sitar: "iron", koto: "silk", shamisen: "silk", shakuhachi: "bamboo", flute: "iron",
  taiko_drum: "hide", bagpipe: "reed", fiddle: "gut",
  acoustic_guitar_nylon: "gut", dulcimer: "iron", pan_flute: "bamboo",
  reed_organ: "reed",
};
// which engine family each named recording belongs to, so a derived body can
// find it: the bench reaches these BY NAME, a generated people BY PHYSICS
// A RECORDING WITH NO MATERIAL IS A BUILD ERROR, not a default. It used to
// fall back to "wood", and that is exactly how the General MIDI flute — a metal
// instrument — ended up tagged as wooden and became the nearest match for every
// clay and wooden pipe a people could build, over an actual bamboo shakuhachi
// sitting in the same pool. A default that is silently plausible is worse than
// no default.
function matOf(src) {
  const m = RECORDED_MAT[src];
  if (!m) throw new Error(`no material recorded for sample source "${src}" — add it to RECORDED_MAT`);
  return m;
}
// A DRIVEN BODY HAS TO LOOP and a struck one must not, so a named recording
// carries its own kind rather than being assumed plucked — which is what the
// bank did, and it would have played the erhu as a note that simply stops.
const GM_KIND = { bowed: "sustain", fluteOpen: "sustain", pipeStopped: "sustain",
  reedPipe: "sustain", horn: "sustain", freeReed: "sustain", panpipe: "sustain" };
const NAMED_FAM = {
  sitar: "luteNeck", acoustic_guitar_nylon: "luteNeck", shamisen: "luteNeck",
  koto: "lyre", dulcimer: "lyre",
  fiddle: "bowed",
  flute: "fluteOpen", pan_flute: "fluteOpen", shakuhachi: "fluteOpen",
  bagpipe: "reedPipe", reed_organ: "freeReed", pan_flute: "panpipe",
  taiko_drum: "drum",
};

/**
 * NAMED INSTRUMENTS THAT ARE NOT IN A GENERAL MIDI SET.
 *
 * The FluidR3 bank below covers what General MIDI happens to name, which is a
 * list drawn up in 1991 around a Western keyboard: it has a sitar and a koto
 * and a shakuhachi, and nothing at all for a bowed fiddle with a snakeskin
 * membrane or a plucked box zither with movable bridges. Those have to come
 * from a real recording, one folder of WAVs at a time, through the same path
 * the family bank uses.
 *
 * `pitch` is per-library because octave numbering is not standard: this erhu
 * set labels its octaves ONE ABOVE scientific pitch, which is not a guess —
 * its "a5" measures 440.0 Hz with nothing at 220, and its "d5" measures
 * 293.7 with nothing at 146. (Its own SFZ maps them an octave lower again;
 * the audio is the authority, not the mapping.)
 */
const NAMED_WAV = {
  "erhu": {
    repo: "erhu", dir: "Samples/sus", kind: "sustain", fam: "bowed", mat: "silk",
    src: "AliExpress Erhu", every: 1,
    match: /^erhu_([a-g][b]?)(\d)_sus_rr1\.wav$/i,
    pitch: (m) => 440 * Math.pow(2, (PC[m[1][0].toUpperCase() + (m[1][1] || "")] - 9) / 12
      + (parseInt(m[2], 10) - 1 - 4)),
  },
  "sheng": {
    repo: "vcsl", dir: "Aerophones/Free Aerophones/Harmonica-Hohner-Special20-C/Sustains/Normal",
    kind: "sustain", fam: "freeReed", mat: "bronze", src: "Harmonica", every: 1,
    like: "a MOUTH-blown free reed, which is exactly what a sheng is — the reed "
      + "organ it used to borrow is blown by a bellows",
    match: /^Hohner-Special20_Normal_([A-G][#b]?)(\d)\.wav$/,
    pitch: (m) => 440 * Math.pow(2, (PC[m[1]] - 9) / 12 + (parseInt(m[2], 10) - 4)),
  },
  "qānūn": {
    repo: "vcsl", dir: "Chordophones/Zithers/Dan Tranh/Normal", kind: "pluck",
    fam: "lyre", mat: "iron", src: "Dan Tranh", every: 1,
    like: "a plucked box zither with movable bridges under metal strings, "
      + "which is what a qānūn is — the dulcimer it used to borrow is STRUCK",
    match: /^([A-G][b#]?)(\d)_(?:ff|f|mf)_1\.wav$/,
    pitch: (m) => 440 * Math.pow(2, (PC[m[1]] - 9) / 12 + (parseInt(m[2], 10) - 4)),
  },
};

const GM_URL = "https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/";
const NAMED = {
  // exact — the instrument itself
  "sitār":      { gm: "sitar",       lo: "C3", hi: "C6" },
  "koto":       { gm: "koto",        lo: "D3", hi: "D6" },
  "shamisen":   { gm: "shamisen",    lo: "G2", hi: "G5" },
  "shakuhachi": { gm: "shakuhachi",  lo: "A3", hi: "D6" },
  "taiko":      { gm: "taiko_drum",  lo: "C2", hi: "C4" },
  "chanter":    { gm: "bagpipe",     lo: "G3", hi: "A5" },
  "drones":     { gm: "bagpipe",     lo: "A2", hi: "A4" },
  "fiddle":     { gm: "fiddle",      lo: "G3", hi: "C7" },
  "tānpūrā":    { gm: "sitar",       lo: "C2", hi: "C4" },
  // by acoustic class, named so the substitution is visible
  "oud":        { gm: "acoustic_guitar_nylon", lo: "F2", hi: "F5", like: "a gut-strung short-necked lute" },
  // A PAN FLUTE IS THE WRONG BODY, not merely the wrong instrument. It is a
  // bundle of stopped pipes with one pitch each and no finger holes, so it
  // cannot bend, and bending is most of what these two do — a taqsīm on a nāy
  // is very largely portamento. A shakuhachi is an end-blown rim flute with
  // open holes in a bamboo tube, which is the nāy's own construction, and it
  // is a real recording of one.
  "nāy":        { gm: "shakuhachi",  lo: "A3", hi: "D6", like: "an end-blown rim flute in bamboo, which is the nāy's own body" },
  "bānsurī":    { gm: "shakuhachi",  lo: "A3", hi: "C6", like: "a bamboo flute with open holes — blown across rather than over" },
  "kamānja":    { gm: "fiddle",      lo: "G3", hi: "C6", like: "a bowed folk fiddle" },
  "sārangī":    { gm: "fiddle",      lo: "E3", hi: "C6", like: "a bowed folk fiddle" },
  "dizi":       { gm: "flute",       lo: "D4", hi: "D7", like: "a transverse flute, without the membrane buzz" },
  "pipa":       { gm: "sitar",       lo: "A2", hi: "A5", like: "a plucked, fretted lute with a bright metallic attack" },
  "guqin":      { gm: "koto",        lo: "C2", hi: "C5", like: "a silk-strung board zither" },
};

/** Note name to MIDI number, for walking a range. */
function midiOf(n) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(n);
  if (!m) return null;
  return PC[m[1] + m[2]] + (parseInt(m[3], 10) + 1) * 12;
}
const SHARP = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const nameOf = (mi) => SHARP[((mi % 12) + 12) % 12] + (Math.floor(mi / 12) - 1);

const GM_CACHE = new Map();
function gmNotes(gm) {
  if (GM_CACHE.has(gm)) return GM_CACHE.get(gm);
  const js = sh("curl", ["-sSf", "--max-time", "180", "-A", UA, GM_URL + gm + "-mp3.js"]);
  const map = new Map();
  const re = /"([A-G][#b]?-?\d)":\s*"data:audio\/mp3;base64,([^"]+)"/g;
  let m;
  while ((m = re.exec(js))) map.set(m[1], m[2]);
  GM_CACHE.set(gm, map);
  console.log(`    fetched ${gm}: ${map.size} notes`);
  return map;
}
async function fromGM(spec, fam) {
  const map = gmNotes(spec.gm);
  const out = [];
  const lo = midiOf(spec.lo), hi = midiOf(spec.hi), step = (spec.every || 1) * 2;
  for (let mi = lo; mi <= hi; mi += step) {
    const b64 = map.get(nameOf(mi)) || map.get(SHARP[((mi % 12) + 12) % 12].replace("b", "#") + (Math.floor(mi / 12) - 1));
    if (!b64) continue;
    const hz = +(440 * Math.pow(2, (mi - 69) / 12)).toFixed(2);
    const file = `${fam}_${Math.round(hz)}.mp3`;
    if (!DRY) writeFileSync(join(OUT_DIR, file), Buffer.from(b64, "base64"));
    out.push({ hz, file, secs: 0 });
  }
  return out;
}

async function buildNamed() {
  const dir = join(OUT_DIR, "named");
  mkdirSync(dir, { recursive: true });
  const cache = new Map();
  const bank = {};
  let files = 0, bytes = 0;
  for (const [label, spec] of Object.entries(NAMED_WAV)) {
    const from = join(REPOS[spec.repo].dir, spec.dir);
    const entries = [];
    if (existsSync(from)) {
      // ONE TAKE PER PITCH, loudest, exactly as the family bank does — a
      // library that ships three dynamics of every note otherwise contributes
      // the same pitch three times, and striding across that list lands twice
      // on one note and skips two others.
      const best = new Map();
      for (const f of readdirSync(from)) {
        const m = spec.match.exec(f);
        if (!m) continue;
        const hz = spec.pitch(m);
        if (!(hz > 0)) continue;
        const key = Math.round(hz * 100);
        const prev = best.get(key);
        if (!prev || dynOf(f) < dynOf(prev.f)) best.set(key, { f, hz });
      }
      const picks = [...best.values()].sort((a, b) => a.hz - b.hz);
      // one every `every` pitches: the engine shifts by at most a tone anyway,
      // and a chromatic set of three-second stereo WAVs is not worth the bytes
      for (let i = 0; i < picks.length; i += spec.every) {
        const p2 = picks[i];
        const raw = decodeWav(readFileSync(join(from, p2.f)));
        if (!raw) continue;
        const sh2 = shape(raw.pcm, raw.rate, spec.kind);
        if (!sh2) continue;
        const file = `${label.replace(/[^a-z]/gi, "")}_${Math.round(p2.hz)}.mp3`;
        if (!DRY && !existsSync(join(dir, file))) {
          const mp3 = await encodeMp3(sh2.pcm, sh2.rate, spec.kind === "sustain" ? 72 : 64);
          writeFileSync(join(dir, file), mp3);
          bytes += mp3.length; files++;
        }
        entries.push({ hz: +p2.hz.toFixed(2), file });
      }
    }
    if (entries.length) {
      bank[label] = { src: spec.src, kind: spec.kind, like: spec.like || null,
        fam: spec.fam, mat: spec.mat, entries };
      console.log(`  ${label.padEnd(12)} ${String(entries.length).padStart(3)} samples  ${spec.src} (recorded)`);
    } else {
      console.log(`  ${label.padEnd(12)} MISSING ${spec.dir}`);
    }
  }
  for (const [label, spec] of Object.entries(NAMED)) {
    if (EMIT_ONLY) {
      // rebuild the entry from what is already on disk, so the manifest can be
      // regenerated without re-fetching three megabytes of soundfont
      const lo = midiOf(spec.lo), hi = midiOf(spec.hi), entries = [];
      for (let mi = lo; mi <= hi; mi += 4) {
        const hz = +(440 * Math.pow(2, (mi - 69) / 12)).toFixed(2);
        const file = `${spec.gm}_${Math.round(hz)}.mp3`;
        if (existsSync(join(dir, file))) entries.push({ hz, file });
      }
      if (entries.length) {
        bank[label] = { src: spec.gm, kind: GM_KIND[NAMED_FAM[spec.gm]] || "pluck",
          like: spec.like || null,
          fam: NAMED_FAM[spec.gm] || null, mat: matOf(spec.gm), entries };
        console.log(`  ${label.padEnd(12)} ${String(entries.length).padStart(3)} samples  ${spec.gm} (from disk)`);
      }
      continue;
    }
    const map = gmNotes(spec.gm);
    if (!map || !map.size) continue;
    // one sample every four semitones across the instrument's own range: close
    // enough that nothing shifts more than a tone, which is where a stretched
    // body starts sounding like a cartoon of itself
    const lo = midiOf(spec.lo), hi = midiOf(spec.hi);
    const entries = [];
    for (let mi = lo; mi <= hi; mi += 4) {
      const b64 = map.get(nameOf(mi)) || map.get(SHARP[((mi % 12) + 12) % 12].replace("b", "#") + (Math.floor(mi / 12) - 1));
      if (!b64) continue;
      const raw = Buffer.from(b64, "base64");
      const hz = +(440 * Math.pow(2, (mi - 69) / 12)).toFixed(2);
      const file = `${spec.gm}_${Math.round(hz)}.mp3`;
      if (!existsSync(join(dir, file))) { writeFileSync(join(dir, file), raw); bytes += raw.length; files++; }
      entries.push({ hz, file });
    }
    bank[label] = { src: spec.gm, kind: GM_KIND[NAMED_FAM[spec.gm]] || "pluck",
      like: spec.like || null,
      fam: NAMED_FAM[spec.gm] || null, mat: matOf(spec.gm), entries };
    console.log(`  ${label.padEnd(12)} ${String(entries.length).padStart(3)} samples  ${spec.gm}${spec.like ? "  (as " + spec.like + ")" : ""}`);
  }
  return { bank, files, bytes };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const fams = Object.keys(MAP);
  if (!EMIT_ONLY && !DRY) {
    // fetch every mapped folder in ONE sparse set per repo, so git resolves the
    // blobs in a single pass instead of once per family
    for (const key of Object.keys(REPOS)) {
      ensureRepo(key);
      if (REPOS[key].full) continue;                 // a small repo, checked out whole
      const dirs = fams.filter(f => MAP[f].repo === key).map(f => MAP[f].dir + "/*")
        .concat(Object.values(NAMED_WAV).filter(n => n.repo === key).map(n => n.dir + "/*"));
      if (!dirs.length) continue;
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
    if (m.gm) {
      // ONE FAMILY COMES FROM THE SOUNDFONT, not from a CC0 library: nobody
      // has published an openly-licensed multisampled panpipe, and General
      // MIDI's pan flute is a real recording of one. It is CC BY 3.0 rather
      // than CC0 like the rest of this bank, and the credits say so per item.
      const entries = await fromGM(m, fam);
      if (entries.length) {
        bank[fam] = { src: m.src, why: m.why, kind: m.kind, unpitched: false,
          mat: matOf(m.src), samples: entries };
        files += entries.length;
        console.log(`  ${fam.padEnd(12)} ${String(entries.length).padStart(3)} samples  ${m.src} (soundfont)`);
      }
      continue;
    }
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
      .filter((_, i) => !m.unpitched || i < 6)                // percussion: a handful of strokes
      .filter((_, i) => m.unpitched || !m.every || i % m.every === 0);
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
    bank[fam] = { src: m.src, why: m.why, kind: m.kind, unpitched: !!m.unpitched,
      mat: matOf(m.src), samples: entries };
    console.log(`  ${fam.padEnd(12)} ${String(entries.length).padStart(3)} samples  ${m.src}`);
  }

  console.log("");
  const named = await buildNamed();

  if (DRY) { console.log(`\n  dry run: ${files} samples would be written`); return; }

  const gen = Object.entries(bank).map(([fam, b]) =>
    `  ${fam}: { src: ${JSON.stringify(b.src)}, kind: ${JSON.stringify(b.kind)}, ` +
    `unpitched: ${b.unpitched}, mat: ${JSON.stringify(b.mat)}, samples: [\n` +
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
  "Community Edition, by Versilian Studios LLC (CC0); the erhu from " +
  "sfzinstruments/aliexpress-erhu (CC0). Panpipes and the named bench " +
  "instruments from FluidR3_GM by Frank Wen, via midi-js-soundfonts (CC BY 3.0).";

// THE NAMED BANK IS THE BENCH'S, and nothing a derived people can reach ever
// looks it up: an instrument only gets a name in \`musicTraditions.js\`, which
// is walled off from the generator by construction. Keyed by that label.
export const NAMED_BANK = {
${Object.entries(named.bank).map(([k, v]) =>
  `  ${JSON.stringify(k)}: { src: ${JSON.stringify(v.src || v.gm)}, ` +
  `kind: ${JSON.stringify(v.kind || "pluck")}, like: ${JSON.stringify(v.like)}, ` +
  `fam: ${JSON.stringify(v.fam)}, mat: ${JSON.stringify(v.mat)}, samples: [\n` +
  v.entries.map(e => `    { hz: ${e.hz}, file: ${JSON.stringify("named/" + e.file)} },`).join("\n") +
  `\n  ] },`).join("\n")}
};
`);
  console.log(`\n  family bank: ${files} samples, ${(bytes / 1048576).toFixed(2)} MB`);
  console.log(`  named bank:  ${named.files} samples, ${(named.bytes / 1048576).toFixed(2)} MB`);
  console.log(`  wrote ${MANIFEST.replace(ROOT + "/", "")}`);
}
main().catch(e => { console.error(e); process.exit(1); });
