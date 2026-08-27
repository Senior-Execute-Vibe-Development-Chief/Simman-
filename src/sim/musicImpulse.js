// ── The struck and plucked voices ────────────────────────────────────────
//
// Everything excited by ONE blow and then left alone: a plucked string, a
// struck bar, a gong, a bell, a drumhead. The old path gave every mode an
// oscillator whose amplitude came from a fitted power law, `a = r^−p`, with a
// per-drive table of exponents, and whose velocity response came from a
// second fitted power law called `tilt`. Both existed for the same reason:
// THE EXCITATION NEVER TOUCHED THE MODES. The noise burst went around them,
// into the output, so there was nowhere for the mallet, the plucking finger,
// or the place you hit the thing to live — and their effects had to be
// painted on afterwards with exponents.
//
// So drive the modes with the blow instead, and both tables delete
// themselves. A mode's share of a strike is just the excitation's spectrum at
// that mode's frequency, times the mode's own shape at the point of contact:
//
//     a_n  =  |E(f_n)| · |Φ_n(ξ)|
//
// and every cue that used to need a constant falls out of one of those two
// terms:
//
//   · HOW HARD you hit it. A blow is a contact of finite duration τ, and a
//     pulse of duration τ cannot put energy above about 1/τ. Hit harder and
//     the contact SHORTENS (thecontact stiffens more stiffly), so the same
//     mallet reaches higher modes — which is why a loud note is brighter and
//     not merely bigger, without any brightness parameter.
//   · WHAT you hit it with. A mallet head, a fingertip, a fingernail, a
//     plectrum: the contact width decides the highest partial that can be
//     reached at all, at harmonic number n ≈ L/Δ. A fingertip on a lyre
//     string is twenty millimetres of a three-hundred-millimetre string, so
//     it cannot excite past the twentieth partial; a plectrum two
//     millimetres wide reaches past the hundredth. That single number is the
//     whole difference between a plucked lute and a plucked harp.
//   · WHERE you hit it. Φ_n(ξ) = |sin(nπξ)| has zeros at every mode with a
//     node under the contact point, so plucking a fifth of the way along
//     silences the fifth harmonic and its multiples, and striking a bar at
//     its centre silences every even mode. This is the comb that gives a lute
//     plucked by the bridge its nasal edge and a harp plucked in the middle
//     its hollow one.
import { FAMILIES, contactSpectrum, contactTime, dampTime } from "./musicInstruments.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * What one blow makes of this body: every mode's frequency, its share of the
 * blow, and how long it rings.
 */
export function struckModes(inst, f0, vel, opts = {}) {
  const fam = FAMILIES[inst.fam] || {};
  const tau = contactTime(inst, vel);
  // where the hand or beater falls, nudged per note — no player lands on the
  // same millimetre twice, and that alone stops a repeated note being a copy
  const beta = clamp((opts.beta ?? fam.beta ?? 0.4) + (opts.jitter ?? 0) * 0.06, 0.02, 0.98);
  // the highest partial the contact can reach at all: a wide fingertip cannot
  // excite a mode whose half-wavelength is shorter than the finger
  const nCut = fam.wid ? (fam.vib === "string" ? 340 / fam.wid : 260 / fam.wid) : 40;
  const out = [];
  inst.partials.forEach((p, i) => {
    const f = f0 * p.r;
    if (!(f > 18 && f < 15000)) return;
    const n = i + 1;
    const pos = Math.abs(Math.sin(Math.PI * n * beta));
    const reach = 1 / Math.sqrt(1 + Math.pow(n / nCut, 2));
    const a = contactSpectrum(f, tau) * pos * reach;
    if (a < 0.0008) return;
    out.push({ f, a, d: p.d, n });
  });
  return { modes: out, tau, beta };
}

/**
 * Play one blow.
 *
 * Each mode is an oscillator with its own decay, which is what lets a struck
 * body change colour as it rings — the high modes go first and the tone
 * darkens toward its fundamental, which is most of what makes a struck note
 * sound like a real object rather than a sample of one.
 */
export function playImpulse(A, inst, f0, when, dur, vel, dest, opts = {}) {
  const { ctx } = A;
  const fam = FAMILIES[inst.fam] || {};
  const K = opts.stroke || null;
  const { modes, tau } = struckModes(inst, f0, vel, opts);
  if (!modes.length) return { damp() {} };

  const gate = ctx.createGain(); gate.gain.value = 1;
  gate.connect(dest);
  const stops = [];
  // uncorrelated partials sum as the square root of their power, so normalise
  // by power and a near-sine body comes out level with a rich one
  const pw = modes.reduce((s, m) => s + m.a * m.a, 0) || 1;
  // Matched by measurement against the driven voices, which were arriving
  // nine decibels quieter for the same written velocity — so every struck or
  // plucked part sat on top of every blown or bowed one.
  const norm = 0.3 / Math.sqrt(pw);
  const TAU60 = 6.907755;

  modes.forEach((m, i) => {
    const osc = ctx.createOscillator(); osc.type = "sine";
    const g = ctx.createGain();
    const t60 = Math.max(0.03, m.d * (K ? K.damp : 1));
    const a = vel * m.a * norm;
    // A real string does not ring at one frequency: it vibrates in two planes
    // at once, and the two are a whisker apart because the string rolls on its
    // own thickness at the bridge — a fixed RELATIVE split of about a tenth of
    // a per cent. So a partial beats against itself at a rate proportional to
    // its own frequency: a quarter of a hertz at the fundamental and several
    // hertz up in the treble. One plane leaks its energy into the soundboard
    // quickly and the other hardly at all, which is why a plucked note has a
    // fast first decay and then a long, quiet aftersound. Neither is
    // reproducible with one oscillator per mode, and together they are most of
    // what a plucked string sounds like.
    const twin = fam.vib === "string" && i < 6;
    const parts = twin ? [[1, 0.62, 1], [1.0009, 0.38, 3.6]] : [[1, 1, 1]];
    for (const [dt, lvl, slow] of parts) {
      const o = dt === 1 ? osc : ctx.createOscillator();
      if (dt !== 1) o.type = "sine";
      o.frequency.value = m.f * dt;
      const gg = dt === 1 ? g : ctx.createGain();
      gg.gain.setValueAtTime(0.0001, when);
      gg.gain.exponentialRampToValueAtTime(Math.max(0.0002, a * lvl), when + Math.min(0.011, tau * 3));
      gg.gain.setTargetAtTime(0, when + Math.min(0.013, tau * 3.5), (t60 * slow) / TAU60);
      o.connect(gg); gg.connect(gate);
      // every oscillator starts at phase zero, so without scattering them the
      // first cycle sums arithmetically into a click
      o.start(when + (opts.jitter != null ? Math.abs(opts.jitter) : 0.3) / m.f);
      o.stop(when + Math.min(t60 * slow * 1.2, 16));
      stops.push(o);
    }
  });

  // A membrane is mostly noise that a few modes colour, not the other way
  // round — and the noise, like the modes, is shaped by how long the hand was
  // in contact.
  if (fam.vib === "membrane") {
    const n = Math.floor(ctx.sampleRate * 0.32);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 5);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass";
    lp.frequency.value = clamp(0.85 / tau, 180, 7000); lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.5, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.28 * (K ? K.damp : 1));
    src.connect(lp); lp.connect(g); g.connect(gate);
    src.start(when); src.stop(when + 0.34);
    // A drumhead is not a linear spring: a hard blow stretches it, so the
    // whole head starts sharp and falls as the stroke dies — a hundred-odd
    // cents in the first fifth of a second, and the single loudest cue that a
    // drum is a real membrane and not a filtered click.
    const drop = 0.9 * vel;
    for (const o of stops) {
      try {
        o.frequency.setValueAtTime(o.frequency.value * (1 + 0.09 * drop), when);
        o.frequency.setTargetAtTime(o.frequency.value, when, 0.075);
      } catch { /* already started */ }
    }
  }

  // `dur` is when the player's hand lands. Physics stays the ceiling — a note
  // can never ring longer than its own decay — but the written length can cut
  // it short, and on a body light enough to stop, it does.
  // How fast a hand takes the sound away is the same physical quantity that
  // decided whether it could be damped at all: a small wooden key stops in a
  // tenth of a second, a bronze one takes a few tenths, and a hung bell barely
  // responds. A single constant here made every body stop identically.
  const dt = Math.min(0.5, Math.max(0.02, dampTime(inst)));
  if (opts.damped) gate.gain.setTargetAtTime(0.0001, when + dur, dt);

  return {
    damp(at) {
      const t = Math.max(at, when + 0.02);
      gate.gain.cancelScheduledValues(t);
      gate.gain.setTargetAtTime(0.0001, t, Math.min(0.4, Math.max(0.02, dampTime(inst))));
      for (const s of stops) { try { s.stop(t + 0.3); } catch { /* already stopped */ } }
    },
  };
}
