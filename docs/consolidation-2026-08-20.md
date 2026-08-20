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
