// ── Rendering the instruments ────────────────────────────────────────────
//
// Every voice you hear is built from the SAME partial list that decided the
// culture's tuning (musicInstruments.js → musicTuning.js). That is the point
// of doing it this way: the spectrum is not a preset chosen to sound like a
// gong, it is the physics that also made this people's scale, so the causal
// chain is audible. Nothing is sampled; the page carries no audio assets.
//
// Two synthesis paths, picked by the body's own physics:
//   · near-harmonic bodies (strings, pipes, horns) → one PeriodicWave
//     oscillator carrying the exact measured partial amplitudes, with a
//     falling lowpass to model the faster damping of high modes.
//   · inharmonic bodies (bars, bells, gongs, plucked tongues, drums) → a
//     bank of sines, one per mode, each with its OWN decay. There is no
//     other honest way: their partials are not a series, and it is precisely
//     that fact the tuning derivation depends on.
//
// The sung voice reuses the measured human vowel formants the Language Lab's
// voice was calibrated against (formantVowelCal.js) — so when a people sings,
// it sings in its own tongue with the same mouth the speech engine uses.
import { FORMANT_VOWELS } from "./formantVowelCal.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Master chain: dry + a procedural room, with distance as a real filter. */
export function makeAudio(ctx) {
  const master = ctx.createGain(); master.gain.value = 0.85;
  const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 16000; tone.Q.value = 0.5;
  const dry = ctx.createGain(); dry.gain.value = 0.8;
  const wet = ctx.createGain(); wet.gain.value = 0.28;
  const verb = ctx.createConvolver(); verb.buffer = roomIR(ctx, 2.4, 2.6);
  master.connect(tone); tone.connect(dry); tone.connect(verb); verb.connect(wet);
  dry.connect(ctx.destination); wet.connect(ctx.destination);
  return { ctx, master, tone, dry, wet, verb };
}
/** A room, made of decaying noise — no impulse-response file to ship. */
function roomIR(ctx, secs, decay) {
  const n = Math.floor(ctx.sampleRate * secs);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 40 ? i / 40 : 1);
    }
  }
  return buf;
}
/** Distance: far away, a settlement's music is dark and mostly reflection. */
export function setDistance(A, intimacy) {
  const k = clamp(intimacy, 0, 1);
  A.tone.frequency.setTargetAtTime(1200 + 13000 * Math.pow(k, 1.35), A.ctx.currentTime, 0.12);
  A.wet.gain.setTargetAtTime(0.34 - 0.21 * k, A.ctx.currentTime, 0.12);
  A.dry.gain.setTargetAtTime(0.62 + 0.32 * k, A.ctx.currentTime, 0.12);
}

// PeriodicWave cache — building one per note would be wasteful
const WAVES = new WeakMap();
function waveFor(ctx, inst) {
  let byCtx = WAVES.get(ctx);
  if (!byCtx) { byCtx = new Map(); WAVES.set(ctx, byCtx); }
  if (byCtx.has(inst.id)) return byCtx.get(inst.id);
  const N = 32;
  const real = new Float32Array(N), imag = new Float32Array(N);
  for (const p of inst.partials) {
    const n = Math.round(p.r);
    if (n >= 1 && n < N) imag[n] += p.a;
  }
  const w = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  byCtx.set(inst.id, w);
  return w;
}

/** A short filtered noise transient: the mallet click, the pluck, the chiff.
 *  Onsets carry more identity than steady state — this is most of the realism. */
function transient(A, when, inst, freq, vel) {
  const { ctx } = A;
  const n = Math.floor(ctx.sampleRate * 0.06);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.9;
  bp.frequency.value = inst.drive === "breath" ? clamp(freq * 4, 900, 5000)
    : inst.drive === "strike" ? clamp(freq * 7, 1200, 8000)
    : inst.drive === "pluck" ? clamp(freq * 5, 900, 6000) : clamp(freq * 3, 600, 4000);
  const g = ctx.createGain();
  const amp = vel * (inst.drive === "strike" ? 0.32 : inst.drive === "pluck" ? 0.22 : 0.1);
  g.gain.setValueAtTime(amp, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.055);
  src.connect(bp); bp.connect(g); g.connect(A.master);
  src.start(when); src.stop(when + 0.07);
}

/**
 * Play one note of one instrument. `freq` is whatever the culture's scale
 * says — no note names, no MIDI, no twelve-tone grid anywhere in the path.
 */
export function playNote(A, inst, freq, when, dur, vel = 0.4, opts = {}) {
  const { ctx } = A;
  // PLAYERS DAMP. A bronze bar left alone rings for nine seconds; a player
  // laying down a melody on one stops it with the other hand before the next
  // note, or the line turns to porridge. So a struck body carrying a MELODIC
  // part rings for about as long as its note, while one struck for colour or
  // punctuation is left to ring out. Without this every metal tradition
  // sounds like a wash rather than a tune.
  const damp = opts.damp !== false && inst.kind !== "sustain" ? dur * 1.5 + 0.3 : Infinity;
  const f = freq * (1 + inst.detune + (opts.jitter ?? 0.0015) * (Math.random() - 0.5));
  if (!(f > 20 && f < 12000)) return;
  transient(A, when, inst, f, vel);

  if (inst.harmonic) {
    // Two oscillators a few cents apart, not one. A real string or pipe is
    // never a single perfectly periodic source — the body radiates slightly
    // detuned partials, two strings of a course are never exactly together,
    // and a player's tone wavers. One rigid oscillator sounds like a test
    // tone; a pair a few cents apart beats slowly against itself and reads as
    // an instrument. This is the cheapest large gain in the whole synth.
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const wv = waveFor(ctx, inst);
    osc.setPeriodicWave(wv); osc2.setPeriodicWave(wv);
    osc.frequency.value = f;
    osc2.frequency.value = f * (1 + (inst.kind === "sustain" ? 0.0035 : 0.0022));
    const g2 = ctx.createGain(); g2.gain.value = 0.45;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.4;
    const sustained = inst.kind === "sustain";
    const ring = sustained ? dur : Math.min(dur + inst.partials[0].d, inst.partials[0].d * 1.6, damp);
    const atk = sustained ? (inst.drive === "bow" ? 0.07 : 0.045) : 0.004;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vel), when + atk);
    if (sustained) {
      g.gain.setValueAtTime(Math.max(0.0002, vel), when + Math.max(atk, dur - 0.06));
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.09);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, when + ring);
    }
    lp.frequency.setValueAtTime(clamp(f * 14, 1500, 12000), when);
    lp.frequency.exponentialRampToValueAtTime(clamp(f * (sustained ? 9 : 3.2), 700, 11000), when + Math.min(ring, 1.4));
    // players are not machines: a breath or a bow wavers
    if (sustained) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 4.6 + Math.random() * 1.2;
      lg.gain.value = f * (inst.drive === "bow" ? 0.006 : 0.004);
      lfo.connect(lg); lg.connect(osc.frequency); lg.connect(osc2.frequency);
      lfo.start(when + 0.12); lfo.stop(when + dur + 0.12);
      // breath noise rides with the tone
      if (inst.drive === "breath") breath(A, when, dur, f, vel * 0.5);
    }
    osc.connect(lp); osc2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(A.master);
    osc.start(when); osc.stop(when + (sustained ? dur + 0.15 : ring) + 0.02);
    osc2.start(when); osc2.stop(when + (sustained ? dur + 0.15 : ring) + 0.02);
    return;
  }

  // inharmonic: each mode is its own decaying sine, exactly as measured
  const held = inst.kind === "sustain";
  for (const p of inst.partials) {
    const pf = f * p.r;
    if (pf > 13000 || p.a < 0.012) continue;
    const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = pf;
    const g = ctx.createGain();
    const ring = held ? dur + 0.1 : Math.max(0.08, Math.min(p.d, damp));
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vel * p.a), when + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, when + ring);
    osc.connect(g); g.connect(A.master);
    osc.start(when); osc.stop(when + ring + 0.02);
  }
  // a drumhead is mostly noise — the modes only colour it
  if (inst.fam === "drum" || inst.fam === "frameDrum") {
    const n = Math.floor(ctx.sampleRate * 0.3);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 5);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = clamp(f * 6, 200, 2600);
    const g = ctx.createGain(); g.gain.setValueAtTime(vel * 0.5, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.28);
    src.connect(lp); lp.connect(g); g.connect(A.master);
    src.start(when); src.stop(when + 0.32);
  }
}

function breath(A, when, dur, f, vel) {
  const { ctx } = A;
  const n = Math.floor(ctx.sampleRate * (dur + 0.1));
  if (n < 64) return;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.1; bp.frequency.value = clamp(f * 3, 800, 5000);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(vel * 0.16, when + 0.05);
  g.gain.setValueAtTime(vel * 0.16, when + Math.max(0.06, dur - 0.05));
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.05);
  src.connect(bp); bp.connect(g); g.connect(A.master);
  src.start(when); src.stop(when + dur + 0.1);
}

// ── the voice: this people's own language, sung ──────────────────────────
const vowelF = (v) => FORMANT_VOWELS[`${v.h},${v.b},${v.r ? 1 : 0},${v.atr ? 1 : 0}`]
  || FORMANT_VOWELS[`${v.h},${v.b},${v.r ? 1 : 0},0`]
  || [[300, 480, 720][v.h] || 480, v.b === 0 ? 2000 : v.b === 1 ? 1400 : 1000, 2600];

/** Sing one syllable at `freq`. Onset consonants get a real articulation —
 *  a burst or a hiss — so a sung line carries the language's own texture. */
export function playVoice(A, syl, freq, when, dur, vel = 0.4, opts = {}) {
  const { ctx } = A;
  const v = (syl && syl.nu && syl.nu[0]) || { h: 1, b: 1, r: 0, atr: 0 };
  const F = vowelF(v);
  const on = syl && syl.on && syl.on[0];
  const lead = on ? (on.m === 0 ? 0.045 : 0.06) : 0;      // stop burst vs continuant

  // glottal source: a sawtooth is a serviceable stand-in for the pulse train
  const osc = ctx.createOscillator(); osc.type = "sawtooth";
  const t0 = when + lead;
  osc.frequency.setValueAtTime(freq * 0.985, t0);
  osc.frequency.exponentialRampToValueAtTime(freq, t0 + 0.05);
  const vib = ctx.createOscillator(), vg = ctx.createGain();
  vib.frequency.value = 5.2; vg.gain.value = freq * 0.008;
  vib.connect(vg); vg.connect(osc.frequency);

  const src = ctx.createGain(); src.gain.value = 1;
  osc.connect(src);
  const sum = ctx.createGain();
  F.slice(0, 3).forEach((hz, i) => {
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass";
    bp.frequency.value = hz; bp.Q.value = [7, 9, 11][i];
    const g = ctx.createGain(); g.gain.value = [1, 0.62, 0.3][i];
    src.connect(bp); bp.connect(g); g.connect(sum);
  });
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, vel * 0.5), t0 + 0.05);
  amp.gain.setValueAtTime(Math.max(0.0002, vel * 0.5), when + Math.max(0.1, dur - 0.07));
  amp.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.05);
  sum.connect(amp); amp.connect(A.master);
  osc.start(t0); osc.stop(when + dur + 0.08);
  vib.start(t0); vib.stop(when + dur + 0.08);

  // the onset consonant, briefly
  if (on) {
    const n = Math.floor(ctx.sampleRate * 0.07);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (on.m === 0 ? Math.pow(1 - i / n, 6) : 1);
    const s2 = ctx.createBufferSource(); s2.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = on.m === 0 ? "bandpass" : "highpass";
    bp.frequency.value = on.p >= 1 && on.p <= 3 ? 4200 : 1600; bp.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.value = vel * (on.m === 0 ? 0.3 : 0.16);
    g.gain.setValueAtTime(vel * (on.m === 0 ? 0.3 : 0.16), when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + lead + 0.02);
    s2.connect(bp); bp.connect(g); g.connect(A.master);
    s2.start(when); s2.stop(when + lead + 0.03);
  }
}
