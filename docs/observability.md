# OBSERVABILITY — every outcome of a run, and how to see it

**Purpose.** Debugging this sim has repeatedly meant writing a bespoke probe to answer
one question, then throwing it away. The 2026-07-31 session lost hours to hypotheses a
single number would have killed: the size loop's gain `k`, whether captures stick,
whether a hegemon exists at all. This document inventories **every outcome a run
produces**, and `tools/observe.mjs` (`npm run observe`) prints all of it from one
command.

    npm run observe                              # summary at step 9000, reference grid
    node tools/observe.mjs --steps=12000 --W=960 # the SHIPPED app grid (tw=480)
    node tools/observe.mjs --every=3000          # trajectory instead of a snapshot
    node tools/observe.mjs --nation=top          # one realm, EVERY field it has
    node tools/observe.mjs --nation=17 --json    # machine-readable
    node tools/observe.mjs --section=war,economy # just those
    node tools/observe.mjs --all                 # include pass workspace buffers

## Units: what the numbers mean

**A settlement is a CITY OR LARGE TOWN, never a village.** The village tier is implied
in the land — `popField` plus each settlement's `_ruralPop`. 230 settlements on an
Earth-sized world means 230 *cities*, not 230 towns total, and a realm with four
members is administering four *provincial centres*.

**1 sim-person = 1,000 people** (`POP_SCALE`, `src/sim/units.js`). Three population
scales exist and confusing them is this codebase's most repeated error:
`settlement.people` (sim units, ×POP_SCALE for people), `popField` (a different
internal scale), `_onePopScale` (the drifting bridge between them).

Quote `pop.people`, `pop.largestCity`, `pop.perKm2`. The raw series are deliberately
named `pop.censusSimUnits` and `pop.fieldUnits` so they cannot be mistaken for
headcounts — which they were, in a published analysis that reported 32M people and a
largest city "smaller than Çatalhöyük" when the true figures were 135M and 4.4M.

## The design rule: introspection, not a list

The tool carries **no hardcoded field list**. It walks the live world and reports every
typed array of length `N`, every numeric leaf on every entity class (to depth 2), every
Map/Set/Array by size, and histograms the event log. **Add state anywhere and it appears
here on the next run with no edit.**

That rule was violated in **three** places, all now closed, and they are worth
remembering together because they are one mistake wearing three faces —
**introspection is only ever as complete as the SHAPE it assumes**:

| | the walk assumed | what was invisible |
|---|---|---|
| one level **down** | entity fields are scalars | 234 numeric leaves per settlement |
| one level **out** | entities live in three registries | 5 of 8 entity classes |
| the **container** | state is a length-`N` array or a registry | all 61 world scalars, `deposits`, `_popLand` |

None was visible as a missing *number* — each was visible only as a missing
*dimension*, which is why they survived so long in a tool whose whole premise is
completeness. The standing question for whoever extends this is therefore never "did I
walk all the fields?" but **"what shape am I assuming, and what lives outside it?"**

This is not theoretical: the runtime histogram immediately surfaced five event kinds
that a `grep` over `logEvent(world, "...")` misses entirely — `ruler.crowned`,
`ruler.elected`, `industry.specialty`, `cradle`, `settled` — because they are emitted
through helpers rather than literals. A hand-maintained inventory would already be wrong.

The one curated list is `SCRATCH`: per-tile arrays that are pass **workspace** (Dijkstra
cost/prev/seen buffers, flood queues, component labels, double-buffer "next" arrays).
That distinction is semantic, so it cannot be detected — but it **fails open**: anything
not named is treated as an outcome and shown.

---

## The observable surface

### 1. Run identity
`seed`, grid (`tw`×`th`, land tiles, km²/tile), `step`, displayed year (cosmetic — see
the FIRST CARDINAL RULE), `_civYear`, `_dt`, entity and realm counts.

### 2. Tile fields — 85 length-N arrays, 48 of them outcomes
* **Terrain / climate (worldgen inputs, static):** `elev` `fert` `temp` `moist` `relief`
  `riverMag` `coast` `climMod` `_irrigable` `_rivNear` `_windX` `_windY` `tFlood`
  `tArrival` `_pastureCap` `_tropicBurden` `_agriCeil`
* **Population & capacity:** `popField` (the canonical people-on-land), `capField`,
  `_migSum` / `_migMove` (migration), `_popLand`
* **Technique & works:** `devField` (the diffusing agriculture wave), `worksField`
  (Boserupian built capital), `_soilFatigue`, `_fishTaken` (per-coast depletable stock)
* **Political:** `_countryOwner` (the authoritative political map), `_countryClaim`
  (the drawn/animated one), `_ctrlOwner` / `_ctrlHold` / `_ctrlEnter` (the control
  field), `_fpRel` + `_fpRelCut` (what was released and WHY — severed vs trimmed),
  `_fpWorked`, `_fpHome`, `_tileCapturedAt`, `_tileHomeland`, `_tileFellAt`,
  `_allegiance` (per-tile attachment), `_tileValue`, `_claimPress`
* **Economic geography:** `_territoryOwner` (the per-settlement economic catchment),
  `_terrClaimant`, `roadQuality`, `roadFlow`, `transportDist`, `_seaOwner`
* **Peoples:** `ancestry` (deep genetic stock), `ancHue`

### 3. Population
Σ `popField`, Σ census, the frozen bridge `_onePopScale`, people per km², urban vs
rural split, per-settlement census / `_urbanPop` / `_ruralPop` / carrying capacity
`s._k` distributions, and the largest settlements by census.

### 4. Nations — 17 country fields + 28 polity-record fields
Per realm: tiles and **real km²**, member count, governed people, wealth, treasury,
`_countryPow` (the coercive weight wars balance on), `_dominance`, `_manpower`,
`_armyPro`/`_armyCon`, `holdReach`, capital organisation, `_nomadic`, government form,
allies, active wars. Plus distributions over all realms and claimed-land fraction.

The polity record additionally carries the **lifecycle and fiscal** state: `foundedStep`
/ `endedStep`, `rulers[]` and `rulerId`, `houses`, `succLaw`, `_reignSince`/`_reignWars`
/`_reignCities`, `_dynLegit`, `_crisisAt`, `treasury`, `_revenue`, `_spend`, `_taxRate`,
`fineness`, `_solvency`, `chron` (chronicle milestone memory), `cultureId`, `faithId`,
`dynastyId`, `personality`.

### 5. Settlements — 166 fields per entity
Grouped by what they answer:
* **Identity//place:** `id` `name` `kind` `mode` `tier` `pos` `foundedStep`
  `parentSettlementId` `countryId` `liegeId` `_isCapital` `_isPort` `_provinceCity`
* **People:** `people` `_urbanPop` `_ruralPop` `_popPeak` `_planPop` `_govPeople`
  `_captives` `_unfree` `_unfreeRatio` `_serf`
* **Food:** `_foodSupply` `_foodDemand` `_civFoodDemand` `_landFood` `_pastoral`
  `_fishYield` `_storableSupply` `_foodPool` `_foodNet` `_foodHaul` `_foodImportRate`
  `food` `_grainHunger` `_grainPrice` `_harvestMul` `_famineUntil` `_k` `_foodK`
* **Land worked:** `_terrTiles` `_terrWorkTiles` `_terrFertSum` `_terrFarmedWt`
  `_terrWorksMean` `_soilFatigue` `_irrigation` `_alluvium` `_workable` `_buildableArea`
* **Economy:** `wealth` `_wealthDelta` `infrastructure` `_gPrice/_gProd/_gDem/_gStock/
  _gCap/_gNet` (8-good vector: staple, materials, ore, metal, cloth, wares, luxury,
  services), `_mIn`/`_mOut` (20 in / 14 out money channels), `_exportValue`,
  `_specKey`/`_specStr`, `localRes`/`_effRes` (13 resources), `_tradeReach`
* **Knowledge:** `knowledge{agriculture, construction, organization, metallurgy,
  navigation, mobility}` and `_techEff{22 derived effects}` — farmYield, reachLevel,
  logisticsLevel, military, walls, credit, seaRange, cohesion, …
* **Politics/military:** `loyalty` `unrest` `_unrestCause` `army` `_armyStart`
  `_homeland` `_attach` `_vassalCount` `_sovereignSeat`
* **Peoples:** `culMix` `langMix` `faithMix` `ancMix` `cultureId` `crops`
* **Environment:** `_climTemp` `_climMoist` `_confine` `_disease` `_diseaseLoad`
  `_wetTropic` `_rugged` `_riverAcc` `waterAccess` `_livestock`

### 6. Economy & trade
Wealth / infrastructure / food distributions, the 8-good price vector, grain price,
`_moneyFlows`, `_ruinHoards`, slave prices. Trade: `_tradePairs` (cross-border flow per
realm pair), `_linkMoney` (per settlement-pair link), `_tradeTotals` (each realm's total
commerce), partners per settlement, busiest borders, `_seaLanes`, `ships`.

### 7. Roads
`_roadTiles`, `_flowTiles`, road-quality and road-flow distributions, `transportDist`,
`_paveMemo`.

### 8. War
Live `_truces`, active war pairs (`_warBornAt`), `_warSeenAt`, `_warExhaust`,
`_warDead`, `_warLastFront`, `_manpower`, standing armies, unrest, loyalty, tiles ever
captured (count **and km²**), `_overlordOf`/`_overlordReach` (vassalage), `_succClaims`.

### 9. Peoples, faiths, dynasties
`cultures` `languages` `faiths` `dynasties` `persons` `_royalCourt` `_sittingRulers`
`ancestryCount`, largest peoples by census, culture-mix depth per town.

These used to be COUNTS only — `count.cultures = 23` was the entire measurement of a
culture. `collect()` now distributes every field of every one of them:
* **cultures** — `divergence`, `foundedStep`, `parentCultureId`, `rootCultureId`,
  `langSeed`, `folkFaithId`, `_lastDrift`
* **languages** — `gen` (generations from the root), `bornStep`, and the typological
  profile `prof{sylC, tone, consN, vowelN, nasalCoda, onDepth}`
* **faiths** — `foundedStep`, `endedStep`, and `doctrine{militancy, zeal, syncretism,
  hierarchy, asce}`
* **dynasties** — `foundedStep`, `endedStep`, `members.len` (how large a house grew),
  `inlaws.len`
* **persons** — `born`, `died`, `lifespan`, `reignFrom`/`reignTo`, `bloodHouse`,
  `children.len`, and `traits{vigor, wit, boldness, ruthlessness}`

### 10. Knowledge & ages
Per-track distributions across all settlements, `_eraAt` (the step each era marker was
reached), `_leadOrg`, `_townBar`/`_cityBar` (the percentile tier bars), `_topUrban`,
`devField`.

### 11. Chronicle — 35 event kinds observed
`settled` `dynasty.union` `language.shift` `ruler.died` `ruler.crowned` `ruler.elected`
`industry.specialty` `settlement.abandoned` `settlement.founded` `settlement.tier`
`settlement.withered` `settlement.lapsed` `settlement.captured` `settlement.annexed`
`culture.born` `culture.diverged` `dynasty.founded` `dynasty.extinct` `war.began`
`war.ended` `war.indemnity` `war.claimWon` `polity.founded` `polity.ended`
`polity.receded` `polity.restored` `polity.seceded` `polity.shattered`
`polity.submitted` `polity.adoptedFaith` `era.reached` `famine.struck` `growth.cities`
`crown.debt` `plague.outbreak` `plague.virginSoil` `succession.crisis` `gov.changed`
`cradle` `faith.founded` `faith.schism` `faith.faded` `faith.syncretized`
`market.boom` `market.dearth` `colony.founded` `colony.departed` `colony.independent`
`colony.inherited` `horde.raid` `slave.revolt` `society.serfdom`
`society.emancipation` `town.planted` `realm.monument` `wealth.milestone` `arc.complete`

Reported as a histogram, a per-1000-step rate, and the most recent few. Per-realm
chronicles come out of `--nation=`.

---

## What it surfaced on its first run

Reference grid, seed 8817, step 9000 — three things nobody was looking for:

* **Wealth is wildly unequal at the realm level and not by size.** `Sasfesučeefa` holds
  76,864 wealth against a median of 523 — a **147×** outlier — while sitting 2nd in area.
  Its `_dominance` (1.93) is the only one above 1.00 in the world.
* **`Tatea` has power exactly 0.0000** while holding 23 tiles and 189 people. A realm on
  the map with no coercive weight at all is either a real finding or a bug in
  `_countryPow`; either way it was invisible before.
* **Trade partners are pinned at exactly 12 for every settlement** (p50 = p90 = max =
  12). That is `partnerReachFor`'s cap binding on the entire world, not a distribution —
  the same "constant that has become the answer" signature as `tradeW = 0.500`.

None of those are what the tool was built to find. That is the point of it.

---

## 12. SHAPE — realm geometry (`--section=shape`)

Counts and areas say nothing about FORM, and form is what a human sees: "blobs all
over", "it follows the river valley", "scattered dots that never touch". Every owner
complaint this session was a shape statement and no instrument could read one.

* **compactness** `4πA/P²` — 1.0 is a disc, ~0.2 a ragged sprawl
* **fragments** — 8-connected components; >1 means the realm is in pieces
* **main-piece share** — how much of it is the largest fragment
* **elongation** — principal-axis ratio about the centroid; a valley state reads high
* **spread from seat** — radius of gyration in tiles
* **enclaved holes** — unclaimed land fully surrounded by the realm
* **neighbouring realms** + the count of ISOLATED realms (no land border with anyone)
* **nearest-seat distance** — the "scattered dots" measure, across all capitals

## 13. THE MAP AS AN IMAGE (`--png=out.png`)

    node tools/observe.mjs --steps=9000 --W=960 --png=map.png
    node tools/observe.mjs --png=pop.png --png-layer=pop      # population
    node tools/observe.mjs --png=dev.png --png-layer=dev      # technique wave
    node tools/observe.mjs --png=ter.png --png-layer=terrain  # fertility

Numbers describe shape; they do not SHOW it. Every diagnosis this session that beat
the probes came from a human looking at the map. Minimal PNG encoder, no dependencies —
openable, and directly readable by an agent that can see images.

**What the first render showed that no metric did.** At step 9000 on the shipped app
grid: 24 realms, **46% of them touching nobody**, strung across the Eurasian
mid-latitudes with the Americas, Australia and most of Africa entirely stateless — and
every realm a **near-perfect disc**. Compactness 0.49 / elongation 1.49 read as
unremarkable in a table; the image reads as circles stamped on the map. Real early
states follow rivers, coasts and valleys. That the territory walk produces discs says
its shape is dominated by distance-from-capital rather than by the transport cost field
it is supposed to ride — a first-order finding that was invisible in every number.

**Second finding, from the metric this time:** `fragments per realm` is **1.00 at p50,
p90 AND max on both grids**. No realm is ever in pieces — the connectivity release
(countryTerritory step 3) severs anything not reachable from the capital through
same-owner land, so an exclave is structurally impossible. History is full of them.

> ### ⚠ BOTH OF THOSE ARE WRONG, AND SO IS MOST OF WHAT FOLLOWS
>
> Every finding above and below was measured at **≤12,000 steps**. A 50,000-step run
> at the app grid reverses them:
>
> | claim, at ≤12k | at 50,000 steps |
> |---|---|
> | realms are near-perfect discs (compactness 0.49) | **compactness p50 0.17**, largest realm 0.035 — ragged, not round |
> | no realm is ever in pieces; exclaves structurally impossible | **fragments p50 2, max 22** |
> | 46% of realms touch nobody | **3%** (2 of 60) |
> | `secede` never fires on any seed | **166 secessions** |
> | nothing has ever died — INVARIANT ZERO on 4 seeds | **521 realm deaths, 276 restorations** |
> | tributary tree is flat, depth 1 | **depth 2**, 45.2% of realms are dependencies |
> | trade net in 2–3 components | **1 component, 100% connected** |
> | 16 separate political worlds | **3**, largest holding 96.7% |
>
> Nothing was wrong with the instruments. Every number was correctly measured, at both
> grids, and several were confirmed invariant across four seeds. **They were all
> measured during the world's growth phase.** At 12,000 steps this sim has barely
> started: 7% of land claimed against 50% at 50,000, 33 realms against 254 ever
> founded, realms still expanding into empty space and therefore never fragmenting,
> never over-extending, never dying.
>
> **`spread` put error bars on the wrong axis.** It varies the SEED and holds the
> horizon fixed — so "INVARIANT ZERO across four seeds" meant four seeds all run to
> 6,000 steps, and the agreement between them was near-meaningless. Horizon variance
> dominated seed variance by an enormous margin and nothing was instrumenting it.
>
> **Read any finding in this document as: "at the horizon it was measured at."** The
> long-run picture is in `docs/50k-run-2026-08-01.md`.

---

# THE MEASUREMENT SUITE

`observe` answers "what is the world like?". The others answer the questions that
actually consumed these sessions — what did this lever do, which commit moved it, how
did it get here, and why did the thing NOT happen — every one of which was hand-rolled
repeatedly before it existed.

## `tools/lib/simmetrics.mjs` — one collector, every consumer

`collect(world)` returns a FLAT map of `metricName -> number`, built by the same
introspection rule as `observe`: every length-N tile field, every numeric leaf on
**every entity class** (settlements, countries, polity records, cultures, languages,
faiths, dynasties, persons), realm geometry, network topology, event payload
magnitudes, every collection size, the chronicle histogram, `world.debug` counters.
**~5,020 metrics, and it grows by itself.** Every tool below consumes it, so all
measurements are directly comparable — the trap the manual bisects fell into was each
pass measuring its own two or three numbers.

### It goes TWO levels deep, and that was not a detail

The collector originally stopped at `typeof v === "number"`, so it saw a settlement's
~60 scalars and **none of the 234 numeric leaves one level below them**:

| hidden structure | leaves |
|---|---|
| `_gPrice/_gProd/_gDem/_gStock/_gCap/_gNet/_gExpLeft/_gImpLeft` — the whole 8-good economy | 64 |
| `_mIn/_mOut/_mInRate/_mOutRate/_mInPend/_mInPendRate` — money provenance | 108 |
| `_techEff{}` — farmYield, reachLevel, logisticsLevel, military, walls, credit, seaRange, cohesion | 14 |
| `knowledge{}`, `localRes`, `_effRes`, `_terrResAcc/_terrResMax` | 35 |
| country/polity `personality{}`, `chron{}` | 7 |

Since `abtest`, `bisect` and `trace` **all** read `collect()`, a lever writing into any
of those was structurally unmeasurable. `MIXED_FARM` writes `_techEff.farmYield`; the
A/B harness could only ever see whatever laundered through to population three passes
later. Worse, abtest's best safety property — the **non-experiment detector** ("both
arms identical on every metric ⇒ the switch was never reached") — would report a lever
that moves *only* hidden state as a dead switch. A false negative exactly where it
costs most, and the same trap `BALANCE_W` sprang once already.

Rules of the descent, all of which fail open:

* **One level, not arbitrary depth.** Depth 2 is where this data model ends.
* **Entity references are not recursed.** A value carrying an `id` plus a `name`/`pos`
  is another entity — `country.capital` would otherwise duplicate all 113 settlement
  fields under `nation.capital.*`, and `_foodParent` would measure a different town.
* **Maps/Sets contribute their size**, so `_tradeReach.size` (partners per settlement)
  is now a first-class metric rather than an observe-only curated line — which means
  the "pinned at exactly 12" cap-binding finding is something a diff can catch.
* **Arrays contribute `.len`** even when their elements aren't numbers, so `culMix.len`
  *is* the mix-depth observe prints by hand.
* **Vectors are named when a table exists, indexed when not.** `_gPrice.metal`,
  `_mIn.tribute_received`. The tables are loaded by **dynamic import in a try/catch**,
  because `bisect.mjs` copies this collector into an *old commit's* worktree where an
  export may not exist yet — a static import would fail at link time and take the whole
  bisect down. A missing table costs a readable name, never a measurement.

### …and it covers EVERY entity class, not three of eight

Depth-2 fixed the collector one level *down*. The identical hole existed one level
*out*: `collect()` measured settlements, countries and polity records — and nothing
else. `count.cultures = 23` was the **entire** measurement of a culture. Audited by
walking every object collection the world holds and counting distinct numeric leaves
(deduping aliases: `_byId` and `_stMap` are the same 68 settlement objects, which is
why a naive count reads 72%), **36.5% of the world's entity state was dark**, and all
of it was the *peoples* half of the simulator:

| collection | objects | leaves | was |
|---|---|---|---|
| persons | 456 | 8,208 | dark |
| events (payload magnitudes) | 260 | 1,820 | dark |
| languages | 23 | 575 | dark |
| faiths | 20 | 280 | dark |
| cultures | 23 | 276 | dark |
| dynasties | 4 | 164 | dark |

Now `culture.*`, `lang.*`, `faith.*`, `dynasty.*`, `person.*` — so `person.lifespan.p50`,
`person.traits.ruthlessness.p50`, `faith.doctrine.militancy.p50`, `lang.prof.tone.p50`,
`dynasty.members.len.max` are metrics that `abtest` and `bisect` can diff. **Dark share
36.5% → 7.2%**, and the remainder is not missing signal: `_moneyFlows` (a flow log whose
aggregate is already in `sett._mIn/_mOut`), `_evIndex` (an index into events),
`_urbanSpike` and `_royalCourt` (scratch and a roster of references).

Persons matters most and grows fastest — 456 at 6k steps on the reference grid, ~23,700
in a long run. It was the single largest dark class *and* the one nobody could see.

### `eventv.*` — how big, not just how often

`event.<kind>` counts occurrences; it cannot say magnitude. A run with two catastrophic
famines and one with two mild ones are identical in the histogram. `eventv.<kind>.<field>`
distributes the numeric payload — `eventv.polity.receded.tiles.max`,
`eventv.settlement.tier.people.p50`.

Payloads are mostly IDENTIFIERS, though, and that is measured, not assumed: over a 6k-step
run `id` appears 260 times, `polity` 191, `s` 172, `x`/`y` 138 each — against `people` 5,
`reign` 5, `tiles` 2, `dead` 2. Distributing an id yields a number that moves whenever
entities are renumbered, which would pollute abtest's effect ranking with pure noise, so
ids are excluded **by name**. That is a semantic distinction which cannot be detected —
the same situation as observe's `SCRATCH` — and it fails open the same way: an unknown
field is treated as a magnitude and measured, so a new one appears by default instead of
hiding. `step` is always kept, because *when* a kind of event fires is a real outcome.

### Positional enumeration only for FIXED-SCHEMA vectors

`_gPrice[3]` is metal in every settlement, so `sett._gPrice.metal` is meaningful. But
index 5 of one dynasty's `members` list has nothing to do with index 5 of the next —
distributing it is noise wearing a metric's name, and noise here is expensive because
abtest ranks by effect size and a shuffled id list moves hard. So a vector is enumerated
positionally only when its length is **identical across the entire entity class**;
otherwise only `.len` is emitted. Detected from the data, never from a hand-kept list:
`dynasty.members`, `sett.crops` and `person.children` collapse to `.len` on their own,
while `_gPrice`, `_mIn` and `knowledge` keep their named entries.

Cost: 79 ms → 121 ms at the reference grid (3,876 metrics), 398 ms at the app grid.

### The world object itself — a whole category that was missed

Audited at 9,000 steps by enumerating every property on `world` and classifying it:
**of 61 numeric scalars sitting directly on the world, the collector read exactly
zero.** Not a shortfall — a category. The walk looked for typed arrays of length `N`
and for objects inside registries, and a plain number on the world object is neither.

What was in there:

* **Every reference scale the sim calibrates itself against** — `_refCapPower`,
  `_refCapPowerS`, `_refRevenue`, `_refRealmPop`, `_musterRatio`, `_provRatio`,
  `_fortRef`, `_tierScale`. These are exactly the "has a constant become the answer?"
  quantities the SECOND CARDINAL RULE is about, and not one could be A/B'd or bisected.
* **Headline aggregates** — `_leadOrg` (which the displayed era is derived from),
  `_topUrban`, `_townBar`, `_cityBar`, `_popTotal`, `_eraProd`, `_climIndex`,
  `_climShock`, `ancestryCount`.

Two more shape assumptions fell with it:

* **`v.length !== N → skip`** dropped `_popLand[9616]`, a real per-LAND-tile
  population field whose length is the land count, not `N`. Arrays that are already
  land-indexed are now measured as fields; anything else becomes `vec.*`, where the
  distribution is often meaningless (`_coastList` holds tile indices) but `.n` is the
  only record anywhere of how many coast tiles the world has.
* **Plain objects on the world were never opened**, and one mattered enormously:
  `deposits` holds **fourteen per-tile arrays** — timber, stone, copper, tin, iron,
  coal, horses, salt, precious, gems — and `depositReserve` holds what is left of the
  depletable ones. **The world's entire resource endowment, the input the whole mining
  and metal economy runs on, was unmeasured.** A tile field hiding inside a bag is
  still a tile field.

`WORLD_SCRATCH` is the counterpart of observe's `SCRATCH` and the same bargain — the
outcome/workspace split is semantic so it cannot be detected, but the list **fails
open**. Only re-entrancy cursors and version stamps, allocator/worker plumbing, and
`worldRef` (the raw worldgen output at *render* resolution, whose sim-res copies are
already collected) are named. The id counters are deliberately *not* scratch: each is a
cumulative "how many were ever minted", the total the live registry cannot give once
records start being reclaimed.

After the fix the same audit reports **every remaining uncovered property is exactly
and only a member of `WORLD_SCRATCH`** — 23 cursors/stamps, 2 lookup tables, 5
allocators, and one entity reference. Nothing is dark by accident.

**This was the third time the same failure appeared.** Depth-2 was one level *down*;
entity classes were one level *out*; this was the container. Each time, introspection
was complete *within an assumed shape* and blind to everything outside it. That is the
standing lesson for whoever extends this next: the question is never "did I walk all
the fields?" but **"what shape am I assuming, and what lives outside it?"**

## `npm run spread` — does this finding generalise, or is it one seed?

`observe`, `trace` and `why` all report ONE seed. This session produced a run of strong
claims on seed 8817 alone — no realm has ever ended, no province has ever seceded, only
0.5% of attacks fail on strength, the tributary tree is flat — and not one carried an
error bar. `abtest` has been multi-seed since it was written, for the reason in its own
header (*"single-seed A/B is how you ship noise as a finding"*), but the identical
hazard applies to every single-seed OBSERVATION and nothing was checking it.

    npm run spread
    node tools/spread.mjs --seeds=8817,31337,4242,7777 --steps=9000
    node tools/spread.mjs --W=960 --grep=life,graph.vassal
    node tools/spread.mjs --unstable          # rank by cross-seed variability

Per metric: median, min, max, coefficient of variation, and a **verdict** — because the
point is telling a reader whether a single-seed claim is safe, not handing them a
number to interpret. `invariant` / `INVARIANT ZERO` (identical on every seed) /
`stable` (CV < 0.10) / `varies` (< 0.35) / `UNSAFE 1-seed`.

**Funnels are included and never averaged.** Three of this session's headline findings
were funnel zeros, and a zero is the easiest result in this repo to over-read.
`0/0/0/0` and `0/0/0/7` mean completely different things; a mean of 1.75 hides which
one you have.

### What it confirmed, and what it demolished

Four seeds, 9,000 steps, reference grid:

| claim | verdict |
|---|---|
| `life.polity.endedNow` = 0 | **INVARIANT ZERO** — but see the warning above: this metric was measuring the wrong quantity, and `event.polity.ended` is non-zero. `spread` faithfully confirmed a zero that did not mean what it appeared to. |
| `life.faith.endedNow` = 0 | **INVARIANT ZERO** (and `faith.endedEver` = 0 too — this one is real) |
| `life.culture.endedNow` = 0 | **INVARIANT ZERO** (no death event exists for cultures at all) |
| `secede` never fires | **0/0/0/0 passed** on 191/155/40/19 candidates |
| `_tradeReach.size` = 12 (p50 *and* max) | **invariant** — the cap binds on every world |
| `graph.vassal.depthMax` = 1 (flat tree) | **UNSAFE** — runs 0–2, CV 0.71 |
| `graph.vassal.blocLandPct` | **UNSAFE** — 0–13.8%, CV 0.62 |
| `life.dynasty.endedNow` | **UNSAFE** — 2–12, CV 0.65 |

Note what `spread` could and could not do here. It correctly reported that
`life.polity.died = 0` on every seed — the metric *is* invariant. Cross-seed agreement
says nothing about whether a metric measures the right thing, and four seeds agreeing
on a wrong number is not evidence of anything. **An error bar is not a validity check.**

So the load-bearing findings survive — *nothing dies, nothing secedes, trade is capped
at exactly 12* — and one of the tidier ones does not. **16.5% of the 5,053-metric map
cannot be honestly quoted from a single run.**

The retraction is the point. This document previously concluded that the
cycle-detection code in `considerSubmissions` "cannot currently fire", reasoning from
`depthMax = 1` on seed 8817. Other seeds reach depth 2. A structural claim about a
mechanism needs a far stronger basis than a distributional one, and until this tool
existed neither had any basis at all beyond a single run.

## `npm run monotone` — the error class the other two gates structurally miss

`coverage` proves every value is measured. `spread` proves a value is stable across
seeds. **Neither can tell you a metric answers the question its name implies**, and
that is the error that actually cost this session. `life.polity.endedNow` was measured, was
reachable, was invariant-zero on four seeds — and counted records *currently* marked
dead rather than deaths ever, because restoration clears the flag. Realms were dying
and the map said none had.

It was caught by accident, and only because the number went 0 → 1 → 0 across
checkpoints. **That is a checkable signature: a count of things that have happened
cannot decrease.**

    npm run monotone
    node tools/trace.mjs --monotone --steps=12000 --every=1000 --W=960

Two arms, because a name is a *claim* and a shape is *evidence*:

* **By name** — `event.*`, `.born`, `.endedEver`, `.restoredEver`, the `_next<Class>Id`
  counters. Any decrease is a defect **unless the event log pruned**, which it does at
  200k and visibly (`count.events` falls at the same checkpoint), so that case is
  recognised rather than guessed at. This arm is the gate: it exits non-zero.
* **By shape** — rose above its own starting value, then fell back to it. A counter
  with a reset looks like this whatever it is called, which matters because the death
  bug's name promised nothing. Advisory, not a failure.

### Both arms had to be built twice

The first shape detector flagged **998 metrics** — "rises overall, drops occasionally"
describes almost every growing stock in a growing world. Noise at that volume is not a
weak signal, it is an ignored report. The second attempt tested against the running
*minimum*, which at the second checkpoint **is** the starting value, so any early dip
qualified: still 632. What works is requiring integer values (a float that wobbles is a
measurement, not a tally) and a genuine round trip — rose above baseline, came back to
it. That lands at 58, which is reviewable.

### The fix was to rename the metric, not to annotate around it

Run against the pre-fix collector the gate catches the original bug exactly:

    ✗ 1 metric(s) NAME a cumulative history and decreased:
        life.polity.died      1.0 → 0.0000  at step 10000

But it kept firing *after* the fix, because `.died` still legitimately decreases — it
is a state. A gate that fails forever on documented behaviour is a broken gate, and the
tempting repair is an exceptions list. That would have been wrong: **the name was the
defect.** The metric is now `life.<class>.endedNow` — records currently marked ended,
a name that makes no claim it cannot keep — beside `life.<class>.endedEver`, the
history. The gate passes because the promise and the measurement finally agree.

## `npm run coverage` — does the collector see the whole world?

The three shape misses above were each found by hand-writing a throwaway enumeration
script, and **nothing in the repo could have caught any of them**. Growing `collect()`
from 1,304 to 5,020 metrics did not make it complete — it made it complete *within the
shape it assumed*, three times running. A metric map cannot report its own missing
dimensions. This tool can.

    npm run coverage
    node tools/coverage.mjs --steps=9000 --W=960   # the shipped grid
    node tools/coverage.mjs --verbose              # every property, classified

**It does not match names.** The obvious implementation — compare world keys against
metric names — is a REPLICATED GATE, and the repo already carries that scar:
`probe_fillaudit.mjs` answers its question by re-implementing the size-target
computation externally, which drifts from the real one and then lies. A name-matching
coverage check would encode a second, parallel idea of what `collect()` does and go
stale the first time `collect()` changed. Two mechanisms are used instead, neither of
which knows anything about the collector's logic:

1. **Proxy** — run the *real* `collect()` against a Proxy of the world that records
   every property read. Exact by construction, sees reads inside helpers too, and
   cannot drift because there is nothing to keep in sync.
2. **Perturbation** — change a numeric leaf, re-collect, and check whether *any* metric
   moved. Reading a value is necessary but nowhere near sufficient: `collect()`
   iterates `Object.keys(world)` in several loops, so almost everything gets read —
   including an object whose contents it then walks straight past. This proves the
   value actually *reaches* a number. Applied kind-uniformly (scalars, tile arrays,
   odd-length arrays, nested objects) because the three misses were three different
   shapes, and a check that understood only one would have caught only one.

`WORLD_SCRATCH` is **imported from the collector, never copied**, so the exclusion list
cannot fork. A property passes if it is proved to reach a metric or is named there;
anything else is DARK and the tool exits non-zero.

### It proves it can fail, on every run

A gate that has never failed is a rubber stamp, and a coverage tool that cannot fail is
worse than none — it certifies blindness. So every run first injects a canary the
collector provably cannot reach (a number nested **two** levels inside a world object,
which is exactly the shape that remains outside the depth-1 descent) and aborts if the
detector does not fire.

That self-test earned itself immediately: the first version used "was it read?" as the
criterion, and the canary was read — because the new world-scalar pass reads every key.
The criterion was wrong, and the tool said so before anyone trusted a green run.

**And the perturbation probe had a bug the gate caught on itself.** `collect()`
distributes length-`N` fields over **land only**, and tile 0 is ocean on every map this
generates — so probing index 0 moved nothing and the first run reported **83 false
alarms, including `popField` and `fert`**. Probing a land tile fixed it. Recorded here
because it is the same lesson one layer up: an instrument's own shape assumptions are
as dangerous as the ones it is built to find.

### Verified against the real regression

Temporarily removing the world-object descent from `collect()` — the exact miss fixed
in `ec72e56` — makes it fail with:

    ✗ 6 DARK properties
        deposits          object   read but reaches no metric
        depositReserve    object   read but reaches no metric
        _craftMean        object   read but reaches no metric
        …

Current state: **172 measurable world properties, 172 proved to reach a metric**, 29
named as workspace, entity-class residue 8.6% (all itemised and justified in
`ENTITY_ACCEPTED`, which also fails open — a new registry shows up as unexplained
rather than quietly joining the accepted total).

### `life.*` — do things RISE AND FALL, or only rise?

Every other metric is a snapshot of the population that EXISTS, and **a snapshot of
survivors contains no lifespans**. That left the question the sim is actually for —
do realms rise and fall? — unanswerable, and a mean lifespan taken over a population
that is still mostly alive is not a number, it is a lie.

Two facts make it computable with **no new recording at all**:

* `entities.js:12` — *"Records are never deleted. A fallen realm keeps its record
  (endedStep set)."* So `endedStep − foundedStep` **is** the lifespan, exactly, for
  every polity that ever existed.
* The **event log is the wrong source**: `events.js:42` caps at 200,000 and splices
  the oldest 50,000, so a long run deletes its own early history and leaves deaths
  whose births have been pruned away. Anything built on it is survivorship-biased in
  precisely the wrong direction.

Per class (`polity` `faith` `dynasty` `culture` `lang` `person`): `born`, `died`,
`alive`, `turnoverPct`, `lifespan.{p50,p90,max}` for the dead, `age.{p50,max}` for the
living, and `survival1k`/`survival4k`/`survival16k`. All in **steps** — the displayed
year is cosmetic and must never be the unit of a measurement compared across runs
(FIRST CARDINAL RULE).

**Right-censoring is handled, because getting it wrong is how survival statistics
mislead.** An entity founded 500 steps ago tells you nothing about 4,000-step
survival, so each horizon's denominator is only entities that have *had the chance*
to reach it — and a horizon no one is old enough for emits **no metric at all**,
rather than a 0% that would read as "everything dies young" when it means "the run is
short".

**`retainedPct` — the metric that admits its own bias.** `dynasties.js:945` reclaims
dead unreferenced persons and `:988` deletes extinct dynasty husks, so for those
classes the live registry is a *sample of survivors*. The count ever minted comes from
the world's own monotone counter, whose name follows the codebase convention
`_next<Class>Id` — derived from the class name, so a new registry following the same
convention is covered with no edit. It **fails safe**: a class with no such counter
emits nothing. That mattered immediately — polities take their id from the country, so
polity ids are sparse by construction, and an id-span heuristic (the first thing tried)
reported **23% retention on a registry whose own header promises records are never
deleted**. A metric that invents a number is worse than one that declines to.

### ⚠ `died` is a STATE, not a history — and that invalidated a headline finding

`died` counts records whose `endedStep` is set. But `entities.js:103` **clears
`endedStep`** when an old realm re-forms under its id (*"re-opened: an old nation
re-forming"*). A realm that fell and was later restored therefore reads as never having
died at all.

Measured at the app grid, 12,000 steps:

| seed | `event.polity.ended` (ever) | `polity.restored` | `life.polity.endedNow` |
|---|---|---|---|
| 8817 | **2** | 2 | **0** |
| 31337 | 1 | 0 | 1 |

**Realms do die.** "Nothing has ever died, INVARIANT ZERO across four seeds" — repeated
through this document and across a session — was an artefact of asking the records a
question they do not answer. `spread` confirmed the zero faithfully; the zero was
measuring the wrong quantity.

The event log is the only cumulative source, and it was explicitly rejected earlier in
this section for pruning at 200k. That reasoning was **right about lifespans** (which
need the founding too, and lose it when the log rolls) and **wrong about counts**. Both
are now emitted and labelled: `.died` is a state, `.endedEver` is a history with a known
horizon, and `.diedThenRestored` reports the size of the gap between them so the
discrepancy can never hide again. `observe --section=life` prints a warning when it is
non-zero.

The lesson is the one this whole document keeps re-learning in a new costume: a metric
can be exactly correct about the thing it measures and still answer a different
question from the one being asked. "Records are never deleted" was true. "Therefore
they remember every death" did not follow.

#### What it said on its first run — and it is an absence

Reference grid, seed 8817, step 9,000:

| class | born | died | turnover | lifespan p50 | age p50 |
|---|---|---|---|---|---|
| polity | 21 | **0** | 0% | — | 3,384 |
| faith | 24 | **0** | 0% | — | 8,807 |
| culture | 32 | **0** | 0% | — | 8,592 |
| lang | 32 | **0** | 0% | — | 8,592 |
| dynasty | 24 | 3 | 12.5% | **75** | 1,791 |
| person | 5,336 | 4,913 | 92.1% | 225 | 141 |

**In this world people die and dynasties die. Nothing else ever does.** No realm, no
faith, no culture and no language has ended in 9,000 steps; `polity.survival4k` is
100%. And the one mortal institution is startlingly ephemeral — a dynasty's median
life is **75 steps** against a realm's 3,384-step age, so houses turn over ~45× within
a single immortal realm.

This is the same shape as every other finding this session — `settlement.captured` 0,
`settlement.annexed` 0, `graph.vassal.depthMax` 1 — and it is the first metric that
states it directly rather than by implication. Note what could NOT have found it: every
empire check in `validate` is a share, a ratio or a count, and **a world where nothing
ever dies passes all of them.**

#### At the SHIPPED grid (THIRD CARDINAL RULE), step 12,000

| class | born | died | turnover | lifespan p50 | age p50 | retained |
|---|---|---|---|---|---|---|
| polity | 33 | **0** | 0% | — | 7,104 | — |
| faith | 39 | **0** | 0% | — | 11,357 | 100% |
| culture | 41 | **0** | 0% | — | 11,256 | 100% |
| lang | 41 | **0** | 0% | — | 11,256 | — |
| dynasty | 96 | 6 | 6.3% | 1,175 | 2,141 | 100% |
| person | 9,638 | 8,985 | 93.2% | 225 | 141 | **50%** |

**The immortality holds at both grids** — so it is a property of the mechanism, not an
artefact of the reference resolution. Two things do NOT hold, and both are exactly what
the third cardinal rule exists to catch:

* **`person.retainedPct` is 100% at the reference grid and 50% at the shipped one.**
  The person purge does not bite at `tw=240` at all, and reclaims half the registry at
  `tw=480`. So `person.lifespan` at the grid the app actually ships is computed over
  half a sample — a bias that is *completely invisible* at the grid everything else is
  validated on. This is the metric earning its keep on its first run: without it, that
  number would have been read as a complete census. (Both grids report a p50 of 225,
  which is reassuring but is not evidence the purge is unbiased.)
* **`dynasty.lifespan.p50` reads 75 steps at the reference grid and 1,175 at the app
  grid** — 15.7× apart. **Do not treat this as a finding yet:** it rests on 3 and 6
  completed lifespans respectively, which is an anecdote, not a distribution. It is a
  flag for a longer run, and it is recorded here rather than quietly averaged away.

### `graph.*` — topology, not sizes

Every network the world carries used to report as one integer. `_overlordOf.size = 16`
is the same number for a sixteen-wide star under one hegemon and a four-deep tribute
chain, and those are different worlds. It matters most for **vassalage**, which the
chronicle read (below) showed is this sim's *primary* consolidation channel.

* **`graph.vassal.*`** — bonds, suzerains, roots, `depthMax`/`depthMean`,
  `subvassalPct` (bonds whose suzerain is itself a dependency — the pyramid, not the
  star), `branchMax`, `blocMaxRealms`, `blocPctRealms`, `dependentPctRealms`, and
  **`blocLandPct`: the share of all claimed land inside the largest bloc**, suzerain
  plus every descendant. That last one is the honest extent of the largest power, and
  it resolves the standing paradox directly — realm count rises and the map reads
  fragmented *because a tributary is invisible on the political map*.
* **`graph.alliance.*`** — degree mean/max, components, largest bloc %, unallied %.
* **`graph.trade.*`** — links, nodes, degree, components, largest %, and
  `top10FlowPct`: is commerce a web, or a handful of arteries carrying everything?
* **`graph.realmnet.*`** — connected components of the realm adjacency graph: how many
  *separate political worlds* exist. `shape.isolatedPct` counts realms touching nobody;
  this counts the clusters, which is a different question.
* **`graph.road.*`** — components and largest share: one road system, or stubs?
* **`graph.liege.*`** — the settlement hierarchy *inside* realms, by depth.

Readable as `node tools/observe.mjs --section=graph`.

**What it said on its first run** (app grid, seed 8817, step 12000, 33 realms):
`vassal.depthMax` **1.00** and `subvassalPct` **0.0%** — a flat tributary tree, no
vassal ever acquiring a vassal. `liege.depthMax` likewise 1. And `realmnet.components`
**16** across 33 realms, largest cluster only **37.5%** — the map is not one political
world with gaps in it, it is sixteen.

> **⚠ Partly retracted by `npm run spread`.** The flat-tree reading was a SINGLE-SEED
> result and does not generalise: across four seeds at 9,000 steps `vassal.depthMax`
> runs 0–2 (median 1, CV 0.71 — **UNSAFE from one seed**), so sub-vassals *do* form on
> some worlds. An earlier version of this document went further and concluded the
> cycle-detection code in `considerSubmissions` "cannot currently fire"; that inference
> was wrong, built on one seed's zero. `blocLandPct` is equally seed-dependent
> (0–13.8%). Kept here rather than deleted, because the mistake is the lesson: a
> structural claim ("the mechanism is unreachable") needs a much stronger basis than a
> distributional one, and neither had an error bar until `spread` existed.

`provenance(world)` returns commit, whether `src/` is dirty, seed, grid, step and the
**lever diff against shipped defaults**. `observe` now prints it as the first block: a
measurement that does not say which code and which levers produced it cannot honestly
be compared with another.

## `npm run abtest` — what does this lever actually do?

    node tools/abtest.mjs --tune="CATCH_WILD=1,SIZE_WORKED=1"
    node tools/abtest.mjs --tune="SPAN_TECH=0" --steps=12000 --W=960
    node tools/abtest.mjs --tune="ORG_BIRTH_VAR=0" --seeds=8817,31337,4242
    node tools/abtest.mjs --env="SIM_SUCCESSORS=0" --grep=realm,shape

Runs both arms on the same seed, diffs **all ~5,020 metrics**, prints a fixed HEADLINE
block plus the largest effects. Three properties that matter:

* **Multi-seed by default.** Single-seed A/B is how noise ships as a finding — the
  cross-grid ratio read 0.57 on one seed and 1.09 on another this session. A mover is
  only tagged `CONSISTENT` if it moves the same direction on every seed.
* **Sentinel-safe ranking.** Ranking by percent puts `endedStep −1 → 2287` (228,800%) at
  the top and buries what matters. Effect size is `|Δ| / (|a|+|b|)`, bounded in [0,1].
* **It detects a NON-EXPERIMENT.** If both arms are identical on every metric it says so
  explicitly, because that means the switch was never reached — a module constant, an
  env-only gate, a dead branch. `BALANCE_W` produced exactly this trap earlier today and
  a null result was nearly recorded as a finding. Unknown keys are rejected up front.

## `npm run bisect` — which commit moved it?

    node tools/bisect.mjs --range=dc4e0e9..19bd402 --metric=realm.areaKm2.p50 --W=960
    node tools/bisect.mjs --commits=b859db7,deffdce,de97888 --auto

Walks a commit range in a throwaway worktree, running the **current** collector against
each commit's `src/` — so every commit is measured identically. `--auto` needs no metric
named in advance: it ranks every one of the ~5,020 by how sharply it steps and reports
which commit carries the most sharp steps. The regression finds itself.

Verified against the known case at the shipped app grid:

    b859db7 → deffdce   realm.areaKm2.p50   267,236 → 26,724   −90.0%  ◄── LARGEST-CLASS STEP

That is the finding it took two sessions, three wrong attributions and the owner
opening builds by hand to reach.

**Bisect at `--W=960`.** The same commit is a 10% effect at the default reference grid
and 10× at the app grid; bisecting at the reference alone clears the guilty commit (the
THIRD CARDINAL RULE).

## The map the PLAYER sees is not the map the sim reasons over

`T.CONTROL_FIELD` is **on by default**, which means the app renders `_ctrlOwner` — a
smoothed control field radiating from each capital — while every metric here reads
`_countryOwner`, the authoritative political map. They are not the same map. Measured
at the shipped grid, seed 8817, step 9000:

| | claimed land |
|---|---|
| `_countryOwner` — authoritative, what the sim reasons over | **4.58%** |
| `_ctrlOwner` — what the player actually looks at | **6.65%** |
| tiles where they disagree | 2.07% of all land (**1.45×** ratio) |

So an owner report about shapes is a report about the DRAWN map, and measuring only the
authoritative one is measuring a map nobody looks at — the same class of mismatch as
validating at a grid the app does not ship. `collect()` now emits `drawn.*` alongside
`shape.*` (geometry of the control field, its realm count, its claimed share, and
`drawn.disagreePct` — how far the two maps have diverged), and
`observe --png-layer=control` renders what the player sees.

## `npm run trace` — the run over TIME

    node tools/trace.mjs --steps=21000 --every=1000
    node tools/trace.mjs --W=960 --steps=12000 --every=1000 --out=run.csv
    node tools/trace.mjs --watch=realm.areaKm2.p50,pop.field
    node tools/trace.mjs --unstable        # rank every metric by how hard it thrashes

Records the full metric map at every checkpoint and reports what a snapshot structurally
cannot: **SWING** (peak/trough — a stability measure), **DIR** (rising / falling /
oscillating, from sign changes in the first difference), **PEAK@** in steps and years,
**SETTLE** (is the last third flat — did it converge?), and the chronicle **bucketed by
window**, so *when* things happened survives instead of collapsing to a count. `--out=`
writes one CSV row per checkpoint × ~5,020 columns.

This is what made the old `_sizePopK` anchor legible as UNSTABLE rather than merely
generous — its median realm swung 92k → 23k → 11k → 80k km² across four checkpoints.
Reading that took four separate manual runs; `--unstable` now ranks every metric that
oscillates, automatically.

### ARCS — the shape of one realm's life

Every other metric in `trace` is a world aggregate, and an aggregate structurally
cannot answer *"did THIS realm peak and decline?"* — a distribution of realm areas per
checkpoint is equally consistent with every realm growing monotonically and with half
of them collapsing. `trace` now records a per-entity table at each checkpoint, keyed on
the sim's **own** polity id — never an invented lineage heuristic, because restoration
is already modelled (`endedStep` cleared, `polity.restored` logged) and a second notion
of identity is how an instrument starts disagreeing with the thing it measures.

    node tools/trace.mjs --entity=top          # one realm, checkpoint by checkpoint
    node tools/trace.mjs --out-entities=e.csv  # one row per realm × checkpoint

Per realm: `peak` and `peakAt`, `finalKm2`, **`peakFraction`** (final ÷ peak — 1.0 means
still at its largest), `riseSteps`, `fallSteps`.

**Self-diagnosing.** A checkpoint trace cannot see a realm born and died inside one
interval. `life.polity.born` counts every realm ever minted (records are never
deleted), so the difference is the blind spot and it is printed every run — a silently
truncated sample reads exactly like a complete one. Reference grid, 9,000 steps:
*21 observed vs 21 ever founded — none missed.*

#### It refuted the prediction written for it

This entry previously argued arcs were low priority: `life.polity.died = 0`, therefore
"no falls to shape". That was wrong, and the instrument said so on its first run:

    peakFraction (final ÷ peak):  p50 1.000   min 0.231
    realms that EVER declined (kept <90% of peak): 3 of 20

    realm            peak km²   peak@   final km²  final/peak
    Sasfesučeefa      2.01e+6    8000     1.31e+6       0.649
    Poxaoso           9.69e+5    8000     9.54e+5       0.984
    K'aubkyuigh       6.15e+5    8000     5.84e+5       0.950

**Realms contract; they simply never collapse.** The largest realm in the world gave up
**35% of its territory** between step 8,000 and 9,000, and one realm kept only 23% of
its peak. So territorial loss is alive and well — what is missing is the last step,
from *shrinking* to *ended*. "Nothing ever dies" and "realms only grow" are different
claims, and the second one is false. That distinction was invisible in every aggregate:
`realm.areaKm2.p50` rises smoothly while individual realms are losing a third of
themselves.

**Confirmed at the shipped grid** (THIRD CARDINAL RULE) — the decline rate is a
property of the mechanism, not of the reference resolution:

| | reference `tw=240` | app `tw=480` |
|---|---|---|
| realms traced | 20 | 31 |
| declined ≥10% from peak | 3 (15%) | 5 (16%) |
| worst `peakFraction` | 0.231 | 0.516 |

At the app grid `Ghesyahčeef` gave up 23% of its peak and `Nawaxexise` 40%. Neither
died. The `fall` column is 0 for most realms only because they peak at the final
checkpoint; the ones that do decline fall over 1,000–2,000 steps and then **stabilise**
— they neither recover nor finish dying. They sit there smaller. That is the session's
finding in one line: **this world has decline, and it has no death, and nothing bridges
the two.**

## `npm run why` — the funnels: why did it NOT happen?

    node tools/why.mjs --steps=9000 --W=960
    node tools/why.mjs --steps=9000 --every=3000     # per window, not cumulative

Every other metric here is OUTCOME state, and outcomes **cannot explain absences** —
which is nearly always the question (why did no state form, why did this realm not grow,
why was that war never declared). `src/sim/peopleSim/telemetry.js` tallies the reason at
**the exact line that rejects**, so the funnel can never drift from the gate. That
matters: `tools/probe_fillaudit.mjs` answers the same question by RE-IMPLEMENTING the
whole size-target computation externally, and a duplicated gate silently diverges from
the real one and then lies.

Cost when off is one `if (!world._tel) return;`. No control flow depends on a tally, so
a telemetry run produces an identical world — `npm test` green with it wired.

Wired so far: **`nucleate`** (state birth: org bar, seat population, basin bar, capital
spacing, same-pass spacing, per-pass cap) and **`growth`** (realm expansion: target zero,
at-or-over target, rate limited, has budget, marginal-tile too thin). First run at the
shipped grid, 6000 steps — 930 candidates considered:

    org<ORG_STATE_MIN         506   54.4%
    seatPop                   404   43.4%
    tooNearExistingCapital     15    1.6%
    basinPop<clusterBar         3    0.3%
    ✓ PASSED                    1    0.1%

State formation is gated on **organisation and seat population**, not on spacing — which
is the kind of answer that previously needed a bespoke probe per question.

### Wired funnels, and what they said on first read

**`found`** — settlement supply (app grid, 12k steps, 28,718 candidate evaluations).
The `~90-entity ceiling` that Tier C spent five design docs and four build attempts on
is measured rather than argued:

    hardFloorOverlap            16657   58.0%
    throttled:reach/diffusion   10949   38.1%
    throttled:spacing             477    1.7%
    pioneerTempo                  260    0.9%
    areaFertTooLow                247    0.9%
    ✓ PASSED                      128    0.4%

**`HARD_FLOOR` — the raw anti-overlap spacing constant — rejects 58% of all candidates**,
and reach/diffusion the next 38%. Capacity, market saturation and population are
nowhere. That is the "fixed-radius exclusivity is a spacing constant in disguise"
verdict from the C1 v1 flip, now with a number on it. Rejections are attributed to the
SMALLEST multiplier in the probability product, so "the roll failed" is never the answer.

**`nucleate`** — state birth: `org<ORG_STATE_MIN` and `seatPop` take 98% of rejections
between them; capital spacing takes 1.6%. State formation is gated on organisation and
seat population, **not** spacing.

**`capture`** — why a live front takes no ground (app grid, 16k steps, 760 fronts):

    ✓ PASSED (took ≥1 tile)       266   35.0%     ~tilesTaken 743
    noContestedTiles              262   34.5%
    attackerNotWinning(adv<=1)    229   30.1%
    marginTooThinToTakeOneTile      3    0.4%

Fronts DO convert — a third of them take ground, 743 tiles over the run. So the
conquest defect is not "advantage cannot become territory"; it is upstream, in how few
fronts open and how little sticks at the realm level. `adv<=1` (not winning) and
`noContestedTiles` need opposite fixes and were previously indistinguishable.

**`submit`** — why a court does NOT bend the knee. Wired because reading the chronicle
established that consolidation here runs almost entirely through vassalage (16
`polity.submitted` against **0** annexations over 16k steps), which made the *one*
channel that actually consolidates the world the one with no funnel on it. The
rejection is attributed to the smaller of the two brakes (identity vs coalition
deterrence), never to "the roll failed" — the same rule `crystallize.js` uses. App grid,
12,000 steps, 481 candidate pairs:

    resistanceNotHopeless        355   73.8%
    alreadyADependency            72   15.0%
    hazardRoll(waiting)           29    6.0%
    outOfProjectionReach          13    2.7%
    identityBrake(foreignCourt)    7    1.5%
    ✓ PASSED                       4    0.8%
    noLiveSeat                     1    0.2%

**Vassalage is gated on the POWER RATIO and essentially nothing else.** `SUBMIT_RATIO`
(the suzerain must be 5× the statelet's whole network) takes three quarters of all
candidates; projection reach takes 2.7% and identity 1.5%. `coalitionBrake` — a whole
deterrence mechanism, with a lever behind it — **rejected zero candidates in 12,000
steps**, and so did `cycleWouldForm`. On this seed the tributary tree never gets deep
enough for a loop to be possible — but see the retraction above: `vassal.depthMax`
reaches 2 on other seeds, so "the cycle-detection code cannot fire" was an
over-reading of one run, not a property of the mechanism.

**`attack`** — WAR INITIATION, the gate a front opening (and therefore a `war.began`)
rests on. `armies.js` had only the bespoke `WDBG` structure here: opt-in, shaped for
one probe, speaking a different language from every other funnel. The bar is a PRODUCT
of six brakes over raw defence, so the binding term is the **largest multiplier above
1** — the opposite of `crystallize.js`, where the terms are probabilities and the
smallest binds. Same rule underneath: name the constraint that did the work. App grid,
9,000 steps, 3,079 candidates:

    warWeariness              1241   40.3%
    ✓ PASSED                   949   30.8%
    coalitionDeterrence        633   20.6%
    tradePeace                 200    6.5%
    aggressionTemperament       21    0.7%
    noCasusBelli                20    0.6%
    outmatched(noBrakeBinding)  15    0.5%

**Only 0.5% of attacks fail because the attacker is too weak.** Ninety-nine and a half
percent of rejections are DETERRENCE — war weariness, coalitions, trade peace. The
military balance is almost never the binding constraint, which reframes "nothing is
ever conquered": it is not that armies cannot win, it is that they are talked out of
starting. `outmatched` is broken out separately for exactly this reason — being
deterred and being outgunned need opposite fixes and were previously the same number.

**`secede`** — why a province does NOT break away. Wired because `life.polity.endedNow`
reads 0 at both grids: no realm has ever ended, and shedding provinces is the channel
by which one could. App grid, 9,000 steps:

    secede:  55 considered · 0 passed (0.0%)  ◄── NEVER FIRED
        withinAdminBudget            42   76.4%
        infantColony                  9   16.4%
        loyaltyStockNotYetSpent       3    5.5%
        garrisoned(recentConquest)    1    1.8%

**Zero secessions, and the reason is not stickiness — it is slack.** Three quarters of
provinces sit *comfortably inside* their realm's administrative budget, so the loyalty
decay that leads to secession is never even entered. Of the handful that are
over-budget, none has finished spending its loyalty stock, and the
`peopleStillAttached` hysteresis brake — the mechanism built to slow secession — has
**never once been the binding constraint**. That is the direct explanation of
`life.polity.died = 0`: realms do not hold together against strain, they never
experience strain.

`loyaltyStockNotYetSpent` and `peopleStillAttached` are deliberately separate: one is a
province on its way out and merely slow, the other would never leave however long you
waited.

**`roadPeer` / `roadPlan`** — why a town does not lay a trade road. **Two channels on
purpose**: `roadPeer` counts PEERS EVALUATED, `roadPlan` counts TOWNS THAT TRIED, and
mixing those two populations is exactly the defect the `growth` funnel used to carry.
App grid, 9,000 steps:

    roadPeer:  865 considered · 1 passed (0.1%)
        shortcutProbeBudgetSpent     561   64.9%
        routeAlreadyMostlyRoad       231   26.7%
        beyondLogisticsHorizon        58    6.7%
        newRouteBudgetSpent            9    1.0%
        noLandPath                     5    0.6%

    roadPlan:  117 considered · 1 passed (0.9%)
        noViablePeer                 116   99.1%

**The single largest line in the funnel is a performance cap.** `MAX_SHORTCUT_EVALS`
exists as cost control — *"a tight cap so a stable network doesn't re-path every peer
every cycle"* — and it accounts for 65% of all peer evaluations. Read it precisely,
though: that cap governs SHORTCUT probes against peers a town is *already* linked to,
so it throttles network *improvement*, not network *formation*. New links are barely
budget-limited at all (1.0%).

The economic brake on new roads is `routeAlreadyMostlyRoad` at 26.7% — the route is
already largely paved, so there is nothing to build. And at the town level, **99.1% of
attempts find no viable peer whatsoever.** That sits beside the standing observation
that trade partners are pinned at exactly 12 for every settlement (p50 = p90 = max),
and together they say the trade network is not demand-limited or wealth-limited: it is
saturated against caps.

Not yet wired: the food passes, faith/culture birth, colony founding. Migration is
deliberately excluded — it is continuous field flow rather than a candidate/reject
decision, so a funnel is the wrong instrument and it needs its own.

### "Never fired" is a finding, not a wiring gap

`why` used to print *"no explicit accept marker"* both when a channel had no accept path
and when the accept path never fired. Those look identical and mean opposite things.
Every funnel that emits `CANDIDATE` has an accept path by convention, so a missing
`PASSED` now reports as **`0 passed (0.0%) ◄── NEVER FIRED`**. That change is what
turned the secession result from a footnote into the headline above.

## `--section=story` — the history the sim writes about ITSELF

The sim carries a narrative layer that nothing in this repo had ever read:
`events.js narrate()`, `chronicle.js chronicleText()`,
`historiography.js perspectiveText()` / `exportHistory()`. It renders the run as prose
for the player — which realms rose, what befell them, in what order — and every
instrument here measured STATE while ignoring it.

    node tools/observe.mjs --steps=12000 --W=960 --section=story

prints the narrated world events and then the largest realm's own chronicle, in its own
voice:

    5600BC  Founded at the dawn of civilisation.
    2350BC  Marched to war against Ghesyahčeef.
     350BC  Treasury swelled past 4.0k.
      75BC  Sisiziitzupčeefa paid a heavy indemnity to Fevvonfax at the peace.
     275AD  Ghesyahčeef paid a heavy indemnity to Fevvonfax at the peace.
     333AD  Plague broke out in Fevvon and swept through the realm.

### Reading it corrected a conclusion held for two sessions

The chronicle says things the metrics did not: *"Facing hopeless odds, the court of
Fevvonfax bowed to Fiighfaxa — keeping its throne at the price of tribute"*, then
*"cast off Fiighfaxa and declared itself sovereign"*, then three separate realms
*"bent the knee and became a tributary"*, then one *"cast off Fevvonfax"* again.

Measured at the app grid over 16,000 steps:

| channel | count |
|---|---|
| `war.began` | 74 |
| **`polity.submitted`** (bent the knee → tributary) | **16** |
| `settlement.captured` | **0** |
| `settlement.annexed` | **0** |

**Consolidation in this sim runs almost entirely through VASSALAGE, and through
annexation not at all.** The standing "nothing is ever conquered" finding — carried
across two sessions and several documents — was measuring `settlement.countryId`
transfers and captured tiles, i.e. the one channel that is zero, while a tributary
network formed roughly once per thousand steps in plain sight.

That also resolves a paradox in the numbers: realm COUNT rises monotonically while
`_dominance` shows a single realm towering 6-9× over the median. Both are true. The
hegemon exists and rules through tribute, and **a tributary is invisible on the
political map** — so the map reads as fragmented while the politics are not.

## Known gaps in observability

Ranked by what they cost. Closed items are kept, struck through, so the next reader can
see what was already tried.

* ~~No TRAJECTORIES~~ — **fixed**: `trace --entity=` / `--out-entities=` and the ARCS
  block (below). Note the prediction attached to this entry was **wrong**: it said
  there would be "no falls to shape" because `life.polity.died = 0`. Realms decline
  constantly; they just never die.
* **Arcs are trace-only, not in `collect()`.** `arc.*` is derived from a whole run, so
  a snapshot cannot compute it and `abtest`/`bisect` cannot diff it. Making it
  snapshot-computable would mean the sim itself remembering each realm's peak extent
  (there is precedent — settlements already carry `_popPeak`), which is a `src/` change
  adding real state and should be an explicit decision, not a measurement side effect.
* **`trace` loses early history in very long runs.** The live event log prunes at
  200k events; `trace.mjs` already walks `prevEvents` per checkpoint and could drain
  into its own permanent store, defeating the cap with no `src/` change.
* **Funnels cover 10 gates.** `found`, `nucleate`, `growth`, `marginalTile`, `capture`,
  `submit`, `attack`, `secede`, `roadPeer`, `roadPlan` — the whole political spine
  (where states are born, grow, fight, consolidate, come apart) plus the trade network.
  Absent: the food passes, faith/culture birth, colony founding. Migration is
  deliberately excluded — it is continuous field flow, not a candidate/reject decision,
  so a funnel is the wrong instrument and it needs its own.
* ~~Observe and trace are single-seed~~ — **fixed**: `npm run spread` (below) puts an
  error bar on every metric and every funnel. `observe`, `trace` and `why` are still
  single-seed themselves; `spread` is the instrument you reach for before quoting one
  of their numbers as a finding.
* ~~No metric carries its own sample size~~ — **fixed**: `dist()` emits `.n` on every
  distribution. Found by being misled by this suite's own output: the 15.7× cross-grid
  dynasty lifespan above looked like a result until you saw it rested on 3 and 6
  completed lives. Without `.n` a diff cannot tell "this moved" from "this had two data
  points", and abtest's ranking was one anecdote away from a wrong call.
* **Individual entities below the realm level are only ever aggregated.** Every class is
  now *distributed* (`person.*`, `culture.*`, …), but there is still no way to ask about
  **one** settlement, one culture, one dynasty, or one road.
* **Language and faith internals are distributed, not CHARACTERISED.**
  `lang.prof.tone.p50` and `faith.doctrine.militancy.p50` exist now, so a change to them
  is diffable — but a distribution is not a description: no phoneme inventory, grammar
  or doctrine summary. `tools/langlab` covers some of this separately.
* **Per-tile history** is only what the fields remember (`_tileHomeland`, `_tileFellAt`,
  `_tileCapturedAt`); there is no general "what happened on this tile" query.
* **7.2% of entity state is still outside the collector** — `_moneyFlows`, `_evIndex`,
  `_urbanSpike`, `_royalCourt`. Audited as duplicate or scratch rather than missing
  signal (`_moneyFlows`' aggregate is already in `sett._mIn`/`_mOut`), so this is
  recorded for honesty, not queued as work.
* ~~Nothing audits the collector's own coverage~~ — **fixed**: `npm run coverage`, and
  it is a gate (see below).
* **Nested objects still collapse to a count in the `--nation=` drill-down**
  (`_techEff={22}`, `knowledge={6}`). The *collector* now descends into them, so
  `abtest`/`bisect`/`trace` see them; only observe's human drill-down print does not.
* ~~No per-tick time series~~ — **fixed**: `tools/trace.mjs`, with `--out=` CSV.
* ~~No diffing~~ — **fixed**: `tools/abtest.mjs` diffs the whole metric map, multi-seed.
* ~~The active lever configuration is not recorded~~ — **fixed**: `provenance()` stamps
  commit, dirty-src, seed, grid and the lever diff on every `observe` run.
* ~~`world.debug` is not surfaced~~ — **fixed**: `collect()` emits `debug.*` (tickMs,
  invariantHits, receded counters), so performance and invariant health diff too.
* ~~Nested state is invisible to the collector~~ — **fixed**: depth-2 descent, +1,676
  metrics, see above.
* ~~Graph structure is counted, not described~~ — **fixed**: `graph.*` and
  `observe --section=graph`.
* ~~The collector measures three entity classes of eight~~ — **fixed**: `culture.*`
  `lang.*` `faith.*` `dynasty.*` `person.*`, plus `eventv.*` payload magnitudes. Dark
  share of entity state 36.5% → 7.2%.
* ~~Variable-length lists were enumerated positionally~~ — **fixed**: a vector is
  indexed only when its length is identical across the whole class, detected from the
  data; lists collapse to `.len`.
* ~~Realm lifespans are unmeasurable~~ — **fixed**: `life.*`, computed from the
  permanent birth/death stamps with no recording, right-censored, and carrying its own
  retention caveat. Its first read was that nothing except people and dynasties has
  ever died.
