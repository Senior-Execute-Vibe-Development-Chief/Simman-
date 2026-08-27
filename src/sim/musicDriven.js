// ── The driven voices ────────────────────────────────────────────────────
//
// Everything held up by a continuous supply of energy: a bow drawn across a
// string, a breath across an edge, a reed, a pair of lips. These were the
// worst thing in the engine, and the reason was structural rather than a
// matter of tuning — the old path was a cached PeriodicWave read by two
// oscillators six cents apart through one gain envelope. Every part of that
// is a synth cliché:
//
//   · TWO DETUNED OSCILLATORS. This is the single loudest tell, and it was
//     the width. A real string has ONE period — the stick-slip loop locks
//     every partial to a common fundamental, which is exactly why a bowed
//     tone is more perfectly harmonic than the string's own modes are. Two
//     sources six cents apart beat at one and a half hertz and are the
//     defining sound of an analogue string ensemble. Width on a real
//     instrument comes from somewhere else entirely (musicBody.js).
//   · A FROZEN SPECTRUM. The wave was cached per instrument in seven
//     brightness buckets, so the tone could not change colour DURING a note
//     and a loud note was a quiet note turned up. In a real wind instrument
//     the spectrum is a function of its own instantaneous amplitude, and
//     violently so: over a trumpet crescendo the fundamental rises 8 dB while
//     the ninth harmonic rises by more than 45 dB.
//   · NO NOISE. The bowed voice had none at all, and the winds had a brief
//     "chiff" at the onset only. In a real flute the broadband component is
//     not a hiss laid beside the tone — it is turbulence shaped by the bore's
//     own resonances, carrying peaks the tone is not even sounding, and it is
//     enough of the identity that a player's fingering can be recovered from
//     the noise alone.
//
// So the tone is not a stored waveform any more. It is a SINE through a
// nonlinearity, which is what the physics actually is: the reed, the jet and
// the lips are nonlinear valves, and the harmonics are made by them, not
// stored in a table. Drive the nonlinearity harder and the spectrum enriches
// on its own — the amplitude-brightness law falls out instead of being
// painted on. The symmetry of the nonlinearity decides whether even harmonics
// exist at all, which is the real reason a cylindrical stopped pipe sounds
// hollow: an odd-symmetric valve characteristic cannot make them.
import { hash32 } from "./peopleSim/rng.js";
import { FAMILIES, MATERIALS } from "./musicInstruments.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ── the valve characteristic ─────────────────────────────────────────────
// Three real transfer curves, one per kind of driver. None is a preset: each
// is the measured shape of how that mechanism converts pressure or velocity
// into flow or force.
const CURVES = new Map();
function curveFor(ctx, kind, asym) {
  const key = kind + ":" + asym.toFixed(2);
  let c = CURVES.get(key);
  if (c) return c;
  const N = 2048, f = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1 + asym;
    let y;
    if (kind === "reed") {
      // A reed is a pressure-controlled valve, and the shape is an inverted U,
      // not a sigmoid: flow first rises as the square root of the pressure
      // difference (Bernoulli), then the same pressure closes the reed against
      // the lay and the flow goes to ZERO. Blowing harder does not just scale
      // the output — it walks the operating point over the hump, which is why
      // a reed's spectrum enriches so violently with dynamic.
      const p = clamp((x + 1) / 2, 0, 1);
      y = Math.sqrt(p) * Math.max(0, 1 - p / 0.82);
      y = y * 2.6 - 0.62;
    } else if (kind === "lip") {
      // Brass: the nonlinearity is not at the lips but in the BORE — at high
      // amplitude the compression half of the wave travels faster than the
      // rarefaction, so the wave steepens toward a shock as it runs down the
      // tube. Asymmetric saturation is what that steepening looks like at the
      // bell, and it is why a loud brass note blares while a quiet one is
      // mellow.
      y = Math.tanh(x * 1.15) * (1 + 0.16 * x) / 1.16;
    } else {
      // Jet drive: the flute's own nonlinearity is literally a hyperbolic
      // tangent — the jet saturates as it is deflected past the labium.
      y = Math.tanh(x * 1.05) / 1.05;
    }
    f[i] = clamp(y, -1, 1);
  }
  CURVES.set(key, f);
  return f;
}

// ── what kind of driver, and the numbers that follow from the body ───────
/**
 * The physical constants of one driven instrument. Every quantity here means
 * something on its own — a reed's closing time, a mouthpiece cup's volume, a
 * bore's cutoff — and the timbre is whatever they imply. No instrument is
 * named anywhere in it.
 */
export function driverOf(inst) {
  const fam = FAMILIES[inst.fam] || {};
  const mat = MATERIALS[inst.mat] || MATERIALS.wood;
  const low = fam.low || 200;
  const d = inst.drive;
  const D = { kind: d, low, bore: fam.ratios ? null : null };

  // Is the bore stopped at one end? Then its standing waves are odd multiples
  // and its valve characteristic has to be odd-symmetric to match. Read it
  // off the modal series the instrument model already derived, rather than
  // asserting it here.
  const r = inst.partials.map(p => p.r);
  D.odd = r.length > 1 && Math.abs(r[1] - 3) < 0.2;

  if (d === "reed") {
    // A double reed's closing time barely changes across the instrument's
    // range — the oboe's is 0.4 to 0.5 ms at every pitch — so the flow pulse
    // has a FIXED duration, and a fixed pulse duration means fixed spectral
    // zeros, which means FORMANTS that do not move with the note. That is
    // where a shawm's nasal carrying power comes from, and it is one physical
    // quantity: a smaller, harder reed closes faster and speaks higher and
    // more piercingly, a big soft one lower and rounder.
    const tau = 0.9e-3 * (1 - 0.55 * clamp(inst.craft ?? 0.4, 0, 1)) * Math.sqrt(175 / low)
      * (0.8 + 0.5 * (1 - mat.bright));
    D.tau = tau;
    D.formants = [
      { f: clamp(1 / (2 * tau), 300, 3600), g: 11, q: 3.2 },
      { f: clamp(3 / (2 * tau), 900, 5200), g: 8, q: 3.6 },
    ];
    D.top = 6500;
  } else if (d === "lip") {
    // The mouthpiece cup is a Helmholtz resonator with a fixed pop tone, and
    // above the bell's flare cutoff the bell stops reflecting and starts
    // radiating — a megaphone, not a resonator. Both are fixed in absolute
    // frequency and both scale with how big the instrument had to be.
    D.formants = [{ f: low * 3.9, g: 6, q: 1.5 }];
    D.shelf = { f: low * 6, g: 8 };
    D.top = 5200;
  } else if (d === "bow") {
    D.top = 9000;
  } else {
    // An edge-blown flute has NO fixed formant — measured spectral envelopes
    // for flutes and clarinets vary with pitch, unlike oboes, bassoons and
    // horns, so giving one a fixed formant would be a realism bug in itself.
    // Its fixed frequency is the tonehole lattice cutoff, above which the bore
    // stops reflecting.
    D.top = 2600 + 900 * mat.bright;
  }
  return D;
}

// one noise buffer, shared: eight seconds, so no voice ever hears its own loop
let NOISE = null;
function noiseBuf(ctx) {
  if (NOISE && NOISE.sampleRate === ctx.sampleRate) return NOISE;
  const n = Math.floor(ctx.sampleRate * 8);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  NOISE = b; NOISE.sampleRate = ctx.sampleRate;
  return b;
}

/**
 * Play one driven note.
 *
 * The whole note is authored as CURVES first — amplitude, drive, pitch and
 * noise level are computed together in JS and then handed to the audio graph
 * as value curves. That is not a convenience: on a real instrument all four
 * are consequences of ONE thing, the player's blowing pressure or bow force,
 * and a synth that modulates them independently sounds like four separate
 * modulators rather than like one person leaning into a note. Sprinkling
 * independent jitter on each partial makes N sources; sharing one driving
 * signal makes one instrument.
 */
export function playDriven(A, inst, freq, when, dur, vel, dest, opts = {}) {
  const { ctx } = A;
  const D = driverOf(inst);
  const f0 = freq;
  const seed = (opts.seed || 1) ^ Math.round(freq);
  const rnd = (t) => hash32(seed, "dv", t) / 4294967296;

  const REL = D.kind === "bow" ? 0.10 : 0.13;
  const total = dur + REL;
  const NPTS = Math.max(48, Math.min(1024, Math.round(total * 220)));
  const amp = new Float32Array(NPTS), drv = new Float32Array(NPTS);
  const pit = new Float32Array(NPTS), nz = new Float32Array(NPTS);

  // ── the onset, in PERIODS rather than milliseconds ──────────────────────
  // How long a note takes to speak is set by how many cycles the oscillation
  // needs to establish itself, so the same attack is four times longer on a
  // low note than on one two octaves up. A fixed eighty-millisecond attack is
  // a swell on a low string and, on a high one, more than fifty periods of
  // wrong-pitch scraping — which listeners reliably judge as choked.
  const atkP = D.kind === "bow" ? 3 + 5 * (1 - vel) : D.kind === "lip" ? 5 + 9 * (1 - vel)
    : D.kind === "reed" ? 2 + 4 * (1 - vel) : 6 + 12 * (1 - vel);
  const atk = clamp(atkP / f0, 0.008, 0.16);
  // Which way the pitch enters is a fact about the mechanism, not a flourish.
  // A jet has to accelerate from nothing, so a flute arrives FLAT and rises. A
  // reed is squeezed before it speaks, so it arrives sharp and settles. Slack
  // lips arrive very flat and lock as the embouchure firms.
  const scoop = D.kind === "breath" ? -0.55 : D.kind === "lip" ? -0.85 : D.kind === "reed" ? 0.22 : -0.18;

  // one slow pressure signal, and everything reads from it
  const vibRate = (D.kind === "bow" ? 6.5 : 5.0) + (rnd(1) - 0.5) * 1.6;
  const vibDepth = (D.kind === "bow" ? 0.0011 : 0.0009) * (opts.expressive ?? 1);
  const vibOn = D.kind === "bow" ? 0.22 : 0.30;
  let w1 = 0, w2 = 0;                                    // 1/f wander state
  for (let i = 0; i < NPTS; i++) {
    const t = (i / (NPTS - 1)) * total;
    // breath and bow both wander: pink, not white, and not a sine
    w1 += ((rnd(i * 2) - 0.5) - w1) * 0.13;
    w2 += (w1 - w2) * 0.07;
    const wander = w2 * 2.6;
    // vibrato is a PRESSURE modulation: it moves loudness, pitch and
    // brightness together and in phase, because on a real instrument it is one
    // gesture and not three
    const vg = dur > 0.34 ? clamp((t - vibOn) / 0.35, 0, 1) : 0;
    const vib = vg * Math.sin(2 * Math.PI * vibRate * t);
    const press = 1 + vibDepth * 900 * vib * 0.012 + wander * 0.05;

    // amplitude
    let a;
    if (t < atk) a = Math.pow(t / atk, D.kind === "lip" ? 2.2 : 1.5);
    else if (t < dur) a = 1;
    else a = Math.max(0, 1 - (t - dur) / REL);
    // a driven note is not flat once it has spoken; it breathes
    // one voice at full velocity peaks near a third of full scale, so a
    // handful of parts can sum without the limiter having to work
    amp[i] = clamp(0.34 * vel * a * press * (1 + 0.055 * vib), 0.0001, 0.55);

    // pitch: the onset scoop, the vibrato, and a slow drift that never repeats
    const sc = t < atk * 1.6 ? scoop * Math.pow(1 - t / (atk * 1.6), 2) : 0;
    pit[i] = f0 * Math.pow(2, (sc * 0.06) + vibDepth * vib * 10 + wander * 0.004);

    // DRIVE: how hard the valve is pushed. This is where the whole
    // amplitude-brightness law lives — a louder note is a more distorted one,
    // not a bigger one. Brass steepens hardest and LATE: the high harmonics
    // need amplitude to have built before the bore can steepen anything, so
    // the drive lags the envelope, which is heard as the note blooming open.
    const lag = D.kind === "lip" ? clamp((t - atk) / 0.07, 0, 1) : 1;
    const rich = D.kind === "lip" ? 5.5 : D.kind === "reed" ? 3.6 : D.kind === "bow" ? 3.0 : 2.2;
    drv[i] = clamp(0.22 + rich * Math.pow(amp[i] / 1.0, 1.35) * lag, 0.15, 8);

    // NOISE. Absolute turbulence rises with pressure, but the tone rises
    // faster — so a soft note is breathy and a loud one focused, and getting
    // that ratio backwards is the commonest way to make a wind instrument
    // sound synthetic.
    const base = D.kind === "breath" ? 0.16 : D.kind === "reed" ? 0.05 : D.kind === "lip" ? 0.035 : 0.09;
    const onset = t < atk ? 1 + 2.6 * (1 - t / atk) : 1;
    nz[i] = base * Math.pow(Math.max(0.02, amp[i]), 0.55) * onset * (1 + 0.5 * wander);
  }

  const stops = [];
  const gate = ctx.createGain(); gate.gain.value = 1;
  gate.connect(dest);

  // ── the tone: a sine through the valve ──────────────────────────────────
  const osc = ctx.createOscillator(); osc.type = "sine";
  osc.frequency.setValueCurveAtTime(pit, when, total);
  const pre = ctx.createGain(); pre.gain.value = 0;
  pre.gain.setValueCurveAtTime(drv, when, total);
  // Asymmetry is the even-harmonic control, and it is the physical one: a
  // perfectly odd-symmetric valve cannot make an even harmonic at all, which
  // is why a stopped cylindrical pipe sounds hollow. Real instruments are
  // never perfectly symmetric, and the asymmetry grows with register — which
  // is why a clarinet's top octave loses its hollowness.
  const reg = clamp(Math.log2(f0 / D.low) / 2.2, 0, 1);
  const asym = D.odd ? 0.02 + 0.20 * reg : D.kind === "bow" ? 0.05 : 0.13 + 0.12 * reg;
  const shp = ctx.createWaveShaper();
  shp.curve = curveFor(ctx, D.kind === "reed" ? "reed" : D.kind === "lip" ? "lip" : "jet", asym);
  shp.oversample = "4x";
  const dc = ctx.createBiquadFilter(); dc.type = "highpass"; dc.frequency.value = 24; dc.Q.value = 0.7;

  // The bore's own ceiling: a fixed frequency, so fewer harmonics survive the
  // higher you play — which is both what a tonehole lattice or a bell flare
  // actually does and, conveniently, the aliasing budget.
  const top = ctx.createBiquadFilter(); top.type = "lowpass";
  top.frequency.value = clamp(D.top, f0 * 2.2, 11000); top.Q.value = 0.6;

  let node = dc;
  osc.connect(pre); pre.connect(shp); shp.connect(dc);
  for (const F of D.formants || []) {
    const bq = ctx.createBiquadFilter(); bq.type = "peaking";
    bq.frequency.value = F.f; bq.gain.value = F.g; bq.Q.value = F.q;
    node.connect(bq); node = bq;
  }
  if (D.shelf) {
    const sh = ctx.createBiquadFilter(); sh.type = "highshelf";
    sh.frequency.value = D.shelf.f; sh.gain.value = D.shelf.g;
    node.connect(sh); node = sh;
  }
  const g = ctx.createGain(); g.gain.value = 0;
  g.gain.setValueCurveAtTime(amp, when, total);
  node.connect(top); top.connect(g); g.connect(gate);
  osc.start(when); osc.stop(when + total + 0.02);
  stops.push(osc);

  // ── the noise, shaped by the SAME bore ──────────────────────────────────
  // Not hiss beside a tone. Turbulence excites the pipe's passive resonances,
  // so the broadband component has peaks at the bore's modes — including modes
  // the note is not sounding, which is why a flute's breath carries the
  // fingering. And it is pulsed, not steady: the jet switches sides, and the
  // string slips, once per period.
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf(ctx);
  src.loop = true;
  src.loopStart = rnd(9) * 6; src.loopEnd = src.loopStart + 1.7;
  const ng = ctx.createGain(); ng.gain.value = 0;
  ng.gain.setValueCurveAtTime(nz, when, total);
  const bank = ctx.createGain(); bank.gain.value = 1;
  src.connect(bank);
  const nsum = ctx.createGain(); nsum.gain.value = 1;
  const step = D.odd ? 2 : 1, first = D.odd ? 1 : 1;
  for (let k = 0; k < 7; k++) {
    const n = first + k * step;
    const bf = f0 * n;
    if (bf > 11000) break;
    const bq = ctx.createBiquadFilter(); bq.type = "bandpass";
    bq.frequency.value = bf; bq.Q.value = 14 + 12 * rnd(20 + k);
    const bg = ctx.createGain(); bg.gain.value = Math.pow(n, -0.4);
    bank.connect(bq); bq.connect(bg); bg.connect(nsum);
  }
  // and two resonances the note is NOT sounding — the closed toneholes and the
  // bore below the speaking length still ring, and that is the part of the
  // breath that identifies the instrument rather than the note
  for (let k = 0; k < 2; k++) {
    const bq = ctx.createBiquadFilter(); bq.type = "bandpass";
    bq.frequency.value = clamp(D.low * (2.4 + 3.1 * k) * (1 + (rnd(40 + k) - 0.5) * 0.2), 120, 9000);
    bq.Q.value = 7 + 5 * rnd(50 + k);
    const bg = ctx.createGain(); bg.gain.value = 0.45;
    bank.connect(bq); bq.connect(bg); bg.connect(nsum);
  }
  // pulsed once per period: a bow slips, and a jet flips, at the pitch rate
  const am = ctx.createGain(); am.gain.value = 1 - (D.kind === "bow" ? 0.34 : 0.28);
  const lfo = ctx.createOscillator(); lfo.type = "sawtooth";
  lfo.frequency.setValueCurveAtTime(pit, when, total);
  const lg = ctx.createGain(); lg.gain.value = D.kind === "bow" ? 0.34 : 0.28;
  lfo.connect(lg); lg.connect(am.gain);
  lfo.start(when); lfo.stop(when + total + 0.02); stops.push(lfo);
  nsum.connect(am); am.connect(ng); ng.connect(gate);
  src.start(when); src.stop(when + total + 0.05); stops.push(src);

  return {
    damp(at) {
      const t = Math.max(at, when + 0.02);
      gate.gain.cancelScheduledValues(t);
      gate.gain.setTargetAtTime(0.0001, t, 0.05);
      for (const s of stops) { try { s.stop(t + 0.14); } catch { /* already stopped */ } }
    },
  };
}
