// Full pitch pipeline: scale → compose → tonic → body clamp → sample quantize.
// Reports where composed degrees drift from scale, and sample-shift cost.
import { foundLanguage } from "../src/sim/language.js";
import { foundPeople, musicOf } from "../src/sim/musicGenome.js";
import { composePiece, degreeHz, modeDegree, finalFor } from "../src/sim/musicCompose.js";
import { quantizeToScaleHz } from "../src/sim/musicArchetypes.js";
import { TRADITIONS, applyTradition } from "../src/sim/musicTraditions.js";
import { makeInstrument, FAMILIES, rangeOf } from "../src/sim/musicInstruments.js";
import { finalsOf } from "../src/sim/musicTuning.js";
import { voiceRange } from "../src/sim/vocalTract.js";
import { prosodyOf } from "../src/sim/languagePhonetics.js";

const W = () => ({ seed: 1, step: 0, languages: new Map(), _nextLanguageId: 1 });
const build = (seed, trad) => {
  const m = musicOf(foundPeople(seed >>> 0, foundLanguage(W(), { seed: seed >>> 0 }), {}));
  return trad ? applyTradition(m, trad, { makeInstrument, finalsOf }) : m;
};

function tonicOf(m, occ = "peace") {
  const base = 294 * (m.melody.breathBound ? 1.12 : 1);
  const fin = finalFor(m, occ);
  const d = m.scale.degrees[((modeDegree(m, fin) % m.scale.degrees.length) + m.scale.degrees.length) % m.scale.degrees.length];
  return base / (d ? d.ratio : 1);
}

function noteFreq(m, ev, occ = "peace") {
  let f = degreeHz(m, tonicOf(m, occ), ev.deg, ev.oct);
  const frame = m.scale.frame.ratio;
  const inst = m.insts[ev.inst];
  let low = 0, top = 0;
  if (inst && FAMILIES[inst.fam]?.low) {
    ({ low, top } = rangeOf(inst, m.mode?.size || 7));
  } else if (ev.role === "voice") {
    ({ low, top } = voiceRange(prosodyOf(m.people.lang)));
  }
  if (!low) return f;
  let guard = 0;
  while (f < low * 0.94 && guard++ < 5) f *= frame;
  while (f > top && guard++ < 9) f /= frame;
  if (f < low * 0.94) f = low;
  else if (f > top) f = top;
  return f;
}

/** Pitch-class distance in cents (within one frame), ignoring octave. */
function pcCentsOff(hz, targetHz, frameCents = 1200) {
  if (!(hz > 0 && targetHz > 0)) return 0;
  const raw = (1200 * Math.log2(hz / targetHz)) % frameCents;
  const c = ((raw % frameCents) + frameCents) % frameCents;
  return Math.min(c, frameCents - c);
}

import { SAMPLE_BANK } from "../src/sim/musicSampleManifest.js";

function pickSample(entries, f) {
  const lo = entries[0].hz, hi = entries[entries.length - 1].hz;
  let hz = f;
  while (hz > hi && hz / 2 >= lo) hz /= 2;
  while (hz < lo && hz * 2 <= hi) hz *= 2;
  let best = entries[0], bestD = Infinity;
  for (const e of entries) {
    const d = Math.abs(Math.log2(hz / e.hz));
    if (d < bestD) { bestD = d; best = e; }
  }
  return { sampleHz: best.hz, targetHz: hz, stretchCents: 1200 * Math.log2(hz / best.hz) };
}

function scaleHzForEvent(m, ev, occ) {
  const tonic = tonicOf(m, occ);
  return degreeHz(m, tonic, ev.deg, ev.oct || 0);
}

function analyzePeople(m, occ = "peace", { leadOnly = true } = {}) {
  const piece = composePiece(m, occ, null, 0.85);
  const tonic = tonicOf(m, occ);
  const melodic = piece.events.filter(e =>
    e.deg != null && (!leadOnly || e.role === "lead" || e.role === "voice"));
  if (!melodic.length) return null;

  let clampShift = 0, quantShift = 0, sampleShift = 0, composeOk = 0, n = 0;
  let maxClamp = 0, maxQuant = 0, maxSample = 0;
  const modeMiss = new Map();
  const examples = [];

  for (const ev of melodic) {
    const clamped = noteFreq(m, ev, occ);
    const scaleTarget = degreeHz(m, tonic, ev.deg, ev.oct || 0);
    const quantized = quantizeToScaleHz(clamped, m, tonic);

    const frame = m.scale.frame.cents;
    const cClamp = pcCentsOff(clamped, scaleTarget, frame);
    const cQuant = pcCentsOff(quantized, scaleTarget, frame);

    const inst = m.insts[ev.inst] || m.insts[0];
    const bank = inst && SAMPLE_BANK[inst.fam];
    let cSample = 0;
    if (bank?.samples?.length && ev.role !== "voice") {
      const q = quantizeToScaleHz(scaleTarget, m, tonic);
      const { stretchCents } = pickSample(bank.samples, q);
      cSample = Math.abs(stretchCents);
      sampleShift += cSample;
      maxSample = Math.max(maxSample, cSample);
    }

    if (cClamp < 1) composeOk++;
    clampShift += cClamp; quantShift += cQuant;
    maxClamp = Math.max(maxClamp, cClamp);
    maxQuant = Math.max(maxQuant, cQuant);
    n++;

    if (cQuant > 35 || cSample > 35) {
      examples.push({
        seed: m.people.seed, role: ev.role, deg: ev.deg,
        hz: clamped.toFixed(1), target: scaleTarget.toFixed(1),
        pcErr: cQuant.toFixed(0), sampleStretch: cSample.toFixed(0),
        arch: m.scale.archetype?.id,
      });
    }

    const inMode = m.mode.idx.includes(ev.deg % m.scale.degrees.length);
    if (!inMode) modeMiss.set(ev.deg, (modeMiss.get(ev.deg) || 0) + 1);
  }

  return {
    seed: m.people.seed,
    archetype: m.scale.archetype?.id || m.scale.derivedBy,
    modeSize: m.mode.size,
    scaleSize: m.scale.degrees.length,
    tetErr: m.scale.tetErr,
    frame: Math.round(m.scale.frame.cents),
    n,
    composeOkPct: (100 * composeOk / n).toFixed(0),
    meanPcClamp: (clampShift / n).toFixed(1),
    meanPcQuant: (quantShift / n).toFixed(1),
    meanSampleStretch: (sampleShift / Math.max(1, n)).toFixed(1),
    maxClamp: maxClamp.toFixed(0),
    maxQuant: maxQuant.toFixed(0),
    maxSample: maxSample.toFixed(0),
    modeMissNotes: [...modeMiss.values()].reduce((a, b) => a + b, 0),
    examples: examples.slice(0, 3),
  };
}

function reportBatch(label, seeds, opts = {}) {
  const rows = [];
  for (const seed of seeds) {
    try {
      const r = analyzePeople(build(seed, opts.trad), opts.occ || "peace", opts);
      if (r) rows.push(r);
    } catch { /* skip */ }
  }
  if (!rows.length) return;
  const mean = (f) => rows.reduce((a, r) => a + +f(r), 0) / rows.length;
  console.log(`\n=== ${label} (n=${rows.length}) ===`);
  console.log(`  pitch-class on-scale after body fold: ${mean(r => r.composeOkPct).toFixed(0)}%`);
  console.log(`  mean PC error (clamp): ${mean(r => r.meanPcClamp).toFixed(1)}c   worst ${Math.max(...rows.map(r => +r.maxClamp)).toFixed(0)}c`);
  console.log(`  mean PC error (quantize): ${mean(r => r.meanPcQuant).toFixed(1)}c   worst ${Math.max(...rows.map(r => +r.maxQuant)).toFixed(0)}c`);
  console.log(`  mean ET sample stretch: ${mean(r => r.meanSampleStretch).toFixed(1)}c   worst ${Math.max(...rows.map(r => +r.maxSample)).toFixed(0)}c`);
  console.log(`  notes off-mode deg: ${mean(r => r.modeMissNotes).toFixed(1)} per piece`);
  console.log(`  mean tetErr: ${mean(r => r.tetErr).toFixed(1)}c`);
  const bad = rows.filter(r => +r.meanPcQuant > 20 || +r.maxQuant > 40).sort((a, b) => b.meanPcQuant - a.meanPcQuant);
  if (bad.length) {
    console.log(`  worst PC error: ${bad.slice(0, 5).map(r => `${r.seed}(${r.meanPcQuant}c, arch=${r.archetype})`).join("  ")}`);
    for (const r of bad.slice(0, 2)) {
      if (r.examples.length) console.log(`    seed ${r.seed} e.g.`, r.examples[0]);
    }
  }
  return rows;
}

// archetype OFF vs ON
const sample = [1035, 1037, 1040, 2025, 1234, 3000, 3017, 4000];
console.log("Pitch pipeline probe — composed lead/voice notes vs playback Hz");
reportBatch("derived peoples (sample)", sample);

const all = [];
for (let i = 0; i < 120; i++) all.push(1000 + i * 17);
reportBatch("derived 120 seeds", all, { leadOnly: true });

// bench traditions
for (const k of Object.keys(TRADITIONS)) {
  const r = analyzePeople(build(7, k), "peace", { leadOnly: true });
  if (!r) continue;
  console.log(`\n=== bench: ${k} ===`);
  console.log(`  tetErr ${r.tetErr.toFixed(1)}c  meanPC ${r.meanPcQuant}c  maxPC ${r.maxQuant}c  modeMiss ${r.modeMissNotes}`);
}

// plain texture: lead only
const plain = [];
for (let i = 0; i < 60; i++) {
  const seed = 1500 + i * 29;
  try {
    const m = build(seed);
    if (m.texture.kind !== "monophony") continue;
    const r = analyzePeople(m, "peace", { leadOnly: true });
    if (r) plain.push(r);
  } catch { /* skip */ }
}
if (plain.length) {
  const mean = (f) => plain.reduce((a, r) => a + +f(r), 0) / plain.length;
  console.log(`\n=== monophonic peoples only (n=${plain.length}) ===`);
  console.log(`  mean tetErr: ${mean(r => r.tetErr).toFixed(1)}c`);
  console.log(`  mean ET sample stretch: ${mean(r => r.meanSampleStretch).toFixed(1)}c   worst ${Math.max(...plain.map(r => +r.maxSample)).toFixed(0)}c`);
  console.log(`  off-mode scale degrees used: ${mean(r => r.modeMissNotes).toFixed(1)} notes/piece`);
  const odd = plain.filter(r => +r.tetErr > 20 || +r.meanSampleStretch > 50).slice(0, 5);
  console.log(`  odd-scale candidates: ${odd.map(r => `${r.seed}(tet=${r.tetErr.toFixed(0)} stretch=${r.meanSampleStretch} arch=${r.archetype})`).join("  ")}`);
}

// archetype vs spectrum: do archetype degrees sit in roughness minima?
import { minimaOf, dissonanceCurve } from "../src/sim/musicTuning.js";
let archOff = 0, archN = 0;
for (let i = 0; i < 80; i++) {
  const seed = 2000 + i * 31;
  let m; try { m = build(seed); } catch { continue; }
  const mins = minimaOf(dissonanceCurve(m.spec)).map(x => 1200 * Math.log2(x.ratio));
  for (const d of m.scale.degrees) {
    if (d.cents <= 0) continue;
    archN++;
    const best = Math.min(...mins.map(mc => Math.abs(mc - d.cents)));
    archOff += Math.min(best, 200);
  }
}
console.log(`\n=== archetype degrees vs ensemble minima (n=${archN}) ===`);
console.log(`  mean miss from spectrum dip: ${(archOff / archN).toFixed(0)}c`);

console.log("\n=== listening-test retune mismatch ===");
const seed = 3500;
const base = build(seed);
const retune12 = (m) => {
  const degrees = m.scale.degrees.map((d) => {
    const cents = Math.round(d.cents / 100) * 100;
    return { ...d, cents, ratio: Math.pow(2, cents / 1200) };
  });
  return { ...m, scale: { ...m.scale, degrees, frame: { ...m.scale.frame, cents: 1200, ratio: 2 } } };
};
const m12 = retune12(base);
const piece = composePiece(base, "peace", null, 0.85);
let shift = 0, n = 0;
for (const ev of piece.events.filter(e => e.role === "lead" && e.deg != null)) {
  const hzBase = degreeHz(base, tonicOf(base), ev.deg, ev.oct || 0);
  const hzPlay = degreeHz(m12, tonicOf(m12), ev.deg, ev.oct || 0);
  shift += pcCentsOff(hzPlay, hzBase, base.scale.frame.cents);
  n++;
}
console.log(`  seed ${seed}: compose on derived scale, play on ET — mean shift ${(shift / n).toFixed(1)}c (${n} lead notes)`);
