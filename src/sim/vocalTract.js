// ── Articulatory voice: a Kelly–Lochbaum waveguide vocal tract ────────────
//
// The formant synthesizer in the Lab paints the *effect* — it names three
// resonances and filters a buzz through them. This paints the *cause*: a
// one-dimensional model of the air column from glottis to lips, as ~44 tube
// sections whose cross-sectional AREA you set by moving a tongue and pinching
// a constriction. You never write down a formant; the resonances fall out of
// the tube's shape exactly as they do in a real mouth. That is the second
// cardinal rule in audio form — build the mechanism, and the sounds emerge.
//
// Because it is the mouth and not a formant table, the exotica come for free:
// a click is a rarefying closure, an ejective a compressed glottis, a nasal an
// open velar port, breathy/creaky voice a glottal setting — all just gestures,
// none hand-drawn per phoneme. Every control here is read straight off the
// phonology's OWN articulatory features (place, manner, laryngeal, tongue
// height/backness/rounding), the same bundles the sim stores.
//
// Pure, dependency-free, JSON-safe and deterministic (seeded noise, no
// Math.random): the sim stays silent; the Lab renders these samples OFFLINE
// into a buffer, so the identical code is exercisable headless under Node
// (tools/voice.mjs measures the formants it produces).
//
// The waveguide + LF-glottis DSP is a faithful port of Neil Thapen's
// public-domain Pink Trombone — a calibrated physical model. We reuse the
// physics and author only the feature→gesture mapping that drives it.

import { TONE_SHAPES } from "./languagePhonetics.js";

const F0_BASE = 105;               // speaker's base pitch (a deeper male voice reads less "high")
const N = 44;                      // tract sections (glottis at 0, lips at N-1)
const BLADE_START = 10, TIP_START = 32, LIP_START = 39;
const NOSE_LENGTH = 28, NOSE_START = N - NOSE_LENGTH + 1;   // 17
const LIP_REFLECTION = -0.85;
// Loss knobs set the formant bandwidths: a near-closed glottis (high
// reflection) and light per-section damping keep the resonances sharp enough
// to read as distinct vowels. `radiation` is the lip-radiation pre-emphasis
// coefficient (see renderScore) — the +6 dB/oct that turns raw tract pressure
// into a sound that reads as speech; 0 disables it. Exposed for the harness.
const DSP = { glottalRefl: 0.9, damp: 0.997, radiation: 0.97, wallLoss: 1.3, wallThresh: 0.03, hf: 0.92 };
// A hard ceiling on the travelling waves. Normal speech never exceeds ~5 here,
// so this is invisible in practice — but a driven closed cavity (a long voiced
// velar closure, where the constriction sits right against the velum) can ring
// up in the near-zero-area sections whose tiny energy weight lets amplitudes
// grow unbounded. The clamp guarantees that can never reach ±∞/NaN; the cavity
// simply saturates and recovers on release. Belt to the wall-loss braces.
const MAXW = 24;

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// seeded white noise in [-1,1] — the codebase's LCG, never Math.random
function makeNoise(seed) {
  let x = (seed >>> 0) || 1;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2147483648 - 1; };
}

// ── the LF glottal source (Liljencrants–Fant), voice quality from tenseness ─
// A physiological pulse, not a sawtooth: the whole point of the de-buzz. Low
// tenseness → breathy (more aspiration, softer close); high → pressed/creaky.
function makeGlottis(sampleRate) {
  const g = {
    freq: F0_BASE, tenseness: 0.6, intensity: 0, loudness: 1,
    timeInWaveform: 0, waveformLength: 1 / F0_BASE,
    alpha: 0, E0: 0, epsilon: 0, shift: 0, Delta: 1, Te: 0, omega: 0,
  };
  function setupWaveform() {
    g.waveformLength = 1 / g.freq;
    let Rd = 3 * (1 - g.tenseness);
    Rd = clamp(Rd, 0.5, 2.7);
    const Ra = -0.01 + 0.048 * Rd;
    const Rk = 0.224 + 0.118 * Rd;
    const Rg = (Rk / 4) * (0.5 + 1.2 * Rk) / (0.11 * Rd - Ra * (0.5 + 1.2 * Rk));
    const Ta = Ra, Tp = 1 / (2 * Rg), Te = Tp + Tp * Rk;
    const epsilon = 1 / Ta;
    const shift = Math.exp(-epsilon * (1 - Te));
    const Delta = 1 - shift;
    let RHSIntegral = (1 / epsilon) * (shift - 1) + (1 - Te) * shift;
    RHSIntegral /= Delta;
    const totalLowerIntegral = -(Te - Tp) / 2 + RHSIntegral;
    const totalUpperIntegral = -totalLowerIntegral;
    const omega = Math.PI / Tp;
    const s = Math.sin(omega * Te);
    const y = -Math.PI * s * totalUpperIntegral / (Tp * 2);
    const z = Math.log(y);
    const alpha = z / (Tp / 2 - Te);
    const E0 = -1 / (s * Math.exp(alpha * Te));
    g.alpha = alpha; g.E0 = E0; g.epsilon = epsilon; g.shift = shift;
    g.Delta = Delta; g.Te = Te; g.omega = omega;
  }
  function waveform(t) {
    const out = t > g.Te
      ? (-Math.exp(-g.epsilon * (t - g.Te)) + g.shift) / g.Delta
      : g.E0 * Math.exp(g.alpha * t) * Math.sin(g.omega * t);
    return out * g.intensity * g.loudness;
  }
  setupWaveform();
  g.step = (noise) => {
    g.timeInWaveform += 1 / sampleRate;
    if (g.timeInWaveform > g.waveformLength) { g.timeInWaveform -= g.waveformLength; setupWaveform(); }
    let out = waveform(g.timeInWaveform / g.waveformLength);
    // aspiration rides with voicing (breath through a barely-open glottis) —
    // kept low so modal vowels don't read as breathy/"wet"
    const voiced = 0.1 + 0.2 * Math.max(0, Math.sin(2 * Math.PI * g.timeInWaveform / g.waveformLength));
    const mod = g.tenseness * voiced + (1 - g.tenseness) * 0.3;
    out += g.intensity * Math.max(0, 0.82 - g.tenseness) * mod * noise * 0.11;
    return out;
  };
  g.setLoudness = () => { g.loudness = Math.pow(clamp(g.tenseness, 0, 1), 0.25); };
  return g;
}

// ── the tube: scattering junctions from the area function ─────────────────
function makeTract() {
  const diameter = new Float64Array(N), rest = new Float64Array(N);
  const Aold = new Float64Array(N), Anew = new Float64Array(N);     // section areas, prev/next block
  const R = new Float64Array(N), L = new Float64Array(N);           // right/left-going pressure waves
  const jR = new Float64Array(N + 1), jL = new Float64Array(N + 1);
  const noseR = new Float64Array(NOSE_LENGTH), noseL = new Float64Array(NOSE_LENGTH);
  const noseJR = new Float64Array(NOSE_LENGTH + 1), noseJL = new Float64Array(NOSE_LENGTH + 1);
  const noseDiameter = new Float64Array(NOSE_LENGTH);
  const noseAold = new Float64Array(NOSE_LENGTH), noseAnew = new Float64Array(NOSE_LENGTH);
  const wall = new Float64Array(N);                                 // per-section damping (heavier at a closure)
  const RlpS = new Float64Array(N), LlpS = new Float64Array(N);     // per-section HF-loss filter state

  for (let i = 0; i < N; i++) diameter[i] = rest[i] = i < 7 * N / 44 - 0.5 ? 0.6 : i < 12 * N / 44 ? 1.1 : 1.5;
  for (let i = 0; i < NOSE_LENGTH; i++) {
    const d = 2 * (i / NOSE_LENGTH);
    noseDiameter[i] = Math.min(d < 1 ? 0.4 + 1.6 * d : 0.5 + 1.5 * (2 - d), 1.9);
  }
  noseDiameter[0] = 0.01;
  for (let i = 0; i < NOSE_LENGTH; i++) noseAold[i] = noseAnew[i] = noseDiameter[i] * noseDiameter[i];

  const commit = () => { Aold.set(Anew); noseAold.set(noseAnew); };

  // build the area function from a posture (writes the NEXT block's areas)
  function shape(p) {
    for (let i = 0; i < N; i++) rest[i] = i < 7 * N / 44 - 0.5 ? 0.6 : i < 12 * N / 44 ? 1.1 : 1.5;
    // tongue: a smooth hump between blade and lips (Pink Trombone's curve)
    for (let i = BLADE_START; i < LIP_START; i++) {
      const t = 1.1 * Math.PI * (p.tongueIndex - i) / (TIP_START - BLADE_START);
      const fixed = 2 + (p.tongueDiameter - 2) / 1.5;
      let curve = (1.5 - fixed + 1.7) * Math.cos(t);
      if (i === BLADE_START - 2 || i === LIP_START - 1) curve *= 0.8;
      if (i === BLADE_START || i === LIP_START - 2) curve *= 0.94;
      rest[i] = 1.5 - curve;
    }
    for (let i = 0; i < N; i++) diameter[i] = Math.max(0, rest[i]);
    // the consonant constriction: a raised-cosine well, never wider than rest
    if (p.constrIndex >= 0 && p.constrDiameter < 1.6) {
      const width = 2.2;
      for (let i = 0; i < N; i++) {
        const dist = Math.abs(i - p.constrIndex);
        if (dist > width) continue;
        const w = 0.5 - 0.5 * Math.cos(Math.PI * (width - dist) / width);
        diameter[i] = Math.min(diameter[i], diameter[i] * (1 - w) + p.constrDiameter * w);
      }
    }
    // lip rounding narrows the mouth aperture
    if (p.lip > 0) for (let i = LIP_START; i < N; i++) diameter[i] = Math.max(0.3, diameter[i] * (1 - 0.62 * p.lip));
    // area floor keeps ΣA>0 at closure; wall loss rises sharply as a section
    // shuts (viscous loss at a near-closure), which also dissipates the energy
    // a hard closure would otherwise trap in the sealed cavity beyond it — the
    // passivity leak that made a nasal (an oral closure + open velum) blow up.
    for (let i = 0; i < N; i++) Anew[i] = Math.max(1e-6, diameter[i] * diameter[i]);
    // wall loss keyed to the NARROWEST area in a small neighbourhood, not just
    // the section's own: this damps the tiny high-Q cavity that forms right
    // beside a closure (the velar/uvular ring-up that glitched) LOCALLY, so the
    // rest of the tract stays bright — global HF loss alone dulled everything.
    for (let i = 0; i < N; i++) {
      let minA = Anew[i];
      for (let j = Math.max(0, i - 2); j <= Math.min(N - 1, i + 2); j++) if (Anew[j] < minA) minA = Anew[j];
      wall[i] = DSP.damp - DSP.wallLoss * clamp((DSP.wallThresh - minA) / DSP.wallThresh, 0, 1);
    }
    noseDiameter[0] = Math.max(0.01, p.velum);
    noseAnew[0] = noseDiameter[0] * noseDiameter[0];
  }

  // one waveguide tick — the passive PRESSURE junction: node pressure is the
  // area-weighted mean of the incoming waves, out = P − in. A sealed nasal
  // port (area→0) then contributes nothing, which is exactly what keeps the
  // velar branch from pumping energy. lambda ramps areas old→new across a
  // block so posture changes don't zipper.
  function step(glottal, turb, lambda, noise, p, lipOut) {
    // turbulence injected at the tight constriction (fricatives, bursts) and a
    // breath source near the glottis (/h/, aspirated release)
    const inject = (index, gain, dia) => {
      if (gain <= 0 || index < 1 || index > N - 2) return;
      const thin = clamp(5 * (0.85 - dia), 0, 1);
      const open = clamp(15 * (dia - 0.02), 0, 1);
      const nz = turb * gain * thin * open;
      const i = Math.floor(index), f = index - i;
      R[i] += nz * (1 - f) * 0.5; L[i] += nz * (1 - f) * 0.5;
      R[i + 1] += nz * f * 0.5; L[i + 1] += nz * f * 0.5;
    };
    if (p.fricative > 0 && p.constrIndex >= 0) inject(p.constrIndex, p.fricative, diameter[clamp(Math.round(p.constrIndex), 1, N - 2)]);
    if (p.aspiration > 0) inject(2, p.aspiration, diameter[2]);

    const mu = 1 - lambda;
    jR[0] = L[0] * DSP.glottalRefl + glottal;
    jL[N] = R[N - 1] * LIP_REFLECTION;
    for (let i = 1; i < N; i++) {
      const A0 = Aold[i - 1] * mu + Anew[i - 1] * lambda, A1 = Aold[i] * mu + Anew[i] * lambda;
      if (i === NOSE_START) {                                // velum: a 3-port with the nasal branch
        const AN = noseAold[0] * mu + noseAnew[0] * lambda;
        const P = 2 * (A0 * R[i - 1] + A1 * L[i] + AN * noseL[0]) / (A0 + A1 + AN);
        jL[i - 1] = P - R[i - 1]; jR[i] = P - L[i]; noseJR[0] = P - noseL[0];
      } else {
        const P = 2 * (A0 * R[i - 1] + A1 * L[i]) / (A0 + A1);
        jR[i] = P - L[i]; jL[i - 1] = P - R[i - 1];
      }
    }
    // frequency-dependent loss: a mild one-pole low-pass per section. Real
    // tracts damp high frequencies far faster than low, so this both warms the
    // timbre and, crucially, kills the ~8 kHz resonances of the tiny cavities
    // that back closures form against the velum — the runaway that fired the
    // clamp and glitched voiced velar/uvular sounds.
    const HF = DSP.hf;
    for (let k = 0; k < N; k++) {
      let r = jR[k] * wall[k], l = jL[k + 1] * wall[k];
      RlpS[k] += HF * (r - RlpS[k]); r = RlpS[k];
      LlpS[k] += HF * (l - LlpS[k]); l = LlpS[k];
      // soft (tanh) saturation, not a hard clip: a cavity that still rings up
      // rounds off smoothly instead of clicking. Linear for normal speech.
      R[k] = Math.abs(r) < 6 ? r : MAXW * Math.tanh(r / MAXW);
      L[k] = Math.abs(l) < 6 ? l : MAXW * Math.tanh(l / MAXW);
    }
    lipOut.lip = R[N - 1];
    // nose branch (fixed-area pressure 2-ports out to the nostril)
    noseJL[NOSE_LENGTH] = noseR[NOSE_LENGTH - 1] * LIP_REFLECTION;
    for (let k = 1; k < NOSE_LENGTH; k++) {
      const B0 = noseAnew[k - 1], B1 = noseAnew[k];
      const P = 2 * (B0 * noseR[k - 1] + B1 * noseL[k]) / (B0 + B1);
      noseJR[k] = P - noseL[k]; noseJL[k - 1] = P - noseR[k - 1];
    }
    for (let k = 0; k < NOSE_LENGTH; k++) {
      const r = noseJR[k] * DSP.damp, l = noseJL[k + 1] * DSP.damp;
      noseR[k] = Math.abs(r) < 6 ? r : MAXW * Math.tanh(r / MAXW);
      noseL[k] = Math.abs(l) < 6 ? l : MAXW * Math.tanh(l / MAXW);
    }
    lipOut.nose = noseR[NOSE_LENGTH - 1];
    void noise;
  }
  shape({ tongueIndex: 20, tongueDiameter: 2.6, constrIndex: -1, constrDiameter: 3, lip: 0, velum: 0.01, fricative: 0, aspiration: 0 });
  commit();
  return { shape, step, commit };
}

// linear interpolation over a sorted [{t,v}] breakpoint track
function sampleTrack(track, t, dflt) {
  if (!track || !track.length) return dflt;
  if (t <= track[0].t) return track[0].v;
  const last = track[track.length - 1];
  if (t >= last.t) return last.v;
  let lo = 0, hi = track.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (track[mid].t <= t) lo = mid; else hi = mid; }
  const a = track[lo], b = track[hi];
  const f = (t - a.t) / (b.t - a.t || 1);
  return a.v + (b.v - a.v) * f;
}

const DEFAULTS = {
  frequency: F0_BASE, tenseness: 0.6, intensity: 0, tongueIndex: 20, tongueDiameter: 2.6,
  constrIndex: -1, constrDiameter: 3, fricative: 0, aspiration: 0, velum: 0.01, lip: 0,
};

/** Render a score {dur, tracks} to mono Float32 PCM at `sampleRate`.
 *  Deterministic given seed. The waveguide is calibrated at a FIXED internal
 *  rate and the result resampled to the requested rate, so the formants land
 *  at the same frequencies on every device (a tube whose length is fixed in
 *  samples would shrink — and pitch up — at a higher output rate). */
export function renderScore(score, sampleRate = 44100, seed = 0x9e3779b9) {
  const IR = 44100;                                // internal DSP rate (tube + glottis calibrated here)
  const tail = Math.ceil(0.06 * IR);
  const len = Math.max(1, Math.ceil(score.dur * IR)) + tail;
  const out = new Float32Array(len);
  const noise = makeNoise(seed);
  const glo = makeGlottis(IR);
  const tr = makeTract();
  const tracks = score.tracks;
  const P = { ...DEFAULTS };
  const sampleAt = (t) => {
    for (const k in DEFAULTS) P[k] = sampleTrack(tracks[k], t, DEFAULTS[k]);
    return P;
  };
  const BLOCK = 128;
  const lipOut = { lip: 0, nose: 0 };
  let turbLP = 0;                                // one-pole low-pass state for turbulence noise
  for (let i = 0; i < len; i += BLOCK) {
    const blk = Math.min(BLOCK, len - i);
    // posture at the block's END drives the new reflections; glottis ramps
    const t0 = i / IR, t1 = (i + blk) / IR;
    const p0f = sampleTrack(tracks.frequency, t0, F0_BASE), p1f = sampleTrack(tracks.frequency, t1, F0_BASE);
    const p0t = sampleTrack(tracks.tenseness, t0, 0.6), p1t = sampleTrack(tracks.tenseness, t1, 0.6);
    const p0i = sampleTrack(tracks.intensity, t0, 0), p1i = sampleTrack(tracks.intensity, t1, 0);
    tr.shape(sampleAt(t1));
    // per-sample: interpolate glottis params, run glottis + two tract steps
    const pmid = sampleAt((t0 + t1) / 2);       // turbulence/aspiration for the block
    for (let s = 0; s < blk; s++) {
      const lambda = s / blk;
      glo.freq = p0f + (p1f - p0f) * lambda;
      glo.tenseness = p0t + (p1t - p0t) * lambda;
      glo.intensity = p0i + (p1i - p0i) * lambda;
      glo.setLoudness();
      const nz = noise();
      const glottal = glo.step(nz);
      // band-limit the turbulence: real frication/burst noise rolls off, not the
      // harsh full-band white that made stop bursts a ~11 kHz click
      turbLP = 0.4 * turbLP + 0.6 * noise();
      tr.step(glottal, turbLP, lambda, nz, pmid, lipOut);
      let v = lipOut.lip + lipOut.nose;
      tr.step(glottal, turbLP, lambda, nz, pmid, lipOut);
      v += lipOut.lip + lipOut.nose;
      out[i + s] = v * 0.125;
    }
    tr.commit();
  }
  // DC-block (the per-section HF loss already warms the timbre)
  let y = 0, xprev = 0;
  for (let i = 0; i < len; i++) { const x = out[i]; y = x - xprev + 0.996 * y; xprev = x; out[i] = y; }
  // LIP RADIATION. The sound radiated from the lips is ~the TIME-DERIVATIVE of
  // the tract pressure — a +6 dB/oct high-pass (a one-zero pre-emphasis). This
  // is the missing physics that made the voice a dull, vowel-less hum: without
  // it the glottal source's steep −12 dB/oct tilt is never compensated and
  // F2/F3 sit 20–40 dB below the fundamental, so every vowel measures (and
  // sounds) nearly identical. With it, the formants stand proud and the vowels
  // separate. Energy-preserving make-up gain, so the leveler below is unaffected
  // (and it self-calibrates regardless). DSP.radiation = 0 disables it.
  if (DSP.radiation > 0) {
    let e0 = 0; for (let i = 0; i < len; i++) e0 += out[i] * out[i];
    let xp = 0; for (let i = 0; i < len; i++) { const x = out[i]; out[i] = x - DSP.radiation * xp; xp = x; }
    let e1 = 0; for (let i = 0; i < len; i++) e1 += out[i] * out[i];
    const g = Math.sqrt(e0 / (e1 || 1e-9)); for (let i = 0; i < len; i++) out[i] *= g;
  }
  // Level management, SELF-CALIBRATING. The sustained voice should set the
  // loudness — not the brief stop bursts or the higher-gain constricted vowels,
  // which are several times louder in the raw waveguide. A first pass finds THIS
  // utterance's own envelope peak; the compressor floor and the downward-expander
  // window are set RELATIVE to it, so the leveler tracks the signal instead of
  // hard-coded magnitudes (which silently broke the moment any upstream stage —
  // e.g. the radiation above — changed the absolute level). Output stays LINEAR
  // in range so there's no pervasive tanh distortion (the buzzy edge); only true
  // peaks soft-limit.
  const ATT = Math.exp(-1 / (0.004 * IR)), REL = Math.exp(-1 / (0.09 * IR));
  let env = 0, envMax = 1e-9;
  for (let i = 0; i < len; i++) { const a = Math.abs(out[i]); env = a > env ? ATT * env + (1 - ATT) * a : REL * env + (1 - REL) * a; if (env > envMax) envMax = env; }
  const LEVEL = 0.5 * envMax;                                    // level voiced segments toward half the utterance's own peak
  const FLOOR = 0.2 * envMax;                                    // caps make-up gain at LEVEL/FLOOR = 2.5× — no transient blow-up
  const gOpen = 0.10 * envMax, gShut = 0.02 * envMax;            // downward-expander window, relative to the peak
  env = 0;
  for (let i = 0; i < len; i++) {
    const a = Math.abs(out[i]);
    env = a > env ? ATT * env + (1 - ATT) * a : REL * env + (1 - REL) * a;
    const gate = env >= gOpen ? 1 : env <= gShut ? 0.05 : 0.05 + 0.95 * (env - gShut) / (gOpen - gShut);
    const v = out[i] * (gate * LEVEL / Math.max(env, FLOOR));
    out[i] = Math.abs(v) < 0.6 ? v : Math.sign(v) * (0.6 + 0.4 * Math.tanh((Math.abs(v) - 0.6) / 0.4));
  }
  // final peak-normalize to a consistent playback level (the absolute output no
  // longer depends on the arbitrary post-radiation scale — the leveler only had
  // to set the segment-to-segment BALANCE)
  let pk = 0; for (let i = 0; i < len; i++) { const a = Math.abs(out[i]); if (a > pk) pk = a; }
  if (pk > 1e-6) { const g = 0.9 / pk; for (let i = 0; i < len; i++) out[i] *= g; }
  if (sampleRate === IR) return out;
  // resample (linear) from the internal rate to the requested output rate
  const ratio = sampleRate / IR, outLen = Math.max(1, Math.round(len * ratio));
  const res = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i / ratio, j = Math.floor(src), f = src - j;
    res[i] = (out[j] || 0) * (1 - f) + (out[j + 1] || 0) * f;
  }
  return res;
}

// ── the feature→gesture mapping: where the tongue is, where the pinch is ──
// Constriction location along the tube by place of articulation (0=glottis
// end … 43=lips). These are ARTICULATORY positions, not tuned formant values —
// the resonances follow from where the air column narrows.
const PLACE_INDEX = { 0: 41, 8: 36, 1: 33, 2: 31, 3: 29, 4: 20, 5: 16, 6: 11, 7: 3 };
// tongue posture for a vowel — the articulatory vowel quadrilateral, from which
// the formants fall out. The two axes of the chart ARE the two axes of the tube:
//   backness → where the tongue hump sits → the front/back cavity split → F2
//   height   → how close the hump rides to the roof → the aperture → F1
// We set the ARTICULATION (tongue position + constriction) from those features;
// we never write a formant frequency. (index 0 = glottis … 43 = lips.)
function vowelPosture(v) {
  const back = v.b || 0, height = v.h || 0;
  // hump front↔back sets F2. A FORWARD hump (near the palate, high index) shrinks
  // the front cavity and RAISES F2 — that is what "front" means; a retracted hump
  // lengthens it and lowers F2. Low vowels pull the high point back and down.
  let tongueIndex = back === 0 ? 31 : back === 2 ? 15 : 21;    // palatal / velar / central
  if (height === 2) tongueIndex -= back === 0 ? 6 : back === 2 ? 3 : 4;   // low vowels retract
  // hump height sets F1. Close → tongue near the roof, small diameter, low F1;
  // open → tongue drops away, large diameter, high F1.
  let tongueDiameter = height === 0 ? 1.8 : height === 1 ? 2.5 : 3.15;
  if (v.atr) { tongueDiameter += 0.3; tongueIndex -= 0.6; }    // −ATR: laxer, a touch centralized
  const lip = v.r ? 0.95 : 0;
  const velum = v.n ? 0.4 : 0.01;
  // A smooth hump alone barely moves F2 (proven: every vowel collapsed to
  // F2≈850). A co-located constriction sharpens the cavity split that MAKES the
  // F2 contrast: FRONT close/mid vowels get a PALATAL channel that raises F2
  // (the mechanism /i/ was missing); BACK close/mid + round get a VELAR pinch
  // that lowers it (how /u/,/o/ get their low F2). Open (low) vowels stay
  // unconstricted — one wide cavity, high F1, F2 wherever the hump leaves it.
  // The constriction's LOCATION (= the hump: forward for front, retracted for
  // back) decides whether it raises or lowers F2, so the SAME tightness gives a
  // front vowel a high F2 and a back vowel a low one — the front/back split is
  // carried by WHERE, not how much. Tightness scales with height (a close vowel
  // pinches harder). Only the fully-open central vowel (/a/) stays unconstricted,
  // a single wide cavity.
  let constrIndex = tongueIndex;
  let constrDiameter = height === 0 ? 0.62 : height === 1 ? 0.9 : 1.15;
  if (back === 1 && height === 2) { constrIndex = -1; constrDiameter = 3; }
  let tenseness = 0.72, fscale = 1;                            // modal voice (less breathy = less "wet")
  if (v.ph === 1) tenseness = 0.4;                             // breathy
  else if (v.ph === 2) { tenseness = 0.9; fscale = 0.72; }     // creaky (drops pitch)
  return { tongueIndex, tongueDiameter, lip, velum, tenseness, fscale, constrIndex, constrDiameter };
}

// a builder that tracks each track's current value, so a gesture can slide
// from wherever the tract already is (coarticulation) to its target
function makeBuilder() {
  const tracks = {}; const cur = { ...DEFAULTS };
  for (const k in DEFAULTS) tracks[k] = [];
  const push = (name, t, v) => { const a = tracks[name]; if (a.length && a[a.length - 1].t >= t) a[a.length - 1] = { t, v }; else a.push({ t, v }); cur[name] = v; };
  return {
    tracks, cur,
    set: (name, t, v) => push(name, t, v),                    // step change
    to: (name, t, v, tr) => { if (tr > 0) push(name, t, cur[name]); push(name, t + Math.max(0, tr), v); },  // ramp from current
    hold: (name, t) => push(name, t, cur[name]),
  };
}

// f0 breakpoints for a vowel span, from the syllable's tone melody / stress
function layF0(B, t, dur, kpts) {
  const n = kpts.length;
  kpts.forEach((k, i) => B.set("frequency", t + dur * (i / Math.max(1, n - 1)), F0_BASE * k));
}

// one consonant gesture; returns the time it consumes
function scoreCons(B, c, t, kpts, final) {
  const p = Math.min(c.p, 8);
  const place = PLACE_INDEX[p] ?? 33;
  const sib = p >= 1 && p <= 3;
  const voicedBar = c.l === 1;
  const kMid = kpts[Math.floor(kpts.length / 2)] || 1;
  const trans = 0.028;

  if (c.m === 1) {                                            // NASAL: closure + open velum
    const dur = 0.085;
    B.to("constrIndex", t, place, 0); B.to("constrDiameter", t, 0.0, trans);
    B.to("velum", t, 0.42, trans); B.to("intensity", t, 1, 0.012);
    B.to("tenseness", t, 0.6, 0.02); B.set("fricative", t, 0); B.set("aspiration", t, 0);
    layF0(B, t, dur, kpts);
    B.to("constrDiameter", t + dur, 1.6, trans); B.to("velum", t + dur, 0.01, 0.05);
    return dur;
  }
  if (c.m === 2) {                                            // FRICATIVE: narrow gap + turbulence
    const dur = final ? 0.125 : 0.1;
    const glottalH = p === 7;                                 // /h/: breath through the open tract
    B.to("constrIndex", t, place, 0);
    B.to("constrDiameter", t, glottalH ? 1.4 : sib ? 0.09 : 0.14, trans);
    B.to("intensity", t, voicedBar ? 0.7 : 0, 0.015);
    B.to("tenseness", t, voicedBar ? 0.5 : 0.6, 0.02);
    if (glottalH) B.to("aspiration", t, 0.7, 0.015); else B.set("aspiration", t, 0);
    B.to("fricative", t, glottalH ? 0 : (sib ? 0.7 : 0.5) * (voicedBar ? 0.7 : 1), 0.015);
    if (voicedBar) layF0(B, t, dur, kpts);
    B.to("fricative", t + dur, 0, 0.02); B.to("aspiration", t + dur, 0, 0.02);
    B.to("constrDiameter", t + dur, 1.6, trans);
    return dur;
  }
  if (c.m === 4) {                                            // LATERAL: a mid constriction, voiced
    const dur = 0.075;
    B.to("constrIndex", t, place, 0); B.to("constrDiameter", t, 0.38, trans);
    B.to("intensity", t, 1, 0.012); B.to("tenseness", t, 0.6, 0.02);
    B.set("fricative", t, 0); B.set("aspiration", t, 0);
    layF0(B, t, dur, kpts);
    B.to("constrDiameter", t + dur, 1.6, trans);
    return dur;
  }
  if (c.m === 5) {                                            // RHOTIC: trill flutters, tap is brief
    const trill = p === 5 || p === 1;
    const dur = trill ? 0.09 : 0.05;
    B.to("constrIndex", t, place, 0);
    B.to("intensity", t, 1, 0.012); B.to("tenseness", t, 0.6, 0.02);
    B.set("fricative", t, 0); B.set("aspiration", t, 0);
    if (trill) {                                              // alternate near-closure and release
      const period = 0.02;
      for (let x = 0; x < dur; x += period) {
        B.to("constrDiameter", t + x, 0.16, period * 0.4);
        B.to("constrDiameter", t + x + period * 0.5, 0.7, period * 0.4);
      }
    } else B.to("constrDiameter", t, 0.3, 0.012);
    layF0(B, t, dur, kpts);
    B.to("constrDiameter", t + dur, 1.6, trans);
    return dur;
  }
  if (c.m === 6) {                                            // GLIDE: the corresponding vowel, gliding
    const dur = 0.06;
    const gv = p === 0 ? { h: 0, b: 2, r: 1 } : p === 4 ? { h: 0, b: 2, r: 0 } : { h: 0, b: 0, r: 0 };
    const post = vowelPosture(gv);
    B.to("tongueIndex", t, post.tongueIndex, trans); B.to("tongueDiameter", t, post.tongueDiameter, trans);
    B.to("lip", t, post.lip, trans); B.to("constrDiameter", t, 1.6, 0.01);
    B.to("intensity", t, 1, 0.012); B.to("tenseness", t, 0.6, 0.02);
    B.set("fricative", t, 0); B.set("aspiration", t, 0);
    layF0(B, t, dur, kpts);
    return dur;
  }
  // STOPS & AFFRICATES: closure → burst (→ frication tail / aspiration)
  const affric = c.m === 3;
  const ejective = c.l === 3;
  const aspirated = c.l === 2;
  const prenasal = c.l === 4;
  const glottalStop = p === 7;
  let dt = 0;
  if (prenasal) {                                            // a nasal murmur leads the closure
    B.to("velum", t, 0.42, 0.015); B.to("constrIndex", t, place, 0); B.to("constrDiameter", t, 0.0, 0.015);
    B.to("intensity", t, 1, 0.012); layF0(B, t, 0.05, kpts); dt += 0.05;
    B.to("velum", t + dt, 0.01, 0.02);
  }
  const closure = affric ? 0.03 : 0.045;
  B.to("constrIndex", t + dt, place, 0);
  B.to("constrDiameter", t + dt, glottalStop ? 0.0 : 0.0, 0.015);
  B.to("intensity", t + dt, voicedBar ? 0.45 : 0, 0.012);   // voice bar or silence
  B.to("tenseness", t + dt, voicedBar ? 0.5 : 0.6, 0.02);
  B.set("fricative", t + dt, 0); B.set("aspiration", t + dt, 0);
  if (voicedBar) layF0(B, t + dt, closure, kpts);
  dt += closure;
  if (ejective) { B.set("intensity", t + dt, 0); dt += 0.03; }   // glottal compression: a beat of silence
  // release burst: a short crack of turbulence as the constriction springs
  // open — RAMPED (an abrupt on/off step read as a click/chirp) and kept modest
  if (!glottalStop) {
    B.to("constrDiameter", t + dt, 0.3, 0.006);
    B.to("fricative", t + dt, ejective ? 0.36 : final ? 0.15 : 0.24, 0.003);
    if (!affric) B.to("fricative", t + dt + 0.009, 0, 0.012);
    B.to("constrDiameter", t + dt + 0.02, 1.6, 0.02);
  } else { B.to("constrDiameter", t + dt, 1.6, 0.02); }
  dt += 0.02;
  if (affric) { B.to("constrDiameter", t + dt, sib ? 0.09 : 0.14, 0.008); B.set("fricative", t + dt, sib ? 0.7 : 0.5); B.to("fricative", t + dt + 0.07, 0, 0.02); B.to("constrDiameter", t + dt + 0.07, 1.6, 0.02); dt += 0.07; }
  if (aspirated) {                                           // voiceless breath after the burst
    B.set("intensity", t + dt, 0); B.to("aspiration", t + dt, 0.5, 0.01);
    B.to("aspiration", t + dt + 0.05, 0, 0.02); dt += 0.055;
  }
  void kMid;
  return dt;
}

// one vowel nucleus (a diphthong glides between the two qualities)
function scoreVowel(B, nu, t, kpts, dur) {
  const a = vowelPosture(nu[0]);
  const b = nu.length > 1 ? vowelPosture(nu[1]) : null;
  const trans = Math.min(0.05, dur * 0.45);
  B.to("tongueIndex", t, a.tongueIndex, trans); B.to("tongueDiameter", t, a.tongueDiameter, trans);
  B.to("lip", t, a.lip, trans); B.to("velum", t, a.velum, trans);
  B.set("constrIndex", t, a.constrIndex);
  B.to("constrDiameter", t, a.constrIndex >= 0 ? a.constrDiameter : 3, trans);
  B.to("intensity", t, 1, 0.02); B.to("tenseness", t, a.tenseness, 0.03);
  if (nu[0].ph === 1) { B.to("aspiration", t, 0.28, 0.02); B.to("aspiration", t + dur, 0, 0.03); }
  // pitch is laid ONCE per syllable in scoreWord (a per-segment contour reset the
  // pitch upward at every seam — a sawtooth wobble); fscale is applied there too
  void kpts;
  if (b) {                                                   // glide toward the second target
    B.to("tongueIndex", t + dur * 0.45, b.tongueIndex, dur * 0.5);
    B.to("tongueDiameter", t + dur * 0.45, b.tongueDiameter, dur * 0.5);
    B.to("lip", t + dur * 0.45, b.lip, dur * 0.5);
  }
  return dur;
}

// one word plan → gestures appended to the builder, starting at time t
function scoreWord(B, plan, t, mod = {}) {
  const scale = mod.scale || 1;
  const nSyl = plan.syls.length;
  plan.syls.forEach((syl, i) => {
    const sylStart = t;
    // pitch: tone melody, else stress + declination (mirrors the formant engine)
    let kpts = plan.tone > 0 && syl.tone != null ? TONE_SHAPES[syl.tone].map(k => k * scale)
      : (() => { const k = (1 + (i === plan.stress ? 0.13 : 0) - 0.1 * (i / Math.max(1, nSyl))) * scale; return [k, k * 0.96]; })();
    if (plan.pitchAccent && i === plan.stress) kpts = kpts.map(k => k * 1.22);
    if (mod.boundary && i === nSyl - 1) {
      const tailK = kpts[kpts.length - 1];
      kpts = mod.boundary === "rise" ? [...kpts, tailK * 1.35] : [...kpts, tailK * 0.72];
    }
    const kf = syl.nu.length && syl.nu[0].ph === 2 ? 0.72 : 1;   // creaky nucleus drops the syllable's pitch
    for (const c of syl.on) {
      t += scoreCons(B, c, t, [], false) + 0.004;               // [] → pitch is laid once, below
      if (c.s) {                                             // ʲ/ʷ on-glide
        const gv = c.s === 1 ? { h: 0, b: 0, r: 0 } : { h: 0, b: 2, r: 1 };
        const gp = vowelPosture(gv);
        B.to("tongueIndex", t, gp.tongueIndex, 0.02); B.to("lip", t, gp.lip, 0.02);
        B.to("intensity", t, 1, 0.01);
        t += 0.034;
      }
    }
    if (syl.nu.length) {
      const long = syl.nu[0].lg;
      const dur = (i === plan.stress ? 0.19 : 0.15) * (long ? 1.5 : 1) * (i === nSyl - 1 ? 1.12 : 1);
      t += scoreVowel(B, syl.nu, t, [], dur) + 0.004;
    }
    for (const c of syl.co) t += scoreCons(B, c, t, [], true) + 0.004;
    // ONE smooth pitch contour across the whole syllable: laying it per-segment
    // reset the pitch upward at every seam (a sawtooth wobble — the "modulating").
    // Voiceless spans are silent, so a contour spanning them is inaudible; the
    // voiced parts trace a single continuous glide, and sampleTrack interpolates
    // smoothly across the syllable boundary (no step).
    layF0(B, sylStart, Math.max(0.001, t - sylStart), kpts.map(k => k * kf));
    // Voicing stays CONTINUOUS across syllable boundaries — fading to silence at
    // every seam chopped a word into disconnected syllables (the "chops"). Only
    // the word's final edge fades out; voiceless consonants make their own gaps.
    if (i === nSyl - 1) { B.to("intensity", t, 0, 0.03); t += 0.03; }
    else t += 0.012;
  });
  return t;
}

/** A single word plan → renderable score. */
export function scorePlan(plan) {
  const B = makeBuilder();
  const dur = scoreWord(B, plan, 0.03);
  return { dur: dur + 0.04, tracks: B.tracks };
}

/** A whole clause (groups of word plans) → renderable score, with the
 *  utterance-level declination, comma rises and final boundary tone. */
export function scoreClause(groups, contour = "fall") {
  const B = makeBuilder();
  let t = 0.03;
  const total = groups.reduce((a, g) => a + g.length, 0);
  let k = 0;
  groups.forEach((g, gi) => {
    const lastG = gi === groups.length - 1;
    g.forEach((p, i) => {
      t = scoreWord(B, p, t, {
        scale: 1.05 - 0.12 * (k / Math.max(1, total - 1)),
        boundary: i === g.length - 1 ? (lastG ? contour : "rise") : null,
      }) + 0.08;
      k++;
    });
    if (!lastG) t += 0.16;
  });
  return { dur: t + 0.04, tracks: B.tracks };
}
