// THE MILITARY-BALANCE ARM — the kill-shot docs/urban-claim-memo-2026-08-27.md
// §5.1 says to run FIRST for T.CORE_LOCAL, "because nobody would think to."
//
// WHY THIS ARM EXISTS. CORE_LOCAL lets a city count its OWN hinterland's
// surplus toward its urban core, which raises urban mass ×2.45 and leaves rural
// mass at ×0.966. The war code reads BOTH halves of that split, in opposite
// directions:
//   armies.js:328-329  siege militia = _urbanPop × SIEGE_MOBILIZE(0.20) × morale
//   armies.js:540      standing/paid cap = _urbanPop × frac   (under WAR_FINISH)
//   armies.js:555      wartime conscript levy = _ruralPop / URBAN_BASE_RURAL
// tuning.js:474 records the split as knife-edge, and WAR_FINISH deliberately
// re-based walls onto the urban core. So a change that multiplies urban mass
// world-wide pushes 2.45× the other way, all at once, with no lever between
// them. The memo's warning is the point: the failure would not present as a bug
// in this mechanism — it would present as "conquest stopped working," diagnosed
// weeks later by someone who never heard of T.CORE_LOCAL.
//
// REFUTED IF realm deaths COLLAPSE (the map ossifies behind unbreakable walls)
// or EXPLODE (the map churns to soup). Both are read per-realm, not raw: the
// treated arm holds MORE realms on MORE land, so raw event counts rise for a
// purely mechanical reason and a raw comparison would manufacture a finding.
//
// THREE THINGS THIS PRINTS THAT probe_shape DOES NOT:
//
//  1. PER-WINDOW flows, counted by ev.step, not cumulative totals differenced by
//     hand. events.js:44 compacts the log at 200k (keeping the last 150k), so a
//     cumulative scan silently under-reports once that fires; a step-filtered
//     count is exact for any window still in the log.
//  2. PER-REALM normalisation, so "more churn" cannot be an artifact of "more
//     realms".
//  3. THE ARMING CHECK (memo §5.4, popField.js). CORE_LOCAL's own first
//     kill-shot ran with the harness pinning LAND_KNOW=0, so the edited line
//     never executed and both arms came back byte-identical — caught by
//     accident, because the hashes matched. Every window here prints
//     blockRan% (did the code run at all — is the REGIME right) and
//     bind% (did the local claim actually beat the founding hold — did the
//     MECHANISM bite). An arm that prints blockRan=0 measured NOTHING, whatever
//     else it says, and this probe says so in words rather than leaving it to
//     be inferred.
//
//   node tools/probe_milbalance.mjs [steps] [W] [seed] [every]
//   LIVE ARM (what the app ships — this is the regime the verdict must be in):
//     SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1,PEER_SEATS=1,WAR_FINISH=1,SETT_STRIDE=3,TRADE_STRIDE=5" \
//       node tools/probe_milbalance.mjs 32000 960 8817
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = +(process.argv[2] || 32000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const EVERY = +(process.argv[5] || 4000);

const world = buildSim({ W, H, seed: SEED });
let landN = 0;
for (let i = 0; i < world.N; i++) if (world.elev[i] > 0) landN++;
const km2PerTile = (510e6 * 0.29) / landN;

// The flows the memo names, plus the war events that would EXPLAIN a move in
// them — a change in deaths with no change in wars is a different story from
// one the war system drove, and the probe should not force that to be guessed.
const FLOWS = ["polity.founded", "polity.ended", "polity.seceded", "polity.shattered"];
const WARS = ["war.began", "war.ended", "settlement.captured", "polity.submittedBySack"];

function windowCounts(lo, hi) {
  const c = Object.create(null);
  for (const k of [...FLOWS, ...WARS]) c[k] = 0;
  for (const ev of world.events || []) {
    const st = ev.step | 0;
    if (st <= lo || st > hi) continue;
    if (c[ev.type] !== undefined) c[ev.type]++;
  }
  return c;
}

function report(lo, hi, t0) {
  const co = world._countryOwner, elev = world.elev, N = world.N;
  const tiles = new Map(); let claimed = 0;
  for (let i = 0; i < N; i++) {
    if (!(elev[i] > 0)) continue;
    const c = co ? co[i] : -1;
    if (c >= 0) { claimed++; tiles.set(c, (tiles.get(c) || 0) + 1); }
  }
  const realms = tiles.size;

  const settled = world.settlements.filter(s => s.mode === "settled");
  let urban = 0, rural = 0, ran = 0, bind = 0, disk = 0;
  for (const s of settled) {
    urban += s._urbanPop || 0;
    rural += s._ruralPop || 0;
    if (s._coreBlockRan) ran++;
    if (s._coreLocalBind) bind++;
    if (s._coreDiskBound) disk++;
  }
  const nS = Math.max(1, settled.length);

  // THE PIN ITSELF — the owner's actual complaint ("most cities at 12k?"), which
  // every metric above only reaches indirectly through aggregate mass. A pin is
  // not a low mean, it is a MODE: 186 of 273 cores sat at EXACTLY 12.00 sim
  // units, the founding stamp (crystallize.js, TIER_CORE[2]/bridge x 1.2), and
  // an average can move a lot while that spike stays exactly where it was. So
  // measure the spike: round the core to 2dp, take the modal value, and report
  // what share of the register sits on it, beside the distribution it sits in.
  const cores = settled.map(s => s._urbanPop || 0).filter(v => v > 0).sort((x, y) => x - y);
  const modeCount = new Map();
  for (const v of cores) { const k = v.toFixed(2); modeCount.set(k, (modeCount.get(k) || 0) + 1); }
  let modeVal = "0", modeN = 0;
  for (const [k, n] of modeCount) if (n > modeN || (n === modeN && +k < +modeVal)) { modeVal = k; modeN = n; }
  const pc = (q) => cores.length ? cores[Math.min(cores.length - 1, Math.floor(q * cores.length))] : 0;

  // THE SATURATION SHARE — how much of the register has passed the point where
  // the only brake on urban concentration stops responding. settlement.js:3714-6
  // scales the urban graveyard by min(1, urbShare/0.3), so a settlement 30% urban
  // and one 90% urban carry the SAME crowd mortality; past 0.3 the driver keeps
  // growing and the counterforce does not. The world-wide urban share cannot
  // answer this — it is an average over a skewed distribution — so measure the
  // per-settlement share directly and count what is over the line.
  const shares = settled.map(s => (s._urbanPop || 0) / Math.max(1, s.people)).sort((x, y) => x - y);
  const sq = (q) => shares.length ? shares[Math.min(shares.length - 1, Math.floor(q * shares.length))] : 0;
  const overSat = shares.filter(v => v >= 0.3).length;

  const c = windowCounts(lo, hi);
  // Per-realm rates use the window's MEAN realm count, not its endpoint: the
  // register is growing fast enough here that the endpoint would flatter or
  // punish a window purely by which end you read it from.
  const meanRealms = Math.max(1, (realms + (report._prevRealms ?? realms)) / 2);
  const per = (k) => (c[k] / meanRealms).toFixed(4);

  console.log(`\n=== window ${lo}->${hi}  realms=${realms}  claimed=${(100 * claimed / landN).toFixed(1)}%  settled=${settled.length}`);
  console.log(`    FLOWS in-window   founded=${c["polity.founded"]} ended=${c["polity.ended"]} seceded=${c["polity.seceded"]} shattered=${c["polity.shattered"]}`);
  console.log(`    FLOWS per realm   founded=${per("polity.founded")} ended=${per("polity.ended")} seceded=${per("polity.seceded")} shattered=${per("polity.shattered")}   (meanRealms=${meanRealms.toFixed(0)})`);
  console.log(`    WAR in-window     began=${c["war.began"]} ended=${c["war.ended"]} captured=${c["settlement.captured"]} sacked=${c["polity.submittedBySack"]}`);
  console.log(`    WAR per realm     began=${per("war.began")} captured=${per("settlement.captured")}`);
  console.log(`    CORES p10=${pc(0.1).toFixed(1)} p50=${pc(0.5).toFixed(1)} p90=${pc(0.9).toFixed(1)} max=${(cores[cores.length - 1] || 0).toFixed(1)}su  |  MODE ${modeVal}su held by ${modeN}/${cores.length} (${(100 * modeN / Math.max(1, cores.length)).toFixed(1)}%)  <- the pin`);
  console.log(`    URBSHARE/sett p50=${sq(0.5).toFixed(3)} p90=${sq(0.9).toFixed(3)} max=${(shares[shares.length - 1] || 0).toFixed(3)}  |  >=0.30 (graveyard saturated): ${overSat}/${shares.length} (${(100 * overSat / Math.max(1, shares.length)).toFixed(1)}%)`);
  console.log(`    MASS  urban=${Math.round(urban)}su rural=${Math.round(rural)}su urbanShare=${(100 * urban / Math.max(1e-9, urban + rural)).toFixed(2)}%`);
  // diskBound is the memo §5.3 metric and it belongs beside the arming pair: it
  // is the brake (min(_coreF, ·)) that keeps urbanisation under history's
  // agrarian ceiling, and its radius grows with the grid — so its share is the
  // number that says whether the ceiling still holds at the grid that ships.
  console.log(`    ARMING  blockRan=${(100 * ran / nS).toFixed(1)}%  bind=${(100 * bind / nS).toFixed(1)}%  diskBound=${(100 * disk / nS).toFixed(1)}%  [CORE_LOCAL=${T.CORE_LOCAL} LAND_KNOW=${T.LAND_KNOW}]`);
  if (!ran) console.log(`    !! ARMING FAILED: the urban-core block executed for NO settlement. This arm measured nothing about CORE_LOCAL, whatever else it printed.`);
  else if (T.CORE_LOCAL && !bind) console.log(`    !! LEVER INERT: the block ran but the local claim never beat the founding hold. Not evidence of "no effect".`);
  console.log(`    MACHINE ${lo} ${hi} ${realms} ${(100 * claimed / landN).toFixed(3)} ${c["polity.founded"]} ${c["polity.ended"]} ${c["polity.seceded"]} ${c["polity.shattered"]} ${c["war.began"]} ${c["settlement.captured"]} ${Math.round(urban)} ${Math.round(rural)} ${(100 * ran / nS).toFixed(2)} ${(100 * bind / nS).toFixed(2)} ${(100 * disk / nS).toFixed(2)}`);
  console.log(`    [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
  report._prevRealms = realms;
}

console.log(`[milbalance] W=${W} seed=${SEED} steps=${STEPS} every=${EVERY}`);
console.log(`[milbalance] MACHINE columns: lo hi realms claimed% founded ended seceded shattered warBegan captured urbanSU ruralSU blockRan% bind% diskBound%`);
const t0 = Date.now();
let lo = 0;
while (world.step < STEPS) {
  const next = Math.min(STEPS, world.step + EVERY);
  while (world.step < next) stepPeopleSim(world, 1);
  report(lo, world.step, t0);
  lo = world.step;
}
