// Unit tests for farm-gate offer: min(willingness, ability to pay).
// Hunger is demand, not cash. A poor hungry city cannot outbid a solvent one.

import { marketPullOfferMap } from "../src/sim/peopleSim/territory.js";
import { grainScarcityOf } from "../src/sim/peopleSim/foodHierarchy.js";
import { T } from "../src/sim/peopleSim/tuning.js";

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`  ok   ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
function approx(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

// people=100 → reserve 60; wealth must clear that to have spare coin.
function sett(id, extra = {}) {
  return {
    id,
    wealth: 0,
    people: 100,
    food: 0,
    _scarcity: 1,
    _foodDemand: 1,
    _foodSupply: 1,
    _landFood: 1,
    _techEff: { market: true },
    ...extra,
  };
}

const prevPay = T.MARKET_PAY;
T.MARKET_PAY = 1;

console.log("[market-pay] offer map");

{
  const byId = new Map([
    [1, sett(1, { wealth: 200 })],
    [2, sett(2, { wealth: 200 })],
  ]);
  const a = marketPullOfferMap({}, byId);
  check("equal fed cities bid equal", approx(a.get(1), a.get(2)), `${a.get(1)} vs ${a.get(2)}`);
}

{
  const byId = new Map([
    [1, sett(1, { _scarcity: 0.5, wealth: 1000 })],   // rich, fed
    [2, sett(2, { _scarcity: 3, wealth: 0 })],         // poor, hungry
  ]);
  const a = marketPullOfferMap({}, byId);
  check("rich fed outbids poor hungry (cannot pay)", a.get(1) > a.get(2) * 4,
    `rich-fed ${a.get(1).toFixed(4)} vs poor-hungry ${a.get(2).toFixed(4)}`);
}

{
  const byId = new Map([
    [1, sett(1, { _scarcity: 3, wealth: 1000 })],      // rich, hungry
    [2, sett(2, { _scarcity: 0.5, wealth: 1000 })],    // rich, fed
  ]);
  const a = marketPullOfferMap({}, byId);
  check("rich hungry outbids rich fed (both can pay; hungry wants it more)", a.get(1) > a.get(2) * 1.5,
    `hungry ${a.get(1).toFixed(4)} vs fed ${a.get(2).toFixed(4)}`);
}

{
  const byId = new Map([
    [1, sett(1, { _scarcity: 3, wealth: 1000 })],      // rich, hungry
    [2, sett(2, { _scarcity: 3, wealth: 0 })],         // poor, hungry
  ]);
  const a = marketPullOfferMap({}, byId);
  check("rich hungry outbids poor hungry (same want, only one can pay)", a.get(1) > a.get(2) * 4,
    `rich ${a.get(1).toFixed(4)} vs poor ${a.get(2).toFixed(4)}`);
}

{
  T.MARKET_PAY = 0;
  const byId = new Map([
    [1, sett(1, { _scarcity: 0.5, wealth: 1000 })],
    [2, sett(2, { _scarcity: 3, wealth: 0 })],
  ]);
  const a = marketPullOfferMap({}, byId);
  check("hunger-only path: poor hungry still outbids rich fed", a.get(2) > a.get(1) * 2,
    `rich-fed ${a.get(1).toFixed(4)} vs poor-hungry ${a.get(2).toFixed(4)}`);
  T.MARKET_PAY = 1;
}

{
  const byId = new Map([
    [1, sett(1, { wealth: 0, _scarcity: 3 })],
    [2, sett(2, { wealth: 0, _scarcity: 1 })],
  ]);
  const a = marketPullOfferMap({}, byId);
  check("coinless dawn: ability does not bind, hunger still ranks", a.get(1) > a.get(2) * 1.5,
    `hungry ${a.get(1).toFixed(4)} vs fed ${a.get(2).toFixed(4)}`);
}

{
  const byId = new Map([
    [1, sett(1, { wealth: 1000, _scarcity: 0.5, _techEff: { market: false } })],
    [2, sett(2, { wealth: 0, _scarcity: 3, _techEff: { market: false } })],
  ]);
  const a = marketPullOfferMap({}, byId);
  check("pre-coin temple: ability does not bind, hunger ranks", a.get(2) > a.get(1) * 2,
    `fed ${a.get(1).toFixed(4)} vs hungry ${a.get(2).toFixed(4)}`);
}

console.log("[market-pay] willingness (grain scarcity)");

{
  const emptyBook = grainScarcityOf({
    _foodSupply: 0, _foodDemand: 2, _landFood: 2, _foodExportedPrev: 0, food: 0,
  });
  check("zero retained + live hinterland is not max-bid", emptyBook < 2.5,
    `scarcity ${emptyBook}`);
  check("empty book with matching land reads fed (~1)", approx(emptyBook, 1, 0.05),
    `scarcity ${emptyBook}`);
}

{
  const stockedGone = grainScarcityOf({
    _foodSupply: 0, _foodDemand: 2, _landFood: 0, _foodExportedPrev: 0, food: 80,
  });
  check("full barn + empty hinterland still reads famine (stores are a buffer, not harvest)", stockedGone === 3,
    `scarcity ${stockedGone}`);
  check("full barn does not hide a live hinterland",
    grainScarcityOf({
      _foodSupply: 0, _foodDemand: 2, _landFood: 2, _foodExportedPrev: 0, food: 80,
    }) === 1, "");
}

{
  const famine = grainScarcityOf({
    _foodSupply: 0, _foodDemand: 2, _landFood: 0, _foodExportedPrev: 0, food: 0,
  });
  check("real empty pot + mouths still reads 3", famine === 3, `scarcity ${famine}`);
}

{
  const unborn = grainScarcityOf({
    _foodSupply: 0, _foodDemand: 0, _landFood: 0, _foodExportedPrev: 0, food: 0,
  });
  check("no demand and no supply is neutral, not starving", unborn === 1, `scarcity ${unborn}`);
}

{
  const glut = grainScarcityOf({
    _foodSupply: 10, _foodDemand: 1, _landFood: 10, _foodExportedPrev: 0, food: 0,
  });
  check("glut clamps at 0.5", glut === 0.5, `scarcity ${glut}`);
}

T.MARKET_PAY = prevPay;

if (failures) {
  console.error(`\n[market-pay] ${failures} failed`);
  process.exit(1);
}
console.log("\n[market-pay] all checks passed");
