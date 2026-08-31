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

## Proposed — working design, awaiting explicit ratification

*(empty — all proposals ratified as of round 14)*

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
