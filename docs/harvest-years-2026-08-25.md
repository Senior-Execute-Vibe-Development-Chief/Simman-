# The harvest-years wave — 2026-08-25

The chain (handoff 2026-08-24): moisture-calibration lap → yield-variance map
validates → the harvest-years mechanism (annual swings into landFood, famine
from the tail, scripted levers retire) → LEAN_YEAR per-basin → the flip ladder.
This doc is the wave's record; run logs in `docs/runs/2026-08-25/`.

## Lap 1 — the moisture-index calibration (DONE, gates green)

### The finding: the index was fine — the LANGUAGE was wrong

`probe_moistcal.mjs` (new; solver + observed arms side by side against NCEP
truth) measured the recorded "Britain ≈ Mesopotamia" debt and dissolved it:
the moisture index is a PRECIPITATION-like quantity (worldgen's own contract:
"how much water this ground gets"), and every consumer that broke was reading
it as ARIDITY against a flat global threshold. Aridity is water vs evaporative
DEMAND. The codebase already owned the corrective layer — biomeClass.js's
calibrated Holdridge `demand(t)` (the language the Köppen classifier passed
79.4% with, and the same fix CANOPY_CLASS applied to the forest signal).
Effective moisture:

    em = moist / demand(temp)

| region (cropland) | raw m (solver) | em solver | em observed | real AI (MAP/PET) |
|---|---|---|---|---|
| England | 0.45 | 0.86 | 0.72 | 0.93 |
| Mesopotamia | 0.06 | 0.10 | 0.03 | 0.11 |
| Sahel | 0.59 | 0.73 | 0.32 | 0.13 |
| Ganges | 0.44 | 0.61 | 0.62 | 0.68 |

Britain–Mesopotamia separates ~25× in em in BOTH regimes. No index rewrite;
no per-region constants. The raw index stays precipitation-like for the
consumers that read it as water (fertility, rivers, biomes).

### What em alone could NOT do — the two missing real axes

- **Continentality.** England (em 0.72, CV band 0.08-0.16) and the Pontic/
  Kazakh steppe (em 0.66-0.75, band 0.25-0.42) are indistinguishable on any
  moisture axis — the steppe bands are WINTERKILL, not aridity. The real
  variable is the COOL-HALF mean temperature (t − tAmp), not amplitude alone:
  Mesopotamia's 9.6 °C amplitude is scorching summers over a +13 °C winter (no
  risk), Kazakhstan's 11.8 °C is a −8 °C winter (full risk).
- **Monsoon concentration.** N. China stacks wf≈0.88 of its rain in the warm
  half yet shows almost no Gaussen-arid months (cold winters demand no water)
  — the one-season signal needs `warmRainFrac`, amplitude-gated ≥4 °C because
  in the low-amplitude tropics "the warmest six months" are the pre-rain heat,
  not a season axis (the Sahel reads wf 0.32; its seasonality rides dryFrac).

Both fields existed (the growing-season work). state.js now carries
`_tAmp`/`_warmRainFrac` onto the sim world whenever worldgen provides them
(consumers keep their own lever gates).

### The solver tAmp refinement (behavioural change, full battery green)

The solver-regime tAmp was latitude-only — London = Astana = 11.7 °C, the
refinement its own comment had documented as missing. Now three real drivers,
calibrated per-region against NCEP amplitude (probe_moistcal table):
latitude insolation swing (26·lat^1.35 °C, the continental-limit ceiling) ×
ocean buffering along the WESTERLY fetch (dirDist west scan, belt-weighted
20→35°; a pangaea interior is fully continental on its own) + an aridity boost
(3.9 °C × (1−em), equator-faded — dry soil and clear skies swing harder;
Mesopotamia's amplitude is heat, not cold). Measured: England 11.7→4.6 (real
3.8-4.9), Pontic 10.2 (9.4), Nile 6.1 (6.6), Kazakh 7.8 (11.8 — the westward
scan resets at the below-sea-level Caspian Depression, which the heightmap
renders as sea; a named quirk, consistent with the sim's Caspian-as-sea
semantics). GROW_SEASON ships default 1, so this changes the default solver
world (hearth crop suitability): **full battery run and green** — smoke all
checks; stylized 8817/4242/777 all hard gates, warnings 0/1/1 (budget 2);
resgate all bands held (median-area 0.76, claimed 1.16, 9 realms, absolute
328k km²). Logs: `tamp_*.log`.

### The yield-variance formula (src/sim/peopleSim/harvest.js — shared code)

The formula moved OUT of the probe into `harvest.js` so the probe scores the
code the mechanism will run (the biomeClass one-copy scar). Four factors, each
a named mechanism: em rain margin (EM0 0.55, ramp 0.50) · one-season
concentration (Gaussen shape ∨ amplitude-gated warm-half concentration) ·
winter risk on the cool-half mean (6 °C onset, 13 °C ramp, +0.17 max) · flood
regime (CV 0.20) with THREE water signals — the tFlood arid-river floodplain
mask, the absolute channel band (mag 2→5), and rainMargin × waterAccess
(channel-in-reach ∨ coast × ALLUVIUM_COAST's own 0.5): **arid-land cropland is
water-fed by construction** — the capacity stack built that fert from water
access, so charging it rain-fed desert CV (~0.45) describes farms that cannot
exist (probe_nilebox: Nile bank tiles fert 0.93 / moist 0.02 / chan 3).

Probe verdicts are FERT-WEIGHTED medians (the max-pooled fert mask hangs
valley fert on point-sample-desert tiles; the mechanism multiplies landFood,
which lives where fert is). Sahel and Pontic boxes were redrawn to the belts
their literature bands actually describe (millet belt 13-17.5°N; steppe proper
≤49°N — the first boxes' medians sat in the Sudanian savanna and Kyiv-latitude
forest-steppe, whose real CVs are honestly below those bands).

### The verdict (probe_yieldcv, four arms)

| arm | agreement |
|---|---|
| observed (app regime), tw=240 | **11/12** |
| observed, tw=480 | **11/12** (grid-stable) |
| solver (gate regime), tw=240 | 4/12 |
| solver, tw=480 | 5/12 |

The observed arm is the calibration referee (near-true inputs — a miss is the
formula's). Its one miss at both grids: **Mesopotamia 0.35 vs 0.15-0.30** —
the sim's lower Tigris-Euphrates never exceeds riverMag 2 at any tested grid
and lays almost no tFlood (probe_floodmask: Fertile Crescent window census
0..5+ = 145/8/10/0/0/0 at tw=480), so the box farms as half-served Gulf-delta
alluvium. The missing-great-river debt, now pinned with numbers — riverGen/
heightmap territory, NOT a formula constant to bend. Every solver-arm miss
decomposes into the three named solver debts (em pattern too wet in the
Sahel/S.India/Iberia; dryFrac saturation in temperate lands — the fixed 0.55
dry-month threshold; weak seasonal phase → warmRainFrac misses the monsoon).
Those are probe_climate_truth's territory, not this wave's.

**The LEAN_YEAR bridge this buys** (margin = 1/p10-year): England 1.18×,
Nile 1.34×, Mesopotamia 1.44×, Sahel 2.05× — versus the flat 2.86× that
strangled seed 777. The per-basin law now has a validated map to read.

### Instruments added

`probe_moistcal.mjs` (regional climate axes vs NCEP truth, both regimes) ·
`probe_floodmask.mjs` (tFlood/channel census over the cradle boxes) ·
`probe_nilebox.mjs` (per-tile cropland dumps, Nile/Mesopotamia) ·
`probe_yieldcv.mjs` v2 (--real arm, fert-weighted verdicts, axis diagnostics).

## Lap 2 — the harvest-years mechanism (T.HARVEST_YEARS, built)

The annual layer under climate.js's century walk (harvest.js, second half).
Each harvest year (2 ticks = 1 yr, the `_ivl` convention): every ~12°
weather cell advances an AR(1) z (ρ=0.30 — drought runs), one 3×3 spatial
smooth (analytically re-normalized to unit variance); each settled
settlement's landFood multiplies by `1 + z·cv(seat)` clamped [0.15, 1.6],
with cv from the validated map. Pastoral stays the famine hedge (added after
the cut, the recorded design). Granaries/prices/relief/siege all respond
through the systems that already read landFood.

**Famine derives from the tail**: a year below the region's p10 (z < −1.28)
that also destroys >35% of the harvest (mul < 0.65 — the retired
FAMINE_SEVERITY's own loss bar, now met emergently) sets the SAME
`s._famineUntil` every consumer already reads (distress +0.5, faith crisis
+0.3) and logs `famine.struck` once per afflicted realm at onset. The
scripted spawner (the aimed die, flat severity, radius stamp) retires under
the lever; plague untouched.

Determinism/persistence: `world._harvestZ` persists (~450 floats); the
smoothed field, lean state and multipliers all re-derive from it;
`_harvestYearMul` joins BOTH the settlement whitelist and the determinism
hash (the `_thinBasinSince` lesson). probe_harvestresume: harvest state
round-trips EXACTLY (z, multipliers, famine events identical), pop drift
0.35% vs the 0.27% lever-off baseline — the codebase's known warm-up drift,
no new class.

**Referee (probe_harvest, 480/8817/6000 steps = 3000y)**: mean multiplier
1.001 over 19k settlement-years (no hidden tax or subsidy); amplitudes by CV
class p10/p90 = 0.84/1.16 (low) and 0.81/1.20 (mid); famine 58/1000y
world-wide across ~15 settlements (≈ once per generation-to-century per
region, emergently by class) vs the legacy dice's 1.3/1000y planet-wide.
Coverage GREEN with the lever on (the new state is reachable); stylized
8817 and 777 under the lever: all hard gates, 0 warnings each.

## Lap 3 — LEAN_YEAR per-basin (built)

`crystallize.js leanAt(world, ti)`: the founding margin becomes the basin's
own DEEP year — `1/(1 − 2.33·cv)` clamped ≤5×, the once-a-century harvest
from the same map — replacing the flat planetary `1/FAMINE_SEVERITY ≈ 2.86×`
whose referendum was decisively green in the owner's live regime but
hard-failed seed 777 (a flat 2.9× strangles marginal-geography worlds).
England-class ~1.4×, the Nile's flood regime ~1.9×, Mesopotamia ~2.3×, the
Sahel ~5×. All seven bar sites re-wired per-site (cityBasinOkAt,
labelBasinFree's peer capacity, the site lane's eligibility/storable/drift
bars via `barOf(k)`, maybePeerSeats' capacity + takes, the mint-time take).
Dissolve stays 1× — the stability band is now per-basin.

## Lap 4 — the flip ladder (in flight)

Pre-flip ladder under `LEAN_YEAR=1,HARVEST_YEARS=1`: stylized 8817/4242/777
(777 is THE gate — it must release by physics), default smoke, resgate,
monotone, and the Egypt live-regime referendum (probe_egyptfate, the
2026-08-24 arm + the pair — the owner's win must survive the per-basin
re-pricing at the Nile's ~1.9×). Verdicts land below; flip =
SAVE_VERSION 46, both levers ON, v<46 guard.
