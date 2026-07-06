# Simman Review — Findings II: Medium & Low

_Companion to [REVIEW.md](../../REVIEW.md)._


## MEDIUM (78)

### 35. Plate convergence/divergence sign is inverted — mountains form where plates separate, rifts where they collide
`src/sim/tectonicGen.js:430` · **MEDIUM** · Bug · verdict: **CONFIRMED** · found by `worldgen-tectonics`

`const convRate = ((pB.vx - pA.vx) * bnx + (pB.vy - pA.vy) * bny);` where (bnx,bny) is normalized (ddx,ddy), i.e. the unit vector FROM this cell TOWARD the neighbor plate B. The relative velocity of B w.r.t. A projected onto that outward normal is POSITIVE when B moves away — that is divergence. But the code treats `convRate > 0.05` as convergent (lines 434-447: cont-cont uplift 0.20, ocean-cont uplift 0.15) and `convRate < -0.05` as divergent (448-455: continental rift lowering). Concrete trace: plate A with vx=+1 on the left, plate B with vx=-1 on the right (head-on Himalaya-style collision); for a cell in A with neighbor in B, ddx=+1, convRate = (-1 - 1)*1 = -2 < -0.05 → the collision zone gets `boundaryDiv` rift lowering, while an Atlantic-style separating margin gets the 60-cell cont-cont plateau BFS. Because plate velocities are drawn from an isotropic random distribution and are never exported (generateTectonicWorld returns only pixPlate), the ensemble of maps is statistically indistinguishable from the correct version — but the mechanism is physically backwards, and any future feature that reads plate velocities (drift animation, velocity arrows on the plates overlay, earthquakes, continental drift over time) will contradict the terrain it produced.

**Fix:** Negate the projection: `const convRate = -((pB.vx - pA.vx) * bnx + (pB.vy - pA.vy) * bny);` (or equivalently use (pA.v - pB.v)·n̂). No other change needed; both sides of a boundary already agree on the sign.

### 36. Plain 'earth' preset never carves straits — Mediterranean and Black Sea are sealed lakes with no naval link to the Atlantic
`src/sim/worldgen.js:80` · **MEDIUM** · Bug · verdict: **CONFIRMED** · found by `worldgen-tectonics`

carveStraits() (line 65) exists precisely because 'Sub-pixel narrow straits seal shut on the ~20 km/pixel Earth heightmap ... the Mediterranean otherwise has NO naval link to the Atlantic' (comment, lines 56-59). It is called only in the earth_sim branch (line 142); the 'earth' branch (lines 80-131) builds the identical elevation from the same heightmap but never calls it. Verified by probe at 960x480 seed 8817: flood-filling ocean from the mid-Atlantic, the Mediterranean (15E,36N) and Black Sea (34E,43N) are ocean but NOT connected in preset 'earth' (connected in 'earth_sim'). Any sea-connectivity mechanic (naval reach, fishing, trade, migration across water) treats the entire Mediterranean world as landlocked in the plain Earth preset.

> **Verifier correction:** Confirmed for the Mediterranean: 'earth' never calls carveStraits, so the Med has no naval link to the Atlantic (earth_sim does link it via the Gibraltar carve at worldgen.js:142). Correction: the Black Sea is disconnected in earth_sim as well — EARTH_STRAITS (worldgen.js:62-64) contains only Gibraltar, no Bosporus — so the Black Sea being a sealed lake is preset-independent, not specific to 'earth'. Proposed fix (call carveStraits after the earth branch's pass-1 loop, before the coast-distance BFS) is correct as stated.

**Fix:** Call `carveStraits(elevation,W,H);` in the 'earth' branch immediately after its elevation pass (after the pass-1 loop, before the coast-distance BFS), exactly as earth_sim does at line 142. Note temperature is computed in the same pass-1 loop from pre-carve elevation — negligible (a few tiles at -0.02), but carving before pass 2 keeps the BFS consistent.

### 37. windSolver's signed-latitude convention is inverted for every asymmetric pressure feature (ITCZ trough at 8°S, polar highs swapped)
`src/sim/windSolver.js:165` · **MEDIUM** · Bug · verdict: **CONFIRMED** · found by `climate`

latDegSigned = ((wy/wH - 0.5)*2)*90 is NEGATIVE at the north pole, yet lines 165-181 treat positive as north: `itczLat = 5 + _itczOffset*90` (≈8 with the 0.033 default) centers the ITCZ trough at latDegSigned=+8, which is geographically 8°S — the real annual-mean ITCZ sits ~5°N; `subpolarN` (Icelandic/Aleutian low) at +60 lands at 60°S while `subpolarS` at -55 lands at 55°N (labels swapped, values close enough to mostly cancel); `polarN`=0.2 at +85 is the SOUTH pole and `polarS`=0.3 at -85 the NORTH — reality is the reverse (the Antarctic high is the stronger one). The symmetric belts (subtropN/S both 0.8@±30) are unaffected. Same root convention error as the seasonal-monsoon flip: the whole STEP-2 block assumes + = north. Failure scenario: the wet ITCZ pressure trough and its convergence sit ~13° south of the moisture solver's convective rain band (whose latSgn convention at moistureSolver.js:273 is correct, + = N), so wind convergence and convective rain never line up even in the annual mean.

> **Verifier correction:** All hemisphere claims confirmed, but the misalignment magnitude is misstated: the moisture solver's convective band defaults to the equator (itczLat=0, moistureSolver.js:46), and worldgen.js:277-278 runs seasonal solves at itczLat=±13 while the wind trough stays fixed at ~8°S (STEP-2 ignores _season). So the code-vs-code offset is ~8° in the annual mean, ~21° in the boreal-summer solve, and ~5° in the winter solve — "~13°" is only the gap versus the real-Earth 5°N reference.

**Fix:** Define one convention at the top (`const latN = -(latFrac)*90; // + = north`) and express all belt centers/hemisphere tests in it; the ITCZ offset, the subpolar-low and polar-high asymmetries then land in their real hemispheres.

### 38. Ekman initialization has both Coriolis cross-terms sign-flipped relative to the solver's own dynamics
`src/sim/windSolver.js:273` · **MEDIUM** · Bug · verdict: **CONFIRMED** · found by `climate`

The iterative solver's Coriolis (lines 341-342: corX = -f*v, corY = +f*u) is correct for screen coordinates with the code's f (positive in the NH), and the probe confirms it converges to correct easterly trades. The steady state of those dynamics with drag k is u = (-k·p_x + f·p_y)/(f²+k²), v = (-f·p_x - k·p_y)/(f²+k²). The init at lines 273-274 instead computes `windX[i] = (-kf*dpdx - f*dpdy)/denom; windY[i] = (f*dpdx - kf*dpdy)/denom;` — both f terms negated — i.e. the Ekman solution for the OPPOSITE hemisphere: the initial field circulates anticyclonically around lows in the NH. With the default 500 iterations the wrong init decays (ocean drag e-folding ≈ 1/(0.018·0.35) ≈ 160 iterations, ~4% residual), so the default output is fine, but `windSolverIter` is an exposed tuning parameter (line 33): anyone lowering it below ~150 for speed gets a wind field still contaminated by reversed gyres, and even at 500 the solver spends most of its budget undoing its own initialization.

> **Verifier correction:** Init at src/sim/windSolver.js:273-274 has both Coriolis cross-terms sign-flipped relative to the solver's own dynamics; proposed fix (windX=(-kf·dpdx+f·dpdy)/denom; windY=(-f·dpdx-kf·dpdy)/denom) is the correct fixed point. Correction: the wrong-init error decays much SLOWER than the claimed ~160-iteration drag e-folding — the explicit-Euler error mode has modulus sqrt((1-k·dt)²+(f·dt)²), so at mid/high latitudes rotation nearly cancels (or exceeds) drag damping (~11% decay after 150 iters at f=0.3 in a point trace); residual removal relies on viscosity and the divergence projection, so low-iteration contamination is worse than stated.

**Fix:** Flip the two f terms in the init to match the dynamics: `windX = (-kf*dpdx + f*dpdy)/denom; windY = (-f*dpdx - kf*dpdy)/denom;`. Convergence gets strictly faster and low-iteration runs become safe.

### 39. eliminateEnclaves transfers settlements with no recordOccupation, no event, and no conquest attribution
`src/sim/peopleSim/conquest.js:2442` · **MEDIUM** · Bug · verdict: **CONFIRMED** · found by `conquest`

Every other transfer path preserves national identity and logs: absorbWeakNeighbors calls `recordOccupation(m, oldCC, bestId, world.step)` + logEvent('settlement.annexed') (lines 2317-2320); army storms call recordOccupation in armies.js:867. But eliminateEnclaves does only `s.countryId = intoId; s.loyalty = 0.6; s._conqueredAt = world.step;`. Failure scenario: a small nation (even a whole city-state, via the CITY_ENCLAVE_DOMINANCE relaxed rule at line 2421) is engulfed and annexed by the enclave pass. Its settlements never get `_homeland` set, so restoreNations (line 811 filters on `m._homeland`) can never re-emerge it — Poland-partitioned-by-enclave assimilates instantly, while the identical settlement absorbed one tile away by absorbWeakNeighbors keeps its homeland for HOMELAND_MEMORY steps. The annexed polity is also closed later by reconcilePolities as generic 'dissolved' with no `by` attribution, and no settlement.annexed event appears in the chronicle — an entire country can vanish from the map with zero recorded history.

> **Verifier correction:** All cited lines check out; only nuance is that recordOccupation(s, from, to) with s._homeland === toId clears homeland ("home again"), so the proposed fix must be called before reassigning countryId with the old countryId as fromId — as the reviewer already specified.

**Fix:** In the flip loop, call `recordOccupation(s, s.countryId, intoId, world.step)` before assigning, and log a settlement.annexed (or a dedicated polity-level 'enclave absorbed') event; consider crediting `endPolity(..., 'conquest'/'absorbed', intoId)` when the region held a whole country.

### 40. Major-river toll (and FRAG_SEPARATION) are not resolution-scaled — the river-frontier mechanic is ~4x weaker at the shipped 960 grid
`src/sim/peopleSim/conquest.js:510` · **MEDIUM** · Bug · verdict: **CONFIRMED** · found by `conquest`

The file is scrupulous about resolution invariance (holdReach = range * resScaleFor(tw), line 585; the long resScale comments at 531-539). But majorRiverToll returns a fixed `Math.max(RIVER_TOLL_MIN, RIVER_TOLL_MAX - cons * RIVER_TOLL_CONS)` (max 6) that is added straight into `d = eucl + surcharge + riverToll` (line 1933) where eucl and the Dijkstra surcharge are map-tile quantities that grow 4x on the shipped 960 grid, and the sum is divided by the res-scaled holdRange (line 1966). At the 240 reference grid a zero-construction realm pays ~6 / holdRange(8-30) = 0.2-0.75 extra load per far-bank province — a genuine wall, as documented ('rivers genuinely bound a low-tech empire's extent'). At 960 the same toll is 6 / (4x holdRange) — a quarter of the effect, so the Rhine/Danube/Nile frontier behavior the comment promises mostly evaporates at the default resolution. FRAG_SEPARATION = 18 (line 310) has the same problem: successor capitals after a capital-fall need only 18 tiles' separation regardless of grid, so at 960 the Diadochi pack 4x closer (in world-fraction) than the mechanic was tuned for; UNREST_RADIUS_MIN = 15 likewise (mitigated because holdReach usually dominates the max()).

> **Verifier correction:** One caveat, not a refutation: countryTerritory.js:184-185 documents a deliberate convention that per-EDGE costs (e.g. CLAIM_CAP) are NOT res-scaled, and the river toll is a per-edge cost — so this may be an overlooked consequence of that convention rather than a plain oversight. But that convention's rationale (cumulative distances scale because they span more tiles) does not hold for a river, which remains a single crossing edge at any resolution, so the barrier-vs-reach ratio still shrinks by resScale and the finding stands.

**Fix:** Multiply the returned toll (and FRAG_SEPARATION, UNREST_RADIUS_MIN) by resScaleFor(world.tw) — crossing a river is a reach-fraction barrier, not a fixed tile count, in the frame where load = d/holdRange.

### 41. Alliance and colonial-independence cadences silently break when T.POLITY_INTERVAL does not divide 600
`src/sim/peopleSim/conquest.js:1691` · **MEDIUM** · Bug · verdict: **CONFIRMED** · found by `conquest`

updatePolities only runs when `world.step % T.POLITY_INTERVAL === 0` (index.js:267). Inside it, `world.step % ALLIANCE_EVERY === 0` (line 1691, 600) and `world.step % INDEPENDENCE_EVERY === 0` (line 1614, 600) therefore fire only at steps that are common multiples of the interval and 600. The default 150 divides 600 — fine. But POLITY_INTERVAL is an exposed runtime lever (tuning.js: min 30, max 400, step 10), and for many legal values the checks starve: interval 90 -> alliances refresh every LCM(90,600)=1800 steps (3x staler), 160 -> 2400, 170 -> 5100, 190 -> 11,400 (19x staler). The war pass (armies.js coalitionBarOf) reads _blocMight/_allianceTarget every muster, so with a slow-refresh setting the balance-of-power brake and the colonial independence arc act on threat data thousands of steps stale — the anti-hegemon force the recent balance-of-power commits added quietly degrades. The `!world._allianceTarget ||` guard only covers the very first pass.

> **Verifier correction:** Claim holds as stated except the interval-170 example: gcd(170,600)=10, so alliances refresh every LCM(170,600)=10,200 steps (17x staler), not 5,100. Also, index.js scales the polity cadence by SIM_GRANULARITY (_ivl, index.js:167) while ALLIANCE_EVERY/INDEPENDENCE_EVERY in conquest.js are unscaled constants, so non-unit granularity can desynchronize the cadences even at the default POLITY_INTERVAL=150.

**Fix:** Replace the modulo checks with last-run tracking: `if (!world._allianceTarget || world.step - (world._allianceAt || -Infinity) >= ALLIANCE_EVERY) { updateAlliances(world); world._allianceAt = world.step; }`, and the same for the independence check.

### 42. rebel() can ravage the same settlement twice in one pass after a failed rising
`src/sim/peopleSim/conquest.js:1125` · **MEDIUM** · Bug · verdict: **CONFIRMED** · found by `conquest`

The guard `if (seed.countryId !== c.id) continue; // already swept into an earlier rising this pass` only catches SUCCESSFUL risings (which change countryId). The failure branch (line 1146-1153, `!hasOutsideBorder || !blocHasCity`) ravages every bloc member (pop x0.82, wealth x0.5, army x0.4) but leaves countryId unchanged. Failure scenario: two nearby interior cities A and B both reach unrest >= 1 in the same pass, so both are in `rebelSeeds`. A's rising rallies B (unrest >= UNREST_JOIN) into its bloc; the bloc is landlocked inside the parent -> fails -> both A and B are ravaged and unrest-zeroed. The loop then reaches seed B: B.countryId still === c.id, so B starts its own (now solitary) rising, fails hasOutsideBorder again, and is ravaged a second time — pop x0.82^2 ≈ x0.67, wealth x0.25 in a single polity pass, double the intended failed-revolt damage.

> **Verifier correction:** Claim accurate as stated; additionally the garrison compounds to army x0.4^2 = x0.16 in the double-ravage. The proposed unrest guard works because both venting paths (lines 1141 and 1149) set unrest to 0 before the loop can revisit the seed.

**Fix:** Also skip seeds whose grievance was already vented this pass: `if ((seed.unrest ?? 0) < 1) continue;` at the top of the seed loop (the failure branch sets m.unrest = 0), or mark bloc members in a Set.

### 43. Tolls and entrepôt brokerage are credited to dead (even pruned) intermediate settlements — a money leak the buyer still pays for
`src/sim/peopleSim/roads.js:1099` · **MEDIUM** · Bug · verdict: **CONFIRMED** · found by `trade-network`

link.inter holds direct settlement OBJECT references captured at reach build (computeReach → intermediatesOnPath, roads.js:407). Trade reach is only refreshed for each settlement every ~REACH_SPREAD=120 ticks (staggerReachRebuild), while settlements die any tick (settlement.js:2256) and are pruned from world.settlements every 32 ticks (index.js:250). sellGoods checks the trade ENDPOINTS' liveness (`if (!peer || peer.mode !== "settled") continue;` roads.js:859) but never checks intermediates: `for (const inter of intermediates) { ... inter.wealth = (inter.wealth || 0) + tollPer; ... }`. Failure scenario: A trades with B through toll town C; C dies at tick t; for up to 120 ticks A/B's cached link still lists C, so every sweep the buyer is charged totalToll = goodsValue × 0.18 (× choke weight up to 4×) as part of `want`, and the coin is credited to a dead — after pruning, fully detached — object. The stated conservation invariant ("Nothing is burned in trade", roads.js:1113) is violated: that coin leaves the live money supply permanently.

**Fix:** Filter intermediates by `inter.mode === "settled"` BEFORE computing tollSum/brokerSum in sellGoods (so the buyer isn't charged for ghosts either), or validate/refresh link.inter liveness in runTradePass before calling runGeneralTradeBetween.

### 44. Road short-circuit in _edgeCost prices any edge touching ONE road tile at road cost — including stepping into impassable ocean
`src/sim/peopleSim/transport.js:205` · **MEDIUM** · Bug · verdict: **CONFIRMED** · found by `trade-network`

`if (qF < 1.0 || qT < 1.0) return Math.min(qF, qT);` fires when EITHER endpoint is a road. Since a non-road tile has quality 1.0, an edge from a road tile into ANY neighbouring tile — deep water, a high peak — costs min(qRoad, 1.0) = qRoad (0.08–0.25), bypassing the water Infinity gate and all terrain penalties, and skipping the port tax and the LAND/WATER cost dials. Failure scenario: roads painted on both banks of a 1-tile-wide strait or channel (elev ≤ 0): edge A(road)→W(water) costs qA, edge W→B(road) costs qB, so the zero-tech global transport map (computeTransport via baseEdgeCost, used by the crystallization connectivity bias, and pipeline.js:547's crossing overlay) treats the two landmasses as road-connected even though water should be Infinity at zero navigation. Inside findPath the noWater guard blocks the water case, but the land half of the bug still applies there: a 1-tile mountain gap between two decayed-road fragments costs ~0.16 total instead of the ~5–12 the terrain model dictates, so road-planning path costs systematically underprice routes that graze existing roads.

> **Verifier correction:** Confirmed at transport.js:205-206, with two corrections: (1) the water bypass needs a road on only ONE bank — road→water costs qRoad, then water→far-land (both quality 1.0) falls through to normal finite land cost + port tax, so any road tile abutting a 1-tile channel gives the far landmass a finite transportDist, defeating crystallize.js's overseas-colonisation gate (lines 434-436); (2) the pipeline.js:547 crossing overlay is NOT affected — its crossWorld object (pipeline.js:507-508) omits roadQuality, so the road shortcut never fires there. The findPath land-half (1-tile terrain gap between road fragments priced at ~2×roadQuality instead of the terrain model's ~5-12) holds as stated; polit

**Fix:** Only short-circuit when BOTH endpoints are roads (`qF < 1.0 && qT < 1.0 → return min`), and otherwise charge e.g. the destination tile's terrain cost when stepping off / the road quality when stepping on — never let a road edge override the water-impassability check (test toMode === 2 before the road shortcut).

### 45. Slave raiding double-scales with SIM_GRANULARITY: the pass interval is already stretched by G, but the grab is also multiplied by dt = 1/G, so raid intensity falls as 1/G
`src/sim/peopleSim/slavery.js:41` · **MEDIUM** · Bug · verdict: **CONFIRMED** · found by `economy`

index.js:280 runs the pass as `if (world.step % _ivl(SLAVE_INTERVAL) === 0) updateSlaveTrade(world)` — the interval stretches to 50·G ticks, which already keeps the pass covering the same 50 units of history at any granularity (index.js:156-167: "Rate PASSES ... stretch their tick-interval by G to stay paced"). But the grab inside the pass is `const grab = Math.min((v.people || 0) * T.SLAVE_RAID * dt, (v.people || 0) * 0.5)` with `dt = world._dt || 1` = 1/G (slavery.js:28). Concrete failure: at G=1 a victim loses 0.4% of its people per 50 history-units; at G=4 the pass fires every 200 ticks (= the same 50 history-units) but grabs only 0.1% — raiding, captive supply, and hence the whole plantation economy run 4× weaker, breaking the granularity contract ("the SAME emergent history unfolds ... G = 1 is the calibrated baseline"). Compare updateCoercedLabour (settlement.js:695), which correctly multiplies its per-TICK attrition by dt because it runs every tick.

> **Verifier correction:** Core claim is exactly right: the _ivl-stretched interval (index.js:280) plus the ×dt in slavery.js:41 double-scales, making raiding ∝ 1/G per unit of history (G=1 baseline unaffected; T.SIM_GRANULARITY can be 1-8 per tuning.js). Minor correction: the revolt roll the reviewer flags for the same audit (settlement.js:702) is per-tick, not interval-stretched, so its ×dt is correct and needs no change.

**Fix:** Remove the `* dt` from the grab (the interval stretch already paces it), or equivalently scale by `dt * ivl` if you want the formula to read as a rate × elapsed-history. Same audit is worth doing on the revolt roll and any other _ivl-stretched pass that also multiplies by dt.

### 46. Ancestry origin is hard-coded to the East African Rift coordinates for the Earth preset
`src/sim/pipeline.js:148` · **MEDIUM** · Cardinal rule 2 (fitted outcome) · verdict: **CONFIRMED** · found by `hydro-pipeline`

generateAncestry branches on the preset name and injects a fixed geographic answer: `if (preset === "earth" || preset === "earth_sim") { const cx = Math.round(((37 + 180) / 360) * tw), cy = Math.round(((90 - 4) / 180) * th); ... }` — snapping the peopling origin to 4°N 37°E (Lake Turkana). This is the Cardinal-Rule-2 tell: detecting a named case (the Earth map) and painting the desired result (origin in Africa) instead of letting the mechanism produce it. The mechanism DOES exist as the else-branch (lines 161-169: warmest, watered, deepest-interior tile of the largest continent), which is used for procedural worlds. On the real Earth heightmap that computed cradle would very likely already land in tropical Africa, so the hard-code mostly substitutes ground-truth for the emergent answer rather than being necessary. It is gated on preset, not on world state.

> **Verifier correction:** Claim is accurate as stated. One mitigating note: the injection is arguably ground-truth INITIAL-CONDITION seeding on a real-Earth map (paralleling the T.EARTH_HEARTHS gate at src/sim/peopleSim/state.js:374 and the real heightmap itself), not a mid-simulation outcome patch — but the emergent else-branch exists and per CLAUDE.md the honest move is to use it everywhere and fix its scoring if it misses Africa.

**Fix:** Drop the earth-specific coordinate injection and always use the computed cradle (warm/watered/interior-of-largest-landmass). If the emergent cradle lands somewhere other than Africa on the Earth map, that is a TRUE finding about the interior/warmth scoring to fix at the mechanism, not to paper over with a lat/lon.

### 47. Inflation baseline lock is gated on `world.step >= 5000` — the only hard step-number gate in the sim, and the state conditions the comment promises are not actually implemented
`src/sim/peopleSim/inflation.js:82` · **MEDIUM** · Cardinal rule 1 (time-gating) · verdict: **CONFIRMED** · found by `economy`

`if (world._inflRef === undefined && world.step >= 5000 && M.size >= 3)`. A repo-wide grep for step-number gates shows this is the single remaining `world.step >= N` content gate in src/sim. Until it fires, updateInflation returns early (line 98) and every sim price is pinned at P=1 — so whether monetary history is allowed to exist is decided by WHEN it is, not by what the economy has become. The comment claims the lock waits until "the world has a real economy (multiple monetised components, total coin enough that the population-weighted mean M/T is a meaningful baseline)" — but the code checks only step≥5000 and M.size≥3; there is no coin-quantity condition at all. Concrete failures both ways: (a) a fast seed whose mining economy booms by step 3000 gets that whole silver boom silently absorbed INTO the baseline (REF locks high at 5000), permanently under-reporting its inflation; (b) a slow seed at step 5000 with three barely-monetised components locks a near-zero-coin REF, then reads spurious permanent "inflation" as it normally monetises over the next millennia. Since REF is forever (and, per the finding above, re-locked on every load), the arbitrary lock moment matters a lot.

**Fix:** Replace the step check with the emergent conditions the comment already describes: e.g. lock when total settlement coin exceeds a threshold proportional to total population (coin per capita — a real monetisation measure), and/or when the largest component's M and T both exceed floors. `world.step >= 5000` should be deleted.

### 48. urbanise's absolute 0.2-mover floor interacts with _dt: at SIM_GRANULARITY > 1 small villages stop migrating entirely — history changes with G
`src/sim/peopleSim/settlement.js:1089` · **MEDIUM** · Determinism · verdict: **CONFIRMED** · found by `settlement`

movers is granularity-scaled (`s.people * MIGRATE_RATE * gap * refuge * _dt`, capped by `s.people * MIGRATE_DRAIN_CAP * refuge * _dt`) but then discarded against a FIXED absolute threshold: `if (movers < 0.2) continue;`. index.js's granularity contract (index.js:156-164) says "the SAME emergent history unfolds over G× more ticks". Concrete: a 30-person village with a 90-person hub (gap 3): movers = 30·0.004·3·_dt = 0.36·_dt. At G=1 it sheds 0.36/tick; at G=2 movers = 0.18 < 0.2 EVERY tick, so it never migrates at all — not slower, zero. Since MIGRATE_MIN_POP is 25, the whole 25-to-~50-pop band of villages (most of a young map) silently loses rural→urban drift as G rises, changing which hubs ever become cities. This is a G-dependent content change, not just smoothing.

> **Verifier correction:** All as claimed, with two minor refinements: the floor is at settlement.js line 1090 (not 1089), and the zero-migration condition is best expressed via the hub: because movers = s.people·0.004·(best.people/s.people)·_dt = 0.004·best.people·_dt when gap is under the ×6 cap, peacetime drift is silently zeroed for any village whose regional hub has fewer than ~50·G people (also modulated by refuge/unrest), rather than strictly by the village's own 25-50 pop band. Proposed fixes (scale floor by _dt, or accumulate fractional movers) are both sound; the _dt-scaled floor is the minimal G=1-byte-identical change.

**Fix:** Scale the floor with _dt (`if (movers < 0.2 * _dt) continue;`) or accumulate fractional movers on the settlement (`s._migAcc += movers; move when ≥ 0.2`) so the same history-rate flows at any granularity.

### 49. Per-tile soil fatigue (world._soilFatigue) is not persisted — 'the land remembers' forgets on every load
`src/sim/persist.js:118` · **MEDIUM** · Save/load · verdict: **CONFIRMED** · found by `settlement` (also `persistence-workers`)

updateSoil (settlement.js:1664-1708) maintains `world._soilFatigue` (Float32Array(N)) as cumulative per-TILE state, with the comment "The LAND remembers (the field is keyed to the tile, not the settlement), so a region that wrecked its soil stays poor even as settlements come and go" — it drives `soilBurden` on land food (settlement.js:1853) and T.SOIL_EXHAUST defaults to 0.5 (active). saveWorld serialises roadQuality/roadFlow/countryClaim/countryOwner/territoryOwner/capturedAt as typed arrays (persist.js:118-123) but not `_soilFatigue`, and the per-settlement catchment-mean cache `s._soilFatigue` is also not in SETT_FIELDS (that one is rebuilt at the next SOIL_INTERVAL pass, but the tile field it's rebuilt FROM starts pristine). Concrete failure: a millennia-old salinised cradle (fatigue ≈ 0.8, land food ×0.6) is saved and reloaded → the entire map is pristine, the exhausted cradle blooms again, and the emergent centre-of-gravity shift the system exists to produce is undone. Run-vs-save/load histories diverge structurally.

**Fix:** Serialise `world._soilFatigue` alongside the other typed arrays in saveWorld/loadWorld (b64FromTyped/typedFromB64, Float32Array), and treat a missing field as zeros for old saves.

### 50. _claimPress and _cBudgetRamp are unserialised state feeding serialised sim-relevant maps — resume diverges from a straight run
`src/sim/peopleSim/countryClaim.js:187` · **MEDIUM** · Save/load · verdict: **CONFIRMED** · found by `territory-identity`

persist.js does save `_countryClaim` and `_countryOwner`, correctly treating them as state. But two of their upstream integrators are not saved: (1) `world._claimPress` (countryClaim.js:186-187) — the per-tile breakthrough pressure the crawl accumulates against ELEV/NOISE resistance; on load it re-zeros, so front tiles that were 1 tick from flipping wait a full resistance cycle again, `_countryClaim` diverges, and since `grownOwnerAt` drives adoptAndFound (which country a village JOINS) and crystallize's spawn nationality, this is sim-visible divergence, not render noise. (2) `world._cBudgetRamp` (countryTerritory.js:389-398) — the eased per-country reach budget; on load `ramp.get(c)` is undefined for every realm, so line 394 restarts every country at `min(target, COUNTRY_REACH_BASE * resScale)` (reach 4·resScale) and re-earns full reach over ~1/BUDGET_RAMP ≈ 17 territory passes: the whole political map's frontier-projection collapses to near-capital blobs on resume (persistence cushions the marches, but fresh expansion and the contest of overlapping reaches both change). `_claimSnap` and `_inheritReach` (one-shot event flags from conquest.js) are likewise lost, dropping any pending instantaneous-secession paint. These are concrete, attributable causes of the acknowledged resume≠straight failure the spec calls "pre-existing unserialized scratch".

> **Verifier correction:** All four fields verified unserialized and sim-feeding as claimed. Two softeners: (1) persist.js's own header (lines 9-15) documents re-warmed transients as accepted design ("the same world mid-breath, not a frame-exact clone"), so this is a known, documented gap rather than an unnoticed regression; (2) the `_cBudgetRamp` reach collapse is cushioned when PERSISTENT_TERRITORY is on, since the reach-Voronoi is layered over the saved `_countryOwner` (countryTerritory.js:290-301) — already-held land is kept and only fresh expansion/contested overlap diverges, which the finding itself acknowledges.

**Fix:** Serialise `_claimPress` (Float32Array) and `_cBudgetRamp` (small Map<int,float> — trivially JSON-able) alongside the maps persist.js already ships; flush or serialise `_claimSnap`/`_inheritReach` at save time. Then the save/load identity test can actually gate this subsystem instead of being permanently red.

### 51. s._credit is not in SETT_FIELDS — with the credit system enabled, every save/load cycle re-mints credit on top of credit-inflated wealth
`src/sim/persist.js:28` · **MEDIUM** · Save/load · verdict: **CONFIRMED** · found by `economy`

The credit ledger (settlement.js:566-573) tracks minted credit separately from specie precisely so contraction is bounded: `const base = Math.max(0, (s.wealth || 0) - cur)` treats only wealth-minus-credit as specie backing. `_credit` is not in SETT_FIELDS (persist.js:28-44), whose own comment says "new fields that carry real cross-tick state belong HERE". Concrete failure (requires T.CREDIT_RATE > 0 — the lever is experimental, default 0): a banking hub with wealth 300 of which _credit=150 is saved; on load `_credit` is undefined, so next tick `cur=0, base=300` — the old credit now counts as specie backing — and delta re-mints toward (CREDIT_MAX_MULT−1)×300 of NEW credit. Each save/load cycle compounds the money supply, violating the closed-supply claim (README: "closed supply: mining faucet, wear drain, conservation in trade") through the persistence boundary rather than through any tick arithmetic.

> **Verifier correction:** Minor timing nuance only: on load _tradeReach is nulled (persist.js:183), so reachF=0 and no minting occurs until the road-plan pass rebuilds trade reach; the re-mint then proceeds as described for any hub with org>0.45 and trade links.

**Fix:** Add "_credit" to SETT_FIELDS. One-line fix; save-safe since missing fields load as undefined for old saves.

### 52. selectElected can elect a person who is already the sitting ruler of another realm
`src/sim/peopleSim/dynasties.js:541` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `identity-culture`

Candidate filter is only `if (!p || p.died >= 0 || ageOf(world, p) < 30) continue; if (!womenOk && p.female) continue;` over EVERY dynasty with `d.cultureId === polity.cultureId` — there is no check that the candidate is not currently on a throne. Every self-made consul founds a house in crown() (`const newHouse = person.dynastyId < 0; if (newHouse) newDynasty(...)`), so all sitting rulers everywhere have dynastyId ≥ 0 and appear on rosters. Cultures span many realms, so a republic of culture X can elect the reigning 42-year-old KING of a neighbouring monarchy of culture X (prime-age weight ~11 vs 4 for a fresh notable). crown() then sets `polity.rulerId = person.id` in the republic while the monarchy's `polity.rulerId` still points at the same person, and `person.reignFrom = stepToYear(world.step) | 0` clobbers the still-open reign record of the monarchy. Both realms now read the same traits, both roll entries share one id, the monarchy's `rulers` roll gets a wrong toY stamped by the republic's next crown, and on his death both realms fire succession logic. heirByLaw's last-resort roster pool has the same hole (a cadet elected consul abroad can also be crowned at home).

**Fix:** Build a set of currently-reigning person ids (one scan over world.countries/polities at pass start, or reuse the loop that builds _royalCourt) and exclude them in selectElected's filter and in heirByLaw's last-resort pool.

### 53. normalizeMix tail-fold redirects assimilation increments INTO the local dominant when a mixture is full
`src/sim/peopleSim/cultures.js:228` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `identity-culture`

When a push takes a mix past MIX_K=4, normalizeMix folds the smallest entries into the dominant: `mix.length = MIX_K; mix[0][1] += tail;`. mixToward/mixLangToward first scale everything by (1-frac) then push `[cid, frac]` — so when the NEW entry is the smallest of 5 (assimilation increments are tiny: language ≤ ~0.07/pass, culture ≤ ASSIM_RATE*CULTURE_LAG*1.4 ≈ 0.007/pass), the state's own increment is deleted and handed to the LOCAL dominant. Concrete: a border town with langMix [[A .4],[B .3],[C .2],[D .1]] conquered by a realm with prestige tongue E — each pass mixLangToward(s,E,0.07) scales A–D down 7%, pushes [E,.07], sorts, folds E into A. The state's Latinization pressure strengthens the local tongue instead, for ~4 passes until D decays below the increment; for the culture layer (frac ≈ 0.007 vs tails ~0.05) the perverse redirection persists for hundreds of passes, and since culture assimilation is itself gated on langShare and on `dominantCulture(s) !== stateCul`, downstream mechanics (political ethnogenesis needs langShare ≥ 0.5) stall in exactly the contested multi-ethnic provinces where they matter most. Deterministic, silent, and self-defeating — the mechanism does the opposite of its intent at the mixture cap.

**Fix:** In mixToward/mixLangToward, when length exceeds MIX_K drop the smallest entry that is NOT the just-added target (or fold the tail proportionally into all survivors), so an incoming increment always survives at the expense of the true smallest incumbent.

### 54. reapHouse roster truncation strands living royals off-roster — immortal, never reaped, still crownable
`src/sim/peopleSim/dynasties.js:661` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `identity-culture`

`dyn.members = keep.length <= MAX_HOUSE ? keep : keep.slice(0, MAX_HOUSE);` silently drops the last-enrolled living members when the roster exceeds 28. The roster CAN exceed 28: growCadets checks the cap, but the monarch's births in the main loop (line 871–882) gate only on MAX_CHILDREN, and birth() → enroll() pushes unconditionally — so at a full roster, the royal newborn is enrolled to slot 29 and sliced off next reap (keep preserves enrollment order, oldest first). The dropped person remains alive in world.persons: reapHouse and reapIdleHouses are roster-driven, so they are NEVER lifespan-reaped; prunePersons only deletes `died >= 0`. But they remain in `ruler.children`, so heirByLaw's line search (which walks children arrays, not the roster) can still find them — `eligible` only checks `died < 0` — and crown a 200-dyn-year-old 'heir' decades later, who then dies the same pass (`rAge >= ruler.lifespan` in the main loop). Meanwhile houseHasAdultHeir (roster-based) doesn't see them, skewing legitimacy, and getDynastyTree (which scans persons by dynastyId) renders an impossibly ancient living member.

**Fix:** Don't truncate living members out of existence: either skip the birth when the roster is full (mirror growCadets' guard in the royal-birth and bastard paths), or reap overdue persons by lifespan regardless of roster membership (e.g. check `ageOf >= lifespan` in eligible/heirByLaw and in a periodic sweep over persons).

### 55. opts.silent on ensurePolity's re-open path silently resurrects ended polities, suppressing polity.restored and producing duplicate/mis-attributed polity.ended events
`src/sim/peopleSim/entities.js:40` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `narrative`

ensurePolity's re-open branch (`if (p.endedStep >= 0) { p.endedStep = -1; if (!opts.silent) logEvent(world, "polity.restored", ...) }`) resets the lifecycle without logging when called silently. Two concrete failures. (1) Restoration suppression: when a dissolved realm's id reappears in the country build, personality.js:172 (silent) runs during the build — BEFORE reconcilePolities at the end of updatePolities — so it flips endedStep to -1 first; reconcile's line 107 (`if (p.endedStep >= 0) ensurePolity(world, id)`) then sees a live record and the non-silent polity.restored never fires. The only restorations that ever log are the explicit homeland path (conquest.js:831). Probe: 1 restored event total while endedStep flapping clearly occurred (10 ended events over 7 ids — ids ended twice). (2) Double-ending: fragmentRealm (armies.js:913, runs on the every-tick conquest cadence) calls endPolity(oldId, "conquest") mid-cycle while world.countries still holds the stale old country until the next updatePolities rebuild. chronicleTick (index.js:293, `world.step % CHRONICLE_INTERVAL` — NOT wrapped in _ivl, unlike the polity pass at index.js:267 `_ivl(T.POLITY_INTERVAL)`) iterates that stale map and its silent ensurePolity resurrects the conquered polity (endedStep=-1, no event); the next reconcile then ends it AGAIN as "dissolved" — the record's endedStep moves later and the chronicle s

**Fix:** Silent calls must never re-open a closed record: in the re-open branch, if opts.silent, return the record WITHOUT touching endedStep (or log the restoration anyway — a re-opened lifecycle is a story moment by definition). Separately, wrap CHRONICLE_INTERVAL in _ivl so the chronicle tick stays aligned with the polity pass, and have chronicleTick skip countries whose polity record is ended.

### 56. Three logged event types have no NARRATE entry — chronicle panel and exports render the raw type string ("plague.virginSoil")
`src/sim/peopleSim/events.js:242` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `narrative`

narrate() falls back to `ev.type` when no template exists (`return fn ? fn(ev, as) : ev.type`). Three live event types are missing from the NARRATE table: "plague.virginSoil" (shocks.js:127), "colony.founded" (conquest.js:1581) and "colony.independent" (conquest.js:1622). All three flow into getChronicle/perspectiveChronicle/exportHistory. Empirically confirmed: a 6000-step run produced a plague.virginSoil event whose narration is the literal string "plague.virginSoil". categoryOf also lacks cases for them, so all three default to "growth" — a virgin-soil plague is colored as growth, and a colony's founding/independence (arguably the two most story-rich colonial moments) are unreadable in every view.

**Fix:** Add NARRATE templates for the three types (e.g. plague.virginSoil: "A pestilence out of the old world swept the unexposed peoples around ${sName}"; colony.founded: as-viewed-from metropole vs colony; colony.independent likewise) and categoryOf entries (plague.virginSoil → "plague", colony.founded → "founding", colony.independent → as===ev.from ? "loss" : "founding"). Consider a dev-mode assert in logEvent that the type has a narrator.

### 57. Virgin-soil sweep uses the source's load (`sl`) instead of the low-immunity party's — strikes immune populations, including the disease source itself
`src/sim/peopleSim/shocks.js:120` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `war-shocks`

In contactEpidemic the low/high parties are resolved per pair: `const lo = sl <= (p._diseaseLoad||0) ? s : p, hi = lo === s ? p : s`, so when the CURRENT settlement `s` is the high-immunity side, `lo === p`. But the population sweep still filters with the source's load: `if ((n._diseaseLoad || 0) >= sl + CONTACT_GAP) continue;  // only the unexposed pool`, where `sl = s._diseaseLoad`. When `s` is the high side, `sl` is large (≈0.9), so `sl + CONTACT_GAP ≈ 1.25` > the max possible load (1), the filter never fires, and EVERY settlement within VIRGIN_RADIUS of `lo` is swept — regardless of immunity. Concrete trace: Old-World port `s` (load 0.9) has a sea lane to New-World port `p` (load 0.1). lo=p, hi=s, gap 0.8 ≥ CONTACT_GAP so it proceeds. The inner loop iterates all settlements incl. `s` itself: `n=s` has load 0.9, `0.9 >= 0.9+0.35`? no, so it is NOT skipped; if `s` is within VIRGIN_RADIUS (22 tiles) of `p` — plausible for two sea-adjacent ports across a strait — then `s._contacted=true; s._virginUntil=…; infect(world,s)`, giving the fully-immune Old-World disease SOURCE a 6× (VIRGIN_MORT) virgin-soil epidemic. This inverts the Columbian mechanic (the connected, high-immunity world is supposed to be the one that is spared). It misfires roughly whenever the high-immunity node is the outer-loop `s`, which happens for every high→low sea link.

**Fix:** Filter against the low-immunity party's load, not the source's: `if ((n._diseaseLoad || 0) >= (lo._diseaseLoad || 0) + CONTACT_GAP) continue;` (and optionally `if (n === hi) continue;` to be explicit that the high-immunity contact node is never swept).

### 58. applyTuning does not clamp to schema min/max — TERRITORY_INTERVAL=0 permanently disables the territory pass
`src/sim/peopleSim/tuning.js:518` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `core-loop`

applyTuning claims 'a malformed message can never poison the sim' but only checks the key exists and the value is a finite number: `if (!(k in DEFAULTS)) continue; const v = Number(overrides[k]); if (Number.isFinite(v)) T[k] = v;`. Schema min/max are never enforced (the UI slider respects them; the worker-message API does not). Failure scenario: `applyTuning({ TERRITORY_INTERVAL: 0 })` (schema min is 24) sets T.TERRITORY_INTERVAL = 0; index.js line 201 consumes it raw — `world.step % T.TERRITORY_INTERVAL === 0` — and `n % 0` is NaN, which never equals 0, so computeTerritory/computeCountryTerritory/adoptAndFound/nucleateFrontierStates never run again for the rest of the session: borders, catchments and state formation silently freeze. A negative value does the same (step % −5 is 0 only every 5 steps for negatives — actually periodic, but 0 is the hard kill). Note the contrast: the _ivl() wrapper (line 167) defensively floors at 1, so CONQUEST/POLITY/MUSTER survive a 0, but TERRITORY_INTERVAL, TRADE_STRIDE and other raw-modulo consumers do not.

**Fix:** In applyTuning, clamp accepted values to the schema's [min, max] (the schema is right there — build a RANGE map alongside DEFAULTS). Defensively, also floor raw interval consumers in index.js: `world.step % Math.max(1, T.TERRITORY_INTERVAL) === 0`.

### 59. Inflation baseline world._inflRef (and _inflP) not saved — loading recalibrates prices and erases all accumulated inflation
`src/sim/persist.js:126` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `persistence-workers`

inflation.js:82-93 calibrates REF once — "Stored on world._inflRef and used forever after — the whole point is that *changes* from this baseline are what inflation/deflation report" — via `if (world._inflRef === undefined && world.step >= 5000 && M.size >= 3) { ... world._inflRef = totalM / totalT; }`. persist.js saves `_inflRaw` (the display EMA) but neither `_inflRef` nor `_inflP` (the sim-facing price EMA). Failure scenario: a late world with heavy silver mining sits at raw M/T = 6× the original baseline (real inflation). Save, load: `_inflRef` is undefined, step >= 5000, so the very next INFLATION_INTERVAL pass recalibrates REF to the CURRENT (inflated) M/T — `raw = (m/t)/REF` becomes ~1 for every component, `_inflP` (also empty; localP falls back to P=1 in the meantime) re-seeds at ~1, and the saved `_inflRaw` EMAs decay toward 1. All wage/food/building-cost price scaling and the wheat-price ticker snap back to baseline — a century of monetary history silently annulled by pressing Load.

**Fix:** Persist `world._inflRef` (a single number, undefined-safe) and `_inflP` (mapToArr like _inflRaw) in the tables block, and restore them in loadWorld before any tick runs.

### 60. Country reach ramp world._cBudgetRamp not saved — every empire's claim budget collapses to base reach on load and re-ramps
`src/sim/persist.js:126` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `persistence-workers`

countryTerritory.js:389-398: `let ramp = world._cBudgetRamp; if (!ramp) ramp = world._cBudgetRamp = new Map(); ... const next = prev === undefined ? ((inherit && inherit.has(c)) ? target : Math.min(target, COUNTRY_REACH_BASE * resScale)) : prev + (target - prev) * BUDGET_RAMP;` — the eased per-country reach is a cross-pass integrator (that is its entire purpose: territory "grows in gradually instead of snapping"). It is not persisted, and `_inheritReach` (the secession exemption) is also transient. Failure scenario: save a world with a continental empire whose ramp has climbed to its full tech target; load; on the first country-claim pass `prev === undefined` for every realm, so each re-seeds at `min(target, COUNTRY_REACH_BASE)` — the empire's projected claim retracts toward its base radius (the loaded `_countryClaim` render map is overwritten by the recomputed one), then re-grows over many passes. Borders visibly implode and re-expand after every load; land beyond the collapsed reach can be re-contested in ways an uninterrupted run never sees. Same class: `world._countrySeedBud` (per-tile seed budget) is also reset.

**Fix:** Persist `_cBudgetRamp` as mapToArr in tables and restore it in loadWorld (alternatively, on load seed the ramp from each country's current claimed extent — but saving the Map is simpler and exact).

### 61. Peace treaties (world._truces) not saved — every truce is void after load and wars immediately re-open
`src/sim/persist.js:126` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `persistence-workers`

armies.js:377 `let truces = world._truces; if (!truces) truces = world._truces = new Map();` — a Map of "a:b" → until-step, written when a war exhausts either side and honoured by `inTruce()` when opening fronts. Default T.TRUCE_TICKS = 1500 (tuning.js:161), so this is generation-scale cross-tick state, not a per-pass cache — the doc comment above it says the whole point is that "neither can open a front on the other until it lapses". It is absent from saveWorld's tables (which do save _warExhaust and _manpower). Failure scenario: two great powers sign a 1500-tick peace at step 20000; save at 20100; load; `world._truces` is a fresh empty Map, `inTruce()` returns false for every pair, and the next advanceFronts pass (within T.CONQUEST_INTERVAL ticks) re-opens the war 1400 ticks early — the loaded history diverges into an extra war the uninterrupted run never had.

**Fix:** Add `truces: mapToArr(world._truces)` to the tables block and `world._truces = arrToMap(t.truces)` in loadWorld (keys are strings, values step numbers — JSON-safe).

### 62. Load path takes genMeta (tecParams) from the main thread instead of the save's own meta — re-saves can be stamped with the wrong terrain params and the rendered map can mismatch the sim map
`src/peopleSimWorker.js:172` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `persistence-workers`

On 'load' the worker does `if (m.genMeta) genMeta = m.genMeta;` and later 'save' writes `serializeWorld(world, genMeta)` — so the re-saved file's `meta.tecParams`/`meta.oceanLevel` come from the MAIN THREAD's current UI state, not from the file being loaded. The file-open handler (WorldSim.jsx:3796-3802) restores `preset` and `oceanLevel` from `meta` but never restores `tecParams`: `_gm = { oceanLevel: oceanLevelRef.current, tecParams: _tecParams }` (WorldSim.jsx:970) uses whatever the tectonic-parameter editor currently holds (mutable via WorldSim.jsx:4066). Failure scenario: user saves a world generated with custom tectonic params; opens a fresh session (default `_tecParams`); loads the file. (a) The main thread regenerates its render terrain with DEFAULT tecParams while the worker's loadWorld rebuilds sim terrain from the file's meta.tecParams (persist.js:150) — settlements sit on a map that doesn't match the terrain being drawn. (b) Pressing Save now writes `meta.tecParams = {}`; the NEXT load of that file deterministically rebuilds the WRONG terrain under the saved dynamic state — permanent corruption of the save lineage.

**Fix:** In the worker's 'load' handler, derive genMeta from the file itself (parse once: `const data = JSON.parse(m.json); genMeta = { oceanLevel: data.meta.oceanLevel, tecParams: data.meta.tecParams }; world = loadWorld(data);`). On the main thread, restore `_tecParams` (and W/H if they ever become variable) from `meta` before calling generate().

### 63. Base cache key omits preset/world identity and is never cleared on world regeneration — stale terrain across worlds with equal (or undefined) _seed
`src/WorldSim.jsx:1409` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `ui-render`

_baseKey is `vm+'|'+(w._seed)+'|'+CH+'|'+toggles…` — no preset, no world identity. finalizeWorld (line 987) clears terrainCache/atlasCache/imgRef but NOT baseLayerRef/baseLayerKey. Two concrete failures: (a) Imports: rasterizeAzgaar/rasterizeHeightmap never set `_seed` (verified — no `_seed` in src/mapImport.js), so every imported world contributes the literal 'undefined' to the key; import heightmap A, view Terrain, then import heightmap B → identical key → line 1411 cache-hits and displays world A's terrain over world B. (b) Load a save whose meta.seed equals the current seed but whose preset differs (load path line 3801: `if(meta.seed===seed)generate(seed)`): the regenerated world has the same _seed, same key → the previous world's raster is shown.

**Fix:** Include `w.preset` (and a per-world nonce) in _baseKey, and null out `baseLayerKey.current` in finalizeWorld alongside the other cache clears.

### 64. Worldgen tuning / preset changes that keep the same seed blit a stale cached base raster — the map visibly never updates
`src/WorldSim.jsx:987` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `ui-state`

finalizeWorld resets `terrainCache.current=null;atlasCache.current=null;imgRef.current=null;` but NOT `baseLayerKey.current`/`baseLayerRef`. draw()'s cache key (line 1409) is `vm+'|'+(w._seed)+'|'+CH+'|'+toggles+'|'+oceanLevel...` — it includes the seed but not `_tecParams`. Failure scenario: open the Tuning modal (or the New World tectonic-preset dropdown, or the real-wind checkbox); `onParamsChange={(p)=>{_tecParams=p;...generate(seed);}}` (line 4184) regenerates the world with the SAME seed → `w._seed` unchanged → `_baseKey` identical → `if(_staticBase&&ctx&&baseLayerRef.current...&&baseLayerKey.current===_baseKey){ctx.drawImage(baseLayerRef.current,0,0);_baseHit=true;}` blits the OLD world's terrain forever (the nulled terrainCache is never consulted because `_baseHit` skips the rebuild). Every slider drag in the Worldgen tuning panel appears to do nothing on all BASE_CACHE_VIEWS (terrain, atlas, wind, moisture, temperature, crop, ...). Same failure for importing two maps in a row: imported worlds have `w._seed === undefined`, so the second import's key equals the first's and the first map keeps rendering.

**Fix:** In finalizeWorld, also set `baseLayerKey.current=null` (one line next to the other cache resets). Optionally fold a world-generation counter into `_baseKey` instead of relying on `_seed`.

### 65. Sticky pan: releasing a drag outside the canvas leaves panDragRef armed, so the map pans with no button held on re-entry
`src/WorldSim.jsx:847` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `ui-state`

The window-level cleanup only clears UNMOVED drags: `const up=()=>{if(panDragRef.current&&!panDragRef.current.moved)panDragRef.current=null;};` (line 847). Failure scenario: mousedown on the canvas, drag past the 3px threshold (`pd.moved=true`, map pans), continue off the canvas edge, release the button outside → window mouseup fires but `pd.moved` is true so the ref is NOT cleared; no click fires on the canvas (mouseup was elsewhere) so onCanvasClick's `panDragRef.current=null` (line 2669) never runs. Now move the mouse back over the canvas with no buttons pressed: onCanvasMove's first branch `if(panDragRef.current){...viewXRef.current=pd.vx+dx*...;draw(...);return;}` (lines 2606-2614) treats every hover as an active pan — the map lurches to track the cursor until the user clicks (mousedown replaces the stale ref). The comment above the handler describes exactly this hazard but the moved-guard inverts the fix: preserving the moved entry serves no purpose because a canvas click event cannot fire after an off-canvas release.

**Fix:** In the window mouseup handler, always clear panDragRef (`panDragRef.current=null`). Click suppression is unaffected: when release happens ON the canvas the click event fires before... actually mouseup precedes click, so instead set a one-shot `suppressNextClickRef` when moved===true and consume it in onCanvasClick.

### 66. While paused, on-demand snapshots mutate the mirror but usually trigger no React re-render — dynasty tree, chronicle-perspective toggle, and realm chronicles appear dead/stale
`src/WorldSim.jsx:2479` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `ui-state`

applySnapshot's only render triggers are `setLiveStep(snap.step)` (line 2443 — a no-op while paused because the step hasn't changed, so React bails out) and `if(psw._snapN%6===1){if(snap.stats)setPsStats(snap.stats);}` (line 2479 — fires on 1 of every 6 snapshots). While playing this is fine (30 snapshots/s). While PAUSED the worker only sends one snapshot per request (peopleSimWorker.js: `if(!playing&&world)buildSnapshot()` on select/selectRealm/chronicle-mode/dynasty-open), so ~5/6 of those responses update `peopleRef.current._dynasty/_chronicle/...` without any re-render. Concrete failures, all with the sim paused: (1) open the 🌳 dynasty overlay — the worker ships the tree, but DynastyOverlay was mounted with `tree=null` and keeps showing "No reigning house — the realm keeps no king-list yet" until something else re-renders; (2) in the ChronicleOverlay click "true record"/"scribes' version" — `onTogglePerspective` only posts to the worker (line 4075-4078), sets no state, and the returned chronicle lands in the ref invisibly, so the button appears broken; (3) open a different realm's chronicle from the Realms tab — the overlay renders the PREVIOUS realm's `_chronicle` and never swaps.

**Fix:** Add a cheap render tick to applySnapshot for paused one-shot data, e.g. bump a `snapVersion` state whenever `snap.selected!==undefined || snap.chronicle!==undefined || snap.dynasty!==undefined` (or simply always `setLiveStep` alongside a monotonically-increasing snapshot counter state).

### 67. Sim-crash paths desynchronize the play button from the actual run state; fallback crash inverts Space toggling permanently
`src/WorldSim.jsx:2540` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `ui-state`

Two paths stop the simulation without updating React's `playing` state. (1) Worker mode: on a step exception the worker posts {type:'error'} and sets its internal `playing=false` (peopleSimWorker.js:242); the main-thread handler only does `console.error('[SimWorker]',d.message,d.stack)` (line 949) — the header keeps showing ❚❚ and the step counter silently freezes with no user-visible signal. (2) Main-thread fallback: `catch(e){console.error('[PEOPLESIM CRASH]',...);playRef.current=false;return;}` (line 2540) clears the ref but not the state. Now `togglePlay=()=>{playRef.current=!playRef.current;setPlaying(p=>!p);}` (line 2567) flips both independently: after the crash playRef=false/playing=true; pressing Space gives playRef=true (rAF loop steps again!) while playing=false (button shows ▶) — the two are inverted for the rest of the session, so the button permanently displays the opposite of reality. Same latent inversion in the DRAW CRASH catch at line 2551.

**Fix:** Make crash paths call `setPlaying(false)` (fallback) and handle worker 'error' by `setPlaying(false); playRef.current=false;` plus a visible toast. Better: derive playRef from playing in an effect instead of maintaining two sources of truth in togglePlay.

### 68. erodeDropsPerPixel has two different code defaults (1.5 gate vs 1.0 count), so the editor's shown default is wrong
`src/sim/tectonicGen.js:948` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `ui-shell`

paramDefs.js:141 declares `def: 1.5` and its own header states the contract: 'def values MUST match the code defaults … a mismatch means touching a slider at its shown default silently changes the world'. tectonicGen.js reads the key twice with DIFFERENT defaults: line 932 `if (p('erodeDropsPerPixel', 1.5) > 0)` (the on/off gate) but line 948 `const dropCount = Math.round(eN * p('erodeDropsPerPixel', 1.0));` (the actual drop count). A pristine world (param absent) therefore erodes with 1.0 drops/pixel while the TuningPanel slider displays 1.5. Failure scenario: user opens the tectonic tuning panel, wiggles the Rain Density slider and puts it back on its displayed value 1.5 → the regenerated world has 50% more erosion drops than the world they were looking at, with no other param changed — exactly the silent divergence the file warns about. Verified by a systematic diff of all p('key', default) reads in tectonicGen/windSolver/moistureSolver against paramDefs defs; this is the only mismatch.

**Fix:** Hoist one read: `const _drops = p('erodeDropsPerPixel', 1.5);` and use it for both the gate and dropCount (line 948 currently says 1.0 — make it 1.5 to match the editor and the gate).

### 69. Globe texture missing colorSpace tag on three r183 — colors render washed out, then get patched with a saturation hack
`src/GlobeView.jsx:40` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `ui-shell`

three is ^0.183.2 (node_modules confirms 0.183.2). Since r152, WebGLRenderer.outputColorSpace defaults to SRGBColorSpace, and Texture's default is `colorSpace = NoColorSpace` (verified in node_modules/three/src/textures/Texture.js). The CanvasTexture at line 40 (and specTexture at 51) are never tagged, so the canvas's sRGB pixel values are sampled as if linear and then re-encoded linear→sRGB on output — everything on the globe comes out visibly brighter/paler than the flat map it was copied from. The code then compensates for the symptom: lines 196-208 run an 8.4M-pixel per-update loop boosting saturation ×1.1 and contrast ×1.05, with the comment 'lighting washes out flat colors' — misattributing a color-management bug to lighting (an ironic small-scale violation of the project's fix-the-mechanism rule). Failure scenario: open the 🌍 globe next to the flat map — terrain hues don't match; deserts and ice trend toward white.

**Fix:** Import SRGBColorSpace and set `texture.colorSpace = SRGBColorSpace;` after creating the map CanvasTexture (leave specTexture as non-color data). Then delete or greatly reduce the saturation/contrast compensation loop.

### 70. GlobeView leaks a WebGL context per 🌍 toggle — repeated toggling can kill the live globe
`src/GlobeView.jsx:177` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `ui-shell`

GlobeView is conditionally mounted (`{showGlobe? <GlobeView .../> : <canvas .../>}` at WorldSim.jsx:3845), so every toggle unmounts and remounts it, creating a brand-new `WebGLRenderer` (line 27) and thus a new WebGL context. The cleanup (lines 170-185) disposes geometries/materials/textures and calls `renderer.dispose()`, but dispose() does NOT release the underlying context — that only happens on GC of the canvas or an explicit forceContextLoss(). Browsers cap live WebGL contexts per page (~16 in Chrome); when exceeded they evict the OLDEST, logging 'WARNING: Too many active WebGL contexts. Oldest context will be lost.' Failure scenario: a user flips between map and globe ~16 times in a session (plausible over a long sim run) before GC collects the orphaned canvases → the browser starts losing contexts; depending on eviction order the CURRENTLY VISIBLE globe's context can be reclaimed, leaving a black square until remount.

**Fix:** Add `renderer.forceContextLoss();` (and null out renderer.domElement) in the cleanup after renderer.dispose() — or keep one persistent GlobeView instance and hide it with CSS instead of unmounting.

### 71. Azgaar import can freeze the tab (per-pixel brute-force fallback) or crash on out-of-assumed-range cell coordinates
`src/mapImport.js:97` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `ui-shell`

rasterizeAzgaar assumes cell coordinates span mapW×mapH, where mapW falls back to `data.info?.width || data.settings?.mapWidth || 960` (line 29). Two failure modes when that assumption is wrong (older/trimmed exports without `info`, or re-exported JSON): (1) Bucket fill (lines 77-78) clamps only the HIGH side — `Math.min(bw-1, Math.floor(cx[i]/scaleX/BUCKET))` — so a negative coordinate (Azgaar jitter can place points fractionally <0) yields a negative bucket index and `buckets[by*bw+bx].push(i)` throws `TypeError: Cannot read properties of undefined (reading 'push')`, aborting the whole import with a cryptic message. (2) If the real map is larger than the assumed 960×560, all cells clamp into the right/bottom edge buckets; for most of the 1920×960 output pixels the 3×3 bucket search finds nothing and `if (best < 0)` triggers the brute-force loop over ALL n cells (lines 97-104) — W×H×n ≈ 1920×960×10,000 = 1.8e10 distance computations, synchronously in handleImport (WorldSim.jsx:2574) on the main thread → the tab freezes for minutes with 'Loading...' shown.

**Fix:** Clamp bucket indices on both sides (Math.max(0, …)); when info/settings dimensions are absent, derive mapW/mapH from max(cx)/max(cy); and replace the O(n) fallback with an expanding-ring bucket search (radius 2, 3, …) which is bounded.

### 72. Duration windows inconsistently scaled by world._dt — history changes shape when the SIM_GRANULARITY lever moves
`src/sim/peopleSim/conquest.js:1669` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `hunt-time-gates`

index.js (lines 156–167) defines the granularity contract: at G>1, per-tick clocks advance dt=1/G and 'the SAME emergent history unfolds over G× more ticks'. Many windows honor it (`WAR_MEMORY / (world._dt || 1)` armies.js:636, `TRUCE_TICKS / (world._dt||1)` armies.js:722, all plague/faith/culture cooldowns in shocks.js/faiths.js/cultures.js, the wither window settlement.js:2265, dark-age cutoff settlement.js:1514). But a whole family does NOT: HOMELAND_MEMORY (conquest.js:1669 `world.step - s._homelandFell > HOMELAND_MEMORY`, raw 6000), COLONY_SUPPLY_TICKS (conquest.js:1131,1639,1986,2033,2064), SIEGE_WINDOW (conquest.js:1809–1810), T.CONQUEST_GRACE (conquest.js:1130,1903,2253,armies.js:851 and more), the serfdom plague-scarcity window (conquest.js:1888 `world.step < (s._plagueUntil||0) + 2000` — raw 2000 next to shocks.js's dt-scaled PLAGUE_DUR), CONSCRIPT_WINDOW (armies.js:210), T.TILE_CAPTURE_GRACE (armies.js:529,590), COLONY_COOLDOWN (crystallize.js:768, sea.js:230), INTEGRATE_TICKS (countryTerritory.js:446). Also updateClimate: CLIMATE_INTERVAL is not stretched via _ivl (index.js:198) and its per-update WALK/VOLC_CHANCE are not dt-scaled, so at G=8 the climate random walk moves and volcanic winters erupt 8x more often per history-year. Failure scenario: user raises the 'Time granularity' lever (tuning.js:25, max 8): conquered peoples assimilate 8x faster in history-time, 

**Fix:** Sweep every `world.step - stamp < WINDOW` / `world.step + WINDOW` comparison and divide the window by (world._dt || 1), as the already-correct sites do; route CLIMATE_INTERVAL through _ivl() (its per-update constants then stay per-history-decade). A one-line helper `histTicks(world, n)` would make the convention hard to miss.

### 73. seedEarthHearths can plant two cradle hearths on the same tile (no dedup / min separation)
`src/sim/peopleSim/state.js:336` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `hunt-determinism`

Each Earth hearth independently searches its window for the best tile and founds a settlement there, with no check against previously chosen hearths: `for (const site of EARTH_HEARTH_SITES) { ... if (score > bestScore) { bestScore = score; bestTi = ti; } ... makeSettlement(world, bx + 0.5, by + 0.5, { people: 25, cradle: true })`. The Nile window (default r 0.04) and Mesopotamia window (r 0.02, centers 0.580 vs 0.622 in fx) overlap in x, so both can select the identical best tile. This is not hypothetical — the shipped smoke test (320×160, seed 4242) logs it on every run: `[peopleSim] Ekhii (Nile) at tile (95,28)` and `[peopleSim] Brerlint (Mesopotamia) at tile (95,28)` — two cradle civilizations stacked on the same tile, sharing one catchment, permanently co-located twin capitals. The algorithmic cradle path (seedCradleVillage) enforces CRADLE_MIN_SEP = 60; the Earth-hearth path enforces nothing.

**Fix:** Track picked tiles across the site loop and reject candidates within a minimum separation (or at least `bestTi` equality) of an earlier hearth, mirroring the CRADLE_MIN_SEP logic; skip a site whose whole window is exhausted.

### 74. Event-feed cursor breaks after event-log compaction (feed goes silent for tens of thousands of events)
`src/peopleSimWorker.js:377` · **MEDIUM** · Bug · verdict: **unverified-skipped** · found by `hunt-perf-memory`

The worker's incremental feed uses an absolute cursor: `if (evs.length > lastEvSent) { ... for (let i = Math.max(lastEvSent, evs.length - 40); ...) ...; lastEvSent = evs.length; }`. events.js compactEvents (events.js:43-48) fires at EVENT_CAP=200,000 and splices the log down to 150,000, reassigning ids. Failure scenario: a long run reaches 200k events with lastEvSent≈200,000 → compaction drops evs.length to ~150,000 → `evs.length > lastEvSent` is false and STAYS false until 50,000 more events accumulate (potentially 100k+ steps at ~0.4 ev/step), during which the live ticker and the click-to-jump feed show nothing new. The chronicle path survives (chronKey uses idx.length and reindexes), but the feed cursor was never taught about compaction.

**Fix:** Clamp the cursor whenever it exceeds the log: `if (lastEvSent > evs.length) lastEvSent = evs.length;` at the top of the feed block (or have compactEvents record a world._evCompactions counter the worker watches).

### 75. EARTH_HEARTH_SITES hard-codes named real-world cradles at pinned coordinates — in tension with README's "Nothing is scripted" and the second cardinal rule
`src/sim/peopleSim/state.js:322` · **MEDIUM** · Cardinal rule 2 (fitted outcome) · verdict: **unverified-skipped** · found by `docs-drift`

Found while verifying README line 5. state.js:322-336 defines `EARTH_HEARTH_SITES = [{ name: "Nile", fx: 0.580, fy: 0.329 }, { name: "Mesopotamia", ..., r: 0.02 }, { name: "Yellow River", fx: 0.811, fy: 0.305, r: 0.016 }]` — named regions with per-site search radii explicitly tightened so the cradle lands on the historically-correct river (comment: "the wide default drifted it ~7° NORTH... seeding 'China' in the steppe; this radius keeps it on the Central-Plain river"; commit 425441e is literally "Fix the China cradle: seat it on the Yellow River, not the northern steppe"). CLAUDE.md's second rule bans "named-region special cases" and "detecting the case you want to fix"; by its own test ("is this Egypt?") this is painting the effect — the emergent cradle scorer (cradleSurround/circumscription, same file) apparently placed cradles somewhere the owner disliked, and the answer was pinned rather than the mechanism fixed. Defensible reading: it is *initial-condition* seeding on the Earth preset only (like using the real heightmap), not a runtime mechanic — but then README's flagship claim "Nothing is scripted; every empire on the map is the output of local rules" (lines 7-8) and CLAUDE.md's framing overstate the purity, and no doc records this exception or its rationale.

**Fix:** Either (a) document the exception explicitly (README + a note in docs/) as "Earth preset seeds the historical hearths as initial conditions; all other presets use the emergent cradle scorer", or (b) treat the drift as a TRUE finding per CLAUDE.md — the cradle scorer mis-weights river-valley vs steppe sites — and fix the scoring mechanism so the pins can be removed.

### 76. Floodplain spawn oversampling is un-normalized importance sampling, and its companion spacing constant was tuned to hit a target settlement share (~45%)
`src/sim/peopleSim/crystallize.js:324` · **MEDIUM** · Cardinal rule 2 (fitted outcome) · verdict: **unverified-skipped** · found by `hunt-fitted-outcomes`

crystallize.js:324 draws 40% of sweep candidates straight from the floodplain tile list: `const ti = (nFlood && rng() < FLOOD_SAMPLE_FRAC) ? floodTiles[rng.int(nFlood)] : rng.int(N)`, but the acceptance probability at line 437 (`const p = quality * ...`) is never divided by the proposal density. With floodplain ≈1% of tiles, a flood tile is proposed ~(0.4·N)/(0.6·nFlood) ≈ 60-70x more often than any other tile, so its effective spawn RATE is inflated ~60x beyond what the quality mechanism (which already gives rivers a 6x multiplier and fert≈1 via tCrop) implies. The intent comment ('a thin ribbon is almost never hit by the uniform random sweep') misdiagnoses: uniform sampling hits a 1% ribbon with exactly 1% of candidates — proportional, not starved; the bias exists purely to make the valley fill faster/denser than the mechanism produces. The tell that this crossed into outcome-fitting is FLOOD_SPACING_MUL's own comment (line 37): x0.5 'gave ~55% of ALL settlements crowded onto the ~1% floodplain', so it was dialed to x0.75, 'pulling the floodplain share back to ~45%' — a constant tuned by watching an aggregate outcome share, exactly the 'constant with no independent physical meaning' tell. Commit 28315ce further sharpened the sampler toward the fertile ribbon.

**Fix:** Either (a) make it honest importance sampling: divide p by the relative proposal density for flood-drawn candidates (multiply p by (0.6·nFlood)/(0.4·N + 0.6·nFlood)-style correction), letting quality and spacing alone set density — if the Nile then fills too slowly, raise the MECHANISM (alluvial quality, spacing on irrigated land justified by village-density data) rather than the sampler; or (b) if the oversampling is kept as a deliberate coverage accelerant, bound its effect to the transient (e.g. only while the ribbon is below its spacing-implied saturation) and derive FLOOD_SPACING_MUL from a physical claim (irrigated-valley village spacing) instead of a share target.

### 77. SIM_GRANULARITY does not stretch the climate and soil cadences, so climate history and soil exhaustion run G× faster per unit of history
`src/sim/peopleSim/index.js:198` · **MEDIUM** · Cardinal rule 1 (time-gating) · verdict: **unverified-skipped** · found by `core-loop`

The granularity contract (tuning.js SIM_GRANULARITY desc, and the comment at index.js:156-164) is 'the SAME emergent history unfolds over G× more ticks': per-tick clocks scale by _dt, rate passes stretch their interval by _ivl(), recompute passes keep theirs. But `updateClimate` is gated at the FIXED `CLIMATE_INTERVAL` (line 198, no _ivl) and climate.js advances real state per call with no _dt: `idx += (rng()−0.5)*2*WALK − idx*REVERT` and `if (rng() < VOLC_CHANCE) shock += VOLC_MAG`. At G=4 that is 4× as many volcanic winters per millennium, epochs whose correlation time is 4× shorter in history-units, and ash that clears 4× faster — a materially different climate history, not the same one smoother. Likewise `updateSoil` is gated at fixed SOIL_INTERVAL (line 263) and settlement.js accrues `gain = T.SOIL_GAIN * fragility * intensity` per pass with no _dt — soil salinises (and recovers) G× faster per unit of history, changing when the cradle-decline centre-of-gravity shift fires. (Related, outside my files: sea.js COLONY_COOLDOWN is raw ticks and SEA_INTERVAL is unstretched, so colony expeditions also run ~G× per history unit; the SIM_GRANULARITY desc admits granary/construction/polity windows are unscaled but does not list climate/soil/sea.) These are per-history clocks, not recomputes, so the current classification is a time-scaling bug in the orchestrator.

**Fix:** Gate both as rate passes: `if (world.step === 1 || world.step % _ivl(CLIMATE_INTERVAL) === 0)` and `% _ivl(SOIL_INTERVAL)`; or keep the cadence and scale the per-pass increments (WALK, VOLC_CHANCE, VOLC_DECAY exponent, SOIL_GAIN, SOIL_RECOVER exponent) by world._dt. Also stretch sea.js's COLONY_COOLDOWN and SEA_INTERVAL, and update the SIM_GRANULARITY desc's known-limitations list.

### 78. Inflation baseline calibration is gated on world.step >= 5000 — the monetary reference is defined by WHEN, not WHAT
`src/sim/peopleSim/inflation.js:82` · **MEDIUM** · Cardinal rule 1 (time-gating) · verdict: **unverified-skipped** · found by `hunt-time-gates`

`if (world._inflRef === undefined && world.step >= 5000 && M.size >= 3)` locks the permanent reference M/T ratio (`world._inflRef`), and until it locks, `if (world._inflRef === undefined) return;` (line 98) disables ALL inflation effects on sim prices (localP()=1 feeds army wages, building costs, food prices). Two problems traced through the code: (a) before step 5000 no amount of monetary expansion registers — a world whose leading realm strikes rich silver mines at step 3000 experiences zero price response, purely because of the date; (b) the baseline itself is 'the economy as it happened to be at step ~5000', so a slow world locks a barely-monetised reference (everything after reads as inflation) while a fast world bakes an already-inflated coin stock into the baseline (real expansion reads as P=1). The M.size >= 3 condition is the emergent half of the gate; the step floor is the scripted half. Note also 5000 is raw ticks, not divided by world._dt, so at SIM_GRANULARITY=8 the baseline locks 8x earlier in history-time.

**Fix:** Replace the step floor with emergent conditions that mean 'the world has a real monetised economy': e.g. M.size >= 3 AND total coin above a per-capita threshold AND at least one realm practising the currency tech (techState already exposes this), or lock when the population-weighted M/T has been stable (low variance) over the last K passes. Any residual duration should be divided by (world._dt || 1).

### 79. Inflation baseline locks on `world.step >= 5000` — a wall-clock gate, which is also what makes the baseline unstable across save/load
`src/sim/peopleSim/inflation.js:82` · **MEDIUM** · Cardinal rule 1 (time-gating) · verdict: **unverified-skipped** · found by `hunt-save-load`

inflation.js:82: `if (world._inflRef === undefined && world.step >= 5000 && M.size >= 3)`. The M.size condition is emergent, but `step >= 5000` gates a one-shot calibration on tick count — the exact pattern the first cardinal rule bans ("calibrate late enough that the world has a real economy" expressed as WHEN, not WHAT). On a slow-developing seed the baseline locks while the economy is still forming (mis-calibrated forever); on a fast seed it locks late. And because the gate is pure step count, a LOADED late-game world (step already ≫5000) re-locks instantly to whatever the post-load economy looks like — compounding the _inflRef-not-saved bug above.

**Fix:** Replace the step gate with the state it is standing in for — e.g. lock when total coin and component count cross emergent thresholds (M.size >= 3 plus a minimum monetised-output level), and persist the locked value so it is computed exactly once per world.

### 80. WAR_DEF_SPLIT is a dead tuning lever — shown in the menu with a 12-line description, read nowhere
`src/sim/peopleSim/tuning.js:155` · **MEDIUM** · Dead code · verdict: **unverified-skipped** · found by `core-loop`

Grep of all 213 schema keys against src/ shows every key consumed as T.KEY somewhere except WAR_DEF_SPLIT. Its only other occurrence is a stale comment in armies.js line 82 ('national field army × WAR_CONCENTRATION / WAR_DEFENSE_DRAG / WAR_DEF_SPLIT / war-exhaustion'), but the actual implementation replaced the divide-by-attackers defensive split with the conserved-allocation model (armies.js line 746: 'No more double-spending the same army on offence and defence (the old offMul/defShare…)'), and defensive load is now built from hard-coded weights (`defLoad.set(dcc, … + (pc.canStorm ? (isCap ? 1.6 : 1.0) : 0.4))`). Failure scenario: a user drags 'Defensive split' from 0 to 2 expecting overstretched defenders per the description ('attacked by 3 it defends each front at ~half') — nothing in the sim changes, and any A/B or calibration built on this lever is measuring noise.

**Fix:** Either remove WAR_DEF_SPLIT from TUNING_SCHEMA (and fix the armies.js:82 comment), or wire it into the defLoad/conserved-allocation weights so the label is honest again.

### 81. Seasonal (monsoon/winter-storm-track) moisture mechanism exists but is only wired into earth_sim — emergent tectonic worlds get an annual-mean solve with no monsoon
`src/sim/tectonicGen.js:1150` · **MEDIUM** · Design flaw · verdict: **ADVISORY** · found by `worldgen-tectonics`

earth_sim runs solveWind/solveMoisture twice with season:+1/-1 and itczLat +13/-13 and blends the wetter half-year (worldgen.js:266-280), because 'An annual-mean wind has NO monsoon — the summer onshore inflow and the winter offshore outflow cancel, starving India, SE Asia and East China ... into desert' (worldgen.js:250-253). tectonicGen calls each solver exactly once with no season (lines 1143, 1150), so every procedurally generated world suffers the exact failure mode that comment describes: no monsoon belt, and no Mediterranean winter rain either — moistureSolver's frontal storm-track term 'Fires only in the seasonal solves' (moistureSolver.js:30-37). By the project's own standard (the emergent worlds are the product; earth_sim is the calibration target), the most physically important moisture mechanism is missing from the emergent path. Relatedly, both tectonicGen:1150 and worldgen.js:277-278 pass a still-all-zero `temperature` array into solveMoisture, so the solver falls back to its internal legacy latitude curve (moistureSolver.js:58-92, the old 0.92-lat^1.5 curve) — which no longer matches earth_sim's calibrated final curve (worldgen.js:367, 0.85-0.66*lat^2...), so evaporation/condensation capacity in the moisture solve is computed from a colder-poled temperature model than the one the world actually ends up with.

**Fix:** Run the two-season solve in tectonicGen exactly as earth_sim does (two solveWind + two solveMoisture with itczLat ±13, wetter-half blend, plus the summerWet/drySeason savanna contrast), and pre-compute a first-pass temperature field to feed solveMoisture so both presets share one temperature model. This would also let several of earth_sim's hand-painted corrections shrink.

### 82. Tool-harness measurements do NOT match the app: pipeline is resolution-invariant only for river CLASSIFICATION, not for floodplains, lakes, or deposits
`src/sim/pipeline.js:326` · **MEDIUM** · Design flaw · verdict: **ADVISORY** · found by `hydro-pipeline`

The harness header and README claim the tools 'measure exactly the world the browser simulates.' The pipeline CODE is genuinely single-source (verified: worldGenWorker runs only generateWorld; buildTerritory runs once on the main thread; peopleSimWorker, persist.js, and _harness.mjs all consume the same buildTerritory/buildWorld outputs; peopleSim reads only riverMag which is shipped). BUT the app runs W=1920/H=960/RES=1 (WorldSim.jsx:27,914) while smoke runs W=320 (smoke.mjs:12) and stylized/earthRun run W=480+. riverGen classifies by absolute km² (resolution-invariant, good), but many downstream quantities are hard-coded in TILE units and therefore scale with resolution: floodplain moisture radius `riverRadius=[0,1,2,3,3]` (pipeline.js:326), `lakeRadius=3` (383), `maxLakeTiles=800` (riverGen.js:575), `minLakeSize=15` (riverGen.js:204), and the coast/plate-boundary BFS caps of 12 tiles (resourceGen.js:130,150). At 480-wide a tile is ~2× the km of a 1920 tile, so a probe sees ~2× wider floodplains, differently-sized lakes, and ~2× the km-spread of coastal salt/oil. Anyone tuning cropland or lakes via the probes is measuring a materially different world from the shipped one.

**Fix:** Express the tile-unit radii/caps in km (like the river km² bars) and convert via kmPerTile, so floodplain width, lake area caps, min lake size, and deposit BFS radii are resolution-invariant like the river classifier already is.

### 83. Floating metropolis bar routinely drops below the scaled city bar, minting 'metropolises' that don't qualify as cities
`src/sim/peopleSim/settlement.js:2312` · **MEDIUM** · Design flaw · verdict: **ADVISORY** · found by `settlement`

`metroBar = Math.max(TIER_THRESHOLD[3], topU * METRO_REL_FRAC)` = max(900, 0.8·largest-urban-pop), while under default DISSOLVE_FARMS the CITY bar scales with world population: `bar(2) = 600 * sc`, sc = clamp(tot/29000, 0.4, 3.5) (lines 2301, 2317-2318). The promotion loop (2331) checks t=3 FIRST and returns, so any settlement with people ≥ metroBar becomes tier 3 without ever meeting bar(2). metroBar < cityBar whenever 0.8·topU < 600·sc, i.e. topU < 750·(tot/29000) ≈ topU/tot < 2.6% — in a spread-out world where the largest settlement holds under ~2.6% of world population this is the NORMAL regime, not an edge case. Concrete: tot=100k → sc≈3.45 → cityBar≈2070; topU=2000 → metroBar=1600. A settlement at 1700 promotes straight from town to METROPOLIS (skipping city), and it doesn't demote (1700 > 1600·0.8). The metro tier then outnumbers the city tier — exactly the inverted pyramid the METRO_REL_FRAC comment (lines 68-76) says this bar exists to prevent.

**Fix:** Floor the metro bar at (a multiple of) the effective city bar: `const metroBar = Math.max(TIER_THRESHOLD[3], topU * METRO_REL_FRAC, bar2 * 1.2)` (computing bar(2) first), or require cumulative qualification in the promotion loop (must meet bar(t) for every rung up to t).

### 84. Single-member realms skip the entire fiscal/unrest/capacity machinery
`src/sim/peopleSim/conquest.js:1693` · **MEDIUM** · Design flaw · verdict: **ADVISORY** · found by `conquest`

`if (c.members.length <= 1) { ...loyalty = 1; continue; }` skips everything: no taxation, no ARMY_WAGE bill (gov._solvency stays 1, so armies.js never deserts its garrison), no unrest accumulation or rebellion, no disburseTreasury, no driftPersonality, and c._capacity/_loadTotal stay undefined (so hasAbsorbHeadroom returns its permissive 'no budget data yet' true, line 2153). Consequences: (a) a one-city state fields a completely free army while a two-settlement realm pays full wages — a systematic fiscal subsidy to city-states that distorts the very consolidation dynamics this file curates; (b) a fresh overseas colony — deliberately founded as its own single-settlement realm (line 341-346) — banks the metropole's investment coin into dpol.treasury (line 1643) but never disburses any of it into the seat's actual economy until it happens to gain a second member; (c) tariffs paid into gov._revenue between passes are never reset, so the first pass after gaining a member books an outsized court windfall.

**Fix:** Run at least the fiscal block (tax, court, disburseTreasury) and the unrest update for single-member realms — the skip should only bypass the province-holding machinery (loads, secession, governors), which genuinely needs >1 member.

### 85. Identity salience is a single GLOBAL scalar keyed to the one most-organised capital on the planet — a remote leader flips every realm into the national age
`src/sim/peopleSim/cohesion.js:56` · **MEDIUM** · Design flaw · verdict: **ADVISORY** · found by `territory-identity`

`identityWeightsNow(world)` reads `world._civYear`, which index.js:188-194 computes from the maximum organisation across ALL capitals worldwide (`if (k && k.organization > leadOrg) leadOrg = k.organization`). The weights are then applied uniformly to every realm's unrest (identityGrievance), admin load (adminFriction), absorption resistance and war-targeting (casusBelliMul). So when one civilisation on one continent industrialises, a bronze-age chiefdom on the far side of the world — with no contact, no printing, no mass literacy — immediately experiences peak nationalism salience (`people: 0.08 + 0.92·ramp(1750,1920)`), heterodox-faith revolt pressure eases, and its multi-ethnic neighbours start fracturing on national lines. That is emergent in letter (no wall-clock) but not in spirit: the mechanism that made nationalism salient was local development (literacy, bureaucracy, conscription), which diffused — it was not a planetary phase switch. The result is anachronistic politics in laggard regions on any seed where development is uneven (i.e., all of them).

**Fix:** Compute salience per-realm from that realm's own capital development (its organisation, or the mean of it and its neighbours to model diffusion): `eraIdentityWeights(civYearFromOrg(cap.knowledge.organization))`. The CIV_ORG_YEAR mapping already exists and is per-value, so this is a one-line change at each call site in conquest.js/armies.js; keep the global `_civYear` for display only.

### 86. Gabriel close-neighbour links are pathed WITH the road discount, so for in-network pairs the 'direct' link rides the existing trunk detour and paints nothing
`src/sim/peopleSim/roads.js:610` · **MEDIUM** · Design flaw · verdict: **ADVISORY** · found by `trade-network`

linkCloseNeighbours exists precisely because "two hamlets 22 tiles apart get routed 80 tiles round a worn trunk because the worn arterial is 'cheaper' than a fresh terrain crossing" (roads.js:168-171), and the Gabriel-edge test (roads.js:609) deliberately admits ALREADY-connected mesh neighbours "so a city links straight to its neighbour instead of every trip detouring out to a trunk artery and back". But the path it then paints comes from `findPath(world, s, peer, { noWater: true })`, which uses localEdgeCost WITH the road short-circuit — exactly the cost field under which the 80-tile worn detour (80 × 0.08 = 6.4) beats the 22-tile fresh crossing (~22 × 0.6+ ≈ 13+). Failure scenario: two connected towns 20 tiles apart with a long worn arterial between them pass the Gabriel test every plan cycle, findPath returns the trunk detour, every tile is already painted, paintRoad returns false, no direct link ever appears — and the wasted pathfind repeats forever. The mechanism only works for the disconnected-components case; the connected-Gabriel case it was extended for is inert in exactly the situation that motivated it.

**Fix:** For the connected-Gabriel case, run findPath with roads ignored (thread an ignoreRoads option through to localEdgeCost, as territory already does) so the painted path is the genuine direct terrain line the foot-traffic model intends.

### 87. Unconditional raiding plus a costless, immortal captive stock: people are siphoned into inert _captives pools that never eat, never die, and never return
`src/sim/peopleSim/slavery.js:45` · **MEDIUM** · Design flaw · verdict: **ADVISORY** · found by `economy`

Phase A raids fire for EVERY settled settlement that is ≥2× stronger than a foreign neighbour within 28 tiles, every pass, with no demand/profit gate of any kind (slavery.js:32-45) — the doc (docs/coerced-labor.md §5) frames raiding-to-sell as the SLAVER archetype, but here every strong border settlement is a slaver whether or not any market exists. Captives then sit in `r._captives` where they (a) are excluded from food demand — settlement.js:2010 feeds only `_unfree`, not `_captives`; (b) never attrit — the only decrements are local use (settlement.js:691) and market sale (slavery.js:78); (c) are excluded from the world headcount — index.js:178 and invariants.js:80 count `s.people` only, so the debug "closed population" watch is blind to the leak, and with ANCHOR_POP on, the demographic anchor compensates for the vanished people by inflating _eraProd; (d) are persisted (persist.js:40) and annihilated silently if the holder dies (pruneDead). Concrete failure: SLAVERY=1 (default) on a continent with no cash-crop climate and no mines — demand is ~0 everywhere, yet every weak frontier settlement bleeds ~0.4%/pass forever into stagnant, costless _captives hoards that can reach tens of thousands of phantom people who cost the raider nothing to hold indefinitely.

**Fix:** Give the captive stock physics: captives must be fed (add to _foodDemand) and attrit/escape back into `people` when unsold for long (a decay term folding `_captives` into the holder's population), and gate Phase-A raiding on an emergent profit signal — e.g. only raiders with nonzero own `_slaveDemand` or a recent history of sales (a smoothed IN_SLAVE_TRADE rate) keep raiding. Also count `_captives + _unfree` into invariants.js's totalPeople so the conservation watch can actually see this subsystem.

### 88. Information horizon is inert for coordinate-less TRAVELS events, and the fixed RUMOR_BAND makes 35% of even zero-distance foreign events render as rumor
`src/sim/peopleSim/historiography.js:158` · **MEDIUM** · Design flaw · verdict: **ADVISORY** · found by `narrative`

Two halves of the horizon mechanism don't do what the header claims. (1) distTo (line 56-57) returns 0 when `ev.x === undefined`, so `know = max(0.04, min(1, 1.35 - d/horizon))` = 1 for any TRAVELS event that carries no coordinates — and three of the seven TRAVELS types never log x/y: polity.ended (entities.js:94), era.reached (chronicle.js:62) and faith.schism (faiths.js:535 logs s/sName but no x/y). Every realm on the planet therefore reliably "hears of" every dissolution, era advance and schism anywhere in the world, regardless of distance or literacy — the horizon simply doesn't apply to them (and this is what turns finding #1's phantom dissolutions into world-wide chronicle spam). (2) The rumor test `r > know - RUMOR_BAND` with know=1 means r ∈ (0.65, 1] → a flat 35% of foreign events AT ANY DISTANCE, including next door or coordinate-less, render as "Travellers brought word..." — contradicting line 30's "tiles within which distant MAJOR events are reliably heard of". Rumor was meant to mark the MARGINAL band of the horizon, but as written it's a fixed global lottery.

**Fix:** Log x/y on all TRAVELS types (polity.ended can use the last capital's position; era.reached the capital; faith.schism the see) so the horizon actually filters them. Make rumor distance-dependent: e.g. rumor iff know < 1 && r > know - RUMOR_BAND (so full-knowledge events are always recorded as record), or scale the band by (1 - know).

### 89. Globe texture is built from the base raster only — political/identity/economic overlays never reach the globe, contradicting the 'supports all view modes' comment
`src/WorldSim.jsx:1632` · **MEDIUM** · Design flaw · verdict: **ADVISORY** · found by `ui-render`

The globe resample (lines 1632-1656) reads `d`, the base ImageData, inside the `if(!_baseHit)` block. When the globe is open canvasRef is unmounted (line 3845), ctx is null, and draw() returns at line 1659 BEFORE the psOverlay/settlement/ships passes — so nothing sim-related is ever composited into `d`. Failure scenario: switch to Politics lens and toggle the globe — you get a plain terrain ball, no realms; Money view gives a featureless dark-slate ball. Additionally the 250ms texture throttle gates only the 4096×2048 resample, not the base rebuild above it: every 30Hz snapshot still runs the full per-pixel base loop (globe mode can never cache — `_staticBase` requires `!isGlobe`, line 1404), wasting ~7 of every 8 rebuilds.

**Fix:** Composite the overlay into an offscreen canvas even when the DOM canvas is absent (draw base+psOverlay to a hidden canvas, sample its getImageData), and early-return from the whole rebuild when the 250ms throttle hasn't elapsed.

### 90. save/load "hash identity" verifies only a fraction of the saved state
`src/sim/persist.js:230` · **MEDIUM** · Design flaw · verdict: **ADVISORY** · found by `tooling-tests`

README (line 137) and persist.js (line 9) claim the smoke test proves "everything in the save round-trips EXACTLY" via hash identity. But `hashWorld` (persist.js:237-254) mixes only: step, a subset of settlement scalar fields + knowledge, a subset of polity fields, `events.length`, and roadQuality sampled every 97th cell. It does NOT touch cultures, faiths, dynasties, persons, languages registries; per-settlement `culMix/faithMix/langMix/ancMix`; the `_countryOwner/_countryClaim/_territoryOwner/_capturedAt` maps; the money/table state (`_linkMoney/_inflRaw/_manpower/_warExhaust/_plagued`); `depositReserve`; or `seaReach`. Failure scenario: a serialization regression that drops `culMix` on every settlement, or corrupts `_linkMoney`, round-trips through save→load and the smoke check `h0 === h1` (tools/smoke.mjs:146) still passes green — the test cannot see those fields. The 500-step functional-resume check (smoke.mjs:149-154) only catches gross corruption (NaN/invariant hits/zero settlements), not silent identity/economy drift.

**Fix:** Either extend hashWorld to fold in the identity registries, per-settlement mixture arrays, owner maps, and money tables, or add a stronger smoke assertion (e.g. deep-compare a canonical serialization save→load→save, and step both original and loaded worlds N steps and compare stats/hash) so the "round-trips EXACTLY" claim is actually enforced.

### 91. Identity-salience curves are anchored to real historical YEARS via a calibration table fitted to Earth's timeline (borderline rule-2 by construction)
`src/sim/peopleSim/index.js:134` · **MEDIUM** · Design flaw · verdict: **ADVISORY** · found by `hunt-fitted-outcomes`

CIV_ORG_YEAR (index.js:134-137) maps the leading capital's organisation to a 'pseudo-year' ([0.10,-6000] ... [0.995,1960]), and cohesion.js eraIdentityWeights (lines 45-53) then expresses when faith/nation/language matter as ramps over those historical years (`faith: 0.12 + 0.88*ramp(100,700) - 0.30*ramp(1800,1970)`, `people: 0.08 + 0.92*ramp(1750,1920)`). This is rule-1 CLEAN (monotone in org, never the wall clock — the comments are right about that), but it is a re-parameterisation, not a mechanism: nationalism crests at 'org such that the calibration table says 1750-1920', i.e. the ANSWER (the historical schedule of identity politics) is encoded directly, with organisation as the index variable. The rule-2 concern is concrete: the anchors fit Earth's one trajectory, so on worlds whose development mix differs (high navigation/literacy but low organisation, or vice versa), salience will fire at the calibrated org level regardless of whether the actual preconditions (mass literacy, print, standardised schooling, cheap movement) exist there. Two fitted tables composed together (org→year, year→salience) is a fragile stand-in for the causes the sim already tracks.

**Fix:** Collapse the two tables into state-causal drivers the sim already has: faith salience from church formation/literacy (faiths.js already gates churches on literate towns), language salience from bureaucracy (organisation directly), national salience from the mechanisms that historically produced it — literacy/printing techs (tech.js has printing/telegraph), urbanisation share, and connectivity (roads/sea reach). Keep CIV_ORG_YEAR only for the cosmetic display calendar.

### 92. Identity lenses rebuild their static grey base per-pixel every frame — excluded from BASE_CACHE_VIEWS for no reason
`src/WorldSim.jsx:1579` · **MEDIUM** · Performance · verdict: **ADVISORY** · found by `ui-render`

The culture/faith/language/ancestry base (lines 1579-1588) is a pure function of world elevation — `if(e<=sl){d[pi4]=20;…}else{const v=(118-…)…}` — yet these views are not in BASE_CACHE_VIEWS (line 40), so while the sim plays, every 30Hz snapshot draw loops all N=1,843,200 pixels (with a screenYtoDataY call each) plus a full putImageData, even though the coloured regions are drawn from the separately-cached psOverlay. 'society' similarly falls through to the terrain else-branch and re-copies the terrain cache per pixel every frame. This is exactly the cost the base cache was built to remove (per the comment at lines 36-40) — these five lenses are the slowest views in the app for no benefit.

**Fix:** Add culture, faith, language, ancestry, society to BASE_CACHE_VIEWS (their bases depend only on seed/CH, already in the key). The overlay canvas on top is what changes with the sim.

### 93. setLiveStep re-renders the entire 4,187-line component ~30Hz while playing; World-tab charts rebuild ~35k-point polyline strings per render
`src/WorldSim.jsx:2443` · **MEDIUM** · Performance · verdict: **ADVISORY** · found by `ui-render`

applySnapshot calls `setLiveStep(snap.step)` on EVERY snapshot; while playing the step always changes, so the whole WorldSim tree — top bar, lens rail, all panel render functions — re-renders at snapshot rate. The psStats 5Hz throttle at line 2479 is therefore mostly moot (renders happen anyway; only the stats object is throttled). With the World tab open, renderCharts (line 3699) runs 7 MiniChart passes, each scanning psHistoryRef (capped 5000 samples, line 2490) for min/max AND string-building `pts+=sx(d.step).toFixed(1)+…` per point — up to ~35,000 toFixed pairs 30 times a second, plus 7 fresh SVG polylines for React to diff.

**Fix:** Move the step/year readout into a tiny memoized child fed by liveStep (or write it to a ref + rAF text update), keep the rest of the tree on the 5Hz psStats cadence, and memoize each MiniChart on (data.length, lastStep).

### 94. GlobeView texture update allocates ~67MB and rebuilds the static specular map on every 4Hz version bump
`src/GlobeView.jsx:193` · **MEDIUM** · Performance · verdict: **ADVISORY** · found by `ui-shell` (also `hunt-perf-memory`)

The caller went to lengths to avoid allocation churn — WorldSim.jsx:1629 comment: the 25MB globe buffer 'is allocated ONCE and reused… churned ~750MB/s' — and bumps `version` ~4×/sec while playing with the globe open (250ms throttle at WorldSim.jsx:1634). But the receiving effect defeats that: line 193 `const img = texCtx.createImageData(CW, CH)` allocates a fresh 4096×2048×4 ≈ 33.5MB ImageData per bump, and lines 219-233 allocate a SECOND 33.5MB ImageData and re-derive the specular (ocean/land) map by sampling `world.elevation` for all 8.4M texels — even though world.elevation is immutable for the lifetime of a generated world; only `terrainBuf` contents change between bumps. Also line 218-220 reassigns `s.specCanvas.width = CW` each pass, which wipes and reallocates the canvas backing store. Net: ~270MB/s of garbage plus a redundant 8.4M-texel loop 4×/sec, on the main thread, while the globe spins. Failure scenario: leave the globe open at Max speed — periodic GC pauses/hitches in the rotation that the 250ms throttle on the producer side was specifically added to prevent.

**Fix:** Cache one ImageData for the color map in stateRef and reuse it (createImageData once, refill d in place). Split the specular-map build into its own effect keyed on `world` only, and drop the per-update specCanvas resize.

### 95. Territory pass is a single multi-hundred-ms hitch at shipped resolution
`src/sim/peopleSim/index.js:201` · **MEDIUM** · Performance · verdict: **ADVISORY** · found by `hunt-perf-memory`

Every T.TERRITORY_INTERVAL (=144) ticks, one step runs computeTerritory (multi-source Dijkstra over all claimed land + two Float32Array(N).fill(Infinity) + core/hinterland stamping + tallyTerritory O(N)) AND computeCountryTerritory (a second full-map multi-source Dijkstra + persistence merge) AND adoptAndFound/nucleateFrontierStates back-to-back. Measured with world._dbgProfile at 240×120 tiles (N=28.8k): territory pass max = 37.7 ms in a 6000-step run (tickMs avg 2.5ms → one step every 144 is ~15-40×). The shipped app runs 1920×960 pixels → tw×th = 960×480 = 460,800 tiles (16× more), so this single step plausibly reaches 300-600 ms. The worker's STEP_BUDGET_MS check (peopleSimWorker.js:243) only breaks BETWEEN steps, so this one step stalls the snapshot cadence and the visible sim freezes for that long every 144 ticks at high speed — the residual 'starts fast, hitches periodically' behaviour the codebase has been chasing.

**Fix:** Time-slice the territory pass the way road planning already is (world._planQueue pattern): run the Dijkstra incrementally over several ticks against a double-buffered owner array, or split computeTerritory and computeCountryTerritory onto alternating half-intervals so no single step pays both floods. Alternatively cap heap work per tick and resume.

### 96. relaxClaim does ~7-9 full-map sweeps every 12 ticks (rings scan all N tiles each)
`src/sim/peopleSim/countryClaim.js:190` · **MEDIUM** · Performance · verdict: **ADVISORY** · found by `hunt-perf-memory`

relaxClaim (called every CLAIM_RELAX_INTERVAL=12 ticks) performs: a foothold/present scan over all N tiles (line 149), the head-of-country settlement scans, then `for (let r = 0; r < rings; r++) { for (let ti = 0; ti < N; ti++) ... }` (lines 190-212) where rings = round(tw/240) = 4 on the shipped 960-wide grid — each ring iterates ALL 460k tiles doing a 4-neighbour adjacency test just to find the handful of front tiles — plus the across-water snap block (two more O(N) scans building a Map of Sets, lines 220-228). That is ~3-4M tile visits per call, ~300k/tick amortised, likely 15-30 ms per call at shipped resolution, for a border animation whose actual work (tiles that can flip) is proportional to FRONT LENGTH, not map area. This is one of the largest fixed per-tick costs that doesn't scale down when the world is calm.

**Fix:** Track the front explicitly: keep a queue/set of tiles where claim[ti] !== target[ti] with a claimed neighbour (seed it once per territory pass when _countryOwner changes, update it locally as tiles flip). Each relax then processes only front tiles — O(front) per ring instead of O(N). The foothold and across-water passes can ride the territory-pass cadence (they only change when _countryOwner does).

### 97. Worker ships a 1.8 MB roadFlow copy 30×/s that the renderer reads ~1×/s
`src/peopleSimWorker.js:407` · **MEDIUM** · Performance · verdict: **ADVISORY** · found by `hunt-perf-memory`

buildSnapshot does `const roadFlow = world.roadFlow ? world.roadFlow.slice() : null;` on EVERY snapshot (~30/s), with the comment 'roadFlow animates road thickness so it streams every snapshot'. But in WorldSim.jsx the only consumer is the psOverlay rebuild (line 2258, road thickness) which regenerates every PS_OVERLAY_REGEN=30 sim-steps (~1/s at speed 30), and the roads-view base which is step-cached in 8-step buckets. At shipped resolution roadFlow is Float32Array(460,800) = 1.84 MB, so this is ~55 MB/s of allocation+memcpy in the worker plus transfer, for data sampled ~1-4×/s. (owner/roadQuality/countryClaim already ride the 6-snapshot static cadence — roadFlow just never got moved.)

**Fix:** Gate roadFlow with `sendStatic` like owner/roadQuality (the mirror keeps the last copy), or downsample it to Uint8 intensity before shipping. Nothing on the main thread needs it fresher than the overlay regen cadence.

### 98. Politics/identity map overlay rebuilds with 150-300k canvas fillRect calls on the main thread
`src/WorldSim.jsx:2114` · **MEDIUM** · Performance · verdict: **ADVISORY** · found by `hunt-perf-memory`

The psOverlay rebuild (every PS_OVERLAY_REGEN=30 sim-steps, plus every layer toggle) paints the political map tile-by-tile: `for(let ti=0;ti<claimArr.length;ti++){ ... octx.fillRect(sx,sy,TR+0.6,TR+0.6); }` (country view, lines 2114-2132), then a border path with a moveTo/lineTo pair per border edge (2137-2145); the culture/faith/language and society branches do the same per-tile fillRect over N2=tw×th=460k tiles (2013-2031, 2050-2053), and the provinces block adds two more full scans (2244-2254). With ~40-60% of land claimed that is 150-300k fillRect calls + tens of thousands of path segments per rebuild on the MAIN thread — realistically tens of ms, i.e. a visible stutter every ~1 s of play in the politics/identity lenses (the identity-flood BFS at 1977-1989 is cheap by comparison; the canvas API calls are the cost).

**Fix:** Rasterise these overlays into a reused ImageData (one u32 write per tile, exactly like the terrain base builder does) and putImageData onto the offscreen canvas, keeping vector strokes only for the thick national borders. This turns ~300k canvas calls into one buffer pass + one blit.

### 99. hashWorld + the smoke test's save→load→save identity cannot detect any of the missing-field bugs above
`src/sim/persist.js:230` · **MEDIUM** · Recommendation · verdict: **ADVISORY** · found by `persistence-workers`

hashWorld mixes only step, a dozen per-settlement scalars, knowledge, four polity fields, event COUNT, and every 97th roadQuality sample — i.e. almost exactly the set persist.js already saves. tools/smoke.mjs (lines 141-149) compares hashWorld(world) to hashWorld(loadWorld(serializeWorld(world))) and then just steps the loaded world 500 ticks for crash-freedom. Every finding above (_tileCapturedAt, _riverAcc/_orgApt, _soilFatigue, _truces, _inflRef, _cBudgetRamp) is invisible to this harness by construction: fields the save omits are also fields the hash omits, so the identity check passes trivially, and the header's claim "What round-trips EXACTLY: everything in the save (verified by the smoke test)" is true but vacuous. This is why six independent pieces of persistent state drifted out of the save without any test failing.

**Fix:** Add a divergence probe: run world A for K steps past the save point and compare against loadWorld(save) run K steps, hashing a much wider field set (include _orgApt, _riverAcc, _soilFatigue samples, truce count, _inflRef, ramp values). Accept the documented warm-up transients by comparing at a horizon past all rebuild intervals, or hash only the persistent-by-design fields listed in a single registry shared with saveWorld so new state must be classified explicitly.

### 100. Stylized-facts suite never gates anything — not in CI, and only 'continuity' can hard-fail
`tools/stylized.mjs:33` · **MEDIUM** · Recommendation · verdict: **ADVISORY** · found by `tooling-tests`

The suite's whole purpose is "is the emergent history history-SHAPED?", but every history-shape check (Zipf, empire tail, lifespans, war rate, tech diffusion, urbanisation) passes `hardFail=false` to `score`, so a miss only increments `soft` and prints `warn`; `process.exit(hard?1:0)` (line 155) fails ONLY on the section-7 continuity gates (settlements>=20, pop>500, wealth finite, countries>=3). Separately, .github/workflows/deploy.yml runs `npm test` but never `npm run validate`, so stylized.mjs is not executed in CI at all. Net effect: a change that flattens city rank-size to slope 0, makes all empires equal-sized, or gives every war a purely geometric cause produces green `npm test` and a deploy — the stylized regularities are informational only and can silently rot.

**Fix:** Run `npm run validate` in CI (at least on main) and/or promote a few of the most robust regularities (e.g. Zipf slope band, empire-tail ratio) to hard gates once you trust their stability across seeds; document explicitly that the rest are advisory.

### 101. SPEC-climate-moisture-fix.md is fully implemented but still reads as an open handoff task
`docs/SPEC-climate-moisture-fix.md:105` · **MEDIUM** · Recommendation · verdict: **ADVISORY** · found by `docs-drift`

The doc is written as "the fix to implement" for a next session, but commit 0ed7349 ("Fix continental aridity: depletive moisture transport") shipped exactly the prescribed fix and more. src/sim/moistureSolver.js is now the depletive model: backward-trace directional advection (lines 214-233), the old near-lossless `nMax * _moistDecay` (0.996) replaced by a heavily lossy diffusion `_moistDiffuse = 0.55` per ~1.5° cell (lines 23, 199, 256-260) — the spec's allowed "small isotropic component with real loss"; plus föhn lee-drying (lines 296-303), evapotranspiration recycling to keep the Amazon/Congo wet (lines 372-377), and a winter storm-track term (lines 344-360) the spec didn't even ask for. Every code reference in the doc is now stale: "the exact defect — moistureSolver.js:204" points at the transport loop header, and `_moistDecay` no longer exists. A future agent handed this spec could burn a session re-diagnosing or re-implementing a fix that already shipped, or 'fixing' the current solver back toward the doc's description of the old one.

**Fix:** Add a header line: "IMPLEMENTED (commit 0ed7349) — kept for the diagnosis record; code references describe the PRE-fix solver." Or move §1-§3 (the excellent root-cause analysis) into a comment/archive and delete §5-§7.

### 102. coerced-labor.md header says "proposal (not yet built)" — all three build steps are fully shipped
`docs/coerced-labor.md:3` · **MEDIUM** · Recommendation · verdict: **ADVISORY** · found by `docs-drift`

Line 3: "Status: **proposal** (not yet built)." In fact every mechanic is live: Step 1 — settlement.js:669 `updateCoercedLabour` (unfree stock, `_cashFrac` drift line 712, cash output line 718, mine intensification line 599 `coerceMine = 1 + T.MINE_COERCE * ...`, slave food line 2010, land diversion line 1921); Step 2 — slavery.js `updateSlaveTrade` (raid phase + global market clearing, IN_SLAVE_TRADE/OUT_SLAVE in money.js:23,38) and capture-on-sack in armies.js:887-889 (`T.CAPTURE_FRAC`); Step 3 — serfdom + the plague fork in conquest.js:1878-1893 (`T.SERF_PLAGUE`, `s._serf`) and serf rent at conquest.js:2093. Fields persist (persist.js:40-41: `_unfree`, `_cashFrac`, `_captives`, `_serf`) and the full lever block lives at tuning.js:443-471. The doc's §11 "open decisions" were all resolved in code (cash crops folded into luxury per its own recommendation — settlement.js:720 books cashOut into `_luxSupply`; no IN_CASHCROP). Anyone triaging docs/ would believe a large shipped system is still unbuilt.

**Fix:** Change the header to "Status: IMPLEMENTED (steps 1-3; see settlement.js updateCoercedLabour, slavery.js, conquest.js serfdom block)" and note the resolved decisions and drifted defaults (CAPTURE_FRAC 0.07 vs proposed 0.15, SLAVE_DEATH 0.003 vs 0.01, SLAVE_TRADE_W dropped in favour of interval-based global clearing).

### 103. persistent-territory-spec.md header contradicts its own body, and the lever default has since flipped to ON
`docs/persistent-territory-spec.md:3` · **MEDIUM** · Recommendation · verdict: **ADVISORY** · found by `docs-drift`

Line 3 says "Status: proposed / not started" while the body's incremental plan marks items 1 and 2 "[DONE this session]" with measured results — internally contradictory. The code confirms implemented: countryTerritory.js persistentTerritoryOn() (lines 42-46), mergePersistentTerritory (line 587) implementing exactly the CORE/MARCH/self-cleaning design of plan item 2. But the spec's stated default — "behind the lever `T.PERSISTENT_TERRITORY` (default 0 = off)" (line 76-77) — is stale: tuning.js:117 now has `def: 1`, i.e. persistent territory is the shipped default behaviour, not an experiment. Subsequent commits (f293f5a, 9b3f0e0 "national war-capacity layer", 31942dc "Re-smooth the political map after the persistence merge") completed the arc including the doc's open item "tune whether marches should also re-smooth" (smoothCountryBorders, countryTerritory.js:750). The stale branch pointer (`claude/ecstatic-keller-qy6100`) and "Owner: next session" framing add to the confusion.

**Fix:** Update header to "Status: IMPLEMENTED, default-ON (T.PERSISTENT_TERRITORY def 1)"; strike the branch/process section; note items 3-4 (area-vs-seat verification, CLAIM_POW still def 0) as the remaining open threads.

### 104. Schism / syncretism cooldown state (world._schismAt, world._lastSyncretismAt) is not serialized
`src/sim/persist.js:126` · **MEDIUM** · Save/load · verdict: **unverified-skipped** · found by `identity-culture`

faiths.js gates schisms per religion family on `const lastRoot = world._schismAt.get(f.rootFaithId) ?? -Infinity; if (world.step - lastRoot < SCHISM_ROOT_COOLDOWN / _dt) continue;` (faiths.js:500) and syncretism on `world.step - (world._lastSyncretismAt ?? -Infinity) >= SYNCRETISM_WORLD_COOLDOWN / _dt` (faiths.js:549). Neither is in saveWorld's payload (the `tables:{...}` block carries other world Maps; these are absent), so on load both reset to 'never happened'. A world saved one pass after a schism, then loaded and run, can schism the same root again immediately and fire a syncretism at once — histories that an uninterrupted run would forbid. This is real cross-tick history state, not a rebuildable warm cache, so it breaks the persist.js contract ('the same world mid-breath'). The same class of hole: `s._lastBorrow` (cultures.js:344 borrowing cooldown) is not in SETT_FIELDS. The smoke test's save→load→save hash identity cannot catch this because the hash doesn't cover these fields either.

**Fix:** Add `schismAt: mapToArr(world._schismAt)`, `lastSyncretismAt: world._lastSyncretismAt` to the save (and restore them in loadWorld), and add `_lastBorrow` to SETT_FIELDS.

### 105. History charts merge two different worlds when loading a save whose step is higher than the current run's
`src/WorldSim.jsx:2483` · **MEDIUM** · Save/load · verdict: **unverified-skipped** · found by `ui-state`

The history reset heuristic is `const H=psHistoryRef.current, st=snap.step, last=H[H.length-1]; if(last&&st<last.step)H.length=0;` — it only detects a step going BACKWARD. finalizeWorld never clears `psHistoryRef`. Failure scenario: run world A to step 1,000; load a save of world B taken at step 50,000 → the first snapshot arrives with st=50,000 > 1,000 → no reset → world A's 10 samples remain at the head of the array, and the Population/Gold/Countries charts (and the "Copy stats rundown" markdown export via buildHistoryExport) draw a continuous line gluing two unrelated worlds together, with a fake 49,000-step gap the x-scaler stretches across most of the chart width.

**Fix:** Clear `psHistoryRef.current.length=0` in finalizeWorld (where the mirror is reset), so every new world/load starts a fresh series; keep the backward-step guard as a belt-and-braces.

### 106. Signed peace treaties (world._truces) are lost on load — wars reopen the moment the first war pass runs
`src/sim/peopleSim/armies.js:377` · **MEDIUM** · Save/load · verdict: **unverified-skipped** · found by `hunt-save-load`

advanceFronts maintains `world._truces` (armies.js:377), a Map of "a:b" country-pair → expiry step, written when either side's exhaustion crosses TRUCE_EXHAUST (armies.js:715-725, `truces.set(cc + ":" + ecc, world.step + T.TRUCE_TICKS / dt)`) and consulted by `inTruce` before any land or amphibious front can open (armies.js:448, 557: "a signed peace holds"). TRUCE_TICKS default 1500 (on). The map is not in persist.js's tables. Failure: two exhausted great powers sign a 1500-tick peace at step 20000; the player saves at 20050 and reloads; `world._truces` is undefined, so at the very next CONQUEST_INTERVAL pass the stronger side's fronts qualify again (exhaustion IS saved via _warExhaust, but a rested-enough attacker or a dominant one clears the bar) — the treaty that structurally bound BOTH sides evaporates and the episodic-war design regresses to the permanent-war equilibrium the truce system was built to break. The expiry values are absolute steps and world.step round-trips, so the map serializes cleanly.

**Fix:** Add `truces: mapToArr(world._truces)` to the tables block in saveWorld and `world._truces = arrToMap(t.truces)` in loadWorld.

### 107. Sim-facing inflation state (_inflP, _inflRef) is lost while only the display map (_inflRaw) is saved — accumulated inflation is rebased to 1 on load
`src/sim/peopleSim/inflation.js:93` · **MEDIUM** · Save/load · verdict: **unverified-skipped** · found by `hunt-save-load`

persist.js saves `inflRaw` (the DISPLAY indicator) but neither `world._inflP` — the SIM-facing per-component price map that localP()/localPByCountry() feed into army wages, food prices and building costs (inflation.js:109-124, 139-163) — nor `world._inflRef`, the baseline M/T reference "used forever after — the whole point is that *changes* from this baseline are what inflation/deflation report" (inflation.js:79-93). On load `_inflRef === undefined`, so the next pass RE-CALIBRATES the baseline to the CURRENT world's M/T (inflation.js:82-93): a late-game world sitting at 5× monetary expansion has that expansion redefined as the new normal — every component's sim price snaps back toward 1 (no EMA memory either, since `_inflP` starts empty and `prevP === undefined` seeds directly at the new target, line 124). Failure: a realm straining under P≈2.4 army wages on the edge of insolvency saves and reloads; post-load wages are computed at P≈1, the fiscal crisis silently evaporates, and history diverges. The wrong one of the two parallel maps was persisted — _inflRaw is explicitly display-only.

**Fix:** Persist `_inflP` (mapToArr) and `_inflRef` (a plain number, e.g. next to climIndex) and restore both in loadWorld; keep _inflRaw for the ticker.

### 108. Country reach ramp (world._cBudgetRamp) and one-shot inheritance set (_inheritReach) are lost — every realm's political reach snaps back to base on load
`src/sim/peopleSim/countryTerritory.js:389` · **MEDIUM** · Save/load · verdict: **unverified-skipped** · found by `hunt-save-load`

computeCountryTerritory eases each country's reach budget toward its tech/size target through the cross-pass Map `world._cBudgetRamp` (countryTerritory.js:389-399): `const prev = ramp.get(c); const next = prev === undefined ? ((inherit && inherit.has(c)) ? target : Math.min(target, COUNTRY_REACH_BASE * resScale)) : prev + (target - prev) * BUDGET_RAMP;`. Neither `_cBudgetRamp` nor `_inheritReach` is saved. Failure: on the first country-territory pass after load the ramp map is empty, so EVERY realm — including a mature continental empire whose ramp had converged to its full target — is treated as brand-new and its budget is clamped to `COUNTRY_REACH_BASE * resScale` (base 4 tiles!), then re-grows at BUDGET_RAMP=0.06 per pass over dozens of passes. With PERSISTENT_TERRITORY=1 (default) the already-held marches are re-asserted from the saved _countryOwner so the drawn map mostly survives, but the fresh reach projection — which drives frontier expansion, the wasteland partition, and recolorByCapital's smooth borders — collapses and creeps back; with the lever off the political map visibly implodes to city-cores and regrows. A secession immediately before save additionally loses its `_inheritReach` full-target seeding, defeating the "inherits an administered region" rule.

**Fix:** Persist `_cBudgetRamp` (mapToArr) and `_inheritReach` ([...set]) in saveWorld/loadWorld tables.

### 109. War-memory map world._warSeenAt is lost — every ongoing war re-logs a duplicate 'war.began' event (and inflates ruler war counts) after load
`src/sim/peopleSim/armies.js:630` · **MEDIUM** · Save/load · verdict: **unverified-skipped** · found by `hunt-save-load`

advanceFronts dedupes war-start events through `world._warSeenAt` with a 900-tick hysteresis: armies.js:630-647 — `const last = seen.get(key); seen.set(key, world.step); if (last !== undefined && world.step - last < WAR_MEMORY / dt) continue; ... logEvent(world, "war.began", ...); if (pa) pa._reignWars = (pa._reignWars || 0) + 1;`. The map is not saved. Failure: a world with five active wars is saved and loaded; at the first advanceFronts pass every ongoing front pair has `last === undefined`, so five spurious "X marched to war against Y" events are appended to the permanent event log (which IS saved and is the source of chronicles, exports and historiography), and each attacking ruler's `_reignWars` epithet counter increments again for a war he already started. The append-only 'true record' is corrupted by phantom war declarations every time a save/load happens mid-war.

**Fix:** Add `warSeenAt: mapToArr(world._warSeenAt)` to tables and restore it in loadWorld (values are absolute steps, so they round-trip with world.step).

### 110. ANCHOR_POP description says '1 (default)' but the default is 0 — stale docs on the sim's most philosophy-critical switch
`src/sim/peopleSim/tuning.js:259` · **MEDIUM** · UI/UX · verdict: **ADVISORY** · found by `core-loop`

The schema entry is `{ key: "ANCHOR_POP", …, def: 0, … desc: "1 (default) = the demographic ANCHOR runs: …" }` — the description asserts the opposite default from the code. The large header comment in index.js (lines 56–76) likewise presents the historical-population anchor as the standing model without mentioning it now defaults OFF (index.js line 180-181 gates on `T.ANCHOR_POP > 0`, else 'FULLY EMERGENT: no pinning'). The ERA_PROD_* levers ('ANCHOR_POP=0 only') carrying fully-tuned non-trivial defaults confirms 0 is the intended present default. Failure scenario: a contributor reading either doc believes population is pinned to POP_ANCHORS, misdiagnoses population behaviour (e.g. the documented late-game decline that occurs with the anchor off), or 'fixes' emergent-capacity code believing the anchor will refill it.

**Fix:** Update the ANCHOR_POP desc to '0 (default) = fully emergent …; 1 = pin world total to the historical curve', and add one line to the index.js header noting the anchor is opt-in and the default path is the emergent _eraProd in settlement.js.

### 111. After load, world.countries is empty until the next polity pass — realm UI blank for up to 150 ticks, indefinitely while paused; _civYear also reads -6000
`src/sim/persist.js:161` · **MEDIUM** · UI/UX · verdict: **ADVISORY** · found by `persistence-workers`

loadWorld sets `world.countries = new Map()` (persist.js:161) and only calls computeTerritory; the country view is rebuilt in updatePolities at `world.step % _ivl(T.POLITY_INTERVAL) === 0` (index.js:267, default 150). buildSnapshot iterates `world.countries.values()` (peopleSimWorker.js:311), and applySnapshot replaces the mirror's map wholesale (`psw.countries = countries`, WorldSim.jsx:2476). Failure scenario: load a save while paused — the immediate snapshot ships `countries: []`, so the realms panel, leaderboard, ruler cards and country hues are empty and STAY empty until the user plays through up to 150 ticks. Additionally index.js:186-194 computes `leadOrg` from the empty `world.countries`, so `world._civYear = civYearFromOrg(0) = -6000` for those ticks: the development-gated systems (identity weights via identityWeightsNow, frontier-close gates) briefly treat a modern world as deep antiquity after every load.

**Fix:** At the end of loadWorld, run the polity aggregation once (call the same country-rebuild routine updatePolities uses, or extract it) so world.countries, _leadOrg and _civYear are warm before the first snapshot — mirroring what is already done for computeTerritory.

### 112. Sim Levers panel is unreachable on every preset except earth_sim, including the default tectonic preset
`src/WorldSim.jsx:4168` · **MEDIUM** · UI/UX · verdict: **ADVISORY** · found by `ui-shell`

The only code path that opens the levers panel is the menu entry `{preset==="earth_sim"&&<button ... onClick={()=>{setLeversOpen(v=>!v);...}}>⚖ Sim levers</button>}`. But the peopleSim (which is what the levers tune — TUNING_SCHEMA lives in sim/peopleSim/tuning.js) runs identically on ALL presets: finalizeWorld spawns the PeopleSimWorker unconditionally (WorldSim.jsx:936-978), and presetRef initializes to "tectonic" (line 885). Failure scenario: a user on the default tectonic world (or an imported Azgaar map) wants to adjust CAP_BASE or war pacing — the entire 100+-lever runtime tuning system exists, is wired, and works (pushTune → worker applyTuning verified end-to-end), but there is no way to open the panel. The 'tune' re-send at line 977 even preserves lever values across regenerations for these presets, values the user can never have set.

**Fix:** Drop the `preset==="earth_sim"` guard on the Sim levers menu entry (or gate it on the people sim actually running, which is: always).


## LOW (91)

### 113. initNoise corrupts the permutation table for negative seeds (252/256 entries become 0)
`src/sim/worldgenUtils.js:20` · **LOW** · Bug · verdict: **CONFIRMED** · found by `worldgen-tectonics`

In initNoise, `seed = (seed * 16807) % 2147483647` preserves sign in JS, so for a negative seed `const j = seed % (i + 1)` is negative; `[p[i], p[j]] = [p[j], p[i]]` then reads `p[-47]` → undefined → assigning undefined into the Uint8Array coerces to 0, and the write to the negative index is a silent no-op. Probe: after the shuffle with seed -12345, 252 of 256 table entries are 0 and mean |noise2D| drops from 0.207 to 0.112 — the noise becomes near-degenerate over most of the lattice while staying 'deterministic', so a world generated from a negative seed is silently broken rather than failing. mkRng right below (line 84) normalizes exactly this case (`((s % M) + M) % M || 1`) but initNoise does not. The current UI only produces seeds in [0, 999999], so this is latent — but generateWorld/initNoise are exported and used by ~60 tools/ probes and by saves (meta.seed), where a hand-edited or externally computed negative seed would hit it. Also: seed 0 and seed 2147483647 (and any multiple) produce identical PERM and identical mkRng streams — colliding worlds.

**Fix:** Normalize at entry like mkRng: `seed = ((seed % 2147483647) + 2147483647) % 2147483647 || 1;` as the first line of initNoise.

### 114. Bilinear upsample of the coarse stamp field extrapolates (weights up to -0.5) at the last columns instead of wrapping
`src/sim/tectonicGen.js:326` · **LOW** · Bug · verdict: **CONFIRMED** · found by `worldgen-tectonics`

In the rawElevCoarse upsample: `const ix = Math.min(ewW - 2, fx | 0), iy = Math.min(ewH - 2, fy | 0); const ixr = (ix + 1) % ewW; // wrap X`. Because ix is clamped to ewW-2 first, ixr is at most ewW-1 and the `% ewW` wrap never fires; for x near W-1, fx reaches ewW-0.5 so dx = fx-ix reaches ~1.5, giving negative bilinear weights (1-dx = -0.5) — linear extrapolation off the grid edge rather than interpolation toward the wrapped column 0. The proper wrap sample for the last pixel column should blend toward rawElevCoarse[...ewW-1] and column 0. The same clamp-then-'wrap' pattern appears in the erosion-delta and windTemp upsamples (lines 1077, 1208) and in worldgen.js earth_sim's windTemp upscale (line 344). In practice the antimeridian cross-fade (lines 333-349) papers over the elevation case, which is why the tectonic seam probe measures clean — but the pattern produces a mild overshoot artifact in the last 1-2 pixel columns of every upsampled field, and moisture/temperature fields get no seam blend.

> **Verifier correction:** Claim confirmed with three minor corrections: (1) worldgen.js:346-347 uses Math.min(mW2-1, ix+1) — clamp-only, no dead % wrap; (2) the erosion upsample (EG=4) extrapolates over the last 3 columns with weights down to -0.75, not -0.5; (3) the proposed fix's premise that the coarse grid is "genuinely periodic in x" is only partly true — stamp distances wrap (line 268) but the fbm/domain-warp noise terms use unwrapped nx, so wrapping the interpolation reduces but does not eliminate the seam discontinuity (the cross-fade is still needed).

**Fix:** Don't clamp ix below the wrap: use `const ix = (fx | 0) % ewW; const ixr = (ix + 1) % ewW; const dx = fx - (fx | 0);` so the final column interpolates toward the wrapped column 0 (the coarse grid is genuinely periodic in x since stamps wrap).

### 115. Final bilinear upscale clamps instead of wrapping X — negative-weight extrapolation and a dateline seam in both solvers
`src/sim/windSolver.js:605` · **LOW** · Bug · verdict: **CONFIRMED** · found by `climate`

windSolver's upscale uses `const ix = Math.min(wW - 2, fx | 0)` with no X wrap (lines 605-609): for the last 3 full-res columns fx reaches wW-0.25 so dx = fx-ix climbs to 1.75, giving bilinear weights of (1-dx) = -0.75 — linear EXTRAPOLATION past the second-to-last coarse column, never touching column 0, plus the same in Y at the bottom rows (dy to 1.75 extrapolating past the zero boundary row, which can manufacture reversed-sign wind). Probe on a seam-straddling landmass shows a discontinuity at x=0/x=W-1 (0.0032 vs typical 0.0006 adjacent deltas in smooth regions). moistureSolver.js:483 has the identical defect: `const ix = Math.min(mW - 2, fx | 0)` makes dx reach 1.5, so the `sxr = (ix + 1) % mW; // wrap X for seamless globe` on line 485 can never actually wrap — the comment is dead. Ironically the moisture ADVECTION loop already found and fixed exactly this bug (lines 226-228: 'clamping to mW-2 made fdx exceed 1 at the seam'). Effect: a few-pixel wind/moisture seam at the map's wrap column (open ocean on tectonic maps by construction of the seam-rotation, the Bering/Pacific on Earth maps) — mild, but it feeds every downstream consumer.

> **Verifier correction:** Claim is accurate as stated, with two refinements: (1) dx reaches its 1.75 (wind) / 1.5 (moisture) maxima only when W is divisible by WG=4 / by 2 respectively — for other widths the clamp still yields dx > 1 (e.g. 1.25) so the extrapolation seam persists, just smaller; (2) in moistureSolver the upscale output is clamped to [0.02, 1], so extrapolation there produces a seam but cannot manufacture out-of-range or reversed-sign values — sign reversal is only possible for wind, where bottom rows extrapolate against the never-written zero row wH-1 (windX/windY loops all run wy=1..wH-2).

**Fix:** In both upscales, mirror the advection-loop fix: `const ix = fx | 0;` (≤ wW-1 by construction), sample the right neighbor as `(ix + 1) % wW`, and keep dx = fx - ix in [0,1); clamp only Y (and use the wH-1 row itself rather than extrapolating past it).

### 116. sampleRealWind longitude wrap segment indexes the wrong cell — clamp instead of blend across 360°→0°
`src/realWindData.js:98` · **LOW** · Bug · verdict: **CONFIRMED** · found by `climate`

For lon in the final wrap segment [lons[nLon-1], 360) the bracket loop never matches and the fallback `if (i === nLon - 2) lonIdx0 = i;` sets lonIdx0 = nLon-2 (the second-to-last column) instead of nLon-1. lonIdx1 = nLon-1 then makes lonRange the ordinary inner spacing (~1.875° on the gaussian grid) and lonFrac = (lon - lons[nLon-2])/1.875 lands in (1, 2), which the clamp at line 133 pins to 1 — so the whole segment returns exactly the lons[nLon-1] column and never blends toward lons[0]. Because of the +180 map offset (line 75), data-lon 360/0 corresponds to the GREENWICH meridian at map center, so the un-blended step sits over the UK/France/West Africa rather than the Pacific. Magnitude is small (one ~1.9° band with a first-order discontinuity) but it is exactly on the most-looked-at part of the Earth map.

**Fix:** Set the wrap case to `lonIdx0 = nLon - 1` (so lonIdx1 wraps to 0 and the existing lonRange/lonFrac wrap arithmetic at lines 101-104, which already handles lonIdx1 < lonIdx0, does the blend correctly).

### 117. South-pole row samples ~87.5°N wind: descending-lat scan never brackets lat = -90
`src/realWindData.js:79` · **LOW** · Bug · verdict: **CONFIRMED** · found by `climate`

y = H-1 gives lat = 90 - 180 = exactly -90. With NCEP's descending lat array (90…-90), the bracket condition `lats[i] >= lat && lats[i+1] < lat` requires lats[i+1] < -90, which never holds, so latIdx0 stays 0. latFrac = (-90 - 90)/(87.5 - 90) = 72, clamped to 1 at line 132 — the bottom map row is filled with the wind of the lats[1] ≈ 87.5°N band. One row of Antarctica gets Arctic wind; harmless for gameplay (polar ice) but a real indexing hole, and it would widen to a band if a dataset not reaching the exact pole were ever used (any lat south of lats[nLat-1] falls through the same way).

> **Verifier correction:** Confirmed with corrections: the shipped dataset (data/global_wind.json) does NOT reach the poles — lat runs 88.54…-88.54 (94 Gaussian latitudes). So every map row with lat < -88.54 (e.g. the bottom ~5 rows at H=512, not just y=H-1) falls through the descending scan with latIdx0=0; latFrac = (lat-88.54)/(86.65-88.54) is large positive and clamps to 1, so those rows sample the 86.65°N band (lats[1]), not 87.5°N. Rows with lat > 88.54 also fall through, but their clamp (lf→0, index 0 = 88.54°N) coincidentally gives the correct nearest band, so only the southern edge is mis-sampled. Proposed fix (clamp fall-through to nLat-2 for the south, or handle out-of-range lat explicitly) is sound.

**Fix:** After the scan, detect fall-through for out-of-range lat (lat <= lats[nLat-1] for descending) and set latIdx0 = nLat - 2 (clamping to the southernmost segment); or scan with `lats[i+1] <= lat` on the last segment.

### 118. Disabling CLIMATE_VAR mid-run freezes the last climate anomaly into fertility forever
`src/sim/peopleSim/climate.js:32` · **LOW** · Bug · verdict: **CONFIRMED** · found by `climate`

`if (!T.CLIMATE_VAR) return;` exits before touching world.climMod, but territory.js (lines 390, 405, 438) keeps multiplying fertility by the existing cm array whenever it is non-null. Failure scenario: a volcanic winter fires (shock 0.14 → high-latitude climMod ≈ 0.79), the user toggles 'Dynamic climate' off in the tuning UI to stop it — and instead the depressed multipliers are frozen in permanently: every subsequent tick still harvests at the volcanic-winter level, with no code path that ever resets it while the flag is off.

> **Verifier correction:** Bug confirmed as stated, but the magnitude example is off: a single volcanic shock of 0.14 gives high-latitude climMod ≈ 1 − 0.14×0.4 ≈ 0.94 (0.79 requires accumulated shock + cold index ≈ −0.52; the clamp floor is 0.70). The frozen multiplier is whatever the last update computed, anywhere in [0.70, 1.15].

**Fix:** On the disabled branch, if world.climMod exists and isn't all-1, fill it with 1 (or set world.climMod = null) before returning, so toggling the feature off returns the world to neutral climate.

### 119. Endorheic/ice tiles can strand accumulated flow with no terminal-lake formed
`src/sim/riverGen.js:248` · **LOW** · Bug · verdict: **CONFIRMED** · found by `hydro-pipeline`

Step 2 sets flowDir=255 for any tile with tTemp<0.12 (ice, line 248), and Step 3 gives ice tiles runoff 0. A land river flowing toward an ice tile terminates there (accumulate: `if(d===255)continue`), and the drainsTerminal trace at line 425 marks that path terminal=1 even when the ice tile sits directly on the ocean shore. Such a river then (a) is classified against the stricter TERMINAL_STRICT bars and (b) has transmission loss applied though it physically reaches the sea. Rare (needs a river mouth buried under a sub-0.12-temp coastal tile) but it mis-classifies genuinely exorheic polar rivers as closed-basin.

> **Verifier correction:** Trace holds: line 248 leaves ice tiles at flowDir=255 (line 242 fill), Step 2 does not exclude ice tiles as flow TARGETS (lines 253-266, only drop>0 is checked), so a warm tile can drain into a shore ice tile; the trace then hits d===255 at line 425 and stamps the whole upstream path drainsTerminal=1 with no trueOcean check (that check only runs when the next tile is sub-sea, line 429). One correction: the transmission loss (lines 447-452) is moisture-gated — aridity=0 when tMoist>=0.45 — so on a humid polar coast only the TERMINAL_STRICT 2.5x classification bar (lines 488, 492-494) actually bites; flow loss occurs only if the terminal-marked path is also arid (<0.45 moist). Also the mis-mar

**Fix:** When the downstream trace hits a flowDir=255 tile, check whether that tile is adjacent to trueOcean (or is ice over/next to ocean) and treat it as exorheic (verdict 0) rather than terminal.

### 120. makeSettlement does not register the newborn in world._byId, so mid-tick settlements are invisible to every byId lookup for the rest of that tick
`src/sim/peopleSim/settlement.js:325` · **LOW** · Bug · verdict: **CONFIRMED** · found by `settlement`

index.js rebuilds `world._byId` at the top of each tick (index.js:172-176). makeSettlement pushes to `world.settlements` (line 325) but never does `world._byId.set(id, s)`, and findSettlementById only lazily builds the map `if (!world._byId)` — which is always false during a tick. Settlements born mid-tick (maybeCrystallize, urban genesis, sea colonies — all run AFTER the byId rebuild, index.js:229, sea.js:597) therefore return null from findSettlementById / world._byId.get for every later pass that tick (roads' findById at roads.js:1147 has the same lazy-only fallback, shocks, foodHierarchy, conquest). Mostly benign (one-tick lag before the newborn participates), but it also means a daughter founded from a parent that was ITSELF founded earlier in the same tick (chain founding) inherits nothing — seedAncestry/orgApt/crops all do findSettlementById(parentId) and silently get null, dropping the ancestry/aptitude/crop inheritance the founding is supposed to carry.

> **Verifier correction:** Confirmed as stated, with one scoping note: in the chain-founding case only ancestry (seedAncestry, settlement.js:190), _orgApt (317), and crop inheritance (336) are dropped — culture and knowledge inheritance survive because the crystallize/colony callers read the donor/parent object directly and pass them in opts, not via findSettlementById. Pre-tick founding (state.js cradles, worker seeding) is unaffected since _byId is still null there and the lazy build works.

**Fix:** In makeSettlement, after the push: `if (world._byId) world._byId.set(id, s);` (and mirror in any other entity-creation path).

### 121. freshCountryId can hand a seceding bloc the id of a LIVE country, silently merging it into a distant realm
`src/sim/peopleSim/conquest.js:647` · **LOW** · Bug · verdict: **CONFIRMED** · found by `conquest`

Country ids are founder-settlement ids. freshCountryId only checks the id is distinct from the PARENT (`bloc[0].id !== c.id`), never that it is not currently in use by another live country. Scenario: city X founded country X; empire c conquered X while country X survived as a rump elsewhere (its other members keep countryId === X). Ages later X assimilates (`_homeland` cleared after HOMELAND_MEMORY, line 1666-1672) and then leads a shedPatch / rebel / declareIndependence breakaway: newId = X -> the whole bloc gets countryId X and next rebuildCountries merges it with the far-away rump into ONE country (strongest member becomes capital) — territory teleport-merged across the map with no event. restoreNations explicitly guards against exactly this (`if (live.has(H)) continue; // a rump still flies the old flag — reunify, don't clone`, line 815), but the generic secession paths have no such gate; when the homeland link has faded the merge is not a reunification at all, just an id collision.

> **Verifier correction:** The merge is not fully silent: rebel and declareIndependence log a polity.seceded event (lines 1100, 1164), but it mislabels the collision as a fresh breakaway; no merge/restored event fires since ensurePolity (entities.js:39-46) returns the live rump's record unchanged. Otherwise the claim holds as stated.

**Fix:** In freshCountryId, skip candidate ids that are keys of world.countries (live realms), falling through to the next bloc member; keep the deliberate homeland-reunification path in restoreNations as the only merge route.

### 122. spendInfrastructure has no treasury floor — extreme SPEND_* slider settings drive the treasury negative (coin minted from nothing)
`src/sim/peopleSim/conquest.js:1296` · **LOW** · Bug · verdict: **CONFIRMED** · found by `conquest`

mon is bounded by budget and relief re-checks `Math.min(Math.max(0, gov.treasury - reserve), ...)` (line 1299), but infra is `budget * T.SPEND_INFRA` computed from the pre-monument budget and spendInfrastructure decrements gov.treasury by the full amount with no floor (line 1346). With T.SPEND_MONUMENT and T.SPEND_INFRA both user-set to 1.0 (each slider allows max 1, defaults sum to 0.95), mon consumes the whole surplus (treasury falls to reserve), then infra books another full budget of member payouts and pushes treasury to reserve - budget — negative whenever budget > reserve. Members received wealth not backed by treasury coin (conservation break), and next pass armyPaid = min(max(0,treasury), bill) = 0 -> solvency 0 -> artificial fiscal-collapse spiral triggered purely by a slider combination.

> **Verifier correction:** Claim correct as stated, with one small addition: the below-reserve excursion requires the monument stage to actually fire, which needs a capital settlement (`if (mon > 0.01 && cap)`, conquest.js:1289); with SPEND_INFRA=1.0 alone treasury bottoms out exactly at the reserve, not below it. Severity=low is accurate since defaults (0.15+0.2+0.6=0.95) never exceed 1.

**Fix:** Recompute the remaining spendable each stage (as relief does): `const infra = Math.min(budget * T.SPEND_INFRA, Math.max(0, gov.treasury - reserve));` or normalize the three SPEND_* shares when their sum exceeds 1.

### 123. Connectivity release flood is 4-connected while every claiming pass is 8-connected — diagonal-only marches are spuriously released
`src/sim/peopleSim/countryTerritory.js:626` · **LOW** · Bug · verdict: **CONFIRMED** · found by `territory-identity`

The country Dijkstra claims with 8 neighbours (lines 494-500), closeRealmGaps' nearest-country flood is 8-connected (line 893-895), and smoothCountryBorders votes over 8 — but mergePersistentTerritory's reachability flood uses only the 4 orthogonal neighbours (line 626 `const ns = [ty*tw+xm, ty*tw+xp, ty>0?ti-tw:-1, ty<th-1?ti+tw:-1];`). Failure scenario: a march lobe attached to the realm's core only through a diagonal step (which the 8-connected Dijkstra produces routinely along coastlines and mountain flanks, and which the majority smoother can thin to) is judged "not contiguous" and wiped to wilderness at line 633, then cannot be re-asserted (prev next pass holds -1). The realm's own live reach re-claims it a pass later, and the cycle repeats — a flickering fringe at exactly the ragged edges the smoothing pass was added to calm.

> **Verifier correction:** The 4-vs-8 connectivity mismatch and spurious release are confirmed as stated, but the symptom is not a "flickering fringe": the fresh Dijkstra claim and the 4-connected release both occur within the same computeCountryTerritory pass before the final map is stored, so diagonal-only-connected march lobes are stably wiped every pass — land within live reach persistently renders as wilderness at coast-corner/thinned necks rather than alternating claimed/wild.

**Fix:** Use the same 8-neighbourhood in the merge's connectivity flood as in the passes that create the geometry (add the four diagonal indices to `ns`), or define claim-connectivity as 4-connected everywhere consistently.

### 124. Sea flood refuses to relax tiles tentatively owned by another port, inflating boundary distances and lane costs
`src/sim/peopleSim/sea.js:326` · **LOW** · Bug · verdict: **CONFIRMED** · found by `trade-network`

`const no = owner[ni]; if (no >= 0 && no !== oid) continue;` blocks relaxation even when the current wave would give the tile a strictly SMALLER dist. In a correct multi-source Dijkstra a tentative (not yet popped) tile is reassigned when a cheaper source reaches it; here first-touch wins. Failure scenario: port A's frontier tentatively claims tile W at dist 10; port B's frontier arrives while W is still in the heap and could set dist 6 — skipped, so W finalizes at dist 10 owned by A. The lane-cost formula `cost = dist[ti] + SEA_STEP*mul + dist[nj]` (sea.js:353) then overestimates the A–B route, and the single-voyage gate `if (e.cost > Math.max(budgetA, budgetB)) continue;` (sea.js:380) can reject a direct lane that is genuinely within one port's range — near the budget line, two ports that should trade directly don't (or only via a relay chain). The error is bounded (~a tile-step or two per boundary tile) but systematic along every port-water boundary.

> **Verifier correction:** The owner test at sea.js:326 does block strictly cheaper cross-owner relaxations, because edge weights into the same tile vary by direction (diagonal √2, windMul ±0.5, iceMul, wobble), so first-touch can win over a cheaper later wave. But Dijkstra pop order bounds the inflation to less than one incoming edge-weight spread per boundary tile (a fraction of SEA_STEP·√2·windMul·iceMul) — the claimed dist-10-vs-6 example cannot occur, since the blocking source's parent necessarily had the smallest dist among the tile's relaxing neighbors. The lane-cost overestimate is further attenuated by the min over all boundary adjacencies (sea.js:358), though a marginal flip of the budget gate at sea.js:380 

**Fix:** Drop the owner test in the relaxation and rely purely on `if (nd < dist[ni])` — reassigning owner/prev on a cheaper relaxation keeps prev chains consistent and yields the true cheapest-port Voronoi the edge/lane logic assumes.

### 125. Embark-tile dedupe silently excludes a co-located second port from the entire maritime network, permanently
`src/sim/peopleSim/sea.js:190` · **LOW** · Bug · verdict: **CONFIRMED** · found by `trade-network`

`if (s._isPort && !portByEmbark.has(s._embarkTile)) { ports.push(s); ... }` — when two settlements' nearest water tile (within EMBARK_RADIUS=4, cached forever in s._embarkTile) is the SAME tile, only the one earlier in world.settlements order becomes a port. The loser is not seeded, gets no budget, never appears in adj/pd, and since every pass starts with `s._seaReach = null`, it has NO sea trade at all — not even as a passive destination (unlike small/no-nav ports, which are deliberately seeded with budget 0 so fleets can still reach them). Failure scenario: two towns on the opposite shores of a 1-tile bay mouth both resolve to that water tile; the higher-id town is locked out of sea lanes, sea-borne grain, and colonisation forever, purely by array order — invisible and permanent because _embarkTile is never recomputed.

> **Verifier correction:** Minor addition: line 189 still sets s._isPort = true for the excluded settlement, so any other code reading _isPort sees a "port" with no sea reach; the loser is also excluded from colonisation eligibility, not just trade. Otherwise the claim is accurate as stated.

**Fix:** When the best water tile is taken, let findEmbarkTile (or the port loop) fall back to the next-nearest free water tile; or key portByEmbark per pass and seed the duplicate from the same tile with its own id at dist 0 handled as a co-seed.

### 126. foodHierarchy's header contradicts its implementation (barter fallback vs strict coin-gating), and _foodNet is never reset for nodes unreachable through a liege cycle
`src/sim/peopleSim/foodHierarchy.js:39` · **LOW** · Bug · verdict: **CONFIRMED** · found by `economy`

Two documentation/robustness defects in one file. (1) The header's pass-3 description (lines 38-41) says "a cash-poor buyer simply under-pays (barter) — people never starve for lack of coin", but the actual sweep is the opposite by design (lines 144-146: "limited by its spare coin (STRICT: no coin, no grain — the un-bought grain stays with the seller ... no more free barter auto-ship)"). One of the two comments is stale; the strict model means a coin-poor city absolutely CAN be food-limited by lack of coin, which changes how anyone debugging a starving metropolis reads this file. (2) Line 126 resets `s._foodUp = 0; s._foodOffer = 0;` each pass but never `_foodNet`. Every node reachable from a root gets `_foodNet` refreshed in its post-order frame (line 184), but a node whose liege chain forms a cycle (possible transiently after absorption/secession between polity passes — the code already carries a `seen` cycle guard at line 160, acknowledging cycles can occur) is in no root's subtree, is never visited, and keeps last pass's `_foodNet` forever; settlement.js:1985 (`netLand = s._foodNet !== undefined ? s._foodNet : landFood`) then feeds its population from a permanently stale number.

> **Verifier correction:** Only defect (1) is real: the header's pass-3 barter description (foodHierarchy.js:34-40) is stale and contradicts the strict coin-gated implementation (lines 143-150, 173) — a doc-only fix. Defect (2) is refuted: liegeId is written only by buildHierarchy (conquest.js:604/612), which reassigns every member of a country in one pass with strictly-higher-tier lieges and a liegeId=-1 capital root, so the pointer graph is provably acyclic at all times (absorption/secession changes countryId, not liegeId, and any cycle edge's most recent write would have rewritten the whole cycle in the same acyclic pass); ids are never reused (settlement.js:218-219). Every settled node is therefore reachable from 

**Fix:** (1) Rewrite the header to match the strict coin-gated model. (2) Reset `s._foodNet = s._storableSupply || 0` (or undefined) in the same loop that resets _foodUp/_foodOffer, so unvisited cycle members degrade to self-sufficiency instead of a frozen value.

### 127. earth_sim carries ~7 named-geography outcome patches — acceptable for a real-Earth preset, but each marks a mechanism still missing from the shared solvers
`src/sim/worldgen.js:464` · **LOW** · Cardinal rule 2 (fitted outcome) · verdict: **CONFIRMED** · found by `worldgen-tectonics`

The earth_sim climate pass contains literal case-detected geographic corrections: the Saharo-Arabian Gaussian 'centred on the Empty Quarter (~46°E, ~21°N)' (arabiaDry, lines 464-466), the Patagonian rain shadow at ~66°W (patShadow, 486), the South-Asian monsoon foreland floor at ~91°E (foreland, 502-505), the interior-Asia moisture lift at ~86°E (asiaLon/asiaLat, 513-515), the Andes low-level jet at ~60°W (llj, 428-430), and the hard-coded Gibraltar strait (EARTH_STRAITS, 62-64). By the letter of the Second Cardinal Rule these are painted effects, not causes (`if (region === 'nile') fertility *= 3` shaped). They are defensible here — the preset's stated job is to match real Earth, and each is documented with the physical mechanism it stands in for (Somali-jet upwelling, sub-resolution cordillera, unresolved valley winds). The real cost is the one the rule warns about: each patch conceals a solver deficiency (coast-parallel monsoon jets, sub-grid orography, orographic channeling) that then remains broken for every emergent tectonic world, where no patch exists and rule 2 forbids adding one.

> **Verifier correction:** Minor: the finding lists six patches, not seven, and the comment at lines 410-416 notes some earlier geographic hacks (east-coast spare, equatorward spillover) were already deleted when the two-season solve landed — evidence the proposed "patches shrink as mechanisms are built" process is already the codebase's practice.

**Fix:** No code change required now; treat the patch list as a backlog. When a missing mechanism is built into windSolver/moistureSolver (e.g. sub-grid orographic amplification from elevation variance, coast-parallel jet drying), delete the corresponding hand patch and re-validate earth_sim — the patches should monotonically shrink, never grow.

### 128. solveMoisture's temperature parameter is dead in every caller — the internal latitude fallback always runs
`src/sim/moistureSolver.js:60` · **LOW** · Dead code · verdict: **CONFIRMED** · found by `climate`

Both call sites pass a still-all-zeros temperature array: tectonicGen.js calls solveMoisture at line 1150 but first writes temperature[] at line 1249; worldgen.js (earth_sim) calls it at lines 277-278 but computes temperature in the final combination loop afterwards. So the hasTemp probe (lines 60-63) always finds zeros and the hard-coded latitude→temperature estimate at lines 88-91 is what every moisture solve actually uses — the real advected temperature (ocean currents, maritime warmth, continental cold) never influences precipitation capacity. Worse, the probe itself is fragile: it scans only the first min(1000, W*H) full-res indices, i.e. a fraction of the NORTH-POLE row; if a caller ever did pass real temperatures whose polar values clamp to ≤0.001 (tectonicGen's own curve gives 0 at lat=1), the probe would still conclude 'no temperature' and silently discard them.

> **Verifier correction:** Minor nuance: the zero-temperature case is explicitly anticipated for tectonic mode by the solver's own comment (moistureSolver.js:58-59, "may be all zeros in tectonic mode where moisture is computed before temperature"), so this is a known-intentional fallback there — but the finding is correct that the earth_sim caller also passes zeros, making the parameter dead in every existing caller. Also, polar cells under tectonicGen's curve are not strictly guaranteed ≤0.001 (noise terms sg(...)*0.08/0.10 and maritime moderation could lift a rare coastal polar cell above the threshold), though the probe would remain unreliable as claimed.

**Fix:** Either compute temperature before moisture and pass it (letting warm currents feed evaporation/capacity emergently — the better, mechanism-first fix), or drop the parameter and the probe entirely and own the internal estimate. If the probe stays, sample scattered mid-latitude cells, not the polar corner.

### 129. windSolver STEP 4 terrain gradients are computed and never used
`src/sim/windSolver.js:240` · **LOW** · Dead code · verdict: **CONFIRMED** · found by `climate`

gradX/gradY (lines 240-249, two Float32Array(N) plus a full loop, labeled 'for Froude blocking') are never read anywhere in the function — the FINAL deflection pass recomputes gx/gy locally from wElev each pass (lines 546-547). Pure wasted allocation and compute on every solve.

**Fix:** Delete STEP 4, or have the deflection pass consume the precomputed arrays (they are loop-invariant, so precomputing once and reusing across the 80 passes would actually be the faster option).

### 130. localPByCountry is never called, and inflation.js's comments describe price effects (army wages, building costs, food prices) that no code implements
`src/sim/peopleSim/inflation.js:150` · **LOW** · Dead code · verdict: **CONFIRMED** · found by `economy`

A repo-wide grep shows `localPByCountry` has zero callers (only `displayPByCountry` is used, by the worker for the HUD). The module's comments repeatedly claim broader reach: line 24 "All sim prices that should respond to inflation read localP", lines 102-104 "Used by localP() / localPByCountry() to scale wages, food prices, building costs", and the P_MAX widening rationale at lines 34-39 ("so sustained monetary expansion keeps registering as real fiscal pressure on army wages / building costs ... the realm genuinely feels the squeeze"). In reality the ONLY sim consumer of localP is the Hume competitiveness term in roads.js:964, grain pricing deliberately opted OUT (foodHierarchy.js:108-114 "the (b) nominal-inflation model deliberately does NOT scale grain by localP"), and conquest.js army wages never read it. So P_MAX=3.0 is a constant tuned for a squeeze that cannot occur, and a future reader will mis-model the system from the comments.

> **Verifier correction:** Claim holds as stated. Additions: localP is also imported by tools/probe_seatrade.mjs (diagnostics only, not sim); docs/currency-system.md:208 already states the truth ("army wages & colony grants (conquest) — now use BASE prices, NOT × localP"), so the stale text is inflation.js's own header (lines 24-26), the P_MAX rationale (lines 34-39), and the _inflP map comment (lines 102-105), plus a leftover contradictory comment at conquest.js:1176-1179 sitting directly above the realmP=1 override.

**Fix:** Either wire localPByCountry into the army wage bill / building costs as the comments intend (making inflation a real fiscal force), or delete localPByCountry and rewrite the comments to state the truth: P currently drives only Hume trade-balance competitiveness plus the display ticker.

### 131. Several per-tick rate processes in this file are not _dt-scaled, so their history-pace changes with SIM_GRANULARITY
`src/sim/peopleSim/settlement.js:768` · **LOW** · Determinism · verdict: **CONFIRMED** · found by `settlement`

The file is inconsistent about the granularity contract. Scaled correctly: growth, famine die-off, mining, coin loss, aptitude ratchet, sciMul, diffusion, wither window (2000/_dt), isolation cutoff (2000/_dt). NOT scaled: (a) `CONQUEST_RECOVERY = 5000` ticks — sackPenalty (lines 768-775) recovers over 5000 TICKS, which is 5000/G history-units, so at G=8 a sacked city recovers 8× faster in history than at the calibrated baseline; (b) agglomeration lock-in `s._specStr` rises by T.AGGLOM_RISE and decays by T.AGGLOM_DECAY per TICK (lines 843-846, AGGLOM_W default 0.7, active); (c) cash-crop land drift `s._cashFrac += 0.04 * (target - cashFrac)` (line 712); (d) credit creation `delta * T.CREDIT_RATE` (line 571, default-off). Each converges G× faster in history-time at higher G — same class of divergence as the urbanise floor but milder (equilibria unchanged, approach speed wrong).

**Fix:** Multiply each rate by `(world._dt || 1)`: compare sack age against `CONQUEST_RECOVERY / (world._dt || 1)`, scale AGGLOM_RISE/DECAY, the 0.04 cashFrac rate, and CREDIT_RATE by _dt.

### 132. s._credit not persisted while the credit it tracks is inside the persisted s.wealth — money supply inflates across save/load when CREDIT_RATE is enabled
`src/sim/persist.js:39` · **LOW** · Save/load · verdict: **CONFIRMED** · found by `settlement`

updateWealth's credit layer (settlement.js:565-574) is bounded by tracking `s._credit` separately: creation reads `base = wealth - _credit` and contraction can only unwind `min(-delta, wealth, cur)`. `wealth` is saved WITH the conjured credit inside it, but `_credit` is not in SETT_FIELDS. On load, `cur = 0`, so `base` = the full credit-inflated wealth and the hub immediately conjures a fresh CREDIT_MAX_MULT layer on top of the old one; the collapse branch can never call in the pre-save credit. The closed money supply (which inflation.js's quantity-theory price level depends on) jumps on every save/load cycle. Low severity only because T.CREDIT_RATE defaults to 0 (experimental) — but it will bite silently the day the lever is turned on.

**Fix:** Add "_credit" to SETT_FIELDS (persist.js:28-44).

### 133. MIX_FLOOR erases sub-5% conversion increments — weak/clashing faiths can never enter a settlement; low slider values silently disable conversion
`src/sim/peopleSim/faiths.js:241` · **LOW** · Bug · verdict: **unverified-skipped** · found by `identity-culture`

faiths' normalizeMix pops any entry below MIX_FLOOR=0.05: `while (mix.length > 1 && mix[mix.length-1][1] < MIX_FLOOR) mix.pop();`. mixFaithToward pushes a NEW faith with share exactly frac = `T.FAITH_SPREAD_RATE * str * 3` where str ≤ 0.5 — max 0.0825 at the default rate 0.055. Any conversion pressure with str < 0.303 (bw < 0.91) is therefore erased the same call, every pass, forever: e.g. a state church with minimum zeal (0.3) pressing a clashing-affinity province gives bw = 2.4·0.84·0.4 ≈ 0.81 → frac ≈ 0.044 < 0.05 — the state faith can never gain its first foothold there no matter how many centuries pass. Folk faiths (FOLK_PULL 0.45) can never spread into a new settlement at all. And because the erasure threshold is fixed while frac scales with the live tuning lever, setting the 'Conversion speed' slider below ~0.034 makes ALL new-faith entry silently impossible (increment ceiling 0.5·3·0.034 = 0.051 ≈ floor) while the UI suggests conversion is merely slower.

**Fix:** Exempt the just-added target from the floor-pop for its first appearance (let it accumulate across passes), or accumulate sub-floor pressure in a per-settlement staging value and commit it once it crosses MIX_FLOOR.

### 134. familyName vowel-strip regex: 'ia'/'ua' alternatives are unreachable, producing 'Velariic'-style stems
`src/sim/peopleSim/cultures.js:217` · **LOW** · Bug · verdict: **unverified-skipped** · found by `identity-culture`

`root.name.replace(/(a|e|i|o|u|ia|ua)$/i, "")` — regex alternation is left-to-right, so for a name ending in 'ia' the single-char 'a' matches first at the end anchor and 'ia' can never win. 'Velaria' → strips only 'a' → 'Velari' + 'ic' = 'Velariic' (double i), where the comment's clear intent is 'Velaric'. Every '-ia'/'-ua' root family name renders with the doubled-vowel artifact.

**Fix:** Order longer alternatives first: `/(ia|ua|a|e|i|o|u)$/i`.

### 135. slave.revolt is logged with no polity field, so it is indexed only under an s: key that nothing ever queries — the event is invisible in every chronicle, tradition and export view
`src/sim/peopleSim/settlement.js:704` · **LOW** · Bug · verdict: **unverified-skipped** · found by `narrative`

`logEvent(world, "slave.revolt", { s: s.id, sName: s.name || "a settlement" })` carries no `polity`, so indexKeys (events.js:22-34) files it only under "s:<id>". Every consumer queries "p:" keys exclusively (getChronicle chronicle.js:23, perspectiveChronicle historiography.js:135, exportHistory historiography.js:234 — verified by grep: no other eventsFor call sites exist), and slave.revolt is not in TRAVELS either. A NARRATE template exists for it (events.js:237) and categoryOf maps it to "society", but it can never reach a reader. Failure: a realm whose plantation economy collapses in a slave revolt shows nothing in its chronicle, while the sibling events (city.slaver, city.plantation, chronicle.js:99/94) DO carry polity and appear.

**Fix:** Add `polity: s.countryId` to the slave.revolt logEvent call (mirroring settlement.abandoned at settlement.js:2257).

### 136. Founding-myth date drifts earlier on every read — the myth is recomputed from world.step, not fixed at burn time
`src/sim/peopleSim/historiography.js:113` · **LOW** · Bug · verdict: **unverified-skipped** · found by `narrative`

foundingMyth computes `claimedAge = Math.round((world.step - p.foundedStep) * stretch); since = Math.max(1, world.step - claimedAge)`. Algebraically since = foundedStep − (world.step − foundedStep)·(stretch − 1): with stretch ∈ (1, 1.45] the claimed founding date moves further into the past linearly as world.step grows. The stretch roll itself is deterministic, but the rendered step is a function of READ time — open the chronicle panel twice a few thousand ticks apart and the same realm's "age of legends" founding has visibly slid backwards, again contradicting the "stable across reads" contract in the header. (Arguably legends DO inflate — but then it should be framed as intended, and the sort anchor shouldn't wander.)

**Fix:** Anchor the exaggeration at the moment of loss instead of the read: use the FIRST sack step as the reference, e.g. claimedAge = (sackSteps[0] - foundedStep) * stretch, since = sackSteps[0] - claimedAge — fixed forever after the burn.

### 137. Invariant money/population conservation tallies ignore ships in transit — phantom drift that can mask real leaks
`src/sim/peopleSim/invariants.js:50` · **LOW** · Bug · verdict: **unverified-skipped** · found by `core-loop`

checkPeopleSimInvariants sums coin over settlements plus live polity treasuries, and people over settlements, but never iterates `world.ships`. sea.js debits real coin and people onto each colony ship at launch (line 521-532: `const endow = Math.min((A.wealth||0)*COLONY_ENDOW_FRAC, COLONY_ENDOW_CAP); A.people -= COLONY_PEOPLE; … { people: COLONY_PEOPLE, wealth: endow }`) and credits them on arrival. Failure scenario: a late-game colonisation wave has 20 ships at sea carrying up to 5000 coin each — `world.debug.totalCoin` dips ~100k and recovers over the voyages. A human or test watching the closed money supply (the file's stated purpose: 'watch the closed money supply for drift') sees sawtooth drift where none exists, and a genuine leak of the same magnitude timed with voyages is indistinguishable from transit.

**Fix:** Add `for (const sh of world.ships) { coin += Math.max(0, sh.wealth || 0); people += Math.max(0, sh.people || 0); }` to the tally (and consider the same for peopleSimStats totals).

### 138. Faith/war memory maps (_schismAt, _lastSyncretismAt, _warSeenAt) not saved — cooldowns reset and ongoing wars re-log 'war.began' after load
`src/sim/persist.js:126` · **LOW** · Bug · verdict: **unverified-skipped** · found by `persistence-workers`

faiths.js:492/532 keeps `world._schismAt` (rootFaithId → step of last schism, enforcing a per-family cooldown) and faiths.js:549/573 `world._lastSyncretismAt` (world-wide syncretism cooldown); armies.js:630-636 keeps `world._warSeenAt` (attacker:defender → last step seen, deduplicating 'war.began' chronicle events within WAR_MEMORY). None are saved. Failure scenario: (1) a schism fired 10 ticks before the save — after load the cooldown map is empty so the same faith family can schism again immediately, which the uninterrupted run forbids; (2) for every front still open across the save, `last === undefined` on the first post-load war pass, so a duplicate 'war.began' chronicle entry is logged for a war the saved event log already narrates — the realm's chronicle shows the same war beginning twice.

**Fix:** Add all three to the tables block (mapToArr/arrToMap; _lastSyncretismAt is a plain number). They are tiny and step-keyed, so they round-trip exactly.

### 139. Society (Labour) view is missing from the neutral-grey base branch — its legend says 'grey land is free' but wilderness renders full terrain colours
`src/WorldSim.jsx:1579` · **LOW** · Bug · verdict: **unverified-skipped** · found by `ui-render`

The grey base is gated on `vm==='culture'||vm==='faith'||vm==='language'||vm==='ancestry'` (line 1579); 'society' falls through to the terrain else-branch (1589). The overlay then paints the coerce heat (`c=v<0.05?"#5e626b":…`, line 2047) only over tiles inside a settlement's BFS disk. Failure scenario: open Economy→Labour — settled regions show grey/crimson as designed, but all unsettled land shows ordinary terrain greens/tans, while the on-screen legend (line 3984-3988) asserts 'grey land is free', making free-vs-wilderness unreadable and the view inconsistent with its four sibling identity lenses.

**Fix:** Add `vm==='society'` to the grey-base condition (and to BASE_CACHE_VIEWS per the caching finding).

### 140. A pending save-load is silently discarded if the sim worker fails asynchronously
`src/WorldSim.jsx:955` · **LOW** · Bug · verdict: **unverified-skipped** · found by `ui-state`

finalizeWorld consumes the pending save eagerly: `const _pend=pendingSaveRef.current; if(_pend){pendingSaveRef.current=null;sw.postMessage({type:'load',json:_pend,genMeta:_gm});}` (lines 970-971). If the worker then fails to boot, `sw.onerror` runs the fallback: `peopleRef.current=initPeopleSim(w,{...})` (line 955) — a FRESH sim, because the save JSON was already nulled out and handed to the now-dead worker. The synchronous-throw path (lines 980-983) handles this correctly with `loadWorld(_pend2)`; only the async onerror path loses the save. Failure scenario: user on a browser where the inlined worker's script errors at startup loads a 50k-step save → gets a pristine step-0 world with no error dialog (only a console.warn).

**Fix:** Stash the save JSON in a local (`const pend=pendingSaveRef.current`) and, in onerror, prefer `loadWorld(pend)` over `initPeopleSim` when a load was pending; only null pendingSaveRef after a successful first snapshot (or keep a copy until then).

### 141. Azgaar import with empty/malformed cells silently produces an all-NaN world instead of an error
`src/mapImport.js:117` · **LOW** · Bug · verdict: **unverified-skipped** · found by `ui-shell`

parseAzgaarJSON only validates `pack.cells` existence (line 16). If `cells.h` is present but empty (n=0), or cells.i/h are objects without `.length` (n undefined → asArray returns zeros of length NaN), `nearest()` returns -1 for every pixel and line 117 reads `const ah = h[ci]` = `h[-1]` = undefined; `undefined < 20` is false so line 120 computes `0.001 + (undefined-20)/80*0.55` = NaN for the entire elevation field. The import 'succeeds' (`setImportStatus('Azgaar map loaded (0 cells…')`), and the NaN terrain then propagates into buildTerritory/peopleSim with undefined behavior (NaN is neither ocean nor land in `elevation[i] <= 0` tests). Failure scenario: user exports Azgaar's 'Minimal' JSON variant or a hand-edited file → blank/undefined world with no error message.

**Fix:** In parseAzgaarJSON, validate `n > 0` and that h has numeric entries; throw the same friendly 'Not a valid Azgaar Full-JSON export' error otherwise.

### 142. river/lake/floodplain/delta/oasis all alias ONE shared Uint8Array in imported worlds
`src/mapImport.js:181` · **LOW** · Bug · verdict: **unverified-skipped** · found by `ui-shell`

Both rasterizeAzgaar (lines 157, 180-181: `const empty = new Uint8Array(W*H); … river: empty, lake: empty, floodplain: empty, delta: empty, oasis: empty, swamp: empty`) and rasterizeHeightmap (lines 236-240) return SIX feature fields referencing the same buffer. The import handler happens to replace `w.swamp` with a fresh array (WorldSim.jsx:2585), but river/lake/floodplain/delta/oasis stay aliased. A grep found no current writer (`\.(river|lake|floodplain|delta|oasis)\[..\] =` has zero matches — rivers are regenerated onto `w.rivers` by buildTerritory), so this is latent — but any future code that marks e.g. a floodplain tile on an imported world would simultaneously mark it river+lake+delta+oasis, a bewildering corruption to debug.

**Fix:** Allocate a separate Uint8Array per field (`river: new Uint8Array(W*H), lake: new Uint8Array(W*H), …`) — six × 1.8MB is negligible next to the Float32 fields already allocated.

### 143. EARTH_HEARTH_SITES: named-region hard-coded cradle coordinates, on by default for earth presets
`src/sim/peopleSim/state.js:322` · **LOW** · Cardinal rule 2 (fitted outcome) · verdict: **unverified-skipped** · found by `core-loop`

seedEarthHearths seeds cradles at hand-placed fractional coordinates for 'Nile', 'Mesopotamia' and 'Yellow River', with per-site search radii hand-tightened specifically to defeat the mechanism's own preferences ('the wide default let it drift … to the CASPIAN', 'drifted it ~7° NORTH … seeding China in the steppe'). This is the second cardinal rule's exact tell — naming the desired result in the code — and it is the DEFAULT on the earth preset (EARTH_HEARTHS def=1), while a genuinely emergent, working alternative exists in the same file (seedCradleVillage's fertility/river/circumscription scoring). It is initial-condition scripting rather than runtime scripting, it is documented, and it has an off switch, so this is a design tension rather than a hidden bug — but the fact that the algorithmic scorer picks the Caspian and the Ordos over the Crescent and the Zhongyuan is, by the project's own doctrine, 'a TRUE finding about a missing mechanism' (the score doesn't weigh what made those sites cradles) that the hard-coded list papers over.

**Fix:** Treat the two documented drift cases as calibration targets for the emergent scorer (e.g. the Caspian pick suggests inland-sea coasts need the seaFrac penalty or a drainage/outlet term; the Ordos pick suggests the temp band or growing-season term is too permissive), then flip EARTH_HEARTHS' default to 0 once the algorithmic sites land in the Crescent/Central Plain on the earth map unaided.

### 144. CAP_GEO 'geographic core' multiplier grants imperial capacity directly for sitting on a floodplain — painted effect, but OFF by default
`src/sim/peopleSim/conquest.js:1788` · **LOW** · Cardinal rule 2 (fitted outcome) · verdict: **unverified-skipped** · found by `hunt-fitted-outcomes`

conquest.js:1786-1792 computes `geoCore = fert[capTi] + 0.5*(tFlood?1:0) + 0.3*min(1, riverMag/3)` and multiplies the realm's hold capacity by `1 + T.CAP_GEO * geoCore`, with the comment stating the goal outright: 'a Nile/Mesopotamia/Yellow-River core holds a structurally larger empire than a steppe-centred realm... A path-INDEPENDENT source of size VARIETY.' The mechanism that SHOULD produce this already exists: a fertile floodplain densely settles (crystallize/territory), which raises capPower, seatBonus and tax base, which raise capacity. Adding a second, direct fert→capacity channel bypasses the causal chain and hard-wires the conclusion; the 0.5/0.3 weights have no independent physical meaning (why does the flood MASK, rather than the food it yields, confer administrative reach?). Mitigation: tuning.js:103 sets def 0, so the shipped sim never exercises it — it is an opt-in experiment, not live behaviour.

**Fix:** Retire the lever, or re-derive it through the mechanism: if river cores under-project empires, measure whether the capital's HINTERLAND population/food surplus (already tallied via territory.js catchments) is correctly feeding capPower, and fix that coupling instead of adding a parallel fert bonus. If a static geography term is truly wanted, base it on the surplus the catchment actually produces, not on tile-mask membership.

### 145. contactEpidemic receives an rng argument it never uses; VIRGIN_DUR is largely inert against the plague lifecycle
`src/sim/peopleSim/shocks.js:103` · **LOW** · Dead code · verdict: **unverified-skipped** · found by `war-shocks`

Two smaller issues in the virgin-soil path. (1) `contactEpidemic(world, passRng(world, 'contact'))` is called with an rng, and the signature is `contactEpidemic(world, rng)`, but the body never references `rng` — the whole scan is deterministic (torusDist + infect). The `passRng(world,'contact')` allocation and the parameter are dead. (2) `_virginUntil` is set up to VIRGIN_DUR(900)/_dt ticks ahead to make the wave 'keep killing', but a settlement's infectious window is only PLAGUE_DUR(250)/_dt, after which it burns out and gains PLAGUE_IMMUNE(4000)/_dt immunity that blocks re-infection well past the 900 window. So the 6× mortality only ever applies for ≤250 ticks per settlement; VIRGIN_DUR beyond PLAGUE_DUR is never realised (the ~90% die-off is in fact reached inside the 250-tick window at default PLAGUE_MORT, so the outcome is fine, but the constant is misleading).

**Fix:** Drop the unused rng param (or actually use it), and either shorten VIRGIN_DUR to match PLAGUE_DUR or extend infectiousness/allow re-infection during the virgin window if a genuinely longer wave is intended.

### 146. Mercator projection machinery is dead (useMercator hard-coded false) and buildAtlas' lake indexing is only correct by the RES=1/flat coincidence
`src/WorldSim.jsx:832` · **LOW** · Dead code · verdict: **unverified-skipped** · found by `ui-render`

`const useMercator=false;` (line 832) permanently disables the projection: CH_MERC, MERC_MAX and both Y-mapping functions reduce to clamped identities, yet every hot loop still pays the screenYtoDataY call. Worse, buildAtlas mixes index spaces that only coincide at RES=1/flat: the sea-halo check `!(lk&&lk[si]>=0)` (line 1123) indexes the tw×th lake array with a W×H data index, and the lake re-stamp loop `for(let i=0;i<N;i++){if(lk[i]<0)continue;…}` (lines 1313-1315) indexes it with a CW×CH canvas index. pipeline.js line 298 confirms tw=W/RES — so any future RES>1 or Mercator revival silently reads garbage lake data and stamps wrong pixels.

**Fix:** Either delete the Mercator path outright (simplifying the Y-mapping to identity and the atlas index handling to one space) or fix the two lk indexings to go through the tile-space conversion used at line 1073.

### 147. Azgaar tribeSeeds extraction is computed but never consumed
`src/mapImport.js:160` · **LOW** · Dead code · verdict: **unverified-skipped** · found by `ui-shell`

rasterizeAzgaar spends an O(states×n) loop (lines 160-177) finding each Azgaar state's highest cell to build `tribeSeeds`, and rasterizeHeightmap returns `tribeSeeds: []`. A repo-wide grep shows the only references are inside mapImport.js itself — nothing in WorldSim or the sim reads `w.tribeSeeds` (the legacy tribe model it fed was replaced by peopleSim, per the comment at WorldSim.jsx:930). Similarly the parsed `culture` array and `stateSet` are only used for the status message.

**Fix:** Delete the tribeSeeds extraction (and the culture read) — or, better, actually wire them into peopleSim cradle seeding so importing an Azgaar world with states means something; right now the doc comment implies it does.

### 148. ~40 hand-rolled probe/render/diag tools predate the pipeline and measure a non-app world
`tools/diag_countries.mjs:14` · **LOW** · Dead code · verdict: **unverified-skipped** · found by `tooling-tests`

The bulk of tools/ (probe_war, probe_min, probe_empires, diag_countries, render_map, probe_review, probe_audit, etc.) call `generateWorld`+`computeRivers`+`generateResources` directly and hand-build tCrop from `tileFert`/`cropSuitability` per tile — WITHOUT the river/lake moisture boosts, the floodplain tCrop override, or the tFlood/tAncestry passed to initPeopleSim. diag_countries.mjs:14 even calls `cropSuitability(tT,tM,tE,tC,riverMag)` with 5 args while the pipeline passes 6 (dropping bDist), so its volcanic/orogenic sparing differs too. They still import cleanly and RUN (not broken), but every one measures a world the browser never simulates — the exact drift the harness was created to eliminate. README already flags this ("Most predate the harness ... prefer the harness"). This is an inventory/cull recommendation, not a live bug.

**Fix:** Cull or port: migrate any probe still in use to `import { buildSim } from './_harness.mjs'`, and delete the clearly-obsolete ones (the Jun-29 batch that hand-rolls tCrop) to stop them being consulted during tuning. Grep target: tools importing `../src/sim/worldgen.js` directly rather than `_harness.mjs`.

### 149. SETT_FIELDS lists "_isColony" twice; worldgenUtils mkRng comment claims parity with peopleSim rng but is a different generator
`src/sim/persist.js:38` · **LOW** · Dead code · verdict: **unverified-skipped** · found by `hunt-determinism`

`SETT_FIELDS` contains `"_isColony"` at both line 35 and line 38 — harmless (second write is identical) but it obscures the field inventory that the save-completeness discipline depends on. Separately, src/sim/worldgenUtils.js:81 comments its `mkRng` is "same as peopleSim/rng.js's mkRng, kept" — it is a Park-Miller LCG while peopleSim's is splitmix32-seeded sfc32; both are fine and deterministic, but the stale comment invites someone to 'deduplicate' them, which would silently change every generated world for existing seeds.

**Fix:** Drop the duplicate "_isColony" entry; reword the worldgenUtils comment to state the generators intentionally DIFFER and must not be unified without breaking seed compatibility.

### 150. maxLakeTiles=800 is both a resolution-dependent cap and fitted to the Caspian's size
`src/sim/riverGen.js:575` · **LOW** · Design flaw · verdict: **ADVISORY** · found by `hydro-pipeline`

Line 574-575: `// Cap lake size — largest real lake (Caspian) is ~370k km² ≈ ~840 tiles at 21km` then `const maxLakeTiles = 800;`. The constant is (a) tuned to a named target (the Caspian at a specific '21km' tile size) and (b) a raw tile count, so its km² meaning changes with resolution. At the app's 1920×960 a tile is ~16.6 km on a side, so 800 tiles ≈ 220k km² — a hard cap well below the real Caspian; at 480×240 a tile is ~33 km so 800 tiles ≈ 870k km². The same physical basin is capped to very different real areas depending on grid, and the '21km' the comment assumes matches neither the app nor the default tools width.

**Fix:** Cap lake area in km² (convert via kmPerTile like the river bars) rather than a fixed tile count, and let the size fall out of the evaporation/inflow balance rather than pinning it to the Caspian.

### 151. Cosmetic passes' output is promoted to durable ledger land: gap-fill and enclosed-waste tiles become sticky marches
`src/sim/peopleSim/countryTerritory.js:615` · **LOW** · Design flaw · verdict: **ADVISORY** · found by `territory-identity`

The `prev` snapshot (lines 301-306) is taken from LAST pass's final `co` — i.e. AFTER fillEnclosedWaste, closeRealmGaps (D=9 default) and smoothing ran. March re-assertion (line 617 `if (p >= 0 && alive.has(p)) co[ti] = p;`) therefore re-asserts not just land the realm's reach once genuinely projected, but tiles a cartographer's convenience painted: the no-man's-land split of closeRealmGaps and enclosed-waste fill become permanent holdings the moment they appear once, released only by owner death or land-disconnection. Failure scenario: two realms briefly come within 2·D of each other; closeRealmGaps splits the buffer to the midline; they then drift apart (settlements die back) — but the filled midline strip stays both realms' forever, connected and alive, so the map shows a border contact that no longer has any mechanism behind it. The spec's "MARCH = keeps the fresh reach projection" is thus quietly widened to "keeps anything any pass ever painted", inflating claimed area beyond what the ledger justifies (the very quantity — claimed 33%→58% — the spec cites as the win).

**Fix:** Snapshot `prev` from the pre-decoration map (before fillEnclosedWaste/closeRealmGaps), or mark gap/waste-filled tiles (a parallel Uint8 mask) and exclude them from march re-assertion so they must re-earn their fill each pass, keeping decoration idempotent instead of ratcheting.

### 152. Doctrine 'worldliness' is a one-way ratchet — every long-lived faith converges to worldliness 1
`src/sim/peopleSim/faiths.js:469` · **LOW** · Design flaw · verdict: **ADVISORY** · found by `identity-culture`

Doctrine drift (step 4½) adjusts militancy bidirectionally (`militancy + (warFrac - 0.25) * 0.01`), but worldliness only ever increases: `if (warFrac < 0.1) f.doctrine.worldliness = Math.min(1, f.doctrine.worldliness + 0.004);` — there is no decrement anywhere in the codebase. Any faith whose realms are mostly at peace gains +0.004/pass, so over a few thousand passes every surviving world religion pins at worldliness=1. Via faithTemperament (`commerce: (worldliness-0.45)*1.2 - ...`) and faithShapePersonality this systematically drags ALL old-faith realms toward the mercantile pole (~+0.5 commerce offset at ¾ equilibrium), flattening exactly the doctrinal diversity (ascetic, otherworldly creeds) the six-axis system was built to preserve.

**Fix:** Make it mean-reverting or two-sided, e.g. drift worldliness down when realms are poor/ascetic-pressured, or revert toward the founding roll like personality's DRIFT_REVERT anchor: `worldliness += ((warFrac < 0.1 ? 1 : w0) - worldliness) * 0.004`.

### 153. SCHISM_MIN_DIST is an absolute tile distance — resolution/map-size dependent, unlike the cultures layer
`src/sim/peopleSim/faiths.js:58` · **LOW** · Design flaw · verdict: **ADVISORY** · found by `identity-culture`

`const SCHISM_MIN_DIST = 95; // map distance from origin see (tiles)` gates schism on `Math.sqrt(dx*dx + dy*dy) < SCHISM_MIN_DIST` (faiths.js:515). cultures.js deliberately made its analogous scale resolution-invariant (`COHESION_BASE_FRAC ... as a fraction of map width`, cohesionRadius uses world.tw). On a small map (~128 tiles wide) 95 tiles is most of the map — schisms effectively never fire and religious history loses its dominant post-axial source of new faiths; on a very large map it's trivially satisfied and only the rng brake limits fission. Same class of issue at smaller scale: the fixed word-of-mouth radius 11 in the spread pass (faiths.js:386) and the divergence-homeland radius 16 (cultures.js:453).

**Fix:** Express it as a fraction of map width like cohesionRadius: `const SCHISM_MIN_FRAC = 0.12; ... < SCHISM_MIN_FRAC * world.tw`, and consider the same for the fixed 11/16-tile radii.

### 154. Regeneration is keyed on the seed state changing, so a 1-in-999999 random-seed collision makes preset changes / imports / 'Roll & generate' silently do nothing
`src/WorldSim.jsx:2760` · **LOW** · Design flaw · verdict: **ADVISORY** · found by `ui-state`

`setPresetAndGo=(p)=>{presetRef.current=p;setPreset(p);setSeed(Math.floor(Math.random()*999999));}` and handleImport's `importedWorldRef.current=w;presetRef.current="import";...setSeed(Math.floor(Math.random()*999999));` both rely on `useEffect(()=>{generate(seed)},[seed,generate])` firing. If the freshly rolled seed equals the current one, the effect doesn't run: the preset chip updates but the world doesn't regenerate; for imports, the rasterized world sits in importedWorldRef unfinalized while the UI claims the import succeeded. Rare but a genuine dead-end when it hits (the user's next roll fixes it, but an import would need re-doing).

**Fix:** Track a generation counter instead of relying on seed inequality: `const [genN,setGenN]=useState(0)` with `useEffect(()=>{generate(seed)},[genN])`, bumping genN wherever a regenerate is intended; or loop the random roll until it differs from the current seed.

### 155. Determinism check compares rounded aggregate stats, not full state
`tools/smoke.mjs:62` · **LOW** · Design flaw · verdict: **ADVISORY** · found by `tooling-tests`

The same-seed determinism gate compares `JSON.stringify(peopleSimStats(a))` vs `...(b)`. peopleSimStats (src/sim/peopleSim/index.js:354-371) returns coarse aggregates, several rounded: `totalPeople: Math.round(sPeople)`, `totalWealth: Math.round(...)`, `totalArmy: Math.round(...)`, plus counts. Failure scenario: a nondeterminism bug that permutes which settlement holds which population, or perturbs values by <0.5 that round to the same totals, leaves every aggregate identical and the check passes. The project already has a stronger primitive (`hashWorld`) used for save/load; determinism is checked with a weaker one.

**Fix:** Compare `hashWorld(a) === hashWorld(b)` (optionally in addition to the stats compare) so determinism is checked against per-entity state, not rounded sums.

### 156. Agglomeration specialty drift rate silently depends on TRADE_STRIDE (memo-coupled mechanism)
`src/sim/peopleSim/settlement.js:839` · **LOW** · Design flaw · verdict: **ADVISORY** · found by `hunt-perf-memory`

The _specKey/_specStr evolution lives INSIDE computeExportValue ('Evolve the agglomeration cluster ONCE per tick (computeExportValue is memoised per step via exportValueOf)', lines 839-849). But exportValueOf is only invoked on ticks something asks for it: the trade pass runs every T.TRADE_STRIDE (=3) ticks, inflation every 50, road planning for one settlement per tick. So for a typical settlement the drift executes on ~1/3 of ticks, meaning the effective AGGLOM_RISE/AGGLOM_DECAY rates are ~⅓ of their nominal per-tick values — and change again if the user moves the TRADE_STRIDE pacing lever, which is documented as 'same AVERAGE money/goods/flow, ~STRIDE× cheaper' (roads.js:197-206) i.e. explicitly supposed to be behaviour-neutral. Failure scenario: set TRADE_STRIDE 1 vs 6 on the same seed → towns lock in specialties at ~6× different speeds → different industrial geography, from a lever sold as pure pacing.

**Fix:** Move the specialty-drift block out of computeExportValue into the per-tick settlement update (or scale its rate by the number of ticks since s._evStep when the memo refreshes), leaving computeExportValue a pure function.

### 157. Event-log compaction reassigns event ids, silently reshuffling every realm's recorded tradition (historiography rolls are keyed on ev.id)
`src/sim/peopleSim/events.js:46` · **LOW** · Determinism · verdict: **unverified-skipped** · found by `narrative`

compactEvents drops the oldest 50k events and then `for (let i = 0; i < events.length; i++) events[i].id = i` — every surviving event's id shifts down by 50,000. historiography.js keys all of its deterministic randomness on that id: `roll(world, viewerId, evId, salt)` (line 43-45) drives the knowledge check, the rumor band, the archive-burn survival and the shame omission. So the moment the log crosses EVENT_CAP (200k events), every realm's tradition is re-rolled wholesale: events a scribe had recorded for millennia vanish from the tradition, rumors become records, burned archives un-burn. This directly contradicts the module's contract (historiography.js:20-21: "deterministic per (world seed, viewer, event), so a realm's tradition is stable across reads and across save/load"). It only fires on very long runs (~0.045 events/step measured, so ~4.4M steps — the header's 0.4/step estimate is 10x pessimistic), but the failure mode is a silent, total rewrite of the one layer whose whole point is stability.

**Fix:** Give each event a monotonically increasing uid at logEvent time (`ev.uid = world._nextEventUid++`, persisted in counters) and key historiography rolls on ev.uid instead of ev.id; positions can keep serving the index.

### 158. Agglomeration idiosyncrasy hash omits world.seed — identical per-settlement-id craft bias in every world
`src/sim/peopleSim/settlement.js:479` · **LOW** · Determinism · verdict: **unverified-skipped** · found by `hunt-determinism`

`for (const key in legs) legs[key] *= Math.max(0, 1 + T.AGGLOM_IDIO * (hash32(sid, key) / 4294967296 - 0.5) * 2);` — every other stochastic draw in the sim follows rng.js's documented rule of deriving from `(world.seed, systemName, id)` (e.g. settlement.js:701 slaveRevolt: `hash32(world.seed || 1, "slaveRevolt", s.id, world.step)`, conquest.js:2313 absorbDefect includes the seed). This one hashes only (settlement id, craft key), so settlement #12's craft-leg multipliers are byte-identical across ALL seeds and maps. It is still deterministic (no reproducibility break), but the 'idiosyncratic local flavour' it is meant to inject is a fixed global lookup table rather than per-world randomness: reroll the seed and the same early settlement ids get the same craft biases, correlating specialization patterns across worlds and violating the stated substream convention.

**Fix:** Include the seed: `hash32(world.seed || 1, "agglomIdio", sid, key)` (note this shifts existing runs' specialties — do it alongside any other history-breaking change).

### 159. fillRealWind re-derives the 12-month mean and does an O(nLat) scan per full-res pixel
`src/realWindData.js:150` · **LOW** · Performance · verdict: **ADVISORY** · found by `climate`

For the default annual-mean path, each of W·H (1.84M at 1920×960) pixels runs a linear latitude search over ~94 entries, a linear longitude search over ~192 entries, and sums 12 months × 8 corner values out of nested boxed JS arrays — on the order of 10⁸-10⁹ property reads on the main thread every time real-wind worldgen runs. The data grid is only ~94×192; the whole climatology fits in a 72KB Float32Array.

**Fix:** Precompute once per load: flatten each month (and the annual mean) into Float32Arrays, and replace the per-pixel searches with direct index arithmetic (the gaussian lat grid is near-uniform; a precomputed pixel-row→latIdx lookup removes the scan exactly).

### 160. The polity pass performs several independent full-map O(N) scans; hasOutsideBorder is O(N) per revolt bloc
`src/sim/peopleSim/conquest.js:688` · **LOW** · Performance · verdict: **ADVISORY** · found by `conquest`

capitalTransportCosts was carefully optimized (generation-stamped scratch, typed-array heap), but the pass still contains: hasOutsideBorder — a full N-tile walk with a Set lookup per owned tile, called once per restoreNations group, per failed/successful rebellion bloc, and per governor bid (several calls in a bad pass); absorbWeakNeighbors — one full N-tile walk; eliminateEnclaves — a full-map flood-fill with a closure call per visited tile plus a per-flood Map; updateAlliances — a full tw*th adjacency scan when it fires. At the shipped 960x960 (N=921,600) that is roughly 3-6 million tile visits per polity pass in the worst case, on top of the per-country Dijkstras — likely the next hitch after the one already profiled (_dbgProfile only times rebuild/transport/loop/absorb, so hasOutsideBorder inside `loop` is invisible to the profiler).

**Fix:** For hasOutsideBorder, iterate only the bloc's tiles (collect them from the per-settlement territory index if one exists, or flood outward from bloc home tiles bounded by the bloc's own territory) instead of scanning all N; add the enclave flood to the _dbgProfile buckets.

### 161. Roads view does an O(n²) settlement scan and per-tile fillStyle churn on every frame
`src/WorldSim.jsx:1802` · **LOW** · Performance · verdict: **ADVISORY** · found by `ui-render`

In the roads view, the dot loop calls `find(s.id)` for each settlement (line 1802), and find() re-locates the settlement it already has via `psw.settlements.find(o=>o.id===sid)` (line 1752) — an O(n) scan per dot, O(n²) per frame at 30Hz (≈4M comparisons with 2000 settlements). The road-tile loop (1783-1791) also builds a fresh `hsl(...)` string and assigns fillStyle per road tile with no lastFs batching, unlike every other overlay loop in the file, and the whole ~460k-tile scan runs on every draw rather than through the psOverlay cache the other views use.

**Fix:** Compute the component root from `s` directly (its tile + compAt, skipping the id lookup), memoize compColour per root, batch fills by component, and consider routing this view through psOverlayRef like the others.

### 162. TuningPanel triggers a full 1920×960 world regeneration (and a new Worker) per slider input event
`src/TuningPanel.jsx:169` · **LOW** · Performance · verdict: **ADVISORY** · found by `ui-shell`

handleParamEdit → `onParamsChange(newParams)` → WorldSim's `onParamsChange={(p)=>{_tecParams=p;…;generate(seed);}}` (WorldSim.jsx:4184). A range input fires onChange continuously while dragging, so each mouse-move step terminates the previous WorldGenWorker and spawns a fresh one for a full-resolution regeneration (WorldSim.jsx:1000-1008), plus finalizeWorld on each completion tears down and re-creates the PeopleSimWorker. Meanwhile doGenerate also regenerates all preview candidates per event. It self-heals (workers are terminated), but dragging a slider produces a storm of worker spawn/kill cycles and redundant full generations. Additionally, `params={{..._tecParams}}` is a fresh object identity every parent render, so the `useEffect(()=>{setBaseParams(params||{})},[params])` at line 115 re-fires ~30×/sec while snapshots pump, re-rendering the whole panel constantly.

**Fix:** Debounce onParamsChange (e.g. 250ms trailing) before calling generate(), and/or only regenerate the big world on pointer-up. In WorldSim, memoize the params prop (useMemo keyed on a params-version counter) so the sync effect fires only on real changes.

### 163. Hot Dijkstra heaps allocate a {ti,d} object per pop — the already-solved _PolHeap pattern isn't applied everywhere
`src/sim/peopleSim/territory.js:153` · **LOW** · Performance · verdict: **ADVISORY** · found by `hunt-perf-memory`

territory.js MinHeap.popMin (line 153), roads.js MinHeap.popMin (1284-1302), sea.js MinHeap.popMin (140) and transport.js _MinHeap.popMin (70-92) all `return { ti, d }`, and their callers destructure it. computeTerritory pops once per relaxed tile edge over most of the land every territory pass; computeReach runs per settlement on the reach-rebuild rotation; the sea flood visits up to MAX_SEA_VISITS=300k. At shipped resolution that is easily hundreds of thousands to millions of short-lived objects per pass, pure nursery GC churn in the hottest loops. conquest.js already fixed exactly this with _PolHeap exposing om_ti/om_d fields ('was per-call Maps — this Dijkstra ... was the single biggest sim hitch'), so the codebase knows the pattern; the other four heaps just predate it.

**Fix:** Port the _PolHeap convention (popMin() sets this.om_ti/this.om_d, returns nothing) to the MinHeaps in territory.js, roads.js, sea.js and transport.js, and update the ~6 call sites.

### 164. aggregateFoodHierarchy allocates Maps/Sets/arrays for the whole tree every tick
`src/sim/peopleSim/foodHierarchy.js:121` · **LOW** · Performance · verdict: **ADVISORY** · found by `hunt-perf-memory`

This pass runs EVERY tick and allocates per call: `const children = new Map()` plus one array per parent (line 121-129), `roots` array, `const budget = new Map()` over all settlements (137-141), `const seen = new Set()` and per-node `[node,false]` stack frames (152-163). With a full Earth map carrying 1,000-2,000+ settlements that is several thousand allocations per tick, every tick, forever — the largest steady per-tick allocation site left in the sim core (the profile shows the 'settlements' bucket dominating steady-state cost: 5.5s of 12s total in a 12k-step run at only ~43 settlements). Not a correctness issue, but it's GC pressure in the innermost loop of the whole program.

**Fix:** Keep reusable scratch on world (a children Map whose arrays are length-0-reset, a Float64Array budget indexed by a settlement slot, an Int32 stack + generation-stamped seen array), refilled each tick — the same clear+refill pattern world._byId already uses.

### 165. Headless runs build the render-only money-flow overlay by default
`src/sim/peopleSim/roads.js:849` · **LOW** · Performance · verdict: **ADVISORY** · found by `hunt-perf-memory`

runTradePass gates the overlay with `const wantFlows = world._wantMoneyFlows !== false;` — i.e. DEFAULT ON when the flag was never set. The browser worker sets it from viewMode on init (peopleSimWorker.js:118), but every headless context (tools/_harness.mjs, smoke, stylized, earthRun — none set _wantMoneyFlows) pays for it: each trade sweep pushes a `{ tiles, mag, toEnd, sea }` object per qualifying pair into a fresh moneyFlows array (roads.js:887-889) that nothing ever reads, thousands of objects every 3rd tick on a dense map, in exactly the long CI/validation runs where throughput matters.

**Fix:** Flip the default to opt-in (`world._wantMoneyFlows === true`), with the worker setting it true when the money view opens — the only consumer.

### 166. River hydrology constants are explicitly calibrated to named basins
`src/sim/riverGen.js:30` · **LOW** · Question · verdict: **ADVISORY** · found by `hydro-pipeline`

Several constants carry comments that they were tuned to make specific named geography come out: ENDO_EVAP=2.0 'Calibrated so the arid closed interiors (Central Asia, the Caspian/Aral/Tarim, the Great Basin) seal' (line 28-30); SNOWMELT_K=3.0 'Calibrated so the Himalaya/Pamir keep their old ~0.5 melt' (67-68); TERMINAL_STRICT=2.5 'only a genuinely large endorheic river (the Volga→Caspian) qualifies' (61); the CATCH_* bars 'Tuned so the global river DENSITY matches the old percentile output at the shipped width' (53-56). These are genuine physical parameters (an evaporation coefficient, a melt volume, a loss fraction) — which is the defensible side of Cardinal Rule 2 — but the calibration target is a named outcome and (per CATCH_* comment) even a specific grid width, so they risk mis-behaving on other maps/resolutions. This is a question/recommendation, not a traced bug: are these values derivable from the physics they represent rather than back-solved from Earth basins?

**Fix:** Where possible, anchor each constant to an independent physical quantity (evaporation rate per unit open-water area, transmission loss per km of arid channel) and let the Caspian/Tarim/Volga outcomes fall out, then verify across seeds/resolutions instead of at the shipped Earth width.

### 167. Several mechanism parameters are openly tuned against aggregate outcome targets (country count ~80-100, urbanisation ~60%, empire pacing) — clarify which targets are canon
`src/sim/peopleSim/countryTerritory.js:242` · **LOW** · Question · verdict: **ADVISORY** · found by `hunt-fitted-outcomes`

A pattern worth an explicit policy: CITY_TIER=2's comment says the count 'lands near the realistic ~80-100-country target' (countryTerritory.js:236-242); crystallize.js:314 tunes spMul so 'urbanisation stays realistic (~60%)'; COUNTRY_REACH_ORG=14 (countryTerritory.js:48) was set/reverted by watching whether 'empires were continental too early' and admits 'it must be calibrated at the shipped width'. Each underlying mechanism is real (city-anchored sovereignty, spacing, org-scaled reach), and validating against DISTRIBUTIONAL stylized facts is the project's own stated method (tools/stylized.mjs) — so none of these is a clear violation. But they sit on the rule-2 boundary: the constants' values are chosen to hit historical aggregates, and the reach comment concedes resolution-sensitivity that pure mechanisms shouldn't have.

**Fix:** Adopt a written convention (CLAUDE.md addendum): tuning a mechanism constant against a DISTRIBUTION-shaped stylized fact via npm run validate is sanctioned calibration; tuning against a specific named outcome (a region, a single count) is not. For COUNTRY_REACH_ORG specifically, the admitted resolution-sensitivity of the size-gate is a smell — finishing the resScale normalisation so the constant means the same thing at every width would remove the need to recalibrate per resolution.

### 168. Isolation dark-age trigger is gated on age-since-founding rather than emergent state
`src/sim/peopleSim/settlement.js:1514` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `settlement`

`const cutOff = reachN === 0 && (world.step - (s.foundedStep || 0)) > 2000 / (world._dt || 1);` — the intent ("only bites an ESTABLISHED settlement that has genuinely been cut off — not a new frontier village that simply hasn't built roads yet") is a grace period, so it's not a content time-gate in the cardinal-rule sense, but it fires on ELAPSED TIME rather than on what the settlement became: a village that spent 2001 ticks never having any road still gets the isolation knowledge-decay penalty, identical to a former hub that lost its network. The emergent formulation is a state flag: only a settlement that HAS traded can be 'cut off'.

**Fix:** Set `s._everConnected = true` whenever `s._tradeReach.size > 0`, and gate: `const cutOff = reachN === 0 && s._everConnected;` (persist the flag). This removes the tick constant entirely.

### 169. BALANCE_CAP is applied to different quantities in the two balance-of-power consumers
`src/sim/peopleSim/conquest.js:2307` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `conquest`

conquest.js (peaceful absorption, commit 4e0d6de) caps the whole multiplier: `prob /= Math.min(BALANCE_CAP, 1 + BALANCE_W * (bm / pow))` — max brake 3.0x. armies.js:350 caps the ratio inside: `mul *= 1 + BALANCE_W * Math.min(BALANCE_CAP, bloc / hp)` — max bar 4.3x. The absorbWeakNeighbors comment claims this is 'the SAME deterrence armies.js applies'. Both are defensible, but they are not the same, and BALANCE_CAP's exported doc ('ceiling on that backing') matches neither unambiguously. Tuning one constant now moves the two brakes by different amounts.

**Fix:** Extract one shared helper (e.g. `coalitionBrake(bloc, pow)`) exported from conquest.js and used by both call sites, so the war bar and the absorption brake stay in lockstep.

### 170. Stale contract comments are now actively misleading: countryClaim.js claims to be render-only, and the merge/commit text claims core protection that doesn't exist
`src/sim/peopleSim/countryClaim.js:13` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `territory-identity`

countryClaim.js:13 says "Render-only: nothing in the sim depends on _countryClaim" — false: `grownOwnerAt` (same file, line 58) is the authority adoptAndFound uses to assign every village/town's `countryId` and crystallize.js uses to decide a newborn settlement's nation, and persist.js serialises `_countryClaim` precisely because it is sim state. Similarly identityField.js:12 and 105-106 say "Nothing reads the field yet ... cannot perturb history" (currently still true — verified) but sits above code whose flood now consumes `world._countryOwner`; and countryTerritory.js:556-558 / commit 31942dc assert catchment cores are pinned in the post-merge smoothing when only home tiles are (see the smoothing finding). In a codebase whose review discipline leans this heavily on long in-file design comments, wrong contracts are how the next regression ships.

**Fix:** Update the countryClaim.js header to "sim-authoritative: adoption/founding reads the crawled claim"; fix the 31942dc-era comment at countryTerritory.js:556 when the pinning fix lands; keep identityField's render-only claim under the existing smoke-test invariant so it stays true.

### 171. hashWorld never samples roadFlow, so the save-completeness check is blind to the flow field
`src/sim/persist.js:253` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `trade-network`

The state hash mixes roadQuality every 97th tile but nothing from roadFlow, even though roadFlow is persisted state that feeds paving, abandonment, and crystallization scoring. This is exactly why the _flowTiles load bug (finding 1) is invisible to the smoke test's save→load→save identity check: two worlds with wildly divergent flow fields hash identically.

**Fix:** Mix roadFlow with the same strided sampling (`for (let i = 0; i < rf.length; i += 97) mixNum(rf[i])`), and consider adding a sampled _flowTiles.size / _roadTiles.size to catch index desync.

### 172. Grain prices and ship fractions are fixed per-tier schedules explicitly tuned so market towns profit — outcome-shaped constants where a price mechanism should be
`src/sim/peopleSim/foodHierarchy.js:97` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `economy`

GRAIN_PRICE_BY_TIER = [2, 8, 14, 22] and SHIP_FRAC_BY_TIER = [0.8, 0.5, 0.2, 0.05] are static. The comment above the price table is candid about the fitting: "The gradient must be STEEP: a market town ships only ~a third of the grain it takes in further up ... yet pays its villages for ALL of it, so a gentle markup leaves the town a net buyer. A big farm-gate→market step-up ... is what lets the town capture the entrepôt margin instead of pumping coin into the countryside." That is a constant chosen to guarantee the desired answer (towns net a margin) rather than a mechanism from which margins emerge — second-cardinal-rule adjacent. It also means grain price never responds to scarcity: a famine-stricken city pays the same 2/unit at the village gate as a glutted one, so coin does not flow preferentially toward hungry regions (_grainHunger is computed at line 107 but, per the comment, only exposed for the panel).

**Fix:** Derive the local grain price from emergent scarcity — e.g. price ∝ base × (1 + k·_grainHunger of the BUYER's subtree) or from the pool/demand ratio at each node — so the village-to-city gradient (and the entrepôt margin) falls out of aggregation and hunger instead of a hand-set table. Keep the tier table only as an initial calibration reference.

### 173. calendar.js's own comments contradict the code in the two places the cardinal rule most needs them to be right
`src/sim/calendar.js:29` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `narrative`

The code itself is clean under rule 1 — verified by grep: stepToYear/yearStr feed only WorldSim.jsx display; displayYear/eraAt feed only the UI ribbon and worker snapshot; dynasties.js uses the separate uniform dynYear strictly for durations (ages, reign lengths — relative spans, not calendar gates); the demographic anchor reads world._civYear derived from emergent organization (index.js:104). But the documentation is stale in dangerous ways: line 29 says the dynamic anchor "reads stepToYear" — the exact two-clock landmine CLAUDE.md documents as a past bug, presented as CURRENT design; and lines 38-41 claim "the dynasty layer measures time on THIS [display] calendar too" while dynasties.js:38 actually imports dynYear/dynStep (and even locally aliases them AS stepToYear/yearToStep, compounding the confusion). A future contributor following these comments could reasonably re-wire the anchor onto the linear clock or the dynasty layer onto the era-anchored display curve — re-introducing rule-1 violations with the file's own blessing.

**Fix:** Correct line 29 to say the anchor reads world._civYear (civYearFromOrg), fix lines 38-41 to state the dynasty layer runs on dynYear (uniform) while only the ribbon RENDERS via displayYear, and rename the dynasties.js import aliases (dynYear as stepToYear) to something that can't be confused with the mechanic clock.

### 174. Plague lethality and famine severity are fixed constants, never modulated by emergent tech (medicine, sanitation, agriculture)
`src/sim/peopleSim/shocks.js:205` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `war-shocks`

Mortality is `mort = T.PLAGUE_MORT * (1 + PLAGUE_URBAN*urban) * virgin * _dt` — no term for the defender's knowledge/medicine/construction. Likewise famine is a flat `s._harvestMul = FAMINE_SEVERITY (0.35)` regardless of agricultural tech, irrigation, or storage capacity. Consequence: an industrial, high-knowledge empire is gutted by an epidemic at exactly the same per-capita rate as a neolithic village, and a bad harvest costs a tech-advanced farming realm the same 65% crop loss as a stone-age one. Per the project's cardinal rule (behaviour should self-calibrate off emergent development), the shock impact ought to ramp DOWN with the settlement's relevant knowledge so late-history plagues/famines soften on their own instead of hitting antiquity-strength forever. This isn't a wrong-output bug today (buffering via granary/stored food gives partial famine relief), but it is a missing mechanism that will distort late-game demographic history.

**Fix:** Scale `PLAGUE_MORT` by a medicine/sanitation factor derived from knowledge (e.g. divide by `1 + K*medicineOrConstruction`) and scale famine severity toward 1 with agriculture knowledge, so both shocks self-calibrate to development rather than being era-flat constants.

### 175. passRng/entityRng share one hash namespace — a future same-name use would silently alias pass step N to entity id N
`src/sim/peopleSim/rng.js:70` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `core-loop`

passRng hashes (seed, system, step|0) and entityRng hashes (seed, system, id|0) with identical structure, so `passRng(world, "X")` at step 500 IS `entityRng(world, "X", 500)`. Today the two name families are fully disjoint (pass: climate/contact/crystallize/dynasty/religion/settlers/settlers.site/shocks/urban; entity: doctrine/personality/schism/syncretism/*.cul — verified by grep), so there is no cross-bleed. But the module's contract ('adding a new randomness consumer NEVER perturbs the draws an existing system sees') is only upheld by convention; a contributor reusing a name across the two helpers gets an entity whose personality replays a specific tick's shock dice, correlated and near-impossible to notice.

**Fix:** Bake the family into the hash: `hash32(seed, "pass:" + system, step)` and `hash32(seed, "ent:" + system, id)`. One-line change; it does re-seed all streams once (same-seed histories shift one time), so land it alongside another determinism-breaking change.

### 176. CIV_ORG_YEAR gates read development through a fitted year-table detour — consider gating on org directly
`src/sim/peopleSim/index.js:134` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `core-loop`

world._civYear = civYearFromOrg(leadOrg) maps emergent organisation through a 10-point table fitted to the historical timeline, and downstream gates (frontier close, hinterland claim, identity salience, and applyDemographicAnchor's target) consume the pseudo-year. This complies with the first cardinal rule — the driver is reached development, not the clock — but the year detour is an outcome-fitted indirection: every consumer inherits the table's shape, and a change to CIV_ORG_YEAR retunes several unrelated mechanisms at once. The gates would be more honest (and independently tunable) reading leadOrg (or their own relevant state) against thresholds with mechanistic meaning; the year mapping can remain purely cosmetic for the HUD, which is exactly what the project's own corollary prescribes for the displayed era.

**Fix:** Migrate consumers of world._civYear to read world._leadOrg (or better, the local condition each gate actually models) and keep civYearFromOrg only for display/chronicle labelling.

### 177. Wind-particle trails issue ~36k individual stroke calls per frame — batch like the money coins
`src/WorldSim.jsx:1715` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `ui-render`

Each of 3000 particles strokes every trail segment separately with its own strokeStyle/lineWidth/beginPath (lines 1715-1721): up to 3000×11 ≈ 33k stroke() calls plus 3000 head-dot fills, per rAF frame, since the wind view animates at full frame rate (animLoop, line 2558). The money overlay in the same file already solved this exact problem by quantising alpha into 4 buckets and batching (lines 1842-1880) — the comment there even explains why.

**Fix:** Quantise segAlpha/lineWidth into a handful of buckets, accumulate segments into per-bucket paths, and stroke each bucket once (~8 strokes instead of ~33,000).

### 178. Add eslint-plugin-react-hooks — several latent stale-closure/deps issues in this exact area would be machine-caught
`eslint.config.js:26` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `ui-shell`

The config deliberately covers only no-undef/no-unused-vars. But the UI files reviewed here contain the precise bug class react-hooks/exhaustive-deps exists for: GlobeView's setup effect uses CW/CH with `[]` deps (latent — globeTexSize is currently always 4096×2048, but if it ever varies the texture canvas stays stale while the update effect writes new-size ImageData into it, clipping the globe texture); TuningPanel's mount effect closes over doGenerate; SimLevers/WorldSim mirror state into refs by hand to dodge deps. None is live-broken today, but each is one refactor away.

**Fix:** Add `eslint-plugin-react-hooks` with rules-of-hooks: error, exhaustive-deps: warn; annotate the intentional ref-mirror patterns with eslint-disable-next-line comments so real omissions stand out.

### 179. Several stylized thresholds are wide enough to be near-vacuous
`tools/stylized.mjs:97` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `tooling-tests`

Some bands admit almost any non-degenerate world: wars/1000 steps passes for `>1 && <400` (400/1000 is near-continuous war); "wars amid succession crises" passes at `crisis/wars > 0.02` OR `wars.length===0` (2% is trivially met, and zero wars auto-passes this human-causes check); urbanisation passes `2%–65%`; tech~cradle-distance passes at `r < -0.1` (barely distinguishable from noise). These will rarely flag a real regression. (Zipf slope −0.5..−1.6, empire tail ≥2.5, and lifespan median 300..STEPS/2 with tail ≥3 are the meaningfully tight ones.)

**Fix:** Tighten the loose bands to what a healthy run actually produces across a seed sweep (e.g. narrow the war rate, raise the crisis-share floor, tighten the diffusion correlation), so a miss signals a genuine shape change.

### 180. Smoke validates determinism/invariants at a single seed and single resolution
`tools/smoke.mjs:12` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `tooling-tests`

All smoke assertions run at exactly W=320,H=160,SEED=4242 (plus the DISSOLVE block at the same size/seed). Determinism, invariants and save/load are never exercised at other resolutions or seeds, so a bug that only manifests at 480-wide, at the app's 1920-wide, or on a different seed (e.g. resolution-dependent territory hashing, seed-specific NaN) ships green. The cardinal-rule promise that mechanisms are "right everywhere ... any map, any seed" is not spot-checked by the gate.

**Fix:** Add a second cheap determinism+invariant pass at a different seed and a different W (e.g. seed 8817 at 240-wide) to the smoke run; it costs a few seconds and catches resolution/seed-coupled regressions.

### 181. README: "seeds two Neolithic river-valley villages" is stale — the sim seeds up to 10 cradles
`README.md:5` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `docs-drift`

README line 5: "then seeds two Neolithic river-valley villages on it". The code seeds up to `MAX_CRADLES = 10` (state.js:287, with the design rationale "Seeding just one cradle gave the first civilisation a permanent compounding lead" at lines 282-286), plus the three pinned Earth hearth sites on the Earth preset (state.js:322). The "two" dates from commit b16b19f ("Earth map: seed exactly two fixed cradles (Nile + Yangtze)"), several design generations ago.

**Fix:** Reword to "seeds a handful of Neolithic river-valley cradles (up to ~10, separated by distance)" or similar.

### 182. currency-system.md §4/§7 list data-model fields and levers that were never built
`docs/currency-system.md:148` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `docs-drift`

The status header (lines 3-5) is accurate (Phases 1-4 + model (b) default-on; Phase 5 default-off — verified: tuning.js:413-423, roads.js:963-987 Hume+FX, settlement.js:557/565-573/605-613 coin-loss/credit/seigniorage, conquest.js:1237-1245 debasement, c._fineness at conquest.js:2110). But §4's data model lists `settlement.bullion  // NEW: uncoined metal awaiting the mint` and `world._mintByCountry` — neither exists (grep over src/sim/peopleSim finds no `s.bullion` or `_mintByCountry`); the implementation coins in place at the mine with seigniorage skimmed there (settlement.js:611-613), resolving §8's open question the "coin in place" way without saying so. §7's lever table lists `MINT_RATE 1.0` and `CREDIT_BUST_DROP 0.5` which don't exist in tuning.js, and two defaults drifted: COIN_LOSS_RATE is 0.0004 (doc: 0.0001), CREDIT_MAX_MULT is 2.0 (doc: 3.0).

**Fix:** Trim §4 to the fields that exist (gov.fineness, s._credit, treasury), delete MINT_RATE/CREDIT_BUST_DROP from §7, sync the two defaults, and mark §8's bullion-shipping question resolved (coined in place).

### 183. farming-region-dissolution.md status stale — Stages 0-1 (plus render-only diffusion) are shipped
`docs/farming-region-dissolution.md:3` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `docs-drift`

Header: "Status: proposal / not started. This is a design doc to decide against, not a commitment." In fact the doc's own recommended first slice shipped: identityField.js implements Stage 0 (mirrorIdentityField writing per-settlement top-K mixes into `tileCulId/tileCulShr` etc. typed arrays, exactly the doc's §4.2 layout) with the smoke-test invariant the doc asked for (auditIdentityField; tools/smoke.mjs:82-97), and Stage 1 (lenses render from the field: diffuseIdentityField called from peopleSimWorker.js:409 for the active Peoples/Faiths/Language lens). The shipped diffusion is explicitly render-only — identityField.js:105-106: "Nothing in the SIM reads the field... cannot perturb history, determinism, or saves" — so Stage 2 (field owns the dynamics) is NOT done, foodHierarchy.js still exists (193 lines; Stage 3 not done), and tier-0 farming regions still spawn (Stage 4 not done). The doc remains the correct roadmap for 2-4.

**Fix:** Update the header: "Stages 0-1 shipped (identityField.js, render-only flood+blur variant); Stages 2-4 not started." Note that the shipped Stage-1 uses a county-flood + anchored blur rather than the doc's plain diffusion.

### 184. README: "14 tracked resources" — there are 15
`README.md:88` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `docs-drift`

README lines 88-89: "seeded resource deposits (14 tracked resources from timber to dyes)". resourceGen.js RESOURCES (lines 5-24) contains 15 entries: timber, stone, copper, tin, iron, salt, horses, precious, coal, oil, gems, spices, furs, incense, dyes.

**Fix:** Change to 15 (or "15 tracked resources"), or drop the count so it can't drift again.

### 185. Legacy POP_ANCHORS demographic pin (world population dialed to Earth's historical curve) still ships as an opt-in lever
`src/sim/peopleSim/index.js:71` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `hunt-fitted-outcomes`

index.js:71-123 keeps `POP_ANCHORS` ('standard historical estimates') and an integral controller that steers `world._eraProd` so total sim population lands ON the real curve — `const target = realWorldPopSim(world._civYear ?? -6000)`. This is the textbook rule-2 pattern (the WRONG example in CLAUDE.md is literally `const target = realWorldPopSim(...)`), softened two ways: it is keyed on the development pseudo-year rather than the clock (the rule-1 fix is done and well documented at lines 92-102), and ANCHOR_POP defaults to 0 (tuning.js:259), so the shipped path is the fully emergent per-settlement `s._eraProd = ERA_PROD_BASE + ERA_PROD_SCALE*agri^POW*devGate` (settlement.js:1787). Reported as a borderline hangover rather than a live violation: while the lever exists, any run with it on has its headline output (population) dialed to the answer, and _civYear→realWorldPopSim composes two fitted tables.

**Fix:** Since the emergent ERA_PROD path is now the default and calibrated, consider deleting the anchor entirely (or demoting it to a tools/-only diagnostic that REPORTS deviation from the historical curve instead of enforcing it) so the fitted table cannot silently become load-bearing again.

### 186. Determinism smoke check compares only aggregate stats — use hashWorld and cover more state
`tools/smoke.mjs:53` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `hunt-determinism`

The determinism check runs two sims in the same process and compares `peopleSimStats` JSON — a handful of aggregates (population, settlement counts, wealth, largest empire). Two runs could diverge in culture mixes, knowledge, unrest, territory, event streams, or polity fiscal state while these aggregates still collide for 600 steps. Meanwhile `hashWorld` (persist.js:230) already exists, folds per-settlement economics and knowledge, and is used for the save round-trip — but not for the two-run determinism check. hashWorld itself also skips large state families: culMix/faithMix/langMix, unrest causes, polity `_impCapacity`/`_momentum`/`_taxRate`, `_countryOwner`, events content (only length), and samples roadQuality at stride 97 — a nondeterminism or save-completeness regression in any of those would pass the current suite.

**Fix:** Compare `hashWorld(a) === hashWorld(b)` (in addition to stats) in the determinism block, extend hashWorld to fold identity mixes, polity fiscal fields and a `_countryOwner` stride-sample, and consider a cross-process check (two `node` invocations comparing printed hashes) to catch engine/module-state coupling.

### 187. Save identity depends on caller-supplied genMeta, and the roundtrip test structurally cannot catch silently-lost state — add a save/load A-B continuation probe
`src/sim/persist.js:97` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `hunt-save-load`

Two structural gaps. (1) saveWorld records `oceanLevel: meta.oceanLevel ?? 0.78, tecParams: meta.tecParams || {}` from the CALLER's meta rather than from anything recorded on the world; the worker keeps genMeta alongside (peopleSimWorker.js:167), but any tool that calls serializeWorld(world) without meta writes a save whose terrain silently regenerates at ocean level 0.78 — the dynamic state then overlays a different planet with no error. (2) The smoke test's guarantee (tools/smoke.mjs:139-156) is hashWorld(world) === hashWorld(loadWorld(serializeWorld(world))) plus 500 clean resume ticks — this verifies that SAVED fields round-trip, but by construction can never detect state that was never saved (every finding above passes it). Also, version handling is all-or-nothing: loadWorld throws on `v !== 1` (persist.js:145) with no migration hooks, and within v1 the schema drifts via `?? default` fallbacks (fine forward, silently lossy backward).

**Fix:** Record oceanLevel/tecParams/preset on the world at init and read them in saveWorld (caller meta as override only). Add a probe that runs world A for N ticks continuously vs world B save→load→N ticks and compares hashWorld (or key aggregates like _soilFatigue sums, truce counts, _orgApt means) — with a documented allowance for the intended re-warm transients — so newly added cross-tick state that misses persist.js fails CI instead of silently forking history.

### 188. Snapshot settlement records: consider columnar/typed packing once settlement counts reach the thousands
`src/peopleSimWorker.js:253` · **LOW** · Recommendation · verdict: **ADVISORY** · found by `hunt-perf-memory`

packSettlement builds a ~25-field object (plus nested pos object and several derived ternaries) per settled settlement, 30×/s, and postMessage structure-clones them; applySnapshot then rebuilds `byId` and the countries Map (with memberIds.map per realm) per snapshot on the main thread (WorldSim.jsx:2465-2475). At the few-hundred-settlement scale this is fine; on a filled Earth run (1,500-3,000 settlements) it becomes ~50-100k transient objects/s on both threads plus clone cost — likely the next bandwidth ceiling after roadFlow. Everything draw() needs per settlement is numeric except `name` (only used for the selected card / labels).

**Fix:** Ship per-settlement draw data as a small set of transferable typed arrays (id/x/y/tier/countryId/people/flags...) refreshed every snapshot, and send names + rarely-changing identity fields on the static cadence; keep the rich object only for the selected settlement.

### 189. climMod overlay is not persisted or rebuilt on load, so a territory pass in the first ≤19 post-load ticks diverges from the unbroken run
`src/sim/persist.js:166` · **LOW** · Save/load · verdict: **unverified-skipped** · found by `core-loop`

persist.js saves and restores `_climIndex`/`_climShock` (lines 104, 166) but not the derived per-tile `world.climMod` array; index.js only rebuilds it when `world.step === 1 || world.step % CLIMATE_INTERVAL === 0` (line 198), and territory.js treats a missing climMod as ×1 (line 390: 'undefined = none → ×1'). Failure scenario: save at step 143; on load, tick 144 hits `144 % T.TERRITORY_INTERVAL(144) === 0` and computeTerritory tallies every catchment's food with climMod=×1, while the unbroken run used the actual overlay (which at a harsh epoch is up to −30% at high latitudes); the next climate rebuild is step 160. Food, granaries and everything downstream diverge from the pre-save trajectory — save/load is not history-transparent during climate extremes.

**Fix:** On load, reconstruct climMod deterministically from the restored _climIndex/_climShock (factor the per-tile loop of updateClimate into a rebuild function that does NOT advance the walk, and call it from loadWorld), or persist the climMod array.

### 190. Road-planning backoff and reach cursor reset on load — one-time post-load building burst
`src/sim/peopleSim/roads.js:513` · **LOW** · Save/load · verdict: **unverified-skipped** · found by `hunt-determinism`

`s._planNext` / `s._planBackoff` / `s._planPop` (set at roads.js:540-542, read in the plan-queue filter at 513-520) and `world._reachCursor` (roads.js:488-495) are cross-tick throttle state not in SETT_FIELDS or the save. After load, every settlement has `_planPop === undefined`, so the filter sets `_planNext = 0` and the ENTIRE settled world re-enters the road-planning queue on the first PLAN_INTERVAL tick — a wave of A* evaluations and potential road builds that the uninterrupted run, with its exponential backoffs (up to 8× PLAN_INTERVAL), would not have performed. Roads are sim state (they steer trade, territory cost, armies), so the post-load network can gain segments the pre-save trajectory would never have built. This sits beyond the documented warm-cache list, though it is bounded (one cycle) and roads are monotone.

**Fix:** Either add `_planNext`/`_planBackoff`/`_planPop` to SETT_FIELDS, or on load initialize `_planPop = s.people` and stagger `_planNext` deterministically (e.g. by id) so the backlog re-forms gradually.

### 191. Faith pacing cooldowns (_schismAt, _lastSyncretismAt) are lost on load — a schism/syncretism can fire immediately after loading
`src/sim/peopleSim/faiths.js:492` · **LOW** · Save/load · verdict: **unverified-skipped** · found by `hunt-save-load`

Schisms are rate-limited per religion family through `world._schismAt` (faiths.js:492-500, `const lastRoot = world._schismAt.get(f.rootFaithId) ?? -Infinity` against SCHISM_ROOT_COOLDOWN=1400) and syncretism world-wide through `world._lastSyncretismAt` (faiths.js:549 `world.step - (world._lastSyncretismAt ?? -Infinity) >= SYNCRETISM_WORLD_COOLDOWN / dt`, cooldown 5000). Neither is saved. Failure: a schism fires at step 30000; save at 30010, load; the `?? -Infinity` fallbacks make the same family immediately eligible again, so the "genuinely-new blended religions are rare" pacing is violated right after every load — a second schism/syncretism can fire millennia early relative to the unbroken run.

**Fix:** Add `schismAt: mapToArr(world._schismAt)` and `lastSyncretismAt: world._lastSyncretismAt` to the save and restore them in loadWorld.

### 192. s._credit (bank credit outstanding) and s._lastBorrow (crop-borrow cooldown) missing from SETT_FIELDS
`src/sim/persist.js:28` · **LOW** · Save/load · verdict: **unverified-skipped** · found by `hunt-save-load`

Two more per-settlement cross-tick fields are dropped: (1) `s._credit` — settlement.js:566-573 tracks credit money created on top of specie so contraction "never... unwinds money it lacks"; the created coin is added to s.wealth (saved) but the liability `_credit` is not, so after load `cur = 0` and the contraction branch (`take = Math.min(-delta, s.wealth, cur)`) can never call the credit in — the boom money becomes permanent specie, and a fresh credit expansion can be conjured on top of it. Only bites when T.CREDIT_RATE > 0 (default 0, experimental — but it is a Levers-panel lever and the lever VALUE is saved, so a save made with it on loads with broken books). (2) `s._lastBorrow` — cultures.js:344-347 gates crop-package borrowing on a 6000-tick per-settlement cooldown (`if ((s._lastBorrow ?? 0) + 6000/dt > world.step) continue;`); lost on load, so a settlement that just borrowed can immediately borrow again (only when T.CROP_AXIS is on).

**Fix:** Add "_credit" and "_lastBorrow" to SETT_FIELDS.

### 193. oceanLevel argument only affects the default 'random' preset, silently ignores 0, and reads out of bounds at 1
`src/sim/worldgen.js:633` · **LOW** · UI/UX · verdict: **ADVISORY** · found by `worldgen-tectonics`

`const sl = sorted[Math.floor(W*H*(oceanLevel||0.78))];` — this is the only use of the oceanLevel parameter in generateWorld. The tectonic preset uses its own `p('seaLevel', 0.67)` from _tecParams (tectonicGen.js:355) and earth/earth_sim/pangaea ignore ocean level entirely, yet worldGenWorker.js:22 always forwards oceanLevel for every preset — so the setting silently does nothing on 4 of 5 presets. Edge cases: `oceanLevel||0.78` means an explicit 0 (all-land request) falls back to 0.78; oceanLevel >= 1 indexes sorted[W*H] → undefined → every `rawElev[i] > undefined` is false → an entirely ocean world with no error.

**Fix:** Use `oceanLevel ?? 0.78`, clamp the index to `Math.min(W*H-1, ...)`, and either forward oceanLevel into tecParams.seaLevel for the tectonic preset or make the UI hide the control on presets that ignore it.

### 194. getExportBreakdown's grain term drifted from computeExportValue despite the 'panel can't drift' contract
`src/sim/peopleSim/settlement.js:932` · **LOW** · UI/UX · verdict: **ADVISORY** · found by `settlement`

computeExportValue's grain leg is fertility-scaled: `const grain = (k.agriculture || 0) * agScale * (0.45 + 1.25 * fert)` (line 803, range ×0.45–×1.7, added so breadbaskets stay grain exporters). The info-panel decomposition still uses the pre-change constant: `const agriculture = (k.agriculture || 0) * agScale * 0.6 * mult` (line 932) — directly under the comment "SAME food gate as computeExportValue — panel can't drift from the economy" (line 931) and the header claim at 906-910. On a rich river-valley tile (fert 0.9 → factor 1.575) the panel understates the grain export ~2.6×, so the composition no longer sums to the headline exportValue and a Nile breadbasket's panel shows crafts leading when the economy is actually selling grain.

**Fix:** Mirror the economy: read `world.fert` at the home tile in getExportBreakdown and use the same `(0.45 + 1.25 * fert)` factor — or better, extract one shared `grainLeg(s, k, world)` helper like craftLegs so this class of drift is impossible.

### 195. Colony route truncated at MAX_ROUTE_TILES makes the ship teleport the last leg and arrive early
`src/sim/peopleSim/sea.js:520` · **LOW** · UI/UX · verdict: **ADVISORY** · found by `trade-network`

`if (full.length > MAX_ROUTE_TILES) full = full.slice(0, MAX_ROUTE_TILES);` keeps the FIRST 1200 tiles of the voyage but foundColony still plants the colony at sh.landTi. Failure scenario: an ultra-long quest voyage (fine grid, transoceanic) exceeds 1200 tiles; the ship sails 1200 tiles, `sh.idx >= path.length - 1` fires mid-ocean, and the colony materialises at the distant landing instantly — the visible ship vanishes far from the landing and the voyage takes less history-time than its true length, so longer routes are paradoxically faster beyond the cap.

**Fix:** Truncate from the MIDDLE (keep start and end segments) or subsample the path uniformly (keep every k-th tile plus endpoints) so the stored polyline still spans the full route and arrival time scales with true distance.

### 196. De-novo organized faiths inherit the FOLK faith's hue instead of golden-angle spread — the intended branch never fires
`src/sim/peopleSim/faiths.js:191` · **LOW** · UI/UX · verdict: **ADVISORY** · found by `identity-culture`

newFaith's hue logic: `if (parent && !f.syncretic) f.hue = (((parent.hue + ...jitter*40) % 360) + 360) % 360; else if (f.parentFaithId < 0) f.hue = (id * 137.508 + 40) % 360;`. Axial genesis always sets `parentFaithId: dominantFaith(s)` — the folk faith (≥ 0) — so a de-novo organized religion, which starts its OWN rootFaithId, still takes a ±20° shade of the folk faith's hue; the golden-angle branch is only reachable for folk faiths themselves (whose default hue at line 186 is `(40 + id * 67.5) % 360`, which repeats every 16 ids anyway). Result: unrelated organized religions born within one folk sphere read as one colour band on the Faiths map, contradicting the comment's 'a de-novo faith is golden-angle spread away' and blurring the schism-vs-new-root visual distinction the rootFaithId machinery exists to support.

**Fix:** Key the hue rule on root membership, matching rootFaithId's own logic: inherit-with-jitter only when `parent && parent.kind === "organized" && !f.syncretic`; otherwise golden-angle spread by id.

### 197. "The annals are ash" marker is emitted for every sack even when no record actually burned, alongside the surviving calamity entry itself
`src/sim/peopleSim/historiography.js:196` · **LOW** · UI/UX · verdict: **ADVISORY** · found by `narrative`

Lines 196-200 push an "(the annals of the years before this are ash — the archive burned with the capital)" line for EVERY step in sackSteps unconditionally. SACK_SURVIVAL is 0.45 per record, so for a realm with few pre-sack events it is quite possible that every record survived the roll — the tradition then claims its annals burned while displaying an unbroken record right above the marker. Conversely a twice-sacked realm shows two ash markers even if the second sack had nothing left to burn. The seam the UI is meant to show (line 124-125: "render the tradition with its seams showing") misreports where the seam is.

**Fix:** Track whether any event was actually dropped per sack step (a `burnedBy` map filled in the loss loop at lines 164-171) and only emit the ash marker for sacks that destroyed at least one record.

### 198. A sim-step exception in the worker silently halts the sim while the UI still shows 'playing'
`src/peopleSimWorker.js:242` · **LOW** · UI/UX · verdict: **ADVISORY** · found by `persistence-workers`

In tick(): `catch (err) { self.postMessage({ type: "error", ... }); playing = false; break; }` — the worker-local `playing` flips to false, but the main thread's React `playing` state is not informed; WorldSim.jsx handles the error message with only `console.error('[SimWorker]', d.message, d.stack)` (line 949). Failure scenario: any exception inside stepPeopleSim mid-run — the step counter freezes, snapshots stop advancing, the play button stays depressed, and the user gets no visible indication anything went wrong unless devtools is open. The paused-state refreshes (e.g. 'select' → `if (!playing && world) buildSnapshot()`) also stop working coherently because worker and UI disagree about the play state.

**Fix:** Include the halt in the protocol — post `{ type: 'error', fatal: true, playing: false }` (or a dedicated 'halted' message) and have the main thread setPlaying(false) and surface a visible toast/banner.

### 199. Politics-lens map colours (relaxed hue wheel) disagree with the id*61 hue used by every other colour swatch in the UI
`src/WorldSim.jsx:2125` · **LOW** · UI/UX · verdict: **ADVISORY** · found by `ui-render`

The Country view colours realms via assignCountryColors' force-relaxed hues (`hues.get(cc)`, line 2125), which drift away from their `(id*61)%360` seeds over time. But the Realms panel swatch (line 2812 `((c.id*61)%360+360)%360`), leaderboard rows (3660/3677), settlement-card country chip (3165), colony ships (2426), and the terrain-view claim tints (2157) all use the static id*61 hue. Failure scenario: after the relaxation has drifted, click a realm in the Politics lens — the panel swatch shows a visibly different colour from the territory the user just clicked, and toggling Terrain↔Politics recolours every realm.

**Fix:** Ship the resolved hue map to the panels (countryColorsRef is already at hand) and use it everywhere a realm swatch is drawn, falling back to id*61 only before the first solve.

### 200. Money-flow legend documents markers the renderer deliberately no longer draws
`src/WorldSim.jsx:3953` · **LOW** · UI/UX · verdict: **ADVISORY** · found by `ui-render`

The Money view legend (lines 3953-3972) explains a mining 'money minted' radial glow and per-settlement 'Gaining wealth / Losing' dots — but the draw pass explicitly skips them: 'Per-settlement markers (the net-wealth node dots and the gold mining-source glow) are intentionally NOT drawn' (lines 2882-2884). The legend's dot-density text ('its share of THIS tick's total activity') also describes the OLD budget scheme the code replaced (comment at 2833-2836: every link now gets a constant-spacing stream scaled by log-busyness). A player reading the legend hunts for glows and red dots that cannot appear.

**Fix:** Rewrite the legend to match: coin streams only, brightness/spacing = log link busyness; delete the mining/node-dot rows or reinstate those markers.

### 201. Escape closes most overlays but leaves the Country Editor armed — the next map click still drops a realm
`src/WorldSim.jsx:2778` · **LOW** · UI/UX · verdict: **ADVISORY** · found by `ui-state`

The keyboard handler's Escape branch closes menu/newWorld/chronicle/dynasty/techTree/layers and clears the selection: `setMenuOpen(false);setNewWorldOpen(false);setChronicleOpen(false);setDynastyOpen(false);setTechTreeOpen(false);setLayersOpen(false);setSelectedSettlementId(-1);` — but not `setEditorArmed(false)` (nor editorOpen/leversOpen/showTuning/rightPanel). Failure scenario: user arms the editor, changes their mind, presses Escape (the universal cancel), then clicks the map to inspect a city — onCanvasClick's `if(editorArmedRef.current&&simWorkerRef.current){...postMessage({type:'editor.placeCountry',...});return;}` (line 2683) irreversibly spawns a fully-formed seed realm into the simulation instead of selecting.

**Fix:** Add `setEditorArmed(false)` (and arguably setEditorOpen/setLeversOpen/setShowTuning/setRightPanel("")) to the Escape branch.

### 202. Globe never resizes with its container — only with the window — so layout changes clip/mis-fit it
`src/GlobeView.jsx:154` · **LOW** · UI/UX · verdict: **ADVISORY** · found by `ui-shell`

Renderer size and camera aspect are set once from `el.clientWidth/clientHeight` at mount and updated only via `window.addEventListener('resize', onResize)` (line 154). The container's size also changes WITHOUT a window resize: opening the in-flow right panel (`rightPanel==="params"`, WorldSim.jsx:4055) or the Layers panel reflows the center column; the map area has `overflow:"hidden"` (WorldSim.jsx:3843). Failure scenario: open the globe, then open Wind & Moisture from the menu → the center column narrows, the renderer canvas keeps its old pixel size and is clipped on the right (or letterboxed wrong) until the user happens to resize the browser window.

**Fix:** Replace the window listener with a `ResizeObserver` on `el` (call the same onResize); disconnect it in cleanup.

### 203. Worker load path restores _wantMoneyFlows but not _identityLens — Peoples/Faiths lens goes dead after loading a save
`src/peopleSimWorker.js:174` · **LOW** · UI/UX · verdict: **ADVISORY** · found by `hunt-save-load`

On "load" the worker replaces the world object and re-derives `world._wantMoneyFlows = (viewMode === "money")` (peopleSimWorker.js:174) but NOT `world._identityLens`, which is only set in the lens-change handler (line 147: `world._identityLens = (viewMode === "culture" || ...) ? viewMode : null`). Failure: the user is viewing the Peoples lens, loads a save; the new world has `_identityLens` unset, so index.js:288 never calls diffuseIdentityField, and `staticSent = false` forces the snapshot to ship the freshly-allocated (empty, all −1) identity field — the lens renders blank/stale until the user manually switches lenses away and back.

**Fix:** In the load handler, mirror the lens logic: `world._identityLens = (viewMode === "culture" || viewMode === "faith" || viewMode === "language") ? viewMode : null;` (and optionally run one diffuse pass before buildSnapshot, as the lens handler does).


## Claims that did NOT survive verification (recorded for honesty)

### 204. Floodplain moisture bump makes the hot river cradles read as malaria belt, contradicting every 'spares the Nile' disease mechanism
`src/sim/peopleSim/state.js:155` · **HIGH** · Bug · verdict: **REFUTED** · found by `core-loop`

initTerrain marks floodplain tiles and then mutates the shared moisture field: `if (isFlood) { world.tFlood[ti] = 1; moist[ti] = Math.max(moist[ti], 0.45); }`. The comment justifies this for the transport-cost hot-dry penalty. But the SAME moist array feeds the habitability disease signals: settlement.js climateOf (line 507) caches `s._climMoist = world.moist[ci]`, and habitability.js malariaSignal computes `damp = c01((effMoist(temp,moist) − 0.16)/0.34)` with `effMoist = m/(0.5+0.5t)`. Failure scenario, traced: a Nile-type cradle tile has temp ≈ 0.78 (the seed filters require 0.62–0.92) and raw moist ≈ 0.10 → effMoist ≈ 0.11 → damp = 0 → no disease, as the levers document ('spares the warm-DRY river cradles — the Nile, Mesopotamia, the Indus', TROPICAL_DISEASE/STATE_DISEASE/TROPIC_SPARSE descs). After the bump, moist = 0.45 → effMoist = 0.45/0.89 ≈ 0.51 → damp = c01(1.02) = 1.0 (full), and tropicalWarmth(0.78) = 0.6, so malariaSignal ≈ 0.6 on the very tiles the cradles sit on. At default levers that is: carrying capacity ×(1 − 0.6·0.6) ≈ −36% (settlement.js diseaseBurden), ~2–3× the state-founding population bar (STATE_DISEASE = 2.0 reuses s._wetTropic), and thinned village spacing in the valley (TROPIC_SPARSE = 0.9 via settleHostility, crystallize.js:118). The mechanism built to keep the wet tropics sparse is instead firing on the arid-river cradles the whole cradle-flywheel 

> **Dissenting verifier:** The mechanical trace is correct — the flood bump mutates the shared world.moist array, climateOf caches it into _climMoist, and malariaSignal yields 0.6 on hot cradle tiles that would otherwise read 0 — but the "bug" framing fails because habitability.js:40-41 explicitly designs warm river cradles to take exactly this partial malaria hit ("they were malarial too... survive on irrigation, as they did historically"), producing the tropicalWarmth-capped 0.6, not a full 1.0 belt. The "spares the warm-DRY cradles" lever prose spares them from the FULL tropical/savanna disease belt and (for TROPIC_SPARSE) from the ARID term via the river, not from all malaria; the finding conflates these. The crad

**Fix:** Keep the habitability inputs pristine: either store a separate `moistRaw` Float32Array before the flood bump and have climateOf/crystallize pass that to malariaSignal/settleHostility, or make the transport core read a dedicated 'wetted' flag (it already has tFlood) instead of mutating moist. Alternatively pass river-access/tFlood into malariaSignal as an exemption, mirroring aridSignal's riverAcc parameter.

### 205. Country claim-budget ramp (world._cBudgetRamp) not serialized — every realm's territorial claim collapses to base reach after load
`src/sim/peopleSim/countryTerritory.js:389` · **HIGH** · Save/load · verdict: **REFUTED** · found by `hunt-determinism`

The claim pass eases each country's reach toward its tech target via a persistent per-country ramp: `let ramp = world._cBudgetRamp; if (!ramp) ramp = world._cBudgetRamp = new Map();` with `next = prev === undefined ? ((inherit && inherit.has(c)) ? target : Math.min(target, COUNTRY_REACH_BASE * resScale)) : prev + (target - prev) * BUDGET_RAMP` (lines 391-397). COUNTRY_REACH_BASE = 4 and BUDGET_RAMP = 0.06. persist.js does not save `_cBudgetRamp` (nor `_inheritReach`), so after loadWorld every country has `prev === undefined` and is NOT in `_inheritReach` — a mature empire whose ramped budget was, say, 40 reach-units restarts at 4×resScale, exactly like a brand-new cradle village. Failure scenario: save a world with several large empires; load it; on the next territory pass (T.TERRITORY_INTERVAL = 144 ticks) computeCountryTerritory recomputes `_countryOwner` with base-level budgets → every realm's projected claim shrinks to a small blob around its settlements, relaxClaim then crawls the drawn borders inward, and downstream mechanics that read the territory map (adoptAndFound village adoption, nucleateFrontierStates, eliminateEnclaves, the identity field mask) all operate on a collapsed political map for the ~50 territory passes (~7000+ ticks) the 0.06 ramp needs to recover. The loaded world is visibly and mechanically NOT 'the same world mid-breath' that persist.js promises.

> **Dissenting verifier:** _cBudgetRamp is indeed unserialized, but the claimed collapse cannot occur: PERSISTENT_TERRITORY defaults to 1 (tuning.js:117), and computeCountryTerritory snapshots the loaded _countryOwner (saved/restored at persist.js:121/197) into _coPrev (countryTerritory.js:301-306), then mergePersistentTerritory (lines 552, 587-633) re-stamps all worked tiles from the saved _territoryOwner (persist.js:122/198) and re-asserts every march the shrunken fresh reach left wild from that saved map (line 617), so every realm's held territory survives the first post-load pass intact. Downstream mechanics (identity mask, enclaves, adoption via the also-saved _countryClaim, persist.js:120/196) never see a collap

**Fix:** Serialize `world._cBudgetRamp` in saveWorld's `tables` (mapToArr/arrToMap like `_warExhaust`); alternatively, on load seed `_inheritReach` with every live countryId so the first ramp pass starts each realm at its full target (the same mechanism secession states already use via snapClaim).

### 206. Post-merge border smoothing erodes 1-wide worked-catchment ribbons — the "catchment cores are protected" claim (commit 31942dc) is false, only HOME tiles are pinned
`src/sim/peopleSim/countryTerritory.js:559` · **MEDIUM** · Bug · verdict: **REFUTED** · found by `territory-identity`

After mergePersistentTerritory, line 559 re-runs `smoothCountryBorders(world, co, T.BORDER_SMOOTH | 0)` (default 2 iterations), with the comment "settlement home tiles are PINNED, so it never erases a settled corridor or a durable catchment core (that's real held land)". But the pin set is only `for (const s of world.settlements) { if (s.mode === "settled") prot[(s.pos.y|0)*tw + (s.pos.x|0)] = 1; }` (line 756) — one tile per settlement, not the catchment. Wilderness votes in the majority filter (a -1 neighbour is a value like any other, line 777-782, flip at `bestC >= 5`). Failure scenario: a Nile-style ribbon realm whose worked floodplain is 1 tile wide (crystallize.js:36 says floodplains are "1-5 tiles wide"; FLOOD_SPACING_MUL packs homes ~3 apart). A ribbon tile between two pinned homes has 2 same-owner neighbours and 6 desert-wilderness neighbours → 6 ≥ 5 → flipped to -1. The persistent CORE stamp (line 608, `co[ti] = s.countryId`) re-asserts it next pass and the smoothing erases it again — a standing stamp/erase cycle whose visible output is the ribbon chopped into pinned dots, exactly the valley-state the whole persistent-territory spec is trying to make cohere. This directly contradicts the merge's own contract that "worked land is durable and path-dependent by construction" (lines 573-577).

> **Dissenting verifier:** The worked catchment (_territoryOwner) is never a 1-wide fertility ribbon: territory.js guarantees every settled settlement a 3×3 core block (coreRadiusFor ≥ 1, lines 121-129, stamped at 217-227 with only elev>0 checked — desert included) plus a nearest-wins hinterland disc of radius 3 at default tier/tuning (HINTERLAND_BY_TIER[0]=3, HINTERLAND_MULT def 1.0, lines 138-147, 244-259) that likewise claims barren tiles regardless of fertility. So mergePersistentTerritory's CORE stamp paints a band ≥3 (typically ~7) tiles wide along a floodplain settlement chain, and any band ≥2 wide is stable under the bestC ≥ 5-of-8 majority filter (a straight-edge tile has at most 3 wilderness neighbours; inte

**Fix:** Pin every CORE tile in the post-merge smoothing pass, not just home tiles — mergePersistentTerritory already computes exactly that set (the tiles it stamped at line 608-609 / the `reached` seeds with qt index); pass it (or reuse `world._persistReach` before the flood extends it) as the `prot` mask for the second smoothing call. The pre-merge smoothing call at line 546 can keep the old home-only pinning.


---

