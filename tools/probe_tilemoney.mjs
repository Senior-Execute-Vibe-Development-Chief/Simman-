#!/usr/bin/env node
// Phase A probe — farm-gate coin on tiles vs legacy seller.wealth.
// Usage: node tools/probe_tilemoney.mjs [steps] [seed]
// Arms: off (TILE_MONEY=0) vs on (TILE_MONEY=1), same emergent food stack.

import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";
import { sumTileWealth, tileWealthOfSettlement } from "../src/sim/peopleSim/tileMoney.js";

const steps = parseInt(process.argv[2] || "6000", 10);
const seed = parseInt(process.argv[3] || "8817", 10);

function run(arm) {
  const world = buildSim({ W: 480, H: 240, seed });
  world._checkInvariants = true;
  for (const k in arm) T[k] = arm[k];
  for (let i = 0; i < steps; i++) stepPeopleSim(world);
  let settleWealth = 0, tileIn = 0, sellersWithTile = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    settleWealth += s.wealth || 0;
    const tw = tileWealthOfSettlement(world, s);
    if (tw > 0) sellersWithTile++;
    tileIn += s._tileMoneyIn || 0;
  }
  const tileTotal = sumTileWealth(world);
  const debugCoin = world.debug?.totalCoin ?? 0;
  return {
    settled: world.settlements.filter(s => s.mode === "settled").length,
    settleWealth,
    tileTotal,
    tileIn,
    sellersWithTile,
    debugCoin,
    tileFiscal: {
      tax: world._tileFiscalTax || 0,
      rent: world._tileFiscalRent || 0,
      inKind: world._tileFiscalInKind || 0,
      salt: world._tileFiscalSalt || 0,
      iron: world._tileFiscalIron || 0,
      faith: world._tileFiscalFaith || 0,
      loss: world._tileFiscalLoss || 0,
    },
    invariantHits: world.debug?.invariantHits || {},
  };
}

const base = {
  MARKET_PULL: 1, PRICE_GROSS: 1, HAUL_PAID: 1, URBAN_LABOR: 1,
  GRAIN_MARKET: 1, GRAIN_FREIGHT: 1, GRAIN_BID: 1, GRAIN_PROVISION: 1,
  ONE_BOOK: 1, SHIP_SURPLUS: 1,
};

console.log(`probe_tilemoney W=480 seed=${seed} steps=${steps}`);
const off = run({ ...base, TILE_MONEY: 0 });
const on = run({ ...base, TILE_MONEY: 1 });
console.log("TILE_MONEY=0", JSON.stringify(off));
console.log("TILE_MONEY=1", JSON.stringify(on));
console.log(`tile coin share (on arm): ${(on.tileTotal / (on.debugCoin || 1)).toFixed(3)}`);
if (on.tileFiscal) console.log("tile fiscal (on)", on.tileFiscal);
