// The REAL spurious-corridor test: the longest GEOGRAPHIC SPAN of a terminal-bound (closed-
// basin) Major+ river. A legit arid endorheic river (Amu Darya → Aral) spans a few hundred km;
// a spurious Himalaya→Caspian corridor threads the whole interior (thousands of km). Trace each
// terminal Major+ chain down its flow path and report the largest source→sink straight-line span.
//   node tools/probe_corridor.mjs [seed] [W]
import { buildWorld } from "../src/sim/pipeline.js";
import { RIVER_MAJOR } from "../src/sim/riverGen.js";

const SEED = parseInt(process.argv[2] || "8817", 10);
const W = parseInt(process.argv[3] || "960", 10), H = W >> 1;
const { w } = buildWorld({ W, H, seed: SEED });
const r = w.rivers; const { riverMag, drainsTerminal, flowDir } = r;
const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
const N = riverMag.length;
const span = (x0, y0, x1, y1) => { let dx = Math.abs(x0 - x1); if (dx > W / 2) dx = W - dx; const dy = y0 - y1; return Math.sqrt(dx * dx + dy * dy); };
const KM_PER_TILE = 40075 / W;   // equatorial km per tile column

let worst = 0, worstInfo = null;
for (let ti = 0; ti < N; ti++) {
  if (riverMag[ti] < RIVER_MAJOR || drainsTerminal[ti] !== 1) continue;
  // follow downstream to the sink, tracking the start tile
  const x0 = ti % W, y0 = (ti / W) | 0;
  let ci = ti, steps = 0;
  while (steps++ < 4000) {
    const d = flowDir[ci]; if (d === 255) break;
    const cx = ci % W, cy = (ci / W) | 0, nx = (cx + DX[d] + W) % W, ny = cy + DY[d];
    if (ny < 0 || ny >= H) break;
    const ni = ny * W + nx; if (w.elevation[ni] <= 0) break;
    ci = ni;
  }
  const s = span(x0, y0, ci % W, (ci / W) | 0);
  if (s > worst) { worst = s; worstInfo = { from: [x0, y0], to: [ci % W, (ci / W) | 0] }; }
}
console.log(`seed ${SEED} @ ${W}w: longest TERMINAL Major+ river span = ${worst.toFixed(0)} tiles (~${(worst * KM_PER_TILE).toFixed(0)} km)`);
if (worstInfo) console.log(`  from (${worstInfo.from}) → sink (${worstInfo.to})`);
console.log(`  (a real arid endorheic river ~few hundred km; a Himalaya→Caspian corridor = several thousand km)`);
