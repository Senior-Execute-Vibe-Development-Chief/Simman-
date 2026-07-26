// War-density + slave-economy breakdown (history-shape audit items 4 & 5).
// Decomposes the audit's "236-451 war events per 1k steps" into its parts and
// profiles who actually runs on the slave trade, so any mechanism work starts
// from the driver, not the aggregate.
//   Per REPORT window: war.began (+cause annotations), war.ended (+dead),
//   settlement.captured, polity.shattered, horde.raid, war.indemnity, live
//   directed front pairs, truce count, share of realms at war.
//   Slavery: unfree/captive stocks vs world population, active raider count
//   (crowned vs stateless), seller/buyer counts by income share, world slave
//   income share. Read-only. node tools/probe_war_slavery.mjs [steps] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { politiesOf } from "../src/sim/peopleSim/entities.js";

const STEPS = parseInt(process.argv[2] || "24000", 10);
const SEED  = parseInt(process.argv[3] || "8817", 10);
const W     = parseInt(process.argv[4] || "480", 10);
const H     = parseInt(process.argv[5] || "240", 10);
const REPORT = parseInt(process.env.REPORT || "2000", 10);
const IN_SLAVE = 13, OUT_SLAVE = 11;

const world = buildSim({ W, H, seed: SEED });
console.log(`war+slavery breakdown ${W}x${H} seed=${SEED} steps=${STEPS}`);

let evCursor = 0;
function report(step) {
  // ── war events this window ──
  const evs = world.events || [];
  const n = { began: 0, ended: 0, dead: 0, maxDead: 0, capt: 0, shat: 0, horde: 0, indem: 0,
    crisis: 0, claim: 0, faithClash: 0 };
  for (; evCursor < evs.length; evCursor++) {
    const e = evs[evCursor];
    switch (e.type) {
      case "war.began": n.began++; n.crisis += e.crisis || 0; n.claim += e.claim || 0; n.faithClash += e.faithClash || 0; break;
      case "war.ended": n.ended++; n.dead += e.dead || 0; if ((e.dead || 0) > n.maxDead) n.maxDead = e.dead || 0; break;
      case "settlement.captured": n.capt++; break;
      case "polity.shattered": n.shat++; break;
      case "horde.raid": n.horde++; break;
      case "war.indemnity": n.indem++; break;
    }
  }
  // ── live war state ──
  let frontPairs = 0;
  if (world._fronts && world._fronts.byCountry) for (const set of world._fronts.byCountry.values()) frontPairs += set.size || 0;
  const truces = world._truces ? world._truces.size : 0;
  let atWar = 0, realms = 0;
  if (world.countries) for (const c of world.countries.values()) {
    if (c.members.length < 1) continue;
    realms++;
    if ((c._fronts || 0) > 0) atWar++;
  }
  const alive = [...politiesOf(world).values()].filter((p) => p.endedStep < 0).length;
  const era = world._eraAt ? world._eraAt.length - 1 : 0;
  const k = 1000 / REPORT;
  console.log(`@${String(step).padStart(6)} era=${era} pol=${alive} | began/1k=${(n.began * k).toFixed(1)} (crisis=${n.crisis} claim=${n.claim} faith=${n.faithClash}) ended/1k=${(n.ended * k).toFixed(1)} capt/1k=${(n.capt * k).toFixed(1)} shat/1k=${(n.shat * k).toFixed(1)} horde/1k=${(n.horde * k).toFixed(1)} indem/1k=${(n.indem * k).toFixed(1)} | fronts=${frontPairs} truces=${truces} atWar=${atWar}/${realms} | deadTot=${Math.round(n.dead)} deadMax=${Math.round(n.maxDead)}`);

  // ── slavery ──
  let pop = 0, unfree = 0, captives = 0, raidersC = 0, raidersS = 0, sellers = 0, buyers = 0;
  let slaveIn = 0, allIn = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    pop += Math.max(0, s.people || 0);
    unfree += s._unfree || 0;
    const c = s._captives || 0;
    captives += c;
    if (c > 1) { if (s.countryId >= 0) raidersC++; else raidersS++; }
    const a = s._mInRate, o = s._mOutRate;
    if (a) {
      let tot = 0; for (let i = 0; i < a.length; i++) tot += a[i];
      slaveIn += a[IN_SLAVE]; allIn += tot;
      if (tot > 0 && a[IN_SLAVE] / tot > 0.10) sellers++;
    }
    if (o && o[OUT_SLAVE] > 0.5) buyers++;
  }
  console.log(`        slavery: unfree=${Math.round(unfree)} (${(100 * unfree / Math.max(1, pop)).toFixed(1)}% of pop) captiveStock=${Math.round(captives)} raiders crowned/stateless=${raidersC}/${raidersS} sellers(>10% inc)=${sellers} buyers=${buyers} worldSlave%=${(100 * slaveIn / Math.max(1e-9, allIn)).toFixed(1)}`);
}

const t0 = Date.now();
for (let s = 1; s <= STEPS; s++) {
  stepPeopleSim(world, 1);
  if (s % REPORT === 0) report(s);
}
console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`);
