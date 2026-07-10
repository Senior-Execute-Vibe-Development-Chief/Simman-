# Settlement ontology — what a settlement may and may not be

Status: **rule adopted; violation 1 fixed (T.POW_FIELD, default on); violations
2–4 specified below, not yet built.** Companion to docs/field-polity-spec.md,
which carried the same programme for territory.

## The rule

A settlement is legitimate in exactly three roles:

1. **The economy's atom** — production, trade, food, coin, crafts, tax
   collection. Cities really are the atoms of an economy.
2. **A seat of government** — the capital (court, treasury, dynasty, tech
   vantage, projection source for reach/admin-cost walks), provincial seats,
   faith sees, garrisons, siege objectives. Government sits somewhere and
   projects from there.
3. **Population bookkeeping** — casualty distribution, census of who lives in
   towns (against the popField, which is canonical for people-on-land).

A settlement must never be the **substance of the nation** — what the nation
is made of, measured by, or transferred as. The nation's substance is the
LAND and its PEOPLE (fields): territory (`_countryOwner`), population
(`popField`), and — once built — loyalty/allegiance and homeland memory.

The test: *"is this reading the seat (legal), the economy (legal), or is it
using the member roster as a proxy for the land and its people (violation)?"*

## The four violations

### V1 — national power = Σ settlementPower over members ✅ FIXED

`T.POW_FIELD` (default on, conquest.js `fieldPowerOverlay`): the six national
aggregates (alliances/threat/blocs, colonial independence, submissions,
absorb dominance, enclave annexation, horde raid gradients) read GOVERNED
PEOPLE — popField over held tiles × the capital's mil·org — median-anchored
per pass to the entity sum so downstream ratio thresholds keep calibration
and unpriceable realms mix in the same units. Applied as an overlay so every
consumer keeps its exact entity-summed baseline (byte-identical lever-off).
Measured: 30/32 realms shift >1%, #1 changes hands, roster-heavy clusters
compress to 0.22×; validated 3 seeds (and it unblocked the W6-D nomad
revival — a horde's power is its people on the steppe, tools/probe_nomads.mjs).

Seat-level power uses stay entity-based on purpose: capital selection,
provincial governor weight (`provPower`), per-settlement coercion, casualty
spread, fragmentation seat ranking — those measure the SEAT or the PERSON.

### V2 — the populace's political feelings live on entities (NOT BUILT)

`s.loyalty`, `s.unrest`, `s._homeland` / `_homelandFell`, `s._conqueredAt`
describe the PEOPLE OF A REGION, not a government office. They belong on the
land/people layer:

- **Homeland memory** (land-anchored): a `_tileHomeland` Int32 field, sibling
  of the existing `_tileCapturedAt` (armies.js:386 — the in-repo precedent
  for tile-anchored political memory): which polity this ground last
  belonged to, stamped on transfer. Irredentism reads the field.
- **Allegiance/grievance** (people-anchored): carried in the population
  field's admixture, exactly as ancestry/culture already travel under
  T.SLAVE_PEOPLE — grievance moves with the deported; contentment grows
  where people prosper in place. Follow identityField.js transport
  semantics; do NOT invent a second advection scheme.
- Governor AMBITION stays on the seat (`_ambition`) — that is genuinely
  about the officeholder.

Consumers to migrate: loyalty budget, rebellion seeding, restoration,
identity grievance. Validation surface: rebellion/secession cadence, empire
mortality, fallen-lifespan gates — the same soft gates POW_FIELD moved
through. Lever + probe like every arc.

### V3 — political change transfers members, not regions (HALF BUILT)

War storms and peaceful absorption already move the FIELD under the default
levers (armies.js TILE_WAR fights on `_countryOwner`; conquest.js absorb
recolors). The member-first survivors are the **rebel / declareIndependence /
fragmentRealm / restoreNations / enclave** family (conquest.js ~1064–3140:
they write `s.countryId` and then patch the field).

Inversion: events transfer a TILE REGION (and, where relevant, CROWN a seat
— "this city becomes the successor's capital"); every settlement on the
region re-derives its flag from the ground (adoptAndFound already does this
derivation). **Depends on V2**: the seceding region's geometry should be the
contiguous disloyal patch around a seed seat — the loyalty field gives
secession its shape; today the member list is the only geometry available.

### V4 — the nation is enumerated as a member list (MOSTLY FALLS OUT)

`c.members` rebuilt per pass is fine as the ECONOMY's roster and the
casualty/tax census. The violations are the NATIONAL census uses:
substantiality (`members.length > 1`, entities.js:144 — should be field
integrals: territory area, popField integral, has-city-tier seat),
aliveness from settlement countryIds (legal if recast as "has a crowned
seat"), muster manpower from Σ member pops (should be popField over tiles —
armies.js:329). Do LAST; mostly reads, falls out once V1–V3 exist.

## Order and discipline

V1 ✅ → (W6-D revival ✅, consumed V1) → **V2 → V3 as a pair** → V4 cleanup.

Every arc: lever default-on only after gates hold; overlay/median-anchor
where a distribution shifts (the CAP-grounding pattern, twice proven);
byte-identical lever-off including float ORDER (don't funnel separately-
ordered sums through one shared loop); probe committed under tools/;
validate = probe_hashbase A/B + smoke + stylized 3 seeds (now a clean 3/3
baseline after the instrument-hygiene pass — keep it clean).

Two populations exist by design: `popField` (canonical people-on-land;
power, manpower, capacity, nomadism) and `s.people` (the economy's town
census; production, casualties, taxes, seat power). Never sum them into one
number.
