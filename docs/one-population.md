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

## Slice B — the city is a concentration OF the field (NOT BUILT)

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
