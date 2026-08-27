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
import { buildBody } from "./musicBody.js";
import { scoreSong, renderScore } from "./vocalTract.js";
import { playDriven } from "./musicDriven.js";
import { playImpulse } from "./musicImpulse.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Role balance, in dB relative to the melody. Without a bus per part every
// voice lands at the same level and the drum buries the tune.
// Balance in dB against the melody. Velocity is HOW HARD A PART IS PLAYED —
// it drives timbre as well as level, because on every real instrument those
// are the same gesture — and the bus alone carries mix balance. Doing both
// with velocity, as this used to, meant the quiet parts were also permanently
// the dullest ones. And a part with no entry here bypassed the balance
// altogether and arrived at full level.
const ROLE_DB = {
  lead: 0, voice: 1, elab: -7, core: -5, het: -8,
  bass: -6, pad: -14, ost: -11,
  // percussion is the drive, not the background — a drum ensemble is what
  // makes this music powerful rather than moody, and it was mixed as an
  // afterthought
  pulse: -2,
  // loud and rare: a punctuating stroke is the biggest single sound in the
  // bar precisely because it is the least frequent one — but it rings for
  // seconds, so what it costs in average level is far more than one note
  mark: -7,
};
const ROLE_PAN = { lead: 0, voice: 0, elab: 0.32, core: -0.22, het: 0.4, bass: 0,
  pad: -0.15, ost: -0.35, pulse: 0.2, mark: -0.28 };
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


/**
 * Play one note. `freq` is whatever the culture's scale says — no note names,
 * no MIDI, no twelve-tone grid anywhere in the path.
 *
 * Returns a handle so the caller can damp this note later, when a player's
 * hand would actually land on it.
 */
// A drum stroke is not an equaliser setting. It is WHERE the hand lands and
// how long it stays there — and every difference in sound follows from those
// two, through the same excitation model every other struck body uses. A bass
// tone is a fleshy hand in the middle of the head, which sits on the
// axisymmetric mode and misses the ring modes entirely; an open tone is at the
// rim, where the ring modes are strongest; a slap is a hard, brief contact
// almost at the edge; a ghost note never lets go.
const STROKE_DSP = {
  bass:  { pitch: 1, beta: 0.5, damp: 1.5 },
  open:  { pitch: 1, beta: 0.82, damp: 1 },
  slap:  { pitch: 1, beta: 0.94, damp: 0.4 },
  ghost: { pitch: 1, beta: 0.7, damp: 0.28 },
};

export function playNote(A, inst, freq, when, dur, vel = 0.4, opts = {}) {
  const role = opts.role || "lead";
  // A stroke is a real change to how and where the body is struck, not a
  // preset: it moves where the hand lands, how long it stays in contact, and
  // how fast it takes the sound away again.
  const K = STROKE_DSP[opts.stroke] || null;
  const f = freq * (K ? K.pitch : 1) * (1 + inst.detune + 0.004 * (Math.random() - 0.5));
  if (!(f > 20 && f < 12000)) return null;
  const body = bodyFor(A, inst, role);
  const dest = body.input;

  const handle = inst.kind === "sustain"
    // Everything held up by continuous energy — bow, breath, reed, lip — is
    // built in musicDriven.js: a sine through the mechanism's own nonlinear
    // valve, so the harmonics are MADE by the drive rather than read from a
    // table, plus turbulence shaped by the same bore as the tone.
    ? playDriven(A, inst, f, when, dur, vel, dest, { seed: opts.seedFor || 1, expressive: opts.expressive })
    // Everything excited by one blow is built in musicImpulse.js: the modes
    // are driven by the blow itself, so how hard, with what, and where all
    // shape the spectrum instead of being painted on with exponents.
    : playImpulse(A, inst, f, when, dur, vel, dest, {
      stroke: K, damped: opts.damped, beta: K ? K.beta : undefined,
      jitter: (Math.random() - 0.5) * 2,
    });

  // The damping handle. A player's free hand stops the note being replaced
  // and lets everything else ring; that selective damping is why ringing
  // instruments sound full instead of muddy.
  if (opts.channel) {
    const prev = A.voices.get(opts.channel);
    if (prev && prev.damp) prev.damp(when);
    A.voices.set(opts.channel, handle);
  }
  return handle;
}

// PeriodicWave cache — one per (instrument, brightness bucket)
const WAVES = new WeakMap();


// ── the voice: this people's own language, SUNG ──────────────────────────
//
// The voice is the one instrument every people has. It needs no ore, no
// timber and no craft, which is why the overwhelming majority of the world's
// music is sung and why a tradition can exist with no built instrument at
// all. It was the one thing this engine modelled worst: a sawtooth through
// three bandpass filters, which is a formant SKETCH — it paints the effect.
//
// src/sim/vocalTract.js is a Kelly-Lochbaum waveguide of the real air column
// with a Liljencrants-Fant glottis, and it was sitting in this repo unused by
// the music. It is pure and deterministic, so a whole sung line renders
// OFFLINE into a buffer under Node or in the page, exactly as langLab already
// does for speech. Which also settles the harder question this file kept
// running into: a feedback loop at audio rate is impossible in the Web Audio
// node graph, but it is trivial in a JS loop that fills a buffer. Physical
// models do not need the graph.
const SUNG = new Map();

/** Render one sung line, cached. `notes` are [{f, dur, vel}] in Hz/seconds. */
export function sungLine(sampleRate, syls, notes, opts = {}) {
  const key = `${sampleRate}|${opts.key || ""}|${notes.map(n => `${n.f.toFixed(1)},${n.dur.toFixed(3)},${(n.vel ?? 1).toFixed(2)}`).join(";")}`;
  let pcm = SUNG.get(key);
  if (!pcm) {
    pcm = renderScore(scoreSong(syls, notes, opts), sampleRate, opts.seed || 1);
    if (SUNG.size > 64) SUNG.clear();
    SUNG.set(key, pcm);
  }
  return pcm;
}

/**
 * Schedule a rendered line. The tract's own level control evens speech out so
 * words stay intelligible, so the musical dynamics are applied here instead —
 * on the buffer, note by note. What the tract DOES carry is the part a gain
 * cannot fake: a harder-sung note is brighter, not merely louder.
 */
export function playSung(A, pcm, notes, when, gain = 1) {
  const { ctx } = A;
  const buf = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
  buf.getChannelData(0).set(pcm);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(Math.max(0.0001, (notes[0]?.vel ?? 0.5) * gain), when);
  let t = 0.03;
  for (const n of notes) {
    g.gain.setTargetAtTime(Math.max(0.0001, (n.vel ?? 0.5) * gain), when + t, 0.035);
    t += n.dur;
  }
  src.connect(g); g.connect(A.buses.voice || A.master);
  src.start(when);
  return { damp(at) { try { src.stop(Math.max(at, when + 0.02)); } catch { /* not started */ } } };
}
