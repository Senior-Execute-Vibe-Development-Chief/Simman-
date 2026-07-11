// Latifundia probe: does conquest wealth CONCENTRATE LAND and demand gang labour —
// the missing DEMAND engine of classical slavery (probe_erapace.mjs header, e84780f:
// classical world coerced share ~10% vs Rome's ~30-40% core; supply worked, demand
// didn't). Mechanism under test (T.LATIFUNDIA): sack plunder + tribute → gov._conqFlow
// → conqShare (extraction share of state income) → s._estates on commercial farm land
// (conquest.js) → ESTATE_PULL slave demand (settlement.js) → the existing market
// (slavery.js) clears it against the captives the same conquests supply.
//   node tools/probe_latifundia.mjs [steps=42000] [seed=8817]
//   SIM_TUNE="LATIFUNDIA=0" node tools/probe_latifundia.mjs        (the A/B)
// Reads at each checkpoint: pop-weighted coerced share (EXACTLY the LABOR_INNOV input:
// min(1, unfree/people + serf)), the slave/serf split (the colonate check: slaves must
// still fall while serfs rise late), estates, and the LARGEST realm's core reading —
// the "Rome number" the diagnostic said should reach ~30-40%.
//
// FINDINGS (measured while building, 480x240 seed 8817; A/B = LATIFUNDIA=0,SLAVE_PULL=0):
//   BASELINE (42k): classical-window peak coercedW 10.3% (slaves ~8%), top-realm core
//     ~9-15%, estates 0; colonate visible late (slaves 8.3%→0.9%, serfs 2.2%→4.8%);
//     era table Bronze 1.5x / Iron 0.3x / Medieval 0.6x / Renaissance 1.1x / Industrial 1.0x.
//   MECHANISM ITERATION (the three faults the probe caught, each fixed at the CAUSE):
//     1. Demand alone moved nothing — the world slave market ran SUPPLY-STARVED ~10:1
//        (26k posted demand vs 5.8k unfree, captive stock 0; afford/foodSec NOT binding
//        at 0.75-1.0). Fix: the price-responsive market (T.SLAVE_PULL, slavery.js).
//     2. A price-BLIND effort response then halved world population (raid pump at cap
//        everywhere). Fix: one scarcity index drives price AND effort — price rations
//        demand, effort follows price, loop self-balances.
//     3. Linear cash-suitability smeared a diffuse ~20% coerced across every warm
//        village (bronze age!). Fix: convex suitability (cs²) + realized-luxury-sales
//        gate — plantations concentrate in prime belts and wait for rich buyers.
//     4. The effort response then bled the mid-tier towns of ORGANIZED states
//        (stylized 4242: 31 cities → 4). Fix: the stateless-frontier guard — a town
//        under a crown takes a 3x greater edge to raid (slavery.js).
//   DEFINITIVE (42k, seed 8817, all levers default): era ratios vs history
//     Bronze 1.6x · IRON/CLASSICAL 0.3x → 0.6x (the named gap HALVED) · Medieval
//     0.6x → 0.9x · Renaissance 0.9x · Industrial 1.0x — the whole mid-table
//     tightened toward 1x; endgame pop 2.7M vs 2.6M baseline (demography intact).
//     World coerced ~10-11.5% through the classical stretch with STRUCTURE (mine
//     towns 40-60%, prime-cash belts, estate cores cycling with conqShare pulses
//     5-26%); the full Rome band (30-40% core, e.g. Xinash 31% at estates 0.24)
//     appears when a world grows a true conquest hegemon — not every seed does,
//     which is as it should be. Colonate preserved and legible: slaves 7-10% in the
//     classical stretch → 0.3% at 42k while serfs hold ~3.8% and estatesW recedes.
//   STYLIZED (15k, 3 seeds, SOFT_BUDGET=2): levers-ON 2/3 seeds PASS vs 0/3 at the
//     e84780f baseline (the chronology wave's "re-earn stylized" debt, confirmed by
//     the identity A/B) — the wave IMPROVES the shape: Zipf slopes moved INTO the
//     empirical envelope (the estate economy differentiates city sizes — antiquity's
//     top-heavy urban systems); 31337 still 5 marginal warns (4 at baseline).
//   IDENTITY: levers-off == e84780f exactly (2500-step state-digest diff AND a
//   line-identical 42k probe run against the pre-wave build).
//   REMAINING (next mechanism, not a dial): Iron 0.6x → 1x wants the hegemonic
//   competition channel — one power absorbing its classical rivals should also
//   collapse the competitive pressure that drives learning (competF/_rivalN).
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "42000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const world = buildSim({ W: 480, H: 240, seed: SEED });

const NAMES = ["Neolithic", "Bronze", "Iron/Classical", "Medieval", "Renaissance", "Industrial", "Modern"];
const eraCoercedPeak = [];   // per era index: peak pop-weighted coerced share seen while it was current

function snapshot(print) {
  let pop = 0, unfree = 0, captives = 0, coercedW = 0, serfW = 0, estW = 0, nEst = 0;
  const realmPop = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const p = Math.max(0, s.people || 0);
    pop += p; unfree += s._unfree || 0; captives += s._captives || 0;
    // EXACTLY the LABOR_INNOV input (settlement.js): the coerced share of the workforce.
    const co = Math.min(1, (s._unfree || 0) / Math.max(1, s.people || 1) + (s._serf || 0));
    coercedW += co * p; serfW += (s._serf || 0) * p; estW += (s._estates || 0) * p;
    if ((s._estates || 0) > 0.5) nEst++;
    if (s.countryId >= 0) realmPop.set(s.countryId, (realmPop.get(s.countryId) || 0) + p);
  }
  const top = [...realmPop.entries()].sort((a, b) => b[1] - a[1])[0];
  let core = null;
  if (top) {
    let tp = 0, tco = 0, test = 0, tun = 0;
    for (const s of world.settlements) {
      if (s.mode !== "settled" || s.countryId !== top[0]) continue;
      const p = Math.max(0, s.people || 0); tp += p;
      tco += Math.min(1, (s._unfree || 0) / Math.max(1, s.people || 1) + (s._serf || 0)) * p;
      test += (s._estates || 0) * p; tun += s._unfree || 0;
    }
    const pol = world.polities && world.polities.get(top[0]);
    const cRec = world.countries && world.countries.get ? world.countries.get(top[0]) : null;
    core = { id: top[0], name: (pol && pol.name) || "?", pop: tp,
             coerced: tco / Math.max(1, tp), est: test / Math.max(1, tp),
             slaves: tun / Math.max(1, tp), conq: (cRec && cRec._conqShare) || 0 };
  }
  const era = (world._eraAt || [0]).length - 1;
  const cw = coercedW / Math.max(1, pop);
  eraCoercedPeak[era] = Math.max(eraCoercedPeak[era] || 0, cw);
  if (!print) return;
  const pf = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : (n / 1e3 | 0) + "k";
  console.log(`step ${String(world.step).padStart(5)} era ${era}: pop ${pf(pop)}  coercedW ${(cw * 100).toFixed(1)}%  (slaves ${(unfree / Math.max(1, pop) * 100).toFixed(1)}%  serfW ${(serfW / Math.max(1, pop) * 100).toFixed(1)}%)  estatesW ${(estW / Math.max(1, pop) * 100).toFixed(1)}%  est>.5 ${nEst}  captiveStock ${pf(captives)}`
    + (core ? `\n            top realm "${core.name}" (${pf(core.pop)}): coerced ${(core.coerced * 100).toFixed(0)}%  slaves ${(core.slaves * 100).toFixed(0)}%  estates ${(core.est * 100).toFixed(0)}%  conqShare ${(core.conq * 100).toFixed(0)}%` : ""));
}

// Sample era peaks every 1500 (a short classical window can fall between wider
// checkpoints entirely), print every 3000.
for (let t = 0; t < STEPS; t += 1500) { stepPeopleSim(world, Math.min(1500, STEPS - t)); snapshot(world.step % 3000 === 0 || world.step >= STEPS); }

// Era pacing table (same scoring as probe_erapace) + the coerced-by-era summary the
// classical gap is about: LABOR_INNOV's bite is 0.6 × coerced, so classical ~35%
// coerced ≈ 21% learning suppression exactly while Rome-analogs hold the map.
const HIST = [-3300, -3000, -700, 500, 1450, 1800, 1950, 2050];
const ea = world._eraAt || [0];
console.log("\nera              reached@   dyn-yrs   hist-yrs   ratio   peak coercedW while current");
for (let e = 0; e < ea.length; e++) {
  const end = e + 1 < ea.length ? ea[e + 1] : world.step;
  const dynY = (end - ea[e]) * 0.25, histY = (HIST[e + 1] ?? 2050) - HIST[e];
  console.log(`${(NAMES[e] || "era" + e).padEnd(16)} ${String(ea[e]).padStart(7)}   ${String(Math.round(dynY)).padStart(7)}   ${String(histY).padStart(7)}   ${(dynY / histY).toFixed(1)}x     ${((eraCoercedPeak[e] || 0) * 100).toFixed(1)}%`);
}
