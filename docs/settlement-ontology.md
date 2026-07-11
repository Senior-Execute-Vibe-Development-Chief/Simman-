# Settlement ontology — what a settlement may and may not be

Status: **rule adopted; violations 1–2 fixed (T.POW_FIELD; T.LOYAL_FIELD +
T.GRIEV_LEDGER — all default on); 3–4 specified, not yet built.** Companion
to docs/field-polity-spec.md,
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

### V2 — the populace's political feelings live on entities ✅ FIXED

`s._homeland` / `_homelandFell` and the *popular* half of loyalty describe
the PEOPLE OF A REGION, not a government office. The seat keeps what is
genuinely the seat's: `s.loyalty` remains the ADMINISTRATIVE cohesion stock
(records, garrisons, the governor's grip — role 2, all its write sites
untouched), `s.unrest` the fast local temperature, `_ambition` the
officeholder. What moves to the land/people layer is the slow stuff the
roster kept mis-owning: WHOSE ground this is, and whether the people on it
have accepted their ruler.

**Full design (rates in dyn-years; 1 dyn-year = 4 steps, a polity pass =
37.5 dyn-years at defaults):**

- **Homeland memory** (land-anchored, `T.LOYAL_FIELD`): `_tileHomeland`
  Int32 + `_tileFellAt` Float64, siblings of `_tileCapturedAt` (armies.js —
  the in-repo precedent for tile-anchored political memory): which polity
  this ground last belonged to, and when it fell. Stamped by ONE owner-diff
  scan per polity pass (`recordOccupation` semantics on tiles: coming home
  clears; a re-occupation keeps the ORIGINAL homeland), not by edits at the
  dozen `_countryOwner` write sites. Memory attaches to ground, so it
  outlives the member roster: a town founded on old-Poland ground inherits
  the yearning; restoration no longer depends on the same settlements still
  standing. `s._homeland`/`_homelandFell` become DERIVED (seat tile) under
  the lever.
- **Allegiance** (the tile-attachment continuum, `T.LOYAL_FIELD`):
  `_allegiance` Float32 per tile — how far the people of this ground have
  accepted their CURRENT ruler. It relaxes toward the administrative
  condition its county lives under (the governing settlement's loyalty
  stock) at a HABITUATION rate that is identity-coupled: base τ = 500
  dyn-years (trust of the heart builds over generations), scaled down by
  `absorbResistance` (a wholly foreign ruler is accepted ~×0.15 as fast)
  and by the pair ledger (grievance freezes habituation; alliance speeds
  it). Detachment (target below current) runs faster than attachment
  (τ = 300). On transfer, FORCE DETACHES, POLITICS RE-POINTS: only ground
  taken in war (a fresh `_tileCapturedAt`) suffers the ×0.25 attachment
  carry-down; a peaceful transfer — secession (the people's own act),
  absorption, restoration — keeps its attachment and habituation simply
  re-targets. Coming home restores it. ASSIMILATION IS EMERGENT: when attachment
  completes (≥0.9), the ground forgets its old flag — replacing the flat
  HOMELAND_MEMORY timer under the lever. (At the median — covered, median
  identity, no grievance — completion lands in the same ~1000–1500-dyn-year
  band the old timer asserted; the tails now MEAN something: kin provinces
  assimilate in centuries, grieved foreign ones never do.)
- **Nation-pair grievance/amity ledger** (people-anchored,
  `T.GRIEV_LEDGER`): `world._natGriev`, ordered-pair `"H:P"` → people-harmed
  (H's people, harmed by P). Fed by the same owner-diff scan (war-captured
  tiles weighted by popField — the people whose land was taken; war-fresh =
  `_tileCapturedAt` since last scan, so peaceful absorption and border
  smoothing never grieve), by city sacks (armies.js storm), and by razzias
  on crowned towns (slavery.js). Amity: allied dyads (updateAlliances — the
  alliance map already folds in trade) pay the ledger DOWN. Decays with
  half-life ~120 dyn-years (two long generations — grievance renews or
  fades). Read saturating against the era's median realm population
  (smoothed, the `_refRevenue` pattern): G = h/(h + ref) — era-proof, no
  absolute constant. Consumed by (a) habituation above, (b) a grievance
  term in the unrest pass ("old wounds": a province whose ground remembers
  H simmering under P ∝ G(H→P)).
- Deportees already carry who they are (`_captiveCul`/`_captiveAnc` under
  T.SLAVE_PEOPLE) — grievance follows them as the LEDGER is keyed by
  nation, not by ground. No second advection scheme (identityField rule).

**Consumers migrated under the levers:**

1. **Secession seeding** (loyalty budget): a province seeds a revolt when
   its administrative stock collapses AND its people have detached (county
   allegiance ≤ bar) — hysteresis: a long-held CORE forced over budget by
   one bad war stays restless but holds (its people carry the realm); a
   fresh march (people never attached) sheds as before.
2. **Restoration**: the restless pool reads ground memory (derived
   homelands) + popular detachment instead of the roster's stock.
3. **Identity grievance**: the unrest pass gains the ledger term — the
   channel pure mixture-mismatch could never express (Poland grieved its
   partitioners nationally, not confessionally).
4. Irredentist war-targeting off `_tileHomeland` (casusBelliMul) is
   designed but deferred with V3 (it wants the same per-pair remembered-
   ground weights V3's geometry produces).

Validation surface: rebellion/secession cadence, empire mortality,
fallen-lifespan gates — the same soft gates POW_FIELD moved through.
Lever + probe (tools/probe_loyalty.mjs) like every arc.

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

V1 ✅ → (W6-D revival ✅, consumed V1) → V2 ✅ → **V3 next** (consumes V2's
geometry: the contiguous low-`_allegiance` patch) → V4 cleanup.

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
