// DOES A CONQUEST STICK? — the fate of every tile an army actually takes.
//
// armies.js flips political tiles directly (`owner[cti] = att.id; capturedAt[cti] =
// step`), so conquest DOES reach the map. The open question is whether the territory
// pass then hands it straight back: fieldPolityTerritory re-derives extent every pass
// from the size target, and its over-capacity shed pins only HOME tiles and WORKED
// catchment — a freshly captured march is neither, and it is by construction the most
// REMOTE candidate, which is exactly the order the shed releases in.
//
// This watches world._tileCapturedAt for new captures, records who took each tile, and
// re-checks the same tiles later: still the captor's, back with the original owner, or
// released to wilderness. A conquest system that works keeps most of them.
//
//   node tools/probe_holdconquest.mjs [W=480] [steps=20000] [seed=8817] [holdAge=1000]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const W = +(process.argv[2] || 480), H = W >> 1;
const STEPS = +(process.argv[3] || 20000), SEED = +(process.argv[4] || 8817);
const HOLD_AGE = +(process.argv[5] || 1000);   // how long after capture we judge the outcome
const SCAN = 250;                              // capture-detection cadence (must be < grace)

const w = buildSim({ W, H, seed: SEED });
const { N } = w;
let seen = new Float64Array(N).fill(-Infinity);
const pending = [];    // {ti, captor, victim, at}
let nCap = 0, held = 0, lost = 0, wild = 0, retaken = 0;

const judge = (upTo) => {
  const co = w._countryOwner;
  while (pending.length && pending[0].at <= upTo) {
    const p = pending.shift();
    const now = co[p.ti];
    if (now === p.captor) held++;
    else if (now < 0) wild++;
    else if (now === p.victim) { lost++; retaken++; }
    else lost++;
  }
};

console.log(`tw=${w.tw} seed=${SEED} steps=${STEPS} holdAge=${HOLD_AGE}`);
console.log("step\tcaptures\tHELD%\ttoWILD%\tretaken/other%\trealms");
for (let t = SCAN; t <= STEPS; t += SCAN) {
  const before = w._countryOwner ? w._countryOwner.slice() : null;
  stepPeopleSim(w, SCAN);
  const cap = w._tileCapturedAt, co = w._countryOwner;
  if (cap && co) {
    for (let i = 0; i < N; i++) {
      if (cap[i] > seen[i]) {                       // a fresh capture this block
        seen[i] = cap[i];
        pending.push({ ti: i, captor: co[i], victim: before ? before[i] : -1, at: cap[i] + HOLD_AGE });
        nCap++;
      }
    }
  }
  judge(w.step);
  if (t % 2500 === 0) {
    const done = held + lost + wild;
    const pc = (x) => done ? `${Math.round(100 * x / done)}%` : "-";
    console.log([t, nCap, pc(held), pc(wild), pc(lost), w.countries ? w.countries.size : 0].join("\t"));
  }
}
const done = held + lost + wild;
console.log(`\nSUMMARY captures=${nCap} judged=${done}  HELD=${held} (${done ? Math.round(100 * held / done) : 0}%)  toWILD=${wild}  lostToAnother=${lost} (retakenByVictim=${retaken})`);
