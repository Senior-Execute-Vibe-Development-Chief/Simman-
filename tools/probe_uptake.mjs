// THE IMPORT-UPTAKE FUNNEL — where does city-feeding grain actually die?
// (2026-08-25, the import/uptake wave. The play-report lap measured the
// SYMPTOM: cities fed ≈ 0.27 with importShare 0.00, cores pinned at the
// 12k bar because URBAN_AGGLOM's fuel is import-fed capacity. This probe
// decomposes the CAUSE, stage by stage, on the real code — foodHierarchy.js
// writes per-node levy/buy debug fields only when this probe installs
// world._tradeStats.)
//
// The pipeline, in order, with the constraint each stage can impose:
//   1. TOPOLOGY   grain moves ONLY child→liege inside one country. A city
//                 with no same-country children CANNOT import, ever (a leaf
//                 exports; a singleton trades nothing). Measures how much of
//                 the register is structurally outside the market.
//   2. SURPLUS    children's pool − demand (pre-haul): is there grain below?
//   3. HAUL       × exp(−d/range): does it survive the trip to this market?
//   4. LEVY       parent requisitions 0.7·foodReach(org) in kind — org-capped.
//   5. COIN       parent buys the rest, capped by spare wealth − reserve.
//   6. FUEL       importShare = (foodNet − landFood)/supply → URBAN_AGGLOM
//                 kBeyond: does what arrives even register as agglom fuel?
//
// Per checkpoint: a stats window (60 ticks) accumulates real levy/buy splits,
// then the register is classified: every hungry city (fedM < 0.85) is
// attributed to the FIRST stage that starves it — LEAF (no children),
// DRY-SURPLUS (children, no surplus below), DRY-HAUL (surplus dies in
// transit), CAPPED (offers arrive; levy+coin uptake < deficit), FED-SHORT
// (uptake flows yet supply still short — land gap bigger than the market).
// Regional boxes (Egypt/Mideast, India, Pontic, W-Europe) localize it.
//
//   SIM_TUNE="<live arm>" node tools/probe_uptake.mjs [steps=10000] [W=480] [seed=8817] [--solver]
//
// (Findings land in this header AFTER the runs — never before. A predicted
// funnel is a hypothesis; the header carries only measurements.)
import { readFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { TIER_CORE, getWealthReserve } from "../src/sim/peopleSim/settlement.js";
import { foodHaulArrive } from "../src/sim/peopleSim/foodHierarchy.js";
import { mergeReach } from "../src/sim/peopleSim/roads.js";

const args = process.argv.slice(2).filter(a => a !== "--solver");
const SOLVER = process.argv.includes("--solver");
const STEPS = +(args[0] || 10000);
const W = +(args[1] || 480), H = W >> 1, SEED = +(args[2] || 8817);
const CKPT = 2000, WIN = 60;   // stats window ticks per checkpoint

let world;
if (SOLVER) {
  world = buildSim({ W, H, seed: SEED });
} else {
  const rc = await import("../src/realClimateData.js");
  const load = n => JSON.parse(readFileSync(new URL(`../data/${n}`, import.meta.url)));
  rc.provideRealClimateData(load("global_precip.json"), load("global_airtemp.json"));
  world = buildSim({ W, H, seed: SEED, realWind: true, realWindFns: { isRealWindAvailable: () => false, isRealClimateAvailable: rc.isRealClimateAvailable, fillRealClimate: rc.fillRealClimate } });
}

const tw = world.tw, th = world.th;
const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);
const lonX = lon => Math.round((lon + 180) / 360 * tw), latY = lat => Math.round((90 - lat) / 180 * th);
// [x0,x1,y0,y1] boxes — belt-honest (the probe_yieldcv lesson)
const BOXES = SOLVER ? {} : {
  "Egypt/Mideast": [lonX(25), lonX(50), latY(38), latY(15)],
  "India":         [lonX(68), lonX(90), latY(28), latY(8)],
  "Pontic":        [lonX(25), lonX(45), latY(52), latY(42)],
  "W-Europe":      [lonX(-8), lonX(20), latY(54), latY(40)],
};
const inBox = (s, b) => { const x = s.pos.x | 0, y = s.pos.y | 0; return x >= b[0] && x <= b[1] && y >= b[2] && y <= b[3]; };

console.log(`\n=== IMPORT-UPTAKE FUNNEL  ${W}x${H} (tw=${tw})  seed ${SEED}  ${SOLVER ? "SOLVER defaults" : "OBSERVED + arm"}  ${STEPS} steps ===\n`);

for (let done = 0; done < STEPS; done += CKPT) {
  stepPeopleSim(world, CKPT - WIN);
  // stats window: accumulate the levy/buy split on the real sweep
  world._tradeStats = { levied: 0, bought: 0, unbought: 0, peerBought: 0 };
  stepPeopleSim(world, WIN);
  const ts = world._tradeStats;
  world._tradeStats = null;

  // ── children map from the same rule the market uses ──
  const byId = world._byId;
  const kidsOf = new Map();
  let n = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    n++;
    const L = (s.liegeId >= 0 && s.countryId >= 0) ? byId.get(s.liegeId) : null;
    if (L && L.mode === "settled" && L.countryId === s.countryId && L.id !== s.id) {
      let a = kidsOf.get(L.id); if (!a) kidsOf.set(L.id, a = []); a.push(s);
    }
  }
  const polities = new Set();
  for (const s of world.settlements) if (s.mode === "settled" && s.countryId >= 0) polities.add(s.countryId);

  // ── per-city classification ──
  let leaves = 0, parents = 0, importersLive = 0;
  let coreNeedSum = 0, supplySum = 0, landSum = 0, offerSum = 0;
  const cls = { LEAF: 0, "DRY-SURPLUS": 0, "DRY-HAUL": 0, CAPPED: 0, "FED-SHORT": 0 };
  // Market-stage attribution for hungry LEAVES — what stands between each one
  // and the OPEN market (meaningful with T.GRAIN_MARKET on: the residual funnel
  // after the peer pass; with it off: what the market WOULD need). Post-pass
  // reads, so residuals are what's LEFT after this tick's sales — a ranking of
  // causes, not an exact ledger.
  const mkt = { "MKT-NOREACH": 0, "MKT-NOSELLER": 0, "MKT-HAULDEAD": 0, "MKT-NOCOIN": 0, "MKT-SHORT": 0 };
  const fedLeaf = [], fedPar = [], impShares = [], spares = [];
  let hungry = 0, coinCapPar = 0, buyingPar = 0;
  const boxStat = {}; for (const k in BOXES) boxStat[k] = { n: 0, fed: [], imp: 0, leaf: 0 };
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const kids = kidsOf.get(s.id) || [];
    const isPar = kids.length > 0;
    if (isPar) parents++; else leaves++;
    const fed = s._fedM ?? 1;
    (isPar ? fedPar : fedLeaf).push(fed);
    const supply = s._foodSupply || 0;
    coreNeedSum += s._coreNeed || 0; supplySum += supply; landSum += s._landFood || 0;
    offerSum += s._foodOffer || 0;
    const isr = supply > 0 ? Math.max(0, Math.min(1, ((s._foodNet ?? 0) - (s._landFood || 0)) / supply)) : 0;
    impShares.push(isr);
    if (isr > 0.02) importersLive++;
    spares.push(s._dbgSpare0 ?? 0);
    if (isPar && (s._dbgBought || 0) + (s._dbgUnbought || 0) > 1e-9) {
      buyingPar++;
      if ((s._dbgUnbought || 0) > 1e-9) coinCapPar++;
    }
    for (const k in BOXES) if (inBox(s, BOXES[k])) {
      const b = boxStat[k]; b.n++; b.fed.push(fed); if (isr > 0.02) b.imp++; if (!isPar) b.leaf++;
    }
    // attribution for the hungry
    if (fed < 0.85) {
      hungry++;
      if (!isPar) {
        cls.LEAF++;
        const reach = mergeReach(s);
        if (!reach || reach.size === 0) mkt["MKT-NOREACH"]++;
        else {
          let resid = 0, landable = 0;
          for (const [pid] of reach) {
            const p = byId.get(pid);
            if (!p || p.mode !== "settled" || p.id === s.id) continue;
            const r = Math.max(0, (p._foodNet || 0) - (p._foodDemand || 0));
            if (r <= 0) continue;
            resid += r;
            landable += r * foodHaulArrive(world, p, s);
          }
          const needNow = Math.max(0, (s._foodDemand || 0) - (s._foodNet || 0));
          if (resid <= 1e-6) mkt["MKT-NOSELLER"]++;
          else if (landable < Math.max(1e-6, needNow) * 0.05) mkt["MKT-HAULDEAD"]++;
          else if ((s.wealth || 0) - getWealthReserve(s) <= 1e-6) mkt["MKT-NOCOIN"]++;
          else mkt["MKT-SHORT"]++;
        }
      } else {
        let kidSurp = 0, kidOffer = 0;
        for (const k of kids) {
          kidSurp += Math.max(0, (k._foodPool || 0) - (k._foodDemand || 0));
          kidOffer += k._foodOffer || 0;
        }
        const uptake = (s._dbgLevied || 0) + (s._dbgBought || 0);
        if (kidSurp <= 1e-6) cls["DRY-SURPLUS"]++;
        else if (kidOffer <= 1e-6) cls["DRY-HAUL"]++;
        else if ((s._dbgUnbought || 0) > 1e-9 || uptake < kidOffer * 0.9) cls.CAPPED++;
        else cls["FED-SHORT"]++;
      }
    }
  }
  const perTick = v => (v / WIN).toFixed(2);
  console.log(`step ${String(world.step).padStart(6)}  n ${n} · polities ${polities.size} (${(n / Math.max(1, polities.size)).toFixed(1)}/realm) · parents ${parents} · leaves ${leaves} (${Math.round(100 * leaves / Math.max(1, n))}%) · importers(isr>.02) ${importersLive}`);
  console.log(`   flow/tick  offers ${perTick((ts.levied + ts.bought + ts.unbought) * 1)}  levied ${perTick(ts.levied)}  bought ${perTick(ts.bought)}  unbought ${perTick(ts.unbought)}  PEER-bought ${perTick(ts.peerBought || 0)} · coin-capped parents ${coinCapPar}/${buyingPar} · ΣcoreNeed ${coreNeedSum.toFixed(1)} Σsupply ${supplySum.toFixed(1)} Σland ${landSum.toFixed(1)}`);
  console.log(`   fed  leaf p10/50/90 ${q(fedLeaf, .1).toFixed(2)}/${q(fedLeaf, .5).toFixed(2)}/${q(fedLeaf, .9).toFixed(2)}  parent ${q(fedPar, .1).toFixed(2)}/${q(fedPar, .5).toFixed(2)}/${q(fedPar, .9).toFixed(2)} · importShare p50/p90 ${q(impShares, .5).toFixed(2)}/${q(impShares, .9).toFixed(2)} · spare-coin p50 ${q(spares, .5).toFixed(1)}`);
  const at = Object.entries(cls).map(([k, v]) => `${k} ${v}`).join(" · ");
  console.log(`   hungry(<0.85) ${hungry}/${n}:  ${at}`);
  if (cls.LEAF > 0) console.log(`     leaf market stage:  ${Object.entries(mkt).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(" · ") || "(none classified)"}`);
  for (const k in BOXES) {
    const b = boxStat[k];
    if (b.n) console.log(`     ${k.padEnd(14)} n ${String(b.n).padStart(3)} · fed p50 ${q(b.fed, .5).toFixed(2)} · importers ${b.imp} · leaf ${Math.round(100 * b.leaf / b.n)}%`);
  }
  console.log("");
}
console.log(`READ: LEAF-dominated hungry = the topology starves non-capitals (peer/market`);
console.log(`trade is the missing system). CAPPED-dominated = levy org / buyer coin is the`);
console.log(`throttle. DRY-SURPLUS at capitals = the land gap is upstream of the market.`);
