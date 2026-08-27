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

import { TONE_SHAPES, DEFAULT_PROS, DEFAULT_ACCENT } from "./languagePhonetics.js";
import { VOWEL_CAL } from "./vocalTractCal.js";
import { FORMANT_VOWELS } from "./formantVowelCal.js";

const F0_BASE = 105;               // speaker's base pitch (a deeper male voice reads less "high")

/**
 * The range a voice can actually sing, in hertz.
 *
 * A larynx is a body like any other, and it has a compass for the same reason
 * a flute does: the folds can be lengthened and thinned only so far. That span
 * is about two octaves, and a speaker sits near the BOTTOM of it rather than in
 * the middle — talking is done with slack folds. What differs between peoples
 * is not the span, which is muscle, but where it sits — and the language
 * already carries that, because every tongue has its own pitch frame and a
 * people sings from the voice it speaks with.
 */
export function voiceRange(pros) {
  const speak = F0_BASE * ((pros && pros.f0k) || 1);
  const low = speak * 0.8;                        // a speaker stands a little above their floor
  return { low, top: low * 4 };                   // two octaves of usable fold length
}
const N = 44;                      // tract sections (glottis at 0, lips at N-1)
const BLADE_START = 10, TIP_START = 32, LIP_START = 39;
const NOSE_LENGTH = 28, NOSE_START = N - NOSE_LENGTH + 1;   // 17
const LIP_REFLECTION = -0.85;
// Loss knobs set the formant bandwidths: a near-closed glottis (high
// reflection) and light per-section damping keep the resonances sharp enough
// to read as distinct vowels. Exposed for the calibration harness.
// hfOpen/hfTight/hfThresh: the per-section HF loss is LOCAL, like the wall
// loss — strong only beside a near-closure (whose tiny cavity is what rings
// up) and nearly transparent in the open tube. The old uniform hf=0.92
// cascaded over ~44 sections into a ~2 kHz treble ceiling that mushed every
// sibilant and collapsed place distinctions ("everything sounds the same").
const DSP = { glottalRefl: 0.9, damp: 0.997, radiation: 0.8, wallLoss: 1.3, wallThresh: 0.03, hfOpen: 0.995, hfTight: 0.85, hfThresh: 0.06 };
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
  const hfA = new Float64Array(N).fill(DSP.hfOpen);                 // per-section HF loss (tight beside a closure)
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
    // NO LARYNX HEIGHT CONTROL, and it is worth saying why rather than leaving
    // the gap. A trained singer drops the larynx, which decouples the short
    // tube above the folds and lets it ring near three kilohertz — the
    // singer's formant, and the reason one voice carries over an orchestra. I
    // built the gesture and measured it: widening the pharynx costs five to
    // ten decibels in that band rather than gaining, because the effect
    // depends on the piriform sinuses and the epilaryngeal tube, and a uniform
    // forty-four-section tube with a smooth tongue hump has neither. A control
    // that does the opposite of its name is worse than no control.
    //
    // What does work here, and is the other half of how a singer is heard, is
    // the glottis: singing closes the folds more abruptly than speech, which
    // measured on this model puts nearly nine decibels more energy at three
    // kilohertz. That lives in scoreSong.
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
      hfA[i] = DSP.hfOpen - (DSP.hfOpen - DSP.hfTight) * clamp((DSP.hfThresh - minA) / DSP.hfThresh, 0, 1);
    }
    noseDiameter[0] = Math.max(0.01, p.velum);
    noseAnew[0] = noseDiameter[0] * noseDiameter[0];
  }

  // one waveguide tick — the passive PRESSURE junction: node pressure is the
  // area-weighted mean of the incoming waves, out = P − in. A sealed nasal
  // port (area→0) then contributes nothing, which is exactly what keeps the
  // velar branch from pumping energy. lambda ramps areas old→new across a
  // block so posture changes don't zipper.
  function step(glottal, turbL, turbH, lambda, p, lipOut) {
    // turbulence injected at the tight constriction (fricatives, bursts) and a
    // breath source near the glottis (/h/, aspirated release). The noise
    // COLOUR follows the source: a sibilant jet against the teeth is
    // high-frequency-weighted, a breathy glottis is not — p.sibilance mixes
    // the low-passed and residual-high-passed streams per gesture.
    const inject = (index, gain, dia, nzv) => {
      if (gain <= 0 || index < 1 || index > N - 2) return;
      const thin = clamp(5 * (0.85 - dia), 0, 1);
      const open = clamp(15 * (dia - 0.02), 0, 1);
      const nz = nzv * gain * thin * open;
      const i = Math.floor(index), f = index - i;
      R[i] += nz * (1 - f) * 0.5; L[i] += nz * (1 - f) * 0.5;
      R[i + 1] += nz * f * 0.5; L[i + 1] += nz * f * 0.5;
    };
    const fricNz = turbL * (1 - p.sibilance) + turbH * 1.8 * p.sibilance;
    if (p.fricative > 0 && p.constrIndex >= 0) inject(p.constrIndex, p.fricative, diameter[clamp(Math.round(p.constrIndex), 1, N - 2)], fricNz);
    if (p.aspiration > 0) inject(2, p.aspiration, diameter[2], turbL);

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
    for (let k = 0; k < N; k++) {
      let r = jR[k] * wall[k], l = jL[k + 1] * wall[k];
      RlpS[k] += hfA[k] * (r - RlpS[k]); r = RlpS[k];
      LlpS[k] += hfA[k] * (l - LlpS[k]); l = LlpS[k];
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
  sibilance: 0,
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
  // Vocal naturalness: a real larynx never repeats itself — cycle-to-cycle
  // pitch wobble (jitter), loudness wobble (shimmer) and a slower pitch
  // wander (drift) ride every voiced sound. Each is heavily low-passed
  // seeded noise (deterministic; a second stream so the timbre noise is
  // untouched), gain-compensated so the depths below are true std-devs.
  const nz2 = makeNoise((seed ^ 0x5bf03635) >>> 0);
  const lp = (fc) => { const a = Math.exp(-2 * Math.PI * fc / IR); return { a, g: Math.sqrt((1 + a) / (1 - a)) / Math.sqrt(1 / 3), s: 0 }; };
  const jit = lp(5), shim = lp(3.5), drift = lp(0.7);
  // A SINGER HOLDS PITCH; A SPEAKER WANDERS. The slow drift and the
  // cycle-to-cycle jitter are what make speech sound like a person rather than
  // a machine, and on a sung line they are the tuning error. Measured on a
  // nine-note phrase with the vibrato switched off, so nothing else is moving
  // the pitch: the speech settings land each note 13.7 cents from where it was
  // asked for (worst 23) and let it wander 40.7 cents WITHIN the note (worst
  // 70) — which is a third of a semitone of drift inside one held note, and
  // audibly sour against instruments that are not drifting with it. The sung
  // settings give 2.4 cents and 9.1. Singing keeps the shimmer, cuts the
  // jitter, and nearly removes the drift, because holding a note steady enough
  // to be in tune with other people is the thing a singer has practised and a
  // talker has not.
  const sung = !!score.sung;
  const JIT_D = sung ? 0.0022 : 0.008;
  const SHIM_D = sung ? 0.045 : 0.06;
  const DRIFT_D = sung ? 0.0018 : 0.012;
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
      jit.s = jit.a * jit.s + (1 - jit.a) * nz2();
      shim.s = shim.a * shim.s + (1 - shim.a) * nz2();
      drift.s = drift.a * drift.s + (1 - drift.a) * nz2();
      glo.freq = (p0f + (p1f - p0f) * lambda) * (1 + JIT_D * jit.g * jit.s + DRIFT_D * drift.g * drift.s);
      glo.tenseness = p0t + (p1t - p0t) * lambda;
      glo.intensity = p0i + (p1i - p0i) * lambda;
      glo.setLoudness();
      const nz = noise();
      const glottal = glo.step(nz) * (1 + SHIM_D * shim.g * shim.s);
      // split the turbulence into a band-limited body and its high residual —
      // the injection site mixes them by sibilance (a /s/ jet is bright, a
      // breath is not); full-band white alone made bursts an ~11 kHz click
      const wT = noise();
      turbLP = 0.4 * turbLP + 0.6 * wT;
      const turbHP = wT - turbLP;
      tr.step(glottal, turbLP, turbHP, lambda, pmid, lipOut);
      let v = lipOut.lip + lipOut.nose;
      tr.step(glottal, turbLP, turbHP, lambda, pmid, lipOut);
      v += lipOut.lip + lipOut.nose;
      out[i + s] = v * 0.125;
    }
    tr.commit();
  }
  // DC-block (the per-section HF loss already warms the timbre)
  let y = 0, xprev = 0;
  for (let i = 0; i < len; i++) { const x = out[i]; y = x - xprev + 0.996 * y; xprev = x; out[i] = y; }
  // Level management. The sustained VOICE should set the loudness — not the
  // brief stop bursts or the higher-gain constricted vowels, which are several
  // times louder in the raw waveguide and, under peak normalization, crushed
  // every open vowel to near-silence. A gentle compressor rides a fast-attack /
  // slow-release envelope toward a target so quiet and loud segments even out;
  // a smooth downward expander (not a hard gate — that clicked) hushes the
  // silences between segments. Output stays LINEAR in the normal range so there
  // is no pervasive tanh distortion (the buzzy edge); only true peaks soft-limit.
  // FLOOR raised from 0.085: over-boosting quiet spans flattened the
  // amplitude contour that carries articulation rhythm — consonants read
  // as loud as vowels and the word smeared into one level mush
  const TARGET = 0.22, FLOOR = 0.12;
  const ATT = Math.exp(-1 / (0.004 * IR)), REL = Math.exp(-1 / (0.09 * IR));
  let env = 0;
  for (let i = 0; i < len; i++) {
    const a = Math.abs(out[i]);
    env = a > env ? ATT * env + (1 - ATT) * a : REL * env + (1 - REL) * a;
    const gate = env >= 0.03 ? 1 : env <= 0.006 ? 0.06 : 0.06 + 0.94 * (env - 0.006) / 0.024;
    const v = out[i] * (gate * TARGET / Math.max(env, FLOOR));
    out[i] = Math.abs(v) < 0.6 ? v : Math.sign(v) * (0.6 + 0.4 * Math.tanh((Math.abs(v) - 0.6) / 0.4));
  }
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
// tongue posture for a vowel: backness → position (front vowels sit forward,
// toward the palate), height → how close the tongue rides to the roof.
function vowelPosture(v) {
  const back = v.b || 0, height = v.h || 0;
  let tongueIndex, tongueDiameter, lip, constrIndex = -1, constrDiameter = 3;
  // CALIBRATED posture, when this quality was fitted against the recorded
  // phone bank (vocalTractCal.js): tongue place/height, lip rounding, and the
  // optional helper constriction all come from the fit. A lax (−ATR) quality
  // without its own fit borrows the tense posture plus the analytic laxing
  // delta; a quality with no entry at all falls back to the analytic formula.
  const cal = VOWEL_CAL[`${height},${back},${v.r ? 1 : 0},${v.atr ? 1 : 0}`]
    || (v.atr ? VOWEL_CAL[`${height},${back},${v.r ? 1 : 0},0`] : null);
  if (cal) {
    tongueIndex = cal.ti; tongueDiameter = cal.td; lip = cal.lip;
    if (cal.cd < 3) { constrIndex = cal.ti; constrDiameter = cal.cd; }
    if (v.atr && !VOWEL_CAL[`${height},${back},${v.r ? 1 : 0},1`]) { tongueDiameter += 0.25; tongueIndex += 0.6; }
  } else {
    // tongue hump position: front vowels forward (palatal), close back vowels at
    // the velum, and LOW vowels retracted into the pharynx (that wide back cavity
    // is what opens F1). So the high point moves with BOTH height and backness.
    tongueIndex = height === 2
      ? (back === 0 ? 16 : back === 2 ? 11 : 13)               // low: pharyngeal-ish
      : (back === 0 ? 27 : back === 2 ? 19 : 20);              // close/mid: palatal / velar / central
    tongueDiameter = height === 0 ? 2.1 : height === 1 ? 2.6 : 3.0;
    if (v.atr) { tongueDiameter += 0.25; tongueIndex += 0.6; } // −ATR: laxer, a touch fronter
    lip = v.r ? 0.95 : 0;
    // a smooth hump alone can't pull F2 down for close back/round vowels — add a
    // constriction co-located with the tongue (that's how /u/ gets its low F2:
    // a long front cavity behind rounded lips). Front /i/ needs no help.
    if ((height === 0 && (back >= 1 || v.r)) || (height === 1 && v.r)) { constrIndex = tongueIndex; constrDiameter = height === 0 ? 0.65 : 0.78; }
  }
  const velum = v.n ? 0.4 : 0.01;
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
function scoreCons(B, c, t, kpts, final, acc = DEFAULT_ACCENT) {
  const p = Math.min(c.p, 8);
  const place = (PLACE_INDEX[p] ?? 33) + (acc.dental && p === 1 ? 2.5 : 0);   // dental habit: coronals forward
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
    B.to("fricative", t, glottalH ? 0 : (sib ? 0.7 : 0.5) * (voicedBar ? 0.85 : 1), 0.015);
    B.set("sibilance", t, glottalH ? 0 : sib ? 1 : 0.4);
    if (voicedBar) layF0(B, t, dur, kpts);
    B.to("fricative", t + dur, 0, 0.02); B.to("aspiration", t + dur, 0, 0.02);
    B.set("sibilance", t + dur, 0);
    B.to("constrDiameter", t + dur, 1.6, trans);
    return dur;
  }
  if (c.m === 4) {                                            // LATERAL: a mid constriction, voiced
    const dur = 0.075;
    B.to("constrIndex", t, place, 0); B.to("constrDiameter", t, 0.38, trans);
    // dark coda ɫ: the tongue body backs toward the velum while the tip holds
    if (final && acc.darkL) { B.to("tongueIndex", t, 17.5, 0.025); B.to("tongueDiameter", t, 2.8, 0.025); }
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
    // burst colour follows place: a coronal release cracks bright, a labial
    // is duller, a dorsal duller still
    B.set("sibilance", t + dt, (p >= 1 && p <= 3) || p === 8 ? 0.8 : p === 0 ? 0.25 : 0.15);
    B.to("constrDiameter", t + dt, 0.3, 0.006);
    B.to("fricative", t + dt, ejective ? 0.36 : final ? 0.15 : 0.24, 0.003);
    if (!affric) B.to("fricative", t + dt + 0.009, 0, 0.012);
    B.to("constrDiameter", t + dt + 0.02, 1.6, 0.02);
  } else { B.to("constrDiameter", t + dt, 1.6, 0.02); }
  dt += 0.02;
  if (affric) { B.set("sibilance", t + dt, sib ? 1 : 0.4); B.to("constrDiameter", t + dt, sib ? 0.09 : 0.14, 0.008); B.set("fricative", t + dt, sib ? 0.7 : 0.5); B.to("fricative", t + dt + 0.07, 0, 0.02); B.to("constrDiameter", t + dt + 0.07, 1.6, 0.02); dt += 0.07; }
  B.set("sibilance", t + dt, 0);
  if (aspirated) {                                           // voiceless breath after the burst
    B.set("intensity", t + dt, 0); B.to("aspiration", t + dt, 0.5, 0.01);
    B.to("aspiration", t + dt + 0.05, 0, 0.02); dt += 0.055;
  } else if (c.m === 0 && c.l === 0 && !glottalStop && acc.vot > 0.25 && !final) {
    // VOT habit: a long-lag language puffs even its PLAIN voiceless stops
    const ad = 0.012 + 0.04 * acc.vot;
    B.set("intensity", t + dt, 0); B.to("aspiration", t + dt, 0.2 + 0.28 * acc.vot, 0.008);
    B.to("aspiration", t + dt + ad, 0, 0.015); dt += ad + 0.01;
  }
  void kMid;
  return dt;
}

// one vowel nucleus (a diphthong glides between the two qualities);
// `red` centralizes an unstressed vowel toward schwa (stress-timed reduction)
function scoreVowel(B, nu, t, kpts, dur, red = 0, open = 0) {
  const a = vowelPosture(nu[0]);
  // A vowel cannot be sung above its own first formant: F1 has to stay above
  // f0 or the tract has nothing to resonate the fundamental with, and the note
  // simply will not speak. Every singing tradition solves it the same way —
  // the jaw drops and the vowel migrates toward the open vowel of its own
  // backness. So this is not a style setting; it is the tract's own limit,
  // and it is why high notes sound more open than low ones everywhere.
  if (open > 0) {
    const o = vowelPosture({ ...nu[0], h: 2 });
    const k = Math.min(1, open);
    a.tongueIndex += (o.tongueIndex - a.tongueIndex) * k;
    a.tongueDiameter += (o.tongueDiameter - a.tongueDiameter) * k;
    a.lip += (o.lip - a.lip) * k;
    if (a.constrIndex >= 0) a.constrDiameter += (3 - a.constrDiameter) * k * 0.7;
  }
  if (red) {
    a.tongueIndex += (20 - a.tongueIndex) * red * 0.6;
    a.tongueDiameter += (2.6 - a.tongueDiameter) * red * 0.6;
    a.lip *= 1 - red * 0.6;
  }
  const b = nu.length > 1 ? vowelPosture(nu[1]) : null;
  const trans = Math.min(0.05, dur * 0.45);
  B.to("tongueIndex", t, a.tongueIndex, trans); B.to("tongueDiameter", t, a.tongueDiameter, trans);
  B.to("lip", t, a.lip, trans); B.to("velum", t, a.velum, trans);
  B.set("constrIndex", t, a.constrIndex);
  B.to("constrDiameter", t, a.constrIndex >= 0 ? a.constrDiameter : 3, trans);
  B.to("intensity", t, 1, 0.02); B.to("tenseness", t, a.tenseness, 0.03);
  if (nu[0].ph === 1) { B.to("aspiration", t, 0.28, 0.02); B.to("aspiration", t + dur, 0, 0.03); }
  const kf = a.fscale;
  layF0(B, t, dur, kpts.map(k => k * kf));
  if (b) {                                                   // glide toward the second target
    B.to("tongueIndex", t + dur * 0.45, b.tongueIndex, dur * 0.5);
    B.to("tongueDiameter", t + dur * 0.45, b.tongueDiameter, dur * 0.5);
    B.to("lip", t + dur * 0.45, b.lip, dur * 0.5);
  }
  return dur;
}

// one word plan → gestures appended to the builder, starting at time t
function scoreWord(B, plan, t, mod = {}) {
  const pros = plan.pros || DEFAULT_PROS;             // the language's own music
  const acc = plan.acc || DEFAULT_ACCENT;             // ...and its segmental habits
  const scale = mod.scale || 1;
  const nSyl = plan.syls.length;
  plan.syls.forEach((syl, i) => {
    // pitch: tone melody, else stress + declination (mirrors the formant engine)
    let kpts = plan.tone > 0 && syl.tone != null
      ? TONE_SHAPES[syl.tone].map(k => (1 + (k - 1) * pros.toneDepth) * scale)
      : (() => { const k = (1 + (i === plan.stress ? pros.stressGain - 1 : 0) - 0.1 * pros.range * (i / Math.max(1, nSyl))) * scale; return [k, k * 0.96]; })();
    if (plan.pitchAccent && i === plan.stress) kpts = kpts.map(k => k * (1 + 0.22 * pros.range));
    if (mod.boundary && i === nSyl - 1) {
      const tailK = kpts[kpts.length - 1];
      kpts = mod.boundary === "rise" ? [...kpts, tailK * (1 + 0.35 * pros.range)] : [...kpts, tailK * (1 - 0.28 * pros.range)];
    }
    kpts = kpts.map(k => k * pros.f0k);               // the language's pitch frame
    for (const c of syl.on) {
      t += scoreCons(B, c, t, kpts, false, acc) + 0.004;
      // ʲ/ʷ on-glide — phonemic (c.s), or the soft-consonant HABIT before a
      // front vowel (plain coronal/velar, scaled by the language's lean)
      const soft = !c.s && acc.soften > 0 && syl.nu.length && syl.nu[0].b === 0 && ((c.p >= 1 && c.p <= 4) || c.p === 8);
      if (c.s || soft) {
        const gv = c.s === 2 ? { h: 0, b: 2, r: 1 } : { h: 0, b: 0, r: 0 };
        const gp = vowelPosture(gv);
        const gd = c.s ? 0.03 : 0.02 * acc.soften;
        B.to("tongueIndex", t, gp.tongueIndex, 0.02); B.to("lip", t, gp.lip, 0.02);
        B.to("intensity", t, 1, 0.01); layF0(B, t, gd, kpts);
        t += gd + 0.004;
      }
    }
    if (syl.nu.length) {
      const v0 = syl.nu[0];
      // rhythm class: equal syllable beats, or stress beats crushing (and
      // reducing) the weak — the same rules the formant engine performs
      const stressed = plan.tone > 0 || i === plan.stress || nSyl === 1;
      const base = pros.rhythm === "syllable" ? 0.165 : stressed ? 0.2 : pros.rhythm === "stress" ? 0.12 : 0.15;
      const red = !stressed && syl.nu.length === 1 && !v0.lg ? pros.reduce : 0;
      let dur = base * (v0.lg ? 1.5 : 1) * (1 - red * 0.35) / pros.rate;
      dur *= i === nSyl - 1 ? (mod.final ? pros.finalLen : 1.06) : 1;
      t += scoreVowel(B, syl.nu, t, kpts, dur, red) + 0.004;
    }
    for (const c0 of syl.co) {
      // final devoicing habit: a word-final voiced obstruent hardens in speech
      const c = acc.finalDevoice && i === nSyl - 1 && c0.l === 1 && (c0.m === 0 || c0.m === 2 || c0.m === 3)
        ? { ...c0, l: 0 } : c0;
      t += scoreCons(B, c, t, kpts, true, acc) + 0.004;
    }
    // Voicing stays CONTINUOUS across syllable boundaries — fading to silence at
    // every seam chopped a word into disconnected syllables (the "chops"). Only
    // the word's final edge fades out; voiceless consonants make their own gaps.
    if (i === nSyl - 1) { B.to("intensity", t, 0, 0.03); t += 0.03; }
    else t += 0.012 / pros.rate;
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
      const pros = p.pros || DEFAULT_PROS;
      t = scoreWord(B, p, t, {
        scale: 1.05 - 0.12 * pros.range * (k / Math.max(1, total - 1)),
        boundary: i === g.length - 1 ? (lastG ? contour : "rise") : null,
        final: lastG && i === g.length - 1,
      }) + 0.08 / pros.rate;
      k++;
    });
    if (!lastG) t += 0.16;
  });
  return { dur: t + 0.04, tracks: B.tracks };
}

// ── singing ──────────────────────────────────────────────────────────────
// The voice is the one instrument every people has. It needs no ore, no
// timber and no craft; it is why the overwhelming majority of the world's
// music is sung, and why a tradition can exist with no built instrument at
// all. So a music engine that models bodies of bronze and gut but has no
// throat is missing the commonest instrument on earth.
//
// Singing is not a different machine from speech — it is this machine with
// two things changed, and they are the two that separate song from speech
// wherever it is done:
//
//   · THE VOWEL CARRIES THE NOTE. A consonant costs about what it costs
//     spoken: it is a gesture of tongue and lips, and those move at the speed
//     they move. Everything left of the note's length is vowel. A four-second
//     note is four seconds of vowel — which is exactly why sung words are so
//     much harder to make out than spoken ones.
//   · THE LARYNX FOLLOWS THE MELODY, not the sentence. Speech f0 is the
//     language's own prosody; here it is the pitch the composer asked for,
//     and the intrinsic pitch differences between vowels (real, and modelled,
//     in speech) are overridden — as a singer overrides them.
//
// Everything else falls out of physiology, not style: a larynx cannot step
// instantly, so notes are joined by a short glide; a held note acquires
// vibrato once it has spoken, at the rate the laryngeal muscles oscillate;
// and a vowel is opened until its first formant clears the note (scoreVowel).

/** F1 of a vowel quality, from the measured phone bank — the ceiling a sung
 *  note has to stay under before the jaw has to open. */
function vowelF1(v) {
  const k = `${v.h || 0},${v.b || 0},${v.r ? 1 : 0},${v.atr ? 1 : 0}`;
  const f = FORMANT_VOWELS[k] || FORMANT_VOWELS[`${v.h || 0},${v.b || 0},${v.r ? 1 : 0},0`];
  return f ? f[0] : [300, 500, 750][v.h || 0];
}

/**
 * Score a sung line. `syls` are this language's own syllables (the same
 * objects `phoneticPlan` produces); `notes` are `[{f, dur}]` in Hz and
 * seconds, one per syllable, from the composer.
 *
 * `vibrato` is a depth in cents. Rate is not a parameter: 5.5-6.5 Hz is what
 * the human larynx does, everywhere, and it is a fact about muscle, not about
 * a musical culture.
 */
export function scoreSong(syls, notes, opts = {}) {
  const B = makeBuilder();
  const acc = opts.acc || DEFAULT_ACCENT;
  const vibCents = opts.vibrato ?? 25;
  const port = Math.max(0.012, Math.min(0.09, opts.portamento ?? 0.035));
  const seed = (opts.seed >>> 0) || 12345;
  let x = seed;
  const rnd = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  const spans = [];                                   // [{t0, t1, f}] for the f0 track
  let t = 0.03, beat = 0.03;                          // where the voice IS · where the beat says it should be
  notes.forEach((nt, i) => {
    const syl = syls.length ? syls[i % syls.length] : { on: [], nu: [{ h: 2, b: 1, r: 0 }], co: [] };
    // consonants keep their spoken cost — the tongue does not slow down
    // because the note is long
    for (const c of syl.on || []) t += scoreCons(B, c, t, [1], false, acc) + 0.004;
    const coda = (syl.co || []).length;
    // A SINGER KEEPS TIME WITH THE ENSEMBLE. Budget the vowel against where
    // the BEAT says this note ends, not against the note's nominal length:
    // consonants and gesture seams that ran long then come out of this vowel
    // instead of pushing every note after it later. Measured before this, the
    // line ran four milliseconds late per note and NEVER caught up — 32 ms by
    // the end of an eight-note phrase, 128 ms over thirty-two, which is a
    // sixth of a beat of drag against an accompaniment that is not drifting.
    // After, the whole line lands within four milliseconds however long it is.
    // A real singer shortens the vowel; they do not arrive late and stay late.
    const vDur = Math.max(0.07, beat + nt.dur - t - coda * 0.075 - 0.008);
    const v0 = (syl.nu && syl.nu[0]) || { h: 2, b: 1, r: 0 };
    // open the vowel until its first formant clears the note being sung
    const open = Math.max(0, nt.f / (0.9 * vowelF1(v0)) - 1);
    const vStart = t;
    t += scoreVowel(B, syl.nu && syl.nu.length ? syl.nu : [v0], t, [1], vDur, 0, open) + 0.004;
    // A loud sung note is not a quiet one turned up: the folds close harder,
    // so the glottal pulse gets sharper and the tone gets brighter. That is
    // the same nonlinearity every driven instrument has, and it is the part
    // of dynamics an output gain cannot fake.
    // A SUNG NOTE IS NOT A SPOKEN ONE TURNED UP. Singing closes the folds
    // harder and more abruptly than speech, and the sharper the closure the
    // more of the spectrum it excites — measured on this tract, firming the
    // glottis lifts the three-kilohertz band by nearly nine decibels, which is
    // most of what makes a voice carry and most of what makes it read as sung
    // rather than said. `carry` is how much the singer has to be heard over.
    const firm = 1.12 + 0.22 * Math.max(0, Math.min(1, opts.carry ?? 0.4));
    if (nt.vel != null) {
      B.to("tenseness", vStart + 0.03,
        Math.min(0.96, B.cur.tenseness * firm * (0.88 + 0.24 * Math.min(1.4, nt.vel))), 0.06);
    }
    spans.push({ t0: vStart, t1: t, f: nt.f, first: i === 0 });
    for (const c of syl.co || []) t += scoreCons(B, c, t, [1], true, acc) + 0.004;
    beat += nt.dur;
    // LEGATO. Speech drops the voice to silence at every word edge; a sung
    // line does not — the phrase is one breath, and the voicing runs right
    // through it. Only the last note is released.
    if (i === notes.length - 1) { B.to("intensity", t, 0, 0.05); t += 0.05; }
  });

  // Now overwrite f0 outright: in song the melody IS the pitch track, so the
  // prosodic contour the gesture builders laid down is discarded rather than
  // blended — a singer does not also perform the sentence's intonation.
  const F = [];
  const push = (tt, v) => { if (F.length && F[F.length - 1].t >= tt) F[F.length - 1] = { t: tt, v }; else F.push({ t: tt, v }); };
  spans.forEach((sp, i) => {
    const prev = i > 0 ? spans[i - 1].f : sp.f;
    // the larynx glides into the note rather than stepping onto it; a bigger
    // leap takes proportionally longer, because it is more muscle to move
    const leap = Math.abs(Math.log2(sp.f / prev));
    const gl = sp.first ? 0 : Math.min(port * (0.6 + 1.6 * leap), (sp.t1 - sp.t0) * 0.4);
    if (gl > 0) push(sp.t0, prev);
    push(sp.t0 + gl, sp.f);
    // VIBRATO, once the note has spoken. It is late and it grows: a singer
    // does not begin a note with it, and a short note never acquires it.
    const hold = sp.t1 - sp.t0 - gl;
    if (vibCents > 1 && hold > 0.34) {
      const rate = 5.6 + rnd() * 0.9;
      const onset = sp.t0 + gl + 0.16;
      for (let tt = onset; tt < sp.t1; tt += 1 / (rate * 8)) {
        const grow = Math.min(1, (tt - onset) / 0.35);
        const cents = vibCents * grow * Math.sin(2 * Math.PI * rate * (tt - onset));
        push(tt, sp.f * Math.pow(2, cents / 1200));
      }
      push(sp.t1, sp.f);
    }
  });
  B.tracks.frequency = F.length ? F : [{ t: 0, v: notes[0] ? notes[0].f : F0_BASE }];
  return { dur: t + 0.05, tracks: B.tracks, sung: true };
}
