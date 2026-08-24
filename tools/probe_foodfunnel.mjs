// THE FOOD-FLOW FUNNEL — where does grain movement die? (2026-08-24)
//
// probe_zipf measured importShare = 0.00 for every city at every checkpoint:
// nothing ships, so the agglomeration engine idles and cities cap at their
// local land (the clone-city cliff; docs/egypt-autopsy-2026-08-24.md). The
// hierarchy (foodHierarchy.js) moves grain child→liege inside ONE country's
// liege tree, levy + coin, decayed by haul survival. Five places it can die,
// each with a different fix:
//
//   TOPOLOGY — most settlements are ROOTS (stateless, or their realm has no
//              higher member): no parent, sf=0, nothing offered. The lane's
//              topology is POLITICAL, and the political map is confetti.
//   POOLS    — members have no storable surplus to offer (fed≈0.1: landFood
//              covers a tenth of demand; 20% of nothing is nothing).
//   HAUL     — offers decay exp(−d/range) before reaching the capital.
//   LEVY/COIN— offers exist but the liege can neither requisition (org below
//              LEVY_ORG_MIN) nor afford (no spare coin) to take them.
//   UNITS    — flows happen but are invisible at consumption (a lag/scale bug).
//
// This reads the stamped fields the pass itself writes (_hasFoodParent,
// _foodOffer, _foodHaul, _foodImportRate, _storableSupply, _foodNet), so no
// re-derivation. Per checkpoint, world + Egypt box.
//
//   SIM_TUNE="<live arm>" node tools/probe_foodfunnel.mjs [steps] [W] [seed] [ckpt]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { getWealthReserve, foodReach } from "../src/sim/peopleSim/settlement.js";

const STEPS = +(process.argv[2] || 25000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const CKPT = +(process.argv[5] || 2500);

const world = buildSim({ W, H, seed: SEED });
const TW = world.tw, TH = world.th;
const lonOf = (x) => (x / TW) * 360 - 180, latOf = (y) => 90 - (y / TH) * 180;
const inBox = (x, y) => { const lo = lonOf(x), la = latOf(y); return la >= 20 && la <= 33 && lo >= 24 && lo <= 36; };
const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);

console.log(`\n=== THE FOOD-FLOW FUNNEL  ${W}x${H} (tw=${TW})  seed ${SEED} ===`);
for (let done = 0; done < STEPS; done += CKPT) {
  stepPeopleSim(world, Math.min(CKPT, STEPS - done));
  const scan = (boxOnly) => {
    const r = {
      n: 0, withParent: 0, stateless: 0, capitalRoot: 0, staleRoot: 0,
      supply: 0, offers: 0, importRate: 0, need: 0, deficitNeed: 0,
      hauls: [], offersArr: [], surplus: 0, surplusN: 0,
      liegeReach: [], liegeSpare: [],
    };
    const lieges = new Set();
    for (const s of world.settlements) {
      if (s.mode !== "settled") continue;
      if (boxOnly && !inBox(s.pos.x | 0, s.pos.y | 0)) continue;
      r.n++;
      r.supply += s._storableSupply || 0;
      r.offers += s._foodOffer || 0;
      r.importRate += s._foodImportRate || 0;   // the 0.9/0.1 fold CONVERGES TO THE MEAN — ×10 (first three 2026-08-24 logs) overstated arrivals 10×; comparisons stood, absolutes did not
      const need = s._coreNeed || 0;
      r.need += need;
      const own = s._foodSupply || 0;
      if (own < need) r.deficitNeed += need - own;
      const sur = (s._storableSupply || 0) - (s._foodDemand || 0);
      if (sur > 0) { r.surplus += sur; r.surplusN++; }
      if (s._hasFoodParent) {
        r.withParent++;
        r.hauls.push(s._foodHaul || 0);
        r.offersArr.push(s._foodOffer || 0);
        if (s._foodParent) lieges.add(s._foodParent);
      } else if (s.countryId < 0) r.stateless++;
      else if (s.liegeId < 0) r.capitalRoot++;
      else r.staleRoot++;
    }
    for (const L of lieges) {
      r.liegeReach.push(foodReach(L));
      r.liegeSpare.push(Math.max(0, (L.wealth || 0) - getWealthReserve(L)));
    }
    return r;
  };
  for (const [lab, r] of [["EGYPT box", scan(true)], ["world    ", scan(false)]]) {
    if (!r.n) continue;
    console.log(`  step ${String(world.step).padStart(6)}  ${lab}: n ${String(r.n).padStart(4)} · parented ${r.withParent} (${(100 * r.withParent / r.n).toFixed(0)}%) · roots: stateless ${r.stateless} capital ${r.capitalRoot} stale ${r.staleRoot}`);
    console.log(`      pools Σ ${r.supply.toFixed(1)} · gross SURPLUS Σ ${r.surplus.toFixed(1)} (${r.surplusN} settlements) · offers Σ ${r.offers.toFixed(2)} · arriving imports Σ/tick ${r.importRate.toFixed(2)} · core deficit Σ ${r.deficitNeed.toFixed(1)}`);
    if (r.hauls.length)
      console.log(`      haul-survival p10/50/90 ${q(r.hauls, .1).toFixed(2)}/${q(r.hauls, .5).toFixed(2)}/${q(r.hauls, .9).toFixed(2)} · liege foodReach p50 ${q(r.liegeReach, .5).toFixed(2)} · liege spare coin p50 ${q(r.liegeSpare, .5).toFixed(1)}`);
  }
}
console.log(`\n  READ THE FUNNEL LEFT TO RIGHT: parented% is TOPOLOGY; surplus Σ is POOLS;`);
console.log(`  offers vs surplus is the SHIP fraction × HAUL; imports vs offers is LEVY/COIN;`);
console.log(`  imports vs core deficit is the gap the lane leaves unfed. The first stage`);
console.log(`  that collapses to ~0 is where the movement dies — fix THAT joint only.`);
