# The default-flip campaign (2026-07) — every dormant lever turned on or removed

**Directive (owner):** "turn on or remove all default-off levers." Before the
campaign the sim shipped with **38 of 295 levers at def 0** — two full
economy arcs and a decade of experiments invisible to anyone who never
touched the Levers panel, and every new arc testing against a default world
increasingly unlike the intended one. The campaign retired that debt:
every dormant lever either became the default (behind a multi-seed gate) or
was deleted with its code path (when its own record said it failed).

## Method

Verdicts from each lever's own recorded evidence (tuning descs are
self-documenting here: EXPERIMENTAL / measured-off / pending-battery), the
design docs, and fresh gates: `npm test` (determinism, invariants,
save/load) + 3-seed stylized (8817/4242/777, 21k @ 480) + the 20k economy
probe + headless UI smoke, per wave. Removals delete only never-taken
branches (byte-safe); flips change the world and must re-pass everything.

## Wave 1 — the goods-vector stack + urban footprint (15 flipped, 7 removed)

**Flipped ON** at their battle-tested values: `RES_SCARCITY, SPEC_RELATIVE,
GOODS_PRICES, GOODS_TRADE, GOODS_CHAIN, GOODS_CLOTHQ, GOODS_TEMPER=0.5,
GOODS_FREIGHT, ARMY_PROCURE, GOODS_STOCKS, GOODS_INVEST=0.5,
RESOURCE_WARS=0.5, INDUCED_INNOV=0.25, GOODS_UNIFY` + `URBAN_FOOTPRINT`.
Gate: smoke green, stylized **3/3 seeds**, UI exit 0, and the bare-defaults
20k probe **byte-matched** the SIM_TUNE-tested stack world (99 settlements /
30,970 pop / 321,812 wealth) — proving flip ≡ tested configuration.

**Removed** (dead, rejected, or superseded per their own records):
- `ANCHOR_POP` — the legacy demographic anchor: population steered to the
  recorded historical curve, the codified two-clock trap the first cardinal
  rule exists to forbid. Deleted with its whole machinery
  (realWorldPopSim + applyDemographicAnchor, index.js).
- `CLAIM_POW` — unread since FIELD_POLITY became the default (audit 2026-07).
- `LAND_TOOL_GATE` — its own desc: "measured at every strength 0.35–0.7 it
  costs more than it buys." (`LAND_CLEAR_METAL` stays — live readers.)
- `ORG_APT_CAP` — measured to fatten the biggest realm ~+50% at every tested
  value (audit); the aptitude LEARNING half lives on.
- `LOCALITY_MODE` + `LOCALITY_SPACING`, `URBAN_NODES` — settlement-ontology
  experiments superseded by the shipped DISSOLVE_FARMS region model.
- `ADOPT_ADMIN` + `ADOPT_ADMIN_DELAY` — an explicit spike whose tenure state
  was never persisted/hashed; the render-decoupling goal it served is
  re-noted in countryClaim.js for a proper future implementation.

## Wave 2 — the industrial-transition bundle (7 flipped)

`INDUSTRIAL_CAP=25, URBAN_IND=3, OUTPUT_TOTAL=1, FIAT_OUTPUT=6,
MODERN_FISC=0.15, FIAT_SMOOTH=0.02, INDUSTRIAL_REACH=4` — exactly the
values of the industrial-transition doc's own full-stack battery (§ the
battery table; INDUSTRIAL_REACH=4 per its 8-vs-4 comparison). All gates are
industrially-gated (emergent thresholds, never a clock), so the classical
era is barely touched — confirmed: 3/3 seeds green, macro at 21k within the
usual band. Also removed in this wave, covered by its battery:
- `RIVER_REACH` — persistent-territory-spec's recorded verdict: "off —
  over-concentrates" (VALUE_PULL alone rides the banks).
- `CAP_GEO` — the other member of ORG_APT_CAP's measured "fattens the
  biggest realms" family; the emergent capacity ruler carries size variety.

## Wave 3 — screens, a FAILED combined gate, a bisect, and honest verdicts

All four candidates (`TILE_IDENTITY, CROP_AXIS, CTRL_LIVE, ALLY_FRONT`)
passed single-seed screens — then the four TOGETHER **failed the combined
full gate**, exactly what the gate exists to catch: smoke failed twice
(`field culture matches entities — 282 mismatched`; load-continuation
diverging to 8 countries / 100 % land vs the original's 16 / 70.5 %) and
the probe world was politically pathological (5 countries, largest empire
65 % of claimed land). A five-way bisect (each lever alone vs base, 12k)
attributed everything:

| lever alone @12k | countries | pop | verdict |
|---|---|---|---|
| base | 72 | 13.6k | — |
| `ALLY_FRONT=1` | 72 | 13.6k | **byte-identical** → FLIPPED ON (relief arms only when a bloc member is stormed by its balance target; screened green at 21k) |
| `CROP_AXIS=1` | 50 | 21.1k | real, sane shifts → full gate (smoke + **3/3 seeds**) → FLIPPED ON — the continental axis is now emergent from concrete crop packages by default |
| `TILE_IDENTITY=1` | 65 | 19.7k | macro sane but **fails its own culture-consistency invariant** (the 282 tiles) → Stage-2 lever REMOVED; the Stage-0/1 identity mirror stays live; settlement-ontology remains the spec |
| `CTRL_LIVE=1` | **8** | 44.7k | **the world-breaker** — runaway consolidation + the unpersisted-field load divergence → prototype lever REMOVED; the render control field stays; field-polity-spec keeps the design |

After the verdicts, bare defaults were proven **byte-identical** to the
bisect's corresponding lines twice over (post-removals == base; post-
CROP_AXIS-flip == the CROP_AXIS line) — flips and removals landed exactly
as measured, nothing else moved. Residual chore, documented: unreachable
guards on the two deleted keys remain in war/identity code for a cleanup
pass.

## The one exception — RES_INV_RIVER stays dormant, documented

Its own gate (backlog #11/#12) is a **1920-resolution windowed multi-seed
battery whose run outlives this container** — an infrastructure limit, not
an evidence call. Flipping without that battery would ignore the lever's
own written flip condition; removing it would delete a needed fine-grid
res-invariance fix. It remains the single deliberately-dormant lever, and
un-blocks when the resumable-recorder tooling (backlog #12) exists.

> **RESOLVED 2026-07-25 — the battery ran, the lever FLIPPED ON.** The
> resumable chunk driver carried the full 4-way (off/on × 8817/31337) to
> 30k at 1920 in one session: realm count recovers ×1.35–1.6 on both seeds,
> settlements stable, residual size/pop deltas sign-flip by seed (chaos,
> not systematic inflation); stylized 21k at 1920 under the lever passed
> all hard gates at 1 soft warning; byte-transparency at the 480 reference
> proven by hashbase A/B on the post-FOOD_K build. **Dormant feature
> switches: 1 → 0.** Full record in the lever's own desc (tuning.js) and
> `tools/score_resinv.mjs` over `bench/resinv1920_*`.

## Not part of the campaign — values, not switches

`FARM_MAX_TIER=0` (live tier threshold read by the trade booking) and
`LUX_VILLAGE_FRAC=0` (villages buy no luxury — the tuned, documented
behaviour) are parameters whose value happens to be zero.

## Ledger

| | count |
|---|---|
| dormant levers before | 38 |
| flipped ON (waves 1–3) | **24** (15 + 7 + `ALLY_FRONT`, `CROP_AXIS`) |
| removed with code paths | **11** (7 + `RIVER_REACH`, `CAP_GEO`, `CTRL_LIVE`, `TILE_IDENTITY`) |
| values-at-zero (no action) | 2 (`FARM_MAX_TIER`, `LUX_VILLAGE_FRAC`) |
| documented exception | 1 (`RES_INV_RIVER`) |

Lever count: 295 → **284**. Dormant feature switches: 38 → **1**.

The Levers panel still carries every flipped lever as a kill-switch (set 0
to A/B the legacy behaviour); each desc is stamped `FLIPPED ON 2026-07`.

## Post-campaign arcs (same session)

- **Pilgrimage throughput** (`PILGRIM_SPEND=0.85`, `PILGRIM_RANGE=60`, both
  flipped after A/B + gates): the watch-list see-hoard pathology fixed at
  the mechanism — the see SPENDS (temple works, provisioning — conserving)
  and offerings decay with the journey. 4242 @12k: top-see 28.3 % →
  sees-combined 12.2 % of world wealth.
- **UI**: the Economy ▸ Prices lens (catchments painted by the local price
  of a selected good — the trade gradient made visible) and honest trade
  labels (measured net-exports replace the barter-guess fiction).
- **RES_INV_RIVER dossier refreshed** (still the one dormant lever): 960
  A/B @12k — political map ~unchanged (43 → 40 realms) but population
  +19 % (the documented water-fed capacity inflation). Its own 1920
  windowed gate now has a road: `tools/battery_resumable.mjs` drives
  `earthFullRecord`'s RESUME checkpoints in chunks that survive container
  restarts (state under `bench/`). Verdict unchanged: dormant until that
  gate runs green.
- **Deferred honestly**: proper landings of the two removed prototypes
  (TILE_IDENTITY Stage 2 with persistence + a passing invariant; live
  borders with sane consolidation) are multi-session arcs whose specs
  (settlement-ontology, field-polity) remain the blueprints.

## Standing watch list (carried from the pre-merge review)

The flip made the goods economy the default world, so the review's watch
items now apply to every run: single-settlement pilgrimage wealth
concentration (bound by a mechanism when addressed, never a cap), the
"Baseline" top-export share, ore at-cap fraction, and the farm-surplus
monetization question — see docs/premerge-review-2026-07.md.
