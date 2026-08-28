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
import { articRate, melodicCapacity, FAMILIES, CARRIES } from "./musicInstruments.js";
import { dissonance } from "./musicTuning.js";
import { prosodyOf } from "./languagePhonetics.js";
const FAM = (i) => FAMILIES[i.fam] || {};

// ── the singer's body, in seconds ────────────────────────────────────────
// Three durations of human articulation, each meaning something on its own
// and none of them tuned to any outcome here. Together they say how fast a
// people can be sung and how late the sung note arrives.
//
//  · a sung vowel is the nucleus of the syllable and the part carrying the
//    pitch — around a fifth of a second at a comfortable pace;
//  · each consonant slot the phonotactics allow adds a gesture on top of it,
//    which is why a CV tongue runs at six syllables a second where a CCVCC one
//    manages four;
//  · and a note does not start when the syllable does. The pitch arrives with
//    the vowel, behind whatever consonant opens it — voice onset time, tens of
//    milliseconds, the same order as a bow settling into Helmholtz motion.
const VOWEL_SECS = 0.18;
const SEGMENT_SECS = 0.06;
const ONSET_SECS = 0.035;

// `artic` is how much of the gap to the next note a note actually sounds for.
// `descent` is how strongly breath declination shows. `bright` is which final
// the mode is heard from. None of these replace a mechanism; they scale it.
export const OCCASIONS = {
  // EVERYDAY IS THE UNMARKED CASE: a people plays from its OWN home.
  //
  // This asked for `bright: 1`, and `finalFor` reads that as the extremum —
  // rotate the mode onto whichever of its degrees has the most of itself inside
  // its own harmonic series. Measured across 240 peoples, that moved 70% of
  // them off degree 0, landed 137 of them on the SAME degree, and took the
  // share whose mode contains a major third from 8% to 54%. Everything sounded
  // brighter and more like everything else, on the one occasion a listener
  // hears most.
  //
  // Degree 0 is not an arbitrary choice of home. It is the pitch the entire
  // scale was derived AGAINST — every minimum on the dissonance curve was
  // measured from it — so rotating away from it for the default repertoire
  // discards the derivation and asks the question the bench already answered:
  // a maqām rotated onto a different degree is a different maqām. That was
  // fixed for the seven pinned traditions and left running for every derived
  // people in the world.
  //
  // Rotating the final for affect is real and stays: a rite and a lament take
  // the darkest degree, a festival the brightest. What changes is that the
  // everyday piece is now a people's own tonic, which is also the only one that
  // differs between them.
  // ATMOSPHERE is the one occasion with no event in it, so nothing outside the
  // music decides how it goes — the MODE does. Every number in this row is
  // replaced by `affectOf` below; what is written here is only the fallback.
  peace:    { label: "atmosphere", bright: 0,  tempo: 1.0,  density: 1.05, reg: 0.2,  perc: 0.6,  orn: 0.8,  drone: 0.5,  descent: 0.85, artic: 1.0,   lead: null },
  rite:     { label: "rite",      bright: -1, tempo: 0.74, density: 0.8,  reg: 0,    perc: 0.3,  orn: 1.2,  drone: 1,    descent: 1.05, artic: 1.05, lead: "sustain" },
  war:      { label: "war",       bright: 0,  tempo: 1.3,  density: 1.15, reg: -0.6, perc: 1,    orn: 0.3,  drone: 0.5,  descent: 0.85, artic: 0.8,  lead: "loud" },
  mourning: { label: "mourning",  bright: -1, tempo: 0.64, density: 0.62,  reg: -0.4, perc: 0.16, orn: 1,    drone: 0.9,  descent: 1.35, artic: 1.1,    lead: "sustain" },
  festival: { label: "festival",  bright: 1,  tempo: 1.22, density: 1.3,  reg: 0.5,  perc: 1,    orn: 0.7,  drone: 0.35, descent: 0.85, artic: 0.86, lead: null },
  work:     { label: "work",      bright: 0,  tempo: 1,    density: 1.2, reg: 0.2,  perc: 0.9,  orn: 0.4,  drone: 0.35, descent: 0.95, artic: 0.9, lead: null },
};

// ── how a mode wants to be played ────────────────────────────────────────
/**
 * A SCALE ALREADY CONTAINS ITS OWN ATMOSPHERE, and it is in the steps.
 *
 * Ḥijāz is not played slowly, over a drone, drenched in ornament because
 * somebody decided maqām music should be sultry. It is played that way because
 * of what its steps ARE: four of its seven are about a semitone, and a step
 * that small does not stand as a degree of its own — it LEANS on the one above
 * it. A leaning tone needs time to lean, something fixed to lean against, and
 * an ornament to lean with, so the tempo drops, a drone appears and the
 * decoration thickens. Every one of those is a consequence, not a taste.
 *
 * The same reading gives the rest of it. A mode whose steps are all a tone or
 * a minor third has nothing leaning anywhere, so it can move, needs no drone
 * to be heard against, and takes percussion happily — which is a Chinese
 * anhemitonic pentatonic, and it comes out bright and quick. A mode with
 * 400-cent GAPS in it cannot be filled in at speed without turning the gaps
 * into runs, so it thins out and lets the notes ring — which is in-sen, and it
 * comes out sparse. None of those three traditions is named anywhere below.
 *
 * Two thresholds, both about what a step DOES rather than what it measures:
 *   · under about 150 cents a step pulls toward its neighbour instead of
 *     standing on its own — the leading-tone effect, and the whole of what
 *     makes a mode sound like it is yearning at something;
 *   · over about 330 cents, wider than a major third, it stops being a step at
 *     all and becomes a gap the line has to leap.
 */
const LEAN_STEP = 150;
const GAP_STEP = 330;
export function affectOf(music) {
  if (music._affect) return music._affect;
  const st = music.mode.steps.filter(x => x > 0);
  const n = st.length || 1;
  const lean = st.filter(x => x < LEAN_STEP).length / n;
  const gap = st.filter(x => x > GAP_STEP).length / n;
  // how much of the mode already lives inside its own home's harmonic series —
  // the same measure `finalsOf` ranks finals by, read at the home it actually
  // uses rather than at the brightest one available
  const fs = music.mode.finals || [];
  const open = Math.max(0, Math.min(1, ((fs.find(x => x.f === 0) || fs[0] || { bright: 0.3 }).bright) * 1.5));
  // AND WHETHER THE ROOM CAN HOLD A NOTE. A drone and a long line are only
  // available to a people who built something that sustains; a room of plucked
  // and struck bodies cannot play atmospherically however its mode leans.
  const holds = music.insts.filter(i => i.kind === "sustain").length / Math.max(1, music.insts.length);
  return (music._affect = { lean, gap, open, holds });
}
/**
 * The occasion, as this people's music actually takes it. Every occasion but
 * one is an EVENT — a rite, a war, a feast — and an event dictates its own
 * terms, so those rows stand as written. Atmosphere is the absence of an
 * event, so there is nothing to dictate anything and the mode is left to say
 * how it goes.
 */
export function occasionFor(music, occKey) {
  const O = OCCASIONS[occKey] || OCCASIONS.peace;
  if (occKey !== "peace" || !music || !music.mode) return O;
  const key = "_occ:" + occKey;
  if (music[key]) return music[key];
  const { lean, gap, open, holds } = affectOf(music);
  const sus = 0.35 + 0.65 * holds;          // what the ensemble can actually hold
  return (music[key] = { ...O,
    // NOBODY IS DANCING. That is what distinguishes this occasion from every
    // other one in the table: a war march, a feast and a work song all have
    // somebody moving to them and a tempo that follows the moving. An
    // atmosphere has none, so it sits under the tradition's own characteristic
    // tempo — which for a reel tradition is a dance tempo and would otherwise
    // come out at 142 beats a minute with drones over it. On top of that, a
    // leaning tone needs time to lean and a gap needs room to be crossed.
    tempo: 0.86 - 0.26 * lean - 0.16 * gap + 0.10 * open,
    // and it needs something fixed to lean against — which only a body that
    // sustains can provide
    drone: Math.min(1, (0.18 + 0.85 * lean) * sus),
    // …and something to lean WITH
    orn: 0.45 + 1.0 * lean,
    // gaps thin a texture out: they cannot be filled at speed without becoming
    // runs, so the notes get fewer and longer instead
    density: 1.2 - 0.75 * gap - 0.2 * lean,
    artic: 0.95 + 0.3 * gap + 0.1 * lean,
    // percussion belongs to a music with a beat to mark, not to one holding a
    // note against a drone
    perc: Math.max(0.1, 0.85 - 0.7 * lean - 0.3 * gap),
    // an open mode sits up in the light; a shaded one sits low
    reg: -0.25 + 0.8 * open,
    descent: 0.8 + 0.25 * lean,
  });
}

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
  const on = new Set(), downbeats = new Set();
  for (let b = 0; b < bars; b++) {
    let acc = 0;
    for (const g of G.groups) { on.add(b * G.slots + acc * G.div); downbeats.add(b * G.slots + acc * G.div); acc += g; }
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

  // DENSITY DECIDES HOW MANY NOTES; THE METRICAL RULES DECIDE WHICH ONES.
  //
  // Four stages sit between the tradition's stated density and the line that
  // comes out, and every one of them SUBTRACTS: the offbeat cull drops weak
  // slots, a long value swallows the onsets beneath it, and the rest rule
  // takes a quarter of what is left. Each is justified on its own and each
  // was tuned on its own, so compounded they took the density down to about a
  // third of what was asked — measured, a people asking for 0.9 got 3.4 notes
  // to the bar and one asking for 0.28 got a note every three seconds, which
  // is slower than any music anyone plays. The stated density never survived
  // to the output, so it did not mean anything.
  //
  // Closing the loop is what makes it mean something. The culls still choose
  // WHICH onsets go — that is where the metre and the tradition's feel live —
  // but if they have taken the line below what the density asked for, the
  // strongest of the dropped slots come back, strongest first.
  const target = Math.min(SPAN, Math.round(SPAN * Math.min(0.85, density * 0.55)) + downbeats.size);
  if (rested.length < target) {
    const have = new Set(rested.map(n => n.s));
    const back = [];
    for (let sl = 0; sl < SPAN; sl++) {
      if (have.has(sl)) continue;
      if (rested.some(n => sl > n.s && sl < n.s + n.v)) continue;   // still inside a long note
      back.push(sl);
    }
    // strongest first, and ties broken by the same roll the culls used, so the
    // line a people gets back is still its own line
    back.sort((a, b) => (wAt(b) - wAt(a)) || (roll("b" + a) - roll("b" + b)));
    for (const sl of back.slice(0, target - rested.length)) rested.push({ s: sl, v: 1 });
    rested.sort((a, b) => a.s - b.s);
  }
  return { grid: G, span: SPAN, bars, onsets: rested.map(n => n.s), notes: rested };
}

/** Where a mode index sits in pitch, frames and all. */
function modeCentsAt(music, mi) {
  const L = music.mode.size, frame = music.scale.frame.cents;
  const w = Math.floor(mi / L);
  return music.mode.cents[((mi % L) + L) % L] + w * frame;
}
/** The mode's own typical step — the unit a singer of it aims in. */
function medianStep(music) {
  if (music._medStep) return music._medStep;
  const st = music.mode.steps.filter(x => x > 0).sort((a, b) => a - b);
  music._medStep = st.length ? st[st.length >> 1] : 200;
  return music._medStep;
}

// ── the melodic line ─────────────────────────────────────────────────────
// A phrase is a walk over the MODE that arches away from where it started and
// comes back to land on a structural degree.
function walkLine(music, seedBase, nNotes, startDeg, descent, land = true) {
  const M = music.melody, S = music.mode.size;
  const med = medianStep(music);
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
      // PROXIMITY IS IN PITCH, NOT IN DEGREES. A singer aims by ear, and one
      // degree of a mode is 90 cents in one place and 350 in another — so
      // measuring nearness by how many degrees a step crosses makes every mode
      // move the same way, and it did: two seven-note traditions on the same
      // metre came back with the identical contour. Measured against the
      // mode's own median step, a mode with a gap in it moves round the gap.
      const w = [];
      let tot = 0;
      const c0 = modeCentsAt(music, deg);
      for (const d of CAND) {
        const dc = Math.abs(modeCentsAt(music, deg + d) - c0);
        let v = Math.exp(-dc / (1.4 * med)) * (d > 0 ? pUp : 1 - pUp) * (Math.abs(d) === 1 ? M.step * 1.6 : 1);
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
  if (!land) return out;
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

// ── the characteristic figure, and building a line out of it ──────────────
/**
 * A MELODY IS NOT A GOOD WALK. Everything above this line makes each STEP
 * plausible — Narmour's implication–realization gets the local statistics of
 * real melody right, and the arch bends the whole thing like a breath. Measured
 * over the corpus, it works: three-quarters of interval transitions satisfy
 * the model. And the result is still wallpaper, for a reason the step-by-step
 * view cannot see.
 *
 * The measurement that showed it: count how many of a phrase's three-note
 * figures are DISTINCT from each other. Across five real traditions and sixty
 * derived peoples the answer was 86–100%. Every figure in the tune was new.
 * A listener has nothing to hold on to and nothing to hum back, however
 * idiomatic each individual step is, because a tune is not a sequence of good
 * steps — it is a small number of figures, turned over.
 *
 * Selection alone cannot fix that. A walk over eight candidate steps will
 * essentially never repeat a figure by accident, so searching for economy in
 * walked lines searches an empty space. The figures have to be there BY
 * CONSTRUCTION: draw one cell, then state it, sequence it, invert it, break
 * it up, and answer it. That is what a sentence and a period are, it is what
 * every rule-based composer since the 1980s does, and it is why the
 * transformation machinery already in this file (which only ever operated on
 * whole phrases) belongs one level down, INSIDE the phrase.
 */

/** Onsets grouped at the metre's own boundaries. A cell fills a group, so a
 *  restated cell lands on the same metrical positions — which is the whole
 *  reason a restatement is heard as one rather than as new material. */
function cellsOf(pat, want = 2) {
  const G = pat.grid, bounds = [];
  for (let b = 0; b < pat.bars; b++) {
    let acc = 0;
    for (const g of G.groups) { bounds.push(b * G.slots + acc * G.div); acc += g; }
  }
  bounds.push(pat.span);
  const raw = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const ix = [];
    for (let j = 0; j < pat.onsets.length; j++) {
      if (pat.onsets[j] >= bounds[i] && pat.onsets[j] < bounds[i + 1]) ix.push(j);
    }
    if (ix.length) raw.push(ix);
  }
  // A FIGURE NEEDS ROOM. At the metre's own division a group may hold one
  // onset, and a one-note cell has no shape in it to restate — so groups pack
  // together until a cell can carry the figure. That floor is not a tuning
  // choice: it is what a figure IS, and without it the germ was being cut down
  // to a single interval and the line came out as unrelated as before.
  const n = pat.onsets.length;
  const target = Math.max(2, Math.min(want, Math.floor(n / 2)));
  const out = [];
  for (const ix of raw) {
    if (out.length && out[out.length - 1].length < target) {
      out[out.length - 1] = out[out.length - 1].concat(ix);
    } else out.push(ix.slice());
  }
  while (out.length > 2 && out[out.length - 1].length < target) {
    const t = out.pop();
    out[out.length - 1] = out[out.length - 1].concat(t);
  }
  // …AND A CELL IS NOT A BAR EITHER. Where the metre's groups are long — a
  // sixteen-beat cycle in two halves — a cell held twice the figure or more,
  // and the only way to fill it was to run the figure round and round: the
  // four-note descent came back as a twelve-note descending scale. A figure
  // spun out past about twice its own length stops being heard as that figure,
  // so a long group carries several cells rather than one long one.
  const split = [];
  for (const ix of out) {
    if (ix.length <= target * 2) { split.push(ix); continue; }
    const parts = Math.round(ix.length / target);
    for (let i = 0; i < parts; i++) {
      const a = Math.round(i * ix.length / parts), b = Math.round((i + 1) * ix.length / parts);
      if (b > a) split.push(ix.slice(a, b));
    }
  }
  out.length = 0;
  for (const ix of split) out.push(ix);
  // a phrase in one group has nothing to answer; halve it so it can answer
  // itself, which is what a metre with no internal division leaves you
  if (out.length < 2 && n >= 4) {
    const all = pat.onsets.map((_, j) => j), h = Math.ceil(all.length / 2);
    return [all.slice(0, h), all.slice(h)];
  }
  return out.length ? out : [pat.onsets.map((_, j) => j)];
}

/** A figure's shape is its intervals, so it can be laid over any number of
 *  notes: cut short, or spun out by coming round again. */
const fitIv = (iv, want) => (iv.length
  ? Array.from({ length: want }, (_, i) => iv[i % iv.length])
  : new Array(want).fill(0));

/** What can be done to a figure. Transposition, sequence and varying the tail
 *  are what a singer does from memory; inversion and retrograde are operations
 *  on a line you can SEE, so they follow literacy — the same split the
 *  phrase-level transforms already make. */
const CELL_OPS = {
  restate: (c) => c,
  sequence: (c) => c,
  varyTail: (c, alt) => c.map((d, i) => (i < Math.ceil(c.length / 2) ? d : alt[i % alt.length])),
  fragment: (c) => c.slice(0, Math.max(1, Math.ceil(c.length / 2))),
  invert: (c) => c.map(d => -d),
  retrograde: (c) => [...c].reverse(),
  free: (c, alt) => alt,
};
function cellOpsFor(F) {
  const oral = ["restate", "restate", "sequence", "varyTail", "fragment"];
  const dev = F.development > 0.25 ? ["invert", "retrograde"] : [];
  // how far a tradition departs from its formula IS its development; how often
  // it comes back is its repetition. Both are already derived from literacy.
  const wander = Math.round(F.development * 3);
  return oral.concat(dev, new Array(wander).fill("free"));
}

/**
 * WHAT MAKES ONE CANDIDATE BETTER THAN ANOTHER. Every term is a constraint
 * with a cause outside this file, and every one of them is a property of the
 * WHOLE line — which is exactly why biasing the walk could not produce them.
 *
 *   economy   a tradition that is remembered rather than read cannot afford
 *             many figures, so reuse is worth more the more oral it is
 *   arch      one high point, and where it falls follows the line's own
 *             declination — a steeply falling line peaks early by definition
 *   narmour   the line realises the expectations it raises
 *   strong    the metre's strong positions carry the mode's structural degrees
 *   compass   it uses its range without leaving it, and it moves
 *
 * None of them names a tune. They are pressures; the search finds what
 * satisfies them, on any mode, any metre, any people.
 */
function scoreLine(music, degs, pat, descent, cells, prior) {
  const M = music.melody, S = music.mode.size, n = degs.length;
  if (n < 2) return 0;
  const iv = [];
  for (let i = 1; i < n; i++) iv.push(degs[i] - degs[i - 1]);

  // REUSE IS MEASURED AT WHATEVER LENGTH THE LINE CAN CARRY. A three-note
  // figure needs a cell with three notes in it, and a sparse metre does not
  // always give one — measured on a five-note phrase, reuse of three-note
  // figures is unreachable however economical the line actually is. So the
  // bare repeated interval counts too, and counts alone when that is all there
  // is room for. (Keys are packed into integers: this runs some hundreds of
  // times per phrase and string keys dominated the cost.)
  const reuseAt = (k) => {
    if (iv.length < k + 1) return null;
    const seen = new Map();
    for (let i = 0; i + k <= iv.length; i++) {
      let key = 0;
      for (let j = 0; j < k; j++) key = key * 64 + (iv[i + j] + 31);
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    let rep = 0, tot = 0;
    for (const v of seen.values()) { rep += v - 1; tot += v; }
    return tot ? rep / tot : 0;
  };
  const r1 = reuseAt(1), r2 = reuseAt(2);
  const reuse = r2 != null ? 0.65 * r2 + 0.35 * r1 : (r1 || 0);

  // THE ARCH IS A PHRASE-LEVEL PROPERTY, so it is measured at the phrase's own
  // level: the top note of each cell, not every note. Counting note-by-note
  // peaks punishes a line for having figures in it — a restated cell is a
  // second peak by construction — and the two pressures then cancel.
  const env = (cells && cells.length >= 3)
    ? cells.map(ix => ix.reduce((a, j) => Math.max(a, degs[j]), -Infinity))
    : degs;
  const m = env.length;
  let peaks = 0, hi = env[0], at = 0;
  for (let i = 0; i < m; i++) if (env[i] > hi) { hi = env[i]; at = i; }
  for (let i = 1; i < m - 1; i++) if (env[i] > env[i - 1] && env[i] >= env[i + 1]) peaks++;
  const wantAt = Math.max(0.15, 0.66 - descent * 0.45);
  const arch = (1 / (1 + Math.pow(Math.max(0, peaks - 1), 1.4) * 0.8))
    * (1 - Math.min(1, Math.abs(at / Math.max(1, m - 1) - wantAt) / 0.5));

  let ok = 0, tests = 0;
  for (let i = 1; i < iv.length; i++) {
    const p = iv[i - 1], q = iv[i];
    if (p === 0) continue;
    tests++;
    if (Math.abs(p) >= 3) { if (Math.sign(q) !== Math.sign(p) && Math.abs(q) <= 2) ok++; }
    else if (q === 0 || Math.sign(q) === Math.sign(p)) ok++;
  }
  const nar = tests ? ok / tests : 0.5;

  const G = pat.grid;
  let st = 0, stN = 0;
  for (let i = 0; i < n; i++) {
    if (G.w[pat.onsets[i] % G.slots] < 1) continue;
    stN++;
    const d = ((degs[i] % S) + S) % S;
    if (d === 0 || M.structural.indexOf(d) >= 0) st++;
  }
  const strong = stN ? st / stN : 0.5;

  let lo = degs[0], top = degs[0];
  for (const d of degs) { if (d < lo) lo = d; if (d > top) top = d; }
  const range = top - lo;
  // A TUNE USES ITS COMPASS, and this term stopped asking it to at 60% of one.
  // `min(1, range / (reach * 0.6))` is the same no-gradient shape as the leap
  // term below, whose comment records what that costs: past the threshold the
  // search is indifferent, so it settles wherever it first arrives. Measured,
  // the derived corpus crossed 64% of its compass — the saturation point, to
  // within noise — and sat there while every pinned tradition ranged over 65
  // to 92%. `reach` is already the ceiling, derived from the body and the
  // voice; what a line does inside it should be rewarded all the way up, and
  // leaving it is the fault the cliff is for.
  const span = range > M.reach ? 0.4 : range / M.reach;
  // A MELODY IS MOSTLY STEPS. Pitch proximity is the most robust thing anyone
  // has measured about melody anywhere, and counting leaps against the BAR
  // rather than against the notes let it be bought cheaply: a twenty-six-note
  // line over two bars paid the same for nine leaps as for two. Count them
  // against the line, and against the tradition's own stepwise preference,
  // which is already derived.
  // …and it must not SATURATE. Expressed as "enough steps and you are done"
  // the term had no gradient past its own threshold, so once a line was
  // stepwise enough it could buy compass with as many leaps as it liked for
  // free — measured, selection took a Hindustani line from one leap to seven
  // while the term reported full marks throughout. Monotone in the step
  // fraction, and steeper the more stepwise the tradition is.
  const steps = iv.reduce((a, d) => a + (Math.abs(d) <= 2 ? 1 : 0), 0) / iv.length;
  const leap = Math.pow(steps, 1 + M.step);
  const moves = 1 - Math.min(1, (iv.reduce((a, d) => a + (d === 0 ? 1 : 0), 0) / iv.length) * 1.6);

  // ECONOMY IS TWO-SIDED, and the first cut here was not. Rewarding reuse and
  // nothing else has one global optimum — state the figure and state it again
  // until the bar runs out — and that is exactly what the search returned: a
  // twenty-six-note Hindustani line that was one four-note figure, four times,
  // with no variation anywhere in it. A line has to be learnable AND worth
  // attending to; both are constraints on the same thing, which is how much a
  // listener has to hold to follow it. Where a tradition sits between them is
  // its own balance of formula and development, already derived from literacy.
  const F = music.form;
  const wantReuse = Math.max(0.05, Math.min(0.7, 0.28 + 0.34 * F.repetition - 0.3 * F.development));
  const econ = 1 - Math.min(1, Math.abs(reuse - wantReuse) / 0.45);

  // A PERIOD: the answer opens like the statement and does not end like it.
  // Without this the search hands back the statement verbatim — same rhythm,
  // same figure, same optimum — and an answer that is its own question is not
  // an answer.
  let period = 0, twin = 1;
  if (prior && prior.length === n) {
    // AN ANSWER THAT IS THE QUESTION IS NOT AN ANSWER. Rewarding contrast in
    // the tail was not enough on a short phrase, where the tail is one cell
    // and every alternative to it costs more than the reward: the search
    // handed back the statement, note for note, as its own answer. Identity
    // is not a weak candidate, it is a non-candidate.
    let same = true;
    for (let i = 0; i < n; i++) if (degs[i] !== prior[i]) { same = false; break; }
    if (same) twin = 0.25;
    const h = Math.ceil(n / 2);
    let head = 0, tail = 0;
    for (let i = 0; i < h; i++) if (degs[i] === prior[i]) head++;
    for (let i = h; i < n; i++) if (degs[i] !== prior[i]) tail++;
    period = 0.5 * (head / h) + 0.5 * (tail / Math.max(1, n - h));
  }

  // THE SEAMS ARE NOT ORDINARY INTERVALS. Where one figure ends and the next
  // begins is a join a player has to make, and there are only a handful of
  // them in a phrase — so counting them in with every other interval buries
  // them: a line could open a sixth between every pair of cells and pay
  // almost nothing, which is what placing cells absolutely made it do.
  let join = 1;
  if (cells && cells.length > 1) {
    let sum = 0;
    for (let c = 1; c < cells.length; c++) {
      const a = degs[cells[c - 1][cells[c - 1].length - 1]], b = degs[cells[c][0]];
      sum += 1 - Math.min(1, Math.abs(b - a) / 4);
    }
    join = sum / (cells.length - 1);
  }

  return twin * (1.4 * econ + 1.0 * arch + 0.8 * nar + 0.6 * strong
    + 0.5 * span + 0.9 * leap + 0.8 * join + 0.6 * moves + (prior ? 1.3 * period : 0));
}

/** Land the last note home, in the register the line is already in. */
function cadence(music, out) {
  const M = music.melody, S = music.mode.size;
  const last = out.length - 1, here = out[last];
  const lo = -Math.round(M.reach * 0.34), cand = [];
  for (const o of [Math.floor(here / S) - 1, Math.floor(here / S), Math.floor(here / S) + 1]) {
    cand.push({ d: o * S, home: 1 });
    for (const d of M.structural) if (d) cand.push({ d: d + o * S, home: 0 });
  }
  const within = cand.filter(c => c.d <= M.reach && c.d >= lo);
  const pool = within.length ? within : cand;
  out[last] = pool.reduce((a, b) => {
    const cost = (x) => Math.abs(x.d - here) + (x.home ? 0 : S * 0.8);
    return cost(b) < cost(a) ? b : a;
  }, pool[0]).d;
  return out;
}

/**
 * WHAT MAKES A FIGURE. Not the same question as what makes a phrase, and
 * scoring it with the phrase fitness was measurably wrong: a phrase wants an
 * arch and a compass, and a three-note figure has neither to give, so the
 * terms that should have decided it were swamped by two it could not satisfy.
 *
 *   narmour  it realises the expectation it raises
 *   outline  its notes are the mode's structural degrees — a figure is how a
 *            tradition says which notes of its mode matter
 *   compact  it stays inside a hand's span of the mode; a figure that crosses
 *            the whole compass is a phrase
 *   shape    it goes somewhere. A figure that changes direction at every step
 *            is an oscillation, and an oscillation is an ornament, not a motif
 */
function scoreFigure(music, degs) {
  const S = music.mode.size, M = music.melody, n = degs.length;
  if (n < 2) return 0;
  const iv = [];
  for (let i = 1; i < n; i++) iv.push(degs[i] - degs[i - 1]);
  let ok = 0, tests = 0;
  for (let i = 1; i < iv.length; i++) {
    const p = iv[i - 1], q = iv[i];
    if (p === 0) continue;
    tests++;
    if (Math.abs(p) >= 3) { if (Math.sign(q) !== Math.sign(p) && Math.abs(q) <= 2) ok++; }
    else if (q === 0 || Math.sign(q) === Math.sign(p)) ok++;
  }
  const nar = tests ? ok / tests : 0.5;
  let st = 0;
  for (const d of degs) {
    const k = ((d % S) + S) % S;
    if (k === 0 || M.structural.indexOf(k) >= 0) st++;
  }
  let lo = degs[0], hi = degs[0], zero = 0, turns = 0;
  for (const d of degs) { if (d < lo) lo = d; if (d > hi) hi = d; }
  for (let i = 0; i < iv.length; i++) {
    if (iv[i] === 0) zero++;
    if (i && iv[i] && iv[i - 1] && Math.sign(iv[i]) !== Math.sign(iv[i - 1])) turns++;
  }
  const range = hi - lo;
  const compact = range === 0 ? 0
    : Math.max(0, 1 - Math.max(0, range - Math.ceil(S / 2)) / 2);
  const moves = 1 - zero / iv.length;
  // AND A FIGURE IS MOSTLY STEPS TOO — more so than a phrase is, because the
  // figure is restated across the whole line, so its intervals ARE the line's
  // intervals. A germ with a fifth in it made every cell leap a fifth, and the
  // line-level proximity term could not undo what the figure had decided.
  const prox = Math.pow(iv.reduce((a, d) => a + (Math.abs(d) <= 2 ? 1 : 0), 0) / iv.length,
    1 + M.step);
  // A FIGURE THAT NEVER TURNS IS THE SCALE. It carries nothing the mode does
  // not already say, so it cannot identify anything — which is exactly what
  // the search returned when turning was simply penalised: a five-note run
  // straight down the mode. One turn is a figure; a turn at every step is a
  // tremolo.
  const shape = turns === 0 ? 0.35 : 1 - Math.min(1, (turns - 1) / Math.max(1, iv.length - 1));
  return 1.0 * nar + 0.9 * (st / n) + 0.9 * prox + 0.8 * compact + 0.7 * moves + 0.6 * shape;
}

/**
 * THE PEOPLE'S FIGURE. One short shape, drawn once and kept, that every
 * occasion's material is built out of. This is the *pakad* of a rāg and the
 * head-motif of a maqām, and cross-culturally it does more to identify a
 * tradition than its scale does — you recognise a tune by its figure long
 * before you could name its mode.
 *
 * It is also the answer to the drift problem. The features a listener
 * identifies a culture BY (timbre, texture) are measurably the ones that
 * change fastest through history, so identity cannot ride on them or a people
 * stops being recognisable across its own eras. Anchoring it here means the
 * instruments and the texture are free to be the century's costume while the
 * figure stays the face.
 */
export function signatureOf(music) {
  if (music._sig) return music._sig;
  const G = gridOf(music.rhythm);
  const len = Math.max(3, Math.min(5, G.groups[0] + 1));
  const seed = hash32(music.people.seed, "sig", music.mode.steps.map(c => Math.round(c)).join(","));
  let best = null, bestS = -Infinity;
  for (let k = 0; k < 240; k++) {
    // NOT LANDED. A figure is not a phrase: the cadential formula is what ends
    // a phrase, and forcing it onto a three-note figure turned every rising
    // germ into a turn back to the tonic — which is how the search came to
    // prefer a bare shuttle between two pitches over anything that went
    // anywhere.
    const degs = walkLine(music, hash32(seed, k), len, 0, music.melody.descent, false);
    const sc = scoreFigure(music, degs);
    if (sc > bestS) { bestS = sc; best = degs; }
  }
  const iv = [];
  for (let i = 1; i < best.length; i++) iv.push(best[i] - best[i - 1]);
  music._sig = iv;
  return iv;
}

/**
 * A LINE, BUILT FROM THE FIGURE AND THEN CHOSEN. Assemble a candidate by
 * laying the people's figure into the first cell and answering it in the
 * rest; score the whole thing; keep the best of several hundred. The
 * acceptance rate is the point — one line in some hundreds satisfies all of
 * the pressures at once, and generating one line and taking it is why the old
 * output had none of them.
 */
function buildLine(music, seedBase, pat, descent, prior) {
  const n = pat.onsets.length;
  if (!n) return [];
  const germ = signatureOf(music);
  const cells = cellsOf(pat, germ.length + 1);
  const M = music.melody, F = music.form;
  const ops = cellOpsFor(F);
  const lo = -Math.round(M.reach * 0.34), hi = M.reach;
  const tries = Math.min(420, 90 + 70 * cells.length);
  let best = null, bestS = -Infinity;
  for (let k = 0; k < tries; k++) {
    const roll = (t) => hash32(seedBase >>> 0, k, t) / 4294967296;
    const alt = [];
    {
      const w = walkLine(music, hash32(seedBase, k, "alt"), Math.max(2, germ.length + 1), 0, descent);
      for (let i = 1; i < w.length; i++) alt.push(w[i] - w[i - 1]);
    }
    const degs = new Array(n).fill(0);
    for (let ci = 0; ci < cells.length; ci++) {
      const ix = cells[ci], want = ix.length - 1;
      let c, base;
      if (ci === 0) { c = fitIv(germ, want); base = 0; }
      else {
        const op = ops[Math.floor(roll("o" + ci) * ops.length)];
        c = fitIv(CELL_OPS[op](germ, alt.length ? alt : germ), want);
        // A CELL IS PLACED, NOT WALKED TO. Starting each cell from where the
        // last one ended made the line MARCH: a figure that descends four
        // degrees, started one degree above the last note, walks the phrase
        // into the floor and out the bottom of the compass, and the clamp
        // that catches it turns the shape into sawteeth. Bases are absolute
        // and the search places them — which is what makes the envelope of
        // cell tops an arch rather than a slope.
        base = op === "restate" ? 0
          : op === "sequence" ? (roll("s" + ci) < 0.5 ? 1 : -1) * (1 + Math.floor(roll("t" + ci) * 2))
            : Math.round((roll("b" + ci) * 1.5 - 0.45) * Math.max(2, Math.min(4, M.reach * 0.5)));
      }
      const seg = [base];
      for (const d of c) seg.push(seg[seg.length - 1] + d);
      let top = seg[0], bot = seg[0];
      for (const d of seg) { if (d > top) top = d; if (d < bot) bot = d; }
      const sh = top > hi ? hi - top : bot < lo ? lo - bot : 0;
      for (let j = 0; j < ix.length; j++) degs[ix[j]] = seg[j] + sh;
    }
    cadence(music, degs);
    const s = scoreLine(music, degs, pat, descent, cells, prior);
    if (s > bestS) { bestS = s; best = degs; }
  }
  return best;
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
  const want = occasionFor(music, occKey).bright ?? 0;
  const fs = music.mode.finals;
  if (!fs || !fs.length) return 0;
  if (want > 0) return fs.reduce((a, b) => (b.bright > a.bright ? b : a)).f;
  if (want < 0) return fs.reduce((a, b) => (b.bright < a.bright ? b : a)).f;
  return 0;
}

/**
 * THE PHRASE BANK: a statement, its answer, and a departure — built ONCE per
 * people and occasion, then returned to. Nothing regenerates per cycle, so
 * the line is recognisable the second time it comes round.
 *
 * A A′ B, and the shape is not arbitrary. The ANSWER keeps the statement's
 * RHYTHM and re-answers the same figure, because a motif is recognised by its
 * rhythm more reliably than by its intervals — an earlier cut here gave every
 * entry its own rhythm, on the reasoning that rhythm is where the audible
 * difference between two phrases lives, and it is: it is also therefore where
 * the audible SAMENESS lives, and a restatement that changes both rhythm and
 * pitch is not heard as a restatement of anything. The DEPARTURE gets its own
 * rhythm as well as its own answer, and how far it departs is the tradition's
 * own development.
 *
 * All three are built out of the people's one figure (`signatureOf`), so a
 * departure is still audibly the same people's music.
 */
export function phraseBank(music, occKey) {
  const key = "_bank:" + occKey;
  if (music[key]) return music[key];
  const O = occasionFor(music, occKey);
  const fin = finalFor(music, occKey);
  const R = music.rhythm, G = gridOf(R);
  // A PHRASE IS NOT A BAR. It used to be exactly one metrical cycle, and after
  // the offbeat cull and the long values that swallow their neighbours, the
  // median melody came out TWO NOTES LONG. Nothing else could work on top of
  // that: a two-note line has one interval, so it cannot arch, and the rule
  // that lands a phrase on a structural degree rewrites half of it.
  //
  // How long a phrase is was already derived — `melody.phraseBeats`, from how
  // long a singer's breath is and how the language groups its words.
  const bars = Math.max(2, Math.min(4, Math.round((music.melody.phraseBeats || 6) / G.beats) || 2));
  const seed = hash32(music.people.seed, "ph", occKey);
  const dens = Math.min(0.95, R.density * O.density);
  const desc = music.melody.descent * O.descent;
  const pat = makePattern(music, seed, dens, R.syncopation, bars);
  const p2 = makePattern(music, seed + 90,
    Math.min(0.95, dens * (1 + music.form.development * 0.3)), R.syncopation, bars);
  const say = buildLine(music, seed + 1, pat, desc);
  const bank = [
    { pat, degs: say, fin, label: "statement" },
    { pat: { ...pat }, degs: buildLine(music, seed + 2, pat, desc, say), fin, label: "answer" },
    { pat: p2, degs: buildLine(music, seed + 3, p2, desc * 0.8), fin, label: "departure" },
  ];
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
  // CANDIDATES ARE NEAR-EVEN NECKLACES, which is what the line above has always
  // claimed and what the code did not do: it enumerated every k-subset of n and
  // threw away the ones whose evenness was worse than 2.2. That is C(n, k)
  // candidates for a test that only ever accepts a vanishing fraction of them,
  // and it is fine at eight slots (C(8,4) = 70) and impossible at thirty-two
  // (C(32,15) = 565,722,720 — hours per cycle). It survived only because no
  // rolled metre has ever exceeded seven beats. Any real sixteen-beat cycle —
  // tīntāl, and it is not exotic — hangs the composer outright.
  //
  // A near-even set is one whose GAPS are near-even, so enumerate the gaps
  // instead of the onsets. A maximally even set has gaps of only q and q+1
  // where q = floor(n/k); "near" allows exactly one gap to stray by one more.
  // That is the same acceptance region the evenness test describes, reached
  // directly, and it turns hours into microseconds without changing what
  // qualifies.
  let best = null, bestScore = -Infinity;
  const pick = new Set();
  const q = Math.floor(n / k);
  const GAPS = [q - 1, q, q + 1, q + 2].filter(g => g >= 1);
  const score = (chosen) => {
    const set = new Set(chosen);
    const ev = evenness(set, n);
    if (ev > 2.2) return;
    let onBeat = 0;
    for (const b of beats) if (set.has(b)) onBeat++;
    // it has to state the downbeat and then disagree with the beat
    const agree = onBeat / beats.size;
    const h = hash32(seed, "tl", chosen.join(",")) / 4294967296;
    const sc = -ev * 1.4 - Math.abs(agree - 0.45) * 6 + rhythmOddity(set, n) * 1.1 + h * 0.5;
    if (sc > bestScore) { bestScore = sc; best = [...chosen]; }
  };
  // walk gap sequences from slot 0 (a timeline states the downbeat), allowing
  // at most one gap outside {q, q+1}
  const walk = (at, chosen, strays) => {
    if (chosen.length === k) { if (at === n) score(chosen); return; }
    const left = k - chosen.length;
    for (const g of GAPS) {
      const nxt = at + g;
      if (nxt > n - (left - 1)) continue;            // no room for the gaps still owed
      const stray = (g === q || g === q + 1) ? 0 : 1;
      if (strays + stray > 1) continue;
      chosen.push(nxt % n);
      walk(nxt, chosen, strays + stray);
      chosen.pop();
    }
  };
  walk(0, [0], 0);
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
  const F = music.form, O = occasionFor(music, occKey);
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
      // Javanese irama runs one to sixteen, in doublings, and the measured
      // surface tempo of a dhrupad concert multiplies by the same integers
      // while the metric pulse barely moves. Three doublings is eight, which
      // is inside that range and as far as this texture can carry.
      dens: Math.pow(2, Math.round(3 * climb) - (t > 0.82 ? 1 : 0)),
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
function bassLine(music, G, cycleSlots, fin, ist, seed, ph) {
  const stable = music.melody.structural;
  const out = [];
  let acc = 0, k = 0;
  // A BASS NOTE SUPPORTS THE NOTE ABOVE IT. Which stable degree it takes was
  // drawn from a hash — an independent walk under the melody, so the interval
  // between them was whatever fell out, and a stable degree one step from the
  // melody's is a held second under the tune for a whole metrical group.
  // Measured, the bass was one of the two voices in an eighth of all the
  // sounding time this corpus spends in a semitone collision.
  //
  // The engine already knows which intervals are smooth for this people: it
  // derived the whole scale that way. So ask it. No name, no preference for
  // a fifth over a fourth — whichever of the tradition's own stable degrees
  // sits best under the note the melody is on, against the tradition's own
  // ensemble spectrum.
  const under = (s) => {
    if (!ph) return stable[(k + hash32(seed, "b", k)) % stable.length] || 0;
    const above = ph.degs[degAt(ph, s)] ?? 0;
    let best = 0, bestR = Infinity;
    for (const d of [0, ...stable]) {
      const c = modeCentsAt(music, above + fin) - modeCentsAt(music, d + fin) + 1200;
      const r = dissonance(music.spec, Math.pow(2, Math.abs(c) / 1200));
      if (r < bestR) { bestR = r; best = d; }
    }
    return best;
  };
  while (acc * G.div < cycleSlots) {
    for (const g of G.groups) {
      const s = acc * G.div;
      if (s >= cycleSlots) break;
      // home at the head of the cycle and at its end — home being the
      // SECTION's centre, which is where the rest of the texture now is
      const atEnd = s >= cycleSlots * 0.75;
      const deg = k === 0 || atEnd ? 0 : under(s);
      out.push({ s, beats: g, deg: modeDegree(music, deg + fin + ist) });
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
  const occ = occasionFor(music, occKey);
  const insts = music.insts;
  // WHAT CAN CARRY A TUNE is derived in musicInstruments.js from how definite
  // the pitch is, how many pitches the player can place, whether the body can
  // still be sounding for as long as this music's notes last, and whether one
  // note clears before the next arrives. Ranking on that instead of on pitch
  // count and prestige is what stops a culture playing melodies on a gong —
  // and it does so because a gong physically cannot, not because anything here
  // knows what a gong is.
  //
  // HOW LONG THIS MUSIC'S NOTES ARE is the tradition's own grid step: one beat
  // divided by its subdivision. It has to be passed in because "can this body
  // hold the note" is meaningless without knowing how long the note is, and it
  // is what lets the same rule hand a fast dance to a plucked string and a
  // long-breathed piece to a bow.
  const noteSecs = (60 / Math.max(1, music.rhythm.tempo * occ.tempo))
    / Math.max(1, music.rhythm.div || 2);
  // CAPABILITY IS A THRESHOLD; CENTRALITY IS THE RANKING. Every claim below
  // already GATES on melodic capacity — `x.m > 0.45` for the lead, `> 0.08`
  // for the inner parts — and that gate is what stops a culture playing tunes
  // on a gong. Sorting by the same number on top of gating with it was the
  // mistake: once two bodies both clear the bar, being 0.00005 better at
  // clearing it means nothing, and that is the margin the oud lost the takht
  // by. Measured: oud 0.99984, qanun 0.99979 — five parts in a hundred
  // thousand, deciding who leads.
  //
  // So rank on WEIGHT, which is centrality — pitch reach, what the material
  // cost, what the craft cost, what a court would keep — and let the
  // predicates decide capability. Among bodies able to hold the line, the one
  // the culture built up is the one it leads with, and among drums the central
  // drum keeps time. That is a claim about traditions rather than about float
  // arithmetic, and it is the same rule for every role.
  const rank = insts.map((i, k) => ({ i, k, m: melodicCapacity(i, noteSecs), r: articRate(i) }))
    .sort((a, b) => b.i.weight - a.i.weight);
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
  // WHO CARRIES THE TUNE, and one thing that was tried here and taken out.
  //
  // `musicOf` picks a tuning reference — the most central body that cannot be
  // adjusted in the moment — and everyone else bends to it. The lead is chosen
  // by melodic capacity, and the two used to land on bodies of OPPOSITE
  // harmonicity 46% of the time: a whole ensemble tuned to an mbira and the
  // tune then played on a struck zither, against whose harmonic spectrum the
  // mbira's scale is 16% rougher than it is against the mbira.
  //
  // The tempting fix is to hand the lead to the reference whenever it can
  // carry a line — the instrument that cannot follow anybody is the one others
  // copy. Measured, it works and it is wrong: the split falls to 9% and the
  // scale fits the melody body as well as it fits the reference, and the price
  // is that a stopped string stops leading anything. Lutes went from eighteen
  // of a hundred and fifty-seven to TWO, bowed strings from ten to one. A
  // world where no fiddle ever carries a tune is a bigger falsehood than a
  // nine-point split.
  //
  // The real repair was upstream, in what counts as un-retunable at all: with
  // the reference chosen by property rather than by four family names, it is
  // usually already the most central body that can carry a line, and `claim`
  // — which walks a weight-sorted list — hands it the tune on its own. Split
  // 46% → 17%, and the melody instruments stay a proper spread. What is left
  // is a bell or a gong setting the pitch for a line it cannot play, which is
  // Chinese court music and is the answer rather than a fault.
  // …AND A LOUD OCCASION STILL NEEDS A BODY THAT CAN PLAY THE TUNE. This claim
  // asked only how the body is driven, so any reed or pair of lips took the
  // melody whatever it could do with it — measured on a didgeridoo, a lip-driven
  // tube with a fundamental and one overblown note, which was handed the line
  // for a war piece. Reed and lip first, as the record says, among bodies that
  // clear the same bar as everyone else who plays the tune.
  const lead = loud
    ? (claim(x => (x.i.drive === "reed" || x.i.drive === "lip") && x.m > CARRIES * 0.44)
      ?? claim(x => x.m > CARRIES * 0.44))
    : claim(x => x.m > CARRIES);
  // the elaborating part is the FASTEST pitched body, not the second-best one
  // the elaborating part is the FASTEST pitched body — but not one whose
  // pitches are its own harmonic series rather than the player's choice: a
  // natural horn cannot paraphrase a melody, it can only sound its tube
  // AND IT NEEDS WHAT THE TUNE NEEDS. The elaborating part plays the same line
  // with more notes in it, so a body that could not carry the line cannot
  // paraphrase it either — and gating this at 0.08 while the lead was gated at
  // 0.45 handed rag Yaman's elaboration to the TANPURA, a four-string drone
  // that has no pitches to paraphrase with. Same bar for both.
  const elab0 = rank.filter(x => !taken.has(x.k) && x.m > CARRIES && FAM(x.i).tune !== "series")
    .sort((a, b) => b.r - a.r)[0];
  // the timekeeper is claimed first among the accompaniment: a body with no
  // pitch to speak of has exactly one job, and letting a pitched part take it
  // first leaves the ensemble with no beat
  const pulse = claim(x => FAM(x.i).vib === "membrane");
  // AND EVERY OTHER BODY THAT CAN KEEP TIME. A percussion section is several
  // DIFFERENT bodies — darbūka and riqq, the two drums of a tablā pair, a drum
  // with clappers and a rattle over it — and the parts written for it are
  // interlocking, which is the whole point of writing more than one.
  //
  // The engine wrote those parts and then gave every one of them to the single
  // body it had claimed as `pulse`: one drummer with four hands. Everything
  // else that could keep time fell through every claim in this function and
  // never played a note — measured, the Arabic riqq, a second frame drum, and
  // the rattle and scraper this table gained last week were all silent in
  // every piece, in ensembles of four and five bodies.
  // A body that cannot be re-articulated is not a part. What it does in every
  // tradition that has one is MARK — one stroke where the cycle turns, left to
  // ring, and the loudest thing in the bar precisely because it is the rarest.
  // A NESTED PUNCTUATION NEEDS NESTED BODIES. A colotomic ensemble marks the
  // cycle, then its quarters, then their quarters — on gongs of different
  // sizes, never on one gong struck sixteen times. So collect however many
  // un-articulable bodies there are, largest first, and mark exactly as many
  // levels as there are bodies to mark them with.
  //
  // CLAIMED BEFORE THE PERCUSSION SECTION, and gated on pitch count as well as
  // on ring. Both were wrong until a gamelan was put on the bench and neither
  // could be argued about afterwards: the gong ageng — one pitch, two thirds of
  // a stroke a second — was being swept into the percussion section as an
  // ordinary drum, while the bonang, a rack of TEN tuned kettles, was made the
  // colotomic marker because it also rings. Exactly backwards, and the comment
  // above already said why: the mark is the body that cannot be re-articulated
  // AND has nothing to re-articulate with.
  const marks = [];
  for (let i = 0; i < 3; i++) { const k = claim(x => x.r < 1.6 && x.i.cap <= 2); if (k == null) break; marks.push(k); }
  const mark = marks.length ? marks[0] : null;
  // …AND NOT A BODY THAT CANNOT BE RE-STRUCK. A percussion section is made of
  // bodies you can hit repeatedly; one that rings for a second and a half is
  // the `marks` case above, which now claims before this does.
  const perc = rank.filter(x => !taken.has(x.k) && x.i.kind === "struck" && x.i.cap <= 2 && x.r >= 1.6)
    .map(x => (taken.add(x.k), x.k));
  const elab = elab0 && !taken.has(elab0.k) ? (taken.add(elab0.k), elab0) : null;
  // ── HETEROPHONY IS EVERY CAPABLE BODY ON THE SAME LINE ──
  //
  // The word means different voices, and what differs is the VERSION of the
  // tune, not the tune. A sizhu ensemble is dizi, erhu, pipa and yangqin all
  // playing one melody in four idioms at once; a takht is oud, qanun, nay and
  // kamanja doing the same; a sankyoku is koto and shamisen and shakuhachi on
  // one line. That is the texture this engine claimed to have and did not
  // build: it gave the tune to ONE body, an ornamented copy to a SECOND, and
  // sent everybody else off to hold a pedal or walk a bass — so a five-body
  // heterophonic tradition came out as a duo with accompaniment, which is
  // exactly what it sounded like.
  //
  // Anything that can carry the line and has not been given another job joins
  // it. Polyphony gets the same treatment here because independent lines are
  // beyond what this composer writes; playing the tune together is nearer the
  // truth than sitting out.
  //
  // AND IT CLAIMS BEFORE THE ACCOMPANIMENT DOES. In a texture defined by
  // everybody being on the line, a body that can carry the line joins it
  // rather than walking a bass underneath it — claiming this last left the
  // shakuhachi playing a bass part two octaves below its own bottom note while
  // the koto played alone. The timekeeper is claimed first because a drum
  // cannot carry a line anyway and the ensemble needs its beat; everything
  // after this point is what is genuinely left over, and a small ensemble
  // having no bass part and no ostinato is the right answer, not a gap.
  const het = (music.texture.kind === "heterophony" || music.texture.kind === "polyphony")
    ? rank.filter(x => !taken.has(x.k) && x.m > CARRIES && FAM(x.i).tune !== "series")
      .map(x => (taken.add(x.k), x.k))
    : [];
  const core = claim(x => x.m > 0.08 && x.r < 6);

  // A DRONE ONLY EXISTS IN A DRONE TEXTURE. `textureOf` decides that from the
  // ensemble's size and whether anything sustains, and it is definitional: a
  // heterophony is many versions of one line and a polyphony is many lines,
  // and neither of them is a line over a held pitch. Claiming a drone anyway
  // meant the one sustaining body in the room was taken off the melody to hold
  // a pedal — the shakuhachi in a sankyoku, the nay in a takht, the sheng in a
  // sizhu, all three of which play the TUNE. Freeing them here is what lets
  // them join the heterophony below.
  const drone = music.texture.kind === "drone"
    ? claim(x => x.i.kind === "sustain" || x.i.partials[0].d > 2.5) : null;
  const bass = claim(x => x.i.partials[0].d > 1.2 || x.i.kind === "sustain");
  const ost = claim(x => x.i.cap >= 3);
  const voices = Math.max(1, Math.round(music.texture.size * (0.35 + 0.65 * intimacy)));
  return {
    lead, elab: elab ? elab.k : null, core, drone, bass, ost, pulse, perc, mark, marks, het,
    voices, occ,
    // ── IS THERE SINGING, AND ARE THERE WORDS IN IT ──
    //
    // It sings unless the occasion is a loud outdoor one, where nothing
    // unamplified carries over the reeds and the drums — OR unless there is
    // nothing else in the room that can state a tune. That second clause is
    // what this file already asserts two hundred lines up: a society with a
    // rich vocal tradition and no melodic instrument is common and one with
    // melodic instruments and no singing is unattested, so a people whose
    // bodies cannot carry a line does not fall silent at a distance — the
    // singing IS their music, and it is all there is to hear. Measured, that
    // is 3 peoples in 120.
    sing: (!loud && intimacy > 0.25) || lead == null,
    // WORDS WERE A FLAG HERE FOR ONE COMMIT, AND NOTHING EVER READ IT. The
    // acoustics behind it are true — consonants are what make speech
    // intelligible and they are the quiet part, brief, well under the vowels
    // they surround and in the band air absorbs fastest, so across a square you
    // hear that people are singing and not a syllable of what. But the renderer
    // does not choose between a worded voice and a wordless one at any distance:
    // it sings wordless always, because a modelled throat next to recorded oud
    // and koto gives itself away. A distance threshold selecting between two
    // options when only one is ever taken is a decorative flag, which is the
    // exact fault this session has spent its time removing from `finalIdx` and
    // `role`. The fact lives where it is acted on, in `fireVoiceLine`.
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
      // THE SECTION'S TONAL CENTRE BELONGS TO THE WHOLE SECTION. `ist` is the
      // modal alternative to leaping an octave at a section seam — the middle
      // sections move the tune's centre through the mode and the outer ones
      // sit at home — and the melody was taking it on its LAST NOTE ONLY.
      // Two faults in one conditional: the tune never actually moved its
      // centre, so the climb the section plan describes did not exist; and the
      // elaboration and the core DID move, so for every middle section of
      // every piece the skeleton and the figuration ran a scale degree or more
      // away from the melody, from first note to last. Measured over a hundred
      // and sixty peoples, the elaboration was one of the two voices in 57% of
      // every semitone clash in the corpus. That is the eeriness, and it is
      // one `? :` wide.
      b: at + b, dur: len, inst, mi, deg: modeDegree(music, mi + fin + ist), oct, role,
      // the melody is the thing being listened to, so it sits on top of the
      // texture the other layers make
      vel: vel * 1.5 * metre * stress * arc * (0.65 + 0.35 * intimacy),
      last, strong,
    };
    // An ornament is a quick neighbour just ahead of the note — a MODE step,
    // so it decorates the line instead of smearing a microtone across it, and
    // sparse, because one on every long note is clutter rather than style.
    if (opts.orn && !strong && span >= 0.5 && hash32(music.people.seed, "orn", s) % 3 === 0) {
      e.ornDeg = modeDegree(music, mi + fin + ist + 1);
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
/**
 * WHICH DEGREE OF THE PHRASE IS SOUNDING AT THIS SLOT.
 *
 * Every part that paraphrases or skeletonises the melody has to look the tune
 * up BY WHERE IT IS IN TIME. Both of them walked their own counter through the
 * degree list instead — the elaboration took its j-th note from the phrase's
 * j-th degree, and since it has several times as many notes as the phrase has
 * degrees, it wrapped and drifted out of phase inside the first bar. So the
 * elaborating part was playing a different place in the tune from the lead,
 * permanently, and the interval between them was whatever fell out.
 *
 * Measured over a hundred and sixty peoples, the elaboration was one of the
 * two voices in 60% of all the semitone clashes in the corpus — a step or a
 * minor ninth sounding against a held melody note. That is the eeriness.
 */
function degAt(ph, slot) {
  const on = ph.pat.onsets;
  let k = 0;
  while (k + 1 < on.length && on[k + 1] <= slot) k++;
  return k;
}

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
  // A GROUND FIXES THE CENTRE. `S.sec.ist` moves the section's tonal centre
  // through the mode — the modal alternative to leaping an octave at a seam —
  // and that is only available to a texture with nothing anchored to the old
  // centre. A drone IS the centre: a tānpūrā is not retuned mid-piece, and a
  // line that walks away from its own drone is a line playing against a held
  // second. A colotomic marker is the same argument from the other end, and a
  // harder one: a gong or a bell has one pitch and cannot follow anywhere.
  //
  // So the two textures that have a ground keep their centre, and the ones
  // that do not are free to move it. This is why the drone traditions were the
  // worst of the bench the moment the melody started actually taking `ist`:
  // the tune moved and the thing it was supposed to be moving against did not.
  // …and a marker grounds it only if it CANNOT FOLLOW. A gong has one pitch,
  // so a tradition that punctuates on one cannot move its centre away from it.
  // A tuned bell set spans octaves and follows anywhere, so it does not ground
  // anything — treating every punctuating body as an anchor took the centre
  // change away from the bell-and-chime traditions that can most afford it.
  const anchored = (E.marks || []).some(k => (music.insts[k] || {}).cap <= 1);
  const ist = (ST.drone || anchored) ? 0 : S.sec.ist;
  const seed = hash32(music.people.seed, "amb", occ);
  const ev = [];
  // WHO IS PLAYING IS A QUESTION OF WHO HAS TURNED UP, and it is two facts,
  // not seven numbers. HOW MANY: `thin` is already the fraction of the ensemble
  // a section calls for, so the seats are that fraction of the parts — a
  // statement is a couple of players and the peak is everybody. WHICH ONES:
  // centrality. The body at the middle of a tradition plays throughout; the
  // fringe body comes in for the climax and drops out again, which is what an
  // ensemble audibly does. The melody keeps its seat whatever happens, because
  // a piece without its tune is not thinner, it is missing.
  //
  // This replaces seven hand-picked thresholds (0.3, 0.55, 0.5, 0.25, 0.45,
  // 0.7, 0.35) none of which meant anything on its own, and it is what makes
  // the density arc REAL: the piece gets busier because more people are
  // playing, not because one player speeds past what hands can do.
  const wOf = (r) => r.startsWith("het")
    ? (music.insts[+r.slice(3)] || { weight: 0 }).weight : ST[r].inst.weight;
  const roster = [...STRATA.filter(r => ST[r] && ST[r].inst),
    ...(E.het || []).map(k => "het" + k)].sort((a, b) => wOf(b) - wOf(a));
  // A THIN SECTION IS QUIETER, NOT NECESSARILY EMPTIER. An ensemble has two
  // ways to play a thinner section — players rest, or the players left play
  // softer — and which it uses is not a preference, it is whether there is
  // anybody spare. A gamelan thinning to 40% genuinely sends half the room to
  // sit down. A quartet cannot: there is nobody to lose, so the same four play
  // softer. Spending the whole reduction on empty seats is what made a small
  // ensemble sound ABANDONED rather than intimate, and it is why the arc was a
  // two-state switch instead of an arc — measured, three of the five bench
  // traditions had exactly TWO distinct stage sets across sixteen bars,
  // because `ceil` over five or six roles has only two values to give.
  //
  // So: rest whoever can be spared above what the music cannot be played
  // without — one line for a monophony, a line and something to hear it
  // against for anything else, which is what the texture's own name asserts —
  // and take the rest of the reduction out of the players' hands instead.
  // A TRIO CANNOT DROP A THIRD OF ITSELF AND STILL BE A TRIO. Thinning took a
  // fraction of the WHOLE roster, so a four-body ensemble played two in its
  // opening and closing sections — proportionally the same cut a seven-body
  // one takes, and audibly a different thing: the large ensemble thins, the
  // small one empties. What a small group actually does is play together and
  // vary its density instead.
  //
  // So the players a section can drop are the ones it has to SPARE — over the
  // minimum the texture needs, which is a line (two of them if the texture is
  // built on several versions of one) and something keeping time.
  const keep = music.texture.kind === "monophony" ? 1 : 2;
  const floor = Math.min(roster.length, keep + (E.pulse != null ? 1 : 0));
  const thin = Math.min(1, S.sec.thin * intimacy);
  const spare = Math.max(0, roster.length - floor);
  const seats = Math.max(1, Math.min(roster.length, floor + Math.round(spare * thin)));
  // whatever thinness the seats could not absorb comes out of the dynamics
  const want = floor + spare * thin;
  const hush = Math.min(1, want / Math.max(1e-6, seats));
  // THE MELODY KEEPS ITS SEAT — WHEN THERE IS ONE. "lead" was written into the
  // stage set unconditionally and the remaining seats counted from `seats - 1`,
  // so an ensemble with no lead gave its only seat to a part that does not
  // exist and everybody who does exist was cut. Found by putting a didgeridoo
  // and a pair of clapsticks on the bench: nothing clears the melodic bar, so
  // there is no lead, so the drone — the entire pitched content of that
  // tradition — was silent in every piece.
  const hasLead = roster.includes("lead");
  const onStage = new Set([...(hasLead ? ["lead"] : []),
    ...roster.filter(r => r !== "lead").slice(0, Math.max(0, seats - (hasLead ? 1 : 0)))]);
  const audible = (role) => onStage.has(role);

  // THE MARK. One stroke where the cycle turns, left to ring, and the LOUDEST
  // event in the cycle — a punctuating body is loud precisely because it is
  // rare. It used to be the quietest thing in the bar.
  if (E.marks && E.marks.length && audible("mark")) {
    const levels = Math.min(E.marks.length, S.sec.dens > 2 ? 3 : 2);
    for (const c of colotomy(SLOTS, G.div, levels)) {
      const k = E.marks[Math.min(c.level, E.marks.length - 1)];
      ev.push({ b: slotBeat(G, c.s, 0), dur: 3.5, inst: k,
        deg: modeDegree(music, fin + ((music.insts[k] || {}).cap > 1 ? ist : 0)),
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
  if (ST.core && audible("core")) {
    // AND THE CORE SLOWS. This is the part of irama that surprises: as the
    // elaboration multiplies, the skeleton it hangs on STRETCHES rather than
    // keeping pace, so the piece gets denser and more spacious at once. Both
    // moving together would just be the same music played faster.
    const step = Math.max(G.div, Math.round((SLOTS / ST.core.n) * Math.sqrt(S.sec.dens)));
    for (let s = 0; s < SLOTS; s += step) {
      const d = ph.degs[degAt(ph, s)] ?? 0;
      ev.push({ b: slotBeat(G, s, R.swing), dur: Math.min(1.1, step / G.div * 0.6), inst: ST.core.k,
        deg: modeDegree(music, d + fin + ist), oct: -1, vel: ST.core.vel, role: "core", damped: true });
    }
  }
  // THE LINE — stated plainly first, and filled in later. A statement is the
  // theme in its barest form; what multiplies as a piece intensifies is the
  // elaboration around it, not the theme itself. Playing every note of it from
  // the opening bar leaves the later sections with nowhere to go, and measured,
  // it was most of why the density ramp stalled at two and a half times when
  // the traditions run four to sixteen.
  const plain = S.sec.dens < 4
    ? { ...ph, pat: { ...ph.pat, onsets: ph.pat.onsets.filter((o, i) => ph.pat.grid.w[o % ph.pat.grid.slots] >= (S.sec.dens < 2 ? 1 : 0.5) || i === 0) } }
    : ph;
  if (plain !== ph) {
    plain.degs = plain.pat.onsets.map(o => ph.degs[ph.pat.onsets.indexOf(o)] ?? 0);
    plain.pat.notes = ph.pat.notes.filter(n => plain.pat.onsets.includes(n.s));
  }
  const lead = layPhrase(music, plain, O, {
    inst: ST.lead ? ST.lead.k : -1, intimacy, oct: Math.round(O.reg) + S.sec.oct,
    ist, orn: music.texture.ornament * S.sec.orn > 0.5,
    vel: 0.42 * (0.85 + 0.3 * Math.min(1, S.sec.dens / 3)),
  });
  // ── THE OTHER VOICES: everyone else who can carry the line is carrying it ──
  //
  // This is what heterophony IS, and the engine did not have it. What differs
  // between the players is not the tune — they are all on the same one, and
  // they meet on every note of it — but what their body does to it, and every
  // difference below is a fact about the body rather than a style setting:
  //
  //  - A SLOWER BODY PLAYS FEWER OF THE NOTES. The sheng and the erhu hold the
  //    skeleton while the pipa plays every note; the nay outlines what the oud
  //    fills in. Which one a player is doing is not a choice, it is their
  //    articulation rate against this phrase's note rate, so the same
  //    `articRate` that bounds the elaboration decides here who plays the
  //    strong notes only. That is the single most recognisable thing about a
  //    heterophonic ensemble: the same melody at several different densities
  //    at once.
  //  - A DRIVEN BODY SPEAKS LATE. A bowed string needs a few periods to settle
  //    into Helmholtz motion and a reed needs to start beating, where a
  //    plucked or struck one is there at the attack. So the driven players sit
  //    a few tens of milliseconds behind and the struck ones sit on the note,
  //    and no two players sit in quite the same place. That spread is most of
  //    why several people playing one line sound like several people instead
  //    of like one instrument with a chorus on it.
  //  - AND A BODY HOLDS THE NOTE FOR AS LONG AS IT HOLDS IT. A sustaining
  //    player carries through the gaps; a plucked one lets it ring and stops
  //    when the string stops.
  for (const k of (E.het || [])) {
    if (!audible("het" + k)) continue;
    const inst = music.insts[k];
    if (!inst) continue;
    const rate = articRate(inst);
    // notes per second this phrase actually asks for
    const asks = lead.length / Math.max(0.05, (SLOTS / G.div) * spb);
    // a body that cannot keep up plays the metrically strong notes instead —
    // not a simplification imposed on it, just what it has time for
    const share = Math.min(1, rate / Math.max(0.001, asks));
    // A LAG IS BOUNDED BY THE NOTE IT IS LAGGING BEHIND. Heterophony offsets
    // the voices; it does not put one of them on the previous note while the
    // rest have moved on. Twenty-eight milliseconds is a flam at a slow tempo
    // and a collision at a fast one, and it stayed twenty-eight milliseconds —
    // so as the lines got denser the same lag started straddling note
    // boundaries instead of decorating them. A player who is a quarter of the
    // way to the next note is not lagging, they are wrong.
    const lag = ((inst.kind === "sustain" ? 0.028 : 0.004)
      * (0.5 + (hash32(seed, "drag", k) % 997) / 997)) / spb;
    let kept = 0;
    for (const e of lead) {
      if (share < 1) {
        // keep the strong notes first, and the phrase's own ends always
        const w = e.strong ? 1 : 0.5;
        if (!e.last && !e.strong && hash32(seed, "het" + k, Math.round(e.b * 96)) % 1000 >= share * w * 1000) continue;
      }
      kept++;
      ev.push({ ...e, inst: k, b: e.b + Math.min(lag, e.dur * 0.25), role: "het",
        // A HELD BODY FILLS THE GAP TO THE NEXT NOTE — but only if it is
        // playing the next note. A body too slow for the line drops notes
        // (`share` above); stretching what it kept over the ones it dropped
        // holds one degree against the two or three the line moved through,
        // which is the longest-lasting collision in the texture.
        dur: e.dur * (inst.kind === "sustain" && share >= 1 ? 1.25 : 1),
        // the line is what is being listened to, so its doublings sit just
        // under it — a little, not a lot: these are players, not a layer
        vel: e.vel * 0.82 * (0.7 + 0.3 * inst.weight),
        // and whoever has the hands to decorate, decorates
        ornDeg: rate > 6 && e.ornDeg != null ? e.ornDeg : undefined,
        ornLead: rate > 6 && e.ornDeg != null ? e.ornLead : undefined,
        damped: inst.kind !== "sustain" });
    }
    if (!kept && lead.length) ev.push({ ...lead[0], inst: k, role: "het", vel: lead[0].vel * 0.62 });
  }
  // A phrase LANDS, in three grades: the end of a phrase, the end of a section,
  // the end of the piece. Only the last note of the last cycle of a section
  // gets the long one, and a section ending also gets real silence after it —
  // a rest is the strongest boundary signal there is.
  const last = lead[lead.length - 1];
  if (last && S.last) last.dur *= S.sec.grade === 2 ? 2.6 : 1.8;
  // THE APPROACH. A section that changes register used to get there by
  // jumping: the line simply restarted a frame higher, on a note nothing had
  // led to. Measured, that happened about one and a half times a piece and it
  // is the loudest remaining fault in the melodies.
  //
  // No tradition does it that way. A modal one climbs by WALKING — the Persian
  // radif names the descending figure that brings the line back down from its
  // high point, and every tradition with an arch has some version of it — so
  // the last few notes of the outgoing cycle are rewritten as a stepwise run
  // that arrives at the new register on the downbeat. Which direction it runs
  // is decided by where the music is going, and its length by how far.
  if (S.last) {
    const nxt = sectionAt(secs, bar + 1);
    // AND IT ARRIVES WHERE IT IS GOING. The run is a lead-in to the NEXT
    // section, so it walks into that section's tonal centre, not this one's —
    // it used to drop the centre entirely and land the line at home while the
    // section it was leading into was somewhere else.
    const nist = (ST.drone || anchored) ? 0 : nxt.sec.ist;
    const climb = nxt.sec.oct - S.sec.oct;
    if (climb !== 0 && lead.length >= 3) {
      const steps = Math.max(3, Math.min(lead.length - 1, music.mode.size));
      const from = lead[lead.length - steps].mi;
      const to = from + climb * music.mode.size;
      for (let i = 0; i < steps; i++) {
        const e = lead[lead.length - steps + i];
        const mi = Math.round(from + ((to - from) * (i + 1)) / steps);
        e.mi = mi;
        e.deg = modeDegree(music, mi + fin + nist);
        // the run is a lead-in, not a cadence: it does not linger
        e.dur = Math.min(e.dur, 1 / G.div * 1.5);
        e.vel *= 0.82 + 0.18 * (i / steps);
      }
      // and the note it was going to land on is not an ending any more
      if (last) last.dur = Math.min(last.dur, 1.2);
    }
  }
  if (ST.lead) ev.push(...lead);
  // THE ELABORATION: two to sixteen times the core's density, running
  // continuously. This is where the music lives in every tuned-metal tradition
  // and the engine simply did not have it — implement the gong and the core
  // and leave this out and you have left out most of the onsets.
  if (ST.elab && audible("elab") && ST.elab.k !== (ST.lead && ST.lead.k)) {
    // AND IT SUBDIVIDES. One note per grid slot is a ceiling the elaborating
    // instruments of these traditions go straight through: a Javanese peking
    // plays two, four, eight or sixteen notes to a beat of the core melody,
    // and that is where the density comes from. How far it can actually go is
    // bounded by the body — a bronze key clears about two notes a second and a
    // wooden one ten — so the subdivision asks and the physics answers.
    const sub = S.sec.dens >= 8 ? 4 : S.sec.dens >= 4 ? 2 : 1;
    const N = SLOTS * sub;
    // THE SUBDIVISION ASKS AND THE PHYSICS ANSWERS — which is what the note
    // above has always claimed and what the code did not do. `ST.elab.n` is
    // already min(what the body allows, what the part wants); multiplying it by
    // `sub` threw the first half of that away, and the ceiling left standing was
    // the GRID, not the player. Measured over sixteen hundred people-bars, 30%
    // asked the elaborating instrument to play faster than its own body can
    // articulate — a stone bar set that clears 1.8 notes a second asked for 7.3,
    // and a stopped pipe that clears ten asked for 23.6, which is past any human
    // tongue on any instrument.
    // And speeding the elaborator up is not how irama works. The elaborating
    // player keeps their own pace; it is the CORE that stretches underneath them,
    // which is what multiplies the density RATIO while everyone goes on playing
    // at a human speed. The core already stretches, sixty lines above.
    const n = Math.max(2, Math.min(
      Math.round(ST.elab.n * sub * Math.min(1, 0.3 * S.sec.dens)),
      ST.elab.n, N - 1));
    const e = euclid(n, N);
    for (let s = 0; s < N; s++) {
      if (!e[s]) continue;
      // it PARAPHRASES the line rather than doubling it: same pitches, more of
      // them, and it fills where the line is not
      // IT PARAPHRASES THE LINE: it plays the note the melody is on, and in
      // the gap it leans toward the note the melody is going to. That is what
      // an elaborating part does in every tradition that has one, and it is
      // also the only way the interval between the two parts is ever a
      // consonance rather than an accident.
      const slot = s / sub, k = degAt(ph, slot), on = ph.pat.onsets;
      const here = ph.degs[k] ?? 0;
      const next = ph.degs[(k + 1) % ph.degs.length] ?? here;
      const to = k + 1 < on.length ? on[k + 1] : SLOTS;
      // A PASSING NOTE IS TAKEN ON THE WAY, not held for half the gap. Leaning
      // toward the next degree for the whole second half of every gap put the
      // elaboration a step off the melody for half of the bar, which is a
      // dissonance rate no tradition has: it is one approach note, immediately
      // before the line moves.
      let lastBefore = true;
      for (let q = s + 1; q < N; q++) if (e[q]) { lastBefore = q / sub >= to; break; }
      const d = lastBefore && Math.abs(next - here) >= 2 ? here + Math.sign(next - here) : here;
      const near = on.some(o => Math.abs(o * sub - s) < sub);
      ev.push({ b: slotBeat(G, s / sub, R.swing), dur: 0.34 / sub, inst: ST.elab.k,
        deg: modeDegree(music, d + fin + ist), oct: Math.round(O.reg) + S.sec.oct,
        vel: ST.elab.vel * (near ? 0.6 : 1), role: "elab", damped: true });
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
  if (ST.drone && music.texture.kind !== "monophony" && audible("drone")
      && music.texture.ornament * S.sec.orn > 0.3) {
    const every = Math.max(1, Math.round(SLOTS / ST.drone.n));
    const fifth = music.melody.structural[1] ?? 2;
    for (let s = 0, j = 0; s < SLOTS; s += every, j++) {
      ev.push({ b: slotBeat(G, s + (j % 3 === 2 ? 1 : 0), 0), dur: (every / G.div) * 1.3,
        inst: ST.drone.k, deg: modeDegree(music, (j % 2 ? fifth : 0) + fin), oct: -2 + (j % 2),
        vel: ST.drone.vel * (0.55 + 0.45 * O.drone) * (j % 2 ? 0.7 : 1), role: "pad" });
    }
  }
  if (ST.bass && music.texture.size >= 2 && audible("bass")) {
    for (const b of bassLine(music, G, SLOTS, fin, ist, seed, ph)) {
      ev.push({ b: slotBeat(G, b.s, R.swing), dur: b.beats * 0.72, inst: ST.bass.k, deg: b.deg,
        oct: -2, vel: ST.bass.vel, role: "bass", damped: true });
    }
  }
  if (ST.ost && music.texture.size >= 3 && audible("ost")) {
    const n = Math.round(ST.ost.n * Math.min(1, S.sec.dens / 2));
    for (const o of ostinato(music, G, SLOTS, fin + ist, n, seed)) {
      ev.push({ b: slotBeat(G, o.s, R.swing), dur: 0.5, inst: ST.ost.k, deg: o.deg, oct: -1,
        vel: ST.ost.vel * 0.7, role: "ost", damped: true });
    }
  }
  // A PEOPLE WITH NO DRUM STILL HAS PERCUSSION. This whole block was gated on
  // `ST.pulse`, the timekeeper, which `ensembleFor` only ever claims from a
  // MEMBRANE — so an ensemble of clappers, rattles and scrapers had every one
  // of them claimed into the section and then skipped it entirely. The peoples
  // who most need their idiophones heard are exactly the ones with no hide to
  // stretch, and they were silent.
  const percBodies = [...(ST.pulse ? [ST.pulse.k] : []), ...(E.perc || [])];
  if (percBodies.length && O.perc > 0.15 && (ST.pulse ? audible("pulse") : true)) {
    // Lowest body takes the first part, which is the one that carries the
    // downbeat — that ordering is the body's own register, not a rule about
    // which drum is the "main" one.
    const section = percBodies
      .map(k => ({ k, i: music.insts[k] }))
      .filter(x => x.i)
      .sort((a, b) => (FAM(a.i).low || 200) - (FAM(b.i).low || 200));
    // HOW MANY PARTS is what the tradition writes; HOW MANY BODIES is what it
    // has to play them. Those are different numbers, and throttling the parts
    // to the bodies was wrong in the one case that matters most: a people
    // whose only percussion is its own hands then played the bell pattern
    // alone and nothing else, losing the continuous fill that is `drumEnsemble`
    // part 1 — measured, four fifths of its percussion. A solo player covers
    // more of the pattern than any one member of a section does, which is
    // exactly what cycling the parts over the bodies gives.
    const hands = Math.max(1, Math.min(4, Math.round(1 + music.texture.size * 0.55 * O.perc * S.sec.thin)));
    const play = section;
    drumEnsemble(music, G, SLOTS, seed, hands, R.density * S.sec.dens * 0.5).forEach((part, pi) => {
      const body = play[pi % play.length];
      for (const h of part.hits) {
        ev.push({ b: slotBeat(G, h.s, R.swing), dur: 0.35, inst: body.k, deg: 0,
          oct: -1, vel: h.vel * O.perc * (ST.pulse ? ST.pulse.vel : 0.5) * 2.2,
          role: "pulse", stroke: h.stroke, voice: pi });
      }
    });
  }
  // THE VOICE, on the line the instrument is playing — but not in unison with
  // it. Two players on one melody, each ornamenting it their own way, is
  // heterophony, and it is the commonest way a sung tradition and its
  // instruments sound together anywhere in the world.
  //
  // THE SINGER IS A BODY, and was the only one in the room not treated as one.
  // Every other player's version of the line is DERIVED: how fast it can
  // re-articulate decides how much of the line it takes (`share`, above), how
  // it is driven decides how late it speaks (`lag`), and where its bottom note
  // sits decides which octave it plays in. The singer got a switch instead —
  // strong notes only if anything else was leading, every note if not, a flat
  // 1.35x on the durations, and an octave picked by subtracting one from
  // whatever body happened to be leading.
  //
  // That is heterophony written as a special case, and it sounded like one. On
  // a slow line the singer was cut to a third of it for no reason — measured
  // across the bench and six seeds, the sung part was 51% of the line and as
  // little as 11%, at tempi where the line runs 1.2 to 2.2 notes a second and
  // any human can sing every note of it. What was left landed on exactly the
  // player's attack, on exactly the player's pitch, 100% of the time: a chorus
  // effect on the lead, not a second person in the room. So derive the
  // singer's part from the singer, using the mechanisms already here.
  if (E.sing) {
    const pros = prosodyOf(music.people.lang);
    // ── 1. HOW MUCH OF THE LINE. A singer is bound by the SYLLABLE, and a
    // syllable is a jaw cycle with segments in it: an open CV nucleus is one
    // gesture, and every consonant slot a language allows on either side of it
    // adds another segment's worth of articulation. So the ceiling is not
    // `articRate`'s ten notes a second — that is fingers — it is however many
    // syllables this people's own phonotactics fit into a second, which is why
    // an open-syllable tongue can be sung faster than a cluster-heavy one.
    const sylC = ((music.people.lang || {}).prof || {}).sylC ?? 1;
    const sylSecs = (VOWEL_SECS + SEGMENT_SECS * sylC) / Math.max(0.5, pros.rate);
    const asks = lead.length / Math.max(0.05, (SLOTS / G.div) * spb);
    const share = Math.min(1, (1 / sylSecs) / Math.max(0.001, asks));
    // ── 2. WHERE THE SINGER SINGS is not this function's to say, and the
    // constant that said it — `oct + (breathBound ? 0 : -1)` — was a guess made
    // without the one number that decides it. A singer picks a key: they move
    // the whole phrase by whole octaves until it sits in their compass, and
    // which octave that is depends on the CONCERT PITCH the piece is played at,
    // which the composer does not choose and cannot see. The renderer does, and
    // already does this properly — least of the breath group outside the voice,
    // then most centred in it, the group moving together so no fold ever lands
    // inside a breath. So say the one thing that is true here, which is that
    // the singer is on the line, and leave the key to whoever knows the pitch.
    // ── 3. WHEN. The voice is a driven body, so it speaks late — and later
    // than any of them, because a consonant has to get out of the way before
    // the vowel carrying the pitch arrives. That delay is voice onset time and
    // it is tens of milliseconds, the same order as a bow settling.
    const vlag = (ONSET_SECS * (0.6 + (hash32(seed, "sing", 0) % 997) / 997 * 0.8)) / spb;
    const sung = [];
    for (const e of lead) {
      // A SINGER WHO IS OUT OF SYLLABLES DOES NOT GO QUIET — they run the extra
      // notes on the vowel they are already on. That is melisma, and it is the
      // most characteristic thing a voice does that no instrument can; dropping
      // those notes instead is what made the sung part a skeleton. So keep
      // every note, and mark the ones past the syllable budget as belonging to
      // the syllable before them. A run-on note has no consonant behind it and
      // so no fresh attack, which is why it is the softer of the two.
      const own = e.strong || e.last || !sung.length
        || hash32(seed, "syl", Math.round(e.b * 96)) % 1000 < share * 1000;
      sung.push({ ...e, role: "voice", inst: -1, melisma: !own,
        vel: e.vel * (own ? 1 : 0.86),
        b: e.b + Math.min(vlag, e.dur * 0.25) });
    }
    // ── 4. AND A SUNG NOTE LASTS UNTIL THE NEXT ONE. A phrase is one breath
    // and the voicing runs right through it; only the last note is released.
    // The old block multiplied each duration by 1.35 instead — a number the
    // renderer never read, because `fireVoiceLine` already lengthens each note
    // to where the next one starts. All it did was hold every sung note a
    // third of the way into the note after it in everything that reads the
    // composer's own output, which is the longest-lasting collision there is
    // and exactly what the heterophony loop above refuses to write.
    sung.forEach((e, i) => {
      const nx = sung[i + 1];
      if (nx) e.dur = Math.max(e.dur * 0.5, nx.b - e.b);
      ev.push(e);
    });
  }
  // and whatever thinness the seats could not absorb comes out of the hands of
  // the players who stayed — see `hush` above. This is what turns the section
  // arc from a switch into a ramp, and it is the only reason a small ensemble
  // can have a quiet section at all without losing half its music.
  if (hush < 1) for (const e of ev) e.vel *= hush;
  return { events: ev, beats, tempo, grid: G, phrase: order[bar % order.length],
    section: S.sec.label, dens: S.sec.dens, seats, roster: roster.length, hush };
}

/**
 * A whole piece: the same generator, run over the section plan instead of
 * looping. `syls` (optional) is a line of the people's own language, sung one
 * syllable per note.
 */
export function composePiece(music, occKey = "peace", syls = null, intimacy = 1) {
  const secs = sectionsOf(music, occKey);
  const sections = [];
  let beat = 0, cycle = 0, sylAt = 0;
  for (const sec of secs) {
    const start = beat;
    const ev = [];
    for (let c = 0; c < sec.cycles; c++) {
      // HOW CLOSE THE LISTENER IS STANDING, which this function used to assert
      // was the front row and nothing else. The looping path has honoured the
      // distance control all along — `ambientBar` takes it, and who is audible,
      // how many players turn up and whether there is any singing all follow
      // from it — so a whole piece ignoring it meant the one thing you cannot
      // hear from across a settlement was the only thing the piece would play.
      const plan = ambientBar(music, { occ: occKey, intimacy, bar: cycle });
      for (const e of plan.events) {
        const o = { ...e, b: beat + e.b };
        // A MELISMA IS SEVERAL NOTES ON ONE SYLLABLE. `ambientBar` marks the
        // notes the singer took past their syllable budget; those carry the
        // syllable already sounding rather than claiming the next one, which
        // is the whole difference between a run and a patter song.
        if (o.role === "voice" && syls && syls.length) {
          o.syl = syls[sylAt % syls.length];
          if (!o.melisma) sylAt++;
        }
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
  const R = music.rhythm, O = occasionFor(music, occKey);
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
