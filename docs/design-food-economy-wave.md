# DESIGN 3 — The food-economy coupled fix (land-food maturity + fishing cost + population-bar recheck)

All line numbers are on HEAD `713c766`, branch `claude/civ-simulation-balance-ysrx3v`. Parts A+B+C MUST ship together (tier-a-fixes doc, recorded coupled constraint). Measured grounding (fresh probe, app-identical harness, 480×240 seed 8817, 12k steps — full trace in the validation section): land food DECLINES 28.2→21.5 over steps 1500–9000 while population quadruples; fish share runs 0%→62%→75% over 3000–9000 and is still 74% at 12k; `_eraProd` p50 is exactly 1.000 until step ~10500; `farmYield` is pinned at 1.36 (leader max agri 0.58 at 12k, crop_rotation unattained); `irrigation` tech arrives ~7500, `the_plough` ~10500. The mid-run world (3k–12k) is fish-fed BECAUSE nothing matures land food in that window: the tech staircase is slow-arriving and pre-modern-light (farm channel sum 0.91 pre-industrial vs 3.15 industrial), and the fitted `_eraProd = 1 + 260·agri⁶·devGate` is designed to be ≈1 until agri>~0.6.

## PART A — Land-food maturity: retire the fitted curve, wire the real mechanisms

### A.0 The audit of the double system

`landFood0` (settlement.js:2546) = `netFert × FARM_YIELD_PER_FERT(0.035) × farmYield × agriGate × armyLabor × _eraProd × livestockBonus × diseaseBurden × aridBurden × soilBurden × workable(1) × irrigation × alluvium × (1−cashLand)`.
Two productivity systems overlap: (1) `farmYield = 1 + ch.farm` (tech.js:462, per-tech farm channel, max 5.06 — but only 1.91 by full medieval; the industrial four techs carry 3.15 of the 4.06 sum); (2) `_eraProd = ERA_PROD_BASE(1) + ERA_PROD_SCALE(260)·agri^6·devGate(org 0.15→0.42)` (settlement.js:2420, tuning.js:369–378). The overlay curve is the rule-2 tell: `260` and the exponent `6` exist only to make the modern boom land at a target scale while staying invisible pre-modern; `devGate` keys FOOD productivity on political organisation (a state does not make wheat grow — the real gates are technique, tools and built land capital, all of which exist elsewhere in the code). Meanwhile the ONE mechanism built exactly for pre-modern agrarian maturation — Boserupian LAND_WORKS (popField.js:128–154, worksField built by popFieldKernel.js:179–197 under population pressure × water × devField skill) — is wired into the FIELD capacity (popField.js:497,542,546 `wkMul`) but NEVER into the settlement food ledger, and under FOOD_K=1 (tuning.js:69) the ledger overwrites the field on all worked land, so the works a basin builds are erased by its own ledger. The ledger and field also disagree on the industrial break (ledger: eraProd ≈260×; field: `indMul = s._indCap` ≈26×, popField.js:531).

Complete `_eraProd` consumer audit (every reader re-dispositioned below): settlement.js:1036 (cash-crop output), :1275 (OUTPUT_TOTAL), :2546 (landFood0), :2564 (pastoral), :2895 (houseEra^HOUSE_ERA_POW), :2915 (rEra^RURAL_ERA_POW); persist.js:243/374 (`world._eraProd` — the DEAD legacy global anchor, index.js:127 pins it to 1; unaffected); comments only at crystallize.js:145, conquest.js:278, popField FOOD_K header, tech.js:296. Fish does NOT read `_eraProd` (the bugs.txt [28] "FISH_LAND_REF × eraProd" prescription is moot — Tier-A deleted FISH_LAND_REF; the Tier-A demand-gap gate is already era-consistent because both sides carry every scaling). `world._eraProd` (persist) is distinct from per-settlement `s._eraProd` (derived every updateFood, never saved).

### A.1 The replacement (settlement.js:2399–2431)

Replace the block. Keep the `devOrg/capMetal` reads (:2407–2411) — `s._indGate`/`s._indCap` (:2429–2430) are unchanged. Delete the `devGate` line (:2412) and the `s._eraProd = BASE + SCALE·agri^POW·devGate` line (:2420). New:

```js
// Built land capital: the works the basin's own people accumulated under pressure
// (popField LAND_WORKS — canals, terraces, drainage). Catchment mean over FARMED
// tiles, same falloff weighting as the harvest itself (territory.js). ONE constant
// (T.LAND_WORKS) prices it on ledger and field alike.
const worksMul = 1 + T.LAND_WORKS * (s._terrWorksMean || 0);
// Industrial agronomy break on the LEDGER — the SAME s._indCap the capField proxy
// already applies (popField.js:531): mechanisation + synthetic nitrogen raise real
// carrying capacity ~10-30× (INDUSTRIAL_CAP's own physical meaning). The ledger and
// the field finally agree on what the industrial break is worth.
s._eraProd = worksMul * s._indCap;   // composite productivity index (housing/rural/cash/output consumers keep one number)
```

`landFood0` (:2546): the `(s._eraProd || 1)` factor now carries `worksMul × indCap` — textual change is only the comment; the factor stays in place. Legacy A/B arm: if `T.ERA_PROD_SCALE > 0`, compute `s._eraProd` by the old formula exactly (devGate line kept inside that branch) — `ERA_PROD_SCALE` default flips 260 → 0; setting it back restores the legacy world byte-identically (the repo's default-flip convention). `ERA_PROD_BASE/POW/DEV0/DEV1` remain read only by the legacy arm; their descs record the retirement verdict.

### A.2 Wiring `s._terrWorksMean` (territory.js)

In `tallyTerritory`: reset `s._terrWorksWt = 0` alongside :395–398; in the accumulation branch (:435–445), after `s._terrFarmedWt += w * _invA;` add `if (wkF) s._terrWorksWt += wkF[ti] * w * _invA;` where `const wkF = T.LAND_WORKS > 0 ? world.worksField : null` is hoisted next to :409. Same additions in the local seed-box path (:530–553). Then `s._terrWorksMean = s._terrFarmedWt > 1e-9 ? s._terrWorksWt / s._terrFarmedWt : 0` at finalize (both paths). worksField ∈[0,1] per tile, so `_terrWorksMean` ∈[0,1] — the farmed catchment's improvement level, harvest-weighted (the canal is priced exactly where the grain is grown, ×1/rn² already handled by `_invA`). Genesis-invariant: worksField is 0 everywhere at start and needs sustained `pop/cap > WORKS_PRESS(0.5)` + water + arrived technique (popFieldKernel.js:189–195), so step-≤1500 output is unchanged to float noise (probe: eraProd was 1.000 then; worksMul starts 1.000).

### A.3 Pastoral (settlement.js:2563–2565)

Rangeland is untouched by canals: pastoral must NOT ride worksMul. Replace `(s._eraProd || 1)` in the pastoral term with `(1 + T.PASTORAL_IND * s._indGate)` — industrial ranching (fencing, wells, veterinary medicine, feedlots) lifted per-area livestock output ~4× over open-range herding; pre-industrial pastoral productivity keeps its existing `(0.3 + 0.7·agriK)` husbandry ramp only. `s._pastShare` (:2577) needs no change.

### A.4 Front-loading the farm channel (tech.js:283–301) — the classical calibration

The 3–6× classical anchor: net cereal output per unit of worked landscape rose ~3–6× from early Neolithic farming to full classical agriculture — Neolithic dry-farmed cereals ~0.4–0.5 t/ha at seed:yield ~3:1 with biennial fallow, vs classical irrigated/manured systems ~1.0–1.2 t/ha at seed:yield 7–10:1 (Roman Egypt, Han China) with fallow reduced or eliminated on watered land; density corroboration: Neolithic village belts ~5–15 persons/km² of arable vs Roman Egypt's valley at ~180/km² (the irrigated-basin tail, which the sim reaches via worksMul×alluvium×irrigation, not via the median). What the honest chain delivers at full classical vs Neolithic (agri 0.30, farming+husbandry only): farmYield 1.77/1.25 = 1.42×, agriGate 1.0/0.51 = 1.96×, worksMul on a pressed median basin ~1.4× (worksMean ~0.2), livestock ramp ~1.15× → median ≈ 4.5×, inside the anchor; cradle tail (worksMean→1, alluvium, irrigation) ≈ 10–12×, which is the Egypt outlier and is what those mechanisms are FOR. No re-weighting of TECH_FX is required to hit the anchor — do NOT touch the farm channel weights in this wave (the industrial-era weights are the industrial break's tech half and are consistent with where the break should land: fertilizers/selective_breed/mechanized_farm/green_revolution arrive exactly at the org+metallurgy ≥0.78–0.97 gates that also open `_indGate`).

### A.5 Consumer re-audit dispositions

- housing `houseEra = eraProd^HOUSE_ERA_POW(0.8)` (:2895) and rural `rEra^RURAL_ERA_POW(1.0)` (:2915–2916): keep reading the composite. Pre-modern effect: improved basins house denser, ≤3^0.8≈2.4× (was 1.0 — the fix is why classical cradle cities can exist on grain); modern ceiling (78)^0.8≈33 vs legacy (261)^0.8≈86 — the modern-era scale shrinks ~2.6×, re-tunable through INDUSTRIAL_CAP alone (validation item, beyond the 21k horizon).
- cashOut (:1036): plantations ride land productivity — keep composite. Note: pre-modern cash-crop output falls vs legacy only where eraProd>1 was already rare; measure slave-economy stats.
- OUTPUT_TOTAL (:1275): real-output index — keep composite.
- capField FOOD_K (popField.js:599–634): no code change; the blend becomes CONSISTENT (ledger `_k` now carries works×indCap, proxy arm carries wkMul×indMul — same two factors, was 260× vs 26×·wk). `landShare` (:629–631) unchanged (see Part B for its fish sensitivity).
- fish: unaffected by A directly; the demand-gap gate closes as netLand matures (that is the design).

## PART B — Fishing costs labor and draws down a stock

### B.0 What replaces what

Current (settlement.js:2628–2674): `fish = FISH_RATE(16) × sea × seaRich × poor × (fishFactor/0.3)` — flat per-settlement cap, no labor, no boats-per-person, no depletion (diagnosis R3; Tier-A measured bimodal fishless-inland vs 90%-fish ports). The Tier-A `poor = clamp01(1 − netLand/demand)` gate (:2668) is KEPT as the effort throttle. New model: Schaefer/Graham surplus-production — catch = q·E·S (catch-per-unit-effort ∝ abundance), effort = fishers, stock logistic per stretch of coast.

### B.1 Fisher labor (the armyLabor hook)

- Effort target: `fisherTarget = T.FISHER_MAX × poor` — the hungry share mans the boats; a land-fed coast draws ~no boats; a coast that cannot feed itself commits its full boat-capable labor share.
- Adjustment (fixes the measured bistability — the middle band becomes the transition regime): `s._fisherFrac += clamp(fisherTarget − s._fisherFrac, −T.FISHER_ADJ·dt, +T.FISHER_ADJ·dt)`; when `sea ≤ 0.02` or `T.FISH_LABOR = 0`, decay `s._fisherFrac *= (1 − T.FISHER_ADJ)`. Computed INSIDE the fish block (after `poor`), stored on the settlement (add to the save schema's settlement fields and the determinism hash next to `_overlordCC`).
- Labor withdrawal — the exact hook the task asks for: settlement.js:2356 becomes `const armyLabor = Math.max(0.2, 1 − Math.max(0, armyFrac − ARMY_LABOR_FREE) * T.ARMY_LABOR_FOOD) * (1 − (s._fisherFrac || 0));` — LAST tick's fisher share (the same 1-tick lag `_foodNet` already uses; no circularity: landFood is computed before the fish block). Fishers withdraw from the harvest 1:1, bounded by FISHER_MAX ≤ 0.25. No labor market invented.

### B.2 The coastal stock (the depositReserve/soilFatigue pattern — "the sea remembers")

- Storage: `world._fishTaken` Float32Array(N), 0 = virgin, keyed on COASTAL LAND tiles (`world.coast[ti]` truthy — the fishery off this stretch of shore), lazily allocated like `_soilFatigue` (settlement.js:2285–2286 pattern). Per-tile capacity is DERIVED, never stored: `C_i = C_full × rich_i`, where `C_full = 4·T.FISH_MSY / T.FISH_REGEN` (logistic identity MSY = rC/4) and `rich_i` is the existing seaRich shape (:2637–2639 iceCut/tropCut, COLD_FISH lever) evaluated from the TILE's temperature. Standing stock `S_i = C_i × (1 − taken_i)`.
- Fished tiles: `s._shoreTiles` = coast-flagged land tiles within the computeWaterAccess neighbourhood (radius `R = max(1, round(rNormPop))`, settlement.js:482 — the same box that defines `waterAccess`), cached at founding/load (static geography). Two ports within the box radius share tiles — the commons is real.
- Catch (replaces :2673): with `d = Σ_i S_i / (n_shore × C_full)` (mean abundance as a fraction of full-richness virgin capacity — seaRich appears ONCE, inside C_i, deleting the separate `seaRich` and `sea` factors from the catch line):
  `fish = s.people × s._fisherFrac × T.FISH_PER_CAP × (techEff(s).fishFactor / 0.3) × d`
  FISH_RATE is retired (def → 0, desc records the verdict); the per-settlement cap is now emergent = fishers × per-capita catch × abundance, exactly as specified.
- Drawdown (same tick, deterministic settlement order): distribute `fish` over `s._shoreTiles` ∝ S_i; `taken_i += catch_i / C_i` (clamped ≤ 0.999).
- Regeneration: every `FISH_REGEN_INTERVAL = 50` ticks (amortization cadence, not a content gate), sweep `world._coastList` (precomputed once): exact logistic step, unconditionally stable at any interval: `S' = C·S·e^{rΔt} / (C + S·(e^{rΔt} − 1))` with `rΔt = T.FISH_REGEN × interval` (e^{rΔt} precomputed once per sweep); write back `taken = 1 − S'/C`.
- Persistence: `fishTaken: sparseFromTyped(world._fishTaken, 0)` beside soilFatigue (persist.js:308, restore beside :432–433, hash sample beside :601). `s._fisherFrac` and `s._shoreTiles` (rebuildable — recompute on load) join the settlement save/derivation accordingly.
- Lever: `T.FISH_LABOR` def 1; 0 = the current Tier-A flat-cap formula byte-identically (the A/B arm keeps :2673 verbatim).

Behavioral consequences that fall out (none coded): a 25-person hamlet no longer lands a 16-food windfall (catch ∝ its own people: ~0.15/tick all-in on virgin rich water — a genuine fishing village feeds itself with surplus); a great fishing port CAN exist — the classical-tech all-in equilibrium on 3 tiles of the richest virgin coast solves to ~5–6k people with the stock fished down to ~20% (the overfished-commons steady state); industrial trawling (fishFactor 6.27, trawling tech) can genuinely strip a coast — the historical collapse emerges; conscription/famine no longer RAISE fish for free (fishing now costs the same labor pool).

## PART C — The population-bar recheck

Every absolute bar today's fish-fed hierarchy reaches, with disposition:

1. **TIER_THRESHOLD/TIER_SCALE_REF** (settlement.js:48 `[0,150,600,900]`, tuning.js:427–430, updateTier :3040–3105). Tier-a recorded: `TIER_SCALE_REF=29000` is calibrated to the phantom-fish scale; the relative bar sits at its 0.4 floor all run → effective bars 60 (town) / 240 (city, DISSOLVE_FARMS). Replacement (the doc's suggested percentile anchor, adopted): in the per-tick cache block (:3047–3057) replace `tot/T.TIER_SCALE_REF` with two rank thresholds over the settled-population list: `townBar = max(60, P50(pop))`, `cityBar = max(240, P85(pop))`; metro bar unchanged (float vs largest urban, :3065). Physical meaning: the urban hierarchy is a RANK structure (central-place theory) — towns are the upper half of the settlement lattice, cities its top ~15% (each city serves ~3–5 towns, the Christaller branching band); the floors are the pre-Tier-B effective absolute bars, retained so a tiny early world still mints its first towns. This decouples the labels from the food SCALE entirely (survives A+B, any seed, any resolution) and un-pins the labelled-city supply (~top-15% ≈ 12 cities on ~80 settlements, vs the 3–4 planet-wide the floating bar produced — directly feeding the CITY_TIER≥2 successor-seat consumers, diagnosis #1). `T.TIER_SCALE_REF/TIER_SCALE_MAX` retire (descs record it). Occupancy at the switch is preserved by construction (measured HEAD 12k: 44/78 ≥ townBar ≈ P50-equivalent; 13 ≥ cityBar ≈ P85-equivalent).
2. **COLONY_MIN_POP = 400** (tuning.js:359, consumed sea.js:277). HEAD 12k: 10 settlements ≥400 — nearly all fish-fed ports; A must replace that mass with grain-fed port hinterlands. KEEP the constant this wave (its meaning — a town's worth of people to spare an expedition — is independent of the food source) and gate the wave on the measurement below; the re-derivation to a city-tier port bar belongs to the Tier-B realm-level-colonization design (diagnosis #7), not here. (crystallize.js:251 `COLONY_MIN_POP=200`, land colonies at :1039 — same disposition.)
3. **NUCLEATE_SEAT_POP = 160 / NUCLEATE_CLUSTER_POP = 400** (countryTerritory.js:1937–1938, seat also :1869/:1880). Inland-dominated (frontier basins) — A's works+consistent-ledger lift raises exactly these; fish removal barely touches them. Keep; measure founding rate.
4. **TOWN_BASIN_MIN = 360** (crystallize.js:235, :715). Field-people basin; A lifts field capacity on worked land via the now-consistent FOOD_K blend. COASTAL basins lose the fish-fed ledger share (popField.js:629–631 `landShare` counts fish as local supply — with fish an order smaller, coastal `ledgerK` drops); measure coastal town genesis specifically.
5. **MIN_POP_TO_PLAN = 60 / MIN_POP_TO_LINK = 30** (roads.js:105, :273). HEAD 12k: 63 ≥30, 53 ≥60, pop p50 = 80 — comfortably reachable from land food alone mid-run; A only raises it. No change.
6. **SLAVE demand freePop scaling** (settlement.js:980–981 `target = SLAVE_TARGET × labourDemand × freePop × foodSec × afford`). Scale-free in population by construction; `foodSec` (:967–970) reads surplus/demand, so honest early food TIGHTENS peacetime slave demand — the right direction; no bar to move. Measure enslaved share and the top-3 income stat for regression only.
7. **Stylized fish gate** (tools/stylized.mjs:542–552): `share <= 0.60` → `share <= 0.40`, and the comment's "pre-Tier-B" band note replaced with the Tier-B calibration record — this is the recorded trigger firing.

Which bars A makes reachable again: the tier ladder above 240-total (city/metro) and COLONY_MIN_POP(400)/NUCLEATE_CLUSTER(400)/TOWN_BASIN(360) all sit in the >150 band the tier-a doc warned would strand — they are re-fed by (i) worksMul on pressed basins (the mid-run 1.5–2.5× land lift in exactly the 3k–12k window fish currently fills), (ii) the consistent FOOD_K ledger, (iii) honest fish that still feeds true fishing coasts up to the stock's sustainable yield. Bars 1 (percentile) additionally self-calibrate whatever the residual scale shift is.

## Constants

Part A — new/changed:
- ERA_PROD_SCALE: 260 → 0 (default flip; >0 restores the legacy fitted overlay byte-identically). ERA_PROD_BASE/POW/DEV0/DEV1 read only by the legacy arm; descs record retirement.
- T.PASTORAL_IND = 3.0 (NEW): industrial ranching multiple minus one — fencing, drilled wells, veterinary medicine and feedlots lifted per-area livestock output ~4× over open-range herding; gated on s._indGate (org+metallurgy ≥0.78, the existing industrial gate).
- Reused, NOT new: T.LAND_WORKS = 2 (already defined as "yield multiple of fully-improved land ≈ the historical irrigation premium" — now priced identically on ledger and field); T.INDUSTRIAL_CAP = 25 (already defined as "industrial agronomy raises real carrying capacity ~10–30×" — now the ledger's industrial break too, via s._indCap).

Part B — new (each independent):
- T.FISHER_MAX = 0.25: maximum share of a community's total population that can work the boats — the whole-population equivalent of a full fishing village's adult boat labor.
- T.FISH_PER_CAP = 0.024 food/tick: one fisher's delivered catch on VIRGIN, FULL-RICHNESS water at the pre-tech baseline — feeds 8 people at the civilian ration (0.0030/tick): the inshore-abundance ceiling of a subsistence boat crew (Lofoten/PNW-class water); typical water (abundance d≈0.5–0.7) feeds 4–5.
- T.FISHER_ADJ = 0.02/tick: labor-reallocation rate — a community retools 0→full fishing effort in ~12 sim-years (boats built, crews learned); also the damper that populates the formerly-empty proportional middle band.
- T.FISH_MSY = 12 food/tick per reference coastal tile at full richness: maximum sustainable yield of ~167 km of the world's RICHEST coast ≈ feeds ~4,000 people — the Lofoten-cod / North-Sea-herring scale; most coasts scale down by rich_i.
- T.FISH_REGEN = 0.10/tick (≈0.40/yr at 0.25 dyn-yr ticks): logistic intrinsic regrowth of inshore mixed stocks (surplus-production r ≈ 0.3–0.5 yr⁻¹); depleted stock rebuilds on a ~decade scale. Derived, not a constant: C_full = 4·FISH_MSY/FISH_REGEN = 480 stock units/tile (logistic identity MSY = rC/4).
- FISH_REGEN_INTERVAL = 50 ticks: amortization cadence for the regen sweep (performance cadence, not a content gate; the exact-logistic step is interval-invariant).
- T.FISH_LABOR = 1 (lever): 0 = Tier-A flat-cap fish byte-identically.
- T.FISH_RATE: 16 → retired (0; desc records that the cap is now emergent = fishers × per-capita catch × abundance). T.COLD_FISH keeps its meaning inside rich_i (tile capacity).

Part C:
- T.TIER_SCALE_REF / T.TIER_SCALE_MAX: retired. Rank thresholds replace them: townBar = max(60, P50 of settled populations); cityBar = max(240, P85). Fractions' meaning: central-place rank structure — each city serves ~3–5 towns (Christaller branching band); floors 60/240 are the measured pre-Tier-B effective bars (tierScale floor-pinned at 0.4 all run), kept so a sparse early world mints its first towns. All other bars (COLONY_MIN_POP 400, NUCLEATE_SEAT_POP 160, NUCLEATE_CLUSTER_POP 400, TOWN_BASIN_MIN 360, MIN_POP_TO_PLAN/LINK 60/30, crystallize COLONY_MIN_POP 200) unchanged this wave — reachability proven by measurement, not by moving constants.

## Validation plan

Baseline captured on HEAD (this design's probe; scratchpad probe_design3.mjs, 480×240 seed 8817, 12k): land/fish/pastoral totals per 1500 steps (28.2/0/5.9 → 32.6/93.3/5.5), fish share (0→74.1%), eraProd p50/p90/max (1.000/1.000/1.000 → 1.880/2.645/2.735), farmYield (1.36→1.63), agri max (0.50→0.58), tech arrivals (farming/husbandry pre-1500, irrigation 7500, plough 10500), bar attainment (≥160:23, ≥360:11, ≥400:10, ≥townBar:44, ≥cityBar:13, tiers 0/65/10/3), coastal poor-band occupancy (37 coastal; 12 at poor>0.7, 6 mid). Re-run identically on the combined build, plus seeds 4242 and 777 (the slow-developer tail), then the full 5-seed 21k stylized battery.

Gates and expected movement:
1. Genesis invariance: steps ≤1500 world land food and settlement count within float noise of HEAD (worksField ≈0, eraProd was exactly 1.0 — this is near byte-level).
2. Mid-run maturity (THE point of the wave): total landFood at steps 6000/9000 ≥ 2× HEAD (21.5→≥40) and monotone non-declining; eraProd p50 > 1 by ~4000 (works-driven), not ~10500.
3. Classical anchor: for the leading basin, landFood per farmed reference tile at the crop_rotation epoch vs its own agri≈0.30 epoch ∈ [3,6] (median across basins; the irrigated-cradle tail may reach ~10–12 — record, don't gate).
4. Fish: world fish share at 21k ≤ 40% on all 5 seeds (the tightened stylized gate, stylized.mjs:551); step-1500 share stays 0.0; the bimodality is gone — the 20–60% fish-share bucket has non-zero settlement occupancy at 12k (HEAD: near-empty).
5. Stock honesty: mean coastal abundance d ≥ 0.5 at 12k (no pre-industrial world-stock collapse); at least one port with sustained fisherFrac ≥ 0.15 (great fishing ports exist); if any run reaches trawling, its ports' local d falls (the emergent industrial depletion — record).
6. Bar reachability (the coupled-constraint proof): at 12k, city-tier count ≥ HEAD's 13 ±30% (percentile bars make this near-construction, so ALSO check absolute: settlements ≥ 240 people ≥ 8); ports ≥ COLONY_MIN_POP(400) ≥ HEAD's 10 ±40%; overseas colony foundings and nucleateFrontierStates foundings per 10k steps ≥ HEAD rates (diagnosis baseline 41 foundings/18k); coastal town genesis (TOWN_BASIN_MIN) not collapsed vs HEAD.
7. Regression: npm test green (determinism incl. the new _fishTaken/_fisherFrac hash members; save/load roundtrip with the sparse fishTaken map; A/B levers ERA_PROD_SCALE=260 and FISH_LABOR=0 byte-identical to HEAD); full stylized battery 5 seeds within soft budget; slave top-3 count and enslaved share not regressed upward; total 21k world population within ~0.5–1.5× HEAD (scale shift expected and recorded — the modern-era ceiling now rides INDUSTRIAL_CAP alone).
Calibration procedure if gates miss: (2) low → the works path is the knob with meaning: verify worksField actually accumulates on pressed basins (probe worksMean p90; if ~0, the binding constant is WORKS_PRESS/WORKS_RATE — surface it, don't inflate LAND_WORKS); (4) high → FISH_MSY down within its physical band (8–16) before touching FISHER_MAX/FISH_PER_CAP; (3) high → the documented trim point is IRRIG_BOOST (works subsumes part of its capital half), never a new cap.

## Risks

1. Coastal transition shock: today's 90%-fish ports lose the flat windfall; small ports (<150) shrink toward their honest land+fish equilibrium. FISHER_ADJ smoothing and virgin stocks soften it, but expect a one-time coastal population redistribution; if seeds show coastal realm die-offs, that is the honest finding the coupled ship exists to absorb — gate 6 is the tripwire.
2. Works/irrigation overlap: worksMul(≤3) × IRRIG_BOOST(≤2.5) × ALLUVIUM(≤3) on arid cradles could overshoot the cradle tail (~10–12× classical). Documented trim point is IRRIG_BOOST; risk is bounded by gate 3's recording.
3. devGate retirement removes the "stateless fertile land can't bloom" brake from FOOD; the job now falls to FOREST_LOCK + works' own pressure/skill gates + agriGate diffusion. Stone-age temperate Europe re-ballooning would show in the stylized cradle-gradient facts — watch them specifically.
4. Modern-era scale: the ledger's industrial ceiling drops from ~690× (eraProd 261 × farm techs) to ~70–200× (indCap 26 × farm techs × works); housing ^0.8 compounds it. Beyond the 21k validation horizon, so it ships under-validated — recorded as a known scale change with INDUSTRIAL_CAP as the single re-tuning lever.
5. FOOD_K landShare counts fish as local supply (popField.js:629–631): shrinking fish lowers coastal capField, coupling into NUCLEATE/TOWN_BASIN on coasts (gate 6 covers); a truer landShare (excluding fish) is a scoped follow-up, deliberately not bolted on here.
6. Percentile tier bars introduce a global-distribution anchor (the R2 pattern family). Mitigation: they gate LABELS/rank thresholds, not any realm's resources, floors keep them sane in tiny worlds, and hysteresis (TIER_DEMOTE_FRAC) damps churn — but if tier flicker rises, the fallback is absolute bars 60/240 (the measured effective HEAD behavior).
7. Slave/cash-crop economy reads the composite eraProd (settlement.js:1036): pre-modern estates earn less; interacts with the Tier-A slave-market fixes — regression-watch the top-3 statistic.
8. Two new per-settlement fields (_fisherFrac, _shoreTiles) and one world array (_fishTaken) touch save format and the determinism hash — the usual roundtrip/hash suite must be extended or resumed saves will silently fork.

## Open questions

1. COLONY_MIN_POP: keep absolute 400 this wave (as specced) or fold into the city-tier percentile bar now? Colonization is already birth-starved (diagnosis #7) and a realm-level colonization actor is a separate Tier-B design — my recommendation is keep-and-measure to avoid two coupled reworks in one subsystem, but the integrator may prefer one bar family.
2. PASTORAL_IND: should industrial ranching exist at all this wave (def 3), or should pastoral stay pre-industrial (def 0) until the steppe/nomad economy gets its own pass? Zero is the conservative ship; the constant is independent either way.
3. ERA_PROD_* legacy arm: keep as an A/B lever (my spec — matches the FOOD_K/FOREST_LOCK convention) or delete outright per the harder default-flip precedents (ANCHOR_POP was removed entirely)? Affects only code volume, not behavior.
4. Percentile floors 60/240 encode the fish-fed world's measured effective bars. A first-principles alternative exists (derive census-unit town/city minima through the world._onePopScale census↔field bridge) but needs its own calibration study — is the measured-floor shortcut acceptable to the owner, given it is documented as such?
5. The 40% fish gate: tier-a measured the honest-immature range at 11.5–50.1% across seeds; if the combined build's slow-developer tail (seed 777-class) still lands 40–45% at 21k despite matured land food, is the gate band 40% hard, or 40% with one-seed tolerance? (The trigger note says "~40%".)
6. Housing/rural ERA_POW consumers keep reading the composite index (works lifts pre-modern housing ≤2.4×). Acceptable, or should housing read only indCap (works feed people but don't house them)? Physical arguments run both ways (terraced basins DID house denser); I specced composite for one-number simplicity.