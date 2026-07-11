// Maritime-empire probe (T.FIELD_NAVAL): does the field polity cross water once
// navigation matures — and never before? Labels landmasses (4-connected, x-wrap),
// then per checkpoint reports realms holding territory on a landmass OTHER than
// their capital's, total overseas tiles, and how much off-mainland land is claimed.
//   node tools/probe_maritime.mjs [seed] [steps] [W] [H]
// A/B: SIM_FIELD_NAVAL=0 vs default. Reference (480×240, seed 8817, 24k steps):
//   lever OFF — cross-water realms stuck at 1-2 all run (only realms with a settled
//     overseas member, retained by the worked-tile seed), overseas share 2.2%→0.5%;
//   lever ON  — byte-identical until navigation crosses the embark floor (t=3000
//     checkpoint matches OFF exactly), then cross-water realms 1→12, overseas share
//     2.2%→11.1%, archipelago realms spanning up to 15 landmasses; at 42k/full nav
//     (seed 31337) 19 of 38 realms cross-water, ~17% of claimed land overseas, realms
//     spanning 10-25 landmasses (one peaked at 30) — and overseas holdings RECEDE
//     when capacity falls (981→851 tiles over the last checkpoints: the shed works).
// Island land is settled (colony ships) at the same ~30-40% either way — the lever's
// delta is realms SPANNING water, not islands being inhabited.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const seed = parseInt(process.argv[2] || "8817", 10);
const STEPS = parseInt(process.argv[3] || "24000", 10);
const W = parseInt(process.argv[4] || "480", 10), H = parseInt(process.argv[5] || "240", 10);
const CHECK = 3000;

const world = buildSim({ W, H, seed });
const { N, tw, th, elev } = world;

// Landmass labels (4-connected, longitude wrap).
const mass = new Int32Array(N).fill(-1);
const massSize = [];
{
  const stack = [];
  let m = 0;
  for (let i = 0; i < N; i++) {
    if (elev[i] <= 0 || mass[i] >= 0) continue;
    stack.push(i); mass[i] = m; let sz = 0;
    while (stack.length) {
      const ti = stack.pop(); sz++;
      const y = (ti / tw) | 0, x = ti - y * tw;
      const ns = [y * tw + ((x + 1) % tw), y * tw + ((x - 1 + tw) % tw), y > 0 ? ti - tw : -1, y < th - 1 ? ti + tw : -1];
      for (const ni of ns) if (ni >= 0 && elev[ni] > 0 && mass[ni] < 0) { mass[ni] = m; stack.push(ni); }
    }
    massSize.push(sz); m++;
  }
}
console.log(`landmasses: ${massSize.length}, largest ${Math.max(...massSize)} tiles, land ${massSize.reduce((a, b) => a + b, 0)}`);

function report(step) {
  const co = world._countryOwner;
  if (!co) { console.log(`t=${step}: no country owner field`); return; }
  const home = new Map(), tiles = new Map(), overseas = new Map(), masses = new Map();
  if (world.countries) for (const [cid, c] of world.countries) {
    if (c.capital && c.capital.mode === "settled") home.set(cid, mass[(c.capital.pos.y | 0) * tw + (c.capital.pos.x | 0)]);
  }
  for (let ti = 0; ti < N; ti++) {
    const c = co[ti]; if (c < 0 || elev[ti] <= 0) continue;
    tiles.set(c, (tiles.get(c) || 0) + 1);
    let s = masses.get(c); if (!s) masses.set(c, s = new Set()); s.add(mass[ti]);
    const h = home.get(c);
    if (h !== undefined && mass[ti] !== h) overseas.set(c, (overseas.get(c) || 0) + 1);
  }
  let navMax = 0, navSail = 0, alive = 0;
  if (world.countries) for (const [, c] of world.countries) {
    const nav = (c.capital && c.capital.knowledge && c.capital.knowledge.navigation) || 0;
    if (c.capital) { alive++; if (nav > navMax) navMax = nav; if (nav >= 0.10) navSail++; }
  }
  const xw = [...overseas.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
  const ovTot = [...overseas.values()].reduce((a, b) => a + b, 0);
  const claimed = [...tiles.values()].reduce((a, b) => a + b, 0);
  const big = massSize.indexOf(Math.max(...massSize));
  let islTiles = 0, islClaimed = 0;
  for (let ti = 0; ti < N; ti++) if (elev[ti] > 0 && mass[ti] !== big) { islTiles++; if (co[ti] >= 0) islClaimed++; }
  console.log(`t=${step}: realms=${alive} navMax=${navMax.toFixed(2)} sailors=${navSail} | cross-water realms(≥3 tiles)=${xw.length} overseasTiles=${ovTot} (${(100 * ovTot / Math.max(1, claimed)).toFixed(1)}% of claimed) | off-mainland land claimed ${islClaimed}/${islTiles} (${(100 * islClaimed / Math.max(1, islTiles)).toFixed(0)}%)`);
  for (const [cid, n] of xw.slice(0, 5)) {
    const c = world.countries.get(cid);
    console.log(`    ${(c && c.name) || cid}: ${n} overseas / ${tiles.get(cid)} tiles, masses=${masses.get(cid).size}, nav=${(((c || {}).capital || {}).knowledge || {}).navigation?.toFixed(2)}`);
  }
}

for (let s = 0; s < STEPS; s += CHECK) {
  stepPeopleSim(world, Math.min(CHECK, STEPS - s));
  report(Math.min(s + CHECK, STEPS));
}
