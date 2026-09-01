# M0 questions log

M0 records unresolved specification choices here instead of turning them into
simulation assumptions.

1. `spec/02-architecture.md` describes dev and target grids but does not give
   exact dimensions. M0 uses `240×120` for `dev` and `960×480` for `target`,
   matching the documented simulation-width conventions in the research notes.
   Please confirm the dimensions and whether width/height refer to simulation
   cells or render pixels before the first terrain field lands.
2. The M0 math contract gives an approximate accuracy and cross-engine
   requirement, but no required approximation family or complete input domain.
   M0 uses explicit range reduction and Taylor/atanh series. The coefficients
   are implementation scaffolding, not physical constants, and should be
   replaced or ratified if a later gate requires a different domain.
3. The WASM bootstrap specifies one deterministic Dijkstra function and a
   hardcoded test graph but does not specify the graph topology or expected
   distances. M0 uses a five-node graph with distances `[0, 2, 3, 4, 6]`;
   this is a toolchain fixture only and must not become routing physics.
---

## Review answers (2026-08-31, spec-session review)

1. **Grid dimensions**: width/height are SIMULATION CELLS, never render
   pixels. `dev` 240×120 is confirmed. `target` 960×480 is accepted as an
   M0 stand-in only: per spec/02 the target grid is 10–20 km, so at M1 —
   when real fields land — `target` becomes **1800×900** (~22 km at the
   equator) and all bench baselines are re-set there. Planned, not silent.
   Related M1 note: the per-write conservation attribution (a function
   call per cell per pass; measured 6.2 ms/tick for ONE trivial field at
   460k cells) must become per-pass aggregated accounting before real
   field counts arrive.
2. **dmath coefficients**: ratified as implementation scaffolding — they
   are representation, not physical constants, and stay OUT of the
   spec/09 world-constants ledger. The bit-golden suite is the binding
   contract; any domain/accuracy revision changes coefficients and
   goldens together in one commit.
3. **Wasm fixture graph**: ratified as a toolchain fixture only; it is
   deleted when the real CRP routing engine lands at M1.

## M1 findings

4. M1 adopts the ratified target grid of `1800×900` simulation cells. The
   copied v1 supplier is sampled at that grid and the substrate owns monthly
   arrays (`cell × 12`); v1 exposes annual temperature/moisture plus seasonal
   amplitude rather than twelve monthly fields, so the adapter expands those
   seasonal fields into monthly values. This is marked `M1-PLACEHOLDER` in
   `substrate.ts` and should be replaced by a directly supplied monthly
   observation/solver contract if the M1 climate review requires it.
5. The M1 Rust API implements the ratified three phases and the layered,
   directed graph, with deterministic Dijkstra workspaces behind the API.
   Nested partition labels are present, but shortcut customization is not
   yet materially faster than the baseline at this milestone; a later CRP
   optimization must remain invisible to the TypeScript caller.
6. The initial target-grid measurements miss the provisional `≤5 ms` point
   query and `≤500 ms` full distance-map budgets on the current Earth
   substrate. Query early termination and pooled workspaces are in place;
   the measured values remain in `bench-baselines.json` and are a performance
   finding, not a relaxed gate.
7. The first travel reality run at seed `42042` exposes real cross-grid
   findings: several long ORBIS routes differ by 12–50% between `dev` and
   `target`, and the coarse raster can lose a land or sea connection. The
   gate remains hard and reports these rows rather than adding route-specific
   corrections; the correct next change is a resolution-invariant topology
   mechanism.
8. The same first gate run passes the fixed freight and daily-speed anchors
   and now produces a measurable Indian Ocean seasonal difference from the
   observed monthly climate. Several ORBIS route rows remain outside their
   25% bands, so `npm run gate` exits nonzero as an explicit M1 calibration
   finding; expected values and route factors were not changed to make this
   first substrate pass.

---

## Review answers (2026-09-01, spec-session review)

4. **Monthly climate contract — resolved, the placeholder is retired for
   Earth worlds.** The observed NCEP monthly climatology (already in
   `data/reality/`) is now sampled directly: each cell's months are the
   sim's own annual fields (keeping worldgen's lapse/orography detail)
   plus the observed monthly anomaly — additive °C for temperature,
   mean-preserving precipitation ratio for moisture. The substrate also
   exposes **monthly wind** (u/v, m/s) — the hemisphere-sine synthesis
   could never carry a monsoon and survives only as the procedural-preset
   fallback, still marked `M1-PLACEHOLDER`.
5. **Accepted.** The three-phase API + layered directed graph stand; CRP
   shortcut customization stays future work behind the same caller
   contract. The engine gained real per-edge geometry in review (per-row
   cos-latitude east–west lengths, precomputed diagonals) — the previous
   per-cell average distorted real km by up to ±20% at mid-latitudes.
6. **Still missed, values updated.** After the physics fixes the target
   grid measures ~47 s substrate, 1.9 s init, 1.7 s customize, 2.4 s
   query, 2.6 s distance-map (the substrate grew honestly: real monthly
   climate + wind sampling). Baselines re-set with headroom; the 5 ms /
   500 ms working targets remain open CRP work, not a widened gate.
7. **Ratcheted into `data/reality/known-misses.json`.** Cross-grid parity
   misses (and dev-only route misses on routes that pass at the shipped
   grid) are acknowledged there as dev-raster geometry, each with its
   reason — including dev land-bridging the Channel. The gate now fails
   on any UNEXPECTED failure and on any STALE manifest entry, so the
   list can only shrink honestly.
8. **The gate now passes with 21 acknowledged misses.** Review replaced
   the constant-echo checks with engine-measured ones (foot/ride speed
   and the 1:5:28 freight ratio on reference terrain, the 3000-km-sea ≡
   ~107-km-land grain-shed anchor) and made the monsoon check
   directional. The remaining acknowledged misses are one physical
   story: land routes run ~2× ORBIS without road/relay infrastructure
   (the neutral slot fills at M7), plus dev-raster geometry per (7).

Review corrections to the M1 build (all validated before merge):

- **`datan2` was mathematically wrong** (artanh series pasted where the
  alternating arctan series belongs — `datan2(1,2)` returned 0.092 for
  0.464). Rewritten with tan(π/8) range reduction; five bit-goldens
  added (the golden suite now covers 26 values). The oracle confirms the
  worldgen fields it feeds now sit within 2e-6 of v1.
- **The sea "monsoon storm" tax removed**: `|moisture−0.4|×6` slowed all
  tropical sea travel ~2.9× in both directions year-round. Replaced by
  the wind-alignment mechanism (`WIND_GAIN`/`WIND_REF_MS`) reading the
  observed monthly wind per directed edge — Calicut→Aden now measures
  39.6 days against the SW monsoon vs 24.9 with the NE, from data.
- **`baseEdgeCost` coast term** was a `min()` clamp (every coast ≤0.8
  regardless of terrain); restored to v1's multiplicative 0.8.
- **River per-magnitude speed discount removed** (no grounding; it made
  great rivers 112 km/day highways and broke the emergent freight ratio).
- **Oracle hardened**: the `annualMoisture` tolerance assert was dead
  (the field sat in the cleanup-exemption list); now live, with a
  scale-floored error metric and a justified 5e-4 bar for f32 iterative
  solver fields (measured drift 1.8e-7 absolute).
- Fixture corrections from sources: Rome→London gains the Channel boat
  crossing (land-only Britain is honestly unreachable) and cites ORBIS's
  ~27-day figure; Athens→Corinth 8→3 days (transcription), target-only
  (below dev resolution); the Calicut⇄Aden expectations follow the
  monsoon direction; London→Bordeaux is the coastal wine run (no
  open-sea Biscay shortcut).
- Duplicate/unused constants deleted; dead `mapImport.js` removed; the
  shell now draws the route path; bench times the placeholder tick
  again; wind sampling bulk-indexed (~10 s off the target substrate).

9. **Fertility is climate-only (owner play-report, 2026-09-01).**
   Measured region means: Sahel/Guinea savanna crop 0.91 / fert 0.87 ≈
   the US corn belt (0.91/0.89); cerrado 0.90. The crop field is a
   RAIN-FED CLIMATE envelope (defensible: the FAO rates the Guinea
   savanna a top underused reserve; sorghum/millet were domesticated in
   the Sahel; and the Nile honestly scores 0.15 — rain-fed Egypt IS
   desert, its miracle is M3's floodwater works). But the model carries
   NO soil-chemistry data: corn-belt mollisols vs leached savanna
   alfisols vs the cerrado's aluminum-toxic acids are invisible to a
   climate proxy, so those regions' FERT is overstated. Ruled: do not
   dial the map (R2). The honest fix is a real soil dataset as a data
   input (R7 — Earthness in data), a candidate for the M3 fertility
   re-founding when the food economy lands; meanwhile the wet-tropic
   demographic realism (disease brakes, package biogeography,
   storability) arrives at M2/M3 by design, and M2's density-ordering
   gate measures the outcome.

10. **Navigation without boats unlocked the ocean (owner play-report,
    2026-09-01).** The open-sea gate required only the navigation
    capability, so a boatless traveler could walk to the Persian Gulf
    and sail to China. Fixed: open-sea = boats AND navigation
    (navigation is a technique, not a vessel); verified navigation-only
    Rome→Alexandria now walks the 225-day land loop, all-capabilities
    Samarkand→Guangzhou goes pack → river → coastal → open-sea in 117.5
    days. On the sea-vs-land balance itself: sail at ~3-5× foot speed is
    the validated history (ORBIS's own fastest routes are sea wherever
    possible; Duncan-Jones's 1:28 freight cliff), so long hauls
    preferring water is design, not bug — the M7 road/relay
    infrastructure narrows the gap overland where empires build it.
    The engine now returns per-leg MODES with the path; the shell colors
    route segments by mode (legend added) and gained wheel-zoom +
    drag-pan, so leg choices are inspectable. Deep zoom with rendered
    condensations remains spec 12 (M2+ per DECISIONS 9).

11. **Boats up the Himalaya (owner play-report, 2026-09-01).** River
    navigability gated only on SIZE (magnitude ≥ 2), never on FALL — so
    routes rowed up the Tsangpo gorge at 32 km/day. The courses
    themselves are right (D8 over the real DEM; big rivers really do
    cross Tibet); navigability now also requires the reach's downstream
    gradient ≤ 1.5 m/km (ledgered from navigable-river gradient
    literature; computed as a rate from the cell's own flow direction
    and real edge geometry, so it is resolution-invariant). Measured at
    target: lowland reaches 80% navigable, hill reaches 32%, and the
    mountain band keeps 58% — the flat PLATEAU interiors, which is the
    historically right subtlety (coracles on the flat Tsangpo, yak
    caravans up the gorges: Dhaka→Lhasa now goes pack over the front
    and touches river only on the plateau flats). Lakes stay navigable
    by definition. No gate route uses river mode, manifest unchanged.

12. **The felucca physics (owner question, 2026-09-01).** Per-reach the
    model now holds direction (used: 0.6×/1.4× down/upstream), gradient
    (used: the 1.5 m/km navigability bar), and monthly wind — but wind
    only acted at sea, so the Nile's famous two-way highway (drift north
    on the current, SAIL south on the etesian northerlies) could not
    happen. Fixed: the wind-alignment factor now applies to river craft
    too. Measured at target, July: wind over the valley −2.7 m/s
    (northerly, from the NCEP data); Cairo→Aswan upstream 22.8 days at
    88% river, Aswan→Cairo downstream 13.8 days — both directions
    viable, downstream faster, inside the historical felucca envelope.
    STILL CRUDE, recorded for the food/economy milestones: the
    down/upstream factors are FLAT — current SPEED does not yet scale
    with the gradient we now compute (the lazy lower Nile and a swift
    1.4 m/km reach get the same asymmetry). The honest refinement is a
    Manning-class current-from-gradient model feeding directional
    speeds (and emergent one-way rivers where current beats boat
    speed); it needs care with instantaneous-vs-daily speed units, so
    it lands with real freight consumers rather than as a rushed
    constant.

13. **Down is not up (owner play-report, 2026-09-01).** Boat descent of
    Himalayan-front rivers: partly legitimate (foothill reaches under
    the gradient bar are timber-raft country), but the diagnostic caught
    a per-cell gate hole — a path edge between two individually
    navigable cells climbed at 2.05 m/km — and the deeper issue that one
    symmetric bar is wrong physics: a raft runs down water a towed barge
    cannot climb. Navigability is now enforced PER EDGE and
    DIRECTIONALLY: downstream to 1.5 m/km (raftable), upstream to
    0.5 m/km (towing/poling, canal-grade) — one-way rivers emerge
    wherever the gradient falls between the bars. Verified: Lhasa→Dhaka
    now uses zero river edges (the descent is honestly overland); the
    Nile keeps both directions (28.3 d up under sail / 18.7 d down,
    every edge within bars). Gate green, manifest unchanged.

14. **No sea ice (owner play-report, 2026-09-01).** Amsterdam→Jakarta
    sailed the Northeast Passage — the old cold-sea term only fired
    below −30°C air, so the Arctic priced as open summer water (and over
    the pole IS shorter than the Cape). Replaced with ice as BLOCKING:
    a sea cell closes in any month below seawater's freezing point
    (−1.8°C, `SEA_FREEZING_TEMPERATURE`), and closes YEAR-ROUND where
    the annual mean is below it (multi-year pack — the heat budget never
    clears). Measured: Kara Sea July +0.5°C but annual −9.6°C →
    pack-blocked (the exact case needing the annual rule); north Baltic
    −5.7°C January / +3°C annual → frozen in winter, open in summer.
    Amsterdam→Jakarta now runs the classic pre-Suez spice route
    (Mediterranean → Egypt portage → Red Sea → monsoon Indian Ocean,
    117.6 days). The VOC's Cape detour was POLITICAL (Ottoman/Portuguese
    control of the short way) — expect it to emerge only when authority
    and the danger premium exist (M5+), not from physics. The dead
    cold-storm constants were retired. Also fixed: routes wrapping the
    antimeridian drew a straight line across the map (render-only; the
    engine's wrap math was always right) — segments now split at the
    seam.

15. **Cataracts validated; the middle Niger is a hydrology finding
    (owner question, 2026-09-01).** The gradient bars reproduce the
    African river geography: Congo mouth→Kinshasa 0% by river (the
    Livingstone Falls seal the interior from the sea; the route walks
    the historical porterage) while Kinshasa→Kisangani runs 87% river
    (the steamer highway); Nile above Aswan runs 65% river with foot
    portages around the cataract reaches. MISS: Segou→Timbuktu shows 0%
    river, but the middle Niger was the famously navigable pirogue
    highway of the Mali empire — the D8 hydrology classes it magnitude 1
    (below the navigable bar), likely the ultra-flat inland delta
    defeating the raster (the real river splits into a maze and loses
    ~half its flow to evaporation there). Recorded as a SUBSTRATE
    hydrology finding for a dedicated pass (the chain is v1-inherited
    and oracle-pinned); not to be dialed from the navigability side
    (R2).

16. **Corner-cutting (owner play-report, 2026-09-01).** Land routes could
   cross a strait wherever two land cells touch only at a corner with
   water on both sides — proven with a direct 2-cell foot path over open
   water (62 such corner pairs at dev). Fixed in the engine: a diagonal
   move must be passable through at least one of its two orthogonal
   intermediate cells, applied symmetrically (ships can no longer slip
   through zero-width isthmus corners either); river mode is exempt
   because a D8 channel is itself the connector between diagonal cells.
   No gate route or known-miss changed — the affected corners are all
   off the measured corridors. Note: some crossings visible in the shell
   are legitimate coastal-sail hops (boats default on); the path line
   does not yet distinguish modes — a lens candidate for M2's shell.
   The shell also gained `?grid=target` (full 1800×900 rendering via
   ImageData; dev stays the fast default).
