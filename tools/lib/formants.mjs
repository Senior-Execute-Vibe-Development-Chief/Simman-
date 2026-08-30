// Shared acoustic measurement: F0 (autocorrelation) + formants (LPC envelope
// peak-picking) + basic stats + a WAV writer. Extracted from tools/voice.mjs
// so the voice sanity harness and the tract↔recording calibration tools
// measure with the SAME code (the biomeClass lesson: duplicated measurement
// drifts, and then the gates score a reimplementation).

import { writeFileSync } from "node:fs";

export function stats(x) {
  let sum = 0, sq = 0, peak = 0, bad = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i]; if (!Number.isFinite(v)) bad++; sum += v; sq += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
  return { rms: Math.sqrt(sq / x.length), dc: sum / x.length, peak, bad };
}

/** pitch by autocorrelation over the (default) voiced middle of x @ sr */
export function estimateF0(x, sr, a = Math.floor(x.length * 0.35), b = Math.floor(x.length * 0.6)) {
  const seg = x.subarray(a, b);
  const minLag = Math.floor(sr / 400), maxLag = Math.floor(sr / 70);
  let best = 0, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0; for (let i = 0; i + lag < seg.length; i++) s += seg[i] * seg[i + lag];
    if (s > best) { best = s; bestLag = lag; }
  }
  return bestLag ? sr / bestLag : 0;
}

/** LPC formants over a ~40 ms window of x @ sr. Decimates to ~sr/DEC first
 *  (at 44.1/48 kHz a low-order LPC can't resolve low formants — the standard
 *  fix is to work at ~2× the formant range), then Levinson–Durbin and
 *  spectral-envelope peak-picking. Returns peak frequencies (Hz), ascending.
 *  Order 16: at order 12 the tightly-spaced F1+F2 of round back vowels
 *  ([u] [o] [ɔ]) merge into one envelope peak and the picker reports F3 as
 *  "F2" — measured directly against the recorded bank. */
export function estimateFormants(x, sr, at = 0.4, DEC = 4, p = 16, fmax = 4500) {
  const dsr = sr / DEC;
  const a = Math.floor(x.length * at), b = Math.min(x.length, a + Math.floor(0.04 * sr));
  // anti-alias (box average) + decimate
  const m = Math.floor((b - a) / DEC), seg = new Float64Array(m);
  for (let i = 0; i < m; i++) { let s = 0; for (let j = 0; j < DEC; j++) s += x[a + i * DEC + j]; seg[i] = s / DEC; }
  for (let i = seg.length - 1; i > 0; i--) seg[i] -= 0.98 * seg[i - 1];         // pre-emphasis
  for (let i = 0; i < seg.length; i++) seg[i] *= 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (seg.length - 1)); // Hamming
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
  for (let f = 150; f <= fmax; f += 10) {
    const w = 2 * Math.PI * f / dsr; let re = 1, im = 0;
    for (let k = 1; k <= p; k++) { re += aC[k] * Math.cos(-w * k); im += aC[k] * Math.sin(-w * k); }
    mags.push({ f, m: 1 / Math.sqrt(re * re + im * im) });
  }
  for (let i = 2; i < mags.length - 2; i++)
    if (mags[i].m > mags[i - 1].m && mags[i].m >= mags[i + 1].m && mags[i].m > mags[i - 2].m) peaks.push(mags[i].f);
  return peaks;
}

// cluster per-window peak lists (within 15%), keep clusters ≥2 windows agree
// on, then enforce physical separation: two formants are never < max(150 Hz,
// 20%) apart — a violator is an LPC harmonic bump riding beside the real
// resonance, and the better-supported cluster wins.
function clusterPeaks(windows) {
  const clusters = [];
  for (const w of windows) for (const f of w) {
    const c = clusters.find(c => Math.abs(f - c.center) / c.center < 0.15);
    if (c) { c.fs.push(f); c.fs.sort((a, b) => a - b); c.center = c.fs[Math.floor(c.fs.length / 2)]; }
    else clusters.push({ center: f, fs: [f] });
  }
  const kept = [];
  for (const c of clusters.filter(c => c.fs.length >= 2).sort((a, b) => a.center - b.center)) {
    const last = kept[kept.length - 1];
    if (last && c.center - last.center < Math.max(150, last.center * 0.2)) {
      if (c.fs.length > last.fs.length) kept[kept.length - 1] = c;
    } else kept.push(c);
  }
  return kept.map(c => c.center);
}

// linear resample to a fixed analysis rate — LPC peak resolution is rate-
// sensitive at the margins, so all vowel measurement runs at ONE rate
const ANALYSIS_SR = 11025;
function toAnalysisRate(x, sr) {
  if (sr === ANALYSIS_SR) return x;
  // anti-alias FIRST (moving average over the decimation width — without it
  // an exact-ratio "resample" is raw subsampling, and folded-down HF buries
  // the mid formants), then linear-interpolate to the analysis rate
  const dec = Math.max(1, Math.round(sr / ANALYSIS_SR));
  const pre = new Float32Array(x.length);
  let acc = 0;
  for (let i = 0; i < x.length; i++) { acc += x[i]; if (i >= dec) acc -= x[i - dec]; pre[i] = acc / Math.min(i + 1, dec); }
  const ratio = ANALYSIS_SR / sr, n = Math.max(1, Math.floor(x.length * ratio));
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = i / ratio, j = Math.floor(s), f = s - j;
    y[i] = (pre[j] || 0) * (1 - f) + (pre[j + 1] || 0) * f;
  }
  return y;
}

/** Vowel formants, robustly, in two regimes — rate-independent (analyzed at
 *  a fixed 11 kHz) and VOICED-GATED (a window in the fade-out tail hands LPC
 *  garbage, so windows quieter than 0.3× the loudest are dropped). Full-band
 *  LPC (order 16) over the surviving windows, clustered, is the default —
 *  reliable for open vowels and front F2. Its one blind spot: a round back
 *  vowel's tightly-spaced F1+F2 merge into one peak (the signature: low
 *  "F1", next peak implausibly >1500). There a LOW band (≤2.4 kHz, order 10
 *  — more poles just model glottal harmonics) resolves the pair; it is
 *  consulted ONLY on that signature and adopted only when its two peaks sit
 *  <1200 Hz, plausibly separated, with the first corroborating full-band F1.
 *  Returns up to [F1, F2, F3]. */
export function measureVowelFormants(x, sr, ats = [0.25, 0.35, 0.45, 0.55, 0.65]) {
  const y = toAnalysisRate(x, sr);
  const rms = ats.map(at => {
    const a = Math.floor(y.length * at), b = Math.min(y.length, a + Math.floor(0.04 * ANALYSIS_SR));
    let s = 0; for (let i = a; i < b; i++) s += y[i] * y[i];
    return Math.sqrt(s / Math.max(1, b - a));
  });
  const rmax = Math.max(...rms);
  const use = ats.filter((_, i) => rms[i] > 0.3 * rmax);
  const full = clusterPeaks(use.map(at => estimateFormants(y, ANALYSIS_SR, at, 1, 16, 4500).filter(f => f >= 180)));
  const merged = full.length >= 2 && full[0] < 550 && full[1] > 1500;
  if (merged) {
    const low = clusterPeaks(use.map(at => estimateFormants(y, ANALYSIS_SR, at, 2, 10, 2400).filter(f => f >= 180)));
    if (low.length >= 2 && low[0] < 1200 && low[1] < 1200 && low[1] > low[0] * 1.5
      && Math.abs(low[0] - full[0]) / full[0] < 0.25) {
      const F3 = full.find(f => f > low[1] + 300);
      return F3 ? [low[0], low[1], F3] : [low[0], low[1]];
    }
  }
  return full.slice(0, 3);
}

/** 16-bit mono PCM WAV */
export function writeWav(path, x, sr) {
  const n = x.length, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, x[i])); buf.writeInt16LE((s * 32767) | 0, 44 + i * 2); }
  writeFileSync(path, buf);
}
