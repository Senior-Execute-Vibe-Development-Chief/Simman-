# TIER C PHASE 1 v3 — THE MARKET-SITE LEDGER: label supply from the drainage/coast skeleton, activation from the field

**Status: DESIGN, measured foundation (probe run on HEAD 237247c, branch claude/civ-simulation-balance-ysrx3v). Deliverable of the v2 verdict's follow-up. Probe source: scratchpad `probe_sitecandidates.mjs`, `probe_censusoverlay.mjs`, `probe_harborfloor.mjs` — to be committed as `tools/probe_sitesupply.mjs` at implementation.**

## 0. Frame — what five falsifications leave standing

Five geometries are measured dead (design-c-label-extraction.md v1/v2 addenda + crystallize.js header): (1) fixed-disk exclusivity = a spacing constant (29 vs 78); (2) seats-outside-every-horizon + unserved-mass bar = a covering constraint (pinned 32, cv 0.21); (3) seat-spacing ≥ R + full-catchment bar = the same covering count dynamically; (4) capture/threshold without geometric floor = saturated by the mature field; (5) watershed of the horizon-smoothed popField = supply equals the demand field's attractor texture, which is **grid-resolved** (38/82/113 at 240/480/960).

The v2 verdict prescribed v3's direction: source market-site structure from resolution-invariant real-scale fields. **The direction as stated is half right, and the probe below says precisely which half.** The load-bearing claim — "terrain fields have real spatial structure at physical scales, so their maxima count per real area is grid-invariant by construction" — is **FALSE for field maxima and TRUE for network topology**. The v3 law is built only on the half the numbers support.

## 1. The measured foundation (the table the design stands on)

Protocol: `buildSim` at 240/480/960 pixels (sim tw 120/240/480, rn = 0.5/1/2), seed 8817 (river arm re-run on 4242), all static reads at t=0, plus one 12k-step lever-OFF maturity run at 480 for the census overlay. "ref-tiles" = 240-tile reference grid units throughout.

### 1a. REFUTED — smoothed static-field maxima are grid-textured too

Watershed basins (v2's exact kernel + pointer machinery, source swapped from popField to static fields), land-rooted counts at 240/480/960:

| source field, kernel | 240 | 480 | 960 | verdict |
|---|---|---|---|---|
| fert, integer kernel (v2's rounding) | 24 | 45 | 85 | ×3.5 — FAIL |
| fert, fractional kernel (exact real support) | 36 | 35 | **63** | flat 240→480, ×1.8 at 960 — FAIL |
| fert×locMul (river ×6, coast ×3), int | 57 | 133 | 331 | ×5.8 — FAIL |
| fert×locMul, frac | 72 | 92 | 181 | ×2.5 — FAIL |
| shelter field, horizon watershed (harbors) | 21 | 15 | 20 | count small AND positions unstable (33–60% match) — FAIL |
| raw 8-neighbour maxima of shelter (harbors) | 150 | 282 | 550 | nn locked at ~3 *tiles* at every grid — pure grid texture — FAIL |

Two mechanisms, both now measured: (i) **worldgen's fields are not band-limited at the horizon scale** — real-Earth elevation, hydraulic-geometry flood ribbons and river-moisture traces carry real structure below 480's pixel, so a finer grid resolves more texture and the smoothed surface sprouts more attractors (the exact failure class of v2's popField, one level down); (ii) **v2's integer kernel rounding is itself a resolution leak** — `r = round(TOWN_BASIN_R·rn/2)` gives real support 14/11/10.5 ref-tiles at 240/480/960, up to ×1.9 count distortion on the same field (**v2 erratum: any surviving smoothing must use fractional edge weights**). Conclusion: *"real structure at physical scales" does not imply "band-limited at the horizon scale." No field-maxima law can be the candidate source.*

### 1b. PROVEN — drainage/coast **topology** at absolute real bars, quantized at the horizon, is invariant

riverGen already classifies by absolute km² of discharge-equivalent catchment (`CATCH_*`, `km2PerAccum` — built for resolution invariance). Counting **nodes of the flow tree** (pixel grid): confluences = ≥2 upstream branches each ≥ bar; mouths = ≥ bar entering true ocean; sinks = sealed endorheic termini ≥ bar:

| discrete nodes, seed 8817 | 240 | 480 | 960 | 480↔960 |
|---|---|---|---|---|
| confluences ≥ 60e3 km² (CATCH_TRIB) | 249 | 317 | 323 | **+1.9%** |
| confluences ≥ 200e3 km² | 60 | 73 | 65 | −11% |
| ocean mouths ≥ 60e3 km² | 368 | 232 | 255 | +9.9% |
| ocean mouths ≥ 200e3 km² | 72 | 74 | 81 | +9.5% |
| terminal sinks ≥ 60e3 km² (480) | — | 8 | — | small real class |

Raw nodes cluster along mainstems (nn 1.4–1.9 ref-tiles, cv ~1.0 — junction chains), so the ledger needs a **real-scale quantizer**: greedy keep-largest-first (by km², strict total order), reject within D real distance. With D = TOWN_BASIN_R/2 = 5 ref-tiles (the attractor half-support of v2's blessed merge ruling — two features within half a horizon are one physical site):

| horizon-merged skeleton (D=5) | 240 | 480 | 960 | notes |
|---|---|---|---|---|
| river nodes (conf+mouth), seed 8817 | 165 | 149 | 142 | **480↔960 −4.7%; 240 +11%**; nn 6.3–6.8, cv 0.38–0.49 |
| river nodes, seed 4242 | 158 | 139 | 141 | **+1.4%** at 480↔960 — robust across seeds |
| river nodes, D=10 sensitivity | 70 | 63 | 66 | ±6% — invariance not an artifact of D |
| anchorages (shelter ≥ 0.30, ranked by shelter) | 126 | 165 | 172 | **480↔960 +4.2%; 240 −24%** (sub-pixel bays — representation limit) |
| union at 480 (rivers+sinks first, then bays) | — | **203** | — | 154 river/sink + 49 additional bays |

**Same real places, not just same counts** (cross-grid position match at R/2): confluences 480↔960 **97.5%**, mouths 96.6%, merged river skeleton 91.3% (83.6% even 240→960), raw bay maxima positions 90–99% (only their count quantization was grid-driven — the quantizer rescues exactly that). Spacing cv 0.38–0.49 = geography-following, nothing like the refuted covering laws' 0.21.

### 1c. The demand overlay (480, 12k steps, lever OFF, seed 8817)

- **93.6%** of the 78 mature OFF labels stand within 5 ref-tiles of a skeleton site (100% within 7.5): the sim's own emergent towns *already sit on this skeleton* — the quality scorer put them there. Snap-founding moves almost nothing.
- **99.9%** of field population (9.45M) lies within one horizon (R=10) of a skeleton site: no stranded countryside.
- **47.3%** of the 222 bar-clearing disk-census sites lie within 5 ref-tiles of a site (68.5% at 7.5): **half the demand texture is diffuse rain-fed interior that the skeleton does not host.** This is the design's honest ceiling: the interior-pocket candidate class fails invariance today (§1a), so v3's realized ON supply projects to ~105–203 at 480 — decisively above the 78-pin and v2's 82-attractor ceiling, but *not* full census tracking (~0.5–0.7 of it).

## 2. The law

Three parts, in the demand/supply split v1/v2 established: **structure supplies, population activates, exclusivity is a partition.**

### 2a. The SITE LEDGER (static candidate supply)

Computed once per world from worldgen output (rebuilt deterministically at load — the `_floodTiles`/transportDist re-warm lifecycle; nothing persists):

- **Class N — river nodes** (pixel flow tree, `worldRef.rivers`): confluences (≥2 upstream branches each ≥ `CATCH_TRIB` = 60e3 km² discharge-equivalent), ocean mouths (≥ bar, next hop true ocean), terminal sinks (≥ bar, sealed terminus — the oasis/terminal-lake market). Ranked by km².
- **Class H — anchorages** (sim grid): near-shore sea tiles with shelter = land-fraction in the R/2 real disk ≥ `SHELTER_MIN` = 0.30 (meaningful enclosure; excludes open-sea rocks and cape tips), local maxima under the strict order (shelter, −index), ranked by shelter. The greedy quantizer — not the raw maxima — is the class: *the best anchorage per horizon stretch of coast.*
- **The quantizer**: one greedy pass over Class N by rank, then Class H by rank against the accepted set: accept iff no accepted site within `SITE_MERGE_D` = TOWN_BASIN_R/2 real distance. A mouth in a bay is one site (the mouth, which outranks). Deterministic: strict sort orders, fixed tie-breaks by (value, x, y).
- Each accepted site maps to its sim tile (nearest land sim tile within 1 tile if coastal aliasing strands the pixel — deterministic scan order); the ledger is an array of {tileIndex, class, rank}, expected K ≈ 200 at 480-scale worlds, ≈ area-proportional on larger maps.

### 2b. The CLAIM geometry (exclusivity)

- **Site cells**: partition every tile to its nearest ledger site (Euclidean real distance; ties by site rank then index) — a static `Int32Array(N)` site-id map plus an in-horizon flag (tile within TOWN_BASIN_R of its site), computed once with the ledger. Land beyond every site's horizon is subsistence countryside — unclaimable, field-fed (the market-shed doc's own rule).
- **One label per cell.** A cell is claimed iff a settled label stands in it; claims are recomputed from the live label set each CRYSTAL_INTERVAL pass and stamped live on mint (the gridAdd discipline — v2's exact claim lifecycle, re-keyed from basin-roots to site-ids). Label death → lapse → the site is refoundable (Jericho persistence, for free).
- v2's smoothed-popField watershed **retires from the supply path entirely** (it was the resolution leak); `computeLabelBasins`/`labelBasinCensus` survive as instrument-only reads for cross-version probe continuity.

### 2c. ACTIVATION (demand) and the founding act

- **The bar**: a site activates only when Σ popField over its cell ∩ horizon ≥ `T.LABEL_BAR` (default 360 — unchanged, absolute by the deflation-audit ruling). One O(N) gather per CRYSTAL_INTERVAL refresh (cheaper than v2's smooth+watershed rebuild, ≤ ~1ms at 480).
- **The sweep inverts**: instead of 120 random tiles praying to land on viable ground, the crystallization pass iterates the ledger's unclaimed, bar-clearing sites and rolls each with the *existing* probability machinery evaluated at the site tile — quality (fert/areaFert gates, resource/geo/defense/holy bonuses), diffusion × pioneerTempo of the nearest donor, saturation damper, ×dt. spacingFactor ≡ 1 (exclusivity is the cell). A site on dead ground (fert < MIN_FERT) never fires spontaneously.
- **Founding stays the conserved ACT**: TOWN_FOUND_MIN=90 real people debited 1:1 from the field around the site (fieldShift), ONE_POP credit, born-into-state gates (grown claim, statecraft symmetry, FISC_ADOPT, NATION_TECH_FLOOR) verbatim. The label founds AT the site tile.
- **Other mints** keep their act semantics, siting through the same three-function API: daughters/sea parties choose the best unclaimed bar-clearing site within their existing range (sea landings thereby target mouths/anchorages — colonists land at harbors); plantations keep their documented exemption (marches are forts, not markets — site-free, but they claim the cell they stand in); rode-away camps exempt (ordu). Dissolution unchanged (demographic wither + witnessed lapse).

### 2d. What survives from shipped v1/v2 code

The **API survives 1:1** — `labelBasinFree`(→ cell of (tx,ty) unclaimed and in-horizon), `labelBasinMass`(→ cell∩horizon mass), `labelClaimBasin`(→ claim cell) — so every call site (sweep 725/980/1035, sendSettlers 1382/1426, plantations 1618, legacy urban genesis 1728, sea.js 796/869) is untouched or trivially re-pointed. Carried unchanged: the claims-from-live-labels rebuild, the CRYSTAL_INTERVAL staleness cadence (perf cadence, not a content gate), all v1 deflation-guard rulings, the persist v<5 regime guard (persist.js:369-372), the conserved founding act, and the OFF path byte-identical (lever default 0).

## 3. Why THIS is resolution-invariant (and the honest limit)

- Node counts of a tree thresholded in absolute km² are **topological real quantities** — riverGen's bars were built for exactly this and the table confirms it end-to-end (±2–10% at 480↔960).
- The quantizer and the horizon are **real lengths already shipped with physical meanings** (TOWN_BASIN_R = one market catchment; D = its attractor half-support per the v2 kernel ruling). No planar packing law: D acts on the ~1-D feature skeleton only; realized spacing (cv 0.4–0.5) comes from geography and demand.
- Supply scales with **real area** (bigger map ⇒ more drainage/coast structure) and with **density** through activation (sparse steppe cells never reach 360; dense valleys activate wall-to-wall) — while the *ceiling* is geographic, which is the claim's content: towns are where geography concentrates exchange.
- **Representation limit, stated**: a 240-pixel grid cannot see sub-pixel bays and under-resolves the 60e3 km² network (harbors −24%, rivers +11% there). This is the same irreducible class as the flood-share ±20% residual, bounded and measured; the discipline bar is 480↔960 ≤ ±10% (met: −4.7%/+4.2%) with 240 within ~±25%.

## 4. Constants (cardinal rule 2 audit)

- REUSED, unchanged meaning: `CATCH_TRIB` = 60e3 km² (riverGen's tributary bar — a market node is a tributary-scale junction/mouth/terminus); `TOWN_BASIN_R` = 10 ref-tiles (market horizon: bar disk + act-snap radius); `T.LABEL_BAR` = 360 (absolute field-people bar); `TOWN_FOUND_MIN` = 90 (founding quantum); CRYSTAL_INTERVAL (cadence).
- DERIVED, not free: `SITE_MERGE_D` = TOWN_BASIN_R/2 (attractor half-support; D=10 sensitivity row shows invariance is not riding on the choice).
- NEW, one: `SHELTER_MIN` = 0.30 — an anchorage's horizon half-disk is ≥30% enclosed by land (excludes open water and cape tips; deliberately below the straight-shore 0.5 because the *ranking*, not the floor, selects — the class is "best anchorage per stretch," the historically real chain of ports; floors ≥0.45 were probed and are *less* invariant, +15–32% at 960, because enclosure values grid-sharpen).
- EXPLICIT NON-CONSTANTS: no site count, no spacing target, no per-region fudge anywhere; the fractional kernel replaces integer rounding wherever smoothing survives (instruments).

## 5. Determinism, perf, save

All ledger passes are fixed-order integer scans + strictly ordered greedy (no rng); the cell map is one deterministic multi-source BFS. One-time cost ~tens of ms even at product grids; per-refresh cost one O(N) gather (below v2's 1.3–1.8ms/5.6–7.4ms rebuilds); founding pass O(K≈200) instead of 120 random-tile rejects. Save: nothing persists — ledger/cells rebuild from the pipeline's deterministic worldgen at load (the same contract that rebuilds `w.rivers` itself); claims rebuild from live labels; snap-founded labels stand on their sites so claim reconstruction is exact; legacy off-site labels claim the cell they stand in. No schema change; SAVE_VERSION regime guard already shipped.

## 6. Acceptance battery (same six arms as v2, same bars, plus the invariance arm)

1. **probe_entitysupply 480×12k, 8817, OFF vs ON** — flip criterion verbatim: ON materially exceeds OFF (78) and tracks the ~218–222 census; report claimed/total *sites* by class as the uptake channel; drift (deflation guard) within v2's envelope; ms/tick ≤ v2's ON cost.
2. **probe_entitysupply 960×6k** — the W4 pin must break *invariantly*: ON real label count at 960 within ±20% of ON at 480 **at matched pfTot**, not accelerating past it on grid texture (v2's failure signature).
3. **Stylized 3 seeds (8817/4242/777), lever ON** — all hard gates, soft ≤ 2 (777 exceeded under v2 — carried watch, plus the 8817 market-integration and 31337 clustering canaries).
4. **probe_empires 480×12k lean, ON** — realm count rising with label supply, no shatters/confetti, 1-member share on the v2 young-realm trajectory.
5. **Byte-identity lever-off** — probe_hashbase 320 AND 480 unchanged (v2 recorded 18ad7c15/256a490b, 3811ccd8/43a9f644); npm test green.
6. **probe_roundtrip_deep on the ON path** — ledger/cell/claim rebuild exactness across save→load→save.
7. **NEW: probe_sitesupply (this probe, committed)** at 240/480/960 × 2 seeds — ledger counts within the §3 bars and ≥90% cross-grid position match at 480↔960; this table is re-run whenever worldgen’s hydrology changes.

## 7. Risks — how THIS design fails, named before an implementer finds them

1. **The diffuse-interior half (HIGH — the flip decider).** 53% of census demand-sites are off-skeleton; projected ON plateau ~105–203 vs census 222. If the flip bar's "track the census" is read strictly, v3 lands ~0.5–0.7 and the flip stalls *by design honesty*: the missing interior class needs band-limited worldgen texture (a worldgen contract change) before any field-maxima class can be invariant. Do not paper over with a lower bar or interior spacing quotas — surface it as the recorded next system.
2. **Euclidean cells mis-bind across barriers (MED).** A ridge-backed valley's mass can count toward the wrong site's bar. Second-order for counts (93.6% of towns already co-locate), but the upgrade path is real: swap the cell metric to the C1 market-shed cost partition when it lands — same law, same constants, better metric. Flag any stylized clustering anomaly to this first.
3. **Coast-quantization critique (MED).** Class H with a 0.30 floor is "coastline sampled at the horizon by best shelter" on straight shores. Defended as the port-chain reality and by activation gating — but if empires probe shows coastal label chains outpacing interior realms unhistorically, raise the class to strict concavity (0.5+) *and* accept its measured 960 drift, or defer the class; decide on data, not taste.
4. **Twin-cell mass splitting (MED-LOW).** Sites 5–6 ref-tiles apart halve a valley's mass between cells; both may sub-bar where v2's single attractor cleared. Cradle floodplains are massively over-bar (non-issue); marginal belts may under-found — visible in arm 1's tier composition.
5. **Static-ledger historicity (LOW-MED, philosophical but real).** A pure-route city with no terrain feature (Palmyra) cannot arise; works/roadFlow are grid-textured sim outputs and MUST NOT become candidate sources until they carry real-scale structure. The ledger is quasi-static like real site geography; the *dynamic* history is which sites live — but record the limitation.
6. **240-grid deficits (LOW, bounded).** −24% harbors/+11% rivers at the probe's coarse grid: representation limit, documented, not law-driven; product grids are ≥480.
7. **Perf inversion at scale (carried from the survey, unchanged).** More labels raise per-label passes; C3 remains the fix; measure ms/tick at 960 in arm 2 before any flip.

## 8. Open questions

1. Flip-bar language for arm 1: is "exceeds OFF, invariant across grids, ≥~1.5× the pin" sufficient for C1's purpose (W4/R1) with census-tracking reported-not-gated until the interior class exists? (Owner call; the design recommends yes, explicitly recorded as partial-census.)
2. Terminal-sink class bar: 60e3 km² yields 8 sites — should sinks use the endorheic-strict multiple (×2.5) for symmetry with riverGen's TERMINAL_STRICT display rule, or stay at the market bar? (Trade-geometry says market bar; display consistency says strict.)
3. Should activation-quality at sites reuse `geoBonusFor` as-is (its 3×3 proxies are grid-textured but now only modulate *rates*, not supply) or be re-derived from the node's own km²/shelter rank (cleaner, one less texture read)?
4. Sea-party siting: when no unclaimed coastal site exists in range, fail-and-wait (recommended, matches v2 decline) or fall back to any unclaimed cell?
5. When C1-shed lands (design-c-label-extraction §1), do cells re-key to cost-basins wholesale, and does the ledger then also seed the shed's market sites (one structure, two consumers)?

---

## COMPACT VERDICT

**v3 as designed CLEARS the invariance bar in the probe table — but only because it abandoned half of the prescribed v3 direction.** Measured, same seed, 240/480/960: horizon-merged river-node skeleton **165/149/142** (D=5; 480↔960 −4.7%; second seed 158/139/141, +1.4%), D=10 sensitivity 70/63/66; anchorage skeleton **126/165/172** (480↔960 +4.2%; the 240 deficit is sub-pixel bays, the accepted representation-limit class); raw confluences at the absolute 60e3 km² bar 249/317/323 with **97.5%** position co-location 480↔960; union ledger **203 sites at 480**. The other half of the v2-prescribed direction — maxima of horizon-smoothed static terrain fields — is **refuted by the same table** (fert 36/35/**63**, pull-form 72/92/**181**, fractional kernel; worse with v2's integer kernel, which is itself a newly measured resolution leak): worldgen fields are not band-limited at the horizon scale, so *any* field-maxima law inherits grid texture — only network **topology** at absolute physical bars, quantized at the blessed horizon scale, survives. Demand-side fit: 93.6% of mature OFF labels and 99.9% of field population sit on/within the skeleton's horizon, so the law founds where the sim already proves towns belong; the honest residual is that only ~47% of the mature disk-census demand texture is skeleton-hosted, so v3 breaks the W4 pin invariantly (projected ON ≈ 105–203 vs the 78 pin at 480) but will not fully track the ~222 census until an interior-pocket class exists — which requires a band-limited worldgen texture contract first, named here as the recorded follow-up rather than patched with a fitted constant.
---

## C1 v3 FLIP VERDICT (2026-07-29) — supply PROVEN INVARIANT, but UNREACHABLE

Measured (480/12k seed 8817): ON reaches 78 labels by step 2000 and then
**freezes for 10k steps** — zero foundings, zero deaths — against the same
78 the OFF pin produces. 128 of 206 bar-clearing sites stand free: 51 on
dead ground (fert), 8 areaFert, and ~66 **transport-isolated** (median 43
tiles to the nearest settlement, far beyond FRONTIER_EXTEND_DIST /
COLONY_MIN_RANGE = 28). Stylized ON 1/3 seeds (all misses quiet-world
softs). The invariance arm PASSED decisively (960 ON = −2.6% of 480 ON at
matched development; v2's texture-acceleration signature gone) and the
site ledger itself passed its §3 bars on both seeds (union 178/207/205 and
170/205/208 at 240/480/960; position match 94–97%).

**The diagnosis — three falsifications now say three different things:**
v1 failed on GEOMETRY (fixed radius = a spacing constant), v2 failed on
RESOLUTION (smoothed-field attractors are grid texture), v3's supply law
is geometrically and resolutionally sound and fails on **REACHABILITY**:
quantizing foundings to the skeleton removes the intermediate random-tile
creep by which the old sweep crossed deserts and mountains, and the
frontier act machinery (FRONTIER_EXTEND_DIST, the independence distance,
census-priced act bars at the frozen ONE_POP bridge) cannot hop
site-to-site distances.

**Therefore the next attempt is NOT a fourth siting geometry.** The
binding constraint has moved into the frontier ACT ECONOMICS — how a
people crosses an empty gap to reach a viable site (relay/staging,
distance-priced expedition cost against real terrain, or a migration-led
settling that the field already models). That is its own mechanism design,
and it is where C1 resumes. Recorded, with the ledger shipped dormant and
byte-identical off (hashes unchanged: 18ad7c15/256a490b, 3811ccd8/43a9f644).
