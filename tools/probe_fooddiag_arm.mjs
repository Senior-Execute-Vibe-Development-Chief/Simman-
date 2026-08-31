// Single-arm food/ratchet diagnostic — spawned by probe_fooddiag.mjs (one process
// per arm so memory is released between runs). Do not run 960/32k arms in parallel.
//
//   node tools/probe_fooddiag_arm.mjs [W] [steps] [seed] [armLabel]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const W = +(process.argv[2] || 480), H = W >> 1;
const STEPS = +(process.argv[3] || 24000);
const SEED = +(process.argv[4] || 8817);
const LABEL = process.argv[5] || "arm";
const EVERY = 4000;
const REPORT_FROM = 12000;   // skip Neolithic silence — political map wakes ~20k on live arm at 960; 480 is earlier

const world = buildSim({ W, H, seed: SEED });
let landN = 0;
for (let i = 0; i < world.N; i++) if (world.elev[i] > 0) landN++;

function crossBorderShare() {
  const owner = world._territoryOwner, co = world._countryOwner, elev = world.elev;
  if (!owner || !co) return { pct: 0, n: 0 };
  const byId = world._byId;
  let farmed = 0, foreign = 0;
  for (let ti = 0; ti < world.N; ti++) {
    if (elev[ti] <= 0) continue;
    const oid = owner[ti];
    if (oid < 0) continue;
    farmed++;
    const s = byId?.get(oid);
    if (!s) continue;
    const pol = co[ti];
    if (pol >= 0 && pol !== s.countryId) foreign++;
  }
  return { pct: farmed ? foreign / farmed : 0, n: foreign, farmed };
}

function telemetry() {
  const th = world._terrHeap;
  const ts = world._transStat;
  const mu = process.memoryUsage();
  return {
    heapMB: (mu.heapUsed / 1e6).toFixed(0),
    terrN: th?.n ?? 0,
    terrCap: th?.cap ?? 0,
    transPeakN: ts?.peakN ?? 0,
    transCap: ts?.peakCap ?? 0,
  };
}

function report(lo, hi) {
  const co = world._countryOwner, elev = world.elev, N = world.N;
  const tiles = new Map();
  let claimed = 0;
  for (let i = 0; i < N; i++) {
    if (elev[i] <= 0) continue;
    const c = co ? co[i] : -1;
    if (c >= 0) { claimed++; tiles.set(c, (tiles.get(c) || 0) + 1); }
  }
  const realms = tiles.size;
  const settled = world.settlements.filter(s => s.mode === "settled");
  let urban = 0, rural = 0, ran = 0, bind = 0, disk = 0, nS = settled.length;
  for (const s of settled) {
    urban += s._urbanPop || 0;
    rural += s._ruralPop || 0;
    if (s._coreBlockRan) ran++;
    if (s._coreLocalBind) bind++;
    if (s._coreDiskBound) disk++;
  }
  const cores = settled.map(s => s._urbanPop || 0).filter(v => v > 0).sort((a, b) => a - b);
  const maxCore = cores.length ? cores[cores.length - 1] : 0;
  const modeCount = new Map();
  for (const v of cores) { const k = v.toFixed(2); modeCount.set(k, (modeCount.get(k) || 0) + 1); }
  let modeVal = "0", modeN = 0;
  for (const [k, n] of modeCount) if (n > modeN || (n === modeN && +k < +modeVal)) { modeVal = k; modeN = n; }
  const cb = crossBorderShare();
  const tel = telemetry();

  const c = { founded: 0, ended: 0, seceded: 0, shattered: 0, warBegan: 0, captured: 0 };
  for (const ev of world.events || []) {
    const st = ev.step | 0;
    if (st <= lo || st > hi) continue;
    if (ev.type === "polity.founded") c.founded++;
    else if (ev.type === "polity.ended") c.ended++;
    else if (ev.type === "polity.seceded") c.seceded++;
    else if (ev.type === "polity.shattered") c.shattered++;
    else if (ev.type === "war.began") c.warBegan++;
    else if (ev.type === "settlement.captured") c.captured++;
  }

  console.log(`\n=== [${LABEL}] window ${lo}->${hi}  realms=${realms}  settled=${nS}  claimed=${(100 * claimed / landN).toFixed(1)}%`);
  console.log(`    urbanShare=${(100 * urban / Math.max(1e-9, urban + rural)).toFixed(2)}%  maxCore=${maxCore.toFixed(1)}su  mode=${modeVal}su (${modeN}/${cores.length})`);
  console.log(`    crossBorderFarm=${(100 * cb.pct).toFixed(1)}% (${cb.n}/${cb.farmed} farmed tiles)`);
  console.log(`    CRASH_RISK heap=${tel.heapMB}MB terrHeap n=${tel.terrN} cap=${tel.terrCap} transPeakN=${tel.transPeakN} transCap=${tel.transCap}`);
  console.log(`    MARKET_PULL=${T.MARKET_PULL} PRICE_GROSS=${T.PRICE_GROSS} HAUL_PAID=${T.HAUL_PAID} URBAN_LABOR=${T.URBAN_LABOR} CORE_LOCAL=${T.CORE_LOCAL}`);
  console.log(`    MACHINE ${lo} ${hi} ${realms} ${(100 * claimed / landN).toFixed(3)} ${c.founded} ${c.ended} ${c.seceded} ${c.shattered} ${c.warBegan} ${c.captured} ${Math.round(urban)} ${Math.round(rural)} ${(100 * ran / Math.max(1, nS)).toFixed(2)} ${(100 * bind / Math.max(1, nS)).toFixed(2)} ${(100 * disk / Math.max(1, nS)).toFixed(2)}`);

  if (+tel.heapMB > 3500) console.log(`    !! HEAP_WARN: ${tel.heapMB}MB — risk of OOM if another arm runs in parallel`);
  if (tel.transCap > 131072) console.log(`    !! TRANS_HEAP_WARN: cap=${tel.transCap} — transport frontier runaway (allocation-wall pattern)`);
}

console.log(`[fooddiag-arm] label=${LABEL} W=${W} seed=${SEED} steps=${STEPS} SIM_TUNE=${process.env.SIM_TUNE || ""}`);
const t0 = Date.now();
let lo = 0;
while (world.step < STEPS) {
  const next = Math.min(STEPS, world.step + EVERY);
  while (world.step < next) stepPeopleSim(world, 1);
  if (lo >= REPORT_FROM || next >= REPORT_FROM) report(lo, world.step);
  lo = world.step;
}
console.log(`[fooddiag-arm] done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
