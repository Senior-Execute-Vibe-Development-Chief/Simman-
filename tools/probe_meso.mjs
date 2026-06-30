// Are the Tigris/Euphrates being treated as TERMINAL (Persian Gulf mis-read as a closed inland
// sea) — which would subject them to the corridor suppression — or as ocean-bound (exorheic)?
// Report, for the Mesopotamia box, the river tiles by magnitude and how many are terminal-bound.
import { buildWorld } from "../src/sim/pipeline.js";
const SEED = parseInt(process.argv[2] || "8817", 10);
const W = parseInt(process.argv[3] || "960", 10), H = W >> 1;
const { w } = buildWorld({ W, H, seed: SEED });
const { riverMag, drainsTerminal } = w.rivers;
// Mesopotamia box: 35–50E, 27–38N
const x0 = Math.round((35 + 180) / 360 * W), x1 = Math.round((50 + 180) / 360 * W);
const y0 = Math.round((0.5 - 38 / 180) * H), y1 = Math.round((0.5 - 27 / 180) * H);
let byMag = [0,0,0,0,0], term = 0, ocean = 0, maxMag = 0;
for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
  const ti = y * W + x; const m = riverMag[ti]; if (m < 1) continue;
  byMag[m]++; if (m > maxMag) maxMag = m;
  if (drainsTerminal[ti] === 1) term++; else if (drainsTerminal[ti] === 0) ocean++;
}
console.log(`Mesopotamia box (35-50E,27-38N) @ ${W}w: S/T/M/G ${byMag[1]}/${byMag[2]}/${byMag[3]}/${byMag[4]}, maxMag ${maxMag}`);
console.log(`  river tiles draining TERMINAL (closed sink) ${term}  vs  OCEAN (exorheic) ${ocean}`);
console.log(term > ocean ? "  ⇒ TERMINAL-bound: the Persian Gulf is read as a closed sea, so the cradle rivers are hit by the corridor suppression." : "  ⇒ OCEAN-bound: not a terminal-classification problem.");
