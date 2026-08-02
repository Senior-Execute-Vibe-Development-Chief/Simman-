// WHERE DO NATIONS COME FROM? — the state-birth census.
//
// One run, three readings at each checkpoint, so a claim about state formation
// can be checked against the sim rather than against a funnel percentage taken
// out of context:
//
//   1. FOUNDING CHANNELS — the polity.founded ledger by `how` (frontier =
//      adoptAndFound's wilderness self-founding, nucleate = the basin channel,
//      secession/colony/fragment = the rest), plus polity.restored. This is the
//      denominator every other number needs: a bar that rejects 99% of a channel
//      nobody uses is not the constraint.
//   2. THE NUCLEATE FUNNEL — telemetry, tallied at the rejecting lines, reset
//      between checkpoints so each window reads its own regime rather than the
//      run's cumulative average.
//   3. THE BARS IN UNITS — the seat bar against the live stateless-city census
//      distribution, and the basin bar against the live unclaimed-basin mass
//      distribution, both in the same census units the gates compare.
//
//   node tools/probe_statebirth.mjs [steps] [seed] [W]
//   SIM_TUNE=SEAT_FIELD=1 node tools/probe_statebirth.mjs 12000
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { telEnable, telReport, telReset } from "../src/sim/peopleSim/telemetry.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "12000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);

const NUCLEATE_R = 9;
const NUCLEATE_SEAT_POP = 160;
const NUCLEATE_CLUSTER_POP = 400;
const NUCLEATE_CAP_FERT_REF = 0.55;
const NUCLEATE_CAP_SPREAD = 3.0;

const world = buildSim({ W, H: W / 2, seed: SEED });
telEnable(world);
world.debug = world.debug || {};   // maybePlantTowns' write-only gate counters
const rs = world.tw / 240;

const CHECKS = [1000, 2000, 4000, 8000, 12000, 25000, 50000].filter((c) => c <= STEPS);
let evCursor = 0;
const founded = new Map();     // how -> count (cumulative)
let restored = 0;

function drainEvents() {
  const evs = world.events || [];
  for (; evCursor < evs.length; evCursor++) {
    const ev = evs[evCursor];
    if (ev.type === "polity.founded") founded.set(ev.how || "?", (founded.get(ev.how || "?") || 0) + 1);
    else if (ev.type === "polity.restored") restored++;
  }
}

function quantiles(arr) {
  if (!arr.length) return "—";
  const a = arr.slice().sort((x, y) => x - y);
  const q = (f) => a[Math.min(a.length - 1, Math.floor(f * a.length))];
  return `${q(0.5).toFixed(0)}/${q(0.9).toFixed(0)}/${a[a.length - 1].toFixed(0)}`;
}

function bars() {
  const { tw, th, N, elev, fert } = world;
  const co = world._countryOwner, pf = world.popField;
  if (!co || !pf) return null;
  const lever = T.FRONTIER_FOUNDING || 1;
  const nucRi = Math.round(NUCLEATE_R * rs);
  const seatBar = NUCLEATE_SEAT_POP / lever, basinBar = NUCLEATE_CLUSTER_POP / lever;

  let cenT = 0, pfT = 0;
  for (const s of world.settlements) if (s.mode === "settled") cenT += s.people || 0;
  for (let ti = 0; ti < N; ti++) if (elev[ti] > 0) pfT += pf[ti];
  const f2c = cenT > 0 && pfT > 0 ? cenT / pfT : 0;

  // For every stateless city: its own census, and the basin mass under it —
  // the two numbers the two gates compare, at exactly the sites the pass looks at.
  const seatVals = [], basinVals = [], basinNeed = [];
  for (const s of world.settlements) {
    if (s.mode !== "settled" || s.countryId >= 0) continue;
    const sx = s.pos.x | 0, sy = s.pos.y | 0;
    const ti = sy * tw + (((sx % tw) + tw) % tw);
    const capNorm = fert ? Math.min(1, Math.max(0, fert[ti] / NUCLEATE_CAP_FERT_REF)) : 1;
    const capMulFert = 1 + NUCLEATE_CAP_SPREAD * (1 - capNorm);
    let mass = 0;
    for (let dy = -nucRi; dy <= nucRi; dy++) {
      const yy = sy + dy; if (yy < 0 || yy >= th) continue;
      for (let dx = -nucRi; dx <= nucRi; dx++) {
        if (dx * dx + dy * dy > nucRi * nucRi) continue;
        const t2 = yy * tw + (((sx + dx) % tw) + tw) % tw;
        if (!(elev[t2] > 0) || co[t2] >= 0) continue;
        mass += pf[t2];
      }
    }
    seatVals.push((s.people || 0) / (seatBar * capMulFert));      // ×bar: ≥1 clears
    basinVals.push((mass * f2c) / (basinBar * capMulFert));       // ×bar: ≥1 clears
    basinNeed.push(capMulFert);
  }
  const clears = (a) => a.filter((v) => v >= 1).length;
  // URBANISATION — the honest way to ask "are there too many settlements?", since
  // a COUNT means nothing without the population it stands on. It must be read
  // off s._urbanPop (the city's own footprint), NOT s.people: under ONE_POP the
  // census is the settlement's whole CATCHMENT — city plus the villages it farms
  // — so cenT/(pfT×f2c) is identically 1 by construction of f2c, a tautology
  // that says nothing. The bridge to census units is _onePopScale.
  let urbT = 0;
  for (const s of world.settlements) if (s.mode === "settled") urbT += s._urbanPop || 0;
  const bridge = world._onePopScale > 0 ? world._onePopScale : f2c;
  const worldCensus = pfT * bridge;
  const urbanShare = worldCensus > 0 ? urbT / worldCensus : 0;
  const catchShare = worldCensus > 0 ? cenT / worldCensus : 0;
  return {
    urbanShare, catchShare,
    stateless: seatVals.length,
    seatClear: clears(seatVals), seatQ: quantiles(seatVals),
    basinClear: clears(basinVals), basinQ: quantiles(basinVals),
    both: seatVals.filter((v, i) => v >= 1 && basinVals[i] >= 1).length,
    capMulQ: quantiles(basinNeed),
    f2c,
  };
}

console.log(`# probe_statebirth  W=${W} seed=${SEED} steps=${STEPS}  SEAT_FIELD=${T.SEAT_FIELD} FRONTIER_FOUNDING=${T.FRONTIER_FOUNDING}`);
for (let i = 0; i < STEPS; i++) {
  stepPeopleSim(world);
  if (!CHECKS.includes(world.step)) continue;
  drainEvents();
  const rep = telReport(world);
  const b = bars();
  const realms = world.countries ? world.countries.size : 0;
  const cities = world.settlements.filter((s) => s.mode === "settled").length;
  console.log(`\n=== step ${world.step}   realms ${realms}   cities ${cities}   stateless ${b ? b.stateless : "?"} ===`);
  console.log(`  founded by channel (cumulative): ${[...founded.entries()].sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  ") || "(none)"}   restored=${restored}`);
  const nuc = rep.nucleate || {};
  const nucTot = Object.values(nuc).reduce((a, c) => a + c, 0) - (nuc.CANDIDATE || 0);
  console.log(`  nucleate funnel (this window): candidates=${nuc.CANDIDATE || 0}  ` +
    Object.entries(nuc).filter(([k]) => k !== "CANDIDATE").map(([k, v]) => `${k}=${v}(${nucTot ? ((100 * v) / nucTot).toFixed(0) : 0}%)`).join("  "));
  console.log(`  births this window: basin(nucleate)=${nuc.PASSED || 0}   city-self-founds(adoptAndFound)=${(rep.selfFound || {}).PASSED || 0}`);
  // THE INFLOW — where stateless cities come from. A standing stock is set by
  // its inflow as much as by its outflow, so the founding funnel above cannot
  // explain the stateless count on its own.
  const bp = rep.birthPolity || {};
  const bpTot = Object.values(bp).reduce((a, c) => a + c, 0) - (bp.CANDIDATE || 0);
  console.log(`  new cities' flag (this window): considered=${bp.CANDIDATE || 0}  ` +
    Object.entries(bp).filter(([k]) => k !== "CANDIDATE").map(([k, v]) => `${k}=${v}(${bpTot ? ((100 * v) / bpTot).toFixed(0) : 0}%)`).join("  "));
  const pl = (world.debug && world.debug.plant) || null;
  if (pl) console.log(`  state-planted towns (cumulative): planted=${pl.planted}  blocked: pop=${pl.pop} org=${pl.org} strain=${pl.strain} coin=${pl.coin} cooldown=${pl.cool} isolation=${pl.iso}  (eligible-realm firings=${pl.elig})`);
  if (b) {
    console.log(`  seat  bar: ${b.seatClear}/${b.stateless} stateless cities clear it   census/bar p50/p90/max = ${b.seatQ}`);
    console.log(`  basin bar: ${b.basinClear}/${b.stateless} of those sites clear it    mass/bar  p50/p90/max = ${b.basinQ}`);
    console.log(`  BOTH bars: ${b.both}    geography multiplier capMul(fert only) p50/p90/max = ${b.capMulQ}   f2c=${b.f2c.toExponential(3)}`);
    console.log(`  urbanisation: ${(100 * b.urbanShare).toFixed(1)}% of the world's people live IN a city; ${(100 * b.catchShare).toFixed(1)}% live on land a city works   (${cities} cities, ${realms} realms → ${realms ? (cities / realms).toFixed(1) : "—"} cities/realm)`);
  }
  telReset(world);
}
