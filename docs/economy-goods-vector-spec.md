# Spec — the goods-vector economy (local prices, goods-carrying trade)

**Status:** proposed · **Date:** 2026-07 · **Companion:**
`docs/settlement-economy-analysis-2026-07.md` (the diagnosis this answers).

## Why

The economy today is **one scalar per settlement** (`exportValue`) and trade
is **one undifferentiated fluid** (money) flowing symmetrically along the
gradient. The analysis showed every "boring" symptom traces to that: town
identities collapse to two buckets, imports mirror exports (no division of
labour), supply chains can't exist, and the biggest cities are the least
distinctive. These aren't under-tuned — they're **unrepresentable** in a
scalar. This spec replaces the representation, not the tuning.

The pivot is one idea:

> **One price per settlement → a vector of local prices per good. Money-flow →
> goods-flow that equalises those prices across neighbours.**

Then specialisation, complementarity, supply chains, price shocks and legible
economic identities become *emergent outputs of local rules*, not bolted-on
special cases — which is the whole product premise (and both cardinal rules).

## How this respects the cardinal rules

- **Emergent, never scripted / never outcome-fitted.** Prices are real
  quantities (local scarcity = demand/supply). A region exports grain because
  its grain price is low and a neighbour's is high — not because a constant
  named it a breadbasket. Egypt, Toledo, Venice, and maps we've never seen all
  fall out of the same price×capability×transport rules. No `RIVER_UNIFY_FLOOR`,
  no `if (isNile)`.
- **State, never time.** Every quantity keys on endowment / tech / stocks /
  prices / connectivity. No tick, year, or era ever enters.

## You are ~60% there already

This is an *extension of patterns the codebase already committed to*, not a
foreign transplant:

- **`foodHierarchy.js` already moves a real good** (grain, up the central-place
  hierarchy, asymmetrically, priced by a buy-low/sell-high margin). It exists
  precisely because the symmetric-flow model was inadequate *for food*. The
  reframe generalises that proven pattern to the other goods.
- **The trade pass** (`runGeneralTradeBetween`, roads.js) already does network
  routing, chokepoint tolls, entrepôt brokerage, FX, tariffs, and
  **price-responsive balance-shifting** (`compA/compB` from `localP`). It's most
  of a goods market — it just moves one fluid instead of distinct goods.
- **Money provenance is already good-labelled** — `_mIn/_mOut` split flows into
  goods/food/materials/luxury (money.js). The accounting is good-aware; only the
  substance doesn't move as goods.
- **`localP`** (inflation.js) is already a per-network price *index* (monetary,
  quantity-theory). The new per-good prices are *scarcity* prices per
  settlement; the two are complementary — the monetary index keeps governing
  inflation & Hume, the good prices govern allocation & trade.

## The model

### Good set (small, legible, deterministic)

Start with **8 goods**, chosen so at least one real supply chain exists and each
maps to existing endowments/tech:

| good | produced from | consumed by |
|------|---------------|-------------|
| `staple` (grain/forage/fish) | fertility × agriculture, water × navigation | population (food) |
| `materials` (timber/stone) | timber+stone deposits × construction | construction, shipbuilding |
| `ore` (copper/tin/iron/coal) | ore deposits (`oreTier`) | **metal production** ← the chain |
| `metal` (tools/arms/wares) | `ore` input × metallurgy | population, army, capital |
| `cloth` (textiles) | fibre (wool/cotton climate) × craft | population |
| `wares` (pottery/leather/crafted) | construction × pop | population (everyday) |
| `luxury` (spices/furs/incense/dyes + cash crops) | `LUX_RES` endowment, cash-crop climate | elite/wealthy demand |
| `services` (shipping/entrepôt/finance) | organisation × water × city size | trade itself, capital |

The flagship chain is **`ore → metal`**: metal production *consumes* `ore`, so
an ore-poor but connected smith-town must **import ore** and a mining region
reads as an ore *exporter* — the first genuine producer/processor pairing.
(`fibre → cloth` can become a second chain in a later stage; start with one.)

### Per-settlement state (added to the settlement record)

- `prod[g]` — output/tick of each good = `capability[g] × labourShare[g]`, where
  `capability[g]` = endowment (post Stage-0 scarcity fix) × tech × pop-scale.
- `demand[g]` — consumption/tick from population (staple/wares/cloth/metal),
  elite wealth (luxury), and industry (ore demanded by metal production).
- `price[g]` — local scarcity price, damped toward the flow-balance target
  `f(demand[g] / (prod[g] + imports[g]))`, clamped to a band `[P_LO, P_HI]`.

Use a **flow model** (produce/consume per tick, price from the imbalance), not
persistent inventories — cheaper, and far more stable/deterministic. An optional
small smoothing buffer can be added later if shocks need memory.

### Endogenous specialisation (replaces the `_specKey` picker)

Labour tilts toward goods that are locally **profitable**:
`labourShare[g] ∝ price[g] × capability[g]`, normalised to the labour budget.
This is the profit motive, and it makes specialisation *any* good, driven by
real price×capability — no miscalibrated `leg/CRAFT_REF` ratio, no bucket that
structurally always wins. Agglomeration lock-in (settlement.js `_specStr`)
stays, but now compounds a real good's `capability`. `_specKey` becomes
"dominant net-export good" — emergent, many-valued, and shown truthfully.

### Trade = price equalisation in goods (replaces symmetric money flow)

Each trade sweep, over each settlement's nearest-K partners (the existing
reach), **per good**:

1. Post each side's pre-trade `price[g]`.
2. Goods flow **low-price → high-price** side, volume
   `∝ (priceGap) × gravity(pop, distance) / transportCost`, bounded by the
   seller's exportable surplus and the buyer's affordability above reserve.
3. Money moves the other way = goods value at the clearing price. Tolls,
   entrepôt brokerage, FX and tariffs apply on that value exactly as today.
4. Exporting lifts the seller's local supply-draw (price rises); importing eases
   the buyer's (price falls) — so prices **relax toward equality across the
   network, up to transport cost**, over ticks. A spatial price gradient (price
   rises with distance from source) emerges — real commodity geography.

This is a **relaxation across ticks**, not an instantaneous global solve — no
world market, no iterative solver, fully local and deterministic. A distant
spice coast reaches an inland capital through a *chain* of local exchanges, the
entrepôts between skimming margin (already modelled). `buy ≠ sell` because a
town imports the goods it's short of and exports the ones it's long on — by
construction.

## The scalar interface (how the rest of the sim stays stable)

The blast radius is contained by keeping the **outputs downstream reads
unchanged**, only re-sourced from the goods layer:

- `s.wealth` — still accumulates net exports (Σ goods sold − Σ goods bought).
- `exportValueOf(s)` — returns total production/net-export **value** (Σ
  price[g]·prod[g]), calibrated so the aggregate magnitude matches today's, so
  development / tech-rate / urbanisation / war read a compatible signal.
- `_specKey` / export breakdown — real dominant good / real per-good mix.
- `_mIn/_mOut` — populated from real per-good flows (already good-labelled).

Swap the engine; keep the driveshaft. Development, migration, war, monetization,
inflation and the UI keep their inputs.

## Stage 0 — endowment scarcity (the prerequisite)

Garbage-in defeats any market: today `localRes[id] = MAX over every territory
tile` (territory.js:499,515), then MAX again over peers (`effectiveLocalRes`),
so big cities read "a bit of everything." For the **production** endowment,
replace MAX with a **concentration-aware** measure (e.g. mean/total over tiles,
or max attenuated by the share of tiles that carry it) so a resource on 2 of 200
tiles reads scarce, not maxed — and stays scarce as the city grows. Keep
MAX-over-reach **only** for the knowledge cap ("can this culture *know* iron").
This is the foundation the whole model sits on and, per the analysis, is the
single most fundamental lever — it visibly raises variety even under today's
scalar trade.

## Determinism · performance · save-load

- **Determinism:** every update is a pure function of state; clearing uses no
  RNG (any tie-break uses the existing named substreams, rng.js). Damped,
  clamped price updates → no oscillation, no solver nondeterminism.
- **Performance:** ~128 settlements at 480 res (low thousands on Earth) × ~12
  partners × 8 goods ≈ tens of thousands of ops per sweep — comparable to the
  food hierarchy already running. Not a blocker.
- **Save/load:** `prod/demand/price` vectors serialise in persist.js (small
  addition; version bump). Terrain-derived capability rebuilds from seed.

## Staging plan (each shippable, A/B-able, validated independently)

Every stage behind a **defaults-off tuning flag** (the repo's established
pattern — cf. `T.URBAN_FOOTPRINT`, `T.FIAT_OUTPUT` in tuning.js: def 0,
byte-identical off), so mainline is unchanged until each stage validates.

- **Stage 0 — `T.RES_SCARCITY`.** Concentration-aware production endowment +
  re-normalise the current picker as a stopgap. Ship; watch specialty variety
  rise; `npm test` + `npm run validate`.
- **Stage 1 — `T.GOODS_PRICES`.** Add `prod/demand/price` vectors and
  price×capability labour allocation. Trade stays scalar; prices only *inform*
  specialisation and are displayable. Real, many-valued town identities with no
  trade-flow change yet. Validate.
- **Stage 2 — `T.GOODS_TRADE`.** Replace symmetric money flow with per-good
  price-equalising flow (tolls/entrepôt/FX intact). `buy ≠ sell` appears. Decide
  grain: fold `foodHierarchy` into the unified market, or keep grain on the
  hierarchy and add the other seven. This is the big one — validate hard.
- **Stage 3 — `T.SUPPLY_CHAIN`.** Metal production consumes `ore`; ore becomes
  trade-sourced. First producer/processor pairing. Optionally add `fibre→cloth`.
- **Stage 4 — couplings.** Temperament biases the demand vector (martial →
  metal/horses, mercantile → services/entrepôt); luxuries re-sized &
  de-symmetrised; shocks propagate via price. Polish.

## Validation

- **Guardrails:** `npm test` (determinism, invariants, save/load) and
  `npm run validate` (stylized facts) must pass at every stage; the defaults-off
  flags keep the old path live for A/B until each is green.
- **New economy stylized facts** to add to the suite: (a) a settlement's
  dominant export ≠ its dominant import (division of labour); (b) specialty
  entropy across towns well above today's ~2-bucket collapse; (c) a distance
  price-gradient for at least one good from its source; (d) ore-poor
  metal-towns exist (supply chain live); (e) luxury share of trade is a thin
  sliver, asymmetric producers→consumers.
- **Probe:** `tools/probe_settlement_econ.mjs` already dumps identity / buy /
  sell / partners — extend it to print per-good prices and the new facts.

## Open questions (decide before Stage 2)

1. **Grain:** unify into the market, or leave on the food hierarchy? (Leaning:
   keep the hierarchy for subsistence feeding — it's tuned and load-bearing for
   city formation — and let the *market* carry only the tradable surplus, so the
   two don't double-count.)
2. **Good count:** is 8 the right granularity, or split ore by metal / add
   `livestock`+`horses` as a 9th (military input)? Start at 8; add only if a
   stage needs it.
3. **Price → inflation coupling:** keep `localP` (monetary index) fully separate
   from good prices, or let the good-price vector *feed* the monetary index?
   (Leaning: separate for now; revisit in Stage 4.)
4. **Persistent stocks:** stay pure-flow, or add small inventories so shortages
   have memory (a besieged city drawing down granaries)? (Leaning: pure-flow
   through Stage 3; reconsider with shocks in Stage 4.)
