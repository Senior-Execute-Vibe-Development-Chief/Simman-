// ── Per-tile circulating coin (farm-gate payments + rural fiscal sinks) ──
// docs/money-field-2026-08-28.md — Phase A: pay; B: tax+rent; C: salt/iron/tithe/loss.

import { getPolity } from "./entities.js";
import { techEff } from "./settlement.js";
import { recordIn, recordOut, IN_GOODS, IN_PILGRIM, OUT_PILGRIM, OUT_TRIBUTE } from "./money.js";
import { localP } from "./inflation.js";
import { G_MATERIALS, G_METAL } from "./goods.js";
import { IDENTITY_K } from "./identityField.js";
import { T, rNormPop } from "./tuning.js";

const TRIB_FOOD_PER_POP = 0.0030;
const TRIBUTE_RATE = 0.10;
const EXTRACT_CHIEF = 0.3;
const SALT_PER_POP = 0.00015;   // inelastic salt need (scaled like goods-layer per-capita rates)
const IRON_PER_POP = 0.0008;    // tools/fittings — matches goods.js METAL_PC scale
const METALLURGY_GATE = 0.15;   // iron market purchases emerge with smelting knowledge

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

  let saltCoin = 0, ironCoin = 0, faithCoin = 0, lossCoin = 0;
  const deposits = world.deposits;
  const faiths = world.faiths;
  const twGrid = world.tw;
  const rn = rNormPop(world);

  const arriveFromTile = (ti, holy) => {
    if (!(T.PILGRIM_RANGE > 0)) return 1;
    const tx = ti % twGrid, ty = (ti / twGrid) | 0;
    let dx = Math.abs(tx - (holy.pos.x | 0));
    if (dx > twGrid / 2) dx = twGrid - dx;
    const dy = ty - (holy.pos.y | 0);
    const dist = Math.sqrt(dx * dx + dy * dy) / rn;
    return 1 / (1 + dist / T.PILGRIM_RANGE);
  };

  const tileFaithAt = (ti, terrS) => {
    const faiId = world.tileFaithId, faiShr = world.tileFaithShr;
    if (faiId) {
      const base = ti * IDENTITY_K;
      const fid = faiId[base];
      if (fid >= 0) return { fid, share: (faiShr[base] || 0) / 255 };
    }
    if (terrS?.faithMix?.length) return { fid: terrS.faithMix[0][0], share: terrS.faithMix[0][1] };
    return { fid: -1, share: 0 };
  };

  const saltScarcity = (market, ti) => {
    let p = 1;
    if (T.GOODS_PRICES && market._gPrice) p = market._gPrice[G_MATERIALS] || 1;
    else p = localP(world, market);
    const localSalt = (deposits?.salt?.[ti] || 0) + (market.localRes?.salt || 0) * 0.25;
    const cheap = Math.min(1, localSalt * 2);
    return Math.max(0.25, p * (1 - 0.4 * cheap));
  };

  const ironScarcity = (market) => {
    if (T.GOODS_PRICES && market._gPrice) return Math.max(0.25, market._gPrice[G_METAL] || 1);
    return localP(world, market);
  };

  for (let ti = 0; ti < world.N; ti++) {
    if ((pf[ti] || 0) <= 0 || !elev || elev[ti] <= 0) continue;
    const people = pf[ti] * bridge;
    const terrOid = terr ? terr[ti] : -1;
    const terrS = terrOid >= 0 && byId ? byId.get(terrOid) : null;
    if (!terrS || terrS.mode !== "settled") continue;
    const polId = terrS.countryId >= 0 ? terrS.countryId : (co ? co[ti] : -1);
    const c = polId >= 0 && world.countries ? world.countries.get(polId) : null;
    const capS = c ? c.capital : terrS;
    const mz = monetizationTile(world, ti, capS, terrS);
    if (mz <= 0) continue;

    const coinHere = tw[ti] || 0;
    if (coinHere <= 0) continue;

    // Phase C — salt (necessity purchase at the market)
    const saltNeed = people * SALT_PER_POP * localP(world, terrS) * dt * ivl;
    if (saltNeed > 0) {
      const saltDue = saltNeed * saltScarcity(terrS, ti) * mz;
      const paid = Math.min(coinHere, saltDue);
      if (paid > 0) {
        tw[ti] -= paid;
        terrS.wealth = (terrS.wealth || 0) + paid;
        recordIn(terrS, IN_GOODS, paid);
        saltCoin += paid;
      }
    }

    // Phase C — iron/tools (metallurgy-gated)
    const metallurgy = capS?.knowledge?.metallurgy ?? terrS.knowledge?.metallurgy ?? 0;
    if (metallurgy >= METALLURGY_GATE) {
      const ironNeed = people * IRON_PER_POP * dt * ivl * metallurgy;
      const ironDue = ironNeed * ironScarcity(terrS) * mz;
      const paid = Math.min(tw[ti] || 0, ironDue);
      if (paid > 0) {
        tw[ti] -= paid;
        terrS.wealth = (terrS.wealth || 0) + paid;
        recordIn(terrS, IN_GOODS, paid);
        ironCoin += paid;
      }
    }

    // Phase C — faith tithe (rural pilgrimage intensity)
    if (T.PILGRIM_W > 0 && faiths) {
      const { fid, share } = tileFaithAt(ti, terrS);
      if (fid >= 0 && share > 0) {
        const f = faiths.get(fid);
        const origin = f ? (f.originSettlementId ?? -1) : -1;
        if (origin >= 0 && origin !== terrS.id) {
          const holy = byId.get(origin);
          if (holy && holy.mode === "settled") {
            const titheDue = people * TRIB_FOOD_PER_POP * T.PILGRIM_W * share
              * arriveFromTile(ti, holy) * mz * dt * ivl;
            const paid = Math.min(tw[ti] || 0, titheDue);
            if (paid > 0) {
              tw[ti] -= paid;
              recordOut(terrS, OUT_PILGRIM, paid);
              holy.wealth = (holy.wealth || 0) + paid;
              recordIn(holy, IN_PILGRIM, paid);
              faithCoin += paid;
            }
          }
        }
      }
    }
  }

  // Phase C — coin loss on tiles (same rate as settlement specie drain)
  if (T.COIN_LOSS_RATE > 0) {
    const lossMul = T.COIN_LOSS_RATE * dt * ivl;
    for (let ti = 0; ti < world.N; ti++) {
      const w = tw[ti] || 0;
      if (w <= 0) continue;
      const loss = w * lossMul;
      tw[ti] = w - loss;
      lossCoin += loss;
    }
  }

  world._tileFiscalTax = taxCoin;
  world._tileFiscalRent = rentCoin;
  world._tileFiscalInKind = inKind;
  world._tileFiscalSalt = saltCoin;
  world._tileFiscalIron = ironCoin;
  world._tileFiscalFaith = faithCoin;
  world._tileFiscalLoss = lossCoin;
}

/**
 * Phase D — unserved surplus signal for founding pressure.
 * Sums tile coin on populated tiles outside any market catchment, plus piled
 * coin above a local spending cushion on claimed tiles (farm-gate pay with weak sinks).
 * Returns a damped multiplier boost ∈ [0, TILE_COIN_FOUND_CAP] for crystallize.
 */
const TILE_COIN_FOUND_CAP = 2;
const TILE_COIN_REF = 2;   // coin per sim-unit person → +1 mul at reference pile

export function unservedTileCoinInDisk(world, tx, ty, rB) {
  if (!(T.TILE_MONEY > 0) || !world._tileWealth || !world.popField) return 0;
  const tw = world._tileWealth, pf = world.popField, to = world._territoryOwner;
  const bridge = world._onePopScale || 0;
  const gridW = world.tw, th = world.th;
  let coin = 0;
  for (let dy = -rB; dy <= rB; dy++) {
    const yy = ty + dy; if (yy < 0 || yy >= th) continue;
    for (let dx = -rB; dx <= rB; dx++) {
      if (dx * dx + dy * dy > rB * rB) continue;
      const ti = yy * gridW + (((tx + dx) % gridW) + gridW) % gridW;
      if ((pf[ti] || 0) <= 0) continue;
      const ppl = pf[ti] * (bridge > 0 ? bridge : 1);
      const c = tw[ti] || 0;
      if (c <= 0) continue;
      if (!to || to[ti] < 0) coin += c;
      else {
        const reserve = 30 + ppl * 0.3;
        if (c > reserve) coin += c - reserve;
      }
    }
  }
  return coin;
}

export function unservedTileCoinPull(world, tx, ty, rB) {
  const coin = unservedTileCoinInDisk(world, tx, ty, rB);
  if (coin <= 0) return 0;
  const pf = world.popField, bridge = world._onePopScale || 0;
  const gridW = world.tw, th = world.th;
  let people = 0;
  for (let dy = -rB; dy <= rB; dy++) {
    const yy = ty + dy; if (yy < 0 || yy >= th) continue;
    for (let dx = -rB; dx <= rB; dx++) {
      if (dx * dx + dy * dy > rB * rB) continue;
      const ti = yy * gridW + (((tx + dx) % gridW) + gridW) % gridW;
      if ((pf[ti] || 0) > 0) people += pf[ti] * (bridge > 0 ? bridge : 1);
    }
  }
  if (people <= 0) return 0;
  const perCap = coin / people;
  return Math.min(TILE_COIN_FOUND_CAP, perCap / TILE_COIN_REF);
}

/** Planet total unserved tile coin (measurement). */
export function sumUnservedTileCoin(world) {
  if (!(T.TILE_MONEY > 0) || !world._tileWealth || !world.popField) return 0;
  const tw = world._tileWealth, pf = world.popField, to = world._territoryOwner;
  const bridge = world._onePopScale || 0;
  let coin = 0;
  for (let ti = 0; ti < world.N; ti++) {
    if ((pf[ti] || 0) <= 0) continue;
    const ppl = pf[ti] * (bridge > 0 ? bridge : 1);
    const c = tw[ti] || 0;
    if (c <= 0) continue;
    if (!to || to[ti] < 0) coin += c;
    else {
      const reserve = 30 + ppl * 0.3;
      if (c > reserve) coin += c - reserve;
    }
  }
  return coin;
}
