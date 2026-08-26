// ── Rendering the instruments ────────────────────────────────────────────
//
// Every voice is built from the SAME partial list that decided the culture's
// tuning (musicInstruments.js → musicTuning.js), so the causal chain is
// audible. Nothing is sampled; the page carries no audio assets.
//
// The signal path models the whole physical chain, which the first version
// did not:
//
//     exciter  →  vibrating element  →  radiating body  →  room
//
// The body (musicBody.js) is the stage that was missing, and its absence was
// the loudest synthetic tell: every filter used to track the played pitch, so
// the instrument was one timbre transposed across its range instead of one
// object being played. A body's resonances are fixed in absolute Hz.
//
// Three other things the first version got structurally wrong, all fixed here:
//
//   · DECAY. Scheduling `exponentialRampToValueAtTime(0.0001, when + ring)`
//     spreads about 78 dB of decay across the ring time, so the note is 20 dB
//     down a quarter of the way in and inaudible past half. Real decay is
//     exponential with a time constant: a T60 is the time to fall 60 dB, and
//     τ = T60/6.91 drives it. Bronze's nine-second ring can now actually
//     happen.
//   · DAMPING. A blanket `dur*1.5+0.3` cap turned a nine-second bronze bar
//     into a woodblock. Real practice damps the note being REPLACED and lets
//     everything else ring — which is exactly why those instruments sound
//     full, as overlapping decays accumulate into a bed. Damping is now a
//     scheduled gesture on a voice channel, not a cap at note-on.
//   · PER-PARTIAL DECAY. One gain node over a fixed PeriodicWave gives every
//     partial the same envelope, so the tone never changes colour as it
//     decays. Struck and plucked bodies now get one oscillator per mode with
//     its own time constant, which also lets real inharmonicity through — a
//     PeriodicWave is an exact harmonic series by definition.
import { FORMANT_VOWELS } from "./formantVowelCal.js";
import { buildBody } from "./musicBody.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU60 = 6.907755;                 // ln(1000): T60 → time constant

// Role balance, in dB relative to the melody. Without a bus per part every
// voice lands at the same level and the drum buries the tune.
const ROLE_DB = { lead: 0, voice: -1, het: -7, bass: -4, pad: -11, ost: -10, pulse: -7, mark: -6 };
const ROLE_PAN = { lead: 0, voice: 0, het: 0.4, bass: 0, pad: -0.15, ost: -0.35, pulse: 0.25, mark: -0.2 };
const dB = (d) => Math.pow(10, d / 20);

/** Master chain: role buses → limiter → soft clip, with a real room. */
export function makeAudio(ctx) {
  const out = ctx.createGain(); out.gain.value = 0.9;
  // A safety limiter, then a tanh soft-clip. Web Audio hard-clips at the
  // destination, and this graph sums dozens of voices; without these the
  // dense passages distort rather than getting loud.
  const comp = ctx.createDynamicsCompressor();
  // gentle: this is a safety limiter, not a loudness war. Squashing the crest
  // factor to under 10 dB makes a dense passage sound flat and tiring.
  comp.threshold.value = -8; comp.knee.value = 10; comp.ratio.value = 3.5;
  comp.attack.value = 0.005; comp.release.value = 0.15;
  // tanh(2.5x)/tanh(2.5) has a SMALL-SIGNAL GAIN of 2.5/tanh(2.5) = 2.53,
  // i.e. +8 dB, and it sat after the compressor and after the reverb sum —
  // several per cent of harmonic distortion plus intermodulation across
  // seventy simultaneous partials, on everything, all the time. A fuzz box
  // across the mix. Unity small-signal gain, ceiling below 1, oversampled.
  const shaper = ctx.createWaveShaper();
  const n = 2048, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(1.2 * x) / 1.2; }
  shaper.curve = curve; shaper.oversample = "4x";

  const master = ctx.createGain(); master.gain.value = 0.42;
  const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 16000; tone.Q.value = 0.5;
  const dry = ctx.createGain(); dry.gain.value = 0.78;
  const wet = ctx.createGain(); wet.gain.value = 0.26;
  // Pre-delay before the room: a real space returns its first reflection some
  // milliseconds after the direct sound, and that gap is what keeps a
  // reverberated source sounding present rather than smeared into the tail.
  const pre = ctx.createDelay(0.2); pre.delayTime.value = 0.028;
  const verbLo = ctx.createBiquadFilter(); verbLo.type = "highpass"; verbLo.frequency.value = 260;
  const verbHi = ctx.createBiquadFilter(); verbHi.type = "lowpass"; verbHi.frequency.value = 5200;
  const verb = ctx.createConvolver(); verb.buffer = roomIR(ctx, 2.8, 2.2);

  master.connect(tone);
  tone.connect(dry);
  tone.connect(pre); pre.connect(verbLo); verbLo.connect(verbHi); verbHi.connect(verb); verb.connect(wet);
  dry.connect(out); wet.connect(out);
  out.connect(comp); comp.connect(shaper); shaper.connect(ctx.destination);

  // one bus per role, panned so the parts occupy different places
  const buses = {};
  for (const [role, d] of Object.entries(ROLE_DB)) {
    const g = ctx.createGain(); g.gain.value = dB(d);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = ROLE_PAN[role] || 0; g.connect(pan); pan.connect(master); }
    else g.connect(master);
    buses[role] = g;
  }
  return { ctx, master, tone, dry, wet, verb, comp, buses, bodies: new Map(), voices: new Map() };
}
/** A room, made of decaying noise — no impulse response file to ship. The two
 *  channels are independent so the tail is wide rather than a point source. */
function roomIR(ctx, secs, decay) {
  const n = Math.floor(ctx.sampleRate * secs);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      // lowpass the noise so the tail darkens as it decays, as a real room does
      lp += ((Math.random() * 2 - 1) - lp) * (0.35 - 0.28 * t);
      d[i] = lp * Math.pow(1 - t, decay) * (i < 60 ? i / 60 : 1);
    }
  }
  return buf;
}
/** Distance: far away, a settlement's music is dark and mostly reflection. */
export function setDistance(A, intimacy) {
  const k = clamp(intimacy, 0, 1);
  A.tone.frequency.setTargetAtTime(1400 + 13000 * Math.pow(k, 1.35), A.ctx.currentTime, 0.12);
  A.wet.gain.setTargetAtTime(0.38 - 0.2 * k, A.ctx.currentTime, 0.12);
  A.dry.gain.setTargetAtTime(0.55 + 0.34 * k, A.ctx.currentTime, 0.12);
}

/** The instrument's body, built once and shared by every note it plays. */
function bodyFor(A, inst, role) {
  const key = inst.id + ":" + role;
  let b = A.bodies.get(key);
  if (!b) {
    b = buildBody(A.ctx, inst);
    b.output.connect(A.buses[role] || A.master);
    A.bodies.set(key, b);
  }
  return b;
}

/** The excitation: a short filtered noise burst. Onsets carry more instrument
 *  identity than steady state, and this one goes THROUGH the body like every
 *  other part of the sound, rather than around it. */
function transient(A, dest, when, inst, freq, vel) {
  const { ctx } = A;
  const n = Math.floor(ctx.sampleRate * 0.08);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // mallet or fingertip contact time is the physical lowpass on a strike:
  // a hard, brief contact excites high modes, a soft one does not
  const hard = inst.drive === "strike" ? 0.55 + 0.45 * vel : 0.3;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    lp += ((Math.random() * 2 - 1) - lp) * (0.1 + 0.8 * hard);
    d[i] = lp * Math.pow(1 - i / n, inst.drive === "breath" ? 2 : 5);
  }
  const src = ctx.createBufferSource(); src.buffer = buf;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.7;
  bp.frequency.value = clamp(freq * (inst.drive === "strike" ? 6 : 4), 700, 7000);
  const g = ctx.createGain();
  const amp = vel * (inst.drive === "strike" ? 0.34 : inst.drive === "pluck" ? 0.24 : 0.16);
  g.gain.setValueAtTime(amp, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + (inst.drive === "breath" ? 0.11 : 0.06));
  src.connect(bp); bp.connect(g); g.connect(dest);
  src.start(when); src.stop(when + 0.12);
}

/**
 * Play one note. `freq` is whatever the culture's scale says — no note names,
 * no MIDI, no twelve-tone grid anywhere in the path.
 *
 * Returns a handle so the caller can damp this note later, when a player's
 * hand would actually land on it.
 */
const STROKE_DSP = {
  bass: { pitch: 0.62, bright: 0.35, damp: 1.6 },
  open: { pitch: 1, bright: 0.75, damp: 1 },
  slap: { pitch: 1.5, bright: 1.5, damp: 0.45 },
  ghost: { pitch: 1.1, bright: 0.9, damp: 0.4 },
};

export function playNote(A, inst, freq, when, dur, vel = 0.4, opts = {}) {
  const { ctx } = A;
  const role = opts.role || "lead";
  // a stroke is a real change to how and where the body is struck, not a
  // preset: it moves the pitch the head speaks at, how much high-mode energy
  // the contact puts in, and how fast the hand takes it away again
  const K = STROKE_DSP[opts.stroke] || null;
  const f = freq * (K ? K.pitch : 1) * (1 + inst.detune + 0.004 * (Math.random() - 0.5));
  if (!(f > 20 && f < 12000)) return null;
  const body = bodyFor(A, inst, role);
  const dest = body.input;
  transient(A, dest, when, inst, f, vel);

  const sustained = inst.kind === "sustain";
  // A louder excitation is a BRIGHTER one, not merely a bigger one — striking
  // or plucking harder puts proportionally more energy into the high modes.
  // Velocity that only moves a gain is the flattest thing a synth can do.
  const tilt = (0.62 + 0.5 * vel) * (K ? K.bright : 1);
  const gate = ctx.createGain(); gate.gain.value = 1;
  // A tuned idiophone's resonator is a TUBE, tuned to that bar's own
  // fundamental — so model it as one, in the signal path. Scaling the mode
  // amplitudes by a pair of constants instead turned bar sets and plucked
  // tongues into literal sine waves, which is both why they sounded like test
  // tones and why their roughness curves had no minima left for the tuning to
  // find. A slight mistuning is inevitable in a hand-made tube, and the better
  // the craft the smaller it is.
  if (inst.reso) {
    const rz = ctx.createBiquadFilter(); rz.type = "bandpass";
    rz.frequency.value = clamp(f * (1 + inst.mistune), 20, 12000);
    rz.Q.value = 26;
    const rg = ctx.createGain(); rg.gain.value = 3.0;
    gate.connect(rz); rz.connect(rg); rg.connect(dest);
  }
  gate.connect(dest);
  const stops = [];

  if (sustained) {
    // A driven body does not decay per partial — it is held — so one wave
    // through the body is right, and cheap. Two oscillators a few cents apart:
    // no real string or pipe is a single perfectly periodic source.
    const wv = waveFor(ctx, inst, tilt);
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
    o1.setPeriodicWave(wv); o2.setPeriodicWave(wv);
    o1.frequency.value = f; o2.frequency.value = f * 1.0035;
    const g2 = ctx.createGain(); g2.gain.value = 0.42;
    const g = ctx.createGain();
    const atk = inst.drive === "bow" ? 0.09 : inst.drive === "breath" ? 0.07 : 0.05;
    const rel = 0.16;
    g.gain.setValueAtTime(0.0001, when);
    // a breath or bow OVERSHOOTS and settles rather than arriving flat
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vel * 1.14), when + atk);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vel), when + atk + 0.09);
    g.gain.setValueAtTime(Math.max(0.0002, vel), when + Math.max(atk + 0.1, dur));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur + rel);
    o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(gate);
    // A held note is never flat: pressure wanders, and vibrato comes in AFTER
    // the note has spoken, never at the attack, and not at all on short ones.
    if (dur > 0.28) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = 5.6 + 0.7 * Math.log2(Math.max(1, f / 220)) + (Math.random() - 0.5) * 0.5;
      lg.gain.setValueAtTime(0, when);
      lg.gain.setTargetAtTime(f * 0.0085, when + 0.18, 0.14);
      lfo.connect(lg); lg.connect(o1.frequency); lg.connect(o2.frequency);
      lfo.start(when); lfo.stop(when + dur + rel + 0.05); stops.push(lfo);
    }
    if (inst.drive === "breath" || inst.drive === "reed") breath(A, gate, when, dur, f, vel);
    o1.start(when); o1.stop(when + dur + rel + 0.05);
    o2.start(when); o2.stop(when + dur + rel + 0.05);
    stops.push(o1, o2);
  } else {
    // Struck and plucked: one oscillator PER MODE, each with its own time
    // constant. This is the only way to get per-partial decay (the tone
    // changes colour as it rings, which is most of what makes a struck note
    // sound alive) and the only way real inharmonicity survives at all — a
    // PeriodicWave is an exact harmonic series by definition.
    const modes = inst.partials.filter(p => p.r * f < 12000 && p.a > 0.008).slice(0, 12);
    // uncorrelated sources sum as √N, so hold perceived level constant
    // normalise by POWER, not by mode count: counting modes makes a near-sine
    // body several dB louder than a harmonically rich one at the same velocity
    const pw = modes.reduce((a, p) => a + p.a * p.a, 0) || 1;
    const norm = 1 / Math.sqrt(pw);
    modes.forEach((p, i) => {
      const pf = f * p.r;
      const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = pf;
      const g = ctx.createGain();
      // by FREQUENCY, not by array position — indexing the tilt by ordinal is
      // exactly the bug musicInstruments.modeAmps exists to avoid, and it was
      // reintroduced here. Clamped at 1 so velocity can only ever darken.
      const a = vel * p.a * Math.pow(Math.min(1, tilt), Math.log2(Math.max(1, p.r)) * 1.2) * norm * 3.2;
      // T60 → time constant. The note then rings for as long as its physics
      // says, instead of having 78 dB crammed into a scheduled window.
      const t60 = Math.max(0.05, p.d * (K ? K.damp : 1));
      g.gain.setValueAtTime(0.0001, when);
      // the fundamental BLOOMS: a resonator takes a moment to fill, while the
      // upper modes are there from the strike
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, a), when + (i === 0 ? 0.012 : 0.003));
      g.gain.setTargetAtTime(0, when + 0.014, t60 / TAU60);
      osc.connect(g); g.connect(gate);
      // Scatter the phases. Every OscillatorNode starts at phase zero, so all
      // the modes rise together and the first cycle sums arithmetically — a
      // spike about √N too tall, and a click.
      const jit = Math.random() / pf;
      osc.start(when + jit); osc.stop(when + Math.min(t60 * 1.2, 14));
      stops.push(osc);
    });
    // a drumhead is mostly noise; the modes only colour it
    if (inst.fam === "drum" || inst.fam === "frameDrum") {
      const n = Math.floor(ctx.sampleRate * 0.35);
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 5);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = clamp(f * 6 * (K ? K.bright : 1), 180, 6000);
      const g = ctx.createGain(); g.gain.setValueAtTime(vel * 0.55, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.3 * (K ? K.damp : 1));
      src.connect(lp); lp.connect(g); g.connect(gate);
      src.start(when); src.stop(when + 0.36);
    }
  }

  // `dur` is when the player's hand lands. Physics stays the CEILING — a note
  // can never ring longer than its T60 — but the written length can cut it
  // short. In the struck branch `dur` was simply never read, so more than half
  // of all notes silently discarded the length the composer gave them, and
  // articulation had no effect at all on those parts.
  if (!sustained && opts.damped) {
    gate.gain.setTargetAtTime(0.0001, when + dur, 0.13);
  }

  // The damping handle. A player's free hand stops the note being replaced
  // and lets everything else ring; that selective damping is why ringing
  // instruments sound full instead of muddy.
  const handle = {
    damp(at) {
      const t = Math.max(at, when + 0.02);
      gate.gain.cancelScheduledValues(t);
      gate.gain.setTargetAtTime(0.0001, t, 0.15);
      for (const s of stops) { try { s.stop(t + 0.2); } catch { /* already stopped */ } }
    },
  };
  // channel bookkeeping: one sounding note per (instrument, role)
  if (opts.channel) {
    const prev = A.voices.get(opts.channel);
    if (prev && prev.damp) prev.damp(when);
    A.voices.set(opts.channel, handle);
  }
  return handle;
}

// PeriodicWave cache — one per (instrument, brightness bucket)
const WAVES = new WeakMap();
function waveFor(ctx, inst, tilt) {
  let byCtx = WAVES.get(ctx);
  if (!byCtx) { byCtx = new Map(); WAVES.set(ctx, byCtx); }
  const bucket = Math.round(tilt * 6);
  const key = inst.id + ":" + bucket;
  if (byCtx.has(key)) return byCtx.get(key);
  const N = 32;
  const real = new Float32Array(N), imag = new Float32Array(N);
  inst.partials.forEach((p, i) => {
    const n = Math.round(p.r);
    if (n >= 1 && n < N) imag[n] += p.a * Math.pow(Math.min(1, bucket / 6), Math.log2(Math.max(1, p.r)) * 1.0);
  });
  // RMS-normalise: peak normalisation (the default) makes a duller wave come
  // out louder, which partly cancels the velocity→brightness coupling
  let rms = 0; for (let i = 1; i < N; i++) rms += imag[i] * imag[i];
  rms = Math.sqrt(rms / 2) || 1;
  for (let i = 1; i < N; i++) imag[i] /= rms;
  const w = ctx.createPeriodicWave(real, imag, { disableNormalization: true });
  byCtx.set(key, w);
  return w;
}

function breath(A, dest, when, dur, f, vel) {
  const { ctx } = A;
  const n = Math.floor(ctx.sampleRate * (dur + 0.2));
  if (n < 64) return;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1);
  const src = ctx.createBufferSource(); src.buffer = buf;
  // breath noise must go through the SAME body as the tone or it is heard as
  // hiss beside a beep instead of as air in an instrument
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.8;
  bp.frequency.value = clamp(f * 2.6, 700, 6000);
  const g = ctx.createGain();
  const lvl = vel * 0.3;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.linearRampToValueAtTime(lvl * 1.5, when + 0.04);      // the attack chiff
  g.gain.linearRampToValueAtTime(lvl, when + 0.13);
  g.gain.setValueAtTime(lvl, when + Math.max(0.14, dur));
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.14);
  src.connect(bp); bp.connect(g); g.connect(dest);
  src.start(when); src.stop(when + dur + 0.2);
}

// ── the voice: this people's own language, sung ──────────────────────────
const vowelF = (v) => FORMANT_VOWELS[`${v.h},${v.b},${v.r ? 1 : 0},${v.atr ? 1 : 0}`]
  || FORMANT_VOWELS[`${v.h},${v.b},${v.r ? 1 : 0},0`]
  || [[300, 480, 720][v.h] || 480, v.b === 0 ? 2000 : v.b === 1 ? 1400 : 1000, 2600];

/** Sing one syllable at `freq`. Onset consonants get a real articulation, so
 *  a sung line carries the language's own texture. */
export function playVoice(A, syl, freq, when, dur, vel = 0.4) {
  const { ctx } = A;
  const dest = A.buses.voice || A.master;
  const v = (syl && syl.nu && syl.nu[0]) || { h: 1, b: 1, r: 0, atr: 0 };
  const F = vowelF(v);
  const on = syl && syl.on && syl.on[0];
  const lead = on ? (on.m === 0 ? 0.045 : 0.06) : 0;

  const osc = ctx.createOscillator(); osc.type = "sawtooth";
  const t0 = when + lead;
  osc.frequency.setValueAtTime(freq * 0.985, t0);
  osc.frequency.exponentialRampToValueAtTime(freq, t0 + 0.05);
  const vib = ctx.createOscillator(), vg = ctx.createGain();
  vib.frequency.value = 5.4; vg.gain.setValueAtTime(0, t0);
  vg.gain.setTargetAtTime(freq * 0.007, t0 + 0.2, 0.15);
  vib.connect(vg); vg.connect(osc.frequency);

  const src = ctx.createGain(); src.gain.value = 1;
  osc.connect(src);
  const sum = ctx.createGain();
  F.slice(0, 3).forEach((hz, i) => {
    const bq = ctx.createBiquadFilter(); bq.type = "bandpass";
    bq.frequency.value = hz; bq.Q.value = [7, 9, 11][i];
    const g = ctx.createGain(); g.gain.value = [1, 0.62, 0.3][i];
    src.connect(bq); bq.connect(g); g.connect(sum);
  });
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, vel * 0.5), t0 + 0.06);
  amp.gain.setValueAtTime(Math.max(0.0002, vel * 0.5), when + Math.max(0.12, dur));
  amp.gain.exponentialRampToValueAtTime(0.0001, when + dur + 0.14);
  sum.connect(amp); amp.connect(dest);
  osc.start(t0); osc.stop(when + dur + 0.2);
  vib.start(t0); vib.stop(when + dur + 0.2);

  if (on) {
    const n = Math.floor(ctx.sampleRate * 0.07);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (on.m === 0 ? Math.pow(1 - i / n, 6) : 1);
    const s2 = ctx.createBufferSource(); s2.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = on.m === 0 ? "bandpass" : "highpass";
    bp.frequency.value = on.p >= 1 && on.p <= 3 ? 4200 : 1600; bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * (on.m === 0 ? 0.3 : 0.16), when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + lead + 0.02);
    s2.connect(bp); bp.connect(g); g.connect(dest);
    s2.start(when); s2.stop(when + lead + 0.03);
  }
}
