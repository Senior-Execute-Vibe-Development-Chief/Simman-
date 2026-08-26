// ── Tuning, derived from the instruments a people can build ──────────────
//
// THE SPINE of the music system, and the reason it obeys the second cardinal
// rule. No culture here is given a scale. Each is given INSTRUMENTS (see
// musicInstruments.js), and a scale is *discovered* in them: two tones sound
// rough when their partials beat against each other, so the intervals where
// that roughness is least are the intervals a people will find consonant and
// build a scale out of. Move the partials and the consonances move with them.
//
// The roughness model is Plomp & Levelt's measured curve in the parametric
// form Sethares uses (Tuning, Timbre, Spectrum, Scale). Its constants are
// fits to LISTENING DATA — human critical-band roughness — not to any
// musical outcome, which is exactly what makes them legitimate here: they
// describe the ear, and the ear is the same everywhere in this world.
//
// The consequence is the interesting part, and it is not something we chose:
//   · harmonic instruments (strings, pipes, voice) put their partials at
//     integer multiples, so roughness bottoms out at simple ratios — 2:1,
//     3:2, 4:3, 5:4. Such a people derives something near just intonation.
//   · a people whose loud, tuned instruments are struck METAL BARS has an
//     inharmonic ensemble spectrum (1 : 2.756 : 5.404 …). Its roughness
//     minima are somewhere else entirely, so it derives a scale with no
//     usable fifth in it — and the "octave" it repeats at may not be 2:1.
// Neither case is written down anywhere. Both fall out of the same function.

// Plomp–Levelt roughness between two sine partials (Sethares' parameters).
const B1 = 3.5, B2 = 5.75, S1 = 0.0207, S2 = 18.96, DSTAR = 0.24;
function roughness(f1, a1, f2, a2) {
  const fmin = Math.min(f1, f2);
  const s = DSTAR / (S1 * fmin + S2);
  const df = Math.abs(f2 - f1);
  return a1 * a2 * (Math.exp(-B1 * s * df) - Math.exp(-B2 * s * df));
}

/** Total roughness of a spectrum sounded against itself transposed by `ratio`. */
export function dissonance(spec, ratio) {
  let d = 0;
  for (const p of spec) for (const q of spec) d += roughness(p.f, p.a, q.f * ratio, q.a);
  return d;
}

/**
 * The curve a people would hear: roughness across every interval from unison
 * to a little past the octave. This is the object the Lab plots — the visible
 * proof that the scale was found, not chosen.
 */
export function dissonanceCurve(spec, { lo = 1, hi = 2.12, n = 900 } = {}) {
  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = lo + (hi - lo) * (i / (n - 1));
    xs[i] = r; ys[i] = dissonance(spec, r);
  }
  return { xs, ys };
}

/** Local minima with their prominence (depth below the lower flanking peak). */
export function minimaOf(curve) {
  const { xs, ys } = curve, out = [];
  for (let i = 1; i < ys.length - 1; i++) {
    if (!(ys[i] <= ys[i - 1] && ys[i] < ys[i + 1])) continue;
    let l = ys[i], r = ys[i];
    for (let j = i; j > 0 && ys[j - 1] >= ys[j]; j--) l = ys[j - 1];
    for (let j = i; j < ys.length - 1 && ys[j + 1] >= ys[j]; j++) r = ys[j + 1];
    out.push({ ratio: xs[i], value: ys[i], prom: Math.min(l, r) - ys[i], cents: 1200 * Math.log2(xs[i]) });
  }
  return out;
}

/**
 * Derive a people's scale from its ensemble spectrum.
 *
 * `cap` — how many distinct pitches their instruments can physically sound.
 * A six-hole pipe cannot play a twelve-note scale; that constraint is what
 * keeps small-instrument cultures pentatonic without anyone deciding they
 * should be. `pull` — how strongly the tradition regularizes toward equal
 * steps (a notated, keyboard-ish tradition does; an oral one does not).
 */
export function deriveScale(spec, { cap = 7, pull = 0, minDepth = 0.02 } = {}) {
  const curve = dissonanceCurve(spec);
  const mins = minimaOf(curve);
  const range = Math.max(...curve.ys) - Math.min(...curve.ys) || 1;
  // Salience is LOCAL: how far a dip falls relative to the roughness right
  // there, not relative to the deepest dip on the curve. Judging it globally
  // lets one enormous octave trough swamp every interval a people actually
  // uses — which is a measurement artefact, not a fact about their ears.
  const depth = (m) => m.prom / (m.value + m.prom || 1);

  // the FRAME interval — where the pattern repeats. Usually the octave,
  // because octave-equivalence is itself a consequence of harmonic partials;
  // an inharmonic ensemble may put its strongest wide consonance elsewhere,
  // and then that is honestly the interval it repeats at.
  const framePool = mins.filter(m => m.ratio > 1.6);
  const frame = framePool.length
    ? framePool.reduce((a, b) => (b.prom > a.prom ? b : a))
    : { ratio: 2, cents: 1200, prom: 0 };

  // candidate degrees: prominent minima strictly inside the frame
  const inside = mins
    .filter(m => m.ratio > 1.02 && m.ratio < frame.ratio - 0.012 && depth(m) >= minDepth)
    .sort((a, b) => b.prom - a.prom)
    .slice(0, Math.max(1, cap - 1))
    .sort((a, b) => a.ratio - b.ratio);

  let degrees = [{ ratio: 1, cents: 0, prom: Infinity, found: true }, ...inside.map(d => ({ ...d, found: true }))];
  // WHERE THE TIMBRE GIVES NO GUIDANCE, A TRADITION MEASURES INSTEAD.
  // Some ensembles have almost no consonance structure to find: a body whose
  // radiated modes are few and very high (a plucked tongue, say) is close to
  // a pure tone, and pure tones are equally smooth against each other almost
  // everywhere. A people in that position cannot hear its way to a scale, so
  // it does the other thing makers do — it divides its frame into even steps
  // by measurement, cutting each bar or boring each hole a fixed part of the
  // way along. Equidistant tunings are exactly what turns up where timbre
  // stops constraining, so this is the mechanism completing itself, not a
  // floor bolted on to keep scales from looking thin.
  const want = Math.max(4, Math.min(cap, 7));
  if (degrees.length < want) {
    const step = frame.cents / want;
    for (let i = 1; i < want && degrees.length < want; i++) {
      const c = i * step;
      if (degrees.some(d => Math.abs(d.cents - c) < step * 0.45)) continue;
      degrees.push({ ratio: Math.pow(2, c / 1200), cents: c, prom: 0, found: false });
    }
    degrees.sort((a, b) => a.cents - b.cents);
  }
  // regularization: a tradition that writes its music down, or builds fixed-
  // pitch instruments in sets, drifts its steps toward equal division of the
  // frame. `pull` is how far — 0 leaves the discovered ratios untouched.
  if (pull > 0 && degrees.length > 1) {
    const step = frame.cents / degrees.length;
    degrees = degrees.map((d, i) => {
      const cents = d.cents * (1 - pull) + i * step * pull;
      return { ...d, cents, ratio: Math.pow(2, cents / 1200) };
    });
  }
  return {
    degrees, frame, curve, minima: mins, range,
    // how the scale was arrived at — heard, measured, or both
    derivedBy: degrees.every(d => d.found) ? "heard" : degrees.some(d => d.found && d.cents > 0) ? "heard + measured" : "measured",
    // how far this scale sits from equal-tempered semitones — a MEASURE of
    // how alien it will sound, computed, never assumed
    tetErr: degrees.reduce((s, d) => s + Math.abs(d.cents - Math.round(d.cents / 100) * 100), 0) / degrees.length,
  };
}

/** The ensemble's combined spectrum: what the culture actually tunes to. */
export function ensembleSpectrum(insts, weights) {
  const spec = [];
  insts.forEach((inst, i) => {
    const w = weights ? weights[i] : 1;
    if (!(w > 0)) return;
    for (const p of inst.partials) {
      if (p.a * w < 0.008) continue;
      spec.push({ f: p.r * 220, a: p.a * w });
    }
  });
  // normalize so curve heights are comparable between peoples
  const tot = Math.sqrt(spec.reduce((s, p) => s + p.a * p.a, 0)) || 1;
  return spec.map(p => ({ f: p.f, a: p.a / tot }));
}

export const cents = (r) => 1200 * Math.log2(r);
/** Nearest just ratio within a tolerance, for labelling only (never for tuning). */
const JUST = [[1, 1, "unison"], [16, 15, "16:15"], [9, 8, "9:8"], [6, 5, "6:5"], [5, 4, "5:4"], [4, 3, "4:3"],
  [7, 5, "7:5"], [3, 2, "3:2"], [8, 5, "8:5"], [5, 3, "5:3"], [7, 4, "7:4"], [9, 5, "9:5"], [15, 8, "15:8"], [2, 1, "octave"]];
export function nearJust(ratio, tolCents = 12) {
  let best = null, bd = Infinity;
  for (const [a, b, label] of JUST) {
    const d = Math.abs(cents(ratio) - cents(a / b));
    if (d < bd) { bd = d; best = label; }
  }
  return bd <= tolCents ? best : null;
}
