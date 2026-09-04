// LANE C0-4 — territory-fill audit: measure the FILL ECONOMY on HEAD.
// For each territory pass: recompute every realm's step-4 target (replicating
// countryTerritory.js fieldPolityTerritory exactly, read-only), read held load
// from world._countryOwner/_fpDist, and classify each realm's growth regime:
//   AT_TARGET   held >= target            (honest smallness — target binds)
//   RATE_LIM    target-held > rateCap     (per-pass budget binds)
//   HEADROOM    0 < target-held <= rateCap (should fill next pass; if it doesn't,
//                                          the cost field / frontier starvation binds)
// Plus: claimed% trajectory, budget spent vs available (pass-to-pass held delta),
// wild-land population above the self-funding contour, realm contact statistics
// (shared borders + nearest-realm BFS gap), war/flow event windows.
//   node tools/probe_fillaudit.mjs [W] [steps] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T, rNormPop } from "../src/sim/peopleSim/tuning.js";
import { resScaleFor } from "../src/sim/peopleSim/countryTerritory.js";

const W = parseInt(process.argv[2] || "480", 10);
const STEPS = parseInt(process.argv[3] || "12000", 10);
const SEED = parseInt(process.argv[4] || "8817", 10);
const CONTACT_EVERY = 2000;

const t0 = Date.now();
const world = buildSim({ W, H: W >> 1, seed: SEED });
console.log(`fill-audit worldgen ${W}x${W >> 1} -> tw ${world.tw}x${world.th} seed=${SEED} steps=${STEPS} build=${((Date.now() - t0) / 1000).toFixed(0)}s`);

const { tw, th, N } = world;
const resScale = resScaleFor(tw), r2 = resScale * resScale;
const terrIvl = Math.max(T.TERRITORY_INTERVAL, Math.round(T.TERRITORY_INTERVAL * rNormPop(world)));
const rateCap = Math.max(1, Math.round((T.EXPAND_RATE ?? 8) * r2 * resScale * (T.POP_FIELD ? 12 : 1)));
const ADMIN_HALF_EFF = Math.max(1e-9, (T.ADMIN_HALF || 15) * resScale);
const loadOfD = (d) => 1 + (Number.isFinite(d) ? d : 0) / ADMIN_HALF_EFF;
const ADMIN_LOAD_RECAL = 1.18;
const FIELD_SPAN = T.FIELD_SPAN || 6;
const adminOn = T.FIELD_ADMIN > 0;
const spanEff = FIELD_SPAN * (adminOn ? ADMIN_LOAD_RECAL : 1);
const spanL = T.LAND_KNOW ? 0.85 : 0;
const BIND_DENS_ENV = +(process.env.SIM_BIND_DENS || 0);
const BIND_DENS = (BIND_DENS_ENV > 0 ? BIND_DENS_ENV : (T.RURAL_BIND_DENS ?? 8000)) / r2;   // people per SIM tile (mirrors countryTerritory BIND_DENS_ENV)
const MARCH_TILES = 150, MARCH_POW = 2;
console.log(`resScale=${resScale} r2=${r2} terrIvl=${terrIvl} rateCap=${rateCap} load/pass  BIND_DENS=${BIND_DENS}/sim-tile  spanEff=${spanEff.toFixed(2)}  adminOn=${adminOn}`);

let landN = 0; { const e = world.elev; for (let i = 0; i < N; i++) if (e[i] > 0) landN++; }
console.log(`landN=${landN} (${(landN / N * 100).toFixed(1)}% of ${N})`);

const q1 = (a, p) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };

// per-pass sampled state
let prevHeldLoad = null;   // cid -> held load at previous pass
let prevBudget = null;     // cid -> grow budget computed at previous pass
let evCursor = 0;
const evWin = () => {
  const evs = world.events || [];
  const out = {};
  for (let i = evCursor; i < evs.length; i++) { const t = evs[i].type; out[t] = (out[t] || 0) + 1; }
  evCursor = evs.length;
  return out;
};

// cumulative budget economy
let cumBudget = 0, cumSpent = 0, cumRateClip = 0, cumGapRaw = 0;
// per-window stall attribution tallies (realm-passes)
let wAt = 0, wRate = 0, wHead = 0, wHeadStarved = 0, wNoTarget = 0, wNomad = 0;

function measurePass(step, detail) {
  const co = world._countryOwner, dist = world._fpDist, elev = world.elev, pf = world.popField;
  if (!co) return;
  const alive = new Set();
  for (const s of world.settlements) if (s.mode === "settled" && s.countryId >= 0) alive.add(s.countryId);
  // held load + tiles + govPop per realm; claimed count; pop shares
  const heldLoad = new Map(), heldTiles = new Map(), govPop = new Map();
  let claimed = 0, pfTot = 0, pfGov = 0;
  for (let ti = 0; ti < N; ti++) {
    if (!(elev[ti] > 0)) continue;
    const p = pf ? pf[ti] : 0; pfTot += p;
    const c = co[ti]; if (c < 0) continue;
    claimed++;
    heldLoad.set(c, (heldLoad.get(c) || 0) + (adminOn ? loadOfD(dist[ti]) : 1));
    heldTiles.set(c, (heldTiles.get(c) || 0) + 1);
    govPop.set(c, (govPop.get(c) || 0) + p);
    pfGov += p;
  }
  // wild frontier per realm (8-conn wild land tiles adjacent to each realm) + wild density census
  const wildAdj = new Map();
  let wildAbove1 = 0, wildAboveHalf = 0, wildAboveQ = 0, wildAbove10 = 0;
  for (let ti = 0; ti < N; ti++) {
    if (!(elev[ti] > 0) || co[ti] >= 0) continue;
    const p = pf ? pf[ti] : 0;
    if (p >= BIND_DENS) wildAbove1++;
    if (p >= BIND_DENS * 0.5) wildAboveHalf++;
    if (p >= BIND_DENS * 0.25) wildAboveQ++;
    if (p >= BIND_DENS * 0.1) wildAbove10++;
    const y = (ti / tw) | 0, x = ti - y * tw;
    const xm = x === 0 ? tw - 1 : x - 1, xp = x === tw - 1 ? 0 : x + 1;
    const ns = [y * tw + xm, y * tw + xp, y > 0 ? ti - tw : -1, y < th - 1 ? ti + tw : -1,
      y > 0 ? (y - 1) * tw + xm : -1, y > 0 ? (y - 1) * tw + xp : -1,
      y < th - 1 ? (y + 1) * tw + xm : -1, y < th - 1 ? (y + 1) * tw + xp : -1];
    const seen = new Set();
    for (let k = 0; k < 8; k++) { const ni = ns[k]; if (ni >= 0 && co[ni] >= 0 && !seen.has(co[ni])) { seen.add(co[ni]); wildAdj.set(co[ni], (wildAdj.get(co[ni]) || 0) + 1); } }
  }
  // step-4 target replication
  const targets = new Map(); let noTarget = 0, nomads = 0;
  let sumPopCap = 0, sumMarch = 0, sumCapTarget = 0;
  const inCap = new Set();
  if (world.countries) for (const [cid, c] of world.countries) {
    if (!alive.has(cid) || !c.capital) continue;
    inCap.add(cid);
    const kn = c.capital.knowledge || {};
    const org = kn.organization || 0;
    const stm = spanL <= 0 ? 1 : 1 - spanL * (1 - Math.min(1, org));
    const cons = kn.construction || 0;
    const logi = (c.capital._techEff ? c.capital._techEff.logisticsLevel : cons * cons) || 0;
    const cp = Math.max(0, c._capacity || 0);
    let t = Math.round(spanEff * stm * cp * r2);
    if (T.SIZE_BY_POP && pf) {
      if (c._nomadic) { nomads++; sumCapTarget += t; }
      else {
        const popCap = Math.round((govPop.get(cid) || 0) * stm * (adminOn ? ADMIN_LOAD_RECAL : 1) / BIND_DENS);
        const march = Math.round(MARCH_TILES * Math.pow(logi, MARCH_POW) * r2);
        t = popCap + march;
        sumPopCap += popCap; sumMarch += march;
      }
      if (t <= 0 && cp <= 0 && (govPop.get(cid) || 0) <= 0) continue;
    }
    if (t <= 0) continue;
    targets.set(cid, t);
  }
  for (const cid of alive) if (!inCap.has(cid)) noTarget++;
  // classification + budget economy
  let nAt = 0, nRate = 0, nHead = 0, nHeadStarved = 0;
  const gaps = [], budget = new Map();
  for (const [cid, t] of targets) {
    const h = heldLoad.get(cid) || 0;
    const gap = t - h;
    gaps.push(gap);
    if (gap <= 0) { nAt++; continue; }
    cumGapRaw += gap;
    const b = Math.min(gap, rateCap);
    budget.set(cid, b);
    cumBudget += b;
    if (gap > rateCap) { nRate++; cumRateClip += gap - rateCap; } else nHead++;
    if ((wildAdj.get(cid) || 0) === 0) nHeadStarved++;
  }
  // spent vs available from previous pass
  if (prevBudget) {
    for (const [cid, b] of prevBudget) {
      const d = (heldLoad.get(cid) || 0) - (prevHeldLoad.get(cid) || 0);
      cumSpent += Math.max(0, Math.min(d, b));
    }
  }
  prevHeldLoad = heldLoad; prevBudget = budget;
  wAt += nAt; wRate += nRate; wHead += nHead; wHeadStarved += nHeadStarved; wNoTarget += noTarget; wNomad += nomads;

  let lines = null;
  if (detail) {
    lines = [];
    const log = (x) => lines.push(x);
    const ht = [...heldTiles.values()];
    const tg = [...targets.values()];
    log(`  realms alive=${alive.size} targeted=${targets.size} noTarget=${noTarget} nomad=${nomads}`);
    log(`  heldTiles med=${q1(ht, 0.5)} p90=${q1(ht, 0.9)} max=${Math.max(0, ...ht)}  target(load) med=${q1(tg, 0.5)} p90=${q1(tg, 0.9)} max=${Math.max(0, ...tg)}  Σtarget=${tg.reduce((a, b) => a + b, 0) | 0} (Σland-load≈${(landN * 1.18) | 0})`);
    log(`  Σtarget split: popCap=${sumPopCap | 0} march=${sumMarch | 0} nomadCap=${sumCapTarget | 0}`);
    log(`  class: AT_TARGET=${nAt} RATE_LIM=${nRate} HEADROOM=${nHead} (of these frontier-starved=${nHeadStarved})`);
    log(`  gap(load): med=${q1(gaps, 0.5).toFixed(1)} p90=${q1(gaps, 0.9).toFixed(1)} max=${gaps.length ? Math.max(...gaps).toFixed(0) : 0}`);
    log(`  pop: pfTot=${(pfTot / 1e6).toFixed(2)}M governed=${(pfGov / 1e6).toFixed(2)}M (${(pfTot > 0 ? pfGov / pfTot * 100 : 0).toFixed(1)}% of people under a state on ${(claimed / landN * 100).toFixed(2)}% of land)`);
    log(`  wild land above bind-dens: 1x=${wildAbove1} 0.5x=${wildAboveHalf} 0.25x=${wildAboveQ} 0.1x=${wildAbove10} (of ${landN - claimed} wild tiles)`);
  }
  return { claimed, alive: alive.size, lines };
}

// contact statistics: shared borders + multi-source BFS nearest-realm gap
function contactStats() {
  const co = world._countryOwner, elev = world.elev;
  if (!co) return;
  const pairs = new Set(); let borderTiles = 0;
  const owners = new Set();
  for (let ti = 0; ti < N; ti++) {
    const c = co[ti]; if (c < 0) continue;
    owners.add(c);
    const y = (ti / tw) | 0, x = ti - y * tw;
    const xm = x === 0 ? tw - 1 : x - 1, xp = x === tw - 1 ? 0 : x + 1;
    const ns = [y * tw + xm, y * tw + xp, y > 0 ? ti - tw : -1, y < th - 1 ? ti + tw : -1,
      y > 0 ? (y - 1) * tw + xm : -1, y > 0 ? (y - 1) * tw + xp : -1,
      y < th - 1 ? (y + 1) * tw + xm : -1, y < th - 1 ? (y + 1) * tw + xp : -1];
    let touch = false;
    for (let k = 0; k < 8; k++) { const ni = ns[k]; if (ni >= 0) { const c2 = co[ni]; if (c2 >= 0 && c2 !== c) { touch = true; pairs.add(c < c2 ? c * 100000 + c2 : c2 * 100000 + c); } } }
    if (touch) borderTiles++;
  }
  // BFS over ALL tiles (land+sea, unit cost) from every claimed tile: geometric gap to nearest other realm
  const lab = new Int32Array(N).fill(-1), d = new Int32Array(N).fill(-1);
  let q = [];
  for (let ti = 0; ti < N; ti++) if (co[ti] >= 0) { lab[ti] = co[ti]; d[ti] = 0; q.push(ti); }
  const gapOf = new Map();   // cid -> min gap to another realm (tiles)
  const touched = new Set();
  while (q.length) {
    const nq = [];
    for (const ti of q) {
      const c = lab[ti], dd = d[ti];
      const y = (ti / tw) | 0, x = ti - y * tw;
      const xm = x === 0 ? tw - 1 : x - 1, xp = x === tw - 1 ? 0 : x + 1;
      const ns = [y * tw + xm, y * tw + xp, y > 0 ? ti - tw : -1, y < th - 1 ? ti + tw : -1];
      for (let k = 0; k < 4; k++) {
        const ni = ns[k]; if (ni < 0) continue;
        if (lab[ni] === -1) { lab[ni] = c; d[ni] = dd + 1; nq.push(ni); }
        else if (lab[ni] !== c) {
          const g = dd + d[ni];
          const a = c, b = lab[ni];
          if (!gapOf.has(a) || g < gapOf.get(a)) gapOf.set(a, g);
          if (!gapOf.has(b) || g < gapOf.get(b)) gapOf.set(b, g);
          touched.add(a); touched.add(b);
        }
      }
    }
    q = nq;
  }
  const gaps = [...gapOf.values()];
  const nOwners = owners.size;
  const contactRealms = new Set(); for (const p of pairs) { contactRealms.add((p / 100000) | 0); contactRealms.add(p % 100000); }
  console.log(`  contact: realms=${nOwners} sharedBorderPairs=${pairs.size} borderTiles=${borderTiles} realmsWithLandBorder=${contactRealms.size} (${(nOwners ? contactRealms.size / nOwners * 100 : 0).toFixed(0)}%)`);
  console.log(`  nearest-realm BFS gap (sim tiles; /${resScale}=ref): med=${q1(gaps, 0.5)} p90=${q1(gaps, 0.9)} max=${gaps.length ? Math.max(...gaps) : 0}`);
}

let lastCk = 0;
for (let s = 1; s <= STEPS; s++) {
  stepPeopleSim(world, 1);
  const isPass = (world.step === 1 || world.step % terrIvl === 0);
  const isCk = s % CONTACT_EVERY === 0;
  if (isPass || isCk) {
    const r = measurePass(s, isCk);
    if (isCk && r) {
      const ev = evWin();
      console.log(`\n== step ${s} == claimed ${r.claimed} tiles = ${(r.claimed / landN * 100).toFixed(2)}% of land, realms=${r.alive}, wall=${((Date.now() - t0) / 1000).toFixed(0)}s`);
      for (const ln of r.lines) console.log(ln);
      contactStats();
      const evStr = ["war.began", "settlement.captured", "settlement.annexed", "polity.shattered", "polity.receded", "polity.founded", "settlement.lapsed", "colony.chartered", "colony.independent"].map(k => `${k}=${ev[k] || 0}`).join(" ");
      console.log(`  events[${lastCk}-${s}]: ${evStr}`);
      console.log(`  budget economy (cumulative): Σavailable=${cumBudget | 0} Σspent=${cumSpent | 0} (${(cumBudget > 0 ? cumSpent / cumBudget * 100 : 0).toFixed(0)}%) Σgap=${cumGapRaw | 0} rateClipped=${cumRateClip | 0}`);
      console.log(`  stall mix (realm-passes since last ck): AT=${wAt} RATE=${wRate} HEAD=${wHead} headStarved=${wHeadStarved} noTarget=${wNoTarget} nomad=${wNomad}`);
      wAt = wRate = wHead = wHeadStarved = wNoTarget = wNomad = 0;
      lastCk = s;
    }
  }
}
console.log(`\ndone ${STEPS} steps in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
