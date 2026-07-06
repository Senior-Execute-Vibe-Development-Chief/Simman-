# Simman Review — Minor Notes & Completeness Critic

_Companion to [REVIEW.md](../../REVIEW.md)._

# Part 3 — Minor notes (unverified, one-liners)


**worldgen-tectonics**

- worldgen.js:571-591 (random preset) applies no cos(lat) correction to stamp distances, unlike tectonicGen:265-269 — high-latitude continents in the random preset are E-W stretched on the sphere.
- worldgen.js:88/140 — earth/earth_sim ocean depth is clamped to [-0.04, 0) while tectonic oceans reach ~-0.25; any depth-thresholded mechanic (deep-water navigation, depth render ceiling) behaves differently per preset.
- worldgen.js:700-705 — the coastal[] loop runs ty=1..cth-2, so tiles in the top and bottom rows are never flagged coastal.
- moistureSolver.js:60-63 — hasTemp probes only the first 1000 pixels (north-pole rows); if a caller ever passes a real temperature field that is 0 across the polar row it silently falls back to the internal latitude curve.
- worldgen.js:162 — openMask checks a single pixel exactly 7° east rather than a contiguous ocean run, so a 1-px lake at the right offset qualifies a cell as 'open ocean'.
- worldgen.js:664 — a 'continental' preset branch exists but is absent from the header comment (lines 7-14) and from the UI preset strings; apparently dead/legacy.
- tectonicGen.js:84-91 — the while(numWithCont<3) repair loop can infinite-loop if params set numMajorBase such that numMajor<3 and all majors are already continental; pure param foot-gun, defaults are safe.
- tectonicGen.js:498-524 — the mountain BFS updates dist[ni] even when the effect doesn't improve, without re-queueing, so distances can be slightly non-minimal; deterministic and cosmetic.
- tectonicGen.js:121-127 — plateCosLat is computed from the unwarped ny while distances use the warped wnx/wny; cosmetic inconsistency.
- earthData.js:22 — sampleEarth clamps x1 to sw-1 instead of wrapping to column 0, so the last source column is duplicated at the seam (falls over the Bering Strait/Pacific; negligible).
- worldgenUtils.js:20 — for seeds above ~5.5e11 the first `seed*16807` multiply exceeds 2^53 and loses integer precision (still deterministic, just biased); UI max is 999999 so unreachable today.
- Seeds 0 and 2147483647 (and multiples) produce identical worlds — both initNoise and mkRng collapse them to the same state.
- Cross-engine reproducibility relies on Math.exp/pow/sin being bit-identical across JS engines, which the spec does not guarantee; within one engine determinism verified bit-identical.
- tectonicGen.js:1011-1020 — erosion sediment destined for ocean-flagged cells is silently dropped (mass not conserved); acceptable for a texture pass, worth knowing.
- worldgen.js:76 — _legacyArg is a dead parameter kept for the ~60 tools/ probes' positional signatures (documented in the header comment).
- The ~40-line coast-distance BFS is duplicated nearly verbatim between the earth (98-111) and earth_sim (144-155) branches, and a third near-copy exists in tectonicGen 683-705 and worldgen default 645-658 — extraction candidate.
- tectonicGen.js:355 — Float32Array.prototype.sort is numeric by default, so the percentile sea-level cut is correct (a plain Array here would have been a lexicographic-sort bug).
- worldgen.js:130/266-267 — the wind solver's noise offset is seed*0.0137, which for large seeds pushes noise sampling to coordinates ~10^7; still within float64 mantissa headroom, deterministic.
- tectonicGen.js:722-723 — the precompute() grids correctly copy column 0 to the last column for seamless X interpolation; this is why tectonic temperature/moisture are seam-clean while the default preset's are not.


**climate**

- windSolver.js has two 'STEP 6' headers and no STEP 7 — cosmetic numbering drift.
- windSolver.js:360/394 — the divergence projection fires on iter%10===9, so with the default 500 iterations the very last solver act zeroes wind on all wElev>0.3 cells; combined with landEddyStrength defaulting to 0, high plateaus end with exactly (0,0) wind, making the moisture backtrace sample its own cell (no advection in or out — only the lossy diffuse term feeds Tibet-like plateaus).
- windSolver.js:337 applies the 1/cos(lat) metric to the zonal PGF but the divergence computation (367) and projection gradient (396) use the raw grid metric — metrically inconsistent on the sphere; divergence removal is slightly wrong at high latitude.
- windSolver.js:390 — corrStr=0.2 with 20 SOR sweeps every 10 iterations removes only a fraction of divergence per projection; mass continuity is soft, which is probably what keeps the explicit Coriolis integration stable (probe showed no blow-up at 1500 iters).
- moistureSolver.js:219-221 — advection distance per step is a CONSTANT reach; wind speed only gates evaporation, orographic rain, and the wDir>0.0005 cutoff, so moisture advects as fast through near-calm air as through a gale.
- moistureSolver.js:237-238 — the 'trace landed on ocean' halving keys on the floor corner cell of the bilinear stencil only, so it flips on/off discontinuously as the trace crosses cell boundaries near coasts.
- moistureSolver.js:205 — rows my=0 and mH-1 are never advected: polar-row land keeps atmos=0/precip=0 forever (always bone-dry poles; consistent but worth knowing).
- moistureSolver.js:417-422 — percentile normalization makes moisture map-RELATIVE: a uniformly lush planet still gets a full dry-to-wet range by construction (an outcome-shaping normalization worth a conscious look under the second cardinal rule), and worldgen compares/differences moistSum vs moistWin (summerWet-drySeason at worldgen.js:480) even though each was independently normalized to its own P95.
- moistureSolver.js:156 — polar ocean keeps an evaporation floor of 0.35 (ice-covered seas evaporate like temperate ones); the land-side temperature capacity clamp is what stops it mattering.
- worldgen.js:266-267 reuses the identical noise seed for both seasonal solves — good: prevents fake seasonal contrast from differing synoptic noise.
- realWindData.js:71 uses lat = 90 - y/(H-1)*180 while the solvers use y/H-based latitude — a half-pixel convention mismatch between the real and simulated paths.
- realWindData.js:41-44 — on load failure the catch clears loadPromise but never sets loadFailed, so isRealWindLoading() correctly returns false, but a hard-missing file is re-attempted on every call site poll; intentional per the comment, just noting the asymmetry with the validation branch.
- windSolver gap funneling (_gapFunneling), land eddies (_landEddyStr) and curl boost (_curlBoost) all default to 0 — three post-processing stages are dead code under default params.
- Three separate hand-calibrated latitude→temperature curves coexist (windSolver STEP 1, moistureSolver fallback lines 88-91, tectonicGen/worldgen final curves) that must be kept in sync manually — the moistureSolver comment even says 'must match the calibrated curve' — a drift hazard.
- climate.js VOLC_CHANCE=0.010 per 10-year update ≈ one volcanic winter per ~1000 years as documented; decay 0.55 per update means a shock is effectively gone in ~3 updates (30 years) — reasonable for Tambora-scale events.
- climate.js climMod is recomputed from persisted scalars every pass rather than serialized — clean save/load design, verified in persist.js:104/166.
- No time/era gating anywhere in the four assigned files — both solvers are pure worldgen-time functions of state, and climate.js is stochastic + state-driven; cardinal rule 1 is clean here. Cardinal rule 2 concerns live mostly in worldgen.js's named-region moisture patches (outside this assignment), several of which trace back to the sign bugs reported above.


**hydro-pipeline**

- pipeline.js:554 passes `w._seed||0` to generateResources but line 564 passes `w._seed??w.seed??1` to generateAncestry — inconsistent seed fallback; harmless because generateWorld always stamps _seed, but a seed of literal 0 makes resources use 0.
- riverGen.js:204 minLakeSize=15 and :575 maxLakeTiles=800 and :383 lakeRadius=3 are all raw tile counts — same resolution-dependence family as the floodplain radii.
- resourceGen.js:130,150 the boundDist/coastDist BFS radius cap of 12 tiles means coastal salt/oil and boundary-linked deposits spread ~2-3× further in km at tool resolution (480) than in the app (1920).
- riverGen.js:568 the lake evaporation multiplier `1 + max(0,basinTemp-0.5)*18` uses basinTemp = the single MAX temperature tile in the candidate, so one hot tile in an otherwise cool basin inflates the whole lake's inflow requirement.
- pipeline.js:532 the floodplain tCrop override to 0.92*coldGate can fire on a high-elevation arid river valley (tFlood is set independent of elevation), overriding the e>0.45→0.02 early return in cropSuitability.
- resourceGen.js:181 scatterMines excludes tTemp<0.22 candidates but the per-tile regional resources (timber/iron/etc.) have no such floor beyond biome, so cold-biome deposits still appear where the point-mine minerals are correctly absent.
- pipeline.js:326 riverMoistPeak/riverRadius arrays treat RIVER_MAJOR and RIVER_GREAT identically (both radius 3), so a Great river's floodplain is no wider than a Major one despite carrying far more water.
- cropGen.js:36 youngSoil tropical discount uses bDist<12 but pipeline builds bDist with a 15-tile BFS radius (pipeline.js:456) while resourceGen builds its own boundDist with a 12-tile radius — two separate boundary-distance fields at two radii feed different consumers.
- riverGen.js:509 downstream-consistency walk is capped at 500 steps; at 1920-wide a continental main stem exceeds 500 tiles, so the tail keeps its own (correct, larger) magnitude — harmless but the cap is resolution-blind.
- persist.js load path (buildWorld→initPeopleSim) reconstructs terrain from seed and is consistent with the harness/app, so save/load uses the same single pipeline.


**settlement**

- settlement.js:299 stale comment — says water access is computed 'from the home tile + 4 neighbours' but computeWaterAccess scans the full 3×3 block
- settlement.js:2196 foodK divides supply by CIVILIAN per-capita only while the granary drain includes army+slave rations, so K is overstated for heavily-garrisoned towns (pop grows while the granary empties, then snaps to the famine branch)
- settlement.js:2019 `s.food += supply - demand` is not _dt-scaled while the famine die-off is — at G>1 the granary fills/drains in the same number of TICKS (fewer history-units), so siege/famine buffer duration varies with granularity
- settlement.js:1662 updateSoil runs every 600 ticks unscaled by G (index.js:263), so soil fatigue approaches its equilibrium G× faster in history-time at high granularity (equilibrium itself is unchanged)
- settlement.js:117 URBAN_ANTICIPATION_REF is a fixed 250 but the town bar it claims to sit 'deliberately ABOVE' scales with world population up to ~525, so mid-game ordinary towns start building anticipatory housing
- settlement.js:2149-2172 building-material payments give every trade partner a 0.05 weight floor, so a town pays coin for 'materials' to partners that have zero timber/stone
- settlement.js:185-190 seedAncestry indexes world.ancestry/temp/moist with unclamped pos (all current callers pass in-bounds tile coords; climateOf clamps but this doesn't)
- settlement.js:2257 a settlement that dies keeps its (possibly negative) people value on the dead object until pruneDead runs (step % 32), so any reader of dead settlements within that window sees garbage population
- settlement.js:1056-1099 urbanise is order-dependent within a pass (a hub receives migrants from earlier-indexed villages before shedding its own) — deterministic given fixed array order, but asymmetric
- settlement.js:640 luxury demand budget (`spare * LUX_SPEND_FRAC`) is per-tick and not _dt-scaled — consistent with the un-scaled trade pass but inconsistent with the _dt-scaled coin-loss/mining in the same function
- settlement.js:572 credit creation is booked as recordIn(s, IN_GOODS, delta) — conjured credit shows up as 'goods' income in the money-flow panel
- settlement.js:43 comment claims TIER_THRESHOLD[1] 'no longer gates anything' but bar(1) is still live in the legacy (non-DISSOLVE) promotion path
- getExportBreakdown (settlement.js:913) can run on worker-mirror settlements without world — sackPenalty and the fert fix (if applied) need the same null-world guard it already documents
- index.js:178 the demographic-anchor popSum correctly skips dead settlements, so the negative-people corpse doesn't corrupt world totals — worth keeping if the death path changes
- Cardinal-rule sweep verdict for this file: clean — per-tick staggers ((step+s.id)%KNOW_INTERVAL, DEV_STRIDE, SOIL_INTERVAL) are all cadence not content; TIER/URBAN/APT constants carry independent physical meaning; no named-region or named-outcome special cases found


**conquest**

- Line 225 comment references world._meanCapPower; the actual field is world._refCapPower (line 1687) — stale doc.
- WAR_SURCHARGE comment says each war level 'multiplies' the army bill; the code is additive: bill x (1 + 1.2 x warLevel) (line 1220).
- Court share is booked as IN_TARIFFS (line 2104), so the info panel shows tax-funded court income under the tariffs label.
- Colonial investment/tribute move coin between TREASURIES but the ledger entries (recordIn/recordOut, lines 1643/1649) are booked against the capitals' income panels — panel-only distortion.
- world._claimSnap / _inheritReach are not persisted; a save taken right after a secession loses the snap and the new realm's territory crawls in after load (cosmetic).
- ravage() destroys wealth outright (rebellions, riots, failed revolts) — an intentional sink, but worth documenting where money conservation is audited, since fragmentRealm/endPolity go to lengths to conserve treasuries.
- blocHasCity ignores _sovereignSeat towns, which countryTerritory.js treats as sovereignty anchors — a conquered frontier-state seat cannot lead a rebellion bloc.
- estAbsorbLoad ignores the size/recency/language/coercion multipliers of the real load, so a pass can still overfill absorb headroom modestly (self-corrects next pass).
- absorbWeakNeighbors exposure score scales with border length in TILES (resolution-dependent), but saturates at T.ABSORB_PROB_MAX so the effect is mostly clamped away.
- Single-member realms also skip driftPersonality, so a long-lived city-state's temperament never evolves until it gains a second member.
- holdPull reads s._minedRate, a derived cache that is 0 right after load until the mining pass runs — rich colonies are briefly less sticky post-load.
- shedFrontier's loyalty-collapsed seeds on interior (non-frontier) loose patches stay at loyalty 0 forever and re-run the patch flood every pass — harmless but wasted work; a tiny loyalty floor or seed cooldown would skip them.
- The `: 4` stress fallback at line 2019 (capacity <= 0) is unreachable in practice since peaceCapacity > 0 for any capPower >= 1.
- recordOccupation called with fromId = -1 (conquering a stateless settlement) stamps _homeland = -1 with _homelandFell set — harmless but leaves a dangling fell-step on a 'native' settlement.
- eliminateEnclaves treats any water (elev <= 0, including 1-tile lakes) as an open border, so a statelet on a pond is never enclosed — plausibly generous.
- In updateAlliances, trade-based allies are only found among adjacent realms (the loop iterates adj), so heavy overseas trade partners never ally by mutual benefit — possibly intended, worth a comment.
- The rebuildCountries capital tie-break and all Map iterations follow insertion order and the defection roll uses seeded hash32 — I found no determinism hazards in this file.


**territory-identity**

- countryTerritory.js:37 — `_envNum`'s `(+process.env[k]) || d` makes an explicit env override of 0 impossible (falls back to default); same pattern at _resScaleEnv/_ringsEnv is intended there but SIM_REACH_BASE=0 silently becomes 4.
- crystallize.js:285 — `Math.max(1, world.tw / 240)` hardcodes the 240 reference width instead of importing resScaleFor/RES_REF_W from countryTerritory.js; the two can silently drift apart.
- countryTerritory.js:272 — claimNoise's longitude wrap is imperfect when tw is not a multiple of NOISE_CELL: gx%cols folds the last partial cell onto column 0, duplicating a noise band at the antimeridian (cosmetic).
- countryTerritory.js:996 — NUCLEATE_CAP_DIST=8 tiles is absolute while all reach quantities are res-scaled, so at 960-wide the 'not in an empire's heartland' isolation gate is 4× weaker relative to realm size.
- crystallize.js:37 — FLOOD_SPACING_MUL's comment tunes it against an outcome share ('pulling the floodplain share back to ~45%') — watch this constant for second-cardinal-rule drift; the physical framing (irrigated land packs denser) is fine but the calibration narrative is outcome-shaped.
- countryTerritory.js:400 — a country whose settled members all temporarily vanish (siege/famine) loses its `_cBudgetRamp` entry and restarts its reach at base when it recovers, an unintended punishment distinct from the hollow-husk logic.
- countryClaim.js:44 — headScore ties (equal tier and people) break on Map iteration order of world.settlements, which is deterministic here (stable array order) but fragile if settlement ordering ever changes.
- territory.js:203 — URBAN_NODES releases tier-1+ owners' tiles every pass then re-stamps cores, so `_territoryOwner` churn under that lever makes the persistent-merge CORE set flicker for node cities (only their 1-radius core persists, which is consistent but worth knowing).
- identityField.js:132/175 — floodCounties and the blur read `world._countryOwner || world._countryClaim`; under persistence the identity field now covers sticky marches too (nation-ed land), which is presumably desired but changed silently when the lever flipped on.
- cohesion.js:117 — casusBelliMul omits the language axis (only faith/people/ancestry + irredentism); if intentional (tongues cause friction, not wars) a one-line comment would prevent it reading as an oversight.
- countryTerritory.js:756 — smoothCountryBorders lets wilderness (-1) vote in the majority filter; combined with ≥5-of-8 this means any 1-wide claimed corridor in open land erodes — that is the mechanism behind the ribbon-erosion finding.
- countryTerritory.js:710 — fillEnclosedWaste allocates a fresh Map plus `stack`/`comp` JS arrays every territory pass; trivial GC churn next to the typed-array discipline everywhere else.
- countryClaim.js:123 — the `_claimSnap` instant-secession paint iterates all N tiles per pass while any snap is pending; fine at current pass rates, but it lingers until the target Voronoi first draws the new region.
- docs/persistent-territory-spec.md:91 — the spec's claim of 'no new save state' is only true because _countryOwner was ALREADY serialised in persist.js (lines 120-121); the spec's validation note saying it is 'currently scratch (recomputed)' is out of date.
- index.js:210 — relaxClaim runs on step 1 before the first computeCountryTerritory? No — territory runs at step 1 too (same guard), and grownOwnerAt falls back to _countryOwner when the claim array is absent; the fallback ordering is correct.
- territory.js:302 — the economic Dijkstra correctly uses the value-discounted EFFORT for the reach gate and the TRUE cost for food falloff; nice separation, and RIVER_REACH default 0 means the river-spine lever is currently inert (per spec: over-concentrates).


**trade-network**

- roads.js:1168-1170 — stale comment: 'marching armies pass no opts so they DO get to route over water', but findPath's only callers are the two roads.js sites, both with noWater:true; armies use localEdgeCost directly.
- transport.js:20-27 — header doc formulas (cold (0.35−t)²×28, aridity heat×dry×25 with heat=max(0,t−0.45)) no longer match the code (cold kicks at t<0.18 ×8; hot-dry at t>0.55/m<0.25) — comment drift on the load-bearing cost spec.
- roads.js:174/592 — MIN_POP_TO_LINK=30 is advertised as 'a lower bar than road planning', but linkCloseNeighbours is only ever called for settlements already in the plan queue (pop ≥ 60, tier ≥ ROAD_MIN_TIER), so the lower bar only applies to the PEER side; a 30-pop hamlet never initiates a link.
- sea.js:589-595 — the turn-back path restores people/wealth but never offsets the OUT_COLONY ledger entry recorded at launch, so the money-flow sector readout shows a phantom colony expense.
- sea.js:353 — the single boundary-joining edge in a lane's cost omits windMul and the wobble term that every other flood edge pays; negligible but inconsistent.
- roads.js:465-473 — refreshComponentsIfStale keys staleness on (roadVersion, settled COUNT); a same-interval death+birth leaves both unchanged, so components can go stale until the next road build/decay — at worst a redundant bounded pathfind, as the code acknowledges elsewhere.
- roads.js:432 — in computeReach a settlement home tile costs a flat 0.15 regardless of terrain, so a chain of settlements over mountains is as cheap a trade corridor as one across plains (1-tile steps, so bounded).
- sea.js:450-458 — linkSea's symmetric reverse-insert means a popular hub's _seaReach can hold far more than SEA_MAX_PEERS entries (one per port that kept it); total pair count stays bounded at ports×64, but the per-hub bound stated in the comment does not hold.
- Three near-identical typed-array MinHeap implementations exist (transport.js:43, sea.js:136, roads.js:1259) — one shared module would prevent drift (transport's is Float32, the others Float64, and only transport's popMin guards n===0).
- persist.js:35+38 — "_isColony" appears twice in SETT_FIELDS (harmless duplicate).
- persist.js:216 — seaReach restore does world.settlements.find per entry: O(n²) load for many ports; world._byId-style map would fix.
- spatialGrid.js:23 — buildSettlementGrid clamps/wraps cx but not cy; an out-of-range pos.y would silently extend grid.cells past cols*rows (unreachable by queries). Positions appear always valid today, so latent only.
- sea.js:522 — tryColonize debits COLONY_PEOPLE=30 without a floor check; a quest port at the COLONY_QUEST_MIN_POP=80 default drops to 50 — safe now, but a lowered slider (min 30) could zero a port.
- roads.js:867 — the pair-dedup reads the peer's CURRENT reach while reaches rebuild staggered; I traced all four listing combinations and each unordered pair runs exactly once — solid.
- updateSea nulls _seaReach for every settled settlement at pass start, so a settlement that loses statehood (countryId < 0) also loses persisted sea links — consistent with the stated stateless-no-shipping design, just noting the persistence interaction.
- roads.js:886 — river-corridor (non-road) tiles on a land link accumulate roadFlow and enter _flowTiles but are never in _roadTiles, so they carry render flow without ever paving — appears intentional (boats don't pave) but undocumented.


**economy**

- inflation.js:71 — M counts settlement purses only; polity treasuries (war chests, often large) are excluded, so heavy taxation reads as monetary deflation and disbursement as inflation. Defensible as 'hoards are out of circulation' but undocumented; worth a comment either way.
- inflation.js:73 — the per-settlement `max(1, ev·√pop)` floor inflates a component's T by its settlement COUNT in subsistence regions (many near-zero producers each contribute 1), biasing poor, fragmented components toward reading as deflationary.
- inflation.js:61 — INFLATION_INTERVAL is not stretched by _ivl(G), so at higher SIM_GRANULARITY the EMA converges G× faster per unit of history (a rate pass treated as a recompute pass).
- inflation.js:121 — the P_MIN=0.4 clamp on the deflation branch is unreachable: raw≥0 gives 1+(raw−1)·0.4 ≥ 0.6, so the effective deflation floor is 0.6 and P_MIN is dead code.
- settlement.js:572-573 — credit creation/destruction is booked as IN_GOODS/OUT_GOODS, so the info panel shows a credit boom as 'goods sold'; a dedicated channel (or IN_FINANCE) would read honestly.
- settlement.js:573 — credit contraction is capped by local wealth, so credit money that circulated away before the bust is never recalled; repeated boom→spend→bust cycles net-mint coin even within a run (bounded per cycle, but a slow leak in the 'closed supply' story while CREDIT_RATE>0).
- tech.js:408-411 — techEffects' claim '0 = exactly the previous sim' is false for logisticsLevel (probe: 0.034 at modest knowledge, blend 0); it's documented as separately blended in countryTerritory.js but the local comment should say so.
- tech.js:41 — the_wheel's req is construction≥0.32 OR mobility≥0.22 but the gate/progress display shows only construction, so the tree can show a locked-looking node that's actually about to unlock via mobility (display-only).
- slavery.js:52 — sellers are not filtered by mode: a just-abandoned/migratory settlement can sell its captives and receive coin during the ≤32 ticks before pruneDead collects it.
- slavery.js:23 — SLAVE_PRICE is a flat 8 forever: no scarcity response, no localP scaling, so slave prices are immune to both the supply/demand imbalance and inflation, unlike everything else traded.
- slavery.js:49 — the market clears GLOBALLY with no transport/reach constraint: a raider can supply an antipodal plantation instantly, with no middleman geography (the doc's 'piggyback the trade graph ... within trade reach' was not implemented).
- slavery.js:21 — RAID_RANGE=28 is fixed; raid reach doesn't scale with mobility/navigation, so the long-range (Atlantic-style) supply pattern exists only via the free global market above, not via any emergent reach.
- index.js:299 / money.js:68 — foldMoney runs only for settled settlements, so flows recorded on a non-settled settlement sit in _mIn/_mOut and pollute the first fold if it re-settles (display-only).
- agriculture.js:129 — world._agriCeil (and s._cropCeil) caches are never invalidated when the live-tunable AGRI_CEIL_FLOOR / AGRI_TROPIC_PENALTY levers change at runtime; the new values apply only after a reload.
- agriculture.js:106-108 — the wet-tropic penalty tests RAW moist (m>0.6) while habitability.js was deliberately recalibrated to Holdridge EFFECTIVE moisture to match the biome map; two adjacent systems define 'wet tropics' on different scales.
- invariants.js:80 — totalPeople excludes _captives and _unfree, so the debug headcount cannot detect slave-system population leaks; likewise index.js:178's anchor popTotal, so enslaved people silently drop out of the demographic-anchor target the world is steered toward.
- foodHierarchy.js:114 — s._grainPrice is set from the settlement's OWN tier, and the buyer pays the child's price; in an inverted liege shape (higher-tier child under lower-tier parent) the parent buys dear and sells cheap — harmless but unmodeled.
- money.js — channel/label bookkeeping verified: IN_LABELS has exactly N_IN=14 entries and OUT_LABELS exactly N_OUT=12; no index drift.
- foodHierarchy.js / slavery.js — conservation probe results: food-hierarchy transfers are exactly symmetric by construction, and the slave-market clearing conserves coin to 1e-14 (fp noise only); the README's 'conservation in trade' claim holds in these subsystems.
- habitability.js — fully clean: pure (temp, moist, riverAcc) functions, no time inputs, no named-region cases; constants are calibrated to the biome classifier's documented scale rather than to a desired outcome.


**identity-culture**

- dynasties.js:800-806 — stale comment: claims the step→year mapping 'compresses early eras' ('one pass can be 30 years in the bronze age'), but dynYear is uniform (0.25 yr/step), so `years` is a constant 6.25·G per pass; the over() machinery still works, the prose misleads.
- cultures.js:417 — culture assimilation stops entirely once the state culture becomes locally dominant, and culMix has no MIX_FLOOR, so ghost minorities persist at fixed shares forever (invisible on the dominant-coloured map, but permanent state).
- cultures.js:453 and faiths.js:386 — fixed tile radii (16 for divergence homelands, 11 for word-of-mouth) are resolution-dependent while cohesionRadius is deliberately map-width-scaled; inconsistent scaling policy.
- cultures.js:476-492 — the language-convergence loop (and the prestige loop before it) reads peers' langMix already mutated earlier in the same pass (array-order-dependent cascade); faiths.js step 3 correctly snapshots pre-pass dominants then applies — the two systems disagree on this discipline.
- cultures.js:325-338 — national standard languages (polity.langId) belong to no culture, so the per-culture drift loop never sound-changes them: a realm's official tongue is frozen forever while every folk tongue evolves.
- cultures.js:426-465 — `s._diverged` is permanent: a settlement that ever diverged is exempt from isolation, distance-drift, AND ethnogenesis for the rest of history, however many times it changes hands.
- faiths.js:219 — folk-faith names draw langWord at a hash-derived index (hash32('folkfaith', anchorId) % 100000) outside the culture's nameCounter, so they can collide with counter-coined names.
- faiths.js:352 — sizePull and the cull both count only settlements where a faith is DOMINANT; a creed held at 30-45% across fifty cities has zero network pull and is cull-eligible despite a huge following.
- dynasties.js:548 — the `seen` Set in selectElected is written but never read (dead code).
- dynasties.js — world.dynasties is never pruned and every self-made consul/theocrat founds a house, so the Map grows without bound and selectElected scans ALL houses (all realms, all time) per vacancy — slow creep on very long runs.
- dynasties.js:877 — the `mother.id !== ruler.id` guard makes a queen regnant immune to maternal childbirth death, unlike cadet mothers in growCadets (inconsistent, presumably to avoid killing the ruler mid-pass).
- dynasties.js:829 — a realm whose capital's organization falls back below LITERACY_MIN is skipped wholesale: the sitting ruler stops being reaped and effectively freezes until literacy returns (then dies instantly if overdue).
- language.js:43 — `" ts".trim()` in CODA_CLUSTER works but is plainly a typo artifact; should just be "ts".
- language.js:162 — foundLanguage's parentId parameter is unused by all callers (branching goes through branchLanguage); the rootId/hue inheritance code in that path is near-dead.
- faiths.js:186 — folk-faith default hue step is 67.5° (repeats every 16 faiths), not golden-angle like the other likeness-colour systems.
- cultures.js:397 — good defensive handling of stale `_capCost` stamps (`_capCostId === s.countryId`) and Infinity costs; noted as solid.
- faiths.js:263-265 — the id-sorted snapshot for the rng-drawing genesis loop is exactly the right determinism hygiene; dynasties' sorted country ids likewise.
- personality.js — no issues found: seeded anchors, weak priors, bounded reversible drift, and the multiplier re-parameterization all check out numerically.
- dynasties.js:171-173 — dynasty legitimacy tenure/reign are computed via dynYear differences of steps, i.e. pure durations; consistent with rule 1.


**narrative**

- historiography.js:173 checks !ev.capital on settlement.captured, but no capture event ever carries a `capital` field (capital falls log polity.shattered instead, armies.js:873-880) — dead condition, harmless today but a trap if capital captures are ever logged as captures.
- events.js:42 header estimates ~0.4 events/step; measured ~0.045/step at 6000 steps — the cap is ~10x safer than documented.
- categoryOf (events.js:285) defaults unknown types to "growth" — combined with missing narrators, a virgin-soil plague renders as a growth-colored raw string.
- chronicle.js:109 emancipation requires serfProv === 0 exactly; one lingering 36%-serf province out of 100 keeps a realm 'serfdom' forever — consider a low-water fraction instead.
- chronicle.js:77 fmtCoin((1 << band) * 1000) overflows to negative for band ≥ 31 (treasury ≥ ~2^31·1000; implausible but free to guard with 2**band).
- chronicle.js:114 realm.monument logs on the FIRST band crossing while wealth (line 77) and debt (line 112) deliberately skip the first — inconsistent milestone conventions.
- indexKeys (events.js:22) doesn't index parentFaith (faith.schism/syncretized) or parent culture (culture.born), so those events are absent from the parent entity's f:/c: history; moot today since only p: keys are ever queried, but the s:/c:/f:/d: index entries are currently write-only weight.
- calendar.js:46-47 claims "a floor guarantees time never stalls — no immortal rulers", but the open-era ease saturates: a permanently-stalled Bronze world pins at exactly 700 BC forever (probed at step 50000). Mechanically harmless (rulers age on dynYear) but the displayed dates of all late events collapse onto one year.
- ERA_ANCHOR's real-history dates (-3300…1950) are legitimate under rule 2 only while displayYear stays cosmetic — worth a loud comment that reading it from a mechanic would instantly make them fitted constants.
- condenseChronicle's merged multi-front entry inherits the FIRST entry's rumor flag and text; a rumor and a firsthand record of same-step declarations can merge under one flag.
- perspectiveChronicle's `born` cutoff (historiography.js:144) uses p.foundedStep, which for silently-registered polities is the registration step, not actual emergence — foreign events from the realm's real early years are excluded from its tradition.
- perspectiveChronicle scans the full event log per call (historiography.js:138) — O(200k) worst case per UI refresh; fine under the cap, but worth a step-range index if the cap is ever raised.
- exportHistory spreads {id, ...p} where p already contains id (historiography.js:218) — harmless duplication.
- entities.js:107 re-open via reconcile passes no seat/from, so a restored realm's polity.restored event always lacks fromName; the explicit homeland path (conquest.js:831) does better — consider threading the occupier through reconcile.
- getChronicle applies `limit` at eventsFor (pre-condense), so the returned line count can undershoot the requested limit after war-front merging — cosmetic only.
- loadWorld leaves world.countries empty until the first polity pass; chronicleTick and perspective views degrade gracefully (capitalOf falls back to polity.capitalId via _byId) — verified no crash path.
- The dynYear import aliasing in dynasties.js:38 (`import { dynYear as stepToYear }`) makes every dynasty call site READ as if it used the banned linear calendar — rename for greppability.


**war-shocks**

- shocks.js:181 plague seed weighted pick is fine, but if the chosen seed is already infectious/immune infect() silently no-ops and the whole plague roll is wasted that generation (pool already filters those out, so only a race with same-tick state matters — negligible).
- shocks.js:204 a settlement inside its _virginUntil window that catches a NORMAL (non-virgin) plague later still gets the 6× multiplier; arguably intended (no immunity yet) but not obviously so.
- armies.js:854-855 siege bombardment uses att._M (start-of-pass snapshot) for SIEGE_DMG even if the attacker's army was already spent on other fronts earlier this same pass — attacker keeps full siege power while its actual army is depleted; minor ordering artefact.
- armies.js:821+ a defender settlement that flips ownership mid-pass can still appear as `def` in a later pair built at scan time; the acc===dcc guard catches same-owner but a genuinely new third-party owner would be bombarded as the old defender — rare edge.
- armies.js:937-938 a settlement defended-against by N countries takes N× attrition in one pass (each pair subtracts att._M×ATTRITION); plausibly intended multi-front bleed but compounds fast for a surrounded city.
- shocks.js:129 contactEpidemic `break`s only the inner sea loop, so one source settlement triggers at most one virgin event per scan but multiple sources can overlap-sweep the same region (compounds with the sl-filter bug).
- shocks.js:37/221 PLAGUE_IMMUNE (4000/_dt) far exceeds PLAGUE_DUR (250/_dt), so re-cascade is well blocked; combined with the note above VIRGIN_DUR>PLAGUE_DUR is inert.
- shocks.js FAMINE_RADIUS/VIRGIN_RADIUS are fixed tile counts, so the geographic footprint of a shock scales with map resolution rather than with any world property — a design choice worth flagging for cross-map consistency.
- armies.js:139 homeMight morale = loyalty - 0.5×unrest floored at MILITIA_MORALE_FLOOR; a settlement with loyalty undefined defaults to 1 via ?? so brand-new settlements defend at full militia — fine.


**core-loop**

- index.js:23-24 — const CLAIM_RELAX_INTERVAL is declared in the middle of the import block (import on line 24 follows it); works via hoisting but is easy to misread.
- index.js:87/121 — the demographic anchor's ANCHOR_SLEW (±2%/tick) is not scaled by world._dt, so with ANCHOR_POP=1 and G>1 the integrator converges G× faster per unit of history (same class as finding 2, but the anchor defaults off).
- state.js:270-287 comments and tuning.js EARTH_HEARTHS desc both say 'two hearths, Nile + Yangtze'; the code seeds THREE (Nile, Mesopotamia, Yellow River) — doc drift on both sides.
- state.js initDeposits point-samples one pixel per tile (unlike fert's max-pool, whose comment explains exactly why point-sampling drops thin features) — a 1-pixel-wide ore vein can vanish at TILE_RES=2.
- state.js seedEarthHearths/seedCradleVillage console.log unconditionally — noisy in headless/test runs; consider gating on a debug flag.
- invariants.js — no check for negative s.army or negative s.food (only finiteness); a casualty or granary underflow bug would pass silently.
- invariants.js:62 — `const t = s.tier | 0` masks a NaN tier as 0, which then passes the range check; check Number.isFinite(s.tier) first.
- invariants.js:27 — the _warned throttle Map is module-global: two live worlds in one process (A/B runs, tests) share and clobber each other's throttle state, and resetInvariantState on world B wipes world A's memory.
- invariants.js — world-level scalars (_eraProd, _climIndex, _climShock) are never finiteness-checked; a NaN in _eraProd would poison every carrying capacity before any per-settlement check fires (though the anchor's clamps make it unlikely).
- rng.js — streams are 32-bit-seeded (hash32 → splitmix32 → sfc32): over a ~100k-step run each system statistically expects ~1 whole-stream collision between two steps (identical draw sequences); practically negligible since draws mix with world state.
- rng.js:76 — entityRng's `id | 0` wraps ids ≥ 2^31 negative; deterministic and currently unreachable, but worth a comment.
- settlement.js:479 — the AGGLOM_IDIO craft bias hashes (sid, key) WITHOUT world.seed, so settlement N has the same idiosyncratic craft edge in every world; deterministic and harmless, but it makes the 'master weaver who happened to settle there' seed-invariant.
- index.js:172-179 — world._byId includes dead settlements until pruneDead compacts them (every 32 ticks); any consumer treating a _byId hit as 'alive' should re-check mode.
- index.js:250 — pruneDead runs MID-tick (between trade and muster): passes before it see dead entries this tick, passes after do not — benign today but a latent order-dependence if a pre-prune pass ever caches array indices.
- index.js peopleSimStats — totalPeople/totalWealth also exclude ships in transit (mirrors the invariants gap), so the HUD population dips slightly during colonisation waves.
- index.js:349-353 — leadingEra/treasury are recomputed on every stats call (~30×/s) while the land scan is cached; techState per capital is cheap, but it could ride the same 32-step cache.
- Changing SIM_GRANULARITY or a *_INTERVAL lever mid-run shifts the modulo phase — a pass can skip or double-fire once around the change; transient and acceptable, worth a note in the tuning blurb.
- tuning.js TRADE_STRIDE/DEV_STRIDE are consumed via raw modulo in roads.js/settlement.js — same unclamped-ingress exposure as finding 3 if set to 0 via the message API (UI min is 1).
- climate.js CLIMATE_INTERVAL / settlement.js SOIL_INTERVAL are exported constants rather than levers by design (comment says 'so index.js drives it without another tuning lever') — fine, but they are the two cadences finding 2 needs to touch.


**persistence-workers**

- persist.js:35+38 — SETT_FIELDS lists "_isColony" twice; harmless but one should be removed.
- persist.js:223 — loadWorld warms computeTerritory without first rebuilding world.climMod (updateClimate only runs at step%20), so the immediate post-load food tally briefly ignores the saved climate state (_climIndex/_climShock are saved; one cheap updateClimate call in loadWorld would fix it).
- peopleSimWorker.js:86 — editor.placeCountry advances world.step by 640 even while paused (history jumps ~320 years for every realm), and a click on ocean silently does nothing (early return, no feedback message to the UI).
- peopleSimWorker.js:233-243 — when the step budget breaks the paced loop early, tickAccum was already debited for ALL earned steps, so unrun steps are dropped: on heavy maps the actual tps silently under-runs the slider (arguably intended anti-spiral behavior; worth a comment).
- peopleSimWorker.js:379 — the event feed ships at most the last 40 new events per snapshot; a burst (editor settle, unbounded speed) silently drops ticker entries.
- peopleSimWorker.js:116/172 — genMeta is overwritten before init/load can throw; on failure the worker keeps the old world (or null) with the new meta, so a subsequent 'save' would pair mismatched state — moot today because WorldSim always creates a fresh worker per generate/load, but fragile protocol.
- WorldSim.jsx:977 — after a load, the main thread re-sends {type:'tune', values:tuneValsRef.current} which applies UI slider values ON TOP of the save's restored tuning, and the tuning panel is never updated from the save — save-tuning vs panel display can silently desync.
- persist.js:154 — loadWorld passes tileRes:1 to initPeopleSim while the live init uses m.tileRes; harmless because createWorld hardcodes TILE_RES=2 and ignores the opt, but misleading.
- persist.js:192 — loadTyped silently discards a saved map whose length mismatches N (e.g. after a future resolution change) and keeps the fresh array; a console.warn would make partial restores diagnosable.
- persist.js:145 — version handling is a hard throw on v !== 1; fine now, but there is no migration scaffold, so the first schema change will orphan all existing saves unless one is added with it.
- persist.js:84-85 — saveWorld embeds LIVE polity/person/culture object references in the returned structure; safe via serializeWorld's immediate stringify, but callers holding the saveWorld object while the sim keeps stepping would see it mutate.
- persist.js:253 — hashWorld samples roadQuality at stride 97 and events by count only; even as a smoke digest it would miss most single-tile changes.
- worldGenWorker.js:28-30 — only top-level typed arrays are transferred; nested world.rivers.riverMag and world.deposits[*] are structure-cloned (multi-MB copies). Correct but slower than it could be; also two top-level views sharing one buffer would throw DataCloneError (caught and falls back to main-thread gen).
- peopleSimWorker.js:305 — buildSnapshot skips settlements not in mode 'settled'; a mid-transit unsettled record briefly disappears from the map (consistent with the live draw path, just noting).
- tools/smoke.mjs:149 — the post-load check only steps the loaded world 500 ticks for crash-freedom; it never compares trajectories against the uninterrupted run (see the hashWorld finding).
- world._seaOwner/_seaDist/_seaWobble, _reach*/_fp*/_pol*/_gap*/_idf* families, _fronts, _royalCourt, _networkComponents, _tileComp — all verified as genuine per-pass rebuilds (lazy-init guarded), correctly excluded from the save.
- world._ancCulture is correctly load-safe by design: rebuilt lazily from cultures tagged ._anc (cultures.js:164-169).


**ui-render**

- Line 40: the comment above BASE_CACHE_VIEWS says atlas is 'excluded' but 'atlas' is in the set (harmless — it's cacheable — but the comment lies).
- Lines 2631-2651: onCanvasMove computes fert, wind speed/dir, riverAccum and tileResourceSummary allocations on every throttled move, but the hover card renders none of them; its 'click for full info' hint is stale — clicking only selects settlements, no tile-info panel exists.
- Line 822: stripeCells anchors stripe phase to the colony bounding box (c starts at minX+minY), so colony stripes jump/shift whenever the colony gains or loses an edge tile.
- Money view is drawn by both applySnapshot (30Hz snapshots) and animLoop (60Hz rAF) while playing — up to ~90 full composites/sec; the animLoop alone would suffice for that view.
- Line 2701: settlement pick radius is a fixed 6 sim tiles (bestD2<36) regardless of zoom — ~96 on-screen px at 8x zoom, so clicks can 'snap' to a visibly distant town.
- Line 3686 labels a country row with its capital's name (cap?cap.name) while renderRealmDetail line 2825 prefers c.name — the same realm shows different names in the two panels.
- Lines 2773-2783: the keyboard effect re-subscribes on every render (no dep array) — acknowledged as cheap in the comment, but it churns listeners 30Hz while playing given the liveStep re-renders.
- onCanvasMove (deps [CW,CH], line 2660) calls draw() but omits it from deps — safe only because draw's useCallback deps happen to be stable; fragile against future dep changes.
- Line 2516: the ancestry peopling replay restarts only when viewMode changes to 'ancestry'; regenerating a world while already on the Ancestry lens skips the replay entirely.
- finalizeWorld never resets identityFillRef, psOverlayMeta, countryColorsRef or ancRevealRef — countryColorsRef leaking hues across worlds is harmless drift-seeding, but identityFillRef could (rarely) key-collide on a fresh world with matching dims/settlement-count/step-bucket.
- No viewport culling: at 8x zoom every settlement glyph, ship and sea lane in the world is still drawn each frame even though ~98% are off-canvas.
- Pan has no bounds clamp — the map can be dragged entirely off-screen; double-click reset is the only recovery and is undocumented in the UI.
- buildAtlas classifies biomes from raw w.moisture with no flood flag (getBiomeD(e,m,t,0), lines 1126/1226/1262/1279/1291) while the Map lens uses smoothed river/lake-boosted tMoist + tFlood — the Atlas can disagree with the Map (e.g. the Nile floodplain ribbon is absent in Atlas).
- Line 1409's key includes depthCeilRef/depthFromSea/oceanLevel for ALL views, so dragging the Depth range slider needlessly invalidates the cache of whatever cached view is showing (only matters in dev mode).
- Line 2296 popWeight recomputes the global pop max by scanning all settlements every frame — trivial but could ride the psOverlay cadence.
- Cardinal-rule audit of the rendering half: clean — era/year are read-only derived labels (psStats.leadingEra, displayYearStr), no draw path branches on step/year, and step%N usages (STEP_CACHE_REGEN, PS_OVERLAY_REGEN, nfKey step/150) are all amortization cadences, not content gates.
- The 10s ancestry replay and 2600ms coin period are wall-clock cosmetic animation constants — presentation-layer, not sim inputs; fine under both rules.


**ui-state**

- src/WorldSim.jsx:2773 — the keyboard effect has no dep array so it removes/re-adds the window keydown listener on every render, including the ~30Hz liveStep renders while playing; deliberate ('cheap') but easy to fix with refs.
- src/WorldSim.jsx:2443 — setLiveStep fires per snapshot (~30Hz), re-rendering the entire 4k-line component while playing; this largely defeats the 5Hz psStats throttle two lines below.
- src/WorldSim.jsx:3702 — `navigator.clipboard.writeText` returns a promise; the try/catch can't catch its rejection and 'Copied ✓' is shown even when the clipboard write failed (unhandled rejection in console).
- src/WorldSim.jsx:3881 — the hover pico-card is placed at cursor+14px with no viewport clamping (unlike the tech-tree tooltip at line 234 which clamps), so it overflows off the right/bottom edges of the window.
- src/WorldSim.jsx:2683 — armed Country-Editor clicks require simWorkerRef and silently fall through to settlement selection in main-thread-fallback mode; same for the chronicle perspective toggle (4077) — fallback users get no feedback.
- src/WorldSim.jsx:787 — onLeverChange writes tuneValsRef.current inside the setTuneVals updater function; updaters should be pure (StrictMode double-invokes them) — harmless here only because the write is idempotent.
- src/WorldSim.jsx:2590 — handleImport's useCallback lists `seed` as a dep but never reads it; harmless (forces re-creation) but misleading.
- src/WorldSim.jsx:2644 — hoverThrottleRef stores _hv.x/_hv.y on throttled moves but nothing ever reads them; the hover card position actually only updates every ~90ms/new tile, contradicting the comment about smooth tracking.
- src/WorldSim.jsx:958-977 — a fresh worker after New World is sent control/view/tune but not the current selectedSettlementId, realmSel or dynastyOpen; an open dynasty overlay across a regeneration shows 'no ruling house' forever until reopened (mostly moot since the selection is invalid anyway).
- src/WorldSim.jsx:1968 — identityFillRef's cache key is `tw x th | settlementCount | floor(step/150)` and is not cleared in finalizeWorld; a new world with the same dims, same settlement count and step<150 can briefly reuse the previous world's nearest-settlement flood. countryColorsRef similarly persists across worlds (harmless, hues just re-relax).
- src/WorldSim.jsx:1656 — setGlobeBuf is always passed the same reused buffer object (React bails on identical state); correctness rides entirely on the separate globeVer bump — fragile but working.
- src/WorldSim.jsx:3719 — feed rows are keyed `F.length-i`, which stays stable while appending but shifts all keys whenever the 250-cap splice trims the head, remounting the visible rows.
- src/WorldSim.jsx:832/840 — `useMercator` is hard-coded false and `_mercator` (a module global) is written during render; dead projection path kept alive, and module-global writes during render are impure (fine for a single-instance component).
- src/WorldSim.jsx:949 — worker 'error' messages (including step-crash reports) only reach console.error; the user gets no in-app notification that the simulation halted.
- src/WorldSim.jsx:1375 — draw() writes window.__ter/__world in dev builds every frame (handy, intentional).
- src/WorldSim.jsx:2710 — onCanvasClick's dep list includes viewMode which it never uses (it reads refs); harmless.
- src/WorldSim.jsx:2747-2754 — jumpTo does not clamp the resulting pan against map bounds nor handle the torus seam (a feed event near the wrap edge jumps linearly); double-click reset makes it recoverable.
- src/WorldSim.jsx:4143 — the save filename captures `seed` from the render closure at click time; if a New World intervenes before the worker's saveData reply, the filename can carry the new seed while the JSON holds the old world (cosmetic race).
- Cardinal-rule check: no time-gated mechanics in this file; year/era in the header are derived read-only labels, HISTORY_INTERVAL/PS_OVERLAY_REGEN/STEP_CACHE_REGEN are amortization cadences, and the 10s ancestry replay is a pure view animation — compliant with both rules.


**ui-shell**

- GlobeView.jsx:123,160 — auto-rotation applies a fixed quaternion per requestAnimationFrame, so spin speed is display-refresh-dependent (a 144Hz monitor spins 2.4× faster than 60Hz); scale by dt.
- GlobeView.jsx:125 — auto-rotation permanently stops on the first pointerdown and never resumes; probably intended, but there's no way to get it back short of remounting.
- GlobeView.jsx:240 — cursor stays 'grab' during a drag; no 'grabbing' feedback, and no setPointerCapture so a drag released outside the window can leave dragging=true until the next pointerup.
- GlobeView.jsx:42-44 — NearestFilter with generateMipmaps=false on a 4096-wide texture shimmers/aliases badly when zoomed out; consider mipmapped Linear for minFilter while keeping Nearest for mag.
- GlobeView.jsx:217 — the W2/H2 fallbacks (1920/960) happen to match WorldSim's W/H constants, but duplicating them as magic numbers will silently break if the sim resolution ever changes.
- TuningPanel.jsx:6 — renderPreview's depthGamma parameter is never passed by any caller (both call sites pass 4-5 args without it); dead parameter.
- TuningPanel.jsx:120-135 — the rAF generation chain isn't cancelled on unmount or when a new doGenerate starts; a stale chain keeps calling generateTectonicWorld and writes into worldsRef after close (harmless today, wasted CPU).
- TuningPanel.jsx:211 — dragging the Candidates count slider fires handleCandCountChange per step, regenerating all previews several times for one drag.
- paramDefs.js:213 — ALL_PARAM_KEYS actually contains param-definition objects, not keys; misleading name.
- paramDefs.js — ~19 generator knobs are read in tectonicGen/windSolver/moistureSolver but absent from the editor (minorWeightMin/Range, minorSubs*/minorCore*/minorSub*, minorNegsMax, penThreshold, bayThreshold, season, moistRecyclRate/Cap, moistFront*, itczLat) — invisible tuning surface.
- mapImport.js:261-278 — loadImageFile has no size guard; a 20k×20k heightmap makes getImageData allocate ~1.6GB and can crash the tab; consider downscaling to sim resolution in the canvas draw.
- mapImport.js:28 — `cells.i ? cells.i.length : cells.h.length` throws a raw TypeError if cells.h is missing; wrap in the friendly 'not a valid export' error.
- atlasUI.css:6 — Google Fonts @import is an external network dependency; the offline single-file build silently falls back to Georgia, and online it's render-blocking; consider self-hosting woff2 (or accept and document the fallback).
- atlasUI.css:123 — `.au-btn:focus { outline: none; }` with no focus-visible replacement removes keyboard focus indication entirely (accessibility).
- SimLevers.jsx:52 — sticky header uses background:'inherit' inside .au-parchment; it inherits the gradient stack re-anchored to the header box, so the stains subtly double up under the header (cosmetic).
- WorldSim.jsx:781-784 — pushTune mutates the main-thread T even when the worker exists; benign today (main-thread sim modules idle) but means two divergent T instances exist if a message is ever dropped.
- main.jsx — no React StrictMode; adding it would have exercised the GlobeView mount/unmount cleanup path (double-invoked effects) during development.
- eslint.config.js:17,24 — ecmaVersion 2023 paired with globals.es2021; also vite.config.js/eslint.config.js themselves are outside the lint glob.
- index.html — no favicon link; every load 404s /Simman-/favicon.ico (noise in server logs/console).
- vite.config.js:6 — base '/Simman-/' is redundant under viteSingleFile (all assets inlined) but harmless; keep only if multi-file dev-mode deploys also target GH Pages.
- peopleSimWorker.js:181-187 — the 'tune' handler correctly rebuilds the paused snapshot after applying levers; nice touch, and applyTuning's whitelist means a malformed message can't poison T (verified).


**tooling-tests**

- smoke.mjs:173 asserts `sa.settlements < 60` ("fewer than farming-region model") — a seed-specific magic threshold in a test assertion that could flake if the DISSOLVE outcome shifts.
- _harness.mjs:16-21 applies SIM_TUNE at module import; smoke's DISSOLVE block calls resetTuning() in its finally (smoke.mjs:175), which would silently wipe any SIM_TUNE env override for code after it — harmless today only because DISSOLVE is the last block.
- earthRun.mjs steps one tick per loop iteration (`stepPeopleSim(world,1)` x STEPS) while smoke/stylized batch — fine only if stepPeopleSim(n) is a pure n-fold loop; worth confirming no per-call setup differs.
- stylized.mjs:86 gates fallen-polity lifespan median to `<= STEPS/2`; at the default STEPS=15000 the ceiling is 7500 steps, which is generous but scales with the CLI arg, so a short run tightens it unintentionally.
- README line 9 in persist.js says "save→load→save hash identity" but smoke actually does save→load and compares to the pre-save LIVE hash (arguably stronger) — the doc wording is inaccurate.
- stylized.mjs is invoked with `[seed] [steps] [W]` but H is forced to W>>1; there's no way to pass a non-2:1 aspect, unlike earthRun which honors EARTH_W/EARTH_H — minor inconsistency across tools.
- diag_full.mjs reads world.fert/world.elev directly and uses tuning T.SIM_GRANULARITY as a lever (fine — a cadence/perf knob, not a content gate).
- No package.json script runs eslint config check or the stylized suite; `npm run validate` exists but is undocumented as non-gating.
- The ~40 stale probes span two staleness tiers: earthRun-style (correct tCrop via buildWorld, but missing tFlood/ancestry opts) vs generateWorld-style (also missing river-boosted tCrop entirely) — the latter are the more misleading to keep.


**docs-drift**

- moistureSolver.js kept the neighbour term as a max() (`if (diffuse > moist) moist = diffuse`, line 260) rather than removing it, but at 0.55 survival/1.5° it is genuinely lossy — within the spec's stated allowance.
- coerced-labor defaults drifted from the proposal: CAPTURE_FRAC 0.07 (doc 0.15), SLAVE_DEATH 0.003 (doc 0.01), SLAVE_UNREST 0.4 (matches); SLAVE_TRADE_W was never built — slavery.js clears a global market every SLAVE_INTERVAL=50 ticks instead.
- Cash crops are booked into `_luxSupply` (settlement.js:720) — the doc's §8 'fold into luxury' recommendation was followed; there is no IN_CASHCROP category.
- Extra levers beyond the coerced-labor spec exist: SLAVE_TARGET, SERFDOM, SERF_FORM, SERF_UNREST, SERF_PLAGUE (tuning.js:443-471) — the doc's lever table could be synced.
- gov.fineness and treasury survive save/load because persist.js serializes whole polity objects ([id, p] at persist.js:84-85), not a field whitelist — worth knowing when adding non-serializable polity fields.
- README's Economy lens list (line 40-41: 'trade/money/resources/cropland') omits the 'Labour' sub-lens added by the slavery work (WorldSim.jsx:268).
- identityField.js field arrays are deliberately NOT serialized (re-mirrored on load) — consistent with the doc's Stage-0 design; Stage 2 would require adding them to persist.js as the doc warns.
- persistent-territory-spec's 'Still to verify visually' item (border smoothing) was closed by commit 31942dc and smoothCountryBorders (countryTerritory.js:750) — another body detail that could be checked off.
- CLAIM_POW (power-weighted borders) remains default 0 (tuning.js:115) — the spec's optional item 4 is still open.
- territory-growth-plan §4a references its prototype at /tmp/proto_b.mjs — long gone; the measured tables are unreproducible.
- resourceGen.js RESOURCES entries carry an `era: 'early'/'mid'/'late'` tag — I did not trace its consumers; worth confirming it only feeds display/deposit seeding and never time-gates content (cardinal rule 1).
- The demographic anchor is confirmed dormant and cardinal-rule-safe as the climate spec's §4 claims: ANCHOR_POP def 0 (tuning.js:259) and the target reads world._civYear (emergent, from leading org) at index.js:103.
- docs/ contains no spec for several major shipped systems (habitability.js, sea colonisation, the national war-capacity layer, historiography) — the docs folder skews toward stale plans rather than current design records.
- tools like probe_egypt.mjs / probe_caspian.mjs name real regions but are measurement probes, not mechanisms — consistent with the cardinal rules.


**hunt-time-gates**

- calendar.js is exemplary rule-1 compliance: the display year interpolates between emergent era-arrival steps (world._eraAt) with a saturating ease inside the open era, and nothing mechanical reads it.
- index.js:71-122 demographic anchor (ANCHOR_POP>0, the default) targets Earth's real historical population curve — rule-1 clean now (reads _civYear, not the clock) but a deliberate rule-2 gray zone: world total population is an outcome fitted to real history; the ANCHOR_POP=0 'fully emergent' escape hatch exists and is documented.
- world._civYear is derived from ONLY the single leading capital's organization (index.js:188-194), so identity salience and the pop target shift GLOBALLY the moment one civ advances — consider whether a regional/percentile signal would be truer to the premise.
- conquest.js:1888 serfdom scarcity window `+ 2000` sits right next to dt-scaled plague durations in shocks.js — the clearest single instance of the granularity inconsistency (folded into finding 3).
- countryTerritory.js:103-112 documents 'no synthetic frontier close ... never keyed on a year' — accurate for the claim layer, but crystallize.js's devFactor does exactly what this comment forswears; the docs and code disagree across files.
- historiography.js:113 claimedAge 'stretch' (scribes exaggerating dynasty age) is display-only narrative distortion — fine.
- resourceGen.js RESOURCE_TYPES 'era' field ('early'/'mid'/'late') is cosmetic metadata only rendered as a UI badge (WorldSim.jsx:3928); nothing gates deposit availability on it — extraction demand is tier/tech-driven (crystallize.js DEMAND_BY_TIER, settlement mining reads knowledge).
- tech.js: every tech gate is a knowledge-threshold predicate (req: k=>k.x>=y); the era column is layout/label only — clean.
- peopleSimWorker.js:269 `world.step < s._famineUntil` in the snapshot is display-only shock badging — fine.
- settlement.js staggered cadences `(world.step + s.id) % KNOW_INTERVAL` are amortization with per-settlement phase offset — allowed cadence, and a nice determinism-safe pattern.
- inflation's INFLATION_INTERVAL, roads' PLAN_INTERVAL/tStride, crystallize's TRANSPORT_REFRESH_TICKS, index.js's step%32 pruneDead are all pure recompute cadences — allowed.
- shocks.js famine/plague RNG is re-seeded from world.step per tick and only consumed on check ticks (comment at 142) — cadence-safe determinism, no content gating.
- performance.now/Date.now appear only in profiling (world.debug) — no wall-clock leaks into mechanics.
- dynasties.js dual-clock design (uniform dynYear for lifespans vs era-anchored display calendar) is well-reasoned and documented in calendar.js:23-29; reign/age math is all duration-since-event.
- conquest.js:445 and countryTerritory.js:445-447 integration ramps (`age = world.step - _conqueredAt/_integratedAt`) are event-anchored eases, not era gates — legitimate, though INTEGRATE_TICKS belongs in the _dt sweep (finding 3).
- inflation.js:82's step floor of 5000 raw ticks is additionally granularity-sensitive (not /_dt) — noted inside finding 2.


**hunt-fitted-outcomes**

- src/sim/peopleSim/state.js:287-290 — MAX_CRADLES=10/CRADLE_MIN_SEP=60 are motivated by an outcome ('single dominant power swallowing the world') but implemented as the historically-real mechanism (independent agricultural invention at separated hearths); acceptable.
- src/sim/peopleSim/state.js:385 — algorithmic cradle temp window justified as 'the Yellow River is the coldest real cradle (~+12C)': calibration of a threshold to reality, not case-detection; fine.
- src/sim/peopleSim/crystallize.js:314 — spMul=2 under DISSOLVE_FARMS comment admits tuning to 'urbanisation stays realistic (~60%)'; distribution-shaped calibration, borderline-acceptable (see finding 7).
- src/sim/peopleSim/territory.js:62-63 — FLOOD_VALUE=0.90/RIVER_VALUE=0.55 lift tile desirability on flood/river masks; physically meaningful (prime irrigated cropland worth) and feeds a value/difficulty mechanism rather than granting territory directly; clean.
- src/sim/peopleSim/transport.js:264-270 — the noPortTax exemption for food catchments is a genuine mechanism fix (mode-change cargo tax is irrelevant to farming on foot), not a river-cradle special case, despite the 'starving the valley cradles' motivation.
- src/sim/peopleSim/conquest.js:1770-1779 — the dominance ceiling was explicitly converted FROM a flat clamp TO an emergent bound (capCoh-scaled); good rule-2 repair work.
- src/sim/peopleSim/cohesion.js + index.js:188-194 — the _civYear/_leadOrg plumbing is the codebase's standard de-pinning idiom and is consistently used (identity salience, absorb resistance); rule-1 clean.
- src/sim/calendar.js — display calendar is genuinely read-only cosmetic; the only mechanical consumer is dynasties.js via dynYear, which is a uniform time-UNIT conversion (reign lengths), not a gate; clean.
- src/sim/riverGen.js:45-62 — CATCH_* absolute-km2 river classification replaced a resolution-dependent percentile; 'tuned so global river DENSITY matches the old percentile output' is self-consistency calibration, not outcome fitting; good.
- src/sim/worldgen.js:304 — 'Target: Gulf Stream should push warm water ~500 pixels' is Earth-physics calibration of the ocean-advection strength; acceptable for the Earth preset's climate model.
- src/sim/peopleSim/habitability.js and agriculture.js are the best rule-2 exemplars in the repo: named regions appear only as the phenomena being explained, every term is a function of local state, and the constants are anchored to the biome classifier's own scales.
- src/sim/peopleSim/personality.js:115-127 — temperament anchors are seeded random with only weak material priors (water/luxuries->commerce, horses/metal->aggression) and expansionism deliberately geography-free; clean asymmetry source.
- src/sim/peopleSim/countryTerritory.js:48 — COUNTRY_REACH_ORG's history ('was 20 — empires were continental too early; a 14->26 trial... reverted') shows pacing tuned by observed empire size; borderline-acceptable mechanism tuning but the admitted resolution-sensitivity is a smell (folded into finding 7).
- docs/ (coerced-labor.md, currency-system.md, persistent-territory-spec.md, farming-region-dissolution.md, territory-growth-plan.md, SPEC-climate-moisture-fix.md) all design mechanism-first and explicitly restate the cardinal rules; no planned outcome-fitting found in the specs.
- src/WorldSim.jsx biome palette comments (Sahara tan, Nile/Indus green ribbon) are pure rendering; no sim influence.
- src/sim/peopleSim/tuning.js:445 SLAVE_TARGET is a scale lever on coerced-labour intensity, not a pinned outcome, despite the name.
- src/sim/peopleSim/crystallize.js:173 — FRONTIER_EXTEND_DIST derived arithmetically from the spacing model (20+8) rather than tuned; good example of a constant with independent meaning.
- src/sim/peopleSim/inflation.js — the price-level baseline self-calibrates from the world's own early economy (world._inflRef) rather than an external target; clean, though the step>=5000 warm-up guard (line 82) is a mild time-flavored readiness check (it also requires M.size>=3, a state condition).


**hunt-determinism**

- All performance.now uses inside src/sim (index.js:151-153,304; conquest.js:1564+) write only to world.debug profiling fields — never saved, never read by mechanics.
- peopleSimWorker's paced/unbounded tick scheduler (tickAccum, STEP_BUDGET_MS) affects only steps-per-wall-second; per-step results are wall-clock-independent.
- Event compaction (events.js:43) reassigns ev.id = new index; historiography's rumor rolls hash on evId (historiography.js:44), so a compaction changes which events get scribal distortion — display-only, but worth knowing.
- world._landStatsCache (index.js:329) makes peopleSimStats value depend on when it's called within a 32-step window — display-only.
- loadWorld never restores world._eraAt's live continuation cleanly if absent (defaults [0]) — cosmetic timeline only.
- POP_ANCHORS/realWorldPopSim and CIV_ORG_YEAR are outcome-calibration tables against real Earth history, but keyed on emergent _civYear (not the clock) and ANCHOR_POP defaults to 0 (off) — a documented, levered calibration rather than a Rule-2 violation; keep it behind the lever.
- EARTH_HEARTH_SITES (state.js:322) hard-codes Nile/Mesopotamia/Yellow-River map positions for the earth preset (T.EARTH_HEARTHS def 1) — initial-condition seeding, not a runtime mechanic, but it is the one named-region special case in the sim; the algorithmic cradle path remains the honest fallback.
- hashWorld folds NaN as 0 via `+v || 0` (persist.js:233) — a NaN infection in people/food/wealth would hash identically to zero and slip past the save-identity check; the invariant checker (opt-in) is the only NaN net.
- conquest.js identityWeightsNow / cohesion.js eraIdentityWeights correctly read world._civYear (emergent development pseudo-year), not the display calendar — the comment at conquest.js:1676 saying 'shifts with the calendar' is misleading wording, not a time-gate.
- dynasties.js uses the UNIFORM dynYear mapping only for durations (ages, reign lengths) — elapsed-time durations, not absolute calendar gates; consistent with the cardinal rule.
- editorPlaceCountry (peopleSimWorker.js:45) runs 640 synchronous sim steps on user input — inherently non-reproducible unless the user saves afterward; fine, but note it also mutates _countryClaim directly.
- ensureRoadArrays rebuilds _roadTiles from roadQuality in ascending tile order after load vs live insertion order — iteration order differs but the pave/decay sweep is per-tile independent, so no divergence.
- seedCradleVillage's candidate sort (state.js:417) ties on equal float scores resolve by tile index via stable sort — deterministic.
- The trade pass's asymmetric-reach pair rule (roads.js:867) correctly guards both directions with reachHasPeer, avoiding both double-processing and dropped one-way links — nice.
- world._famineUntil comparisons and truce/famine durations divide by _dt so SIM_GRANULARITY preserves history-time spans — consistently applied.
- smoke.mjs runs both determinism sims in one process; module-global tuning (T) mutation by a prior test would silently affect later ones — the DISSOLVE_FARMS test's try/finally resetTuning is the right pattern, keep it mandatory for future lever tests.
- worldGenWorker vs main-thread real-wind Earth path use the same pipeline code — no dual-implementation divergence found.


**hunt-save-load**

- persist.js:35,38 — "_isColony" appears twice in SETT_FIELDS; harmless but one should be removed.
- sea.js:263 — the sea-lane wobble field seeds from `world._seed`, which is never set anywhere (the field is `world.seed`), so `(world._seed|0)||1` makes every world share the identical wobble noise regardless of seed; deterministic and save-safe, but not what the comment intends.
- loadWorld calls computeTerritory before any climate pass, and post-load `world.climMod` stays undefined for up to CLIMATE_INTERVAL−1 ticks (index.js:198 only fires on step===1 or the modulo), so the first territory tally ignores the restored _climIndex/_climShock — call updateClimate(world) in loadWorld before computeTerritory for an exact warm start.
- world._claimSnap (instant secession paint set, countryClaim.js:74) is not saved — a realm that seceded just before the save has its territory crawled out ring-by-ring after load instead of snapping; cosmetic-transient.
- world._claimPress (border-crawl pressure accumulator, countryClaim.js:187) resets on load, so all fronts pause a few relax passes while pressure rebuilds; within re-warm doctrine but worth knowing.
- world._agriCeil is computed once and cached but never invalidated when T.AGRI_CEIL_FLOOR / T.AGRI_TROPIC_PENALTY levers change mid-run (agriculture.js:129) — a live lever tweak silently does nothing until reload; unrelated to saves but adjacent.
- hashWorld samples roadQuality only every 97th tile and events only by length — fine as a cheap identity check, but don't mistake it for coverage; it also never touches the tables/maps blocks (e.g. a broken _warExhaust roundtrip would pass).
- world._checkInvariants and world._dbgProfile do not survive loadWorld (new object); tools re-set them manually, the app worker never enables invariants — intentional, but worth documenting in persist.js's header.
- Polity/culture/faith/person/dynasty records are saved by raw JSON — any future Map/Set/typed-array field added to those records will silently serialize as {} / be lost; keep them JSON-plain or add explicit codecs (the _momentum/_impCapacity/etc. fiscal fields are all currently plain and survive).
- countries-view fields (c._warStamp, c._dominance, c._manpower, c._armyPro/_armyCon, c._defLoad, c._offFronts) are rebuilt every polity pass by design — they are genuinely transient because updatePolities recreates the objects; no save action needed, but note advanceFronts silently loses conscription context (c._warStamp) until the first post-load polity+war pass pair.
- The demographic-anchor first tick after load uses `world._civYear ?? -6000` (index.js:103) because _civYear is computed later the same tick — a deliberate 1-tick lag mid-run, but on load it compounds with the empty-countries gap (main finding).
- events.js EVENT_CAP compaction reassigns ev.id = position and reindexes — saved logs (ids equal positions) round-trip consistently through reindexEvents.
- seaReach values (Map pid → lane record) and ships are JSON-plain and round-trip fine; ship ids continue from counters.ship correctly.
- SETT_FIELDS persists `_chronFlags`/`_peakTier` and polity.chron persists milestone bands — chronicle dedup state survives load correctly; the war.began dedup (_warSeenAt) is the one chronicle-integrity gap.
- tuning saved as diff-from-default means a code-version change to a default silently changes loaded old saves' behavior (the save records no absolute values for untouched levers) — acceptable, but a `tuningDefaultsVersion` stamp in meta would make it auditable.


**hunt-perf-memory**

- Per-pass profile at 240×120, 12k steps: settlements bucket dominates (≈5.5s per 4k steps late-run), then trade (1.6s), roads (0.7s), polities (0.75s); max single-tick spikes: territory 37.7ms, roads 25ms, trade 23ms, sea 15ms, crystallize 13.5ms, polities 14ms — all interval passes, none per-tick.
- computeTransport (global flood for crystallisation weighting) allocates a fresh Float32Array(N) every 480-tick refresh instead of reusing a buffer — 1.8MB churn per refresh at Earth scale (transport.js:293).
- countryClaim.js header says '_countryClaim is render-only: nothing in the sim depends on it' — outdated: grownOwnerAt feeds crystallize spawn-country decisions and adoptAndFound, so it is sim-input state now (comment fix only).
- runTradePass allocates a new linkMoney Map with string keys ('lo:hi') per trade sweep; armies/alliances then re-parse those keys with indexOf/slice — an integer pair-key (lo*2^20+hi) would kill both the string churn and the parsing.
- buildSnapshot's ghost-owner scrub builds a Set of settled ids and scans all N owner tiles every 6th snapshot (peopleSimWorker.js:402-405) — could key on a territory version and skip when unchanged.
- editorPlaceCountry runs stepPeopleSim(world, 640) synchronously inside one worker message — snapshots freeze for the whole settle burst (seconds at Earth scale); consider chunking it through the tick scheduler.
- buildHierarchy (conquest.js:600-619) is O(members²) per realm per polity pass (nearest higher-tier scan) — fine at current empire sizes (≤~60 members), worth a grid query if realms ever reach hundreds of members.
- advanceFronts' full-map scan does a byId Map.get per owned tile (and up to 4 more per neighbour check); precomputing an ownerId→countryId Int32 lookup once per pass would cut most Map traffic in the biggest interval scan (armies.js:434-530).
- updateAlliances' adjacency scan calls the ccAt closure (owner→byId.get→countryId) up to 3× per tile over the full grid every 600 ticks (conquest.js:1514-1518) — same Int32 lookup-table optimisation applies.
- hasOutsideBorder / filterToConnectedBloc allocate Sets/Maps and scan O(N) per secession attempt — event-driven and rare, acceptable.
- identityField diffusion (4 vote-stencil passes over N×K) runs only when an identity lens is active and every 150 ticks — well gated; its scratch buffers are reused (allocation-free as claimed).
- Money/roads views rebuild their full-canvas base every 8 sim-steps (STEP_CACHE_REGEN) — a 1.84M-pixel loop ~4×/s at speed 30; cheap fills, but could ride the psOverlay regen instead.
- applySnapshot rebuilds cultures/faiths/languages Maps from arrays on every static send (5×/s) even when unchanged — a version tag would skip it; same for psw._byId rebuilt 30×/s.
- The wind-view particle system stores trail arrays of objects per particle (3000 × 12 {x,y} objects, shift() per frame) — fine at this size, but a ring-buffer Float32Array would be idiomatic with the rest of the codebase.
- MAX_REACH_VISITS=8000 caps each reach Dijkstra; on a very dense road web this truncates before MAX_PARTNERS is found — behavioural (nearest peers only), not a leak, but worth knowing it binds at scale.
- EVENT_CAP=200k is generous as a 'memory safety valve': at that size the save file's events section alone is ~30-50MB of JSON; if long-run saves matter, consider capping saved events separately from the live log.
- world._moneyFlows entries hold references into link.tiles (the reach cache's path arrays) — no copying, good; they die with the next sweep so no retention issue.
- peopleSimStats' O(N) land scan is cached for 32 steps (index.js:326-343) — good; it was called 30×/s pre-cache.
- The b64FromTyped save path builds the base64 via string concatenation in 32k chunks — O(bytes) with rope strings, acceptable for multi-MB saves in a worker; a chunk array + join would be marginally kinder.
- foodHierarchy's per-tick budget Map snapshot means coin conservation holds regardless of tree order — the allocation churn noted in findings is the only cost concern there.
- hashWorld samples roadQuality every 97th tile — cheap and adequate for the determinism smoke test.
- No O(cells)-every-tick pass exists: climate (O(N)/20), soil (O(settlements×49)/600), relaxClaim (O(N·rings)/12 — flagged), identity mirror (O(N·K)/150, lens-gated) are all on intervals; the per-tick core is strictly O(settlements×partners).


---

# Part 4 — Completeness critic

File-level coverage is near-total: every file in src/sim and src/sim/peopleSim is named in at least one digest, the UI/worker/persistence layers each got dedicated reviewers, and four cross-cutting hunts (time-gates, fitted outcomes, determinism, save/load) plus perf swept src/ systematically. Convergent independent confirmation of the biggest bugs (_tileCapturedAt/_capturedAt persistence mismatch, _truces/_cBudgetRamp/_orgApt/_soilFatigue loss, inflation step>=5000 gate) suggests the per-subsystem work was genuinely thorough. What the audit structurally missed: (1) optional-flag code paths — the real-NCEP-wind mode exists only on the main thread and is invisible to pipeline.js, persist.js, and the tools harness, so its save/load and parity story was never examined by anyone; (2) the tech/knowledge progression engine — the master driver of reach, era, capacity, and _eraProd — produced ZERO findings across all 23 reviewers (tech.js was only nominally in the economy reviewer's scope; settlement.js updateKnowledge, a large function, yielded no findings), the strongest thin-coverage signal in the audit; (3) cross-system multiplicative stacking — agri knowledge enters land food through at least four multiplicative channels (techEff.farmYield, s._eraProd = agri^POW, irrigation = f(farmTech), alluvium = f(farmTech)) and river/floodplain advantage through at least five systems, but each reviewer saw only their own factor and nobody audited the composed product; (4) armies.js combat math got a descriptive summary but every war-shocks finding is about shocks.js — battle resolution, casualties, manpower, and conscription accounting are effectively unaudited; (5) five reviewers flagged individual SIM_GRANULARITY/_dt and resolution-scaling inconsistencies, but nobody ran the end-to-end A/B experiments that would quantify whether history shape actually diverges; (6) secondary tooling and data provenance (tools/ui_smoke.mjs, tools/audit_hydro.mjs, convert_wind_data.py sign conventions, ~5 MB of data/ files of unclear necessity, no regeneration script for the 2.4 MB earthData.js) were never inspected.
