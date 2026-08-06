// TWO OWNER QUESTIONS FROM ONE SCREENSHOT (population lens, tw=960):
//   1. "A nation was founded in northern Australia, and the population around
//      it got greyed out?" — is URBAN_DRIFT draining the giant water-blind
//      market cell into the site tile, and by how much?
//   2. "China: super densely populated, but no nation forming" — which
//      formation gate blocks the densest cells?
//
// Instruments every city-ELIGIBLE cell (drift active): cell mass at
// eligibility vs now, the site tile's share of the cell, landmasses spanned.
// And every 5000 steps, funnels the TOP-mass cells through the land-nation
// formation gates: settlement-claimed / realm field / land paint / farming at
// the site / connected mass — printing which gate blocks each.
//
//   SIM_TUNE="DAWN_LIVE=1" node tools/probe_dimfunnel.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { labelSiteLedger, peopledBasinAt } from "../src/sim/peopleSim/crystallize.js";

const STEPS = parseInt(process.argv[2] || "25000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "960", 10);

const world = buildSim({ W, H: W / 2, seed: SEED });
const atElig = new Map();   // k → {mass, step}  (first time seen eligible)
const minted = new Set();
let evSeen = 0;

function cellStats(k) {
  const L = labelSiteLedger(world);
  const pf = world.popField, siteId = L.siteId;
  const st = L.sites[k];
  let mass = 0, tiles = 0;
  for (let i = 0; i < siteId.length; i++) if (siteId[i] === k) { mass += pf[i]; tiles++; }
  return { mass, tiles, sitePop: pf[st.ti] };
}

for (let i = 0; i < STEPS; i++) {
  stepPeopleSim(world);
  const L = labelSiteLedger(world);
  const elig = world._siteCityElig;
  // record first-eligibility baselines & report drift drain each 1000
  if (elig) for (let k = 0; k < elig.length; k++) {
    if (elig[k] >= 1 && !atElig.has(k) && !minted.has(k)) {
      const c = cellStats(k);
      atElig.set(k, { mass: c.mass, step: world.step });
      console.log(`ELIGIBLE k=${k} @${world.step} (${L.sites[k].x},${L.sites[k].y}): cell ${c.tiles}t mass ${c.mass.toFixed(0)}, site tile ${c.sitePop.toFixed(0)}`);
    }
  }
  const ev = world.events || [];
  for (; evSeen < ev.length; evSeen++) {
    const e = ev[evSeen];
    if (e.type === "settlement.founded" && e.city) {
      const ti = (e.y | 0) * world.tw + (e.x | 0);
      const k = L.siteId[ti];
      if (k >= 0) {
        minted.add(k);
        const c = cellStats(k);
        const b = atElig.get(k);
        console.log(`MINT   k=${k} @${world.step}: cell mass ${c.mass.toFixed(0)}${b ? ` (was ${b.mass.toFixed(0)} at elig — drained ${(100 * (1 - c.mass / b.mass)).toFixed(0)}% over ${world.step - b.step} steps)` : ""}`);
        atElig.delete(k);
      }
    }
  }
  if (world.step % 1000 === 0 && atElig.size) {
    for (const [k, b] of atElig) {
      if (minted.has(k)) continue;
      const c = cellStats(k);
      const share = c.mass > 0 ? c.sitePop / c.mass : 0;
      console.log(`  drift k=${String(k).padStart(4)} @${world.step}: cell ${b.mass.toFixed(0)}→${c.mass.toFixed(0)} (${(100 * (1 - c.mass / b.mass)).toFixed(0)}% drained), site tile holds ${(100 * share).toFixed(0)}% of cell`);
    }
  }
  // The China funnel: top cells by mass, which nation-formation gate blocks
  if (world.step % 5000 === 0) {
    const claims = world._siteClaims;   // may be stale by CLAIM_REFRESH — fine for a funnel readout
    const pf = world.popField, devF = world.devField, co = world._countryOwner, lo = world._landOwner;
    if (claims && pf && devF) {
      const mass = new Float64Array(L.sites.length);
      for (let t = 0; t < L.siteId.length; t++) { const k = L.siteId[t]; if (k >= 0) mass[k] += pf[t]; }
      const barF = 10 / world._onePopScale;   // TRIBAL_CENSUS / bridge (formation bar)
      const order = [...mass.keys()].sort((a, b) => mass[b] - mass[a]).slice(0, 8);
      console.log(`  ── funnel @${world.step} (top cells by people; nation bar ${barF.toFixed(0)} field units) ──`);
      for (const k of order) {
        const st = L.sites[k];
        let why;
        if (claims.claimed[k]) why = "SETTLED (a settlement claims the cell)";
        else if (co && co[st.ti] >= 0) why = `realm ${co[st.ti]} field covers the seat`;
        else if (lo && lo[st.ti] >= 0) why = `nation ${lo[st.ti]} already holds the seat`;
        else if (mass[k] < barF) why = `mass ${mass[k].toFixed(0)} < bar`;
        else {
          const b = peopledBasinAt(world, k, barF);
          why = b.mass < barF ? `connected mass ${b.mass.toFixed(0)} < bar (people across water/off-mass)`
            : b.devP < 0.45 ? `its people do not yet farm (devP ${b.devP.toFixed(2)}, seat devF ${devF[st.ti].toFixed(2)})`
            : "WOULD FORM at next cadence";
        }
        console.log(`    k=${String(k).padStart(4)} (${String(st.x).padStart(3)},${String(st.y).padStart(3)}) mass ${mass[k].toFixed(0).padStart(8)}: ${why}`);
      }
    }
  }
}
