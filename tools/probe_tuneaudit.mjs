// THE STATE OF THE DERIVED SCALES, in the terms a listener complains in.
//
// Not "is the roughness number lower" — that model cannot tell a diatonic
// semitone from a clash, and says so: 112c scores 0.175 against a harmonic ear
// and 141c scores 0.164. What a listener actually names is a pitch stranded
// between two notes, a scale with no fifth in it, and a degree nobody heard
// that the engine put there to fill a quota.
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
// how far a pitch sits from the nearest note anyone has a name for
const stranded = (c) => Math.abs(c - Math.round(c / 100) * 100);

let n = 0, sizeSum = 0, modeSum = 0, invented = 0, degs = 0, between = 0, betweenPeoples = 0;
let hasFifth = 0, hasThird = 0, roughSum = 0, minStepSum = 0, evenSum = 0, allEqual = 0;
for (let i = 0; i < 240; i++) {
  const seed = 1000 + i * 7;
  let m; try { m = musicOf(foundPeople(seed, foundLanguage(W(), { seed }), {})); } catch { continue; }
  n++;
  sizeSum += m.scale.degrees.length;
  modeSum += m.mode.size;
  degs += m.scale.degrees.length;
  invented += m.scale.degrees.filter(d => !d.found).length;
  const strandedHere = m.mode.cents.filter(c => stranded(c) >= 35).length;
  between += strandedHere;
  if (strandedHere) betweenPeoples++;
  const F = m.scale.frame.cents;
  if (m.mode.cents.some(c => Math.abs(c - 702) < 25)) hasFifth++;
  if (m.mode.cents.some(c => Math.abs(c - 386) < 25 || Math.abs(c - 316) < 25)) hasThird++;
  const all = [...m.mode.cents, F];
  let r = 0, p = 0;
  for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) { r += dissonance(HARM, R(all[b] - all[a])); p++; }
  roughSum += r / p;
  const st = m.mode.steps;
  minStepSum += Math.min(...st);
  const mean = st.reduce((a, x) => a + x, 0) / st.length;
  const cv = Math.sqrt(st.reduce((a, x) => a + (x - mean) * (x - mean), 0) / st.length) / mean;
  evenSum += cv;
  if (cv < 0.06) allEqual++;          // an equal division in all but name
}
const pc = (x) => (100 * x / n).toFixed(0) + "%";
console.log(`${n} derived peoples`);
console.log(`  scale size          ${(sizeSum / n).toFixed(2)} degrees      mode ${(modeSum / n).toFixed(2)}`);
console.log(`  degrees INVENTED    ${(100 * invented / degs).toFixed(0)}% (the rest were heard in the spectrum)`);
console.log(`  pitches stranded between two notes (>=35c off): ${between} in all, in ${pc(betweenPeoples)} of peoples`);
console.log(`  mode contains a fifth ${pc(hasFifth)}   a third ${pc(hasThird)}`);
console.log(`  narrowest step        ${(minStepSum / n).toFixed(0)}c mean`);
console.log(`  step evenness (cv)    ${(evenSum / n).toFixed(3)}   equal-division-in-disguise ${pc(allEqual)}`);
console.log(`  mode roughness vs a harmonic ear ${(roughSum / n).toFixed(4)}`);
