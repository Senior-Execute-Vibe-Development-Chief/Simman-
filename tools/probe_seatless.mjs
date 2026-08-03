// SEAT_FIELD sizing probe — "a nation does not need a city to form".
//
// Before building the seatless-founding half of C2/4b (a state nucleating at an
// unclaimed popField MAXIMUM and planting its own capital), measure how much
// work that machinery would actually have. Two questions, one run:
//
//   Q1  Of the unclaimed basins that ALREADY clear the state-founding mass bar
//       (the `clusterPop` gate nucleateFrontierStates charges), how many hold NO
//       stateless settled city — i.e. how many states could only ever be born
//       seatless? If ~0, the seatless path is inert in this regime and the real
//       gate is the SEAT-SIZE bar, not the absence of a seat.
//
//   Q2  What is the seat-size bar actually rejecting? Distribution of stateless
//       city census vs the bar it must clear (NUCLEATE_SEAT_POP/lever × capMul),
//       so the 83.9%-on-seatPop funnel reading has a shape behind it.
//
// The basin scan MIRRORS nucleateFrontierStates' own geometry and units (the
// BIRTH_FIELD field-mass bar through the census<->field exchange rate, the
// fertility half of capMul); it deliberately does NOT re-implement the disease /
// forest / ruggedness terms, which need per-settlement cached climate — so the
// counts below are an UPPER bound on viable basins (the omitted terms only ever
// RAISE the bar). An upper bound is exactly what sizing a "does this ever fire?"
// question wants.
//
//   node tools/probe_seatless.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "12000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);

// nucleateFrontierStates' own constants (countryTerritory.js — kept in sync by
// name here; a divergence shows up as a nonsense count, not a silent pass).
const NUCLEATE_R = 9;
const NUCLEATE_SEAT_POP = 160;
const NUCLEATE_CLUSTER_POP = 400;
const NUCLEATE_CAP_DIST = 8;
const NUCLEATE_CAP_FERT_REF = 0.55;
const NUCLEATE_CAP_SPREAD = 3.0;

const world = buildSim({ W, H: W / 2, seed: SEED });
const resScale = world.tw / 240;

function pct(a, b) { return b > 0 ? ((100 * a) / b).toFixed(1) + "%" : "—"; }

function scan() {
  const { tw, th, N, elev, fert } = world;
  const co = world._countryOwner, pf = world.popField;
  if (!co || !pf) return null;
  const lever = T.FRONTIER_FOUNDING || 1;
  const nucRi = Math.round(NUCLEATE_R * resScale);
  const clusterPop = NUCLEATE_CLUSTER_POP / lever;
  const seatPop = NUCLEATE_SEAT_POP / lever;
  const capD2 = ((NUCLEATE_CAP_DIST * resScale) / Math.sqrt(lever)) ** 2;

  // census <-> field exchange rate, exactly as the founding pass computes it
  let cenT = 0, pfT = 0;
  for (const s of world.settlements) if (s.mode === "settled") cenT += s.people || 0;
  for (let ti = 0; ti < N; ti++) if (elev[ti] > 0) pfT += pf[ti];
  const f2c = cenT > 0 && pfT > 0 ? cenT / pfT : 0;

  const caps = [];
  if (world.countries) for (const c of world.countries.values()) if (c.capital && c.capital.mode === "settled") caps.push(c.capital.pos);

  // Basin mass over UNCLAIMED land only (the pass's own domain), summed-area over
  // the disk. Straight disk sum per candidate tile would be O(N·r²); stride the
  // candidate set instead — we want the count of viable REGIONS, and the basin
  // radius is ~9·rs so a stride of r/2 cannot miss a region, only resolve it
  // coarsely. Local-maximum suppression then collapses each region to one seat.
  const stride = Math.max(1, Math.round(nucRi / 2));
  const mass = new Float64Array(N).fill(-1);
  const massAt = (tx, ty) => {
    const ti0 = ty * tw + tx;
    if (mass[ti0] >= 0) return mass[ti0];
    let m = 0;
    for (let dy = -nucRi; dy <= nucRi; dy++) {
      const yy = ty + dy; if (yy < 0 || yy >= th) continue;
      for (let dx = -nucRi; dx <= nucRi; dx++) {
        if (dx * dx + dy * dy > nucRi * nucRi) continue;
        const ti = yy * tw + (((tx + dx) % tw) + tw) % tw;
        if (!(elev[ti] > 0) || co[ti] >= 0) continue;
        m += pf[ti];
      }
    }
    mass[ti0] = m;
    return m;
  };

  // stateless settled cities, for the "does this basin already have a seat?" test
  const statelessCities = world.settlements.filter((s) => s.mode === "settled" && s.countryId < 0);

  const viable = [];   // { tx, ty, cp, hasCity }
  for (let ty = 1; ty < th - 1; ty += stride) {
    for (let tx = 0; tx < tw; tx += stride) {
      const ti = ty * tw + tx;
      if (!(elev[ti] > 0) || co[ti] >= 0) continue;
      // fertility half of capMul (the state-capacity gate); omitted terms raise it
      const capNorm = fert ? Math.min(1, Math.max(0, fert[ti] / NUCLEATE_CAP_FERT_REF)) : 1;
      const capMulFertOnly = 1 + NUCLEATE_CAP_SPREAD * (1 - capNorm);
      const cp = massAt(tx, ty) * f2c;
      if (!(cp >= clusterPop * capMulFertOnly)) continue;
      // isolation from existing capitals — the pass's own gate
      let near = false;
      for (const p of caps) {
        let dx = Math.abs(p.x - tx); if (dx > tw / 2) dx = tw - dx;
        const dy = p.y - ty;
        if (dx * dx + dy * dy < capD2) { near = true; break; }
      }
      if (near) continue;
      let hasCity = false;
      for (const s of statelessCities) {
        let dx = Math.abs(s.pos.x - tx); if (dx > tw / 2) dx = tw - dx;
        const dy = s.pos.y - ty;
        if (dx * dx + dy * dy <= nucRi * nucRi) { hasCity = true; break; }
      }
      viable.push({ tx, ty, cp, hasCity });
    }
  }
  // collapse to distinct REGIONS: keep the heaviest candidate in each 2·nucR disk
  viable.sort((a, b) => b.cp - a.cp);
  const regions = [];
  for (const v of viable) {
    let dup = false;
    for (const r of regions) {
      let dx = Math.abs(r.tx - v.tx); if (dx > tw / 2) dx = tw - dx;
      const dy = r.ty - v.ty;
      if (dx * dx + dy * dy < (2 * nucRi) ** 2) { dup = true; break; }
    }
    if (!dup) regions.push(v);
  }

  // Q2 — what the seat-size bar is rejecting among stateless cities
  const sizes = statelessCities.map((s) => s.people || 0).sort((a, b) => a - b);
  const q = (f) => (sizes.length ? sizes[Math.min(sizes.length - 1, Math.floor(f * sizes.length))] : 0);
  let clearSeat = 0;
  for (const s of statelessCities) {
    const ti = (s.pos.y | 0) * tw + (((s.pos.x | 0) % tw) + tw) % tw;
    const capNorm = fert ? Math.min(1, Math.max(0, fert[ti] / NUCLEATE_CAP_FERT_REF)) : 1;
    if ((s.people || 0) >= seatPop * (1 + NUCLEATE_CAP_SPREAD * (1 - capNorm))) clearSeat++;
  }

  return {
    realms: world.countries ? world.countries.size : 0,
    cities: world.settlements.filter((s) => s.mode === "settled").length,
    stateless: statelessCities.length,
    seatBar: seatPop,
    clearSeat,
    sizes: { p10: q(0.1), p50: q(0.5), p90: q(0.9), max: sizes[sizes.length - 1] || 0 },
    regions: regions.length,
    seatless: regions.filter((r) => !r.hasCity).length,
    f2c,
  };
}

const CHECKS = [2000, 6000, 12000, 25000, 50000].filter((c) => c <= STEPS);
console.log(`# probe_seatless  W=${W} seed=${SEED} steps=${STEPS}  (tw=${world.tw}, resScale=${resScale})`);
console.log("step   realms cities stateless  seatBar clearsBar   viableBasins  SEATLESS(no city)");
for (let i = 0; i < STEPS; i++) {
  stepPeopleSim(world);
  if (CHECKS.includes(world.step)) {
    const r = scan();
    if (!r) { console.log(`${world.step}  (no field)`); continue; }
    console.log(
      `${String(world.step).padEnd(6)} ${String(r.realms).padEnd(6)} ${String(r.cities).padEnd(6)} ` +
      `${String(r.stateless).padEnd(10)} ${r.seatBar.toFixed(0).padEnd(8)} ` +
      `${(r.clearSeat + " (" + pct(r.clearSeat, r.stateless) + ")").padEnd(14)} ` +
      `${String(r.regions).padEnd(14)} ${r.seatless} (${pct(r.seatless, r.regions)})`
    );
    console.log(`       stateless-city census p10/p50/p90/max = ${r.sizes.p10.toFixed(0)}/${r.sizes.p50.toFixed(0)}/${r.sizes.p90.toFixed(0)}/${r.sizes.max.toFixed(0)}  (bar ${r.seatBar.toFixed(0)}; f2c ${r.f2c.toExponential(3)})`);
  }
}
