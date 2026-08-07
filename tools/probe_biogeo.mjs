// Package biogeography check: what does each region domesticate, and is the New
// World locked to New-World crops? Prints the best package at each cradle window
// AND at a set of New/Old-World sample tiles, with and without CROP_BIOGEO, so
// the maize-in-Egypt anachronism (and its inverse, wheat in the Americas) is
// visible as a before/after.
//   node tools/probe_biogeo.mjs [W] [seed]
import { buildSim } from "./_harness.mjs";
import { bestPackageAt } from "../src/sim/peopleSim/agriculture.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const W = +(process.argv[2] || 480), H = W >> 1;
const SEED = +(process.argv[3] || 8817);

const SITES = [
  ["Nile", 0.578, 0.330], ["Mesopotamia", 0.622, 0.330], ["Indus", 0.694, 0.344],
  ["YellowR", 0.811, 0.305], ["Yangtze", 0.790, 0.380], ["Europe", 0.50, 0.22],
  ["Sahel", 0.52, 0.43], ["Mesoamerica", 0.23, 0.40], ["N.America", 0.27, 0.28],
  ["Amazonia", 0.30, 0.55], ["Andes", 0.27, 0.55], ["Australia", 0.86, 0.64],
];

function report(tag, world) {
  const { tw, th, elev } = world;
  console.log(`\n== ${tag}`);
  for (const [name, fx, fy] of SITES) {
    const cx = Math.round(fx * tw), cy = Math.round(fy * th);
    // best of a small window (the site may land a hair off a coast/river cell)
    let best = null, bestS = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const ti = (cy + dy) * tw + (((cx + dx) % tw) + tw) % tw;
      if (!(elev[ti] > 0)) continue;
      const b = bestPackageAt(world, ti);
      if (b && b.suit > bestS) { bestS = b.suit; best = b; }
    }
    console.log(`   ${name.padEnd(12)} ${best ? `${best.id}(${best.suit.toFixed(2)})` : "—"}`);
  }
}

// bestPackageAt reads live leadAgri; force the field to a MATURE reach so the
// late-game "packages have spread" picture is what we compare (early is trivially
// origin-only). We build the sim, step a little so agriculture exists, then read.
T.CROP_BIOGEO = 0;
const w0 = buildSim({ W, H, seed: SEED });
report("CLIMATE ONLY (CROP_BIOGEO=0)", w0);

T.CROP_BIOGEO = 1;
const w1 = buildSim({ W, H, seed: SEED });
w1._bioReachDev = 0.05;   // DAWN reach — origins + early halo only
report("BIOGEO @ DAWN (leadAgri 0.05)", w1);
w1._bioReachDev = 1.0;    // MATURE reach — full spread
report("BIOGEO @ MATURITY (leadAgri 1.0)", w1);
