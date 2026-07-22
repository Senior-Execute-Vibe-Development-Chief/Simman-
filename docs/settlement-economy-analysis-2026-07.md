# Settlement economy: is it realistic, or flat and boring?

**Date:** 2026-07 · **Method:** watched the emergent economy at 480×240,
seeds 8817 (20 000 steps) and 1234 (14 000 steps), via
`tools/probe_settlement_econ.mjs`. The probe dumps, per settlement: site
(climate/water/resources), the specialty it locks into, its export mix, its
actual money-in / money-out by channel, its trade partners, and its realm's
temperament — plus world-wide aggregates (income composition, specialty
distribution).

**Verdict:** the intuition is right. There is a *lot* of economic machinery
(comparative-advantage specialisation, agglomeration lock-in, luxury trade,
food hierarchy, entrepôt brokerage, Hume price-specie-flow, FX, tolls, cash
crops, slavery) — but at the level you actually *look at a town*, the output
is flat: two kinds of town, everyone trades the same abstract "goods" both
ways, and the biggest cities are the least distinctive. Below is what's
wrong, each tied to the mechanism that causes it. None of the fixes are
outcome-fitting — they repair the systems that should have produced variety.

---

## What the economy actually *is* (the one-paragraph model)

Every settlement computes a single scalar `exportValue`
(`computeExportValue`, settlement.js) from a handful of sectors — a primary
sector (grain/forage/fish + timber/stone/salt/horses) and five craft legs
(Textiles, Metalwork, Pottery & leather, Crafted wares, Services & records).
Trade is then **abstract money flow along the export-value gradient**
(`runGeneralTradeBetween`, roads.js:969): for every connected pair, *both*
sides sell `exportValue × gravity × …` to each other and pay for what they
buy. Goods are never matched commodity-to-commodity; the flow is booked into
three display buckets (food / materials / goods) after the fact. On top sit a
luxury overlay (spices/furs/incense/dyes + cash crops) and a central-place
food hierarchy. The trade panel itself concedes it can't name per-route goods
because "a goods label would be fiction" (settlement.js:1211-1215).

That single design choice — trade as a symmetric scalar flow, not a matching
of what-I-make against what-you-lack — is the root of most of what follows.

---

## Findings

### F1 — Specialisation collapses to two buckets; the picker is miscalibrated

Across **both seeds**, of five craft sectors only three ever win, and two
dominate ~90 %:

| specialty            | seed 8817 (128 towns) | seed 1234 (84 towns) |
|----------------------|:---------------------:|:--------------------:|
| Crafted wares        | **64.8 %**            | **50.0 %**           |
| Textiles             | 31.3 %                | 38.1 %               |
| Pottery & leather    | 3.9 %                 | 9.5 %                |
| Metalwork            | 0 %                   | 2.4 %                |
| Services & records   | **0 %**               | **0 %**              |

**Mechanism.** The comparative-advantage pick (settlement.js:1065-1066) ranks
sectors by `legs[k] / CRAFT_REF[k]`. Work the algebra with the actual
constants (settlement.js:527-553):

- **Crafted wares** score `= (construction·0.3) / 0.3 = construction` → ≈ 1.0
  for any developed town (construction saturates).
- **Metalwork** score `= min(metallurgy, oreTier)·1.9 / 1.9 = min(metallurgy,
  oreTier)` → capped at `oreTier` ≤ 0.9 (iron) / 0.65 (bronze) / 0.30 (copper).
- **Services & records** score `= org·popScale²` → ≤ ~0.9 even for a maxed
  metropolis.
- **Textiles** only clears 1.0 in a genuinely fibre-rich temperate belt.

So **"Crafted wares" wins by construction-saturation, and Metalwork/Services
are *structurally capped below it and can essentially never win*.** The
"specialty" 50-65 % of towns lock into is the *smallest* leg in absolute terms
(`construction·0.3`) — indeed the world's single biggest export line is
literally **"Baseline"** (the flat 1.0 everyone has) for ~half of towns
(49-58 %) and Textiles for the rest. The agglomeration lock-in (Florence→wool,
Toledo→steel, Murano→glass — its stated goal, settlement.js:585-587) is being
applied to a sector that is a rounding error in the town's real output. There
are effectively **two kinds of town**: "textile town" and "generic
crafted-wares town." No metal cities, no commercial/financial hubs, no
distinctive craft towns — the exact variety the machinery was built to make.

### F2 — Buy ≈ sell: no division of labour

Because both partners sell their export scalar to each other every pair
(roads.js:957, 1028-1029), a town's imports are a near-mirror of its exports.
From the seed-8817 symmetry table (\$/tick):

```
                goods sell / buy      food sell / buy
Pogduttotpok      47.8 / 40.4          36.9 / 10.7
Gyihidi           63.5 / 81.6          51.1 / 40.2
Kyakyigyo         61.6 / 80.0          60.3 / 55.6
```

Every city both **sells and buys "goods"** in comparable amounts, and most
both sell and buy food. "What a town buys" is not driven by "what it lacks" —
it's the same basket it sells, scaled by the export-value difference. Real
economies run on complementarity (a manufacturing town imports food and raw
materials, exports finished goods); here the flow is symmetric by
construction, so that structure can't appear.

### F3 — Endowments homogenise as cities grow, so the biggest cities are the least distinctive

The top cities each sit on **8-10 resources at once**:

```
Pogduttotpok: timber spices precious dyes stone salt gems tin iron
Bofvu:        spices timber copper stone iron gems salt horses tin dyes
Gyihidi:      tin incense salt timber spices dyes stone iron
```

**Mechanism.** `localRes[id] = MAX over every territory tile`
(territory.js:499, 515), and `effectiveLocalRes` takes the **MAX again across
all trade peers** (settlement.js:495-509). So the more land a city controls and
the more partners it has, the closer its endowment gets to "a high value of
everything." Scarcity — the thing that *creates* comparative advantage —
evaporates exactly where trade matters most. There is no "tin comes from
*there*," no spice islands; the big hubs each have their own tin, spice, dye
and metal. When everywhere has everything, there is nothing to specialise
*away from* and nothing to trade *for*.

### F4 — The luxury sector is oversized and, again, symmetric

Luxuries are **15-17 % of all world income** and the **#1 income line for most
big cities** (Gyihidi luxuries-sold 161/tick vs its entire manufacturing
export value ≈ 4). Yet the same cities are also the top luxury *buyers*
(Gyihidi buys 90, Kyenevon 141, Kyakyigyo 53). **Mechanism:**
`LUX_SUPPLY_RATE = 4.0 × luxRes × √pop` (settlement.js:153, 804) makes a city
that happens to sit on spices+incense+dyes earn more from luxury than from all
its crafts combined, and F3 means nearly every rich coastal city *does* sit on
luxuries — so everyone both produces and consumes them. Historically luxuries
were a thin, high-margin sliver flowing *asymmetrically* from a few producers
(the Moluccas produce spice and consume little) to many consumers (courts that
produce none). Here it's a fat, symmetric layer.

### F5 — No supply chains / intermediate goods

Metalwork requires ore **in the town's own tile** — `oreTier` reads
`localRes`, "you forge from ore in hand" (settlement.js:512-526). A town wired
to a rich mining neighbour still can't become a smithing centre; there is no
ore→metal→tools chain, no timber→ships, no fibre→cloth-sold-to-a-dyer. Every
sector is a self-contained function of local endowment × knowledge × pop.
Sheffield importing ore, Venice's Arsenal importing timber, a weaving town
buying a dyer's output — none of that shape is representable.

### F6 — Temperament neither varies among the winners nor shapes production

7 of the top 8 cities (seed 8817) are **"Mercantile"**; the commerce prior
`0.3 + water·0.5 + lux·0.6 + nav·0.2` (personality.js:133-138) pushes exactly
the high-water/high-luxury sites — i.e. every eventual big city — toward
commerce, so the trait collapses among the survivors. And even where it
varies, `commerce` only tweaks **road-building appetite** (`commerceMul`,
roads.js:743); it never changes *what a town makes or trades*. A "Mercantile"
realm and a "Martial" one produce the same export mix from the same geography.

### F7 — Per-route goods are admitted fiction; the barter labels are cosmetic

The panel can't say what moves on a route ("would be fiction",
settlement.js:1211), so it falls back to `topBarterGood` — the richest raw
resource the partner lacks (settlement.js:1218-1228). In practice this prints
near-nonsense: `give copper / get -` (gives copper, receives nothing), and
almost every route is labelled with raw ore/stone/horses, never the
manufactured goods the town supposedly specialises in.

---

## Why it reads as boring (synthesis)

Variety in a real economy comes from **scarcity → specialisation →
complementary exchange**. This model weakens all three links:

1. **Scarcity** is erased by MAX-over-territory-and-peers endowments (F3).
2. **Specialisation** is funnelled into ~2 buckets by a miscalibrated picker
   (F1), touches no supply chain (F5), and is decoupled from temperament (F6).
3. **Exchange** is a symmetric scalar flow, so imports mirror exports and no
   division of labour emerges (F2); the one genuinely complementary channel,
   luxuries, is oversized and also made symmetric by F3 (F4).

The result: a map of near-interchangeable "Mercantile crafted-wares towns"
that all sell a bit of everything to each other and buy a bit of everything
back. All the sophisticated machinery underneath (Hume flows, entrepôts, FX,
cash crops) is real, but it's modulating one grey scalar instead of a textured
set of goods.

---

## Systemic fixes (mechanism-first — no outcome-fitting)

> **Status 2026-07:** the chosen direction is the goods-vector reframe —
> `docs/economy-goods-vector-spec.md`. Its Stage 0 (fixes #1 + #2 below,
> behind `T.RES_SCARCITY` / `T.SPEC_RELATIVE`, defaults off) has LANDED and
> measured: specialty entropy 1.11 → 2.19 bits, top-city endowment breadth
> halved — see the spec's "Stage 0 — LANDED" section for the A/B table.

Directions only; nothing here dials in a specific town's result.

1. **Re-normalise the comparative-advantage picker (F1).** The `CRAFT_REF`
   denominators must be the *actual maximum attainable* output of each leg so
   `leg/ref` is comparable across sectors — or pick on absolute contribution
   with a diversity term. Test: Metalwork and Services must be *able* to win
   where ore / city-scale genuinely dominate. This is a calibration of the
   mechanism, not a floor on any outcome.
2. **Stop homogenising endowments (F3).** For the *production/specialisation*
   read, don't MAX a resource across the whole territory and every peer; use a
   concentration-attenuated measure (a scarce resource present on 2 of 200
   tiles should read scarce, not maxed), so distinctive geography survives city
   growth. Keep the MAX-over-peers view only for the *knowledge cap*, where
   "can this culture know iron" is the right question.
3. **Make imports demand-driven (F2).** Split the symmetric both-sell flow so a
   town's *purchases* are weighted toward the sectors it's **weak** in (its low
   legs / its food or material deficits), and its *sales* toward its strong
   ones. Net complementary flow, not mirrored gross flow.
4. **One real supply link (F5).** Let production draw a scarce input from trade
   partners the way `effectiveLocalRes` already lets *knowledge* do — so an
   ore-poor but well-connected town can forge from imported ore, and the miner
   reads as an ore *exporter*. Even one such chain (ore→metal) would create the
   first genuine producer/processor pairing.
5. **Right-size and de-symmetrise luxuries (F4).** Lower `LUX_SUPPLY_RATE` so
   luxuries are a thin high-margin sliver, and gate a region's luxury *supply*
   on genuinely scarce endowment (post-fix F3) so producers are few and
   consumers many.
6. **Let temperament bias the trade/production mix (F6),** not just road
   appetite: a Mercantile realm leans entrepôt/services, a Martial one toward
   metal/horses. A gentle nudge on the sector weights, kept well below
   geography so it colours rather than dictates.

Fixing **F1 + F3** alone (the picker and the endowment homogenisation) would
already break the two-bucket monotony and give the map visibly different kinds
of town; F2 + F5 are what would make "what they buy vs sell" finally mean
something.

*Reproduce:* `node tools/probe_settlement_econ.mjs 20000 8817 480 240`

---

## RE-DIAGNOSIS 2026-07 — after the goods-vector arc (Stages 0–4 slice)

Same instrument, same depth (20k @ 480), seeds 8817 + 4242, seven levers on.
Scorecard against the original findings:

| finding | then | now |
|---|---|---|
| F1 specialisation collapse | 2 buckets, entropy 1.11; Metal/Services never win | **FIXED** — entropy 2.28/2.29; all five sectors 12–26 % on both seeds |
| F2 buy ≈ sell mirror | asymmetry ~0.05 | **FIXED** — 0.93/0.84/1.00 and 0.94/0.99/0.89; every card's buy-list differs from its sell-list |
| F3 endowment homogenisation | top cities 8–10 resources | **FIXED** — 3–4 graded resources; big cities are the *most* distinctive now |
| F4 luxury oversized & symmetric | #1 line everywhere, both ways | **MOSTLY FIXED** — one-way (asym 0.89–1.0); size awaits the LUX_SUPPLY_RATE calibration |
| F5 no supply chains | metal = own-tile ore only | **FIXED** — forge cities import ore at price 4.0 (Tyizuvtiv: iron 0.14 in hand, ore bid at the cap, labour leaning metal 0.35) |
| F6 temperament decorative | 7/8 top realms "Mercantile", no production effect | **FIXED** — labels vary (Raider-Republic, Trading Empire, …); temperament bids demand (GOODS_TEMPER) |
| F7 per-route goods fiction | "give copper / get −" | **FIXED in substance** — real per-good flow lines per settlement; the old barter labels linger in the panel and can now be retired |

**New finding, F8 — craft-trade VALUE is under-scaled.** The flows are real
and directional but THIN in coin: "goods sold" is 2.4 % (8817) / 1.6 %
(4242) of world income, and a Metalwork *specialist* metropolis earns
+0.02/tick on goods while living on taxes and war loans. Cause: the
per-capita demand constants put craft demand (and so surpluses) at ~0.1–3
units/tick where the old scalar shipped 40–300 coin/tick — a ~50–100×
scale gap between the goods layer's units and the coin economy. This is
precisely the CALIBRATION PASS already scoped (with layer unification,
after the fiat merge): size the per-capita constants so gross craft trade
carries a historical share of income. Mechanism right, units unfinished.

Minor: staple sits at the price floor almost everywhere (0.25–0.34) —
breadbaskets are glutted with no horizontal grain market by design (owner
ruling: hierarchy feeds, market carries surplus only); revisit only if
grain-export economies (Egypt→Rome) are wanted as visible trade.

**Verdict: the economy is no longer boring — it is legible, diverse,
directional, and mechanistic. What remains is one calibration (F8), not a
missing system.**
