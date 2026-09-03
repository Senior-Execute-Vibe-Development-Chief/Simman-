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
    on can-grow rows, farmer growth, adoption, cohort ageing — about 84
    months expected at both grids, printed, never set); foragers grow in
    place without hopping (their opening fill is a uniform fraction of
    capacity, so their diffusion carries no net mass to first order; the
    second-order effect is measured by an agreement arm, never assumed);
    conductance at the annual mean. The world WAKES into the monthly
    regime at the first caged basin: the first hearth-law window whose
    free farmable share falls below the ledger's caging knee — M4's own
    precondition (Carneiro), so M4 inherits the trigger instead of
    redefining it. Sub-rulings: (a) the wake is a state trigger;
    `config.wake` (auto / never / a year) is an initial condition like the
    seed, read by nothing after the switch; a chosen year later than the
    trigger is the player knowingly accepting the solve past its
    validity, and provenance says so. (b) The window is the hearth-law
    basin until M4 derives its flight radius (the forager diffusion length
    over a generation is the candidate); then the wake follows that
    derivation. (c) The scrubber's prehistory frames are a rendering
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

## Proposed — working design, awaiting explicit ratification

- **P8. Glacial-coastline peopling wavefront** (owner question 2026-09-01,
  QUESTIONS #27). Bake an LGM land mask (ETOPO altitude > −120 m — the
  bathymetry is already in the source data) and let `generateAncestry`'s
  pre-history wavefront walk the real ice-age coastline: Beringia,
  Sundaland, Sahul and Doggerland become actual land, and the tuned
  strait-pricing proxies (`ANC_OCEAN_STEP` / `ANC_HOP_FREE`) relax into
  physics. Bake-side only — no live sea level; replaces dials with data
  (R2/R7). Not needed for M2: the proxies already yield the correct
  peopling extents and ordering that its gates consume.
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
