// THE EGYPT AUTOPSY — what kills the Nile realm? (2026-08-24)
//
// probe_egypt (32f10df, live-arm regime) measured the finding this instrument
// exists to explain: the realm ruling the Nile core reaches 866,799 km² — 87%
// of modern Egypt, the best large-state result the sim has produced — at step
// 17,500, and by 20,000 it holds ZERO tiles; the cradle anchor itself churns
// names every checkpoint (Ňěňní → Fị̀ptàị → Tụ̀ị → Tāptáịkò) and its catchment
// goes 57 → 42 → 0 → 8. That is not a border shifting — the settlement complex
// itself is dying. Three different deaths would each explain the checkpoints,
// and they call for completely different fixes:
//
//   CONQUEST    — a rival stormed the valley (fix lives in war/peace terms)
//   DISSOLUTION — the polity fell apart from inside: secession, recede-lapse,
//                 DISSOLVE_CORE fading its cities (fix lives in the admin/
//                 capacity ledger or the dissolve bars)
//   STARVATION  — the basin itself emptied: famine/plague/urban-graveyard
//                 killed the people and the cities followed (fix lives in the
//                 food economy / disease, and the flags were never the story)
//
// The sim already writes the death certificates — logEvent records
// settlement.abandoned/withered/dissolved(why basin|core), settlement.captured/
// lapsed, polity.ended(how)/shattered/seceded/receded, famine.struck,
// plague.outbreak, war.* — so this probe runs the window ONCE and then reads
// the log, instead of re-deriving causes from side effects. Dead settlements
// are REMOVED from world.settlements (state.js sweep), so a registry of
// everything ever seen in the box is kept as the run goes.
//
// Measured at the regime where the finding lives: seed 8817, W=480 (tw=240),
// FULL LIVE arm. Run it exactly as the trio ran:
//
//   SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1,PEER_SEATS=1,FOUND_DRIFT=1,ABSORB_ORG_ERA=1,TRIBUTE_UP=0.33,ENGULF=8,FEAR_REACH=1,WAR_FINISH=1,SMALL_WAR=8,RELIEF_REACH=1,EXCH_WAVE=3,TECH_USE=1,VASSAL_LEVY=0.5,DISSOLVE_CORE=1,SETT_STRIDE=3,TRADE_STRIDE=5" \
//     node tools/probe_egyptfate.mjs [steps=25000] [W=480] [seed=8817] [sample=100]
//
// Time-series rows print AS SAMPLED (a truncated run still yields its series);
// the event dump and the life tables print at the end.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { eventsFor, narrate } from "../src/sim/peopleSim/events.js";

const STEPS = +(process.argv[2] || 25000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const SAMPLE = +(process.argv[5] || 100);

const world = buildSim({ W, H, seed: SEED });
const TW = world.tw, TH = world.th, N = world.N;
const lonOf = (x) => (x / TW) * 360 - 180, latOf = (y) => 90 - (y / TH) * 180;
// probe_egypt's exact box — continuity with the finding
const LAT0 = 20, LAT1 = 33, LON0 = 24, LON1 = 36;
const inBox = (x, y) => { const lo = lonOf(x), la = latOf(y); return la >= LAT0 && la <= LAT1 && lo >= LON0 && lo <= LON1; };
const DLAT_KM = (180 / TH) * 111.32;
const tileKm2 = (y) => DLAT_KM * (360 / TW) * 111.32 * Math.cos(latOf(y) * Math.PI / 180);

const boxTiles = [];
for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) if (inBox(x, y)) boxTiles.push(y * TW + x);
const boxLand = boxTiles.filter((ti) => world.elev[ti] > 0);

// ── registries (dead settlements are swept from world.settlements) ──
const reg = new Map();       // sid -> {name,x,y,first,lastSettled,peak,tier,cid}
const realmSeen = new Map(); // cid -> {first,peakTiles,peakBoxTiles,peakMem,name}
const note = (s) => {
  let r = reg.get(s.id);
  if (!r) reg.set(s.id, r = { name: s.name, x: s.pos.x | 0, y: s.pos.y | 0, first: world.step, lastSettled: -1, peak: 0, tier: 0, cid: -1 });
  r.name = s.name || r.name;
  if (s.mode === "settled") {
    r.lastSettled = world.step;
    if (s.people > r.peak) r.peak = s.people;
    if ((s.tier | 0) > r.tier) r.tier = s.tier | 0;
    r.cid = s.countryId;
  }
  return r;
};

const MORTAL = new Set([
  "settlement.abandoned", "settlement.withered", "settlement.dissolved",
  "settlement.captured", "settlement.annexed", "settlement.lapsed",
  "settlement.founded", "settlement.tier",
  "polity.founded", "polity.tablet", "polity.ended", "polity.shattered",
  "polity.seceded", "polity.receded", "polity.restored", "polity.submitted", "polity.united",
  "famine.struck", "plague.outbreak", "plague.virginSoil", "market.dearth",
  "war.began", "war.ended", "war.claimWon", "war.indemnity",
  "horde.raid", "succession.crisis", "slave.revolt", "town.planted",
]);

let evCursor = 0;
function digestNewEvents() {
  const evs = world.events || [];
  for (; evCursor < evs.length; evCursor++) {
    const ev = evs[evCursor];
    // register any settlement actor we haven't seen (position at event time)
    if (ev.s != null && ev.s >= 0 && !reg.has(ev.s)) {
      for (const s of world.settlements) if (s.id === ev.s) { note(s); break; }
    }
  }
}

console.log(`\n=== EGYPT AUTOPSY  ${W}x${H} (tw=${TW})  seed ${SEED}  box lon ${LON0}..${LON1} lat ${LAT0}..${LAT1} (${boxLand.length} land tiles) ===`);
console.log(`  step | box: sett  Σpeople | largest (people/urban  fed  dis  org) cid | realm@box: id  boxT  worldT   km²  mem  cap/load  fronts | field: Σpop  Σcap`);

const co = () => world._countryOwner;
for (let done = 0; done < STEPS; done += SAMPLE) {
  stepPeopleSim(world, Math.min(SAMPLE, STEPS - done));
  digestNewEvents();

  // box settlement census
  let n = 0, tot = 0, big = null;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    if (!inBox(s.pos.x | 0, s.pos.y | 0)) continue;
    note(s);
    n++; tot += s.people;
    if (!big || s.people > big.people) big = s;
  }

  // owner census over box tiles
  const own = new Map();
  const grid = co();
  if (grid) for (const ti of boxTiles) { const c = grid[ti]; if (c >= 0) own.set(c, (own.get(c) || 0) + 1); }
  let top = -1, topT = 0;
  for (const [cid, t] of own) { if (t > topT) { top = cid; topT = t; } }
  for (const [cid, t] of own) {
    let rs = realmSeen.get(cid);
    if (!rs) realmSeen.set(cid, rs = { first: world.step, peakTiles: 0, peakBoxTiles: 0, peakMem: 0, name: "" });
    if (t > rs.peakBoxTiles) rs.peakBoxTiles = t;
  }

  // tracked realm = top box owner
  let realmStr = "        (no realm owns the box)";
  if (top >= 0) {
    let wt = 0, km2 = 0;
    if (grid) for (let y = 0; y < TH; y++) { const a = tileKm2(y); const off = y * TW; for (let x = 0; x < TW; x++) if (grid[off + x] === top) { wt++; km2 += a; } }
    const c = world.countries ? world.countries.get(top) : null;
    const gov = world.polities ? world.polities.get(top) : null;
    const rs = realmSeen.get(top);
    if (rs) { if (wt > rs.peakTiles) rs.peakTiles = wt; if (c && c.members && c.members.length > rs.peakMem) rs.peakMem = c.members.length; if (gov && gov.name) rs.name = gov.name; }
    const cap = c && c._capacity != null ? c._capacity.toFixed(0) : (gov && gov._capAbs != null ? gov._capAbs.toFixed(0) : "-");
    const load = c && c._loadTotal != null ? c._loadTotal.toFixed(0) : (gov && gov._loadAbs != null ? gov._loadAbs.toFixed(0) : "-");
    realmStr = `${String(top).padStart(4)} ${String(topT).padStart(4)} ${String(wt).padStart(6)} ${String(Math.round(km2 / 1000)).padStart(5)}k ${String(c && c.members ? c.members.length : 0).padStart(4)}  ${cap}/${load}  ${String((c && c._fronts) || 0).padStart(2)}`;
  }

  // field sums
  let fp = 0, fc = 0;
  const pf = world.popField, cf = world.capField;
  if (pf && cf) for (const ti of boxLand) { fp += pf[ti]; fc += cf[ti]; }

  let bigStr = "  (none)";
  if (big) {
    // CORE solvency, not the notional whole-census ratio: _foodDemand
    // deliberately bills the entire catchment census (settlement.js FOOD_REACH
    // note — the countryside feeds itself), so supply/demand reads ~0 for every
    // big ONE_POP settlement BY DESIGN. The sim's own famine gate compares the
    // flow against _coreNeed; _fedM is its ~100-tick moving average. The first
    // run of this probe read the notional ratio — a wrong-column artifact.
    const fed = big._fedM !== undefined ? big._fedM
      : Math.min(9.99, (big._foodSupply || 0) / Math.max(1e-9, big._coreNeed || 1));
    const org = (big.knowledge && big.knowledge.organization) || 0;
    bigStr = `${(big.name || "?").slice(0, 12).padEnd(12)} ${String(Math.round(big.people)).padStart(5)}/${String(Math.round(big._urbanPop || 0)).padStart(5)} ${fed.toFixed(2)} ${(big._diseaseLoad || 0).toFixed(2)} ${org.toFixed(2)} c${big.countryId}`;
  }
  console.log(`${String(world.step).padStart(6)} | ${String(n).padStart(3)} ${String(Math.round(tot)).padStart(7)} | ${bigStr} | ${realmStr} | ${Math.round(fp)} ${Math.round(fc)}`);
}

// ── the death certificates ──
console.log(`\n=== THE EVENT LOG, EGYPT BOX, steps 9000+ (the sim's own record — not inferred) ===`);
const evs = world.events || [];
const inBoxSid = (sid) => { const r = reg.get(sid); return r && inBox(r.x, r.y); };
const boxRealms = new Set(realmSeen.keys());
// First pass: the COMPLETE type histogram and per-2k-window counts — the
// line-capped dump below truncates (first run: everything past ~step 18k was
// silently missing from the per-type tallies), so the totals print first.
const sel = [];
for (const ev of evs) {
  if (ev.step < 9000 || !MORTAL.has(ev.type)) continue;
  const sHit = ev.s != null && ev.s >= 0 && inBoxSid(ev.s);
  const xyHit = ev.x != null && ev.y != null && inBox(ev.x, ev.y);
  const pHit = (ev.polity != null && boxRealms.has(ev.polity)) || (ev.from != null && boxRealms.has(ev.from)) || (ev.to != null && boxRealms.has(ev.to));
  if (sHit || xyHit || pHit) sel.push(ev);
}
{
  const byType = new Map();
  for (const ev of sel) byType.set(ev.type, (byType.get(ev.type) || 0) + 1);
  console.log(`  -- complete type histogram (${sel.length} events; the listing below may truncate) --`);
  for (const [t, n] of [...byType].sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(5)}  ${t}`);
}
let printed = 0, skipped = 0;
for (const ev of sel) {
  if (printed >= 2000) { skipped++; continue; }
  printed++;
  const extras = [];
  for (const k of ["s", "how", "why", "n", "sName", "from", "fromName", "to", "toName", "byName", "name", "kind", "city", "mortality"]) if (ev[k] !== undefined) extras.push(`${k}=${ev[k]}`);
  console.log(`  ${String(ev.step).padStart(6)}  ${ev.type.padEnd(22)} ${extras.join(" ").slice(0, 130)}`);
  console.log(`          └ ${narrate(world, ev)}`);
}
if (skipped) console.log(`  … ${skipped} more events elided`);

console.log(`\n=== SETTLEMENT LIFE TABLE (everything ever settled in the box) ===`);
console.log(`  id     name           first   last    peak   tier  death (type @ step)`);
const DEATHS = new Set(["settlement.abandoned", "settlement.withered", "settlement.dissolved"]);
for (const [sid, r] of [...reg].sort((a, b) => a[1].first - b[1].first)) {
  if (!inBox(r.x, r.y)) continue;
  let death = "";
  for (const ev of eventsFor(world, "s:" + sid)) if (DEATHS.has(ev.type)) death = `${ev.type.replace("settlement.", "")}${ev.why ? "(" + ev.why + ")" : ""} @ ${ev.step}`;
  const alive = r.lastSettled >= world.step - SAMPLE;
  console.log(`  ${String(sid).padStart(5)}  ${(r.name || "?").slice(0, 13).padEnd(13)} ${String(r.first).padStart(6)}  ${String(r.lastSettled).padStart(6)}  ${String(Math.round(r.peak)).padStart(6)}  ${String(r.tier).padStart(3)}   ${death || (alive ? "(alive at end)" : "(gone, no death event)")}`);
}

console.log(`\n=== REALM LIFE TABLE (everything that ever owned a box tile) ===`);
console.log(`  id     name             firstSeen  peakBoxT  peakWorldT  peakMem  born(how)          end(how @ step)`);
for (const [cid, rs] of [...realmSeen].sort((a, b) => a[1].first - b[1].first)) {
  let born = "", end = "";
  for (const ev of eventsFor(world, "p:" + cid)) {
    if (ev.type === "polity.founded" && ev.polity === cid && !born) born = ev.how || "?";
    if (ev.type === "polity.ended" && ev.polity === cid) end = `${ev.how || "?"}${ev.byName ? " by " + ev.byName : ""} @ ${ev.step}`;
    if (ev.type === "polity.shattered" && ev.polity === cid) end = `shattered by ${ev.toName || "?"} @ ${ev.step}`;
  }
  const alive = world.countries && world.countries.get(cid);
  console.log(`  ${String(cid).padStart(5)}  ${(rs.name || "?").slice(0, 15).padEnd(15)} ${String(rs.first).padStart(9)}  ${String(rs.peakBoxTiles).padStart(8)}  ${String(rs.peakTiles).padStart(10)}  ${String(rs.peakMem).padStart(7)}  ${born.padEnd(18)} ${end || (alive ? "(alive at end)" : "(gone, no end event)")}`);
}
console.log("");
