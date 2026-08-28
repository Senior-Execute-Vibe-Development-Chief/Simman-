// DOES A PEOPLE'S SCALE LAND ON RATIOS ANYONE HAS A NAME FOR?
//
// Not "is the roughness lower" — that model cannot separate a leading tone
// from a clash. What a listener reports, verified against five seeds judged by
// ear, is whether the degrees sit ON simple integer ratios or between them.
// Rank order was exact: 4/4 and 2/4 good, 3/4 fair, 1/4 and 0/3 bad — while the
// curve's DEPTH was 0.193 to 0.226 across all five and separated nothing.
import { foundLanguage } from "../src/sim/language.js";
import { foundPeople, musicOf } from "../src/sim/musicGenome.js";

const W = () => ({ seed: 1, step: 0, languages: new Map(), _nextLanguageId: 1 });
const JUST = [[9,8],[8,7],[7,6],[6,5],[5,4],[4,3],[7,5],[3,2],[8,5],[5,3],[7,4],[9,5],[15,8]];
const off = (c) => {
  let b = Infinity;
  for (const [p, q] of JUST) { const d = Math.abs(c - 1200 * Math.log2(p / q)); if (d < b) b = d; }
  return b;
};
let n = 0, on = 0, tot = 0, offSum = 0, byBand = new Map();
const sigs = [];
for (let i = 0; i < 240; i++) {
  const seed = 1000 + i * 7;
  let m; try { m = musicOf(foundPeople(seed, foundLanguage(W(), { seed }), {})); } catch { continue; }
  n++;
  const ds = m.mode.cents.filter(c => c > 0);
  const hits = ds.filter(c => off(c) <= 15).length;
  on += hits; tot += ds.length;
  for (const c of ds) offSum += off(c);
  const band = m.insts.length ? Math.min(3, Math.floor(m.insts.filter(x => x.harmonic).length / m.insts.length * 4)) : 0;
  const b = byBand.get(band) || { on: 0, tot: 0, n: 0 };
  b.on += hits; b.tot += ds.length; b.n++; byBand.set(band, b);
  sigs.push(m.mode.cents.map(c => Math.round(c / 25) * 25).join(","));
}
console.log(`${n} peoples: ${(100 * on / tot).toFixed(0)}% of degrees land within 15c of a simple ratio; mean miss ${(offSum / tot).toFixed(0)}c`);
const LABEL = ["< 1/4 harmonic", "1/4 - 1/2", "1/2 - 3/4", ">= 3/4"];
for (const k of [0, 1, 2, 3]) {
  const b = byBand.get(k); if (!b) continue;
  console.log(`   ${LABEL[k].padEnd(16)} n=${String(b.n).padStart(3)}   ${(100 * b.on / b.tot).toFixed(0)}% on a simple ratio`);
}
console.log(`   diversity ${new Set(sigs).size}/${sigs.length} distinct modes (${(100 * new Set(sigs).size / sigs.length).toFixed(0)}%)`);
