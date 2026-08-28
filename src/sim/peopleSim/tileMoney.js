// ── Per-tile circulating coin (farm-gate payments + rural fiscal sinks) ──
// docs/money-field-2026-08-28.md — Phase A: farm-gate credit; Phase B: tax + rent.

import { getPolity } from "./entities.js";
import { getWealthReserve, techEff } from "./settlement.js";
import { recordOut, OUT_TRIBUTE } from "./money.js";
import { T } from "./tuning.js";

const TRIB_FOOD_PER_POP = 0.0030;
const TRIBUTE_RATE = 0.10;
const EXTRACT_CHIEF = 0.3;

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

/** Per-tile monetization — same shape as settlement monetization(). */
export function monetizationTile(world, ti, capS, terrS) {
  const pf = world.popField;
  const bridge = world._onePopScale || 0;
  const people = pf && pf[ti] > 0 && bridge > 0 ? pf[ti] * bridge : 0;
  const tw = world._tileWealth;
  const reserve = 30 + people * 0.3;
  const coinF = Math.min(1, Math.max(0, (tw?.[ti] || 0) / (3 * reserve)));
  const reachS = terrS || capS;
  const reachF = reachS ? Math.min(1, (reachS._tradeReach?.size || 0) / 10) : 0;
  const instF = capS && techEff(capS).market ? 1 : 0.3;
  return coinF * (0.25 + 0.75 * reachF) * instF;
}

function territoryTiles(world, sid) {
  const owner = world._territoryOwner;
  const elev = world.elev;
  if (!owner || owner.length !== world.N || !elev) return null;
  const tiles = [];
  const weights = [];
  const pf = world.popField;
  const fert = world.fert;
  let wSum = 0;
  for (let ti = 0; ti < world.N; ti++) {
    if (owner[ti] !== sid || elev[ti] <= 0) continue;
    let w = pf && pf[ti] > 0 ? pf[ti] : (fert && fert[ti] > 0 ? fert[ti] : 1);
    tiles.push(ti);
    weights.push(w);
    wSum += w;
  }
  if (!tiles.length || wSum <= 0) return null;
  return { tiles, weights, wSum };
}

function creditPolityCoin(world, polId, capS, amount) {
  if (!(amount > 0)) return;
  const p = getPolity(world, polId);
  if (!p || p.endedStep >= 0) return;
  p.treasury = (p.treasury || 0) + amount;
  p._revenue = (p._revenue || 0) + amount;
  if (capS) recordOut(capS, OUT_TRIBUTE, amount);
}

function remitInKind(world, polId, inKind) {
  if (!(inKind > 0)) return;
  const p = getPolity(world, polId);
  if (!p || p.endedStep >= 0) return;
  let inflow = inKind;
  if (T.TRIBUTE_UP > 0) {
    const hid = world._overlordOf ? world._overlordOf.get(polId) : undefined;
    if (hid != null && hid >= 0) {
      const hp = getPolity(world, hid);
      if (hp && hp.endedStep < 0) {
        const up = inflow * T.TRIBUTE_UP;
        hp.tribute = (hp.tribute || 0) + up;
        inflow -= up;
      }
    }
  }
  p.tribute = (p.tribute || 0) + inflow;
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
  const pack = territoryTiles(world, seller.id);
  if (!pack) {
    seller.wealth = (seller.wealth || 0) + amount;
    return amount;
  }
  const tw = ensureTileWealth(world);
  let credited = 0;
  for (let i = 0; i < pack.tiles.length; i++) {
    const share = amount * (pack.weights[i] / pack.wSum);
    if (share > 0) {
      const ti = pack.tiles[i];
      tw[ti] = (tw[ti] || 0) + share;
      credited += share;
    }
  }
  seller._tileMoneyIn = (seller._tileMoneyIn || 0) + credited;
  return credited;
}

/**
 * Phase B — land tax in coin + harvest rent on tiles (fisc cadence).
 * In-kind tribute accrues to polity store; coin debits _tileWealth.
 */
export function updateTileFiscalSinks(world, interval) {
  if (!(T.TILE_MONEY > 0)) return;
  const pf = world.popField;
  const bridge = world._onePopScale;
  if (!pf || !(bridge > 0)) return;
  const co = world._countryOwner, lo = world._landOwner, elev = world.elev;
  const terr = world._territoryOwner;
  const byId = world._byId;
  const tw = ensureTileWealth(world);
  const dt = world._dt || 1;
  const ivl = Math.max(1, interval | 0);
  let taxCoin = 0, rentCoin = 0, inKind = 0;

  for (let ti = 0; ti < world.N; ti++) {
    if ((pf[ti] || 0) <= 0 || !elev || elev[ti] <= 0) continue;
    let polId = co ? co[ti] : -1;
    if (polId < 0 && lo) polId = lo[ti];
    if (polId < 0) continue;
    const c = world.countries ? world.countries.get(polId) : null;
    const capS = c ? c.capital : null;
    const terrOid = terr ? terr[ti] : -1;
    const terrS = terrOid >= 0 && byId ? byId.get(terrOid) : null;
    const org = capS?.knowledge?.organization ?? -1;
    const extract = org >= 0 ? EXTRACT_CHIEF + (1 - EXTRACT_CHIEF) * org : EXTRACT_CHIEF;
    const taxDue = pf[ti] * bridge * TRIB_FOOD_PER_POP * TRIBUTE_RATE * extract * dt * ivl;
    const mz = T.MONETIZE > 0 ? monetizationTile(world, ti, capS, terrS) : 1;
    const coinDue = taxDue * mz;
    const kindDue = taxDue * (1 - mz);
    if (coinDue > 0) {
      const paid = Math.min(tw[ti] || 0, coinDue);
      if (paid > 0) {
        tw[ti] -= paid;
        creditPolityCoin(world, polId, capS, paid);
        taxCoin += paid;
      }
    }
    if (kindDue > 0) {
      remitInKind(world, polId, kindDue);
      inKind += kindDue;
    }
  }

  if (T.FARM_RENT > 0 && terr) {
    for (const s of world.settlements) {
      if (s.mode !== "settled" || !(s._landFood > 0)) continue;
      const gov = getPolity(world, s.countryId);
      if (!gov || gov.endedStep >= 0) continue;
      const c = world.countries ? world.countries.get(s.countryId) : null;
      const capS = c ? c.capital : null;
      const taxMul = (gov._taxRate ?? T.TAX_BASE) / T.TAX_BASE;
      const serfMul = T.SERFDOM ? 1 + T.SERF_RENT * (s._serf || 0) : 1;
      const rentTotal = s._landFood * T.FARM_RENT * serfMul * taxMul * ivl;
      const pack = territoryTiles(world, s.id);
      if (!pack) continue;
      for (let i = 0; i < pack.tiles.length; i++) {
        const ti = pack.tiles[i];
        const share = rentTotal * (pack.weights[i] / pack.wSum);
        const mz = T.MONETIZE > 0 ? monetizationTile(world, ti, capS, s) : 1;
        const coinDue = share * mz;
        const kindDue = share * (1 - mz);
        if (coinDue > 0) {
          const paid = Math.min(tw[ti] || 0, coinDue);
          if (paid > 0) {
            tw[ti] -= paid;
            creditPolityCoin(world, s.countryId, capS, paid);
            rentCoin += paid;
          }
        }
        if (kindDue > 0) {
          gov._inKind = (gov._inKind || 0) + kindDue;
          inKind += kindDue;
        }
      }
    }
  }

  world._tileFiscalTax = taxCoin;
  world._tileFiscalRent = rentCoin;
  world._tileFiscalInKind = inKind;
}
