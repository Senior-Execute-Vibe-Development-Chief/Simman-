#!/usr/bin/env node
// TILE_MONEY measurement — single emergent arm, checkpoint samples.
// Usage: node tools/probe_tilemoney_measure.mjs [steps] [seed] [W]
//   W default 480 (tw=240). W=960 → tw=480 shipped-grid spot.

import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";
import { sumTileWealth } from "../src/sim/peopleSim/tileMoney.js";

const steps = parseInt(process.argv[2] || "24000", 10);
const seed = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);
const H = W >> 1;
const CHECK = 6000;

const base = {
  MARKET_PULL: 1, PRICE_GROSS: 1, HAUL_PAID: 1, URBAN_LABOR: 1,
  GRAIN_MARKET: 1, GRAIN_FREIGHT: 1, GRAIN_BID: 1, GRAIN_PROVISION: 1,
  ONE_BOOK: 1, SHIP_SURPLUS: 1, TILE_MONEY: 1,
};

function snap(world, step) {
  let settleWealth = 0, tileIn = 0, tilesWithCoin = 0, maxMet = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    settleWealth += s.wealth || 0;
    tileIn += s._tileMoneyIn || 0;
    const m = s.knowledge?.metallurgy ?? 0;
    if (m > maxMet) maxMet = m;
  }
  const tw = world._tileWealth;
  if (tw) {
    for (let i = 0; i < tw.length; i++) if ((tw[i] || 0) > 0) tilesWithCoin++;
  }
  const tileTotal = sumTileWealth(world);
  const debugCoin = world.debug?.totalCoin ?? 0;
  const f = {
    tax: world._tileFiscalTax || 0,
    rent: world._tileFiscalRent || 0,
    inKind: world._tileFiscalInKind || 0,
    salt: world._tileFiscalSalt || 0,
    iron: world._tileFiscalIron || 0,
    faith: world._tileFiscalFaith || 0,
    loss: world._tileFiscalLoss || 0,
  };
  const sinkCoin = f.tax + f.rent + f.salt + f.iron + f.faith + f.loss;
  return {
    step,
    settled: world.settlements.filter(s => s.mode === "settled").length,
    countries: world.countries?.size ?? 0,
    settleWealth,
    tileTotal,
    tileShare: tileTotal / (debugCoin || 1),
    tileIn,
    tilesWithCoin,
    debugCoin,
    maxMetallurgy: maxMet,
    lastPassSinks: f,
    lastPassSinkCoin: sinkCoin,
    invariantHits: world.debug?.invariantHits || {},
  };
}

console.log(`probe_tilemoney_measure W=${W} tw=${W >> 1} seed=${seed} steps=${steps}`);
const world = buildSim({ W, H, seed });
world._checkInvariants = true;
for (const k in base) T[k] = base[k];

const checkpoints = [];
for (let i = 0; i < steps; i++) {
  stepPeopleSim(world);
  const s = i + 1;
  if (s % CHECK === 0 || s === steps) checkpoints.push(snap(world, s));
}

for (const c of checkpoints) {
  console.log("checkpoint", JSON.stringify(c));
}
const last = checkpoints[checkpoints.length - 1];
console.log(`SUMMARY tileShare=${last.tileShare.toFixed(4)} tileTotal=${last.tileTotal.toFixed(2)} M=${last.debugCoin.toFixed(0)} iron_sink=${last.lastPassSinks.iron.toFixed(4)} maxMet=${last.maxMetallurgy.toFixed(3)}`);
