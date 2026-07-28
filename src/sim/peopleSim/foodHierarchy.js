// ── Central-place grain market ────────────────────────────────────────
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

import { getWealthReserve, techEff } from "./settlement.js";
import { recordIn, recordOut, IN_FOOD, OUT_FOOD } from "./money.js";
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
const LEVY_ORG_MIN = 0.35;   // statecraft (reachLevel) a liege needs before it can run a redistributive grain levy at all — the proto-state threshold below which there is no city-feeding bureaucracy
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
function foodHaulArrive(world, child, parent) {
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

  // Decay every settlement's smoothed import inflow up front (the hierarchy walk
  // below only ever ADDS arrivals) so a settlement that drops out of the food
  // hierarchy — or out of "settled" mode — reads a fading, then zero, "Imported
  // /tick" row instead of freezing at its last value.
  for (const s of world.settlements) if (s._foodImportRate) s._foodImportRate *= 0.9;

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
        // The liege's in-kind requisition share — how much of a child's shippable
        // surplus this centre can gather WITHOUT paying, from its administrative
        // reach (see LEVY_* above). A proto-state (org < LEVY_ORG_MIN) has none and
        // must buy everything with coin (so it can't feed a city until money or
        // statecraft arrives); an organised state requisitions up to LEVY_MAX.
        const org = techEff(node).reachLevel;
        const levyShare = org > LEVY_ORG_MIN
          ? LEVY_MAX * Math.min(1, (org - LEVY_ORG_MIN) / (1 - LEVY_ORG_MIN))
          : 0;
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
          const took = levied + bought;                      // grain that moved UP (levy + purchase); bought ≥ 0 always (rest > 0 since offer > 0 & levyShare ≤ 0.7; spare ≥ 0)
          if (took <= 0) continue;
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
        node._foodImportRate = (node._foodImportRate || 0) + imported * 0.1;
        node._foodPool = pool;
        node._foodNet = pool;                                // keeps it all unless its OWN parent buys (when parent is processed)
        const sf = node._hasFoodParent ? SHIP_FRAC_BY_TIER[Math.min(3, Math.max(0, node.tier | 0))] : 0;
        const arrive = node._hasFoodParent ? foodHaulArrive(world, node, node._foodParent) : 0;
        node._foodOffer = pool * sf * arrive;                // only grain that survives the haul to its market is offered up
        node._foodHaul = arrive;                             // (info panel: this hop's haul-survival fraction)
        node._foodUp = node._foodOffer;                      // (info panel / compatibility)
      }
    }
  }
}
