# TIER C / LANE C0-1 — THE COUPLING SURVEY
## Every site where a settlement entity is PHYSICAL rather than a label (HEAD 19bd402)

**The test applied** (from docs/settlement-ontology.md): a settlement is legal as (1) the economy's atom, (2) a seat of government, (3) population bookkeeping. It is PHYSICAL — a Tier-C target — wherever its *position, spacing, count, or existence* authors the world's spatial/demographic/political state instead of reading it. The measured stake: ~90 entities at 24k on BOTH the 240- and 480-tile grids (long-run-report §5 W4) — entity supply does not scale with area, and it caps country count, road realism, successor supply, and war density (R1).

**Legend** — Verdicts: **F** = MOVES-TO-FIELD; **L** = STAYS-AS-LABEL-ATTRIBUTE (story/seat/economy — legal roles); **A** = NEEDS-ADAPTER (stays on the label but its input/creation must be re-keyed to the field). Risk: what breaks if inverted naively.

---

## 1. Economic catchment — territory.js (the deepest remaining physicality)

| site | (a) what it reads from the entity | (b) field equivalent | (c) verdict | (d) risk |
|---|---|---|---|---|
| core block stamp, territory.js:243-260 (`coreRadiusFor`, CORE_BY_TIER=[1,2,3,4]) | `s.pos` + `s.tier` author a guaranteed owned block in `_territoryOwner` | none — this IS the authored partition | **A** — becomes "the label's home tile(s)", a read of where the label sits | LOW alone |
| hinterland Voronoi, :274-290 (`hinterlandRadiusFor`, HINTERLAND_BY_TIER=[3,4,6,8]×T.HINTERLAND_MULT) | `s.pos`, `s.tier`, nearest-wins d² | none | **A** — nearest-label assignment *within the border* (CATCHMENT_CLIP already forbids political effect) | MED |
| reach-budget Dijkstra, :203-373 (`reachBudget` = TERRITORY_BASE 5 + reachLevel×T.ORG_REACH; per-owner knowledge edge costs) | `s.pos` (sources), `s.knowledge` (budget + edge tariffs), heap flood over all N | cost machinery is per-tile; devField could supply regional tech | **A** | **HIGH** — this flood is ~97% of compute at 1920px (doc'd); it is also the ONLY thing that partitions tiles among labels |
| tallyTerritory outputs, :386-518: `_terrFertSum/_terrTiles/_terrWorkTiles/_terrFarmedWt/_terrWorksWt/_terrWorksMean`, `localRes`, `_minableTiles` | per-entity sums over its owned tiles | inputs already per-tile: `fert`, `climMod`, `worksField`, `deposits`, `depositReserve`, `_soilFatigue` | **F** for production (see §2); **L** for `localRes`/mines (economy bookkeeping per label) | HIGH (25 consumer sites in settlement.js alone) |
| `world._borders` (:518) | settlement-adjacency map | `_countryOwner` adjacency | **DEAD — written, zero readers.** Delete in C4 | none |
| `reclaimRuins` :152-169 | owner entity's org excavates hoards | — | **L** | none |
| `seedLocalTerritory` :524-570 | `s.pos` box scan pre-first-pass | same tile inputs | **A** (follows whatever the catchment becomes) | LOW |
| CATCHMENT_CLIP guards :220-232, :253, :286, :369 | catchment reactive to `_countryOwner` | — | already the Tier-C direction; keep | — |

**Status**: politically inert (CATCHMENT_CLIP, default on since v3), but still the AUTHORED geometry that three resolutions ride at once: food production (§2), the ONE_POP census partition (§3), and soil/mines/fish-shore geometry. This is "one entity carries three resolutions" one level down from the polity version the field rewrite already fixed.

## 2. Food & economy — settlement.js, foodHierarchy.js, goods.js, money.js, roads.js (trade)

| site | (a) reads | (b) field equivalent | (c) | (d) |
|---|---|---|---|---|
| `updateFood` settlement.js:2426 — land food from `_terrFertSum/_terrFarmedWt/_terrWorksMean` + farm-labour floor | the entity's catchment sums | `worksField`, `fert×climMod`, `_soilFatigue`, popField labor all per-tile — production COULD be computed on tiles and aggregated per label | **F** (production on the field; the label keeps the market/granary ledger) | **HIGH** — B3 precedent: re-grounding food is a REGIME change (pop ×0.2); whole calibration rides these magnitudes |
| fishing, :2364-2425 (`shoreTilesOf` from `s.pos`, `_fisherFrac`, per-coast `_fishTaken` stocks) | entity anchors the shore scan | `_fishTaken` is ALREADY a per-tile depletable field (B3) | **A** (shore assignment by label; stocks stay field) | LOW |
| `updateSoil` :2291 (clips to catchment) | catchment geometry | `_soilFatigue` per-tile | **F** (fatigue where farmed on the field) | LOW |
| food hierarchy, foodHierarchy.js:85-260 — liege TREE (`s.liegeId`, same-country), haul survival from `s.pos` distance (`foodHaulArrive`), SHIP_FRAC/GRAIN_PRICE by tier | entity graph + entity positions | none; hierarchy is central-place ECONOMY | **L** (economy's atom — legal) but **A** on supply: tree shape/haul ranges recalibrate when label density scales | MED |
| crafts/goods/luxury: `_gPrice/_gShare/_gStock/_gCapx`, `_specKey`, `localRes`, computeExportValue :1106 | per-label market state | none intended ("abstract story and ECONOMIC units") | **L** | LOW |
| money.js 16 channels, wealth, credit, inflation components | per-label ledgers | none intended | **L** | LOW |
| trade: roads.js partner reach (~12 partners, `partnerReachFor`), sellGoods :1569, entrepôts | entity graph over entity positions | roadQuality/roadFlow per-tile already | **L** + **A** on constants (see §7) | MED (perf O(n·k)) |

## 3. Demography — the ONE_POP bridge (popField.js) — CANONICAL DIRECTION, partition still entity-authored

| site | (a) | (b) | (c) | (d) |
|---|---|---|---|---|
| `deriveOnePop` popField.js:1455-1628 — `s.people = Σ popField over {_territoryOwner==s.id} × _onePopScale` | THE census partition = the entity-authored catchment | popField canonical | **A** — census becomes the label's basin read (whatever geometry C-phase 3 lands) | **HIGH — see "riskiest coupling"** |
| urban spike/agglomeration/graveyard :1521-1627 (`s.pos` core disk, `_urbanPop/_ruralPop`) | label position = concentration site | field does the moving | **L** — a label legitimately HAS a position; under Tier C the position becomes a READ (the peak it names) | MED |
| `fieldShift` :1649-1678 (all demographic events debit/credit at `s.pos`) | label position as event anchor | popField | **L** (correct under Tier C) | none |
| `_onePopScale` frozen bridge scalar :1470-1486 (persisted) | median census per median catchment AT ACTIVATION | — | **A** — unit conversion must survive label-supply scaling (see riskiest coupling) | HIGH |

## 4. Entity BIRTH — crystallize.js (THE Tier-C core: supply does not scale)

| site | (a) | (b) | (c) | (d) |
|---|---|---|---|---|
| founding sweep `maybeCrystallize` :335+ — spacing MIN_SETT_DIST=8 × REGION_SPACING (T, def 2) × capacitySpacingMul(≤2.5) × rn; site scores (geo/road/resource/defense) | a FIXED SPACING QUANTUM in ref-tiles mints the atom; supply ∝ 1/spacing², saturates ~90 planet-wide | TOWN_BASIN gate already reads the field (:704-715: basin ≥ 360 field people in r=10 ref-tiles); founders debited from the field (:746) | **F** — birth becomes a field READ: label where the basin's field people clear the bar and no existing label claims the basin; spacing EMERGES from basin exclusivity, so supply scales with density at any grid | **HIGH** — this is the R1/W4 lever; every per-entity density downstream shifts |
| daughter colonies `sendSettlers` :1074, plantations `maybePlantTowns` :1181, sea `foundColony` sea.js:819 | parent entity chooses site by spacing rules | same basin machinery available | **A** (keep as state/parent ACTS that mint labels, but site choice reads the field) | MED |
| born-into-state gates (FISC_ADOPT, statecraft symmetry) :720-741 | court affordability per new label | fine as-is | **L** | LOW |
| `maybeUrbanGenesis` :1361 | DEAD under DISSOLVE_FARMS (:1362 early-return) | — | delete-with-lever in C4 | none |

## 5. Politics — countryTerritory.js + conquest.js + entities.js (mostly inverted; residuals are seats & succession)

| site | (a) | (b) | (c) | (d) |
|---|---|---|---|---|
| capital anchor, countryTerritory.js:561-580 (+ pre-pass fallback :572-588) | capital `s.pos` = the ONLY anchor (TILE_POLITY def 1) | `_countryOwner` authored | **L** — role 2, the deliberate design | — |
| coverage floor :794 (COVER_BASE 25 + COVER_ORG 260 × org) | capital org | — | **L** | — |
| `nucleateFrontierStates` :1980+ — seat MUST be a stateless settlement ENTITY (NUCLEATE_SEAT_POP 160, CLUSTER 400, CAP_DIST 8); BIRTH_FIELD mass already field | **entity supply caps country count** (diagnosis #4, still binding) | popField maxima (the 4b sketch, designed) | **A** — 4b: seed at unclaimed popField MAXIMUM; the seat label may be minted BY the founding | HIGH |
| `adoptAndFound` :1821-1978 | derives flags from ground (inverted); wilderness city self-founds :1936 | — | **A** — under 4b a stateless non-capital city stops self-founding | MED |
| aliveness, entities.js:187-209 (`reconcilePolities`: live = any settlement with countryId; "realm dies with its last city"); substantiality :201 (`members.length>1`) | the member ROSTER is the nation's existence | field integrals exist (territory area, popField mass) + "has crowned seat" | **A** — V4: aliveness = crowned seat + field integrals | MED |
| provinces: `assignProvinces` conquest.js:738-761 (`_provinceCity` by entity proximity), governor power :2847-2868 (`provPower` = Σ settlementPower per seat) | entity proximity partitions provinces; seat power entity-summed | `s._govPeople` already field (PROV_FIELD def 1) | **L** (seats) + **A** (partition could read the field; falls out of label density) | LOW |
| V3 family — `shedPatch` :1066, `fragmentRealm` :1253 (successors = max(2, ceil(cityCount/2))), `declareIndependence` :1398, `restoreNations` :932, enclaves :3645 | events transfer MEMBER LISTS then patch the field; successor count quantized by city-label supply (B1 improved witnessing; 19 shatters → 0 fragment successors at depth) | loyalty field gives secession its geometry (`_allegiance`, `_tileHomeland` — built, V2 done) | **A** — V3: transfer TILE REGIONS + crown a seat; successor supply also unlocked by C1 label density | HIGH |
| `absorbWeakNeighbors` :3464 (stamps worked region into `_countryOwner`) | already field-stamping | — | done | — |
| `fiscAdoptable` entities.js:64-80 (capital-distance load) | capital pos — seat read | — | **L** | — |
| polity id = founding-capital settlement id (entities.js:22) | id-space coupled to label registry | — | **L** (keep; ids are story) | LOW |

## 6. War — armies.js (tactical layer already on the tile field; residuals are seat-hosted)

| site | (a) | (b) | (c) | (d) |
|---|---|---|---|---|
| country adapters :728-748 (front scan on `_countryOwner`; `_M`=Σ member might, `_homeTi`=capital tile, WAR_REACH exp decay) | capital pos + member-summed army | done — the 4c inversion shipped | **L** | — |
| garrisons: `musterArmies` :327 (ARMY_TIER_FRAC × s.people, food/pay gates), levy :417 (`_ruralPop`) | per-city hosting | MUSTER_FIELD (def 1) already field-caps the POOL | **L** — cities host troops by design | LOW |
| forward bases :763-810 (garrisoned member towns extend projection) | member positions+garrisons | — | **L** (what garrison towns are FOR) | LOW |
| storm = capital label falls → `fragmentRealm`; fortress = capital homeMight :242 | seat siege — legal | — | **L** | — |
| casualty reconcile → member garrisons (`_armyStart` proportional) | roster distribution | — | **L** (bookkeeping role 3) | LOW |
| `fortRef` :683-687 = 85th-percentile settled garrison | a PERCENTILE over the entity population — self-recalibrates as label supply scales | — | **L** (verify distribution shift under C1) | MED |
| amphibious beaches (defender country water-edge) | field | done | — | — |

## 7. Roads — roads.js (entity endpoints; the R1 costume)

| site | (a) | (b) | (c) | (d) |
|---|---|---|---|---|
| kin links `linkCloseNeighbours` :794-825 (CLOSE_NEIGHBOUR_DIST=12 ref-tiles ≈ the entity spacing floor — diagnosis #11: the floor IS the symptom) | entity spacing sets minimum road length | road paint (`roadQuality/roadFlow`) is per-tile already | **L** endpoints + the pathology is FIXED BY C1 (denser labels ⇒ shorter links); A6's walked-length cap stays | LOW after C1 |
| trunk planning `tryAddRoad` :886 (SEG_CAP_BASE 12 + SEG_CAP_LOGI 36×logistics), Gabriel test, components | entity pair graph | — | **L**; re-derive radii/caps once density scales | MED (perf) |

## 8. Courts / dynasties / cultures / faiths / chronicle — pure story: the destination state

dynasties.js (courts at capitals, marriage by capital distance :313-342, republic primacy via PROV_FIELD), cultures.js/faiths.js (registries + per-settlement mixes `culMix/faithMix/langMix/ancMix`; identityField TILE_IDENTITY def 0 is the field-authoritative option, deliberately parked), chronicle.js/historiography.js (event coords from `s.pos`). **All L.** Risk LOW. These are what a LABEL is for.

## 9. Shocks / slavery / sea

| site | (a) | (b) | (c) | (d) |
|---|---|---|---|---|
| famine shocks.js:197 (FAMINE_RADIUS=12 tiles around a seed SETTLEMENT, `_harvestMul` per entity) | entity-radial; absolute radius (diagnosis #6: 1.5% of an empire) | climMod per-tile exists; could strike a REGION of the field | **A** (C4) | LOW |
| plague (trade-graph spread), virgin-soil radius :143 | entity graph — epidemiology between market towns is honest | fieldShift mirrors deaths to land (FIELD_DEMOG) | **L** | LOW |
| razzia slavery.js:124 (forEachNear s.pos, RAID_RANGE 28) | entity-radial; captives fieldShift both ends (SLAVE_PEOPLE) | popField for victims possible | **L** now, **A** later | LOW |
| sea.js ports/embark :202, nearest-port ocean Voronoi :350, charters (B4b state actor) | port entities seed the sea flood | — | **L**; port density scales with C1 | LOW |

## 10. UI / persist

persist.js: SETT_FIELDS (:76-102) serializes `pos` + ~60 label attributes — a label is still an object; **no schema change needed for C1/C2**. `_territoryOwner` is persisted (:272) — if C3 makes the catchment derived-per-pass it can LEAVE the save (v5, with the v3-style default-flip compat guard :357-361). hashWorld covers settlements + fields. WorldSim.jsx renders the mirror (markers at `s.pos`) — unchanged; more markers need LOD, render-only. **L/A, risk LOW-MED (save v5 discipline).**

---

# THE PHASE ORDER (extending the proven pattern: lever default-off → byte-identical → probe → stylized 3 seeds → flip; median-anchor any distribution shift — the POW_FIELD/CAP-grounding pattern, twice proven)

**C1 — LABEL_BIRTH (T.LABEL_BIRTH): entity supply reads the field.** Crystallize's fixed spacing quantum (MIN_SETT_DIST×REGION_SPACING×capacitySpacingMul) is replaced by basin-exclusive field nucleation: a label founds where an UNCLAIMED market basin (TOWN_BASIN_R) holds ≥ the town bar of field people — the machinery at crystallize.js:704-746 already computes exactly this as a GATE; C1 makes it the SUPPLY. Spacing emerges from basin exclusivity → density scales with popField at any grid (closes W4/R1). Independent: no other subsystem changes; makeSettlement, adoption gates, ONE_POP debit all carry over. **Prerequisite for the value of everything else.**

**C2 — SEAT_FIELD (4b + V3 + V4, likely 2-3 levers): politics stops depending on label supply.** (i) 4b: nucleateFrontierStates seeds at unclaimed popField maxima; stateless non-capital cities stop self-founding. (ii) V3: secession/fragment/restore transfer TILE REGIONS (geometry = the contiguous low-`_allegiance` patch — V2 is built and waiting) and CROWN a seat; retires the member-list-then-patch pattern and the cityCount/2 successor quantum. (iii) V4: aliveness = crowned seat + field integrals (entities.js:187-209). C2 is structurally independent of C1 but its OUTCOME (successor/realm supply) needs C1's label density to express; build C2 second, measure the pair.

**C3 — FOOD_FIELD: production on the land, the catchment retired to a derived market partition.** Land food computed per-tile (fert×climMod×worksField×field labor) and aggregated per label; the reach-budget Dijkstra (the 97%-of-compute flood) collapses to a within-border nearest-label assignment; `_soilFatigue` accrues where farmed on the field; deriveOnePop's partition re-keys to the same derived basin. LAST because it re-grounds economic magnitudes (the B3 precedent: expect a regime change, plan the leaner-world-style reckoning) and because C1/C2 must be stable to attribute its effects.

**C4 — residual sweep:** famine→field regions; delete dead `world._borders` and `maybeUrbanGenesis`; re-derive road/partner constants at scaled density; persist v5 (drop `_territoryOwner` if C3 landed); fortRef/percentile-bar distribution audit.

**Byte-identity boundaries:** every lever default-off byte-identical (probe_hashbase A/B at 480, incl. float order); the percentile tier bars (B3) and fortRef self-calibrate with entity count — verify, don't re-anchor; absolute census bars need the anchor treatment below.

# THE SINGLE RISKIEST COUPLING

**Census-unit deflation through the ONE_POP bridge.** `s.people = Σ popField(catchment) × _onePopScale` (popField.js:1455-1589). World field population is conserved, so scaling label supply N× divides the SAME field people among N× more labels: every label's census falls ~N× while `_onePopScale` — frozen at activation and persisted — cannot re-calibrate. Every ABSOLUTE census threshold then mis-fires simultaneously: NUCLEATE_SEAT_POP 160 / NUCLEATE_CLUSTER_POP 400 (state birth), TOWN_FOUND_MIN 90 / TOWN_BASIN_MIN 360 (further founding — a feedback loop on C1 itself), tier floors 60/240, COLONY_MIN_POP, SIZE_REF 1000 (fisc), ARMY_TIER_FRAC×people (garrisons → storm bars → war), levy/plague/sack magnitudes. This is not one bug but a UNIT REGIME shift threaded through every subsystem at once — the exact mechanism by which a naive C1 would break everything while looking locally correct. Mitigation must be designed INTO C1: either thresholds re-derived as percentile/field-mass reads (the B3 bar pattern — preferred, mechanism-honest), or a documented one-time unit re-anchoring; never per-site fudge factors (second cardinal rule).

## Constants

Entity-supply quantum (C1 targets): crystallize.js MIN_SETT_DIST=8, SPARSE_SPREAD (barren ×2.5 via capacitySpacingMul), T.REGION_SPACING def 2, URBAN_SPACING=5, TOWN_FOUND_MIN=90, TOWN_BASIN_MIN=360, TOWN_BASIN_R=10, COLONY_MIN_RANGE=10, FRONTIER_EXTEND_DIST=28. Absolute census bars at deflation risk (riskiest coupling): NUCLEATE_SEAT_POP=160, NUCLEATE_CLUSTER_POP=400, NUCLEATE_CAP_DIST=8 (countryTerritory.js:1996-1999); tier floors max(60,P50)/max(240,P85) (percentile — self-calibrating, B3); SIZE_REF=1000 (entities.js:35); ARMY_TIER_FRAC=[0.02,0.05,0.09,0.11]×1.075 (armies.js:42); COLONY_MIN_POP (sea.js). Catchment geometry: TERRITORY_BASE=5 + reachLevel×T.ORG_REACH, CORE_BY_TIER=[1,2,3,4], HINTERLAND_BY_TIER=[3,4,6,8]×T.HINTERLAND_MULT (territory.js:48,116,128). Political anchors: T.COVER_BASE=25, T.COVER_ORG=260, T.FIELD_SPAN=6, T.EXPAND_RATE=8, T.WAR_REACH=15. Road/entity-spacing twins: CLOSE_NEIGHBOUR_DIST=12 (roads.js:272), SEG_CAP_BASE=12+SEG_CAP_LOGI=36. Radial absolutes: FAMINE_RADIUS=12 (shocks.js:25), RAID_RANGE=28 (slavery.js:35). Bridge scalars (persisted, frozen or smoothed): _onePopScale, _musterRatio, _provRatio, _refCapPowerS, _refRevenue, _refRealmPop. Levers in play: POP_FIELD=1, ONE_POP=1, TILE_POLITY=1, CATCHMENT_CLIP=1, POW/MUSTER/PROV/BIRTH_FIELD=1, LOYAL_FIELD=1, GRIEV_LEDGER=1, DISSOLVE_FARMS=1, TILE_IDENTITY=0 (parked), SUCCESSOR_STATES=1. SAVE_VERSION=4.

## Validation plan

Per phase (the proven arc discipline): (1) probe_hashbase A/B at 480 lever-off — byte-identical including float order; (2) npm test smoke (determinism, invariants, save/load roundtrip); (3) lever-on functional probe committed under tools/ — C1 wants a NEW probe_entitysupply.mjs measuring entity count vs grid (240/480/960) and vs field density, acceptance: count scales ~area×density instead of pinning at ~90 (the W4 signature gone); (4) stylized 3 seeds (8817/4242/777) all hard gates, soft warnings within budget — note percentile tier bars and fortRef should self-recalibrate, VERIFY the Zipf/urbanization gates rather than re-anchoring them; (5) probe_empires 480 ≤12k lean (shared CPU) for realm count/turnover/top-5 — C1+C2 acceptance: realm count ceiling rises with entity supply, successor events >0 after shatters (the depth residual), no confetti (anti-confetti fold retained); (6) 960 spot-check for the resolution claim (entity supply at the app-like grid ~4× the 480 count); (7) for C3, an explicit A/B regime reckoning à la B3 (expect magnitude shifts; document, don't fit), plus the food-composition channel now in the closing battery; (8) save-compat: v4 loads under new defaults keep their regime (v3-pattern guard) before any v5 bump; (9) hegemon/successor probes re-run only after C1+C2 land (contact density is the known confound). Riskiest-coupling guard: a dedicated assertion probe that world field population, Σ s.people, and _onePopScale stay mutually consistent as entity count scales.

## Risks

1) Census-unit deflation (THE named riskiest coupling): label supply ×N divides the conserved field among N× more labels; every absolute census bar (state birth, town founding, fisc, garrisons, colony) mis-fires at once while the frozen persisted _onePopScale cannot re-calibrate — must be solved structurally in C1 (percentile/field-mass bars), not per-site. 2) C1 feedback loop: TOWN_BASIN_MIN is itself a census-adjacent constant; naive scaling could runaway-mint or starve foundings. 3) Perf: O(n) and O(n·partners) passes (foodHierarchy, trade, roads, muster) grow with entity count; the territory Dijkstra is O(N log N) regardless but its per-owner bookkeeping grows — C3 is the real perf fix, so C1 must be measured for tick cost at 960 before flip. 4) C3 is a B3-class regime change (food magnitudes re-grounded) — expect population/wealth shifts and a leaner-world-style reckoning; do not tune it back to the old numbers. 5) V3 region-transfer touches conquest.js:1064-3140, the densest event code in the repo; the B1 witnessing events (polity.receded/settlement.lapsed) must survive re-keying. 6) War distributions (fortRef percentile, casualty reconcile) shift with entity count — verify episodic-decisive war character at C1 flip. 7) Save v5: dropping _territoryOwner requires the derived partition to be exactly reproducible at load (the warm-up-no-mutation contract, persist.js:507-537). 8) Second-cardinal-rule exposure: the temptation at every step is to re-fit the ~90-entity constants; each replacement must be a mechanism (basin exclusivity, percentile bars), never a dialed count.

## Open questions

1) C1 birth semantics: is a label minted the moment a basin clears the bar (pure read — labels can also DISSOLVE when the basin empties?), or does founding remain a discrete conserved ACT (fieldShift debit) as today? Label death/dissolution is currently only demographic — should a label whose basin empties be retired, and what happens to its story attributes? 2) C3 catchment endpoint: derived nearest-label partition per pass (cheap, keeps the census partition) vs. no partition at all (food and census both read radial basins) — the latter is purer but breaks the mine/shore/soil assignment that wants exclusivity. 3) Does the liege tree (food hierarchy topology) survive as-is at 4-10× label density, or does it need depth limits / market-town promotion rules re-derived? 4) _onePopScale under C1: freeze-at-activation is self-consistent for fresh worlds but a v4 save loaded under C1 carries a scalar calibrated at old density — is the v3-style regime guard (old saves keep C1 off) sufficient, or does the scalar need a documented re-anchor path? 5) 4b seat minting: may nucleation CREATE the seat label at a field peak (a virtual seat crystallizing into a town), or must it wait for C1 to have supplied one — i.e., does C2 depend on C1 harder than surveyed? 6) TILE_IDENTITY (default 0, the kin-gravity trade-off): Tier C makes rural identity more load-bearing (more labels, smaller counties) — does the parked flip decision re-open inside C2's V3 geometry? 7) Where does the render LOD line go when the app grid carries ~400-800 labels (WorldSim mirror cost)? 8) Should famine/shock regionalization (C4) ride climMod or a new per-tile shock overlay — and does it stay entity-witnessed for the chronicle?