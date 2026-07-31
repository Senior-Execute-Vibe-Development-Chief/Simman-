# C1 lane M — the reachability measurement (2026-07-29)

## Tables

All runs: `buildSim` at W=480 (sim tw=240, rn=1, so tiles = ref-tiles; 1 tile ~167 km), foreground+serial. Probes (absolute paths, scratchpad, not committed):
`/tmp/claude-0/-home-user-Simman-/85150cac-b1ce-5215-a2a1-aa8eb6eca827/scratchpad/probe_gapM.mjs` (site anatomy + founding log + relay curve; args `on|off W steps seed`),
`.../probe_gapM2.mjs` (act audit to 24k), `.../probe_gapM3.mjs` (excursion-budget pricing + land components), `.../probe_gapM4.mjs` (disk-census split).
JSON dumps: `.../gapM_on_480_8817.json`, `.../gapM_off_480_8817.json`, `.../gapM_on_480_4242.json`.

## T1 — ON-arm final site anatomy (12k steps, LABEL_BIRTH=1)

| | seed 8817 | seed 4242 |
|---|---|---|
| ledger K | 207 | 205 |
| labels (settled) | 78 | 78 |
| ledger cells claimed | 78 (exactly 1 label/cell) | 78 |
| free sites | 129 | 127 |
| free AND over LABEL_BAR=360 | 128 | 126 |
| ...dead ground (fert<MIN_FERT=0.03) | 55 | 57 |
| ...areaFert<MIN_AREA_FERT=1.0 | 8 | 9 |
| ...VIABLE (passes both quality gates) | **65** | **60** |
| viable free that are overland-reachable (transportDist finite) | **0** | **0** |
| viable free at Euclid dNear > FRONTIER_EXTEND_DIST(28) | 56 (p50 45.3) | 51 (p50 44.9) |

Reproduces the v3 verdict's classification (51 dead / 8 areaFert / ~66 "isolated") almost exactly; only the *cause* differs.

## T2 — where the free supply actually is (land components; Earth base elevation, so component geometry is seed-invariant)

| component | land tiles | ledger sites | viable-free sites | home? |
|---|---|---|---|---|
| 11 (Afro-Eurasia) | 3858 | 98 | **0** | HOME — holds all 78 labels |
| 81 (polar, ice) | 2855 | 29 | 0 | |
| 0 (Americas) | 1605 | 46 | 31 | |
| 44 | 676 | 21 | 21 | |
| 66 | 297 | 9 | 9 | |
| 4 small islands | 18–29 each | 1 each | 1 each | |
| **totals** | 9616 | 207 | 65 | 40.1% of land is HOME |

Home continent: 98 sites = 78 claimed + 14 free-dead + 6 free-lowArea, **0 free viable → the reachable ledger is 100% consumed.** 108 of 207 sites are off the settled component. popField: 8.86M of 9.45M (93.7%) on the home component; mean devField 0.517 home vs **0.001** unreached.

## T3 — anatomy of the "isolated" sites (ON, 8817, step 12000)

| class | n | cell mass p50 | pf/tile p50 | pf/cap p50 | devField p50 | fert p50 | dNear p50 | transportDist | straight-line gap: water / mtn / arid |
|---|---|---|---|---|---|---|---|---|---|
| claimed | 78 | 79,692 | 1289.6 | 0.80 | 0.547 | 0.838 | 0.7 | 0 | 0% / 0% / 0% |
| free, dead ground | 55 | 3,359 | 27.4 | 0.88 | 0.000 | 0.000 | 41.1 | inf for 41/55 | 58% / 0% / 27% |
| free, lowArea | 8 | 13,749 | 151.1 | 0.82 | 0.480 | 0.087 | 7.8 | inf for 2/8 | 16% / 0% / 37% |
| **free, viable, far** | **56** | 6,381 | 78.3 | 0.80 | **0.000** | 0.766 | 45.3 | **inf for 56/56** | **70% / 0% / 3%** |
| free, viable, near (≤28) | 9 | 4,500 | 34.7 | 0.78 | 0.000 | 0.617 | 25.5 | **inf for 9/9** | 70% / 0% / 2% |

Gap type per site (viable-far): water>20% **56/56**; mountain>15% **0**; arid>40% **0**; "merely far" **0**. Every one of the 56 crossed the 360 bar by the FIRST checkpoint (step 240) and reached 0.80 of local capField. devField ≥0.25 arrival: **0 of 56, ever**. Seed 4242 identical in kind (51/51 overseas, dev 0.000, gap 70% water).

## T4 — the gap priced in the sim's own unit: CONSECUTIVE WATER TILES (excursion budget B)

| B (water tiles crossable in one hop) | land in reach | % of land | viable free sites unlocked (8817 / 4242) | labels would be |
|---|---|---|---|---|
| 0 | 3858 | 40.1% | 0/65 · 0/60 | 78 |
| 1 | 4318 | 44.9% | 12/65 · 9/60 | 90 / 87 |
| **2** | 6714 | **69.8%** | **65/65 · 60/60** | **143 / 138** |
| 4 | 6733 | 70.0% | 65/65 | 143 |
| 6 | 9592 | 99.8% | 65/65 | 143 |
| 12+ | 9616 | 100% | 65/65 | 143 |

Reference: `FIELD_ADMIN`'s existing water-excursion budget is `(1+7·nav)·resScale` water tiles = 1.88 at the world's step-12k best nav (0.125), crossing 2.0 at nav≈0.143 (~step 14k). The realm-admin walk therefore acquires the crossing this geography needs ~10k steps before any label-minting act can.

## T5 — relay curve in transport COST (msDijkstra over the shipped cost core)

| per-hop cost budget | zero-tech one-shot / relay | best-tech (nav .125, cons .375) one-shot / relay | labels (best-tech, relay) |
|---|---|---|---|
| 14 | 0/65 · 0/65 | 0/65 · 0/65 | 78 |
| 28 | 0 · 0 | 1 · 1 | 79 |
| 43 | 0 · 0 | 4 · **53** | **131** |
| 60 | 0 · 0 | 5 · **64** | **142** |
| 100 | 0 · 0 | 35 · 65 | 143 |
| 185 | 0 · 0 | 64 · 65 | 143 |

Zero-tech unlocks nothing at any budget (water = Infinity). Relay/staging is worth ~13× the same budget spent one-shot (4 → 53 at budget 43).

## T6 — the "creep", both arms, 12k, seed 8817 (diffed every CRYSTAL_INTERVAL)

| | OFF (lever 0) | ON (LABEL_BIRTH=1) |
|---|---|---|
| foundings | 106 | **258** |
| deaths | 28 | **180** |
| net labels | 78 | 78 |
| distinct ledger cells occupied | 60 (78 labels → 1.30/cell) | 78 (1.00/cell) |
| donor distance p10/p50/p90/max | 3.5 / 5.1 / 11.5 / **25.1** | 4.9 / 6.0 / 7.6 / **25.5** |
| foundings with donor distance > FRONTIER_EXTEND_DIST(28) | **0 / 102** | **0 / 254** |
| transport cost from then-existing labels p50/p90/max | 7.9 / 39.4 / 81.2 | 2.8 / 49.7 / 101.4 |
| foundings at transportDist = inf (crossed water) | **0** | **0** |
| founding distance to nearest ledger site p50 / ≤5 tiles | 2.8 / 104 of 106 | 0.0 / 258 of 258 |
| foundings per 1k steps (first→last) | 52,19,5,5,6,2,3,2,4,2,3,3 | 115,41,47,22,14,8,2,2,1,1,0,5 |

## T7 — chain structure from a cradle (hops), OFF arm

| depth | n | founding step p10/p50/p90 | donor dist p50 |
|---|---|---|---|
| 0 (cradles) | 4 | 0/0/0 | — |
| 1 | 13 | 24/72/1944 | 9.2 |
| 2 | 25 | 48/456/6768 | 5.7 |
| 3 | 38 | 264/1512/8904 | 4.5 |
| 4 | 16 | 696/3240/11112 | 5.7 |
| 5 | 4 | 408/7872/10656 | 4.7 |
| 6 | 5 | 696/3720/9936 | 6.4 |
| 7 | 1 | 8640 | 7.4 |

ON reaches depth 14 with the same per-hop distance (p50 5–7 tiles): the frontier advances by ~5-tile hops in both arms; ON simply runs the ladder faster and then recycles.

## T8 — ACT AUDIT, ON arm to 24k (probe_gapM2): can any act ever cross?

| step | labels | max nav | labels nav≥COLONY_MIN_NAV(0.25) | max org | org≥CHARTER_ORG_MIN(0.60) | census p50/max | ≥COLONY_MIN_POP(400) | pressed | realms treasury≥CHARTER_ENDOW(5000) |
|---|---|---|---|---|---|---|---|---|---|
| 2000 | 78 | 0.019 | 0 | 0.115 | 0 | 16/118 | 0 | 0 | 0 |
| 6000 | 78 | 0.060 | 0 | 0.153 | 0 | 47/258 | 0 | 0 | 0 |
| 12000 | 78 | 0.125 | 0 | 0.213 | 0 | 69/540 | 1 | 0 | 0 |
| 18000 | 78 | 0.193 | 0 | 0.277 | 0 | 59/1269 | 2 | 0 | 0 |
| 24000 | **79** | **0.261** | **35** | 0.352 | **0** | 61/2076 | 7 | 5 | **0** |

`settlement.founded` by kind over 24k: cradle=4, settled=274, settlers=1, planted=0. Sea/colony events: `colony.independent`=1. First step any label can mount an ocean expedition: **24,000**. Charters: impossible in the horizon (org and treasury never reached).
Census deflation, measured: `_onePopScale` = **0.00128** (frozen, unchanged all run); Σcensus 0.012M vs field 17.43M (ratio 0.0007). Share of labels clearing each absolute bar at 24k: TOWN_FOUND_MIN 90 → 33%; NUCLEATE_SEAT_POP 160 → 18%; COLONY_MIN_POP / NUCLEATE_CLUSTER_POP 400 → 9%. A "400-person" colonising port = 400/0.00128 ≈ **312,000 field people** in its catchment.

## T9 — the "~218–222 census" target is an instrument artifact (probe_gapM4, ON 12k, 8817)

| bar | greedy disjoint disks | centres on WATER | on HOME continent | of which off-skeleton (>5 tiles from a site) | overseas |
|---|---|---|---|---|---|
| 360 | 225 | **140 (62%)** | **38** | 3 | 47 |
| 2000 | 189 | 107 | 38 | 3 | 44 |
| 5000 | 155 | 81 | 38 | 3 | 36 |
| 20000 | 95 | 39 | 38 | 3 | 18 |

`probe_entitysupply.mjs:54-91` (`basinSupply`) scans a stride-2 lattice over ALL tiles, so a disk centred on the sea sums the coastal population; 62% of the "census" is such sea-centred disks. On land there are 85 bar-clearing disks, 47 of them overseas — the home continent carries **38**, fewer than the 78 labels already standing there.

## Findings

## 1. THE ISOLATED SITES — they are not isolated by desert or mountain; they are OVERSEAS

The ~66 "transport-isolated" sites decompose (seed 8817, 12k) into 65 viable free sites of which **0 are overland-reachable from any label**: `transportDist` = Infinity for 65/65 (56 beyond the 28-tile Euclid ring, 9 inside it). Straight-line gap composition: 70% water, **0% mountain**, 2–3% arid, mean land fertility along the gap 0.56 (good land, not desert). Per-site gap classification: water>20% for 56/56; mountain>15% for 0; arid>40% for 0; "merely far" for 0. Seed 4242 reproduces exactly (51/51 overseas, 0 overland, 70% water).

The reason `transportDist` is infinite is structural, not developmental: `computeTransport` (transport.js:321) uses `baseEdgeCost` (transport.js:309), which calls `_paramsFor(world, null)` — the ZERO-knowledge params — and `transport.js:184` sets `water: nav < T.NAV_EMBARK_THRESH ? Infinity`. With nav ≡ 0 the world's transport map is **land-only forever, at any development level**. The sweep's connectivity test reads exactly this map (`const td = transportDist[ti]`, crystallize.js:1150 → `connected` at crystallize.js:1202 → `extension` at :1249 → `if (!extension && !rodeAway) continue` at :1288). So the crystallisation sweep can never mint a label across even one water tile, and this is invariant to how advanced the world becomes.

Their condition on the ground: cell mass p50 = 6,381 (18× the 360 bar) at 78 people/tile, sitting at **0.80 of local capField** — full, at forager technique. devField p50 = 0.000 (p90 = 0.000); mean devField on the entire unreached component = 0.001 vs 0.517 on the settled one. Fertility p50 = 0.77: this is good, peopled, un-teched land.

The v3 verdict's numbers are reproduced (51 dead / 8 areaFert / ~66 isolated at median 43 tiles); its *diagnosis* — "deserts and mountains" — is measurably wrong. It is the sea, and specifically the Bering-scale and Indonesia-scale straits: at this grid all of it is **1–2 water tiles wide** (T4).

## 2. THE CREEP THAT VANISHED — it did not vanish, and it never crossed anything

Instrumenting every founding in the OFF world: 106 foundings, 28 deaths in 12k. Donor distance p50 5.1, p90 11.5, **max 25.1** — `FRONTIER_EXTEND_DIST`×rn = 28 was **never** the binding gate (0 of 102 foundings exceeded it). **Zero** foundings occurred at `transportDist` = Infinity: the OFF creep never crossed water either. Its foundings sit a median 2.8 tiles from a ledger site (104 of 106 within 5) — i.e. the OFF sweep was already founding *on the skeleton*, confirming design §1c's 93.6% co-location from the dynamic side.

There is genuine rough-terrain creep, but it is mild and present in BOTH arms: transport cost from the then-existing labels reached p90 39.4 / max 81.2 (OFF) and p90 49.7 / max 101.4 (ON) for straight-line hops of ≤25 tiles — a 3–5× cost/distance ratio, i.e. hops around hills, not across barriers.

**The ON arm creeps harder than OFF, not less**: 258 foundings and 180 deaths in 12k (274 sweep foundings by 24k), same per-hop distance (p50 6.0), chain depth reaching 14 vs OFF's 7. The label COUNT is frozen at 78; the label POPULATION churns violently, refounding cells vacated by death. **The v3 verdict's "zero foundings and zero deaths for 10,000 steps" is false as measured** — it appears to have been inferred from the flat count.

What ON actually loses relative to OFF is not gap-crossing: it is intra-cell multiplicity. OFF puts 78 labels in 60 cells (1.30/cell) and leaves 23 viable home-continent cells unclaimed; ON puts 1 label per cell and claims all 78 viable home cells. Both land on 78 by different routes; the coincidence is what made the freeze look like a lost mechanism.

## 3. THE FIELD'S OWN REACH — decisive, but with a caveat that matters

Yes: every one of the 56–65 unreachable viable cells holds ≥ LABEL_BAR by the **first checkpoint (step 240)**, and 206 of 207 sites clear the bar by 6k. Free-cell mass p50 rises 1,620 → 4,696 over 2k→12k; final fill is 0.80 of capField. The people are there and only the label is missing.

But the people were not *migrated* there — `initPopField` (popField.js:401-417) seeds every land tile at genesis, graded by `tArrival` (the out-of-Africa residence map), and logistic growth fills it locally. Migration did not cross the water either. The honest statement: **the field's coverage of the unreached continents is a genesis initial condition plus local growth, not a demonstration that migration crosses gaps.**

The caveat for design: `T.LABEL_BAR` = 360 absolute mass over an ~87–120-tile cell is **not binding anywhere** — even dead desert cells hold 3,359. The bar cannot distinguish a forager coast (78 people/tile) from a farming valley (1,290 people/tile): a 16× density difference both sides of the same bar. "205 of 206 sites clear the bar" is a statement about an inert bar, not about demand.

## 4. DEV WAVE vs POP — the technique wave is land-locked too, so the comparison is degenerate

On claimed cells devField ≥0.25 arrives at p50 step 750 and ends at 0.547. On the isolated ground devField is **0.000 (p10/p50/p90 all 0.000); 0 of 56 ever reach 0.25** in 12k, and mean devField over the whole unreached component is 0.001 vs 0.517 connected. The dev/pop lag is undefined because the wave never arrives: `ensureDevField`/`relaxDevWave` diffuse only over land and are sourced by `stampDevSources` (popField.js:224), which stamps from settlements — of which there are none over there. popField crossed the bar at step ≤240; devField arrival is +∞.

This is why those cells are "full" at only 78 people/tile: capField reads local technique, so forager-technique land saturates at ~1/16 the density of farmed land. Population and technique are decoupled by the same 2-tile water gap.

## 5. Corrections to the shared evidence base (stated plainly, as asked)

1. "~66 transport-isolated at median 43 tiles… desert/mountain gaps" — distance and count confirmed; **cause wrong**: 100% overseas, 0% mountain in the gap.
2. "labels freeze at 78 and produce NOTHING for 10k further steps" — count frozen, **but 258 foundings / 180 deaths in 12k**, 274 sweep foundings by 24k.
3. "the old sweep crossed deserts and mountains by intermediate random-tile creep" — **not measured anywhere**: OFF max donor distance 25.1 < 28, zero water crossings, foundings already on the skeleton.
4. "the ledger sweep must track the ~218–222 census" — that census is an instrument artifact: 62% of its disks are centred on water; on land it is 85, of which 47 overseas; the home continent's disjoint-disk census is **38**, i.e. HALF the 78 labels the sim already sustains there. Any future flip bar built on this number is measuring the sea.
5. The census-deflation channel named in the survey is real and now quantified (T8): `_onePopScale` = 0.00128 frozen; `COLONY_MIN_POP` = 400 (tuning default, not the 200 quoted in the verdict) prices a colonising port at ~312k field people; 1 of 78 labels qualifies at 12k, 7 of 79 at 24k, and only 5 are also "pressed". `maybeSendSettlers` (crystallize.js:1642) therefore fires ~once per 24k steps.

## 6. What the crossing would actually cost (the design's price list)

- In the sim's own existing unit: **B = 2 consecutive water tiles** unlocks 100% of the free viable supply (65/65 and 60/60) and 70% of the planet's land; B = 1 unlocks 12/9; B = 6 unlocks 99.8% of land. The whole finding lives between 1 and 2 tiles.
- `FIELD_ADMIN` already carries a water-excursion budget of `(1+7·nav)·resScale` tiles: 1.88 at the world's step-12k nav (0.125), 2.0 at nav ≈ 0.143 (~step 14k). The political walk gets this crossing roughly 10k steps before any minting act does.
- The only water-crossing minting act, `sea.js` `foundColony`, is gated at `COLONY_MIN_NAV` = 0.25 (sea.js:108, tested at :305 and :336) — first reached at **step 24,000** — plus `T.COLONY_MIN_POP` = 400 census (sea.js:314), or a charter at `CHARTER_ORG_MIN` = 0.60 (sea.js:138; max org 0.352 at 24k) and `CHARTER_ENDOW` = 5000 treasury (sea.js:137; zero realms ever). Charters are unreachable in this horizon by two independent gates.
- Relay matters far more than budget size: at a per-hop cost budget of 43 (≈ a 10-tile sea leg at the world's own navigation), one-shot reaches 4 sites, staged relay reaches 53.
- Resolution note for whoever designs on this: the gap measured in TILES doubles at 960 while the fields do not care, so any excursion budget must be a REAL distance (the existing `resScale` factor is exactly right); a tile-count constant would be a new spacing constant in disguise.

## Verdict

**The true blocker is not frontier act economics on land, and it is not siting geometry. It is that 100% of the site supply the v3 ledger still has to offer lies across water, and no label-minting act in the sim can cross water at this development — while the one act that could is gated behind a navigation level the world does not reach until step ~24,000.**

Ranked, with the evidence:

**1. The water barrier plus the absence of any water-crossing birth path (the binding constraint).** 65 of 65 viable free sites (8817) and 60 of 60 (4242) are on land components with no overland connection to any label; 0 are overland-reachable; the gaps are 70% water, 0% mountain. Two independent mechanisms enforce it: (a) the crystallisation sweep tests connectivity through `world.transportDist`, built with zero-knowledge params where water = Infinity (transport.js:184, 309, 321; consumed at crystallize.js:1150 → 1202 → 1249 → 1288), so the sweep is **permanently land-locked by construction, at any tech**; (b) `sea.js foundColony` needs `COLONY_MIN_NAV` = 0.25 (first reached step 24,000, T8), a 400-census port (1 of 78 labels at 12k — the frozen `_onePopScale` = 0.00128 makes that ~312k field people), or a charter needing org 0.60 and 5000 treasury, neither of which the world reaches at all. The gap itself is **two water tiles wide**; the realm-admin walk already prices exactly this crossing at `(1+7·nav)·resScale`, and crosses it ~10k steps before any label can.

**2. The reachable ledger is exhausted — the second, independent ceiling.** On the settled continent there are 98 ledger sites: 78 viable, all 78 claimed (100% uptake), plus 20 that fail the fertility/areaFert gates. **There is no free viable site on the home continent at all.** So a perfect land-frontier mechanism — relay, staging, distance-priced expeditions, anything overland — would add exactly **zero** labels on this map. Every remaining label the ledger can supply (109 sites) requires a boat. If C1 wants supply without a boat, it needs the interior-pocket class (§7.1) — and note that the home continent's own demand texture is only 38 disjoint bar-clearing disks against 78 existing labels, so that class must be argued from geography, not from the disk census, which is 62% sea-centred artifact.

**3. Not blockers (measured, so the design can stop paying for them).** Demand: the 360 bar is cleared 18× over on every isolated cell by step 240, at 0.80 of local capacity — the activation side is inert and cannot tell a forager coast (78 people/tile) from a farmed valley (1,290 people/tile). `FRONTIER_EXTEND_DIST` = 28: never binding in either arm (max observed donor distance 25.5). The "lost creep": ON creeps *more* than OFF (258 vs 106 foundings in 12k, chain depth 14 vs 7), at identical ~5-tile hops; what ON lost is intra-cell multiplicity (OFF: 78 labels in 60 cells), not gap-crossing.

**4. The honest reframing for the next design.** The v3 freeze is two facts wearing one costume: the ledger's reachable supply is fully consumed (so the count *should* stop rising), and the unreached supply is behind a 2-tile sea that the birth path cannot price at any tech. The missing system is therefore **a birth path that can be reached across water** — either by making the sweep's connectivity read a tech-aware cost instead of the zero-tech land-only map, or by letting the existing maritime acts fire at the development the world actually attains, with the excursion budget expressed as a real distance. That is a mechanism about *how people reach ground*, and it falls out of transport cost and navigation that already exist; it must not be built as a new distance constant, and it should not be justified by the disk census, which measures the sea.

Finally, the honest caveat the design must carry: at 12k on this map the world simply has not invented ocean-going ships. A crossing mechanism will not, by itself, make the flip bar at 12k unless it is priced at the navigation the world genuinely has (nav ≈ 0.125, i.e. a ~2-tile strait at a real cost of ~43 per hop with relay) — at which point the measured ceiling is 131–143 labels (T4, T5), which is above the ≥117 flip bar and, notably, is a *maritime* history rather than a denser countryside.