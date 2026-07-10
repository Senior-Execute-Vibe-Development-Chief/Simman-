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
// Under T.SLAVE_PEOPLE (default) that conservation is DEMOGRAPHIC, not just a ledger
// claim: bought captives join the buyer's s.people carrying their origin peoples,
// stocks and tongues (settlement.js arriveCaptives), so forced migration reshapes the
// destination's population the way it did the plantation Americas. Lever off = the
// legacy accounting (victims depopulate; buyers gain only the _unfree workforce stat).

import { forEachNear } from "./spatialGrid.js";
import { settlementPower } from "./conquest.js";
import { recordIn, recordOut, IN_SLAVE_TRADE, OUT_SLAVE } from "./money.js";
import { getWealthReserve, recordCaptives, drainCaptivePools, arriveCaptives } from "./settlement.js";
import { T } from "./tuning.js";

export const SLAVE_INTERVAL = 50;     // ticks between slave-trade passes (slow flow)
const RAID_RANGE     = 28;            // tiles a slaver's raiding parties reach
const RAID_DOMINANCE = 2.0;           // how much stronger a raider must be than its victim
const SLAVE_PRICE    = 8;             // coin per captive on the market (calibration)

export function updateSlaveTrade(world) {
  if (!T.SLAVERY) return;
  const setts = world.settlements;

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
        // per-PASS rate, no ×dt: the pass interval is already G-stretched (index.js
        // _ivl), so scaling by dt again halved/quartered raiding per unit of history
        const grab = Math.min((v.people || 0) * T.SLAVE_RAID, (v.people || 0) * 0.5);
        if (grab < 1) return;
        recordCaptives(r, v, grab);                                    // the captives carry who they ARE (SLAVE_PEOPLE)
        v.people -= grab; took += grab;                                // the victim region bleeds
      });
      if (took > 0) r._captives = (r._captives || 0) + took;   // (a raider becoming a notable slaver is announced once, in chronicle.js)
    }
  }

  // ── Phase B: THE MARKET (long-distance, but along the trade network) ──────────
  // Under SLAVE_PEOPLE clearing runs PER TRADE COMPONENT (world._networkComponents —
  // the same connected road+sea graph the price level integrates over): a buyer can
  // only be supplied from sellers its merchants can actually reach. Pre-navigation
  // worlds run many small regional markets; as the components merge (roads, then
  // ocean shipping) they integrate into the great long-distance systems — the
  // Atlantic and Indian-Ocean trades emerge from CONNECTIVITY, never from an era —
  // and each system pools its own regional origins. (The old single GLOBAL pool was
  // a tolerable simplification for a labour stat, but once captives became PEOPLE it
  // teleported population between unconnected continents.) Lever off: one global
  // market, exactly the legacy clearing.
  const comps = world._networkComponents;
  const marketKey = T.SLAVE_PEOPLE
    ? (s) => (comps && comps.has(s.id)) ? comps.get(s.id) : s.id
    : () => 0;
  const markets = new Map();   // key → { sellers, buyers, supply, demand }
  const marketOf = (key) => { let m = markets.get(key); if (!m) markets.set(key, m = { sellers: [], buyers: [], supply: 0, demand: 0 }); return m; };
  for (const s of setts) {
    const c = s._captives || 0;
    if (c > 0.5) { const m = marketOf(marketKey(s)); m.sellers.push(s); m.supply += c; }
  }
  if (!markets.size) return;
  for (const s of setts) {
    if (s.mode !== "settled") continue;
    const want = s._slaveDemand || 0;
    if (want <= 0.5) continue;
    const key = marketKey(s);
    if (!markets.has(key)) continue;                       // no reachable supply — demand goes unmet
    const spare = Math.max(0, (s.wealth || 0) - getWealthReserve(s));
    const buy = Math.min(want, spare / SLAVE_PRICE);
    if (buy > 0.5) { const m = markets.get(key); m.buyers.push([s, buy]); m.demand += buy; }
  }
  for (const { sellers, buyers, supply, demand } of markets.values()) {
    if (supply <= 0.5 || demand <= 0.5) continue;
    const traded = Math.min(supply, demand);
    // Pooled ORIGIN of this market's human cargo (SLAVE_PEOPLE): every seller ships in
    // proportion to its stock, so the mixture is the stock-weighted union of the
    // component's captive pools — mixed-origin cargoes, regionally coherent.
    let poolCul = null, poolAnc = null;
    if (T.SLAVE_PEOPLE) {
      poolCul = []; poolAnc = [];
      const addPool = (pool, id, n) => {
        let e = null; for (const p of pool) if (p[0] === id) { e = p; break; }
        if (e) e[1] += n; else pool.push([id, n]);
      };
      for (const s of sellers) {
        const w = (s._captives || 0) / supply;
        if (s._captiveCul) for (const [id, n] of s._captiveCul) if (id >= 0 && n > 0) addPool(poolCul, id, n * w);
        if (s._captiveAnc) for (const [id, n] of s._captiveAnc) if (id >= 0 && n > 0) addPool(poolAnc, id, n * w);
      }
    }
    // Buyers receive captives in proportion to demand and pay the price; the captives
    // become their unfree workforce — and, under SLAVE_PEOPLE, their resident PEOPLE,
    // admixing the buyer's culture/ancestry/language layers on arrival.
    for (const [s, buy] of buyers) {
      const got = traded * (buy / demand);
      if (got <= 0) continue;
      s.wealth = (s.wealth || 0) - got * SLAVE_PRICE; recordOut(s, OUT_SLAVE, got * SLAVE_PRICE);
      s._unfree = (s._unfree || 0) + got;
      arriveCaptives(world, s, got, poolCul, poolAnc);
    }
    // Sellers ship in proportion to their stock and earn the price.
    for (const s of sellers) {
      const stock = s._captives || 0;
      const shipped = traded * (stock / supply);
      if (shipped <= 0) continue;
      s._captives = Math.max(0, stock - shipped);
      drainCaptivePools(s, shipped, stock);
      s.wealth = (s.wealth || 0) + shipped * SLAVE_PRICE; recordIn(s, IN_SLAVE_TRADE, shipped * SLAVE_PRICE);
    }
  }
}
