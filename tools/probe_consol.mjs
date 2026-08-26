// THE CONSOLIDATION PIPELINE — where does empire-building actually jam?
// (2026-08-26, the combined consolidation × institutional-pace lap. The
// owner's t=36864 journal shows the funnel counts; this measures the
// DISTRIBUTIONS behind them, on the real gates via telemetry + hooks.)
//
// The pipeline: war → storm/capture (power asymmetry) → submit (vassal bond,
// needs hopeless resistance) → integrate (province, needs the era's
// upper-third court + direct-rule reach) — against the leaks (secession,
// fission, bond decay). Known structure going in:
//   · absorbOrgBar under T.ABSORB_ORG_ERA is RELATIVE (the 67th percentile
//     of capitals' reachLevel): 67% of courts ALWAYS read orgBelowMin by
//     construction — the funnel's dominant count is designed, not a
//     shortage. What matters is the PACK: if capitals cluster tightly, the
//     bar is noise; if spread, it selects real hegemons.
//   · Storms: advCity = committed attack / ((relief + assist + garrison)·walls)
//     vs T.CITY_STORM_RATIO (1.6). The 2026-08-22 measurement ("blocs form,
//     never convert to force") got VASSAL_LEVY; storms still ~never pass in
//     the owner's journal. world._warDbg (armies.js hook) decomposes every
//     heartland front this run.
//   · The camp clock (SIEGE_ENDURE) lifts sieges when the CITY still eats —
//     and the v45-48 food waves filled every granary. Fed cities may now
//     out-eat every camp: siegeLifts vs breaches tells.
//
//   SIM_TUNE="<live arm>" node tools/probe_consol.mjs [steps=30000] [W=480] [seed=8817]
import { readFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { techEff } from "../src/sim/peopleSim/settlement.js";
import { telEnable, telReport, telReset } from "../src/sim/peopleSim/telemetry.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = +(process.argv[2] || 30000);
const W = +(process.argv[3] || 480), H = W >> 1, SEED = +(process.argv[4] || 8817);
const rc = await import("../src/realClimateData.js");
const load = n => JSON.parse(readFileSync(new URL(`../data/${n}`, import.meta.url)));
rc.provideRealClimateData(load("global_precip.json"), load("global_airtemp.json"));
const world = buildSim({ W, H, seed: SEED, realWind: true, realWindFns: { isRealWindAvailable: () => false, isRealClimateAvailable: rc.isRealClimateAvailable, fillRealClimate: rc.fillRealClimate } });
telEnable(world);
world._warDbg = [];

const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);
console.log(`\n=== CONSOLIDATION PIPELINE  ${W}x${H} (tw=${world.tw})  seed ${SEED}  OBSERVED + arm  ${STEPS} steps ===`);
console.log(`  storm bar CITY_STORM_RATIO=${T.CITY_STORM_RATIO} · integrate bar = 67th-pct of capitals (ABSORB_ORG_ERA=${T.ABSORB_ORG_ERA})\n`);

for (let done = 0; done < STEPS; done += 3000) {
  telReset(world);
  world._warDbg.length = 0;
  stepPeopleSim(world, 3000);

  // ── the political register ──
  let states = 0, singles = 0;
  const orgs = [];
  if (world.countries) for (const c of world.countries.values()) {
    if (!c.capital) continue;
    states++;
    let mem = 0; for (const m of c.members) if (m.mode === "settled") mem++;
    if (mem <= 1) singles++;
    orgs.push(techEff(c.capital).reachLevel || 0);
  }
  const bonds = world._overlordOf ? world._overlordOf.size : 0;
  orgs.sort((a, b) => a - b);
  const bar = orgs.length ? orgs[Math.min(orgs.length - 1, Math.floor(orgs.length * 0.67))] : 0;

  // ── flows this window (telemetry) ──
  const tr = telReport(world);
  const g = (ch, k) => (tr[ch] && tr[ch][k]) || 0;

  // ── storm decomposition (the _warDbg hook) ──
  const wd = world._warDbg;
  const advs = wd.map(x => x.adv);
  const weak = advs.filter(a => a < T.CITY_STORM_RATIO).length;
  const med = (key) => q(wd.map(x => x[key]), .5);

  console.log(`step ${String(world.step).padStart(6)}  states ${states} (singl ${states ? Math.round(100 * singles / states) : 0}%) · bonds ${bonds} · org pack p50/p67(bar)/p90 ${q(orgs, .5).toFixed(2)}/${bar.toFixed(2)}/${q(orgs, .9).toFixed(2)} (spread p90−p50 ${(q(orgs, .9) - q(orgs, .5)).toFixed(3)})`);
  console.log(`   flows/3k  submit ${g("submit", "PASSED")}/${g("submit", "CANDIDATE")} · integrate ${g("integrate", "PASSED")}/${g("integrate", "CANDIDATE")} (orgBelowMin ${g("integrate", "orgBelowMin")} beyondDirectRule ${g("integrate", "beyondDirectRule")}) · capture ${g("capture", "PASSED")} · storm PASSED ${g("storm", "PASSED")} lifts ${g("storm", "siegeLifts")} grinding ${g("storm", "wallsHold(grinding)")}`);
  console.log(`   storms n ${wd.length} · adv p50/p90/max ${q(advs, .5).toFixed(2)}/${q(advs, .9).toFixed(2)}/${(advs.length ? Math.max(...advs) : 0).toFixed(2)} vs bar ${T.CITY_STORM_RATIO} · tooWeak ${wd.length ? Math.round(100 * weak / wd.length) : 0}% · med att ${med("att").toFixed(1)} vs def: relief ${med("defF").toFixed(1)} + assist ${med("assist").toFixed(1)} + garrison ${med("defH").toFixed(1)} ×walls ${med("em").toFixed(2)}`);
  console.log("");
}
console.log(`READ: adv p90 far under the bar with walls (em) dominating ⇒ the walls price`);
console.log(`is the lock; relief/assist dominating ⇒ coalitions; att tiny ⇒ concentration/`);
console.log(`command caps. Tight org pack (spread ≈ 0) ⇒ the relative integrate bar is noise.`);
