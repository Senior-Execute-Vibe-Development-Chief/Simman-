# Country count & size — measured diagnosis (2026-07)

User report: **countries are generally too few and too large.** This doc records the
measured causes and the trial results (including the negatives), so the follow-up
mechanism work starts from evidence, not vibes. All numbers: 480×240, seed 8817,
15 000 steps, app-identical pipeline (`tools/_harness.mjs` buildSim), current defaults
(post real-width-floodplain fix). The timeline probe lives in the session scratchpad;
its columns are reproducible from `world._countryOwner` + settlement/polity state at
1 000-step checkpoints.

## The measured shape

| step | settled | stateless (pop%) | cities (bar) | countries | claimed% | max realm (tiles) |
|-----:|--------:|-----------------:|-------------:|----------:|---------:|------------------:|
| 1000 | 24 | 12 (47%) | 0 (240) | 3 | 5.9% | 370 |
| 3000 | 35 | 6 (10%) | 7 (240) | 7 | 16.3% | 890 |
| 8000 | 41 | 10 (7%) | 3 (410) | 8 | 22.2% | 753 |
| 12000 | 42 | 3 (1%) | 4 (933) | 10 | 26.2% | 521 |
| 15000 | 70 | 15 (1%) | 4 (2100) | 14 | 46.2% | 806 |

Flows over the run: `polity.founded` = 7 (3 genesis cradles, 3 frontier, 1 fragment)
vs `polity.ended` = 38; `settlement.annexed` = 64, `settlement.captured` = 29,
`polity.seceded` = 20 (mostly reabsorbed). Realm membership at 12 000:
11,7,5,4,3,3,2,2,1,1.

## Findings

**1. The count is arithmetically bounded by the settlement map.** 42–70 settlements
whose realms hold 1–11 members can only make ~10–15 countries. The
`countryTerritory.js` CITY_TIER comment's "~80–100-country target" is unreachable at
this settlement count regardless of any political lever.

**2. City formation didn't stop — it is PINNED by construction.** Cities peaked at 7
(step 3000) and settled at 3–4 forever while the floating city bar climbed 240 → 2100
(`updateTier`: `TIER_THRESHOLD[2]=600 × tierScale`, tierScale = totalPop/29 000 capped
at 3.5 under `DISSOLVE_FARMS`). A *relative* bar keeps "city" = the top handful of the
age — so any sovereignty rule anchored on CITY_TIER (city-led secession, adoptAndFound
founding) can only ever mint a handful of seats. The label is fine as a label; as a
*sovereignty gate* it hard-caps the polity count at ≈ member-count of the top of the
settlement hierarchy.

**3. Primary state formation is fuel-starved by a timing scissors.** Statelessness is
plentiful early (47% of pop at step 1000) but org is below `ORG_STATE_MIN=0.15` — no
one may found. By the time org crosses the bar (~step 4-5000), the cradle realms'
claims + the connected-extension adoption channel (crystallize: a village founded by a
realm's people joins that realm) have consumed the fuel: stateless pop is ~7% by 6000
and ~1% from 10 000 on. The whole run mints THREE frontier states. Note the asymmetry:
a *people* below the statecraft bar cannot found a state, but a *realm* whose org is
below that same bar (the cradles at org 0.11, 9–18 members by step 3000) claims and
adopts without limit.

**4. The tech-reach subsystem is DORMANT — measured, not suspected.** Instrumenting
`computeCountryTerritory`'s seed loop (step ~2000): every seed's basin =
`integMin` floor = 2 cost-units; the ramped national budget (`full`) is 1.2–2.0. The
formula `reach = max(integMin, full × min(1, √(urbanPop/2500)))` multiplies three
throttles — `REACH_SIZE_MIN=0.25`-scaled budget, `√(urbanPop/2500)` ≈ 0.1–0.45 all
game (urban cores never approach 2500), and `BUDGET_RAMP` from `min(target, BASE=4)` —
whose product sits BELOW the floor for every realm at every stage measured. Direct
proof: `SIM_REACH_BASE=99` (25× the base) and a trial `CLAIM_POP_REF` 2500→500 both
produce a 15 000-step trajectory that differs by **±2 tiles at step 14 000, zero
before**. Political territory is therefore *flat member bubbles* (+`REALM_GAP_FILL`,
enclosed-waste fill, capital recolor); org/logistics/personality/value-pull reach
differentiation never engages. **The only live size lever is member count** (hold
capacity, conquest.js) — which is why realms read as uniformly-sized blobs that grow
by absorbing members.

## Trial results (the negatives matter)

- **`FRONTIER_FOUNDING=3`**: frontier foundings 3→7-11; mid-run count 10→14; but the
  extra statelets are conquest fodder — by 15 000 the run ends with **11 countries
  (fewer than baseline's 14), max realm 1849 tiles (vs 806), largest-empire share of
  claimed land 40% (vs 18%)**, and the stylized suite returns **3 soft warnings
  (budget 2) — FAIL**: tech~cradle-distance −0.09 (diffusion signature washed out),
  growth-acceleration inverted, market-integration inverted. Default change REJECTED.
- **`SIM_REACH_BASE=2/99`** and **`CLAIM_POP_REF→500`**: byte-identical trajectories
  (see finding 4). These are not levers today; treating them as levers is a trap.

## What would actually move it (mechanism work, not dials)

1. **Re-couple sovereignty to something the world actually produces.** CITY_TIER
   sovereignty + the floating city bar pins the seat supply at ~4. Either the bar
   stops gating *sovereignty* (only labels), or seats derive from function
   (administrative centres of provinces past the capital's reach) rather than a
   relative size label.
2. **Close the founding scissors.** Symmetric statecraft: a realm's *adoption/claim*
   capacity below `ORG_STATE_MIN` should be as limited as founding is (the cradle
   exemption is currently absolute), so the frontier stays stateless long enough for
   org to arrive — the historical archipelago phase. (This also directly shrinks
   early realm size: 9–18-member org-0.11 cradle realms are the anachronism.)
3. **Revive or retire the reach subsystem.** If reach differentiation is wanted (it is
   — it's the designed size mechanism), the three compounding throttles must be
   recalibrated so `full × popScale` crosses the `integMin` floor for developed realms
   at BOTH grids — NB the git-history warning that empire size is resolution-sensitive
   (`SIM_REACH_ORG` 14→26 over-inflated at app resolution): calibrate at 1920, not
   only 240. If it's not wanted, delete it honestly rather than shipping dead code
   that reads like the size dial.
4. **The settlement count itself** (42–70 at 480; ~235 at the full-Earth 30k run) is
   the deep bound on any count target — that's crystallize spacing / DISSOLVE_FARMS
   territory, with sim-wide blast radius; treat as its own project.

## Update: fix #2 (statecraft symmetry) — IMPLEMENTED

`ORG_STATE_MIN` now gates territorial rule on BOTH sides. (1) crystallize.js: a
mother settlement below the bar spreads PEOPLE, not rule — her daughter village is
born STATELESS (the ride-away path's status) instead of auto-joining the donor's
realm from outside its border; the demographic founding gate was decoupled from the
flag (a connected daughter of any settled community may be BORN — previously
`joinCountry < 0 → not founded`, which a first cut of this gate exposed: settlement
count collapsed 24→4 by step 1000 and all births squeezed inside the three cradle
borders, compounding them to 21 members — worse than the disease). (2)
countryTerritory.js adoptAndFound: a realm whose best org is below the bar cannot
annex an INDEPENDENT settlement its border crawls over; realm↔realm transfers and
losses are untouched. Setting the existing `ORG_STATE_MIN` lever to 0 disables the
symmetry (and the founding bars) together.

Measured (480×240, seed 8817, 15k steps, vs the baseline table above): countries
7→**13** at step 6000, 10→**17** at 12 000, 14→**19–21** at 15 000; stateless pop
share at step 1000 47%→**84%** (a real archipelago phase, integrated as states form:
5% by 8000); max realm at step 3000 **890→195 tiles / 18→3 members** (the org-0.11
continental cradle is gone) while the late imperial tail survives (max 916 at
14 000; max/median 6.7→4.5). probe_egypt: Old-Kingdom-era Egypt (org≈0.1–0.2) now
claims 130–220% of modern Egypt's area (was 330–450%), growing to ~440% only as
statecraft rises. At 960: countries 5→11 by step 8000, same shape. Frontier
foundings 5→11 per 15k steps and — unlike the FRONTIER_FOUNDING=3 dial, which fed
the extra statelets to a 40%-of-claimed-land hegemon and failed the gates — the
stylized suite passes **3/3 seeds** (0/2/1 soft warnings, within budget 2). Honest
caveat, verified side-by-side against baseline (which shows 0 warnings on the same
seeds): the warnings are NEW to this change — on 2 of 3 seeds the growth-
acceleration signature softens (e.g. 12.3% vs 20.1% per window) and on one the
market-integration correlation flips. Plausibly the longer stateless phase delays
early market integration; within the suite's own tolerance, but worth watching if
the growth gate tightens. Smoke green; deep roundtrip byte-identical; hash guards
re-baselined in the probe headers.

## Update: the supermassive-realm follow-up (empire MORTALITY) — IMPLEMENTED

User re-report after the symmetry fix: counts better but winners still reach
"all of Europe" size. A 24k-step anatomy probe found the giants IMMORTAL: the two
oldest realms lived the entire run, secession fired 12 times in 24k steps against
76 polity deaths (shed one-member orphans die and return to the giants), and the
leader held capacity 225 against load 24 at 17 members. Three coupled defects, all
in conquest.js:

1. **The CAP_MODEL dominance tail rewarded SIZE, not efficiency.** fiscalSurplus
   compared realm-TOTAL revenue to the peer-median realm — but total revenue is
   member-count × per-province take, so a 17-province realm of ordinary provinces
   read ~5× "dominant" and its capacity compounded on its own size (revenue →
   capacity → members → revenue). Fixed: extraction measured PER PROVINCE against
   the peer per-province median — the tail now pays for the efficiency the comment
   always claimed it measured. Dominance multipliers fell 2.7–5.1× → 1.0–2.6×;
   over-budget episodes now actually occur at the top.
2. **The secession seat-bar was silently re-broken by the CITY_TIER raise.**
   blocHasCity's own comment records that requiring a full city "was the bug that
   made empires immortal" and documents the fix as tier ≥ CITY_TIER *when
   CITY_TIER meant TOWN*; raising CITY_TIER 1→2 (the correct anti-swarm fix for
   FOUNDING) dragged this bar and the overmighty-governor seat gate up with it —
   and the floating city bar (finding 2 above) pins labelled cities to ~4 in the
   world, so in a 17-member giant NO member could ever lead a breakaway. Founding
   and secession need different bars: a successor inherits a working
   administration.
3. **Provincial seats didn't exist without the label.** assignProvinces seated
   provinces on cities only, and buildHierarchy's strictly-higher-tier rule
   concentrates vassals on the capital under DISSOLVE (everyone is tier 1), so
   there was no functional route to a governor either. Fixed: a provincial seat is
   the LOCALLY-STRONGEST member within a PROVINCE_SPAN (=9 ref tiles, the same
   region scale as NUCLEATE_R) — label-free; blocHasSeat and the governor gate
   accept it; and the governor's power base is his PROVINCE's aggregate power
   (a satrap's strength was his satrapy), reducing to the old reading for size-1
   provinces.

Measured (480×240 seed 8817, 24k steps, vs pre-fix): realm count 13–18 →
**25–26 mid-game** (19 at 24k — late consolidation at industrial logistics is
earned); secessions 12→**39**, shattered 41→48; mid-game max realm 810–1066 →
**545–755 tiles**; the top-5 leaderboard now TURNS OVER at every checkpoint
(empires rise and fall) instead of two immortal realms sitting on it all run.
Stylized gates: **3/3 seeds pass** (1/2/0 warnings — the pre-existing growth
warning; the 4242 market warning eased −0.83→−0.47; 31337 fully clean), with the
polity gates IMPROVED on the CI seed: 22 polities (was 14), largest-empire share
15% (was 18%), fallen-lifespan median 887 steps. Smoke green; deep roundtrip
byte-identical; hash guards re-baselined. Residual (recorded): the modern-era
endpoint still consolidates toward ~19 realms with 20M-km² leaders — right order
for industrial great powers, but decolonization-style dependency breakup and the
settlement-count bound (finding 1) remain the next levers if more late-game
granularity is wanted.

## Post-mortem: why every prior review and gate missed this

Recorded so the pattern is recognisable next time.

1. **Part of it WAS found and lost in triage.** The July-2026 fleet review filed the
   blocHasCity re-break as finding "[0] PLAUSIBLE MINOR" (bugs.txt:277) with the
   exact fix later applied — adversarial verification split on it, MINOR read as
   cosmetic, and the fix waves worked the CONFIRMED-critical clusters (save/load,
   cardinal-rule violations). A local gate misread as minor was actually one leg of
   the map's dominant failure: severity-by-local-reading cannot see systemic effect.
2. **One defect was CREATED by a review fix.** The review correctly flagged the old
   CAP_DOM_P dominance tail as a fitted exponent; the grounded CAP_MODEL replacement
   shipped with the per-realm-vs-per-province units error, so the "mechanism" paid
   for size. New mechanism, new bug, after the review's snapshot — and calibrated
   against gates that cannot see immortality.
3. **The gates measure distributional SHAPE at an instant; immortality is a
   TRAJECTORY property.** Share-%, tail ratios, Zipf, and fallen-lifespan (which
   excludes the immortals by construction) all pass a frozen-leaderboard world.
4. **The pathology lives past the validation horizon.** The leaderboard freezes from
   ~step 16k; CI runs 15k. Measured while attempting a gate: at 15k a broken build
   is indistinguishable (top-3 churn 9 vs 12); at 24k it separates only weakly
   (7 vs 10) AND the other bands — calibrated at 15k — false-warn on legitimately
   modern worlds. Hence NO scored gate: `tools/probe_empires.mjs` (top-realm ages,
   capacity-vs-load, war/absorb flows at 24k) is the instrument, and stylized now
   prints the churn/secession numbers unscored for the deep manual tier.
5. **Compensating errors tuned in different eras.** "Everything shatters" was fixed
   by adding capacity (CAP_K, instMul, dominance, hysteresis — each individually
   justified); "micro-state swarm" was fixed by raising CITY_TIER. Each was
   validated against the complaint it addressed; nobody re-measured the PAIR, and
   when the secession side silently died, the capacity side had no opponent left.
   The diagnostic instruments to see any of this (realm age/flows/capacity-slack)
   did not exist until this session — and the pre-existing country diagnostics
   (diag_countries, render_country) bypass the pipeline entirely, so they measure
   a world without the floodplain/fertility substrate the sim actually runs on
   (also worth fixing).
