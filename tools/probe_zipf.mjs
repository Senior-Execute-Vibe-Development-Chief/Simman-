// THE CITY-SIZE DISTRIBUTION — is there a hierarchy at all? (2026-08-24)
//
// The day's bottom (docs/egypt-autopsy-2026-08-24.md): the register count is
// pie ÷ mean-city-size, and this sim's cities equilibrate at exactly 1× the
// minimum — no Zipf, maximum count, zero margin, churn. The agglomeration
// engine EXISTS (popField.js T.URBAN_AGGLOM: the urban total is set by the
// economy and distributed ∝ import-fed capacity; T.URBAN_GAMMA's density
// graveyard compresses) and its own comment names its fuel: "a grain-importing
// hub concentrates what it ships in — the heavy-tailed import economy gives
// the cores their size ORDER". If the food-trade lane is starving (fed ≈ 0
// everywhere, measured), importShare ≈ 0 for every city and the engine idles.
//
// So this measures BOTH at once, per checkpoint, world + Egypt box:
//   · rank-size on _urbanPop (the Zipf object) and on people (catchments):
//     log-log slope over the top ranks, primacy S1/S2, top-10 listing
//   · mean size / the city bar (the margin the packing thesis says is 1×)
//   · the ENGINE'S FUEL: importShare = (foodNet − landFood)/supply and the
//     import-fed spike share, distributions over the same top ranks
//
//   SIM_TUNE="<live arm>" node tools/probe_zipf.mjs [steps] [W] [seed] [ckpt]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = +(process.argv[2] || 25000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const CKPT = +(process.argv[5] || 2500);

const world = buildSim({ W, H, seed: SEED });
const TW = world.tw, TH = world.th;
const lonOf = (x) => (x / TW) * 360 - 180, latOf = (y) => 90 - (y / TH) * 180;
const inBox = (x, y) => { const lo = lonOf(x), la = latOf(y); return la >= 20 && la <= 33 && lo >= 24 && lo <= 36; };
const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);

// OLS slope of log(size) on log(rank) over the top R ranks (sizes>0).
// Zipf's law: slope ≈ −1 for integrated urban systems; flat ≈ 0.
function zipfSlope(sizes, R) {
  const s = sizes.filter((v) => v > 0).sort((a, b) => b - a).slice(0, R);
  if (s.length < 5) return { slope: NaN, n: s.length };
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < s.length; i++) {
    const x = Math.log(i + 1), y = Math.log(s[i]);
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const n = s.length;
  return { slope: (n * sxy - sx * sy) / (n * sxx - sx * sx), n };
}

console.log(`\n=== THE CITY-SIZE DISTRIBUTION  ${W}x${H} (tw=${TW})  seed ${SEED} ===`);
console.log(`  Zipf reference: slope ≈ −1.0 (integrated urban systems, ancient and modern);`);
console.log(`  flat ≈ 0 = no hierarchy = maximum count at zero margin (the packing thesis).\n`);
for (let done = 0; done < STEPS; done += CKPT) {
  stepPeopleSim(world, Math.min(CKPT, STEPS - done));
  const scan = (boxOnly) => {
    const urb = [], ppl = [], imp = [], rows = [];
    for (const s of world.settlements) {
      if (s.mode !== "settled") continue;
      if (boxOnly && !inBox(s.pos.x | 0, s.pos.y | 0)) continue;
      const u = s._urbanPop || 0, p = s.people || 0;
      urb.push(u); ppl.push(p);
      const supply = s._foodSupply || 0;
      const ishare = supply > 0 ? Math.max(0, Math.min(1, ((s._foodNet !== undefined ? s._foodNet : 0) - (s._landFood || 0)) / supply)) : 0;
      imp.push(ishare);
      rows.push({ name: s.name, u, p, ishare });
    }
    rows.sort((a, b) => b.u - a.u);
    return { urb, ppl, imp, rows };
  };
  for (const [lab, r] of [["EGYPT box", scan(true)], ["world    ", scan(false)]]) {
    if (!r.ppl.length) continue;
    const zu = zipfSlope(r.urb, 30), zp = zipfSlope(r.ppl, 30);
    const su = [...r.urb].sort((a, b) => b - a), sp = [...r.ppl].sort((a, b) => b - a);
    const prim = su.length > 1 && su[1] > 0 ? su[0] / su[1] : NaN;
    const meanP = r.ppl.reduce((a, b) => a + b, 0) / r.ppl.length;
    console.log(`  step ${String(world.step).padStart(6)}  ${lab}: n ${String(r.ppl.length).padStart(4)} · Zipf slope urban ${zu.slope.toFixed(2)} (n${zu.n}) / catchment ${zp.slope.toFixed(2)} · primacy ${prim.toFixed(1)} · mean/bar ${(meanP / 200).toFixed(2)} · importShare p50/p90 ${q(r.imp, .5).toFixed(2)}/${q(r.imp, .9).toFixed(2)}`);
    if (lab.startsWith("EGYPT")) {
      const top = r.rows.slice(0, 8).map((x) => `${(x.name || "?").slice(0, 8)} u${Math.round(x.u)}/p${Math.round(x.p)}/i${x.ishare.toFixed(2)}`).join("  ");
      console.log(`         top urban: ${top}`);
    }
  }
}
console.log(`\n  READ: slope ≈ 0 with importShare ≈ 0 convicts the ENGINE'S FUEL (the food-`);
console.log(`  trade lane) before its strength levers; slope ≈ 0 with real imports convicts`);
console.log(`  the distribution law itself (URBAN_AGGLOM/URBAN_GAMMA form or strength).`);
