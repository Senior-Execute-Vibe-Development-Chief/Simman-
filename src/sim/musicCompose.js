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
function makePattern(music, seed, density, syncopation) {
  const G = gridOf(music.rhythm);
  const roll = (t) => hash32(seed >>> 0, t) / 4294967296;
  const on = new Set();
  let acc = 0;
  for (const g of G.groups) { on.add(acc * G.div); acc += g; }   // every downbeat
  // the rest, spread as evenly as possible
  const want = Math.max(1, Math.round(G.slots * Math.min(0.85, density * 0.55)));
  const e = euclid(want, G.slots);
  const rot = Math.floor(roll("rot") * G.slots);
  for (let s = 0; s < G.slots; s++) if (e[(s + rot) % G.slots]) on.add(s);
  // a tradition that pushes against the beat keeps one fixed offbeat; one that
  // does not, drops the weakest slots it happened to land on
  if (syncopation < 0.25) for (const s of [...on]) if (G.w[s] < 0.5 && roll("d" + s) > syncopation * 3) on.delete(s);
  acc = 0;
  for (const g of G.groups) { on.add(acc * G.div); acc += g; }   // …and again, so nothing dropped a downbeat
  return { grid: G, onsets: [...on].sort((a, b) => a - b) };
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
  // Cadence: the last note falls to the nearest structural degree of the
  // mode — nearest in the register it is already in, considering the frame
  // below and above as well, or the line ends by leaping an octave to a note
  // it never approached.
  const last = out.length - 1, here = out[last];
  const octOf = Math.floor(here / S);
  const cand = [];
  for (const o of [octOf - 1, octOf, octOf + 1]) for (const d of M.structural) cand.push(d + o * S);
  const within = cand.filter(c => c <= M.reach && c >= -Math.round(M.reach * 0.34));
  const pool = within.length ? within : cand;
  out[last] = pool.reduce((a, b) => (Math.abs(b - here) < Math.abs(a - here) ? b : a), pool[0]);
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
  const R = music.rhythm;
  // ONE motif, on one rhythm. Everything else in the bank is that motif
  // turned over — so the second phrase answers the first instead of merely
  // following it.
  const seed = hash32(music.people.seed, "ph", occKey);
  const pat = makePattern(music, seed, Math.min(0.95, R.density * O.density), R.syncopation);
  const motif = phrase(music, seed + 1, pat.onsets.length, 0, music.melody.descent * O.descent);
  const strong = pat.onsets.map(s => pat.grid.w[s] >= 1);
  const alt = phrase(music, seed + 2, pat.onsets.length, 0, music.melody.descent * O.descent);
  const ops = transformsFor(music.people.soc.literacy);
  const bank = [{ pat, degs: motif, fin, label: "motif" }];
  for (let k = 1; k < 3; k++) {
    const op = ops[hash32(seed, "op", k) % ops.length];
    const M = music.melody, lo = -Math.round(M.reach * 0.34);
    // Transpose by what the compass actually has room for, in whichever
    // direction has room — picking an amount first and clamping afterwards
    // just undoes the transposition on any motif that already reaches the top.
    const head = M.reach - Math.max(...motif), foot = Math.min(...motif) - lo;
    const amt = head >= 1 ? Math.min(head, 1 + (hash32(seed, "amt", k) % 2))
      : foot >= 1 ? -Math.min(foot, 1 + (hash32(seed, "amt", k) % 2)) : 0;
    let degs = TRANSFORMS[op](motif, amt, alt, strong);
    const hi = Math.max(...degs), low = Math.min(...degs);
    const shift = hi > M.reach ? M.reach - hi : low < lo ? lo - low : 0;
    if (shift) degs = degs.map(d => d + shift);
    // however far it wanders, it comes home: the last note is still a
    // structural degree, so the phrase still sounds finished
    degs[degs.length - 1] = motif[motif.length - 1];
    bank.push({ pat, degs, fin, label: op });
  }
  music[key] = bank;
  return bank;
}
/** Statement, repeat, answer, return — fixed, so the ear can follow it. */
const FORM_ORDER = [0, 0, 1, 0, 0, 2, 1, 0];

/**
 * The BASS: one note per group head, on the mode's stable degrees, an octave
 * or so under everything else. Every rule-based composer that sounds like
 * music has one, and its absence is why a melody-over-a-drone reads as thin
 * and unanchored — the drone says where home is but never moves, so nothing
 * ever confirms or contradicts it. A bass that steps between stable tones
 * gives the cycle somewhere to go and somewhere to arrive.
 */
function bassLine(music, occKey) {
  const key = "_bass:" + occKey;
  if (music[key]) return music[key];
  const G = gridOf(music.rhythm), fin = finalFor(music, occKey);
  const stable = music.melody.structural;
  const out = [];
  let acc = 0, k = 0;
  for (const g of G.groups) {
    // home on the first group, a stable neighbour after — the simplest true
    // harmonic motion there is
    const deg = k === 0 ? 0 : stable[(k + hash32(music.people.seed, "b", k)) % stable.length] || 0;
    out.push({ s: acc * G.div, beats: g, deg: modeDegree(music, deg + fin) });
    acc += g; k++;
  }
  music[key] = out;
  return out;
}

/**
 * The OSTINATO: a short pitched figure that repeats every cycle. In cyclic
 * traditions this is the organising layer — the part everything else is heard
 * against (the Shona kushaura under its kutsinhira, the timeline under the
 * drums). It is also what makes repetition legible: a listener who has heard
 * the figure twice knows where they are in the cycle.
 */
function ostinato(music, occKey) {
  const key = "_ost:" + occKey;
  if (music[key]) return music[key];
  const G = gridOf(music.rhythm), fin = finalFor(music, occKey);
  const stable = music.melody.structural;
  const n = Math.min(4, Math.max(2, Math.round(G.beats / 2)));
  const e = euclid(n, G.slots);
  const out = [];
  let j = 0;
  for (let s = 0; s < G.slots; s++) {
    if (!e[s]) continue;
    const deg = stable[(j + hash32(music.people.seed, "os", j)) % stable.length] || 0;
    out.push({ s, deg: modeDegree(music, deg + fin) });
    j++;
  }
  music[key] = out;
  return out;
}

/** The timekeeper's pattern: the SAME every cycle, because that is what a
 *  beat is. It states the metrical hierarchy — group heads hard, beats
 *  lighter — plus whatever fixed offbeat this tradition habitually pushes. */
function pulsePattern(music, occKey) {
  const key = "_pulse:" + occKey;
  if (music[key]) return music[key];
  const G = gridOf(music.rhythm), R = music.rhythm;
  const out = [];
  // downbeats always, hard — the tap
  let acc = 0;
  for (const g of G.groups) { out.push({ s: acc * G.div, vel: 0.42 }); acc += g; }
  // the TIMELINE proper: a maximally-even Euclidean pattern over the cycle,
  // which is the form the world's bell patterns and claves actually take
  const k = Math.max(2, Math.round(G.beats * (0.45 + R.syncopation * 0.7)));
  const e = euclid(k, G.slots);
  const rot = hash32(music.people.seed, "tl") % G.slots;
  for (let s = 0; s < G.slots; s++) {
    if (!e[(s + rot) % G.slots]) continue;
    if (out.some(h => h.s === s)) continue;
    out.push({ s, vel: G.w[s] >= 0.5 ? 0.22 : 0.16 });
  }
  music[key] = out.sort((a, b) => a.s - b.s);
  return music[key];
}

/** Assign instruments to roles. Which body leads is an occasion question — a
 *  war band does not lead with the softest thing it owns. */
// A gong or a big bell is not a part. Its modes are inharmonic AND long —
// a bell's tierce and quint ring for seconds, which is what a bell is for —
// so a line played on one turns into a standing cloud that fights every note
// after it. What such an instrument does in every tradition that has one is
// MARK: a single stroke at the head of the cycle, giving the form its
// punctuation and letting the ring be the point instead of an accident.
const MARKERS = new Set(["gong", "bell"]);

export function ensembleFor(music, occKey, intimacy = 1) {
  const occ = OCCASIONS[occKey] || OCCASIONS.peace;
  const insts = music.insts;
  const idx = (pred) => { const i = insts.findIndex(pred); return i < 0 ? null : i; };
  const partable = (i) => !MARKERS.has(i.fam);
  const loud = idx(i => i.fam === "horn" || i.fam === "reedPipe");
  const sustain = idx(i => i.kind === "sustain" && partable(i));
  const marker = idx(i => MARKERS.has(i.fam));
  // who can actually carry a tune: a natural horn is loud and prestigious but
  // has six notes, so it leads fanfares, not melodies
  const melodic = insts.map((i, k) => ({ i, k })).filter(o => o.i.cap >= 5 && partable(o.i))
    .sort((a, b) => (b.i.cap * (0.5 + b.i.weight)) - (a.i.cap * (0.5 + a.i.weight)));
  const lead = occ.lead === "loud" && loud != null ? loud
    : occ.lead === "sustain" && sustain != null ? sustain
    : melodic.length ? melodic[0].k : 0;
  const droneI = insts.findIndex((i, k) => k !== lead && partable(i) && (i.kind === "sustain" || i.partials[0].d > 3));
  const pulse = idx(i => i.fam === "drum" || i.fam === "frameDrum");
  const second = melodic.find(o => o.k !== lead)?.k ?? null;
  const voices = Math.max(1, Math.round(music.texture.size * (0.35 + 0.65 * intimacy)));
  // the bass wants a body that speaks low and holds; the ostinato wants one
  // that can repeat a figure cleanly — a plucked or struck body, not a
  // sustaining one that would smear it
  const bass = insts.findIndex((i, k) => k !== lead && partable(i) && (i.kind === "sustain" || i.partials[0].d > 1.5));
  const ost = insts.findIndex((i, k) => k !== lead && k !== bass && i.cap >= 3 && i.kind !== "sustain" && partable(i));
  return { lead, drone: droneI < 0 ? null : droneI, pulse, second, voices, occ,
    marker, bass: bass < 0 ? null : bass, ost: ost < 0 ? (second ?? null) : ost };
}

/** Frequency of a scale degree. `oct` counts FRAME repetitions — which is not
 *  always an octave, and that is the point. */
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
  const { at = 0, inst, vel = 0.36, intimacy = 1, role = "lead", oct = 0, syls = null, sylFrom = 0 } = opts;
  const ev = [];
  pat.onsets.forEach((s, i) => {
    const b = slotBeat(G, s, R.swing);
    const nextB = i + 1 < pat.onsets.length ? slotBeat(G, pat.onsets[i + 1], R.swing) : G.beats;
    const span = Math.max(0.12, nextB - b);
    const strong = G.w[s] >= 1;
    const mi = degs[i];
    const last = i === pat.onsets.length - 1;
    // A phrase LANDS. Its final note is held — that is what makes it sound
    // finished rather than merely stopped — and everything else runs close to
    // the next onset so the line is legato rather than a row of blips.
    const len = last ? span * 1.9 : span * O.artic;
    const e = {
      b: at + b, dur: len, inst, mi, deg: modeDegree(music, mi + fin), oct, role,
      // the melody is the thing being listened to, so it sits on top of the
      // texture the other layers make
      vel: vel * 1.25 * (strong ? 1.15 : G.w[s] >= 0.5 ? 1 : 0.82) * (0.65 + 0.35 * intimacy),
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
export function ambientBar(music, { occ = "peace", intimacy = 1, bar = 0, seed = 0 } = {}) {
  const E = ensembleFor(music, occ, intimacy);
  const O = E.occ, R = music.rhythm;
  const G = gridOf(R);
  const bank = phraseBank(music, occ);
  const ph = bank[FORM_ORDER[bar % FORM_ORDER.length]];
  const fin = finalFor(music, occ);
  const ev = [];

  // the pulse: the same pattern every cycle, thinned by distance
  if (E.pulse != null && O.perc > 0.15) {
    const audible = O.perc * (0.5 + 0.5 * intimacy);
    for (const h of pulsePattern(music, occ)) {
      ev.push({ b: slotBeat(G, h.s, R.swing), dur: 0.4, inst: E.pulse, deg: 0, oct: -1,
        vel: h.vel * audible, role: "pulse" });
    }
  }
  // the marker: one stroke at the head of the cycle, left to ring
  if (E.marker != null && bar % 2 === 0) {
    ev.push({ b: 0, dur: 1.2, inst: E.marker, deg: modeDegree(music, fin), oct: -1,
      vel: 0.3 * (0.5 + 0.5 * intimacy), role: "mark", ring: true });
  }
  // THE PAD. Not a probabilistic drone that is absent two cycles in three:
  // a continuously sounding bed is the defining move of ambient texture, and
  // without one a piece is a row of separate events with silence behind them.
  // Two voices on stable degrees, held past the end of the cycle so the bed
  // never gaps at the seam.
  if (E.drone != null && music.texture.kind !== "monophony") {
    const pads = [0, music.melody.structural[1] ?? 2];
    pads.forEach((d, i) => {
      ev.push({ b: 0, dur: G.beats * 1.18, inst: E.drone, deg: modeDegree(music, d + fin), oct: -1 - (i === 0 ? 1 : 0),
        vel: (0.3 - i * 0.08) * (0.6 + 0.4 * intimacy) * (0.55 + 0.45 * O.drone), role: "pad" });
    });
  }
  // the bass: one note per group head, on stable degrees, under everything
  if (E.bass != null && music.texture.size >= 2 && O.drone > 0.3) {
    for (const b of bassLine(music, occ)) {
      ev.push({ b: slotBeat(G, b.s, R.swing), dur: b.beats * 1.05, inst: E.bass, deg: b.deg, oct: -2,
        vel: 0.32 * (0.6 + 0.4 * intimacy), role: "bass" });
    }
  }
  // the ostinato: the same short figure every cycle, the layer everything
  // else is heard against
  if (E.ost != null && music.texture.size >= 3) {
    for (const o of ostinato(music, occ)) {
      ev.push({ b: slotBeat(G, o.s, R.swing), dur: 0.55, inst: E.ost, deg: o.deg, oct: -1,
        vel: 0.19 * (0.5 + 0.5 * intimacy), role: "ost" });
    }
  }
  // the line
  ev.push(...layPhrase(music, ph, O, {
    inst: E.lead, intimacy, oct: Math.round(O.reg),
    orn: music.texture.ornament * O.orn > 0.5,
  }));
  // heterophony: a second player on the SAME line, sparser — the same melody
  // taken plainly, which is what heterophony is. On the grid, never a flam.
  if (music.texture.kind !== "monophony" && E.second != null && E.voices >= 5 && E.second !== E.ost) {
    const thin = { ...ph, pat: { grid: ph.pat.grid, onsets: ph.pat.onsets.filter(s => ph.pat.grid.w[s] >= 0.5) } };
    thin.degs = thin.pat.onsets.map(s => ph.degs[ph.pat.onsets.indexOf(s)]);
    ev.push(...layPhrase(music, thin, O, { inst: E.second, vel: 0.2, intimacy, oct: Math.round(O.reg), role: "het" }));
  }
  return { events: ev, beats: G.beats, tempo: Math.round(R.tempo * O.tempo), grid: G, phrase: FORM_ORDER[bar % FORM_ORDER.length] };
}

// ── whole pieces ─────────────────────────────────────────────────────────
/**
 * A piece for an occasion. An oral tradition states a formula and returns to
 * it; a literate one states it and goes somewhere. `syls` (optional) is a line
 * of the people's OWN language, sung one syllable per note.
 */
export function composePiece(music, occKey = "peace", syls = null) {
  const F = music.form, R = music.rhythm, E = ensembleFor(music, occKey, 1);
  const O = E.occ, G = gridOf(R), fin = finalFor(music, occKey);
  const bank = phraseBank(music, occKey);
  const sections = [];
  let beat = 0, sylAt = 0;
  for (let s = 0; s < F.sections; s++) {
    const label = s === 0 ? "statement" : s === F.sections - 1 ? (F.repetition > 0.5 ? "return" : "close") : `variation ${s}`;
    const ev = [];
    const start = beat;
    for (let p = 0; p < F.phrasePerSection; p++) {
      // how far this phrase departs from the statement: literacy buys
      // development, memory buys return
      const dev = s === 0 ? 0 : Math.min(1, F.development * (s / Math.max(1, F.sections - 1)) + (label === "return" ? -F.repetition : 0));
      const pick = dev < 0.25 ? 0 : dev < 0.6 ? 1 : 2;
      const ph = bank[pick];
      ev.push(...layPhrase(music, ph, O, {
        at: beat, inst: E.lead, vel: 0.38 * (p === 0 ? 1.1 : 1), oct: Math.round(O.reg),
        orn: music.texture.ornament * O.orn > 0.5,
      }));
      if (syls && syls.length) {
        ev.push(...layPhrase(music, ph, O, {
          at: beat, inst: -1, vel: 0.4, role: "voice", syls, sylFrom: sylAt,
          oct: Math.round(O.reg) - (music.melody.breathBound ? 0 : 1),
        }));
        sylAt += ph.pat.onsets.length;
      }
      if (E.drone != null) {
        ev.push({ b: beat, dur: G.beats * 1.18, inst: E.drone, deg: modeDegree(music, fin), oct: -2, vel: 0.26, role: "pad" });
      }
      if (E.bass != null && music.texture.size >= 2) {
        for (const bl of bassLine(music, occKey)) {
          ev.push({ b: beat + slotBeat(G, bl.s, R.swing), dur: bl.beats * 1.05, inst: E.bass, deg: bl.deg, oct: -2, vel: 0.32, role: "bass" });
        }
      }
      if (E.ost != null && music.texture.size >= 3) {
        for (const o of ostinato(music, occKey)) {
          ev.push({ b: beat + slotBeat(G, o.s, R.swing), dur: 0.55, inst: E.ost, deg: o.deg, oct: -1, vel: 0.19, role: "ost" });
        }
      }
      if (E.pulse != null && O.perc > 0.15) {
        for (const h of pulsePattern(music, occKey)) {
          ev.push({ b: beat + slotBeat(G, h.s, R.swing), dur: 0.4, inst: E.pulse, deg: 0, oct: -1, vel: h.vel * O.perc, role: "pulse" });
        }
      }
      beat += G.beats;
    }
    sections.push({ label, events: ev, startBeat: start, beats: beat - start });
  }
  const all = sections.flatMap(s => s.events);
  const leadDurs = all.filter(e => e.role === "lead").map(e => e.dur);
  return {
    sections, events: all, totalBeats: beat, tempo: Math.round(R.tempo * O.tempo),
    occ: occKey, nPVI: nPVI(leadDurs), grid: G,
  };
}

/** The nPVI a SPEAKER of this language produces — the number the music's own
 *  nPVI should track. Both are measured the same way, so the Lab can show the
 *  correspondence instead of asserting it. */
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
