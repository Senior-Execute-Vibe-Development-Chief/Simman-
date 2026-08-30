// Unit tests for MARKET_PULL bid mass and grain scarcity.
// The farm-tile flood is hunger × size × circulating pay — not hunger alone.

import { marketPullAbilityMap } from "../src/sim/peopleSim/territory.js";
import { grainScarcityOf } from "../src/sim/peopleSim/foodHierarchy.js";
import { T } from "../src/sim/peopleSim/tuning.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

function sett(id, extra = {}) {
  return {
    id,
    wealth: 0,
    people: 100,
    _scarcity: 1,
    _foodDemand: 1,
    _foodSupply: 1,
    _landFood: 1,
    ...extra,
  };
}

console.log("[market-bid] ability map");

{
  const byId = new Map([
    [1, sett(1)],
    [2, sett(2)],
  ]);
  const a = marketPullAbilityMap({}, byId);
  check("equal fed cities bid equal", approx(a.get(1), a.get(2)), `${a.get(1)} vs ${a.get(2)}`);
}

{
  const byId = new Map([
    [1, sett(1, { _scarcity: 3 })],
    [2, sett(2, { _scarcity: 1 })],
  ]);
  const a = marketPullAbilityMap({}, byId);
  check("hungrier city bids more", a.get(1) > a.get(2) * 1.5, `hungry ${a.get(1).toFixed(3)} vs fed ${a.get(2).toFixed(3)}`);
}

{
  const byId = new Map([
    [1, sett(1, { _foodDemand: 4, people: 400 })],
    [2, sett(2, { _foodDemand: 1, people: 100 })],
  ]);
  const a = marketPullAbilityMap({}, byId);
  // sizeRel = sqrt(d/dBar); 4× mouths → 2× size term, other factors equal.
  const ratio = a.get(1) / a.get(2);
  check("4× mouths → ~2× bid (sqrt area→radius)", approx(ratio, 2, 0.05), `ratio ${ratio.toFixed(3)}`);
}

{
  T.TILE_MONEY = 1;
  const world = {
    _tileWealth: new Float32Array([0, 80, 0]),
    _territoryOwner: new Int32Array([1, 1, 2]),
  };
  const byId = new Map([
    [1, sett(1, { wealth: 0 })],
    [2, sett(2, { wealth: 0 })],
  ]);
  const a = marketPullAbilityMap(world, byId);
  check("tile coin, not empty s.wealth, stretches the ring", a.get(1) > a.get(2),
    `rich-field ${a.get(1).toFixed(3)} vs broke ${a.get(2).toFixed(3)}`);
}

{
  const byId = new Map([
    [1, sett(1, { wealth: 0 })],
    [2, sett(2, { wealth: 100 })],
  ]);
  const a = marketPullAbilityMap({}, byId);
  check("coinless city still bids (pay floor, not zero)", a.get(1) > 1e-3,
    `broke ${a.get(1)}`);
  check("richer city outbids the broke one", a.get(2) > a.get(1),
    `broke ${a.get(1).toFixed(3)} vs rich ${a.get(2).toFixed(3)}`);
}

{
  const byId = new Map([
    [1, sett(1, { wealth: 0 })],
    [2, sett(2, { wealth: 0 })],
  ]);
  const a = marketPullAbilityMap({}, byId);
  check("coinless dawn: pay is neutral, not a zero bid", approx(a.get(1), a.get(2)) && a.get(1) > 0.5,
    `${a.get(1)} ${a.get(2)}`);
}

console.log("[market-bid] grain scarcity (empty book ≠ famine)");

{
  const emptyBook = grainScarcityOf({
    _foodSupply: 0, _foodDemand: 2, _landFood: 2, _foodExportedPrev: 0,
  });
  check("zero retained + live hinterland is not max-bid", emptyBook < 2.5,
    `scarcity ${emptyBook}`);
  check("empty book with matching land reads fed (~1)", approx(emptyBook, 1, 0.05),
    `scarcity ${emptyBook}`);
}

{
  const famine = grainScarcityOf({
    _foodSupply: 0, _foodDemand: 2, _landFood: 0, _foodExportedPrev: 0,
  });
  check("real empty pot + mouths still reads 3", famine === 3, `scarcity ${famine}`);
}

{
  const unborn = grainScarcityOf({
    _foodSupply: 0, _foodDemand: 0, _landFood: 0, _foodExportedPrev: 0,
  });
  check("no demand and no supply is neutral, not starving", unborn === 1, `scarcity ${unborn}`);
}

{
  const glut = grainScarcityOf({
    _foodSupply: 10, _foodDemand: 1, _landFood: 10, _foodExportedPrev: 0,
  });
  check("glut clamps at 0.5", glut === 0.5, `scarcity ${glut}`);
}

if (failures) {
  console.error(`\n[market-bid] ${failures} failed`);
  process.exit(1);
}
console.log("\n[market-bid] all checks passed");
