// Deep save/load round-trip verifier — the ONE gate that reaches DYNASTY
// FORMATION. Smoke's save/load runs at 1500 steps and its determinism at 600;
// both are BELOW the ~5–6k steps at which world.persons / world.dynasties first
// populate, so neither exercises the kin-graph hash. This runs long enough that
// persons + dynasties exist, then asserts serialize→load is byte-identical
// (hashWorld covers them since W6-G) — the check that guards the W6-F dynastic
// work against a lossy/nondeterministic round-trip. Run it after any change to
// dynasties.js / the person or dynasty shape / persist.js.
//   node tools/probe_roundtrip_deep.mjs [steps]
// Baseline (8000 steps, all defaults ON incl. RES_INVARIANT_POP + the real-width worldgen
// floodplain ribbon): 8817 h=67aeea45 (2732p/60d), 31337 h=2958a5c6 (2523p/43d).
// (Previous ribbon-scaling baseline: d8906420/29eec7f5.) Recoveries via env:
//   RES_INVARIANT_POP=0                 → f057635 / d489b985 (tile-unit density, CAP_MODEL era)
//   CAP_MODEL=0                         → 28abc46d / ef4fc665 (the legacy fitted-tail size model)
//   CROSS_REALM_HEIRS=0 CLAIMANT_WARS=0 → the throne-siloed dynasties (on the current size model)
//   CROSS_REALM_HEIRS=0 CLAIMANT_WARS=0 CAP_MODEL=0 → d69f113 / 9c5ecf94 (the full pre-W6-F/R5 baseline)
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { serializeWorld, loadWorld, hashWorld } from "../src/sim/persist.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "8000", 10);
const SEEDS = [8817, 31337];
const W = 320, H = 160;
// Optional lever overrides (env unset = defaults = the baseline in the header comment):
// set CROSS_REALM_HEIRS=0 CLAIMANT_WARS=0 to recover the throne-siloed round-trip
// (d69f113 / 9c5ecf94), or CLAIM_POWER_WIN to A/B the power-gated crownForeign resolution.
for (const k of ["CROSS_REALM_HEIRS", "CLAIMANT_WARS", "CLAIM_POWER_WIN", "CAP_MODEL", "CAP_FISC", "CAP_LOG", "RES_INVARIANT_POP"]) if (process.env[k] != null) T[k] = +process.env[k];
let fail = 0;
for (const seed of SEEDS) {
  const w = buildSim({ W, H, seed });
  stepPeopleSim(w, STEPS);
  const persons = w.persons ? w.persons.size : 0, dyn = w.dynasties ? w.dynasties.size : 0;
  const h0 = hashWorld(w);
  const json = serializeWorld(w);
  const h1 = hashWorld(loadWorld(json));
  const populated = persons > 0 && dyn > 0;
  const ok = h0 === h1 && populated;
  if (!ok) fail++;
  const why = !populated ? "  (WARN: kin graph empty — raise steps)" : "";
  console.log(`${ok ? "ok  " : "FAIL"} seed=${seed} persons=${persons} dyn=${dyn}  ${h0}${h0 === h1 ? " == " : " != "}${h1}${why}`);
}
console.log(fail ? `\n${fail} seed(s) FAILED round-trip` : `\nall seeds round-trip byte-identical at ${STEPS} steps`);
process.exit(fail ? 1 : 0);
