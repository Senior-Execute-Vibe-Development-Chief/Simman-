// Definitive corridor test: the longest Major+ river (ANY drainage — terminal OR ocean) whose
// path lies in the Caspian↔Himalaya box (25-58N, 40-105E). Reports its span, endpoints, and
// whether it drains to a closed sink or the "ocean" (which at fine res may be a wrongly-opened
// Caspian). This catches a corridor even if a bad ocean-connection reclassified it as exorheic.
import { buildWorld } from "../src/sim/pipeline.js";
import { RIVER_MAJOR } from "../src/sim/riverGen.js";
const SEED = parseInt(process.argv[2] || "8817", 10);
const W = parseInt(process.argv[3] || "1920", 10), H = W >> 1;
const { w } = buildWorld({ W, H, seed: SEED });
const { riverMag, drainsTerminal, flowDir } = w.rivers;
const DX = [1,1,0,-1,-1,-1,0,1], DY = [0,1,1,1,0,-1,-1,-1];
const KM = 40075 / W;
const inBox = (x, y) => { const lon = x/W*360-180, lat = 90-y/H*180; return lon>=40 && lon<=105 && lat>=25 && lat<=58; };
const span = (x0,y0,x1,y1) => { let dx=Math.abs(x0-x1); if(dx>W/2) dx=W-dx; const dy=y0-y1; return Math.sqrt(dx*dx+dy*dy); };
let worst = 0, info = null;
for (let ti = 0; ti < riverMag.length; ti++) {
  if (riverMag[ti] < RIVER_MAJOR) continue;
  const x0 = ti % W, y0 = (ti/W)|0; if (!inBox(x0, y0)) continue;
  let ci = ti, steps = 0, inB = true;
  while (steps++ < 6000) {
    const d = flowDir[ci]; if (d === 255) break;
    const cx = ci%W, cy=(ci/W)|0, ny = cy+DY[d]; if (ny<0||ny>=H) break;
    const ni = ny*W + ((cx+DX[d]+W)%W); if (w.elevation[ni] <= 0) break;
    ci = ni; if (!inBox(ci%W,(ci/W)|0)) inB = false;
  }
  const s = span(x0, y0, ci%W, (ci/W)|0);
  if (s > worst) worst = s, info = { from:[x0,y0], to:[ci%W,(ci/W)|0], term: drainsTerminal[ti], inB };
}
console.log(`seed ${SEED} @ ${W}w: longest MAJOR+ river in Caspian-Himalaya box = ${worst.toFixed(0)} tiles (~${(worst*KM).toFixed(0)} km)`);
if (info) console.log(`  from lon${(info.from[0]/W*360-180).toFixed(0)} lat${(90-info.from[1]/H*180).toFixed(0)} → lon${(info.to[0]/W*360-180).toFixed(0)} lat${(90-info.to[1]/H*180).toFixed(0)}, drains ${info.term===1?'TERMINAL(closed)':'OCEAN(exorheic)'}`);
