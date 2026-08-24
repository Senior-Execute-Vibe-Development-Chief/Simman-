// THE CELL-MASS DISTRIBUTION — what does a market cell actually hold? (2026-08-24)
//
// The mint ladder's last open question (docs/egypt-autopsy-2026-08-24.md final
// section). PEER_LATTICE already prices EXTRA seats in a claimed cell at the
// city bar (capacity = floor(cellMass/bar), labelBasinFree) — but the FIRST
// seat is exempt (an unclaimed cell is free unconditionally, at the fossil
// TOWN_BASIN_MIN activation), so the register saturates at one-per-cell and
// the box register IS the cell lattice. The candidate one-line fix — the
// first seat pays the same law — bites exactly as hard as the cell-mass
// distribution says: if most peopled cells hold ≥ one city-bar of people, it
// is inert; if the bar is a real cut, the register drops toward Σ capacity.
// Unit soup (field vs census vs the drifting bridge) makes this unguessable —
// so measure it.
//
// Per checkpoint, over the Egypt box and the world:
//   cells seen, their mass distribution (field units AND census via the live
//   bridge), the city bar in field units, capacity = floor(mass/bar) per
//   cell, Σ capacity (the would-be register ceiling under first-seat law),
//   and the ACTUAL settled register for comparison.
//
//   SIM_TUNE="<live arm>" node tools/probe_cellmass.mjs [steps] [W] [seed] [ckpt]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { labelSiteOf, labelBasinMass } from "../src/sim/peopleSim/crystallize.js";

const STEPS = +(process.argv[2] || 20000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const CKPT = +(process.argv[5] || 2000);

const world = buildSim({ W, H, seed: SEED });
const TW = world.tw, TH = world.th;
const lonOf = (x) => (x / TW) * 360 - 180, latOf = (y) => 90 - (y / TH) * 180;
const inBox = (x, y) => { const lo = lonOf(x), la = latOf(y); return la >= 20 && la <= 33 && lo >= 24 && lo <= 36; };
const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);

console.log(`\n=== THE CELL-MASS DISTRIBUTION  ${W}x${H} (tw=${TW})  seed ${SEED} ===`);
console.log(`  bar = TIER_CORE[2]/URBAN_SHARE_REF = 200 census over the live bridge; capacity = floor(cellMass/bar)\n`);
for (let done = 0; done < STEPS; done += CKPT) {
  stepPeopleSim(world, Math.min(CKPT, STEPS - done));
  const bridge = world._onePopScale > 0 ? world._onePopScale : 0.002;
  const barF = (10 / 0.05) / bridge;   // TIER_CORE[2]=10, URBAN_SHARE_REF=0.05 — field units
  const scan = (boxOnly) => {
    const seen = new Set(), masses = [];
    for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
      if (boxOnly && !inBox(tx, ty)) continue;
      if (world.elev[ty * TW + tx] <= 0) continue;
      const st = labelSiteOf(world, tx, ty);
      if (!st || seen.has(st.ti)) continue;
      seen.add(st.ti);
      masses.push(labelBasinMass(world, st.x, st.y));
    }
    let capSum = 0, cellsGE1 = 0;
    for (const m of masses) { const c = Math.floor(m / barF); capSum += c; if (c >= 1) cellsGE1++; }
    let settled = 0;
    for (const s of world.settlements) {
      if (s.mode !== "settled") continue;
      if (boxOnly && !inBox(s.pos.x | 0, s.pos.y | 0)) continue;
      settled++;
    }
    return { n: masses.length, masses, capSum, cellsGE1, settled };
  };
  const b = scan(true), w = scan(false);
  const row = (lab, r) => console.log(
    `    ${lab}: cells ${String(r.n).padStart(4)} · mass p10/50/90 ${Math.round(q(r.masses, .1))}/${Math.round(q(r.masses, .5))}/${Math.round(q(r.masses, .9))} field` +
    ` (= ${(q(r.masses, .1) * bridge).toFixed(0)}/${(q(r.masses, .5) * bridge).toFixed(0)}/${(q(r.masses, .9) * bridge).toFixed(0)} census)` +
    ` · cells≥1bar ${String(r.cellsGE1).padStart(3)} · Σcapacity ${String(r.capSum).padStart(4)} · ACTUAL settled ${r.settled}`);
  console.log(`  step ${world.step}  bridge ${bridge.toFixed(5)}  bar ${Math.round(barF)} field (${(10 / 0.05).toFixed(0)} census)`);
  row("EGYPT box", b);
  row("world    ", w);
}
console.log(`\n  READ: Σcapacity vs ACTUAL settled is the first-seat law's predicted register.`);
console.log(`  cells≥1bar ≈ n  ⇒ the law is inert; Σcapacity ≪ actual ⇒ it cuts the register`);
console.log(`  toward history; Σcapacity ≈ 0 with people plainly present ⇒ the BRIDGE/bar`);
console.log(`  units are wrong for cells and the law must be re-grounded before building.`);
