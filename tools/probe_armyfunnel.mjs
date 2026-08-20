// THE EMPTY BARRACKS (consolidation lap, 2026-08-20): the owner's live census
// shows army = 0 for essentially every realm, which starves every decisive
// channel downstream — storm advCity ~ 0 (assaultTooWeak 11,588/11,597 at the
// shipped grid), capture adv <= 1 (2,904/2,914), and with them the whole
// death-and-absorption half of the register. This names the melt: for every
// settled settlement each checkpoint, which branch of musterArmies is it in —
// UNDERFED (fed < demand x 0.98 -> garrison melts 20%/muster), INSOLVENT
// (solvency < 1 -> melts toward BANKRUPT_DESERT), or GROWING toward its cap —
// and what the cap even is (org-scaled armyCapFrac x people).
//
//   SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1,PEER_SEATS=1" node tools/probe_armyfunnel.mjs [steps=26000] [W=960] [seed=8817]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { getPolity } from "../src/sim/peopleSim/entities.js";

const STEPS = +(process.argv[2] || 26000), W = +(process.argv[3] || 960), SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H: W >> 1, seed: SEED });
const q = (a, p) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.round(p * (b.length - 1)))]; };

console.log(`step | setts | army: sum p50 p90 max | fedFail% | insolv% | fedRatio p10/p50 | solv p10/p50 | treas p50 | org p50 | manpower p50`);
const CKPT = 2000;
for (let done = 0; done < STEPS; done += CKPT) {
  stepPeopleSim(world, Math.min(CKPT, STEPS - done));
  const setts = world.settlements.filter((s) => s.mode === "settled");
  if (!setts.length) { console.log(`${String(world.step).padStart(5)} | 0`); continue; }
  const armies = [], fedR = [], orgs = [];
  let fedFail = 0;
  for (const s of setts) {
    armies.push(s.army || 0);
    const d = s._foodDemand || 0, f = s._foodSupply || 0;
    fedR.push(d > 0 ? f / d : 1);
    if (f < d * 0.98) fedFail++;
    orgs.push((s.knowledge && s.knowledge.organization) || 0);
  }
  const solvs = [], treas = [];
  let insolv = 0, nGov = 0;
  if (world.countries) for (const c of world.countries.values()) {
    const gov = getPolity(world, c.id);
    if (!gov || gov.endedStep >= 0) continue;
    nGov++;
    const sv = gov._solvency != null ? gov._solvency : 1;
    solvs.push(sv); treas.push(Math.max(0, gov.treasury || 0));
    if (sv < 0.999) insolv++;
  }
  const mps = world._manpower ? [...world._manpower.values()] : [];
  const aSum = armies.reduce((a, b) => a + b, 0);
  console.log(
    `${String(world.step).padStart(5)} | ${String(setts.length).padStart(4)} | ${Math.round(aSum)} ${q(armies, 0.5).toFixed(1)} ${q(armies, 0.9).toFixed(1)} ${Math.round(Math.max(...armies))} | ${Math.round((fedFail / setts.length) * 100)}% | ${nGov ? Math.round((insolv / nGov) * 100) : 0}% | ${q(fedR, 0.1).toFixed(2)}/${q(fedR, 0.5).toFixed(2)} | ${q(solvs, 0.1).toFixed(2)}/${q(solvs, 0.5).toFixed(2)} | ${Math.round(q(treas, 0.5))} | ${q(orgs, 0.5).toFixed(2)} | ${Math.round(q(mps, 0.5))}`
  );
}
