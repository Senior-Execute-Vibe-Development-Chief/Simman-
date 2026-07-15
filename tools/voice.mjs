// Headless verifier for the articulatory voice (src/sim/vocalTract.js).
// Renders phonemes offline, measures F0 + formants (LPC envelope peak-picking),
// and asserts the vowel space is acoustically sane — the calibration loop the
// Lab can't run because it has no ears in CI. Also dumps WAVs for a human ear.
//
//   node tools/voice.mjs            # measure + sanity table
//   node tools/voice.mjs --wav DIR  # also write demo WAVs to DIR
//
// The DSP core is pure, so this exercises the EXACT code the Lab plays.
import { writeFileSync, mkdirSync } from "node:fs";
import { renderScore, scorePlan, scoreClause } from "../src/sim/vocalTract.js";

const SR = 44100;
const args = process.argv.slice(2);
const wavDir = args.includes("--wav") ? (args[args.indexOf("--wav") + 1] || "voice-out") : null;

// ── hand-built plans (no language machinery needed to drive the synth) ──
const V = (h, b, r, extra = {}) => ({ h, b, r, n: 0, lg: 0, ph: 0, atr: 0, ...extra });
const C = (p, m, l = 0, s = 0) => ({ p, m, l, s });
// a SUSTAINED vowel (long + stressed) so the measurement window lands on
// steady state, not the constriction transition — short vowels mis-read F2
const vowelPlan = (v) => ({ syls: [{ on: [], nu: [{ ...v, lg: 1 }], co: [], tone: null }], stress: 0, tone: 0, pitchAccent: false });
const cvPlan = (c, v) => ({ syls: [{ on: [c], nu: [v], co: [], tone: null }], stress: -1, tone: 0, pitchAccent: false });
const wordPlan = (syls) => ({ syls: syls.map(s => ({ tone: null, ...s })), stress: 0, tone: 0, pitchAccent: false });

// ── measurement ──────────────────────────────────────────────────────────
function stats(x) {
  let sum = 0, sq = 0, peak = 0, bad = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i]; if (!Number.isFinite(v)) bad++; sum += v; sq += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
  return { rms: Math.sqrt(sq / x.length), dc: sum / x.length, peak, bad };
}
// pitch by autocorrelation over the voiced middle
function estimateF0(x) {
  const a = Math.floor(x.length * 0.35), b = Math.floor(x.length * 0.6);
  const seg = x.subarray(a, b);
  const minLag = Math.floor(SR / 400), maxLag = Math.floor(SR / 70);
  let best = 0, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0; for (let i = 0; i + lag < seg.length; i++) s += seg[i] * seg[i + lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  return bestLag ? SR / bestLag : 0;
}
// LPC formants: decimate to ~11 kHz first (at 44.1 kHz a low-order LPC can't
// resolve low formants — the standard fix is to work at ~2× the formant range),
// then Levinson–Durbin and pick spectral-envelope peaks.
function estimateFormants(x) {
  const DEC = 4, sr = SR / DEC;                            // 11025 Hz
  const a = Math.floor(x.length * 0.4), b = Math.min(x.length, a + Math.floor(0.04 * SR));
  // anti-alias (box average) + decimate
  const m = Math.floor((b - a) / DEC), seg = new Float64Array(m);
  for (let i = 0; i < m; i++) { let s = 0; for (let j = 0; j < DEC; j++) s += x[a + i * DEC + j]; seg[i] = s / DEC; }
  for (let i = seg.length - 1; i > 0; i--) seg[i] -= 0.98 * seg[i - 1];         // pre-emphasis
  for (let i = 0; i < seg.length; i++) seg[i] *= 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (seg.length - 1)); // Hamming
  const p = 12;
  const r = new Float64Array(p + 1);
  for (let k = 0; k <= p; k++) { let s = 0; for (let i = 0; i + k < seg.length; i++) s += seg[i] * seg[i + k]; r[k] = s; }
  if (r[0] < 1e-12) return [];
  const aC = new Float64Array(p + 1); aC[0] = 1; let err = r[0];
  for (let i = 1; i <= p; i++) {
    let acc = r[i]; for (let j = 1; j < i; j++) acc += aC[j] * r[i - j];
    const k = -acc / err;
    const tmp = aC.slice();
    for (let j = 1; j < i; j++) aC[j] = tmp[j] + k * tmp[i - j];
    aC[i] = k; err *= (1 - k * k);
    if (err <= 0) break;
  }
  const peaks = [], mags = [];
  for (let f = 150; f <= 4500; f += 10) {
    const w = 2 * Math.PI * f / sr; let re = 1, im = 0;
    for (let k = 1; k <= p; k++) { re += aC[k] * Math.cos(-w * k); im += aC[k] * Math.sin(-w * k); }
    mags.push({ f, m: 1 / Math.sqrt(re * re + im * im) });
  }
  for (let i = 2; i < mags.length - 2; i++)
    if (mags[i].m > mags[i - 1].m && mags[i].m >= mags[i + 1].m && mags[i].m > mags[i - 2].m) peaks.push(mags[i].f);
  return peaks;
}
function measure(plan, seed = 12345) {
  const x = renderScore(scorePlan(plan), SR, seed);
  return { x, st: stats(x), f0: estimateF0(x), F: estimateFormants(x) };
}

// ── WAV writer (16-bit mono PCM) ──────────────────────────────────────────
function writeWav(path, x) {
  const n = x.length, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, x[i])); buf.writeInt16LE((s * 32767) | 0, 44 + i * 2); }
  writeFileSync(path, buf);
}

// ── cardinal-vowel sanity ──────────────────────────────────────────────────
const cardinals = [
  { name: "i (high front)", v: V(0, 0, 0), want: "F2>1800 F1<450" },
  { name: "a (low central)", v: V(2, 1, 0), want: "F1>600" },
  { name: "u (high back rnd)", v: V(0, 2, 1), want: "F1<450 F2<1200" },
  { name: "e (mid front)", v: V(1, 0, 0), want: "F1<650 F2>1500" },
  { name: "o (mid back rnd)", v: V(1, 2, 1), want: "F1<650 F2<1300" },
  { name: "ə (mid central)", v: V(1, 1, 0), want: "central" },
];
console.log("cardinal vowels — F0 / formants (Hz):");
let anyBad = false;
const got = {};
for (const c of cardinals) {
  const m = measure(vowelPlan(c.v));
  got[c.name] = m;
  const F = m.F.slice(0, 4).map(f => Math.round(f)).join(" ");
  const flag = m.st.bad || !isFinite(m.st.rms) || m.st.rms < 1e-3 ? " ⚠SILENT/NaN" : "";
  if (flag) anyBad = true;
  console.log(`  ${c.name.padEnd(20)} F0=${Math.round(m.f0).toString().padStart(3)}  F=[${F}]  rms=${m.st.rms.toFixed(3)} peak=${m.st.peak.toFixed(2)}  want ${c.want}${flag}`);
}
const f = (name) => got[name].F.filter(x => x >= 200);
const F1 = (name) => f(name)[0] || 0, F2 = (name) => f(name)[1] || 0;
const checks = [
  ["/i/ F2 high (>1800)", F2("i (high front)") > 1800],
  ["/i/ F1 low (<500)", F1("i (high front)") < 500],
  ["/a/ F1 high (>600)", F1("a (low central)") > 600],
  ["/u/ F2 low (<1200)", F2("u (high back rnd)") < 1200],
  ["/i/ F2 > /u/ F2 (front/back split)", F2("i (high front)") > F2("u (high back rnd)") + 400],
  ["/a/ F1 > /i/ F1 (open/close split)", F1("a (low central)") > F1("i (high front)") + 150],
];
console.log("\nvowel-space checks:");
let pass = 0;
for (const [label, ok] of checks) { console.log(`  ${ok ? "✓" : "✗"} ${label}`); if (ok) pass++; }
console.log(`\n${pass}/${checks.length} checks passed${anyBad ? "  (⚠ silence/NaN detected)" : ""}`);

// consonant smoke: nothing should be NaN/silent when it shouldn't be
console.log("\nconsonant smoke (rms should be > 0):");
const cons = [
  ["p (vl stop)", cvPlan(C(0, 0, 0), V(2, 1, 0))],
  ["b (vd stop)", cvPlan(C(0, 0, 1), V(2, 1, 0))],
  ["s (sibilant)", cvPlan(C(1, 2, 0), V(2, 1, 0))],
  ["m (nasal)", cvPlan(C(0, 1, 1), V(2, 1, 0))],
  ["n (nasal)", cvPlan(C(1, 1, 1), V(0, 0, 0))],
  ["l (lateral)", cvPlan(C(1, 4, 1), V(2, 1, 0))],
  ["r (trill)", cvPlan(C(5, 5, 1), V(2, 1, 0))],
  ["k (velar)", cvPlan(C(4, 0, 0), V(2, 1, 0))],
  ["h (glottal fric)", cvPlan(C(7, 2, 0), V(2, 1, 0))],
  ["w (glide)", cvPlan(C(0, 6, 1), V(2, 1, 0))],
];
for (const [name, plan] of cons) {
  const m = measure(plan);
  const flag = m.st.bad ? " ⚠NaN" : m.st.rms < 1e-3 ? " ⚠SILENT" : "";
  if (flag) anyBad = true;
  console.log(`  ${name.padEnd(18)} rms=${m.st.rms.toFixed(3)} peak=${m.st.peak.toFixed(2)} dc=${m.st.dc.toFixed(4)}${flag}`);
}

if (wavDir) {
  mkdirSync(wavDir, { recursive: true });
  // demo vowels
  for (const c of cardinals) writeWav(`${wavDir}/vowel_${c.name[0]}.wav`, measure(vowelPlan(c.v)).x);
  // demo CV syllables + a couple of little words
  writeWav(`${wavDir}/syl_pa.wav`, renderScore(scorePlan(cvPlan(C(0, 0, 0), V(2, 1, 0))), SR));
  writeWav(`${wavDir}/syl_si.wav`, renderScore(scorePlan(cvPlan(C(1, 2, 0), V(0, 0, 0))), SR));
  writeWav(`${wavDir}/word_mala.wav`, renderScore(scorePlan(wordPlan([
    { on: [C(0, 1, 1)], nu: [V(2, 1, 0)], co: [] }, { on: [C(1, 4, 1)], nu: [V(2, 1, 0)], co: [] },
  ])), SR));
  writeWav(`${wavDir}/word_kitanu.wav`, renderScore(scorePlan(wordPlan([
    { on: [C(4, 0, 0)], nu: [V(0, 0, 0)], co: [] }, { on: [C(1, 0, 0)], nu: [V(2, 1, 0)], co: [] }, { on: [C(1, 1, 1)], nu: [V(0, 2, 1)], co: [] },
  ])), SR));
  // a two-word "clause" to exercise prosody
  writeWav(`${wavDir}/clause.wav`, renderScore(scoreClause([[
    wordPlan([{ on: [C(1, 0, 0)], nu: [V(2, 1, 0)], co: [] }, { on: [C(4, 2, 0)], nu: [V(0, 0, 0)], co: [] }]),
    wordPlan([{ on: [C(0, 1, 1)], nu: [V(1, 2, 1)], co: [] }, { on: [C(1, 5, 1)], nu: [V(2, 1, 0)], co: [] }]),
  ]], "fall"), SR));
  console.log(`\nwrote WAVs to ${wavDir}/`);
}

process.exit(anyBad ? 1 : 0);
