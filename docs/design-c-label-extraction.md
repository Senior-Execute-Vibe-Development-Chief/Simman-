## C0-3 — The region economy: from per-settlement claims to market-sheds read off the field

### Frame
Tier C's endpoint (docs/field-polity-spec.md Phase 3) makes a settlement a LABEL — name, court, market, story — read out of popField, "no PHYSICAL impact." The economy is the last place the label still authors ground: `world._territoryOwner` is written by the label's own cost flood (territory.js:171-378) and consumed by ~9 spatial facts: `_terrFertSum/_terrTiles/_terrWorkTiles/_terrFarmedWt/_terrWorksMean` (food ledger, settlement.js:2639,2655), `localRes` grade×substantiality (territory.js:505-517), `_minableTiles`, the borders map (territory.js:486-491 → conquest), the census read (deriveOnePop, popField.js:1455-1601), the FOOD_K writeback (popField.js:614-634), urban concentration's hinterland drain (popField.js:1560-1587), soil clipping (updateSoil), and fieldShift's owner scans. That enumerated seam IS the design surface; everything else in the economy (goods vectors, hierarchy tree, trade pairs, money channels) is already label-keyed and stays.

### 1. What a market region IS: the MARKET-SHED
- **Not the political region.** Markets ≠ states: trade crosses borders (roads.js tariffs/FX/entrepôts exist because it does), a realm holds many sheds, and political churn would whipsaw food. The political map remains only the CLIP (CATCHMENT_CLIP semantics, territory.js:211-232, 253, 286, 369 — "you farm only your country's ground" is load-bearing, default-on, validated; it is what makes war/blockade bite).
- **Not the label's authored claim** — that is what Tier C abolishes.
- **The market-shed**: the partition of POPULATED land (popField > 0) by cheapest transport cost to a label, within the label's org-scaled market horizon (reachBudget, territory.js:78-92 — reused, no new constant), clipped to the label's country. Land beyond every horizon is subsistence countryside: the field feeds itself there (exactly what FOOD_K already does for wild land, popField.js:610-611). This is central-place theory made literal — and mechanically it is today's multi-source Dijkstra (territory.js:309-373) DEMOTED from authored claim to derived readout, so the first stages can be byte-identical refactors.
- **The structural change: split PARTITION from TALLY.** Today one fused flood computes the partition (heap + localEdgeCost per 8-neighbour edge — the expensive part, the "edge-cost family" in the 2026-07-25 profiles) AND tallies fert×climMod/works/resources — which is why the audited recompute-skip was impossible (roadmap-wave-6: inputs genuinely drift every firing). Under the shed model the TALLY is a flat O(N) pass over a stored partition (no heap, no edgeCost — runs every firing, always fresh under climMod), and the PARTITION updates incrementally: re-flood only around born/dead labels, country-border deltas, and a budgeted B80-style relaxation wavefront for slow tech-driven cost drift, with switch hysteresis (a tile re-markets only when the challenger is SHED_HYST cheaper — marketing habit; also kills border flicker).

### 2. Trade links: labels stay the nodes; regions are what they speak for
The trade graph is already label-keyed (`s._tradeReach` computeReach roads.js:539, pair sweep roads.js:1145-1230, goods flows runGoodsTradeBetween roads.js:1363-1430, sea lanes, the liege tree foodHierarchy.js:159-176). Region-to-region trade = label-to-label trade where each label's supply/demand aggregates its shed — no new topology object, the goods-vector economy keeps its shape and its audited sellGoods coin path (roads.js:1569+) verbatim, so B4a slave freight and the unbundled channels ride through unchanged. Shed ADJACENCY falls out of the partition for free and replaces tallyTerritory's borders map (conquest input unchanged) and supplies the close-neighbour/kin candidate set (fewer doomed findPath probes). The food hierarchy stays the label tree: levy + snapshot-budget purchase (foodHierarchy.js:179-259) is the proven coin-conservation pattern; only `_storableSupply`'s provenance changes.

### 3. Craft agglomeration attaches to the LABEL
`_specKey/_specStr` (settlement.js:653-661, 1169-1196), `_gPrice/_gShare/_gCapx` (goods.js) are precisely the "abstract story and economic units" labels exist to carry — they persist on the label and survive shed churn. Endowments (`localRes`, `_minableTiles`) re-derive from the shed each tally; a town locked into Metalwork whose shed loses its ore district declines via the existing AGGLOM_DECAY — emergent mining-town decline, no new code. URBAN_AGGLOM's concentration re-keys its owner reads from claim to shed with no semantic change.

### 4. The food ledger when labels read the field (the FOOD_K inversion)
Today the ledger→field direction: per-label harvest (settlement.js:2639 — netFert×FARM_YIELD_PER_FERT×eraProd(works)×~12 multipliers) → hierarchy → `_k` → FOOD_K repaints `_k` over catchment tiles into capField (popField.js:614-634; def 1 = fully — the rural field is ALREADY the ledger redistributed; the seam proves the representations agree in aggregate). Phase C2 inverts the PRODUCTION arrow only: per-tile foodField = fert×climMod (per-tile) × worksField (per-tile, persisted) × technique (devField, per-tile, persisted) × soil (`_soilFatigue`, per-tile) × per-tile river/coast terms (irrigation/alluvium are really tile facts, settlement.js:2606-2631); label-uniform terms (armyLabor, cashLand, famine `_harvestMul`) apply per-shed. landFood = Σ foodField over shed, normalized at the flip so Σ-shed reproduces the current formula on reference seeds (an A/B assertion, not a runtime fudge). Everything DOWNSTREAM of landFood — the Tier-A fish gate on RETAINED netLand (settlement.js:2719,2754), fisher labor withdrawal, Schaefer stocks, hierarchy, demand, `_k`, the FOOD_K writeback — is untouched, so the Tier A/B fish calibration carries over intact. No circularity: foodField is production, capField stays capacity=f(retained food); the loop is today's loop with one arrow re-grounded.

### 5. Perf: what the win actually is
Measured fresh (480×240 seed 8817, 6k steps, last-600 window, HEAD defaults): tick 21.0ms; settlements bracket 16.7ms = 79.3% (incl. popField pass); roads 7.1%; trade 6.3%; territory 2.2% amortized but 91.6ms on the firing tick; 66 labels. Product grid (repo's own deep profiles, roadmap-wave-6 2026-07-25, 1920-worldgen/960-sim mature 30k): settlements ~82ms/tick, stepPopField 43-45ms, edge-cost family 42-53ms/tick spread across the catchment flood + capitalTransportCosts + findPath, territory firing bracket 583ms; the measurement that forced the ×rNorm cadence stretch: 63-203s PER FIRING, 97% of compute (index.js:147-153) at Modern.
Savings decomposition: (a) **partition/tally split** — the from-scratch flood (~1.3M relaxations × localEdgeCost over ~65% of ~250k land tiles at 960) becomes O(N) tally + incremental partition; steady-state border drift is tiny (carto counters ~500 tiles/1k steps at 480), so amortized partition work drops ~10-50× and the tally has zero edgeCost calls — expect the firing to fall from ~583ms to low tens of ms, letting the cadence stretch (and its 4×-stale catchments at the app grid) retire. (b) **The label-count scaling trap — the binding constraint**: per-label per-tick economy is ~0.15-0.25ms; Tier C's purpose is MORE labels (~155 → plausibly 300-500 at 960). Unchanged per-label cost balloons the dominant pass 2-4×. The region economy pays for the labels because per-tile work (food, population, works, technique) is O(N) vectorized and already worker-parallel (popfield-parallel), independent of label count, while the residual per-label work (goods 8-vector, knowledge) rides KNOW_INTERVAL/DEV_STRIDE staggers. Net budget: per-label per-tick cost must fall roughly as label count rises; the I82 verdict already names the honest lever (a trajectory-shifting stagger of the knowledge-driven economic terms) — this migration turns that from "perf refactor" into a designed product decision taken at a validated stage boundary.

### 6. Migration path (labels-carry-the-economy first, then region-ize by subsystem)
- **C0 `T.REGION_ECON` — the adapter, byte-identical even ON.** Extract the REGION READER: one struct per label {fertSum, tiles, workTiles, farmedWt, worksMean, res, minables, adjacency, ownerView} written by one tally function; all consumers (settlement.js food, goods.js, popField.js FOOD_K/deriveOnePop/urbanConcentrate, updateSoil, conquest borders) read through it. Writer = today's flood verbatim. Proof: probe_hashbase unchanged at lever 0 AND 1. Do this first because it freezes the seam before any behavior moves — every later stage becomes a writer swap.
- **C1 `T.MARKET_SHED` — the split partition (the perf stage).** Same partition semantics (budgets, clip, value-pull) but stored + incremental + hysteresis; trajectory shift is only the staleness/hysteresis profile. Bank the perf here, BEFORE the risky ontology stages — if later stages stall, the win stands alone, and it unblocks the recorded POP_FIELD_STRIDE follow-up.
- **C2 `T.FOOD_FIELD` — the production inversion** (§4). Gated hard on food composition and the B3 leaner-world bands.
- **C3 `T.LABEL_LIFECYCLE` — births at field peaks, deaths by basin mass.** crystallize.js already half-does birth (TOWN_BASIN_MIN field mass, fieldShift debit, crystallize.js:222-236,699-746) — extend, keep the bars; death = demotion when the shed's field mass can no longer hold a town (B3's percentile rank bars), coin → ruin hoard (the existing conserved channel, territory.js:151-168), shed re-partitions to neighbours. This is the stage that actually scales entity supply (countries, roads, successors, war density — diagnosis R1) and it goes LAST because it needs C1's cheap incremental partition (label churn = partition churn) and C2's field food (a newborn label must read a real economy from the ground on day one).
- **C4 — cleanup**: `_territoryOwner` becomes the derived shed readout (persist drops it a save-version later), seedLocalTerritory retires (a new label tallies immediately), optionally re-derive the hierarchy tree from shed adjacency + tier.
Order justification: (1) C0 is provably inert — trajectory risk is isolated per stage; (2) the FOOD_K seam means the field already carries the ledger's shape, so inverting production (C2) against a FIXED label set keeps every Tier A/B calibration testable; (3) coin conservation never crosses a stage boundary — coin stays label-keyed throughout, and only C3 touches label existence, via the two existing conserved channels (ruin hoards for coin, fieldShift for people); (4) the perf claim is falsifiable at C1 with profile_window on the 960/30k snapshot, independent of everything after.

## Constants

NEW (each with independent physical meaning, per cardinal rule 2):
- SHED_HYST (~1.15): a tile switches market only when the challenger label's transport cost is ≥15% cheaper — marketing habit/standing relationships; doubles as border-flicker damping. State-based hysteresis, not a timer.
- SHED_RELAX_BUDGET (heap-pops/tick for the incremental partition wavefront): a PERF CADENCE in the blessed sense (controls how often/fast the same computation refreshes, never whether history may happen) — the B80 pattern.
- Levers, all default 0, byte-identical off: T.REGION_ECON (C0 adapter — must also be byte-identical ON), T.MARKET_SHED (C1), T.FOOD_FIELD (C2), T.LABEL_LIFECYCLE (C3).
REUSED, deliberately NOT duplicated: reachBudget/ORG_REACH as the market horizon (territory.js:78-92); FARM_YIELD_PER_FERT, LAND_WORKS, climMod, devField, worksField, _soilFatigue for the per-tile food form; TOWN_FOUND_MIN/TOWN_BASIN_MIN/TOWN_BASIN_R and B3's percentile tier bars for label lifecycle; AGGLOM_W/IDIO/RISE/DECAY unchanged on the label; CATCHMENT_CLIP semantics for the political clip; RUIN_RECLAIM for dead-label coin.
EXPLICIT NON-CONSTANT: C2's Σ-shed normalization is a one-time A/B flip-boundary assertion against the current formula on reference seeds — never a runtime multiplier fitted to an outcome.

## Validation plan

Per stage, the repo's standing discipline: (1) tools/probe_hashbase.mjs byte-identity at lever 0 (and at lever 1 for C0 — the adapter must be inert); (2) npm test smoke (determinism, invariants incl. coin totals, save/load); (3) stylized 3 seeds (8817/4242/777) all hard gates, soft budget 2, with explicit watch on the two known hypersensitive canaries — 8817 market-integration (the gate that non-tunably blocked ADOPT_ADMIN when the trade graph reshaped) and 31337 clustering at its 0.5 boundary — plus the standing fish-share gate (Tier-B band 0.8–3.7% across 5 seeds is the C2 hard tripwire); (4) tools/probe_settlement_econ.mjs — specialty entropy ≥~2.0 bits, trade asymmetry bands (goods ~0.9+, luxury ~1.0), income composition history-shaped; (5) probe_empires at 480 AND 960 — realm count/coverage/top-5/turnover within the post-B2 regime, C3 additionally must show count RISING with label supply without confetti (birth/death flow, not just an instant); (6) probe_roundtrip_deep for the new persisted shed/label state (persist + hash per the C1 registry discipline — SHED partition must persist because hysteresis is memory); (7) C1 perf claim falsified/confirmed with tools/profile_window.mjs on a 960/30k snapshot before/after (territory firing bracket, edge-cost family self-time, tick mean) — target: firing 583ms → low tens of ms, no regression in settlements bracket; (8) C2/C3 close with the 5-seed battery (Tier-B convention, majority rule) plus an A/B assertion that per-label Σ-shed landFood matches the current ledger within a few % at the flip boundary on 2 seeds; (9) worker-pool identity probe for any C2 work moved into the banded field pass (the popfield-parallel gather lemma must hold — FOOD_K-class writes stay serial-on-principle or index-ordered).

## Risks

Ranked against the repo's own scars:
1. CONFETTI (HIGH, C3): more labels → more nucleation seats → country confetti. Mitigations: field-mass birth bars (already), B1's anti-confetti fold, isolation ring, percentile tier bars; gate on birth/death FLOW not instant count (diagnosis R5). C3 is last precisely so this risk lands on a validated substrate.
2. HOLLOW HUSK (HIGH, C2): shed under-attribution (clip + horizon stranding populated land) shrinks world food in a world B3 already made honest-lean — 4242/777 sit ON the quiet-world gates. The flip-boundary Σ-shed ≈ ledger assertion and the fish band are the tripwires; do NOT tune war/Zipf gates to pass — that's the recorded territory-fill follow-up's job.
3. MARKET-INTEGRATION CANARY (MEDIUM-HIGH, C1): ADOPT_ADMIN's history proves this 8817 gate punishes trade-graph reshaping non-tunably; C1's hysteresis/staleness profile is the likely trigger. Budget a mechanism diagnosis, not a delay sweep.
4. FISH/FOOD RECOUPLING (MEDIUM, C2): safe only because the fish gate's RETAINED-netLand basis and the hierarchy sit strictly downstream of landFood; any temptation to move fish or the hierarchy onto tiles in the same stage re-opens the Tier-A regression class — keep them label-anchored through C2.
5. LABEL-COUNT PERF INVERSION (MEDIUM, C3): 2-4× labels at unchanged per-label cost balloons the dominant pass; the required stagger of per-tick economic terms is TRAJECTORY-SHIFTING (I82 verdict) and must be taken as an explicit product decision at a stage gate, never smuggled in as refactor.
6. COIN CONSERVATION (LOW if discipline holds): all flows stay on the audited sellGoods/levy/snapshot-budget patterns; the only new coin motion is dead-label → ruin hoard (existing conserved channel). Invariants pass covers it.
7. DETERMINISM/PARALLELISM (LOW-MEDIUM): incremental partition must be order-deterministic (stable label order, epoch stamps); any field-pass additions must preserve the banded worker bit-identity proof.
8. SAVE-COMPAT (LOW): shed partition + hysteresis state persisted with a SAVE_VERSION bump and hashed (the C1/C1b registry rule); pre-version saves rebuild from a full flood on first firing.

## Open questions

1. CLIP SCOPE: the shed clips to the political border for FOOD (must — validated, makes war bite); do endowments/mining clip too? Today's CATCHMENT_CLIP clips both; keeping both is the conservative default, but a border shift then strands a mine mid-lock-in — decide whether that's desired history (it usually is) before C1.
2. SUBSISTENCE LAND: land beyond every market horizon feeds only the field (recommended — FOOD_K's wild-land arm already does this); confirm the stateless-settlement wilderness carve-out (territory.js:220-221) survives so primary state formation still bootstraps.
3. HIERARCHY TOPOLOGY: keep the liegeId tree through C2 (recommended) or re-derive central-place nesting from shed adjacency + tier at C4? The tree is tuned and load-bearing for city formation (owner's grain ruling).
4. LABEL-COUNT TARGET at the product grid — the per-label perf budget and the road-network density both hang on it (owner call: is ~2-3× today's ~155 the goal at 960?). Related: should the trade partner cap K shrink as label density rises to hold road realism (diagnosis #11 says road length is entity spacing wearing a road costume — C3 is the actual fix, but K governs the network's degree)?
5. PASTORAL: fold grazeTiles into the field form at C2 (natural — it already reads _terrWorkTiles, settlement.js:2655) or defer? It touches the W6-D nomad calibration.
6. C2 vs the ERA_PROD legacy arm: the byte-identical A/B convention (ERA_PROD_SCALE pattern) implies keeping the ledger formula as the FOOD_FIELD=0 arm indefinitely — confirm the owner wants the dual-arm maintenance cost or a sunset after the 5-seed battery.
7. Whether C1 should also subsume capitalTransportCosts (conquest.js, ≈2.4s/polity firing at 30k/960 — the other big edge-cost customer) onto the same incremental partition machinery — likely yes, but it is political, not economic, and belongs to a sibling lane.
## C1 v1 FLIP VERDICT (2026-07-29) — REJECTED at real grids; v2 direction

Measured (probe_entitysupply, 480x12k seed 8817): lever-ON 29 entities vs
OFF 78; ON captures 13% of the 218 bar-clearing basins vs OFF's 35%;
nn spacing 11.6 ref-tiles ON vs 5.3 OFF; coverage 21.6% vs 59.1%; stylized
lever-ON 0/3 seeds. Root cause: exclusivity at the FIXED TOWN_BASIN_R (10
ref-tiles) is itself a spacing constant — wider than the old floor — so the
v1 mechanism inverts the intent. The deflation guard and byte-identity all
held; the lever ships OFF and dormant. v2 direction: the exclusive claim
must be the basin a label actually COMMANDS — watershed cells around local
maxima of the (smoothed) population field, above the bar in MASS — whose
count scales with density by construction; a dense valley packs many
adjacent basins, a sparse steppe few.

## C1 v2 FLIP VERDICT (2026-07-29) — watershed law SHIPPED default OFF; the
## supply ceiling is the demand field's ATTRACTOR TEXTURE, which is
## grid-resolved — the step appears at 960, not at 480

WHAT SHIPPED (T.LABEL_BIRTH, still default 0): v1's fixed-disk exclusivity
replaced by the watershed basin law exactly per the v1 verdict's direction —
popField smoothed by a box kernel whose support DIAMETER is TOWN_BASIN_R
(the horizon is the MERGE distance: under a box of half-width h two
concentrations fuse exactly when within 2h, so 2h = R; full-radius smoothing
double-charges the horizon — measured 30 vs 38 attractors at 240/12k),
market sites = local maxima, basins = steepest-ascent watershed
(deterministic via the strict total order (S, −tileIndex); the only length
is the horizon, a real distance), labels own the basin their tile ascends
to, foundings fire only in an UNCLAIMED basin holding ≥ T.LABEL_BAR field
people in MASS. Net-of-neighbours crescents gone; basin partition cached at
CRYSTAL_INTERVAL staleness (perf cadence), claims stamped live on mint (the
gridAdd discipline). Daughter/sea acts read the same law for siting;
plantations keep their documented exemption; all v1 deflation guards,
the persist regime guard, and the conserved founding ACT carried unchanged.

ALTERNATIVE GEOMETRIES BUILT AND REFUTED ON THIS BRANCH (so v3 does not
retread): (a) seats-outside-every-horizon-disk with the bar on UNSERVED
mass is a COVERING constraint — 96.7% of field population served by 32
labels at 240/12k, pinned at 32, nn cv 0.21 uniform; (b) seat-spacing ≥ R
with the FULL-catchment bar (v1 minus crescents) converges to the same
covering count dynamically (32 at 240/12k) — a hard seat exclusion at R
can never pack to the census's overlapping-catchment density from a
covering configuration; (c) any capture/threshold law without a geometric
floor is saturated by the mature field (the 360-people bar stops binding
everywhere settled — sub-tile viable spacing) and over-supplies without a
new competition mechanism.

MEASURED (probe_entitysupply, seed 8817, shipped law):
  480x12k  OFF: entities 78, nn 5.3 cv 0.32, disks[360]=221, wshed
           ceiling 82 basins (25 claimed), srv 93.6%, drift 2.2% final,
           5.2→9.2 ms/tick.
           ON:  entities 37 (rising ×1.76 over the back half — no plateau),
           nn 5.1 cv 0.48, disks[360]=225, wshed ceiling 75 (21 claimed),
           srv 81.3%, drift 6.6% final (mid-run spikes to 21%), pfTot 5.7M
           vs OFF 9.5M (a leaner world: fewer labels → less catchment
           economy), 3.0→4.9 ms/tick. Basin-law fresh compute 1.3-1.8 ms
           at 480 (≤1/24 steps ⇒ ≤0.08 ms/tick amortized).
  960x6k   OFF: entities 65 and flattening (48→61→65) at nn 11.0 tiles =
           5.5 REF-tiles — the W4 pin: same real spacing, no area scaling.
           ON:  entities 101 and ACCELERATING (47→71→101), nn 5.9 tiles =
           2.9 REF-tiles, cv 0.69 (density-following), wshed ceiling 113
           (45 claimed — headroom remains), srv 79%, 7.6→12.9 ms/tick
           (basin compute 5.6-7.4 ms fresh ⇒ ≤0.3 ms/tick amortized).
  stylized lever-ON (21k, 480): 8817 PASS (2 soft, at budget), 4242 PASS
           (1 soft), 777 0 hard but 5 soft — EXCEEDS budget: 2/3 (v1: 0/3).
  empires lever-ON (12k, 480, lean): realms 11→20 rising, no shatters, no
           captures, claimed 0.8%, 1-member share 90% vs OFF's 100% at the
           same horizon — the young-realm norm, no confetti.

VERDICT: ships default OFF. The 480/12k flip criterion (ON must materially
exceed OFF and track the ~218 census) fails decisively — not because of
claim geometry (v1's error) but because the law's supply ceiling is the
number of horizon-scale ATTRACTORS the smoothed demand field carries, and
the mature countryside between towns is too smooth: 82 basins at 480
against 221 census sites and 78 sustained OFF labels. The same law at 960
BREAKS the W4 pin in the right direction (101 vs 65 at 6k, still rising,
packing dense valleys at half the OFF real spacing) because the finer grid
resolves more real texture into the field. That is the true finding: the
watershed supply is attractor-texture-limited, and popField's texture is
currently GRID-dependent, so the law inherits a resolution dependence the
repo's invariance discipline forbids (the same Earth must carry the same
towns at any grid). v3 direction: give the siting law a
resolution-invariant source of market-site structure — either texture the
demand field at real scales (works/fert/water carry real-distance
structure; raw per-tile pf noise does not), or derive site structure from
the res-invariant terrain fields directly — and re-run this battery
unchanged. Byte-identity lever-off held through every edit (320:
18ad7c15/256a490b; 480: 3811ccd8/43a9f644); npm test PASS.

## C1 v3 FLIP VERDICT (2026-07-29) — the MARKET-SITE LEDGER is INVARIANT
## but the frontier cannot WALK it; ships default OFF; the supply freeze is
## a site-graph REACHABILITY finding, not a count ceiling

WHAT SHIPPED (T.LABEL_BIRTH re-keyed, still default 0; docs/design-c-
siting-ledger.md implemented faithfully): supply from the drainage/coast
SKELETON — river confluences/mouths/terminal sinks at riverGen's absolute
CATCH_TRIB=60e3 km² discharge-equivalent bar (sinks at the market bar, OQ2)
plus best-anchorage-per-coast-stretch (SHELTER_MIN=0.30 local maxima of the
R/2 half-disk land fraction, fractional-edge disk per the v2 kernel
erratum), greedy keep-largest quantized at SITE_MERGE_D=TOWN_BASIN_R/2;
cells = nearest-site Euclidean within one horizon, one label per cell,
claims from live labels at CRYSTAL_INTERVAL staleness; activation = cell
mass ≥ T.LABEL_BAR through the sweep's EXISTING probability machinery at
the site tile (spacingFactor≡1); founding the conserved act AT the site;
daughters/sea site through the ledger (fail-and-wait, OQ4; sea landings
snap to the harbor site); plantations exempt-but-claiming; geoBonusFor
reused as-is (OQ3); v2's watershed machinery demoted to instruments with
the fractional kernel; labelBasin* API 1:1; nothing persists (ledger/cell/
claim rebuild at load proven byte-exact). Ledger invariance measured and
committed as tools/probe_sitesupply.mjs (240/480/960 × 8817/4242): union
178/207/205 and 170/205/208; 480↔960 rivers −9.4/−7.2%, anchorages
+9.6/+9.6%, union −1.0/+1.5%, position match 94.1/96.6% — PASS the §3
bars; 240 carries the accepted representation deficit (bays −31%).

MEASURED (probe_entitysupply, seed 8817, shipped law):
  480x12k  OFF: entities 78 (the pin, verbatim v2 numbers — OFF path
           byte-identical: 320 hashbase 18ad7c15/256a490b, 480
           3811ccd8/43a9f644, npm test PASS). ON: entities 78 BY STEP
           2000 — the ledger sweep activates the whole cradle-reachable
           site set almost immediately (OFF needs 12k steps to creep to
           the same count) — then FREEZES: zero foundings and zero
           deaths for 10,000 steps. 128 of 206 bar-clearing sites stay
           free at 12k: 51 stand on dead ground (fert<MIN_FERT — mouths
           and sinks in desert), 8 fail areaFert, and ~66 are transport-
           isolated (td>INDEPENDENT_DIST, median 43 tiles to the nearest
           settlement — beyond FRONTIER_EXTEND_DIST and COLONY_RANGE),
           while the census-gated acts that could bridge (daughters at
           COLONY_MIN_POP=200, sea parties, plantations at 500) never
           fire at this development. nn 5.8 cv 0.24 (vs OFF 5.3/0.32),
           srv 92.8%, pfTot 8.3M vs OFF 9.5M, drift 9.2% final (32.8%
           spike at the burst), ms/tick 9.30 vs OFF 9.23.
  960x6k   ON: 76 entities, frozen from 2k — within −2.6% of 480 ON at
           matched pfTot, nn 6.0 ref-tiles ≈ 480's 5.8: the v2 failure
           signature (101 and ACCELERATING on grid texture) is GONE. The
           law is resolution-invariant end to end; what it is not, at
           this machinery, is reachable.
  stylized lever-ON (21k, 480, 3 seeds): 1/3 — 8817 PASS (2 soft, at
           budget); 4242 3 soft, 777 4 soft (0 hard anywhere; the misses
           are all quiet-world softs — wars ~0, few fallen polities, few
           big cities — the frozen-supply signature; 4242 sits ON the
           budget knife-edge: a one-site ledger perturbation flips it).
  empires  lever-ON (12k, 480, lean): realms 21→32 rising, no shatters,
           no captures, 1-member 100% (young-realm norm), no confetti.
  roundtrip deep ON 14k: byte-identical both seeds; ledger/cell/claim
           rebuild EXACT across save→load; post-load CONTINUATION phase
           drift is the standing lever-off class (OFF control diverges
           identically — unpersisted warm-cache refresh phases).

VERDICT: ships default OFF. The 480/12k flip bar (materially exceeds OFF,
≥1.5× the 78 pin ⇒ ≥117, invariant across grids) fails at exactly ON=78 =
1.0× OFF — but the FAILURE MODE is new and diagnostic. v1 failed on
geometry (a spacing constant), v2 on resolution (grid-textured supply);
v3's supply is proven invariant (arm 2 and probe_sitesupply) and the
freeze is REACHABILITY: founding sites are now quantized to the skeleton,
so the wave of advance — calibrated to creep tile-by-tile through
contiguous countryside (FRONTIER_EXTEND_DIST=28, connected-donor
td≤INDEPENDENT_DIST, colony census bars) — cannot hop the desert/mountain/
sea gaps between site clusters that random-tile creep used to fill with
intermediate villages. The OFF world reaches its 78 BY that creep; the ON
world reaches the same 78 in 2k steps and then has no legal move: the
demand side is never the binding constraint again (205 of 206 sites clear
the 360 bar by 12k), the ACT side is. The recorded follow-ups, in order of
leverage: (1) the census-deflation of act bars at this development
(_onePopScale ≈ 0.001 prices COLONY_MIN_POP=200 at ~200k field people — a
frozen-bridge consequence the deflation audit anticipated for THRESHOLDS
but which here gates the only channels that can extend the frontier);
(2) the interior-pocket candidate class (§7.1, unchanged — 47% of demand
texture off-skeleton awaits band-limited worldgen texture); (3) C1-shed
cost-basin cells (§8.5) whose cost metric would let sites bind across
barriers honestly. Do NOT widen FRONTIER_EXTEND or soften the act bars to
force the flip — those are real mechanisms priced in real units; the
missing system is the frontier's own act economics at site-graph
distances. Byte-identity lever-off held through every edit; npm test
PASS; all seven acceptance arms recorded in the v3 commit.
