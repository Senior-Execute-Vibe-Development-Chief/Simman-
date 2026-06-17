// Probe: deep ancestry field (worldgen genetic substrate).
//   node tools/probe_ancestry.mjs
import { buildWorld } from "./_harness.mjs";

const W = 320, H = 160, SEED = 4242;
const { ter } = buildWorld({ W, H, seed: SEED, preset: "earth_sim" });
const { tAncestry, ancestryCount, tw, th, tElev, ancOriginFx, ancOriginFy } = ter;
const ogx = Math.round((ancOriginFx ?? 0) * tw), ogy = Math.round((ancOriginFy ?? 0) * th);
const oLon = (ancOriginFx ?? 0) * 360 - 180, oLat = 90 - (ancOriginFy ?? 0) * 180;
console.log(`[probe] genesis origin — tile (${ogx},${ogy})  ≈ ${oLat.toFixed(1)}°${oLat>=0?"N":"S"} ${oLon.toFixed(1)}°${oLon>=0?"E":"W"}  (East African Rift ≈ 4°N 37°E)`);

const counts = new Map(); let land = 0;
for (let ti = 0; ti < tw * th; ti++) { if (tElev[ti] <= 0) continue; land++; const a = tAncestry[ti]; counts.set(a, (counts.get(a) || 0) + 1); }
console.log(`[probe] deep ancestry — ${W}x${H} seed ${SEED}`);
console.log(`  ancestries: ${ancestryCount}   land tiles: ${land}   avg region: ${(land / Math.max(1, counts.size)).toFixed(0)} tiles`);
const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
console.log(`  region sizes (% of land): ${sorted.map(([a, n]) => `#${a}:${(100 * n / land).toFixed(0)}%`).join("  ")}`);

// coarse ASCII map — one glyph per ancestry, '.' = water
const GL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz";
const COLS = 110, ROWS = 46;
let out = "";
for (let r = 0; r < ROWS; r++) {
  let line = "";
  for (let c = 0; c < COLS; c++) {
    const tx = Math.min(tw - 1, Math.floor(c / COLS * tw)), ty = Math.min(th - 1, Math.floor(r / ROWS * th));
    const ti = ty * tw + tx;
    if (Math.abs(tx - ogx) <= tw / COLS / 2 && Math.abs(ty - ogy) <= th / ROWS / 2) { line += "@"; continue; }
    line += tAncestry[ti] < 0 ? "." : (GL[tAncestry[ti] % GL.length] || "?");
  }
  out += line + "\n";
}
console.log(out);
