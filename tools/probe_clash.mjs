// WHY DID THIS MODE GET THROUGH?
//
// `deriveMode` scores a candidate set four ways: pairwise roughness as a chord,
// pairwise roughness of its STEPS, a crawl penalty for steps under 120 cents,
// and an evenness penalty past 0.35 relative spread. Print all four for the set
// it chose, next to what a plain harmonic ear makes of the same set — because
// the first two are measured against the ENSEMBLE's spectrum and the ear is
// what the recordings actually bring.
import { foundLanguage } from "../src/sim/language.js";
import { foundPeople, musicOf } from "../src/sim/musicGenome.js";
import { dissonance } from "../src/sim/musicTuning.js";

const W = () => ({ seed: 1, step: 0, languages: new Map(), _nextLanguageId: 1 });
const HARM = (() => {
  const s = Array.from({ length: 10 }, (_, i) => ({ f: 262 * (i + 1), a: Math.pow(0.85, i) }));
  const t = Math.sqrt(s.reduce((a, p) => a + p.a * p.a, 0));
  return s.map(p => ({ f: p.f, a: p.a / t }));
})();
const R = (c) => Math.pow(2, c / 1200);

const seeds = process.argv.slice(2).map(Number);
for (const seed of (seeds.length ? seeds : [1037, 1040, 1041, 1035])) {
  const m = musicOf(foundPeople(seed, foundLanguage(W(), { seed }), {}));
  const cents = [...m.mode.cents, m.scale.frame.cents];
  const steps = m.mode.steps;
  console.log(`\n── seed ${seed} — ${m.insts.length} bodies, ${m.insts.filter(i => i.harmonic).length} harmonic, frame ${m.scale.frame.cents.toFixed(0)}c`);
  console.log(`   mode ${m.mode.cents.map(c => c.toFixed(0)).join(" ")}   steps ${steps.map(s => s.toFixed(0)).join(" ")}`);
  // the two guards, exactly as deriveMode computes them
  let crawl = 0, sum = 0, sum2 = 0;
  for (const st of steps) {
    if (st < 120) crawl += Math.pow((120 - st) / 120, 2);
    sum += st; sum2 += st * st;
  }
  const k = steps.length, mean = sum / k;
  const cv = Math.sqrt(Math.max(0, sum2 / k - mean * mean)) / mean;
  console.log(`   crawl penalty ${(0.09 * 8 * crawl).toFixed(4)}   evenness cv ${cv.toFixed(3)} (bound 0.35) -> ${(0.55 * (cv > 0.35 ? Math.pow(cv / 0.35 - 1, 2) : 0)).toFixed(4)}`);
  // every step, judged by a harmonic ear, worst first
  const rows = [];
  for (let i = 0; i + 1 < cents.length; i++) {
    const iv = cents[i + 1] - cents[i];
    rows.push({ what: `step ${cents[i].toFixed(0)}->${cents[i + 1].toFixed(0)}`, iv,
      own: dissonance(m.spec, R(iv)), ear: dissonance(HARM, R(iv)) });
  }
  for (let a = 0; a < cents.length; a++) for (let b = a + 2; b < cents.length; b++) {
    const iv = cents[b] - cents[a];
    rows.push({ what: `${cents[a].toFixed(0)} vs ${cents[b].toFixed(0)}`, iv,
      own: dissonance(m.spec, R(iv)), ear: dissonance(HARM, R(iv)) });
  }
  rows.sort((x, y) => y.ear - x.ear);
  console.log("   worst intervals, by a harmonic ear:");
  for (const r of rows.slice(0, 4)) {
    console.log(`     ${r.what.padEnd(18)} ${r.iv.toFixed(0).padStart(4)}c   ear ${r.ear.toFixed(3)}   own-spectrum ${r.own.toFixed(3)}`);
  }
}
