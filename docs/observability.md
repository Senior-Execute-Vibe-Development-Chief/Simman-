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

## The design rule: introspection, not a list

The tool carries **no hardcoded field list**. It walks the live world and reports every
typed array of length `N`, every numeric key present on settlements / countries / polity
records, every Map/Set/Array by size, and histograms the event log. **Add state anywhere
and it appears here on the next run with no edit.**

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

## Known gaps in observability

* **No per-tick time series.** `--every=N` re-snapshots, it does not record a trace. A
  real trace (one row per checkpoint, CSV) would make regressions bisectable by eye.
* **Language and faith internals** are counted but not characterised (no phoneme /
  grammar / doctrine summary) — `tools/langlab` covers some of this separately.
* **Per-tile history** is only what the fields remember (`_tileHomeland`, `_tileFellAt`,
  `_tileCapturedAt`); there is no general "what happened on this tile" query.
* **No diffing.** The highest-value next addition is `observe --json` at two commits
  piped through a differ, so "what did this change actually move?" is one command
  instead of a bespoke A/B.
* **The active lever configuration is not recorded in a snapshot.** A dump does not say
  which `T.*` values produced it, so two snapshots cannot be safely compared without
  external bookkeeping. Should be the first line of every report.
* **`world.debug` is not surfaced** — `tickMs`, `invariantHits`, `recededTiles/People`,
  slave-trade counters. Performance and invariant health are outcomes too.
* **Nested objects collapse to a count** in the nation drill-down (`_techEff={22}`,
  `knowledge={6}`, `_gPrice=[8]`, `culMix=[4]`). "Every field" is true only one level
  deep.
* **Individual entities below the realm level are only ever aggregated.** There is no
  way to ask about one settlement, one culture, one dynasty, or one road.
* **Graph structure is counted, not described** — the liege tree, the alliance graph,
  the road network and the trade graph all report as sizes, never as topology.
