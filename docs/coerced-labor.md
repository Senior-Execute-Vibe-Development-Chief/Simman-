# Coerced labour: slavery, cash crops & serfdom — design spec

Status: **implemented, default-on** (slavery.js + updateCoercedLabour; levers T.SLAVERY / T.SLAVE_RAID / T.CASH_CROPS / T.SERFDOM). Originally a plan for adding coerced labour as a real
economic factor, not a relabel of `people`.

---

## 0. The design principle (why this isn't redundant)

`people` already farms, levies, taxes and produces. A second labour stock that does
the same is cosmetic. Coerced labour earns its place only by doing what free
population **structurally cannot**:

1. **Decouple labour from amenity.** Free pop only grows where it's fed and livable
   (carrying-capacity/Locality model). So the sim today *cannot* make a malarial sugar
   coast or a 4,000 m silver mountain productive — no free pop would ever live there.
   Coerced labour is the mechanism to *force* labour onto high-value / low-amenity land.
2. **Divert land from food to CASH CROPS.** Slaves on land don't add food — they grow
   sugar/cotton/tobacco, so the land stops feeding itself and the settlement must
   **import food**. New demand, not a duplicate of the food economy.
3. **Owner-concentrated, non-citizen surplus.** Free pop consumes most of its output;
   the unfree are held at subsistence and *all* their product flows to the owner. So
   their output becomes concentrated owner wealth, they don't count as the political
   nation, and they add **revolt risk** and a **demographic sink** (they die in
   mines/plantations → resupply demand → this is what *sustains* the slave trade).
4. **People as a trade commodity** — selling captives is an income stream that produces
   nothing (the slaver middleman).

**Corollary:** slavery is only worth adding if we ALSO add the demand sinks it serves
(cash crops + slave-intensified mining). Without those it's a relabel.

Everything below is gated on **state** (climate, deposits, military power, wealth,
labour scarcity, trade reach) — never on time/era/year (the cardinal rule). The
"Atlantic plantation complex" emerges when a polity has the *reach* to connect a labour
source to a cash-crop region, on any map — not on a date.

---

## 1. Data model

Per settlement (persist in `SETT_FIELDS`):
- `_unfree` — stock of coerced labourers (a shadow population, separate from `people`).
- `_cashFrac` — 0..1 share of the settlement's arable committed to cash crops vs food.
- `_slaveDecayCredit` (optional) — smoothing for resupply demand.

Per settlement (derived, not persisted): `_cashSuit`, `_labourDemand`, `_unrestSlave`.

No new polity/gov fields required for the core; serfdom reuses `FARM_RENT`.

---

## 2. Mechanic A — the unfree-labour stock

`_unfree` is labour the settlement OWNS. Distinct from `people` in every way that matters:

- **Feeds at subsistence.** Adds to `_foodDemand` at a per-capita rate `SLAVE_FEED`
  (≤ free per-capita). If unfed → starvation decay (existing food-short machinery).
- **Not citizens.** Excluded from: army levy / loyal force (`settlementPower`'s military
  term), the tax base (they hold no wealth), the political `people` count, and
  carrying-capacity *consumption* (they don't grow the free population).
- **Produces** in coerced sectors only (cash crops, mines, optionally urban crafts) —
  output flows to settlement wealth (the owner).
- **Demographic sink.** Decays at `SLAVE_DEATH × harshness` (mines/plantations are
  lethal; domestic/mild is ~0). Net resupply need = decay − any natural increase. This
  is the demand that drives the trade.
- **Revolt risk.** Unrest term `gSlave = SLAVE_UNREST × clamp(_unfree / (people+_unfree))`
  folded into the existing unrest sum (conquest.js unrest loop). A high unfree ratio with
  a weak garrison → revolt (reuse `rebel()`): output collapses, `_unfree` is freed/killed,
  the settlement is wrecked (Haiti/Zanj/Spartacus).

Hooks: `computeExportValue` (production), conquest.js unrest loop (revolt), the food
demand calc (`_foodDemand`).

---

## 3. Mechanic B — cash crops (the missing production mode)

The heart of the system. A new export sector distinct from food and from textile fibre.

**Suitability** (climate, like cotton but broader — tropical export crops):
```
cashSuit = warmWet(temp, moist)            // sugar/coffee: hot & wet
         + 0.5 * dryFibre(temp, moist)     // cotton: warm, less wet
   // 0 in temperate/cold/arid; peaks on hot wet coasts
```

**Land allocation** (the food-vs-cash tradeoff, emergent):
`_cashFrac` drifts toward a target each pass:
```
target = cashSuit-gated max  ×  food-security gate
food-security gate = how safely the settlement can source food for its people if it
                     stops growing its own (surplus on hand OR a food-trade link to a
                     breadbasket). Low food security → it dare not convert → stays
                     subsistence.
```
So a plantation emerges only where **(a) suitable + (b) can import food + (c) has labour** —
exactly the Caribbean. Food output is scaled by `(1 - _cashFrac)`; the freed land grows
cash crops instead.

**Output** (labour-gated — peasant cash-cropping is modest; the PLANTATION needs coerced
labour):
```
cashOut = cashSuit × _cashFrac × arableScale
        × (FREE_CASH + COERCE_CASH × _unfree / max(1, people))
```
Without `_unfree`, a small free-peasant cash crop; with slaves, full plantation output.

**Booking:** cash crops were colonial semi-luxuries (sugar, tobacco, coffee) → book as a
new `IN_CASHCROP` ("plantation goods") for archetype visibility, or fold into `IN_LUXURY`
(decision §8). Output → settlement wealth (owner), NOT free-pop growth.

**Consequence (the new dynamic):** a plantation settlement has small free pop + large
`_unfree` + high wealth + **food imports** + revolt risk. The food imports feed your
breadbasket & carrying-trade archetypes (provisioning trade).

Hooks: `computeExportValue` (add the leg + scale food by `1-_cashFrac`), `getExportBreakdown`
(panel), the food-supply calc.

---

## 4. Mechanic C — mining intensification (the existing slot)

The sim already mines specie from finite deposit reserves (settlement.js wealth pass,
`depositReserve` depletes). Coerced labour intensifies it — Potosí.

```
mineRate *= 1 + MINE_COERCE × (_unfree_in_mining / scale)
```
More specie extracted, **reserves deplete faster**, and mining is high-`harshness` so
`_unfree` decays fast there → constant resupply. A slave-mine boom town: rich, deadly,
hungry for more slaves, and short-lived (the seam runs out).

Hook: the mining/extraction function in settlement.js. Smallest, quickest real effect.

---

## 5. Mechanic D — the slave trade (supply, demand, the middleman)

Three parties, all emergent:

**Supply (capture).** Captives come from violence:
- On a sack/raid (armies.js `_sackedAt`), `CAPTURE_FRAC × victim.people` is removed from
  the victim (depopulation → the raided march empties toward terra nullius) and enters the
  **slave market** as captives held by the captor.
- A **slaver/middleman** polity raids specifically to SELL (Dahomey/Crimea/Aro): it holds
  captives as tradeable stock, not labour it uses itself.
- (Depends on the *plunder* layer for the raid action; until then, seed capture from the
  existing sack hook so this is testable.)

**Demand.** A settlement "wants" slaves when it has unmet coerced-labour demand —
`labourDemand = cashSuit + mineAccess`, gated by wealth to pay — minus current `_unfree`.

**Flow.** Piggyback the trade graph: captives flow from supply (slaver stock) toward the
highest-paying demand (plantation/mine settlements within trade reach), coin flowing back.
- Seller (slaver) books `IN_SLAVE_TRADE`; buyer books `OUT` + gains `_unfree`.
- Conserved: people are *moved* (captor→buyer), coin is *moved* (buyer→slaver). Nothing
  minted.

**Archetype:** the slaver state lives on selling people, produces little itself, and
depopulates its victims. The buyer is the plantation/mine economy.

Hooks: armies.js (capture on sack), a new `updateSlaveTrade(world)` pass (like
`updatePilgrimage`), money.js categories.

---

## 6. Mechanic E — serfdom (land-tenure coercion; related, separable)

Serfdom is not chattel slavery — it's bound peasants owing heavy labour-rent. The sim
already has `FARM_RENT` (a levy on harvest). **Serfdom = high-coercion `FARM_RENT`** at the
settlement level:
- A `_serf` tenure flag/level raises harvest extraction (more surplus to the lord/state →
  exportable grain) BUT suppresses free-pop mobility/urbanization and **raises unrest**.
- **The plague fork** (emergent payoff): a population shock (shocks.js plague) makes labour
  scarce. Where the lord/state is weak → serfdom *breaks* (wages rise, peasants flee/bargain
  — Western Europe). Where coercion is strong + export pressure high → serfdom *tightens*
  (the second serfdom — Eastern Europe). Same shock, opposite outcomes, gated on coercion
  capacity + export pull. No time gate.

Separable from chattel slavery; can land in a later step. Lowest-risk (it's a `FARM_RENT`
modifier).

---

## 7. Emergent dynamics this unlocks (the payoff)

- **Plantation economies** on tropical coasts: export-rich, food-importing, slave-importing,
  revolt-prone, owner-concentrated wealth.
- **Slave-mine boom towns** at ore/precious deposits: specie booms, deadly, resupply-hungry,
  bust when the seam depletes.
- **Slaver middleman states** on the frontier between a raiding power and a rich market:
  income = selling captives; their victims' regions depopulate (terra nullius).
- **Provisioning trade**: plantations drive grain imports → links to breadbaskets & the
  carrying trade.
- **Slave revolts** where the unfree ratio is high and the garrison thin (Haiti).
- **The plague labour-fork**: West frees, East binds.
- **Inequality**: plantation/mine wealth concentrates in a tiny owner class.

All driven by climate, deposits, military reach, wealth and labour scarcity — never a date.

---

## 8. Income categories (money.js)

Add (decision point — category bloat vs visibility):
- `IN_SLAVE_TRADE` — selling captives (the slaver). **Recommended.**
- `OUT_SLAVE` — buying slaves. **Recommended** (pairs the trade).
- `IN_CASHCROP` ("plantation goods") — OR fold cash crops into `IN_LUXURY`.
  **Recommendation: fold into luxury** to limit bloat (sugar/tobacco *were* luxuries),
  unless we want the plantation archetype to headline distinctly.

Money rates aren't persisted, so adding categories is save-safe.

---

## 9. Levers (tuning.js)

| Lever | Default (proposed) | Role |
|---|---|---|
| `SLAVERY` | 1 | master on/off |
| `CASHCROP_W` | ~0.9 | cash-crop output weight |
| `COERCE_CASH` | ~1.5 | how much coerced labour multiplies plantation output |
| `MINE_COERCE` | ~1.0 | slave-mining intensification |
| `SLAVE_FEED` | ~0.6 | unfree per-capita food need (vs free = 1) |
| `SLAVE_DEATH` | ~0.01 | base attrition × harshness |
| `SLAVE_UNREST` | ~0.4 | revolt pressure from a high unfree ratio |
| `CAPTURE_FRAC` | ~0.15 | share of a sacked/raided pop taken captive |
| `SLAVE_TRADE_W` | ~0.02 | slave-market flow rate |
| `SERF_RENT` | ~1.6 | serfdom extraction multiplier on FARM_RENT |

---

## 10. Build order (each step self-contained + validatable)

**Step 1 — the production heart.** `_unfree` stock + cash-crop mode + mining
intensification + feeding/decay/revolt. *Seed* `_unfree` via a simple wealth-gated
acquisition (abstracting the trade) so it's testable in isolation.
- Gate: smoke (determinism, save/load with new fields), `npm run validate` (all hard
  gates; watch population — cash crops divert food, so confirm no famine collapse and that
  food-import demand appears), and a probe showing plantation/mine archetypes emerging on
  the right geography.

**Step 2 — the real supply chain.** Replace abstract acquisition with the slave TRADE:
capture-on-sack → slaver stock → demand-driven flow → buyer. The middleman archetype +
depopulation of source regions.
- Gate: smoke + validate; probe showing captives flowing source→slaver→buyer, slaver
  income, and source depopulation.

**Step 3 — serfdom + the plague fork.** `FARM_RENT` coercion + the labour-scarcity fork.
- Gate: smoke + validate; probe showing the West-frees / East-binds split after a plague.

(Step 1 pairs naturally with the **plunder** layer for a richer capture supply, but doesn't
require it — the existing sack hook suffices to seed Step 2.)

---

## 11. Open decisions for review

1. **Scope now:** Step 1 only (prove the niche), or Steps 1–2 (full supply chain)?
2. **Cash-crop category:** distinct `IN_CASHCROP`, or fold into `IN_LUXURY`?
3. **Urban/domestic slavery** (slaves in `craftLegs`, displacing free labour — Rome): include,
   or keep coerced labour to plantations+mines first?
4. **Revolt severity:** do successful revolts found a *free* successor settlement (maroon /
   Haiti), or just wreck output? The former is more emergent but more work.
5. **Framing:** modelled as factual economic history — costs (death, depopulation, revolt)
   shown honestly, not sanitised or glorified. Confirm this is the intent.
