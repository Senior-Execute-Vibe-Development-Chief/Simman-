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
    where the same tools took 21 min on CI. CI wall time after:
    {{CI_AFTER}}.

    What is left on the path is the target substrate build, about 41 s per
    tool and rebuilt by every tool (parity, smoke, both gates, bench,
    oracle), and world creation at the target grid, 12 s. A content-keyed
    on-disk substrate cache would take both to under a second locally; in
    CI the restore of a ~400 MB artefact costs about what the build does,
    so it is a local-loop gain first.
