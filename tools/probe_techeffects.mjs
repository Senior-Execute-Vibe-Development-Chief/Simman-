// Tech-effects calibration check (tech.js techEffects). Prints, for a sweep of
// "advancement" levels and a few archetypes, the NEW tech-derived bonus channels
// against the OLD continuous-knowledge formulas they replace — so the discrete
// staircase can be tuned to hug the old curve (balance preserved) before any of
// it is wired into the sim.
//   node tools/probe_techeffects.mjs
import { techEffects, techState, TECHS } from "../src/peopleSim/tech.js";

const f2 = n => n.toFixed(2).padStart(6);
function row(label, k) {
  const e = techEffects(k, 1);                 // fully tech-driven
  const ag = k.agriculture, cn = k.construction, nav = k.navigation, met = k.metallurgy, mob = k.mobility;
  const oldFarm = 1 + ag * 1.2, oldFish = 0.3 + nav * 1.2, oldBuild = cn, oldMil = 1 + met * 1.5 + mob * 0.8;
  const ts = techState(k);
  console.log(
    `${label.padEnd(18)} t${String(ts.count).padStart(2)}  ` +
    `farm ${f2(e.farmYield)}/${f2(oldFarm)}  fish ${f2(e.fishFactor)}/${f2(oldFish)}  ` +
    `build ${f2(e.buildLevel)}/${f2(oldBuild)}  mil ${f2(e.military)}/${f2(oldMil)}  ` +
    `reach ${f2(e.reachLevel)}  trade ${f2(e.ch.trade)}  wealth ${f2(e.ch.wealth)}`);
}

console.log("label              techs  farm new/old  fish new/old  build new/old  mil new/old  +reach +trade +wealth\n");
// Correlated sweep: a developing civ where the tracks rise together.
for (let a = 0.1; a <= 1.001; a += 0.1) {
  row(`adv ${a.toFixed(1)}`, { agriculture: a, construction: a, organization: a, metallurgy: a, navigation: a, mobility: a });
}
console.log("");
// Archetypes (uneven — geography-shaped).
row("bronze coast",   { agriculture:0.55, construction:0.50, organization:0.45, metallurgy:0.50, navigation:0.60, mobility:0.15 });
row("iron horse",     { agriculture:0.80, construction:0.72, organization:0.78, metallurgy:0.86, navigation:0.08, mobility:0.86 });
row("landlocked steel",{ agriculture:0.92, construction:0.95, organization:0.95, metallurgy:0.97, navigation:0.05, mobility:0.40 });
row("maritime metro", { agriculture:0.94, construction:0.96, organization:1.00, metallurgy:0.96, navigation:0.96, mobility:0.60 });

console.log(`\n${TECHS.length} techs total; channel sums at full-tech printed as 'new'. Aim: new ≈ old along the sweep.`);
