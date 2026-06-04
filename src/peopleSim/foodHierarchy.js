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
//   1. PRICE + DEMAND.  grainPrice[s] = PRICE_BY_TIER[tier] × localP — grain is
//      cheap at the village gate and dear in the city, so the gradient rising up
//      the tree is the margin a market town earns (buy low from villages, sell
//      dear to the city). hunger[s] = how food-limited s is (houseK > foodK → it
//      could grow if fed) — the demand signal that pulls grain harder.
//
//   2. GRAIN UP (post-order).  pool[s] = own production + Σ children shipped up;
//      up[s] = pool × SHIP_BY_TIER[tier] × (1 + DEMAND_PULL·parent.hunger) × KEEP
//      — a village ships most of its grain to market and stays small; a hungry
//      city upstream pulls a larger fraction. net[s] = pool − up is what s keeps.
//
//   3. COIN DOWN.  each market PAYS its suppliers for the grain they shipped it,
//      at the SELLER's local price, capped by the buyer's spare coin (snapshotted
//      so payment order can't create coin). The capital is the top buyer and
//      funds the chain; villages are paid for their surplus; a town nets the
//      margin between cheap grain in and dear grain out. Grain already moved in
//      pass 2, so a cash-poor buyer simply under-pays (barter) — people never
//      starve for lack of coin, and the closed money supply is exactly conserved.
//
// Runs at the END of the settlement phase (after updateFood/updatePopulation set
// fresh _storableSupply / _houseK / _foodK), producing _foodNet for the NEXT
// tick's updateFood — a 1-tick lag that's invisible (production drifts slowly).

import { localP } from "./inflation.js";
import { getWealthReserve } from "./settlement.js";
import { recordIn, recordOut, IN_FOOD, OUT_FOOD } from "./money.js";

const KEEP_PER_HOP = 0.9;   // fraction of shipped grain surviving each hop up the hierarchy
// Fraction of its grain POOL a settlement ships up to its market centre, by tier
// (village → town → city → metropolis). A village is a farm: it sends most of
// its grain to market and stays small; a metropolis keeps nearly all that flows
// to it and grows. Pool is land-based (independent of population), so a fixed
// fraction can't cause the pinning feedback a "pool − current demand" rule would.
const SHIP_FRAC_BY_TIER = [0.8, 0.5, 0.2, 0.05];
const SHIP_FRAC_MAX = 0.95;   // demand can pull no more than this up (a settlement always keeps a seed of grain)
const DEMAND_PULL   = 0.6;    // how strongly a hungry market upstream raises the fraction shipped to it
// Grain's market price by the SELLER's tier (× local price level). The gradient
// must be STEEP: a market town ships only ~a third of the grain it takes in
// further up (it feeds its own people with the rest) yet pays its villages for
// ALL of it, so a gentle markup leaves the town a net buyer. A big farm-gate→
// market step-up (village grain is cheap; a town's collected, market-ready grain
// is dear) is what lets the town capture the entrepôt margin instead of pumping
// coin into the countryside. (× localP so grain trades higher in a wealthy region.)
const GRAIN_PRICE_BY_TIER = [2, 8, 14, 22];

export function aggregateFoodHierarchy(world) {
  const byId = world._byId;
  if (!byId) return;

  // ── 1. price + demand signal per settlement ─────────────────────────
  // hunger = how food-limited it is (housing capacity it could fill if it had
  // more grain); price = its tier's grain price scaled by local inflation.
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const hK = s._houseK || 0, fK = s._foodK || 0;
    s._grainHunger = hK > 0 ? Math.max(0, Math.min(1, (hK - fK) / hK)) : 0;
    s._grainPrice = GRAIN_PRICE_BY_TIER[Math.min(3, Math.max(0, s.tier | 0))] * localP(world, s);
  }

  // ── children lists from the CURRENT liege tree ──────────────────────
  // Same-country, alive parent only, so a stale liegeId (after an absorption /
  // secession between polity passes) can't ship grain across a border; such a
  // settlement becomes a local root (its own market, no parent to ship to).
  const children = new Map();
  const roots = [];
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    s._foodUp = 0;
    const L = (s.liegeId >= 0 && s.countryId >= 0) ? byId.get(s.liegeId) : null;
    if (L && L.mode === "settled" && L.countryId === s.countryId && L.id !== s.id) {
      s._hasFoodParent = true; s._foodParent = L;
      let a = children.get(L.id); if (!a) children.set(L.id, a = []); a.push(s);
    } else {
      s._hasFoodParent = false; s._foodParent = null;
      roots.push(s);
    }
  }

  // ── 2. grain flows UP (demand-modulated), iterative post-order ───────
  // Children processed before their parent, with a seen-guard so a pathological
  // liege cycle can't loop forever.
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
        let pool = node._storableSupply || 0;
        const kids = children.get(node.id);
        if (kids) for (const k of kids) pool += k._foodUp || 0;
        node._foodPool = pool;
        const base = SHIP_FRAC_BY_TIER[Math.min(3, Math.max(0, node.tier | 0))];
        // A hungrier market above pulls a larger fraction up (toward SHIP_FRAC_MAX);
        // a satiated one pulls only the base fraction.
        const parent = node._foodParent;
        const pull = parent ? (1 + DEMAND_PULL * (parent._grainHunger || 0)) : 1;
        const sf = node._hasFoodParent ? Math.min(SHIP_FRAC_MAX, base * pull) : 0;
        const up = pool * sf * KEEP_PER_HOP;
        node._foodUp = up;
        node._foodNet = pool - up;                          // what it keeps for its own population
      }
    }
  }

  // ── 3. coin flows DOWN: each market pays its suppliers ───────────────
  // A parent buys each child's shipped grain at the CHILD's local price (cheap at
  // the village gate), capped by the parent's spare coin THIS tick. Budgets are
  // snapshotted up front so the order of payment can't let a node spend coin it
  // only receives later — no coin is created, the supply is exactly conserved.
  const budget = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    budget.set(s.id, Math.max(0, (s.wealth || 0) - getWealthReserve(s)));
  }
  for (const [pid, kids] of children) {
    const P = byId.get(pid);
    if (!P || P.mode !== "settled") continue;
    let totalCost = 0;
    for (const k of kids) totalCost += (k._foodUp || 0) * (k._grainPrice || 0);
    if (totalCost <= 0) continue;
    const scale = Math.min(1, (budget.get(pid) || 0) / totalCost);   // afford only what spare coin allows
    if (scale <= 0) continue;
    for (const k of kids) {
      const pay = (k._foodUp || 0) * (k._grainPrice || 0) * scale;
      if (pay <= 0) continue;
      P.wealth -= pay;
      k.wealth = (k.wealth || 0) + pay;
      recordOut(P, OUT_FOOD, pay);     // money-flow panel: grain bought
      recordIn(k, IN_FOOD, pay);       //                   grain sold
    }
  }
}
