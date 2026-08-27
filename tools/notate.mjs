#!/usr/bin/env node
// ── Write down what a people actually plays ──────────────────────────────
//
// The engine has never had a way to LOOK at its own melodies. You could hear
// them and you could measure them, but there was no score — so nothing could
// be read, compared, or argued with. This writes one.
//
// Two files per people, which together are the standard way microtonal music
// is exchanged in machine-readable form:
//
//   · an ABC tune, where the note letters are the people's own MODE DEGREES
//     rather than twelve-tone pitches. That is how a gamelan or a maqam is
//     transcribed by hand too: you write the degrees and you state the tuning
//     separately, because the degrees are the thing being sung and the tuning
//     is a property of the instruments.
//   · a Scala tuning file (.scl) giving those degrees in cents. Feed both to
//     any microtonal player and you get back exactly what the engine plays.
//
// Plus a TSV of every note in exact hertz and beats, for anything that would
// rather not parse either.
//
//   node tools/notate.mjs [seed] [occasion]        one people to stdout
//   node tools/notate.mjs --sweep 8 [occasion]     a spread of peoples
//   node tools/notate.mjs --out DIR ...            write files instead
import { mkdirSync, writeFileSync } from "node:fs";
import { musicOf, foundPeople } from "../src/sim/musicGenome.js";
import { composePiece, gridOf, degreeHz, sectionsOf, finalFor, modeDegree } from "../src/sim/musicCompose.js";

// A frame's worth of mode degrees, laid out so the frame lands on an ABC
// octave: a five-degree mode reads as a pentatonic scale in C, a seven-degree
// one as a diatonic one. The letters are POSITIONS, not pitches — what they
// sound like is in the .scl file.
const LAYOUT = {
  2: ["C", "G"], 3: ["C", "E", "G"], 4: ["C", "D", "E", "G"],
  5: ["C", "D", "E", "G", "A"], 6: ["C", "D", "E", "F", "G", "A"],
  7: ["C", "D", "E", "F", "G", "A", "B"],
  8: ["C", "D", "E", "F", "G", "A", "B", "c"],
};
function layoutFor(n) {
  if (LAYOUT[n]) return LAYOUT[n];
  const base = "CDEFGAB";
  return Array.from({ length: n }, (_, i) => base[i % 7] + (i >= 7 ? "'" : ""));
}

/** ABC pitch token for a mode step `p` (which may run past one frame). */
function abcPitch(p, L, letters) {
  const oct = Math.floor(p / L);
  const s = letters[((p % L) + L) % L];
  let t = s;
  if (oct === 0) return t;
  if (oct > 0) { t = t.toLowerCase(); for (let i = 1; i < oct; i++) t += "'"; return t; }
  for (let i = 0; i < -oct; i++) t += ",";
  return t;
}

/** An ABC duration suffix for `n` units of the L: length. The grid is the
 *  smallest thing anybody plays, so a length is a whole number of units. */
function abcLen(n) {
  const r = Math.max(1, Math.round(n));
  return r === 1 ? "" : String(r);
}

export function notate(seed, occ = "peace") {
  const people = foundPeople(seed >>> 0, null);
  const m = musicOf(people);
  const G = gridOf(m.rhythm);
  const piece = composePiece(m, occ);
  const secs = sectionsOf(m, occ);
  const mode = m.mode, S = m.scale.degrees.length, L = mode.idx.length;
  const letters = layoutFor(L);
  // the same reference the Lab plays at: the mode's own FINAL sits at a
  // comfortable singing pitch, whichever degree of the scale that is
  const base = 294 * (m.melody.breathBound ? 1.12 : 1);
  const fd = m.scale.degrees[((modeDegree(m, finalFor(m, occ)) % S) + S) % S];
  const tonic = base / (fd ? fd.ratio : 1);

  // Which mode step a scale degree is — RELATIVE TO THE FINAL, so that C on
  // the staff is this people's home and not scale degree zero. A mode whose
  // final is its fifth degree is not "a mode starting on A"; it is its own
  // mode, and writing it starting on A is the transcription equivalent of the
  // bug that used to make it SOUND that way.
  const fin = finalFor(m, occ);
  const stepOf = (deg) => {
    const w = Math.floor(deg / S);
    const i = ((deg % S) + S) % S;
    const k = mode.idx.indexOf(i);
    return k < 0 ? null : k + w * L - fin;
  };
  // the mode as it is actually sung: rotated so the final is degree zero
  const rot = Array.from({ length: L }, (_, i) => {
    const c = mode.cents[(i + fin) % L] - mode.cents[fin];
    return (c < 0 ? c + m.scale.frame.cents : c);
  });

  // the melody is whatever carries it: the instrumental lead if there is one,
  // otherwise the sung line
  const hasLead = piece.events.some(e => e.role === "lead");
  const line = piece.events.filter(e => e.role === (hasLead ? "lead" : "voice"))
    .sort((a, b) => a.b - b.b);

  // ── ABC ──
  const unit = 4 * G.div;                       // L: 1/unit  → one grid slot
  const meter = m.rhythm.meterKind === "additive"
    ? `(${G.groups.join("+")})/${G.div === 3 ? 8 : 4}`
    : `${G.beats}/4`;
  const A = [];
  A.push(`X:${seed}`);
  A.push(`T:${people.name || "seed " + seed} — ${occ}`);
  A.push(`C:${people.biomeLabel}, ${m.insts.map(i => i.label).join(" + ")}`);
  A.push(`%%tuning ${rot.map(c => c.toFixed(1)).join(" ")} / frame ${m.scale.frame.cents.toFixed(1)}c   (from the final)`);
  A.push(`%%tonic ${tonic.toFixed(1)} Hz${hasLead ? "" : "  (sung: this people has no instrument that can carry a line)"}`);
  A.push(`%%form ${secs.map(s => `${s.label}:${s.cycles}c d${s.dens} oct${s.oct >= 0 ? "+" : ""}${s.oct}`).join(" | ")}`);
  A.push(`M:${meter}`);
  A.push(`L:1/${unit}`);
  A.push(`Q:1/4=${piece.tempo}`);
  A.push("K:C");

  const barBeats = G.beats;
  let body = "", cursor = 0, bar = 0, inBar = 0;
  const push = (tok, len) => {
    const u = Math.max(1, Math.round(len * G.div));
    body += tok + abcLen(u) + " ";
    inBar += u / G.div;
    while (inBar >= barBeats - 1e-6) { inBar -= barBeats; bar++; body += (bar % 4 === 0 ? "|\n" : "| "); }
  };
  for (const e of line) {
    const gap = e.b - cursor;
    if (gap * G.div > 0.5) push("z", gap);
    const p = stepOf(e.deg);
    const tok = p == null ? "z" : abcPitch(p + e.oct * L, L, letters);
    push(tok, Math.max(1 / G.div, e.dur));
    cursor = e.b + Math.max(1 / G.div, e.dur);
  }
  if (!body.trimEnd().endsWith("|")) body += "|";
  A.push(body.trimEnd().replace(/\|\s*$/, "|]"));

  // ── Scala ──
  const scl = [
    `! ${people.name || "seed" + seed}.scl`,
    `! derived from ${m.insts.map(i => i.label + " of " + i.mat).join(", ")}`,
    `${people.name || "seed " + seed} — ${L} of ${S} degrees, frame ${m.scale.frame.cents.toFixed(2)}c`,
    ` ${L}`,
    "!",
    ...rot.slice(1).map(c => ` ${c.toFixed(5)}`),
    ` ${m.scale.frame.cents.toFixed(5)}`,
  ].join("\n");

  // ── exact notes ──
  const tsv = ["bar\tbeat\tstep\tcents\thz\tbeats\tvel"];
  for (const e of line) {
    const p = stepOf(e.deg);
    const hz = degreeHz(m, tonic, e.deg, e.oct);
    const cents = 1200 * Math.log2(hz / tonic);
    tsv.push([Math.floor(e.b / barBeats) + 1, (e.b % barBeats).toFixed(2),
      p == null ? "-" : p + e.oct * L, cents.toFixed(1), hz.toFixed(1),
      e.dur.toFixed(2), e.vel.toFixed(2)].join("\t"));
  }
  return { abc: A.join("\n"), scl, tsv: tsv.join("\n"), music: m, piece, people, line, letters, L, S, stepOf, tonic, rot, fin };
}

// ── cli ──
const argv = process.argv.slice(2);
if (argv[0] === "--out") { var OUT = argv[1]; argv.splice(0, 2); mkdirSync(OUT, { recursive: true }); }
if (argv[0] === "--sweep") {
  const n = +argv[1] || 8, occ = argv[2] || "peace";
  const seeds = [];
  for (let s = 1000; seeds.length < n && s < 4000; s += 7) {
    const m = musicOf(foundPeople(s, null));
    // spread the sample over kinds of tradition, not over consecutive seeds
    const key = `${m.mode.size}:${m.rhythm.meterKind}:${m.insts[0].fam}`;
    if (seeds.some(x => x.key === key)) continue;
    seeds.push({ s, key });
  }
  for (const { s } of seeds) {
    const r = notate(s, occ);
    if (typeof OUT === "string") {
      writeFileSync(`${OUT}/${s}.abc`, r.abc + "\n");
      writeFileSync(`${OUT}/${s}.scl`, r.scl + "\n");
      writeFileSync(`${OUT}/${s}.tsv`, r.tsv + "\n");
    } else { console.log(r.abc); console.log(); }
  }
  if (typeof OUT === "string") console.log(`wrote ${seeds.length} tunes to ${OUT}`);
} else if (argv.length) {
  const r = notate(+argv[0], argv[1] || "peace");
  console.log(r.abc); console.log(); console.log(r.scl); console.log(); console.log(r.tsv);
}
