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

## Stage 0 — LANDED (2026-07)

Shipped behind `T.RES_SCARCITY` (+ `RES_SCARCITY_K`, def 1.5) and
`T.SPEC_RELATIVE`, both **default 0** (byte-identical off; smoke green twice).
Measured at 480×240, seed 8817, 20 000 steps (`tools/probe_settlement_econ.mjs`):

| metric | OFF | S only | R only | **S+R** |
|---|---|---|---|---|
| specialty entropy (bits, max 2.32) | 1.11 | 0.92 | 2.12 | **2.19** |
| top-10-city endowment breadth ≥0.10 / ≥0.25 / ≥0.40 | 6.3 / 4.6 / 2.7 | 5.3 / 3.3 / 1.6 | 6.4 / 4.8 / 2.6 | **3.4 / 2.2 / 1.5** |
| Crafted-wares share of specialties | 64.8 % | 77.0 % | 9.1 % | 15.7 % |
| Metalwork / Services shares | 0 % / 0 % | 0 % / 0 % | 32.6 % / 10.6 % | 22.5 % / 11.8 % |
| settlements · pop · wealth | 128 · 35.0k · 301k | 87 · 25.6k · 289k | 132 · 35.9k · 322k | 102 · 26.9k · 303k |

Findings:

- **The two levers are COMPLEMENTS — ship them together.** Scarcity alone
  (S) *worsens* the picker collapse (Crafted wares 77 %): scarcer geography
  shrinks the geographic legs, leaving construction even more dominant under
  the CRAFT_REF scoring. The Ricardian pick alone (R) fixes the distribution
  but leaves big cities endowment-homogenised. Together: all five sectors
  alive in geographic proportions AND the top cities' endowment breadth
  roughly halved (6.3 → 3.4 at the 0.10 threshold).
- **Mechanism lesson (recorded so it isn't re-learned):** the first
  RES_SCARCITY cut used the saturated SUM alone (`S/(S+K)`, K=1) and failed
  its own goal — a forest belt sums to S≈30, an ore district 4–6, so
  everything a big city touched read ~0.9+ and breadth ROSE (top-10 ≥0.40:
  2.7 → 6.1). Quantity without quality is the wrong physics; the landed form
  is **grade × substantiality** (`maxRichness × (1 − e^(−S/K))`), which
  preserves the MAX's correct reading of source quality and gates it on
  commanding a real district.
- **Honest macro shift under the flags** (pop −23 %, settlements −20 %,
  cities 16 → 20): the inflated MAX endowments were propping up craft
  output everywhere; scarcity removes that subsidy. `npm run validate` under
  both flags: **all hard gates pass**, 1 soft warning (Zipf n/a — 13 cities
  > 50 urban at 21k, within the 2-warning budget).
- Remaining for Stage 1+: ~39 % of towns' single biggest export line is
  still the flat "Baseline" — that line only disappears when real per-good
  production replaces the scalar (Stage 1).

Repro:
```
SIM_TUNE="RES_SCARCITY=1,SPEC_RELATIVE=1" node tools/probe_settlement_econ.mjs 20000 8817 480 240
SIM_TUNE="RES_SCARCITY=1,SPEC_RELATIVE=1" npm run validate
```

### Stage 0 cross-seed battery (2026-07) — PASSED, default-flip ready

- Stylized suite under both flags: **3/3 seeds** (8817, 4242, 777) pass all
  hard gates; each shows the same 1 soft warning (Zipf n/a — few cities > 50
  urban at 21k, within the 2-warning budget, the known era-dependent softie).
- Seed-1234 probe replicates the Stage 0 metrics: entropy 1.27 → **2.10**
  bits; top-10 endowment breadth down at every threshold (4.0/3.0/1.4 →
  3.2/2.1/1.1). Macro drift is **seed-dependent, not systematic**: pop fell
  ~23 % on 8817 but ROSE ~37 % on 1234 (15.4k → 21.1k).
- The default flip is a judgement call for the owner; mechanics are ready.

## Stage 1 — LANDED (2026-07)

Shipped behind `T.GOODS_PRICES` (+ `GOODS_PRICE_ADAPT` 0.05,
`GOODS_LABOUR_ADAPT` 0.02, `GOODS_ELAST` 0.5), **default 0** (byte-identical
off; smoke green with the layer in the import graph). New `goods.js`: the
8-good vector per settlement — production, demand, damped local scarcity
price, and profit-seeking craft labour shares — exactly as specced, with
capabilities REUSING the scalar recipes (exported `craftLegs`, the
food/materials fractions, the luxury budgets) so the layers can't drift.
`_gPrice`/`_gShare` persist. Trade is still the scalar flow.

Measured at 480×240 / 8817 / 20 000 steps, all three flags on:

- **Real spatial price gradients per good** (min/med/max): staple
  0.25/0.25/4.00 — breadbaskets at the floor, famine towns at the cap; metal
  0.25/1.98/4.00 — dear wherever forge-less; cloth 0.25/0.44/1.89 —
  glutted; luxury 0.25/1.87/4.00. This dispersion is the gradient Stage 2
  trades against, now observable per settlement.
- **Demand-responsive specialisation**: the price-weighted pick reshapes the
  mix (entropy 2.12 bits): Crafted wares 29.6 %, Services 24.5 %, Metalwork
  24.5 %, Pottery 18.4 %, **Textiles 3.1 %**.
- **Known Stage-1 artifact (recorded, not a bug): local-only prices
  undervalue EXPORT industries.** Textiles fell 36 % → 3 % because every
  town's *local* cloth market is glutted (median 0.44) — with no goods
  trade, no town can justify an export loom. The historical textile belts
  were export industries; they should return exactly when Stage 2 lets a
  cloth-cheap town sell into cloth-dear regions. If they don't, THAT will be
  a real finding about the demand constants.

Repro: `SIM_TUNE="RES_SCARCITY=1,SPEC_RELATIVE=1,GOODS_PRICES=1" node
tools/probe_settlement_econ.mjs 20000 8817 480 240`

## Stage 2 — LANDED (2026-07)

Shipped behind `T.GOODS_TRADE` (requires `GOODS_PRICES`), **default 0**
(byte-identical scalar flow off; smoke green). Per-good flows down the price
gradient replace the symmetric exchange; money rides the same audited
`sellGoods` path (now returning its applied scale, with per-good booking
channels); imports/exports feed next-tick prices; Hume compA/compB,
demandMul and the luxury overlay retire on this path (their jobs emerge
from the prices). Measured at 480×240 / 8817 / 20 000, all four flags:

- **F2 FIXED — buy ≠ sell.** Asymmetry index (0 = the old mirror, 1 = pure
  one-way): **goods 0.80, materials 0.73, luxury 0.95.** The baseline's
  big cities sat at ~0.05 (sell 30 / buy 33). Every settlement shows a
  directed flow signature (ore towns export ore, cloth-short towns import
  cloth, luxury coasts export to inland consumers).
- **Prices equalise across the network**, up to transport cost: metal
  median 1.98 (Stage 1, autarky) → **0.90**; ore → 1.00; visible already
  at 3k steps (ore max 2.24 → 1.42). The self-flattening gradient IS the
  trade system working.
- **Gates:** stylized all hard gates pass (same 1 soft Zipf-n/a warning,
  within budget); smoke (defaults) byte-identical. Macro: wealth 259k vs
  301k baseline — one-way flows move less gross coin than the old
  symmetric churn, as expected.
- **Pre-registered test result — textiles did NOT recover (0 %).** The
  spec's Stage-1 note said a non-recovery would be a real finding, and it
  is: cloth capability carries a universal CLIMATE floor (0.2 + wool/cotton
  in craftLegs — untouched by RES_SCARCITY, which grades deposits, not
  climate), so no region is cloth-POOR, the glut is world-wide (median
  0.55, max 1.83), and no price gradient can justify an export loom. What
  made Flanders/Florence was that most regions could NOT make fine cloth.
  The missing mechanism is cloth QUALITY/skill grading (or wealth-elastic
  clothing demand — real consumption rose steeply with wealth); build one
  of those, don't inflate a constant. → Stage 3/4 candidate.

Repro: `SIM_TUNE="RES_SCARCITY=1,SPEC_RELATIVE=1,GOODS_PRICES=1,GOODS_TRADE=1"
node tools/probe_settlement_econ.mjs 20000 8817 480 240`

Remaining stages: **Stage 3** — metal production CONSUMES ore (the physical
chain; ore demand is already priced and flowing, so this is now a small
step: gate `prod[metal]` on ore availability = local + imported). **Stage
4** — temperament→demand coupling, luxury re-sizing, cloth quality, shocks
via prices, UI panel for the goods table.

## Stage 3 — LANDED (2026-07)

Shipped behind `T.GOODS_CHAIN` (requires `GOODS_PRICES`; `GOODS_TRADE` makes
imports exist), **default 0** (byte-identical off; smoke green). Metal
capability is skill-limited (reach-capped metallurgy × the same `METAL_W`
craftLegs uses); production gates on ore availability = own extraction +
imports; ore demand reads the UNGATED desired metal so the starved smith
keeps bidding — the bid is the signal that ships the ore. Measured at
480×240 / 8817 / 20 000, all five flags:

- **Ore becomes a real industrial input: median price 1.00 → 1.87**, spread
  0.25–4.00 — cheap at the mining districts, dear at the forges, bid up by
  smiths who consume it. Ore-import flow lines appear across the network
  (Sheffield lives: connected smiths run on shipped ore; cutting the route
  strangles the forge).
- Asymmetry holds (goods 0.81 / materials 0.77 / luxury 0.99); entropy 2.03
  (Pottery 28 %, Metalwork 27 %, Crafted wares 26 %, Services 18 %).
- **Gates:** stylized all hard gates pass (same 1 soft Zipf warning); smoke
  byte-identical. Macro: wealth compresses further (156k) — the chain is a
  real constraint on what was previously free metal output; where total
  wealth should sit is a Stage-4 calibration question for when the scalar
  and goods layers unify.
- The textile finding stands (0.9 % — one town): cloth quality/skill
  grading remains the missing mechanism.

Repro: `SIM_TUNE="RES_SCARCITY=1,SPEC_RELATIVE=1,GOODS_PRICES=1,GOODS_TRADE=1,GOODS_CHAIN=1"
node tools/probe_settlement_econ.mjs 20000 8817 480 240`

## Stage 4 slice — LANDED (2026-07): cloth quality, temperament demand, lux lever

Three separable mechanisms behind `T.GOODS_CLOTHQ` (0/1), `T.GOODS_TEMPER`
(weight) and the exposed `T.LUX_SUPPLY_RATE` (default unchanged), all
byte-identical off. Measured at 480×240 / 8817 / 20 000, seven levers on
(`…,GOODS_CLOTHQ=1,GOODS_TEMPER=0.5`):

- **THE LOOMS RETURN — and are earned.** Market cloth = fine cloth (skill-
  gated supply, monetization-gated demand; homespun stays real but
  unmarketed). Textiles: 0 % → **20.5 %** of specialties; cloth median
  price 0.44 (glut) → 2.88 (autarkic scarcity, 3k) → **0.94 with 0.25–4.00
  spread** (mature trade — equalised, with the gradient that sustains the
  export loom). 15 settlements carry cloth in their flow signatures.
- **Peak diversity: entropy 2.28 bits of 2.32 max** — Metalwork 25.6 /
  Crafted wares 23.1 / Textiles 20.5 / Services 18.8 / Pottery 12.0. The
  most balanced specialty map of the arc, from geography × skill × demand.
- **Asymmetry strongest yet:** goods 0.93 / materials 0.84 / luxury 1.00.
- **Gates: all hard gates pass; soft budget now EXACTLY spent (2/2).**
  Besides the known Zipf-n/a, `population ~ development` loosened to 0.65
  (from 0.90): towns now prosper on trade position and skill, not farm
  development alone — realistic in kind (Venice), but it puts the stack at
  the warning line. The calibration pass must tighten this before any
  default flip.

Repro: `SIM_TUNE="RES_SCARCITY=1,SPEC_RELATIVE=1,GOODS_PRICES=1,GOODS_TRADE=1,GOODS_CHAIN=1,GOODS_CLOTHQ=1,GOODS_TEMPER=0.5"
node tools/probe_settlement_econ.mjs 20000 8817 480 240`

**Seven-lever cross-seed battery (2026-07): PASSED.** Stylized under the
full stack: 2/2 seeds (4242, 777), each with only the known Zipf-n/a softie
— the pop~development 0.65 warning was an 8817 outlier, not systematic.
Seed-1234 probe replicates the whole signature: entropy 2.24, Textiles
17.9 % (the looms return cross-seed), asymmetry 0.97 / 0.95 / 1.00.

**In the app:** the settlement card now carries a **Local market** section
(worker mirrors `_gPrice/_gShare/_gNet`; dormant when the levers are off) —
all eight goods priced (dear = scarce here), the top net flows, and where
craft labour leans. Verified by dev build + headless ui_smoke (exit 0).

**Stage 4 remainder (not started):** layer unification (exportValue derived
FROM the goods vector; craftLegs' in-hand ore gate retires in favour of the
chain) and the calibration pass (wealth scale, per-capita constants, the
pop~development softie) — **deliberately deferred until the fiat arc
(industrial-transition branch) merges: its total-output T-measure prices
the same output the unified exportValue would define, so the two need ONE
joint calibration, not two.** Then: shocks-via-prices demo, the
settlement-panel goods table (UI/worker snapshot), luxury re-sizing via the
now-exposed lever, and the full cross-seed battery for any default flips.

## Beyond Stage 4 — the nine-lever batch (2026-07)

Owner said "do all of it"; landed in three commits, every lever default 0 /
byte-identical off (smoke green with all the touched paths — knowledge,
conquest scoring, events, worker):

- **T.GOODS_FREIGHT** — per-good value density (ore 3×, luxury 0.15×); trade
  RANGE per good becomes an output (von Thünen). Bulk spreads widen, luxury
  untouched (measured 3k A/B).
- **T.ARMY_PROCURE** — war burns kit: army metal demand × live warLevel
  (cached on the polity). The war economy through prices.
- **T.GOODS_STOCKS** — entrepôts shelve and re-export: multi-hop trade, the
  spread-minus-freight profit of position; stock decays, stays off the local
  price. Measured buffering: ore max 4.00 → 2.65 (3k).
- **T.GOODS_INVEST** — spare wealth buys depreciating craft capacity from
  LIVE partners (closed supply, the construction pattern). The growth engine;
  at the full stack, wealth hits the arc's high (387k) with pop back at
  baseline (36.2k — the Stage-0/4 macro drift is GONE with investment on).
- **T.RESOURCE_WARS** — absorption pressure reads the price map (cheap-there,
  dear-at-my-capital, gap ≥ 0.5); biases WHICH neighbours a dominant realm
  erodes, never creates dominance.
- **T.INDUCED_INNOV** — dear staple/metal/materials pull the agronomy/
  furnace/mason tracks (one-sided; gluts never punish).
- **Chronicle**: `market.dearth` / `market.boom` events from sustained
  crisis-band prices (log-only, fires only with the layer on).
- **Snapshot**: `_gPrice` mirrored for every settlement — the painted
  price-map lens is DEFERRED to the UI arc (canvas work); data is ready.
- **tools/probe_priceshock.mjs** — sack the top luxury exporter: victim
  price 0.59 → 0.86 in 500 ticks, ring-1 +0.07, ring-2 flat, absorbed by
  ~2000. Distance decay AND market resilience, both emergent.

**Twelve-lever battery (8817, 20k):** smoke green; validate all hard gates,
1 soft warning — now a MEASURED Zipf slope (−0.60, 21 cities; the known
ONE_POP compression topic) instead of n/a. Entropy 2.25 (Services 28.5 /
Textiles 23.8 / Metalwork 21.5 / CW 14.6 / Pottery 11.5); asymmetry goods
0.91 / luxury 0.99. *Measurement caveat:* materials asymmetry reads 0.29
because CAPITAL-GOODS purchases (GOODS_INVEST) book on the same channel as
materials trade — a labelling overlap, not mirror trade; split the channel
when the calibration pass lands.

Still deliberately parked: layer unification + the F8 calibration (JOINT
with the fiat arc after it merges), the painted price lens, default flips
(owner's call), and the ultracode-scale cross-seed × cross-lever matrix +
adversarial pre-merge review when the owner calls for them.

## Open questions (decide before Stage 2)

1. **Grain:** ~~unify into the market, or leave on the food hierarchy?~~
   **DECIDED 2026-07 (owner):** grain STAYS on the food hierarchy — it's tuned
   and load-bearing for city formation. The market carries only the tradable
   `staple` *surplus* (what's left after the hierarchy feeds the tree), so the
   two never double-count. Stage 2 must subtract the hierarchy's shipped grain
   from the market-side `staple` supply.
2. **Good count:** is 8 the right granularity, or split ore by metal / add
   `livestock`+`horses` as a 9th (military input)? Start at 8; add only if a
   stage needs it.
3. **Price → inflation coupling:** keep `localP` (monetary index) fully separate
   from good prices, or let the good-price vector *feed* the monetary index?
   (Leaning: separate for now; revisit in Stage 4.)
4. **Persistent stocks:** stay pure-flow, or add small inventories so shortages
   have memory (a besieged city drawing down granaries)? (Leaning: pure-flow
   through Stage 3; reconsider with shocks in Stage 4.)
