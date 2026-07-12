# One population — settlements are concentrations, not containers

Status: **ruling adopted (owner, 2026-07); slice A built (T.FIELD_DEMOG);
slices B–C specified below.** Successor to the two-population rule at the end
of docs/settlement-ontology.md, which this supersedes as the DESTINATION
(the two-population discipline remains the law of the land until each slice
lands — never sum the two numbers in code that predates its slice).

## The ruling

There is ONE population: the people-on-land field (`popField`). Settlements
are retired as the demographic atom — a settlement is a CITY: a high
concentration of that same population which does specific things (markets,
courts, crafts, walls). The census (`s.people`) is ultimately a VIEW — the
field sampled at the city — not a second stock of people.

This is the field programme's own declared destination (popField.js phase
notes; docs/field-polity-spec.md; ontology V4), now made explicit.

## Why staged (the chasm)

`s.people` is read and written across the entire economy (production, food,
taxes, muster, casualties, tiers, Zipf — hundreds of sites), and the whole
calibration rides its magnitudes. A one-shot swap would be un-validatable.
Each slice below is lever-gated, byte-identical off, probed, and passes the
stylized suite before its default flips — the same discipline every field
migration (POW_FIELD, LOYAL_FIELD, DEV_FIELD) moved through.

## Slice A — demographic events live on the field (T.FIELD_DEMOG) ✅

Every event that adds or removes PEOPLE in the census is mirrored onto the
field around the settlement it struck, so the land is the honest record of
demographic history (and the Population lens shows devastation):

- plague mortality (shocks.js), famine die-off (settlement.js)
- the sack's captives carried off (armies.js), razzias (slavery.js),
  horde captive-trains (conquest.js)
- revolt/riot ravage deaths (conquest.js)
- coerced-labour deaths and losses (settlement.js)
- captive ARRIVALS — the forced-migration inflow (settlement.js
  arriveCaptives): the plantation coast gains the people its market bought

Mechanics: `fieldShift(world, s, ±n)` (popField.js) — losses drain the home
tile then cascade outward ring by ring (the countryside those people lived
in), clamped at zero and bounded; gains land on the home tile (arrivals
concentrate). Deterministic walk order; no RNG.

KNOWN LIMITS (accepted for A):
- Census and field are not yet reconciled numbers, so a dent is
  proportional, not conserved to the person. Voluntary movements (colonist
  ships, town founding, the urbanise drift) are NOT mirrored — they move
  people between census sites while the field's own migration models the
  countryside; B unifies them.
- The field's phase-1 peopling rate (POP_GROWTH 0.03/step ≈ 12%/dyn-year,
  ~5–10× human natural increase) refills a one-off dent within a few
  dyn-years. So slice A buys: the PLUMBING (every event site wired), the
  CRISIS-WINDOW dip every field consumer feels (1–2 polity passes), and
  structurally thinner land under RECURRING drains (the endemic razzia
  coast). Lasting scars arrive with B, when the field takes ownership of
  demography and its rates become human ones (the census's demographic-
  transition machinery moves over with it).

## Slice B — the city is a concentration OF the field (BUILT, lever off — T.ONE_POP)

STATUS (measured, 480×240 / 21k / 3 seeds): mechanics complete and clean —
determinism, save/load hash identity, +1000-step continuation 3.2%, smoke
green, ALL hard stylized gates pass on 3/3 seeds. NOT default yet: two
consistent soft warnings (2/2 budget — the bar is zero):
  • Zipf slope −0.48..−0.66 (envelope −0.8..−1.2) — city sizes too uniform;
  • urbanization 56–64% in the agrarian era (band 2–25%) — cores absorb
    most of their region.
ROOT CAUSE, identified and FIXED in the same arc: the urban spike was the
RESIDUAL between two different food models (farm-model K minus field
terrain capacity) — mostly model mismatch × region size, so every core
was overweight and near-uniform (56–64% agrarian urbanization, Zipf
−0.48). Rebuilt as the IMPORT-FED share of one model (foodK × the
hierarchy-grain share, _foodNet − _landFood over _foodSupply): a self-fed
farm town concentrates nothing beyond its tile; a grain-importing hub
concentrates exactly what it ships in. Measured after: urbanization
26.2%/in-band/in-band (band 2–25%), city counts 18–23 (baseline-like),
Zipf −0.60/−0.70/clean — 4242 at ZERO warnings, 31337 at one, 8817 at
two. REMAINING before the flip (bar = zero on all three): the last of
the Zipf flatness.

### The Zipf tail: diagnosis + the dead ends (measured, do not re-walk)

The blocker is the city-size Zipf slope (suite reads −0.56/−0.67/−0.69;
envelope −0.8..−1.2 — city sizes not heavy-tailed enough). Confirmed root
cause: the great cores are chronically UNDERFILLED — generic 4-neighbour
field diffusion fills a city core at fill ratios 0.07–0.51 of its capacity,
so spike SIZE (which carries the heavy-tailed import economy) decouples
from population; every big city fills at the same throughput-limited rate →
flat distribution. Two dead ends explored and rejected:

1. **Catchment urban pull** (each core draws field-people from its whole
   territory toward `(1−ruralShare)×catchmentPop`): STABLE, fixes the
   underfill, urbanization tracks the calibrated ruralShare (19–27%, good)
   — but the target is ~uniform (territory is Voronoi-even) so it does NOT
   create the tail (Zipf −0.56/−0.67/−0.69, a wash vs generic diffusion,
   and a slight regression on 4242). Correct mechanism, wrong for the tail.
2. **Preferential inter-city concentration** (cores shed surplus along
   trade routes to the biggest hub — the primate-city dynamic): creates the
   tail but is UNSTABLE at every rate tried (even 0.002) — driven by hub
   size it runs away (Zipf −1.8..−2.5, the pack consolidating into 2–3
   metropoles) because the import-fed ceilings never bind; driven by the
   source ratio it death-spirals small cities to zero. Chaotic across seeds
   (couples to the settlement lifecycle: drained cores → deaths →
   consolidation).

KEY POSITIVE finding: the import-fed spike CEILINGS are themselves Zipf
(−1.5, census units 13600→50 over 18 importing cities). The tail EXISTS in
the economy; the unsolved problem is translating it to population WITHOUT
runaway. THE MECHANISM TO BUILD NEXT: a tightly-BINDING urban ceiling —
scale the spike so a city's real import capacity is reached and STOPS
growth there (the ceiling then brakes any concentration flow, and the
heavy-tailed ceilings become the heavy-tailed sizes). The current spikes
are ~2–14× too large to bind, which is why fill ratios sit at 0.07–0.51
and nothing caps the primate pull. Calibrate the spike magnitude first
(so median fill → ~1), THEN a gentle preferential pull is self-limiting.

What is already true under the lever: the field owns demography (human
rates; the transition/graveyard bend stamped per core), the 3000 BC world
starts at its Malthusian equilibrium (the peopling sparks were the wrong
initial condition once rates are human), urbanise() and the census
logistic retire, founders/colonists move ON the field, s.people and
s._urbanPop are derived reads, and a settlement's death no longer erases
its region's people.

The heart of the unification:

1. **Urban capacity**: a city tile's carrying capacity stops being cropland
   arithmetic and becomes URBAN capacity — housing + the food its market
   actually imports (the existing housing/food machinery, read as a
   capField spike at the city's footprint). Cities become exactly what the
   ruling says: places where capacity — and therefore people — concentrate.
2. **Urbanization is field flow**: the field's capacity-seeking migration
   INTO the urban spike replaces the census-side rural→urban drift
   (urbanise) and the settlement growth clock — one demography, one
   migration.
3. **The census is derived**: `s.people` := field integral over the city's
   footprint, recomputed per tick like any view; every economy consumer
   keeps reading `s.people` and never knows the difference.

Gates: Zipf (city sizes now emerge from field flow), urbanization share,
food/production calibration, muster. This is the big one — its own arc,
possibly several, with a bridging lever per step.

## Slice C — the last census-based NATIONAL reads (ontology V4)

Muster manpower, substantiality, aliveness — Σ-member-pops reads move to
field integrals over held land. Mostly falls out once B exists; listed in
docs/settlement-ontology.md §V4.

## Invariants

- Emergent only: no clocks, no named regions, no fitted outcomes.
- Every slice: lever + probe + hashbase lineage + stylized 3/3 at zero
  warnings before its default flips.
- Until B lands, the two-population rule holds for all pre-B code: the
  census is the economy's number, the field is the nation's substance,
  and they are never summed.
