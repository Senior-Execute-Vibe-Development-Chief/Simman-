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

UPDATE (binding-ceiling attempt measured — see "dead end 3" below): the
documented "tightly-binding ceiling / calibrate spike so median fill → 1"
next-step was built and swept, and it does NOT get there. Magnitude scaling
can't drive median fill to 1 (pop falls with cap; binding and a heavy tail
are in tension), the heavy tail lives only in the region-scale economic
import capacity that a single field tile throughput-clips, and the economic
ceiling (−1.5) is steeper than the target (−0.8..−1.2) so the solution is a
noise-dominated partial bind — seed 8817's Zipf sticks at −0.56..−0.65 for
every spike scale. Best measured (K≈0.50) fixes urbanization on all three
and reaches ZERO warnings on 31337 & 4242 but leaves 8817's Zipf warning,
and any passing value would be fitted. STILL lever-off, byte-identical. The
one untried mechanism (multi-tile urban footprint) and the pivot options are
at the bottom of the dead-ends section.

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

### The binding-ceiling attempt: measured, and why it is stubborn (dead end 3)

Built the calibration (`URBAN_SPIKE_K`, a multiplier on the spike magnitude)
and swept it against the REAL stylized gate, 3 seeds. Two hard results:

1. **Magnitude scaling cannot make median fill → 1.** Shrinking the spike
   shrinks the tile ceiling, but the field's single-tile diffusion inflow
   drops WITH it (a smaller ceiling has less spare, so it pulls fewer
   migrants and its logistic saturates sooner) — so `pop` falls almost as
   fast as `cap`, and the fill ratio barely moves (median 0.18 at K=1 →
   0.20–0.37 across the whole sweep; only K≈0.05 reaches ~0.75, and there
   the economy is so unconcentrated the ceilings compress to ~12× and Zipf
   goes SHALLOW, −0.60). The "median fill → 1" target is unreachable by
   magnitude alone: binding and a heavy tail are in direct tension.
2. **No spike scale passes 3/3 at zero warnings; a value that came close is
   fitted.** Real-gate Zipf (urban cores, the flip statistic):
   K=1.0 → −0.56 / −0.67 / −0.69;  K=0.65 → −0.65 / −0.65 / −0.67 (all
   fail); K=0.50 → **−0.56 / −0.76 / −0.72** (31337 & 4242 hit ZERO
   warnings, and urbanization returns to band on all three — a real gain
   over K=1's 26% overshoot — but **seed 8817 is stuck at −0.56..−0.65 for
   every K tried**). Its city sizes are genuinely more uniform; no spike
   magnitude moves it, because the limiter is the single-tile THROUGHPUT
   CLIP, not the ceiling magnitude. Picking K to pass would be a fitted
   constant (median fill still ~0.2 → the "binding ceiling" physical story
   never actually holds) — cardinal rule 2. Not flipped.

**Where the tail actually lives (measured), and why the tile can't hold it.**
The heavy tail is ONLY in `s._k × importShare` — the economic import
capacity (census units, Zipf −1.5). importShare *alone* is a modest fraction
(median 0.13, max 0.45 → `φ/(1−φ)` never exceeds ~0.8, no tail), and core
terrainCap is near-uniform (~3700, bar fertility artifacts). So the derived
per-tile density spike `terrainCap × φ/(1−φ)` — the one formulation with no
fitted constant — FAILS: it lands ~100× too small to bind (median 517 vs a
reachable core pop ~94k) and carries no tail. The tail is a REGION-scale
economic quantity; 4-neighbour diffusion can only deliver it to ONE tile,
where it throughput-clips (the −1.5 ceiling flattens to the −0.6 the gate
reads). And the economic ceiling being STEEPER (−1.5) than the target
envelope (−0.8..−1.2) means the honest answer is a PARTIAL bind between
full-clip (−0.6) and full-bind (−1.5) — a balance point that is
lifecycle-noise-dominated (±0.1–0.15 across seeds), which is exactly why
8817 won't hold still. (Diagnostic: `tools/probe_onepop_fill.mjs`.)

**The one untried mechanism that could un-clip without runaway** (if ONE_POP's
Zipf is pursued further): a MULTI-TILE urban footprint — a metropolis
occupies more tiles than a town (real sprawl), so the region-scale economic
ceiling binds PER TILE across a size-proportional footprint instead of
piling onto one throughput-clipped tile. Distinct from both documented dead
ends (catchment pull spread over the whole Voronoi territory → uniform;
preferential inter-city pull → runaway) and from magnitude scaling. Risk: it
conserves the ceiling total, so it may over-steepen toward −1.5 unless the
footprint is geographically bounded, and it couples to the settlement
lifecycle (drained neighbours → deaths) — re-measure city COUNT, not just
slope. Otherwise the clean queue stands (ontology V3 region-first secession;
the horde force multiplier), and ONE_POP stays lever-off, byte-identical,
with every non-Zipf gate already passing 3/3.

### The agglomeration↔congestion mechanism (BUILT, lever off — T.URBAN_AGGLOM/URBAN_BETA)

The breakthrough on the WHY: all four dead ends above fail because they get
Zipf's actual generative mechanism half-right. Real rank-size law is not a
fixed ceiling that cities fill — it emerges from INCREASING RETURNS (a bigger,
denser city is more productive, so it attracts more — people flow UP the
density gradient, the opposite of the field's peopling diffusion) balanced by
CONGESTION (crowding cost rising super-linearly with density), the balance
applied scale-independently (Gibrat) → a power law. The field diffuses people
toward EMPTY land (down-gradient, throughput-limited); urbanization is
anti-diffusive. Dead end 2 had the agglomeration pull with no congestion brake
→ runaway; dead end 3 had a hard ceiling (a brake) with no pull → uniform.
Neither is Zipf; Zipf is the EQUILIBRIUM of the two.

Built as a CONSERVATIVE concentration (popField.js): each region moves people
between its CORE tile and its own countryside (owned tiles only — no people
created/destroyed, so this IS urbanization, the rural↔urban split) toward an
agglomeration target. The total urban population is set by the ECONOMY
(Σ import-fed capacity — how many non-farmers the food surplus supports, so
urbanization is an OUTPUT, not a knob), and that total is DISTRIBUTED across
cities by a β-COMPRESSED share of each one's import capacity: share_i =
pull_i^β / Σ pull^β. β<1 is the congestion compression (β=1/γ, γ the
congestion elasticity) — it turns the heavy-tailed (−1.5) import economy into
a −β·1.5 city-size law WITHOUT changing the total (Σ share = 1 for any β).
This is the one thing linear spike-scaling (dead end 3) mathematically could
NOT do: a linear multiplier cannot change a power-law slope; only a sublinear
power transform can. Capped at 90% of a region's own people (a city lives
within its hinterland — bounds the feedback, no runaway).

MEASURED (480×240 / 21k, real gate): it WORKS on the core blocker — it breaks
the throughput clip (median core fill 0.18 → 0.83, the ceiling now binds) and
β cleanly controls the slope. At URBAN_AGGLOM=0.13/β=0.72 the previously-STUCK
seed 8817 finally lands its Zipf IN band on the real gate (the first mechanism
to move it), and 4242 is clean at ZERO warnings. NOT flip-ready yet:
  • seed 31337 is noisy — Zipf −0.54 where the same config gives 8817/4242
    in-band (the share distribution is sensitive to each seed's importer
    structure), and its urbanization rides high (~31%);
  • the aggressive redistribution perturbs the POLITICAL gates (empire-area
    tail 3.0, fallen-lifespan) via the settlement-lifecycle coupling
    (drained cores → deaths → consolidation — watch-item a, now live);
  • β is a free lever; its honest home is the urban-graveyard mortality-
    density curve (settlement.js URBAN_GRAVEYARD_W is currently FLAT — make it
    rise with density and β = the mortality elasticity, self-calibrating and
    less seed-noisy).
So the mechanism is the right shape (it generates the tail from the real
cause, self-limiting) but needs a further arc: ground β in mortality, bound
the flow so it stops destabilising the political layer, and damp the
per-seed variance. Lever off = byte-identical (8817=f925a9f, 31337=fd5cb49c,
proven vs clean src); URBAN_AGGLOM=0 recovers the pre-agglomeration ONE_POP.

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
