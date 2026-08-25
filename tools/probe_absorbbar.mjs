// THE INTEGRATION LANE: is the era org bar the binding gate, or a redundant one?
//
// Owner's own run (owner-run-t35572, tw=960 live) shows the integrate funnel flat
// at 2-3% PASSED for twelve thousand steps while candidates grow 100x, with
// orgBelowMin taking ~half of every window. That is the lane that turns a
// suzerainty BLOC into governed TERRITORY, and its being shut is why the atlas
// paints big cohesive nations (bloc roots) over a realm partition that is still
// confetti — 55 realms in the biggest "nation".
//
// The structural suspicion, stated before measuring so the measurement can refute
// it: absorbOrgBar under T.ABSORB_ORG_ERA is the ABSORB_ERA_Q (0.67) QUANTILE of
// the live court org distribution. A quantile of the population it gates pins the
// admitted share at one third FOREVER — however institutionally advanced the world
// becomes, exactly a third of courts may integrate, and a court that improves can
// still be pushed BELOW the bar by its peers improving faster. History's
// administrative capacity is not a rank: Rome could province Pergamon because Rome
// had censuses, roads and a magistracy, not because it placed in its era's top
// third; as institutions matured MORE polities could administer, not the same third.
//
// But the org bar is only the FIRST of six gates, and the ones behind it
// (seat grade, direct-rule reach, admin headroom vs estimated load, the patience
// clock, identity and coalition brakes) are real capability tests. So the question
// this probe answers is not "is the bar high" but:
//
//   IF THE ORG BAR WERE REMOVED, WOULD INTEGRATIONS HAPPEN — or would the
//   rejections simply move downstream to the gates with physical meaning?
//
// Redundant bar  => PASSED barely moves, noAdminHeadroom/beyondDirectRule absorb
//                   the candidates, and the org bar is not the thing to fix.
// Binding bar    => PASSED rises materially and bloc converts to territory.
//
// Run both arms; the funnel is the sim's own (telemetry.js), never re-implemented:
//   node tools/probe_absorbbar.mjs [steps] [W] [seed] [window]
//   SIM_TUNE="...,ABSORB_ORG_ERA=0,ABSORB_ORG_MIN=0.1"   # the bar removed
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { telEnable, telReport, telReset } from "../src/sim/peopleSim/telemetry.js";
import { absorbOrgBar } from "../src/sim/peopleSim/conquest.js";
import { techEff } from "../src/sim/peopleSim/settlement.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = +(process.argv[2] || 30000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const WIN = +(process.argv[5] || 1000);

const world = buildSim({ W, H, seed: SEED });
telEnable(world);
const N = world.N, elev = world.elev;
let landN = 0; for (let i = 0; i < N; i++) if (elev[i] > 0) landN++;
const KM2 = (510e6 * 0.29) / landN;

const q = (a, f) => (a.length ? a[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);
const M = (x) => (x / 1e6).toFixed(2) + "M";

console.log(`\n=== THE ABSORPTION BAR  ${W}x${H} (tw=${world.tw})  seed ${SEED}  ${STEPS} steps ===`);
console.log(`    ABSORB_ORG_ERA=${T.ABSORB_ORG_ERA}  ABSORB_ORG_MIN=${T.ABSORB_ORG_MIN}` +
  (T.ABSORB_ORG_ERA > 0 ? "   (bar = the era's 0.67 quantile)" : "   (bar = the absolute floor)"));

const rows = [];
for (let done = 0; done < STEPS; done += WIN) {
  telReset(world);
  stepPeopleSim(world, Math.min(WIN, STEPS - done));

  const countries = world.countries || new Map();
  // court organisation — reachLevel, exactly the quantity absorbOrgBar ranks
  const orgs = [];
  for (const c of countries.values()) if (c.capital) orgs.push(techEff(c.capital).reachLevel || 0);
  orgs.sort((a, b) => a - b);
  const bar = countries.size ? absorbOrgBar(world, countries) : 0;

  // bonds, and how many have a suzerain under the bar
  const ov = world._overlordOf || new Map();
  let bondsUnder = 0;
  for (const [, hid] of ov) {
    const Hc = countries.get(hid);
    if (Hc && Hc.capital && (techEff(Hc.capital).reachLevel || 0) < bar) bondsUnder++;
  }

  // bloc → territory: the biggest bloc's realms and area, against its ROOT's own
  const rootOf = (id) => { let r = id, g = 0; while (ov.has(r) && g++ < 64) r = ov.get(r); return r; };
  const co = world._countryOwner;
  const tiles = new Map(), blocTiles = new Map(), blocRealms = new Map();
  if (co) for (let ti = 0; ti < N; ti++) { const c = co[ti]; if (c >= 0 && elev[ti] > 0) tiles.set(c, (tiles.get(c) || 0) + 1); }
  for (const [c, t] of tiles) { const r = rootOf(c); blocTiles.set(r, (blocTiles.get(r) || 0) + t); }
  for (const c of tiles.keys()) { const r = rootOf(c); blocRealms.set(r, (blocRealms.get(r) || 0) + 1); }
  let bigRoot = -1, bigT = 0;
  for (const [r, t] of blocTiles) if (t > bigT) { bigT = t; bigRoot = r; }

  const live = new Set();
  for (const s of world.settlements) if (s.mode === "settled" && s.countryId >= 0) live.add(s.countryId);
  const mem = new Map();
  for (const s of world.settlements) if (s.mode === "settled" && s.countryId >= 0) mem.set(s.countryId, (mem.get(s.countryId) || 0) + 1);
  let singles = 0; for (const n of mem.values()) if (n === 1) singles++;

  const f = telReport(world).integrate || {};
  rows.push({
    step: world.step, courts: countries.size, bar,
    p33: q(orgs, 0.33), p50: q(orgs, 0.5), p67: q(orgs, 0.67), p90: q(orgs, 0.9), max: orgs.length ? orgs[orgs.length - 1] : 0,
    bonds: ov.size, bondsUnder,
    states: live.size, singlePct: live.size ? Math.round(100 * singles / live.size) : 0,
    blocR: blocRealms.get(bigRoot) || 0, blocKm2: bigT * KM2, rootKm2: (tiles.get(bigRoot) || 0) * KM2,
    f,
  });
}

console.log(`\n-- the court org distribution, and the bar it is ranked against ----------`);
console.log(`   step  courts | org p33   p50   p67   p90   max |  BAR  | bonds  suzerain under bar`);
for (const r of rows) {
  if (!r.courts) continue;
  console.log(`  ${String(r.step).padStart(6)} ${String(r.courts).padStart(6)} |     ${r.p33.toFixed(2)}  ${r.p50.toFixed(2)}  ${r.p67.toFixed(2)}  ${r.p90.toFixed(2)}  ${r.max.toFixed(2)} | ${r.bar.toFixed(2)}  | ${String(r.bonds).padStart(5)}  ${String(r.bondsUnder).padStart(5)} (${r.bonds ? Math.round(100 * r.bondsUnder / r.bonds) : 0}%)`);
}

console.log(`\n-- the integrate funnel, per window (the sim's own tally) ----------------`);
console.log(`   step   CAND  PASSED  pass% | orgBelow  beyondRule  noHeadroom  hazard  identity  seatTier`);
for (const r of rows) {
  const f = r.f, c = f.CANDIDATE || 0; if (!c) continue;
  const p = f.PASSED || 0;
  const g = (k) => String(f[k] || 0).padStart(8);
  console.log(`  ${String(r.step).padStart(6)} ${String(c).padStart(6)} ${String(p).padStart(7)} ${(100 * p / c).toFixed(1).padStart(6)}% |${g("orgBelowMin")}${g("beyondDirectRule")}${g("noAdminHeadroom")}${g("hazardRoll(waiting)")}${g("identityBrake(foreignCourt)")}${g("seatAboveTierCap")}`);
}

console.log(`\n-- bloc vs TERRITORY: is the biggest "nation" a state or a suzerainty? ---`);
console.log(`   step  states  singl%  biggest bloc: realms   bloc km2   the ROOT's OWN km2   converted`);
for (const r of rows) {
  if (!r.states) continue;
  const conv = r.blocKm2 > 0 ? 100 * r.rootKm2 / r.blocKm2 : 0;
  console.log(`  ${String(r.step).padStart(6)} ${String(r.states).padStart(6)} ${String(r.singlePct).padStart(6)}%  ${String(r.blocR).padStart(20)}   ${M(r.blocKm2).padStart(8)}   ${M(r.rootKm2).padStart(16)}   ${conv.toFixed(0).padStart(8)}%`);
}
console.log("");
