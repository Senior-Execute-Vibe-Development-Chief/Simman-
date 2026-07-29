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
console.log(`[entitysupply] ${W}x${H} (tw=${world.tw}) seed=${SEED} steps=${STEPS} LABEL_BIRTH=${T.LABEL_BIRTH} LABEL_BAR=${T.LABEL_BAR}`);

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
    return ax.length;
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
for (let t = CKPT; t <= STEPS; t += CKPT) {
  const t0 = performance.now();
  stepPeopleSim(world, CKPT);
  const msTick = (performance.now() - t0) / CKPT;

  const setts = world.settlements.filter((s) => s.mode === "settled");
  const tiers = [0, 0, 0, 0];
  let stateless = 0, cenT = 0;
  const realms = new Set();
  for (const s of setts) {
    tiers[Math.min(3, s.tier | 0)]++;
    cenT += s.people || 0;
    if (s.countryId >= 0) realms.add(s.countryId); else stateless++;
  }
  let pfTot = 0, cov = 0;
  const pf = world.popField, own = world._territoryOwner, elev = world.elev;
  if (pf) for (let ti = 0; ti < world.N; ti++) if (elev[ti] > 0) { pfTot += pf[ti]; if (own && own[ti] >= 0) cov += pf[ti]; }
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
  rows.push({ step: world.step, n: setts.length, pfTot, supply, wshed, svc, sled });
  const sledStr = sled
    ? `sites=${sled.claimed}/${sled.K} bar:${sled.overBar}(free ${sled.freeOverBar}) ` +
      `[${["conf", "mouth", "sink", "bay"].map((c) => `${c[0]}:${sled.byClass[c] ? `${sled.byClass[c].claimed}/${sled.byClass[c].n}` : "0/0"}`).join(" ")}]`
    : "sites=n/a";
  console.log(
    `step ${String(world.step).padStart(6)}  entities=${String(setts.length).padStart(4)} ` +
    `(t1=${tiers[1]} t2=${tiers[2]} t3=${tiers[3]} stateless=${stateless}) realms=${realms.size}  ` +
    `pfTot=${(pfTot / 1e6).toFixed(2)}M cov=${pfTot > 0 ? ((100 * cov) / pfTot).toFixed(1) : 0}% ` +
    `ΣsPeople=${(cenT / 1e6).toFixed(2)}M scale=${scale.toFixed(3)} drift=${(100 * drift).toFixed(2)}%  ` +
    `disks[${bars.join("/")}]=${supply.join("/")}  ` +
    `wshed[${bars.join("/")}]=${wshed ? wshed.map((o) => `${o.claimed}of${o.basins}`).join("/") : "n/a"} (${basinMs.toFixed(1)}ms)  ` +
    `${sledStr}  ` +
    `srv=${svc && svc.tot > 0 ? (100 * (1 - svc.unserved / svc.tot)).toFixed(1) : "n/a"}%  ` +
    `nn=${nn.mean.toFixed(1)}±cv${nn.cv.toFixed(2)}  ${msTick.toFixed(2)}ms/tick`
  );
}

// Supply-tracking summary: does the entity count TRACK the field (the C1
// claim) or saturate at the quantum (the W4 pin)?
const first = rows[Math.min(2, rows.length - 1)], last = rows[rows.length - 1];
if (first && last && first !== last) {
  const dN = last.n / Math.max(1, first.n);
  const dPf = last.pfTot / Math.max(1, first.pfTot);
  const dSup = last.supply[0] / Math.max(1, first.supply[0]);
  console.log(`[entitysupply] growth ${first.step}→${last.step}: entities ×${dN.toFixed(2)}, pfTot ×${dPf.toFixed(2)}, bar-disks ×${dSup.toFixed(2)} | final entities/bar-disks = ${(last.n / Math.max(1, last.supply[0])).toFixed(2)}` +
    (last.wshed ? ` | final wshed claimed/total at bar = ${last.wshed[0].claimed}/${last.wshed[0].basins}` : "") +
    (last.sled ? ` | final sites claimed/total = ${last.sled.claimed}/${last.sled.K} (bar-clearing ${last.sled.overBar})` : "") +
    (last.svc && last.svc.tot > 0 ? ` | service coverage = ${(100 * (1 - last.svc.unserved / last.svc.tot)).toFixed(1)}%` : ""));
}
