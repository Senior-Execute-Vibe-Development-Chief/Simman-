// How far does the NATIONAL CLAIM sit from the coast? Decides whether "blank coasts"
// in the tint are a render-quantization gap (claim is right at the coast) or a genuine
// unclaimed frontier (claim recedes inland — filling it would INVENT territory).
//   node tools/probe_coastclaim.mjs [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const W = parseInt(process.argv[2] || "480", 10), H = W >> 1;
const SEED = parseInt(process.argv[3] || "8817", 10);
const world = buildSim({ W, H, seed: SEED });
const tw = world.tw, th = world.th;

// Step until politics is well-developed (leading org ~0.55).
for (let s = 0; s < 40000; s += 250) {
  stepPeopleSim(world, 250);
  let lead = 0;
  for (const c of (world.countries ? world.countries.values() : [])) {
    const k = c.capital && c.capital.knowledge; if (k && k.organization > lead) lead = k.organization;
  }
  if (lead >= 0.55) break;
}

const claim = world._countryClaim;
const elev = world.elev;
const isLand = (i) => elev[i] > 0;
// A sim land tile is COASTAL if a 4-neighbour is ocean.
const coastal = [];
for (let i = 0; i < tw * th; i++) {
  if (!isLand(i)) continue;
  const y = (i / tw) | 0, x = i - y * tw;
  const nb = [y > 0 ? i - tw : -1, y < th - 1 ? i + tw : -1, x > 0 ? i - 1 : -1, x < tw - 1 ? i + 1 : -1];
  let coast = false;
  for (const j of nb) if (j < 0 || !isLand(j)) { coast = true; break; }
  if (coast) coastal.push(i);
}

// Multi-source BFS from every CLAIMED land tile, over LAND, to get each land tile's
// tile-distance to the nearest claim.
const dist = new Int32Array(tw * th).fill(-1);
const q = new Int32Array(tw * th); let head = 0, tail = 0;
for (let i = 0; i < tw * th; i++) if (isLand(i) && claim && claim[i] >= 0) { dist[i] = 0; q[tail++] = i; }
while (head < tail) {
  const i = q[head++]; const y = (i / tw) | 0, x = i - y * tw;
  const nb = [y > 0 ? i - tw : -1, y < th - 1 ? i + tw : -1, x > 0 ? i - 1 : -1, x < tw - 1 ? i + 1 : -1];
  for (const j of nb) { if (j < 0 || dist[j] >= 0 || !isLand(j)) continue; dist[j] = dist[i] + 1; q[tail++] = j; }
}

let landTiles = 0, claimedLand = 0;
for (let i = 0; i < tw * th; i++) if (isLand(i)) { landTiles++; if (claim && claim[i] >= 0) claimedLand++; }

// For coastal tiles: how many are claimed, and the distance histogram for unclaimed ones.
let coastClaimed = 0; const hist = {}; let coastUnreachable = 0;
for (const i of coastal) {
  if (claim && claim[i] >= 0) { coastClaimed++; continue; }
  const d = dist[i];
  if (d < 0) { coastUnreachable++; continue; }              // on a landmass with no claim at all
  hist[d] = (hist[d] || 0) + 1;
}

console.log(`── coast-claim · ${W}x${H} · seed ${SEED} · step ${world.step} · tw=${tw} th=${th} ──`);
console.log(`land tiles ${landTiles}  ·  claimed ${claimedLand} (${(100*claimedLand/landTiles).toFixed(0)}%)`);
console.log(`coastal land tiles: ${coastal.length}  ·  claimed at coast: ${coastClaimed} (${(100*coastClaimed/coastal.length).toFixed(0)}%)`);
console.log(`unclaimed coastal on a NATION-BEARING landmass, by tile-distance to nearest claim:`);
const keys = Object.keys(hist).map(Number).sort((a,b)=>a-b);
let cum = 0; const totUnclaimedReach = keys.reduce((s,k)=>s+hist[k],0);
for (const k of keys) { cum += hist[k]; console.log(`  ${String(k).padStart(3)} tiles away: ${String(hist[k]).padStart(5)}  (cum ${(100*cum/totUnclaimedReach).toFixed(0)}%)`); }
console.log(`unclaimed coastal on a landmass with NO claim (empty continent): ${coastUnreachable}`);
