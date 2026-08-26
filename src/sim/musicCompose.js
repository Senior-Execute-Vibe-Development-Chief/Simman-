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
  peace:    { label: "everyday",  bright: 1,  tempo: 1.06, density: 1.15, reg: 0.35, perc: 0.7,  orn: 0.7,  drone: 0.4,  descent: 0.8,  artic: 0.7,  lead: null },
  rite:     { label: "rite",      bright: -1, tempo: 0.74, density: 0.8,  reg: 0,    perc: 0.3,  orn: 1.2,  drone: 1,    descent: 1.05, artic: 0.97, lead: "sustain" },
  war:      { label: "war",       bright: 0,  tempo: 1.3,  density: 1.15, reg: -0.6, perc: 1,    orn: 0.3,  drone: 0.5,  descent: 0.85, artic: 0.6,  lead: "loud" },
  mourning: { label: "mourning",  bright: -1, tempo: 0.64, density: 0.62,  reg: -0.4, perc: 0.16, orn: 1,    drone: 0.9,  descent: 1.35, artic: 1,    lead: "sustain" },
  festival: { label: "festival",  bright: 1,  tempo: 1.22, density: 1.3,  reg: 0.5,  perc: 1,    orn: 0.7,  drone: 0.35, descent: 0.85, artic: 0.62, lead: null },
  work:     { label: "work",      bright: 1,  tempo: 1,    density: 1.2, reg: 0.2,  perc: 0.9,  orn: 0.4,  drone: 0.35, descent: 0.95, artic: 0.66, lead: null },
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

/** Choose which slots carry an onset. Strong slots fill first; density says
 *  how far down the metrical hierarchy the tradition goes. */
function makePattern(music, seed, density, syncopation) {
  const G = gridOf(music.rhythm);
  const roll = (i, t) => hash32(seed >>> 0, i, t) / 4294967296;
  const on = [0];
  for (let s = 1; s < G.slots; s++) {
    const weak = G.w[s] < 0.5;
    let p = density * (G.w[s] >= 1 ? 1.1 : G.w[s] >= 0.5 ? 0.92 : 0.42);
    if (weak) p *= 0.5 + syncopation;      // pushing against the beat is a habit, not noise
    if (roll(s, "o") < p) on.push(s);
  }
  return { grid: G, onsets: on };
}

// ── the melodic line ─────────────────────────────────────────────────────
// A phrase is a walk over the MODE that arches away from where it started and
// comes back to land on a structural degree.
function phrase(music, seedBase, nNotes, startDeg, descent) {
  const M = music.melody, S = music.mode.size;
  const roll = (i, t) => hash32(seedBase >>> 0, i, t) / 4294967296;
  const out = [];
  let deg = startDeg;
  for (let i = 0; i < nNotes; i++) {
    if (i > 0) {
      const frac = i / Math.max(1, nNotes - 1);
      const stepwise = roll(i, "s") < M.step;
      const mv = stepwise ? 1 : 2 + (roll(i, "l") < 0.25 ? 1 : 0);
      // A phrase ARCHES: it rises away from where it started and comes back
      // down to land — what a breath does, pressure building then falling.
      // Declination tilts the whole arch downward by as much as the occasion
      // wants (the same fall the speech engine applies to f0).
      const pUp = 0.5 + M.arch * (0.55 - frac) * 1.7 - descent * 0.3 * frac;
      const down = roll(i, "d") >= Math.max(0.12, Math.min(0.9, pUp));
      deg += down ? -mv : mv;
      if (deg > M.reach) deg -= S;
      if (deg < -Math.round(M.reach * 0.34)) deg += S;
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
  const bank = [];
  for (let k = 0; k < 3; k++) {
    const seed = hash32(music.people.seed, "ph", occKey, k);
    const pat = makePattern(music, seed, Math.min(0.95, R.density * O.density), R.syncopation);
    // an answering phrase starts elsewhere in the SAME register — a contrast
    // of shape, not of octave
    const start = k === 0 ? 0 : (music.melody.structural[k % music.melody.structural.length] || 0) % music.mode.size;
    const degs = phrase(music, seed + 1, pat.onsets.length, start, music.melody.descent * O.descent);
    bank.push({ pat, degs, fin });
  }
  music[key] = bank;
  return bank;
}
/** Statement, repeat, answer, return — fixed, so the ear can follow it. */
const FORM_ORDER = [0, 0, 1, 0, 0, 2, 1, 0];

/** The timekeeper's pattern: the SAME every cycle, because that is what a
 *  beat is. It states the metrical hierarchy — group heads hard, beats
 *  lighter — plus whatever fixed offbeat this tradition habitually pushes. */
function pulsePattern(music, occKey) {
  const key = "_pulse:" + occKey;
  if (music[key]) return music[key];
  const G = gridOf(music.rhythm), R = music.rhythm;
  const out = [];
  for (let s = 0; s < G.slots; s++) {
    if (G.w[s] >= 1) out.push({ s, vel: 0.6 });
    else if (G.w[s] >= 0.5) out.push({ s, vel: 0.3 });
  }
  if (R.syncopation > 0.28) {
    const s = hash32(music.people.seed, "syn") % G.slots;
    if (G.w[s] < 0.5) out.push({ s, vel: 0.26 });
  }
  music[key] = out.sort((a, b) => a.s - b.s);
  return music[key];
}

/** Assign instruments to roles. Which body leads is an occasion question — a
 *  war band does not lead with the softest thing it owns. */
export function ensembleFor(music, occKey, intimacy = 1) {
  const occ = OCCASIONS[occKey] || OCCASIONS.peace;
  const insts = music.insts;
  const idx = (pred) => { const i = insts.findIndex(pred); return i < 0 ? null : i; };
  const loud = idx(i => i.fam === "horn" || i.fam === "reedPipe" || i.fam === "gong");
  const sustain = idx(i => i.kind === "sustain");
  // who can actually carry a tune: a natural horn is loud and prestigious but
  // has six notes, so it leads fanfares, not melodies
  const melodic = insts.map((i, k) => ({ i, k })).filter(o => o.i.cap >= 3)
    .sort((a, b) => (b.i.cap * (0.5 + b.i.weight)) - (a.i.cap * (0.5 + a.i.weight)));
  const lead = occ.lead === "loud" && loud != null ? loud
    : occ.lead === "sustain" && sustain != null ? sustain
    : melodic.length ? melodic[0].k : 0;
  const droneI = insts.findIndex((i, k) => k !== lead && (i.kind === "sustain" || i.partials[0].d > 3));
  const pulse = idx(i => i.fam === "drum" || i.fam === "frameDrum");
  const second = melodic.find(o => o.k !== lead)?.k ?? null;
  const voices = Math.max(1, Math.round(music.texture.size * (0.35 + 0.65 * intimacy)));
  return { lead, drone: droneI < 0 ? null : droneI, pulse, second, voices, occ };
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
    const e = {
      b: at + b, dur: span * O.artic, inst, mi, deg: modeDegree(music, mi + fin), oct, role,
      vel: vel * (strong ? 1.15 : G.w[s] >= 0.5 ? 1 : 0.82) * (0.65 + 0.35 * intimacy),
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
  const roll = (t) => hash32(music.people.seed, seed >>> 0, bar, t) / 4294967296;
  const ev = [];

  // the bed: a held pedal on the final
  if (E.drone != null && music.texture.kind !== "monophony" && roll("dr") < O.drone) {
    ev.push({ b: 0, dur: G.beats, inst: E.drone, deg: modeDegree(music, fin), oct: -1,
      vel: 0.26 * (0.55 + 0.45 * intimacy), role: "drone" });
  }
  // the pulse: the same pattern every cycle, thinned by distance
  if (E.pulse != null && O.perc > 0.15) {
    const audible = O.perc * (0.5 + 0.5 * intimacy);
    for (const h of pulsePattern(music, occ)) {
      ev.push({ b: slotBeat(G, h.s, R.swing), dur: 0.4, inst: E.pulse, deg: 0, oct: -1,
        vel: h.vel * audible, role: "pulse" });
    }
  }
  // the line
  ev.push(...layPhrase(music, ph, O, {
    inst: E.lead, intimacy, oct: Math.round(O.reg),
    orn: music.texture.ornament * O.orn > 0.5,
  }));
  // heterophony: a second player on the SAME line, sparser — the same melody
  // taken plainly, which is what heterophony is. On the grid, never a flam.
  if (music.texture.kind !== "monophony" && E.second != null && E.voices >= 3) {
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
      if (E.drone != null && O.drone > 0.4) {
        ev.push({ b: beat, dur: G.beats, inst: E.drone, deg: modeDegree(music, fin), oct: -1, vel: 0.24, role: "drone" });
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
