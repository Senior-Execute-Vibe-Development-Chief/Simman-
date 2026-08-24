// WHAT MELTS A 6,000-CENSUS ANCHOR TO NOTHING IN ~2K STEPS? (2026-08-24)
//
// The Egypt autopsy (docs/egypt-autopsy-2026-08-24.md) established the shape:
// realms die because their SEATS die, and 19 real anchors (catchments of
// 1.2M-6.1M people, sitting capitals included) abandoned on a ~1-per-350-step
// conveyor. This decomposes the melt itself. Four candidate terms, not
// exclusive, each with a different fix — so per the second cardinal rule none
// gets built against until one is convicted:
//
//   STARVATION   — chronic core underfeeding (_fedM low; STARVE_SHED melts
//                  the capacity floor, the field redistributes away)
//   FAMINE SHOCK — _harvestMul windows compounding on vulnerability-weighted
//                  re-draws (famine-active share of the final steps high)
//   COMPETITION  — the accelerating mint slices the anchor's worked territory
//                  (_terrTiles falls while _fedM stays fine)
//   GRAVEYARD    — endemic disease 0.5-0.75 with no health tech (disease high
//                  while food and territory stay fine)
//
// Method: every SAMPLE steps, record the live state of every ANCHOR-class
// settlement (people >= ANCHOR_BAR) in the box. When one leaves the settled
// set, print its final-window trajectory. At the end, print a decomposition
// table over each dead anchor's final DECOMP_WIN steps — and the SAME columns
// for the survivors, because the contrast is the conviction: a term that is
// equally bad on survivors convicts nothing.
//
// Same regime as the autopsy:
//   SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1,PEER_SEATS=1,FOUND_DRIFT=1,ABSORB_ORG_ERA=1,TRIBUTE_UP=0.33,ENGULF=8,FEAR_REACH=1,WAR_FINISH=1,SMALL_WAR=8,RELIEF_REACH=1,EXCH_WAVE=3,TECH_USE=1,VASSAL_LEVY=0.5,DISSOLVE_CORE=1,SETT_STRIDE=3,TRADE_STRIDE=5" \
//     node tools/probe_anchormelt.mjs [steps=25000] [W=480] [seed=8817] [sample=100]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { eventsFor } from "../src/sim/peopleSim/events.js";

const STEPS = +(process.argv[2] || 25000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const SAMPLE = +(process.argv[5] || 100);
const ANCHOR_BAR = 200;        // the city-catchment bar: a real settlement
const DECOMP_WIN = 2000;       // final window the decomposition reads

const world = buildSim({ W, H, seed: SEED });
const TW = world.tw, TH = world.th;
const lonOf = (x) => (x / TW) * 360 - 180, latOf = (y) => 90 - (y / TH) * 180;
const LAT0 = 20, LAT1 = 33, LON0 = 24, LON1 = 36;
const inBox = (x, y) => { const lo = lonOf(x), la = latOf(y); return la >= LAT0 && la <= LAT1 && lo >= LON0 && lo <= LON1; };

// per-anchor sampled history: sid -> { name, rows: [{step,people,urban,fedM,supply,coreNeed,terr,work,dis,famine,harvest,besieged,cid,army}] }
const hist = new Map();
const dead = [];   // { sid, name, atStep (last settled sample), deathEv }

console.log(`\n=== ANCHOR MELT DECOMPOSITION  ${W}x${H} (tw=${TW})  seed ${SEED}  bar ${ANCHOR_BAR}  box lon ${LON0}..${LON1} lat ${LAT0}..${LAT1} ===`);

let prevAnchors = new Set();
for (let done = 0; done < STEPS; done += SAMPLE) {
  stepPeopleSim(world, Math.min(SAMPLE, STEPS - done));
  const now = new Set();
  for (const s of world.settlements) {
    if (s.mode !== "settled" || !inBox(s.pos.x | 0, s.pos.y | 0)) continue;
    const h = hist.get(s.id);
    if ((s.people || 0) < ANCHOR_BAR && !h) continue;   // once an anchor, always tracked (so the melt's tail is recorded)
    now.add(s.id);
    let hh = h;
    if (!hh) hist.set(s.id, hh = { name: s.name, rows: [] });
    hh.name = s.name || hh.name;
    hh.rows.push({
      step: world.step,
      people: s.people || 0, urban: s._urbanPop || 0,
      fedM: s._fedM !== undefined ? s._fedM : -1,
      supply: s._foodSupply || 0, coreNeed: s._coreNeed || 0,
      terr: s._terrTiles || 0, work: s._terrWorkTiles ?? -1,
      dis: s._diseaseLoad || 0,
      famine: world.step < (s._famineUntil || 0) ? 1 : 0,
      harvest: s._harvestMul !== undefined ? s._harvestMul : 1,
      besieged: s._besiegedNow ? 1 : 0,
      cid: s.countryId, army: s.army || 0,
    });
  }
  for (const sid of prevAnchors) {
    if (now.has(sid)) continue;
    const hh = hist.get(sid);
    let deathEv = "";
    for (const ev of eventsFor(world, "s:" + sid))
      if (ev.type === "settlement.abandoned" || ev.type === "settlement.withered" || ev.type === "settlement.dissolved")
        deathEv = `${ev.type.replace("settlement.", "")}${ev.why ? "(" + ev.why + ")" : ""} @ ${ev.step}`;
    dead.push({ sid, name: hh.name, atStep: world.step, deathEv });
    console.log(`\n  ✝ ANCHOR DIED: ${hh.name} (id ${sid}) — ${deathEv || "no death event (moved/captured out?)"} — final trajectory:`);
    console.log(`     step   people  urban   fedM  supply/coreNeed   terr work   dis  fam hvst siege  cid  army`);
    const win = hh.rows.filter((r) => r.step >= world.step - DECOMP_WIN);
    for (const r of win)
      console.log(`   ${String(r.step).padStart(6)}  ${String(Math.round(r.people)).padStart(6)} ${String(Math.round(r.urban)).padStart(6)}  ${r.fedM < 0 ? "  -  " : r.fedM.toFixed(2).padStart(5)}  ${r.supply.toFixed(1).padStart(7)}/${r.coreNeed.toFixed(1).padEnd(7)}  ${String(r.terr).padStart(4)} ${String(r.work).padStart(4)}  ${r.dis.toFixed(2)}  ${r.famine}  ${r.harvest.toFixed(2)}  ${r.besieged}   ${String(r.cid).padStart(4)}  ${String(Math.round(r.army)).padStart(4)}`);
  }
  prevAnchors = now;
}

// ── the decomposition table ──
const decompose = (hh, endStep) => {
  const win = hh.rows.filter((r) => r.step >= endStep - DECOMP_WIN && r.step <= endStep);
  if (win.length < 2) return null;
  const first = win[0], last = win[win.length - 1];
  const mean = (f) => win.reduce((a, r) => a + f(r), 0) / win.length;
  return {
    n: win.length,
    p0: first.people, p1: last.people,
    terr0: first.terr, terr1: last.terr,
    fedM: mean((r) => (r.fedM < 0 ? 1 : r.fedM)),
    famShare: mean((r) => r.famine),
    hvst: mean((r) => r.harvest),
    dis: mean((r) => r.dis),
    siege: mean((r) => r.besieged),
    solv: mean((r) => (r.coreNeed > 0 ? Math.min(2, r.supply / r.coreNeed) : 1)),
  };
};
const row = (tag, name, sid, d, extra) =>
  console.log(`  ${tag}  ${(name || "?").slice(0, 13).padEnd(13)} ${String(sid).padStart(5)}  ${String(Math.round(d.p0)).padStart(6)}→${String(Math.round(d.p1)).padEnd(6)} ${String(d.terr0).padStart(4)}→${String(d.terr1).padEnd(4)}  ${d.fedM.toFixed(2).padStart(5)}  ${d.solv.toFixed(2).padStart(5)}  ${(100 * d.famShare).toFixed(0).padStart(4)}%  ${d.hvst.toFixed(2).padStart(5)}  ${d.dis.toFixed(2).padStart(4)}  ${(100 * d.siege).toFixed(0).padStart(4)}%  ${extra || ""}`);

console.log(`\n=== DECOMPOSITION — each DEAD anchor's final ${DECOMP_WIN} steps ===`);
console.log(`       name              id   people        terr       fedM   sup/need  fam%   hvst   dis  siege`);
for (const d of dead) {
  const hh = hist.get(d.sid);
  const dc = decompose(hh, d.atStep);
  if (dc) row("✝", d.name, d.sid, dc, d.deathEv);
}
console.log(`\n=== CONTROL — every SURVIVING anchor's final ${DECOMP_WIN} steps (the contrast is the conviction) ===`);
console.log(`       name              id   people        terr       fedM   sup/need  fam%   hvst   dis  siege`);
for (const [sid, hh] of hist) {
  if (dead.some((d) => d.sid === sid)) continue;
  const lastRow = hh.rows[hh.rows.length - 1];
  if (!lastRow || lastRow.step < world.step - SAMPLE || lastRow.people < ANCHOR_BAR) continue;
  const dc = decompose(hh, world.step);
  if (dc) row(" ", hh.name, sid, dc);
}
console.log(`\n  READ IT THIS WAY: a term convicts only where it separates the dead from the`);
console.log(`  survivors. fedM low on both = background; terr collapsing only on the dead =`);
console.log(`  competition; fam%/hvst worse on the dead = the shock channel; dis equal = fuel,`);
console.log(`  not trigger. sup/need is the INSTANT core solvency (capped at 2).`);
console.log("");
