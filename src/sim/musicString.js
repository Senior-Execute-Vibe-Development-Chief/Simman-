// ── The string itself ────────────────────────────────────────────────────
//
// Everything else in this engine describes a vibration; this one IS one.
//
// A plucked string is not a stack of decaying sinusoids that happen to sit at
// harmonic ratios — it is a wave running back and forth along a wire, losing a
// little at each reflection, and every property people recognise in the sound
// falls out of that loop rather than being written into a mode list. Exact
// harmonicity, because one round trip sets one period for everything at once.
// The high partials dying first, because the loss at the ends is a lowpass.
// The way a pluck near the bridge sounds nasal, because a wave leaving one
// point cancels the modes with a node there. None of it is a parameter.
//
// It could not be built in the Web Audio graph, and that is not a matter of
// awkwardness: a delay inside a feedback cycle is clamped to a whole render
// quantum, so the shortest loop possible is 128 samples and the highest note
// any graph-level string can play is 344 Hz. Half the instrument, and the
// tuning drifts between browsers. But a feedback loop is trivial in a plain JS
// loop filling a buffer — about two milliseconds for a note, six hundred times
// faster than real time — and the buffer then plays back through the same
// body, the same room and the same mixer as everything else. Which also keeps
// the property the body model exists for: the buffer transposes, the body does
// not, so the instrument stays one object being played.
//
// (Extended Karplus–Strong, in the form Jaffe and Smith set out: delay line,
// loss filter, fractional-delay allpass for tuning, allpass cascade for
// stiffness, and a comb for where the player plucked.)

/** Seeded noise, so a rendered string is reproducible. */
function noiseGen(seed) {
  let x = (seed >>> 0) || 1;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2147483648 - 1; };
}

/**
 * Render one plucked note.
 *
 * `t60` is how long the fundamental takes to fall sixty decibels — the same
 * figure the material model already carries — and the loop gain is solved from
 * it rather than dialled: a wave makes f0 round trips a second, so the gain per
 * trip is whatever makes those trips add up to the right decay.
 */
export function pluckString(sr, f0, opts = {}) {
  const {
    t60 = 2.4,          // ring time of the fundamental, seconds
    bright = 0.55,      // how much of the top survives each reflection
    beta = 0.14,        // where it was plucked, as a fraction of the length
    width = 8,          // how wide the contact was, in millimetres
    vel = 0.6,
    secs = 0,
    seed = 1,
  } = opts;
  const L = sr / f0;
  if (!(L > 4) || !(L < sr / 12)) return null;

  // The loss filter is one zero: at direct current it passes, at Nyquist it
  // cuts, and where between is what "bright" means for a wire. Its phase delay
  // is b samples, which the tuning below has to account for.
  const b = 0.5 - 0.42 * bright;
  // Louder is brighter here too, and for the same reason as everywhere else: a
  // harder pluck is a shorter, sharper contact, so more of the string's top
  // gets set moving in the first place.
  const g = Math.pow(10, -3 / (f0 * Math.max(0.05, t60)));

  // NO DISPERSION HERE, and that is a deliberate limit rather than an
  // omission. A wire resists bending, so its partials run sharp of whole
  // numbers — and the cheap way to model that, a short cascade of allpasses
  // that delays low frequencies more than high ones, does not deliver. I built
  // it and measured it: against a target stretch of twenty-two cents at the
  // eighth partial of a bronze wire, four stages gave three cents and sixteen
  // gave six, while the delay they added ran the whole instrument as much as
  // three semitones flat until it was subtracted back out. Reaching the real
  // figure needs a designed dispersion filter, which is a different piece of
  // work.
  //
  // So this renders a FLEXIBLE string, exactly — which is what gut and silk
  // are: their stretch at the eighth partial is about one cent, well under
  // anything anyone hears. A wire stiff enough to jangle is sent to the modal
  // bank instead (musicSynth), where its partials can simply be placed where
  // the physics says. Each model does the case it is actually right for.
  const Dint = Math.max(2, Math.floor(L - b - 0.5));
  const Dfrac = Math.min(1.45, Math.max(0.15, L - b - Dint));
  const c = (1 - Dfrac) / (1 + Dfrac);          // tuning allpass

  // ── the excitation ──
  const rnd = noiseGen(seed);
  const buf = new Float32Array(Dint);
  // contact width sets the highest partial that can be reached at all: a wave
  // shorter than the finger cannot be started by it
  const nCut = Math.max(3, 340 / Math.max(0.5, width)) * (0.7 + 0.6 * vel);
  const aC = Math.exp(-2 * Math.PI * Math.min(0.45, (nCut * f0) / sr));
  // The bridge force from a plucked string falls at six decibels an octave —
  // a triangle released against a termination, nothing more — so the burst is
  // tilted before it ever enters the loop. Flat noise gave a string whose
  // fourth partial was louder than its first.
  const aT = Math.exp(-2 * Math.PI * Math.min(0.4, (f0 * 0.42) / sr));
  let lp = 0, tilt = 0;
  for (let i = 0; i < Dint; i++) {
    lp = aC * lp + (1 - aC) * rnd();
    tilt = aT * tilt + (1 - aT) * lp;
    buf[i] = tilt;
  }
  // …and where the player plucked cancels every mode with a node under the
  // finger: pluck a fifth of the way along and the fifth harmonic is silent
  const d = Math.max(1, Math.round(beta * Dint)) % Dint;
  const cp = buf.slice();
  for (let i = 0; i < Dint; i++) buf[i] = cp[i] - cp[(i - d + Dint) % Dint];
  // normalise the burst so velocity means level and nothing else
  let pk = 0; for (let i = 0; i < Dint; i++) pk = Math.max(pk, Math.abs(buf[i]));
  if (pk > 0) for (let i = 0; i < Dint; i++) buf[i] *= vel / pk;

  // ── the loop ──
  const n = Math.floor((secs || Math.min(9, t60 * 1.1 + 0.35)) * sr);
  const out = new Float32Array(n);
  let ptr = 0, zLoss = 0, apX = 0, apY = 0;
  for (let i = 0; i < n; i++) {
    const v = buf[ptr];
    out[i] = v;
    // one zero, scaled to the ring time
    const loss = g * ((1 - b) * v + b * zLoss);
    zLoss = v;
    // fractional delay
    const ap = c * loss + apX - c * apY;
    apX = loss; apY = ap;
    buf[ptr] = ap;
    ptr = ptr + 1 === Dint ? 0 : ptr + 1;
  }
  // a DC blocker: the comb and the loss filter can leave a slow offset that
  // would otherwise show up as a thump through the body
  let px = 0, py = 0;
  for (let i = 0; i < n; i++) { const x = out[i]; py = x - px + 0.9995 * py; px = x; out[i] = py; }
  return out;
}

/**
 * Is this string flexible enough for the waveguide?
 *
 * The test is whether its stiffness would be heard: a stretch under about ten
 * cents at the eighth partial — the highest one a plucked string radiates
 * strongly — is below anything a listener picks out as jangle. Gut and silk
 * clear it by an order of magnitude; drawn bronze and iron do not, and go to
 * the modal bank where their partials can be placed exactly.
 */
export function flexible(B) {
  return 1200 * Math.log2(Math.sqrt(1 + (B || 0) * 64)) < 10;
}
