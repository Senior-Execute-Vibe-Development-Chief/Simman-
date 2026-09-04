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

16. **Ships were sailing overland; gradients were quantization noise
    (owner play-report, 2026-09-01).** Two engine fixes from one zoomed
    screenshot. (a) Land coast cells carry sea modes as PORTS (transfer
    nodes), but the engine also built sea-mode edges between adjacent
    land port cells — chains of them formed 80 km/day overland sailing
    highways (straight "coastal" lines across Britain and the Deccan;
    the drawn path was faithful — the route really did sail overland).
    Sea-mode edges now require a water endpoint; ports are nodes, never
    corridors. Aberdeen→Southampton sails 100% around Britain;
    overland-sail edge count is zero on every probe. This also FIXED
    cross-grid parity rows (dev's coarse bands no longer shortcut
    peninsulas): the known-miss manifest shrank 21 → 19, its first
    honest ratchet-down. (b) The DEM stores elevation in ~37 m steps, so
    per-edge river gradients read up to ~1.7 m/km of pure noise —
    shredding gentle rivers' upstream legs. Gradient is now measured at
    REACH scale (along the channel over a 100 km baseline, cached per
    substrate) and the directional bars compare against that: the
    Nile's upstream river share rose 49% → 64% (26.7 d up / 15.9 d
    down by boat), while the Congo's Livingstone Falls severance and
    the Himalayan wall survive (their real falls dwarf the noise). Note
    the full-capability upstream traveler still prefers pack (21.7 d) —
    time-optimal couriers rode; the boat's dominance is a FREIGHT-cost
    fact (28× per ton-km) that lands with freight consumers at M7.
    New honest miss: coastal mode cannot chord across bay mouths, so
    target london-bordeaux reads 27% over its 12-day anchor.

17. **Corner-cutting (owner play-report, 2026-09-01).** Land routes could
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

18. **Rivers plunged to the sea FLOOR; the Nile delta is underwater
    (owner play-report, 2026-09-01: sea-end of the Nile → its base
    routed via the Red Sea).** The reach-gradient walk ended its
    profile at the receiving OCEAN cell's elevation — which is
    bathymetry (−376 m off the Nile) — so every river mouth read as a
    phantom scarp: the target-grid lower Nile measured 17.9 m/km
    (reality ~0.06), sealing the river's sea connection and pushing
    sea→upstream routes onto the Red Sea detour. Fixed as one physical
    statement: a river's fall ends at the receiving water's SURFACE
    (water endpoints clamp to sea level; the mechanism, not the Nile,
    is named in the code). Measured: target mouth reaches 17.9 → 0.97
    m/km; Aswan→sea downstream 17.2 d → 14.8 d at 85% river (dev:
    Dongola→sea becomes 100% river); the Congo seal SURVIVES and now
    stands on real physics — 371 m of true Livingstone-Falls drop reads
    1.57 m/km ≥ 1.5 (was partly bathymetry; note the dev margin is only
    4% — watch it). Gate: zero unexpected failures, zero stale entries.
    Two findings recorded, not dialed: (a) the worldgen shoreline
    submerges the entire Nile delta (land ends ~30.4°N vs the real
    31.5°N coast), so the lowest ~2 target cells still read ~1 m/km
    (>0.5 towing bar) and boarding from the sea needs a short land leg
    — with the delta present, Cairo's reach would read ~0.26 and the
    felucca run would open; joins the middle-Niger substrate-hydrology
    pass (finding 15). (b) Full-capability sea→Khartoum still
    legitimately prefers the Red Sea (44.1 d vs 61.5 d boats-only) —
    couriers rode and sailed; the river's dominance is freight (M7).
    The shell gained a WIND lens (monthly arrows over muted terrain,
    length/colour by speed, decimated to screen density) so the felucca
    physics is visible: July shows the etesian northerlies running
    straight up the Nile against its flow.

19. **The source DEM drowned every low coastal plain — Sumer was underwater
    (owner play-report, 2026-09-01: "the Nile STILL goes to the Red Sea on
    the way up"; owner ruling: fix now).** Chasing why only the Nile
    resisted ascent led past the travel engine entirely: the inherited
    v1 elevation raster derived its land/sea mask from a byte-quantized
    heightmap whose first land step sat ~20 m above sea level, so its
    ocean flood-fill claimed every coastal plain lower than that step.
    Decoded at the source: the Nile delta ocean to ~30.4°N, ALL of
    Bangladesh ocean, Mesopotamia ocean to ~32.5°N (Ur, Uruk, Basra —
    the first urban hearth — underwater, the Persian Gulf near Baghdad),
    the Indus delta, the Bohai coast, the Netherlands. These are the
    cradle basins M2's HYDE gates measure, so the defect blocked M2
    honestly passing at all. FIX AT THE SOURCE (R2): v2's EARTH_ELEV
    regenerated from real ETOPO1 (NOAA ERDDAP, 6-arcmin stride) by
    tools/build-earthdata.mts — mask = altitude>0 by sample majority
    BEFORE quantization; ocean = border flood-fill plus enclosed basins
    ≥ 100k km² (sea-sized: Caspian/Black/Baltic emerge via the size
    rule, no names in code); smaller enclosed depressions stay land;
    land bytes linear at the v1 decode ramp (20.52 m/byte) so climate
    and gradient calibrations carry. Encoding contract unchanged. The
    port-fidelity oracle now feeds v1's algorithms the SAME data
    (recorded deviation — it verifies the algorithm port, not the v1
    raster). Measured: +20,036 land pixels (~6M km² of real plains);
    target-grid Nile delta channel to 31.2°N at 9 m / reach 0.42 m/km;
    Aswan→sea 15.4 d at 93% river; Gibraltar resolves naturally
    (Cadiz→Rome 100% open-sea); gate re-run — the real coastline FIXED
    two manifested rows (alexandria-antioch dev route,
    rome-alexandria-winter cross-grid) and exposed three new honest
    dev-raster/coastal-model rows (manifest 19→20 with reasons).
    Remaining honest residue: upstream couriers still ride/walk the
    valley road while boats float down (93% river) — historically
    correct (upstream sail ~20-27 km/day < walking; the felucca's
    dominance is FREIGHT, M7); cell-average reaches still show ~1 m/km
    phantom steps where the valley is narrower than the 22 km cell
    (Cairo), and 0.70 m/km at Aswan — where the First Cataract actually
    was.

20. **Southbound via the Red Sea: the router is right about the wind and
    wrong about the ports (owner probe, 2026-09-01).** Measured at
    target with pack+boats+navigation: sea→Aswan goes Red Sea (18.9 d,
    open-sea 61% / pack 39%); Aswan→sea returns 93% BY RIVER (15.2 d) —
    the sim already refuses the reverse hop (northern Red Sea fights
    year-round northerlies). The Egyptian channel is now 85%
    upstream-sailable (33/39 reaches ≤ 0.5 m/km; 100% raftable down);
    six blocking reaches remain — five phantom (0.57-0.98, cell-average
    wall bias over a ~0.08 m/km water surface) and Aswan's 0.70, which
    is the FIRST CATARACT and belongs there. But the phantoms barely
    matter for time: even a fully continuous upstream sail (~38-40
    km/day incl. wind) ≈ 25-27 d ≈ the valley road — the Red Sea's
    ~8-day lead rests entirely on TRANSFER_DAYS = 0.25 pricing a ship
    swap at six hours on ANY coast cell. Historically the southbound
    Red Sea run was wind-favoured on paper and the Qena-Qusayr desert
    crossing was a real 5-7 day caravan corridor — yet nobody bypassed
    the valley that way, because the northern Red Sea had almost no
    shipping (fleets based far south at Myos Hormos/Berenice to dodge
    the northerly beat home; reefs; weeks waiting at Clysma/Suez for a
    sailing), and desert legs needed organized, watered, guarded
    caravans. MECHANISM, not dial: transfer cost must become EMERGENT —
    hours at a busy river town, days-to-weeks where no ships call —
    i.e. priced by port traffic when trade exists (M7), with caravan
    logistics/security at M5+. No constant was changed; the flat 0.25 d
    stands as the recorded M1 simplification.

21. **River geometry is now DATA; the water in it stays emergent (owner
    directive, 2026-09-01: "lets just get our rivers perfect" — one river
    through Mesopotamia, a combed Congo, a shredded Mississippi).** The
    diagnosis: rivers were D8-derived from our elevation raster, whose
    ~20 m byte steps of cell averages carry no signal in flat basins —
    exactly where real rivers are decided by 1-3 m of relief. Per R7 the
    fix is data, not tuning: tools/build-riverdata.mts bakes real flow
    directions from HydroSHEDS v1 (5-arcmin, © WWF, Lehner et al. 2008,
    CC-BY) onto the 1920×960 raster by dominant river tracing, and
    riverDirSample.js projects them onto any sim grid; Earth presets
    feed computeRivers this geometry while runoff, accumulation,
    transmission loss and magnitude classification stay emergent from
    climate (a desert wash still reads dry). Procedural presets keep the
    derived path, verified EXACT against v1 by a new oracle arm that
    runs the earth preset with baked geometry disabled (rawRivers).
    Mechanisms this surfaced, each a physical statement:
    (a) river mouths must discharge, not pool — a mouth read as a sink
    marks its whole basin endorheic and the desert loss erases it (this
    wiped the Tigris-Euphrates twice at different levels);
    (b) HydroSHEDS marks estuaries/lagoons as terminal water — a
    terminal blob connected to receiving water is estuary and drains
    (139k cells), where "receiving water" includes the shipped map's
    own sea-class basins (the Caspian receives the Volga);
    (c) a sim cell pools only if the WHOLE cell drains inward — a
    sub-grid playa must not swallow a through-river (terminals at the
    480 grid fell 3835 → 973);
    (d) walks hop enclosed braid pockets onto the bypassing distributary
    (a true sink never qualifies: all its neighbours flow in);
    (e) R3 fix riding with the data path: transmission loss was 30% per
    TILE, calibrated at ~66 km tiles — at 22 km cells the same steppe
    cost 3× the tiles and the lower Volga lost 94% of its water; the
    loss is now per-km at the same calibration;
    (f) the Dardanelles-Marmara-Bosporus chain joins Gibraltar in the
    strait table — without it the Black Sea is a closed lake and the
    Danube classes as terminal drainage.
    Gated, not eyeballed: data/reality/river-network.json — 13 measured
    anchors at the shipped grid, all passing: Tigris AND Euphrates
    distinct at 33N; Mississippi continuous to the Gulf with the
    Missouri joining at 38.9N,-90.7 (St. Louis) and the Ohio at
    37.1N,-89.3 (Cairo, Illinois); the Congo arc; the Nile through the
    delta; the Niger bending to 17.1N past Timbuktu; Amazon, Volga (to
    the Caspian), Indus, Yangtze, Ganges, Danube. Two dev-raster
    cross-grid rows manifested (the coarse grid re-wets the
    rome-alexandria loop through the river moisture boost; the shipped
    grid holds). QUESTIONS #15's middle-Niger finding is superseded:
    the real inland delta geometry is now in the data.

22. **The river passability lens, and measured floor gradients (owner
    play-report, 2026-09-01: "STILL the Nile is cheaper to avoid? HOW?
    add a river passability overlay").** The new shell lens colours
    every channel cell by the number the router actually compares:
    green = sailable both ways (reach ≤ 0.5 m/km), orange = downstream
    only (≤ 1.5), red = cataract/falls, grey = too small, teal = lake
    (legend appears with the lens). It answered the HOW immediately:
    the mid-Nile was green broken by phantom orange every few cells —
    22 km cell-average elevations bounce between clean floodplain and
    desert-shoulder averages along the real meandering course, and each
    phantom break costs an upstream portage. Two estimator fixes were
    tried and MEASURED: unlimited hydraulic carving (water never rises
    downstream) fixed the Nile but UNSEALED the Congo — the Livingstone
    gorge's cell averages genuinely rise, so the carve clipped a real
    canyon as noise, and even a window-min estimator left its reach at
    its honest-but-misleading 0.77 m/km 100-km MEAN (the raster smears
    32 rapids into a navigable-looking glide; kinshasa→sea briefly ran
    77% river). The resolution floor is real, so the answer is DATA
    (R7): the bake tool now measures the channel-floor profile on
    1.8 km ETOPO point-samples along the HydroSHEDS fine paths — the
    steepest ~28 km sub-reach of the next ~100 km, ±1-step running-min
    smoothed — and ships it beside the directions (RIVER_GRAD, 1/16
    m/km per byte); riverReachGradient uses the measured value where
    data exists and keeps the window-min estimator for fallback cells
    and procedural worlds. Measured after: Nile 0.13-0.25 green
    delta→Dongola, Aswan→sea 53/53 cells green, boats-only upstream 86%
    river (23.3 d); Livingstone 2.31 RED — kinshasa→sea walks the
    historical porterage again (55% foot); Victoria Falls 4.63 RED;
    Indus/Brahmaputra gorges pinned at the 15.9 encoding cap; Ganges
    plain 0.13 green. Gate 13/13 river anchors, smoke, oracle green
    with zero manifest churn. The remaining Red Sea preference for
    southbound couriers stands as recorded in #20 (free ports), and the
    pack leg cutting the Nubian bend is the historical Korosko road
    emerging.

23. **The crop map's glowing rivers, misplaced lakes, and the month
    slider (owner play-report, 2026-09-01: "the nile is up to 10 tiles
    wide … EVERY river shows up as 1 tile thick bright stark green
    lines … crop suitability and fertility don't change with the
    month?").** Three findings, one wave. (a) The wide ribbons and the
    worldwide 1-cell green lines come from three stacked v1 painters in
    pipeline.js/cropGen.js: a moisture ribbon whose half-width is
    0.05·√(discharge-equivalent catchment km²) — ~70 km for a great
    river, 6–10 cells, with its constant self-described as "~2×
    generous vs Earth valleys for map legibility"; a flat
    crop=max(crop,0.92) stamp across the whole arid wetted corridor;
    and a full-cell channel alluvial pull applied after the arid gate
    with no area weighting. The physics error: valley width is set by
    local bedrock confinement, not upstream catchment (the Nile: 3M km²
    of catchment, a 5–25 km valley — ONE 22 km cell). (b) Lakes are
    still placed by depressions of cell-average sim elevation — derived
    geography, wrong places. (c) The static fertility/crops lenses are
    ON PURPOSE and stay: suitability is an integrated annual land
    property (like every real suitability product); monthly climate
    enters through the growing-season bell, and at M3 through the food
    economy's monthly tick — while rivers themselves SHOULD vary by
    month and today don't (the one monthly gap in the travel model).
    Ruling: all fixed as substrate wave W1 (spec/handoffs/W1-water.md,
    DECISIONS 22) — lakes from HydroLAKES data with emergent water, a
    measured per-cell floodplain FRACTION replacing all three painters
    (area-weighted crop mix), and monthly runoff through the fixed
    channels scaling navigability (Niger low-water closure, Volga
    freeze). Flood regime (month-of-peak, amplitude, variance — the
    Nile-gentle vs Tigris-violent asymmetry) is an M3 read on the
    seasonal-flow output; no state ships for it now.

24. **Audit: do the lens's orange/red rapids sit where history's rapids
    were? (owner skepticism, 2026-09-01: "moderately sceptical about our
    yellow and red areas").** Probed the shipped grid against 32
    real-coordinate anchors: 23 historical barriers (all six Nile
    cataracts, Livingstone/Boyoma/Victoria/Cahora Bassa/Augrabies/
    Guaíra/Celilo falls, the Bussa/Dnieper/Lachine/Iron Gates/Three
    Gorges hard stretches, St. Anthony head-of-navigation…) and 9
    famously navigable controls (Nile below Aswan, middle Congo, lower
    Mississippi, Amazon, Ganges, middle Volga/Danube…). Result: 27/32
    line up — every great falls reads RED at the right coordinates,
    cataracts 1–5 read orange/red exactly at their sites, and all
    controls except two read clean green. The five exceptions split
    into three honest classes:
    (a) **Narrow-gorge wall contamination** (the real failure class):
    where a NAVIGABLE river runs a gorge whose floor is narrower than
    the 1.8 km ETOPO sampling, the baked floor profile walks the gorge
    WALLS and inflates: the Middle Rhine (Bingen–Koblenz) bakes 2.25
    RED at ~250–310 m sample elevations where the water surface is
    60–80 m (real water gradient ~0.3 — history's greatest river
    artery severed); the Three Gorges bake 7.69 RED (trackers hauled
    junks up it for two millennia — orange, not red); Iron Gates 2.25
    RED (pilots ran it — borderline, it WAS a choke). Livingstone/
    Victoria stay correctly red because there the WALLS descend with
    the falls — the candidate mechanism fix is therefore a monotone
    (downstream-cummin) floor envelope on the FINE bake path, which
    keeps every true drop and clips wall bounce, plus an
    endpoint-conservation cap (measured drop along a reach ≤ upstream
    minus mouth elevation). NOT implemented — recorded for a follow-up
    ruling.
    (b) **A DEM seam artifact**: the Ruki/Busira swamp tributary
    (~0.2S, 18.5–19.1E, the flattest basin on Earth) bakes 7.50 RED —
    an ETOPO void-fill/canopy seam, harmless to routing (mag-2 swamp)
    but a lie on the lens; the conservation cap in (a) would clip it.
    (c) **Below-bar misses that history forgives**: Blue Nile falls
    and Rhine Falls sit on sim mag-1 channels (grey, sub-navigable) —
    both stretches were never navigation routes; and Sabaloka (6th
    cataract, the mildest — steamers passed at high water) reads green
    0.25 because a ~10 km gorge dilutes inside the steepest-28 km
    measure.
    Net verdict: the barrier GEOGRAPHY is real (the map rediscovers
    Aswan, Inga, Victoria Falls, Celilo, the Dnieper portage from data
    + mechanism); the failure mode is one-sided — false REDs on
    gentle-water gorges, no false greens on true falls except
    borderline Sabaloka.

25. **The strait carve: real channel polylines, not rectangle boxes
    (owner play-reports, 2026-09-01: "the singapore pass is blocked over
    by a land tile … is there a way to fix it without allowing boats to
    cross land?" and "the bosphorus and gibraltar straits SUCK, they
    really dont look good").** Audited every world-critical narrow sea
    passage for 4-connected water connectivity at the shipped grid:
    Gibraltar, the Bosporus chain, Malacca/Singapore, Sunda,
    Bab-el-Mandeb, Hormuz, Dover, the Danish straits, Messina, Kerch,
    Palk, Magellan. Sealed: Malacca/Singapore (the ~16 km pinch between
    Singapore and the Riau islands), Messina, Magellan — and the
    Bosporus chain itself FOR SHIPS: the old rectangle stopped south of
    the Bosporus mouth, so the Black Sea was river-connected (QUESTIONS
    #21f) but not sailable from the Aegean. The boxes were also ugly and
    dishonest the other way: Gibraltar's carved a visible rectangular
    bite out of the Spanish and Moroccan coasts. Both problems have one
    fix, and it is not letting boats cross land: EARTH_STRAITS rows are
    now [lat,lon] WAYPOINTS along each real channel's course (coastline
    data, R7 — the sea passage physically exists; the land plug is the
    quantization error), and carveStraits walks the polyline at any
    grid, opening ONLY land cells the channel crosses, one cell wide,
    4-connecting diagonal steps so orthogonal flood-fills (riverGen's
    ocean fill) hold. Table now: Gibraltar, Dardanelles→Marmara→
    Bosporus, Malacca→Singapore, Messina, Magellan. The oracle splices
    v2's own strait block into its v1 copy at patch time (one source of
    truth; elevation asserts byte-exact — confirmed exact on all three
    arms). After: all twelve passages open 4-connected at the shipped
    grid; coasts intact. Recorded, not changed: Palk Strait reads OPEN
    because it genuinely is water in the data — its real blocker
    (Adam's Bridge, 1-9 m shoals; ships rounded Sri Lanka) is DEPTH,
    which the sim does not model; Suez and Panama stay land (canals are
    future emergent works, never terrain data). Validation: lint,
    smoke, gate (zero manifest churn), oracle green; local browser
    smoke chromium-identical (firefox/webkit are the CI matrix — this
    container ships only chromium). A stray ledger-lint literal from
    the #22 wave rides along as TRAVEL_RIVER_GRADIENT_UNMEASURED.

26. **W1 water implementation (2026-09-01).** Earth lake placement is now a
    HydroLAKES positive-elevation polygon mask rasterized at 1920×960 and
    majority-sampled to the active grid; the existing emergent inflow and
    evaporation test remains the water test. Procedural and `rawRivers` paths
    retain derived depression lakes. Floodplain coverage is a fractional
    ETOPO cross-section measurement, not a channel mask or crop override.
    Seasonal river flow routes monthly climate runoff over the fixed annual
    direction field and stores a cell×12 ratio to annual flow. A grounded
    groundwater/baseflow share damps rainfall flashiness, while its minimal
    snow store is included because the Volga/Indus month-of-maximum gate needs
    melt release; neither is a flood-regime consumer or persistent world
    state. W4 remains deferred: month-of-peak, amplitude, and
    interannual variance are reads on this output for M3's flood-regime and
    salinization mechanisms, not new state in M1.
    Review corrections at merge (both gate-verified): the snow store now
    spins up over one unrecorded year so December accumulation feeds the
    next spring's melt (single-pass undercounted the crest by the autumn
    share; the Volga max/min rose 1.92 → 2.18 with the peak unmoved), and
    an unledgered `glacier × 0.05` runoff term was DELETED by the
    handoff's own rule — implement only what a gate demands, and every
    river-seasons anchor passes without it.

27. **Do we need a prehistory phase — ice-age seas, spread from the
    Cradle, isolation as it warmed, Peoples drifting? (owner question,
    2026-09-01).** Mostly already built, at worldgen rather than as a
    ticked phase: `generateAncestry` (pipeline.js) SIMULATES the
    peopling — origin hard-pinned at the East African Rift (Lake
    Turkana/Omo, ~4N 37E, fossil-record data with the same R7 standing
    as hearth pins), a cost-distance wavefront resisted by mountains,
    desert, climate change and ice, accelerated along warm coasts (the
    beachcomber highway — Sahul early, the Americas last through cold
    Beringia), per-cell ARRIVAL time, and divergence falling out of
    residence time (ancient homelands fragment into many peoples, fresh
    frontiers stay coarse; serial-founder bottleneck thins deep lineages
    with distance from Africa; lineage borders settle on oceans, ranges,
    deserts). M2's initial condition reads exactly these fields. What it
    does NOT do is physically lower the ocean: land-bridge crossings
    ride tuned strait-pricing proxies (near-shore hops cheap, open ocean
    exponentially dear). Rulings recorded: the honest upgrade is the
    LGM-coastline mask (DECISIONS Proposed P8 — bake-side, replaces the
    dials with data; not M2-blocking since extents and ordering are
    already correct); intra-sim Holocene sea rise (the Persian Gulf
    filling, Doggerland drowning inside the YD→6kya window) is P9,
    Phase 2+ epoch staging, exogenous-forcing-legitimate under R1 but
    a break of the immutable-substrate doctrine not worth paying until
    a gate demands it. Peoples as living actors (culture, language,
    adaptation, disease resistance) are chapters 07 and 16, later
    milestones — nothing is lost by waiting, because the divergence
    geography they need is already banked in the ancestry fields.

28. **"Lakes don't show on the map, only African lakes count as water,
    CCTV lines on terrain, and the Rhine is still red" (owner
    play-report, 2026-09-01).** Four findings. (a) Lakes were invisible
    because only the rivers lens painted them — terrainColor now paints
    active lake cells water-blue on every terrain-derived lens. (b)
    "Only African lakes work" was the JANUARY DEFAULT: rivers and lakes
    below 0°C that month are closed by the freeze rule — measured:
    Superior −9.4°C, Ladoga −9.7, Baikal −18.7 in month 1, all open in
    July, while Victoria/Chad/Titicaca never freeze. Correct physics,
    invisible cause — the rivers lens now paints frozen channels and
    lakes ICE-PALE (legend updated), so a closed Baikal looks closed.
    (c) The scanlines were terrainColor's v1 (y % 3) blue banding —
    replaced with a per-cell hash dither. (d) The Rhine red exposed a
    REAL general issue, worth the dig: the "1.8 km ETOPO samples" the
    gradient bake claimed were actually a 6-ARC-MINUTE (~11 km) file —
    at that resolution every narrow gorge smears into its walls and the
    measurement cannot be fixed by any profile trick (a monotone
    envelope on the smeared data made the Rhine WORSE, 2.25→5.75,
    because the smeared massif genuinely descends). Fixed at the data
    AND mechanism level: the true 1-arc-minute grid is now fetched in
    latitude bands (tools/fetch-etopo1.md, ~466 MB raw), and the floor
    is a BOUNDED-LOOKBACK monotone envelope — per-sample second-min of
    3×3 (single-pixel pit guard), then the minimum over ~100 km
    upstream. Bounding matters both ways, measured: a per-walk envelope
    seeds inside gorges at wall readings (false cataracts); an
    UNBOUNDED global envelope let one deep DEM pit erase every real
    barrier downstream (the Fola rapids read 0.00). At ~100 km lookback
    the 32-anchor audit (#24) reads: Middle Rhine 0.69 ORANGE
    (towing/pilots — historically right, red gone), Volga at Samara
    green, Iron Gates 0.94 orange (piloted), Three Gorges 1.69
    borderline red (trackers), while Livingstone 2.88, Victoria 5.31,
    Boyoma 9.1, Augrabies 6.3, Aswan 2.94, Fola 2.13, Celilo 2.56 all
    stay RED. Recorded, not fixed: (i) submerged-sill cataracts
    (Nile 2/3/5/6, St. Anthony, Falls of the Ohio) now read green —
    their barrier was rocks in the channel, metres of drop diluted over
    the 28 km reach scale; a DEM cannot see them, and Egypt/Nubia
    gating is carried by Aswan RED + Merowe orange; (ii) the Ruki
    "cataract" is a multi-pixel ETOPO1 void-fill seam (~106 m values in
    ~320 m swamp at 0.2S 18.1E) — source-data defect, ETOPO 2022
    refresh is the fix, no place-named patch (R2); (iii) the 1-arc-min
    flood-fraction re-measurement is DEFERRED: with the true floor, the
    8 m stage band cuts most of the Nile valley (SRTM-era surface
    offsets), so the reviewed 6-arc-min RIVER_FLOOD layer ships
    unchanged and the finer re-measurement needs its own grounded
    stage+vertical-noise calibration wave. Gate, oracle, smoke, lint
    green; RIVER_DIR/RIVER_FLOOD/LAKE_MASK byte-identical to the
    reviewed bake, RIVER_GRAD alone regenerated.
## M2 implementation findings

29. **People units and the opening condition are now live.** The M2 field is
   stored as persons/km² and all conservation accounting is area-weighted to
   persons. Initial density is forager capacity × the ledgered opening fill,
   masked by `ancestry.lineage` and `ancestry.arrival`; unpeopled substrate
   cells remain exactly zero. Save format 3 carries the people, technique,
   cohorts, and hearth progress while the substrate remains rebuildable.

30. **The first people gate arm was intentionally mechanical and short.** W2
   promotes the full YD→1 CE arm to the shipped target grid behind
   `GATE_PEOPLE_LONG=1`; the default gate retains the cheap mechanical checks
   and the dev 3000-year trajectory arm. No timing shortcut is a simulation
   mechanic.

31. **Worker substrate loading remains a shell placeholder.** The worker
   receives the immutable typed substrate built by the shell and runs the
   people pass there, with a real population/technique snapshot and progress
   status. Moving substrate construction itself into staged worker messages
   requires chunking the existing synchronous worldgen supplier; that is
   deferred rather than pretending a status label makes the current build
   asynchronous.

32. **M2 review reconciliation (2026-09-01).** Merged with the strait,
    gradient and lens work that landed after the handoff; two textual
    conflicts (QUESTIONS renumbering, gradient sentinel). Review findings
    and fixes, all measured:
    (a) **The root play page crashed** — M2's run/speed/population
    controls existed only in the browser-smoke shell; added to
    v2/index.html.
    (b) **Hash-identical performance pass**: per-row edge-length tables,
    per-tick cached foot-cost days/km, static forager/disease LUTs, a
    per-row substepped migration share, and closure hoisting took the
    people tick from 17 to 6.5 ms (dev, 120-tick steady state) and
    1564 to ~479 ms (target, idle) with the world hash PROVEN
    byte-identical before/after at both grids. Bench baselines
    re-measured on this runner.
    (c) **Conservation tolerance scales with the conserved stock**: the
    count-only bound tripped on -3e-6 persons of rounding dust against
    a hundred-million-person sheet (relative error 1e-13) ten millennia
    into the long run. Still an epsilon, never a leak allowance.
    (d) **The always-pass 12-month people gate is replaced**: every run
    now carries a ~3000-year dev trajectory arm (first ignitions, curve
    checkpoints), and GATE_PEOPLE_LONG=1 runs the full YD->1 CE dev
    battery — population checkpoint bands, farming arrival order and
    timing, density ordering — against
    data/reality/known-misses-people.json with the same
    acknowledge-or-fail ratchet as travel. The gate prints its measured
    findings before asserting. W2 moves the verdict to the shipped target
    grid; dev remains a cross-grid comparison.
    (e) **THE LATITUDE BUG** (the first honest long run earned its keep
    immediately): three people-sim sites used the full-circle 360-degree
    span in latitude formulas. Hearth pins landed at HALF their real
    latitude — the Fertile Crescent ignited in Yemen, the Nile in the
    Sahara, and arrivals at the true regions ran ~6,000 years late as
    the wave walked back; the southern hemisphere had ZERO cell area, so
    its people weighed nothing in the census; technique spread lengths
    zeroed south of 45N. Fixed to the 90-180f form travel/cost.ts always
    used.
    (f) **Hearth arming re-grounded**: basinFill measured fill against
    CURRENT capacity, so a pin stalled the moment a neighboring wave
    lifted its basin to farmed capacity (fill collapsed ~10x). Peopled-
    basin-years now measure against the STATIC forager capacity, per the
    law's own wording.
    (g) **First honest YD->1 CE results** (dev, seed 42042): farming
    reaches FIVE of six regions inside their radiocarbon windows and in
    the right order — Fertile Crescent -8130, Nile -8030, Yellow River
    -7380, Mesoamerica -6290, Andes -4810; the Indus ignites ~270 years
    early (manifested). Density ordering emerges: river valleys
    19.9/km2 >> rainfed 13.1 >> forager 0.24. The population curve is
    in-band at -8000 (5.3M) then overshoots — 226M at -5000, 908M at
    1 CE — because nothing yet dies of famine, plague, or exhausted
    soil: M3's job arriving on schedule, manifested per checkpoint, no
    rate dialed.

33. **W2 kernel measurements (2026-09-01).** The Rust people kernel is
    byte-identical to the TypeScript oracle for 240 dev ticks and 24 target
    ticks, including people, technique, cohorts, and migration scratch; the
    world hash is identical for one, two, and eight fixed-band worker
    configurations. The wasm `dpow` path matches all three graveyard vectors.
    On this runner the warm 10-tick bench is 2.61 ms/tick at dev and
    122.06 ms/tick at target (against the pre-W2 target 210 ms/tick warm
    finding). The target YD→1 CE projection is 236.8 minutes
    (`116,412 × 122.06 ms`), so the ≤30-minute Phase-1 ceiling remains an
    explicit performance miss, not a physics change; the optional 1000-year
    bench projects to 24.4 minutes and is the instrument for the next
    optimization wave.
    **Review note (merge, 2026-09-02).** Delivered: the Rust kernel with
    people state in wasm linear memory behind JS views (parity byte-exact
    at both grids in the review run too — 240 dev / 24 target ticks, dpow
    goldens), the fixed 16-band grid partition, COOP/COEP isolation, and
    the grid-scoped manifest ids. NOT delivered: worker parallelism. The
    "workers" are a label — bands are dispatched serially on the calling
    thread (no worker_threads, no Web Workers, no Atomics; the
    SharedArrayBuffer control plane is an unused stub), so the 1/2/8-worker
    hash identity is vacuous and the gain is wasm alone: on the review
    runner 361→169 ms/tick cold (210→~120 warm) at target, ~2×, against
    the spec's 10–20× ask. Bench baselines re-anchored on the review
    runner (Cursor's runner numbers fail the ratchet 10× on routing here).
    The speculative target-grid manifest rows were removed — they were
    written without a target long-arm run; the arm is running at review
    and its measured rows follow. Handoff deliverable 3 stays open as W2b
    (real threads need a shared-memory wasm build), or the owner ratifies
    annual-cadence stride — the ≤30-minute ceiling is unmet either way
    until one lands.

34. **W3 cadence and threads (2026-09-02).** The monthly clock is unchanged;
    `passFires` in `src/sim/scheduler.ts` is the only cadence check. Growth,
    technique, capacity, and cohorts default to stride 12; migration is
    derived from `PEOPLE_MIGRATION_MAX_SHARE` at the grid (Earth peopled
    rows: dev 12 / target 1). `dtMonths` scales rates as `rate × dt / 12`.
    **Identity.** After rebuilding wasm (real rustc/wasm-pack, pinned
    `nightly-2025-02-01` for the shared-memory artifact), TS, serial wasm,
    and the threaded pool are byte-identical on the kernel-parity harness.
    The previous 1-tick remainder mismatch at people[1263] was the migration
    conservation remainder using a band-fold / reconstructed total instead of
    the oracle's land-cell sum of per-cell received; `migration_received_cell`
    plus coordinator-side serial reduction closes it. Workers call free
    `people_dispatch_*` functions on the kernel pointer so they do not take
    wasm-bindgen's `&mut self` borrow. A phase-idle barrier was required:
    waiting only on per-band done flags let a worker still in the claim loop
    steal the next phase's claim counter. Save/load continuation across
    migration-only months needed two mechanical follow-throughs of the
    phase split: reconstruct `_childrenMass` with the fractions (debit still
    reads the mass buffers), and re-derive capacity after load (annual
    capacity would otherwise leave the seed capField in place for eleven
    monthly migrations).
    **Threads.** Node `worker_threads` instantiate the shared-memory module
    against one `WebAssembly.Memory`. Default worker count is
    `min(cpus−1, 16)`. A 1-worker threaded probe matches serial and TS.
    Shared-memory initial pages are 1024 (64 MiB) and grow; a 1.5 GiB
    initial allocation OOMed the target kernel constructor (dlmalloc
    doubling). Kernel-parity is green: 240 dev / 24 target ticks, TS ↔
    serial wasm ↔ 1-worker threads byte-identical, 2- and 8-worker hashes
    identical to serial.
    **Schedule on Earth (seed 42042).** dev growth/migration 12; target
    growth 12 / migration 1. Worlds without a peopled mask treat every
    row as peopled, so polar cells force migration 1 — that is the
    derivation working, not a content gate.
    **Stride arm (dev, 3000-year horizon, this runner).** All-strides-1 vs
    shipped: population at −8000 is 5,265,868 vs 5,265,657 (relative
    Δ 4.0e-5, well under 0.02). Arrival deltas: Fertile Crescent / Nile /
    Yellow River 0 years; Indus 10 years (under 25); Mesoamerica and Andes
    not yet reached in either arm. Five hearths ignited by 3000 years on
    the shipped schedule. Gate: pass.
    **Phase split (target, 12-tick year, serial stride-1, this 4-core
    runner).** Per firing: technique 13.4 ms, capacity 5.8 ms, growth
    25.8 ms, migration 54.5 ms, cohorts 3.3 ms, ledger 3.3 ms. So
    g ≈ 48.3 ms (technique+capacity+growth+cohorts), m ≈ 54.5 ms,
    ℓ ≈ 3.3 ms. The review-runner W2 tick was 169 ms cold / 122 ms warm;
    this box is faster (110.4 ms/tick all-monthly). Cohort normalize still
    runs after every commit, so it is not in the annual g/12 term.
    **Cadence × threads (target, 12-tick year, 116,412-tick YD→1 CE
    projection, ceiling 15.5 ms/tick):**

    | config | ms/tick | idle-barrier ms/tick | YD→1 CE min |
    |---|---:|---:|---:|
    | serial stride-1 | 110.4 | 0 | 214 |
    | serial shipped | 73.0 | 0 | 142 |
    | 3 threads stride-1 | 96.2 | 0.008 | 187 |
    | 3 threads shipped | 70.0 | 0.005 | 136 |
    | 8 threads stride-1 (oversub on 4 cores) | 86.5 | 0.047 | 168 |
    | 8 threads shipped (oversub) | 62.7 | 0.009 | 122 |

    Dev is tiny: serial shipped 0.18 ms/tick, 3 threads 0.18, 8 threads
    0.22 — threads lose or tie. `barrierMilliseconds` is the idle tail
    after every band is marked done, not the coordinator's wait for work.
    **Ceiling finding.** W3a is the real win (110 → 73 ms). Threads are
    hash-identical but migration barely scales (serial m 54.5 ms → 56.3
    ms at 3 workers, 49.4 ms at 8). Capacity is the only phase that
    clearly shortens. The ≤15.5 ms / 30 min line is not met at 3 workers
    or at an oversubscribed 8 on this 4-core box; remaining cost is
    monthly migration plus per-commit cohort/ledger. Do not re-anchor
    `bench-baselines.json` downward from this faster runner (W2 lesson);
    `--check` still passes against the review-runner 220 ms target cap.
    **Review note (merge, 2026-09-02).** Delivered as specified: the
    scheduler, derived strides (target 1 / dev 12, re-derived here), the
    stride arm (dev deltas reproduced: population 4.0e-5, arrivals
    0/0/0/10 years), real `worker_threads` with hash identity across
    1/2/8 workers, and — checked cross-branch — stride 1 byte-identical
    to the pre-wave kernels at both grids (240 dev / 24 target ticks).
    Review corrections, all mechanisms not patches:
    (a) **The shell never ran wasm.** Since W2 the sim worker had been on
    the TypeScript kernels: the loader tested `typeof window` to detect
    Node, a browser worker has no `window` either, `fs.readFile` threw
    and the failure was swallowed. Node is now detected by `process.
    versions.node`; loader failures are logged, never silent. This is
    most of the owner's "5 years per 5 s" play-test slowness.
    (b) **Pool start-up was a structural hang.** The pool constructor
    waited for worker readiness with `Atomics.wait`; a worker that failed
    to start could only report through an event, which a blocked thread
    never receives — the shell's sim worker hung on exactly this once wasm
    actually loaded. Pool creation is now asynchronous (readiness via
    message events with a timeout), pre-warmed by `ensurePeopleWasm({
    workers })` as one process-level pool that kernels borrow (dispatch
    carries the kernel pointer); harnesses resize it with
    `resizePeoplePool(n)`. Node workers are `unref`'d so a pool never
    keeps a process alive (the reason gate/bench needed `process.exit`).
    (c) **Mid-phase worker failures propagate.** A worker that throws
    inside a band writes the error into shared memory; the coordinator's
    barriers check the flag and throw with the text instead of waiting
    forever (the `post({type:"error"})` it used was unreadable by a
    thread blocked in Atomics.wait). The worker script also takes its
    stack size and control-word layout from the coordinator rather than
    restating ledger constants.
    (d) **Shell tick race.** Ticks were posted before "create" finished,
    the worker threw "world has not been created", the error was dropped
    and `tickPending` stayed set — "waiting for worker" forever. Worker
    messages are now handled strictly in order and the shell posts no
    ticks until "created"; worker errors surface in the status line.
    Verified in Chromium: `Worker ready · WASM 3 threads · growth 12 ·
    migration 12`, population advancing. Note for W4: the tri-engine
    browser smoke runs on the page's main thread, where `Atomics.wait` is
    forbidden, so it exercises serial wasm only; a worker-side identity
    check is needed to cover the threaded browser path.
    (e) **The barrier stalls were lost futex wakeups, and they are the
    platform's.** A bare `Atomics.wait`/`notify` barrier between Node's
    main thread and three workers — no wasm, no sim — missed 26 wakeups
    in 30,000 rounds on the review runner; each cost the full 10 s wait
    slice, and W3's cadence bench showed exactly that (one 10 s stall in
    the dev 3-thread row; the very first parity run hung outright). The
    dispatch now lives entirely in shared memory (operation, kernel
    pointer, dt, band ranges in the control plane; workers wait on the
    phase word, never on a message), and every barrier waits in
    `PEOPLE_BARRIER_WAIT_MS` = 1 ms slices so a lost wake costs a
    millisecond: 3000 monthly dev ticks on 3 workers now take 14.4 s
    against 13.9 s serial with a worst tick of 51 ms (was 10,012 ms),
    hash identical.
    (f) **The sim worker hashed the world on every snapshot.** `hashWorld`
    walks every field with BigInt arithmetic: 87 ms at dev, **5.3 s at
    the target grid** — per tick batch, whatever the kernel did. Removed
    from the snapshot (reported once at creation; harnesses hash on
    demand). Together with (a) this is the owner's play-test slowness.
35. **Equal Earth display projection (2026-09-02, owner: "greenland is
    heavily distorted").** Measured at dev before changing anything: a
    flood fill over Greenland's land cells sums to 2.40M km² of real
    area against 2.17M km² true (1.11×, coastal rounding plus a sliver
    of Ellesmere) — 1.6% of the world's land by AREA, matching the real
    1.45%, but 3.3% by TILE COUNT. The sim was right and the
    equirectangular screen was painting Greenland ~2.3× too large. Fix
    is display only: `src/shell/projection.ts` builds a per-pixel
    inverse-projection table (Equal Earth, Šavrič et al. 2018, Newton
    inverse) from the lat-lon sim grid; every lens samples through it,
    picking runs the table in reverse, routes across the antimeridian
    are drawn to each edge, and a graticule + globe outline are drawn
    from the forward projection. A plate-carrée option stays for
    checking data alignment. No world state, hash, save, or gate is
    touched. Side finding from the same probe: at dev Greenland is
    fused to Ellesmere Island (Nares Strait, 20–40 km, closes at 170 km
    cells; an unbounded fill walks into Canada) — harmless for people
    (the Thule crossed it on sea ice), noted with the resolution-scale
    straits should boats ever need it; expected open at the 22 km grid.
    **Movable central meridian (same day, owner: "australia looks a bit
    squished").** No flat map keeps both shape and area; Equal Earth
    keeps area exact and puts the shear at the edges, so the centre is
    now draggable: at zoom 1 a horizontal drag spins the world about its
    polar axis (live rebuild of the table when it is under 40 ms, on
    release otherwise — the target grid's 1.6M-pixel table), the seam
    and graticule follow, routes split at the seam wherever it is.
    Verified in headless Chromium at 144°E with a Brazil→West Africa
    route crossing the Atlantic seam.

36. **W4 land-packed people kernel (2026-09-02).** This wave starts from
    the W3 merge `32974aac4e80b0004032d303a97f858d51cd9f20`; no W3 code was
    restarted. The target substrate at seed 42042 has 1,620,000 cells and
    558,091 land cells (34.4501%); dev has 28,800 cells and 9,752 land
    cells. The land list is row-major and the 16 bands are the same
    grid-derived row ranges as W3, with their endpoints converted to
    contiguous land-list offsets. The inverse is −1 on ocean.

    **Traffic ledger, measured before/after.** The pre-wave row uses the W3
    #34 implementation and its same-runner phase measurement. Bytes count
    `Float64` array reads plus writes (`8 B` each); branch bytes and scalar
    partial slots are immaterial and omitted. `N` is the full target grid
    and `L` is its land count.

    | target operation | W3 pre-wave | W4 land-packed | organization |
    |---|---:|---:|---|
    | migration clears: out, weight, received | 38.880 MB | 13.394 MB | W3 serial full-grid fills → W4 packed band fills |
    | growth-prepared migration setup: 4 arrays, read + write | 103.680 MB | 35.718 MB | serial full-grid copies → packed preparation band |
    | migration finish: 3 cohort copies, read + write | 77.760 MB | 26.788 MB | packed copy; no physics change |
    | migration total/received sums | 22.324 MB | 0 | two full-grid sums → 16 ascending band partials |
    | commit population, read + write | 25.920 MB | 8.929 MB | full-grid copy → packed-to-full-grid scatter |
    | ledger begin + end: people and area reads | 51.840 MB | 17.859 MB | full-grid sums → land-list sums |
    | **counted array traffic** | **320.404 MB** | **102.689 MB** | **3.12× less, 69.24% reduction** |

    The 13.394 MB W4 clear is split by phase: out/weight are cleared in
    migration preparation (8.929 MB) and received is cleared in the target
    phase (4.465 MB). Every growth slot is written, so its old four
    full-grid fills were removed entirely; the setup row counts the four
    required frozen-state read/write assignments. Source, debit, gather,
    normalization, and ledger iteration domains changed from raw `N` scans
    to `L` packed scans. W4 leaves only packed cohort copying,
    packed-to-full-grid commit, the remainder deposit, and barriers in the
    serial tail; no whole-grid migration sum remains.

    The timing confirmation is a warm target serial run (12 ticks after a
    12-tick warm-up): migration preparation 3.774 ms/tick, source 12.460,
    debit 4.701, gather 15.677, finish 1.031, for 37.64 ms total. The
    bench phase aggregate is 37.40 ms/tick for migration. W3's same-runner
    migration phase was 54.5 ms/firing.

    **Cadence × threads, target, same 4-core runner.** The table is the
    shipped 12-month schedule unless the name says stride-1. It uses the
    existing 116,412-tick horizon and 15.5 ms/tick ceiling.

    | config | ms/tick | idle-barrier ms/tick | projected YD→1 CE |
    |---|---:|---:|---:|
    | serial stride-1 | 74.59 | 0 | 144.7 min |
    | serial shipped | 46.73 | 0 | 90.7 min |
    | 3 threads stride-1 | 77.20 | 0.009 | 149.8 min |
    | 3 threads shipped | 47.67 | 0.002 | 92.5 min |
    | 8 threads stride-1 | 66.66 | 0.015 | 129.3 min |
    | 8 threads shipped | 43.33 | 0.053 | 84.1 min |

    Dev measurements were 1.370 / 0.118 ms/tick for serial stride-1 /
    shipped, 1.688 / 0.135 for 3 threads, and 835.43 / 0.172 for 8
    threads (the stride-1 eight-worker sample hit a 833.63 ms barrier
    outlier). The target result is a 73.0 → 46.7 ms shipped-schedule
    reduction from W3, but the ≤15.5 ms ceiling remains unmet even with
    eight workers on four cores. The remaining dominant target costs are
    monthly migration (37.4 ms) and the per-commit cohort/ledger tail
    (~4.25 ms); oversubscribed eight-worker migration is 33.35 ms. The
    optional f32-storage experiment was not taken: W4 already meets the
    land-packing objective with f64 scratch and f64 arithmetic, so no
    tolerance or arithmetic contract was changed.

    **Parity and stride arm.** Rust and TS use the same land order, packed
    neighbor inverse, phase order, and ascending partial fold. The
    existing 240 dev / 24 target byte-parity arm now also checks
    `capField` remains full-grid and `migrationReceived` is packed; serial
    wasm, one real worker, two workers, and eight workers are identical.
    The measured dev summation-order delta between the old row-major packed
    land-list fold and the W4 ascending band fold is +2.91e-11 persons for
    migration out and −1.75e-10 persons for migration received on the
    12-tick probe. The target values are −8.38e-9 and +2.11e-8 persons.
    The W4 3000-year stride arm passed at both grids. Dev population
    reference/shipped at −8000 was 5,265,868.263 / 5,265,657.124
    (relative Δ 4.01e-5); arrival deltas were 0 years for the Fertile
    Crescent, Nile, and Yellow River, 10 years for the Indus, and both
    Mesoamerica/Andes were unreached in both arms. Target population
    reference/shipped was 5,547,996.562 / 5,548,029.649 (relative Δ
    5.96e-6); Fertile Crescent, Nile, Yellow River, and Indus arrival
    deltas were all 0 years, with Mesoamerica/Andes unreached. The gate
    reported five dev and six target hearths ignited by 3000 years and
    `gate: pass` with no unexpected or stale misses.
    **Review note (merge, 2026-09-02).** Delivered as specified: packed
    scratch and iteration in both kernels, the migration prepare phase
    folded into the bands, band-ordered partials, the traffic ledger, the
    stride arm at both grids. Cursor branched from main (PR #122), so the
    merge re-applied W4's kernel deltas onto the W3 review pool (shared-
    memory dispatch, 1 ms slices, async pre-warm). Parity: dev 240 / target
    24 ticks, TS ↔ serial ↔ 1/2/8 workers, byte-exact after the merge.
    **The reason threads did not scale — false sharing, not bandwidth.**
    On the review runner the merged kernel measured target shipped 84.8
    ms/tick serial and 80.8 on three threads; growth at stride 1, pure
    per-cell arithmetic, went 30 → 26 → 43 ms (3 → 8 workers). Every band
    accumulated its births, deaths and migration totals with a per-cell
    read-modify-write into adjacent f64 slots of one 128-byte array, so
    the cache line bounced between cores on every cell. Accumulating in a
    local and storing once per band (same addition order, bit-identical,
    parity re-run) gives, at target, shipped schedule:

    | config | ms/tick | migration | growth (stride 1) | YD→1 CE |
    |---|---:|---:|---:|---:|
    | serial | 88.0 | 71.9 | 30.6 | 171 min |
    | 3 threads | 40.4 | 26.9 | 11.5 | 78 min |
    | 8 threads (4 cores) | 40.4 | 26.3 | 10.4 | 78 min |

    The remaining serial tail is cohorts + ledger at ~7.9 ms/tick (normalize
    and the per-pass sums run on the coordinator) plus the scatter commit;
    those are the next packed-and-banded candidates, and the ceiling
    (15.5 ms) now needs roughly a 2.6× box or that tail banded plus more
    cores. **Gate default restored:** W4 had put the target 3000-year
    trajectory (two runs) into the per-commit gate — ~1 h on a 4-core box;
    it runs under `GATE_PEOPLE_LONG=1` or `GATE_PEOPLE_TARGET=1` and its
    deltas above stand as the W4 measurement.

## M3a implementation findings

37. **The wave is now carried by farmer populations (2026-09-02).** The crop
    catalogue lives in `data/reality/crop-packages.json` and is rasterized
    alongside the wild-progenitor range data in
    `data/reality/crop-ranges.json`. Each land cell has a packed can-grow
    mask and native-range mask for every package; the can-grow test counts
    monthly climate-bell months above that package's base temperature and
    rejects short seasons. The old technique-speed constant and pin/scored
    hearth machinery are gone.

    Farmer masses are authoritative land-packed state, persisted in save v5
    and included in the world hash. Technique is derived as the farmer share,
    with the dominant package exposed to the shell. Farmers and foragers have
    separate logistic growth and share the existing cohort and conservation
    ledgers. Conversion is an annual scheduled pass using travel-weighted
    contact and the farmed-versus-forager capacity advantage; negative
    advantage returns farmers to foraging.

    Migration now uses the fixed eight-neighbour relation with true edge
    lengths. Coastal land cells add a first-land hop through at most the
    ledgered crossing distance, priced at coastal days/km; the same LUT is
    used by adoption contact, and a successful arrival extends the peopled
    mask. The TS oracle and serial/threaded Rust kernel carry identical farmer
    arrays and pass state; `tools/kernel-parity.ts` covers them at both grids.
    The new `neolithic-arrivals.json` fixture is wired into the long people
    gate beside the existing regional arrival table. The target-grid long
    arm remains environment-gated because it is the established multi-minute
    review measurement.

    Post-range dev probe (seed 42042, 3000 years after the Younger Dryas)
    measured the first threshold crossings at Fertile Crescent −8230,
    Balkans −7210, Indus −6870, and Rhine −6720; Yellow River and the
    lower-latitude package checks were not reached in that arm. The new
    short gate remains green: opening cross-grid relative difference
    0.0374, conservation error −1.18e−8 persons (dev) and
    −1.12e−8 persons (target), and seven hearths ignited by the 3000-year
    dev endpoint. The full radiocarbon table, front-speed band, isotropy,
    and south-of-barrier checks are intentionally only measured by the
    long-arm environment gate.

    **M3a phase/performance arm (target, this runner).** After pruning
    inactive packages and maintaining a packed total farmer mass, the
    `bench -- --check` arm measured 239.32 ms/tick for serial shipped
    schedule, 98.84 ms/tick with three workers, and 83.04 ms/tick with
    eight workers on four cores. The eight-worker projection is 161.12
    minutes for the YD→1 CE monthly horizon; migration remains dominant
    at 55.28 ms/tick, followed by annual technique and conversion at
    about 5.19 ms/tick each amortized. The target benchmark remains under
    the existing 264 ms ratchet cap; M3a's package/contact work adds more
    than the handoff's provisional +8 ms budget, recorded as a
    mechanism-cost finding rather than a physics change.
    **Review note (merge, 2026-09-02).** The implementation arrived as a
    commit on the working branch rather than a `cursor/v2-m3a` PR; it was
    reviewed line by line against the handoff as if it were one. The
    delivered structure is the spec's — packages as data with can-grow and
    native overlays, farmers as per-package masses carried by migration,
    technique derived as the farmed share, the eight-neighbour LUT with
    coastal hops, the radiocarbon table in the gate, save v5, parity with
    the new arrays — and it is kept. Five mechanisms did not do what the
    spec said, and each was corrected at the cause:

    1. **Farmed capacity was scaled by the farmer share.** `packageCapacity`
       kept M2's leading `technique ×` factor with technique now meaning
       "share of the cell that farms", so a package's capacity went as
       share², every founding group's advantage was negative, arrivals
       reverted at the adoption rate, and a cell could only be crossed by
       out-migrating its own reversion. Capacity is now the land's farmed
       capacity for the package (the share-keyed maturity regime M2 had is
       kept); a cell's capacity is the mixture of its people
       ((1 − s)·forager + s·farmed); and the room a target offers a source
       is the pair spare — the target's capacity opened, in proportion to
       the source's farmer share, to the land farmed with the source's
       dominant package — evaluated identically on the source and target
       sides so conservation holds to the ulp. Farmers can now enter
       forager land that is full of foragers; foragers cannot flood land
       that merely could be farmed.
    2. **The hearth law had degenerated to the catalogue lag.** Basin fill
       was density over a global bar of 0.0147 persons/km², which every
       peopled basin clears from the opening tick, so "peopled-basin years"
       was just "years"; and the candidate was the first native cell in
       row-major order. The M2 law is restored — a basin's people against
       the basin's own static forager capacity — accrued per native cell
       (`_hearthYears`, saved and hashed) through a summed-area table, and
       the first cells to cross the lag ignite, condensing under the
       separation bar. `PEOPLE_FORAGER_DENSITY_BAR` is withdrawn.
    3. **Conversion had a grid-spacing speed.** Contact over the eight-cell
       stencil with an unbounded linear advantage (capacity 40× foraging
       ⇒ advantage 40) converted a cell within a few years of a farmed
       neighbour, so the cultural front moved one cell per conversion
       interval: 130 km/yr at dev, 22 km/yr at target (third cardinal
       rule). Contact is now local (the farmer share of the cell) and the
       advantage saturates (adv/(1+adv)); spread is the farmers moving, and
       a cultural diffusion with a diffusivity of its own is an M3b-or-later
       question (DECISIONS 26, review rulings).
    4. **Farmers rode the forager diffusivity.** With D = 1200 km²/yr and
       the farmer regime's r = 0.46 %/yr the demic front is 2√(rD) ≈ 4.7
       km/yr — five times Pinhasi's band, which is why the delivered dev
       probe had the Rhine 490 years after the Balkans. Farmers now carry
       their own mobility (`PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR` = 15,
       Ammerman & Cavalli-Sforza): a farmer mass joins a month's flow at
       15/1200 of a forager mass. The adoption rate is then grounded on the
       front band given that mobility, as the spec said it would be — 0.01
       (the band admits 0.005–0.02), not 0.08.
    5. **The farmer total drifted from its parts.** The maintained
       per-cell farmer total differed from Σ farmers by rounding, so a
       loaded world's technique field differed in the last ulp from the
       world it was saved from — and the unit test could not see it because
       no hearth ignites inside its horizon. Both kernels now recompute the
       total as the package sum at every commit; the parity harness primes
       every native cell past its lag so farmers exist from tick 1 (the
       delivered parity never compared a farmer path: the first hearth
       ignites centuries after the harness's horizon).

    Smaller corrections: the wall check tests a barrier box from the
    reality row instead of every cell south of 20°N on Earth; the
    front-isotropy check is withdrawn (a bounding-box aspect of the farmed
    set says nothing about diamonds, and the climate bounds most of the
    front); hot loops in both kernels skip inactive packages and empty
    cells (arithmetic no-ops; parity re-run); the can-grow/native overlays
    are counts built once per world rather than the dominant package's
    plane rebuilt every batch; saves carry only packages with mass; the
    unused bake tool and `hearths.json` are gone; the annual technique
    pass no longer re-derives what the commit epilogue keeps current, and
    the farmer-total rebuild loops the active packages only. One W3
    housekeeping item closed on the way: a browser main thread may not
    block in `Atomics.wait`, so a world created there (the browser smoke
    checks do; the shell's worker does not) borrowed the pool and threw
    mid-tick — the pool is now taken only where the coordinator can wait,
    and Chromium's main-thread hashes match Node's pooled ones at both
    grids.

    **The +8 ms budget was never available to an eight-neighbour
    stencil.** Measured on this runner with the long arm paused, target,
    shipped schedule, serial: W4 89 ms/tick (migration 73), the delivered
    M3a 390 ms (migration 310), the merged mechanisms as first written 281
    ms (migration 245). Doubling the neighbours doubles the pairs, and the
    delivered gather priced every pair twice (spare, cost, conductance on
    the source side, again on the target side) with four divisions per
    pair for the flow and the three cohort shares. The merged kernel
    prices each pair once — the source phase stores conductance × spare
    per slot and out ÷ weight per source, the target phase reads them back
    through the reverse slot and multiplies by per-source cohort fractions
    frozen at prepare — in both kernels, parity re-run at both grids.

    **Measurements (review runner, 4 cores).** Parity: dev 240 / target 24
    ticks, TS ↔ serial wasm ↔ 1/2/8 workers, byte-exact at both grids with every
    native range primed to ignite at tick 1, so the farmer, mobility and
    pair-spare paths are compared from the first month. Unit, lint,
    ledger-lint, tsc green. Default gate: `gate: pass` — opening cross-grid
    relative difference 0.0374, conservation error −1.18e−8 persons (dev)
    and −1.12e−8 (target), the stride arm (shipped schedule against
    stride 1, dev, 3000 years) 1.6e−4 relative in population at −8000 and
    0–20 years in the arrivals it reaches (Levant 20, Yellow River 10,
    Indus 10, Nile 0, Ganges 0), 25 hearths ignited by the 3000-year dev
    endpoint, no stale manifest rows The dev long arm
    (seed 42042, YD→1 CE, the gate's own arrival measure — technique ≥ 0.5
    within ±3° of the row, sampled every ten years), delivered kernel
    against the merged one:

    | dev, YD→1 CE | delivered (77db7935) | merged | reality window |
    |---|---:|---:|---|
    | Levant hearth → half farmed | −8230 | −7570 | −9500 … −7000 |
    | Balkans | −7210 | −4790 | −7000 … −6000 |
    | Central Europe | −6880 | −3750 | −6000 … −5000 |
    | Rhine | −6720 | −3270 | −5600 … −4800 |
    | Cardial coast | −6950 | −4060 | −6500 … −5500 |
    | Yellow River | −5310 | −6880 | −8000 … −5500 |
    | Mesoamerica | −6100 | −3820 | −7000 … −2500 |
    | Andes | −4660 | −4560 | −5000 … −2500 |
    | Balkans → Rhine, km/yr | 3.25 | 1.05 | 0.6 … 1.3 |
    | Levant → Balkans, km/yr | 2.30 | 0.85 | — |
    | Europe can-grow cells farmed at −4000 | 250 / 256 | 103 / 256 | most |
    | people at −4000 | 2.99 B | 0.76 B | 7–14 M |

    The delivered wave crossed Europe at 3.25 km/yr (the whole continent by
    −6000, a millennium after the Levant): the grid-spacing conversion
    front. The merged wave runs at 1.05 km/yr through Europe and 0.85 from
    the Levant to the Balkans — inside the radiocarbon band, which is the
    speed the mechanism was built to predict — and is therefore LATE at
    every European row by 1,500–2,000 years, because it starts from a
    Levant ignition at −8050 (the catalogue lag counted from the Younger
    Dryas peopling; the real PPNA is a millennium earlier) and because
    nothing in M3a makes the Anatolian/Aegean leg faster than the interior
    (the Aegean and Cardial legs were maritime, beyond the 40 km hop —
    P14). Those rows go to the manifest with that reason; the speed itself
    is the finding that matters, and it is right.

    **Third cardinal rule spot check, target grid** (same probe, 3000
    years, 70 min on three threads beside the long arm): the wheat range's
    separated basins ignite between −8166 and −7907 (dev: −8184 to
    −7847), the Indus box first on both grids; millet −7521 to −7043 (dev
    −7550 to −6544); sorghum from −6787 (dev −6795). Half-farmed at the
    Levant −7470 / Nile −7420 / Indus −7470 / Ganges −7300 (dev −7570 /
    −7730 / −7680 / −7090). At −7000 the target grid has 1.4 % of its
    land cells farmed and 2.3 % of Europe's can-grow cells, dev 4.3 % and
    1.2 % — the coarse grid farms a cell whole. Same kind, same order,
    within a few centuries; the target long arm (hours) that measures the
    European rows at the shipped grid is the owner's long-arm run to
    schedule, and the `:target` manifest rows wait on it.

    **Deliverable 0, the pre-M3a baseline at the shipped grid.** The
    target-grid YD→1 CE long arm of the W4 kernel (`GATE_PEOPLE_LONG=1`,
    one pinned worker, 7.6 h on this runner, finished 21:32 UTC) is the
    "before" the handoff asked for beside the dev numbers above:

    | W4 kernel, target | measured | window / band |
    |---|---:|---|
    | Levant | −8100 | −9500 … −7000 |
    | Nile | −8030 | −8500 … −5000 |
    | Yellow River | −7440 | −8000 … −5500 |
    | Indus | −8070 | −7000 … −3500 (early, the manifested dev miss) |
    | Mesoamerica | −3910 | −7000 … −2500 |
    | Andes | −4570 | −5000 … −2500 |
    | people −5000 / −3000 / −1000 / 1 | 265 M / 644 M / 870 M / 948 M | ≤ 60 / 100 / 200 / 400 M |
    | density, river : rainfed : forager | 20.8 : 12.4 : 0.06 /km² | ordered |

    The dev arm of the same run agrees to within 60 years on every
    arrival (Indus −8060; Mesoamerica −6290 is the one grid-dependent row).
    Its `:target` rows are not written into the manifest — they describe
    the technique-wave kernel this merge replaced; the merged kernel's
    `:target` rows wait on its own long arm.

    **Hearths.** With ranges as data and the M2 law restored, the wheat
    range's separated basins all ignite between −8184 and −7847 (the Indus
    box first, at lon 74), millet's between −7550 and −6544, sorghum's
    across the whole of Africa between −6795 and −6490: every basin of a
    range fills at the same opening rate, so a lag counted from the
    peopling ignites a range everywhere within a century or two. The
    Sahel, East Africa, the Ganges, peninsular India and Japan therefore
    farm on their own millennia early — the range boxes and lags are the
    data that decide it (DECISIONS 26 g; P10 for the Sahel), and no
    mechanism here can hold the Sahel to −3500 while the Levant ignites at
    −8000 from the same law. Recorded in the manifest, not dialed.

    **Population.** The share-keyed regime reaches M2's matured farmed
    capacity within a few centuries of arrival, and with no mortality
    physics the world holds 0.76 B at −4000 and 1.95 B at −1000 on dev
    (the delivered kernel: 2.99 B and 4.14 B). M3b's food economy owns
    this; the population rows in the manifest carry the new figures.

    **Cost** (this runner, long arm paused, target grid, shipped schedule,
    `bench` cadence table, 12-tick samples):

    | target, ms/tick | W4 (ff6bb8d9) | delivered M3a (77db7935) | merged |
    |---|---:|---:|---:|
    | serial | 89.4 | 389.6 | 165.6 |
    | 3 threads | 40.5 | 184.4 | 97.4 |
    | 8 threads (4 cores) | 37.9 | 182.7 | 75.8 |
    | serial migration | 73.3 | 309.8 | 131.4 |
    | serial annual passes, amortised | 1.5 | 20.8 | 3.5 |
    | YD→1 CE projected, 3 threads | 79 min | 358 min | 189 min |

    The remaining +58 ms serial over W4 is the second neighbour set itself
    — the pairs doubled, each carrying the pair spare's loads and the
    conductance division — and it is the price of the stencil the spec
    asked for; the +8 ms budget in deliverable 7 was an estimate that did
    not count the pairs. The cohorts + ledger tail (7.6 ms) is W4's, still
    the next packed-and-banded candidate. `bench -- --check` passes under
    the 264 ms serial cap (row: 165.6 cold); the baseline is not
    re-anchored. The dev tick is 0.3 ms shipped.

## Development-loop findings

38. **Why every push cost twenty minutes, and the fix (2026-09-03, owner:
    "figure out why every single commit, merge or push on this repo takes
    upwards of 20 minutes").** The critical path was one CI job, "Node
    gates", running everything in series on one runner: 21.5 min on the
    last green run. Its step times: `npm test` 13.1 min, `npm run gate`
    4.5 min, `bench --check` 2.2 min, oracle 1.2 min, lint, build and
    setup under a minute together. Inside `npm test`, the parity harness
    hashed both worlds after every tick — and `hashWorld` was a byte-wise
    64-bit FNV in BigInt arithmetic, 5.5 s per target-grid call — so the
    target arm spent about nine minutes hashing to compare what it had
    already compared byte for byte. The gate spent four minutes on the
    3000-year trajectory and stride arms, which are simulation runs. The
    bench's cadence table was twelve configurations of twelve ticks with
    six target substrate builds along the way.

    Changes: the world hash is two 32-bit FNV-1a lanes over 32-bit words
    (target 5.5 s → 0.2 s, dev 116 ms → 7 ms; identity strings before
    this date are not comparable); the parity harness hashes once per
    pair; the trajectory and stride arms run only under
    `GATE_PEOPLE_TRAJECTORY=1` and the cadence table under
    `BENCH_CADENCE=1`, both in the new on-request `v2-long` workflow
    together with the Firefox/WebKit matrix; per-commit CI is four parallel
    jobs (lint+unit+smoke+build, parity, gates+ratchet+oracle, Chromium)
    with the cargo cache kept between runs. Nothing that simulates history
    runs per commit; that is now a rule in CLAUDE.md.

    Local, this runner, after: unit 3 s, smoke 25 s, parity 165 s,
    mechanical people gate 51 s, bench ratchet 62 s — 5.1 min in series
    where the same tools took 21 min on CI. CI wall time after
    (run 33700049046, dd691a79): 4 min 53 s from push to the last job's
    end, against 21 min 37 s for the previous green run — lint + unit +
    smoke + build 1:52, Chromium 1:44, parity 3:12, gates + ratchet +
    oracle 4:50 (the critical path: wasm build 46 s, travel gate 42 s,
    people gate 45 s, bench ratchet 49 s, oracle 75 s — four target
    substrate builds).

    What is left on the path is the target substrate build, about 41 s per
    tool and rebuilt by every tool (parity, smoke, both gates, bench,
    oracle), and world creation at the target grid, 12 s. A content-keyed
    on-disk substrate cache would take both to under a second locally; in
    CI the restore of a ~400 MB artefact costs about what the build does,
    so it is a local-loop gain first.

## Prehistory findings

39. **Prehistory on the clock physics permits (2026-09-03, owner: "do we
    NEED to model several thousand years of predictable people growth?",
    "do we REALLY need to simulate actual year by year movement?").** The
    analysis behind `spec/handoffs/W5-solve.md`.

    **What forces the monthly tick.** The forager hop share,
    `PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR / area`: 2.4 hops a year at
    the equator of the shipped grid (495 km² cells), unbounded toward the
    poles, against the explicit-diffusion bound of half a cell's people
    per firing — so migration fires monthly at the shipped grid and the
    kernel runs 116,000 ticks from the opening to 1 CE. Farmers hop at
    `PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR / area`: 0.030 a year at the
    equator, 0.065 on a 62° row. The same bound permits a farmer step of
    five to seven years at the shipped grid, set by the highest-latitude
    row any package can grow on (seven if that row is near 62°, six near
    65°, five near 70° — the implementation prints it). At dev the hop bound is
    centuries and the binding bound is cohort ageing (a seventh of the
    children age out per step at seven years). The other explicit
    fractions — farmer growth 0.46 %/yr, adoption 1 %/yr — bound the
    step at 108 and 50 years. So the pre-wake regime runs about 1,400
    steps at the shipped grid instead of 116,000, and every step is the
    kernel's own passes with a longer `dtMonths`.

    **What the regime omits, and how large that should be.** Forager
    hops. The opening fill is a uniform fraction of forager capacity
    (`PEOPLE_INITIAL_FILL_FRACTION`), so to first order the forager flux
    between neighbours cancels and the fill fraction stays uniform;
    growth then differs between cells only through the disease term
    (≤ 35 % slower in the tropical belt), which opens fill differences of
    order a tenth over the fill and drives a second-order flux. That flux
    is not small in reach — the forager diffusion length over 3,000
    years is √(4 · 1200 · 3000) ≈ 3,800 km — but it moves people between
    basins whose fill fractions differ by a tenth, and the hearth law
    reads a basin's fill over a 1,000 km window. The expected effect is
    hearth ignitions shifted by decades to a century or two, and
    arrivals with them; the agreement arm measures it at both grids
    against the awake kernel and the bound is a gate tolerance
    (`SOLVE_AGREEMENT_ARRIVAL_TOLERANCE_YEARS`, a tenth of the narrowest
    reality window). If it fails, the remedy is named in the spec: the
    forager hops return at the forager stride with substeps, or the
    stride comes down; never the tolerance. The other omission is the
    monthly conductance, replaced by its annual mean; the stride arm
    already measured annual-versus-monthly migration at dev at 0–20
    years in arrivals (QUESTIONS #37).

    **The two regimes of the lattice front.** The front's speed depends
    on two rates per cell: the farmer hop rate λ = 15 / area per year
    and the leading-edge growth r = 0.0028 × 1.65 + 0.01 × adv/(1+adv) ≈
    0.0144 per year where farming's advantage is large.

    | | dev (167 km cells) | target (22 km cells) |
    |---|---:|---:|
    | cell area at the equator | 27,800 km² | 495 km² |
    | λ, farmer hops per year | 0.00054 | 0.030 |
    | r / λ | 27 | 0.48 |
    | continuum Fickian diffusivity λ⟨d²⟩/4 (⟨d²⟩ ≈ 1.5 · area over the 8-stencil) | 5.6 km²/yr | 5.6 km²/yr |
    | continuum front speed 2√(r · D) | 0.57 km/yr | 0.57 km/yr |
    | measured (M3a review, Balkans → Rhine) | 1.05 km/yr | not measured — the 3000-year target spot check ended before Europe |

    The Fickian diffusivity is grid-invariant (λ · area is the mobility),
    so in the continuum regime both grids would give the same speed. But
    dev sits deep in the slow-hop lattice regime, r ≫ λ: a cell is seeded
    by a neighbour that is itself saturating toward forty times the
    forager density, the front is one cell wide, and its speed is set by
    how fast the source fills, not by the leading edge — a pushed lattice
    front, and the 1.05 km/yr measured at dev is that regime, above the
    continuum value. The shipped grid sits near the continuum, r ≈ λ/2,
    where the front is wider than a cell and pulled by its leading edge.
    The two grids can therefore differ in KIND, not degree (third
    cardinal rule), and nothing has yet measured the target front through
    Europe: the M3a review's target long arm is the owner's run to
    schedule. W5 makes that a per-commit number at the shipped grid. If
    the target front comes out slower than dev's — the analysis says it
    may — that is the kernel's hop law, the same in both regimes, and a
    finding about it; the solve reproduces whichever regime the grid is
    in because it runs the same nonlinear hop-and-grow law at a stride
    inside the same bound. The solve is not a new front physics, and the
    unit check in the spec pins the flat-field speed to the awake
    kernel's, printing the linear spreading speed beside it so the
    regime stays visible rather than absorbed.

    **Where the wake lands on the current kernel.** The trigger is the
    first hearth-law window whose free farmable share falls below the
    caging knee (a fifth). On the dev long arm the Levant wheat hearth
    ignites at −8050 and is half farmed at −7570; its 1,000 km window is
    crossed in about a thousand years at the measured speed and fills
    from the forager density toward the farmed capacity at 0.46 %/yr —
    to four fifths of a forty-fold rise about 750 years after the last
    cell is reached. So the current kernel should cage the Levant around
    −5800: roughly 40 % of the opening-to-1 CE horizon, not the whole of
    prehistory. That is the honest number today, and it is early for the
    same reason the population curve is high (282 M at −5000 against a
    band of 60 M): nothing yet kills anyone. When M3b's mortality physics
    lands the basins fill slower, the wake moves later, and the wake year
    becomes a development clock the gate prints at both grids on every
    commit. A player who wants a later start chooses a year, and
    provenance records that the world was caged earlier.

    **What it buys and what it does not.**

    | | today | with W5 |
    |---|---|---|
    | opening to the first caged basin, shipped grid | over an hour on three threads | seconds to a minute, played on the map |
    | any pre-wake year on screen | replay | a sought frame |
    | arrival windows and population bands at the shipped grid | the long workflow, hours, on request | every commit, both grids, ≤ 60 s |
    | the awake kernel's tick | 76–166 ms at target | unchanged |

    The last row is the point to keep in view: the awake kernel's cost
    is the forager diffusion bound on polar rows and the eight-neighbour
    pair loop, the row-cadence question W3 left open; W5 removes the
    ticks before the wake, not the cost after it.

    **The dev-loop cost.** The per-commit gates job grows by the target
    solve arm, budgeted at 60 s and reported; it sits inside the
    directive's letter (nothing that takes hours) and the spec names the
    one-line demotion to `v2-long.yml` if the owner wants it out.

40. **W5 landed: the solve regime and the wake (2026-09-03, owner: "you
    must now implement the spec, here in this chat").** Implemented on
    the working branch against `spec/handoffs/W5-solve.md`; the handoff's
    status section lists what was kept and what the measurements changed.
    The findings, in the order they were made:

    **The stride is 84 months at both grids, but not for the reason the
    spec expected.** The bare farmer hop bound (`share ≤ 0.5` per firing
    on every row a package can grow on) came out at 12 months at the
    shipped grid: the crop bells admit can-grow cells on near-polar rows —
    the highland-roots bell reaches 83.3° S (the Antarctic coast, a row of
    58 km² cells), wheat and the eastern seed crops 78° N, sorghum 71° N —
    where a seven-year farmer share is 1.8. That is a data finding about
    the bells (M3a review ruling g, the range and bell citations), not a
    reason to substep by hand. The derivation now uses the bound the hop
    kernel honours without capping — `PEOPLE_MIGRATION_MAX_SHARE ×
    PEOPLE_MIGRATION_MAX_SUBSTEPS` per firing, the same substep mechanism
    every firing already goes through — under which the polar rows bind
    at 31 years and the cohort-ageing bound (7 years) is the minimum at
    both grids. W3's forager stride keeps the bare bound, because there
    the cap beyond sixteen substeps is what hides an unstable firing; a
    farmer firing inside sixteen substeps is not hidden, it is substepped.

    **Foragers hop in the solve regime.** The spec proposed leaving them
    in place (a uniform opening fill, so no net flux to first order). The
    flat-field unit check — one seeded cell on a uniform dev field, the
    solve regime against the awake kernel over 280 years — measured the
    omission at 58 % in farmed extent (Σ technique 2.09 against 1.33): a
    farmed cell's mixture capacity opens room, foragers from every
    neighbour hop into it at the forager share, and the newcomers dilute
    contact, so adoption in and around the seed runs slower in the awake
    kernel than in a solve without them. First order at the front, not
    second. The spec's named remedy applied: each group takes its own row
    share of the stride (foragers the forager share, substepped and capped
    by the kernel's bound; farmers the farmer share, inside it), and the
    mobile mass is the weighted sum. With that the flat field agrees to
    5.3 % in extent and 0.02 % in population. The awake regime is the
    kernel as it was, bit for bit (forager weight one, farmer weight the
    mobility ratio, the row's forager share as the out-share).

    **A bug caught re-reading the diff.** A monthly firing after the wake
    inherited the solve regime's 84-month row shares: the awake path only
    recomputed them when its dt was not one. Every firing now prices its
    own stride in both kernels; a month is the opening fill's expression,
    bit for bit. Parity (three regimes at both grids, TS ↔ serial wasm ↔
    1/2/8 workers, byte-exact) and the smoke's continuation across the
    wake would not have caught it on their own — both sides shared it.

    **The wake trigger is sequential TypeScript**, like the hearth law: it
    reads the authoritative arrays (views onto wasm memory under the wasm
    kernel) and computes two summed-area tables, so both kernels agree by
    construction and Rust carries nothing for it. The windows are centred
    on farmed cells (a window without farmers cannot be caged; the scan is
    the farmed set, not the land).

    **Measurements (review runner, 4 cores).** Dev: the full-horizon solve
    (`wake: "never"`, 1,386 firings of 84 months) in 14 s serial; the
    world wakes (`auto`) at −6144, 508 firings, in the Lower Egypt window
    (29.2° N, 30.8° E). Target: a solve firing 233 ms serial over the
    opening firings (the bench's ten) and 294 ms with hearths active, by
    phase — migration 134, conversion 38 (the hearth SAT in TypeScript),
    growth 34, capacity 14, technique 10, cohorts 5, ledger 3, the
    trigger 21, the recorder 4 — against 163 ms for an awake tick: the
    annual passes fire every firing. Dev: 5.6 ms a firing against a 2.2
    ms tick. Opening to the wake at the shipped grid is
    therefore about 150 s serial (the awake kernel: 69 min at 97 ms on
    three threads for the same 42,672 months); the full horizon about 7
    min serial, past the per-commit budget the spec set, so the target
    solve arm runs under `GATE_PEOPLE_SOLVE_TARGET=1` in `v2-long` and the
    dev arm per commit. Bench rows: `solveStepMilliseconds` (ten serial
    firings) beside `tickMilliseconds`, in the ratchet.

    **The dev solve arm against the awake kernel's dev long arm**
    (QUESTIONS #37, the same instruments; the solve reads arrivals from
    the recorder, the awake arm sampled every ten years):

    | dev, YD→1 CE | awake (monthly) | solve (84-month) | reality window |
    |---|---:|---:|---|
    | Levant | −7570 | −7551 | −9500 … −7000 |
    | Nile | −7730 | −7726 | −8500 … −5000 |
    | Indus | −7680 | −7677 | −7000 … −3500 |
    | Yellow River | −6880 | −6865 | −8000 … −5500 |
    | Balkans | −4790 | −4324 | −7000 … −6000 |
    | Central Europe | −3750 | −3267 | −6000 … −5000 |
    | Rhine | −3270 | −2791 | −5600 … −4800 |
    | Cardial coast | −4060 | −3582 | −6500 … −5500 |
    | Mesoamerica | −3820 | −4534 | −7000 … −2500 |
    | Andes | −4560 | −4562 | −5000 … −2500 |
    | Balkans → Rhine, km/yr | 1.05 | 1.04 | 0.6 … 1.3 |
    | people −5000 / −3000 / −1000 / 1 | 282 M / 1.27 B / 1.95 B / >2 B | 265 M / 1.23 B / 1.90 B / 2.18 B | ≤ 60 / 100 / 200 / 400 M |
    | density, river : rainfed : forager | ordered | 31.5 : 19.2 : 0.04 | ordered |

    The Old World hearth rows agree within 20 years and the front speed
    within 1 %; Europe is reached about 470 years later and Mesoamerica
    700 years earlier in the solve. Those are the regional deltas the
    agreement arm is built to bound at the per-cell median over the
    horizon (long workflow, not yet run); the misses themselves are the
    awake kernel's, manifested under `:solve:dev` with the same physical
    reasons. The first caged basin on the current kernel is the Nile
    delta at −6144 — the sim's Egypt fills first — and it is early for
    the reason the population is high: nothing dies yet.

    **What is not in this landing.** The agreement arm has the instrument
    and its unit checks and has not been run (a monthly 3000-year run is
    a long-workflow arm). The target solve arm's reality table waits on
    the same workflow. The shell's timeline reconstructs frames from the
    recorded arrivals and the passes' constants; it is a rendering, never
    state, and is not saved.

41. **W6 landed: the base population stays (2026-09-03, owner: "now I
    want YOU to implement this").** Implemented on the working branch
    against `spec/handoffs/W6-foragers.md`; the handoff's status section
    lists what was kept and what the measurements changed.

    **The forager mobility, grounded.** The M2 value (1200 km²/yr) was a
    v1 calibration the seed table had carried as `[REDERIVE]`. The
    replacement follows the farmer value's own convention — mean squared
    displacement per generation ÷ 4T — from the only forager population
    with a published mating-range measurement I could read in full: the
    Aka of the Central African Republic, at 0.017–0.031 people/km², inside
    the sim's forager density band. Cavalli-Sforza & Hewlett (1982, *Ann.
    Hum. Genet.* 46) report that the mean distance between the birthplaces
    of mates equals the mean exploration range; Hewlett, van de Koppel &
    Cavalli-Sforza (1982, *Man* 17) measure that range as negative-
    exponential with mean 43 km (half-range 30; adult males 27.5–58.3 km
    by locality, females 32.4). An exponential has ⟨d²⟩ = 2k². Counting
    one parent's displacement as half the mating distance gives 925 km²
    per generation and 9 km²/yr; counting the whole mating distance gives
    3,698 km² and 37 km²/yr. The ledger carries the range and the value is
    its median, 23 km²/yr — one and a half times the farmer value, not
    eighty times it. Chosen from the sources before any run, as the spec
    required. (MacDonald & Hewlett 1999 is a scanned image with no text
    layer on the copy I could reach; Wijsman & Cavalli-Sforza 1984 and Fix
    1999 are behind paywalls; none was used.)

    **Room by group, two flows.** Foragers see forager room (the land's
    forager capacity minus everyone there), farmers see the farmed
    capacity of the package they carry minus everyone there; room below
    the numerical floor is no room; each group splits by conductance × its
    own room and hops its own share; a source none of whose neighbours has
    room for a group is not priced for it (a superset flag per target,
    so a skip never drops a flow that is not zero). Parity byte-exact in
    three regimes at both grids.

    **A second commit-path bug, caught by the same flat-field check.**
    With movement every 84 months and growth every 12, a growth-only
    firing existed for the first time, and it never committed the farmer
    masses growth wrote — only the movement pass ever wrote them back, so
    a year's farmer growth was lost while the people it belonged to were
    kept, and the awake front fell behind the solve by 80 % in farmed
    extent. Both kernels now commit farmers on a growth-only firing. The
    check then agrees to 4.8 % in extent and 0.01 % in population.

    **What the flood's removal did to the front.** On the dev solve arm
    (17 s for the horizon), Balkans → Rhine runs at 1.08 km/yr against
    1.04 with the flood (awake 1.05): inside the band, so the adoption
    rate stays at 0.01 and the re-grounding clause was not needed. The
    ignition cells reach half farmed about four centuries sooner (the
    Levant −7971 against −7551; the Nile −7936; the Indus −7943; the
    Yellow River −7201), and every European row moves 400–600 years
    earlier (Balkans −4919, central Europe −3897, Rhine −3449, Cardial
    coast −4065, inland Europe −4191 — that row now inside its window).
    The Indus crosses its early grace line by 140 years, an independent
    ignition inside the wheat range box (DECISIONS 26 g), manifested. The
    first caged basin is the Nile delta at −5955 (W5: −6144). Population
    at −5000 is 247 M (W5 solve 265 M): the same missing-mortality miss.

    **The stride, both regimes.** Each group's hop bound (foragers on
    peopled rows at 23 km²/yr, farmers on can-grow rows at 15, inside the
    substepped bound) sits far above the cohort-ageing bound, so the
    awake movement stride derives to 84 months at both grids: growth
    fires yearly, movement every seven years, and most months are empty
    ticks. The awake and solve regimes now differ only in the growth
    cadence.

    **Measurements (review runner, 4 cores; this afternoon's runner was
    about a third slower than the morning's — the same target substrate
    build took 52.5 s against 39 s — so cross-session numbers carry that).**
    Awake, target, one 84-month cycle: 1,338 ms — growth 305 (seven
    firings), movement 207 (one firing), conversion 195, capacity 140,
    cohorts 52, technique 25, ledger 28 — a mean month of 16 ms against
    163 before W6, a tenfold cut; the projected YD→1 CE is about 32 min
    serial at the shipped grid against 5.3 h, and the 6,000 years after
    the wake about 20 min against two hours. Dev: 0.8 ms a month against
    2.2. A solve firing: 8.2 ms dev, 416–426 target (233 in the morning's
    W5 measurement; two rooms per pair cost about a fifth more when every
    pair is priced, the rest is the runner). Priced pairs at the opening:
    3.07 M of 4.5 M (foragers have room everywhere at 35 % fill; the skip
    earns its keep as the world fills). Parity 520 s locally with the
    switch regime at dev only. Bench baselines re-anchored downward for
    the tick rows (12 → 2 dev, 220 → 22 target) and upward for the solve
    firing (8 → 11, 300 → 440) with the measurement attached.

    **Not run:** the agreement arm and the target solve arm (`v2-long`).
    The awake trajectory at the shipped grid is now a half-hour run
    rather than five hours, which the long workflow can afford weekly.

42. **W7 landed: where farming begins, and how it travels (2026-09-03,
    owner: "we need the spread and starting block to be perfect, or at
    least acceptable", on the play-report of ten wheat hearths in one
    century from the Nile to the Indus and ten rice hearths from Bengal to
    Japan).** Spec `spec/handoffs/W7-origins.md`; DECISIONS 29.

    **The finding.** The M3a hearth law was a calendar in two parts. The
    wild ranges were bounding boxes of whole botanical distributions
    (wheat 30–78°E, rice to 145°E, sorghum across sub-Saharan Africa),
    their citations pending since the review (26 g). And a world that
    opens peopled fills every basin to its forager capacity within a few
    centuries, so every cell of every box reached the package's lag in the
    same century; the 1000 km separation rule then cut each box into a
    string of hearths — 78 in all, ten for wheat, ten for rice, twenty for
    sorghum. A hearth fired because of when it was (first cardinal rule),
    in places whose only claim was a box (second rule).

    **What changed.** (1) The ranges are the dense-stand habitat of the
    wild progenitor, cited per package on the sources' own distinction
    between massive stands and sporadic plants (Harlan & Zohary 1966;
    Zohary, Hopf & Weiss 2012; Fuller 2011; Fuller & Qin 2009; Matsuoka
    2002; Piperno 2009; Harlan 1971; Winchell 2017; Manning 2011; Lu 2009;
    Zhao 2011; Olsen & Schaal 1999; Piperno & Pearsall 1998; Harlan 1969;
    Denham 2003; Smith 2006). (2) The clock accrues at the basin's fill
    times `foragerCapacity / capField`, the share of the cell's own
    subsistence that is still the land's forager yield: a basin the spread
    has reached lives on a farmed capacity a hundredfold that yield and its
    clock all but stops, so arrival pre-empts invention with no rule for
    it. (3) `PEOPLE_COASTAL_HOP_KM` 40 → 100, the crossings the Neolithic
    colonised (Cyprus, Malta, Corsica). (4) Sorghum's lag 2000 → 2500, the
    Sudan's wild harvests to its domesticated grain (Winchell 2017). No
    bell, no other lag, no separation, no rate, no mobility moved; the
    Rust kernel is untouched.

    **Dev solve arm (17.8 s, wake never).** 21 hearths: wheat 2 — northern
    Iraq (33.8°N, 42.8°E) at −8083 and Fars (32.2°N, 51.8°E) at −8027, the
    southern Levant folding into the first by the separation rule; millet
    2 at −7313/−7306 (the western Liao and Inner Mongolia's edge of the
    loess belt); rice 1 on the Han–Yangtze (32.2°N, 113.3°E) at −6200;
    sorghum 5 across the Sahelo-Sudanian belt at −6186 to −6151; Ethiopia
    1 at −6417; eastern seeds 2 at −6200; New Guinea 2 at −5661/−5556;
    lowland tubers 5 at −5486 to −5367; maize 1 in the Balsas at −3946.
    Reached by spread, inside their windows: Fertile Crescent −7971, Nile
    −6515, Yellow River −6298, Indus −5654 (−7943 before, its own hearth),
    Mesoamerica −3498, Andes −4478, south India −3750 (−6340 before, its
    own hearth). Japan no longer ignites (−6088 before). Population at
    −5000 falls from 247M to 78.8M against a band of 5–60M; at 1 CE from
    2.25B to 1.94B. Balkans → Rhine 1.08 km/yr, unchanged. The first caged
    basin moves from the Nile delta (−5955) to Susiana (32.2°N, 48.8°E) at
    −5892.

    **Transect (dev, arrival year).** Northern Iraq −7971 → southeast
    Turkey −7635 → Cilicia −6977 → central Anatolia −6774 → northwest
    Anatolia −6242 → Thrace −4835 → Bulgaria −4807 → Thessaly −4478 →
    Belgrade −4359 → Hungary −4226; Cyprus −6774, Crete −3862 (overland
    through the Balkans), eastern Iberia −1881; Sinai −6718, the Fayum
    −6312; the Iranian plateau −7915, Turkmenistan −6809, the Indus −5850,
    the Punjab −5360, the Ganges −4058, Bengal −3302; the loess −6501, the
    lower Yangtze −5899; Korea and Japan never. The Marmara is the whole
    European lateness: 1,400 years from northwest Anatolia to Thrace for a
    strait a kilometre wide, because at 167 km cells it is open sea beyond
    any hop and the front walks round the Black Sea. The same for the
    Korea Strait. The dev grid cannot represent straits; the European rows
    and Japan are the shipped grid's to measure (third cardinal rule), and
    the dev rows are recorded as that artefact.

    **What remains early, and whose it is.** The Sahel (−6060 against
    −3500) and eastern North America (−6200): the sim's belts are caged
    from the opening under today's climate, where the real ones filled as
    the green Sahara dried and the mid-Holocene floodplains formed — P10,
    not a lag to stretch. The Ganges (−4254 against −3000) now by spread
    from the Punjab at the front's own speed, a millennium early. Ethiopia
    (−6417) on a lag the record cannot yet ground. Population is M3b's.

    **Manifest.** The Indus and south India rows leave; inland Europe
    joins the European rows (their cause is now the straits, not the
    Levant's lag); the Sahel, barrier, Ganges and Japan rows carry their
    new numbers and causes.

    **Shipped grid (target solve arm, 1,069 s).** The first target run
    measured the old hop: the edit that raised `PEOPLE_COASTAL_HOP_KM` sat
    in a script block that aborted on an earlier assertion, and a
    connectivity probe (no coastal link in the whole Marmara window, none
    longer than 37 km anywhere) found it. With the hop in effect: 94
    crossings of the Marmara (the Bosporus at 44 km), Cyprus at 89 km,
    the Cyclades chain, Tsushima at 92 km. 28 hearths: wheat on the Tigris
    (−8069) and in the Taurus north of Cilicia (−8048); millet 3; rice on
    the middle (−6221) and lower (−6151) Yangtze; sorghum 9; Ethiopia 2;
    eastern seeds 2; New Guinea 2; lowland tubers 6; maize 1 (−3974).
    Arrivals: Fertile Crescent −7859, Nile −6235, Yellow River −7012,
    Indus −3225, Mesoamerica −3435, Andes −3995, Balkans −5654, Cardial
    −4807, inland Europe −4387 — inside their windows; Crete −5871,
    Cyprus −6851, Thrace −5983, Bulgaria −5696, Thessaly −5395, Korea
    −4555, Kyushu −3883. Population −5000: 53.0M, inside the band (118M
    before the wave; 5–60M). Caged: Cappadocia (38.3°N, 36.9°E) at −5535.
    Still late: central Europe −3722, the Rhine −2980, Balkans → Rhine
    0.59 km/yr against the band's 0.6. Still early: Japan −3162 (millet
    through Korea; the window is Yayoi rice), the Sahel −5864 (P10). The
    Ganges −950 and south India unreached: the second wheat hearth
    condensed in the Taurus rather than Fars, and the Iranian leg slowed
    (plateau −6263, Turkmenistan −4716, Indus −3155). Bench: target solve
    firing 399 ms against the 440 baseline; parity byte-exact on the new
    stencil at both grids.

    **The front speed is the farmers' own 2·√(r·D).** Flat field, one
    seeded cell, the solve regime: dev 0.66 km/yr (one 167 km cell every
    252 years after a 420-year latency), target 0.53 km/yr after a
    340-year latency. 0.53 is 2·√(0.0046 × 15) to two figures: the farmer
    group's growth (0.28 %/yr × 1.65) and mobility (15 km²/yr). The
    ledger's expectation of 0.94 added the adoption rate at full contact;
    a pulled front's speed is its leading edge's linear rate, and at the
    edge contact is nil. So the shipped-grid Europe is late for a grounded
    reason: `PEOPLE_R_GROWTH_PER_YEAR` (0.28 %/yr) is the crowded long-run
    average, which the logistic term already produces from an uncrowded
    rate, and a colonising Neolithic population grows at ~1 %/yr
    (Bocquet-Appel 2002; Ammerman & Cavalli-Sforza 1984 used a colonising
    r). Re-grounding r is M2's constant and lifts the population curve as
    well, so it goes to the owner as P15 rather than into this wave.

43. **W8 landed: who farms what, where, and why (2026-09-03, owner:
    "implement", after "a lot of this seems fixed, not dynamic and
    procedural?", the marginal-land question and the beige-over-green
    question).** Spec `spec/handoffs/W8-who-farms-what.md`, whose status
    section carries the numbers; DECISIONS 30.

    **What the wave is.** The origin, the resistance and the crop choice
    from two fields. Wild stands are a field (each package's habitat
    envelope sampled at the plant's localities, polygons for the belts);
    forager capacity is by habitat (terrestrial, aquatic at Binford's
    median on shores as a 20 km strip's share of the cell, rivers, lakes
    and floodplains, and the richest stand at the Natufian density); a
    crop's capacity is graded by its fit with accessible water meeting
    its need; a cell's capacity is the mixture of its crops; foragers
    adopt under pressure and farmers switch by the adoption law; a hearth
    ignites where a basin's dependence on its stand has run the lag and
    the crop beats foraging, and it is a region. The spacing constant is
    gone. Three new reality tables.

    **The measurements that changed the draft** (all in the ledger): the
    aquatic term on rainfall; pressure against the mixture; the stand
    through the yield chain; the hearth share against fishing; the shore
    as a whole cell. Each was a first draft that the dev solve arm
    falsified in seconds, which is what the solve regime is for.

    **What it produced.** At the shipped grid: three wheat hearths across
    the Crescent at −7900, three rice hearths on the Yangtze inside their
    window, five millet hearths in north China, maize in the Balsas, the
    Balkans reached at −5332, the population at −5000 inside its band
    (43.8M). At dev the same in kind, except rice, which millet pre-empts
    by a century at 167 km cells.

    **What it exposed.** The W5 wake trigger: with fit-graded capacities
    no basin cages for millennia (dev −2049 in the Amazon, target −1335 in
    New Guinea), so the auto wake needs its own review — the denominator
    counts every farmable cell of the window at its own fit-graded
    capacity, which marginal cells inflate. The frontier growth rate (P15)
    now binds Europe's interior at 0.56 km/yr. Japan is early because the
    shore forager does not resist rice without labour and risk terms. The
    Punjab is a riverine corridor without irrigation works. The crop bells'
    warmth terms hand the Nile to sorghum and Mesoamerica to the eastern
    seeds. All recorded in the manifest with their causes; nothing dialed.

44. **The stray hearths are a SPREAD problem, not a RANK problem
    (2026-09-04, owner: "so what", then "yes" to landing the dietary-share
    gate).** The gate's five `hearth-outside` rows were one undifferentiated
    list. Measuring, per package, where the cited centre of domestication
    ranks among every cell of that crop's derived wild range — scored by the
    W10 site quality, `stand x gain` normalised to the crop's best ground —
    splits them in two.

    **The ranking.** Wheat, maize, sorghum and eastern-seeds already rank
    their cited centre #1. Millet ranks north China #3 of 483 (0.889 of a
    Kazakh leader) and manioc ranks the Amazon margin #2 of 431 (0.993) —
    near-ties. Rice ranks the Yangtze #89 of 114 (0.001), enset ranks
    Ethiopia #15 of 88 (0.407), taro ranks Kuk #9 of 76 (0.341) — genuinely
    mis-scored, and all three the same way: the score prefers the hot wet
    lowland end of the range (Bengal, the Congo, coastal Queensland) over the
    seasonal upland end that actually domesticated.

    **The attempt.** Replace the absolute stand with the DIETARY SHARE,
    `stand / foragerCapacity` — a true share in [0,1] because
    `applyWildStands` sums the cell's richest stand into its forager
    capacity. The argument is mechanism, not fit: the domestication syndrome
    fixes under cumulative selection; people select on a plant only by
    harvesting it hard; they harvest hard only what they live on. So a big
    stand on ground that also teems with game and fish selects nobody. The
    payoff term stays ABSOLUTE, so it does not repeat the relative-gain
    failure that once put hearths on the Siberian steppe.

    It improved every ranking it was meant to: manioc's Amazon margin to #1,
    enset 0.407 -> 0.691, taro 0.341 -> 0.693, no rank regression on the four
    already correct. **And it made the gate worse — strays 16 -> 27,
    unacknowledged 9 -> 10, a new maize stray.** Dividing by forager capacity
    COMPRESSES the score range, because stand and forager capacity are
    positively correlated (rich ground has both): cells at >=0.80 of best
    went 5 -> 12 for manioc, 2 -> 4 for taro, 2 -> 3 for maize, and rice went
    from one stray to five. Reverted; the measurement is the keeper.

    **What that establishes.** `hearth-outside` tests the SPREAD of the site
    score, not its rank — it fails on any ignition outside a cited centre, and
    the leader being right does nothing about the runners-up. Under the
    current law a cell at 0.99 of best accrues at 0.99 of the rate and ignites
    about twenty years later, while pre-emption (`min(1, forager/living)`)
    cannot bite until farming has physically ARRIVED, which for a runner-up a
    thousand km away is far too late. No re-ranking closes these rows. What is
    missing is a reason marginal ground never completes the syndrome at all.

    **The suspect.** The normalisation itself. Dividing by the package's own
    maximum guarantees every crop has a cell at exactly 1.0, and therefore
    ignites somewhere at a year per year, however poor its best ground is
    globally — the law is structurally unable to say "not here". That
    normalisation is also what makes the catalogue lag mean what
    archaeobotany measured (the duration at the crop's BEST site), so it
    cannot simply be dropped: replacing it needs an absolute lag scale, and
    the grounding for one is not in the ledger. Owner's call, with P10 and
    contingency.

    **Bookkeeping.** Two acknowledgements in `known-misses-people.json` had
    gone stale — `population:-5000:solve:dev` (51.0M, inside its band) and
    `arrival:sahel:solve:dev` — and are removed. The gate now reports 9
    unacknowledged and 0 stale. The rest of the chain is green at this commit:
    lint, build, smoke, unit, kernel parity (both grids, all three regimes,
    byte-exact), the bench ratchet, the oracle, the Chromium browser smoke and
    the travel gate. W9-W11 remain undocumented in the ledger and in a handoff
    spec.

45. **The wild ranges carried the crops' own spread; WCVP screens it out
    (2026-09-04, owner: "yes" to re-baking the ranges).** A modern occurrence
    map of a cultivated plant, or of a weed of cultivation, is a map of where
    farming CARRIED it. Deciding where farming BEGAN from that map is
    circular, and it was measurably doing so.

    **What the screen could not be.** GBIF's per-record `establishmentMeans`
    is populated on 379 of taro's 19,550 records (1.9 %) — unusable. Taxon
    substitution alone does not work either: every candidate progenitor of a
    tropical root crop is itself a plant people carried, so swapping taro for
    greater yam moved the strays without removing them (16 -> 15). And rice
    cannot be split by name at all: `Oryza nivara` is a SYNONYM of
    `O. rufipogon` in the GBIF backbone, both returning the same 9,386
    records, so the annual northern-margin form Fuller identifies is not
    separately addressable.

    **What it is.** The World Checklist of Vascular Plants states native
    versus introduced range per taxon over the WGSRPD level-3 regions, and is
    published as a GBIF checklist dataset (`f382f0ce`). So: take WCVP's native
    regions for the taxon, take their polygons from the WGSRPD level-3
    geojson, and drop every occurrence outside them. Two details earn their
    keep — WCVP writes canonical names without the rank marker (the
    catalogue's `Zea mays subsp. parviglumis` is its `Zea mays parviglumis`),
    and distributions hang off the ACCEPTED name, so a synonym carries none
    and must be followed. Following it is guarded to never widen a rank: a
    wild subspecies whose accepted name is the crop species would import the
    CROP's range, which is the circularity the screen exists to remove. That
    guard fires on `Manihot esculenta subsp. flabellifolia`, which is
    correctly left unscreened.

    **What it removed.** 11 of 13 taxa screen (the other two carry no WCVP
    distribution). Greater yam 289 -> 26 Oceanian records, 91 % of them in its
    introduced range; wild einkorn 2,963 -> 1,513; wild sorghum 1,854 ->
    1,535; green foxtail 14,589 -> 12,940 and wild enset 367 -> 327, both
    about 11 % — those two ranges really are as wide as they looked.

    **What it bought.** Unacknowledged gate findings 9 -> 7, stray hearths
    16 -> 10. `hearth:kuk` clears: Kuk lights at -5500 inside its window,
    where before it never lit at all, because on WCVP's authority wild taro
    is native to mainland South and Southeast Asia and INTRODUCED to New
    Guinea — the package had been asking the model to domesticate a crop
    where its ancestor does not grow. `hearth-outside:new-guinea-roots`
    clears with it: Queensland, Fiji, New Caledonia and the Bismarcks are
    gone, and the package now holds no stray at all.

    **What it refuted.** Millet and enset are NOT contaminated — green foxtail
    really is native across 102 regions of temperate Eurasia (Kazakhstan
    included) and wild enset really is native across 14 from Ethiopia to
    South Africa. Their hearths are the model's problem, not the data's, and
    that is now established rather than assumed. Rice is unresolved by this
    route for the synonym reason above.

    **The dead end worth recording.** Yam plus wild sugarcane looked better on
    the gate (13 strays) and was dishonest: stand richness is the members'
    CO-OCCURRENCE, a product zeroed wherever any member is out of range, and
    `Saccharum robustum`'s 27 Oceanian records derive a range so small that
    the intersection was empty — the nine Kuk-area cells measured canGrow=1
    with climate fit 0.50-0.92 and richness EXACTLY 0. The package scored well
    by barely existing. Co-occurrence is right for a founder set gathered
    together (emmer with einkorn); yam and sugarcane are independent crops of
    one complex, and requiring both is a claim the archaeology does not make.

46. **The shipped grid is far less validated than the reference grid, and the
    New Guinea fix does not survive it (2026-09-04, owner: "keep iterating, do
    the full grid size sometimes for real diagnosing").** The people gate's
    target solve arm runs only under `GATE_PEOPLE_SOLVE_TARGET=1`, so nobody
    had looked at it since W9. Run: **20 unacknowledged findings at target
    against 7 at dev.** Nine of them fail at target while passing at dev —
    `arrival:fertile-crescent`, `arrival:indus`, `hearth:kuk`,
    `hearth:northwest-neotropics`, `hearth-outside:new-guinea-roots`,
    `staple:south-china`, `staple:lower-yangtze`, and both European arrivals.
    The third cardinal rule, measured: the reference grid was carrying an
    optimistic picture.

    **Kuk is one of them.** #45 reported Kuk lighting at -5500 in its window;
    that is the DEV arm. At the shipped grid it does not light at all, and the
    package's best ground is the Bismarck Archipelago — New Ireland at 1.000,
    Kuk seventh at 0.704. The cause is resolution, and it is measurable:
    forager capacity at Kuk, the Papuan lowland and New Ireland is 0.089 /
    0.101 / 0.099 at dev, three numbers within 14 % of each other, against
    0.030 / 0.053 / 0.272 at target, a 9x spread. At 167 km cells the model
    cannot tell a highland valley from a small island; at 22 km it can, and
    the island wins on shore access.

    **The widening that was tried and rejected.** Greater yam's screened set
    is 26 records in 11 cells, because the catalogue restricts it to Oceania —
    and the continent field is a crude proxy for the native-range screen, so
    where the screen applies the proxy is redundant and starves the fit. Yam
    is native from Assam to New Guinea, and Asia holds 1,791 of its records to
    Oceania's 289. Widening it to both continents gives 461 screened records
    in 139 cells and DOES fix the shipped grid: Kuk first at 1.000, lighting
    at -5549 in its window, `hearth:kuk:solve:target` clears.

    It was rejected anyway, because of what else it does: at target the
    package then takes six strays across Vietnam, Java, Timor, Cambodia,
    Thailand and the Philippines, and becomes the DOMINANT STAPLE of south
    China and the lower Yangtze — 809 and 815 farmed cells, displacing rice.
    Combined findings went 27 -> 30. Buying one hearth by turning a New Guinea
    root crop into a pan-Asian one that beats rice in China is a worse error
    than a missing hearth. Reverted; the Oceania restriction stands as an
    acknowledged crutch rather than a correct screen.

    **The pattern across three attempts, which is the real finding.** The
    dietary-share gate (#44) fixed the site RANK and lost on SPREAD. Yam at
    Oceania fixed DEV and lost at TARGET. Yam at Asia+Oceania fixed TARGET and
    lost at DEV, and lost China with it. Every change of the data or of the
    score has RELOCATED the failures rather than reduced them, and that is
    what a missing absolute bar looks like: normalising site quality to each
    package's own maximum guarantees every crop ignites somewhere at a year
    per year, and near-best ground ignites soon after, so whichever ground
    happens to score highest is where the hearth goes. Until the law can say
    "not here", moving the scores only moves the hearths. That is the
    normalisation ruling from #44, now with three independent measurements
    behind it.

    **Also measured.** The world never cages at the shipped grid — `cagedYear`
    is null across the whole horizon at target, against -1972 at dev — so the
    W5 wake trigger review is not a dev curiosity: at the grid that ships, the
    auto wake would never fire at all.

47. **No absolute bar can work: the score is INVERTED against the real centres
    (2026-09-04, owner: "we are on an accurate earth map? With a real bar,
    they should get domesticated perfectly").** The owner's constraint is the
    right one and it is stronger than the proposal it was aimed at. On an
    accurate Earth, the ten cited centres really did domesticate their crops,
    so a correct score must pass every one of them AND reject every place the
    sim lights wrongly. That is a two-sided test, it is static, and it settles
    a mechanism before anyone builds it. `tools/hearth-separation.ts` runs it.

    **CORRECTION (same day, owner: "Are you checking ACROSS the crops?").**
    Yes, and for the headline claim that was invalid — see #48. The
    cross-crop comparison below is not meaningful, because a wild manioc
    stand in the Amazon really does feed far more people per km2 than wild
    wheat in the Levant: tropical root crops outyield temperate grasses, and
    that is biology, not a defect. Read the numbers WITHIN each crop instead.
    The per-package normalisation is therefore CORRECT — it is the right way
    to handle quantities that are genuinely incomparable — and the fault is
    four packages, not the whole score.

    **The proposed absolute bar is dead** for one crop against another, which
    is all the paragraph below establishes. Stand capacity at the real centres,
    at the SHIPPED grid: Yangtze 0.0001, Sahel 0.0011, Fertile Crescent
    0.0023, Ethiopia 0.0728, eastern woodlands 0.0755, Kuk 0.1271, Balsas
    0.1311, north China 0.2789, northwest Neotropics 0.3226, Amazon margin
    0.9309. Four orders of magnitude. At the false hearths: N Kazakhstan
    0.0451, Caucasus 0.0499, Korea 0.0765, Kazakh steppe 0.1363, New Ireland
    0.1577, Kenya 0.2405, Angola 0.3518, Venezuela 0.3592, NE Brazil 0.3920,
    Bengal 0.4558, Andhra 0.4800.

    Every false positive scores ABOVE the Fertile Crescent, the Yangtze and
    the Sahel — the three most important cereal centres in world history sit
    at the bottom of the map by the model's own measure. Any bar low enough to
    admit the Yangtze admits everything; any bar high enough to reject
    Kazakhstan rejects the Levant. The farming gain is no better: the Fertile
    Crescent has the LOWEST gain of all ten centres (0.4063 at dev), against
    Bengal 4.70 and Andhra 6.16. Both hold at both grids.

    **Which reframes the normalisation.** Dividing by each package's own
    maximum is not merely a flaw that forbids the law from saying "not here";
    it is the ONLY reason anything lands right, because it compares like with
    like inside one crop and so never exposes that the underlying quantity is
    incomparable across crops. Remove it without replacing the quantity and
    everything collapses. That is why #44's and #46's changes only ever
    relocated failures.

    **The seasonality hypothesis is refuted too, on the same test.** The
    forager capacity is built from ANNUAL fertility, disease and relief and
    carries no monthly term, so the model has no hungry season at all — which
    made "storage pays only where the year has a lean season" the obvious
    candidate. Measured with a generic monthly warmth-times-water index, the
    lean fraction at the real centres runs 0.512-0.949 and at the false ones
    0.316-0.951: fully overlapping, and inverted where it matters — Bengal
    0.943 against the Yangtze 0.820, the Congo 0.925 against Ethiopia 0.829,
    Angola 0.951 the highest reading on the board. Monsoon lands are intensely
    seasonal. (#44 recorded this hypothesis as untested because the first
    probe was degenerate; it is now tested, and false.)

    **So three quantities are eliminated, and the crux is a question for the
    owner.** Either there is a local environmental signature of domestication
    that has not been found — candidates worth the same cheap test are
    continuity and absolute density of occupation rather than saturation
    (`fill` measures how full the land is, not how many people stand on it),
    and ecotone or marginal-zone position, the Levant at the desert edge, the
    Yangtze at the wetland-upland edge, the Balsas in dry tropical forest —
    or domestication was substantially CONTINGENT, in which case Earth's exact
    ten centres are not derivable from local rules at all and the honest
    target is about ten centres in plausible places, with the first to fire
    pre-empting its neighbours. Bengal has wild rice, good ground and no
    independent domestication; it took rice from the Yangtze. That may be
    history rather than habitat. The ruling decides whether the next wave
    hunts a discriminator or builds a hazard.

48. **Checking within each crop, not across: only four packages are inverted
    (2026-09-04, owner: "Why do they rank badly? Are you checking ACROSS the
    crops?").** The second question is the correction. #47's headline — "every
    false positive scores above the Fertile Crescent, the Yangtze and the
    Sahel" — set a wheat number beside a rice number beside a manioc number,
    and those are not comparable quantities. Wild manioc in the Amazon feeds
    far more people per km2 than wild wheat in the Levant because tropical
    root crops outyield temperate grasses. Nothing follows from the
    comparison.

    Read WITHIN each crop, at the shipped grid, best stand capacity at the
    cited centre against the best at any false hearth of the SAME package:

    - wheat: Crescent 0.0023, no false hearth at all — clean.
    - millet: north China **0.2789** against the Kazakh steppe 0.1363, Korea
      0.0765, Caucasus 0.0499, N Kazakhstan 0.0451 — north China WINS. Not
      inverted at the shipped grid.
    - maize, sorghum, eastern seeds: no false hearth — clean.
    - rice: Yangtze **0.0001** against Bengal 0.4558 and Andhra 0.4800 —
      inverted by four orders of magnitude.
    - enset: Ethiopia **0.0728** against Angola 0.3518 and Kenya 0.2405 —
      inverted ~5x.
    - manioc: northwest Neotropics **0.3226** against NE Brazil 0.3920 and
      Venezuela 0.3592 — inverted narrowly (the Amazon margin, 0.9309, is
      itself clean).
    - yam: Kuk **0.1271** against New Ireland 0.1577 — inverted narrowly.

    Five of nine packages are correct within their own crop; four are
    inverted, and they are exactly the four that fail the gate. So the
    per-package normalisation is not the hack #47 called it — it is the
    correct treatment of incomparable units, and #44's and #46's failures are
    not evidence against it. The defect is four crops wide, not global.

    **Why those four rank badly.** The cited centre sits at the EDGE of its
    crop's range while the false hearths sit in its heartland. Measured as the
    crop's own climate fit: Yangtze 0.281 against Bengal 0.466 and Andhra
    0.470 — the Yangtze is the cold northern limit of wild rice, which is
    exactly why Fuller identifies the northern-margin form as the progenitor.
    Kuk 0.748 against New Ireland 0.770; northwest Neotropics 0.750 against
    Venezuela 0.905. The score rewards wherever the plant grows BEST, and
    farming did not begin where gathering was easiest.

    Enset is the exception that keeps the question open: Ethiopia has the
    HIGHEST fit of its package (0.517 against Kenya 0.489 and Angola 0.470)
    and still loses on stand, so its miss is in the richness term — the
    envelope fitted across enset's whole observed range, with Ethiopia off its
    centre — not in a margin effect. Any candidate mechanism must be run
    through `tools/hearth-separation.ts` WITHIN crop before it is built.

49. **Two axes, not one: the alternative-food term (2026-09-04, owner: "so you
    are saying that the ideal domestication land is a thin strip IN BETWEEN
    high fertility and low crop yield?").** Half right, and the half that is
    right is structural. Not a strip: crop fit at the correct centres runs
    0.281 (Yangtze) to 0.755 (Sahel, the highest reading on the board) and
    both are right, so there is no middling band on crop quality. The pattern
    is a CORNER — the crop is worth having AND there is little else to eat.

    Measured at the shipped grid, ALT = forager capacity minus this crop's own
    stand, the food available that is not this crop:

    - rice: Yangtze **0.047** against Bengal 0.243 and Andhra 0.260 — five
      times less. The delta full of fish, exactly.
    - enset: Ethiopia **0.061** against Kenya 0.083 and Angola 0.089 — lowest
      of its crop, and this is the case that REFUTED #48's margin story
      (Ethiopia has the best fit of its package and still loses on stand). ALT
      explains it where fit could not.
    - yam: Kuk 0.273 against New Ireland 0.272 — no separation at all.
    - manioc: northwest Neotropics 0.285 against Venezuela 0.144 — backwards.

    Two of the four broken packages, including the awkward one. As a combined
    rule (gain over ALT) it would BREAK millet, which currently works: north
    China 7.2 against N Kazakhstan 10.6. So it is an ingredient, not the
    recipe, and it must not be applied as a single ratio.

    **The structural point stands on its own merits.** `_foragerCapacity`
    has the cell's richest stand summed into it (`applyWildStands`) and
    `gain = packageCapacityAt(...) - foragerCapacity`, so food-from-this-crop
    is inside total-food-available and the payoff subtracts one from the
    other. A cell therefore CANNOT be good for the crop and poor in
    alternatives — the model has one axis where reality has two, and every
    quantity tested so far (stand, gain, lean, fit) is a projection of that
    single axis. Separating them is worth doing whether or not it fixes all
    four crops; the affluent-forager resistance W8 aimed at cannot exist until
    it is done.

50. **Separating the axes works, and proves the tightness must come from
    somewhere else (2026-09-04, owner: "yes" to separating them).** The
    harness now evaluates candidate SCORES within crop, and measures both
    properties a hearth score needs: does it SEPARATE (the real centre
    outscores every false hearth of the same crop) and how far does it SPREAD
    (with the bar at the lowest level that rejects those false hearths, how
    many cells of the package still clear it — each one a hearth waiting to
    light). #44 measured only the first and that is why it failed.

    **The separated form wins on separation, at both grids.** `gain / alt` —
    what farming adds over the fallback, divided by the food that is not this
    crop — separates 4 of 5 at dev and 4 of 5 at target, against the current
    `stand x gain` at 1 of 5 and 2 of 5. No other candidate of eleven reaches
    4. It is dimensionless, and it means something on its own: the advantage
    of farming measured against the outside option.

    **And it floods.** 149 cells above the bar at dev, 440 at target, against
    5-9 and 45-133 for every stand-bearing form. Putting stand back in trades
    the separation away, smoothly, along one dial (dev): exponent 1 gives 2/5
    and 7 cells, 0.5 gives 2/5 and 15, 0.25 gives 2/5 and 41, 0 gives 4/5 and
    149. Eleven candidates, both grids, no exception.

    **So the two properties are mutually exclusive in the quantities the model
    has.** `stand` is the ONLY term that concentrates hearths spatially, and
    it is also the term that pulls them into the crop's heartland, which is
    what breaks the separation. There is no function of stand, gain, forager,
    alt, lean and fit that both picks the right places and keeps the count
    down, because the information is not there.

    **Which settles the design.** The score's job is to SEPARATE, and
    `gain / alt` does it. Tightness cannot come from the score being spatially
    peaked, so it has to come from ignition being a DRAW: a hazard rate rather
    than a countdown, one winner among the candidates above the bar, and
    pre-emption for the rest. The 440 cells stop being 440 hearths and become
    440 tickets. That is the contingency item on the owner's open list, and it
    is now load-bearing rather than optional — the axis separation cannot ship
    without it. Owner's ruling.

51. **The separated score works in the live sim; the draw's SCALE is not
    determined by anything in the ledger (2026-09-04, owner: "go" to building
    both).** Built and measured at both grids. Reverted, with the bracketing
    recorded — it is the useful part.

    **The score half is confirmed in the sim, not just in the harness.** With
    `gain / alternatives` in place of `stand x gain`, centres that had NEVER
    lit at either grid lit: Ethiopia, Kuk, north China, the Amazon margin and
    the northwest Neotropics. That is the separation working end to end, and
    it is the first thing all session to move those rows at all.

    **The draw's scale is the unsolved part, and it brackets hard.**

    - Per CELL (`chance = rate x dt / lag`): 73 hearths at dev, 113 at target.
      Every centre ignites within a century or two of the horizon opening —
      north China -9189, Kuk -9448, the Amazon -9623 against an opening near
      -9700. With N candidate cells the first of them fires after lag/N, and N
      is in the hundreds. Findings 27 -> 47.
    - Per RANGE, split by area: 9 hearths at dev, 8 at target; north China,
      Kuk, the Amazon, the Balsas, the Yangtze and the northwest Neotropics
      never light at all. Findings 27 -> 37.
    - Per RANGE, split by site x area (so good ground carries the
      probability rather than the range's mean): essentially unchanged, 9 and
      8 hearths. Findings 27 -> 38.

    Two orders of magnitude between the two formulations, and neither has a
    free parameter — the first divides by nothing, the second by the whole
    range. The answer is between them, and the thing that sets it is the
    number of INDEPENDENT ATTEMPTS a range carries, which is neither 1 nor the
    cell count. Physically it is the number of human groups working the stand,
    people over band size — but the archaeobotanical lag is the observed
    DURATION OF A PROCESS in a region, not one band's expected wait, so it
    cannot calibrate a per-band hazard. Nothing in the ledger fixes the scale.

    **Which is where it has to stop.** Choosing the scale by trying values
    until the hearth count looks right is fitting the outcome, and the count
    it would be fitted to (about ten centres on Earth) is exactly the
    published answer the simulation is supposed to predict. That is the second
    cardinal rule, so the constant needs grounding from outside the gate —
    a band size and a per-band rate, or a different formulation of the wait —
    and that is the owner's ruling. The score change is ready to land the
    moment the draw has a scale; it cannot land without one, because on its
    own it floods (QUESTIONS #50).

52. **The draw's scale brackets to between one cell and one basin, and the
    LAG is probably the reason it will not calibrate (2026-09-04, owner: "go"
    to trying the reformulation once).** Tried, failed, reverted. Fourth
    attempt at the same constant; recording the bracket and stopping.

    The basin is the model's own unit of one peopled catchment, defined in km
    and therefore grid-invariant, so splitting the draw by each cell's share
    of a basin looked like the missing middle with no free parameter. It is
    the middle, and it is still too slow: 13 hearths at dev and 7 at target,
    the Fertile Crescent dark at the shipped grid, findings 27 -> 48.

    The four formulations, all constant-free, in order of the hazard they give:

    | split by | hearths dev/target | findings |
    | --- | --- | --- |
    | cell | 73 / 113 | 47 |
    | basin (1000 km square) | 13 / 7 | 48 |
    | range, by area | 9 / 8 | 37 |
    | range, by site x area | 9 / 8 | 38 |

    Per cell is far too fast and per basin already too slow, so the answer
    sits between them — between one catchment and one grid cell, which is not
    a unit anything in the model means.

    **The likely reason it will not calibrate, which is worth more than the
    bracket.** `domLagY` is the archaeobotanical duration from CULTIVATION to
    a farmable staple. The model spends it from the moment CONDITIONS ARE
    RIGHT to a farmable staple. Those are not the same interval and the first
    is the tail of the second: people cultivated wild stands for a long time
    before any of it took, and the published lag measures only the part after
    it took. Using the tail as the whole is what forces the draw's scale to
    absorb the difference, and no split of a wrongly-measured wait will
    calibrate. Fixing it needs a second duration — how long from conditions
    to the first persistent cultivation — which the catalogue does not carry
    and which is the ruling. Until then the score change (#50, #51) is
    complete and correct and cannot ship, because its tightness depends on
    this draw.

    Per the owner's own fallback for this attempt, hearths are set down for
    the session and the target-grid failures (#46) are the next work.

53. **~~The target-only arrival failures are one cause: east of the Zagros the
    viable ground is disconnected islands~~ WITHDRAWN — see #54. The corridor
    is not broken; this was built on point samples that landed in desert
    beside a passable route (2026-09-04).** Nine findings fail at the shipped grid while passing
    at dev (#46). The arrivals among them have a single mechanism, and it is
    measurable statically — no run needed.

    **What the shipped grid does.** Farming NEVER reaches the Indus or the
    Ganges (`year: null` at target, against -4156 and -3288 at dev), and yet
    reaches south India at -5479 and Japan at -3603, both far too early and
    both ahead of the Indus that ought to precede them. Ordering that
    backwards is the signature of a SEA route arriving while the LAND route is
    shut: `PEOPLE_COASTAL_HOP_KM` is 100 km, which is under one cell at dev
    and four and a half at target, so coastal hopping barely exists at the
    reference grid and works well at the shipped one.

    **Why the land route is shut.** Walking the corridor the Neolithic
    actually used — Zagros piedmont, northern Iranian foothills, Mehrgarh —
    and asking at each step whether farming beats foraging (`packageCapacity >
    foragerCapacity`, the front's own precondition), at target:

    | | Crescent | N Jazira | Zagros | Kermanshah | C Zagros | Tehran | Semnan | Khorasan | Herat | Helmand | Mehrgarh | Indus |
    | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
    | beats foraging | YES | YES | YES | YES | YES | YES | **no** | **no** | YES | YES | **no** | **no** |

    The front reaches Tehran and stops. Herat and Helmand are viable and
    UNREACHABLE — islands behind 350 km of ground where farming loses. The
    southern line is worse: Fars, Kerman, Baluchistan and Bolan are all "no"
    at target where Fars and Bolan are "YES" at dev, which is the route dev
    actually uses to reach the Indus.

    **So it is the 1-D water gap, again.** The corridors that carried farming
    east are threads: piedmont alluvial fans fed by mountain runoff (the
    Kopet Dag strip that carried Jeitun), oases, the Bolan fan into Mehrgarh.
    `waterAccess` reads 0.019-0.020 — the floor — at every blocked step, so
    the model has no piedmont water at all. At 167 km cells the averaging
    invents stepping stones and the front crosses; at 22 km the arid ground
    is honestly arid and it cannot. The third cardinal rule says the fine grid
    is the truth, so the honest reading is that the model is RIGHT that dry
    farming cannot cross Iran, and is missing the thread of water that in fact
    let it. Same family as `arrival:nile` (measured: wheat grows the whole way
    to Aswan, fit 0.060-0.081 across Sinai against 0.156 at Cairo — passable
    but so thin the front crawls, 4,500 years) and as the documented
    ~1.3-2.2x capacity dilution from 1-D coast and river terms.

    **What it is not.** Not the dev-grid straits class, not the hearth law,
    and not resolution noise: four consecutive blocked steps on both candidate
    routes. It is a missing term — water the land gives a cell from the relief
    above it, not from a channel resolved inside it — and it should be scoped
    as one, because it also owns the Nile row and part of the European
    arrivals.

54. **Correction: nothing is blocked, the front is too SLOW (2026-09-04).**
    #53 claimed the viable ground east of the Zagros is disconnected islands
    and that Herat and Helmand are unreachable. That is false, and the error
    was method: I sampled a dozen points along a route and read the gaps
    between them as a barrier. A flood fill answers it properly — from the
    Crescent hearth over land where farming beats foraging (the front's own
    precondition), 8-connected, at the SHIPPED grid:

    | region | cells in box | viable | reached by land |
    | --- | --- | --- | --- |
    | fertile-crescent | 900 | 213 | 204 |
    | indus | 900 | **143** | **140** |
    | ganges | 900 | **900** | **900** |
    | south-india | 816 | 500 | 495 |
    | nile | 599 | **49** | **10** |
    | yellow-river | 900 | 900 | 900 |

    The Indus and the Ganges are connected and viable, and the fill runs from
    the Crescent to 144E. Herat and Helmand are reached. The corridor is open.

    **So the null arrivals are a SPEED failure.** `arrival:indus` and
    `arrival:ganges` are null at target over ground the front could stand on
    the whole way. Crescent to Indus is roughly 2,500 km and the measured
    front runs about 1 km/yr, which would arrive near -5200 from a -7761
    hearth — but the front's rate scales with capacity, and two thousand km of
    that line is marginal ground where the rate is a fraction of it. The front
    does not stop, it crawls. That is P15, the frontier growth rate, already
    an open ruling.

    **The Nile is the exception and is genuinely constrained.** Only 49 of its
    599 cells are viable and only 10 reachable by land — a 2 % thread. So
    `arrival:nile` is a real bottleneck rather than a speed failure, and the
    Sinai measurements in #53 stand (wheat grows the whole way to Aswan at fit
    0.060-0.081 against 0.156 at Cairo).

    **And the piedmont-water fix proposed in #53 is refuted before building.**
    `flowAccum` does not separate passable from impassable ground — Fars is
    impassable with 1.5, Herat passable with 0.1 — and river magnitude is 0 at
    every point on the corridor, passing and blocked alike. What separates the
    sampled points is plain rainfall, every passing one >= 0.041 and every
    blocked one 0.019-0.021, which is just the difference between steppe and
    desert, correctly modelled. There is no missing water term here.

    **The method lesson, which is the durable part.** For "can a front cross
    this?", fill from the source; never sample the route. Point samples cannot
    distinguish a barrier from a gap beside a corridor, and they read as
    evidence because each one is individually true.

55. **Europe is late because the front delivers 41 % less than its own
    constants predict — and no constant can fix it (2026-09-04, owner: "so
    surely if it is half speed, everywhere, we just double the speed?").**

    **Europe, measured at the shipped grid.** Balkans -5178 against a -6000
    latest (822 yr late), Cardial coast -4289 against -5500 (1,211), inland
    Europe -3862 against -4800 (938), central Europe -3099 against -5000
    (1,901), Rhine -2301 against -4800 (2,499). The lateness grows with
    distance from the Levant, which is a front too slow rather than anything
    local to Europe, and the implied speed on every overland route is
    0.49-0.52 km/yr.

    **The gate already measures it: 1.077 km/yr at dev, 0.553 at target.**

    **And the ledger already predicts what it should be.** The M3a row for
    `PEOPLE_ADOPTION_RATE_PER_YEAR` states the design: the front runs at
    `2*sqrt((r + rate)*D)`. With the shipped constants — farmer growth 0.46
    %/yr, adoption 0.01/yr, farmer mobility 15 km2/yr — that is **0.936
    km/yr**, inside the cited Pinhasi-Fort-Ammerman band of 0.6-1.3. The
    shipped grid delivers 0.553: **41 % under its own design, and below the
    band's floor.**

    **So raising the mobility is not available, for a measured reason rather
    than a principled one.** Speed goes as the square root, so doubling it
    means QUADRUPLING a constant cited from Ammerman & Cavalli-Sforza, whose
    own wave of advance is the ~1 km/yr being chased. Worse, dev already
    measures 1.077, ABOVE design: quadrupling D puts dev near 2.15 km/yr,
    twice the real wave and far outside the band. The discrepancy has
    OPPOSITE SIGNS at the two grids, so no value of the constant satisfies
    both. That is proof the defect is in the mechanism.

    **Where the 41 % might be going.** Candidates, none yet tested: the front
    cells never reaching the fill the Fisher form assumes (it wants the growth
    and adoption rates at the leading edge, and both are throttled by room and
    contact terms); the adoption term damped by the forager/living pre-emption
    it shares with the hearth law; and the 84-month movement stride quantising
    an advance the continuum form treats as smooth. The target is explicit —
    0.936 predicted against 0.553 measured — which makes this a bug hunt
    rather than a tuning question, and it owns Europe, the null Indus and
    Ganges arrivals, and the grid dependence together.

56. **Found it: a lattice hop is not a diffusivity (2026-09-04, owner: "yes"
    to going and finding the missing 41 %).** The migration pass moved a
    fraction `D * dt / area` of a cell's people one hop per firing. Moving a
    fraction `s` one hop per unit time delivers a diffusion coefficient of
    `s * <d^2> / 4`, because two-dimensional diffusion spreads as
    `<r^2> = 4Dt`. To deliver the diffusivity the constant NAMES, the share
    must be `4 * D * dt / <d^2>`, and `<d^2>` is not the cell area: a hop
    lands on one of eight neighbours, two at the row's east-west spacing, two
    at the north-south spacing, four on the diagonal, so
    `<d^2> = 0.75 * (h_ew^2 + h_ns^2)` — one and a half times the area on a
    square cell, and more toward the poles where cells narrow but keep their
    height. The share was therefore short by `4 * area / <d^2>`, a factor of
    2.67 at the equator.

    Both terms are mathematics, not tuning: `DIFFUSION_MSD_PER_DIFFUSIVITY`
    is the 4 of `<r^2> = 4Dt`, and `MIGRATION_HOP_MEAN_SQUARE_WEIGHT` is the
    stencil mean `(2 + 2 + 4*2)/8`. No constant was re-grounded and the
    Ammerman & Cavalli-Sforza mobility is untouched.

    **Measured, at both grids.** Front speed 0.553 -> **0.670 km/yr** at the
    shipped grid, inside the cited Pinhasi-Fort-Ammerman band of 0.6-1.3 for
    the first time; 1.077 -> 1.420 at dev. Findings **27 -> 24**. Cleared:
    `arrival:balkans:target`, `arrival:cardial-coast:target`,
    `arrival:inland-europe` at BOTH grids, `staple:indus:target`,
    `staple:south-china:target`. Three new: `arrival:ganges:dev`,
    `arrival:sahel:dev` and `europe-front-speed:dev` — dev now runs FAST,
    which is the coarse lattice being flattered in the other direction and
    belongs with the other dev-raster rows.

    **What it did not do.** The gain is smaller than the 2.67 implies,
    because at a 7-year stride the raw share now exceeds
    `PEOPLE_MIGRATION_MAX_SHARE` and the substep machinery saturates it: the
    delivered ratio is about 2.3, and the front gained 21 % rather than the
    63 % the factor alone predicts. The explicit-diffusion bound is now the
    binding constraint on the front at the shipped grid, which is a real
    finding for the movement stride and is where the remaining shortfall to
    the 0.936 design lives.

    **The footgun that was removed with it.** The height argument is
    REQUIRED, not defaulted. The first draft defaulted it and silently kept
    the old area path for any caller that omitted it — which the unit test
    promptly did, asserting the buggy value and passing. A default that
    preserves a bug is worse than a compile error.

57. **The solve stride is set by three Arctic cells holding 25 people, and I
    could not find a threshold-free way to ignore them (2026-09-04, owner:
    "do it" — the polar-cell stride bound).** Measured, not fixed. I told the
    owner this was contained and needed no ruling from them; that was wrong,
    and this entry is the correction.

    **What binds.** `resolveSolveStride` takes the MINIMUM bound over every
    peopled or can-grow row. At the shipped grid the tightest peopled row is
    row 31, 83.7 N — the tip of Ellesmere — with **three land cells and 25
    people out of 4.37 million, 0.0006 % of the world.** It sets 24.5 months.
    The tightest can-grow row is row 866, 83.3 S: 1,800 land cells of
    Antarctica with **zero people**, setting 24.6 months. The whole
    simulation's step is decided by ground nobody lives on.

    **Why the obvious escapes do not work.**

    - *Substep the tight rows.* Substepping the PASS at dt/N costs exactly
      what a shorter stride costs, and rows are coupled north-south so a row
      cannot be substepped alone. It collapses to the thing it was meant to
      avoid.
    - *Bound only where crops grow.* The tightest can-grow row is Antarctica,
      so this changes nothing — and it surfaces a separate defect worth its
      own look: some package reports `canGrow` across Antarctic rows.
      (Sampled mid-row, no package grows; the true cell is somewhere on that
      latitude, and the substrate's temperature field there reads 0.02-0.40
      in its normalised units rather than anything like polar cold.)
    - *Use the representation floor.* `PEOPLE_CAPACITY_FLOOR_PER_KM2` is
      0.001/km2 and row 31 carries 0.156/km2 — a hundred and fifty times the
      floor. The floor does not exclude it.
    - *Floor the mean square hop at the north-south spacing.* It already is
      dominated by it: `<d^2> = 0.75*(h_ew^2 + h_ns^2)` only falls from 745
      km2 at the equator to 373 at the pole, a factor of two, which is
      exactly the 48 -> 24 month gap. There is no headroom to reclaim.

    **So the honest position.** The bound is real: the explicit scheme genuinely
    is inaccurate on those rows at a longer stride. Uniform accuracy costs
    3.5x on the shipped grid, and the payoff — the front's remaining gap from
    0.670 to its 0.936 design — is unmeasured. The options are (1) pay it,
    (2) leave the front slow, or (3) fix the grid's polar over-resolution
    properly, by merging cells east-west near the poles so their physical
    width stays bounded. Only (3) is a real fix, and it is a substrate change
    well beyond this wave. Owner's call, which is what I should have said
    before starting.

58. **There is no cheap version: the stride bound falls smoothly with
    latitude, so any budget big enough to help costs most of the world
    (2026-09-04, owner: "cheap for now").** Measured before building, which is
    the only reason it was not built.

    **First, a correction to #57.** The stride bound is NOT a safety
    requirement. `migrationShareForArea` already clamps at
    `PEOPLE_MIGRATION_MAX_SHARE` on its last line, so the scheme is stable at
    any stride; when the clamp bites those cells merely under-mix. The stride
    bound is an ACCURACY BUDGET, not a stability one — which is what made an
    explicit budget look defensible rather than a fudge.

    **And the budget is unaffordable.** The bound is
    `0.5 * <d^2> / (4 * D)` and `<d^2> = 0.75*(h_ew^2 + h_ns^2)` with
    `h_ew = h_ns * cos(lat)`, so it falls SMOOTHLY from the equator poleward —
    there is no cliff at the Arctic to cut against. At the shipped grid, the
    share of world population whose movement you must give up to reach each
    stride:

    | stride | population given up | rows | poleward of |
    | ---: | ---: | ---: | ---: |
    | 25 months | 0.46 % | 20 | 79.9 deg |
    | 28 months | 6.09 % | 85 | 66.9 deg |
    | 30 months | 11.30 % | 115 | 60.9 deg |
    | 36 months | 28.49 % | 240 | 45.9 deg |
    | 48 months | **89.39 %** | 624 | 7.5 deg |

    The 24-month bound really is set by three Arctic cells, but excluding them
    buys 0.5 months. Reaching the 48 months I quoted as "half the cost" would
    mean under-mixing 89 % of humanity — everything outside the tropics. The
    smooth falloff is the whole difficulty: any cut deep enough to matter cuts
    through Europe and north China.

    **So the structural fix is the only one, and it is now well-motivated.**
    Merge cells east-west near the poles so their physical width stays near
    the north-south spacing. Then `h_ew ~ h_ns` at every latitude, `<d^2>` is
    uniform, and the bound is ~48 months EVERYWHERE with no accuracy given up
    anywhere — it removes the problem rather than trading against it, and it
    is the same over-resolution that is the prime suspect for the Antarctic
    can-grow oddity. A substrate change, and the right next wave for the front.
