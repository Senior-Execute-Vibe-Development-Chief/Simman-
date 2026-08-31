// Benchmark: entity register vs urban cores vs ledger vs popField peaks.
//   node tools/bench_city_register.mjs [steps=24000] [W=960] [seed=8817]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { labelSiteLedger } from "../src/sim/peopleSim/crystallize.js";
import { TIER_CORE } from "../src/sim/peopleSim/settlement.js";
import { resetTuning, applyTuning } from "../src/sim/peopleSim/tuning.js";

const STEPS = +(process.argv[2] || 24000);
const W = +(process.argv[3] || 960), H = W >> 1, SEED = +(process.argv[4] || 8817);
const CHECKS = [10000, 15000, 20000, 24000].filter(s => s <= STEPS);
const CORE_BAR = TIER_CORE[2]; // 10 = ~10k urban core

const ARMS = [
  { name: "live (defaults)", tune: {} },
  { name: "pre-flip register", tune: { DISSOLVE_TOWNS: 0, CITY_CORE: 0, CROWD_FOUND: 0 } },
  { name: "pre-flip + no residual", tune: { DISSOLVE_TOWNS: 0, CITY_CORE: 0, CROWD_FOUND: 0, MINT_RESIDUAL: 0 } },
];

function popFieldPeaks(world, topN = 5) {
  const pf = world.popField;
  if (!pf) return { peaks: [], urbanField: 0, fieldSum: 0 };
  let fieldSum = 0, urbanField = 0;
  const peaks = [];
  const tw = world.tw, th = world.th, N = world.N;
  // Local maxima on a 3×3 window (cheap proxy for proto-urban piles)
  for (let y = 1; y < th - 1; y++) {
    for (let x = 1; x < tw - 1; x++) {
      const ti = y * tw + x;
      if (world.elev[ti] <= 0) continue;
      const v = pf[ti];
      fieldSum += v;
      let isPeak = v > 0;
      for (let dy = -1; dy <= 1 && isPeak; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (pf[ti + dy * tw + dx] > v) isPeak = false;
        }
      }
      if (isPeak) peaks.push({ ti, x, y, v });
    }
  }
  peaks.sort((a, b) => b.v - a.v);
  const bridge = world._onePopScale > 0 ? world._onePopScale : 0;
  const top = peaks.slice(0, topN).map(p => ({
    field: p.v,
    census: bridge > 0 ? p.v * bridge : null,
  }));
  if (bridge > 0) {
    for (const s of world.settlements) {
      if (s.mode === "settled") urbanField += (s._urbanPop || 0);
    }
  }
  return { peaks: top, peakCount: peaks.length, fieldSum, urbanField, bridge };
}

function snapshot(world, L) {
  const setts = world.settlements.filter(s => s.mode === "settled");
  const cores = setts.map(s => s._urbanPop ?? s.people);
  const catchments = setts.map(s => s.people);
  const cities10k = cores.filter(c => c >= CORE_BAR).length;
  const tier = [0, 0, 0, 0];
  for (const s of setts) if (s.tier >= 0 && s.tier < 4) tier[s.tier]++;
  let claimed = 0, elig = 0;
  const eligArr = world._siteCityElig;
  const claims = world._siteClaims;
  if (claims?.claimed) {
    for (let k = 0; k < L.sites.length; k++) {
      if (claims.claimed[k]) claimed++;
      if (eligArr && eligArr[k]) elig++;
    }
  }
  const pf = popFieldPeaks(world);
  const q = (a, f) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(f * s.length))];
  };
  return {
    entities: setts.length,
    cities10kCore: cities10k,
    catchmentP50: q(catchments, 0.5),
    coreP50: q(cores, 0.5),
    coreMax: cores.length ? Math.max(...cores) : 0,
    tier,
    ledgerSites: L.sites.length,
    sitesClaimed: claimed,
    sitesElig: elig,
    pfPeaks: pf.peakCount,
    pfTopCensus: pf.peaks.map(p => p.census),
    urbanCoreSum: pf.urbanField,
    bridge: pf.bridge,
    countries: world.countries?.size ?? 0,
    step: world.step,
  };
}

console.log(`\n=== CITY REGISTER BENCHMARK  tw=${W >> 1}  seed ${SEED}  to ${STEPS} ===`);
console.log(`  city bar: TIER_CORE[2]=${CORE_BAR} (~${CORE_BAR}k urban core); catchment = sim units × 1000 people\n`);

for (const arm of ARMS) {
  resetTuning();
  applyTuning({ POP_FIELD_WORKERS: -1, DAWN_LIVE: 0, STATE_RECORDS: 0, LAND_KNOW: 0, PEER_SEATS: 0, FOUND_DRIFT: 0, ABSORB_ORG_ERA: 0, TRIBUTE_UP: 0, ENGULF: 0, FEAR_REACH: 0, WAR_FINISH: 0, SMALL_WAR: 0, RELIEF_REACH: 0, EXCH_WAVE: 0, TECH_USE: 0, VASSAL_LEVY: 0, DISSOLVE_CORE: 0, SETT_STRIDE: 1, TRADE_STRIDE: 3, ...arm.tune });
  const tuneStr = Object.entries(arm.tune).map(([k, v]) => `${k}=${v}`).join(",");
  const world = buildSim({ W, H, seed: SEED });
  const L = labelSiteLedger(world);
  console.log(`── ${arm.name}${tuneStr ? ` (${tuneStr})` : ""} ──`);
  let last = 0;
  for (const target of CHECKS) {
    stepPeopleSim(world, target - last);
    last = target;
    const s = snapshot(world, L);
    console.log(
      `  step ${String(s.step).padStart(5)}  entities ${String(s.entities).padStart(3)}  cities≥10kCore ${String(s.cities10kCore).padStart(3)}  ` +
      `catch p50 ${s.catchmentP50.toFixed(0)}  core p50 ${s.coreP50.toFixed(0)}  core max ${s.coreMax.toFixed(0)}  ` +
      `tier v/t/c/m ${s.tier[0]}/${s.tier[1]}/${s.tier[2]}/${s.tier[3]}  realms ${s.countries}  ` +
      `ledger ${s.ledgerSites} claimed ${s.sitesClaimed} elig ${s.sitesElig}  pfPeaks ${s.pfPeaks}`
    );
    if (s.pfTopCensus.length) {
      const tops = s.pfTopCensus.map(c => c != null ? Math.round(c) : "?").join(",");
      console.log(`           pf top-5 core-proxy (census): ${tops}  Σ urban cores ${s.urbanCoreSum.toFixed(0)}`);
    }
  }
  console.log("");
}

console.log("READ: entities = settlement register; cities≥10kCore = urban _urbanPop bar;");
console.log("  pfPeaks = local popField maxima (proto-urban in land); pre-flip raises entities not pfPeaks.");
