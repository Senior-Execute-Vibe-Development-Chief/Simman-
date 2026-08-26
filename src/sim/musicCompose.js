// ── Composition: turning a people's music into notes ─────────────────────
//
// Two renderers over one derivation (musicGenome.js):
//
//   ambientBar()  — the tone-setting layer. Continuous, never looping,
//                   generated a cycle at a time so it can run forever under
//                   whatever the viewer is looking at. `intimacy` is the
//                   zoom: far away you hear the bed, up close you hear the
//                   players.
//   composePiece() — a whole piece for an occasion, with real sections. Its
//                   form comes from the people's literacy: an oral tradition
//                   returns to its formula, a written one develops away
//                   from it.
//
// The OCCASION is the one input that comes from outside the culture: what is
// happening to them right now. In the world sim these are all live state —
// war level, food balance, offerings at a holy see, a coronation — which is
// what would make the ambient layer quietly informative rather than merely
// atmospheric. Here the Lab supplies it directly.
import { hash32 } from "./peopleSim/rng.js";
import { nPVI } from "./musicGenome.js";

export const OCCASIONS = {
  peace:    { label: "everyday",  tempo: 1,    density: 1,    reg: 0,    perc: 0.5,  orn: 1,    drone: 0.6, descent: 1,    lead: null },
  rite:     { label: "rite",      tempo: 0.72, density: 0.68, reg: 0,    perc: 0.22, orn: 1.35, drone: 1,   descent: 1.05, lead: "sustain" },
  war:      { label: "war",       tempo: 1.32, density: 1.18, reg: -1,   perc: 1,    orn: 0.5,  drone: 0.5, descent: 0.85, lead: "loud" },
  mourning: { label: "mourning",  tempo: 0.62, density: 0.55, reg: -0.4, perc: 0.14, orn: 1.15, drone: 0.9, descent: 1.35, lead: "sustain" },
  festival: { label: "festival",  tempo: 1.22, density: 1.35, reg: 0.3,  perc: 1,    orn: 0.95, drone: 0.4, descent: 0.95, lead: null },
  work:     { label: "work",      tempo: 0.96, density: 1.05, reg: 0,    perc: 0.85, orn: 0.7,  drone: 0.35, descent: 1,   lead: null },
};

/** Assign instruments to roles. Which body leads is an occasion question —
 *  a war band does not lead with the softest thing it owns. */
export function ensembleFor(music, occKey, intimacy = 1) {
  const occ = OCCASIONS[occKey] || OCCASIONS.peace;
  const insts = music.insts;
  const idx = (pred) => { const i = insts.findIndex(pred); return i < 0 ? null : i; };
  const loud = idx(i => i.fam === "horn" || i.fam === "reedPipe" || i.fam === "gong");
  const sustain = idx(i => i.kind === "sustain");
  // who can actually carry a tune: a natural horn is loud and prestigious but
  // has six notes, so it leads fanfares, not melodies. Rank by how much of the
  // scale a body can reach, then by how central it is.
  const melodic = insts.map((i, k) => ({ i, k })).filter(o => o.i.cap >= 3)
    .sort((a, b) => (b.i.cap * (0.5 + b.i.weight)) - (a.i.cap * (0.5 + a.i.weight)));
  let lead = occ.lead === "loud" && loud != null ? loud
    : occ.lead === "sustain" && sustain != null ? sustain
    : melodic.length ? melodic[0].k : 0;
  const droneI = insts.findIndex((i, k) => k !== lead && (i.kind === "sustain" || i.partials[0].d > 3));
  const pulse = idx(i => i.fam === "drum" || i.fam === "frameDrum");
  const second = melodic.find(o => o.k !== lead)?.k ?? null;
  // how many lines are actually audible: the ensemble, thinned by distance
  const voices = Math.max(1, Math.round(music.texture.size * (0.35 + 0.65 * intimacy)));
  return { lead, drone: droneI < 0 ? null : droneI, pulse, second, voices, occ };
}

/** Frequency of a scale degree. `oct` counts FRAME repetitions — which is
 *  not always an octave, and that is the point. */
export function degreeHz(music, tonicHz, deg, oct = 0) {
  const d = music.scale.degrees;
  const n = d.length;
  let i = ((deg % n) + n) % n;
  const wrap = Math.floor(deg / n);
  return tonicHz * Math.pow(music.scale.frame.ratio, oct + wrap) * d[i].ratio;
}

// ── the melodic line ─────────────────────────────────────────────────────
// A phrase is a walk over the scale that (a) prefers steps to leaps by the
// culture's own `step` habit, (b) drifts downward because breath pressure
// falls, and (c) lands on a structural degree — the ones the roughness curve
// itself ranked most consonant.
function phrase(music, seedBase, nNotes, startDeg, descent) {
  const M = music.melody, S = music.scale.degrees.length;
  const roll = (i, t) => hash32(seedBase >>> 0, i, t) / 4294967296;
  const out = [];
  let deg = startDeg;
  for (let i = 0; i < nNotes; i++) {
    const frac = i / Math.max(1, nNotes - 1);
    const stepwise = roll(i, "s") < M.step;
    let mv = stepwise ? 1 + (roll(i, "s2") < 0.22 ? 1 : 0) : 2 + Math.floor(roll(i, "l") * 3);
    // declination: the further into the phrase, the more likely down
    const down = roll(i, "d") < 0.5 + descent * 0.45 * frac;
    deg += down ? -mv : mv;
    // keep inside the compass, folding back rather than clipping flat
    if (deg > M.range) deg -= S;
    if (deg < -Math.round(M.range * 0.55)) deg += S;
    out.push(deg);
  }
  // cadence: the last note falls to the nearest structural degree
  const last = out.length - 1;
  const octOf = Math.floor(out[last] / S);
  const cand = M.structural.map(d => d + octOf * S);
  out[last] = cand.reduce((a, b) => (Math.abs(b - out[last]) < Math.abs(a - out[last]) ? b : a), cand[0]);
  return out;
}

/** Note durations for one cycle: the rhythm class decides how uneven they are. */
function cycleDurs(rhythm, seedBase, beats, density) {
  const roll = (i, t) => hash32(seedBase >>> 0, i, t) / 4294967296;
  const durs = [];
  let filled = 0, i = 0;
  const unit = rhythm.cls === "syllable" ? 0.5 : 1;
  while (filled < beats - 1e-6 && i < 64) {
    const dense = roll(i, "n") < density;
    let d = dense ? unit * (roll(i, "d") < 0.62 ? 1 : 0.5) : unit * (1 + Math.floor(roll(i, "l") * 2));
    // stress-timed traditions pair a long against a short; syllable-timed
    // ones keep the units level (this is the durational-variability
    // signature the Lab measures back out as nPVI)
    if (rhythm.swing > 0 && durs.length % 2 === 0) d *= 1 + rhythm.swing;
    else if (rhythm.swing > 0) d *= 1 - rhythm.swing * 0.7;
    d = Math.min(d, beats - filled);
    durs.push(d); filled += d; i++;
  }
  return durs;
}

/**
 * One cycle of ambience. Returns events in BEATS from the cycle start, so a
 * scheduler can keep asking for the next one forever.
 */
export function ambientBar(music, { occ = "peace", intimacy = 1, bar = 0, seed = 0 } = {}) {
  const E = ensembleFor(music, occ, intimacy);
  const O = E.occ, R = music.rhythm;
  const beats = R.beats;
  const base = hash32(music.people.seed, seed >>> 0, bar);
  const roll = (t) => hash32(base, "a", t) / 4294967296;
  const ev = [];

  // the bed: a held pedal on a structural degree. Present whenever the
  // texture supports more than one line at all.
  if (E.drone != null && music.texture.kind !== "monophony" && roll("dr") < O.drone) {
    ev.push({ b: 0, dur: beats, inst: E.drone, deg: 0, oct: -1, vel: 0.3 * (0.55 + 0.45 * intimacy), role: "drone" });
  }
  // the pulse: only ever as loud as the occasion wants, and thinned by distance
  if (E.pulse != null && roll("pc") < O.perc * (0.4 + 0.6 * intimacy)) {
    const hits = R.meterKind === "additive" ? [0, Math.floor(beats / 2), beats - 1] : [0, Math.floor(beats / 2)];
    for (const h of hits) {
      ev.push({ b: h, dur: 0.5, inst: E.pulse, deg: 0, oct: -1, vel: (h === 0 ? 0.55 : 0.34) * O.perc, role: "pulse" });
      if (R.syncopation > 0.25 && roll("sy" + h) < R.syncopation) {
        ev.push({ b: h + 0.5, dur: 0.4, inst: E.pulse, deg: 0, oct: -1, vel: 0.24 * O.perc, role: "pulse" });
      }
    }
  }
  // the line: sparse when far away, a real phrase when close
  const speak = roll("sp") < 0.45 + 0.5 * intimacy;
  if (speak) {
    const durs = cycleDurs(R, base + 1, beats, R.density * O.density * (0.5 + 0.5 * intimacy));
    const degs = phrase(music, base + 2, durs.length, music.melody.structural[bar % music.melody.structural.length] || 0,
      music.melody.descent * O.descent);
    let t = 0;
    durs.forEach((d, i) => {
      ev.push({
        b: t, dur: d * 0.92, inst: E.lead, deg: degs[i], oct: Math.round(O.reg * 0.5), role: "lead",
        vel: (0.34 + (i === 0 ? 0.12 : 0)) * (0.6 + 0.4 * intimacy),
        orn: music.texture.ornament * O.orn > 0.55 && i % 2 === 1,
      });
      t += d;
    });
    // heterophony: a second player on the same line, loosely — the same
    // melody, not a different one, which is what heterophony IS
    if (music.texture.kind !== "monophony" && E.second != null && E.voices >= 3 && roll("het") < 0.6) {
      let t2 = 0;
      durs.forEach((d, i) => {
        if (i % 2 === 0) ev.push({ b: t2 + 0.06, dur: d * 0.8, inst: E.second, deg: degs[i], oct: Math.round(O.reg * 0.5), vel: 0.2 * intimacy, role: "het" });
        t2 += d;
      });
    }
  }
  return { events: ev, beats, tempo: Math.round(R.tempo * O.tempo) };
}

// ── whole pieces ─────────────────────────────────────────────────────────
/**
 * A piece for an occasion. An oral tradition states a formula and returns to
 * it; a literate one states it and goes somewhere. `syls` (optional) is a
 * line of the people's OWN language to be sung — one syllable per note of
 * the vocal line.
 */
export function composePiece(music, occKey = "peace", syls = null) {
  const F = music.form, R = music.rhythm, E = ensembleFor(music, occKey, 1);
  const O = E.occ;
  const seed0 = hash32(music.people.seed, "piece", occKey);
  const sections = [];
  let beat = 0;
  // the motif: one phrase, stated first, that everything after refers to
  const motif = phrase(music, seed0, R.beats, 0, music.melody.descent * O.descent);
  for (let s = 0; s < F.sections; s++) {
    const label = s === 0 ? "statement" : s === F.sections - 1 ? (F.repetition > 0.5 ? "return" : "close") : `variation ${s}`;
    const ev = [];
    const secSeed = hash32(seed0, s);
    for (let p = 0; p < F.phrasePerSection; p++) {
      const pSeed = hash32(secSeed, p);
      const durs = cycleDurs(R, pSeed, R.beats, R.density * O.density);
      // how far this phrase departs from the motif: literacy buys development
      const dev = s === 0 ? 0 : Math.min(1, F.development * (s / Math.max(1, F.sections - 1)) + (label === "return" ? -F.repetition : 0));
      const fresh = phrase(music, pSeed + 5, durs.length, motif[0], music.melody.descent * O.descent);
      const degs = durs.map((_, i) =>
        dev <= 0.02 ? motif[i % motif.length]
        : hash32(pSeed, i, "mix") / 4294967296 < dev ? fresh[i]
        : motif[i % motif.length] + (dev > 0.5 ? 1 : 0));
      let t = beat;
      durs.forEach((d, i) => {
        ev.push({
          b: t, dur: d * 0.94, inst: E.lead, deg: degs[i], oct: Math.round(O.reg * 0.5), role: "lead",
          vel: 0.38 * (p === 0 ? 1.1 : 1),
          orn: music.texture.ornament * O.orn > 0.55 && i % 3 === 2,
        });
        t += d;
      });
      // the sung line rides the same phrase, one syllable per note
      if (syls && syls.length) {
        let ts = beat;
        durs.forEach((d, i) => {
          ev.push({ b: ts, dur: d * 0.9, inst: -1, deg: degs[i], oct: Math.round(O.reg * 0.5) - (music.melody.breathBound ? 0 : 1),
            vel: 0.4, role: "voice", syl: syls[(p * durs.length + i) % syls.length] });
          ts += d;
        });
      }
      if (E.drone != null && O.drone > 0.4) {
        ev.push({ b: beat, dur: R.beats, inst: E.drone, deg: 0, oct: -1, vel: 0.26, role: "drone" });
      }
      if (E.pulse != null && O.perc > 0.2) {
        for (let k = 0; k < R.beats; k += R.meterKind === "compound" ? 3 : 2) {
          ev.push({ b: beat + k, dur: 0.5, inst: E.pulse, deg: 0, oct: -1, vel: (k === 0 ? 0.5 : 0.3) * O.perc, role: "pulse" });
        }
      }
      beat += R.beats;
    }
    sections.push({ label, events: ev, startBeat: beat - F.phrasePerSection * R.beats, beats: F.phrasePerSection * R.beats });
  }
  const all = sections.flatMap(s => s.events);
  const leadDurs = all.filter(e => e.role === "lead").map(e => e.dur);
  return {
    sections, events: all, totalBeats: beat, tempo: Math.round(R.tempo * O.tempo),
    occ: occKey, nPVI: nPVI(leadDurs), motif,
  };
}

/** The nPVI a SPEAKER of this language produces — the number the music's own
 *  nPVI should track. Both are measured the same way, so the Lab can show
 *  the correspondence instead of asserting it. */
export function speechNPVI(music) {
  const R = music.rhythm;
  // exactly the durations the speech engine schedules (langLab scheduleWord /
  // vocalTract scoreWord): syllable- and even-timed tongues give every
  // syllable the same length; a stress-timed one lengthens the stressed one
  // and squeezes the rest. Measuring the same quantity on both sides is what
  // makes the speech↔music comparison mean anything.
  const durs = [];
  for (let i = 0; i < 24; i++) {
    const base = R.cls === "syllable" ? 0.165
      : R.cls === "even" ? 0.15
      : i % 3 === 0 ? 0.2 : 0.12;
    durs.push(base * (1 + (hash32(music.people.seed, "sp", i) / 4294967296 - 0.5) * 0.12));
  }
  return nPVI(durs);
}
