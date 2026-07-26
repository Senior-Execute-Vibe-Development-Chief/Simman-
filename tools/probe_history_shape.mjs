// History-shape sweep for the 2026-07 playtest notes. One run measures, on the
// same world, every claim in the review:
//   A. POLITY IMMORTALITY — per-id lifecycle ledger (shatters, restorations,
//      re-foundings), sticky-death rate, lifespan of secession-born states
//      (the "90 provinces secede and are reabsorbed in decades" oscillation).
//   B. EVENT PACING BY ERA — polity/war events per 1k steps per live polity,
//      with the leading era at each window ("too much activity in the stone age").
//   C. FAITH CONCENTRATION — top-faith share of world population, #faiths ≥5%,
//      HHI ("a single faith sweeps everything").
//   D. SLAVE ECONOMY BREADTH — share of realms with slave-trade income >10% /
//      in top-3 sources; world slave share of all income ("everyone slaves").
//   E. EARTH REGIONS — pop / settlements / mean org & agri knowledge / claimed%
//      / capitals for Sub-Saharan Africa, India, Europe, East Asia, MENA, plus
//      a t=0 fertility/climate diagnosis per region ("India stays blank",
//      "sub-Saharan Africa not held back").
// Read-only; app-identical pipeline. node tools/probe_history_shape.mjs [steps] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { politiesOf } from "../src/sim/peopleSim/entities.js";

const STEPS = parseInt(process.argv[2] || "24000", 10);
const SEED  = parseInt(process.argv[3] || "8817", 10);
const W     = parseInt(process.argv[4] || "480", 10);
const H     = parseInt(process.argv[5] || "240", 10);
const CHECK = parseInt(process.env.CHECK || "2000", 10);
const IN_SLAVE = 13;   // money.js IN_SLAVE_TRADE

const world = buildSim({ W, H, seed: SEED });
console.log(`history-shape ${W}x${H} seed=${SEED} steps=${STEPS}`);

// Fractional-coordinate boxes on the earth_sim projection (fy 0.5 = equator,
// lat ≈ (0.5−fy)·180; fx 0.5 ≈ 0° lon). Coarse by design — relative readings.
const REGIONS = [
  { key: "SubSah",  fx0: 0.44, fx1: 0.62,  fy0: 0.42, fy1: 0.66 },
  { key: "India",   fx0: 0.685, fx1: 0.755, fy0: 0.32, fy1: 0.46 },
  { key: "Europe",  fx0: 0.47, fx1: 0.615, fy0: 0.16, fy1: 0.30 },
  { key: "EastAsia", fx0: 0.775, fx1: 0.85, fy0: 0.26, fy1: 0.39 },
  { key: "MENA",    fx0: 0.44, fx1: 0.67,  fy0: 0.29, fy1: 0.42 },
];
const inBox = (r, x, y) => { const fx = x / world.tw, fy = y / world.th; return fx >= r.fx0 && fx <= r.fx1 && fy >= r.fy0 && fy <= r.fy1; };

// t=0 terrain diagnosis per region (land tiles only)
{
  console.log("t=0 terrain (land tiles): region  land  fert>0.4  meanFert  meanTemp  meanMoist");
  for (const r of REGIONS) {
    let n = 0, f4 = 0, fS = 0, tS = 0, mS = 0;
    for (let y = 0; y < world.th; y++) for (let x = 0; x < world.tw; x++) {
      if (!inBox(r, x, y)) continue;
      const ti = y * world.tw + x;
      if ((world.elev[ti] || 0) <= 0) continue;
      n++; const f = world.fert[ti] || 0;
      if (f > 0.4) f4++;
      fS += f; tS += world.temp[ti] || 0; mS += world.moist[ti] || 0;
    }
    console.log(`  ${r.key.padEnd(8)} ${String(n).padStart(5)}  ${String(f4).padStart(5)}  ${(fS / Math.max(1, n)).toFixed(3)}     ${(tS / Math.max(1, n)).toFixed(3)}     ${(mS / Math.max(1, n)).toFixed(3)}`);
  }
}

function checkpoint(step) {
  const alive = [...politiesOf(world).values()].filter((p) => p.endedStep < 0).length;
  const era = world._eraAt ? world._eraAt.length - 1 : 0;
  // C. faith shares (population-weighted)
  const byFaith = new Map(); let popTot = 0;
  // D. slave income
  let slaveRealmTop = 0, realmN = 0, slaveIncome = 0, allIncome = 0;
  const realmIn = new Map();   // cid -> [slave, total]
  const regStats = new Map(REGIONS.map((r) => [r.key, { pop: 0, sett: 0, org: 0, agri: 0, caps: 0 }]));
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const ppl = Math.max(0, s.people || 0); popTot += ppl;
    if (s.faithMix) for (const [fid, share] of s.faithMix) byFaith.set(fid, (byFaith.get(fid) || 0) + ppl * share);
    const a = s._mInRate;
    if (a) {
      let tot = 0; for (let i = 0; i < a.length; i++) tot += a[i];
      slaveIncome += a[IN_SLAVE]; allIncome += tot;
      if (s.countryId >= 0) {
        const e = realmIn.get(s.countryId) || [0, 0];
        e[0] += a[IN_SLAVE]; e[1] += tot; realmIn.set(s.countryId, e);
      }
    }
    for (const r of REGIONS) if (inBox(r, s.pos.x, s.pos.y)) {
      const g = regStats.get(r.key);
      g.pop += ppl; g.sett++;
      g.org += (s.knowledge?.organization || 0); g.agri += (s.knowledge?.agriculture || 0);
    }
  }
  for (const [, e] of realmIn) { realmN++; if (e[1] > 0 && e[0] / e[1] > 0.10) slaveRealmTop++; }
  const shares = [...byFaith.values()].map((v) => v / Math.max(1, popTot)).sort((a, b) => b - a);
  const hhi = shares.reduce((s, x) => s + x * x, 0);
  const big = shares.filter((x) => x >= 0.05).length;
  if (world.countries) for (const c of world.countries.values()) {
    if (!c.capital) continue;
    for (const r of REGIONS) if (inBox(r, c.capital.pos.x, c.capital.pos.y)) regStats.get(r.key).caps++;
  }
  // claimed% per region
  const claimed = new Map(REGIONS.map((r) => [r.key, [0, 0]]));
  const co = world._countryOwner;
  if (co) for (let y = 0; y < world.th; y++) for (let x = 0; x < world.tw; x++) {
    const ti = y * world.tw + x;
    if ((world.elev[ti] || 0) <= 0) continue;
    for (const r of REGIONS) if (inBox(r, x, y)) { const e = claimed.get(r.key); e[1]++; if (co[ti] >= 0) e[0]++; }
  }
  console.log(`@${String(step).padStart(6)} era=${era} polities=${alive} | faith top=${(100 * (shares[0] || 0)).toFixed(0)}% n≥5%=${big} HHI=${hhi.toFixed(2)} | slave: realms>10% ${slaveRealmTop}/${realmN}, world ${(100 * slaveIncome / Math.max(1e-9, allIncome)).toFixed(1)}%`);
  const rows = REGIONS.map((r) => {
    const g = regStats.get(r.key), cl = claimed.get(r.key);
    const org = g.sett ? (g.org / g.sett).toFixed(2) : "-";
    const agri = g.sett ? (g.agri / g.sett).toFixed(2) : "-";
    return `${r.key} s=${g.sett} pop=${(g.pop / 1000).toFixed(1)}k org=${org} agri=${agri} cl=${(100 * cl[0] / Math.max(1, cl[1])).toFixed(0)}% cap=${g.caps}`;
  });
  console.log(`         ${rows.join(" | ")}`);
}

// B. event pacing per window
let evCursor = 0, lastAlive = 1;
function pacing(step) {
  const evs = world.events || [];
  let pol = 0, war = 0;
  for (; evCursor < evs.length; evCursor++) {
    const t = evs[evCursor].type;
    if (t.startsWith("polity.")) pol++;
    else if (t.startsWith("war.") || t === "settlement.captured") war++;
  }
  const alive = [...politiesOf(world).values()].filter((p) => p.endedStep < 0).length || 1;
  const era = world._eraAt ? world._eraAt.length - 1 : 0;
  console.log(`  pacing @${String(step).padStart(6)} era=${era} live=${alive} polityEv/1k=${(pol / CHECK * 1000).toFixed(1)} warEv/1k=${(war / CHECK * 1000).toFixed(1)} perPolity=${((pol + war) / CHECK * 1000 / alive).toFixed(2)}`);
  lastAlive = alive;
}

const t0 = Date.now();
for (let s = 1; s <= STEPS; s++) {
  stepPeopleSim(world, 1);
  if (s % CHECK === 0) { checkpoint(s); pacing(s); }
}

// A. lifecycle ledger from the full event log + registry
{
  const per = new Map();   // id -> {found:0, end:0, rest:0, shat:0, sec:0}
  const get = (id) => { let e = per.get(id); if (!e) { e = { found: 0, end: 0, rest: 0, shat: 0, sec: 0 }; per.set(id, e); } return e; };
  const secBorn = new Map();   // id -> foundedStep (via secession/fragment)
  for (const ev of world.events || []) {
    if (ev.type === "polity.founded") { get(ev.polity).found++; if (ev.how === "fragment") secBorn.set(ev.polity, ev.step); }
    else if (ev.type === "polity.ended") get(ev.polity).end++;
    else if (ev.type === "polity.restored") get(ev.polity).rest++;
    else if (ev.type === "polity.shattered") get(ev.polity).shat++;
    else if (ev.type === "polity.seceded") { get(ev.polity).sec++; secBorn.set(ev.polity, ev.step); }
  }
  const reg = politiesOf(world);
  let ever = reg.size, aliveEnd = 0, deadStuck = 0, elastic = 0, multiShat = 0, maxShat = 0, maxShatId = -1;
  for (const [id, p] of reg) {
    const e = per.get(id) || { end: 0, rest: 0, shat: 0 };
    if (p.endedStep < 0) aliveEnd++;
    else if (e.rest === 0) deadStuck++;
    if (e.rest >= 1 || e.shat >= 2) elastic++;
    if (e.shat >= 3) multiShat++;
    if (e.shat > maxShat) { maxShat = e.shat; maxShatId = id; }
  }
  // secession-born lifespans
  const lifes = [];
  for (const [id, born] of secBorn) {
    const p = reg.get(id); if (!p) continue;
    lifes.push((p.endedStep >= 0 ? p.endedStep : STEPS) - born);
  }
  lifes.sort((a, b) => a - b);
  const q = (f) => lifes.length ? lifes[Math.min(lifes.length - 1, Math.floor(f * lifes.length))] : 0;
  const under2k = lifes.filter((x) => x < 2000).length;
  console.log(`\n== lifecycle ==`);
  console.log(`polities ever=${ever} aliveAtEnd=${aliveEnd} deadAndStayedDead=${deadStuck} (${(100 * deadStuck / Math.max(1, ever)).toFixed(0)}%) elastic(restored or 2+ shatters)=${elastic} 3+shatters=${multiShat} maxShatters=${maxShat} (${reg.get(maxShatId)?.name || maxShatId})`);
  console.log(`secession/fragment-born: n=${lifes.length} lifespan p25/p50/p75=${q(0.25)}/${q(0.5)}/${q(0.75)} steps; died<2000 steps: ${under2k} (${(100 * under2k / Math.max(1, lifes.length)).toFixed(0)}%)`);
  const eras = world._eraAt || [];
  console.log(`eras reached: ${eras.map((s2, i) => `${i}@${s2}`).join(" ")}`);
}
console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`);
