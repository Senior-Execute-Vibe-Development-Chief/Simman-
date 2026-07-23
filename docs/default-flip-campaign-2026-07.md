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

## Wave 3 — the four survivors (flipped after screens + combined gate)

`TILE_IDENTITY` (identity lives on the land — the settlement-ontology
Stage-2 design, flipped by its own documented procedure), `CROP_AXIS`
(concrete crop packages — the continental axis becomes emergent instead of
a proxy), `CTRL_LIVE` (the control field IS the political map — live
borders), `ALLY_FRONT=1` (coalition relief armies — the code ships the
DEFENSIVE-ONLY rewrite; the measured-harmful offensive half was already
excised, which supersedes the backlog's older "keep 0" note).
Each passed a single-seed screen individually (hard gates green, warns in
budget), then the four together — the prospective default world — passed
the combined full gate: smoke (the sharp edge: per-tile culture state and
field borders through save/load), 3-seed stylized, 20k probe.
<!-- W3-RESULTS -->

## The one exception — RES_INV_RIVER stays dormant, documented

Its own gate (backlog #11/#12) is a **1920-resolution windowed multi-seed
battery whose run outlives this container** — an infrastructure limit, not
an evidence call. Flipping without that battery would ignore the lever's
own written flip condition; removing it would delete a needed fine-grid
res-invariance fix. It remains the single deliberately-dormant lever, and
un-blocks when the resumable-recorder tooling (backlog #12) exists.

## Not part of the campaign — values, not switches

`FARM_MAX_TIER=0` (live tier threshold read by the trade booking) and
`LUX_VILLAGE_FRAC=0` (villages buy no luxury — the tuned, documented
behaviour) are parameters whose value happens to be zero.

## Ledger

| | count |
|---|---|
| dormant levers before | 38 |
| flipped ON (waves 1–3) | 26 |
| removed with code paths | 9 |
| values-at-zero (no action) | 2 |
| documented exception | 1 (`RES_INV_RIVER`) |

The Levers panel still carries every flipped lever as a kill-switch (set 0
to A/B the legacy behaviour); each desc is stamped `FLIPPED ON 2026-07`.

## Standing watch list (carried from the pre-merge review)

The flip made the goods economy the default world, so the review's watch
items now apply to every run: single-settlement pilgrimage wealth
concentration (bound by a mechanism when addressed, never a cap), the
"Baseline" top-export share, ore at-cap fraction, and the farm-surplus
monetization question — see docs/premerge-review-2026-07.md.
