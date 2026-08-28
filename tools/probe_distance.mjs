// WHAT DOES A PEOPLE'S MUSIC SOUND LIKE FROM ACROSS THE SETTLEMENT?
//
// The background track is music heard at a distance, and distance decides more
// than volume: who is audible at all, how many players turn up, whether there
// is singing, and whether there are WORDS in the singing. Measure the corpus
// at each remove.
import { foundLanguage } from "../src/sim/language.js";
import { foundPeople, musicOf } from "../src/sim/musicGenome.js";
import { composePiece, ensembleFor } from "../src/sim/musicCompose.js";

const W = () => ({ seed: 1, step: 0, languages: new Map(), _nextLanguageId: 1 });
const STEPS = [["in the city", 0.85], ["nearby", 0.5], ["across the square", 0.35], ["far off", 0.15]];

console.log("heard from            sings  with words  voice share  players  no-instrument peoples singing");
for (const [label, intim] of STEPS) {
  let sing = 0, words = 0, vs = 0, roster = 0, n = 0, mustSing = 0;
  for (let i = 0; i < 120; i++) {
    const seed = 1000 + i * 37;
    const m = musicOf(foundPeople(seed, foundLanguage(W(), { seed }), {}));
    const E = ensembleFor(m, "peace", intim);
    n++;
    if (E.sing) sing++;
    if (E.sing && E.words) words++;
    if (E.lead == null && E.sing) mustSing++;
    const ev = composePiece(m, "peace", null, intim).events || [];
    const v = ev.filter(e => e.role === "voice").length;
    vs += ev.length ? v / ev.length : 0;
    roster += new Set(ev.map(e => e.inst)).size;
  }
  console.log(label.padEnd(20),
    `${(100 * sing / n).toFixed(0)}%`.padStart(6),
    `${(100 * words / n).toFixed(0)}%`.padStart(11),
    `${(100 * vs / n).toFixed(0)}%`.padStart(12),
    (roster / n).toFixed(1).padStart(9),
    String(mustSing).padStart(30));
}
