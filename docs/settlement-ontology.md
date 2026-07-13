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


---

## STATUS UPDATE (2026-07-13) — the cities-only census purge (partial V4, §4b)

With settlements now purely CITIES (urban nodes over an auto-farmed countryside),
every place the member roster stood in for the nation's PEOPLE was re-audited
(docs/audit-2026-07.md, "do countries care about settlements beyond economics?")
and the census-as-substance reads were migrated to the governed land — three
levers, DEFAULT ON, each the POW_FIELD grounding pattern (field measure,
median-anchored to the census so calibrated thresholds keep meaning; the anchors
persist in saves; byte-identical at 0):

- **MUSTER_FIELD** — the national manpower pool draws on governed popField, not
  Σ city censuses (armies.js; the doc's own V4 item "muster manpower from Σ member
  pops — should be popField over tiles" is DONE for the pool; garrison hosting and
  the per-city rural conscript levy stay urban by design).
- **PROV_FIELD** — the admin-load ledger's per-province reads are the province's
  governed catchment people (`s._govPeople`, conquest.js): size burden, rebel
  levy (the peasant rising), people-weighted NAT_OVERREACH heterogeneity, and
  republic primacy (dynasties.js).
- **BIRTH_FIELD** — frontier-state viability is the stateless BASIN's popField
  mass, not the summed censuses of nearby towns (countryTerritory.js; this is
  field-polity-spec §4b's substance — the seat still must be a real city).

Validated: windowed 2-seed probes healthy on every axis (coverage up on both
seeds, biggest realm down/flat), stylized 3/3 seeds all hard gates at ≤2 soft
warnings, smoke green, levers-off recovery byte-exact.

**Still standing (by design or pending):** the capital and provincial SEATS
(role 2 — selection, courts, governor tree, CAP_SEAT, walls); the V3
member-transfer family (secede/fragment/restore/absorb still flip s.countryId
and seed successors at member cities); realm ALIVENESS from the roster (a realm
dies with its last city — defensible as "no seat, no court", but the field
alternative remains open); `natArmy = Σ member garrisons` (cities host troops —
now the pool above it is field-based); and the per-province IDENTITY mixes
(cohesion reads city mixes — the rural majority has no identity data until the
per-tile identity field becomes authoritative, Stage 2).

---

## STATUS UPDATE (2026-07-13, later) — identity Stage 2 BUILT (lever, default off)

The last item above — "the rural majority has no identity data until the
per-tile identity field becomes authoritative, Stage 2" — is now built:
**T.TILE_IDENTITY** (tuning.js; identityField.js `stepIdentityField`), default
0 pending the windowed A/B.

- **The culture layer is sim state under the lever**: tiles KEEP their mix on
  ownership change (conquest recolours the flag, not the people — verified: a
  6k-step probe run shows ghost identity persisting on 168 tiles that lost
  their owner) and ASSIMILATE toward their governing city's culMix at
  r = 1−exp(−dtY·attach/ASSIM_TAU) per firing — the LOYAL_FIELD attachment
  continuum is the clock, so habituated ground assimilates in the same
  ~1000-dyn-year band emergent flag-forgetting (HAB_DONE) lands in, and
  restless conquered ground effectively never does. Owned-but-empty tiles are
  painted by first colonisation; the field seeds once from the city mirror
  (fresh world, pre-v4 save, or lever flipped mid-run). Faith/language stay
  Stage-0 render mirrors; the culture LENS displays the authoritative field
  (diffuse/mirror guards keep render from clobbering state).
- **Consumers wired**: (a) the irredentist casus-belli term reads THE
  CONTESTED TILE's own people at the land front (audit OPEN #3 — structurally
  inert under tile-war since the adapter has no culMix — now live; the
  amphibious bars stay pair-level, beaches are enumerated after the bar);
  (b) every province is stamped `s._rurCulMix` (top-2, popField-weighted) +
  `s._rurCulPeople` (in CENSUS units via the PROV_FIELD anchor), and
  absorbResistance's people axis blends town and countryside people-weighted —
  an EXACT blend (layerMis is linear in the share), so rural identity now
  exists in cohesion (habituation, absorb, overreach, grievance) and peasant
  nationalism is expressible. Audit OPEN #2's "rural people have no identity"
  is closed under the lever.
- **Persistence**: SAVE_VERSION 3→4 — the culture layer persists top-2
  quantised (`maps.tileCul2Id/Shr`, ≈6 B/tile; slots 2-3 are re-earned residue).
  Additive-tolerant: lever-off saves carry no new keys; pre-v4 saves re-seed
  from the mirror on the first firing. Roundtrip verified byte-equal on the
  persisted slots (tools/probe_identity2.mjs, top2Mismatch 0, resume clean).
- **Validation at default off**: probe_hashbase 36e38967/f57f0ddd and the 480
  reference b9c264b9/100239cd both UNCHANGED (byte-transparent), smoke green.
  tools/probe_identity2.mjs is the lever-on functional gate.

**Next for this arc**: the windowed lever A/B (16k–30k, 2 seeds) + stylized
3-seed with TILE_IDENTITY=1, then the flip decision. Expected effects to
measure: irredentist wars along cultural fault lines, slower absorb of
culturally-foreign countryside, revolt/secession cadence shifts from the
rural cohesion term.

**Windowed lever A/B (same day, 480/16k–30k, probe_avg):** count and coverage
are NEUTRAL (8817: 32.6→34.6 realms, 50.6→51.8%; 4242: 39.4→37.1, 55.5→57.5%
— within window noise), but the BIGGEST REALM grows on both seeds: 6.6→8.6
Mkm² (+30%, 8817) and 6.6→7.7 (+17%, 4242). Mechanism read: the sticky field
assimilates a realm's long-held core to its culture, and the now-live
irredentist discount then makes wars INTO kin land cheaper — cultural gravity
that big coherent realms harvest best (the Qin / Prussia–Germany /
Piedmont–Italy unification pattern — historically honest, but it leans
against the consolidation arc's giant discipline). VERDICT: **stays DEFAULT
0.** The flip is a design decision, not a formality: it wants (a) the
stylized battery + churn analysis under the lever (is the bigger realm still
mortal?), and (b) possibly a counterweight — the kinship-RESTRAINT side of
the same casus read (kin STATES sparing each other) measured against the
irredentist pull before the pair ships on.

---

## STATUS UPDATE (2026-07-13, later still) — flip evidence in: DEFAULT 0 STANDS; the counterweight must act on ABSORPTION, not war

Both flip prerequisites above were run (480px reference throughout; the rs=4
arc left it byte-identical, so every prior number is comparable).

**(a) Mortality/churn A/B (probe_empires 24k, both seeds, lever vs off).**
Board-level churn, count and coverage stay healthy under the lever — but the
top slot becomes an ABSORB-CONCENTRATION race: on 8817 one realm
monotone-snowballs (2.0→3.3→3.5→7.0→12.9 Mkm² across checkpoints, age 21.9k
at 24k, absorb=27 in the last window; the off-lever top is 7.0M and YOUNG at
10.6k — the off board churns at #1); on 4242 the pattern is milder (9.2M vs
7.5M) and the top slot still turns over — the 24k winner vaulted there with
30 absorbs in one window. Same mechanism, seed-dependent severity.

**(b) The kinship-restraint counterweight — BUILT, MEASURED, and it
BACKFIRES.** Under the lever the people-axis of casusBelliMul now reads the
DEFENDER REALM's governed people (towns + countryside, people-weighted — the
absorbResistance blend; armies.js realmCulOf → cohesion.js) instead of its
capital city's census mix. No new constants: only the read moves onto the
land, completing the lever's semantics (both casus sides on the same field).
Off-path byte-transparent (hash480 b9c264b9/100239cd and hashbase
f9eb7306/8d66ed8d verified unchanged); probe_identity2 passes (ghost 148
tiles, stamps 65/66, top2Mismatch 0). Measured, windowed 16k–30k: biggest
realm 8.6→**11.0** Mkm² (8817 — now +67% over lever-off) and 7.7→**8.0**
(4242); probe_empires 24k on 8817 goes BIPOLAR (13.7M age-24k + 13.2M
age-22k twin hegemons). **The restraint pacifies each cultural sphere
INTERNALLY (kin mid-realms stop shattering each other) while kin-lowered
absorbResistance — untouched by any casus term — consolidates the pacified
sphere into its biggest member.** Sphere-pacification + kin-absorption =
FASTER unification (the post-1815 German pattern: intra-sphere peace +
customs-union integration → Prussia absorbs the lot). Historically honest;
exactly anti-discipline.

**Stylized 3-seed under the lever (pair build): 3/3 ALL HARD GATES PASS**
(soft warnings within budget; largest-empire share 7% on 777, Zipf −1.25,
fallen median ~139y) — the lever world stays history-shaped even with the
bigger giants.

**VERDICT: TILE_IDENTITY stays DEFAULT 0.** The restraint ships lever-gated
(the honest complete read; anyone flipping the lever gets both sides of the
casus and this documented trade-off). **The real counterweight is an
ABSORB-CHANNEL design, queued:** the growth channel is peaceful absorption
(conquest.js: prob ×= 1 − ABSORB_IDENTITY·absorbResistance — kin countryside
reads ~0.1 resistance vs ~0.8 foreign, a ~3× rate advantage into kin
neighbours), so the missing mechanism is kin STATES resisting peaceful
dissolution: a state-COHERENCE term on the absorbed party (its own org / age
/ court — a functioning kingdom does not dissolve into a cousin realm
without dominance or crisis), distinct from the people-kinship that rightly
lowers integration FRICTION. Note the ABSORB_* gates (ABSORB_ORG_MIN /
ABSORB_DOMINANCE / ABSORB_FORCE) were measured inert pre-Stage-2 ("suppress
peaceful absorption: no effect") precisely because absorption was not then
the kin-gravity channel — under the lever they become live levers again, and
the state-coherence design should be measured against them.
