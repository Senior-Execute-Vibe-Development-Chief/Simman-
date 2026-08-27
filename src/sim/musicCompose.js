// ── Composition: turning a people's music into notes ─────────────────────
//
// Two renderers over one derivation (musicGenome.js):
//
//   ambientBar()  — the tone-setting layer. Continuous, generated a cycle at
//                   a time so it can run forever under whatever the viewer is
//                   looking at. `intimacy` is the zoom: far away you hear the
//                   bed, up close you hear the players.
//   composePiece() — a whole piece for an occasion, with real sections.
//
// THE METRICAL GRID. Everything below places notes on a grid of beats and
// subdivisions, and nothing is allowed off it. That is not a stylistic
// preference — a pulse is something a listener ENTRAINS to, and entrainment
// needs a periodic reference to lock onto. Free-floating durations that
// merely add up to the right total produce onsets at arbitrary times, and a
// listener hearing them reports, correctly, that there is no beat. (Measured:
// before this, sixty scheduled notes produced a hundred and fifty-two audible
// attacks with inter-onset intervals scattered from 30ms to 1.4s, and beat
// autocorrelation of 0.24.)
//
// AND MUSIC REPEATS. A line that is freshly improvised every cycle is not a
// melody, however well-formed each phrase is — there is nothing to recognise
// the second time. So each people gets a small BANK of phrases, built once,
// and the ambient layer states them in a fixed order with returns. Repetition
// is what turns a sequence of pitches into a tune.
//
// The OCCASION is the one input from outside the culture: what is happening
// to them right now. In the world sim these are all live state — war level,
// food balance, offerings at a holy see, a coronation.
import { hash32 } from "./peopleSim/rng.js";
import { nPVI } from "./musicGenome.js";
import { articRate, melodicCapacity, FAMILIES } from "./musicInstruments.js";
const FAM = (i) => FAMILIES[i.fam] || {};

// `artic` is how much of the gap to the next note a note actually sounds for.
// `descent` is how strongly breath declination shows. `bright` is which final
// the mode is heard from. None of these replace a mechanism; they scale it.
export const OCCASIONS = {
  peace:    { label: "everyday",  bright: 1,  tempo: 1.06, density: 1.15, reg: 0.35, perc: 0.7,  orn: 0.7,  drone: 0.4,  descent: 0.8,  artic: 0.98,  lead: null },
  rite:     { label: "rite",      bright: -1, tempo: 0.74, density: 0.8,  reg: 0,    perc: 0.3,  orn: 1.2,  drone: 1,    descent: 1.05, artic: 1.05, lead: "sustain" },
  war:      { label: "war",       bright: 0,  tempo: 1.3,  density: 1.15, reg: -0.6, perc: 1,    orn: 0.3,  drone: 0.5,  descent: 0.85, artic: 0.8,  lead: "loud" },
  mourning: { label: "mourning",  bright: -1, tempo: 0.64, density: 0.62,  reg: -0.4, perc: 0.16, orn: 1,    drone: 0.9,  descent: 1.35, artic: 1.1,    lead: "sustain" },
  festival: { label: "festival",  bright: 1,  tempo: 1.22, density: 1.3,  reg: 0.5,  perc: 1,    orn: 0.7,  drone: 0.35, descent: 0.85, artic: 0.86, lead: null },
  work:     { label: "work",      bright: 1,  tempo: 1,    density: 1.2, reg: 0.2,  perc: 0.9,  orn: 0.4,  drone: 0.35, descent: 0.95, artic: 0.9, lead: null },
};

// ── the grid ─────────────────────────────────────────────────────────────
/**
 * A cycle of beats, each divided in two or three, with a METRICAL WEIGHT per
 * slot. Weight is what makes a metre audible: group heads land hardest, beats
 * next, offbeats least, and a pattern that respects that ordering is heard as
 * having a downbeat rather than as a stream of equal events.
 */
export function gridOf(rhythm) {
  const div = rhythm.meterKind === "compound" ? 3 : 2;
  const beats = rhythm.beats;
  // additive metres are unequal groups of beats, not a bar of equal ones —
  // 7 is 2+2+3, not seven of anything
  const groups = rhythm.meterKind === "additive"
    ? (beats === 5 ? [2, 3] : beats === 7 ? [2, 2, 3] : beats === 9 ? [2, 2, 2, 3] : [beats])
    : beats % 4 === 0 ? [beats / 2, beats / 2]
    : beats % 3 === 0 && beats > 3 ? [3, beats - 3]
    : [beats];
  const slots = beats * div;
  const w = new Array(slots).fill(0.22);
  for (let b = 0; b < beats; b++) w[b * div] = 0.55;
  let acc = 0;
  for (const g of groups) { w[acc * div] = 1; acc += g; }
  return { div, beats, slots, groups, w };
}
/** Grid slot → time in beats. Swing delays the weak half of a duple beat by a
 *  fixed ratio — it stays on the grid, it just isn't evenly split. */
function slotBeat(G, s, swing) {
  const off = G.div === 2 && s % 2 === 1 ? swing * 0.2 : 0;
  return s / G.div + off;
}

/**
 * EUCLIDEAN RHYTHM (Bjorklund's algorithm, as Toussaint showed in 2005).
 * Distribute k onsets over n slots as evenly as possible. This is not a
 * stylistic device: Toussaint's result is that the maximally-even patterns
 * ARE the timelines of world music — E(3,8) is the tresillo, E(5,8) a West
 * African bell pattern, E(4,7) the Bulgarian răčenica, E(7,16) a Brazilian
 * necklace, E(5,12) South African, E(11,24) Central African. One evenness
 * principle generates the lot, which is exactly the kind of mechanism this
 * project wants: k and n come from the culture's own metre and density, and
 * the pattern that falls out is a real one without any of them being named.
 */
export function euclid(k, n) {
  if (k <= 0 || n <= 0) return new Array(Math.max(0, n)).fill(false);
  if (k >= n) return new Array(n).fill(true);
  let a = new Array(k).fill(null).map(() => [true]);
  let b = new Array(n - k).fill(null).map(() => [false]);
  while (b.length > 1) {
    const m = Math.min(a.length, b.length);
    const merged = [];
    for (let i = 0; i < m; i++) merged.push(a[i].concat(b[i]));
    const rest = a.length > m ? a.slice(m) : b.slice(m);
    a = merged; b = rest;
    if (a.length <= 1) break;
  }
  return a.concat(b).flat().slice(0, n);
}

/**
 * Which slots carry an onset.
 *
 * Two rules, and the first is not negotiable: A NOTE FALLS ON EVERY DOWNBEAT.
 * That is where a listener taps, and a part that keeps missing it is heard as
 * having no beat however regular its other onsets are; syncopation is the
 * exception a tradition takes deliberately, not the default. (This is the
 * rule Computoser states outright, and its absence is most of why the first
 * cuts here had no pulse.) The rest of the slots are filled by a Euclidean
 * pattern, so what lies between the downbeats is maximally even instead of
 * independently rolled — which is what makes it a groove rather than a
 * scatter.
 */
function makePattern(music, seed, density, syncopation, bars = 1) {
  const G = gridOf(music.rhythm);
  const SPAN = G.slots * bars;
  const wAt = (s) => G.w[s % G.slots];
  const roll = (t) => hash32(seed >>> 0, t) / 4294967296;
  const on = new Set();
  for (let b = 0; b < bars; b++) {
    let acc = 0;
    for (const g of G.groups) { on.add(b * G.slots + acc * G.div); acc += g; }   // every downbeat
  }
  // the rest, spread as evenly as possible ACROSS THE WHOLE PHRASE — which is
  // what lets one bar of it differ from the next instead of every bar being
  // the same bar
  const want = Math.max(1, Math.round(SPAN * Math.min(0.85, density * 0.55)));
  const e = euclid(want, SPAN);
  const rot = Math.floor(roll("rot") * SPAN);
  for (let s = 0; s < SPAN; s++) if (e[(s + rot) % SPAN]) on.add(s);
  // A tradition that pushes against the beat keeps its offbeats; one that does
  // not drops some of them. It used to drop them with probability
  // 1 − 3·syncopation, which for a people with no timekeeper is eighty-nine
  // per cent — most of why the median phrase came out two notes long.
  if (syncopation < 0.25) {
    for (const s of [...on]) if (wAt(s) < 0.5 && roll("d" + s) > 0.45 + syncopation * 2) on.delete(s);
  }
  for (let b = 0; b < bars; b++) {
    let acc = 0;
    for (const g of G.groups) { on.add(b * G.slots + acc * G.div); acc += g; }   // …nothing drops a downbeat
  }
  const onsets = [...on].sort((a, b) => a - b);
  // A NOTE VALUE IS NOT THE GAP TO THE NEXT ONSET. Euclidean patterns are
  // maximally even by construction, so deriving duration from the gap gives
  // every note the same length and a melody with no agogic accent — no long
  // notes, no short ones, no phrase shape, ever. Values are drawn separately,
  // weighted by metrical position (a strong beat can carry a long note; a weak
  // offbeat rarely does), and a long value SWALLOWS the onsets it covers
  // rather than being truncated by them.
  // AGOGIC ACCENT: a strong beat can carry a longer note than a weak one,
  // because the metre gives it room. But it is an accent, not the norm — the
  // old weights gave nearly half of all downbeat notes a half-bar or whole-bar
  // value, which swallowed every onset underneath and left a line made of
  // nothing but long notes. Measured, only eighteen per cent of the long notes
  // in the corpus were at a phrase end, so the one place length genuinely
  // belongs was the one place it wasn't. Length at a cadence is applied where
  // it means something (layPhrase, three grades of it); here the values stay
  // short, which is what notated folk melody overwhelmingly is.
  const VAL = {
    strong: [[1, 0.38], [2, 0.40], [3, 0.14], [4, 0.08]],
    beat: [[1, 0.60], [2, 0.34], [3, 0.06]],
    weak: [[1, 0.88], [2, 0.12]],
  };
  const pickVal = (tier, r) => {
    let acc = 0;
    for (const [v, p] of VAL[tier]) { acc += p; if (r < acc) return v; }
    return 1;
  };
  const notes = [];
  for (let i = 0; i < onsets.length; i++) {
    const sl = onsets[i];
    if (notes.length && sl < notes[notes.length - 1].s + notes[notes.length - 1].v) continue;  // swallowed
    const tier = wAt(sl) >= 1 ? "strong" : wAt(sl) >= 0.5 ? "beat" : "weak";
    let v = pickVal(tier, roll("v" + sl));
    // A note may not run past the end of its own metrical group. One that does
    // obscures the very boundary the group exists to mark, and a value drawn
    // long enough to cross two of them erases the metre outright.
    const inBar = sl % G.slots;
    let room = G.slots - inBar, acc2 = 0;
    for (const g of G.groups) { if (inBar < (acc2 + g) * G.div) { room = (acc2 + g) * G.div - inBar; break; } acc2 += g; }
    v = Math.min(v, Math.max(1, room), Math.max(1, Math.floor((SPAN - sl) / 2)));
    notes.push({ s: sl, v });
  }
  // rests: a line that never stops speaking has no phrases in it
  const rested = notes.filter((n, i) => i === 0 || wAt(n.s) >= 0.5 || roll("r" + n.s) > 0.24);
  return { grid: G, span: SPAN, bars, onsets: rested.map(n => n.s), notes: rested };
}

// ── the melodic line ─────────────────────────────────────────────────────
// A phrase is a walk over the MODE that arches away from where it started and
// comes back to land on a structural degree.
function phrase(music, seedBase, nNotes, startDeg, descent) {
  const M = music.melody, S = music.mode.size;
  const roll = (i, t) => hash32(seedBase >>> 0, i, t) / 4294967296;
  const out = [];
  let deg = startDeg, prevIv = 0;
  const CAND = [-4, -3, -2, -1, 1, 2, 3, 4];
  for (let i = 0; i < nNotes; i++) {
    if (i > 0) {
      const frac = i / Math.max(1, nNotes - 1);
      // A phrase ARCHES: it rises away from where it started and comes back
      // down to land — what a breath does, pressure building then falling.
      // Declination tilts the whole arch downward by as much as the occasion
      // wants (the same fall the speech engine applies to f0).
      const pUp = Math.max(0.12, Math.min(0.9, 0.5 + M.arch * (0.55 - frac) * 1.7 - descent * 0.3 * frac));
      // MELODIC EXPECTATION (Narmour's implication–realization model, in the
      // operational form the generative-melody literature uses). Two findings
      // about what listeners expect, and a line that obeys them reads as
      // INTENDED rather than as a walk:
      //   · pitch proximity — small intervals are overwhelmingly more likely
      //     than large ones, and a melody is mostly steps;
      //   · a small interval implies CONTINUATION in the same direction, but
      //     a leap implies REVERSAL and a stepwise filling-in of the gap it
      //     opened (Meyer's gap-fill).
      // A random walk has neither property, which is why it sounds arbitrary
      // however consonant its pitches are.
      const w = [];
      let tot = 0;
      for (const d of CAND) {
        let v = Math.exp(-Math.abs(d) / 1.55) * (d > 0 ? pUp : 1 - pUp) * (Math.abs(d) === 1 ? M.step * 1.6 : 1);
        if (Math.abs(prevIv) >= 3) {
          v *= Math.sign(d) !== Math.sign(prevIv) ? 3 : 0.2;   // reversal after a leap
          v *= Math.abs(d) <= 2 ? 1.8 : 0.3;                   // …filling the gap stepwise
        } else if (prevIv !== 0) {
          v *= Math.sign(d) === Math.sign(prevIv) ? 1.3 : 0.95; // small intervals continue
        }
        const nd = deg + d;
        if (nd > M.reach || nd < -Math.round(M.reach * 0.34)) v *= 0.04;
        w.push(v); tot += v;
      }
      let r = roll(i, "n") * tot, pick = CAND[0];
      for (let c = 0; c < CAND.length; c++) { r -= w[c]; if (r <= 0) { pick = CAND[c]; break; } }
      deg += pick; prevIv = pick;
    }
    out.push(deg);
  }
  // CADENCE: the last note comes HOME. It used to fall to whichever of the
  // mode's stable degrees was nearest, which for a three-degree stable set
  // meant it landed on the actual final about a third of the time — and
  // measured across the corpus, only a quarter of lines ended on their own
  // home. A phrase that does not resolve is a phrase that has not ended, and
  // an ear that never hears one stops expecting them.
  //
  // Home in the register the line is ALREADY IN, though: a cadence that leaps
  // a frame to reach the final is not a cadence, it is a new phrase's first
  // note. Land on the final if the line can reach it and on the nearest
  // stable degree only when it cannot.
  const last = out.length - 1, here = out[last];
  const lo = -Math.round(M.reach * 0.34);
  const cand = [];
  for (const o of [Math.floor(here / S) - 1, Math.floor(here / S), Math.floor(here / S) + 1]) {
    cand.push({ d: o * S, home: 1 });
    for (const d of M.structural) if (d) cand.push({ d: d + o * S, home: 0 });
  }
  const within = cand.filter(c => c.d <= M.reach && c.d >= lo);
  const pool = within.length ? within : cand;
  out[last] = pool.reduce((a, b) => {
    // a frame's distance is worth giving up to reach home, but no more
    const cost = (x) => Math.abs(x.d - here) + (x.home ? 0 : S * 0.8);
    return cost(b) < cost(a) ? b : a;
  }, pool[0]).d;
  return out;
}

/** Mode index → scale degree, so pitch lookup stays in one place. */
export function modeDegree(music, mi) {
  const mode = music.mode.idx, L = mode.length, S = music.scale.degrees.length;
  const w = Math.floor(mi / L);
  return mode[((mi % L) + L) % L] + w * S;
}

/** Which member of the mode this occasion treats as home. A working day takes
 *  the brightest final the mode offers; a rite or a lament takes a shaded one.
 *  Same pitches either way. */
export function finalFor(music, occKey) {
  const want = (OCCASIONS[occKey] || OCCASIONS.peace).bright ?? 0;
  const fs = music.mode.finals;
  if (!fs || !fs.length) return 0;
  if (want > 0) return fs.reduce((a, b) => (b.bright > a.bright ? b : a)).f;
  if (want < 0) return fs.reduce((a, b) => (b.bright < a.bright ? b : a)).f;
  return 0;
}

/**
 * MOTIF TRANSFORMATION. A tradition does not hold three unrelated tunes; it
 * holds one idea and turns it over. Transposition, inversion, retrograde,
 * varying only the ending, varying everything except the downbeat notes —
 * these are the standard operations, in classical practice and in every
 * rule-based composer that has been built. What they buy is the thing the
 * first cut here lacked entirely: everything you hear is audibly related to
 * everything else, so the music has an argument rather than a sequence.
 *
 * Which operations a people has is not free. Transposition and varying the
 * ending are what a singer can do from memory, so every tradition has them;
 * inversion and retrograde are operations on a written line — you have to
 * SEE the notes to turn them over — so they follow literacy, the same way
 * long non-repeating form does.
 */
const TRANSFORMS = {
  transpose: (m, a) => m.map(d => d + a),
  sequence: (m) => m.map(d => d + 1),
  varyEnd: (m, a, alt) => m.map((d, i) => (i < Math.ceil(m.length * 0.6) ? d : alt[i])),
  varyBase: (m, a, alt, strong) => m.map((d, i) => (strong[i] ? d : alt[i])),
  invert: (m) => m.map(d => 2 * m[0] - d),
  retrograde: (m) => [...m].reverse(),
};
function transformsFor(literacy) {
  const oral = ["transpose", "sequence", "varyEnd", "varyBase"];
  return literacy > 0.5 ? oral.concat(["invert", "retrograde"]) : oral;
}

/**
 * The phrase bank: a handful of complete cycles, built ONCE per people and
 * occasion and then returned to. This is what makes a melody a melody — the
 * ambient layer states A, repeats it, answers with B, returns to A. Nothing
 * is regenerated per cycle, so the line is recognisable the second time.
 */
export function phraseBank(music, occKey) {
  const key = "_bank:" + occKey;
  if (music[key]) return music[key];
  const O = OCCASIONS[occKey] || OCCASIONS.peace;
  const fin = finalFor(music, occKey);
  const R = music.rhythm, G = gridOf(R);
  // A PHRASE IS NOT A BAR. It used to be exactly one metrical cycle, and after
  // the offbeat cull and the long values that swallow their neighbours, the
  // median melody came out TWO NOTES LONG. Nothing else could work on top of
  // that: a two-note line has one interval, so it cannot arch; the dynamic arc
  // is provably flat (sin(π/4) = sin(3π/4)); and the rule that lands a phrase
  // on a structural degree rewrites half the melody. Twenty-nine per cent of
  // pieces came out as a single pitch repeated.
  //
  // How long a phrase is was already derived — `melody.phraseBeats`, from how
  // long a singer's breath is and how the language groups its words — and was
  // read nowhere in the repo. Read it.
  const bars = Math.max(2, Math.min(4, Math.round((music.melody.phraseBeats || 6) / G.beats) || 2));
  const seed = hash32(music.people.seed, "ph", occKey);
  const dens = Math.min(0.95, R.density * O.density);
  const pat = makePattern(music, seed, dens, R.syncopation, bars);
  const motif = phrase(music, seed + 1, pat.onsets.length, 0, music.melody.descent * O.descent);
  const strong = pat.onsets.map(s => pat.grid.w[s % pat.grid.slots] >= 1);
  const alt = phrase(music, seed + 2, pat.onsets.length, 0, music.melody.descent * O.descent);
  const ops = transformsFor(music.people.soc.literacy);
  const bank = [{ pat, degs: motif, fin, label: "motif" }];
  for (let k = 1; k < 3; k++) {
    const op = ops[hash32(seed, "op", k) % ops.length];
    const M = music.melody, lo = -Math.round(M.reach * 0.34);
    // EACH ENTRY GETS ITS OWN RHYTHM. All three used to share one pattern
    // object, so a "variation" changed pitches over an identical set of
    // onsets, durations, rests and accents — and since half the pitch
    // transforms came out as literal copies too, the answering phrase was
    // frequently the statement. Rhythm is where most of the audible difference
    // between two phrases lives.
    const p2 = makePattern(music, seed + 90 * k, dens * (0.85 + 0.3 * (k - 1)), R.syncopation, bars);
    const head = M.reach - Math.max(...motif), foot = Math.min(...motif) - lo;
    const amt = head >= 1 ? Math.min(head, 1 + (hash32(seed, "amt", k) % 2))
      : foot >= 1 ? -Math.min(foot, 1 + (hash32(seed, "amt", k) % 2)) : 0;
    let degs = TRANSFORMS[op](motif, amt, alt, strong);
    const hi = Math.max(...degs), low = Math.min(...degs);
    const shift = hi > M.reach ? M.reach - hi : low < lo ? lo - low : 0;
    if (shift) degs = degs.map(d => d + shift);
    // However far it wanders it comes home — but only if there is enough
    // phrase left for an ending to exist. Forcing the last note back onto the
    // motif's last note is what turned varying the ending into a guaranteed
    // no-op (it varies only the final notes) and inversion into the identity.
    if (degs.length >= 4) degs[degs.length - 1] = motif[motif.length - 1];
    // fit the pitches to whatever rhythm this entry drew
    const n2 = p2.onsets.length;
    const fitted = Array.from({ length: n2 }, (_, i) => degs[Math.floor(i * degs.length / n2)]);
    if (fitted.length >= 4) fitted[fitted.length - 1] = motif[motif.length - 1];
    bank.push({ pat: p2, degs: fitted, fin, label: op });
  }
  music[key] = bank;
  return bank;
}

/**
 * THE FORM: which phrase, in what order, for how long.
 *
 * This was a literal — `[0,0,1,0,0,2,1,0]`, the same eight slots for every
 * people on every map at every literacy, and the ambient layer read nothing
 * from `music.form` at all. Two cardinal rules broken at once: the shape of
 * the music was written down as the answer instead of falling out of the
 * mechanism that already existed to produce it, and which phrase played was
 * gated on `bar % 8` — on WHEN it is, not on what the tradition is.
 *
 * The mechanism was already there. An oral tradition states a formula and
 * returns to it, because return is how a thing survives being remembered; a
 * literate one can depart and not come back the same way, because the line
 * does not have to be held in anyone's head. So `repetition` decides how often
 * the statement comes back and `development` decides how far the departures
 * go, and the LENGTH of the form varies with them too.
 */
export function formOrderOf(music) {
  const F = music.form;
  const seed = hash32(music.people.seed, "order");
  const n = Math.max(4, Math.min(16, Math.round(F.sections * F.phrasePerSection * (1 + F.development))));
  const out = [0];
  let last = 0;
  for (let i = 1; i < n; i++) {
    const r = hash32(seed, "o", i) / 4294967296;
    // the last slot always comes home
    if (i === n - 1) { out.push(0); continue; }
    // a return is due whenever memory says so, and departure is bounded by how
    // far this tradition develops
    const home = r < F.repetition * 0.55 + 0.2;
    if (home) { out.push(0); last = 0; }
    else out.push(last === 0 ? (r < 0.5 + F.development * 0.4 ? 1 : 2) : (last = last === 1 ? 2 : 1));
    last = out[i];
  }
  return out;
}

/**
 * The BASS: one note per group head, on the mode's stable degrees, an octave
 * or so under everything else. Every rule-based composer that sounds like
 * music has one, and its absence is why a melody-over-a-drone reads as thin
 * and unanchored — the drone says where home is but never moves, so nothing
 * ever confirms or contradicts it. A bass that steps between stable tones
 * gives the cycle somewhere to go and somewhere to arrive.
 */// ── the timeline ─────────────────────────────────────────────────────────
//
// The pattern the whole ensemble orients to. It was generated as a maximally
// even (Euclidean) rhythm, which is most of the way there and demonstrably not
// all of it: of the ten twelve-pulse seven-stroke timelines that traditional
// music actually uses, a Euclidean generator produces six — they are six of
// its seven rotations — while its SEVENTH rotation is used nowhere on earth,
// and four more real patterns are not maximally even at all and it cannot
// reach them. The son and rumba claves, the two most widespread timelines in
// the Atlantic world, are among the ones it cannot produce.
//
// So do not generate the answer: SEARCH for it, by the properties a timeline
// has to have. There are only a few hundred candidates and three real
// constraints, every one of them a measurable property of the pattern rather
// than a name:
//
//   · ODDITY (Arom): no two onsets sit exactly half a cycle apart, so the
//     pattern cannot be split evenly and the cycle has a direction.
//   · NEAR-EVENNESS: the onsets are spread about as widely as they can be.
//     Real timelines occupy the top few evenness classes and nothing below.
//   · IT MUST NOT AGREE WITH THE BEAT. This is the one the Euclidean
//     generator has no way to express, because it is a property of the
//     ROTATION rather than of the pattern, and rotation is exactly what an
//     algorithm cannot supply. The standard West African bell lands on two of
//     the four main beats out of seven strokes; that mismatch is the
//     mechanism, and a timeline that agrees with the beat is just the beat.
function rhythmOddity(set, n) {
  const half = n / 2;
  if (n % 2) return 1;
  for (const a of set) if (set.has((a + half) % n)) return 0;
  return 1;
}
function evenness(set, n) {
  const on = [...set].sort((a, b) => a - b), k = on.length;
  const ideal = n / k;
  let e = 0;
  for (let i = 0; i < k; i++) {
    const gap = ((on[(i + 1) % k] - on[i] + n) % n) || n;
    e += (gap - ideal) * (gap - ideal);
  }
  return e / k;
}
/**
 * The timeline for this people, searched rather than generated. Deterministic:
 * every people with the same metre and the same density gets the same one, and
 * a people with a different feel for the beat gets a different one.
 */
export function timelineOf(music, G, seed) {
  const n = G.slots;
  const k = Math.max(3, Math.min(n - 2, Math.round(n * (0.42 + 0.22 * music.rhythm.syncopation))));
  const beats = new Set();
  { let a = 0; for (const g of G.groups) { beats.add(a * G.div); a += g; } }
  // candidates: every rotation of every near-even necklace, scored
  let best = null, bestScore = -Infinity;
  const pick = new Set();
  const build = (start, chosen) => {
    if (chosen.length === k) {
      const set = new Set(chosen);
      if (!set.has(0)) return;                       // a timeline starts the cycle
      const ev = evenness(set, n);
      if (ev > 2.2) return;                          // only the top evenness classes
      let onBeat = 0;
      for (const b of beats) if (set.has(b)) onBeat++;
      // it has to state the downbeat and then disagree with the beat
      const agree = onBeat / beats.size;
      const h = hash32(seed, "tl", chosen.join(",")) / 4294967296;
      const score = -ev * 1.4 - Math.abs(agree - 0.45) * 6 + rhythmOddity(set, n) * 1.1 + h * 0.5;
      if (score > bestScore) { bestScore = score; best = [...chosen]; }
      return;
    }
    for (let i = start; i < n; i++) { chosen.push(i); build(i + 1, chosen); chosen.pop(); }
  };
  build(0, []);
  if (!best) { const e = euclid(k, n); best = []; for (let i = 0; i < n; i++) if (e[i]) best.push(i); }
  for (const b of best) pick.add(b);
  return pick;
}


// ── WHO PLAYS HOW FAST ───────────────────────────────────────────────────
//
// The single change that turns this texture into music, and the one the engine
// had backwards. It organised on SUSTAIN: a body that rang for a long time got
// a slow, sustained part, so a culture whose best instruments were bronze
// ended up with a slow moody drift. Every real tradition built on ringing
// metal does the opposite. In a gamelan the great gong — lowest, loudest,
// twenty seconds of decay — sounds ONCE per cycle, and over the top of it the
// small bronze keys run at ten notes a second. The players state the rule
// flatly: the lowest instruments play most sparsely and the highest play
// fastest, and the spread inside one ensemble is thirty-two to one.
//
// So density is not a style setting, it is a physical limit: a part can play
// as fast as its own body can get out of the way and no faster. That number
// already exists — a body's articulation rate, from its ring-down and whether
// a hand can stop it — and reading density off it produces the stratified
// texture for free, in both the families the engine got wrong. A hung gong
// clears a fifth of a note per second, so in an eight-second cycle it gets one
// stroke; a wooden bar clears ten, so it gets as many as the grid has. Nobody
// decided that. And because the parts land at different densities, the
// COMPOSITE fills the cycle even though no single player is playing fast —
// which is the organising principle of West African drumming and of Balinese
// interlocking alike.
//
// Loudness follows, in the direction that is surprising until it isn't: a
// player spends about the same effort per cycle whatever their part, so one
// stroke gets all of it and thirty-two share it. The sparse low things are the
// loud ones — which is why the biggest gong in the room is also the rarest
// sound in it, and why intensity in these traditions is built by adding
// onsets and changing strokes rather than by turning anything up.
const STRATA = ["mark", "core", "lead", "elab", "bass", "ost", "pulse", "drone"];

export function strataOf(music, E, G, cycleSlots, secPerBeat) {
  const cycleSecs = (cycleSlots / G.div) * secPerBeat;
  const out = {};
  for (const role of STRATA) {
    const k = E[role];
    if (k == null) continue;
    const inst = music.insts[k];
    if (!inst) continue;
    const canDo = articRate(inst) * cycleSecs;          // what the body allows
    // A punctuating body's ring IS its part: it sounds once and fills the
    // cycle, so what bounds it is not how fast it could be hit but how long it
    // goes on for.
    const want = role === "mark" ? Math.max(1, Math.round(cycleSecs / Math.max(1, inst.partials[0].d)))
      : role === "core" ? cycleSlots / (2 * G.div)
      : role === "bass" ? G.groups.length * Math.max(1, cycleSlots / G.slots)
      : role === "drone" ? Math.max(2, cycleSecs / 1.7)
      : role === "elab" ? cycleSlots
      : role === "ost" ? cycleSlots / 2
      : cycleSlots * 0.7;
    const n = Math.max(1, Math.round(Math.min(canDo, want)));
    // the same effort, spread over however many strokes it buys — but a
    // gesture, not a formula: one stroke of a great gong is a whole-body swing
    // and thirty-two notes on a small key are wrist flicks, and neither is
    // four times the other
    out[role] = { k, inst, n, vel: Math.max(0.16, Math.min(0.88, 0.46 / Math.pow(Math.max(1, n) / 6, 0.34))) };
  }
  return out;
}

// ── the cycle ────────────────────────────────────────────────────────────
/**
 * How long a cycle a tradition can hold. It has to be trackable with nothing
 * written down, and what makes it trackable is having a reference to count
 * against and enough players to share the counting.
 */
export function cycleBars(music) {
  const soc = music.people.soc;
  const held = 0.5 * soc.literacy + 0.3 * Math.min(1, music.texture.size / 6) + 0.2 * soc.urban;
  return held > 0.62 ? 4 : held > 0.34 ? 3 : 2;
}

// ── the shape of a piece ─────────────────────────────────────────────────
/**
 * A piece as a run of sections, each with its own density, register and
 * landing pitch. Nothing used to vary: the same tempo, register, ensemble and
 * dynamics throughout, and every part except the melody regenerated
 * byte-identically because it was memoised on the occasion and took no
 * argument that could change it. Ninety-four per cent of pieces were one
 * metrical cycle repeated end to end. That is the drone.
 *
 * What varies in real music, in the order the evidence puts them:
 *
 *   · DENSITY, four- to sixteen-fold, in doublings, while the pulse stays put.
 *     This is the near-universal: Javanese irama runs 1:2:4:8:16 and SLOWS the
 *     pulse as it densifies, and measured dhrupad holds its metric tempo in a
 *     narrow band across a whole concert while the surface rate multiplies by
 *     the same integers. Tempo is the least universal of the three, so it is
 *     left alone.
 *   · THE ENSEMBLE, at every boundary. Timbre is the strongest cue a listener
 *     has that something changed — stronger than loudness, whose measured
 *     effect on whether a section reads as new is not distinguishable from
 *     zero. So parts enter and leave.
 *   · REGISTER, as an ARCH: up about an octave by two-thirds through and back
 *     down to close. The melodic arch is one of the few documented
 *     cross-cultural universals and it holds over a whole piece as well as
 *     over a phrase — the Persian radif names both ends of it, the climb to
 *     the oj and the forud that lands home again.
 *   · WHERE PHRASES END. A modal tradition has no chord changes, so what moves
 *     instead is the landing tone, while the drone holds the final — and the
 *     drone holding still is exactly what makes the movement audible.
 */
export function sectionsOf(music, occKey) {
  const F = music.form, O = OCCASIONS[occKey] || OCCASIONS.peace;
  const seed = hash32(music.people.seed, "form", occKey);
  const n = Math.max(3, Math.min(7, F.sections + 2));
  const stable = music.melody.structural;
  const out = [];
  for (let s = 0; s < n; s++) {
    const t = n > 1 ? s / (n - 1) : 0;
    const climb = Math.min(1, t / 0.72);
    out.push({
      label: s === 0 ? "statement" : s === n - 1 ? "close" : `variation ${s}`,
      // sections are not the same length — equal ones are the loudest single
      // tell that this is a loop and not a piece
      cycles: s === 0 ? 1 : (t > 0.55 && t < 0.9 ? 2 : 1 + (hash32(seed, "len", s) % 2)),
      dens: Math.pow(2, Math.round(2.4 * climb) - (t > 0.82 ? 1 : 0)),
      // The climb is real — the arch to a high point and the landing back home
      // is one of the few cross-cultural universals — but it does NOT have to
      // be made of octave jumps. A modal tradition moves its tonal CENTRE
      // instead, through the mode, and that is what `ist` below does. A whole
      // frame is reserved for the peak alone, where a real climax does change
      // register; everywhere else an octave leap at a section seam is a leap
      // to a note nothing approached.
      oct: t > 0.55 && t < 0.86 ? 1 : 0,
      ist: s === 0 || s === n - 1 ? 0
        : stable[(1 + hash32(seed, "ist", s) % Math.max(1, stable.length)) % stable.length] || 0,
      // how much of the ensemble is playing: thin at the edges, full at the peak
      thin: 0.42 + 0.58 * Math.sin(Math.PI * Math.min(1, (t + 0.08) / 1.02)),
      grade: s === n - 1 ? 2 : 1,
      orn: O.orn * (0.7 + 0.6 * climb),
    });
  }
  return out;
}
/** Which section a given cycle falls in, and how far through it. */
export function sectionAt(secs, cycle) {
  const total = secs.reduce((a, s) => a + s.cycles, 0) || 1;
  let p = ((cycle % total) + total) % total;
  for (let i = 0; i < secs.length; i++) {
    if (p < secs[i].cycles) return { sec: secs[i], i, into: p, last: p === secs[i].cycles - 1 };
    p -= secs[i].cycles;
  }
  return { sec: secs[secs.length - 1], i: secs.length - 1, into: 0, last: true };
}

// ── colotomy ─────────────────────────────────────────────────────────────
/**
 * The punctuation. A single ringing body cannot play a line, but it can say
 * where you are — and that is a NESTED job rather than one stroke. The great
 * gong closes the whole cycle, the next instrument down quarters it, the next
 * halves those, and nothing sounds where the level above it sounds. That
 * nesting is the listener's map of a long cycle, and it costs one event per
 * level.
 */
function colotomy(cycleSlots, div, levels) {
  const out = [];
  const taken = new Set();
  for (let L = 0; L < levels; L++) {
    // each level down divides the one above it in four, as the nesting in a
    // real colotomic ensemble does
    const every = cycleSlots / Math.pow(4, L);
    if (every < div * 2) break;
    for (let s = 0; s < cycleSlots; s += every) {
      const at = Math.round(s);
      if (taken.has(at)) continue;
      taken.add(at);
      out.push({ s: at, level: L });
    }
  }
  return out;
}

/**
 * The BASS. It used to tile every bar at a hundred and five per cent with one
 * note per metrical group, on the same degrees every bar forever — a second
 * drone, not a bass. It now moves per PHRASE and lands on the section's own
 * ending tone, so what it does across a piece is the thing a modal tradition
 * does instead of chord changes.
 */
function bassLine(music, G, cycleSlots, fin, ist, seed) {
  const stable = music.melody.structural;
  const out = [];
  let acc = 0, k = 0;
  while (acc * G.div < cycleSlots) {
    for (const g of G.groups) {
      const s = acc * G.div;
      if (s >= cycleSlots) break;
      // home at the head of the cycle, the section's landing tone at its end,
      // a stable neighbour between
      const atEnd = s >= cycleSlots * 0.75;
      const deg = k === 0 ? 0 : atEnd ? ist
        : stable[(k + hash32(seed, "b", k)) % stable.length] || 0;
      out.push({ s, beats: g, deg: modeDegree(music, deg + fin) });
      acc += g; k++;
      if (acc * G.div >= cycleSlots) break;
    }
  }
  return out;
}

/**
 * The OSTINATO: a short figure that repeats, the layer everything else is
 * heard against. Now takes the section's density, so the part that organises
 * the cycle also intensifies with it.
 */
function ostinato(music, G, cycleSlots, fin, n, seed) {
  const stable = music.melody.structural;
  const e = euclid(Math.max(2, Math.min(n, cycleSlots - 1)), cycleSlots);
  const out = [];
  let j = 0;
  for (let s = 0; s < cycleSlots; s++) {
    if (!e[s]) continue;
    const deg = stable[(j + hash32(seed, "os", j)) % stable.length] || 0;
    out.push({ s, deg: modeDegree(music, deg + fin) });
    j++;
  }
  return out;
}

// A DRUM IS NOT ONE SOUND. A hand drum speaks at least three ways depending on
// where and how it is struck, and real percussion writing is built out of the
// contrast between them — a pattern of identical hits is a metronome, not a
// drum part. Each stroke is a real change to the strike: where the hand lands
// on the head, how long it stays, and how much of the ring it takes away.
export const STROKES = {
  bass: { vel: 1 },
  open: { vel: 0.82 },
  slap: { vel: 0.9 },
  ghost: { vel: 0.34 },
};

/**
 * The percussion ENSEMBLE.
 *
 * Percussion is not one part played louder. It is several parts INTERLOCKING,
 * and the composite is a groove no single player is playing. Three rules,
 * every one of them from how these ensembles actually work:
 *
 *   · THE TIMELINE IS FIXED AND NEVER STOPS. It is the reference everyone else
 *     hears the cycle through, and in Ewe practice it is the one part that may
 *     not vary at all while every other part may.
 *   · THE RATTLE IS DERIVED FROM IT, not generated beside it. Every downstroke
 *     falls with a bell stroke and every upstroke falls between them, which
 *     turns a seven-stroke timeline into an eleven-stroke surface with the
 *     accent marking which is which. That is why rattles energise.
 *   · THE SUPPORTING DRUMS ARE GENERATED TOGETHER, under a coverage
 *     constraint, and pitch-stratified — high, middle, low — so their
 *     composite is heard as a melody nobody is playing. Generating them
 *     independently gives four parts that collide; generating them jointly
 *     gives one instrument with four hands.
 */
function drumEnsemble(music, G, cycleSlots, seed, hands, dens) {
  const line = timelineOf(music, G, seed);
  const parts = [];
  const timeline = [];
  for (let s = 0; s < cycleSlots; s++) {
    if (!line.has(s % G.slots)) continue;
    timeline.push({ s, stroke: G.w[s % G.slots] >= 1 ? "bass" : "open", vel: G.w[s % G.slots] >= 1 ? 0.72 : 0.5 });
  }
  parts.push({ hits: timeline, voice: 0, fixed: true });

  if (hands >= 2) {
    // the rattle: with the bell, then between it
    const hits = [];
    for (const t of timeline) hits.push({ s: t.s, stroke: "open", vel: 0.44 });
    for (let s = 0; s < cycleSlots; s++) {
      if (line.has(s % G.slots)) continue;
      if (hash32(seed, "rat", s) % 5 === 0) continue;      // not quite every gap
      hits.push({ s, stroke: "ghost", vel: 0.24 });
    }
    parts.push({ hits: hits.sort((a, b) => a.s - b.s), voice: 1, fixed: true });
  }

  // the supporting drums, filled JOINTLY: each takes slots the others left, so
  // the composite covers the cycle and no two players collide
  const covered = new Set(timeline.map(t => t.s));
  for (let p = 2; p < hands + 1; p++) {
    const hits = [];
    const target = Math.max(2, Math.round(cycleSlots * dens * (0.34 + 0.12 * p) / 2));
    const e = euclid(Math.min(target, cycleSlots - 1), cycleSlots);
    const rot = hash32(seed, "rot", p) % cycleSlots;
    for (let s = 0; s < cycleSlots; s++) {
      if (!e[(s + rot) % cycleSlots]) continue;
      if (covered.has(s) && hash32(seed, "dup", s * 7 + p) % 4 !== 0) continue;   // interlock, don't double
      covered.add(s);
      const w = G.w[s % G.slots];
      const h = hash32(seed, s, p) % 6;
      hits.push({
        s,
        stroke: w >= 1 ? "bass" : h < 2 ? "slap" : h < 4 ? "open" : "ghost",
        vel: (w >= 1 ? 0.6 : 0.38),
      });
    }
    if (hits.length) parts.push({ hits, voice: p - 1, fixed: false });
  }
  return parts;
}

/** Assign instruments to parts. */
export function ensembleFor(music, occKey, intimacy = 1) {
  const occ = OCCASIONS[occKey] || OCCASIONS.peace;
  const insts = music.insts;
  // WHAT CAN CARRY A TUNE is a property of the body, derived in
  // musicInstruments.js from how definite its pitch is, how many pitches the
  // player can place, whether the note can be shaped after it starts, and
  // whether one note clears before the next arrives. Ranking on that instead
  // of on pitch count and prestige is what stops a culture playing melodies on
  // a gong — and it does so because a gong physically cannot, not because
  // anything here knows what a gong is.
  const rank = insts.map((i, k) => ({ i, k, m: melodicCapacity(i), r: articRate(i) }))
    .sort((a, b) => b.m - a.m);
  const taken = new Set();
  const claim = (pred) => {
    const o = rank.find(x => !taken.has(x.k) && pred(x));
    if (o) taken.add(o.k);
    return o ? o.k : null;
  };
  // An occasion does not just turn the volume up: it picks WHO PLAYS. A
  // gamelan's loud repertoire and its soft repertoine use different subsets of
  // the same instruments and are led by different ones — the soft style by the
  // quietest, most flexible thing in the room and by the singer, the loud
  // style by bronze and drums with the voice left out. And the loud melodic
  // lead the world over is a double reed over a drum, never an idiophone.
  const loud = occ.lead === "loud";
  // THE VOICE LEADS UNLESS SOMETHING CAN BE HEARD OVER IT. That is not a
  // preference, it is what the record says: societies with a rich vocal
  // tradition and no melodic instrument at all are common, and societies with
  // melodic instruments and no singing are unattested. So the instrument taken
  // here is the one that plays WITH the singer — and a body that cannot hold a
  // line does not get promoted to holding one just because nothing better is
  // in the room. When nothing clears the bar, nobody plays the tune and
  // somebody sings it, which is the commonest ensemble on earth.
  const lead = loud
    ? (claim(x => x.i.drive === "reed" || x.i.drive === "lip") ?? claim(x => x.m > 0.2))
    : claim(x => x.m > 0.45);
  // the elaborating part is the FASTEST pitched body, not the second-best one
  // the elaborating part is the FASTEST pitched body — but not one whose
  // pitches are its own harmonic series rather than the player's choice: a
  // natural horn cannot paraphrase a melody, it can only sound its tube
  const elab0 = rank.filter(x => !taken.has(x.k) && x.m > 0.08 && FAM(x.i).tune !== "series")
    .sort((a, b) => b.r - a.r)[0];
  // the timekeeper is claimed first among the accompaniment: a body with no
  // pitch to speak of has exactly one job, and letting a pitched part take it
  // first leaves the ensemble with no beat
  const pulse = claim(x => FAM(x.i).vib === "membrane");
  const elab = elab0 && !taken.has(elab0.k) ? (taken.add(elab0.k), elab0) : null;
  const core = claim(x => x.m > 0.08 && x.r < 6);
  // A body that cannot be re-articulated is not a part. What it does in every
  // tradition that has one is MARK — one stroke where the cycle turns, left to
  // ring, and the loudest thing in the bar precisely because it is the rarest.
  // A NESTED PUNCTUATION NEEDS NESTED BODIES. A colotomic ensemble marks the
  // cycle, then its quarters, then their quarters — on gongs of different
  // sizes, never on one gong struck sixteen times. So collect however many
  // un-articulable bodies there are, largest first, and mark exactly as many
  // levels as there are bodies to mark them with.
  const marks = [];
  for (let i = 0; i < 3; i++) { const k = claim(x => x.r < 1.6); if (k == null) break; marks.push(k); }
  const mark = marks.length ? marks[0] : null;
  const drone = claim(x => x.i.kind === "sustain" || x.i.partials[0].d > 2.5);
  const bass = claim(x => x.i.partials[0].d > 1.2 || x.i.kind === "sustain");
  const ost = claim(x => x.i.cap >= 3);
  const voices = Math.max(1, Math.round(music.texture.size * (0.35 + 0.65 * intimacy)));
  return {
    lead, elab: elab ? elab.k : null, core, drone, bass, ost, pulse, mark, marks,
    voices, occ,
    // It sings unless the occasion is a loud outdoor one, where nothing
    // unamplified carries over the reeds and the drums.
    sing: !loud && intimacy > 0.25,
  };
}
export function degreeHz(music, tonicHz, deg, oct = 0) {
  const d = music.scale.degrees;
  const n = d.length;
  const i = ((deg % n) + n) % n;
  const wrap = Math.floor(deg / n);
  return tonicHz * Math.pow(music.scale.frame.ratio, oct + wrap) * d[i].ratio;
}

/** Lay one phrase onto the grid as timed events. */
function layPhrase(music, ph, O, opts) {
  const { pat, degs, fin } = ph;
  const G = pat.grid, R = music.rhythm;
  const { at = 0, inst, vel = 0.36, intimacy = 1, role = "lead", oct = 0, syls = null, sylFrom = 0, ist = 0 } = opts;
  const ev = [];
  const notes = pat.notes || pat.onsets.map(s => ({ s, v: 1 }));
  const n = notes.length;
  notes.forEach((nt, i) => {
    const s = nt.s;
    const b = slotBeat(G, s, R.swing);
    const span = Math.max(0.12, nt.v / G.div);
    const strong = G.w[s % G.slots] >= 1;
    const mi = degs[i % degs.length];
    const last = i === n - 1;
    // a phrase LANDS: its final note is held past the end of the cycle, and
    // the next cycle's downbeat is suppressed so it survives instead of being
    // stolen by the note that follows
    const len = last ? span * 1.55 : span * O.artic;
    // DYNAMICS. A line with three decibels of range in it is a machine. Real
    // range comes from three sources at once: the metrical hierarchy, the
    // language's OWN stress (rhythm.accent, derived from prosody and until now
    // computed and never read), and the arc of the phrase — which rises to a
    // peak and falls away, tilted downward by the same breath declination the
    // pitch already uses.
    const metre = strong ? 1 : G.w[s % G.slots] >= 0.5 ? 0.62 : 0.4;
    const stress = strong ? R.accent : 1 / Math.sqrt(R.accent);
    const arc = (0.72 + 0.34 * Math.sin(Math.PI * (i + 0.5) / n)) * (1 - 0.12 * O.descent * (i / Math.max(1, n - 1)));
    const e = {
      b: at + b, dur: len, inst, mi, deg: modeDegree(music, mi + fin + (last ? ist : 0)), oct, role,
      // the melody is the thing being listened to, so it sits on top of the
      // texture the other layers make
      vel: vel * 1.5 * metre * stress * arc * (0.65 + 0.35 * intimacy),
      last, strong,
    };
    // An ornament is a quick neighbour just ahead of the note — a MODE step,
    // so it decorates the line instead of smearing a microtone across it, and
    // sparse, because one on every long note is clutter rather than style.
    if (opts.orn && !strong && span >= 0.5 && hash32(music.people.seed, "orn", s) % 3 === 0) {
      e.ornDeg = modeDegree(music, mi + fin + 1);
      e.ornLead = Math.min(0.22, span * 0.3);
    }
    if (syls && syls.length) e.syl = syls[(sylFrom + i) % syls.length];
    ev.push(e);
  });
  return ev;
}

/**
 * One cycle of ambience, in BEATS from the cycle start, so a scheduler can
 * keep asking for the next one forever.
 */
/**
 * ONE CYCLE of ambience, in beats from the cycle start, so a scheduler can
 * keep asking for the next one forever. A cycle is a whole PHRASE, not a bar:
 * looping one bar is literally what "an infinitely repeating block" is.
 */
export function ambientBar(music, { occ = "peace", intimacy = 1, bar = 0 } = {}) {
  const E = ensembleFor(music, occ, intimacy);
  const O = E.occ, R = music.rhythm, G = gridOf(R);
  const bank = phraseBank(music, occ);
  const order = formOrderOf(music);
  const secs = sectionsOf(music, occ);
  const S = sectionAt(secs, bar);
  const ph = bank[order[bar % order.length] % bank.length];
  const SLOTS = ph.pat.span;
  const beats = SLOTS / G.div;
  const tempo = Math.round(R.tempo * O.tempo);
  const spb = 60 / tempo;
  const fin = finalFor(music, occ);
  const ST = strataOf(music, E, G, SLOTS, spb);
  const seed = hash32(music.people.seed, "amb", occ);
  const ev = [];
  const audible = (need) => S.sec.thin * intimacy >= need;

  // THE MARK. One stroke where the cycle turns, left to ring, and the LOUDEST
  // event in the cycle — a punctuating body is loud precisely because it is
  // rare. It used to be the quietest thing in the bar.
  if (E.marks && E.marks.length && audible(0.3)) {
    const levels = Math.min(E.marks.length, S.sec.dens > 2 ? 3 : 2);
    for (const c of colotomy(SLOTS, G.div, levels)) {
      const k = E.marks[Math.min(c.level, E.marks.length - 1)];
      ev.push({ b: slotBeat(G, c.s, 0), dur: 3.5, inst: k, deg: modeDegree(music, fin),
        oct: -1 - (c.level === 0 ? 1 : 0),
        // each level down is a smaller body and a smaller stroke, sharing the
        // effort the level above spends in one
        vel: (ST.mark ? ST.mark.vel : 0.7) * Math.pow(0.45, c.level),
        role: "mark", ring: c.level === 0 });
    }
  }
  // THE CORE: the slow skeletal melody the elaboration hangs on. Slow but
  // STOPPED, never sustained — a metallophone key is hand-damped as the next
  // one sounds, so a slow core is short events at long intervals, and
  // rendering it as long ones is the single most audible way to make this
  // music sound moody instead of driven.
  if (ST.core && audible(0.55)) {
    const step = Math.max(G.div, Math.round(SLOTS / ST.core.n));
    for (let s = 0, j = 0; s < SLOTS; s += step, j++) {
      const d = ph.degs[Math.floor(j * ph.degs.length / Math.max(1, SLOTS / step))] ?? 0;
      ev.push({ b: slotBeat(G, s, R.swing), dur: Math.min(1.1, step / G.div * 0.6), inst: ST.core.k,
        deg: modeDegree(music, d + fin + S.sec.ist), oct: -1, vel: ST.core.vel, role: "core", damped: true });
    }
  }
  // THE LINE.
  const lead = layPhrase(music, ph, O, {
    inst: ST.lead ? ST.lead.k : -1, intimacy, oct: Math.round(O.reg) + S.sec.oct,
    ist: S.sec.ist, orn: music.texture.ornament * S.sec.orn > 0.5,
    vel: 0.42 * (0.85 + 0.3 * Math.min(1, S.sec.dens / 3)),
  });
  // A phrase LANDS, in three grades: the end of a phrase, the end of a section,
  // the end of the piece. Only the last note of the last cycle of a section
  // gets the long one, and a section ending also gets real silence after it —
  // a rest is the strongest boundary signal there is.
  const last = lead[lead.length - 1];
  if (last && S.last) last.dur *= S.sec.grade === 2 ? 2.6 : 1.8;
  if (ST.lead) ev.push(...lead);
  // THE ELABORATION: two to sixteen times the core's density, running
  // continuously. This is where the music lives in every tuned-metal tradition
  // and the engine simply did not have it — implement the gong and the core
  // and leave this out and you have left out most of the onsets.
  if (ST.elab && audible(0.5) && ST.elab.k !== (ST.lead && ST.lead.k)) {
    const n = Math.max(2, Math.round(ST.elab.n * Math.min(1, 0.22 * S.sec.dens)));
    const e = euclid(Math.min(n, SLOTS - 1), SLOTS);
    let j = 0;
    for (let s = 0; s < SLOTS; s++) {
      if (!e[s]) continue;
      // it PARAPHRASES the line rather than doubling it: same pitches, more of
      // them, and it fills where the line is not
      const d = ph.degs[j % ph.degs.length];
      const near = ph.pat.onsets.some(o => Math.abs(o - s) < 1);
      ev.push({ b: slotBeat(G, s, R.swing), dur: 0.4, inst: ST.elab.k,
        deg: modeDegree(music, d + fin + S.sec.ist), oct: Math.round(O.reg) + S.sec.oct,
        vel: ST.elab.vel * (near ? 0.6 : 1), role: "elab", damped: true });
      j++;
    }
  }
  // THE DRONE. Not a held note: a real drone is RE-ARTICULATED, on its own
  // cycle, which does not have to line up with the piece's — a tanpura is
  // plucked string after string at its own rate. And it is two pitches, the
  // final and its strongest consonance, not a chord.
  // A DRONE IS A GROUND, and a ground only means something if something moves
  // against it. A held pitch under a line that is barely ornamented is not a
  // drone tradition, it is a held pitch — so the drone appears where the melody
  // is active enough to need one.
  if (ST.drone && music.texture.kind !== "monophony" && audible(0.25)
      && music.texture.ornament * S.sec.orn > 0.3) {
    const every = Math.max(1, Math.round(SLOTS / ST.drone.n));
    const fifth = music.melody.structural[1] ?? 2;
    for (let s = 0, j = 0; s < SLOTS; s += every, j++) {
      ev.push({ b: slotBeat(G, s + (j % 3 === 2 ? 1 : 0), 0), dur: (every / G.div) * 1.3,
        inst: ST.drone.k, deg: modeDegree(music, (j % 2 ? fifth : 0) + fin), oct: -2 + (j % 2),
        vel: ST.drone.vel * (0.55 + 0.45 * O.drone) * (j % 2 ? 0.7 : 1), role: "pad" });
    }
  }
  if (ST.bass && music.texture.size >= 2 && audible(0.45)) {
    for (const b of bassLine(music, G, SLOTS, fin, S.sec.ist, seed)) {
      ev.push({ b: slotBeat(G, b.s, R.swing), dur: b.beats * 0.72, inst: ST.bass.k, deg: b.deg,
        oct: -2, vel: ST.bass.vel, role: "bass", damped: true });
    }
  }
  if (ST.ost && music.texture.size >= 3 && audible(0.7)) {
    const n = Math.round(ST.ost.n * Math.min(1, S.sec.dens / 2));
    for (const o of ostinato(music, G, SLOTS, fin, n, seed)) {
      ev.push({ b: slotBeat(G, o.s, R.swing), dur: 0.5, inst: ST.ost.k, deg: o.deg, oct: -1,
        vel: ST.ost.vel * 0.7, role: "ost", damped: true });
    }
  }
  if (ST.pulse && O.perc > 0.15 && audible(0.35)) {
    const hands = Math.max(1, Math.min(4, Math.round(1 + music.texture.size * 0.55 * O.perc * S.sec.thin)));
    drumEnsemble(music, G, SLOTS, seed, hands, R.density * S.sec.dens * 0.5).forEach((part, pi) => {
      for (const h of part.hits) {
        ev.push({ b: slotBeat(G, h.s, R.swing), dur: 0.35, inst: ST.pulse.k, deg: 0,
          oct: -1 - (pi === 0 ? 1 : 0), vel: h.vel * O.perc * ST.pulse.vel * 2.2,
          role: "pulse", stroke: h.stroke, voice: pi });
      }
    });
  }
  // THE VOICE, on the line the instrument is playing — but not in unison with
  // it. Two players on one melody, each ornamenting it their own way, is
  // heterophony, and it is the commonest way a sung tradition and its
  // instruments sound together anywhere in the world. The instrument takes the
  // plain version; the singer holds the structural notes and lets the runs go.
  if (E.sing) {
    const sung = ST.lead ? lead.filter((e, i) => e.strong || i === 0 || i === lead.length - 1) : lead;
    for (const e of sung) {
      ev.push({ ...e, role: "voice", inst: -1, vel: e.vel * (ST.lead ? 1.05 : 1),
        dur: e.dur * (ST.lead ? 1.35 : 1), oct: e.oct + (music.melody.breathBound ? 0 : -1) });
    }
  }
  return { events: ev, beats, tempo, grid: G, phrase: order[bar % order.length],
    section: S.sec.label, dens: S.sec.dens };
}

/**
 * A whole piece: the same generator, run over the section plan instead of
 * looping. `syls` (optional) is a line of the people's own language, sung one
 * syllable per note.
 */
export function composePiece(music, occKey = "peace", syls = null) {
  const secs = sectionsOf(music, occKey);
  const sections = [];
  let beat = 0, cycle = 0, sylAt = 0;
  for (const sec of secs) {
    const start = beat;
    const ev = [];
    for (let c = 0; c < sec.cycles; c++) {
      const plan = ambientBar(music, { occ: occKey, intimacy: 1, bar: cycle });
      for (const e of plan.events) {
        const o = { ...e, b: beat + e.b };
        if (o.role === "voice" && syls && syls.length) o.syl = syls[sylAt++ % syls.length];
        ev.push(o);
      }
      beat += plan.beats;
      cycle++;
    }
    // A SECTION ENDS WITH SILENCE. A rest is the strongest boundary cue there
    // is, and this texture never had one — measured, total silence in a bar was
    // zero for nine peoples in ten.
    beat += sec.grade === 2 ? 0 : 1;
    sections.push({ label: sec.label, events: ev, startBeat: start, beats: beat - start });
  }
  const all = sections.flatMap(s => s.events);
  const leadDurs = all.filter(e => e.role === "lead").map(e => e.dur);
  const R = music.rhythm, O = OCCASIONS[occKey] || OCCASIONS.peace;
  return {
    sections, events: all, totalBeats: beat, tempo: Math.round(R.tempo * O.tempo),
    occ: occKey, nPVI: nPVI(leadDurs), grid: gridOf(R),
  };
}
export function speechNPVI(music) {
  const R = music.rhythm;
  // exactly the durations the speech engine schedules (langLab scheduleWord /
  // vocalTract scoreWord)
  const durs = [];
  for (let i = 0; i < 24; i++) {
    const base = R.cls === "syllable" ? 0.165 : R.cls === "even" ? 0.15 : i % 3 === 0 ? 0.2 : 0.12;
    durs.push(base * (1 + (hash32(music.people.seed, "sp", i) / 4294967296 - 0.5) * 0.12));
  }
  return nPVI(durs);
}
