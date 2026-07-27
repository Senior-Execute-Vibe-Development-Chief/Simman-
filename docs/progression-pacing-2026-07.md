# Progression pacing — the early-game anachronism pass (2026-07)

Four player-facing complaints, one underlying pattern: **capabilities the world
had not yet earned were on the map from (nearly) tick 0**, and the one era that
is *supposed* to be short was the longest thing in the run.

1. Stone Age lasts too long
2. Roads: too long, too early — and inaccurate later
3. Sea lanes in the deep Stone Age
4. Do we need stateless settlements? / universal boosts on age change?

Everything below is measured with `tools/probe_erapace.mjs` (era spans on the
uniform human clock) and the new `tools/probe_progression.mjs` (per-checkpoint:
leading knowledge, road census by quality band, sea-lane count/span, ports
projecting lanes with vs without the Sailing tech, stateless share).

## Baseline (seed 8817, 480×240, all defaults, pre-change)

- **Stone Age: steps 0–11700** — 2925 dyn-years, **9.8×** its display span,
  **39% of a 30k run** — while Bronze ran 1.2×, Medieval 1.3× (on target).
  The world's own org↔year calibration (cohesion.js CIV_ORG_YEAR: org 0.10 ≈
  −6000, 0.18 ≈ −3300) says the sim was faithfully simulating ~2700 years of
  late neolithic; the problem was the *starting vector*, not the growth law.
- **Sea lanes from step 8000** (lead navigation 0.07): 9 lanes, spans to 14
  tiles; 29 lanes spanning 35 tiles by step 14000. **Every lane-holding port
  until ~step 24000 lacked the Sailing tech** — the whole early sea web rode
  the zero-tech `SEA_RANGE_BASE = 10` (≈40 tiles of open water for any coastal
  village with pop ≥ 20 and token navigation drift ≥ 0.04).
- **Roads:** 128 painted tiles by step 6000 (lead construction 0.17 —
  pre-pottery); **89 tiles worn to arterial grade (≤0.1, i.e. 12× cheaper than
  terrain) by step 10000**, construction 0.26. Flow alone paved Roman-quality
  surface with no engineering anywhere on the planet.
- **Stateless settlements:** 95% at genesis (correct — statehood must emerge),
  still 53% at the Medieval checkpoint — and locked out of *all* trade
  infrastructure (the state gates on `linkCloseNeighbours`, review I19), so
  they sat on the map doing nothing.

## Mechanisms changed (all state-derived; no dates, no era gates)

### Genesis: an internally consistent neolithic package
`makeSettlement` seeded natural villages with agriculture 0.50 (established
cereal farming) but construction 0.10 (pre-pottery) — a society ~2000 years
out of joint with itself. The whole pre-Bronze arc is the construction track
crawling 0.10 → 0.36 (mining), so that skew alone WAS the overlong Stone Age.
Now **construction seeds at 0.18** (pottery just mastered — the granary craft
no farming people ever lacked; the tech-tree gate for Pottery), in both the
genesis vector (settlement.js) and the independent-invention baseline
(crystallize.js). Organization stays 0.1 — statehood is still earned.
Initial conditions of the world at t=0, not a gate on anything.

### Roads: surface quality is the builder's roadcraft; paving is state engineering
- `paintRoad` now paints at **`paintQualityFor(builder)`**: 0.58 (kin path)
  → 0.25 (`QUALITY_NEW`, engineered) as the builder's construction crosses
  0.10 → 0.60 (the construction band of the Roads tech). A later, more
  skilled builder re-planning a route upgrades the old surface (min()).
- Flow-paving splits into three regimes by what the tile's owning realm has
  earned (capital `techEff().have`, memoised per tick): traffic alone
  hard-packs any surface down to **`TRACK_FLOOR = 0.30`**; the **Roads tech**
  paves busy corridors on to **`PAVED_FLOOR = 0.12`** — deliberately kept
  *above* the river lane (0.10), because water haulage stayed cheaper than
  the best road until rail (review I17: the old single 0.08 floor priced a
  Roman road below a river barge); the **Railroad tech** takes corridors to
  `QUALITY_MAX = 0.08`, the one land mode that historically beat the barge.
  When a realm earns each unlock, its busy corridors simply pave on — the
  emergent via (then rail-age) network. Unowned ground keeps tracks.
- Trunk-road *planning* horizon (`partnerReachFor`) base halved (20 → 10
  reference tiles) and now grows with construction as well as
  mobility/navigation (max ×2.4) — a hamlet plans to its neighbours; the
  wheel, pack routes and engineering push the horizon out.
- **`linkCloseNeighbours` is un-state-gated** and runs on its own
  one-settlement-per-tick rotation over everyone settled (review I19's
  recommendation): kin paths never needed a court. Stateless communities now
  trade along paths; trunk *planning* (tryAddRoad) keeps its statecraft gate,
  though stateless peers are now legitimate trunk *destinations* (the
  tin/amber pattern). The renderer draws tracks/paths thinner and fainter
  than engineered roads.

### Sea lanes: the sail is the gate
- `SEA_RANGE_BASE` 10 → **2.0** — the pre-sail range is a paddled strait hop
  (Cyprus, the Aegean obsidian run, Sahul: real but a few tiles), not a sea
  web.
- Lane projection beyond that hop requires the **embark ability (Sailing
  tech)**: `budget = SEA_RANGE_BASE + (embark ? seaRange · T.SEA_RANGE_NAV : 0)`.
- Sailing gains a `seaRange: 0.12` share in TECH_FX — the sail is what turns
  strait-hopping into coastal shipping, so the sea web opens at the Sailing
  unlock at roughly the reach the old zero-tech base handed out at tick 0,
  then grows through Galleys → Compass → Caravels → Ocean Sailing →
  Steamship exactly as before (the channel renormalises; max is unchanged).

## After (measured, same probes)

**Era pacing (probe_erapace, 30k steps, seeds 8817/4242/31337):**

|                | 8817 | 4242 | 31337 |
|----------------|------|------|-------|
| Stone Age ends | 9000 | 9300 | 8400  | (was 9900–11700)
| Bronze ratio   | 1.5× | 1.5× | 1.5×  | (seed spread was 0.9–1.7×)
| Iron ratio     | 0.4× | 0.4× | 0.3×  | (the pre-existing classical gap, untouched)
| Medieval       | 1.3× | 0.5× | 0.9×  |
| Renaissance    |  —   | 1.1× | 1.1×  |
| Industrial     |  —   | 1.0× | 1.5×  |
| epoch fit      | −5717| −5705| −5450 |

**Progression (probe_progression, seed 8817):** through the whole Stone and
Bronze Ages the road network is paths and (from ~step 18000, lead
construction 0.55) hard-packed tracks — nothing below the track floor until
a realm discovers Roads (and nothing at rail grade until Railroad); sea
lanes before Sailing are strait hops (max span 8–9 tiles vs 35 before); at
step 24000 Sailing arrives and the sea web opens (45 lanes, span 34) —
*with* the sail instead of 16k steps before it. Stateless share falls to
~24% by step 22000 (was ~52%): path-connected free communities develop and
found/join states faster, so the same change that made them useful also
thinned them.

The display/dynasty epoch (`calendar.js DISP_START/DYN_START`, cosmetic,
CRADLE_EVE=0 branch) was re-fit per the established procedure: −4300 →
**−5500** (the 3-seed fits −5717/−5705/−5450, ≈ −5390 with the Iron anchors
excluded as the documented classical gap). Bronze now displays at
~3200–3400 BC on all three seeds — its historical date.

## The two questions

**Do we need stateless settlements? — Yes; they are load-bearing.** They are
(a) the *entire* pre-state world (under CRADLE_EVE=0 every settlement is
born before any state exists — removing them means re-injecting scripted
states at genesis, which was measured and removed in 2026-07 as the
territorial balloon); (b) the fuel of primary state formation
(`nucleateFrontierStates` — a state is born FROM a developed stateless
basin); (c) the steppe-horde genesis path (rode-away camps); (d) the honest
representation of the non-state world that persisted alongside states for
most of history (the 53%-at-Medieval share is the segmentary periphery —
forest/disease/capacity-gated, thinning as states expand). What was wrong
was not their existence but their idleness — they were locked out of trade
infrastructure entirely; the kin-path change above fixes that.

**Universal boosts on age change? — None exist, and none should.** Audited:
the era index is computed for the chronicle/event log, the HUD ribbon, and
the tech-tree colouring — all read-only displays. Every bonus in the sim is
per-tech (knowledge thresholds, per culture, with techEffects' partial-credit
on-ramp smoothing even individual unlocks); the only world-level development
signal (`_civYear` → identity-salience weights) is a smooth function of the
leading capital's organisation, read per-pair so uncontacted regions keep
their own era. An age flip grants nothing — by the first cardinal rule it
never may.

## Addendum — THE URBAN FLOOR (owner ruling: entities are cities/large towns only)

The stateless-settlements verdict above was superseded in one respect by the
owner's ontology ruling: settlement entities represent cities and large
towns only, so the sweep's 18–26-person births were entities below the
model's own representational floor — and *they*, not statelessness itself,
were the flagless-wilderness artifact. Fix (crystallize.js, state.js; full
rule in docs/settlement-ontology.md "THE URBAN FLOOR"): births require a
peopled basin (≥360 field people in the market catchment), found at town
scale (90–118) drawn OUT of the basin field (conserved), cradles seed at
110, steppe camps stay the one documented small/stateless exception.

Measured (3 seeds, same probes): Bronze attainment moved again, 8400–9300 →
**7200–7800** (town-scale foundings learn faster — the Stone Age is now
~24% of a 30k run, from 39% at baseline); Bronze 1.4–1.5×, Medieval
0.8–1.4×, Renaissance 1.3–1.5×, Industrial 1.0–1.5×, Iron 0.4× (the
classical gap, unchanged); stateless falls 56 → 25 by step 16000 with the
biggest ever stateless settlement 239 people (org 0.13 — a genuine
pre-state town, the Çatalhöyük case) and none on claimed ground; stylized
suite all hard gates green (1 in-budget soft warning: only 4 polities
fallen in-window — more states form earlier, the board is younger). The
display/dynasty epoch re-fit accordingly: −5500 → **−5250** (3-seed fits
−5342/−5240/−5240), landing Bronze on screen at ~3300–3450 BC.

## Addendum 2 — the SEGMENT CAP (owner: "still continent-spanning roads between two little settlements")

Right: the first roads pass fixed surface QUALITY and TIMING but left the
LENGTH of a single planned route ungoverned — `partnerReachFor`'s uncapped
√pop term let a modest early town plan a ~20–26-reference-tile line (a
reference tile ≈ 170 km: ~4,000 km), and the kin-path pass guaranteed
painted links out to 20 reference tiles (~3,300 km). The urban floor made
it worse: every 90+-person founding instantly cleared both the planning
(60) and linking (30) population bars. Fixes (roads.js, WorldSim.jsx):

- **A hard cap on any single planned segment**: `min(want, SEG_CAP_BASE 12
  + SEG_CAP_LOGI 36 × logisticsLevel)` reference tiles. Pre-logistics
  cultures plan only to the neighbour ring (~the founding-spacing scale);
  the classical roads era stretches it to ~20; the rail age to ~35–48 —
  the first genuinely continental single land routes, exactly when history
  built them. Long-range land trade below that tech is what it really was:
  a RELAY through intermediate towns, which the trade-reach chaining
  already models (and which stays unbounded, as it should be).
- **Kin paths shrink to the real neighbour ring**: CLOSE_NEIGHBOUR_DIST
  20 → 12 reference tiles (the founding-spacing rings on habitable land);
  pairs farther apart than that are not "close" in any sense and get no
  guaranteed path — ultra-sparse pairs stand honestly isolated (and under
  the urban floor such entities barely arise).
- **Pre-engineering surfaces render as desire lines**: a track/path draws
  only while it carries real traffic (flow ≥ ~a sustained trade trickle);
  engineered roads always draw (masonry persists). No phantom lines
  between towns that never trade; no ghost paths through the
  multi-thousand-tick abandonment decay.

Verified with build telemetry (`world.debug.maxBuildSpan`, printed by
probe_progression): the longest single build over a 16k-step run is
exactly **12 reference tiles** from tick 0 through the Bronze Age; the
longer all-road trade links the probe still reports (27–48) are relay
chains threading towns/junctions — the Silk-Road structure, drawn only
where flow actually runs.
