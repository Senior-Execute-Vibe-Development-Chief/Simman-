// ── The slave trade: capture → slaver → market (coerced-labour, step 2) ──────
// Step 1 (settlement.js updateCoercedLabour) seeded the unfree workforce abstractly.
// This replaces that with a real supply chain:
//   • RAID    — strong settlements seize people from weaker FOREIGN neighbours (the
//               razzia that fed the Crimean / trans-Saharan / Atlantic trades); the
//               victims depopulate, the raider holds the captives to sell.
//   • MARKET  — captives clear against coerced-labour DEMAND; they become the BUYER's
//               unfree workforce, coin flows back to the sellers. The slaver/middleman
//               (Dahomey, the Aro, Crimea) profits by selling people it never works.
//               Under T.SLAVE_FREIGHT (default) the clearing is DISTANCE-PRICED over
//               the trade network through roads.js sellGoods — the cargo pays the
//               same freight/toll/entrepôt/tariff family every other consignment
//               pays, matched greedily nearest-first, unsold stock staying home
//               (clearDistancePriced below; lever 0 = the legacy pooled clearing).
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
import { recordInMetered, recordOutMetered, IN_SLAVE_TRADE, OUT_SLAVE } from "./money.js";
import { getWealthReserve, recordCaptives, drainCaptivePools, arriveCaptives } from "./settlement.js";
import { feedGrievance } from "./loyaltyField.js";
import { fieldShift } from "./popField.js";
import { T, rNormPop } from "./tuning.js";
import { mergeReach, sellGoods, TRANSPORT_PER_PATHCOST, TOLL_RATE, TOLL_CHOKE_W, GT_BULK, entrepotShare, MinHeap } from "./roads.js";
import { G_LUXURY } from "./goods.js";

export const SLAVE_INTERVAL = 50;     // ticks between slave-trade passes (slow flow)
const RAID_RANGE     = 28;            // tiles a slaver's raiding parties reach
const RAID_DOMINANCE = 2.0;           // how much stronger a raider must be than its victim
const SLAVE_PRICE    = 8;             // coin per captive on the market (calibration)
const PULL_CAP       = 3;             // ceiling on the scarcity multiple: price/raid intensity saturates at 1+PULL_CAP×SLAVE_PULL. HONESTY NOTE: this caps only the market SIGNAL — nothing bounds raid capacity itself (no reach/logistics/army limit on how many victims one raider works per pass); razzia costs remain a known gap. (Distance-priced clearing is BUILT: T.SLAVE_FREIGHT below.)

// The EFFECTIVE pass interval — index.js fires updateSlaveTrade every
// _ivl(SLAVE_INTERVAL) ticks (G-stretched, same formula). The metered income
// bookings below spread each pass's take over exactly the span it was earned in.
const passIvl = () => Math.max(1, Math.round(SLAVE_INTERVAL * Math.max(1, T.SIM_GRANULARITY || 1)));

// A settlement's slave-market: its trade-network component (SLAVE_PEOPLE), else the
// single global pool — the same key phase B clears against.
function marketKeyOf(world, s) {
  if (!T.SLAVE_PEOPLE) return 0;
  const comps = world._networkComponents;
  return (comps && comps.has(s.id)) ? comps.get(s.id) : s.id;
}

// ── The market signal (T.SLAVE_PULL): ONE scarcity index drives price & effort ──
// Per trade component, r = cash-backed demand / captive stocks. From it:
//   PRICE  ×(1 + PULL×min(cap, r−1))  when starved; ×(1 − PULL×min(0.5, 1−r)) in glut
//          — a starved market pays dear (rationing its own demand: the rich estate
//          outbids the marginal buyer), a post-conquest glut dumps prices (Aemilius
//          Paulus crashing the Delos market).
//   EFFORT raiding intensity and (√, armies.js) wartime enslavement ride the same
//          multiple — the razzia follows the price (Dahomey raided BECAUSE the coast
//          paid; a glutted market isn't worth the risk of a raid).
// The feedback closes itself: scarcity → price↑ → effective demand rationed AND
// supply effort↑ → stocks recover → the signal dies. Derived per step from persisted
// state (posted demand, wealth, captive stocks) plus ONE per-pass transient — the
// lagged clearing-price map (world._slaveLastPrice) the index backs cash demand
// with. Like war fronts / trade reach, it re-warms on its own cadence after a
// load (one pass at the base-price prior), so it needs no save wiring.
// SLAVE_PULL=0 → multiplier ≡ 1: the legacy fixed-price, fixed-rate trade, byte-identical.
function buildScarcity(world) {
  const want = new Map(), stock = new Map();
  const lastP = world._slaveLastPrice;   // key → the price the last clearing pass actually charged
  for (const s of world.settlements) {
    const c = s._captives || 0;
    let k;
    if (c > 0.5) { k = marketKeyOf(world, s); stock.set(k, (stock.get(k) || 0) + c); }
    if (s.mode !== "settled" || (s._slaveDemand || 0) <= 0.5) continue;
    if (k === undefined) k = marketKeyOf(world, s);
    const spare = Math.max(0, (s.wealth || 0) - getWealthReserve(s));
    // Back cash demand at the market's own LAGGED CLEARING price, not the base
    // price: the clearing pass charges spare/m.price (marked up to 4× base when
    // starved), so backing the index with spare/SLAVE_PRICE counted up to 4×
    // more cash-backed demand than the market can absorb at the price it
    // actually charges — a self-sustaining pin at the multiplier cap (measured:
    // marketMul=4 permanently). One pass of lag is the standard cobweb form —
    // buyers budget against the price they last saw. The cobweb is damped but
    // can ring for several passes near the interior fixed point (|slope| ≈
    // PULL·r/p² approaches 1 in a moderately starved market); a genuinely
    // starved market sits stably at the cap, which is honest scarcity. A
    // market that has never cleared (or whose component id changed on a
    // network merge) starts at the base price.
    const p = (lastP && lastP.get(k)) || SLAVE_PRICE;
    const eff = Math.min(s._slaveDemand, spare / p);   // demand backed by coin, the only kind a raider gets paid for
    if (eff > 0.5) want.set(k, (want.get(k) || 0) + eff);
  }
  const r = new Map();
  for (const [k, w] of want) r.set(k, w / Math.max(1, stock.get(k) || 0));
  world._slaveScarcity = r;
}
function marketMulOf(world, key) {
  if (!T.SLAVERY || T.SLAVE_PULL <= 0) return 1;
  if (world._slaveScarcityStep !== world.step) { buildScarcity(world); world._slaveScarcityStep = world.step; }
  const r = world._slaveScarcity.get(key);
  if (r === undefined) return 1;   // no cash demand here — base price, base razzia
  return 1 + T.SLAVE_PULL * (Math.min(PULL_CAP, Math.max(0, r - 1)) - Math.min(0.5, Math.max(0, 1 - r)));
}
// The market multiplier at a settlement's own component (raiders raid FOR their
// market; the sack-capture site in armies.js reads it too).
export function slavePull(world, s) {
  if (!T.SLAVERY || T.SLAVE_PULL <= 0) return 1;
  return marketMulOf(world, marketKeyOf(world, s));
}

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
      forEachNear(world, r.pos.x, r.pos.y, RAID_RANGE * rNormPop(world), (v) => {
        if (v === r || v.mode !== "settled") return;
        if (v.countryId === r.countryId && r.countryId >= 0) return;   // raid OUTSIDERS, not your own
        // The razzia preys on the STATELESS frontier: a town under a crown is a hard
        // target (walls, garrisons, retaliation — protection is what states are FOR),
        // so it takes a far greater edge to raid one. This is where the Roman and
        // Atlantic supplies actually came from — barbaricum and the decentralized
        // zones, not rival states' town belts (measured: without this margin the
        // demand-driven razzia bled the world's mid-tier towns and its city system
        // collapsed, 31→4 cities). Rides SLAVE_PULL — the legacy base-rate razzia
        // barely moved this margin — for byte-identical off.
        const guard = (T.SLAVE_PULL > 0 && v.countryId >= 0) ? 3 : 1;
        if (rPow < settlementPower(v) * RAID_DOMINANCE * guard) return;   // only the clearly weaker
        // per-PASS rate, no ×dt: the pass interval is already G-stretched (index.js
        // _ivl), so scaling by dt again halved/quartered raiding per unit of history.
        // × slavePull: the raider works for ITS market — the razzia follows the PRICE
        // (harder when the market is starved, slack when it's glutted; header above).
        const grab = Math.min((v.people || 0) * T.SLAVE_RAID * slavePull(world, r), (v.people || 0) * 0.5);
        if (grab < 1) return;
        recordCaptives(r, v, grab);                                    // the captives carry who they ARE (SLAVE_PEOPLE)
        v.people -= grab; took += grab;                                // the victim region bleeds
        fieldShift(world, v, -grab);                                   // one population: the razzia empties the LAND (FIELD_DEMOG)
        // GRIEV_LEDGER: a razzia on a CROWNED town is a national wound the
        // victim's realm remembers against the raider's (the stateless
        // frontier has no court to keep the ledger).
        feedGrievance(world, v.countryId, r.countryId, grab);
      });
      if (took > 0) r._captives = (r._captives || 0) + took;   // (a raider becoming a notable slaver is announced once, in chronicle.js)
    }
  }

  // ── Phase B: THE MARKET ─────────────────────────────────────────────────────
  // T.SLAVE_FREIGHT (default): distance-priced clearing over the trade network —
  // captives pay the road like every other consignment. Lever 0: the legacy
  // pooled per-component clearing below, byte-identical.
  if (T.SLAVE_FREIGHT > 0) { clearDistancePriced(world, setts); return; }

  // ── LEGACY pooled clearing (T.SLAVE_FREIGHT=0) ──────────────────────────────
  // Under SLAVE_PEOPLE clearing runs PER TRADE COMPONENT (world._networkComponents —
  // the same connected road+sea graph the price level integrates over): a buyer can
  // only be supplied from sellers its merchants can actually reach. Pre-navigation
  // worlds run many small regional markets; as the components merge (roads, then
  // ocean shipping) they integrate into the great long-distance systems — the
  // Atlantic and Indian-Ocean trades emerge from CONNECTIVITY, never from an era —
  // and each system pools its own regional origins. (The old single GLOBAL pool was
  // a tolerable simplification for a labour stat, but once captives became PEOPLE it
  // teleported population between unconnected continents.) SLAVE_PEOPLE off: one
  // global market, exactly the original clearing. KNOWN RESIDUAL this pooled form
  // carries (diagnosis §3, [I13]): one frictionless clearing per component — every
  // seller paid the same price regardless of distance to any buyer, the only trade
  // in the sim exempt from freight/tolls/tariffs. That is what SLAVE_FREIGHT fixes.
  const marketKey = (s) => marketKeyOf(world, s);
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
    const m = markets.get(key);
    if (m.price === undefined) m.price = SLAVE_PRICE * marketMulOf(world, key);   // this component's scarcity price (see header)
    const spare = Math.max(0, (s.wealth || 0) - getWealthReserve(s));
    const buy = Math.min(want, spare / m.price);           // a dear market rations its own demand
    if (buy > 0.5) { m.buyers.push([s, buy]); m.demand += buy; }
  }
  // Remember what each market charged: the NEXT pass's scarcity index backs
  // cash demand at this price (buildScarcity above). Rebuilt whole each pass —
  // a component key that stops quoting (demand died, network re-merged) simply
  // falls back to the base price, the honest no-information prior. Replaced
  // only AFTER the quoting loop, so the lazy buildScarcity trigger inside
  // marketMulOf still reads the PREVIOUS pass's prices.
  {
    const lastP = new Map();
    for (const [key, m] of markets) if (m.price !== undefined) lastP.set(key, m.price);
    world._slaveLastPrice = lastP;
  }
  for (const { sellers, buyers, supply, demand, price = SLAVE_PRICE } of markets.values()) {
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
    // Income/spend PROVENANCE is metered over the pass interval (money.js
    // recordInMetered): the coin moves now, but a 50-tick pass booked into a
    // ~20-tick display EMA read up to 2.5× the true rate right after each
    // pass — while ordinary trade books every few ticks. Same totals, honest rate.
    const ivl = passIvl();
    for (const [s, buy] of buyers) {
      const got = traded * (buy / demand);
      if (got <= 0) continue;
      s.wealth = (s.wealth || 0) - got * price; recordOutMetered(s, OUT_SLAVE, got * price, ivl);
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
      s.wealth = (s.wealth || 0) + shipped * price; recordInMetered(s, IN_SLAVE_TRADE, shipped * price, ivl);
    }
  }
}

// ── Distance-priced clearing (T.SLAVE_FREIGHT) — the market pays the road ────
// The pooled clearing above was the last frictionless trade in the sim ([I13]):
// every seller in a component earned the same price whether the buyer was the
// next valley or the far shore, while every crate of cloth pays freight, tolls,
// entrepôt brokerage and tariffs. Here captives clear PAIRWISE over the actual
// trade graph — the merged road+sea reach links every goods consignment already
// travels — through roads.js sellGoods itself, so a human cargo pays exactly
// the friction family of goods ([D9]): freight per accumulated path cost at the
// captive's value density (the silk class — the highest value-to-weight cargo
// there was: GT_BULK[G_LUXURY], people walk themselves), a toll to every relay
// town and on-path settlement (the coffle passes the same gates the caravan
// does — coastal middlemen and caravanserai towns lived on precisely this), the
// entrepôt margin of the great marts, and the buyer's realm's import duty.
//
// Matching is GREEDY NEAREST-FIRST by network transport cost (deterministic
// tiebreak on ids): the near buyer clears the near stock first — a seller far
// from any demand keeps its captives in stock (unsold, awaiting a market, worked
// locally next pass, or never moved at all). Nothing here targets an outcome:
// the expected localization — slave income concentrating at markets near the
// plantation/mine/estate belts and fading with network distance — is whatever
// these ordinary costs imply.
//
// The PRICE is still the destination market's scarcity price (the Tier-A
// T.SLAVE_PULL loop, marketMulOf, unchanged): buyers bid their component's
// price, the lagged-price map keeps backing next pass's demand index, and the
// friction rides ON TOP through sellGoods exactly as for goods (the buyer pays
// carriage and dues; relay towns collect; the seller's sale books
// IN_SLAVE_TRADE, its carriage fee books as shipping income — same ledger,
// metered over the pass interval per the Tier-A honest-rate contract).
//
// Search bound (no new constants): a route dies where its own friction kills
// the trade — expansion stops when accumulated ad-valorem dues reach the whole
// cargo value (tolls alone retire a route within a handful of relay towns:
// every graph hop IS a settlement) or when carriage alone would exceed the
// seller's entire stock at the dearest price any market can quote (the
// PULL_CAP saturation) — the sellGoods ship-worthiness inequality applied as
// a search horizon. An isolated continent cannot buy captives until someone
// builds the sea lane; when the lanes exist, the long-distance system EMERGES
// from connectivity, never from an era.
function clearDistancePriced(world, setts) {
  const ivl = passIvl();
  const byId = world._byId;
  const sellers = [];
  const wantLeft = new Map();   // buyerId → residual demand this pass
  for (const s of setts) {
    if (s.mode !== "settled") continue;
    if ((s._captives || 0) > 0.5) sellers.push(s);
    if ((s._slaveDemand || 0) > 0.5) wantLeft.set(s.id, s._slaveDemand);
  }
  if (!sellers.length || !wantLeft.size) { world._slaveLastPrice = new Map(); return; }

  // The settlement graph: undirected adjacency over each settlement's merged
  // road+sea reach (the SAME links, costs and on-path intermediates the goods
  // trade walks), cheapest parallel edge kept. Reach maps are nearest-K and
  // asymmetric; folding both directions restores the mutual mesh.
  const adj = new Map();   // id → [{to, link}]
  const addEdge = (a, b, link) => {
    let l = adj.get(a);
    if (!l) adj.set(a, l = []);
    for (const e of l) if (e.to === b) { if (link.cost < e.link.cost) e.link = link; return; }
    l.push({ to: b, link });
  };
  for (const s of setts) {
    if (s.mode !== "settled") continue;
    const reach = mergeReach(s);
    if (!reach || reach.size === 0) continue;
    for (const [pid, link] of reach) {
      const p = byId ? byId.get(pid) : null;
      if (!p || p.mode !== "settled") continue;
      addEdge(s.id, pid, link);
      addEdge(pid, s.id, link);
    }
  }

  // Per-value friction of passing THROUGH a settlement — the sellGoods rates
  // verbatim (transit toll incl. the chokepoint term + entrepôt brokerage).
  const thruFrac = (x) => TOLL_RATE * (1 + TOLL_CHOKE_W * Math.min(1, x.waterAccess || 0))
                        + T.ENTREPOT_W * entrepotShare(x);
  // Freight for one pass-consignment over pathCost: the same per-route rate a
  // goods pair pays over the same span of trade (runGeneralTradeBetween), at
  // the captive cargo's value density (GT_BULK silk class under GOODS_FREIGHT).
  const bulkMul = T.GOODS_FREIGHT > 0 ? 1 + T.GOODS_FREIGHT * (GT_BULK[G_LUXURY] - 1) : 1;
  const rn = rNormPop(world);
  const freightOf = (pathCost) => pathCost / rn * TRANSPORT_PER_PATHCOST * ivl * bulkMul;
  // Dearest price any market can quote (the PULL_CAP saturation) — an upper
  // bound used only to stop searching where carriage can never be paid.
  const priceCap = SLAVE_PRICE * (1 + Math.max(0, T.SLAVE_PULL || 0) * PULL_CAP);

  // From each seller, walk the network outward (Dijkstra by accumulated link
  // cost) collecting every reachable posted demand until friction forecloses.
  const cands = [];
  for (const seller of sellers) {
    if (!adj.has(seller.id)) continue;   // no market reach: the stock stays home
    const stockVal = (seller._captives || 0) * priceCap;
    const dist = new Map(), tfrac = new Map(), prev = new Map(), prevLink = new Map();
    const routes = { prev, prevLink, byId };
    const heap = new MinHeap();
    dist.set(seller.id, 0); tfrac.set(seller.id, 0);
    heap.push(seller.id, 0);
    while (heap.n > 0) {
      const { ti: id, d } = heap.popMin();
      if (d > (dist.get(id) ?? Infinity)) continue;   // stale heap entry
      const isSrc = id === seller.id;
      const here = isSrc ? seller : (byId ? byId.get(id) : null);
      if (!here) continue;
      if (!isSrc && wantLeft.has(id)) cands.push({ cost: d, seller, buyer: here, routes });
      const out = adj.get(id);
      if (!out) continue;
      // Passing THROUGH `here` adds its dues to everything beyond (endpoints
      // charge nothing — the intermediatesOnPath rule); each hop's own on-path
      // settlements charge theirs.
      const thru = isSrc ? 0 : thruFrac(here);
      const tf = tfrac.get(id) || 0;
      for (const e of out) {
        let hopFrac = thru;
        const li = e.link.inter;
        if (li) for (const x of li) if (x.mode === "settled" && x.id !== seller.id) hopFrac += thruFrac(x);
        const nf = tf + hopFrac;
        if (nf >= 1) continue;                       // dues ≥ the whole cargo value: dead route
        const nd = d + e.link.cost;
        if (freightOf(nd) >= stockVal) continue;     // carriage alone exceeds the stock's dearest value
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd); tfrac.set(e.to, nf);
          prev.set(e.to, id); prevLink.set(e.to, e.link);
          heap.push(e.to, nd);
        }
      }
    }
  }
  if (!cands.length) { world._slaveLastPrice = new Map(); return; }

  // Nearest-first, deterministic: transport cost, then seller id, then buyer id.
  cands.sort((a, b) => a.cost - b.cost || a.seller.id - b.seller.id || a.buyer.id - b.buyer.id);

  // Each quoting market's scarcity price, memoised — all quotes read the ONE
  // index frozen this step (marketMulOf), which itself backed demand at LAST
  // pass's prices; the memo becomes the next pass's lagged-price map below.
  const priceMemo = new Map();
  const priceOf = (key) => {
    let p = priceMemo.get(key);
    if (p === undefined) priceMemo.set(key, p = SLAVE_PRICE * marketMulOf(world, key));
    return p;
  };
  for (const c of cands) {
    const seller = c.seller, buyer = c.buyer;
    const stock = seller._captives || 0;
    if (stock <= 0.5) continue;                      // sold out to a nearer buyer
    const want = wantLeft.get(buyer.id) || 0;
    if (want <= 0.5) continue;                       // filled from a nearer seller
    const qty = Math.min(stock, want);
    if (qty < 0.5) continue;                         // dust stays in stock
    const price = priceOf(marketKeyOf(world, buyer));   // the DESTINATION market's price
    const inters = routeIntermediates(c);
    // The audited sale: purse, ship-worthiness, tolls to every relay, entrepôt
    // margin, import duty, conservation — and the Tier-A metering of every
    // booking over the pass interval. scale = the fraction that actually ships.
    const scale = sellGoods(world, seller, buyer, qty * price, freightOf(c.cost),
      inters, inters ? inters.length : 0, IN_SLAVE_TRADE, OUT_SLAVE, ivl) || 0;
    if (scale <= 0) continue;
    const moved = qty * scale;
    // The PEOPLE move with the coin — this seller's own captive pool arrives
    // (pairwise cargo: regionally coherent origins, no cross-network teleport).
    arriveCaptives(world, buyer, moved, seller._captiveCul, seller._captiveAnc);
    drainCaptivePools(seller, moved, stock);
    seller._captives = Math.max(0, stock - moved);
    buyer._unfree = (buyer._unfree || 0) + moved;
    wantLeft.set(buyer.id, want - moved);
    // Write-only telemetry for probes: how far the executed trades ran.
    const dbg = world.debug;
    if (dbg) {
      dbg.slaveTradeN = (dbg.slaveTradeN || 0) + 1;
      dbg.slaveTradeVal = (dbg.slaveTradeVal || 0) + moved * price;
      dbg.slaveTradeCostVal = (dbg.slaveTradeCostVal || 0) + moved * price * (c.cost / rn);
      if (!(dbg.slaveTradeMaxCost >= c.cost / rn)) dbg.slaveTradeMaxCost = c.cost / rn;
    }
  }
  // The lagged-price map for next pass's scarcity backing (buildScarcity):
  // exactly the markets that quoted this pass; a key that stops quoting falls
  // back to the base price, the honest no-information prior.
  world._slaveLastPrice = priceMemo;
}

// The intermediates of a matched pair's network route: every relay settlement
// the path threads (interior graph nodes) plus each hop link's own on-path
// settlements — deduplicated, endpoints excluded — handed to sellGoods so the
// SAME toll/entrepôt machinery that pays Lyon and Malacca pays the towns the
// coffle passes. Reconstructed lazily (only for pairs that actually match)
// from the seller's Dijkstra predecessor maps; nodes on a finalized shortest
// path are themselves finalized, so the walk is exact.
function routeIntermediates(c) {
  const { prev, prevLink, byId } = c.routes;
  let out = null, seen = null;
  const add = (x) => {
    if (!x || x.id === c.seller.id || x.id === c.buyer.id) return;
    if (!seen) { seen = new Set(); out = []; }
    if (seen.has(x.id)) return;
    seen.add(x.id); out.push(x);
  };
  let at = c.buyer.id;
  while (at !== c.seller.id) {
    const link = prevLink.get(at);
    if (link && link.inter) for (const x of link.inter) add(x);
    const from = prev.get(at);
    if (from === undefined) break;   // (defensive: a candidate always has a chain)
    if (from !== c.seller.id) add(byId ? byId.get(from) : null);
    at = from;
  }
  return out;
}
