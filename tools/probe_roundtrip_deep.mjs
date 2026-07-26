// Deep save/load round-trip verifier — the ONE gate that reaches DYNASTY
// FORMATION. Smoke's save/load runs at 1500 steps and its determinism at 600;
// both are BELOW the ~5–6k steps at which world.persons / world.dynasties first
// populate, so neither exercises the kin-graph hash. This runs long enough that
// persons + dynasties exist, then asserts serialize→load is byte-identical
// (hashWorld covers them since W6-G) — the check that guards the W6-F dynastic
// work against a lossy/nondeterministic round-trip. Run it after any change to
// dynasties.js / the person or dynasty shape / persist.js.
//   node tools/probe_roundtrip_deep.mjs [steps]
// Baseline (14000 steps): 8817 h=db04acac (5220p/109d), 31337 h=64ee637d
// (3588p/66d) — re-anchored for SPAN_TECH 0→0.85 (the earned span;
// SIM_TUNE="SPAN_TECH=0" recovers the prior pair below).
// Prior (14000 steps — longer than the 8000 convention because CRADLE_EVE=0's
// natural dawn delays dynasty formation ~5k steps and the guard exists FOR the
// dynastic state): 8817 h=184431e (3829p/103d), 31337 h=a53e6c0b (2808p/76d) —
// re-anchored for CRADLE_EVE 1→0 (the eve-of-states removal;
// SIM_TUNE="CRADLE_EVE=1" + 8000 steps recovers the prior pair below).
// Prior (8000 steps, all defaults ON): 8817 h=b7650477 (9088p/126d), 31337
// h=5c7e2cd9 (8013p/118d) — re-anchored for FAITH_FRONTIER 0→1 (the faith
// monoculture fix; SIM_TUNE="FAITH_FRONTIER=0" recovers the prior pair).
// Prior: 8817 h=c31bbafa (8710p/149d), 31337
// h=6c5fc1bc (8693p/138d) — re-anchored 2026-07 for the history-shape audit's two
// default changes (Indus hearth + COLLAPSE_SCAR 0→0.7), which re-key every stream.
// Prior (pre-audit, all defaults ON incl. POP_FIELD — the field-simulation model:
// people on a per-tile field, territory grown by governed-region capacity, not stamped from
// settlement catchments): 8817 h=9f0ebe23 (4957p/101d), 31337 h=38b95edf (4320p/87d).
// POP_FIELD=0 recovers the pre-field settlement roundtrip 8817=ff050141/31337=cff49050;
// under it FIELD_POLITY=0 recovers the entity-model roundtrip. (POP_FIELD_STRIDE=4 opt-in
// perf shifts it to b3b25958/4ff0f7d5. Prior: c4c527a1/81b0ff1d
// REGION_SPACING 1.2; b4ad4366/d827e128 pre-granularity; a8c69cbd/78210a0b pre-relief;
// 400fe557/e834530 pre-mortality; 67aeea45/2958a5c6 pre-symmetry.) Recoveries via env:
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
