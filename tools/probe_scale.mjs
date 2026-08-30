// WHY DOES ONE WORLD SOUND LIKE MUSIC AND THE NEXT SOUND EERIE?
//
// The scale is derived by matching it to the ensemble's own spectrum (Sethares).
// That is only a consonance argument for a listener hearing THAT spectrum. So
// measure both: how rough a people's own mode is against the ensemble it was
// derived for, and how rough the same mode is against a plain harmonic
// spectrum — which is what a human ear, and every real instrument recording we
// play it on, actually brings to it.
import { foundLanguage } from "../src/sim/language.js";
import { foundPeople, musicOf } from "../src/sim/musicGenome.js";
import { dissonance } from "../src/sim/musicTuning.js";

const HARM = Array.from({ length: 8 }, (_, i) => ({ f: 300 * (i + 1), a: Math.pow(0.85, i) }));
const norm = (s) => { const t = Math.sqrt(s.reduce((a, p) => a + p.a * p.a, 0)) || 1; return s.map(p => ({ f: p.f, a: p.a / t })); };
const H = norm(HARM);

/** Mean roughness over every pair of degrees in the mode, against a spectrum. */
function rough(spec, cents, frame) {
  let sum = 0, n = 0;
  const all = [...cents, frame];
  for (let a = 0; a < all.length; a++) {
    for (let b = a + 1; b < all.length; b++) {
      sum += dissonance(spec, Math.pow(2, (all[b] - all[a]) / 1200)); n++;
    }
  }
  return n ? sum / n : 0;
}
const W = () => ({ seed: 1, step: 0, languages: new Map(), _nextLanguageId: 1 });
const build = (seed) => musicOf(foundPeople(seed >>> 0, foundLanguage(W(), { seed: seed >>> 0 }), {}));

const rows = [];
for (let s = 0; s < 240; s++) {
  const seed = 1000 + s * 7;
  let m; try { m = build(seed); } catch { continue; }
  const harm = m.insts.filter(i => i.harmonic).length, tot = m.insts.length;
  const frame = m.scale.frame.cents;
  rows.push({
    seed, hf: tot ? harm / tot : 0, tot,
    own: rough(m.spec, m.mode.cents, frame),
    ear: rough(H, m.mode.cents, frame),
    frame: Math.round(frame), tet: m.scale.tetErr,
    lead: (m.insts.find(i => i.role === "lead") || m.insts[0] || {}).fam,
  });
}
// the same measurement on a plain just diatonic, as a control: what a scale
// a human ear likes scores against that ear
const JUSTM = [0, 204, 386, 498, 702, 884, 1088];
console.log("control — just diatonic vs a harmonic ear:", rough(H, JUSTM, 1200).toFixed(4));
console.log("control — 12-TET diatonic          :", rough(H, [0,200,400,500,700,900,1100], 1200).toFixed(4));
console.log("control — 7-EDO (equidistant)      :", rough(H, [0,171,343,514,686,857,1029], 1200).toFixed(4));
console.log();
const show = (name, R) => {
  if (!R.length) return;
  const mean = (g) => R.reduce((a, r) => a + g(r), 0) / R.length;
  console.log(name.padEnd(24), String(R.length).padStart(4),
    "| rough vs own spectrum", mean(r => r.own).toFixed(4),
    "| vs a HARMONIC ear", mean(r => r.ear).toFixed(4),
    "| 12tet-err", mean(r => r.tet).toFixed(0).padStart(2) + "c");
};
console.log("harmonic share of ensemble");
show("all harmonic", rows.filter(r => r.hf === 1));
show(">= 3/4", rows.filter(r => r.hf >= 0.75 && r.hf < 1));
show("1/2 - 3/4", rows.filter(r => r.hf >= 0.5 && r.hf < 0.75));
show("1/4 - 1/2", rows.filter(r => r.hf >= 0.25 && r.hf < 0.5));
show("< 1/4", rows.filter(r => r.hf < 0.25));
console.log();
show("ALL", rows);
const sorted = [...rows].sort((a, b) => a.ear - b.ear);
console.log("\nsmoothest to a harmonic ear:", sorted.slice(0, 5).map(r => r.seed + "(" + (r.hf * 100).toFixed(0) + "%h)").join("  "));
console.log("roughest  to a harmonic ear:", sorted.slice(-5).map(r => r.seed + "(" + (r.hf * 100).toFixed(0) + "%h)").join("  "));
