// A PINNED TRADITION MUST BE THE TRADITION IT SAYS IT IS.
//
// `musicTraditions.js` is the bench: seven entries that declare, as data, what
// a takht or a sizhu or a sankyoku is made of, tuned to and led by. Everything
// measured on the bench is only worth reading if the engine actually produces
// what the table declares — and twice now it has not, silently, for the whole
// life of the field:
//
//   · `finalIdx` was written on every entry and read by nothing. Five of the
//     seven were being played from the wrong tonic, which is a different maqām
//     and a different rāg, so every measurement taken on them was a measurement
//     of something else.
//   · putting a gamelan, a West African ensemble and a didgeridoo on this bench
//     found five faults inside an hour that five melodic string-and-pipe
//     traditions had never touched: the colotomic gong swept into the
//     percussion section, a ten-kettle rack made the marker instead, the whole
//     percussion block skipped for any people with no drum, the loud-occasion
//     lead handed to a body that cannot play a tune, and a stage seat reserved
//     for a "lead" that does not exist. A bench only tests what it contains.
//   · `role` was written on every body and read by nothing. That one turned out
//     TRUE — the composer derives the same assignment from weight and capacity
//     98 times in a hundred — and the right response to a true declaration
//     nothing checks is not to start obeying it (that would destroy the very
//     independence that makes the agreement evidence) but to assert it, so the
//     next drift in the derivation is caught here instead of by ear.
//
// So: every fact a tradition declares is checked against what the engine does
// with it. Cheap, and it runs in `npm test`.
import { TRADITIONS, applyTradition } from "../src/sim/musicTraditions.js";
import { foundLanguage } from "../src/sim/language.js";
import { foundPeople, musicOf } from "../src/sim/musicGenome.js";
import { ensembleFor, composePiece, ambientBar, OCCASIONS, finalFor, modeDegree, degreeHz } from "../src/sim/musicCompose.js";
import { ARCHETYPE_PHYS_FIT_MIN } from "../src/sim/musicArchetypes.js";
import { makeInstrument } from "../src/sim/musicInstruments.js";
import { finalsOf } from "../src/sim/musicTuning.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

const W = () => ({ seed: 1, step: 0, languages: new Map(), _nextLanguageId: 1 });
const build = (key) => applyTradition(
  musicOf(foundPeople(7, foundLanguage(W(), { seed: 7 }), {})), key, { makeInstrument, finalsOf });

const OCCS = Object.keys(OCCASIONS);
const t0 = performance.now();
console.log(`[music] ${Object.keys(TRADITIONS).length} pinned traditions x ${OCCS.length} occasions`);

for (const key of Object.keys(TRADITIONS)) {
  const T = TRADITIONS[key];
  const m = build(key);

  // ── the scale is the one the table names, to the cent ──
  const got = m.scale.degrees.map(d => Math.round(d.cents));
  check(`${key}: plays its own scale [${got.join(" ")}]`,
    got.length === T.scale.length && got.every((c, i) => Math.abs(c - T.scale[i]) < 1),
    `declared [${T.scale.join(" ")}]`);

  // ── and calls home the degree it names, on every occasion ──
  const fi = T.finalIdx ?? 0;
  const wrong = OCCS.filter(o => finalFor(m, o) !== fi);
  check(`${key}: home is degree ${fi} whatever the occasion`, wrong.length === 0,
    wrong.map(o => `${o}→${finalFor(m, o)}`).join(" "));

  // ── every body it lists is heard. A tradition that names five instruments
  // and plays three is not that tradition — this is what left the Arabic riqq
  // and the Japanese shamisen silent in every piece for months.
  const heard = new Set();
  for (const o of OCCS) for (const e of composePiece(m, o).events || []) heard.add(e.inst);
  const mute = T.insts.map((s, i) => [s, i]).filter(([, i]) => !heard.has(i));
  check(`${key}: all ${T.insts.length} bodies play`, mute.length === 0,
    mute.map(([s]) => s.label || s.fam).join(", "));

  // ── and each does the job the table says it does. Derived independently by
  // `ensembleFor` from weight and capacity; asserted, never read, so that the
  // agreement stays a measurement.
  for (const occ of OCCS) {
    const E = ensembleFor(m, occ, 1);
    const role = new Map();
    const put = (k, r) => { if (k != null && !role.has(k)) role.set(k, r); };
    put(E.lead, "lead"); put(E.elab, "elab"); put(E.drone, "drone");
    for (const k of (E.marks || [])) put(k, "mark");
    for (const k of (E.het || [])) put(k, "het");
    put(E.pulse, "pulse");
    for (const k of (E.perc || [])) put(k, "pulse");
    put(E.core, "core"); put(E.bass, "bass"); put(E.ost, "ost");
    const bad = T.insts.map((s, i) => [s, i]).filter(([s, i]) => {
      if (!s.role) return false;
      const g = role.get(i) || "SILENT";
      if (g === s.role) return false;
      // heterophony IS carrying the line — every player on one tune is what the
      // word means, so a declared lead playing `het` is the texture working
      if (s.role === "lead" && g === "het") return false;
      // and a loud outdoor occasion picks its own lead: a war band is fronted
      // by a double reed over a drum, never by a court zither. That override is
      // `ensembleFor`'s and it is right.
      if (s.role === "lead" && OCCASIONS[occ].lead === "loud") return false;
      return true;
    });
    check(`${key}/${occ}: bodies do their declared jobs`, bad.length === 0,
      bad.map(([s, i]) => `${s.label || s.fam} declares ${s.role} plays ${role.get(i) || "SILENT"}`).join("; "));
  }
}

// ── and one thing about every people, pinned or not: the mode's home has to be
// a degree the mode contains. `modeDegree` maps a mode index onto a scale
// index, and a final outside it is a tonic the melody can never land on.
for (let s = 0; s < 60; s++) {
  const seed = 1000 + s * 37;
  const m = musicOf(foundPeople(seed, foundLanguage(W(), { seed }), {}));
  const bad = OCCS.filter(o => {
    const f = finalFor(m, o);
    return !(Number.isInteger(f) && f >= 0 && f < m.mode.size)
      || !Number.isInteger(modeDegree(m, f));
  });
  if (bad.length) { check(`seed ${seed}: home is inside the mode`, false, bad.join(" ")); break; }
  if (s === 59) check("60 derived peoples: home is inside the mode", true);
}

// ── coherence: texture choices that were audible as mud in vertical probes ──
const MELODIC = new Set(["lead", "het", "elab", "voice", "core", "bass", "ost", "pad"]);
function verticalOf(m) {
  const plan = ambientBar(m, { occ: "peace", bar: 0, intimacy: 0.85 });
  const ev = (plan.events || [])
    .filter(e => MELODIC.has(e.role) && e.deg != null)
    .map(e => ({ t: e.b, dur: e.dur || 0.5, hz: degreeHz(m, 220, e.deg, e.oct || 0), role: e.role }))
    .filter(e => e.hz > 0);
  ev.sort((a, b) => a.t - b.t);
  let pairs = 0, semis = 0, poly = 0, n = 0;
  for (let i = 0; i < ev.length; i++) {
    const a = ev[i], aEnd = a.t + Math.min(a.dur, 1.2);
    let over = 0;
    for (let j = i + 1; j < ev.length && ev[j].t < aEnd; j++) {
      const b = ev[j];
      if (b.t + Math.min(b.dur, 4) <= a.t) continue;
      over++;
      let r = b.hz / a.hz; if (r < 1) r = 1 / r;
      if (r > 4.2) continue;
      const oc = ((Math.round(1200 * Math.log2(r)) % 1200) + 1200) % 1200;
      if ((oc >= 30 && oc <= 140) || (oc >= 1060 && oc <= 1170)) semis++;
      pairs++;
    }
    poly += over; n++;
  }
  const roles = new Set((plan.events || []).map(e => e.role));
  const hetOn = (plan.events || []).some(e => e.role === "het");
  return {
    pairs, semis: pairs ? semis / pairs : 0, poly: n ? poly / n : 0,
    elabHet: roles.has("elab") && hetOn,
  };
}

// ── archetype tuning for derived peoples ─────────────────────────────────
const archetypes = new Set();
let applied = 0;
for (let s = 0; s < 50; s++) {
  const seed = 3000 + s * 17;
  const m = musicOf(foundPeople(seed, foundLanguage(W(), { seed }), {}));
  if (m.scale.archetype?.id) {
    applied++;
    archetypes.add(m.scale.archetype.id);
    check(`seed ${seed}: archetype physFit above gate`, (m.scale.archetype.physFit ?? 1) >= ARCHETYPE_PHYS_FIT_MIN,
      `fit ${m.scale.archetype.physFit?.toFixed(2)}`);
  }
}
check("50 derived peoples: at least 4 distinct tuning families when applied", archetypes.size >= 4 || applied < 8,
  `${archetypes.size} families in ${applied} applied (raw preferred on tie)`);

// mean ET distance — archetype scales should stay sample-friendly
let maxEt = 0;
for (let s = 0; s < 30; s++) {
  const seed = 4000 + s * 23;
  const m = musicOf(foundPeople(seed, foundLanguage(W(), { seed }), {}));
  maxEt = Math.max(maxEt, m.scale.tetErr ?? 0);
}
check("archetype tuning: degree ET error under 45¢", maxEt < 45, `worst ${maxEt.toFixed(1)}¢`);

// pitches stranded between ET names (>=35¢) — the listener complaint
let strandedPeoples = 0;
const stranded = (c) => Math.abs(c - Math.round(c / 100) * 100);
for (let s = 0; s < 60; s++) {
  const seed = 5000 + s * 19;
  const m = musicOf(foundPeople(seed, foundLanguage(W(), { seed }), {}));
  if (m.mode.cents.some(c => stranded(c) >= 35)) strandedPeoples++;
}
check("60 derived peoples: under 20% with pitches stranded off ET names", strandedPeoples < 12,
  `${strandedPeoples}/60`);

let scaleSigs = new Set(), textures = new Set();
for (let s = 0; s < 60; s++) {
  const seed = 6000 + s * 23;
  const m = musicOf(foundPeople(seed, foundLanguage(W(), { seed }), {}));
  scaleSigs.add(m.scale.degrees.map(d => Math.round(d.cents)).join("|"));
  textures.add(m.texture.kind);
}
check("60 derived peoples: at least 45 distinct scales", scaleSigs.size >= 45, `${scaleSigs.size} scales`);
check("60 derived peoples: at least 3 textures represented", textures.size >= 3, [...textures].join(", "));

console.log("[music] coherence gates (30 derived peoples, peace ambient bar)");
let maxSemis = 0, maxPoly = 0;
for (let s = 0; s < 30; s++) {
  const seed = 2000 + s * 41;
  const m = musicOf(foundPeople(seed, foundLanguage(W(), { seed }), {}));
  const plan = ambientBar(m, { occ: "peace", bar: 0, intimacy: 0.85 });
  const hetOn = (plan.events || []).filter(e => e.role === "het");
  const hetInsts = new Set(hetOn.map(e => e.inst));
  check(`seed ${seed}: at most one heterophonic doubler per bar when elaborating`,
    !plan.events?.some(e => e.role === "elab") || hetInsts.size <= 1,
    `${hetInsts.size} het bodies`);
  const v = verticalOf(m);
  maxSemis = Math.max(maxSemis, v.semis);
  maxPoly = Math.max(maxPoly, v.poly);
}
check("coherence: semitone clash share stays under 23%", maxSemis < 0.23, `worst ${(100 * maxSemis).toFixed(1)}%`);
check("coherence: mean simultaneous melodic parts under 2.55", maxPoly < 2.55, `worst ${maxPoly.toFixed(2)}`);

const secs = ((performance.now() - t0) / 1000).toFixed(1);
if (failures > 0) {
  console.error(`[music] ${failures} check(s) FAILED in ${secs}s`);
  process.exit(1);
}
console.log(`[music] all checks passed in ${secs}s`);
