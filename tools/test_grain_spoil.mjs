// Climate-scaled grain spoilage: granary, haul, mart stock.

import { grainSpoilClimate } from "../src/sim/peopleSim/habitability.js";
import { foodHaulArrive } from "../src/sim/peopleSim/foodHierarchy.js";
import { T } from "../src/sim/peopleSim/tuning.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("[grain-spoil] climate multiplier");

{
  const temperate = grainSpoilClimate(0.50, 0.55);
  const tropical = grainSpoilClimate(0.88, 0.72);
  const hotDry = grainSpoilClimate(0.90, 0.10);   // bone-dry subtropical — desert granary belt (effMoist low)
  check("tropical rots faster than temperate", tropical > temperate * 1.4,
    `trop ${tropical.toFixed(2)} vs temp ${temperate.toFixed(2)}`);
  check("hot dry preserves vs temperate", hotDry < temperate,
    `dry ${hotDry.toFixed(2)} vs temp ${temperate.toFixed(2)}`);
  check("multiplier bounded", temperate >= 0.45 && tropical <= 2.8);
}

{
  const prevG = T.GRANARY_SPOIL, prevC = T.CLIMATE_SPOIL;
  T.GRANARY_SPOIL = 1;
  T.CLIMATE_SPOIL = 1;
  const world = { tw: 240, temp: new Float32Array(1), moist: new Float32Array(1),
    coast: new Uint8Array(1), riverMag: new Uint8Array(1) };
  const child = { id: 1, pos: { x: 10, y: 10 }, tier: 1,
    _climTemp: 0.88, _climMoist: 0.72, knowledge: {} };
  const parentCool = { id: 2, pos: { x: 50, y: 10 }, tier: 2,
    _climTemp: 0.50, _climMoist: 0.55, knowledge: {} };
  const parentHot = { id: 3, pos: { x: 50, y: 10 }, tier: 2,
    _climTemp: 0.88, _climMoist: 0.72, knowledge: {} };
  const d = 30;
  const arriveCool = foodHaulArrive(world, child, parentCool);
  const arriveHot = foodHaulArrive(world, child, parentHot);
  check("hot route loses more grain than cool route", arriveCool > arriveHot,
    `cool ${arriveCool.toFixed(4)} vs hot ${arriveHot.toFixed(4)} at d=${d}`);
  T.GRANARY_SPOIL = prevG;
  T.CLIMATE_SPOIL = prevC;
}

console.log(failures ? `\n[grain-spoil] ${failures} failure(s)` : "\n[grain-spoil] all checks passed");
process.exit(failures ? 1 : 0);
