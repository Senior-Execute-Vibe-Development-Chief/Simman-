// Fit the articulatory tract's vowel postures to the HUMAN formants measured
// from the recorded phone bank (assets/ipa-audio/formants.json, produced by
// tools/measure_vowel_truth.mjs), and bake the result as src/sim/vocalTractCal.js.
//
//   node tools/fit_tract_vowels.mjs             # fit + bake + report
//   node tools/fit_tract_vowels.mjs --verify    # measure the CURRENT mapping
//                                               #   (via scorePlan) against truth
//
// This is calibration of a physical model against measurement — the biomeClass
// argument: the tract stays the mechanism (resonances still fall out of the
// tube shape); what is fitted is WHERE the tongue sits for each vowel quality,
// searched per quality over (tongueIndex, tongueDiameter, lip, helper-
// constriction) to minimize log-formant error. The recordings mix speakers of
// different vocal-tract lengths, so each vowel gets ONE free uniform formant
// scale k∈[0.8,1.3] (vocal-tract-length normalization): the fit matches the
// vowel QUALITY (the formant pattern), not the recorder's larynx.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderScore, scorePlan } from "../src/sim/vocalTract.js";
import { estimateFormants, stats } from "./lib/formants.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SR = 44100;
const VERIFY = process.argv.includes("--verify");
const truth = JSON.parse(readFileSync(join(ROOT, "assets", "ipa-audio", "formants.json"), "utf8"));

// ── truth repair: merged-peak artifacts the measurement flags itself ──────
// A round back vowel whose "F2" lands above 1800 Hz while F1 sits low is the
// order-limit merge (F1+F2 fused, F3 mis-read as F2) — [ɔ] survives even at
// order 16. Repair its F2 from the round-back column's height neighbours.
for (const [sym, t] of Object.entries(truth)) {
  if (t.b === 2 && t.r === 1 && t.F.length >= 2 && t.F[1] > 1800) {
    const peers = Object.values(truth).filter(u => u.b === 2 && u.r === 1 && u.F.length >= 2 && u.F[1] <= 1800);
    if (peers.length) {
      const f2 = Math.round(peers.reduce((a, u) => a + u.F[1], 0) / peers.length);
      console.log(`(truth repair: [${sym}] F2 ${t.F[1]} is a merged-peak artifact → ${f2} from round-back peers)`);
      t.F = [t.F[0], f2];
      t.repaired = true;
    }
  }
}

// ── render a raw posture (bypasses vowelPosture — this searches its replacement)
function postureScore(c, dur = 0.3) {
  const k = (v) => [{ t: 0, v }];
  return { dur, tracks: {
    tongueIndex: k(c.ti), tongueDiameter: k(c.td), lip: k(c.lip),
    constrIndex: k(c.cd < 3 ? c.ti : -1), constrDiameter: k(c.cd),
    velum: k(0.01), fricative: k(0), aspiration: k(0),
    frequency: k(105), tenseness: k(0.72),
    intensity: [{ t: 0, v: 0 }, { t: 0.02, v: 1 }, { t: dur - 0.03, v: 1 }, { t: dur, v: 0 }],
  } };
}
function measureCand(c) {
  const x = renderScore(postureScore(c), SR, 12345);
  if (stats(x).rms < 1e-3) return null;
  const F = estimateFormants(x, SR, 0.45).filter(f => f >= 180);
  return F.length >= 2 ? F : null;
}
// log-formant error with a per-vowel VTL scale k — but ANCHORED to the
// recording's own pitch. A free k∈[0.8,1.3] spans a 1.6× ratio, wider than
// many vowel distinctions: five mid/open qualities collapsed onto one
// posture with k absorbing the difference. The recorder's F0 says roughly
// how their tract compares to our 105 Hz male tube, so k gets a narrow
// window: male-pitched ≈ our scale, high-pitched shrinks toward it.
const W = [1, 1, 0.35];
const kRange = (f0) => (f0 >= 180 ? [0.78, 0.98] : f0 >= 140 ? [0.85, 1.05] : [0.95, 1.1]);
function fitErr(Ft, Fh, f0) {
  const n = Math.min(Ft.length, Fh.length, 3);
  if (n < 2) return { err: 1e9, k: 1 };
  const [kLo, kHi] = kRange(f0 || 120);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += W[i] * Math.log(Ft[i] / Fh[i]); den += W[i]; }
  const k = Math.min(kHi, Math.max(kLo, Math.exp(num / den)));
  let err = 0;
  for (let i = 0; i < n; i++) { const d = Math.log(Ft[i]) - Math.log(k * Fh[i]); err += W[i] * d * d; }
  return { err, k };
}

// "before"/verify: the CURRENT feature→gesture mapping, through scorePlan
function measureMapping(v) {
  const plan = { syls: [{ on: [], nu: [{ ...v, lg: 1 }], co: [], tone: null }], stress: 0, tone: 0, pitchAccent: false };
  const x = renderScore(scorePlan(plan), SR, 12345);
  return estimateFormants(x, SR, 0.45).filter(f => f >= 180);
}

const vowels = Object.entries(truth).map(([sym, t]) => ({ sym, ...t }));
if (VERIFY) {
  let sum = 0, n = 0, worst = null;
  for (const v of vowels) {
    const Ft = measureMapping({ h: v.h, b: v.b, r: v.r, atr: v.atr, n: 0, lg: 0, ph: 0 });
    const { err, k } = fitErr(Ft, v.F, v.f0);
    sum += err; n++;
    if (!worst || err > worst.err) worst = { sym: v.sym, err };
    console.log(`  [${v.sym}]  human=[${v.F.join(" ")}]  tract=[${Ft.slice(0, 3).map(Math.round).join(" ")}]  k=${k.toFixed(2)}  err=${err.toFixed(3)}`);
  }
  console.log(`mapping error vs truth: mean ${(sum / n).toFixed(3)} over ${n} vowels (worst [${worst.sym}] ${worst.err.toFixed(3)})`);
  process.exit(0);
}

// ── the search: coarse grid, then local refinement ────────────────────────
const t0 = Date.now();
measureCand({ ti: 20, td: 2.6, lip: 0, cd: 3 });
console.log(`(one render+measure: ${Date.now() - t0} ms)`);

function fitVowel(v) {
  const Fh = v.F;
  let best = null;
  const consider = (c) => {
    const Ft = measureCand(c);
    if (!Ft) return;
    const { err, k } = fitErr(Ft, Fh, v.f0);
    if (!best || err < best.err) best = { ...c, err, k, Ft: Ft.slice(0, 3).map(Math.round) };
  };
  const lips = v.r ? [0.45, 0.7, 0.95] : [0, 0.2];
  for (const ti of [10, 13, 16, 19, 22, 25, 28])
    for (const td of [1.7, 2.1, 2.5, 2.9, 3.3])
      for (const lip of lips)
        for (const cd of [3, 0.7])
          consider({ ti, td, lip, cd });
  const b0 = { ...best };
  for (const dti of [-1.5, 0, 1.5])
    for (const dtd of [-0.2, 0, 0.2])
      for (const dlip of [-0.12, 0, 0.12])
        for (const cd of [...new Set([b0.cd, 0.5, 0.9, 3])])
          consider({ ti: b0.ti + dti, td: Math.max(1.4, b0.td + dtd), lip: Math.min(1, Math.max(0, b0.lip + dlip)), cd });
  return best;
}

const cal = {};
let sumB = 0, sumA = 0, n = 0;
for (const v of vowels) {
  const before = fitErr(measureMapping({ h: v.h, b: v.b, r: v.r, atr: v.atr, n: 0, lg: 0, ph: 0 }), v.F, v.f0).err;
  const best = fitVowel(v);
  cal[`${v.h},${v.b},${v.r},${v.atr}`] = {
    ti: +best.ti.toFixed(1), td: +best.td.toFixed(2), lip: +best.lip.toFixed(2), cd: best.cd,
    sym: v.sym, F: best.Ft, target: v.F, k: +best.k.toFixed(2),
  };
  sumB += Math.min(before, 1e3); sumA += best.err; n++;
  console.log(`  [${v.sym}]  human=[${v.F.join(" ")}]  fit=[${best.Ft.join(" ")}] k=${best.k.toFixed(2)}  ` +
    `ti=${best.ti} td=${best.td} lip=${best.lip} cd=${best.cd}  err ${before.toFixed(3)} → ${best.err.toFixed(3)}`);
}
console.log(`\nmean log-formant error: ${(sumB / n).toFixed(3)} → ${(sumA / n).toFixed(3)} over ${n} vowels`);

const lines = Object.entries(cal).map(([key, c]) =>
  `  "${key}": { ti: ${c.ti}, td: ${c.td}, lip: ${c.lip}, cd: ${c.cd} },  // [${c.sym}] fit [${c.F.join(" ")}] ← human [${c.target.join(" ")}] ×${c.k}`);
const mod = `// GENERATED by tools/fit_tract_vowels.mjs — do not edit by hand.
// Calibrated vowel postures for the articulatory tract, fitted against the
// HUMAN formants measured from the recorded phone bank (assets/ipa-audio/
// formants.json ← tools/measure_vowel_truth.mjs). Keyed "height,backness,
// round,ATR"; each entry: tongueIndex, tongueDiameter, lip rounding, and the
// helper-constriction diameter (3 = none; a value < 3 pinches at the tongue
// position — how a real /u/ gets its low F2). Per-vowel ×k is the free
// vocal-tract-length normalization absorbed at fit time (the bank mixes
// speakers); it is NOT applied at synthesis.
// Mean weighted log-formant error vs truth: ${(sumB / n).toFixed(3)} (old mapping) → ${(sumA / n).toFixed(3)} (this table).
export const VOWEL_CAL = {
${lines.join("\n")}
};
`;
writeFileSync(join(ROOT, "src", "sim", "vocalTractCal.js"), mod);
console.log(`wrote src/sim/vocalTractCal.js (${n} fitted postures)`);
