import { FAMILIES, definiteness } from "./musicInstruments.js";
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
/**
 * HOW A BODY'S PITCH ANSWERS TO ITS OWN SIZE.
 *
 * A maker does not choose a frequency. They cut a length — a string, a bore, a
 * bar — and the pitch is whatever that length gives. What the cut DOES to the
 * pitch is the body's physics and nothing else:
 *
 *   string, air column   f ∝ 1/L    halve it and you have the octave
 *   bar, clamped tongue  f ∝ 1/L²   halve it and you have TWO octaves
 *   membrane, plate      f ∝ 1/r
 *
 * That difference is the whole reason a string culture and a metallophone
 * culture arrive at different scales from the same act.
 */
export const LENGTH_POWER = { string: 1, air: 1, membrane: 1, shell: 1, tongue: 2, bar: 2, plate: 2 };

/**
 * THE PITCHES A MAKER'S HANDS CAN ACTUALLY PRODUCE.
 *
 * Marking a length in halves, thirds, quarters, fifths and sixths is something
 * you can do by folding and stepping; past about a sixth you cannot place the
 * mark by eye. That bound is a claim about hands, not about music.
 *
 * And the cut is taken from a length you ALREADY HAVE, not only from the whole
 * — which is how the monochord actually works, and how 三分損益 works: take two
 * thirds of what you just found, then four thirds of that, and keep going. So
 * the candidates are a lattice grown off the degrees already placed.
 *
 * For a string (power 1) the lattice is the just ratios — 3/2, 4/3, 5/4, 6/5.
 * For a bar (power 2) it is their SQUARES — 9/8, 16/9, 25/16, 36/25 — which
 * is a completely different set, and that is the prediction: a string-and-pipe
 * people should land on just intervals and a metallophone people should not.
 */
const PARTS = [[2, 1], [3, 1], [3, 2], [4, 1], [4, 3], [5, 1], [5, 2], [5, 3], [5, 4], [6, 1], [6, 5]];
export function cutPitches(power, frameCents, haveCents) {
  const out = new Map();
  for (const base of haveCents) {
    const bR = Math.pow(2, base / 1200);
    for (const [m, n] of PARTS) {
      let r = bR * Math.pow(m / n, power);
      // A CUT THAT OVERSHOOTS IS FOLDED BY THE OCTAVE, not by the frame. Where
      // a people's pattern repeats is its own business; that halving a string
      // gives the same note again is a fact about the string, and about ears,
      // and is not up for negotiation. Folding by the frame instead asserted
      // that 1200 and the frame were the same note — so a people repeating at
      // 1156 had a forty-four-cent interval handed to it as a legitimate cut,
      // and every degree grown off that one inherited the smear.
      while (r >= 1.9995) r /= 2;
      while (r < 1) r *= 2;
      for (let oct = 0; ; oct++) {
        const c = 1200 * Math.log2(r) + 1200 * oct;
        if (c > frameCents - 1) break;
        if (c >= 1) out.set(Math.round(c * 4), c);   // quarter-cent dedupe
      }
    }
  }
  return [...out.values()].sort((a, b) => a - b);
}

// THE RESOLUTION OF THE CURVE, not a rule about music.
//
// This is the closest two degrees may sit, and it is used both ways a degree
// can arrive — the minima picked off the curve, and the cuts the maker adds.
// Its job is to stop ONE dip being counted twice: Plomp-Levelt's roughness peak
// sits at about a quarter of a critical band, which in this register is some
// tens of cents wide, so two minima closer than that are one feature found
// twice rather than two intervals.
//
// It was 120, on the claim that below that a step reads as an inflection of one
// degree rather than as two. The bench refutes that outright. Six of its seven
// traditions have a narrowest step under 145 cents — 112 in Ḥijāzkār, in
// Bhairavī and in Mixolydian, 90 in in-sen — and nobody has ever mistaken the
// semitone of a diatonic scale for an inflection. What IS an inflection is a
// quarter-tone, and 70 cents sits just above one.
//
// The cost of the old value was total: measured across 240 derived peoples, the
// narrowest step anywhere in the corpus was 133 cents, ONE people in a hundred
// had a step that leans at all, and the entire sultry-to-sparse half of
// `affectOf` was unreachable by construction. A world that cannot make a
// semitone cannot make a maqām, a rāg, or a shakuhachi piece.
const STEP_FLOOR = 70;
// How much relative spread a set of steps may have and still be a scale, used
// where the degrees are MADE (`deriveScale`) and where they are chosen from
// (`deriveMode`).
//
// This was 0.35, cited against the diatonic at 0.26, slendro at 0.06 and pelog
// at 0.35 — three tunings that happen to be even, offered as the evidence for
// what evenness is allowed to be. The bench sitting in this same repository
// contains two that are not: Ḥijāzkār's steps spread 0.42 and in-sen's 0.60. So
// the generator was rejecting as insufficiently even two of the seven
// traditions the bench exists to calibrate it against, and every mode shaped
// like them. 0.60 is the widest thing the evidence actually contains.
const EVEN_SPREAD = 0.6;
const EVEN_W = 0.55;

export function deriveScale(spec, { cap = 7, pull = 0, minDepth = 0.02, frameSpec = null, power = 1 } = {}) {
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
  //
  // BUT IT IS A DIFFERENT QUESTION FROM THE DEGREES, and one curve was
  // answering both. "Which intervals sound smooth" is decided by the body a
  // tradition cannot retune — everyone else bends to it, so its consonances
  // become the tradition's, and `musicOf` gives it five times the weight to
  // say so. "Which interval REPEATS" is not that question at all: it is about
  // what the ensemble actually radiates, all of it, at the shares it really
  // plays in. Letting the tuning reference's amplified voice decide it too
  // meant one minority bar set could put a whole string-and-pipe culture's
  // octave at a minor sixth. Measured, the compression was monotone in that
  // multiplier — x1 gave 2 compressed frames in 80, x5 gave 9, x12 gave 19 —
  // and no human music repeats at a minor sixth. So the caller may hand in a
  // second spectrum for the frame alone; the degrees are untouched, and the
  // measured difference between a metal tradition's scale and a string
  // tradition's is unchanged at 5.5 cents either way.
  const fCurve = frameSpec ? dissonanceCurve(frameSpec) : curve;
  const framePool = minimaOf(fCurve).filter(m => m.ratio > 1.6);
  const frame = framePool.length
    ? framePool.reduce((a, b) => (b.prom > a.prom ? b : a))
    : { ratio: 2, cents: 1200, prom: 0 };

  // CANDIDATE DEGREES: prominent minima strictly inside the frame — and no two
  // of them on top of each other.
  //
  // The invention loop sixty lines below already refuses a cut that lands
  // within `STEP_FLOOR` of a degree already placed, and the comment there says
  // exactly why: Plomp-Levelt's roughness PEAK is a couple of hundred cents
  // wide in this register, so for a sparse or inharmonic spectrum the
  // least-rough new pitch is one crammed against a pitch already there, and
  // minimising roughness honestly returns a CLUSTER. That is a fact about the
  // curve, not about how a degree came to be chosen — but the rule was only
  // applied to degrees that arrived by CUTTING, and never to the ones that
  // arrived by LISTENING, in the same function, on the same scale.
  //
  // So a scale built entirely from minima could crawl, and did. Measured on
  // seed 1041: nine degrees at 0 158 315 443 597 718 837 960 1079, every one
  // of them `found`, steps of 158 157 128 154 121 119 123 119 121. That is a
  // chromatic ladder, and no subset of it is a mode — of all 56 six-note
  // subsets the best available still had a semitone in it. The mode search was
  // being blamed for a set it was handed.
  //
  // Deepest first, and a minimum that lands inside the floor of one already
  // taken is the same degree heard twice, so it goes.
  const inside = [];
  for (const m of mins
    .filter(m => m.ratio > 1.02 && m.ratio < frame.ratio - 0.012 && depth(m) >= minDepth)
    .sort((a, b) => b.prom - a.prom)) {
    if (inside.length >= Math.max(1, cap - 1)) break;
    const c = 1200 * Math.log2(m.ratio);
    if (c < STEP_FLOOR || frame.cents - c < STEP_FLOOR) continue;
    if (inside.some(d => Math.abs(1200 * Math.log2(d.ratio) - c) < STEP_FLOOR)) continue;
    inside.push(m);
  }
  inside.sort((a, b) => a.ratio - b.ratio);

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
  // HOW MANY DEGREES A SCALE NEEDS IS SET BY HOW WIDE ITS FRAME IS.
  // `STEP_FLOOR` says how small an interval stops reading as a step; this is
  // the same statement from the other end. Beyond about a fourth a gap is no
  // longer a step a singer takes — it is a leap, and a scale with a leap in it
  // is a scale missing a degree there. So the maker goes on cutting until the
  // gaps are steps, and stops when the instruments run out of pitches (`cap`),
  // which is the honest reason a small pipe in a wide frame keeps its gaps.
  const stepsNow = () => {
    const cs = degrees.map(d => d.cents).sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < cs.length; i++) out.push((i + 1 < cs.length ? cs[i + 1] : frame.cents) - cs[i]);
    return out;
  };
  const ringGaps = () => Math.max(...stepsNow());
  // …AND "THE GAPS ARE STEPS" IS AN EVENNESS QUESTION, not a width one.
  //
  // `STEP_CEIL` says a gap past about a fourth is a leap. That is true and it
  // is far too permissive to stop on: measured, it alone left the corpus at 4.4
  // degrees a scale, where the world's sit at five to seven, because a set of
  // 400-cent gaps satisfies it completely and is not a scale anyone plays.
  //
  // `deriveMode` already has the better-evidenced form of the same statement
  // and real tunings to back it: a scale is a RUN OF COMPARABLE STEPS, and they
  // sit under about a third of relative spread — the diatonic is 0.26, slendro
  // 0.06, pelog 0.35. So the maker goes on cutting while the steps are still
  // uneven, and stops when they are comparable or the body runs out of room.
  // That also puts each new degree where one is missing rather than anywhere it
  // fits, which is the difference between filling seed 1037's 417-cent gap and
  // stranding a pitch at 141.
  const uneven = () => {
    const st = stepsNow();
    if (st.length < 2) return true;
    const mean = st.reduce((a, x) => a + x, 0) / st.length;
    if (!(mean > 0)) return false;
    const cv = Math.sqrt(st.reduce((a, x) => a + (x - mean) * (x - mean), 0) / st.length) / mean;
    return cv > EVEN_SPREAD;
  };
  const wants = () => ringGaps() > STEP_CEIL || uneven();
  // A SCALE IS FINISHED WHEN ITS GAPS ARE STEPS — not when it reaches a count.
  //
  // The paragraph above states the mechanism exactly: the maker goes on cutting
  // until the gaps are steps, and stops when the instruments run out of
  // pitches. Then a third condition was bolted across it — `want = max(4,
  // min(cap, 7))`, a floor saying a scale needs seven degrees — and a floor on
  // the COUNT is the answer written down. It fired even when every gap was
  // already a step, which is the case it did the damage in.
  //
  // Measured on seed 1037: the curve heard 0 417 698 879 1020, a clean
  // pentatonic set whose widest gap is 417 cents, well inside the 500 a fourth
  // allows. Nothing needed filling. `want` invented two degrees anyway, one of
  // them at 141 cents — a pitch 39 cents from any note either side of it, which
  // is what the ear picks out of that people's music immediately and what no
  // amount of work on the MODE could have removed, because the mode can only
  // choose among degrees the scale hands it.
  //
  // A people whose spectrum offers five clean degrees has a five-degree scale.
  // That is most of the world's music, and it arrives here by the frame being
  // full rather than by a count being met. The floor that remains is the gap
  // rule's own: no gap wider than a fourth means at least three degrees in an
  // octave, whatever the spectrum says.
  // BOTH CONDITIONS, not either. The maker cuts while there is somewhere a cut
  // is NEEDED (a gap too wide to be a step) and while there is room on the body
  // to put one (`cap`, which now counts pitches per FRAME rather than per
  // instrument). Either alone is a quota: `want` was one, and turning this
  // conjunction into a disjunction is the same mistake wearing `cap` — measured,
  // it filled every scale to the body's limit and took invented degrees from
  // 27% to 39% and stranded pitches from 149 to 193.
  if (degrees.length < cap && wants()) {
    // Dividing the frame into equal parts is the ANSWER written down, not the
    // mechanism — and it was supplying nearly half of every pitch in the
    // system, so most scales were an equal division in disguise and sounded
    // like each other. What a maker without timbral guidance actually does is
    // cut and listen: try a step, hear whether it fights what is already
    // there, keep it if it does not. So search for the pitch that leaves the
    // set LEAST rough overall, and let the answer be whatever it is. Where the
    // timbre really is featureless the search does converge on near-equal
    // steps — but it arrives there rather than starting there, and where the
    // timbre has any structure at all it finds that instead.
    const lo = 1.02, hi = frame.ratio - 0.012;
    while (degrees.length < cap && wants()) {
      let best = null, bestCost = Infinity;
      // A MAKER CUTS WHERE THE HOLE IS.
      //
      // This searched the whole frame, so the loop could run BECAUSE a gap was
      // too wide and then place its degree nowhere near it. Measured on seed
      // 1037: the heard set 0 417 698 879 1020 has a 417-cent hole and the cut
      // went in at 141, filling nothing and stranding a pitch 44 cents from any
      // note either side of it — the one a listener picks out of that people's
      // music immediately. The condition on the loop and the choice inside it
      // were answering different questions.
      //
      // Somebody who has noticed their scale has a hole in it cuts INTO the
      // hole. Which is also the only place a new degree can improve anything:
      // everywhere else is already a step. So the gap decides where, the cut
      // lattice decides which divisions are available in there, and roughness
      // decides between those — three rules, each doing its own job.
      const cs = degrees.map(d => d.cents).sort((a, b) => a - b);
      let gapLo = 0, gapHi = frame.cents, widest = 0;
      for (let i = 0; i < cs.length; i++) {
        const top = i + 1 < cs.length ? cs[i + 1] : frame.cents;
        if (top - cs[i] > widest) { widest = top - cs[i]; gapLo = cs[i]; gapHi = top; }
      }
      // WHERE THE CANDIDATES COME FROM. This used to sweep a four-cent grid
      // across the whole frame — a continuum, offered to a question that has
      // no answer on one. Plomp–Levelt's roughness PEAK is a couple of hundred
      // cents wide in this register, so for a sparse or inharmonic spectrum
      // the least-rough new pitch is one crammed against a pitch already
      // there, and minimising roughness honestly returned a cluster: scales
      // beginning 0, 130, 260, and modes with crawls in them that no one could
      // sing and the mode search could not avoid.
      //
      // A maker does not sweep a continuum. They cut, and then they listen.
      // The cutting is what produces the candidates; the listening — every
      // line below this one, unchanged — chooses among them.
      for (const c of cutPitches(power, frame.cents, degrees.map(d => d.cents))) {
        const r = Math.pow(2, c / 1200);
        if (r < lo || r > hi) continue;
        if (c <= gapLo || c >= gapHi) continue;
        if (degrees.some(d => Math.abs(d.cents - c) < STEP_FLOOR)) continue;
        const set = [...degrees.map(d => d.ratio), r, frame.ratio];
        let cost = 0, n = 0;
        for (let a = 0; a < set.length; a++) {
          for (let b = a + 1; b < set.length; b++) {
            let q = set[b] / set[a]; if (q < 1) q = 1 / q;
            cost += dissonance(spec, q); n++;
          }
        }
        cost /= n || 1;
        // …AND THE MAKER IS ALSO CUTTING. Roughness alone cannot answer this
        // question, which is the whole reason the search exists: where the
        // spectrum is sparse the dissonance curve is nearly flat, and worse
        // than flat, Plomp–Levelt puts its roughness PEAK at a couple of
        // hundred cents in this register — so for a bar set or a plucked
        // tongue the least-rough new pitch is one crammed up against a pitch
        // already there. Measured, that is what came out: scales with degrees
        // at 130, 260, and a mode with two crawls in it that no one could sing
        // and the mode search could not avoid, because the scale it chose from
        // had nothing else to offer.
        //
        // What a maker actually does is DIVIDE something — a length of bar, a
        // bore, a string — into parts they can tell apart. So the same
        // evenness the mode search already applies to a set of degrees applies
        // here, where the degrees are made. It is not a floor bolted on: it is
        // the other half of "cut and listen", and it is why the comment above
        // can say the search converges on near-equal steps where the timbre is
        // featureless. Without it, it converged on a cluster.
        const cs = [...degrees.map(d => d.cents), c].sort((a, b) => a - b);
        let sum = 0, sum2 = 0;
        for (let a = 0; a < cs.length; a++) {
          const step = (a + 1 < cs.length ? cs[a + 1] : frame.cents) - cs[a];
          sum += step; sum2 += step * step;
        }
        const kk = cs.length, mean = sum / kk;
        const cv = mean > 0 ? Math.sqrt(Math.max(0, sum2 / kk - mean * mean)) / mean : 0;
        // AND A CUT THAT LEAVES A HOLE HAS NOT FILLED ONE.
        //
        // Restricting the search to the gap is necessary and it is not enough:
        // on seed 1037 the widest gap is the 417 cents from the tonic, and 141
        // is INSIDE it. What that cut leaves is 141 and 276 — one step and most
        // of a hole — where a cut at 200 leaves 200 and 217, two steps. The
        // maker went in to remove a hole; a division that lopsided half-fails
        // at the only thing it was for.
        //
        // So the balance of the split is part of the cost. This is local to the
        // gap being filled and says nothing about any other interval in the
        // scale, which is what keeps it from becoming the pull toward equal
        // division that the note below is about.
        const bal = Math.max(c - gapLo, gapHi - c) / Math.max(1, Math.min(c - gapLo, gapHi - c));
        cost *= 1 + EVEN_W * (bal - 1);
        // A BOUND, NOT A PULL. Made monotone in the spread this drives every
        // scale toward equal division, which is the fault the paragraph above
        // exists to prevent: measured, distinct modes across 240 peoples fell
        // from 68% to 43% and one 275-500-700-975 pentatonic turned up in
        // twenty-two of them. Real tunings are not equal, they are COMPARABLE,
        // so this stays a ceiling — and what tells the search where to cut is
        // not a pull toward evenness but the hole itself. See `gapLo`/`gapHi`.
        cost *= 1 + EVEN_W * (cv > EVEN_SPREAD ? Math.pow(cv / EVEN_SPREAD - 1, 2) : 0);
        if (cost < bestCost) { bestCost = cost; best = { c, r }; }
      }
      if (!best) break;
      degrees.push({ ratio: best.r, cents: best.c, prom: 0, found: false });
      degrees.sort((a, b) => a.cents - b.cents);
    }
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
    let w = weights ? weights[i] : 1;
    if (!(w > 0)) return;
    // A BODY TOO VAGUE TO CARRY A LINE IS TOO VAGUE TO TUNE TO, and for the
    // same reason. Roughness only means something between partials that
    // actually specify a pitch, so a drumhead's Bessel series and a gong's
    // plate modes have no business shaping a melodic scale — and they were
    // shaping it, by as much as a third of a semitone, and in one culture in
    // twelve a gong or a bell was the ×5 tuning REFERENCE for a scale it was
    // then banned from playing. Weighting by definiteness removes them for a
    // stated physical reason instead of by a list of family names.
    w *= Math.pow(definiteness(inst.partials), 2);
    if (!(w > 0.004)) return;
    // AND EACH BODY SOUNDS WHERE IT ACTUALLY SITS. Every instrument used to be
    // sounded at one fictional 220 Hz unison, which quietly broke the whole
    // model: roughness is critical-band dependent, so WHERE a body sits
    // decides which of its intervals are rough, and the engine's own registers
    // put these bodies two octaves apart. Measured, the pretence moved the
    // derived scale by a median of 36 cents and moved the frame itself by more
    // than a quarter-tone in a third of all cultures.
    const f0 = (FAMILIES[inst.fam] && FAMILIES[inst.fam].low ? FAMILIES[inst.fam].low : 200) * 1.5;
    for (const p of inst.partials) {
      if (p.a * w < 0.006) continue;
      spec.push({ f: p.r * f0, a: p.a * w });
    }
  });
  // normalize so curve heights are comparable between peoples
  const tot = Math.sqrt(spec.reduce((s, p) => s + p.a * p.a, 0)) || 1;
  return spec.map(p => ({ f: p.f, a: p.a / tot }));
}

/**
 * A MODE is not the scale. The scale is every interval that sits well against
 * the tonic; a melody moving freely through all of them crawls semitone by
 * semitone and sounds like nothing anyone would sing — using a 6:5 and a 5:4
 * in the same phrase means a 71-cent step between them. What people actually
 * sing is a subset whose notes are consonant WITH EACH OTHER, and that is a
 * property the same roughness model already measures: just take it pairwise
 * over the chosen set instead of against the tonic alone.
 *
 * So the mode is built greedily — start on the tonic, and repeatedly add the
 * degree that leaves the whole set least rough. Small steps are penalised
 * automatically and heavily, because roughness peaks around a quarter of a
 * critical band, which is exactly the interval a crawl uses. Nothing here
 * prefers a major third to a minor one by name: 5:4 simply beats 6:5 against
 * a harmonic spectrum, so harmonic-instrument peoples tend to land on the
 * brighter set on their own, and metal-tuned ones do not.
 */
const STEP_CEIL = 500;      // cents: above this, a gap reads as a leap, not a step
const CRAWL_COST = 0.09;
export function deriveMode(spec, degrees, size = 5, frameRatio = 2, stepShare = 0.65) {
  const n = degrees.length;
  if (n <= size) return degrees.map((_, i) => i);
  // roughness between two degrees of the set, taken the short way round; the
  // frame-wrap counts too, so the step from the top note back up to the tonic
  // is judged like any other
  const ratioOf = (i) => (i === n ? frameRatio : degrees[i].ratio);
  const cache = new Map();
  const pair = (a, b) => {
    const key = a * 64 + b;
    if (cache.has(key)) return cache.get(key);
    let r = ratioOf(b) / ratioOf(a);
    if (r < 1) r = 1 / r;
    const v = dissonance(spec, r);
    cache.set(key, v);
    return v;
  };
  // Exhaustive over subsets that contain the tonic — there are only a handful
  // of degrees, so there is no reason to approximate. Greedy fails here in a
  // specific and audible way: it will take a degree that sits beautifully
  // against the tonic and only afterwards discover that it lands a few dozen
  // cents from another one it already holds.
  const pool = [];
  for (let i = 1; i < n; i++) pool.push(i);
  const pick = size - 1;
  let best = null, bestCost = Infinity;
  const combo = [];
  const walk = (start) => {
    if (combo.length === pick) {
      const set = [0, ...combo, n];       // tonic … frame
      let cost = 0, pairs = 0, crawl = 0;
      for (let a = 0; a < set.length; a++) {
        for (let b = a + 1; b < set.length; b++) { cost += pair(set[a], set[b]); pairs++; }
      }
      cost /= pairs || 1;
      // A mode has to be SINGABLE as well as consonant. Two pitches closer
      // than about a hundred cents are not heard as two scale degrees but as
      // one degree inflected, which is why steps that small are vanishingly
      // rare in the world's tunings. So a set that leaves a crawl in it pays,
      // and pays more the tighter the crawl — a graded cost, not a filter,
      // so a tradition whose frame leaves it no choice can still have one.
      let sum = 0, sum2 = 0;
      for (let a = 0; a + 1 < set.length; a++) {
        const step = 1200 * Math.log2(ratioOf(set[a + 1]) / ratioOf(set[a]));
        if (step < STEP_FLOOR) crawl += Math.pow((STEP_FLOOR - step) / STEP_FLOOR, 2);
        sum += step; sum2 += step * step;
      }
      // …AND A SCALE IS A RUN OF COMPARABLE STEPS. The consonance search alone
      // will happily return a tonic with a cluster of notes a fifth above it —
      // measured, the median mode had its largest step three times its
      // smallest and the worst had nine, which is a chord with a crawl on top,
      // not a scale. The constraint is the same one as the crawl floor and it
      // is about people rather than about physics: a melody is tracked BY
      // INTERVAL, so a set with no consistent step size gives a singer nothing
      // to aim at and a listener nothing to follow. Real tunings sit under
      // about a third of relative spread — the diatonic is 0.26, slendro 0.06,
      // pelog 0.35 — and the ones that go past it, like hijaz, buy it with a
      // single deliberate wide step rather than with scatter.
      const k = set.length - 1;
      const mean = sum / k;
      const cv = mean > 0 ? Math.sqrt(Math.max(0, sum2 / k - mean * mean)) / mean : 0;
      const spread = cv > EVEN_SPREAD ? Math.pow(cv / EVEN_SPREAD - 1, 2) : 0;
      // BOTH SINGABILITY PENALTIES SCALE THE COST, they do not add to it.
      // Added, they were absolute numbers against a roughness figure whose
      // size depends entirely on the spectrum that produced it — so on a rough
      // ensemble they were noise and the search ignored them, which is how a
      // mode with a fourth-wide hole in it survived. As multipliers they mean
      // the same thing on every spectrum: a set half again past the bound pays
      // a tenth more, one twice past pays half again.
      cost *= 1 + CRAWL_COST * 8 * crawl + EVEN_W * spread;
      // A SCALE IS SUNG, SO ITS STEPS ARE THE INTERVALS THAT DECIDE IT.
      // Everything above this line scores the set as a CHORD: the mean
      // roughness over all fifteen or twenty-one pairs, which is the right
      // question for a tuning and the wrong one for a mode. A melody almost
      // never sounds two of its degrees together, and it uses every STEP
      // constantly — so a step nobody can place is not one of fifteen numbers
      // to be averaged away, it is a hole the singer falls into in every
      // phrase. Measured, that is exactly what got through: a mode with two
      // adjacent 130-cent crawls and a 386-cent gap paid a 1.6% penalty for
      // it, because the crawl floor is a hard cutoff at 120 and the evenness
      // term is quadratic from 0.35, and neither of them could see a step that
      // is simply ROUGH.
      //
      // The roughness model already knows. Ask it about the steps, and weight
      // that against the chord question by how stepwise this tradition's own
      // melodic motion is — which is already derived, from the same people.
      let stepCost = 0;
      for (let a = 0; a + 1 < set.length; a++) stepCost += pair(set[a], set[a + 1]);
      stepCost /= Math.max(1, set.length - 1);
      cost = cost * (1 - stepShare) + stepCost * stepShare
        * (1 + CRAWL_COST * 8 * crawl + EVEN_W * spread);
      if (cost < bestCost) { bestCost = cost; best = combo.slice(); }
      return;
    }
    for (let i = start; i < pool.length; i++) {
      if (pool.length - i < pick - combo.length) break;
      combo.push(pool[i]); walk(i + 1); combo.pop();
    }
  };
  walk(0);
  return [0, ...(best || pool.slice(0, pick))].sort((a, b) => a - b);
}

/**
 * WHICH NOTE IS HOME. A mode is a set of pitches; it is not yet a melody's
 * world. Treat a different member as the final and the same five notes turn
 * from dark to bright — the minor-pentatonic set becomes the major-pentatonic
 * one, without a single pitch changing. Rotating the final is the lever real
 * traditions actually use for affect, so this derives it rather than fixing it.
 *
 * A final's BRIGHTNESS here is acoustic, not stylistic: how much of the mode
 * already lives inside that note's own low harmonic series. A degree with a
 * 3:2 and a 5:4 above it is a note the others point at — 5:4 IS the fifth
 * partial of that final, while 6:5 appears nowhere low in its series, which
 * is exactly why one reads as open and the other as shaded. Score each
 * candidate that way and the tradition can pick a bright final for a working
 * day and a darker one for a rite, out of one set of pitches.
 */
const SERIES = [[702, 1], [386, 0.9], [204, 0.55], [1088, 0.5], [884, 0.45], [498, 0.4]];
export function finalsOf(modeCents, frameCents) {
  const L = modeCents.length;
  const out = [];
  for (let f = 0; f < L; f++) {
    let bright = 0;
    for (let k = 1; k < L; k++) {
      const iv = ((modeCents[(f + k) % L] - modeCents[f]) % frameCents + frameCents) % frameCents;
      for (const [target, w] of SERIES) {
        const d = Math.abs(iv - target);
        if (d < 45) bright += w * (1 - d / 45);
      }
    }
    out.push({ f, bright: bright / (L - 1 || 1) });
  }
  return out;
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
