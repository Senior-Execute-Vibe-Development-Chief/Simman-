// ── The slave trade: capture → slaver → market (coerced-labour, step 2) ──────
// Step 1 (settlement.js updateCoercedLabour) seeded the unfree workforce abstractly.
// This replaces that with a real supply chain:
//   • RAID    — strong settlements seize people from weaker FOREIGN neighbours (the
//               razzia that fed the Crimean / trans-Saharan / Atlantic trades); the
//               victims depopulate, the raider holds the captives to sell.
//   • MARKET  — captives clear against coerced-labour DEMAND; they become the BUYER's
//               unfree workforce, coin flows back to the sellers. The slaver/middleman
//               (Dahomey, the Aro, Crimea) profits by selling people it never works.
// Conserved: people are moved (victim → captive → the buyer's unfree), coin is moved
// (buyer → seller). Nothing minted. Emergent — gated on military power, wealth and
// labour demand, never on era.

import { forEachNear } from "./spatialGrid.js";
import { settlementPower } from "./conquest.js";
import { recordIn, recordOut, IN_SLAVE_TRADE, OUT_SLAVE } from "./money.js";
import { getWealthReserve } from "./settlement.js";
import { T } from "./tuning.js";
import { logEvent } from "./events.js";

export const SLAVE_INTERVAL = 50;     // ticks between slave-trade passes (slow flow)
const RAID_RANGE     = 28;            // tiles a slaver's raiding parties reach
const RAID_DOMINANCE = 2.0;           // how much stronger a raider must be than its victim
const SLAVE_PRICE    = 8;             // coin per captive on the market (calibration)

export function updateSlaveTrade(world) {
  if (!T.SLAVERY) return;
  const setts = world.settlements;
  const dt = world._dt || 1;

  // ── Phase A: SLAVE-RAIDING ──────────────────────────────────────────────────
  if (T.SLAVE_RAID > 0) {
    for (const r of setts) {
      if (r.mode !== "settled") continue;
      const rPow = settlementPower(r);
      if (rPow <= 1) continue;
      let took = 0;
      forEachNear(world, r.pos.x, r.pos.y, RAID_RANGE, (v) => {
        if (v === r || v.mode !== "settled") return;
        if (v.countryId === r.countryId && r.countryId >= 0) return;   // raid OUTSIDERS, not your own
        if (rPow < settlementPower(v) * RAID_DOMINANCE) return;        // only the clearly weaker
        const grab = Math.min((v.people || 0) * T.SLAVE_RAID * dt, (v.people || 0) * 0.5);
        if (grab < 1) return;
        v.people -= grab; took += grab;                                // the victim region bleeds
      });
      if (took > 0) {
        r._captives = (r._captives || 0) + took;
        logEvent(world, "slave.raid", { s: r.id, sName: r.name || "a raider", n: Math.round(took) });
      }
    }
  }

  // ── Phase B: THE MARKET (global clearing — the slave trade was long-distance) ──
  let supply = 0;
  const sellers = [];
  for (const s of setts) { const c = s._captives || 0; if (c > 0.5) { sellers.push(s); supply += c; } }
  if (supply <= 0.5) return;
  let demandUnits = 0;
  const buyers = [];
  for (const s of setts) {
    if (s.mode !== "settled") continue;
    const want = s._slaveDemand || 0;
    if (want <= 0.5) continue;
    const spare = Math.max(0, (s.wealth || 0) - getWealthReserve(s));
    const buy = Math.min(want, spare / SLAVE_PRICE);
    if (buy > 0.5) { buyers.push([s, buy]); demandUnits += buy; }
  }
  if (demandUnits <= 0.5) return;
  const traded = Math.min(supply, demandUnits);
  // Buyers receive captives in proportion to demand and pay the price; the captives
  // become their unfree workforce.
  for (const [s, buy] of buyers) {
    const got = traded * (buy / demandUnits);
    if (got <= 0) continue;
    s.wealth = (s.wealth || 0) - got * SLAVE_PRICE; recordOut(s, OUT_SLAVE, got * SLAVE_PRICE);
    s._unfree = (s._unfree || 0) + got;
  }
  // Sellers ship in proportion to their stock and earn the price.
  for (const s of sellers) {
    const shipped = traded * ((s._captives || 0) / supply);
    if (shipped <= 0) continue;
    s._captives = Math.max(0, (s._captives || 0) - shipped);
    s.wealth = (s.wealth || 0) + shipped * SLAVE_PRICE; recordIn(s, IN_SLAVE_TRADE, shipped * SLAVE_PRICE);
  }
}
