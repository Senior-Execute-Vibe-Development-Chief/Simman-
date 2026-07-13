# SPEC — Fix continental aridity in the moisture model

**STATUS: IMPLEMENTED (kept as the design record).** The fix this spec prescribes
is built and shipped — src/sim/moistureSolver.js now runs the depletive, CONSERVED
moisture transport ("Depletive transport (replaces the old near-lossless
max-of-neighbours flood)... continentality is emergent", moistureSolver.js header);
the non-conserved max-of-neighbours spread this doc diagnoses is gone. Do not
re-implement from this spec — it is history. (Audit 2026-07: the doc previously
read as an open handoff.)

Handoff spec. Investigation is done; the root cause is pinned. This describes the
bug, the evidence, what was already tried/reverted, and the fix to implement.

---

## 1. The symptom (what the user observed)

On the Earth map, civilization reliably "blooms" first in the strip **above the
Himalayas, from the Caspian Sea to China** (the real Karakum/Kyzylkum/Tarim
desert belt, ~38–46°N). One realm there becomes a runaway primate empire on
nearly every run. The user's instinct (correct) was that this region should be
*sparse* — historically Central Asia was oasis city-states and steppe nomads,
never the first/dominant agrarian empire.

## 2. Root cause (CONFIRMED — do not re-litigate)

**The moisture model gives deep, mountain-ringed continental interiors far too
much rainfall.** Interior Central Asia reads **moisture ≈ 0.37–0.50** when the
real desert should be **≈ 0.10–0.15**. At that moisture it sits exactly on the
fertility sweet spot, so it becomes the most fertile large region on the map →
breadbasket → leading development → primate empire. Because Earth's climate is
deterministic, it's the same place every run.

### The exact defect — `src/sim/moistureSolver.js:204`

```js
let moist = Math.max(upwind, nMax * _moistDecay, prev[ci] * _moistDecay);
```

Moisture is propagated inland as the **MAX** of (a) wind-traced `upwind`,
(b) the wettest land neighbour `nMax`, (c) self-persistence — each decayed only
by `_moistDecay = 0.996` (line 9). This is a **near-lossless isotropic flood-fill**,
not depletive transport. Consequences:

1. **Continentality is effectively unmodelled.** Real interiors are dry because
   air *rains out its water as it crosses land* — transport is a **conserved,
   depleting** budget. Here moisture is never "spent" in transit: at 0.996/cell,
   ~35 coarse cells inland still retains `0.996³⁵ ≈ 0.87`. There is no
   distance-to-ocean term and no water-conservation — just the weak decay.
2. **It bypasses the rain shadow.** The orographic lee-drying term
   (`:234–247`) does cut moisture at a mountain's lee tile, but the next line
   takes `max` over **all four** neighbours, so the interior cell simply refills
   from whichever neighbour didn't come over the mountains. The Himalaya/Pamir/
   Tibet wall — the thing that *should* make Central Asia a desert — is defeated
   by the transport formulation itself.
3. Subtropical subsidence (`:227–231`, centred 28°N, shoulder to ~40°) correctly
   does **not** reach ~42°N — Central Asian aridity is continental + rain-shadow,
   not subtropical. So continentality and rain shadow are the only two levers
   that could dry it, and the `max`-spread breaks both.

**One-line statement of the bug:** moisture is transported as a non-conserved
`max`-of-neighbours quantity with ~1.0 decay, instead of a conserved budget that
depletes as it precipitates across land.

### Is the WIND model also at fault? — No, not currently.

Of the three terms in the `max`, only `upwind` uses wind; `nMax` and `prev` are
wind-independent. Since it's a `max`, the wind term only matters when `upwind`
beats both isotropic terms, which for interior cells ~never happens (`nMax` is the
max over all neighbours; `upwind` is one directional sample). So the interior
fills wind-agnostically. A perfect wind would not dry Central Asia, and the wind
is not what's wetting it. **However:** once transport is made depletive/advective,
the wind becomes the *sole* director of where moisture lands, so its correctness
matters fully then — **sanity-check the wind field as step 2 of the fix** (see §6).
The wind code looks sound (Hadley/Ferrel cells, trades, westerlies, two-season
monsoon, ocean gyres in `worldgen.js`) but has never been properly exercised
because the `max`-spread bypasses it, so latent wind bugs could surface.

## 3. Hypotheses already RULED OUT (don't repeat this work)

- **A spurious river.** There *is* a generated river chain from the eastern
  highlands to the Caspian, but it is a *symptom*, not the cause. Decisive test:
  in the corridor interior, river-less desert tiles average **fert 0.81** vs
  river tiles **0.88** — nearly identical. The fertility is rainfall-driven, not
  river-driven. The terrain is a continuous downhill ramp to the Caspian (the
  only water sink; the Aral/Balkhash/Lop Nur are *not* sinks in the coarse DEM),
  so there is no endorheic-routing bug to fix — the river generator faithfully
  drains a ramp fed by excess moisture + mountain snowmelt.
- **A river-evaporation ("transmission loss") fix.** Implemented and **reverted**
  (`riverGen.js`): a global per-tile evaporative loss on hot/dry tiles. It
  regressed Zipf (−1.56 → −1.73) and cut city count (55 → 43) by thinning rivers
  worldwide, and it didn't dry the corridor anyway (the corridor isn't even
  classified "dry" — moisture 0.4+, which is the bug itself). Do **not** reinstate
  this as the fix.
- **The primate-city carrying-capacity stack** (`_eraProd ≈ 105`, irrigation,
  hinterland). Real, but it's the *mechanism* of the bloom, not why it's *there*.
  The user explicitly said the carrying-capacity system is "generally good" — do
  not nerf city size / add capacity caps. The geography (moisture) is the target.

## 4. What was changed this session (all committed, gates pass)

These are adjacent fixes from the same conversation; context, not part of this
task:
- `habitability.js` (new) — savanna/Sahel/tsetse/aridity brakes for sub-Saharan
  Africa, calibrated to the biome `em`/temp bands.
- Frontier-close: first re-gated on logistics tech, then **removed entirely** —
  territory coverage now emerges from each realm's own reach growing with its
  logistics (no synthetic global flood). `countryTerritory.js`.
- Demographic anchor retargeted from `stepToYear` → `world._civYear`
  (`index.js`) — a latent cardinal-rule fix; `ANCHOR_POP` defaults to 0 so it's
  currently dormant.

## 5. The fix to implement

Make advected moisture a **conserved, depletive** quantity: air carries a water
budget along the wind and **loses it to each precipitation event**, so the column
dries monotonically downwind and an interior reached only after a long overland
path (and blocked by mountains) gets the dregs. Concretely:

- **Replace the `max`-of-neighbours transport (`:204`) with directional advection
  that conserves and depletes.** The moisture arriving at a cell should be what
  the wind carried in from upwind, *minus* everything that precipitated en route —
  not the max of its wettest neighbour. Remove (or drastically weaken) the
  wind-independent isotropic `nMax` term; it is the thing that floods interiors.
- **Keep a small isotropic/diffusive component** only as needed to model
  synoptic/seasonal transport the annual-mean wind misses (the original intent of
  the `nMax` term), but it must not be a near-lossless fill — give it real loss so
  it cannot carry ocean moisture 35 cells inland intact.
- **Continentality should then be emergent** from the depletion (water runs out
  as it rains across land), not a flat 0.996/cell decay. A mountain-ringed interior
  with a long dry fetch ends up near-rainless on its own.
- The **rain shadow (`:234–247`) will start working** once the interior isn't
  refilled isotropically — verify the lee-drying actually seals interiors after
  the transport change.

Design constraints:
- **Cardinal rule:** everything stays emergent from state (elevation, wind, temp,
  distance/fetch) — no latitude/era/time gates. This is terrain-gen, run once at
  world creation, so it's naturally state-based; keep it that way.
- This is the **global** climate model — it touches every continent's rainfall.
  Tune conservatively and iterate.

## 6. Verification plan

After each change, run and check:

1. `npm test` (smoke: determinism, save/load, invariants) — must stay green.
2. `npm run validate` (stylized facts) — hard gates must pass; watch **Zipf**
   (~ −1 to −1.5), **urbanization** (~10%), **civilization alive**, **cradle
   distance correlation**.
3. **Regional moisture spot-checks** — confirm the target dried WITHOUT collateral
   damage. Reproduce with a harness probe (`tools/_harness.mjs` `buildSim`,
   default preset is `earth_sim`):
   - **Central Asia interior (~42°N, 65°E): must drop to ≈ 0.10–0.20** (from 0.37).
   - Amazon, Congo: must stay wet (~0.6+).
   - Ganges / SE Asia (monsoon): must stay wet.
   - US Great Plains / Sahel: moderate, not over-dried to dead desert.
   - W. Europe (maritime westerlies): must stay moist.
   A good probe: sample moisture by lat/lon box (see the session's
   `box(...)`/`find(...)` one-liners in the transcript) and split corridor tiles
   by river presence to confirm the rainfall (not river) changed.
4. **Wind sanity-check (step 2):** once transport is wind-driven, confirm the wind
   field over key regions is physical (midlat westerlies, tropical trades, monsoon
   inflow). The wind is an intermediate and is NOT persisted on the world object —
   instrument `solveMoisture`/`worldgen.js` directly, or temporarily expose the
   field, to inspect it.

## 7. Quick repro of the symptom (for the next session)

```js
import { buildSim } from './tools/_harness.mjs';
import { stepPeopleSim } from './src/sim/peopleSim/index.js';
const w = buildSim({ W: 480, H: 240, seed: 8817 });   // earth_sim default
stepPeopleSim(w, 14000);
// biggest settlement sits ~39N,56E (Caspian strip); inspect w.moist / w.fert there.
// corridor interior (lat 38-46, lon 53-72): avg moisture ~0.37, fert ~0.81 even on
// river-less tiles — that's the bug to drive down to a desert (~0.12).
```

## 8. Key files

- `src/sim/moistureSolver.js` — **the fix lives here** (transport, line 204).
- `src/sim/worldgen.js` — wind field generation (step-2 sanity check).
- `src/sim/pipeline.js` — `cradleFitness`/fertility from temp+moisture (the
  moisture→fertility coupling; sweet spot ~m 0.45). Confirms why wet interior →
  fertile.
- `src/sim/riverGen.js` — river generation (symptom only; do not touch as the fix).
- `tools/_harness.mjs`, `tools/stylized.mjs` — build a world / run the gates.
