// The SIZE LOOP: is the territory target self-referential, and where is its gain?
//
// The quota model (countryTerritory.js, T.SIZE_BY_POP) sets
//     target = govPop / bindDens          govPop = Σ popField over OWNED tiles
// so with d = people per owned tile the target is k·held with GAIN
//     k = d / bindDens.
// That has no interior fixed point: k>1 runs away upward until frontier dilution
// pulls d down, k<1 RATCHETS the realm down to its one-tile anchor core (each pass
// sheds to k·held, which lowers govPop, which lowers the target again). This probe
// measures k directly, per checkpoint, so the regime is visible instead of inferred.
//
// It also measures the OTHER half of the loop: a settled settlement's economic
// catchment is clipped to its own country's ground (T.CATCHMENT_CLIP), while a
// STATELESS one may work wilderness — so founding a state can shrink a village's
// fields, which shrinks its food, its people, govPop, and the target again. The
// stateless-vs-stated catchment split says whether that penalty is real and how big.
//
//   node tools/probe_sizeloop.mjs [W=960] [steps=8000] [ck=1000] [seed=8817]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";
import { resScaleFor } from "../src/sim/peopleSim/countryTerritory.js";
import { stepToYear } from "../src/sim/calendar.js";

const W = +(process.argv[2] || 960), H = W >> 1;
const STEPS = +(process.argv[3] || 8000), CK = +(process.argv[4] || 1000);
const SEED = +(process.argv[5] || 8817);

const w = buildSim({ W, H, seed: SEED });
const { N, elev } = w;
const r2 = (rs => rs * rs)(resScaleFor(w.tw));
const bindDens = (T.RURAL_BIND_DENS ?? 8000) / r2;      // people per SIM tile
let land = 0; for (let i = 0; i < N; i++) if (elev[i] > 0) land++;
const kkm2 = (510e6 * 0.29) / land / 1000;
const yr = s => { const y = Math.round(stepToYear(s)); return y < 0 ? `${-y}BC` : `${y}AD`; };
const med = a => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };

console.log(`tw=${w.tw} r2=${r2} bindDens=${bindDens.toFixed(0)}/sim-tile  ${Math.round(kkm2)}k km2/tile  seed=${SEED}`);
console.log("step\tyear\tn\tclaim%\tmed_t\tmax_t\tGAIN k\tgovPop\tcatch_state\tcatch_free\tk_cap");

for (let t = CK; t <= STEPS; t += CK) {
  stepPeopleSim(w, CK);
  const co = w._countryOwner, pf = w.popField;
  const held = new Map(); let claimed = 0, govPop = 0;
  for (let i = 0; i < N; i++) {
    if (!(elev[i] > 0)) continue;
    const c = co[i]; if (c < 0) continue;
    claimed++; govPop += pf ? pf[i] : 0;
    held.set(c, (held.get(c) || 0) + 1);
  }
  const sizes = [...held.values()].sort((a, b) => a - b);
  // GAIN: mean people per governed tile against the density one tile costs.
  // >1 the quota funds expansion; <1 every realm ratchets to its anchor core.
  const k = claimed > 0 ? (govPop / claimed) / bindDens : 0;
  // The catchment penalty of statehood: worked tiles, stated vs stateless.
  const cs = [], cf = [];
  for (const s of w.settlements) {
    if (s.mode !== "settled") continue;
    (s.countryId >= 0 ? cs : cf).push(s._terrTiles || 0);
  }
  // The CAPITAL-tile gain: can the densest tile a realm owns fund even itself?
  const capK = [];
  if (w.countries) for (const c of w.countries.values()) {
    if (!c.capital || c.capital.mode !== "settled") continue;
    const ti = (c.capital.pos.y | 0) * w.tw + (c.capital.pos.x | 0);
    if (elev[ti] > 0 && pf) capK.push(pf[ti] / bindDens);
  }
  console.log([t, yr(t), sizes.length, (100 * claimed / land).toFixed(2),
    sizes.length ? sizes[sizes.length >> 1] : 0, sizes[sizes.length - 1] || 0,
    k.toFixed(3), Math.round(govPop), `${med(cs)} (n=${cs.length})`, `${med(cf)} (n=${cf.length})`,
    med(capK).toFixed(2)].join("\t"));
}
