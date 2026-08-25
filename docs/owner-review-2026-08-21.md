# Owner review 2026-08-21 — fourteen observations, thought through

Owner instruction: **"do not apply any of these. just think deep on them and
record them."** This doc is that record: per item, what was seen, the diagnosis
from physics we already have measurements for, the mechanism that would be
built (never painted — second cardinal rule), and the first measurement to run.
Items that converge on one root are grouped into waves at the end.

Context for every item: the owner plays the shipped app — `tw=960`, all
app-default levers, **WAR_FINISH = 0** (the war engine is still behind its
lever while the boil is being fixed; laps 5-7 landed today).

---

## 1. "Faith, peoples, and language appear entirely unified now, globally"

The most alarming item on the list — a world with one culture, one faith, one
tongue by the classical era is *maximally* unhistorical (the real classical
world held thousands of languages; unification never happened at any point in
history, let alone by antiquity).

**Diagnosis (hypothesis, unmeasured):** the dense-register recalibration class
— the same class TRADE_STRIDE just went through. The peer-seats wave
multiplied the city register ~15×, which multiplied **contact edges**
(trade links, adjacency, migration) ~15× or worse, while drift/genesis rates
stayed constant. Identity in this sim spreads along contact and homogenizes
where contact is dense; history's diversity survived because contact was SLOW
relative to divergence. Multiply contact 15× without touching divergence and
the equilibrium flips from "diverse with trade creoles" to "uniform."
Secondary suspects: (a) identity-field dominant-id rendering can *look* more
uniform than the mix data is — verify against the raw mixes, not the lens;
(b) culture/faith/language **genesis** (schisms, splits, drift into new ids)
may be gated on isolation conditions that a fully-connected world never
meets again — if nothing new is ever born, any mixing rate eventually
uniformizes.

**Mechanism direction:** per-capita contact normalization (assimilation
pressure should scale with contact *share*, not contact *count* — a city with
15× more neighbors is not 15× more assimilated), plus divergence that never
switches off (drift accumulates with distance/generations even between
connected regions — real languages diverge *while in contact*).

**Measure first:** live culture/faith/language counts over a full arc at both
grids, vs the pre-PEER_SEATS baseline; conversion/assimilation events per
capita per window; genesis events per window. If genesis is ~0 after the
early era, that alone explains it.

## 2. Cradle placement: "north Caspian / SE Black Sea cradles; no early
Mediterranean, Middle East, or China nations"

**This one is half-measured already.** The hearth logs show the pins land
right (Nile, Mesopotamia, Indus, Yellow River picked every run) — but their
SCORES tell the story: Nile 7.2, Indus 6.2, Yellow 5.7-6.3, **Mesopotamia
4.0** (wheat suit 0.67). The Tigris-Euphrates *without irrigation* is
genuinely mediocre farmland — rain-fed suitability is what the climate model
scores, and southern Mesopotamia is arid. History's Sumer exists because of
**canal irrigation**, a mechanism the sim does not have. Meanwhile the
Pontic-Caspian river basins (Volga, Don, Kuban) score respectably on rain-fed
suit and are enormous, so they out-compete the true cradles the moment the
model can't see irrigation. The "Mesopotamia never states" investigation
(already an open lap) now has a named missing mechanism.

China: the Yellow River hearth matures 1,300-1,700 years *later* than the
Nile in-run (measured in the logs: 2238-2619y into prehistory vs ~900y) and
East Asia receives no diffusion from the west for a long time — so the east
runs its whole state arc delayed. Real history had Erlitou/Shang state
formation ~1900-1600 BCE, well after Sumer but not absent. If the app shows
literally zero East Asian nations by classical, the delay has compounded
through statehood bars.

**Mechanism direction (the honest one): IRRIGATION.** Where river magnitude ×
aridity × flat land coincide, worked land's effective fertility multiplies
with organization/construction knowledge — canal networks as an emergent
capability, not a painted bonus. This single mechanism moves Mesopotamia and
Egypt to the top of the early table *for the reason they were actually at the
top*, pulls the arid belt into play (see item 13), and demotes the steppe
rivers to what they were (pastoral marches) without ever naming a region in
code.

**Measure first:** per-hearth-basin population and statehood timeline at
tw=960; the fertility map's view of southern Mesopotamia vs the Kuban.

> **ERRATUM (2026-08-23, measured — docs/confetti-leverage-2026-08-23.md, the
> irrigation lap):** two claims above did not survive measurement. (1) Irrigation
> is NOT missing: FIELD_CRADLE / IRR_BAND / IRRIG_CROP / FLOOD_OPT all ship at 1,
> and probe_irrfield shows the canal premium running at FULL strength in
> Mesopotamia (arid 1.00, water 1.00, farmTech 1.00 — multipliers ≥ the Nile's).
> (2) In honest tight-valley boxes at tw=480 the fertility map scores Sumer and
> the Nile valley IDENTICALLY (fert p50 0.150 both). The China half of this item
> IS confirmed and quantified: the Yellow River's capacity is flat at ~274/tile
> for 16,000 steps (the hearth stagger), then jumps 13x. Do not build an
> irrigation wave off this item; the open question is a ~2x Nile-vs-Sumer
> cap/tile residual with no attribution yet.

## 3 + 7 + 8 + 12. The statehood/integration funnel: "majority of cities have
no nation" + "almost every city is a capital" + "speck nations survive inside
larger nations" + "tax 0-3%, army 0-10, control 0/0, treasury 0"

Four observations, one funnel. They describe a world where polity formation
produces either **nothing** (stateless city majority) or **singletons**
(every city its own nation), integration into multi-city states almost never
fires, and the resulting statelets are fiscally degenerate.

**The measured core:** the consolidation battery's integrate funnel read
`orgBelowMin 937 of 940` — the ABSORB_ORG_MIN=0.48 institutional floor
blocks essentially ALL peaceful absorption in the early/classical world.
That floor is an absolute constant in a world whose org distribution the
dense register reshaped — the same stale-absolute class as TIER_SCALE_REF
and fortRef (both already re-grounded to era-relative quantiles). History's
counterevidence is direct: Egypt was a unified multi-city state by 3100 BCE,
Sumer ran hegemonies from the start — early-world integration was NOT rare.

The enclave specks (item 8) are the same funnel seen from outside: why didn't
micro-states survive inside empires IRL? Because the surrounding power
absorbs or vassalizes them at leisure — no strategic depth, no reachable
allies, total transit control. The exceptions (San Marino, Andorra) survived
by *becoming dependencies* — which is exactly the channel the org floor is
blocking. The fiscal degeneracy (item 12) is partly honest scale (a
city-state's army of 0-10 sim units = 0-10k men is historically right;
Sumerian city armies ~5k) and partly the capacity pipeline not engaging at
singleton scale (`control 0/0` — capacity AND load both zero — reads like
the pipeline never runs, not like a weak state; audit needed).

Also in here: the gold-star bug (item 7's second half) — the capital marker
stars every country's seat, including tributaries. The atlas convention
should star only sovereign bloc roots; tributary seats already have the
provincial-ring marker. Trivial UI fix, recorded not applied.

**Mechanism direction:** re-ground ABSORB_ORG_MIN as an era-relative bar
(quantile of the live org distribution, the fortRef pattern), and consider
the deeper truth that **the city-state is the default political form of an
urban core** — a city that crosses the urban bar IS a polity (the polis);
the interesting question history asks is not "does a city have a state" but
"which cities share one."

**Measure first:** the integration funnel at tw=960 across the arc (what
blocks each absorption candidate); org distribution quantiles by era;
enclave fate traces (who blocks their absorption).

## 4. "Bronze age nations sending out colony ships"

Least alarming item. Short-hop sea colonization IS bronze-age real (Minoan
Crete, Cycladic settlement, Uruk's river colonies; Phoenicia by late
bronze). What would be wrong is *transoceanic* range at bronze nav. The
displayed era is also the LEADING civ's era — a bronze headline can coexist
with an iron-age coastal state whose nav legitimately clears SEA_DEMAND.

**Measure first:** colony launch events joined with the launcher's own nav
level and the voyage distance — the anachronism, if any, is in the range
curve, not the existence of ships.

## 5 + 9 + 10. War at lever 0: "not enough war, everything grows like a
plant" + "capitals ALWAYS under siege in war" + "no boom and bust empires"

These three are the app's lever-0 war physics, and they are the exact
campaign in flight. At lever 0: armies are the demilitarized-register
accounting artifact (measured: world army ≈ 1 sim unit before the fix),
storms essentially never succeed (7 of 11,597 measured), so wars are eternal
sieges that decide nothing — which is precisely "capitals always under siege"
+ "growth like a plant" + "no boom and bust." The consolidation engine
behind WAR_FINISH is the answer, and its verdict arms already show the other
world: armies at ~1% of population, a 1.75M km² conquest empire, provinces
changing master — currently still too churny to ship (laps 5-7 landed today:
sieges lift, storms need committed force, works take a season, the siege
levée mans the walls; the A/B against lever 0 is running).

One structural note recorded for later: under TILE_WAR the storm targets the
CAPITAL exclusively — history besieged border fortresses first and capitals
rarely. A "march of sieges" (the front invests the nearest walled town, not
the throne) would fix the always-the-capital look and slow deep conquest
naturally. Not built yet; belongs to the war campaign's next arc.

## 6. "Slop cities with exactly 12k citizens — artificial minimum?"

Not a floor — a **birth cohort artifact**, almost certainly. The peer-seats
mint bar seats a city only where the basin can feed a ~10k-person urban core
(CLAUDE.md's owner directive), so every freshly minted city is born AT ~10-12k
core. A register that tripled in the last few thousand steps is mostly
recent mints still sitting near their birth weight. The real question is
**differentiation speed**: history's city sizes spread into a Zipf tail
fast (a few giants, many small). If the sim's young cities all grow at ~the
same slow rate, the pile at 12k persists unnaturally long — pointing at the
post-mint growth physics (the capacity logistic clamping everyone to their
basin bar) rather than at a floor. Decline exists (DISSOLVE_TOWNS fades
decayed basins), so it's not a ratchet.

**Measure first:** the urban-core rank-size distribution (Zipf slope) at
tw=960 over time, and the age-vs-size joint distribution — if size is purely
age, differentiation is missing (ties into the open "primate cities" lap).

## 11. "Vast majority of cities say they are starving, but never shrink"

**Measured today, root known.** The ledger↔field two-truths split: the info
card reads the LEDGER's supply flow (`_foodSupply` — p50 = 0.00, 67% of
cities at zero, measured this session), while population growth reads the
FIELD (which feeds them fine). The granaries are simultaneously FULL
(s.food p50 = 467, ~93k ticks of stores at the tiny core need — also
measured today). The display is lying, not the demography. This same split
already: (a) melted armies (fixed with the field-OR-ledger fed test), (b)
nearly gave sieges a false instant-starvation clock (chased and disproven
today). Three consumers burned = the unification lap ("make the ledger
honest under the field regime") has graduated from watch-item to named debt.
Interim: the card should read field-fedness (`_fedM`), not `_foodSupply`.

## 13. "Nations only where crops are green; cities only on rivers/cropland;
no Middle East, no North Africa fed from far away"

True, and structural: the mint bar requires the LOCAL basin to feed the
urban core, so a city that history fed by IMPORT (Rome on Egyptian grain,
Palmyra/Petra/Mecca on caravan trade, every Greek island polis on shipped
wheat) cannot exist here. Two missing systems, one wave with item 2:

* **Irrigation** (item 2) — makes the arid river valleys the cradles they
  were.
* **The grain trade feeding the field** — imported food raising a city's
  effective basin, so trade-route nodes and ports can sustain cores their
  local land cannot. The ledger's food trade EXISTS; it just doesn't feed
  the field's capacity logic — the two-truths split again (item 11's lap is
  a prerequisite).

Together these unlock the entire arid belt — Mesopotamia, Egypt's
grain-empire role, the caravan cities, North Africa — from mechanisms, not
paint.

## 14. "Should nations get an X factor (Rome's armies, Britain's navy)?"

Owner asked for a design opinion. **Recommendation: never an applied
per-nation factor** — that is the second cardinal rule's definition of
outcome-fitting (naming the result in code). But the owner's instinct points
at something real: history's great powers each had a *particular
institutional edge*, and the sim currently has only smooth personality
scalars. The emergent version of an X factor:

* **Institutions as discrete, condition-unlocked adoptions** — citizenship
  law (Rome's actual X factor: converting the conquered into soldiers),
  professional standing army, chartered trade companies, meritocratic
  bureaucracy (China's), naval acts. Each unlocks from real conditions
  (manpower pressure + integration history; island + trade share; etc.),
  is chosen by personality, and carries real tradeoffs.
* **Reinforcement drift** — personality drifts toward what has been winning
  for that realm (a realm that keeps winning by fleet invests fleet-ward),
  so distinctive national characters PERSIST and compound, path-dependently,
  without a single named nation in the code.

Rome then emerges wherever citizenship-law + manpower conditions coincide —
which is what "Rome" actually was.

---

## The waves these converge into (priority-ordered, none started)

1. **Identity homogenization** (item 1) — measure counts/genesis first; the
   register's contact recalibration. *The one most likely to be a plain
   regression and most visible.*
2. **Statehood & integration funnel** (items 3, 7, 8, 12) — the org floor
   re-grounding + capacity-pipeline audit at singleton scale + star fix.
3. **The arid-belt civilizations** (items 2, 13) — irrigation + trade-fed
   fields; prerequisite: the ledger-field unification (item 11), which three
   consumers now demand.
4. **War campaign** (items 5, 9, 10) — in flight behind WAR_FINISH; laps 5-7
   landed today; A/B vs lever 0 running; "march of sieges" recorded for the
   next arc.
5. **Urban differentiation** (item 6) — Zipf measurement first; joins the
   open primate-cities lap.
6. **Colony range audit** (item 4) — small; measure before touching.
7. **Institutions & reinforcement drift** (item 14) — design direction
   recorded; a large wave for later.
