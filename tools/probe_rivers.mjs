// River network: classification density, resolution invariance, and the spurious
// terminal-corridor signature (long rivers dwindling across ARID land into a closed/inland
// sink — the Himalaya→Caspian artifact). Build the world at one or more widths and compare.
//   node tools/probe_rivers.mjs [seed] [W1] [W2 ...]
import { buildWorld } from "../src/sim/pipeline.js";

const SEED = parseInt(process.argv[2] || "8817", 10);
const WIDTHS = (process.argv.slice(3).map(Number).filter(Boolean));
if (!WIDTHS.length) WIDTHS.push(480, 960);

for (const W of WIDTHS) {
  const { w } = buildWorld({ W, H: W >> 1, seed: SEED });
  const r = w.rivers; if (!r || !r.riverMag) { console.log(`W=${W}: no rivers`); continue; }
  const { riverMag, drainsTerminal } = r;
  const elev = w.elevation, moist = w.moisture; const N = riverMag.length;
  const H = W >> 1;
  let land = 0, byMag = [0, 0, 0, 0, 0];
  let majMouths = 0, greatMouths = 0;   // length-INDEPENDENT: one per river system reaching the sea
  let aridTermBig = 0;                  // spurious arid terminal corridor (Major+)
  const oceanAdj = (ti) => { const x = ti % W, y = (ti / W) | 0; for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = (x+dx+W)%W, ny = y+dy; if (ny<0||ny>=H) continue; if (elev[ny*W+nx] <= 0) return true; } return false; };
  for (let ti = 0; ti < N; ti++) {
    if (elev[ti] <= 0) continue; land++;
    const m = riverMag[ti]; byMag[m]++;
    if (m >= 3 && drainsTerminal && drainsTerminal[ti] === 1 && moist[ti] < 0.22) aridTermBig++;
    if (m >= 3 && oceanAdj(ti)) { majMouths++; if (m >= 4) greatMouths++; }
  }
  const riverTiles = byMag[1] + byMag[2] + byMag[3] + byMag[4];
  console.log(`W=${String(W).padStart(4)} | land ${land} | S/T/M/G ${byMag[1]}/${byMag[2]}/${byMag[3]}/${byMag[4]} `
    + `| MOUTHS major+ ${majMouths} (great ${greatMouths}) | ARID-terminal Major+ ${aridTermBig}`);
}
console.log(`\nresolution-INVARIANT ⇒ MOUTH counts (one per river system) should be similar across widths.`);
console.log(`spurious Himalaya→Caspian corridor ⇒ ARID-terminal Major+ tiles; should be ~0.`);
