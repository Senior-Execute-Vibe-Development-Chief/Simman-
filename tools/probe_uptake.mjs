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
// FINDINGS 2026-08-25 (measured; run logs in docs/runs/2026-08-25/uptake_*):
//   · Worlds are PRE-URBAN far longer than the old 10k probe horizons: first
//     cities ~15-18k (solver-240, obs-240) and ~19-20k (obs-480). Measure at
//     24k/30k/32k.
//   · BASELINE, all three regimes: the hungry register is LEAF-dominated —
//     obs-240 30k: hungry 449/535, of them LEAF 377 + DRY-SURPLUS 71,
//     CAPPED ~0; obs-480 26k: 248/297 LEAF; solver-240 24k: 12/13. A leaf
//     (82-84% of every register) can neither buy (no children) nor SELL (no
//     parent → never offers), so the market cannot see the world's surplus:
//     Σland 441 vs ΣcoreNeed 207 (obs-240 30k) — the food EXISTS at 2.1×
//     need and cities starve at fed p50 0.08. Once a tree exists the
//     levy/coin stages CLEAR (unbought ≈ 0, coin-capped 0-2 of 4-10) — the
//     topology, not org or coin, is the binding constraint.
//   · T.GRAIN_MARKET=1 A/B (obs-240 30k, final v47 build): importers 3→175,
//     peer grain 12.3/tick vs the tree's ~1.4, fed(leaf) p50 0.08→0.58
//     (fedNOW p50 0.75), W-Europe 0.85 / Pontic 0.82 / India 0.70 vs
//     baseline 0.04-0.50, importShare p90 0.00→1.00 — URBAN_AGGLOM has fuel
//     at non-capitals. Egypt residual 0.24 (atomized bronze singletons: no
//     coin, no levy tree — the register-atomization wave's item). Most
//     hungry-labeled leaves read MKT-COVERED (need closed same tick; the
//     label is the ~230-tick _fedM average lagging on a churning register —
//     fedNOW is the instantaneous read); MKT-SHORT-idle under the v47 build
//     is mostly the institution gate (pre-coinage cities the classifier's
//     coin check cannot see).
//   · THE THREE RULES the 777 elimination forced into the shipped form, and
//     the chaos-ensemble lesson (777's no-mechanism alive-count spans 20-22
//     vs the recorded 40 — a lucky draw; the market cluster sat at a REAL
//     14-15 until all three landed): seed-corn (granary refills before
//     exports), the market institution gate (techEff.market — dawn trades
//     flattened the early urban distribution and cost the marginal world
//     its first founding cascade, +1 vs +7), and the export capacity
//     ADD-BACK (not a max()-vs-production floor, which was a cross-tick
//     ratchet muting harvest-year capacity signals from tick 1). Full
//     record: tuning.js GRAIN_MARKET desc + docs/harvest-years-2026-08-25.md.
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
  for (const s of world.settlements) { s._dbgPeerIn = 0; s._dbgPeerOut = 0; }   // window-scoped accumulators
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
  const mkt = { "MKT-COVERED": 0, "MKT-NOREACH": 0, "MKT-NOSELLER": 0, "MKT-HAULDEAD": 0, "MKT-NOCOIN": 0, "MKT-SHORT-bought": 0, "MKT-SHORT-idle": 0 };
  const fedLeaf = [], fedPar = [], fedNow = [], impShares = [], spares = [];
  // Channel discriminators (the 777 depression isolation): concentration →
  // graveyard (urban share, cores), fish suppression at import-fed coasts
  // (fish = supply − net, the un-stashed local perishable), coin drain.
  const cores = [], wealths = [], peerIns = [];
  let sumPeople = 0, sumUrban = 0, sumFish = 0, sumSupplyF = 0;
  let hungry = 0, coinCapPar = 0, buyingPar = 0;
  const boxStat = {}; for (const k in BOXES) boxStat[k] = { n: 0, fed: [], imp: 0, leaf: 0 };
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const kids = kidsOf.get(s.id) || [];
    const isPar = kids.length > 0;
    if (isPar) parents++; else leaves++;
    const fed = s._fedM ?? 1;
    (isPar ? fedPar : fedLeaf).push(fed);
    fedNow.push((s._coreNeed || 0) > 0 ? Math.min(1, (s._foodSupply || 0) / s._coreNeed) : 1);   // INSTANTANEOUS fed — separates the ~230-tick _fedM lag from a real shortfall
    cores.push(s._urbanPop ?? 0); wealths.push(s.wealth || 0);
    if ((s._dbgPeerIn || 0) > 0) peerIns.push(s._dbgPeerIn);
    sumPeople += s.people || 0; sumUrban += s._urbanPop || 0;
    sumFish += Math.max(0, (s._foodSupply || 0) - (s._foodNet !== undefined ? s._foodNet : (s._landFood || 0)));
    sumSupplyF += s._foodSupply || 0;
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
          if (needNow <= 1e-6) mkt["MKT-COVERED"]++;   // bought to full need this tick — _fedM (a ~230-tick average) still catching up
          else if (resid <= 1e-6) mkt["MKT-NOSELLER"]++;
          else if (landable < needNow * 0.05) mkt["MKT-HAULDEAD"]++;
          else if ((s.wealth || 0) - getWealthReserve(s) <= 1e-6) mkt["MKT-NOCOIN"]++;
          else mkt[(s._dbgPeerIn || 0) > 0 ? "MKT-SHORT-bought" : "MKT-SHORT-idle"]++;   // idle with sellers+haul+coin = a mechanism bug
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
  console.log(`   fed  leaf p10/50/90 ${q(fedLeaf, .1).toFixed(2)}/${q(fedLeaf, .5).toFixed(2)}/${q(fedLeaf, .9).toFixed(2)}  parent ${q(fedPar, .1).toFixed(2)}/${q(fedPar, .5).toFixed(2)}/${q(fedPar, .9).toFixed(2)} · fedNOW p10/50/90 ${q(fedNow, .1).toFixed(2)}/${q(fedNow, .5).toFixed(2)}/${q(fedNow, .9).toFixed(2)} · importShare p50/p90 ${q(impShares, .5).toFixed(2)}/${q(impShares, .9).toFixed(2)} · spare-coin p50 ${q(spares, .5).toFixed(1)}`);
  peerIns.sort((a, b) => b - a);
  const peerTot = peerIns.reduce((a, b) => a + b, 0);
  const top3 = peerIns.slice(0, 3).reduce((a, b) => a + b, 0);
  console.log(`   channels  Σpeople ${sumPeople.toFixed(0)} · urbanShare ${(sumPeople > 0 ? sumUrban / sumPeople : 0).toFixed(3)} · core p50/p90 ${q(cores, .5).toFixed(1)}/${q(cores, .9).toFixed(1)} · fishShare ${(sumSupplyF > 0 ? sumFish / sumSupplyF : 0).toFixed(3)} · wealth p50 ${q(wealths, .5).toFixed(0)} · peer-buyers ${peerIns.length} top3share ${peerTot > 0 ? (top3 / peerTot).toFixed(2) : "n/a"}`);
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
