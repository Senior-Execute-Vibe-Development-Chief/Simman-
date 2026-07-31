# User report 2026-07-28 — measured diagnosis (identify/explain only; NO fixes)

Twelve player-facing symptoms, reported together; owner instruction: *"Don't try
fix, just identify, explain and reason with them."* This doc records what each
symptom actually is on HEAD (`845c766`, post-PR#64), with mechanisms, file:line
evidence, fresh measurements where they were cheap (app-identical harness, 480,
seed 8817 unless noted), and the prior-work status. Per the repo convention
(country-count-size-diagnosis.md etc.), this is the evidence base for follow-up
mechanism work — nothing here changes sim behavior.

The app ships at worldgen 1920 → sim `tw=960`, `rNormPop = resScale = 4`
(state.js:11,49; tuning.js:724). Several findings below are *amplified* at that
grid relative to the 240/480 grids most constants were calibrated on; each is
flagged.

---

## The five cross-cutting roots

Most of the twelve symptoms are surface expressions of five deeper patterns:

**R1 — The settlement-entity granularity bound.** Entities are towns founded
8–20 ref-tiles (≈1,400–3,400 km) apart (crystallize.js MIN_SETT_DIST=8 ×
capacitySpacingMul ≤2.5). ~87 entities exist on the whole Earth at step 18k.
Sovereignty seats, road endpoints, secession seats, colony sources are all
entities — so country count, road length, successor-state supply and colony
frequency are all quantized by the same atom. The docs know this
(field-polity-spec.md: "the atom itself was the residual complaint"); the
field rewrite moved *territory* off the atom but birth/seats/roads still live
on it. Symptoms: #4, #11, partly #1, #7.

**R2 — Global median/leader anchors in local decisions.** `world._sizePopK`
(countryTerritory.js:704-757) sets EVERY realm's territorial target as
`governedPop × (median realm's tiles-per-person)`, overwriting the realm's own
`spanTechMul` and capacity computed one line earlier (:735 vs :756). Also in
this family: `_refCapPower`/`_refCapPowerS`/`_refRevenue` (median-anchored
capacity/dominance), `f2c` in nucleation (flat in practice, latent). These
satisfy the *letter* of the first cardinal rule (they read world state, not the
clock) but break its *spirit* — a local outcome driven by non-local state —
and they produce exactly the anachronism class the rule exists to prevent
(a Stone-Age realm sized by the Bronze leader's cohort). Symptoms: #8, #9,
and the "breathing" coverage oscillation.

**R3 — Asymmetric friction.** The slave trade is the only trade that pays *no*
freight/toll/tariff/brokerage/ship-worthiness/cost-of-goods (slavery.js pooled
clearing vs roads.js:1431-1530 sellGoods); fishing is the only food source with
no labour, area, capital, depletion or shock exposure (settlement.js:2577-2608).
Channels exempted from the frictions everything else pays win their category by
construction. Symptoms: #2, #3.

**R4 — Resolution-invariance gaps at the shipped grid.** Colony candidate cap
(`COLONY_PER_PORT_CAND=400` raw tiles ≈ ¼ the real coastline coverage at 960),
naval overlord reach (`NAVAL_REACH_BASE/NAV` raw tiles — colonies ~3× more
fragile at 960 than where tuned, conquest.js:3131-3134 says so in-comment),
control-field fade tuned against a 144-tick cadence that runs at 576 at the app
grid. Symptoms: #7, #10.

**R5 — Validation blind spots.** No gate watches food composition (fish share
drifted 6% → 84-92% across default flips, silently); polity immortality is a
trajectory property past the 15k CI horizon (country-count doc post-mortem §3-4
says exactly this); the count gates score an instant, not the birth/death flow.
Symptoms: #2, #6 persisting despite "CLOSED" verdicts.

---

## 1. "Nations shrink too often, without leaving anything behind"

**Real, and it is two defects joined: shrink is the only pressure valve, and
the shrink channel is successor-blind.**

Territory leaves a realm through three paths, and two of them set tiles to
**wilderness (-1)**, not to any state: dead-owner release
(countryTerritory.js:592) and the over-capacity shed (:861-909), which releases
most-remote-first, **silently — no `polity.*` event, no chronicle line**. The
settlement standing on a shed tile keeps its people/wealth/tier but re-derives
`countryId` from the ground on the next pass — and while the stateless→realm
direction pays three gates (org/budget/fisc, :1764-1766), the realm→stateless
direction is unguarded (:1769). A town silently lapses off the political map.

Nothing can restore it as a successor: `restoreNations` (conquest.js:930-968)
walks **living realms' member lists** — a lapsed region is on nobody's list, so
its only route back to statehood is `nucleateFrontierStates`, which mints a
fresh id with no name, hue, or history. Where a *loyalty* secession does fire,
`shedPatch` needs a `tier ≥ CITY_TIER(2)` seat — and the floating city bar pins
labelled cities to ~3-4 planet-wide (country-count doc finding 2) — so its
terminal branch `settlement.lapsed` (conquest.js:1075-1083) fires instead. A
shattering empire splits into `max(2, ceil(cityCount/2))` successors
(conquest.js:1183-1184) — with cityCount usually 0, **exactly two**, never a
Diadochi spread. `COLLAPSE_SCAR = 0.7` then wipes ~63% of the fallen court's
organization.

What *does* persist: the people (cities never die politically, only
demographically), the ground's homeland memory (loyaltyField.js:244-248 — and
it never decays on wilderness, :307), roads, the polity record (entities.js
"Records are never deleted"). What does not: any successor polity, because
every successor-forming mechanism keys off member lists and city labels, and
the dominant shrink channel bypasses all of them.

Historically the pattern is inverted: when Rome/the Abbasids/the Tang receded,
the cities didn't lapse into flagless wilderness — local elites, governors and
bishops became successor kings; the *political* fabric re-knitted at a smaller
scale almost instantly. The sim has the fabric (people, memory, seats) but the
transition path from "shed march" to "successor statelet" does not exist.

**Missing mechanism class:** shed/lapse → local successor formation (the ground
under a shed march contains towns, garrisons and a homeland memory — a
successor seat should form from what is already there), and
restoration-from-wilderness (the loyalty field already stores `home[ti]`
forever; nothing reads it for re-founding).

## 2. "Fish is still a vast portion of food"

**Real, measured, and worst at the start: 86.6% of world food production at
step 1500, 83.7% at step 12000; 93% of world population lives where fish >
half of food; Mesopotamia itself reads 75% fish** (probe over Σ`_fishYield` vs
Σ`_landFood`; independently tools/probe_fishshare.mjs).

The declared containment mechanism is a no-op. Fish =
`FISH_RATE(16) × sea × seaRich × poor × fishTech` (settlement.js:2606), where
`poor = 1 − (landFood/tiles)/FISH_LAND_REF(8.0)` is supposed to zero the catch
where farmland is rich. Measured `landFood/tiles` is **0.026–0.110 for the
whole run** — the reference is ~100× off the scale it is compared against, so
`poor` sits at 0.985–0.997 everywhere, forever, cradles included. `seaRich` is
a plateau, not the "cool-water peak" its comment claims: 1.0 from 0°C to 20°C,
measured world mean 0.95. `FISH_LAND_REF=8.0` has no independent physical
meaning (it is a total-food scale compared against a per-tile number) — the
second-cardinal-rule tell.

Structural asymmetries, beyond the broken gate:
- Fish is a flat **per-settlement** quantity — no population, area, labour,
  boat or capital term. A 25-person hamlet lands the same catch as a
  2,000-person port (~12× the *entire land output* of a genesis settlement).
- No depletion/commons (`depositReserve` and `_soilFatigue` exist for land;
  nothing for the sea — ideas.txt [D6] unbuilt).
- Strictly additive: `supply = netLand + fish` — no labour split, no
  opportunity cost; conscription, famine, soil, disease, cash-crops all cut
  *land* food only, which *raises* `poor`, which raises fish.
- Meanwhile land food spends the whole pre-modern era at forager scale:
  `_eraProd = 1 + 260·agri^6·devGate` is pinned ≈1.0 until ~step 10k (the
  agri^6 back-loading plus the org dev-gate), while fish is at full strength
  from tick 1 — so the share is *highest at genesis*, exactly as reported.
- Feedback: water access slows agriculture learning (`foragePull`,
  settlement.js:1913-14) precisely where fish lands — the aquatic trap
  is real ethnography, but here it compounds with all of the above.
- Display: the panel share is post-export (a village ships 80% of its grain up
  the hierarchy but keeps 100% of its fish in the denominator).

**Prior work status:** commit `878ee01` ("demote fish to a marginal
supplement") measured 6.1% world fish share — then `CRADLE_EVE=0` and
`SPAN_TECH=0.85` cut early land food ~10× and nobody re-derived
`FISH_RATE`/`FISH_LAND_REF`; the review's own prescribed compensating half
("make FISH_LAND_REF scale with _eraProd", bugs.txt [28]) was never built while
its amplifying half (fishTech, spanning ×6.27 — more than farming's ×5.06, and
front-loaded: ×3.13 by Bronze) shipped. **No validation gate watches food
composition** (stylized.mjs has none), so the regression 6% → 90% was silent.

## 3. "Slave trade is a top-3 money earner in every single country"

**Directionally right, structurally explained — with one correction: slave
trade is 0.9% of WORLD income.** Measured: top-3 in 10/47 realms at step 10k,
rising to 21/56 (38%) late (history-shape-audit). It *feels* universal because
of ranking and display structure; the underlying economy is genuinely broken,
just not large.

Why it ranks everywhere despite being small:
- **It is the only friction-free trade in the sim.** Goods pay gravity volume
  caps, freight, tolls, entrepôt brokerage, tariffs, an FX rate, and a
  ship-worthiness check that kills unprofitable routes (roads.js:1431-1530).
  Slaves clear in a single pooled market per road component at a flat price
  with **none of those** (slavery.js:124-193) — a 100%-margin sale of an asset
  seized free. Every seller in a continental component is paid the same price
  regardless of distance to any buyer.
- **The ranking denominator is nearly empty.** Of 16 income channels
  (money.js:11-26), a typical realm has ~5-6 live ones, and the productive
  ones are bundled (all five crafts book to IN_GOODS; all luxuries + cash
  crops to IN_LUXURY). A channel worth 5% of income lands at rank 3.
- **Display amplifiers:** the 50-tick slave pass against a ~20-tick income EMA
  shows up to 2.5× the true rate right after a pass; the archetype label
  checks "Slaver city" *first* (WorldSim.jsx:3772-3786); the chronicle's
  slaver threshold (25/tick) is the lowest of any archetype.

Why supply exists everywhere: **the peacetime razzia is unconditional.**
Measured at step 6000: **8.2% of world population enslaved, zero wars ever
fought.** The raid loop (slavery.js:86-122) requires only: settled, something
foreign within `RAID_RANGE` (28 ref-tiles ≈ a 56-tile radius), and a 2× power
edge (6× vs crowned victims). No war state, no army committed, no cost, no
risk, no capacity bound (`took` accumulates over every qualifying victim; the
header's claimed "bounded by military reach/logistics" is not implemented). No
personality, culture, faith or diplomacy input.

Why demand never dies: demand ∝ `freePop` (unbounded) against supply bounded
at a few % of neighbours' population per pass → the market multiplier is
**permanently pinned at its cap** (measured 10:1 supply-starved; `marketMul=4`
everywhere, forever), so the self-balancing loop the code header describes
cannot close. The single largest demand leg (`ESTATE_PULL=1.0`) is a pure coin
pump: `_estates` creates demand and attrition but **produces nothing** (only
mines and cash crops convert unfree labour to output), and estates ratchet 6×
faster up than down off a war-plunder term that never reaches zero.

**Absent localizers** (each named in coerced-labor.md or the review, none
built): distance-priced clearing along the network [I13]/[D9], the `gSlave`
unrest term from the design doc §2 (no political price for a slave economy),
any faith/culture stance, any wage comparison (`FREE_LABOUR` gates on an
org/metallurgy band no validated run reaches), and a grounded price
(`SLAVE_PRICE = 8` is commented "(calibration)" — the literal rule-2 tell).

## 4. "Not enough countries ever, especially mid to late game"

**Real, and it is birth starvation, not death excess.** Measured on Earth/480:
41 foundings vs 7 endings over 18k steps; frontier foundings flat-line after
step 15k; the realm count plateaus ~55 while **87 settlement entities exist on
the whole planet**.

Three stacked bounds:
1. **R1 (the atom).** Primary state formation (`nucleateFrontierStates`)
   requires a *stateless settlement entity* as seat (countryTerritory.js:1848)
   — the stateless pool is 23-29 entities from step 8k on, and each must also
   clear org ≥ 0.15, a size bar × geography multiplier, an 8-ref-tile
   isolation ring from every capital, and local leadership. The count is
   arithmetically capped by the entity supply — country-count doc finding 1,
   still the binding constraint.
2. **The founding scissors close permanently.** Nucleation counts only
   *unclaimed* basin mass (:1900) and needs stateless seats; as claimed land
   rises, the primary channel shuts. Mid/late game the only channels left are
   fragment/restore/secede — which **recycle** the existing pool, and (per #1)
   under-produce successors (fragment → exactly 2; shedPatch → lapse).
3. **History's count comes from decomposition, not just genesis.** Real
   polity counts stayed in the hundreds through the entire pre-modern era
   because empires continuously decomposed into successor states. With #1's
   successor-blind shrink and #6's death-resistance, the sim's late game has
   neither the genesis channel nor the decomposition channel at scale.

## 5. "SE Asia, east of the Caspian, inland N Africa — empty all run"

**Real (measured at 18k: SE Asia 1 settlement/6.6% claimed vs Europe 7/98.7%),
and each region has a different cause — one is working as intended, one is a
double-count bug, one is a missing-package chicken-and-egg.**

**SE Asia — the worst case, and NOT a land-quality problem.** Its fertility is
the best in the model (0.755 vs North China 0.644; rice suitability 0.82).
Four stacked suppressors:
- `malariaSignal` saturates at ~1.0 (t≥0.82, wet) → founding spacing ×2.19
  (~1/5 settlement density).
- The state-formation bar is **~11.7×** baseline because `STATE_DISEASE`
  (×2.92) and `STATE_FOREST` (×4.0, saturated) **multiply** — but the forest
  test (countryTerritory.js:1872) has *no temperature band*, while its own
  lever text (tuning.js:523) defines it as the **temperate** forest mechanism
  (Europe/Russia/N-America) and the disease lever explicitly covers the wet
  tropics. On warm monsoon land the two levers double-count the same
  hostility. (The river exemption is what spares North China, moist 0.731 —
  it would otherwise be forest-locked too.)
- The technique wave never arrives: devField 0.224 at 18k vs 0.586-0.597
  everywhere else. `DIFF_CLIM` charges the wave `|Δtemp|+|Δmoist|` per hop —
  the doc-comment claims this sums to the net climate distance, but it
  actually sums the **total variation** along the path, and SE Asia is the
  most climatically textured land on the map (monsoon coasts, cordilleras,
  archipelago), so the accumulated toll dwarfs the true climate displacement
  from China. Capacity then reads `DEV_BASE+DEV_TECH·dev` → a 2.4× handicap.
- **Nobody owns rice.** Cradles domesticate `bestPackageAt` of their own tile
  — measured: Nile → maize, Mesopotamia → maize, Indus → maize, Yellow River →
  **tubers** (storability 0.35 — also quietly capping China's taxable
  surplus). Maize's wide climate bell out-scores wheat at warm floodplain
  tiles, and rice starts nowhere, so monsoon Asia's founder crop can only
  arrive by trade diffusion from a rice owner (there are none) or independent
  domestication — which needs `agri ≥ 0.7` at a settlement already there: a
  chicken-and-egg with the suppressors above.

**East of the Caspian — intended aridity, unintended permanence.** The
depletive moisture solver (SPEC-climate-moisture-fix.md) deliberately dried
it (it used to be the world's breadbasket — the opposite bug). But its best
storable package is wheat at 0.25 suitability: below `CROP_DOMESTICATE(0.45)`,
so it can **never** independently domesticate, and `agriGate` caps farming at
36% of full *forever, at any tech*. Its crystallize quality score is ~10×
below a river tile (no river/coast locMul), and carrying capacity sits on the
pastoral floor. It is empty of *entities* — the popField does carry people —
because towns can't clear the urban floor there. Historically this belt held
Khwarezm/Sogdia/Merv — irrigation-fed oasis civilization on the Amu/Syr Darya;
the mechanism that would produce that (rivers crossing desert = the Nile
pattern) exists, so the gap is likely the rivers' magnitude/fertility at sim
resolution plus the crop ceiling.

**Inland N Africa — half intended.** The Sahara core has no establishable crop
(best suitability 0.05 < CROP_ESTABLISH 0.18) — correctly, mechanistically
empty. The fertile Maghreb interior and Sahel (fert ~0.7 — real land) are
thinned by `aridSignal` ≈ 0.73 → spacing ×1.78 and end at 2 settlements. The
Sahel belt (Ghana/Mali/Songhai country) and the Atlas valleys read as
casualties of the arid-margin spacing penalty rather than of actual carrying
capacity.

## 6. "Eternal, ever-growing nations"

**Real at the scale the player sees, despite two docs measuring it "CLOSED" —
because every giant-killing channel but one is structurally closed, the one
that remains weakens with the target's size, and the pressure valve that DOES
scale (the shed) produces shrink, not death.** This is the twin of #1.

The kill-channel audit (all nine exits):
- **Capital storm** — the dominant killer per the hegemon probe — is gated by
  exponential projection decay: `projOf = exp(−d/H)` from the attacker's
  nearest base. A capital 3 half-distances deep reads ×0.05 → the attacker
  needs **~32× parity** to clear `CITY_STORM_RATIO(1.6)`. Empire depth is
  itself the moat, and depth grows with size — the only effective death
  channel weakens exactly as the target grows.
- **Frontier secession** saturates: `over = min(OVER_DECAY_CAP=1, …)` — a
  realm 20× over budget bleeds loyalty no faster than 2× over; org damps it
  (`LOYAL_ORG_HOLD`), attachment hysteresis delays it, and the patch must
  touch the outer frontier — so a giant peels its rim, never its core.
- **Rebellion** is prosperity-proof by design: unrest grows only when
  Σgrievances > 0.4; peace+plenty+monuments hold rich empires below it.
- **The overmighty-governor channel is measured inert** (max ambition 0.08
  across 3×24k seeds; the ossification doc left `ELITE_FRACTURE` deliberately
  unbuilt).
- **Succession crises never shatter settled realms** — the Diadochi path is
  reachable only for `_nomadic` realms (conquest.js:2766); a settled empire
  takes a loyalty/unrest tap (0.10/0.18) that prosperity absorbs.
- **Absorption/enclave** need a 2.6×-stronger neighbour — nothing out-powers
  the hegemon. **Nomad shatter** needs `_nomadic`. **Vassalage** preserves.
- Meanwhile three stabilizers reward size: imperial hysteresis (capacity
  floors at 50% of its historical peak, decaying 4× slower than it rose —
  ~15k ticks of memory); suppression funded by size (`coerce ∝ √natArmy` →
  per-province load falls as members rise); shocks with absolute radii
  (`FAMINE_RADIUS=12` tiles — total for a statelet, 1.5% of an empire).

The "ever-growing" half: under `SIZE_BY_POP` the target is
`governedPop × _sizePopK + march(logistics²)` — population and logistics only
ever rise, and capacity is explicitly *not* the ceiling (the code comment at
countryTerritory.js:750-752 says so). Against that, the over-target shed
guarantees the giant's failure mode is *receding marches* (silent, #1), never
collapse. Historically the ratio is inverted: great empires died more often
than they merely shrank, through elite fracture, succession war, and
peripheral secession — the three channels that are, respectively, unbuilt,
nomad-only, and rim-only here. The ossification doc's own flag stands:
its "CLOSED" verdict was measured at 480/24k, while immortality is a
trajectory property the docs themselves note lives past the validation
horizon (country-count post-mortem §3-4), and the pre-comboE 960/50k run
showed top-5 ages 29k-49k with `captured=0` for the entire run.

## 7. "Colonies rare, short-lived; large nations don't have them"

**Real, and structural: there is no realm-level colonization actor at all.**
Overseas colonization (sea.js) is a per-port settlement decision — the only
realm input is a personality multiplier ≤1.45 on a cooldown that never binds.
Empire size, treasury, capacity, naval power: none enter. Three squeezes then
make *large* realms specifically fail:
- The ocean is a **nearest-port Voronoi** (sea.js:350): every 20-person cove
  with nav 0.04 seeds the flood, and open water belongs to whichever outermost
  cape hamlet is closest — which usually cannot colonize (needs 400 people),
  while the metropolis behind it cannot *see* the far shore. Who reaches the
  empty continent is decided by accidental coastal geometry — the measured
  "effectively random".
- The candidate list is the 400 **nearest** coastal tiles (raw, not
  res-scaled: ~¼ real coverage at the shipped grid) — for a big realm, all
  inside the 56-tile settlement-exclusion disk of its own dense hinterland →
  zero valid sites, every pass, forever. A frontier port beside an empty coast
  founds instantly.
- Colonies are born **independent** with a one-shot `_overlordCC` marker that
  is consumed unconditionally at the next polity pass (conquest.js:1825) — if
  the founder's realm id changed during the voyage, the link silently drops
  and the colony is an orphan micro-state forever (more "random" colonies).

Short lives: the overlord reach that meters supply and independence
(`navalReach = 8 + 70·nav`) is in **raw tiles, deliberately un-res-scaled**
(comment at conquest.js:3131-3134) — at the shipped 960 grid a colony sits at
~⅓ the projection it was tuned for: it starves (supply ∝ proj) and it breaks
free at ~14% of the metropole's power. A tier-1 colony on another realm's
growth path is annexed **for free** (the non-sovereign `adoptAndFound` branch
skips every gate for settlements that already have a country id,
countryTerritory.js:1769). And if the metropole ever dies, all its colonies
are freed at once with no inheritance (conquest.js:3112).

Historically colonization was a *state* project (chartered companies, navies,
crown finance) executed *through* ports; here it is a port accident that
states never see. That inversion is the whole symptom.

## 8. "Countries spawn small, grow to standard size (often, not always), early game only; the growers collapse later"

**Every clause of this observation is a real mechanism:**
- *Spawn small*: a newborn has one member and capacity 0 (solo realms are
  skipped by the capacity calc), so it starts at its basin/core (~5-18 tiles
  after the MINIMUM-EGYPT fix).
- *Grow to standard size*: "standard" is literal — the capacity ruler is
  **median-anchored** (`CAP_K_REL·log2(1+power/max(POW_REF,_refCapPowerS))`)
  and the size target is `governedPop × _sizePopK` where `_sizePopK` is *the
  median realm's tiles-per-person* (R2). Every realm is pulled toward the
  cohort median by construction. Uniform "standard-size" realms are not an
  accident; they are what a median-anchored ruler produces.
- *Often but not always*: the geography multiplier on the founding/viability
  bars (`capMul` — fertility/disease/forest/ruggedness) decides which basins
  qualify and how fast they fill.
- *Early game only*: the founding scissors (#4) — primary formation needs
  unclaimed basins and stateless seats, which stop existing.
- *The growers collapse later*: the momentum loop is a structural boom-bust —
  conquest banks capacity momentum (`MOMENTUM_CAP=16`) that decays at 0.55/
  pass the moment the streak stops ("hard snap", the code's own words), so the
  propped-up frontier sheds within ~4 passes of the last victory. Measured
  peak 324 → trough 168 tiles (budget-gated-expansion.md), with two attempted
  dampers measured negative and reverted.

## 9. "One nation reaches Bronze → many countries spawn and grow large, still Stone Age"

**Confirmed, and the mechanism is identified — it is not the era system, it is
`world._sizePopK` (R2).** The progression-pacing audit ("Universal boosts on
age change? — None exist") audited the era index, per-tech bonuses and
`_civYear` — all clean — but `_sizePopK` is a *median*, not a *leader*, so it
fell outside the audit frame. With 4-8 capacity-bearing realms in the early
game, the median IS the leader's cohort:

    step 7000:  _sizePopK 2.4e-5   claimed 1.4%   max realm 17 t   (Stone)
    step 8000:  _sizePopK 2.7e-4   claimed 11.7%  max realm 70 t   (leader hits BRONZE)

An **11.2× jump in one window**, applied to every realm on the planet as
`target = ownPop × _sizePopK` — Stone-Age realms included, whose own
`spanTechMul` is computed and then discarded (:735 vs :756). It also
oscillates (20× band over the run), with world coverage breathing in lockstep
(1.0% → 11.7% → 4.3% → 8.9%): mint statelets → median falls → everyone
shrinks → shed to wilderness → more stateless → more statelets → median falls
further; consolidate → median rises → everyone inflates. The observed
correlation "Bronze leader ⇒ many new large Stone-Age countries" is this
coupling, not co-development. (Founding-wave *timing* correlation also gets a
natural contribution from DAWN's rolling basin-viability, but the 11× size
jump is the coupling.)

## 10. "Very strangely shaped countries, especially in Europe"

**Real; four mechanisms, all maximally expressed where coastline density is
highest — i.e. Europe:**
- The naval admin/growth walk's water-excursion budget **resets at every
  landfall** (the `w=0` default at countryTerritory.js:326 vs :636/:854) — it
  bounds one crossing, never the total, so island chains are traversable
  without limit (Aegean→Baltic tentacles; the doc's "Umayyad shape" is this).
  Sea distances are also per-realm, so rivals interleave across the same
  strait in the same pass → speckled far shores.
- The two shape-cleanup passes are **structurally dead on coasts**: border
  smoothing requires ≥5 *land* neighbours to vote (sea abstains — every
  peninsula/island/convex coastal tile is unsmoothable, :1508-1514); gap-fill
  requires enclosure on all four cardinal rays and water kills a ray
  (:1557,:1640). Exactly where Europe's protrusions are, the erosion passes
  don't run.
- Only a 3×3 core per member is pinned; everything else is shed-eligible
  every pass, and `ENCLOSED_FILL_MAX=1.0` lets a realm double via one
  mountain-pocket fill then shed it back — lumpy churn.
- What is *rendered* is the control field, whose stale-hold hysteresis
  (~300 ticks) is tuned against a 144-tick recompute cadence that actually
  runs at 576 at the app grid (R4) — lost land keeps flying the old flag,
  overseas land renders from a different array with a visible seam.

## 11. "Roads still far too long too early"

**Real — third report of this symptom; the PR#64 fix verified its cap was
binding but the cap floor is itself continental, and one build path ignores
it.** Two road-building paths exist:
- Trunk planning pays the logistics cap `min(want, SEG_CAP_BASE(12) +
  SEG_CAP_LOGI(36)·logisticsLevel)` — at zero tech, **12 ref-tiles ≈ 2,040 km**.
- Kin paths (`linkCloseNeighbours`) have **no tech gate, no statecraft gate**:
  any 30-person settlement gets guaranteed links to everything within
  `CLOSE_NEIGHBOUR_DIST = 12` ref-tiles — numerically identical to the cap
  floor, so the "logistics horizon" is exactly non-binding at zero tech. A
  stone-age hamlet still paints a ~2,000 km path at tick 0. The cap is also
  Euclidean-endpoint; the A* route that gets painted can be far longer.

The root cause is R1: settlement entities are founded 8-20 ref-tiles
(1,400-3,400 km) apart, so *any* "connect your neighbours" rule paints
continental lines — the prior fix's own telemetry ("longest build exactly 12
ref-tiles") verified the floor, and the floor is the symptom. Lowering the
neighbour radius below spacing disconnects the network entirely (tried:
"found NOBODY", roads.js:744-747 comment). Long-distance *relay* trade
(unbounded by design, partner-count-capped) then hard-packs these chains into
prominent trunks. Road length cannot be fixed inside roads.js; it is the
entity granularity wearing a road costume.

## 12. "Not enough power gap between techs (iron ≫ bronze, guns ≫ iron)"

**Real, quantified, and previously undocumented.** Tech enters combat as a
bounded additive multiplier: `military = 1 + Σ per-tech fx` (tech.js:463),
hard range **1.0 → 3.35 from Stone Age to fully Modern**. Worked ratios at
equal population: **bronze→iron 1.275×; iron→gunpowder 1.063×;
stone→modern 3.23×**. The entire gunpowder revolution sums to 0.21 weight —
less than copper working (0.24) — and `gunpowder` carries `defense −0.12`, so
adopting it weakens your walls more than it sharpens your assault.

Consequences:
- The *base* attack bar is `ATTACK_MIN_RATIO = 1.176` — so a gunpowder realm
  **cannot even open a front** against an equal-population iron realm (1.063 <
  1.176). Muskets need more *men*, not better guns.
- Every terrain co-factor outweighs the whole tech arc: a defended river tile
  ×3.2, alpine ×4.6, walls ×2.5, nomad ×1.8, thin-front ×10 — while
  population enters linearly and unbounded (`natMight = Σ army×techMul`).
  Matching stone→modern takes 3.23× the men; matching bronze→iron takes 28%
  more people.
- **Diffusion makes the gap moot anyway**: knowledge diffusion between
  connected neighbours runs ~50-100× faster than invention
  (`DIFFUSE_RATE·litMul` vs `LEARN_BASE·…`), so the steady-state gap between
  trading neighbours is ~0.01 knowledge — a fraction of the 0.30 that
  separates bronze from iron working. Since adjacency ⇒ trade reach ⇒
  convergence, the bronze-vs-iron battle *structurally cannot occur between
  neighbours who fight*; durable gaps survive only across oceans and hard
  capability gates (no ore / no horses / no sea).

Historically the decisive gaps (Plassey, Cajamarca, the Iron-Age
transformation) were order-of-magnitude force multipliers *and* arrived
faster than diffusion could equalize. Here the multiplier is capped at 3.35×
lifetime and diffusion outruns invention — both halves of the gap are
suppressed independently.

---

## Appendix — incidental defects found during this pass (no behavior changed)

- `tools/probe_fishshare.mjs:56` prints `s._agg` — never assigned; the column
  always reads 0 (real field: `s._agriGate`).
- `_foodImportRate` (WorldSim.jsx:3261, worker mirror) is read but never
  written — the "Imported /tick" row is dead.
- `tech.js:302` comment "fish sums ≈ 1.18" — actual 1.58 (`trawling` added
  after the note).
- `settlement.js:160-165` and `:2345-46` header comments document two
  superseded food formulas.
- `slavery.js:31` comment claims raid capacity "bounded by military
  reach/logistics" — no such bound exists in the code.
- `sea.js:95-96` promises "supplied from home (see supplyColonies in
  conquest.js)" — that function no longer exists (flow moved to the overlord
  link, now reach-throttled).
- `cohesion.js:56 identityWeightsNow` has zero callers (superseded by
  `identityWeightsFor`).
- The stylized suite has **no food-composition gate** — the fish share
  regressed 6% → 90% across default flips with all gates green (R5).
