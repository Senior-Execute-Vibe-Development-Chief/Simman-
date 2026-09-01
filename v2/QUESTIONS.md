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
