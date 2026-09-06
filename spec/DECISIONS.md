# v2 — Ratified owner decisions

A running log of design rulings for the v2 rebuild. Each entry is binding on
the spec suite unless a later entry supersedes it. Dates are ratification
dates; wording of the ruling is the owner's intent, not a paraphrase to be
lawyered.

## 2026-08-31 — Phase 1 charter round

1. **Identity: plausible alternate Earth.** The sim produces plausible
   alternate Earth histories, NOT a rerun of real history. This is the
   product's differentiator from other history sims. Reality is the
   statistical benchmark, never a script or rails.

2. **Exogenous forcings: stochastic from realistic hazard maps.** Volcanic
   winters, climate excursions etc. are drawn stochastically from
   real-hazard-calibrated distributions. An optional "historical forcing
   track" toggle (real eruptions at their real dates) is permitted —
   forcings are physics inputs, not behavior gates, so the toggle does not
   violate the emergence rule.

3. **Phase 1 timeline: end of the Younger Dryas → early modern.** The end
   is defined in development terms (ocean navigation, print, gunpowder,
   proto-state administration), never as a date. Industrial and speculative-
   future eras are later phases, planned for — Phase 1's ledgers must not
   architecturally preclude them (see the organic-energy seam in the
   economy spec).

4. **No player in Phase 1.** Phase 1 is the pure simulator: observe, zoom,
   inspect, share. Player agency is a later phase.

5. **Mechanism budget + reality calibration.** The mechanism-budget
   guardrail is accepted (few conserved-quantity mechanisms per vertical;
   every constant carries a unit and a citation). Additionally, owner
   directive: **ALL systems must be calibrated against the most realistic
   dataset we have — real life. Numbers must match real life; that is what
   we diagnose AGAINST.** Every subsystem ships with a reality table (the
   historical dataset and the statistics it must reproduce), and the
   validation suite diagnoses against those tables.

6. **Political ontology: no nation-state assumption.** Owner directive:
   v1 over-focused on collective "nations" as the unit. Historically,
   "countries" were not the staple — local lords, city-states, leagues,
   and cultural umbrellas ("Greece" over hundreds of poleis) were. v2's
   political model must be built with this in mind: political authority is
   modeled at the scale history actually had (centers, obligations,
   gradients of control), and the territorially exclusive modern state must
   be an emergent late outcome, not the built-in unit.

7. **Micro-founded power.** (Ratified through the brainstorm arc of
   2026-08-31.) The authority layer is derived from first principles — the
   seven primitives of `05-politics.md` (appropriable surplus, coercion as a
   fed stock, exit, the extraction bargain, legitimacy, monitoring cost,
   war economics) — with the recursion-up-scale model amended by the
   accepted critiques: a strong state is chain-*breaking* (bureaucratization),
   not a taller chain; "organisation" is an institution portfolio, never a
   scalar; the obligation graph is not a tree (peer edges, leagues,
   cross-cutting charters); urbanization and state formation are coupled
   but distinct processes.

## 2026-08-31 — Knowledge & technology round

8. **Techniques live in practitioners.** (All four sub-rulings ratified.)
   a. Knowledge is carried by practitioner pools (the goods economy's labor
      shares), practiced, transmitted person-to-person, and mortal — never
      an abstract civilization-level stat. Complexity sustainable scales
      with the connected carrier population (the Tasmania principle).
   b. The institution catalog (05.5) merges into this system as the
      administration domain — institutions are techniques whose
      practitioners are scribes and officials. One mechanism.
   c. Awareness vs mastery: knowing-of a technique diffuses easily;
      proficiency must be rebuilt locally through practice or imported
      carriers.
   d. Blocking (guilds, elites suppressing threatening techniques) runs at
      full historical strength in Phase 1.
   Spec: `11-knowledge.md`.

## 2026-08-31 — Zoom experience round

9. **The living zoom.** (All four sub-rulings ratified.)
   a. **Persistent micro-genealogy**: rendered people/families derive from
      deterministic per-site streams aged by real local demography —
      persistent across visits, consistent with recorded history (famines
      grow graveyards). A pure derived layer; never sim state.
   b. **The no-lies rule**: every rendered detail traces to sim state; one
      escape hatch — cosmetic-but-derived (e.g. daily weather elaborated
      deterministically from monthly truth + harvest-year anomaly); pure
      invention forbidden; where the sim is silent the renderer is quiet.
   c. **Day/night cycle included**, flagged cosmetic.
   d. **Scope**: spec fully now; street-level band builds later, trailing
      the milestones (valley-level "alive" ships first). Never blocks the
      sim.
   Spec: `12-zoom.md`.

## 2026-08-31 — War round

10. **War in the concrete.** (All four sub-rulings ratified.)
    a. **Armies are entities** — moving, supplied columns on the travel
       field (foraging real fields, carrying days of food, following
       water). Fronts are abolished.
    b. **Devastation is the default strategic act**, writing into
       food/works/grievance books; wars can be decided with no territory
       changing hands.
    c. **Wars end by assessment convergence** — fighting reveals strength;
       settlements formalize beliefs as obligation edges (tribute/vassalage
       the norm, annexation the exception).
    d. **Mercenary market and siege reputation** both in Phase 1.
    Spec: `13-war.md`.

## 2026-08-31 — Discovery & colonization round

11. **The known world.** (All four sub-rulings ratified.)
    a. **Geographic knowledge is a real system** (coarse per-tradition
       known-world frontiers; exploration = demand-driven frontier
       pushing; pilots as carriers, charts as writing-domain artifacts).
       Owner addition: the **mappa mundi lens** — view the world as a
       given city/tradition believes it: high-fidelity known coasts,
       warped speculative far shores (warp derived from actual report
       quality), fog at the edge of knowledge.
    b. **Colony types are strictly emergent** from disease burden × native
       density/organization × profitability — never a typed choice
       (trading post / settler / extraction / protectorate as outcomes).
    c. **Isolation by physics**: Old/New World contact waits for real
       blue-water capability, every seed — early, late, or reversed
       contact are legitimate alternate Earths.
    d. **Port v1's validated colonial arc** (charters, colonial economy,
       independence when local capacity outgrows projected metropole
       force) onto the obligation-graph substrate.
    Spec: `14-discovery.md`.

## 2026-08-31 — Steppe & roads round

12. **Herds, not nomads — and the danger premium.** (Ratified; 12a is the
    owner's own deeper formulation, superseding the "mobile community
    type" proposal.)
    a. **Fully physical pastoralism**: herds are stocks that need food;
       they can eat grass (seasonal, locally depletable, regrowing),
       fodder (stored grass — labor + storage technique), or grain
       (competes with mouths). Communities drift toward their food
       source. No nomad type exists: sedentary mixed farming,
       transhumance, semi-nomadism, and full steppe nomadism are points
       on the feeding-ratio continuum. The mounted-war archetype emerges
       from horses + daily riding practice (11). Reality check: the
       agro-pastoral frontier must emerge at the cropping-beats-herding
       rainfall line (the Great Wall line).
    b. **Mirror-empire cascade**: steppe confederation hazard scales with
       the adjacent settled neighbor's extortable wealth; person-bound
       edges make hordes shatter at succession.
    c. **The dismount dilemma**: a conquering steppe center's legitimacy
       splits between steppe followers (eroded by adopting settled
       institutions) and settled subjects (built by it) — the Khaldun
       cycle emerges.
    d. **The danger premium** (owner question ratified into mechanism):
       effective travel cost = physical cost + predation danger per
       segment — high where authority is thin and displaced violence-men
       are plentiful, suppressed by strong authority (protection is the
       lord's own revenue defense). Consequences required emergent: the
       internal peace dividend; Silk-Road-class overland routes lighting
       only under imperial spans and dying at fragmentation — which
       re-prices the sea route (14's exploration trigger).
    Spec: `15-pastoral.md` + 03 amendment.

## 2026-08-31 — Plagues round

13. **Disease pools.** (All ratified.)
    a. Regional disease pools per pathogen class (crowd, zoonotic,
       water-borne, parasitic) with per-population immunity portfolios;
       outbreak severity = immunity gap × density; endemicization after
       each wave. Individual outbreaks get generated names for the
       chronicles; mechanics stay class-based.
    b. New pathogen classes emerge from density × livestock × time — the
       first cities breed the first plagues, at emergent dates, every
       seed.
    c. Quarantine is an administration-domain technique in the 11 catalog
       (the Venice pattern: trade wealth × administrative capacity).
    d. Next moves ratified: write `16-plagues.md`, run a full-suite
       coherence pass, then M0 scaffolding on the owner's word.
    Spec: `16-plagues.md`.

## 2026-08-31 — Charter completion round

14. **All remaining proposals ratified; four additions.**
    - **P1–P4, P7 ratified as written** (pressure-and-selection;
      community as the atom; salience-gated centers; fading-authority
      canonical map; generated names as canon + gazetteer overlay).
    - **P6 ratified in the recommended form**: faith as simplified fields
      + pilgrimage economy until M6 validates the obligation graph, then
      promoted to full non-territorial graph actors.
    a. **Piracy**: the danger premium (12d) extends to sea lanes —
       predation where naval authority is thin; convoys, suppression as a
       sellable service, pirate havens where authority can't project.
    b. **The full hazard roster**: earthquakes (real fault maps), great
       floods and river avulsions (with the flood-control legitimacy
       burden — the failed-dikes Mandate mechanism), storms at sea
       (fleet-loss draws), harbor silting — all per the DECISIONS-2
       pattern: drawn from real hazard geography, responses emergent.
    c. **Megaprojects**: treasury + labor → stocks in existing books
       (canals edit the travel field; long walls are fortification along
       emergent frontiers; harbors, lighthouses; monuments). Owner
       addition: **excess wealth may flow to frivolous, vast-scale
       prestige projects** — legitimacy manufacture and surplus sink at
       once (pyramids, palaces, follies).
    d. **Fish reinstated**: v1's FISH=0 directive was a verdict on the
       broken flat-cap fishery, not on fish. v2 carries the designed
       labor/stock/depletion fishery on conserved books.
    e. **The observatory chapter (17)** written as working design — the
       owner's reply skipped item A; assumed yes, veto reverts.

## 2026-08-31 — Personalities round

15. **Societal character is path dependence, never dice.** (Ratified.)
    a. Three emergent layers: the practice profile (11), the institutional
       portfolio (11/05), and **value vectors on cultures** — written
       slowly by practiced/rewarded life, read back as behavioral weights
       (war appetite, prestige-project choice, extraction restraint,
       conversion resistance, exploration, blocking), decaying on
       generational timescales. The lag is the lock-in: styles outlive
       their causes (the Sparta mechanism).
    b. **Founder effects** at culture branching: small founding
       populations amplify individual traits into cultural ones.
    c. **No society-level random personality, ever** — idiosyncrasy
       enters only through persons (ruler traits, dynasties) and founder
       effects. Constitution-adjacent rule.
    d. **Personality collapse is a pathology gate** (v1's scar: "by 50k
       every realm reads Trading Empire"): all mature realms converging
       on one style = red build; target is Sparta/Athens-class divergence
       under similar conditions.
    Spec: 07 values section; 08.3 gate.

## 2026-08-31 — Unfree labor round

16. **Coercion as a spectrum, driven by the Domar triangle.** (All five
    ratified.)
    a. Coercion is dimensions on the labor books (mobility denial ×
       output share × saleability of the person) — chattel, helotry,
       serfdom, debt bondage, corvée, indenture as points on a continuum,
       never a binary category.
    b. **The Domar triangle** is the demand law: unfreedom demand ∝ land
       abundance × labor scarcity × elite coercive capacity — deriving
       the plague fork (wages vs second serfdom), frontier serfdom, and
       conquest-estate slavery instead of asserting them.
    c. **Debt bondage** is a supply channel in coined economies
       (Solon-class debt crises emergent).
    d. **Manumission** is a standing flow.
    e. **Presentation rule**: unfree labor is recorded and measured with
       full historiographic honesty (chronicles name it; the almanac
       plots it against the reality tables) and never aesthetically
       rewarded.
    Spec: 06.4 expanded.

## 2026-08-31 — Audit round (ratified via owner "ok"; any item revertible on a word)

17. **The thin-spot audit, folded in.**
    a. **Government form** is coalition-derived: the form of rule reflects
       whose resources the center cannot do without (land+levies → kings;
       trade+finance → merchant councils/republics; legitimacy manufacture
       → priest-rule; massed citizen soldiers/rowers → broad
       participation). Derived label with real consequences (succession
       law, factional strife, value feedback). Spec: 05.3.
    b. **The trust problem**: cross-authority trade is gated by an
       enforcement term — shared authority, shared identity networks
       (**emergent trade diasporas** along high-value routes), or late
       institutional substitutes (merchant law, credit — the
       impersonal-exchange transition). Spec: 06.5.
    c. **Naval warfare**: fleets as entities; sea control, blockade into
       the siege/food books, convoy vs commerce raiding, galley-era
       coastal seasonality. Spec: 13.6.
    d. **Money's origin** derived: coinage as a verification technique;
       states adopt it because taxing and paying armies monetized is
       cheaper — monetization spreads with state capacity. Spec: 06.2.
    e. **Mass-migration cascades** (Sea Peoples / Völkerwanderung class)
       are a required emergent outcome — a gate, not a mechanism;
       verified at M5–M6. Spec: 08.
    f. **Consciously excluded from Phase 1** (a choice, not an
       oversight; each re-openable): household/marriage-pattern
       demography (EMP — Phase-2 depth), espionage as a system (folded
       into war-assessment noise), education beyond carrier pools,
       intra-family politics below the dynasty, sub-monthly weather.

## 2026-08-31 — Foundations round (owner-ordered full reduction audit)

18. **The reduction audit.** Every mechanism reduces to: Level-0 data,
    Level-1 conserved matter/energy, a **closed registry of ten
    population mental stocks** (each with carrier/writer/reader/
    calibration; the four attachment stocks declared latent variables,
    outcome-validated; cap enforced), obligation edges as recorded facts
    with always-re-derived live strength, and hazard draws in the
    ratified slots only. New laws: **the label law** (no mechanism reads
    a derived label — one violation found in 17a's phrasing and fixed)
    and **the representation-invariance gate** (macro-history invariant
    under perturbation of bookkeeping thresholds — the generalized third
    cardinal rule). Spec: `18-foundations.md`; 05.3 fixed; 08 + 09
    amended.

## 2026-08-31 — Substrate round

19. **The compute substrate.** (All five ratified.)
    a. **Hybrid**: TypeScript shell + mechanisms; **routing engine in
       Rust→WebAssembly from day one** (the measured 97% hotspot with a
       stable interface); all hot loops kernel-disciplined behind narrow
       typed-array APIs for later wasm drop-ins; ONE core serving the
       browser worker and headless Node (batteries).
    b. **CRP-style three-phase routing**: preprocess fixed topology once,
       customize on cost change (season/tech/roads), query constantly;
       dirty-region invalidation.
    c. **Determinism laws**: no stdlib transcendentals in sim code (own
       polynomial implementations, lint-enforced); fixed-order
       reductions; tri-engine hash tests (Chromium/Firefox/WebKit + Node)
       in CI.
    d. **Memory doctrine**: SoA, arenas/pools, zero steady-state
       allocation in tick paths; history as keyframes+deltas spilled to
       OPFS (browser) / disk (headless).
    e. **Performance budgets are standing CI gates from M1**; working
       target: a full Phase-1 run headless in ≤ ~30 min on a normal
       laptop, so 20-seed batteries run overnight.
    Spec: 02 substrate section; 10 M0 expanded.
    Implementation begins: M0 handed off (spec/handoffs/M0.md).
    M0 merged and gate-passed 2026-08-31 (tri-engine CI green on
    4a416a3e); M1 handed off (spec/handoffs/M1.md).
    M1 merged and gate-passed 2026-09-01 (b6f12df4; review wave
    c5870631: real monthly climate+wind, wind-alignment monsoon, datan2,
    edge geometry, measured gate + known-miss ratchet; corner-cutting
    fix 47cb49a8); M2 handed off (spec/handoffs/M2.md).

## 2026-09-01 — Shoreline round

20. **Real-ETOPO earth data; the drowned-plains fix.** (Ratified — owner
    picked "fix it now" 2026-09-01.) The inherited v1 elevation raster's
    byte-quantized mask drowned every low coastal plain (the Nile delta,
    Sumer to ~32.5°N, all of Bangladesh, the Indus delta, the Bohai
    coast, the Netherlands) — the cradle basins the M2+ gates measure.
    v2's `EARTH_ELEV` is regenerated from real ETOPO1 by
    `v2/tools/build-earthdata.mts`: mask = altitude>0 by sample majority
    before quantization; ocean = border flood-fill plus enclosed basins
    ≥ 100k km² (sea-sized — the Caspian class — no names in code);
    smaller enclosed depressions stay land; land bytes linear at the v1
    decode ramp (≈20.52 m/byte) so climate/gradient calibrations carry;
    encoding contract otherwise unchanged. This is a RECORDED DATA
    DEVIATION from the v1 port: the worldgen oracle now runs v1's
    algorithms on v2's data (it verifies the algorithm port, not the v1
    raster). v1 itself is untouched. QUESTIONS.md #19 carries the full
    measurement record.

## 2026-09-01 — Rivers round

21. **Real river geometry; emergent water.** (Ratified — owner directive
    "lets just get our rivers perfect".) Earth presets take river
    GEOMETRY from baked HydroSHEDS v1 flow directions
    (`v2/tools/build-riverdata.mts` → riverDirData.js, dominant river
    tracing to any grid); runoff, accumulation, transmission loss and
    magnitude stay emergent from climate (R7: Earthness in data, never
    mechanism). Riding deviations, each recorded with reasons in
    QUESTIONS.md #21: per-km transmission loss (R3 — the flat per-tile
    constant erased the lower Volga at fine grids), the
    Dardanelles-Marmara-Bosporus strait row (the Black Sea must reach
    the ocean or the Danube reads terminal), and mouth/estuary/pocket
    discharge rules. Procedural presets keep the v1-verbatim derived
    path, proven EXACT by the oracle's new rawRivers arm. The reality
    gate gains data/reality/river-network.json: 13 measured anchors
    (twin rivers at Baghdad, Mississippi tree with its real
    confluences, the Congo arc, the Niger bend, Volga→Caspian, ...),
    all passing at the shipped grid.

## 2026-09-01 — Water round

22. **Honest water: data lakes, the measured floodplain, seasonal flow.**
    (Ratified — owner directive "i think that needs to happen now …
    write the spec for this talked about build".) Three substrate fixes
    before M2 calibrates against the map, specified in
    `spec/handoffs/W1-water.md`:
    (a) **Lakes.** v1's derived candidate placement (depressions of
    cell-average sim elevation — the last derived geography, wrong
    everywhere at 22 km averages) is superseded on earth presets by a
    baked HydroLAKES mask; the WATER stays emergent (inflow validation
    unchanged — a basin the hydrology cannot fill stays dry; Chad may
    shrink). Procedural presets keep the v1-verbatim path.
    (b) **Floodplain.** The three fertility painters (the
    `HW = 0.05·√catchment` moisture-ribbon width law, whose constant is
    annotated "~2× generous vs Earth valleys for map legibility"; the
    `tFlood ⇒ crop = max(crop, 0.92)` stamp; the full-cell channel
    alluvial pull) are REPLACED, not tuned, by a per-cell floodplain
    FRACTION measured from the fine ETOPO samples already in the river
    bake (height-above-channel within a physical flood stage). Crop
    suitability becomes the area-weighted mix of irrigated-floodplain
    and rain-fed land: the Nile paints one cell wide because its valley
    IS one cell wide; valley width is local confinement, never upstream
    catchment.
    (c) **Seasonal flow.** Monthly emergent runoff routed through the
    fixed channels (twelve accumulation passes) scales river
    navigability by month — chapter 03's seasonality contract's river
    arm (the Niger's low-water closure, the Volga freeze). Fertility and
    crop suitability remain ANNUAL by design: they are integrated land
    properties; the monthly signal reaches agriculture through the
    growing-season bell and, at M3, the food economy's monthly tick.
    (d) **Flood regime** (Nile-gentle vs Tigris-violent) is deferred to
    M3 as a read on (c)'s output; no state ships for it now.

## 2026-09-01 — Kernel round

23. **W2: the banded wasm people kernel** (Ratified — owner: "make a
    spec for cursor to do this", after playing M2 at ~5 sim-years per
    5 s). Performance only, zero physics: the people pass moves to a
    Rust/wasm band kernel behind the existing typed-array API, with
    people state in wasm linear memory (JS views, never mirrored),
    a FIXED grid-derived band layout so the world hash is identical
    for any worker count and to the TS reference (which stays in-tree
    as the parity oracle, byte-exact acceptance), dmath's dpow ported
    under the bit-golden discipline, and worker banding via
    SharedArrayBuffer (COOP/COEP in the shell; single-thread wasm
    fallback). Closes the ≤30-minute full-Phase-1 ceiling (currently
    6.8 h at 210 ms/tick × 116k ticks) and promotes the full YD→1 CE
    gate arm to the SHIPPED grid with its own grid-scoped manifest
    rows. Spec: `spec/handoffs/W2-kernel.md`. Annual-cadence stride
    stays unbuilt pending separate ratification.

## 2026-09-02 — Cadence round

24. **W3: the multi-rate scheduler, and real threads.** (Ratified —
    owner: "write a spec for this scheduled thing and previously talked
    about W2B performance", after the cadence conversation.) One monthly
    clock; every pass declares stride and phase through one helper;
    cross-rate coupling is by delta ledger, never by reach-in; the
    resolved schedule is world identity (hashed, saved). The people pass
    splits: GROWTH (technique, capacity, growth, cohorts) at an annual
    stride; MIGRATION at the stride its diffusion bound permits at the
    grid — derived, never hand-set: monthly at the shipped grid (annual
    outflow share 2.4–7 against the 0.5 bound), annual at dev. Ruling 1's
    "measurably changes trajectory" gets a measuring instrument: a
    stride arm that runs reference and shipped schedules and bounds the
    population and arrival deltas; a failure sets that pass to stride 1,
    never a tolerance. W2b lands in the same wave: shared-memory wasm
    (pinned nightly, threads-enabled std) with real `worker_threads` /
    Web Workers claiming fixed bands, hash-identical to serial dispatch
    and to the TS oracle; halo-exchange named as the sanctioned fallback.
    Owner expectation corrected in the spec: "people yearly" is people
    GROWTH yearly — movement stays monthly at the shipped grid, so the
    ceiling closes with threads, not cadence alone. Spec:
    `spec/handoffs/W3-cadence.md`.

## 2026-09-02 — Layout round

25. **W4: the land-packed people kernel.** (Ratified — owner: "create the
    spec", after the W3 review found that real threads barely scaled.)
    W3 measured migration at 54.5 ms serial → 49.4 ms on eight threads:
    the pass is bound by memory traffic, not arithmetic — six full-grid
    fills/copies and three whole-grid sums per firing over arrays that
    are 71% ocean. W4 packs every SCRATCH array and every iteration to
    the land list (saved fields keep their full-grid views; the peopled
    mask and band doctrine unchanged), folds the serial preludes and
    totals into the banded phases with per-band partials combined in
    band order (the one allowed result change — a summation order,
    proved harmless by the stride arm), and optionally narrows cleared
    scratch to f32 storage with f64 arithmetic in lockstep with the TS
    oracle. Byte-exact parity remains the acceptance instrument. Spec:
    `spec/handoffs/W4-layout.md`. Branches from the W3 merge.

## 2026-09-02 — Wave-and-crops round

26. **M3a: the wave and the crops.** (Ratified — owner: "yes, write the
    spec", after the 4400 BCE play-report: Europe unfarmed, the Near
    Eastern package across the Sahel, all India farmed, a Chaco blob,
    diamond fronts.) M3 splits in two. M3a makes the spread of farming a
    prediction: crop packages with climate bells and a growing-season
    minimum; wild-progenitor RANGES as data replacing the hearth pins
    (hearths condense where a peopled basin sits on a range for the
    package's lag; pins become the reality check); farmers as a
    sub-population per package carried by migration, so the front's speed
    is 2√(rD) of the farmer group and the 1 km/yr constant is deleted;
    conversion by contact × (farmed − forager) advantage, which is the
    forager-resistance and the climate wall in one expression; spread
    over the travel field with 8 neighbours and coastal hops of tens of
    km; the European radiocarbon front as the reality table. M3b (food,
    storage, bad years, herds, fish, communities) follows on the map M3a
    produces. Spec: `spec/handoffs/M3a-wave.md`. Branches from the merge
    of the working branch into main.

    **Review rulings (2026-09-02, merge of the M3a implementation;
    QUESTIONS #37).** (a) *Contact is local.* Foragers adopt the package
    of the farmers they live among; the neighbour-stencil contact term of
    the spec is withdrawn because its front moves one cell per conversion
    interval, a speed equal to the grid spacing (third cardinal rule).
    Spread is farmers moving; a cultural diffusion with a diffusivity of
    its own is an M3b-or-later design question, not a stencil. (b) *The
    advantage saturates*, adv/(1+adv): the linear form converted a cell
    within years of first contact whatever the rate. (c) *Farmers carry
    their own mobility.* A farmer mass joins a month's flow at
    `PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR` / the forager diffusivity
    (15 / 1200, Ammerman & Cavalli-Sforza); riding the forager
    diffusivity gave 2√(rD) ≈ 4.7 km/yr, five times the radiocarbon
    front. The adoption rate is then grounded on the front band given
    that mobility, as the spec said it would be. (d) *A package's farmed
    capacity is independent of the farmer share*; a cell's capacity is
    the mixture of its people, and the land a farming source can enter
    opens in proportion to the farmers it sends (the pair spare). (e)
    *The peopled-basin law is M2's* — a basin's people against the
    basin's own static forager capacity, accrued per native cell; the
    proposed global density bar is withdrawn. (f) *The front-isotropy
    gate check is withdrawn*: a bounding-box aspect of the farmed set
    measures nothing about diamonds, and on Earth the climate bounds most
    of the front; the stencil is the mechanism and is reviewed as such.
    (g) *The wild-range boxes are data awaiting citations* — three
    (wheat into the Indus, rice into Japan, sorghum across the whole
    Sahel) decide whether those regions ignite on their own or are
    reached, and the owner rules on the sources.

## 2026-09-03 — Solve round

27. **W5: the peopling solve and the wake.** (Ratified — owner: "write
    the spec", after the prehistory conversation: "do we NEED to model
    several thousand years of predictable people growth?" and "do we
    REALLY need to simulate actual year by year movement?") No. Before
    anything pushes back on the people field the only thing that moves is
    the farming front, and its diffusion bound permits a multi-year step
    where the forager bound forces a monthly one (15 against 1200 km²/yr).
    The kernel gains a second schedule regime, SOLVE: every pass at one
    stride derived from the bounds the passes already carry (farmer hops
    on can-grow rows, farmer growth, adoption, cohort ageing — 84 months
    at both grids, printed, never set); foragers hop at the forager share
    of the stride, substepped and capped by the kernel's own bound (the
    spec proposed leaving them in place; the flat-field check showed the
    omission first-order at the front — a farmed cell's mixture capacity
    draws foragers in and the newcomers dilute contact — so the named
    remedy applied before the wave landed, QUESTIONS #40); conductance at
    the annual mean. The world WAKES into the monthly
    regime at the first caged basin: the first hearth-law window whose
    free farmable share falls below the ledger's caging knee — M4's own
    precondition (Carneiro), so M4 inherits the trigger instead of
    redefining it. Sub-rulings: (a) the wake is a state trigger;
    `config.wake` (auto / never / a year) is an initial condition like the
    seed, read by nothing after the switch; a chosen year later than the
    trigger is the player knowingly accepting the solve past its
    validity, and provenance says so. (b) The window is the hearth-law
    basin, centred on farmed cells, until M4 derives its flight radius (the
    forager diffusion length over a generation is the candidate); then the
    wake follows that derivation. (c) The scrubber's prehistory frames are a rendering
    condensation (02, box 5): reconstructed from recorded arrival steps
    and the passes' own constants, never state, never saved. (d) The
    reality tables for the front and the population curve are measured
    per commit at both grids from a full-horizon solve, inside the
    dev-loop directive (a minute, not hours; demotable to the long
    workflow by a flag); the awake kernel's agreement with the solve is a
    long-workflow arm whose bounds are gate tolerances — a failure lowers
    the stride or restores forager hops, never a tolerance. (e) No
    physical constant is added; the new constants are the named knee, the
    named farmed marker, two gate tolerances and a save version. (f) The
    awake kernel's cost is untouched: the row-cadence question W3 left
    open stays open, and this wave replaces the performance wave sketched
    after the M3a review. Spec: `spec/handoffs/W5-solve.md`. Branches
    from the merge of the working branch into main.

28. **W6: the base population stays.** (Ratified — owner: "write the
    spec for that change", after asking why foragers need to move at
    all.) They barely do, and the one place W5 measured their movement
    as consequential was an artefact: a forager source saw a farmed
    cell's MIXTURE capacity as room, so the foragers of every neighbour
    poured into a new farming cell and were converted there — the flood
    the flat-field check measured at 58 %. Rulings: (a) foragers see
    forager room (the land's forager capacity minus everyone there),
    farmers see farmed room; 26 (d)'s "foragers see the target's
    capacity as it stands" is revised accordingly. (b) Each group flows
    on its own weights and conserves itself; the M3a mixed flow with
    farmers riding at a ratio is retired. (c) The forager mobility is
    re-grounded by the farmer value's own convention (parent–offspring
    displacement per generation ÷ 4T) from the forager literature, cited
    in the ledger and chosen before any run; `PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR`
    (1200, a v1 calibration the ledger has carried as `[REDERIVE]` since
    M2) is retired. (d) Each group's movement stride derives from its own
    bound as W5 derives the solve stride, may exceed a year, and a source
    with no room beside it (room below the numerical floor) is not priced
    — so the awake kernel loses its monthly pass by physics, not by a
    switch. (e) The adoption rate may be re-grounded inside the range its
    row already admits if the front leaves the radiocarbon band once the
    flood is gone; nothing else moves. Spec: `spec/handoffs/W6-foragers.md`.
    Implemented the same day (QUESTIONS #41): the mobility grounded at 23
    km²/yr on the Aka measurements, the front inside the band at 1.08
    km/yr so (e) was not needed, the awake month at the shipped grid down
    tenfold.

29. **W7: where farming begins, and how it travels.** (Owner directive
    2026-09-03, on the play-report of ten wheat hearths igniting in one
    century from the Nile to the Indus and ten rice hearths from Bengal
    to Japan: "we need the spread and starting block to be perfect, or at
    least acceptable.") The M3a hearth law had become a calendar: range
    boxes covering whole botanical distributions, and a peopled world
    that fills every basin within centuries, so every cell of every box
    reached the lag in the same century and the separation rule cut it
    into hearths a thousand kilometres apart. Rulings: (a) *The ranges
    are the dense-stand habitat of the wild progenitor, cited per
    package* — the belts where the plant forms harvestable stands, on the
    sources' own distinction between massive stands and sporadic plants
    (26 g is resolved by those citations); sporadic regions are reached,
    and their arrival windows are the check on the reading. (b) *A basin
    that already farms stops domesticating*: the clock accrues at the
    basin's fill times the share of the cell's subsistence that is still
    the forager yield (`foragerCapacity / capField`), so arrival pre-empts
    invention with no rule for it. (c) *The boat hop is the Neolithic's*:
    100 km on the crossings it colonised (Cyprus, Malta, Corsica),
    replacing the 40 km foot-and-raft scale. (d) *The sorghum lag runs
    from the Sudan's wild harvests to its domesticated grain* (2500 y,
    Winchell 2017). (e) *The dev grid cannot represent the straits*: at
    167 km cells the Bosporus, the Dardanelles and the Korea Strait are
    open sea beyond any hop, so every European row and Japan are measured
    at the shipped grid (third cardinal rule) and the dev rows are
    recorded as the artefact they are. (f) *What remains early is P10's*:
    the Sahel and eastern North America ignite on a world caged from the
    opening under today's climate, where the real belts filled as the
    green Sahara dried and the mid-Holocene floodplains formed; no lag is
    stretched to hide it. Spec: `spec/handoffs/W7-origins.md`.
    Implemented the same day (QUESTIONS #42): 21 hearths at dev (78
    before) and 28 at the shipped grid, wheat in the Fertile Crescent arc
    only, rice on the Yangtze only; at the shipped grid the Balkans, the
    Cardial coast, inland Europe, the Nile, the Indus and the Yellow River
    reached by spread inside their windows, Korea at −4555, and the
    population at −5000 inside its band for the first time. (g) *The
    front's speed is the farmers' own 2·√(r·D)*: 0.53 km/yr at the
    shipped grid on a flat field, to two figures the farmer growth (0.46
    %/yr) and mobility (15 km²/yr); the ledger's 0.94 had added adoption
    at full contact, which a leading edge never has. Central Europe and
    the Rhine stay late for that reason, and the remedy is P15.

30. **W8: who farms what, where, and why.** (Direction ratified — owner:
    "spec all of these changes we have talked about", after the W7
    play-report: the origin "seems fixed, not dynamic and procedural";
    marginal land farmed as densely as the Crescent on the farming lens;
    the first crop holding a cell for good.) One wave: (a) wild stands as
    a field — a wild-habitat envelope per package sampled at the plant's
    documented localities, polygons for the belts, the hearth clock at the
    basin's dependence on the stand, the spacing constant deleted and a
    hearth a region; (b) forager capacity by habitat — shores and stands
    from the hunter-gatherer density literature, so the affluent forager
    resists; (c) yield graded by climate fit; (d) adoption under pressure,
    the cell's fill; (e) the mixture as the capacity; (f) farmers switch
    to a better crop by the adoption law. New reality tables: the centres
    of domestication with windows, the staple by region at 1 CE, the
    forager density ordering. P10 and contingency stay the owner's. Spec:
    `spec/handoffs/W8-who-farms-what.md`. Implementation on request.

## 2026-09-05 — Front-speed round

31. **W12: the front at the speed its constants name.** (Owner directive
    2026-09-04/05, after the play-report — "europe seems late?", "so surely
    if it is half speed, everywhere, we just double the speed?", "can you
    not just make the cells represent as larger, proportionally?", "think
    about it a bit" — then **"spec it"**.) The farming front ran at 0.553
    km/yr at the shipped grid against the ledger's own design of
    `2·√((r + adoption)·D)` = 0.936, and every reason is in the
    discretisation. (a) LANDED: a lattice hop is not a diffusivity — the
    share is `4·D·dt/<d²>` with `<d²>` the stencil's mean square hop, not
    `D·dt/area`; front 0.670 at target, inside the cited band, the Balkans,
    Cardial coast and inland Europe cleared, findings 27 → 24 (`a1eac742`).
    (b) Per-pass strides in the solve regime, as the awake regime already
    has: only migration needs the 24-month step the corrected share demands
    at the shipped grid; the other passes keep 84; measured cost ~1.5× not
    3.5×. (c) The reduced polar grid — the owner's "represent the cells as
    larger": merge east–west where `cos(lat) < 0.5`, again below 0.25, so
    every cell's aspect ratio stays inside [0.5, 1]; it makes the migration
    bound ~48 months at every latitude with nothing given up, where every
    exclusion-based shortcut measured as giving up most of humanity
    (QUESTIONS #58). (d) The anisotropic finite-volume flux, face length
    over distance, which under-serves east–west transport on the isotropic
    split by the aspect ratio — and is stiff enough at the poles that it
    must follow (c). Sub-rulings: no constant is re-grounded, the
    Ammerman & Cavalli-Sforza mobilities are untouched, and "double the
    speed" is refused on a measurement — dev already runs above design, so
    no value of the constant satisfies both grids. The visible step at the
    shipped grid becomes "2-year steps" under (b) until (c) restores 4;
    that trade is the owner's. The adoption pass at 65 % of a solve firing
    is owned as a performance task. Spec:
    `spec/handoffs/W12-front-speed.md`. Implementation on request, in the
    order (b) → (c) → (d).

32. **W12 §2 landed: each solve pass on its own stride, on a gcd clock.**
    (31(b), implemented 2026-09-05.) Every solve pass now fires at the
    largest whole-year stride inside its OWN bound, as the awake regime's
    passes already did, so the movement cadence the corrected hop share
    demands is charged to movement alone. Two bounds. The REACTION bound —
    farmer growth, adoption, cohort ageing, none of which knows the cell
    size, so it is the same at every grid: min(108.2, 50, 7.5) years, 84
    months. And the TRANSPORT bound — each group's hop share inside
    `PEOPLE_MIGRATION_MAX_SHARE` on every row it can be a source from: 24
    months at the shipped grid, over a century at dev. So dev keeps 84
    everywhere and is byte-identical, and the shipped grid moves at 24
    against the other five passes' 84. Four corrections the implementation
    forced, recorded because the spec said otherwise:
    (a) *The clock is the greatest common divisor of the strides, not the
    shortest.* A clock of 24 lands on 0, 24, 48, 72, 96 … and meets
    `step % 84 === 0` only every 168 months, so growth, capacity, adoption
    and cohorts would have run at DOUBLE their own bound while every gate
    still reported 84. Only a divisor of every stride lands on every
    cadence, and the gcd is the largest such divisor: 84 at dev, 12 at the
    shipped grid (QUESTIONS #60).
    (b) *Movement is capped at the reaction stride.* It transports what
    reaction wrote, so a transport firing longer than the span that field is
    held fixed over integrates a field which no longer exists — and buys no
    reach doing it, since a firing moves people at most one cell whatever
    the share. That cap is what binds at dev, and what keeps dev
    byte-identical.
    (c) *The substep allowance leaves the transport bound.* Substepping is
    what keeps the explicit scheme stable across a long firing, not licence
    to make one longer; the 16× factor bought a slower front and nothing
    else (QUESTIONS #57), and it never showed at dev, whose share sits at a
    sixtieth of its bound.
    (d) *The visible step at the shipped grid is 1 year, not the 2 that 31
    promised.* That is what the correct clock gives, and §3 does not restore
    it on its own — gcd(84, 48) is 12 as well. Two other mechanisms reach a
    coarser one, both legal because rounding a stride DOWN is always inside
    its bound: a movement stride that is also a divisor of the coarsest
    (84/21, 1.75 years, +14 % movement firings, and 3.5 years once §3
    lands), or the coarsest rounded to a multiple of the shortest (72/24, 2
    years, ≈ +13 % total, which is where 31's "2-year" came from). The
    handoff carries the table; the choice is the owner's.
    Cost, measured on landing: dev unchanged at 0.55 → 0.57 ms per
    solve-year, the shipped grid 34.9 → 104.8. That 3.0× is §1's, not §2's —
    the corrected share needs 3.5× the movement firings to carry the same
    span. What §2 buys is keeping the multiplier OFF the other five passes:
    against a single stride at migration's own bound, 1.19× on a cold world
    and 1.65× with every hearth primed, the spread being the adoption pass
    at 65 % of a firing. Prerequisite: §1 had moved nine rows of the dev
    solve arm without recording them, so the known-miss manifest was
    re-measured to 48 first (`15d83fe6`, QUESTIONS #59). Measured at the
    shipped grid on request (QUESTIONS #63): the front 0.670 → **0.854
    km/yr** against the 0.936 design, all five European windows met, the
    Indus 1,128 years later than before (−2027, a new miss) — the residual
    9 % is not uniform but split by direction, §4's sign, undecidable from
    box years alone — and decided by the arrival raster, run on request
    (QUESTIONS #64): the Iranian plateau's capacity, not the split. The
    eastward leg runs at 1.0 km/yr where the ground holds it and at
    0.16–0.30 across 750 km the substrate keeps at the moisture floor with
    no channel, ~2,400 years of the miss; the anisotropy test finds no
    east–west penalty at 30–60 °N, so neither §4/P16 nor P15 is indicated
    by the front, and the mechanism the Indus waits on is P17. Population
    overshoot grew with the speed (M3b). §3 (the
    reduced polar grid) and §4 (the anisotropic flux) remain on request —
    see 33, which measures 31(c) and withdraws it.

33. **W12 §3 measured and NOT built: the ratified polar merge moves the
    stride from 24 months to 24 months.** (31(c), measured 2026-09-05 before
    building — #58's method applied to #58's own remedy.) 31(c) ratified
    merging cells east–west in pairs below `cos(lat) = 0.5` and in fours
    below 0.25, on the claim that the migration bound then becomes ~48
    months at every latitude. Measured per-row over every row anyone can be
    a source from, at the shipped grid, from the real substrate, with the
    same expression `transportBoundYears` uses — validated by reproducing
    today's 24-month stride exactly on the no-merge arm — the ratified rule
    takes the bound from 2.045 to 2.408 years and the **stride from 24 to
    24**. Three findings (QUESTIONS #61, table in the handoff §3d):
    (a) *It is not the cap of four.* A cell of aspect `a` has mean square
    hop `(a² + 1)/2` of a square cell's; the equatorial bound is 4.034 years
    and the stride is that bound FLOORED to whole years, so holding 48
    months needs **a ≥ 0.992**, not a ≥ 0.5. Any power-of-two rule has
    worst-case aspect 0.5 by construction, just below each doubling
    threshold, whatever the cap: 4 → 64 moves the bound 2.408 → 2.525 years
    and the stride not at all.
    (b) *The rule fails its own criterion.* Measured worst aspect under it
    is 0.438 at 83.7 °N, a peopled row at the shipped grid, because
    `cos(83.7°) = 0.11` is under the 0.125 where a cap of four still reaches
    0.5. The [0.5, 1] band needs unbounded factors and was given two.
    (c) *31(d) is worse off than its spec says, not better.* Under every
    power-of-two merge the anisotropic bound stays under 1.1 years, so §2
    would derive a **12-month** stride — half of today's, doubling movement
    cost, poles still clamping — against the ~32 months §4b assumed. §4 is
    free only on a grid whose aspect is ~1: there its bound is 2.689 years,
    exactly today's stride.
    So **31(c) is withdrawn as ratified and nothing was built** — it would
    have been weeks of structural change (packing, adjacency, persistence,
    kernel row areas, renderer) for a measured zero, and 31(d) is blocked
    behind whatever replaces it. The rule that does work is a different
    design and is proposed, not substituted: P16. Dev is unaffected either
    way — its transport bound is 116 years today and 227 under P16, and the
    84-month reaction cap binds long before both.

34. **W13 landed: the routed water (P17) and the watered month.** (Owner,
    2026-09-05: "so we need water runoff", on #64's finding that the Indus
    is late because the plateau's water is not in the substrate.) The
    worldgen's per-tile runoff is returned instead of being summed and
    thresholded away, and the people world routes it down the worldgen's
    own flow directions in drainage order: each cell takes from what
    arrives the water its channel strip lacks in rain
    (`PEOPLE_CHANNEL_STRIP_KM = 10`, the Upper Nile valley floor and the
    Kopet Dag fans, as a share of the cell so it is the same ground at
    every grid), passes the rest on with its own runoff, and never takes
    its own. What it takes is one more term of water access, kept apart as
    the land's own water (`_surfaceAccess`, with the floodplain, river and
    lake terms) so that a growing month is admitted on it — W8 admitted a
    month on its rain alone and the Nile's winter did not count toward
    wheat's season; now Luxor has eight months, Mohenjo-daro seven where it
    had four and no wheat at all. The year's rain does not admit a dry
    month (the broader form was measured and withdrawn). Measured on the
    substrate at the shipped grid: Luxor's wheat capacity 0.91 → 3.11
    persons/km², Mohenjo-daro 0 → 11.4, Patna 4.5 → 11.0, Peshawar 12 → 21;
    the plateau sites 0.11–0.14 → 0.13–0.15, because their catchments are
    empty in the 1.9° table — P18, and the reason P17 alone does not move
    the Indus row. At dev the strip is 0.06 and the gate sees the machinery,
    not the size: the Indus arrives −4758 → −4121 (in window), central
    Europe clears, the Ganges takes rice, south China and the lower Yangtze
    take millet (the W8 grade cannot tell packages apart on watered ground
    — QUESTIONS #65 — first arrival wins), and the population leaves its
    band at −5000 (71.4M vs 60M; M3b). Seven dev rows newly recorded,
    three cleared. The shipped-grid arm is `v2-long` on request; the target
    rows are annotated, not refreshed.

35. **W14 landed: the rain on the slope (P18) and the paddy.** (Owner,
    2026-09-05, on the W13 handoff's list of what is next: "2 and 4 are
    really the only immediate fixes" — P18 and the paddy — then "do it".)
    P18: within each 1.9° table cell's own footprint, the sampled rain is
    placed on the slope it fell on — each land pixel weighted by
    `exp(g · Δz)` for its elevation anomaly against the footprint's land
    mean (g = 0.5 /km, the windward precipitation gradient, Barry 2008;
    clamped at the 2.5 km vapour scale height, Smith & Barstad 2004),
    normalised to a land mean of one so the footprint's rain is conserved
    and none is invented — before the quantile rank, with the quantile map
    untouched. The footprint is the widest odd box inside one table cell:
    zero at the reference grid, where the correction is inert by
    construction, four at the target grid. The paddy: each package carries
    `standingWaterResponse`, the relative change of its monthly fit on
    ground standing under water (rice 1.0, the paddy doubling the upland
    crop, GRiSP 2013; the New Guinea roots 0.33, Kirch 1994; every other
    package −0.35, the cereals' waterlogging loss, Setter & Waters 2003),
    and a cell's standing water in a month is the floodplain under the
    discharge above the year's own mean plus, for a wetland crop only, the
    strip W13's routed stream can keep wet — the plant's number and the
    land's state in one product, no package or place named in code.
    Measured on the substrate at the target grid: P18 moves every wet
    range (the Pamir crest 0.33 → 0.59, the Alps' Turin foot 0.34 → 0.20)
    and **does not lift the plateau sites** — Jeitun, Sang-e Chakhmaq,
    Mehrgarh, Tepe Yahya 0.02 → 0.02 — because the driest 26 % of land sits
    at the quantile map's 0.02 floor and a ×1.5 share does not move a
    desert-range pixel's rank out of that band; so `arrival:indus:solve:
    target` will not move under W14, the miss is placed at the floor band
    (QUESTIONS #66), and the floor is not lifted to reach it. The paddy
    grades rice above every other package exactly where ground stands
    under water (Mohenjo-daro 0.54 → 0.80, Luxor 0.48 → 0.72, Patna 0.52 →
    0.77, Dongting 0.48 → 0.74; wheat unchanged everywhere) and flips the
    best package by summed capacity to rice in south China, the Ganges, the
    Indus and the Sahel; the lower Yangtze's centre is off the ribbon. At
    dev P18 is inert and the paddy moves the arm a stride here and there
    (the Sahel −4758 → −4842) with no verdict changed: the two millet
    staples stand at 167 km cells and say why. Two findings recorded, not
    dialed: the floor band, and the seasonal river model's flat flood
    amplitude (the Nile's peak month 1.21 of the mean against ~3× real).
    The shipped-grid arm is `v2-long` on request; the target rows carry the
    substrate numbers and an expectation each.
    **Run on request the same day** (owner: "do the run"; W14 handoff §6,
    QUESTIONS #67) — the first target arm since W12 §2, so it measures W13
    and W14 together and isolates neither: the Indus arrival CLEARED (−2027
    → −3109) but the box farms millet at 1 CE on twice the cells and the
    steppe millet ignitions moved thousands of years earlier (the Tarim
    −5990), so which front reached the plain is not decided and the plateau
    finding stands until the arrival raster with its package is run (the
    #64 method, on request); the Ganges is reached by Godavari rice at −4799
    and farms rice (the paddy's signature; its arrival row is now a miss on
    the early side); Kuk lights inside its box (P18 on a wet range); south
    China and the Indus turn to millet at 1 CE and north-China millet lights
    13 years past the grace (three new misses); the Amazon-margin tubers
    hearth lights 1,225 years later, which is NOT the paddy's drowning term
    (corrected 2026-09-05: that term costs the site 3 % of capacity, the
    flood amplitude being flat, and P18 raises the new hearth cell's quality
    0.525 → 0.717 — the site got better and lit later, so the delay is in
    the peopling of the basin and the substrate does not hold it);
    population 305 / 670 / 797M at −3000 / −1000 / 1 CE (M3b). Three
    manifest rows added, four removed, the rest re-measured; recorded, not
    dialed.

36. **W15 landed: the wind the rain climbed, and the paddy as
    husbandry.** (Owner, 2026-09-05, after the W14 shipped-grid arm's
    findings: "why did whats wrong go wrong" → "what is the fix" →
    **"implement all"**.) Two corrections to W14, both mechanism, neither a
    dial: `constants.ts` is untouched, no cited value moved, and nothing was
    added to the ledger's constant columns.

    **(a) The paddy is husbandry, not botany.** W14 applied a package's
    whole `standingWaterResponse` at every technique and to the wild stand.
    Its grounding does not support that: Bray 1986's and GRiSP 2013's
    irrigated-over-rainfed ratio is measured on bunded, levelled,
    water-controlled fields — a thing farmers build, not a thing the plant
    does. So the POSITIVE part is scaled by the cell's technique (none at
    technique 0, full paddy at technique 1) and the NEGATIVE part — a crop
    drowning in a flood it cannot drain — stays physiology at every
    technique. One factor `1 + technique · gain`, with `gain` measured over
    the same admitted months, so technique-1 capacity is bit-for-bit W14's
    and technique-0 is bit-for-bit the un-paddied one; only 0 and 1 appear
    as literals. Both kernels, parity holds. It matters because the leaked
    capacity was read by the wild-stand richness and the hearth site
    quality: measured at the shipped grid, W14 credited un-farmed
    floodplain with up to 82 % more capacity than un-farmed ground can
    deliver (the Ganges 8.72 → 5.92 persons/km² at technique 0, Bengal 7.86
    → 5.35, the Mekong 4.37 → 2.95) — that is, it was moving the ignition
    clock with a yield nobody had built the works for.

    **(b) P18's footprint had no aspect.** W14's Δz was against the
    footprint's land-mean elevation, so a lee slope of a given height lifted
    exactly as much as the windward one — the single thing an orographic
    term must not do. The reference is now the elevation one footprint
    half-width UPWIND along that month's own wind, the height the air
    climbed: the standard upslope model (Smith 1979, *Adv. Geophys.*
    21:87–230; Roe 2005, *Annu. Rev. Earth Planet. Sci.* 33:645–671 §2).
    Same gain, same clamp, same footprint, same conservation, no new
    constant and no new length; the wind is the substrate's own monthly
    NCEP/NCAR field and a dead calm reads weight one. Measured at the
    shipped grid on the substrate alone, the windward-minus-lee contrast
    improves on six ranges of eight (the Alps −0.006 → +0.080, the Andes
    +0.039 → +0.178, the Western Ghats −0.019 → +0.013, the Himalaya +0.426
    → +0.474, the Southern Alps −0.148 → −0.033, the Alborz −0.674 →
    −0.535) and conservation holds (land mean 0.9981 over 558,091 cells).
    The gain was deliberately NOT re-tuned to the new reference; moving it
    to suit the term would be fitting the outcome.

    The Cascades and the Zagros move the wrong way and the Alborz is still
    negative, from one nameable cause — a 1.9° monthly climatological mean
    averages away the barrier-normal component of a flow that reverses
    within the month — whose remedy is finer wind data, not a coefficient.
    Two bugs in the ported wind sampler were found and deliberately left
    (they are off the sim's own path; a worldgen wave that can re-baseline
    the v1 hashes owns them). Everything above is substrate only, no
    history.

    **The shipped-grid arm ran the same day, on the owner's word ("run
    it"), and answers what the substrate could not.** `a2b40415`, seed
    42042, target solve leg 1,378 s. It clears exactly one manifest row —
    **`staple:south-china:solve:target`: south China farms rice at 1 CE**,
    the first time it has — and regresses none: the gate came back with
    nothing unacknowledged and that single stale row, so the only edit it
    forces is a removal. Nothing else changed in kind. Population 307.6 /
    682.1 / 812.3M at −3000 / −1000 / 1 CE (the same M3b miss, within 2 %
    of the W14 arm at every checkpoint), the European front 0.891 km/yr,
    every density and forager ordering held, and no primary arrival moved
    by more than 102 years except the Andes (189 sooner) and Japan (58
    later). Downstream: a fourth rice ignition in Myanmar (−4646), the
    Godavari and Bengal ones EARLIER, two new highland-roots hearths on the
    southern African highveld, and the first caged basin 616 years sooner
    and up the Mekong. Twenty rows re-measured in place; 61 rows.

    **The arm does not decompose the two corrections, and the first attempt
    to say it did was wrong — recorded so the method is not repeated.** A
    probe diffed `substrate.moisture` as if it were an annual field of
    length N; it *is* `climate.moisture`, cell-major with twelve months per
    cell and length N × 12, so the dump covered only the first 135,000
    cells — everything north of 75°N, where there is no orographic
    signal to find. Over the whole monthly field the wind reference reaches
    every box with relief (south China 70 % of cells moved, the loess 91 %,
    Sichuan 95 %, the Alps 90 %, the Andes 92 %; 18.2 % of all 1.62M cells,
    and the flat Nile valley the one box it leaves alone), so the field
    isolates no row to one correction. One thing IS isolated, by
    construction: the split touches only the two packages with a positive
    `standingWaterResponse`, and where it acts, technique-0 fit and wild
    stand are strictly lower while technique-1 capacity is exactly equal —
    so acting alone it can only ever make rice LATER. This arm makes the
    Godavari and Bengal ignitions earlier. The wind reference is therefore
    in them, and south China's clearance rides on a rice front the split
    alone would have delayed. A clean split needs a hybrid arm (W14's
    `realClimateData.js` on the W15 tree — the two corrections live in
    different files), roughly 23 minutes; recorded as needing one, offered
    and not run (owner directive 2026-09-03). QUESTIONS #68,
    `spec/handoffs/W15-wind-and-husbandry.md` §6.

37. **W16 landed: the taxon we name, not the crop it resolves to.**
    (Owner, 2026-09-06: "surely we SHOULD ALREADY be deriving wild ranges
    from real data?" → "why run? surely you can just look if the derived
    range covers the yangtze?" → **"do that, but also consider any other
    important wild ancestors we are missing"**.) No simulation code changed:
    this wave changes WHICH PLANTS the nine crop packages are built from, in
    `tools/build-croprelatives.mts` and the file it bakes.

    **(a) A name is not a taxon.** GBIF's occurrence search resolves a
    `scientificName` query to the ACCEPTED usage of that name and answers
    with the accepted taxon's records. Four of thirteen taxa this repo names
    are synonyms in GBIF's backbone, so four reads were not reading the
    plant they named — and one of the four is a fault that had been in
    every bake since W9: **`Manihot esculenta` subsp. `flabellifolia` is a
    synonym of `Manihot esculenta`, cassava.** The tubers package's wild
    range was fitted to 23,587 records of the modern cassava planting map,
    where the wild subspecies itself carries 1,448 — exactly the
    circularity the W12 native-range screen was built to remove, arriving
    through a door that screen does not watch. It is why tubers held the
    largest wild stand on Earth (2.2875; now 1.5393, and rice at 1.8653 is
    the maximum). The read is now pinned to a GBIF **usage key**, and a
    synonym is followed only where following does not move UP the rank
    ladder — the rule the WCVP screen already applied to distributions, for
    a reason that stands on its own: an infraspecific name exists to
    separate the wild form from the crop, and resolving it to the species
    throws that distinction away. By that rule wild einkorn and the Ozark
    gourd follow their synonyms and stay whole, wild rice follows to the
    *O. rufipogon* complex, and wild manioc does not follow into cassava.
    Each taxon's resolution is written into the baked file (`usageKey`,
    `read`, `matchedStatus`), so a silent substitution is visible in the
    data and not only in the counts. Eleven of thirteen reads come back
    byte-identical, which is what makes the two that moved trustworthy.

    **(b) Wild barley rejoins the founder set.** The package is called
    "Wheat & Barley" and had no barley in it. `Hordeum spontaneum` was
    excluded with a measurement — its range, Morocco to Tibet, "put wheat's
    envelope in north China" — taken when ONE envelope was fitted to the
    merged cloud of every member. W10 gave each member its own envelope and
    made a package rich only where its members CO-OCCUR; W11 divided the
    collection effort out cell by cell. Under those two a widespread member
    cannot drag the fit anywhere, it can only restrict the intersection —
    which IS the founder-set claim the code already cites. Measured: the
    Crescent keeps all four rich cells, the package's range reaches 74 km of
    the hearth centre instead of 206, best richness there rises 43 % and
    best stand anywhere 45 %, site quality 1.0000 unchanged. The revert
    condition was not met.

    **The exclusions that stand are not the same case**, and were re-argued
    rather than inherited: broomcorn millet is a feral escape whose ancestor
    botany does not know; wild taro and wild sweet potato are WCVP-introduced
    where the package needs them native; wild sugarcane and wild teff are
    independent crops of one complex, so requiring them alongside yam and
    enset is a claim the archaeology does not make (and sugarcane was
    measured to empty the Kuk intersection). Wild banana falls under the same
    sugarcane ruling. The five non-cereal Crescent founders — the pulses and
    flax — are excluded because a package's founder set is the progenitors of
    the crops the package IS, and "Wheat & Barley" is a cereal package.
    **(c) Wild sunflower was added on barley's argument, measured, and
    reverted.** It was the one candidate that survived the audit: Smith 2006
    names four founders of the Eastern Agricultural Complex, the package
    carried three, and the fourth's stated exclusion — "spanning the
    continent" — is exactly the breadth argument (b) retires. So it was
    added and baked. It reads clean — an ACCEPTED species usage, the 44,705
    European records dropped unread by `continents`, 8,086 of 33,805 kept by
    the WCVP screen — and it KILLS the package: the screened wild sunflower
    spans lon −124.0..−96.5 and the Ozark gourd spans −96.5..−83.75, sharing
    EXACTLY ZERO occurrence cells, so the members' product is empty
    everywhere. eastern-seeds' best wild stand 0.4429 → 0.0000, its rich
    cells 17 → 0, and the eastern-woodlands hearth site 1.0000 → 0.0000.
    Reverted, and the exclusion now rests on that measurement rather than on
    breadth — **the sugarcane ruling, not the barley one.**

    That makes three packages where the co-occurrence product is the binding
    constraint (sugarcane at Kuk, teff in Ethiopia, sunflower in the Eastern
    Woodlands), each held off by an exclusion argued in a comment. **The
    product is the right rule for a founder set that had to be gathered
    together and the wrong rule for a complex of crops domesticated
    independently, and the code has only the first kind of package.** A
    second kind — members as alternatives, rich where ANY is rich — is
    unspecified and unbuilt; recorded as the honest next question, not
    designed here. QUESTIONS #69.

    **Verification.** lint, `npm test` (smoke, parity, byte-identical
    save/load), `gate:people` → `pass` at dev with the W5 SOLVE arm, all on
    this bake; the range, stand and hearth-site figures are substrate probes
    with no history simulated. The manifest keeps all 61 rows: none added,
    removed or re-banded, three refreshed where the bake moved the
    measurement their reason describes — the outside tubers ignition left
    the lower Orinoco (a cell that was cassava's, not wild manioc's) for
    eastern Brazil at −4114, the Indus box holds rice, and
    northwest-neotropics still fails but now against the wild plant's real
    distribution, which is a finding about a MISSING PACKAGE (the region's
    domesticates are arrowroot, leren and yam bean) rather than a defect to
    tune. No shipped-grid arm was run; the tubers range lost eleven twelfths
    of its cells, so one is recorded as needed. QUESTIONS #69,
    `spec/handoffs/W16-the-taxon-we-name.md`.


## Proposed — working design, awaiting explicit ratification

- **P16. The true reduced grid** (replaces the withdrawn 31(c); measured
  2026-09-05, DECISIONS 33, QUESTIONS #61). `n_row = max(1, floor(width ·
  cos(lat)))` — a row holds as many cells as fit at one cell-height each, so
  a cell is never narrower than it is tall. A mechanism, not a fitted
  constant: rounding DOWN is what puts the aspect on the safe side of 1, and
  it self-calibrates at any grid height, on any map. Measured worst aspect
  0.998; it doubles the shipped-grid migration stride (24 → 48 months),
  which is what 31(c) promised and did not deliver, and it makes 31(d)'s
  anisotropic flux free (bound 2.689 years, exactly today's stride). The
  cost is that it is a TRUE reduced grid — arbitrary run lengths, so
  adjacent rows disagree everywhere — and the fixed eight-slot stencil the
  TS oracle and the Rust kernel share cannot express a merged cell's several
  northern neighbours. It changes what a cell IS, reaching the land packing,
  the adjacency structure, persistence, the kernel's per-row cell area, and
  the renderer; and its payoff cannot be confirmed end-to-end without a long
  arm, which the dev loop forbids. Ratification is the owner's.

- **P8. Glacial-coastline peopling wavefront** (owner question 2026-09-01,
  QUESTIONS #27). Bake an LGM land mask (ETOPO altitude > −120 m — the
  bathymetry is already in the source data) and let `generateAncestry`'s
  pre-history wavefront walk the real ice-age coastline: Beringia,
  Sundaland, Sahul and Doggerland become actual land, and the tuned
  strait-pricing proxies (`ANC_OCEAN_STEP` / `ANC_HOP_FREE`) relax into
  physics. Bake-side only — no live sea level; replaces dials with data
  (R2/R7). Not needed for M2: the proxies already yield the correct
  peopling extents and ordering that its gates consume.
- **P17. Routed catchment runoff as water access** — ~~proposed~~
  **BUILT as W13 (2026-09-05, owner: "so we need water runoff"; see 34,
  `spec/handoffs/W13-runoff.md`)**. (W12 raster finding, QUESTIONS #64,
  2026-09-05.) The substrate carries water in three forms —
  the cell's own rainfall, the floodplain ribbon of a large river, and a
  channel magnitude on a 0–4 scale of which 89 % of land reads 0 — and
  none of them is "a wet catchment drains onto this dry cell". That is
  what an oasis is, and it is what farmed Jeitun, Sang-e Chakhmaq,
  Mehrgarh and Tepe Yahya by −7000 to −5500: mountain runoff over an
  alluvial fan. In the sim those cells read the moisture floor (0.02) and
  water access 0.02, so wheat capacity is 0.13–0.21 persons/km² against
  3–19 in Europe, the front crosses the plateau at 0.16–0.30 km/yr, the
  Indus is reached ~2,400 years late and Jeitun and Mehrgarh are never
  farmed (arrival:indus:solve:target). The worldgen already computes flow
  accumulation (it sizes the floodplain ribbon by it); the mechanism is to
  route each cell's catchment precipitation down it, less an evaporation
  loss, and count what arrives as water access — a runoff coefficient and
  a loss rate, both physical quantities, no place named. It lifts every
  piedmont on every map and nothing else. It is the substrate's, it moves
  the world hash at both grids, and it is NOT to be substituted by raising
  the moisture floor or the plateau's fertility (second cardinal rule).
  The data-side half — the 1.9 ° climatology averaging a range's wet
  slope with the basin at its foot (the NCEP cell over Shahroud reads
  95 mm/yr) — is recorded in #64 and is P18. As built, the routing reads
  the worldgen's own per-tile runoff and flow directions with one
  constant, a 10 km channel strip; measured at the shipped grid on the
  substrate alone, it waters the Nile, the lower Indus, the Ganges, the
  Oxus and the Tarim and leaves the plateau sites at the floor, because
  their catchments are empty in the table — so P17 alone does not move
  the Indus row, and the shipped-grid re-measurement is `v2-long` on
  request.
- **P18. Sub-grid orographic redistribution of the coarse precipitation** —
  ~~proposed~~ **built as W14** (DECISIONS 35, 2026-09-05; W13 finding,
  QUESTIONS #65). The Earth preset's moisture is
  a quantile map of the 1.9° NCEP/NCAR precipitation, and a range narrower
  than a cell — the Kopet Dag, the Alborz foot, the Sulaiman, the Makran —
  is averaged with the basin at its foot and smeared into its desert. With
  P17 built, that is now the whole of the plateau sites' deficit: routing
  finds nothing in their catchments to route (Jeitun's water access
  0.02 → 0.07, Mehrgarh 0.02 → 0.12, Sang-e Chakhmaq 0.02 → 0.02; wheat
  capacity 0.11–0.14 → 0.13–0.15 persons/km²), while every site under a
  resolved catchment gets its water. The physical remedy is on the data
  side: redistribute each coarse cell's precipitation over the fine cells
  inside it by their elevation anomaly against the coarse mean — an
  orographic enhancement per metre of relief, one coefficient with a
  citation — CONSERVING the coarse cell's total, so no rain is invented,
  only placed on the slope it fell on. (**The reference in that sentence is
  superseded by W15**, DECISIONS 36: an anomaly against the coarse mean has
  no aspect, so it lifted a lee slope exactly as much as a windward one.
  The built term now references the elevation one footprint half-width
  UPWIND along the month's own wind — the height the air climbed — with the
  same gain, clamp, footprint and conservation.) No place named; it lifts every
  range on every map and nothing else. It is the substrate's, it moves the
  world hash at both grids, and it is not to be substituted by raising the
  moisture floor, the runoff floor, or the channel strip (second cardinal
  rule). Built as proposed, one gain and one clamp with citations, the
  footprint the widest odd box inside a table cell, the total conserved —
  and measured at the target grid it moves every wet range and NOT the
  plateau sites (0.02 → 0.02), because the quantile map's floor band (the
  driest 26 % of land at one value) absorbs the share before it reaches the
  solver's moisture. The Indus target row therefore stays a miss under W14,
  now placed at the floor band — a data-side ruling for the owner
  (QUESTIONS #66) — and neither the floor nor the gain is lifted to reach
  it.
- **P19. The crop fit splits: annual share for the wild stand, harvest-cycle
  grade for the farmed capacity** (W16 finding, 2026-09-06; QUESTIONS #70).
  `crop.ts` grades a cell as `fitSum / MONTHS_PER_YEAR` — the share of the
  year that is favourable — and hands the SAME number to two consumers that
  want opposite normalisations. For the wild stand that is correct and is
  W10's own finding: gatherers graze continuously, so eight good months feed
  more than five, and averaging over qualifying months alone scored a short
  Siberian summer as highly as a long Chinese one. For a HARVEST it is
  wrong: a crop occupies one cycle, and the months outside it are not part
  of the yield, so the model rewards a long season over a good one. Measured
  cost (dev substrate, technique 1): Cairo wheat 0.171 and third of six
  under the year share, 0.411 and first over the growing season; Luxor
  0.168/fifth → 0.289/second, above sorghum — and at Luxor both crops' water
  terms are identically `access` 0.401, so the entire sorghum-beats-wheat
  result on the Nile is season LENGTH. The proposal is the W15 pattern
  again: carry two fits, `/12` for `stand` and hearth site quality, a cycle
  grade for `packageCapacityAt`. It needs no Rust change — `crop_fit` enters
  Rust only at `package_capacity`, and the stand is TS-side.

  **It is Proposed and not built because three things are missing, and one
  of them is a trap.** (i) `/season` alone re-breaks W10 — millet's best
  stand moves from the 7-month Balkhash cell to a 6-month one and the loess
  falls 3rd → 5th — which is what forces the split rather than a
  replacement. (ii) **The cycle length is a datum this repo does not have.**
  `seasonMinimumMonths` is a growing-season MINIMUM by its ledger entry
  (§09:242) and is not the cycle; the result is acutely sensitive to what
  replaces it (a 6-month emmer scores 0.0000 at Cairo, a 5-month one tops
  the table), so **picking the length that makes Egypt come out wheat is a
  fitted outcome and is forbidden** (second cardinal rule). The length must
  be sourced as agronomy — days to maturity, per package, with citations —
  and the map is then whatever it implies. (iii) Perennials have no
  within-year cycle: under a cycle window highland-roots zeroes at Luxor,
  Cairo, Central Europe and the Sahel, and tubers on the lower Yangtze and
  the loess. A crop standing in the ground is graded by the year like the
  stand; an annual by its cycle. That is a second KIND of package — the
  same shape of gap QUESTIONS #69 records on the founder-set side — and it
  is unspecified.

  **Blast radius, so this is not mistaken for tuning.** The naive `/season`
  lifts global best-package capacity only ×1.082, but changes which package
  is best in 25.1 % of farmable cells (1641 of 6529). Forecast under a
  candidate cycle table: south China and the lower Yangtze both go clearly
  to rice, the loess millet 4th → 2nd (its real fast maturity is absent from
  the model today, since millet carries wheat's 5-month minimum); Central
  Europe goes to eastern-seeds and Mexico is still not maize. Not measured
  at the shipped grid.
- **P15. The frontier growth rate** (W7 finding, 2026-09-03). The
  farming front is a pulled wave whose speed is 2·√(r·D) of the farmer
  group's own uncrowded growth; the kernel reproduces that to two figures
  on a flat field (0.53 km/yr at the shipped grid) and the shipped-grid
  Europe is late because `PEOPLE_R_GROWTH_PER_YEAR` (0.28 %/yr) is the
  crowded long-run average, which the logistic term already produces from
  an uncrowded rate. A colonising Neolithic population grows at ~1 %/yr
  (Bocquet-Appel 2002, the Neolithic demographic transition; Ammerman &
  Cavalli-Sforza 1984). Re-grounding r on the uncrowded rate would put the
  front at ~0.8–1 km/yr at both grids and lift the population curve toward
  capacity faster, which M3b's mortality then has to pay for; the owner
  rules on the order.
- **P10. Paleoclimate anomaly track** (review, 2026-09-02). The sim
  applies today's climatology from 9700 BCE; the Sahara was green from
  ~9000 to ~4000 BCE, with lakes, herders, and the first Nile settlers
  pushed out of it as it dried, and the 8200 BCE cold event pushed
  farmers into Europe. A dated anomaly track (temperature/precipitation
  deltas by region and millennium, from paleoclimate reconstructions) is
  an exogenous forcing under R1 — a boundary condition like the observed
  climate, never a gate — but it breaks the immutable-substrate doctrine
  the same way P9 does, so the shape is epoch-staged rebuilds (can-grow
  LUTs and capacity recomputed at a stage). Wanted before M3b: famine
  geography in North Africa depends on it.
- **P9. Holocene sea-rise epoch staging (Phase 2+).** The YD→6kya rise
  falls inside the simulated window (the Persian Gulf fills; Doggerland
  and Sundaland drown ~8kya). A sea-level track is a legitimate
  exogenous forcing under R1 — a boundary condition like the observed
  climate, with mechanisms responding to the water, never the date —
  but a dynamic coastline breaks the immutable-substrate doctrine, so
  the shape is epoch-staged substrate rebuilds keyed on (data identity,
  sea level). Pull forward only when a gate or play-test demands it;
  M2's gates are insensitive at their stated tolerances.

These are in the specs as the working design; the owner has not explicitly
ruled on them. Veto or amend freely; specs will follow.

- **P1. Behavioral doctrine: pressure and selection, not rational
  calculation.** Actors' rates drift under local pressures; variation comes
  from ruler traits and dynasties; selection (death of misruled polities)
  does the optimizing. Discrete acts (declaring war, granting a charter)
  are hazard rates driven by the same pressures.
- **P2. The community is the atom of the ruled.** Compliance, unrest, and
  legitimacy are booked per community (village-scale aggregate condensed
  from the population field), not per individual. Individuals are rendered
  texture, except historically load-bearing persons (rulers, founders).
- **P3. Centers condense at a salience bar.** A "local lord" becomes an
  entity only where controlled mass crosses a threshold; below it, lordship
  is texture in the authority field. Same condensation principle as
  villages.
- **P4. Map honesty.** The canonical political map renders authority as it
  is: solid at cores, fading through sworn lands, blank where no one rules —
  hard crisp borders emerge only with late-Phase-1 state capacity. A
  simplified "dominant authority" lens exists for quick reading.
- **P5. Institution portfolio.** ~~Proposed~~ **RATIFIED via DECISIONS 8b**
  (institutions are administration-domain techniques; see 11).
- **P6. Non-territorial authority networks** (organized religion; later,
  leagues like the Hanse) are first-class actors in the obligation graph.
  Scope question open: full actor class in Phase 1, or v1-style faith
  fields + pilgrimage economy until M6 validates.
- **P7. Names.** Generated names (language engine) are canon on the
  alternate Earth; an optional real-geography gazetteer overlay exists for
  orientation, styled clearly as annotation, never as world content.
