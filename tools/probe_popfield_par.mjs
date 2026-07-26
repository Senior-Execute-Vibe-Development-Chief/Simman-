// Cross-worker-count identity gate for the popField parallel arc
// (docs/popfield-parallel.md §6). Runs the SAME world once per lever value and
// requires hashWorld AND sha256(popField)/sha256(capField) to be identical
// across the whole set — T.POP_FIELD_WORKERS must be a wall-clock dial, never
// a seed. On divergence it prints the first differing tile (±0-aware) and
// exits non-zero.
//
//   genesis mode:  node tools/probe_popfield_par.mjs [steps=2500] [levers=0,1]
//                  (320×160, seeds 8817 + 31337 — the hashbase geometry, so the
//                   printed L0 hash must equal the current probe_hashbase pair)
//   snapshot mode: node tools/probe_popfield_par.mjs <snap.world.json> [ticks=200] [levers=0,1]
//                  (covers the mature paths a genesis run never reaches:
//                   urban spikes, FOOD_K, works, industrial fades, rn>1 wrap)
import fs from "fs";
import crypto from "crypto";
import { buildSim } from "./_harness.mjs";
import { loadWorld, hashWorld } from "../src/sim/persist.js";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { applyTuning } from "../src/sim/peopleSim/tuning.js";

const a2 = process.argv[2];
const snapMode = !!a2 && a2.endsWith(".json");
const SNAP = snapMode ? fs.readFileSync(a2, "utf8") : null;
const STEPS = parseInt(snapMode ? (process.argv[3] || "200") : (a2 || "2500"), 10);
const LEVERS = (process.argv[snapMode ? 4 : 3] || "0,1").split(",").map(Number);
const SEEDS = snapMode ? ["snapshot"] : [8817, 31337];

const sha = (arr) => crypto.createHash("sha256")
  .update(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)).digest("hex");
// ±0-aware float equality on the raw f32 bits (1/x distinguishes the zeros).
const firstDiff = (A, B) => {
  for (let i = 0; i < A.length; i++) if (A[i] !== B[i] || 1 / A[i] !== 1 / B[i]) return i;
  return -1;
};

let fail = 0;
for (const seed of SEEDS) {
  const rows = [];
  for (const L of LEVERS) {
    applyTuning({ POP_FIELD_WORKERS: L });
    const world = snapMode ? loadWorld(SNAP) : buildSim({ W: 320, H: 160, seed });
    // loadWorld restores the SAVE's tuning (persist.js resets + applies the
    // saved non-defaults), silently clobbering the lever — re-apply AFTER.
    applyTuning({ POP_FIELD_WORKERS: L });
    stepPeopleSim(world, STEPS);
    rows.push({ L, hash: hashWorld(world), pf: sha(world.popField), cf: sha(world.capField),
                pfA: world.popField.slice(), cfA: world.capField.slice() });   // keep copies, drop the world
  }
  applyTuning({ POP_FIELD_WORKERS: 0 });   // leave the module default restored
  const ref = rows[0];
  let bad = false;
  for (const r of rows.slice(1)) {
    if (r.hash === ref.hash && r.pf === ref.pf && r.cf === ref.cf) continue;
    bad = true; fail = 1;
    const ti = firstDiff(ref.pfA, r.pfA);
    const tc = firstDiff(ref.cfA, r.cfA);
    console.log(`DIVERGED ${seed}: L${ref.L} vs L${r.L} — hash ${ref.hash}/${r.hash}` +
      (ti >= 0 ? `  popField first diff @${ti} (${ref.pfA[ti]} vs ${r.pfA[ti]})` : "") +
      (tc >= 0 ? `  capField first diff @${tc}` : ""));
  }
  console.log(`${seed} steps=${STEPS} levers=[${LEVERS.join(",")}]  ` +
    rows.map((r) => `L${r.L}:${r.hash}`).join(" ") +
    `  pf:${ref.pf.slice(0, 12)}  ${bad ? "✗ DIVERGED" : "✓ identical"}`);
}
process.exit(fail);
