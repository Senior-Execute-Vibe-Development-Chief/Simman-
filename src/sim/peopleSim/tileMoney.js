// ── Per-tile circulating coin (farm-gate payments) ─────────────────────
// Phase A (docs/money-field-2026-08-28.md): grain sales credit the WORKED
// tiles that produced them; buyer settlement wealth debits. Seller settlement
// wealth does NOT rise on IN_FOOD — the countryside holds the coin.
//
// Rural sinks (tax, rent, salt, tithe) land in Phase B–C; this module only
// moves coin at the farm gate and keeps conservation honest.

import { T } from "./tuning.js";

export function ensureTileWealth(world) {
  const N = world.N;
  if (!world._tileWealth || world._tileWealth.length !== N) {
    world._tileWealth = new Float32Array(N);
  }
  return world._tileWealth;
}

/** Sum coin held on tiles owned by settlement `s`. */
export function tileWealthOfSettlement(world, s) {
  if (!(T.TILE_MONEY > 0) || !world._tileWealth) return 0;
  const owner = world._territoryOwner;
  if (!owner || owner.length !== world.N) return 0;
  const tw = world._tileWealth;
  let sum = 0;
  for (let ti = 0; ti < world.N; ti++) {
    if (owner[ti] === s.id) sum += tw[ti] || 0;
  }
  return sum;
}

/** Total coin on all tiles (conservation / inflation). */
export function sumTileWealth(world) {
  const tw = world._tileWealth;
  if (!tw || !(T.TILE_MONEY > 0)) return 0;
  let sum = 0;
  for (let i = 0; i < tw.length; i++) sum += tw[i] || 0;
  return sum;
}

/**
 * Credit a farm-gate grain payment to the seller's worked tiles (pro-rata by
 * popField, else fertility, else equal). When T.TILE_MONEY is off, credits
 * seller.wealth (byte-identical legacy path).
 */
export function creditFarmGatePayment(world, seller, amount) {
  if (!(amount > 0) || !seller) return 0;
  if (!(T.TILE_MONEY > 0)) {
    seller.wealth = (seller.wealth || 0) + amount;
    return amount;
  }
  const owner = world._territoryOwner;
  const elev = world.elev;
  if (!owner || owner.length !== world.N || !elev) {
    seller.wealth = (seller.wealth || 0) + amount;
    return amount;
  }
  const pf = world.popField;
  const fert = world.fert;
  const tiles = [];
  const weights = [];
  let wSum = 0;
  for (let ti = 0; ti < world.N; ti++) {
    if (owner[ti] !== seller.id || elev[ti] <= 0) continue;
    let w = pf && pf[ti] > 0 ? pf[ti] : (fert && fert[ti] > 0 ? fert[ti] : 1);
    tiles.push(ti);
    weights.push(w);
    wSum += w;
  }
  if (wSum <= 0 || tiles.length === 0) {
    seller.wealth = (seller.wealth || 0) + amount;
    return amount;
  }
  const tw = ensureTileWealth(world);
  let credited = 0;
  for (let i = 0; i < tiles.length; i++) {
    const share = amount * (weights[i] / wSum);
    if (share > 0) {
      tw[tiles[i]] = (tw[tiles[i]] || 0) + share;
      credited += share;
    }
  }
  seller._tileMoneyIn = (seller._tileMoneyIn || 0) + credited;
  return credited;
}
