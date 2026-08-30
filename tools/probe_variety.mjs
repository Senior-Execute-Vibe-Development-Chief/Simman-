// WHAT DO THE CONSTRAINTS COST IN VARIETY?
//
// Every bound added to the scale derivation buys correctness and spends
// range. This measures what is left: how many distinct modes the corpus holds,
// how many of them lean (which is what `affectOf` turns into atmosphere), and
// how far the step spread reaches — against the bench, which is the evidence
// for what a real tuning is allowed to be.
import { foundLanguage } from "../src/sim/language.js";
import { foundPeople, musicOf } from "../src/sim/musicGenome.js";
import { TRADITIONS } from "../src/sim/musicTraditions.js";

const W = () => ({ seed: 1, step: 0, languages: new Map(), _nextLanguageId: 1 });
const stats = (st, frame) => {
  const mean = st.reduce((a, b) => a + b, 0) / st.length;
  const cv = Math.sqrt(st.reduce((a, x) => a + (x - mean) * (x - mean), 0) / st.length) / mean;
  return { cv, lean: st.filter(x => x < 150).length / st.length, min: Math.min(...st), frame };
};
const rows = [], sigs = [];
let leanAny = 0, n = 0;
for (let i = 0; i < 240; i++) {
  const seed = 1000 + i * 7;
  let m; try { m = musicOf(foundPeople(seed, foundLanguage(W(), { seed }), {})); } catch { continue; }
  n++;
  const s = stats(m.mode.steps.filter(x => x > 0), m.scale.frame.cents);
  rows.push(s);
  if (s.lean > 0) leanAny++;
  sigs.push(m.mode.cents.map(c => Math.round(c / 25) * 25).join(","));
}
const q = (g, p) => { const v = rows.map(g).sort((a, b) => a - b); return v[Math.floor(p * (v.length - 1))]; };
console.log(`${n} derived peoples`);
console.log(`  distinct modes            ${new Set(sigs).size} (${(100 * new Set(sigs).size / n).toFixed(0)}%)`);
console.log(`  step spread   p10 ${q(r => r.cv, .1).toFixed(2)}  median ${q(r => r.cv, .5).toFixed(2)}  p90 ${q(r => r.cv, .9).toFixed(2)}  max ${q(r => r.cv, 1).toFixed(2)}`);
console.log(`  narrowest step p10 ${q(r => r.min, .1).toFixed(0)}c  median ${q(r => r.min, .5).toFixed(0)}c  min ${q(r => r.min, 0).toFixed(0)}c`);
console.log(`  peoples with ANY leaning step  ${leanAny} (${(100 * leanAny / n).toFixed(0)}%)`);
console.log(`  mode sizes                ${[...new Set(rows.map(r => r.frame && 0))].length ? "" : ""}`);
// the bench is the evidence for what a tuning is allowed to be
console.log(`\nthe bench, for comparison:`);
for (const k of Object.keys(TRADITIONS)) {
  const t = TRADITIONS[k];
  const st = t.mode.map((c, i) => (i + 1 < t.mode.length ? t.mode[i + 1] : t.frame) - c);
  const s = stats(st, t.frame);
  console.log(`  ${k.padEnd(12)} spread ${s.cv.toFixed(2)}  narrowest ${String(s.min).padStart(3)}c  leaning ${(100 * s.lean).toFixed(0)}%`);
}
