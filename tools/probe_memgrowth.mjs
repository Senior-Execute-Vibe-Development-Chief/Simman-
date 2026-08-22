// The ~24k-step stall (owner report 2026-08-19): the app stops stepping at
// roughly the same step count every run — pause/speed fiddling surfaces an
// error, buys a few display years, then it stalls again. That rhythm is heap
// exhaustion (each failed step's partial work is GC'd, a few steps fit, the
// heap refills), and it matches the headless record: a tw=960 run died at the
// container's ~14GB ceiling at 45k steps; a browser tab's ceiling is far lower
// and arrives proportionally earlier. So: WHAT in the world grows per step?
//
// This walks the world object graph at step checkpoints and attributes
// approximate retained bytes to each world.<key> subtree (TypedArray
// byteLength; array/object/string overheads estimated). Keys whose bytes rise
// ~linearly with steps are the leak; fields sized by the map (N-length arrays)
// are the flat baseline. process.memoryUsage() anchors ground truth.
//
//   node tools/probe_memgrowth.mjs [W=960] [steps=24000] [ckpts=6] [seed=8817]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const W = +(process.argv[2] || 960), STEPS = +(process.argv[3] || 24000);
const CKPTS = +(process.argv[4] || 6), SEED = +(process.argv[5] || 8817);

function approxBytes(root) {
  const seen = new WeakSet();
  function sz(v) {
    if (v === null || v === undefined) return 0;
    const t = typeof v;
    if (t === "number") return 8;
    if (t === "boolean") return 4;
    if (t === "string") return 16 + 2 * v.length;
    if (t !== "object" && t !== "function") return 8;
    if (t === "function") return 0;
    if (seen.has(v)) return 0;
    seen.add(v);
    if (ArrayBuffer.isView(v)) return 96 + v.byteLength;
    if (v instanceof ArrayBuffer) return 96 + v.byteLength;
    let b = 32;
    if (Array.isArray(v)) { b += 8 * v.length; for (const x of v) b += sz(x); return b; }
    if (v instanceof Map) { for (const [k, x] of v) b += 32 + sz(k) + sz(x); return b; }
    if (v instanceof Set) { for (const x of v) b += 24 + sz(x); return b; }
    for (const k in v) { b += 24 + 2 * k.length; b += sz(v[k]); }
    return b;
  }
  return sz(root);
}

const world = buildSim({ W, H: W >> 1, seed: SEED });
const ivl = Math.max(1, Math.round(STEPS / CKPTS));
const hist = new Map();   // key -> [bytes per checkpoint]

for (let done = 0; done < STEPS; ) {
  const n = Math.min(ivl, STEPS - done);
  stepPeopleSim(world, n);
  done += n;
  if (typeof global !== "undefined" && global.gc) global.gc();
  const mu = process.memoryUsage();
  const rows = [];
  for (const k of Object.keys(world)) {
    const b = approxBytes(world[k]);
    rows.push([k, b]);
    if (!hist.has(k)) hist.set(k, []);
    hist.get(k).push(b);
  }
  rows.sort((a, b) => b[1] - a[1]);
  console.log(`\n=== step ${world.step}  rss=${(mu.rss / 1e6).toFixed(0)}MB heapUsed=${(mu.heapUsed / 1e6).toFixed(0)}MB external=${(mu.external / 1e6).toFixed(0)}MB arrayBuffers=${((mu.arrayBuffers || 0) / 1e6).toFixed(0)}MB`);
  for (const [k, b] of rows.slice(0, 14)) console.log(`  ${k.padEnd(24)} ${(b / 1e6).toFixed(1)}MB`);
}

// Growth verdict: keys ranked by (last − first) checkpoint bytes.
console.log(`\n=== GROWTH (last − first checkpoint) ===`);
const growth = [...hist.entries()].map(([k, v]) => [k, v[v.length - 1] - v[0], v]);
growth.sort((a, b) => b[1] - a[1]);
for (const [k, d, v] of growth.slice(0, 14)) {
  console.log(`  ${k.padEnd(24)} +${(d / 1e6).toFixed(1)}MB   [${v.map((x) => (x / 1e6).toFixed(0)).join(", ")}]`);
}
