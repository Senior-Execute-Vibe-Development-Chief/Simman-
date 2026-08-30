// HOW FAR IS EVERY NOTE DRAGGED FROM A REAL RECORDING? A sampled body is only
// itself at the pitches it was recorded at; everywhere else it is resampled,
// which moves its formants and its length as well as its pitch.
import { foundLanguage } from "../src/sim/language.js";
import { foundPeople, musicOf } from "../src/sim/musicGenome.js";
import { composePiece, degreeHz } from "../src/sim/musicCompose.js";
import { TRADITIONS, applyTradition } from "../src/sim/musicTraditions.js";
import { makeInstrument } from "../src/sim/musicInstruments.js";
import { finalsOf } from "../src/sim/musicTuning.js";
import { SAMPLE_BANK, NAMED_BANK } from "../src/sim/musicSampleManifest.js";
const W = () => ({ seed: 1, step: 0, languages: new Map(), _nextLanguageId: 1 });
const build = (seed, trad) => {
  const m = musicOf(foundPeople(seed >>> 0, foundLanguage(W(), { seed: seed >>> 0 }), {}));
  return trad ? applyTradition(m, trad, { makeInstrument, finalsOf }) : m;
};
// the same pool `musicSamples` builds: family recordings plus the named ones,
// merged by family and chosen by MATERIAL
const MATS = { bone:[.55,.5], bamboo:[.6,.5], wood:[.42,.6], reed:[.5,.4], clay:[.35,.5],
  gut:[.4,1.2], silk:[.32,1.4], iron:[.75,2.2], bronze:[.7,3], hide:[.45,.35],
  stone:[.5,1.5], silver:[.8,2.5], horn:[.5,.6], gourd:[.4,.5], none:[.55,.09] };
// the same score `sampledFor` uses: the right material, and enough of it
const gapOf = (hz) => {
  const v = [...hz].filter(x => x > 0).sort((a, b) => a - b);
  if (v.length < 2) return 1200;
  const g = []; for (let i = 1; i < v.length; i++) g.push(1200 * Math.log2(v[i] / v[i - 1]));
  g.sort((a, b) => a - b); return g[Math.floor(g.length / 2)];
};
const matDist = (a, b) => {
  const X = MATS[a], Y = MATS[b];
  if (!X || !Y) return 9;
  const db = X[0] - Y[0], dd = Math.log((X[1] + .2) / (Y[1] + .2)) / 3;
  return Math.sqrt(db * db + dd * dd);
};
const POOL = {};
for (const [f, b] of Object.entries(SAMPLE_BANK)) {
  if (b.unpitched) continue;
  (POOL[f] ||= []).push({ src: b.src, mat: b.mat, hz: b.samples.map(x => x.hz) });
}
for (const [, b] of Object.entries(NAMED_BANK)) {
  if (!b.fam) continue;
  const p2 = (POOL[b.fam] ||= []);
  if (!p2.some(x => x.src === b.src)) p2.push({ src: b.src, mat: b.mat, hz: b.samples.map(x => x.hz) });
}
function bankFor(inst) {
  if (inst.sampleName && NAMED_BANK[inst.sampleName]) return NAMED_BANK[inst.sampleName].samples.map(s => s.hz);
  const p2 = POOL[inst.fam];
  if (!p2 || !p2.length) return null;
  const sc = (c) => matDist(inst.mat, c.mat) + gapOf(c.hz) / 1200;
  return p2.reduce((a, b) => (sc(b) < sc(a) ? b : a)).hz;
}
function report(tag, m) {
  const p = composePiece(m, "peace");
  const ev = (p.events || []).filter(e => e.deg != null && e.inst >= 0);
  let n = 0, sum = 0, worst = 0, dead = 0, big = 0;
  const per = new Map();
  for (const e of ev) {
    const inst = m.insts[e.inst];
    if (!inst) continue;
    const hz = degreeHz(m, 220, e.deg, e.oct || 0);
    const bank = bankFor(inst);
    if (!bank || !bank.length || !(hz > 0)) continue;
    // the same octave fold the player applies: in-range notes stay put
    const lo = bank[0], hi = bank[bank.length - 1];
    let g = hz;
    while (g > hi && g / 2 >= lo) g /= 2;
    while (g < lo && g * 2 <= hi) g *= 2;
    let best = Infinity;
    for (const h of bank) best = Math.min(best, Math.abs(1200 * Math.log2(g / h)));
    n++; sum += best; worst = Math.max(worst, best);
    if (best < 10) dead++;
    if (best > 120) big++;
    const k = inst.sampleName || inst.fam;
    const q = per.get(k) || { n: 0, s: 0, d: 0 };
    q.n++; q.s += best; if (best < 10) q.d++;
    per.set(k, q);
  }
  if (!n) { console.log(tag.padEnd(11), "(no sampled bodies)"); return; }
  console.log(tag.padEnd(11), "notes", String(n).padStart(4),
    "| mean shift", (sum / n).toFixed(0).padStart(3) + "c",
    "| worst", worst.toFixed(0).padStart(3) + "c",
    "| played AT a recorded pitch", (100 * dead / n).toFixed(0).padStart(3) + "%",
    "| shifted over a semitone", (100 * big / n).toFixed(0).padStart(3) + "%");
  const rows = [...per].sort((a, b) => b[1].s / b[1].n - a[1].s / a[1].n).slice(0, 3);
  for (const [k, q] of rows) console.log("      ", k.padEnd(12), "mean", (q.s / q.n).toFixed(0) + "c", "| on-pitch", (100 * q.d / q.n).toFixed(0) + "%");
}
for (const k of Object.keys(TRADITIONS)) report(k, build(7, k));
console.log();
for (const s of [1037, 1035, 2025]) report("seed " + s, build(s, null));
