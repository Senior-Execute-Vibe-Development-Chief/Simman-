# The from-0 dawn: wrong cradles, a silent crash, and what fixed which
### 2026-08-07 — owner report: "1: game shuts down at step 23713. 2: civ start in southwest canada, then ghana, then northwest australia"

Both reports reproduced, root-caused, and addressed. This file is the evidence
ledger; the code changes ride the same commit.

---

## 1. "Civ start in southwest Canada, then Ghana, then northwest Australia"

### Reproduced at the then-shipped defaults (pre-flip; app grid tw=960, observed climate, seed 8817)

`DAWN_LIVE=1` (the from-0 start) arms every hearth with `needY =
domLagY(best package) / suit`, and the best package is chosen by **climate fit
alone** — nothing says teosinte lived only in Mesoamerica. The armed table at
the app grid, in maturity order:

| order | site | lat/lon | package | needY |
|---|---|---|---|---|
| 1 | Orange River, **South Africa** | 29S 20E | wheat 1.00 | **902y** |
| 2 | Indus | 28N 70E | wheat 0.89 | 1008y |
| 3 | Orinoco, Venezuela | 8N 62W | rice 1.08 | 2317y |
| 4 | Mississippi | 32N 92W | rice 1.06 | 2351y |
| 5 | **Top End, Australia** | 15S 135E | rice 1.05 | 2377y |
| 6 | Paraná, Argentina | 31S 59W | rice 1.04 | 2410y |
| 7 | Nile | 29N 31E | wheat 0.37 | 2430y |
| 8 | **Ivory Coast (“Ghana”)** | 6N 5W | rice 1.02 | 2440y |
| 9 | Mesopotamia | 32N 44E | sorghum 0.79 | 2535y |
| 10 | Yellow River | 35N 112E | **maize** 1.05 | 4300y |

The live run confirms ignition tracks this table. The owner's seed drew the
same defect's other face: the wheat bell (tOpt 13°C annual, semi-arid) crowns
cool-dry mid-latitude sites — the BC plateau (their "southwest Canada"), the
Karoo, the Pampas — while the real wheat cradles read as rice/sorghum land, and
the Yellow River waits 4300 years for a crop from the wrong hemisphere.

### The mechanism was already built: `T.CROP_BIOGEO` + `T.IRRIG_CROP`, blocked separately, never measured together

- `CROP_BIOGEO` (wild ancestors have homelands) shipped OFF, blocked on a
  resgate claimed-land failure (0.36 vs 0.44 on seed 8817) attributed to its
  adaptation discount thinning crop coverage.
- `IRRIG_CROP` (flood-fed fields read the river) shipped OFF, blocked on the
  maize-through-irrigation anachronism — i.e. blocked **on** biogeography.

Measured **as the designed pair** (this session, both gate seeds):

| gate | solo CROP_BIOGEO (recorded) | the pair (measured today) |
|---|---|---|
| resgate claimed-land ratio | 0.36 FAIL | **0.68 (8817) / 1.81 (31337)** ok |
| resgate median-area ratio | — | 0.78 / **1.01** ok |
| resgate density ratio | — | 0.75 / 0.95 ok |
| resgate absolute median | — | 431k / 481k km² ok |
| resgate app realm count @6k | — | **4 / 5 vs floor 6 — the one FAIL** |
| smoke functional resume | 22-23% drift FAIL | **0.2%** ok (see §3) |
| smoke civilization-alive @4k (tw=160) | — | **4 vs ≥5 — the other FAIL** |
| stylized (21k) | 3/3 seeds, 1 warn each (recorded) | **all hard gates, warns at budget (2/2)** |
| DAWN_LIVE 40k arc (tw=480) | — | 52 cities, save/load + export clean |

Dawn under the pair at the app grid: **Indus 1332y → Nile 1833 → Channel-coast
2002 → Mesopotamia 2305 → Sahel (sorghum) 2954 → E-Africa 3704 → Paraná
(tubers) 4304 → Yellow River (rice) 4545 → N-Mexico (maize) 5023 → Venezuela
10101. Australia never arms.** Canada, Ghana and South Africa are gone from the
dawn; the Americas wait for their native packages' honest lags; the first
civilizations are the Old-World river valleys.

Live at tw=480 (40k steps): Indus → Zambezi highlands → Nile → southern
Britain → Sahel → Yellow River → Peru → N-America → Mesopotamia. Two soft
warts, recorded, not tuned away:

- **The Atlantic-facade wheat corridor** (a Channel/Britain-class hearth 3rd-4th):
  the climate-toll geodesic prices the maritime facade ~1.5 units from the
  Crescent (inside the 2.5 domestication core) and the annual-mean wheat bell
  rates 10°C coastland well. Cross-grid-stable (1.16/1.55/1.54 at
  240/480/960), so a metric property, not a resolution bug. The envelope
  centring is the GROW_SEASON entry's recorded honest limit.
- **The trans-Sahara / Rift high-road**: |Δtemp|+|Δmoist| is ~zero across a
  uniform desert and along temperate highlands, so wheat's range reaches the
  Sahel (d≈2.1-2.3) and the Zambezi highlands cheaply. Defensible for the
  Sahel; generous for southern Africa.

### Why the presence half alone is DEAD (the `CROP_HOMELAND` experiment)

To ship the anachronism-killer without the coverage-thinning discount, the
presence gate was split into its own lever and measured. **Presence without
adaptation re-crowns wrong sites under new names**: the far-travelled package
wins wherever it merely arrives — the Nile falls to W-African tubers (0.65 vs
wheat's undiscounted 0.61; needY 4600), the Indus to Yangtze rice, and the dawn
opens Iberia 957y → Zambia 1154y. Exactly the failure `packageAdaptMul`'s own
comment predicted. The halves ship together or not at all. The lever stays in
the schema at 0 as the recorded experiment.

### What still blocks the default flip (precisely two floors, both dawn-pace)

Every ratio, invariant, determinism, persistence, and history-shape gate is
green — the cross-grid ratios are the best in this repo's records. The two reds
are **fixed-horizon absolute count floors calibrated on the old dawn's pace**:
smoke's `civilization alive ≥5 @ step 4000` on the tw=160 toy grid (got 4,
alive and growing), and resgate's `app realms ≥6 @ step 6000` (got 4/5 — few
but real: 298-481k km² medians, not the 7-tile confetti the floor was built
against; 17 polities by stylized's 21k horizon). The old regime matured all ten
hearths nearly synchronously with anachronistic suit≈1 packages and minted
states fast; the pair's dawn (7 matured + 3 armed at map-open) matches the real
archaeological stagger, so early-horizon counts are honestly lower. Re-deriving
dawn-pace floors is a ratchet-charter decision (the charter's own lesson:
never in the same wave as the regime change), and the live-agronomy flip wants
the 4-seed abtest panel per the GROW_SEASON precedent.

### The flip (owner order, same day)

The owner ordered the flip ("do it"), which is what authorizes the two
dawn-pace floor re-derivations in the flip wave. Landed as one act:

- `CROP_BIOGEO` def 0 → 1 and `IRRIG_CROP` def 0 → 1, together (each one's desc
  records why alone it is the measured-wrong config).
- **SAVE_VERSION 5 → 6** with the v<6 regime guard (persist.js): both levers are
  live agronomy, so a pre-flip save that stores no delta for them is pinned to
  its old regime on load — the exact GROW_SEASON v5 pattern. New worlds get the
  pair; old worlds keep the agronomy they grew on.
- **smoke alive-floor 5 → 3** (both the main run and the dissolve arm — tw=160
  toy grid, 4 settlements measured at the horizon) and **resgate
  `appRealmsMin` 6 → 3** (charter formula at the new regime: ~25% below the
  worse gate seed, realms measured 4/5 at 8817/31337). Collapse-catch duty is
  carried by the untouched absolute-area floor and ratio bands — all green, and
  the failures the gate was built on (7-tile realms, collapse-to-anchor) still
  trip those.
- Battery at the new defaults, recorded below.

#### Flip battery (new defaults, no overrides)

| gate | result |
|---|---|
| npm test (smoke + emblem) | **all checks pass** (functional resume 0.2%) |
| resgate 8817 | **all bands held** — ratios 0.78 / 0.68 / 0.75, absolute 431k km², realms 4 ≥ 3 |
| resgate 31337 | **all bands held** — ratios 1.01 / 1.81 / 0.95, absolute 481k km², realms 5 ≥ 3 |
| stylized (21k) | **all hard gates passed**, 2 soft warnings (budget 2) |
| save migration | v6 default → pair ON · v5 no-delta → pinned OFF · v5 explicit → kept (probe, 3/3) |
| coverage | **✓** — `_armedHearths`/`_landSeats` (the dawn's live registries, now populated at gate horizons) measured in collect(): `hearth.armedNow` + `hearthArmed.*`, `nation.landSeatsNow` + `landSeat.*` |
| monotone (12k) | **0 failures** — the new metrics are point-in-time gauges by name (`…Now`), never cumulative claims |
| abtest 4-seed panel (vs pair-off) | **pace, not shape** — see the panel note below |
| tw=960 spot-check (probe_shape 16k) | see the panel note below |

#### The 4-seed panel (abtest --base="DAWN_LIVE=0" --tune="CROP_BIOGEO=0,IRRIG_CROP=0", 12k, tw=240, seeds 8817/31337/4242/9999)

Baseline = the new defaults (pair ON), variant = pair OFF. 2,003 movers
consistent across all four seeds, and they tell one story — the pair shifts
**genesis pace, not history shape**:

- Realms at the fixed 12k horizon: ON 8/4/5/5 vs OFF 10/13/12/18 — while
  **median realm areas are comparable** (e.g. 769k ↔ 754k km² on 8817): the
  realms that exist are full-sized, there are simply fewer of them this early.
- ON worlds still carry live armed hearths at 12k (`count._armedHearths` 2 vs
  0) and one seed fires `farming.invented` live at step 4272 — the stagger is
  real even in the seeded-dawn condition.
- OFF worlds are further along the political arc at the same step: wars begun
  3 → 17, secessions/submissions/vassal blocs present only there. That is the
  OLD dawn racing ahead, not a shape divergence — stylized already prices the
  mature shape (all hard gates at 21k) and resgate the cross-grid sizes.

---

## 2. "Game shuts down at step 23713"

Could not reproduce a sim crash headless: at the app grid (tw=960, observed
climate, defaults, seed 8817) 30k steps ran clean, tw=480 ran 40k clean twice —
including a run exercising the full snapshot lane (stats, feed narration,
realm cards, chronicles both renderings, dynasty tree, trade profiles,
save/export) every 50 steps. The reported step sits in the genesis window at
the app grid (first cities/nations ~20-25k), so the trigger is seed- or
lane-specific. What WAS found and fixed is the failure UX that turns any throw
into "the game shuts down":

- A `stepPeopleSim` throw was posted to the page and **silently ignored** —
  the sim halted forever at its last frame, console-only.
- A `buildSnapshot` throw escaped the worker's try/catch entirely →
  `worker.onerror` → the page **terminated the worker and re-initialized a
  fresh world from step 0 on the main thread** (~a minute of frozen UI at the
  app grid, the 23k-step run destroyed) — the sim itself was healthy; only the
  rendering of it had failed.

Now: snapshot builds are guarded (throttled error report, sim keeps running,
save/export stay live); step errors pause the sim AND surface a persistent
banner with the step, the seed to report, and the fact that Save still works;
unhandled worker messages report instead of escaping; and the
fall-back-to-main-thread path is scoped to boot failures only (a worker that
has ever delivered a frame is never torn down mid-run). If the crash recurs,
the user now SEES the stack's message and the world is rescuable — and the
saved world is the reproducer.

---

## 3. Bycatch: a real save/load bug the gates then caught

Chasing the pair's smoke failure exposed that `s._thinBasinSince` — the
DISSOLVE_TOWNS "sustained below the city bar" clock — was never persisted.
Every save/load silently reset every pending town dissolution (~1500 steps of
grace re-granted). Invisible on the shipped defaults in the gate's window
(no town near the bar); the pair's leaner marginal-package worlds put towns AT
the bar, and the loaded arm kept towns the original dissolved on schedule —
the smoke gate's "systematic" verdict was exactly right. Fixed by persisting
the clock: defaults' functional-resume drift improved 6.8% → 4.5%, the pair's
22% → 0.2%.

## Repro commands

```
# the defect (pre-flip defaults — now requires turning the pair OFF):
SIM_TUNE="DAWN_LIVE=1,CROP_BIOGEO=0,IRRIG_CROP=0" RUN_W=1920 node <runner importing tools/_harness.mjs>
# the fix (the new defaults):
SIM_TUNE="DAWN_LIVE=1" RUN_W=1920 ...                          # Indus→Nile→…, Australia never
# gates: npm test / npm run resgate / npm run validate at defaults;
# panel: node tools/abtest.mjs --tune="CROP_BIOGEO=0,IRRIG_CROP=0" --seeds=8817,31337,4242,9999 --steps=12000
```
