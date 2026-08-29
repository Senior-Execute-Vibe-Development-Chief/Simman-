// ── Farm-gate compulsion (Mode C) ─────────────────────────────────────
// docs/food-system-design-2026-08-27.md §1.1 — grain moves because someone
// TOOK it, not because someone PAID. Under T.MARKET_PULL the bid assigns
// tiles; compulsion OVERRIDES the bid where authority holds a claim.
//
// Priority (strongest first):
//   1. Overlord — tributary province → suzerain capital market (Rome/Egypt)
//   2. Landlord — nearest settlement in the tile's political country (local
//      land right beats a distant same-realm bidder)
//   3. Liege — walk child → liege chain to the realm seat (central place)
//
// Enforcement is emergent: foodReach (organization) gates every claim; never
// step, year, or era. Requires T.MARKET_PULL + T.COMPEL.

import { foodReach } from "./settlement.js";
import { T } from "./tuning.js";

function canCompel(s) {
  return s && s.mode === "settled" && foodReach(s) > 0;
}

function tileXY(ti, tw) {
  const y = (ti / tw) | 0;
  return { x: ti - y * tw, y };
}

function dist2(tx, ty, sx, sy, tw) {
  let dx = Math.abs(tx - sx);
  if (dx > tw / 2) dx = tw - dx;
  const dy = ty - sy;
  return dx * dx + dy * dy;
}

/** Nearest settled member of country `cid` to tile ti. */
function nearestInCountry(ti, cid, byCountry, tw) {
  const members = byCountry.get(cid);
  if (!members || !members.length) return -1;
  const { x: tx, y: ty } = tileXY(ti, tw);
  let best = -1, bestD = Infinity;
  for (const s of members) {
    const d2 = dist2(tx, ty, s.pos.x | 0, s.pos.y | 0, tw);
    if (d2 < bestD) { bestD = d2; best = s.id; }
  }
  return best;
}

/** Suzerain capital market for a tile governed by country `tileCountry`. */
function overlordMarket(world, tileCountry) {
  const ov = world._overlordOf ? world._overlordOf.get(tileCountry) : undefined;
  if (ov == null || ov < 0) return -1;
  const oc = world.countries ? world.countries.get(ov) : null;
  const cap = oc && oc.capital;
  return canCompel(cap) ? cap.id : -1;
}

/** Liege one step up, same country, if administration can levy. */
function liegeStep(s, byId) {
  if (!s || s.liegeId < 0) return -1;
  const L = byId.get(s.liegeId);
  if (!L || L.mode !== "settled" || L.countryId !== s.countryId) return -1;
  return canCompel(L) ? L.id : -1;
}

/** Approximate haul cost for foodFalloff after a compulsion reassignment. */
function approxHaulCost(world, sid, ti, byId) {
  const s = byId.get(sid);
  if (!s) return Infinity;
  const tw = world.tw;
  const { x: tx, y: ty } = tileXY(ti, tw);
  const d2 = dist2(tx, ty, s.pos.x | 0, s.pos.y | 0, tw);
  return Math.sqrt(d2) * 1.0;
}

/**
 * Post-pass on territory assignment: compulsion claims outrank the bid.
 * Mutates owner[] and tcost[] for compelled tiles; returns count changed.
 */
export function applyFarmGateCompulsion(world, owner, tcost, byId) {
  if (!(T.MARKET_PULL > 0) || !(T.COMPEL > 0)) return 0;

  const { tw, N, elev } = world;
  const co = world._countryOwner;
  if (!co || co.length !== N) return 0;

  const byCountry = new Map();
  for (const s of byId.values()) {
    if (s.countryId < 0) continue;
    let a = byCountry.get(s.countryId);
    if (!a) byCountry.set(s.countryId, a = []);
    a.push(s);
  }

  let changed = 0;
  for (let ti = 0; ti < N; ti++) {
    if (elev[ti] <= 0) continue;
    const bidOid = owner[ti];
    if (bidOid < 0) continue;

    const polCountry = co[ti];
    let oid = bidOid;
    let compelled = false;

    // 1 — Overlord: provincial grain to the suzerain capital (cross-border)
    if (polCountry >= 0) {
      const ovSid = overlordMarket(world, polCountry);
      if (ovSid >= 0) { oid = ovSid; compelled = true; }
    }

    // 2 — Landlord: local land right within the political country
    if (!compelled && polCountry >= 0) {
      const localSid = nearestInCountry(ti, polCountry, byCountry, tw);
      if (localSid >= 0 && canCompel(byId.get(localSid))) oid = localSid;
    }

    // 3 — Liege chain: child hinterland feeds the administrative hierarchy
    let s = byId.get(oid);
    for (let guard = 0; guard < 8 && s; guard++) {
      const lid = liegeStep(s, byId);
      if (lid < 0) break;
      oid = lid;
      s = byId.get(oid);
    }

    if (oid !== bidOid) {
      owner[ti] = oid;
      tcost[ti] = approxHaulCost(world, oid, ti, byId);
      changed++;
    }
  }
  return changed;
}
