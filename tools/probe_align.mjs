// DOES EVERY VERTICAL LINE STAND IN A DIP?
//
// Two different alignments, and only one of them should ever be perfect.
//
//  · degree -> minimum. A bright line is a degree the people chose; a dip is
//    where their instruments stop fighting. A degree standing where there is
//    no dip is one nobody heard — invented to fill a quota. This SHOULD line
//    up, always.
//  · minimum -> the faint grid. That grid is equal-tempered semitones, a ruler
//    borrowed from another tradition. This should NOT line up: a just major
//    third is 14 cents off it by definition, and a people whose dips all fell
//    on the grid would be a people playing a piano.
import { foundLanguage } from "../src/sim/language.js";
import { foundPeople, musicOf } from "../src/sim/musicGenome.js";

const W = () => ({ seed: 1, step: 0, languages: new Map(), _nextLanguageId: 1 });
const NEAR = 12;                       // cents: as close as the eye reads "on it"

let inDip = 0, degs = 0, offSum = 0, onGrid = 0, n = 0, perfect = 0;
const named = new Map([[1038, "good"], [1039, "good"], [1036, "fair"], [1037, "BAD"], [1040, "BAD"]]);
const rows = [];
const SEEDS = [];
for (let i = 0; i < 240; i++) SEEDS.push(1000 + i * 7);
for (const k of named.keys()) if (!SEEDS.includes(k)) SEEDS.push(k);
for (const seed of SEEDS) {
  let m; try { m = musicOf(foundPeople(seed, foundLanguage(W(), { seed }), {})); } catch { continue; }
  const judged = named.has(seed);
  if (!judged) n++;
  const mins = (m.scale.minima || []).map(x => 1200 * Math.log2(x.ratio));
  const ds = m.scale.degrees.map(d => d.cents).filter(c => c > 0);
  let hit = 0;
  for (const c of ds) {
    if (judged) { let b = Infinity; for (const mc of mins) b = Math.min(b, Math.abs(mc - c)); if (b <= NEAR) hit++; continue; }
    degs++;
    let best = Infinity;
    for (const mc of mins) best = Math.min(best, Math.abs(mc - c));
    offSum += Math.min(best, 200);
    if (best <= NEAR) { inDip++; hit++; }
    if (Math.abs(c - Math.round(c / 100) * 100) <= NEAR) onGrid++;
  }
  if (judged) { rows.push([seed, named.get(seed), hit, ds.length]); continue; }
  if (ds.length && hit === ds.length) perfect++;
}
console.log(`${n} peoples, ${degs} degrees`);
console.log(`  degree stands in a dip           ${(100 * inDip / degs).toFixed(0)}%   (mean miss ${(offSum / degs).toFixed(0)}c)`);
console.log(`  peoples where EVERY degree does  ${(100 * perfect / n).toFixed(0)}%`);
console.log(`  degree happens to sit on the 12-TET grid  ${(100 * onGrid / degs).toFixed(0)}%  <- should NOT be 100%`);
if (rows.length) {
  console.log("\n  the five judged by ear:");
  for (const [s, v, h, t] of rows) console.log(`    ${s}  ${v.padEnd(5)}  ${h}/${t} degrees standing in a dip`);
}
