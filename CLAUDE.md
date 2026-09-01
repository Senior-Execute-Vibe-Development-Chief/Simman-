# Simman — working notes for future generations

This is a procedural world generator and **emergent** civilization simulator.
Nothing is scripted; every empire on the map is the output of local rules. Read
`README.md` for architecture, and `docs/` for design plans. Run `npm test`
(smoke: determinism, invariants, save/load) before pushing. The v1
`npm run validate` and `npm run resgate` tools remain available for manual
diagnostics; v2 changes use the acceptance suite in `v2/`.

If you ADD STATE to the world, also run `npm run coverage`: it proves, by
perturbation rather than by name-matching, that every measurable property is
reachable from `collect()`. New state is measured by default — the exclusion
list fails open — so this fails until the state is either reached or explicitly
named as pass workspace.

If you ADD A METRIC, also run `npm run monotone`: a count of things that have
happened cannot decrease, and it fails on any metric whose NAME claims a
cumulative history while its value falls. That is not hypothetical — `life.*.died`
counted records *currently* marked dead, restoration cleared the flag, and "no
realm has ever died" was reported for a session while realms were dying. When it
fires, ask whether the name or the measurement is wrong; renaming to a claim the
metric can keep (`endedNow` vs `endedEver`) is usually the fix, and an exceptions
list usually is not. See `docs/observability.md`.

---

## WHAT THE NUMBERS MEAN — read before quoting any of them

**A SETTLEMENT IS A CITY — or a community growing into one. NEVER a mere village
or market town.** (Owner directive 2026-08-05, `DISSOLVE_TOWNS` default-on: an
entity mints only where the basin can feed a ~10k-person urban core, and one whose
basin decays fades back into the countryside.) Villages and towns are not entities —
they are **implied in the land**, carried by `popField` (people-on-land) and by each
city's belt (`_ruralPop`). A settlement's TIER label (village/town/city/metropolis
under `CITY_CORE`) is its measured urban-core size on the way up that arc — a
tier-0/1 entity is a *growing city*, not proof the village register exists.

So the entity count is the CITY register: a dawn world holds ~10 (the hearth
cradles — 3000 BCE Earth held about a dozen cities), an iron-age one ~100, most
labeled city by then. A realm holding 2M km² with four members is administering
four **urban provinces** — the register real empires used (~20-30 Achaemenid
satrapies over 5.5M km²; ~10 Roman provinces rising to ~50 under Diocletian; ~100 Han
commanderies). Pre-flip history (the "230 cities and large towns" register) is
reachable byte-identically with `CITY_CORE=0, CROWD_FOUND=0, DISSOLVE_TOWNS=0`.

**POPULATION IS IN SIM UNITS. 1 sim-person = 1,000 people** (`POP_SCALE`, defined in
`src/sim/units.js` and imported by both the UI and the metric collector). A settlement
showing `people = 4422` holds **4.4 million people**.

There are THREE population scales in this codebase and confusing them is the single
most repeated mistake in its history:

| | what it is |
|---|---|
| `settlement.people` | sim units — **× POP_SCALE for people** |
| `popField` | people-on-land, a *different* internal scale |
| `_onePopScale` | the bridge between those two, ≈0.001-0.003, drifting |

**And `s.people` is not the city — it is the CATCHMENT.** Under `ONE_POP` the census
is derived from the field over the settlement's worked catchment: `s.people =
Σ popField(catchment) × _onePopScale` — the city *and* the villages it farms.
`s._urbanPop` is the city alone; `s._ruralPop = s.people − s._urbanPop` is its
countryside. So a settlement showing `people = 4422` **stands at the centre of** 4.4
million people; it does not house them. Three things follow, all of which have already
caught someone:

- Σ `s.people` is the population of the catchment-**covered** world (settled, worked
  land) — not the urban population, not world population.
- **Urbanisation must be read off `_urbanPop`.** Taking Σ`s.people` over the field
  converted at the global census/field ratio returns exactly 100% — a tautology, since
  that ratio is *defined* to make the two equal.
- A census bar on a settlement is a bar on its **catchment**, so compare it to a
  region's population, not to a city's. `NUCLEATE_SEAT_POP = 160` is "the seat's city
  and countryside together hold 160,000" — the bar is still measurably unreachable (no
  stateless city clears it at any checkpoint), but say what it is a bar *on*.

`npm run observe` prints the real-people figure first and labels the sim units as
such. In the metric map, quote **`pop.people`**, `pop.largestCity`, `pop.perKm2` —
never `pop.censusSimUnits` or `pop.fieldUnits`, which are named for their units
precisely because they are not headcounts.

Forgetting this produced two published-then-retracted findings in one session: "the
world has 1000× too few towns" and "the world holds 32M people, its largest city
smaller than Çatalhöyük". True figures: 135M and a 4.4-million-person metropolis.

---

## THE CARDINAL RULE — everything must be emergent

> **Never, ever gate a specific event, capability, transition, or behavior on a
> point in time — not ticks, not the calendar year, not a fixed "era" boundary.
> EVERYTHING has to emerge from the world's underlying STATE.**

A thing happens because of **what the world has become** (development, technology,
population, local conditions, accumulated history) — *never* because of **when it
is** (step N, year Y, era E). If you ever find yourself writing "after step X" or
"once it's the modern era" or "by year 1500", stop: that is a bug in waiting.

### Why this is absolute (learned the hard way)

- **It's the entire premise.** "Nothing is scripted." A time-gate *is* a script.
  It hard-codes a story instead of letting one emerge, and it produces
  anachronisms (a thing firing in a world that isn't ready for it).
- **The calendar decouples from development — the "two-clock" trap.** The displayed
  year advances on a fixed linear clock; the world's actual development advances at
  its own emergent pace. They drift apart by thousands of years. *Anything* keyed on
  the year then fires at the wrong development level. Real bugs this caused here:
  the demographic anchor inflating population toward billions because the linear
  clock had passed "1950" while the economy was still medieval; "frontier closes
  with the modern era" firing by calendar while tech was bronze.
- **Emergent gating self-calibrates.** Gate on tech/development/conditions and the
  behavior fires exactly when the world is ready for it — on any map, any seed, any
  pace, forever. No re-tuning when the clock or the map changes.

### Right vs wrong

```
WRONG:  if (world.step > 12000) openFrontier()
WRONG:  if (stepToYear(world.step) > 1500) allowGunpowder()
WRONG:  if (era === "modern") x()              // where "era" is a span of time
WRONG:  const target = realWorldPopSim(stepToYear(world.step))   // anchor on the clock

RIGHT:  if (capital.knowledge.logistics > 0.6) extendReach()
RIGHT:  if (settlement.people > THRESHOLD) urbanise()
RIGHT:  reach = base + logisticsLevel * SCALE    // ramps with emergent tech
RIGHT:  pressure ∝ unrest, fiscal balance, identity grievance   // emergent conditions
```

### Corollaries

- **The calendar/year is cosmetic** — a read-only label for the player, *never* an
  input to a mechanic. The same goes for the displayed "era": it must be *derived*
  from emergent development (e.g. the leading civilization's knowledge), and only
  ever *read*, never used to *drive* anything.
- **Per-tick intervals are fine** — `step % INTERVAL === 0` to amortize a pass over
  ticks is a performance cadence, not a content gate. The distinction: it controls
  *how often code runs*, never *whether a piece of history is allowed to happen yet*.
- When in doubt, ask: **"Does this fire because of WHEN it is, or because of WHAT
  the world has become?"** Only the latter is allowed.

---

## THE SECOND CARDINAL RULE — build the SYSTEM, never fit the OUTCOME

> **Always create the emergent system from which a behaviour falls out as a
> consequence. Never reach in and produce the desired outcome directly with a
> shallow, special-cased fix. If a result is wrong, fix the MECHANISM that should
> have produced the right one — do not bolt on a patch that hard-codes the answer.**

The first rule bans gating on *time*. This one bans gating on the *answer*. A
simulation's job is to PREDICT — the empires, the rivers, the famines are
*outputs* you discover, not *targets* you dial in. The moment you write code that
detects a specific case and grants it the result you wanted, you have stopped
simulating and started scripting — just in space instead of time.

### The tells (how to catch yourself)

- **A constant with no independent physical meaning.** If `RIVER_UNIFY_FLOOR =
  0.85` exists only because it makes Egypt come out ~1M km², it is a fitted
  answer, not a mechanism. A real parameter means something on its own (a
  transport cost, a per-capita demand, a diffusion rate) and the outcome is
  whatever it implies — even if that surprises you.
- **Detecting the case you want to fix.** `if (onGreatRiver(s)) giveMoreReach()`
  reads "make THIS thing big." The question is never "is this Egypt?" — it is
  "what mechanism makes a cheaply-connected, densely-settled region cohere?"
  Build that, and Egypt (and the Indus, and the North China Plain, and maps you
  have never seen) fall out for free, with no name in the code.
- **Patching the symptom, not the cause.** When the cost model already prices
  rivers cheap but a realm still won't follow one, the bug is the *blunt throttle
  overriding the geography* — fix THAT, don't add a second override pointing the
  other way. Two wrongs make a fragile, over-tuned mess.

### Why this is absolute (learned the hard way)

- **A fitted outcome only fits the case you looked at.** Tune a constant to land
  Egypt and it silently mis-sizes every other river valley, every seed, every
  resolution. A real mechanism is right everywhere because it models the actual
  cause. (`RIVER_UNIFY` was tuned to the Nile at one resolution; it told us
  nothing about, and quietly distorted, everywhere else.)
- **Symptom-patches compound into un-tunable knots.** Each shallow fix overrides
  the last; the subsystem accretes special cases until no one can predict what it
  does and every change breaks three others. The codebase's own scars —
  "continental too early," "confetti," "hollow husk" — are layers of this.
- **Emergence is the entire product.** "Every empire on the map is the output of
  local rules." A hard-coded outcome is, by definition, not. If you have to name
  the result in the code, the system that should have produced it is missing —
  go build *that*.

### Right vs wrong

```
WRONG:  if (onGreatRiver(s)) reach = max(reach, FLOOR)   // make river realms big
WRONG:  if (region === "nile") fertility *= 3            // make Egypt fertile
WRONG:  clampEmpireSize(c, HISTORICAL_KM2[c])            // dial in the answer

RIGHT:  cost ÷= (1 + riverMag*K)   // a river is cheap to move along — and a
        // realm administered through that cost field follows the valley on its own
RIGHT:  settle where fertility×water is high  // the Nile densely settles itself,
        // and the political union of those settlements IS the valley state
```

- **When in doubt, ask: "Am I building the cause, or painting the effect?"** If you
  are reaching past the mechanism to set the result, stop and find the mechanism.
- **A surprising-but-mechanistic result beats a correct-but-fitted one.** If the
  honest system makes Egypt a city-state, that is a TRUE finding about a missing
  mechanism (here: river valleys don't densely settle yet) — surface it and build
  the missing system, don't paper over it with a constant.

---

## THE THIRD CARDINAL RULE — measure at the grid that SHIPS

> **Every gate in this repo runs at `W=480` (sim `tw=240`). The app ships `W=1920`
> with `simDiv 2` (Half, sim `tw=960` — owner default 2026-08; it was `simDiv 4`,
> `tw=480`, until the shape-of-the-map wave measured that the political map's
> small-state tier only exists at the finer grid). A mechanism validated only at
> the reference grid is unvalidated. Run `npm run resgate` before pushing anything
> that touches territory, population, the food economy, or politics — its app arm
> runs `tw=480` as the standing cross-grid proxy (a full `tw=960` arm is
> hours-scale; docs/shape-of-the-map-2026-08.md carries this wave's direct
> `tw=960` measurements), so anything with large territorial blast radius should
> ALSO be spot-checked at `tw=960` (`tools/probe_shape.mjs [steps] 1920 [seed]`).**

### Why this is absolute (learned three times in one week)

This is not a precision concern. At the two grids the same code can differ in
**KIND**, not degree — a mechanism can be inert at one and dominant at the other:

- **`deffdce`, the size-target re-grounding.** Cost 1.91% → 1.73% claimed land at
  `tw=240` — a 10% effect, passed every gate. At `tw=480` it took the median realm
  from **70 tiles to 7**. A 10× cut, and the owner saw it in play.
- **`b859db7`, `SUCCESSOR_STATES`.** Its own commit message records the measurement:
  *"0 secessions per 24k … the channels are live but atom-starved."* True at
  `tw=240`, where an orphaned patch is ONE settlement and the ≥2-member rule lapses
  it. At `tw=480` the same real patch holds several, so the identical rule fires
  constantly — 15 recessions in the first 2000 steps of a four-realm world. **It was
  validated in exactly the regime where it does nothing.**
- The whole `docs/resolution-collapse-2026-07-29.md` investigation, whose §6 asked
  for this arm and did not get it — which is why it happened twice more.

### Why the existing gates cannot see it

`npm run validate`'s empire checks are all **ratios** — largest empire's *share*,
area tail *largest/median*, polity *count*. **A world whose realms are uniformly 10×
too small passes every one of them.** The missing measurement is absolute real area,
compared across grids. That is what `tools/resgate.mjs` adds.

### Corollaries

- **A resolution-dependent constant is a bug, not a tuning value.** If a quantity is
  expressed per TILE, ask what it means per km² at both grids. `/r2` conversions
  assume the underlying field is exactly per-real-area invariant — verify that it is
  (it measurably is not for coast- and river-derived terms).
- **A "no effect" measurement at `tw=240` is not evidence of no effect.** It may be
  evidence that the mechanism cannot reach its own trigger at that granularity.
- The `resgate` bands encode a **known, open gap** (~1.3-2.2× capacity dilution from
  1-D coast/river terms). They are a ratchet to be tightened as that closes — never a
  target to tune toward. If a change improves them, re-baseline downward and say so.
