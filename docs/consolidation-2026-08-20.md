# The consolidation engine — conquest learns to finish (2026-08-20)

Owner, on the step-38k Renaissance frames (989 → 1,038 realms in 19 steps,
37% claimed): the count is huge — display a nation and its tributaries as one
thing? and what else causes it?

Two lanes shipped together.

## Lane 1 — the atlas headline (display only)

Real 1500-CE Earth held ~1,000–2,000 polities counted the way the register
counts; atlases read as ~hundreds because they paint SOVEREIGN BLOCS. The
register already knows the structure (57% of realms measured as vassals at
27k — 219 of 387), and the political paint already tints by suzerainty root.
Shipped:

* The top-bar headline is now **"N nations · M states"** — nations =
  distinct suzerainty-bloc roots (overlord chains followed to their end, the
  same convention the paint uses), states = the full register.
* A border between two members of the SAME bloc draws as a thin translucent
  **province line**; only true national borders (different roots) keep the
  thick dark stroke. Tributaries read as states of their empire.
* `window.nations()` gains an `over` column (the suzerain's name).

## Lane 2 — the mechanism: why the register only ratchets up

The death-and-absorption half of politics was inert at the shipped grid
(W=1920 catchment arm): **attack PASSED 27,549** but **storm 7 of 11,597**
(`assaultTooWeak`), **capture 10 of 2,914** (`adv<=1`), **integrate 0 of
4,290** (`orgBelowMin` 2,613 + `seatAboveTierCap` 1,562). History's
Renaissance count was FALLING (Europe ~500 → ~350 across 1500–1650) because
empires ate the confetti; the sim's could only rise.

Measured to three mis-groundings (probe_armyfunnel, live arm), one lever
(`T.WAR_FINISH` — built and instrumented; **ships at def 0**, see the
battery verdict; v39 save guard, inert while def 0):

1. **The world had no armies.** The muster desertion test reads the
   settlement food LEDGER — vestigial under the field regime, where the
   census eats from the land's capacity (the owner's own early report,
   "starving but not shrinking", was its shadow). Measured: **90–97% of all
   settlements fail the ledger test with `_foodSupply` p50 = 0.00 while
   their populations grow** — every garrison on Earth melted 20% per muster,
   world army ≈ 1 sim-unit, and every decisive channel starved downstream.
   Fix: a ledger-hungry settlement is still fed if the field that feeds its
   people covers them (Σ capField ≥ Σ popField × the ledger's own 0.98 over
   its catchment — no new constant).
2. **Walls AND paid garrisons were provincial.** `homeMight`'s militia floor
   and `armyCapFrac`'s professional-core base both read `s.people` — the
   CATCHMENT census (CLAUDE.md's trap, fourth and fifth strikes). The first
   battery arm proved the split must be symmetric: re-grounding only the
   walls (urban) while armies still drew 5–9% of multi-million catchments
   made every storm succeed — flows ran ended 96 + shattered 137 against
   founded 36 per 4k steps and the size distribution COMPRESSED (Gini 0.39):
   a boiling map that grinds instead of consolidating. Fix: one honest
   split everywhere — the PAID core and the MILITIA are urban
   (`_urbanPop`), the wartime CONSCRIPT levy is rural (`_ruralPop`, already
   split-aware), the countryside is what a besieger forages.
3. **The seat-grade ladder predates the register.** `tierCapForOrg` demanded
   org ≥ 0.72 to govern a tier-2 seat — but under CITY_AT_BIRTH every entity
   is born tier 2, so integration/absorption required near-industrial
   statecraft to province ANY client. Fix: the law is RELATIVE — a court
   governs client seats up to its own capital's grade (Rome governs Pergamon
   because Rome already governs Rome); the ABSORB_ORG_MIN institutional
   floor stays.

Zero new constants in all three. En-passant: v39 save guard added; PEER_SEATS
(same-day) deliberately ships unguarded so the owner's live peer worlds
survive their own saves.

## Battery — and the verdict: SHIPS AT 0

**Arm 1 (probe_armyfunnel, lever on):** the world arms. World army 1 → 3,894
sim-units by 22k (asymmetric form) and 682 under the symmetric urban split —
~1% of world population under arms, the historical standing share. Fiscal
strain engages (insolvency 24–47%): wages are real for the first time.

**Arm 2 (probe_shape + war telemetry, lever on, tw=480):** the engine
FINISHES now — per-event physics land in the historical band:

* storm: **PASSED 557 of 6,340** heartland sieges (9% per-siege success —
  was 7 of 11,597); `wallsHold(grinding)` 55; `pacifiedGrace` 1,414 — the
  same capitals re-stormed in cycles.
* capture: **PASSED 84, ~205 tiles taken** (was 10); union 39; secede 18.
* integrate: orgBelowMin 937 of 940 — the 0.48 floor rightly holds this
  early; the relative seat-grade unlock matters later, when orgs cross it.

But the AGGREGATE is a warlord blender, not history: flows at 24k ran
**founded 105 / ended 477 / seceded 164 / shattered 557 per 4k steps**, the
size distribution COMPRESSED (Gini 0.41, lnσ 0.86, max 374k) — war grinds
everyone down before anyone accumulates. History's early city-state era had
centuries of coexistence before Akkad: wars constant, decisive annexation
RARE and mostly non-sticking, because levies went home for harvest, wages
were the professionals' only, and early conquests reverted without the
administrative capacity to hold them. Arming the world without that
levy-fiscal physics boils it.

**So the lever ships at def 0** — the miss precedent (STATE_WORKS,
MARCH_LAW, STATE_OPEN): the mechanism is built, gated, instrumented, and
the diagnosis it proved is permanent (the demilitarized register was an
accounting artifact; the three re-groundings are real). The named next lap:
**THE LEVY IS UNPAID** — wages bill the professional core only; levies are
subject duty that disbands for harvest — plus siege persistence (a siege is
a CAMPAIGN that must be maintained, not a per-pass coin-flip), so war
volume falls to history's pace while decisiveness stays.

## Watch items

* War now has teeth in a world of statelets: watch total war mortality and
  realm-death rate against the stylized bands — the goal is the count
  BENDING, not a global annihilation.
* The ledger↔field food split remains two truths; the deeper unification
  (make `_foodSupply` honest under the field regime) is a separate,
  larger lap if its other consumers (growth, trade, sieges) show artifacts.

## 2026-08-21 addendum — laps 5-10 and the first 1.5M km² empire-bloc

Nine further laps landed this day (siege endurance/lift, committed-force
storm, works clock, siege levée, satrap succession, hegemony-before-
annexation, the era-relative absorb bar, and TRIBUTE_UP — the bala), the
lever shipped ON, and the bala verdict arm (tw=480/28k, full live set)
produced the first GeaCron-shaped hierarchy this sim has ever had:

* **Biggest bloc: 26 realms / 1.54M km²** — Achaemenid-entry scale, built
  by the full two-stage chain: sack → tribute bond (130 sackYieldsTribute
  per window) → in-kind bala remittance → granary/market/works →
  capacity/reach → more conquest and integration (120 PASSED/window).
* Top-5 blocs 26/8/8/8/6 realms — one great empire over a tier of
  kingdoms over a mass of statelets: the real map's shape.
* Painted nations (bloc roots): 529 at 28k — the 1500-CE polity band.
* Stateless cities: 6% (from 100% at first cities).

Still open, in priority order: (1) the biggest bloc holds ~6% of claimed
land vs history's hegemonic 25-50% — integration pace (hazardRoll 710 +
beyondDirectRule 478 per window are the binding gates) converts bloc to
territory too slowly; (2) realm deaths ~587/window — churn above the
stylized band; (3) the statehood GRADIENT (owner screenshot 2026-08-21):
statehood fires globally near-synchronously — the Americas/Australia tile
with statelets while history's map at any moment is old dense kingdoms in
cradles, young edges, tribal beyond. Cradle-first consolidation is the
next named wave.

## 2026-08-21 addendum II — enclosure physics and the shadow of empire

The owner's zoomed screenshot asked the two sharpest questions the map can
ask: why do single-tile specks survive INSIDE larger nations, and why does
a vast realm not sweep the statelet cluster on its border? Four laps, each
measured on the same ladder (probe_statefunnel, tw=480, 28k, seed 8817;
"painted" = suzerainty-bloc roots, what the atlas shows):

| arm | painted @28k | biggest bloc | top5 | submit PASSED |
|---|---|---|---|---|
| bala (pre-enclosure) | 529 | 26 realms / 1.54M km² / 6% | 26,8,8,8,6 | 71 |
| + ENGULF submission | 448 | 13 / 1.10M / 4% | 13,11,10,9,8 | 128 |
| + ENGULF integration | 448 (identical blocs) | 13 / 1.10M / 4% | 13,11,10,9,8 | 128 |
| + FEAR_REACH | 492 | **34 / 1.73M / 7%** | **34,24,12,12,11** | 188 |

**ENGULF lap 1 — encirclement compels submission** (`ENGULF=8`, hazard
×(1+8·share²) when one realm holds share of a statelet's land border;
coastline counts as open). Painted nations 529→448, submissions 71→128:
the free-standing specks inside empires kneel within generations.

**ENGULF lap 2 — the same clock on integration — measured a perfect
null**, and the null is the finding: the hazard boost moved +62 encircled
vassals through the roll per window (waiting 832→770) and the downstream
brakes ate every single one — coalitionBrake 76→117, identityBrake
70→91, PASSED exactly 100 in both arms. The neck for DIGESTING an
enclave was never the hazard clock; it was deterrence applied uniformly
to targets no coalition could actually save.

**Lap 3 — enclosure severs relief** (`24cde36`). Deterrence is a promise
of relief, and relief must march across the frontier the suzerain does
not hold — Melos had Spartan kinship, Athens held the sea, nobody came.
At both brake sites (submit + integrate) the deterrence surplus now
decays with the enclosure share already computed for the hazard:
`brake = 1 + (brake−1)·(1−share)` when the dominant encloser is the
hegemon itself. Fully surrounded → no deterrence; free-standing → the
whole balance-of-power guarantee, untouched. No new constant.

**FEAR_REACH — the shadow of empire** (`68266fb`). The threat map
assigned fear across shared borders only, so the INTERIOR of a statelet
cluster never feared the giant next door — submission candidacy never
formed, and the giant could only peel the onion one contact-ring per
patience cycle while the whole cluster coalesced into a counter-
coalition. Now the era's top-24 powers by coercive weight cast threat
over every court whose capital lies within the punitive-expedition
radius the submission gate already enforces (SUBMIT_REACH × holdReach),
and the balance-of-power law extends symmetrically — distant courts
fearing the same giant join the same coalition. Assyria's reputation
reached courts it never bordered; so does ours. Final (28k vs the
ENGULF arm): biggest bloc **13→34 realms, 1.10→1.73M km²**, top5
13,11,10,9,8 → **34,24,12,12,11** — two great empires over a tier of
kingdoms, the strongest hierarchy head any arm has produced.
Submissions 128→188/window, `alreadyADependency` 2,995→4,451 (far more
of the register is bound into orbits), and `resistanceNotHopeless`
rejections per candidate fell — the interior faces the giant's might.
Painted count 448→492 only because the register itself grew (1,081
cities vs 1,027; the confetti replenishes at the edge — the statehood-
gradient wave's territory, not this one's). VERDICT: stays def-on.

**Lap-3 verdict** (28k, fear stack ± the relief law): the brakes it
targets fell measurably — coalitionBrake(deterrence) 97→57 on
integration, 330→265 on submission — and integrations rose 134→141;
the macro shape (biggest bloc 38 vs 34 realms, 1.22M vs 1.73M km²)
sits within single-seed trajectory noise, so this ships as a targeted
unblock, not a macro claim. Enclave digestion is no longer
deterrence-blocked: the integration funnel's necks are now
`orgBelowMin` 2,468 + `hazardRoll` 1,015 + `beyondDirectRule` 1,006
per window against coalition's 57 — the era bar (holding as designed),
the clock, and reach. Those are the integration-pace axis of this
wave, not brakes to discount.

The open necks after this wave, by count: submit `hazardRoll(waiting)`
~4,300 and `resistanceNotHopeless` ~2,400 per window (the pace and the
power bar), integrate `orgBelowMin` + `beyondDirectRule` + the clock
(above). The ATTACK lane — the owner's sharpened question, "why didn't
the large empire ATTACK them?" — is measured separately in the
predation probe (docs/predation, pending): at tw=240 predation is
ALIVE globally (505 ≥4× wars per window) while the TOP-POWER giants
idle at 0-1 offensives below their command capacity; per-giant bar
attribution + a neighbor census at tw=480 will name the binding brake.
