// The ~24k app stall, instrument 2: the owner's banner reads "Array buffer
// allocation failed" — a typed-array allocation hit the tab's ceiling at
// tw=960. The heap creep that fills the tab is per-step transient allocation
// churn (probe_memgrowth: world graph flat, RSS creeping identically with the
// pool off). This names the churn SITES: wrap every TypedArray constructor
// AFTER genesis, count calls and bytes by allocation site over a step window,
// rank by bytes. Sites are identity-stable across grids; bytes scale ~x16 at
// the shipped grid.
//   node tools/probe_allocchurn.mjs [W=480] [settle=500] [window=2000] [seed=8817]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const W = +(process.argv[2] || 480), SETTLE = +(process.argv[3] || 500);
const WINDOW = +(process.argv[4] || 2000), SEED = +(process.argv[5] || 8817);
const MIN_LEN = 4096;   // count only sizeable arrays — small ones are noise, the ceiling-killers are grid-sized

const world = buildSim({ W, H: W >> 1, seed: SEED });
stepPeopleSim(world, SETTLE);

const NAMES = ["Float64Array", "Float32Array", "Int32Array", "Uint32Array", "Int16Array", "Uint16Array", "Uint8Array", "Int8Array", "Uint8ClampedArray"];
const orig = {};
const agg = new Map();
function site() {
  const lines = new Error().stack.split("\n");
  for (let i = 2; i < lines.length; i++) {
    const l = lines[i];
    if (l.includes("probe_allocchurn")) continue;
    const m = l.match(/at (?:([^ ]+) )?\(?([^)]*\/(?:src|tools)\/[^)]+)\)?/);
    if (m) return (m[1] || "(anon)") + " @ " + m[2].split("/").slice(-2).join("/").replace(/:\d+$/, "");
  }
  return "(native/unknown)";
}
for (const nm of NAMES) {
  orig[nm] = globalThis[nm];
  globalThis[nm] = new Proxy(orig[nm], {
    construct(t, args, nt) {
      const inst = Reflect.construct(t, args, nt);
      if (inst.length >= MIN_LEN) {
        const k = nm + " " + site();
        let e = agg.get(k);
        if (!e) agg.set(k, e = { calls: 0, bytes: 0 });
        e.calls++; e.bytes += inst.byteLength;
      }
      return inst;
    },
  });
}
stepPeopleSim(world, WINDOW);
for (const nm of NAMES) globalThis[nm] = orig[nm];

const rows = [...agg.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
let tot = 0, totCalls = 0;
for (const [, e] of rows) { tot += e.bytes; totCalls += e.calls; }
console.log(`[allocchurn] tw=${world.tw} window=${WINDOW} steps after settle=${SETTLE}: ${totCalls} large allocations, ${(tot / 1e6).toFixed(0)}MB total (${(tot / WINDOW / 1e3).toFixed(0)}KB/step; x16 real-bytes at tw=960)`);
for (const [k, e] of rows.slice(0, 24)) {
  console.log(`  ${(e.bytes / 1e6).toFixed(1).padStart(8)}MB  ${String(e.calls).padStart(6)} calls  ${k}`);
}
