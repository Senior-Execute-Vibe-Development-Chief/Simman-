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
(above).

## 2026-08-21 addendum III — the predation lap (SMALL_WAR)

Owner, sharpening the sweep question: *"my problem wasnt they werent
submitting, it was: why didnt the large empire attack them?"*

**Diagnosis** (probe_predation + the war-debug predation/watch slices,
tw=480, full live stack): the war BAR was open — 57,817 predatory
(≥4×) pair-passes per window CLEARED it at 28k — and **command
capacity ate them: 119,019 of 181,963 attack-capable moments refused
(65%)**, coalition deterrence a distant second (19%). The neighbor
census caught the giants in the act at every checkpoint: Sogyoepa
(pow 20,239) spending its single command slot on its 2.2× near-peer
across their 20-tile border while free neighbours 796×, 372× and
infinitely weaker sat adjacent, bar-cleared, unattacked forever. The
serial-war law priced a punitive expedition like a great-power war.

**The law** (`83d6b66`, `SMALL_WAR=8` def-on): a foe an order of
magnitude below you is a POLICE ACTION, not a war in the command
sense — the sovereign's field army stays home, a detachment
prosecutes it (the consul fights Carthage while a praetor's column
sacks the hill forts). Threshold derived, not tuned: a detachment of
~¼ of forces at ~2× storm superiority handles any foe ≤ ⅛ your
weight. Police actions neither consume a command slot nor are refused
for want of one, and symmetrically don't crowd peer wars out of the
ledger; the one-new-enemy-per-pass declaration cadence still applies,
so mop-ups stay serial. Self-calibrating: the bigger the realm, the
more of its neighbourhood is a police action.

**A/B verdict** (tw=480/28k, identical stack ± lever): predatory wars
2,901 → 3,376/window (+16%), crushing (≥10×) 2,023 → 2,440 (+21%),
register 771 → 689 realms (−11% — more statelets eaten), total war
+11% with NO shatter cyclone (the register still grows). The endgame
dashboards show the design working literally: Nitufpok (pow 29,175,
18 members) prosecuting TWO simultaneous police actions against
zero-power statelets while its peer border rests in truce; a
30-member realm sitting in post-sweep digestion truces. SHIPS.

**Predation necks after this lap, by pred-slice count/window:** the
paper-coalition brake 10,697 (deterrence pooled with NO projection
term — an ally that cannot reach the theater still deters; the
colonial clause four lines below it already has the correct
`power × projection` law — generalize it), parity 9,539 (frontier
projection, honest), truce cycle 7,035, amphib bar 5,602.

**Lap 2 — RELIEF_REACH** (`fc1ef54`, def-on): the generalization
above, built. updateAlliances records bloc MEMBER lists beside the
pooled scalar; each member backs a threatened court weighted by
whether its punitive column can arrive (full weight inside half its
own SUBMIT_REACH × holdReach relief radius — the submission gate's
own credible-expedition bound — fading to nothing at the radius; the
defender backs itself in full). A/B on the SMALL_WAR arm: pred-slice
coalition brake 10,697 → 9,062 (−15%; most deterrence was already
LOCAL and stays — the honest share), predatory wars +7%, crushing
+8%. Cumulative over both laps vs the pre-predation control:
**predatory wars +25% (2,901 → 3,615/window), crushing +30%**, and
every giant on the final dashboard prosecutes TWO police actions at
once, their peer borders resting in truce (one at 35 members — the
largest realm any arm has produced).

**The wave's atlas verdict** (probe_statefunnel, full stack, 28k):

| arm | painted | biggest bloc | top5 |
|---|---|---|---|
| bala | 529 | 26 / 1.54M km² / 6% | 26,8,8,8,6 |
| + ENGULF | 448 | 13 / 1.10M / 4% | 13,11,10,9,8 |
| + FEAR_REACH | 492 | 34 / 1.73M / 7% | 34,24,12,12,11 |
| **+ SMALL_WAR + RELIEF_REACH** | **440** | **38 / 2.07M / 8%** | **38,19,12,12,12** |

The first arm to move BOTH owner-facing axes at once: fewest painted
nations of any rung AND the largest empire-bloc of any rung — the
sword now feeds the atlas. Remaining gap unchanged in kind: the top
bloc holds 8% of claimed land vs history's hegemonic 25-50% — the
bloc→territory conversion (integrate `orgBelowMin` 3,282 +
`beyondDirectRule` 563 + the clock) is the standing integration-pace
axis. Predation necks now, in order: parity (honest frontier
physics), truce cycle (7,035/window pred), the amphib bar (8,100 —
sea-borne predation, a later lap), and the march of sieges for war
texture.

## 2026-08-21 addendum IV — the first tw=960 rung, and the app-stride bug

The owner's app screenshot (tw=960, step 22.6k: BRONZE AGE, 11 states,
94% stateless, a carpet of birth-sized cities) contradicted every arm in
this doc — and the seam was neither the sim nor a stale save but the
STRIDES: five inner cadence gates in the strided settlement pass
coincide with the app's SETT_STRIDE=3 only every lcm(3,8)=24 ticks, so
crop adoption/domestication (event-like, not dt-compensated) ran at a
THIRD of the measured pace in the shipping app only. The harnesses pin
stride 1 — every gate ran in the exact regime where the bug does
nothing (the resgate blind spot in TIME). Fixed (`faac4e2`): inner
cadences snap onto the stride's grid; K=1 byte-identical.

The harness-stride tw=960 arm (28k, full stack —
`docs/runs/2026-08-21/shipfunnel960.log`) is the ladder's first
shipping-grid rung and its strongest world:

| grid | painted | biggest bloc | top5 | stateless |
|---|---|---|---|---|
| tw=480 (predation stack) | 440 | 38 / 2.07M km² / 8% | 38,19,12,12,12 | 8% |
| **tw=960 (full stack)** | **295** | **33 / 1.64M km² / 9%** | **33,28,27,24,13** | **12%** |

FOUR empires above 24 realms — the deepest empire tier of any arm.

**Stride verdict (same day): ACQUITTED as the screenshot's cause.** The
app-stride BEFORE arm (buggy binary, SETT_STRIDE=3/TRADE_STRIDE=5,
tw=960/24k — `shipfunnel960_appstride.log`) measured 424 cities / 33%
stateless / 239 realms — statistically identical to the fixed
reference. The cadence composition was objectively wrong and the fix
stands (exact at every stride, byte-identical at the pins), but at this
grid the technique WAVE carries farming's spread, not the per-settlement
crop events that ran slow — the bug's world-level effect is negligible.
The screenshot's leading explanation moves to the BUILD VINTAGE: the
probes that sweep to statehood all carry the same-day caravan-exchange
lap (EXCH_WAVE, `e39080c`), which thaws the tally-frozen basins that
bind hardest at tw=960 — a world whose dawn ran on a build from hours
earlier lacks it. A discriminating arm (app strides, EXCH_WAVE=0,
TECH_USE=0 — the pre-screenshot lever state) is running; if it
reproduces the ~11-state stall, fresh worlds on the current build are
already healed.

**Case closed (the 22.6k screenshot):** the pre-caravan vintage arm
(`shipfunnel960_precaravan.log` — app strides, EXCH_WAVE=0, TECH_USE=0)
does not stall permanently either (220 realms by 24k) but comes
closest: at 20k it holds 19 realms / 13 painted with 30% of the
register at the birth bar — half the realms and triple the slop-pile of
the full stack at the same step. The statehood sweep is STEEP (100% →
64% → 36% stateless in successive 4k windows), so a snapshot on the
sweep's early edge reads as ~10 nations / 90%+ stateless / a
birth-sized carpet — the screenshot is that phase, arriving later on
the older build and that world's seed timing. No standing stall exists
in current code at any measured configuration; the four-arm tw=960
table (reference, buggy strides, fixed strides, pre-caravan) is the
shipping grid's validation set. A fresh world on the current build is
the user-facing confirmation; a current-build world still 90%+
stateless at 24k would be a live repro worth attaching to directly.

## 2026-08-22 — the levy lap, from the owner's own run

The owner's first full app run at the shipping grid (36,312 steps, all
levers default — `docs/runs/2026-08-22/owner-run-t36312.txt`) is the
first observation artifact the run-journal tooling produced, and it
settled one question and opened another.

**Settled — the 22.6k screenshot.** The journal reads *step 22,001: 9
states, 95% stateless, Bronze Age* against the screenshot's step 22,592
/ 11 states / 94%. An exact match, and the run then swept normally
(95% → 58% at 28k → 25% at 32k → **10% stateless at 36k**, 1,223 cities,
465 painted nations, 260M people at Medieval — city count and
population both on history's band). The sweep-onset diagnosis is
confirmed from the owner's side; no stall exists.

**Opened — blocs that never became force.** The same journal:
`storm: assaultTooWeak 4,018 of 4,318` per 1k steps (93%), 21 storms
passing, `capture` healthy (1,540 tiles), and **81% of states still
single-city** under 358 vassal bonds. Empires existed on the map and
not on the battlefield. Cause: `natMight` summed a country's OWN
cities, so a suzerain of two dozen clients marched with its metropole's
garrisons alone — while the capitulation test five hundred lines below
already pooled dependencies ("a suzerain weighs with its clients").

**T.VASSAL_LEVY** (`bbf91d7`, def 0.5): a dependency marches — a share
of its might joins the suzerain's field army and is DEBITED from its
own (mass-conserving; an over-extended empire hollows the clients that
then revolt), decayed by reach (holdReach → the SUBMIT_REACH punitive
radius) and by loyalty. Verified wired: `effPool` → `natMight`, so the
levy reaches the storm's committed force.

**A/B verdict (tw=480, identical stack ± the lever) — and a same-day
correction: the effect COMPOUNDS, so the first reading understated it
threefold.** Read at 28k the lever looked modest; read at 32k, after
bonds accumulate, it is the largest single consolidation gain any lap
in this campaign has produced.

| | levy 0 @28k | levy 0.5 @28k | levy 0 @32k | levy 0.5 @32k |
|---|---|---|---|---|
| bonds | 248 | 264 | 358 | **459** (+28%) |
| biggest bloc | 18 realms | 23 | 42 realms / 1.53M km² | **70 realms / 2.16M km²** (+67% / +41%) |
| top-5 bloc realms | 18,17,14,12,11 | 23,19,17,16,11 | 42,20,16,15,14 | **70,39,32,31,17** (+77% by sum) |
| storm PASSED | 283 | 292 | 390 | **491** (+26%) |
| capture PASSED | 89 | 104 | 239 | **268** (+12%) |
| cities | 1,049 | 1,087 | 1,288 | **1,467** (+14%) |
| stateless | 17% | 13% | 2% | 3% |

The mechanism is self-reinforcing exactly as history's was: bonds beget
levies, levies beget victories, victories beget bonds. At 28k (264
bonds) it bought +19% on the empire tier; at 32k (459 bonds) it buys
+77%. The intermediate reading is recorded here deliberately — the
28k-only verdict said "modest gain, honest miss," and it was wrong
because a compounding lever cannot be judged at the front of its own
curve.

**What still does NOT move, at either horizon.** Singleton states hold
at 82%, and the biggest bloc holds 6% of claimed land against history's
hegemonic 25-50%. The storm SUCCESS RATE is flat (2.1% → 2.2%) — the
extra storms come from more war, not easier walls. So the levy answered
"can an empire mass force?" and not "why is a realm so small?"

**What the storm numbers teach.** The storm RATE may not be the honest target:
history's sieges mostly ended in starvation, treachery or negotiated
surrender rather than escalade, and the sim's alternative channels DO
fire (siegeLifts 326, sackYieldsTribute 117 per window). The measured
gap that matters is territorial, not tactical — at 32k the biggest bloc
holds **42 realms but only 1.53M km², 5% of claimed land**, against
history's hegemonic 25-50%. Blocs are wide in COUNT and thin in LAND.
That points back at the integration axis (`orgBelowMin` refusing 4,783
of 8,336 candidates per window) and at median realm size, not at the
walls. Next measurement, not next build.
