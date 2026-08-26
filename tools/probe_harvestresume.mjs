// Save/load functional-resume under T.HARVEST_YEARS — the _thinBasinSince class
// of bug (dropped cross-tick state silently diverging a resumed world).
//   node tools/probe_harvestresume.mjs [W=320] [seed=31337]
import { buildSim, SIM_TUNE_OVERRIDES } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { applyTuning } from "../src/sim/peopleSim/tuning.js";
import { saveWorld, loadWorld } from "../src/sim/persist.js";

const W = +(process.argv[2] || 320), H = W >> 1, SEED = +(process.argv[3] || 31337);

const sig = (w) => {
  let people = 0, food = 0, mulS = 0, n = 0, fam = 0;
  for (const s of w.settlements) if (s.mode === "settled") {
    people += s.people; food += s.food || 0; mulS += s._harvestYearMul ?? 1;
    if (w.step < (s._famineUntil || 0)) fam++;
    n++;
  }
  let z = 0; if (w._harvestZ) for (const v of w._harvestZ) z += v;
  return { n, people: +people.toFixed(3), food: +food.toFixed(3), mulS: +mulS.toFixed(4), fam, z: +z.toFixed(5), events: (w.events || []).filter(e => e.type === "famine.struck").length };
};

function resumePair(lever) {
  applyTuning({ HARVEST_YEARS: lever, ...SIM_TUNE_OVERRIDES });
  const world = buildSim({ W, H, seed: SEED });
  stepPeopleSim(world, 600);
  const save = saveWorld(world, {});
  stepPeopleSim(world, 400);   // unbroken run → step 1000
  const world2 = loadWorld(save, {});
  applyTuning({ HARVEST_YEARS: lever, ...SIM_TUNE_OVERRIDES });   // re-apply: persist restores save tuning
  stepPeopleSim(world2, 400);  // resumed run → step 1000
  const a = sig(world), b = sig(world2);
  return { a, b, drift: Math.abs(a.people - b.people) / Math.max(1, a.people) };
}

// The codebase carries a KNOWN ~0.2-0.3% functional-resume drift from derived-
// cache warm-ups (the accepted level smoke gates at — see CROP_BIOGEO's desc,
// "resume drift 0.2% post-fix"). The lever's own bar is therefore RELATIVE:
// harvest state must round-trip EXACTLY, and the lever must not add a drift
// class beyond the same world's lever-off control.
console.error("[control] lever off ...");
const C = resumePair(0);
console.error("[arm] HARVEST_YEARS ...");
const L = resumePair(1);
console.log("control unbroken:", JSON.stringify(C.a));
console.log("control resumed :", JSON.stringify(C.b));
console.log("harvest unbroken:", JSON.stringify(L.a));
console.log("harvest resumed :", JSON.stringify(L.b));
const exact = Math.abs(L.a.z - L.b.z) < 1e-4 && L.a.mulS === L.b.mulS && L.a.events === L.b.events && L.a.n === L.b.n;
const noNewDrift = L.drift < C.drift * 2 + 0.001;
console.log(`control drift ${(100 * C.drift).toFixed(3)}%  ·  harvest drift ${(100 * L.drift).toFixed(3)}%`);
console.log(exact && noNewDrift
  ? "PASS — harvest state round-trips exactly; no new drift class over the baseline"
  : `FAIL — ${exact ? "drift class added" : "harvest state diverged on resume"}`);
