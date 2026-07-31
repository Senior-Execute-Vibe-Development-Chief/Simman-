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

---

# THE MEASUREMENT SUITE

`observe` answers "what is the world like?". The other two answer the questions that
actually consumed this session, and both were hand-rolled repeatedly before existing.

## `tools/lib/simmetrics.mjs` — one collector, every consumer

`collect(world)` returns a FLAT map of `metricName -> number`, built by the same
introspection rule as `observe`: every length-N tile field, every numeric key on
settlements / countries / polity records, realm geometry, every collection size, the
chronicle histogram, `world.debug` counters. **~1,570 metrics today, and it grows by
itself.** Every tool below consumes it, so all measurements are directly comparable —
the trap the manual bisects fell into was each pass measuring its own two or three
numbers.

`provenance(world)` returns commit, whether `src/` is dirty, seed, grid, step and the
**lever diff against shipped defaults**. `observe` now prints it as the first block: a
measurement that does not say which code and which levers produced it cannot honestly
be compared with another.

## `npm run abtest` — what does this lever actually do?

    node tools/abtest.mjs --tune="CATCH_WILD=1,SIZE_WORKED=1"
    node tools/abtest.mjs --tune="SPAN_TECH=0" --steps=12000 --W=960
    node tools/abtest.mjs --tune="ORG_BIRTH_VAR=0" --seeds=8817,31337,4242
    node tools/abtest.mjs --env="SIM_SUCCESSORS=0" --grep=realm,shape

Runs both arms on the same seed, diffs **all ~1,570 metrics**, prints a fixed HEADLINE
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
named in advance: it ranks every one of the ~1,570 by how sharply it steps and reports
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
writes one CSV row per checkpoint × ~1,570 columns.

This is what made the old `_sizePopK` anchor legible as UNSTABLE rather than merely
generous — its median realm swung 92k → 23k → 11k → 80k km² across four checkpoints.
Reading that took four separate manual runs; `--unstable` now ranks every metric that
oscillates, automatically.

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

Not yet wired: war INITIATION (`armies.js` still uses its own bespoke `WDBG` counters
and should be migrated onto this layer), the food/trade passes, and migration.

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
* ~~The active lever configuration is not recorded~~ — **fixed**: `provenance()` stamps
  commit, dirty-src, seed, grid and the lever diff on every `observe` run.
* ~~`world.debug` is not surfaced~~ — **fixed**: `collect()` emits `debug.*` (tickMs,
  invariantHits, receded counters), so performance and invariant health diff too.
* **Nested objects collapse to a count** in the nation drill-down (`_techEff={22}`,
  `knowledge={6}`, `_gPrice=[8]`, `culMix=[4]`). "Every field" is true only one level
  deep.
* **Individual entities below the realm level are only ever aggregated.** There is no
  way to ask about one settlement, one culture, one dynasty, or one road.
* **Graph structure is counted, not described** — the liege tree, the alliance graph,
  the road network and the trade graph all report as sizes, never as topology.
