// ── C1 entity-supply instrument (T.LABEL_BIRTH, docs/tier-c-coupling-survey.md §4) ──
//
// Measures the thing Tier C exists to fix: planet-wide ENTITY COUNT pinned at
// ~90 at every grid (long-run W4 / diagnosis R1) because the founding sweep's
// fixed spacing quantum — not the peopled land — set the supply. Under
// LABEL_BIRTH the supply is basin-exclusive field nucleation, so the count
// must (a) exceed the pin where the field carries more town-scale basins, and
// (b) TRACK field density over the run instead of saturating at the quantum.
//
// Channels per checkpoint:
//   • entities: settled count (by tier), camps/stateless, realm count
//   • the FIELD-SIDE SUPPLY, three reads:
//       disks — greedy disjoint-centre TOWN_BASIN_R disks per bar (the v1
//       instrument, kept for continuity with the v1 verdict's 218 number);
//       wshed — v2's watershed census (crystallize.js labelBasinCensus,
//       instrument-only since v3): attractor basins of the horizon-smoothed
//       popField per mass bar with claim counts — the number the v2 verdict
//       turned on, kept for cross-version continuity;
//       sites — the v3 LAW's own census (siteLedgerCensus): ledger sites by
//       class (conf/mouth/sink/bay) with claim counts, plus how many clear
//       the activation bar — claimed/total sites is the v3 supply-uptake
//       channel (design-c-siting-ledger.md arm 1)
//   • srv% — share of field population within one market horizon of a label
//     (labelServiceCensus): the service-coverage measure that exposed the
//     covering-constraint dead end (96% served by 32 labels at 240/12k)
//   • ONE_POP consistency (the survey's riskiest-coupling guard): world field
//     population vs Σ s.people vs _onePopScale must stay mutually consistent
//     as entity count scales — Σ census ≡ _onePopScale × (field within label
//     catchments) by construction; the probe measures the residual drift
//   • observed nearest-neighbour spacing (mean, CV) — the emergent spacing
//   • ms/tick for the window (C1 must stay affordable; C3 is the perf fix)
//     + the watershed rebuild cost (basinMs — the census IS one fresh build)
//
//   node tools/probe_entitysupply.mjs [W] [steps] [seed]
//   SIM_TUNE="LABEL_BIRTH=1" for the lever-on arm (OFF is the pin baseline).
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { labelBasinCensus, labelServiceCensus, siteLedgerCensus } from "../src/sim/peopleSim/crystallize.js";
import { T, rNormPop } from "../src/sim/peopleSim/tuning.js";

const W = +(process.argv[2] || 480), H = W >> 1;
const STEPS = +(process.argv[3] || 12000);
const SEED = +(process.argv[4] || 8817);
const CKPT = 2000;

const world = buildSim({ W, H, seed: SEED });
console.log(`[entitysupply] ${W}x${H} (tw=${world.tw}) seed=${SEED} steps=${STEPS} LABEL_BIRTH=${T.LABEL_BIRTH} LABEL_BAR=${T.LABEL_BAR} MULTI_HEARTH=${T.MULTI_HEARTH} EARTH_HEARTHS=${T.EARTH_HEARTHS}`);

// ── the C1 v4 hearth-field channels (docs/design-c-hearth-field.md arms 2/5/8) ──
// Under T.MULTI_HEARTH the supply story is "how many landmasses ever invented
// farming", so an instant planet-wide label count hides the whole mechanism.
// These four channels are what the design gates on:
//   comps — labels per 8-neighbour LAND COMPONENT. devField is stamped from
//     settlements and relaxed by a LAND-ONLY wave, so a component with no hearth
//     can never farm and can never carry a label; "labels on ≥N components" is
//     the direct read of whether agriculture has more than one origin.
//   devLand — share of land at devField ≥ NEOLITHIC_AGRI (0.45), the farmed-land
//     share the whole density stack rides on.
//   census p10/p50/p90 + _townBar/_cityBar — the DEFLATION battery (design §1d,
//     risk 3): a census is a partition, so more labels means a smaller share
//     each, and the absolute tier floors bind. Reported at every checkpoint.
//   founding/death FLOW — an instant count of 78 hid 258 foundings in lane M.
// Land components, 8-neighbour (roads.js landComp8's definition, re-derived so
// the probe never mutates a world cache).
const LC = (() => {
  const { N, tw, th, elev } = world;
  const lc = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  for (let seed = 0; seed < N; seed++) {
    if (lc[seed] >= 0 || elev[seed] <= 0) continue;
    let top = 0; stack[top++] = seed; lc[seed] = seed;
    while (top > 0) {
      const ti = stack[--top];
      const ty = (ti / tw) | 0, tx = ti - ty * tw;
      const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
      const yu = ty - 1, yd = ty + 1;
      const ns = [ty * tw + xm, ty * tw + xp,
        yu >= 0 ? yu * tw + tx : -1, yd < th ? yd * tw + tx : -1,
        yu >= 0 ? yu * tw + xm : -1, yu >= 0 ? yu * tw + xp : -1,
        yd < th ? yd * tw + xm : -1, yd < th ? yd * tw + xp : -1];
      for (let k = 0; k < 8; k++) {
        const ni = ns[k];
        if (ni < 0 || elev[ni] <= 0 || lc[ni] >= 0) continue;
        lc[ni] = seed; stack[top++] = ni;
      }
    }
  }
  return lc;
})();
// The component the hearth pins sit on — "the home continent" of the lane-M
// census framing. Derived from the world's own cradles, never named.
const HOME_COMP = (() => {
  const tally = new Map();
  for (const s of world.settlements) {
    const c = LC[(s.pos.y | 0) * world.tw + (s.pos.x | 0)];
    if (c >= 0) tally.set(c, (tally.get(c) || 0) + 1);
  }
  let best = -1, bn = 0;
  for (const [c, n] of tally) if (n > bn) { bn = n; best = c; }
  return best;
})();
const NEOLITHIC_AGRI = 0.45;   // mirrors crystallize.js — instrument only
const HEARTHS_AT_GENESIS = world.settlements.length;
console.log(`[entitysupply] genesis: ${HEARTHS_AT_GENESIS} cradle(s) on ${new Set(world.settlements.map((s) => LC[(s.pos.y | 0) * world.tw + (s.pos.x | 0)])).size} land component(s); home comp ${HOME_COMP}`);

// Exclusive-basin supply census: greedy disjoint-centre packing of
// TOWN_BASIN_R disks over the popField, counted at each bar. Centres are the
// stride-2 lattice (an instrument approximation — gross disk mass, not the
// net-of-neighbours mass the sweep charges — so it reads slightly HIGH; it is
// the ceiling the dynamic supply approaches, not a prediction of the count).
function basinSupply(world, bars) {
  const pf = world.popField;
  if (!pf) return bars.map(() => -1);
  const rn = rNormPop(world);
  const rB = Math.max(1, Math.round(10 * rn));   // TOWN_BASIN_R, real distance
  const { tw, th } = world;
  const stride = 2;
  const sums = [];
  for (let y = 0; y < th; y += stride) {
    for (let x = 0; x < tw; x += stride) {
      let s = 0;
      for (let dy = -rB; dy <= rB; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= th) continue;
        for (let dx = -rB; dx <= rB; dx++) {
          if (dx * dx + dy * dy > rB * rB) continue;
          s += pf[yy * tw + (((x + dx) % tw) + tw) % tw];
        }
      }
      if (s > 0) sums.push([s, x, y]);
    }
  }
  sums.sort((a, b) => b[0] - a[0]);
  const rb2 = rB * rB;
  return bars.map((bar) => {
    const ax = [], ay = [];
    for (const [s, x, y] of sums) {
      if (s < bar) break;
      let ok = true;
      for (let i = 0; i < ax.length; i++) {
        let dx = Math.abs(ax[i] - x); if (dx > tw / 2) dx = tw - dx;
        const dy = ay[i] - y;
        if (dx * dx + dy * dy < rb2) { ok = false; break; }
      }
      if (ok) { ax.push(x); ay.push(y); }
    }
    // HONEST FRAMING (docs/tier-c-reachability-measurement.md T9): the lattice
    // scans EVERY tile, so a disk centred on the SEA sums the coastal population
    // and is counted as "supply" — 62% of the number were such disks. The count
    // is reported, never gated on, and always split: total / on water / on the
    // home land component / overseas.
    let onWater = 0, onHome = 0, overseas = 0;
    for (let i = 0; i < ax.length; i++) {
      const c = LC[ay[i] * tw + ax[i]];
      if (c < 0) onWater++;
      else if (c === HOME_COMP) onHome++;
      else overseas++;
    }
    return { n: ax.length, onWater, onHome, overseas, onLand: ax.length - onWater };
  });
}

function nnStats(setts, tw) {
  const ds = [];
  for (let i = 0; i < setts.length; i++) {
    let best = Infinity;
    for (let j = 0; j < setts.length; j++) {
      if (i === j) continue;
      let dx = Math.abs(setts[i].pos.x - setts[j].pos.x); if (dx > tw / 2) dx = tw - dx;
      const dy = setts[i].pos.y - setts[j].pos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
    if (isFinite(best)) ds.push(Math.sqrt(best));
  }
  if (!ds.length) return { mean: 0, cv: 0 };
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  const sd = Math.sqrt(ds.reduce((a, b) => a + (b - mean) * (b - mean), 0) / ds.length);
  return { mean, cv: mean > 0 ? sd / mean : 0 };
}

const rows = [];
let evSeen = 0;
for (let t = CKPT; t <= STEPS; t += CKPT) {
  const t0 = performance.now();
  stepPeopleSim(world, CKPT);
  const msTick = (performance.now() - t0) / CKPT;

  const setts = world.settlements.filter((s) => s.mode === "settled");
  const tiers = [0, 0, 0, 0];
  let stateless = 0, cenT = 0;
  const realms = new Set();
  const pops = [];
  const byComp = new Map();
  for (const s of setts) {
    tiers[Math.min(3, s.tier | 0)]++;
    cenT += s.people || 0;
    pops.push(s.people || 0);
    const c = LC[(s.pos.y | 0) * world.tw + (s.pos.x | 0)];
    byComp.set(c, (byComp.get(c) || 0) + 1);
    if (s.countryId >= 0) realms.add(s.countryId); else stateless++;
  }
  pops.sort((a, b) => a - b);
  const pq = (q) => (pops.length ? pops[Math.min(pops.length - 1, Math.floor(q * pops.length))] : 0);
  const compRank = [...byComp.entries()].sort((a, b) => b[1] - a[1]);
  // Founding / death FLOW over this window (an instant count hides everything —
  // lane M measured 258 foundings behind a frozen count of 78).
  let nFound = 0, nDied = 0;
  for (; evSeen < world.events.length; evSeen++) {
    const ty = world.events[evSeen].type;
    if (ty === "settlement.founded" || ty === "colony.founded" || ty === "town.planted") nFound++;
    else if (ty === "settlement.abandoned" || ty === "settlement.withered") nDied++;
  }
  let pfTot = 0, cov = 0;
  const pf = world.popField, own = world._territoryOwner, elev = world.elev;
  if (pf) for (let ti = 0; ti < world.N; ti++) if (elev[ti] > 0) { pfTot += pf[ti]; if (own && own[ti] >= 0) cov += pf[ti]; }
  // Farmed-land share: devField is the agricultural TECHNIQUE that actually
  // reached a tile; ≥ NEOLITHIC_AGRI is the sim's own "this ground farms" bar.
  let landTiles = 0, devTiles = 0, devSum = 0;
  const dev = world.devField;
  if (dev) for (let ti = 0; ti < world.N; ti++) if (elev[ti] > 0) { landTiles++; devSum += dev[ti]; if (dev[ti] >= NEOLITHIC_AGRI) devTiles++; }
  const scale = world._onePopScale || 0;
  // Σ census ≡ scale × covered-field by construction (deriveOnePop); residual =
  // max(1,·) clamps + labels whose catchment was empty this pass. Drift beyond
  // a few % as the count scales would mean the census partition double-counts
  // or drops field people — the riskiest-coupling failure signature.
  const drift = scale > 0 && cov > 0 ? cenT / (cov * scale) - 1 : 0;
  const bars = [T.LABEL_BAR > 0 ? T.LABEL_BAR : 360, 2000, 5000, 20000];
  const supply = basinSupply(world, bars);
  const tB = performance.now();
  const wshed = labelBasinCensus(world, bars);    // v2 watershed census (instrument — no world cache touch)
  const basinMs = performance.now() - tB;
  const svc = labelServiceCensus(world);          // horizon service coverage (pure)
  const sled = siteLedgerCensus(world, bars[0]);  // v3 ledger census (claims computed fresh)
  const nn = nnStats(setts, world.tw);
  rows.push({ step: world.step, n: setts.length, pfTot, supply, wshed, svc, sled,
    comps: compRank.length, devFrac: landTiles ? devTiles / landTiles : 0, realms: realms.size,
    p50: pq(0.50), nFound, nDied });
  const sledStr = sled
    ? `sites=${sled.claimed}/${sled.K} bar:${sled.overBar}(free ${sled.freeOverBar}) ` +
      `[${["conf", "mouth", "sink", "bay"].map((c) => `${c[0]}:${sled.byClass[c] ? `${sled.byClass[c].claimed}/${sled.byClass[c].n}` : "0/0"}`).join(" ")}]`
    : "sites=n/a";
  const d0 = supply[0];
  console.log(
    `step ${String(world.step).padStart(6)}  entities=${String(setts.length).padStart(4)} ` +
    `(t1=${tiers[1]} t2=${tiers[2]} t3=${tiers[3]} stateless=${stateless}) realms=${realms.size}  ` +
    `pfTot=${(pfTot / 1e6).toFixed(2)}M cov=${pfTot > 0 ? ((100 * cov) / pfTot).toFixed(1) : 0}% ` +
    `ΣsPeople=${(cenT / 1e6).toFixed(2)}M scale=${scale.toExponential(3)} drift=${(100 * drift).toFixed(2)}%  ` +
    `disks[${bars.join("/")}]=${supply.map((o) => o.n).join("/")} (bar0: sea ${d0.onWater} | home ${d0.onHome} | overseas ${d0.overseas})  ` +
    `wshed[${bars.join("/")}]=${wshed ? wshed.map((o) => `${o.claimed}of${o.basins}`).join("/") : "n/a"} (${basinMs.toFixed(1)}ms)  ` +
    `${sledStr}  ` +
    `srv=${svc && svc.tot > 0 ? (100 * (1 - svc.unserved / svc.tot)).toFixed(1) : "n/a"}%  ` +
    `nn=${nn.mean.toFixed(1)}±cv${nn.cv.toFixed(2)}  ${msTick.toFixed(2)}ms/tick`
  );
  // The hearth-field channels (design arms 2/5/8).
  console.log(
    `            HEARTH  comps=${compRank.length} [${compRank.slice(0, 6).map(([c, n]) => `${c === HOME_COMP ? "home" : `c${c}`}:${n}`).join(" ")}]  ` +
    `devLand≥${NEOLITHIC_AGRI}=${(100 * (landTiles ? devTiles / landTiles : 0)).toFixed(1)}% (mean dev ${(landTiles ? devSum / landTiles : 0).toFixed(3)})  ` +
    `census p10/p50/p90=${pq(0.10).toFixed(0)}/${pq(0.50).toFixed(0)}/${pq(0.90).toFixed(0)} max=${pops.length ? pops[pops.length - 1].toFixed(0) : 0}  ` +
    `townBar=${(world._townBar || 0).toFixed(1)} cityBar=${(world._cityBar || 0).toFixed(1)}  ` +
    `flow +${nFound}/−${nDied}`
  );
}

// Supply-tracking summary: does the entity count TRACK the field (the C1
// claim) or saturate at the quantum (the W4 pin)?
const first = rows[Math.min(2, rows.length - 1)], last = rows[rows.length - 1];
if (first && last && first !== last) {
  const dN = last.n / Math.max(1, first.n);
  const dPf = last.pfTot / Math.max(1, first.pfTot);
  const dSup = last.supply[0].n / Math.max(1, first.supply[0].n);
  console.log(`[entitysupply] growth ${first.step}→${last.step}: entities ×${dN.toFixed(2)}, pfTot ×${dPf.toFixed(2)}, bar-disks ×${dSup.toFixed(2)} | final entities/bar-disks = ${(last.n / Math.max(1, last.supply[0].n)).toFixed(2)}` +
    (last.wshed ? ` | final wshed claimed/total at bar = ${last.wshed[0].claimed}/${last.wshed[0].basins}` : "") +
    (last.sled ? ` | final sites claimed/total = ${last.sled.claimed}/${last.sled.K} (bar-clearing ${last.sled.overBar})` : "") +
    (last.svc && last.svc.tot > 0 ? ` | service coverage = ${(100 * (1 - last.svc.unserved / last.svc.tot)).toFixed(1)}%` : ""));
}
// The hearth-field verdict line (design arm 2): the flip criterion is the LABEL
// count against the 78 pin, with the honest census split reported beside it —
// never gated on. Acceptance is a FLOW, so the trajectory is printed too.
if (last) {
  const d = last.supply[0];
  console.log(`[entitysupply] HEARTH VERDICT  genesis hearths=${HEARTHS_AT_GENESIS}  labels=${last.n} on ${last.comps} land component(s)  ` +
    `devLand=${(100 * last.devFrac).toFixed(1)}%  realms=${last.realms}  census p50=${last.p50.toFixed(1)}  ` +
    `| disk census ${d.n} = sea ${d.onWater} (${(100 * d.onWater / Math.max(1, d.n)).toFixed(0)}% instrument artifact) + home ${d.onHome} + overseas ${d.overseas}  [REPORTED, NOT GATED]`);
  console.log(`[entitysupply] TRAJECTORY  ` + rows.map((r) => `${r.step / 1000}k:${r.n}/${r.comps}c`).join(" "));
  console.log(`[entitysupply] FLOW        ` + rows.map((r) => `${r.step / 1000}k:+${r.nFound}/−${r.nDied}`).join(" "));
}
