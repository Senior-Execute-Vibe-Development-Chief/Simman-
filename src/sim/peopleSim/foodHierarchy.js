// ── Central-place grain market (+ the open peer market, v47) ──────────
//
// Grain flows UP the settlement hierarchy (village → market town → city →
// capital) and COIN flows DOWN to pay for it. A market centre aggregates the
// grain of its WHOLE subtree, so a city is fed by its entire hinterland — not a
// fixed handful of trade partners. This is Central Place Theory.
//
// History note: an earlier road-based food trade already had the economics below
// (coin moving buyer→seller, inflation-priced grain, demand-driven flow, tolls)
// but capped a settlement at ~12 trade partners, so a city could never be fed by
// more than ~12 villages and no metropolis could form. The hierarchy replaced
// that capped, O(n²)-ish pairwise trade with a deterministic O(n) tree sweep —
// a city draws on its whole region. This file re-attaches the market economics
// that the first hierarchy cut (it was pure barter + fixed fractions) onto that
// uncapped topology, and adds the merchant margin the road trade never had.
//
// Each tick, three cheap passes over the liege tree (all O(settlements)):
//
//   1. PRICE + DEMAND.  grainPrice[s] = PRICE_BY_TIER[tier] × scarcity (real terms —
//      the (b) nominal-inflation model does NOT scale grain by localP; scarcity is a
//      physical demand/supply ratio clamped 0.5–3, not a monetary quantity).
//      Grain is cheap at the village gate and dear in the city, so the gradient
//      rising up the tree is the margin a market town earns (buy low from
//      villages, sell dear to the city). hunger[s] (_grainHunger) measures how
//      food-limited s is (houseK > foodK → it could grow if fed); it's exposed
//      for the info panel — the BUYING itself is coin-gated, not hunger-pulled.
//
//   2. GRAIN UP (post-order).  pool[s] = own production + Σ children shipped up;
//      offer[s] = pool × SHIP_BY_TIER[tier] × haulSurvival(s → its market) — a
//      village ships most of its grain to its NEARBY market and stays small, but
//      grain that can't reach a distant centre before it spoils just stays rural
//      (see foodHaulArrive: distance / tech / water). net[s] = pool − what its
//      parent buys is what s keeps.
//
//   3. LEVY + COIN DOWN.  an organised liege first REQUISITIONS a share of each child's
//      offer IN KIND (no coin — the temple/palace economy; see LEVY_* below), then PAYS
//      for as much of the REMAINDER as its spare coin allows, at the SELLER's local
//      price, capped by the buyer's snapshotted spare coin (so payment order can't
//      create coin). The capital is the top buyer and funds the chain; villages are paid
//      for the bought share; a town nets the margin between cheap grain in and dear grain
//      out. Grain already moved in pass 2, so a cash-poor buyer simply levies/under-pays
//      (barter) — people never starve for lack of coin, and the closed money supply is
//      exactly conserved.
//
// Runs at the END of the settlement phase (after updateFood/updatePopulation set
// fresh _storableSupply / _houseK / _foodK), producing _foodNet for the NEXT
// tick's updateFood — a 1-tick lag that's invisible (production drifts slowly).

import { getWealthReserve, techEff, LEVY_ORG_MIN, foodReach, granaryCap } from "./settlement.js";
import { recordIn, recordOut, IN_FOOD, OUT_FOOD } from "./money.js";
import { mergeReach } from "./roads.js";
import { T, rNormPop } from "./tuning.js";

// ── In-kind levy (the temple/palace redistributive economy) ───────────
// The first cities were fed by REQUISITION, not purchase: a temple- or
// palace-state gathered the countryside's surplus grain in kind and
// redistributed it to the centre, centuries before coined money existed
// (Uruk, Old-Kingdom Egypt, Shang, the Andean storehouse states). The market
// (coin buying grain, below) EXTENDS that flow as money spreads, but the levy
// is what lets a PRE-COINAGE city exist at all — without it a coin-poor centre
// simply starved ("no coin, no grain"), so no city could form before money.
// The levy requires ADMINISTRATION (a bureaucracy to assess, collect and haul):
// below LEVY_ORG_MIN a society is too politically primitive to run one (a
// chiefdom takes tribute, not a systematic grain levy), and it ramps with the
// liege's statecraft to LEVY_MAX — capped so a market residual always remains
// for coin to buy. Emergent: gated on the realm's own organisation, never a
// date or era.
// LEVY_ORG_MIN — the proto-state threshold — moved to settlement.js (ONE
// definition): the same administrative-reach ramp now also weights FOOD_K's
// rural-capacity blend (T.FOOD_REACH), so the two consumers share it.
const LEVY_MAX     = 0.7;    // ceiling on the in-kind share of a child's shippable surplus a fully-organised state requisitions without payment (the rest is left to the coin market)

// ── Grain haul: distance, tech & water gate (replaces the old flat per-hop loss) ──
// Grain spoils and costs money to cart, so a region only ships up the food it can get
// to market before it rots. The fraction that SURVIVES the haul to its market centre
// decays exponentially with the transport distance to that centre, over a RANGE that
// grows with: (a) the DESTINATION's tier — a city/metropolis aggregates a wider
// hinterland than a market town (granaries, ports, professional carters); (b) the
// shipper's TRANSPORT TECH — roads (construction) and wagons (mobility), with an
// industrial-era leap for rail + refrigeration + canning as construction matures; and
// (c) a WATER corridor bonus when both ends sit on a river/coast (grain by barge/ship
// went vastly further than by ox-cart — Rome's Egyptian grain, the Baltic rye trade).
// Beyond its range a region's surplus simply stays rural and feeds its own people.
// (FOOD_HAUL_RANGE / FOOD_HAUL_TECH / FOOD_HAUL_WATER tune it.)
const FOOD_RANGE_BY_TIER = [1.0, 1.0, 2.2, 3.6];   // destination-tier catchment multiplier (FR/town · town · city · metropolis)

// Fraction of grain shipped from `child` that survives the haul to its market `parent`.
// (Exported for probe_uptake's market-stage attribution — sim consumers stay in-module.)
export function foodHaulArrive(world, child, parent) {
  const tw = world.tw;
  let dx = Math.abs(child.pos.x - parent.pos.x); if (dx > tw / 2) dx = tw - dx;
  const dy = child.pos.y - parent.pos.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  let range = T.FOOD_HAUL_RANGE * FOOD_RANGE_BY_TIER[Math.min(3, Math.max(0, parent.tier | 0))] * rNormPop(world);   // grain hauls a REAL distance, not a tile count (RES_INVARIANT_POP)
  // Transport tech of the shipping region: roads (construction) + wagons (mobility),
  // plus an industrial leap (rail / refrigeration / canning) as construction passes ~0.85.
  const k = child.knowledge || {};
  const cons = k.construction || 0, mob = k.mobility || 0, nav = k.navigation || 0;
  range *= 1 + (cons * 0.6 + mob * 0.4 + Math.max(0, cons - 0.85) * 5) * T.FOOD_HAUL_TECH;
  // Water corridor: both ends on a river/coast → grain moves by barge/ship, far further
  // (full strength at high navigation, half-strength by river even at zero seafaring).
  const ci = (child.pos.y | 0) * tw + (child.pos.x | 0);
  const pi = (parent.pos.y | 0) * tw + (parent.pos.x | 0);
  const onWater = (ti) => (world.coast && world.coast[ti]) || (world.riverMag && world.riverMag[ti] >= 2);
  if (onWater(ci) && onWater(pi)) range *= 1 + (T.FOOD_HAUL_WATER - 1) * (0.5 + 0.5 * nav);
  return Math.exp(-d / Math.max(1e-3, range));
}
// Fraction of its grain POOL a settlement ships up to its market centre, by tier
// (village → town → city → metropolis). A village is a farm: it sends most of
// its grain to market and stays small; a metropolis keeps nearly all that flows
// to it and grows. Pool is land-based (independent of population), so a fixed
// fraction can't cause the pinning feedback a "pool − current demand" rule would.
const SHIP_FRAC_BY_TIER = [0.8, 0.5, 0.2, 0.05];
// Grain's market price by the SELLER's tier. The gradient
// must be STEEP: a market town ships only ~a third of the grain it takes in
// further up (it feeds its own people with the rest) yet pays its villages for
// ALL of it, so a gentle markup leaves the town a net buyer. A big farm-gate→
// market step-up (village grain is cheap; a town's collected, market-ready grain
// is dear) is what lets the town capture the entrepôt margin instead of pumping
// coin into the countryside.
const GRAIN_PRICE_BY_TIER = [2, 8, 14, 22];

export function aggregateFoodHierarchy(world) {
  const byId = world._byId;
  if (!byId) return;
  // T.SHIP_SURPLUS — the farm gate sells the SURPLUS, not a tier slice
  // (docs/egypt-autopsy-2026-08-24.md, the ONE_BOOK half-green verdict). The
  // SHIP_FRAC_BY_TIER fractions were the village world's proxy for need —
  // villages need little (ship 0.8), cities need most (ship 0.05-0.2). Under
  // the city-only register every member ships the CITY fraction of an
  // already-small pool: offers measured ~0.02-0.04/tick against anchor core
  // needs of 1-3 — two orders short, so no import ever reaches an anchor and
  // the agglomeration engine idles even with the book fixed. Under ONE_BOOK
  // the need is EXPLICIT (demand = the market-fed core), so the proxy
  // retires: a settlement offers what its own ledger does not eat,
  // max(0, pool − demand) — the honest farm-gate form. Requires the ONE-book
  // regime (without it demand bills the whole catchment, pool − demand ≤ 0
  // everywhere, and offers would VANISH rather than open).
  const surplusBasis = T.SHIP_SURPLUS > 0 && T.ONE_BOOK > 0 && T.ONE_POP > 0 && T.DISSOLVE_FARMS > 0;

  // Decay every settlement's smoothed import inflow up front (the hierarchy walk
  // below only ever ADDS arrivals) so a settlement that drops out of the food
  // hierarchy — or out of "settled" mode — reads a fading, then zero, "Imported
  // /tick" row instead of freezing at its last value.
  for (const s of world.settlements) {
    if (s._foodImportRate) s._foodImportRate *= 0.9;
    if (s._foodExported) s._foodExported = 0;   // T.GRAIN_MARKET capacity add-back: rolls each aggregation; updateSettlement (earlier in the tick) read the previous pass's value
  }
  // Goods-flow overlay recorder (render-only; the worker sets _wantGoodsFlows
  // while the "Goods flow" view is open — zero cost and zero allocations
  // otherwise). Grain entries rebuild every tick here; the goods-vector
  // entries rebuild each trade sweep in roads.js (_goodsFlowsTrade). An entry
  // is {pts, mag, toEnd, kind}: pts is a tile-index path — a road/sea link's
  // tiles where one exists, else a 2-point straight line (the renderer lerps
  // over segments, so 2 points draw a direct stream — the liege tree is not
  // road-constrained and never had a path).
  const gf = world._wantGoodsFlows ? [] : null;
  world._goodsFlowsGrain = gf;
  const tw = world.tw;
  const tiOf = (s) => (s.pos.y | 0) * tw + (s.pos.x | 0);

  // ── 1. price per settlement ─────────────────────────────────────────
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const hK = s._houseK || 0, fK = s._foodK || 0;
    s._grainHunger = hK > 0 ? Math.max(0, Math.min(1, (hK - fK) / hK)) : 0;
    // (b) NOMINAL-inflation model: the price NEVER tracks localP (the MONETARY price
    // level). Money pools at producers (mines/exporters), which lifts localP — but the
    // grain-BUYING cities don't hold that coin, so pricing grain by localP squeezed them
    // for money sitting elsewhere and made population depend on the money SUPPLY. So the
    // absolute money level stays out of the price; localP drives only Hume
    // competitiveness + the ticker.
    // What DOES move it is REAL scarcity — a physical demand/supply ratio, NOT a monetary
    // quantity (this is a different axis from the localP coupling removed above, not a
    // reintroduction of it): base tier price × clamp(local demand/supply, 0.5, 3). In a
    // dearth (famine, siege, over-crowding) demand outruns the harvest and grain gets
    // DEAR; in a glut it's cheap. Read from updateFood's _foodDemand/_foodSupply.
    // Conserved — it's a price the buy loop pays, so coin still balances; it redistributes
    // coin toward whoever is SHORT (a famine/siege makes the hungry SELLER's grain dear).
    // Clamped so a shock can't send the price to zero or infinity.
    // KNOWN TRADEOFF (surfaced, not hidden): _foodSupply is the RETAINED net after
    // shipping up, so a heavy exporter can read as short and price its exports dear,
    // occasionally inverting the steep farm-gate→market tier gradient below on a
    // same-/near-tier pair. The 0.5–3 clamp bounds it and coin stays conserved; a truer
    // supply signal (production-relative, not retained-relative) is a scoped follow-up,
    // deliberately not bolted on here where it would destabilise the validated economy.
    const scarcity = Math.min(3, Math.max(0.5,
      (s._foodDemand || 1) / Math.max(0.01, s._foodSupply)));   // no `|| 1` on supply: a food-empty settlement must read as MOST scarce, not neutral (Math.max(0.01,…) guards the divide)
    s._grainPrice = GRAIN_PRICE_BY_TIER[Math.min(3, Math.max(0, s.tier | 0))] * scarcity;
  }

  // ── children lists from the CURRENT liege tree ──────────────────────
  // Same-country, alive parent only, so a stale liegeId (after an absorption /
  // secession between polity passes) can't ship grain across a border; such a
  // settlement becomes a local root (its own market, no parent to ship to).
  const children = new Map();
  const roots = [];
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    s._foodUp = 0; s._foodOffer = 0;
    const L = (s.liegeId >= 0 && s.countryId >= 0) ? byId.get(s.liegeId) : null;
    if (L && L.mode === "settled" && L.countryId === s.countryId && L.id !== s.id) {
      s._hasFoodParent = true; s._foodParent = L;
      let a = children.get(L.id); if (!a) children.set(L.id, a = []); a.push(s);
    } else {
      s._hasFoodParent = false; s._foodParent = null;
      roots.push(s);
    }
  }

  // ── spare-coin budget snapshot (so payment can't create coin) ────────
  const budget = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    budget.set(s.id, Math.max(0, (s.wealth || 0) - getWealthReserve(s)));
  }

  // ── 2+3 integrated, post-order: grain only moves as far as it is BOUGHT ──
  // Each node BUYS grain from its children, limited by its spare coin (STRICT: no
  // coin, no grain — the un-bought grain stays with the seller, who keeps and eats
  // it). It then OFFERS its own pool up for its parent to buy. So a city is fed by
  // exactly the grain it can afford from its countryside, and a cash-poor centre
  // simply gets less and is food-limited — no more free barter auto-ship. Coin flows
  // seller-ward, the closed supply is exactly conserved (each pays from a snapshot of
  // its spare coin, so it can't spend coin it only earns later by re-selling).
  // net[s] = what s keeps after its own parent buys from it.
  const seen = new Set();
  for (const root of roots) {
    const stack = [[root, false]];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const node = frame[0];
      if (!frame[1]) {
        frame[1] = true;
        if (seen.has(node.id)) { stack.pop(); continue; }   // cycle guard
        seen.add(node.id);
        const kids = children.get(node.id);
        if (kids) for (const k of kids) if (!seen.has(k.id)) stack.push([k, false]);
      } else {
        stack.pop();
        let pool = node._storableSupply || 0;                // own production (MODEL B: every tier farms its territory)
        let imported = 0;                                    // grain arriving from the subtree THIS tick (levy + purchase)
        let spare = budget.get(node.id) || 0;
        // Probe-only flow decomposition (tools/probe_uptake.mjs installs
        // world._tradeStats; the sim never does). The levy/buy split cannot be
        // reconstructed post-hoc — coin is spent sequentially across children —
        // so record it here. Underscore debug fields, never persisted, written
        // only under the probe: zero effect on a normal run.
        const ts = world._tradeStats;
        let dbgLevied = 0, dbgBought = 0, dbgUnbought = 0;
        const dbgSpare0 = spare;
        // The liege's in-kind requisition share — how much of a child's shippable
        // surplus this centre can gather WITHOUT paying, from its administrative
        // reach (see LEVY_* above). A proto-state (org < LEVY_ORG_MIN) has none and
        // must buy everything with coin (so it can't feed a city until money or
        // statecraft arrives); an organised state requisitions up to LEVY_MAX.
        const levyShare = LEVY_MAX * foodReach(node);   // the shared administrative-reach ramp (settlement.js) — byte-identical to the inline form it replaces
        const kids = children.get(node.id);
        if (kids) for (const k of kids) {
          const offer = k._foodOffer || 0;                   // grain the child put up for sale
          if (offer <= 0) continue;
          // 1. LEVY: requisition the org-scaled share in kind, no coin paid.
          const levied = offer * levyShare;
          // 2. MARKET: coin buys as much of the REMAINDER as spare coin allows.
          const price = k._grainPrice || 0;
          const rest = offer - levied;
          const bought = price > 0 ? Math.min(rest, spare / price) : rest;
          if (bought > 0) {
            const pay = bought * price;
            node.wealth -= pay; k.wealth = (k.wealth || 0) + pay;
            recordOut(node, OUT_FOOD, pay);   // money-flow panel: grain bought
            recordIn(k, IN_FOOD, pay);        //                   grain sold
            spare -= pay;
          }
          if (ts) { dbgLevied += levied; dbgBought += bought; dbgUnbought += Math.max(0, rest - bought); }
          const took = levied + bought;                      // grain that moved UP (levy + purchase); bought ≥ 0 always (rest > 0 since offer > 0 & levyShare ≤ 0.7; spare ≥ 0)
          if (took <= 0) continue;
          if (gf && took > 1e-6) gf.push({ pts: [tiOf(k), tiOf(node)], mag: took, toEnd: true, kind: "grainL" });   // levy/tree grain, child → liege
          pool += took;
          imported += took;
          k._foodNet = (k._foodNet || 0) - took;             // child keeps less — it gave up `took`
        }
        // Smoothed grain INFLOW from the hinterland — the info panel's "Imported /tick" row.
        // Same per-tick 0.9/0.1 fold as the other *Rate fields (e.g. _minedRate): the ×0.9
        // decay was applied to every settlement at the top of this pass, so here only the
        // arrival is folded in. NOTE: this is a DECOMPOSITION of the supply the settlement
        // already receives through _foodNet (imports are inside _foodSupply), not an extra
        // flow on top of it.
        if (ts) {
          ts.levied += dbgLevied; ts.bought += dbgBought; ts.unbought += dbgUnbought; ts.ticksSeen = world.step;
          node._dbgLevied = dbgLevied; node._dbgBought = dbgBought; node._dbgUnbought = dbgUnbought;
          node._dbgSpare0 = dbgSpare0; node._dbgLevyShare = levyShare;
        }
        node._foodImportRate = (node._foodImportRate || 0) + imported * 0.1;
        node._foodPool = pool;
        node._foodNet = pool;                                // keeps it all unless its OWN parent buys (when parent is processed)
        const sf = node._hasFoodParent ? SHIP_FRAC_BY_TIER[Math.min(3, Math.max(0, node.tier | 0))] : 0;
        const arrive = node._hasFoodParent ? foodHaulArrive(world, node, node._foodParent) : 0;
        node._foodOffer = node._hasFoodParent && surplusBasis
          ? Math.max(0, pool - (node._foodDemand || 0)) * arrive   // T.SHIP_SURPLUS: the farm gate sells what its own ledger does not eat
          : pool * sf * arrive;                // only grain that survives the haul to its market is offered up
        node._foodHaul = arrive;                             // (info panel: this hop's haul-survival fraction)
        node._foodUp = node._foodOffer;                      // (info panel / compatibility)
      }
    }
  }
  if (T.GRAIN_MARKET > 0) grainMarketPass(world);
}

// ── T.GRAIN_MARKET: the OPEN grain market (2026-08-25, the uptake wave) ──────
// The tree sweep above is the TEMPLE/PALACE economy: grain moves child→liege
// only, inside one country. probe_uptake measured its consequence at every
// mature grid: the hungry register is LEAF-dominated — a settlement with no
// same-country children CANNOT import, ever, so only realm capitals are fed by
// the market (fed(parent) p50 1.00 vs the starving leaf tail), importShare
// reads 0.00 almost everywhere, and URBAN_AGGLOM — whose growth fuel is
// import-fed capacity — never tells a core to grow: the owner's "every city
// 12k and starving". The levy/coin stages were measured CLEAR (unbought ≈ 0
// once offers exist); the topology is the constraint.
//
// What history has instead: the open market. Athens lived on Black-Sea grain,
// Rome on Egyptian and African shipments, the Hanse moved Baltic rye to
// Flanders — grain flowed BETWEEN polities, wherever price gradients and
// carriage made it worth moving, on exactly the network every other good used.
// So this pass lets a settlement whose ledger still runs short after the tree
// sweep BUY grain from its TRADE PEERS (mergeReach — the same road+sea reach
// goods trade uses, cross-border like goods trade, no war gate — trade-peace
// coupling and SIEGE_STARVE already own those axes), from each peer's residual
// surplus (what its own ledger does not eat and its liege did not take), at
// the SELLER's local grain price, capped by the buyer's spare coin. No levy
// here — requisition is a sovereignty act, the tree's job; across borders
// grain moves only when PAID FOR. A cash-poor town simply cannot buy (the
// pre-coinage world stays levy-fed — the historical order of appearance).
//
// Every term is an existing mechanism — foodHaulArrive (distance/tech/water
// spoilage physics, destination-tier catchment), _grainPrice (tier base ×
// real scarcity), getWealthReserve (the subsistence hoard floor), the reach
// networks (roads/sea, themselves emergent). NO new constants: the flow is
// bounded by deficit × surplus × haul survival × coin, all emergent — grain
// uptake then deepens with roads, ships, mining and statecraft on its own.
// Deterministic: settlements in array order, peers in reach (nearest-first)
// order, no RNG. Nothing here persists — per-tick flow only.
function grainMarketPass(world) {
  const ts = world._tradeStats;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    // THE MARKET INSTITUTION GATE: commercial grain buying needs coined money
    // (techEff.market — the currency tech's own ability, the monetization()
    // precedent). Before it, exchange is the levy/tree (the temple economy,
    // above) and local barter — the historical order: Uruk's grain moved by
    // administration, the commercial grain trade at scale is classical.
    // Measured without it (the 777 pair, uptake_solver240_777_24k*_v2): dawn
    // cradles trade from birth (granaries start at cap, cold ledgers read
    // need), the early urban distribution flattens (median core 15.9 vs 42.2
    // at 14k), the marginal world's first founding cascade never fires
    // (+1 vs +7 at 16-18k), and seed 777 lands 14-15 vs its 20-22
    // no-mechanism band. Emergent, never a date: the market opens where and
    // when a society mints coin.
    if (!techEff(s).market) continue;
    if (T.SIEGE_STARVE && s._besiegedNow) continue;   // no marketing through a siege line
    let need = (s._foodDemand || 0) - (s._foodNet || 0);
    if (need <= 1e-9) continue;
    const reach = mergeReach(s);
    if (!reach || reach.size === 0) continue;
    let spare = Math.max(0, (s.wealth || 0) - getWealthReserve(s));   // post-tree purse: the tree sweep's buys already spent from it
    if (spare <= 1e-9) continue;
    let boughtIn = 0;
    const gf = world._goodsFlowsGrain;
    const twm = world.tw;
    for (const [peerId, link] of reach) {
      if (need <= 1e-9 || spare <= 1e-9) break;
      if (peerId === s.id) continue;
      const p = world._byId ? world._byId.get(peerId) : null;
      if (!p || p.mode !== "settled") continue;
      if (T.SIEGE_STARVE && p._besiegedNow) continue;   // a besieged seat sells nothing across the lines (and its capacity add-back stays 0)
      // _foodNet is the seller's LIVE inventory — each sale below decrements
      // it, so the residual self-draws-down (a bushel can only sell once).
      // THE SEED-CORN RULE: a settlement sells only the surplus its own
      // granary cannot absorb — while stores sit below cap the harvest
      // refills them FIRST (granaryCap is the same clamp updateFood applies),
      // so a famine-drained community rebuilds its buffer before exporting
      // again; a full granary sells its whole surplus flow. Without this the
      // market drained exactly the flow that fills granaries and, under
      // HARVEST_YEARS, the marginal-geography gate seed bled 40→15
      // settlements (gm_stylized_777 vs hy_stylized_777): communities sold
      // their famine reserve and died at the next lean year.
      const surplus = Math.max(0, (p._foodNet || 0) - (p._foodDemand || 0));
      const residual = Math.max(0, surplus - Math.max(0, granaryCap(p) - (p.food || 0)));
      if (residual <= 1e-9) continue;
      // Haul survival: buyer is the DESTINATION market (its tier sets the
      // catchment range — a metropolis pulls a wider grain shed), seller the
      // shipper (its transport tech + the water corridor do the rest).
      const arrive = foodHaulArrive(world, p, s);
      if (arrive <= 1e-6) continue;
      const price = p._grainPrice || 0;
      let landed = Math.min(need, residual * arrive);
      if (price > 0) landed = Math.min(landed, spare / price);
      if (landed <= 1e-9) continue;
      const pay = landed * price;
      s.wealth -= pay; p.wealth = (p.wealth || 0) + pay;
      recordOut(s, OUT_FOOD, pay);
      recordIn(p, IN_FOOD, pay);
      spare -= pay;
      // Seller parts with what ARRIVES (the tree sweep's convention — the
      // un-hauled remainder never left the farm gate).
      p._foodNet = (p._foodNet || 0) - landed;
      p._foodExported = (p._foodExported || 0) + landed;   // capacity add-back (updatePopulation): exports cannot drag the catchment's K below what its land grows
      s._foodNet = (s._foodNet || 0) + landed;
      need -= landed; boughtIn += landed;
      if (gf && landed > 1e-6) {
        // Prefer the real route (link.tiles is oriented buyer→seller, so grain
        // toward the buyer flows toward the START: toEnd=false); sea/short
        // links without tiles get a 2-point straight stream seller→buyer.
        if (link && link.tiles && link.tiles.length > 1) gf.push({ pts: link.tiles, mag: landed, toEnd: false, kind: "grainM" });
        else gf.push({ pts: [(p.pos.y | 0) * twm + (p.pos.x | 0), (s.pos.y | 0) * twm + (s.pos.x | 0)], mag: landed, toEnd: true, kind: "grainM" });
      }
      if (ts) { ts.peerBought = (ts.peerBought || 0) + landed; p._dbgPeerOut = (p._dbgPeerOut || 0) + landed; }
    }
    if (boughtIn > 0) {
      // Same 0.9/0.1 smoothed-inflow fold as the tree sweep (the ×0.9 decay
      // already ran at the top of aggregateFoodHierarchy this tick).
      s._foodImportRate = (s._foodImportRate || 0) + boughtIn * 0.1;
      if (ts) s._dbgPeerIn = (s._dbgPeerIn || 0) + boughtIn;
    }
  }
}
