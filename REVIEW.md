# Simman — Comprehensive Review

_An ultra-deep, whole-app audit: every file in `src/`, `tools/`, `docs/`, and CI was read line-by-line by 23 specialised reviewers (17 subsystem reviews + 4 cross-cutting hunts + a completeness critic), and every bug-class claim was challenged by independent adversarial verifier agents before making this report. 206 findings survived (3 claims were refuted and are recorded separately for honesty): **2 critical, 34 high, 79 medium, 91 low** — 70 of them formally CONFIRMED by verifiers, the rest advisory or spot-checked._

**Companion documents (the full detail):**

- [Findings I — Critical & High](docs/review/findings-critical-high.md) (36 findings, full detail + verifier notes)
- [Findings II — Medium & Low](docs/review/findings-medium-low.md) (170 findings)
- [How the app works — subsystem maps](docs/review/systems.md) (an accurate mechanism map of every subsystem, as reverse-engineered by the reviewers)
- [Minor notes & completeness critic](docs/review/notes.md) (~200 one-line observations, plus what even this audit didn't reach)

**Baseline health (verified directly on a fresh clone):** `npm run lint` ✅ (1 warning), `npm test` ✅ (determinism, 4000-step invariants, save/load hash identity), `npm run validate` ✅ (all hard gates, 1 soft warning), `npm run build` ✅. The app is alive and its core loop is sound. Everything below is about making it *right*.

---

## 0. Fix immediately — CI deploys feature branches to production

`.github/workflows/deploy.yml:5` triggers on `push: branches: [main, 'claude/**']`, and the job unconditionally runs `actions/deploy-pages@v4` into the repo's **single** production `github-pages` environment. Any push to any `claude/**` working branch replaces the live site with that branch's build. One-line fix: deploy only from `main` (keep lint/test/build as a separate job for branches if you want CI on them). *(This review was committed with `[skip ci]` to avoid exactly that.)*

## 1. The biggest systemic problem: save/load silently loses a lot of state

**27 findings** — the largest cluster in the audit, most of them CONFIRMED, several found independently by 2–3 reviewers. The smoke test's "save → load → hash identity" check passes because `hashWorld` (persist.js:230) only hashes *what persist.js saves* — it is structurally blind to state that never gets saved. What actually happens on load today:

| Lost state | Effect after load | Where |
|---|---|---|
| `world._tileCapturedAt` — persist saves/loads a field named `_capturedAt` **that nothing in the sim ever writes** (and with the wrong dtype: Int32 vs Float64-filled-with--Infinity) | Post-conquest hold protection dies; freshly conquered land is instantly contestable | persist.js:123 vs armies.js:296 |
| Settlement site fields `_riverAcc`, `_confine`, `_rugged` — computed only in `makeSettlement`, and `loadWorld` builds bare objects instead | **Loaded worlds permanently lose river access** (trade, irrigation, floodplain benefits) | persist.js:182 |
| `world._truces` (peace treaties) | Every war re-opens the moment the first war pass runs | armies.js:377 |
| `world._inflP` + `world._inflRef` (sim-facing prices + permanent baseline; only the *display* map `_inflRaw` is saved) | All accumulated inflation erased; baseline re-locks at current M/T | inflation.js:82 |
| `world._soilFatigue` ("the land remembers") | Millennia of salinisation forgotten — the arid-cradle decline mechanism resets | settlement.js:1668 |
| `s._orgApt` (heritable organisation aptitude, "permanent ratchet", on by default) | Every people's winter-selection history resets to 0 | settlement.js:318 |
| `world.roadFlow`'s sparse index `_flowTiles` never rebuilt | Pre-save trade flow **never decays again** — grows unboundedly | roads.js:255 |
| `world.countries` not rebuilt until the next polity pass | Up to ~150 ticks of world-wide carrying-capacity collapse right after load; Realms UI blank (indefinitely while paused) | persist.js:223 |
| `world._warSeenAt`, `_schismAt`, `_lastSyncretismAt`, `s._credit`, `s._lastBorrow`, climMod overlay | Duplicate `war.began` events; instant schisms; **credit re-minted on top of credit-inflated wealth** (money-conservation break); post-load territory divergence | several |

On the UI side of the same story: loading a save **doesn't restore `_tecParams`** — the displayed terrain regenerates from the *current* tuning while the sim world is rebuilt from the *saved* params (WorldSim.jsx:3796) — and the load path then **clobbers the save's tuning levers with the UI's current values** (WorldSim.jsx:977, worker processes `load` then `tune` in order).

**Recommended fix pattern** (rather than whack-a-mole): (a) fix the `_capturedAt` name/dtype mismatch; (b) add the missing fields to persist; (c) on load, run the `makeSettlement` site-computation path and rebuild all sparse indexes; (d) call `updatePolities` once at the end of `loadWorld`; (e) extend `hashWorld` to cover the full mutable state, and add a **post-load divergence test** to smoke: run N steps from a load vs. the same N steps unbroken, compare hashes. That last test would have caught every row in the table above, and future ones.

## 2. The climate model has confirmed physics bugs (masked by calibration)

Independent, CONFIRMED sign/convention errors in the wind–moisture stack:

- **The mid-latitude westerlies never form** — zonal-mean winds are easterly at *all* latitudes because the meridional pressure term swamps the belt structure (windSolver.js:203).
- **July monsoon heating is applied to the wrong hemisphere** — the `hemi` sign is inverted relative to the row convention, so boreal summer heats Australia and cools Asia (windSolver.js:110).
- **The real-NCEP wind path sign-inverts the v-component** (northward-positive vs the internal southward-positive screen-y), so "real wind" mode blows meridional winds backwards (realWindData.js:158).
- The signed-latitude convention is inverted for every asymmetric pressure feature (ITCZ trough lands at 8°**S**; polar highs swapped, windSolver.js:165), and the Ekman initialization has both Coriolis cross-terms flipped (windSolver.js:273).
- Both presets pass a **still-all-zero temperature array** into `solveMoisture`, so evaporation capacity is computed from a legacy internal latitude curve that no longer matches the calibrated temperature the world actually gets (tectonicGen.js:1150, worldgen.js:277).

Why does Earth still look right? Because `earth_sim` carries ~7 hand-painted, named-geography moisture patches, and its two-season monsoon blend was calibrated *around* these bugs. That's the rule-2 tension the CLAUDE.md warns about: the patches paper over missing/broken mechanism. Worse, the two-season (monsoon + winter-storm-track) machinery is **only wired into `earth_sim`** — every emergent tectonic world gets a single annual-mean solve, which the code's own comments say produces "no monsoon … starving India, SE Asia and East China into desert" (worldgen.js:250, tectonicGen.js:1143). Fixing the sign bugs, wiring the seasonal solve into the tectonic path, and re-calibrating would let several hand patches shrink or disappear.

## 3. Cardinal-rule violations (the hunts found the codebase *mostly* clean)

**Rule 1 (no time gates)** — the dedicated hunt swept every `step`/`year`/`era` read in `src/`:

- **CRITICAL — crystallize.js:278**: `devFactor = COVERAGE_FLOOR + (1-COVERAGE_FLOOR) · (step·dt)/COVERAGE_RAMP` (comment: "~renaissance"). A pure elapsed-time ramp multiplying **both** the crystallisation probability and colonisation pressure — it *is* the tempo of civilization's spread, keyed to nothing but the clock. This is the textbook two-clock trap: on a slow world it opens the frontier too early, on a fast one too late. Replace with an emergent driver (e.g. neighbourhood organisation/logistics/population pressure).
- **inflation.js:82**: the monetary baseline `_inflRef` locks at `world.step >= 5000` — the only hard step-number gate in the sim. Gate it on emergent monetization (e.g. trade volume / coined-wealth share) instead. (Its non-persistence, §1, is what makes it unstable across loads too.)
- **index.js:198**: `SIM_GRANULARITY` stretches most cadences but **not** climate variability or soil exhaustion — so climate history and salinisation run G× faster per unit of history at higher granularity. Borderline (pace inconsistency rather than a content gate), but it breaks the "same history at any granularity" contract.
- **index.js:134**: `CIV_ORG_YEAR` maps development through a fitted *year table* detour; identity-salience curves are anchored to real historical years. Borderline — the inputs are emergent, but the calibration table is the calendar. Consider gating on org directly.
- settlement.js:1514: the isolation dark-age trigger keys on *age-since-founding* rather than emergent state (advisory).

**Rule 2 (no fitted outcomes)**:

- **state.js:322 — `EARTH_HEARTH_SITES`**: Nile / Mesopotamia / Yellow River cradles hard-coded at pinned coordinates with search radii **tuned to override the emergent site score**, default ON for both earth presets. This is the single biggest "is this OK?" question in the codebase — see Questions below. (Related: pipeline.js:148 pins the ancestry origin to the East African Rift.)
- crystallize.js:324: floodplain spawn oversampling is un-normalised importance sampling whose companion spacing constant was tuned to hit a target settlement count.
- riverGen.js:575: `maxLakeTiles = 800` is resolution-dependent *and* sized to the Caspian; riverGen.js:30's hydrology constants are openly calibrated to named basins.
- countryTerritory.js:242: several parameters carry comments tuning them to aggregate outcome targets ("country count ~80–100", urbanisation ~60%).
- conquest.js:1788: `CAP_GEO` grants imperial capacity directly for sitting on a floodplain (painted effect; currently OFF by default).

## 4. Confirmed simulation-logic bugs (the emergent engine)

- **Population annihilation in one tick** (settlement.js:2253): the logistic growth step is raw Euler — when a besieged city's food K collapses, `people += r·dt·people·(1−people/K)` overshoots to near-zero **or negative population** in a single tick instead of starving over time. Clamp the step (or integrate implicitly).
- **The "immortal empire" regression is back** (conquest.js:726): `blocHasCity` requires a full tier-2 CITY — the *exact* bar the function's own doc-block says was the bug that made empires immortal and was supposedly lowered to town+.
- **Cross-water territory is dead** (countryTerritory.js:633): the persistent-territory merge's connectivity release wipes ALL cross-water holdings every pass, killing the mare-nostrum mechanism the claim Dijkstra deliberately builds — with the lever default ON. (Also: the release flood is 4-connected while claiming is 8-connected, spuriously releasing diagonal marches, :626.)
- **Lakes reach the sim as fertile, passable, resource-bearing land** (pipeline.js:403): the lake override zeroes `tFert`/`tDiff` — two arrays that are *never passed to the people-sim* — and `tCrop` is computed after/independently. Settlements can sit in lakes.
- **Sister languages are byte-identical** (language.js:215): the daughter seed folds in only `(parent.seed, "branch", parent.gen, world.step)` — two branches from one parent in the same tick get the same seed, hence identical phonology forever.
- **Polity lifecycle events are broken at the source** (entities.js:108): every country is silently registered *before* `reconcilePolities`' "substantial" gate runs, so the gate is dead code — most polities never get a `polity.founded` event and ghost `polity.ended` events fire for realms that never had a story. (The event-sourced-narrative design itself is excellent — this is the one leak in it.)
- **Money leaks to the dead** (roads.js:1099): tolls and entrepôt brokerage are credited to dead — even pruned — intermediate settlements, which buyers still pay. One of the few real breaks in the otherwise-verified conservation story (the audit *confirmed arithmetically* that trade settlement and the slave market conserve coin to fp-noise).
- **Wrong plague victims** (shocks.js:120): the virgin-soil sweep tests the *source's* disease load instead of the low-immunity destination's — it strikes immune populations, including the disease's own homeland.
- **A pathfinding wormhole** (transport.js:205): any edge touching ONE road tile is priced at road cost — including the step *into impassable ocean*.
- Cadence bugs: alliance/colonial-independence checks silently break when `POLITY_INTERVAL` doesn't divide 600 (conquest.js:1691); `rebel()` can ravage the same settlement twice in a pass (:1125); a seceding bloc can be handed the id of a **live** country and silently merge into a distant realm (:647); elected rulers can already be sitting rulers elsewhere (dynasties.js:541); truncated house rosters strand living royals as immortal off-roster crownables (:661).
- **Granularity is not neutral** (multiple reviewers, echoed by the critic): urbanise's absolute 0.2-mover floor freezes small-village migration at G>1 (settlement.js:1089); slave raiding double-scales with G (slavery.js:41); several rates in settlement.js aren't `_dt`-scaled; river tolls and `SCHISM_MIN_DIST` aren't resolution-scaled. Net: **history changes shape when the performance lever moves**, which the levers panel presents as safe.

## 5. UI: two critical rendering bugs and a long tail

- **CRITICAL — WorldSim.jsx:1670**: both branches of the base blit write into the **same offscreen canvas**, but only the cached branch updates the cache key — visiting any identity lens corrupts every cached lens until an unrelated key change. Companion key bugs: the resource toggles stringify as `'[object Object]'` so toggling resources does nothing (:1409), and the key omits world identity and is never cleared on regeneration, so same-seed tuning changes blit a **stale world** (:987).
- Colonies are invisible in normal operation: `applySnapshot` drops the worker-shipped `_overlord` field, so metropole colours/stripes/labels only ever worked in non-worker mode (WorldSim.jsx:2473).
- Wheel-zoom is permanently lost after toggling the 3D globe (stale imperative listener, :2735); sticky pan after releasing a drag off-canvas (:847); while paused, on-demand snapshots mutate the mirror without re-rendering (dynasty tree / chronicle toggles appear dead, :2479); a sim crash desyncs the play button and can permanently invert Space (:2540); loading an older save merges two worlds' history charts (:2483).
- The **Sim Levers panel is unreachable on every preset except `earth_sim`** — including the default tectonic preset (:4168).
- GlobeView leaks a WebGL context per 🌍 toggle (GlobeView.jsx:177), misses the r183 `colorSpace` tag (then compensates with a saturation hack, :40), and allocates ~67 MB rebuilding a static specular map on every 4 Hz texture update (:193).
- TuningPanel triggers a full 1920×960 regeneration + a new Worker **per slider input event** (TuningPanel.jsx:169). Azgaar import can freeze the tab or produce an all-NaN world on malformed files, and river/lake/floodplain/delta/oasis **all alias one shared Uint8Array** in imported worlds (mapImport.js:97/117/181).
- Recommendation echoed by the reviewers: add `eslint-plugin-react-hooks` — several of these are exactly the class it catches.

## 6. Performance (mostly the render/UI side)

The sim itself is well-amortised; the hot spots are at the boundary: `setLiveStep` re-renders the entire 4,187-line component at ~30 Hz while playing and rebuilds ~35k-point chart polylines per frame (WorldSim.jsx:2443); the worker ships a 1.8 MB `roadFlow` copy 30×/s that the renderer samples ~1×/s (peopleSimWorker.js:407); the politics overlay issues 150–300k `fillRect` calls on the main thread (:2114); identity lenses rebuild their static grey base per-pixel every frame because they're excluded from the base cache for no reason (:1579). In-sim: the territory pass is a single multi-hundred-ms hitch at shipped resolution (index.js:201) and `relaxClaim` does 7–9 full-map sweeps every 12 ticks (countryClaim.js:190). Also: **the event-feed cursor breaks after event-log compaction** — the feed goes silent for tens of thousands of events (peopleSimWorker.js:377).

## 7. Tests & tooling: green, but blind where it matters

- The smoke determinism check compares **rounded aggregate stats**, not state hashes; combined with `hashWorld`'s blind spots (§1), the two most important regression classes (silent state loss, subtle divergence) are currently invisible. `npm run validate` is not in CI, only its continuity check can hard-fail, and several thresholds are wide enough to be near-vacuous.
- `tools/earthRun.mjs` claims to be "app-identical" but omits `tFlood` + ancestry, simulating a measurably different world — prefer `_harness.mjs` everywhere.
- ~40 `probe_*/render_*/diag_*` tools predate the harness and measure a non-app world; cull or port them. `tools/ui_smoke.mjs` (a puppeteer render-crash smoke that would catch the whole §5 class) exists but is wired into nothing.

## 8. Docs drift

`docs/territory-growth-plan.md` is the most misleading file in the repo — it describes a "SHIPPED" implementation (`marchWarfare()`, `MARCH_BASE/ORG`, `CAP_TILES_BASE/ORG`…) that **does not exist anywhere in the codebase**. Inverse drift too: `coerced-labor.md` says "proposal (not yet built)" but all three build steps shipped; `SPEC-climate-moisture-fix.md` is fully implemented but reads as an open handoff; `persistent-territory-spec.md`'s header contradicts its body and the lever default has since flipped to ON. README nits: "seeds two Neolithic villages" (it's up to 10 cradles), "14 tracked resources" (there are 15).

## 9. What's healthy (credit where due)

Money conservation in trade settlement and the slave market was **verified arithmetically to fp-noise** — the README's "closed supply" claim holds in those subsystems. `habitability.js` is fully clean (pure functions, no time inputs, no named regions). The RNG substream partition design is sound (one latent namespace-collision risk, rng.js:70). The event-sourced narrative architecture (structured log → prose as a *rendering*) and the historiography design are genuinely excellent. The identity-field mirror passes its invariants. Determinism held in every probe the auditors ran.

## 10. What even this audit didn't reach (the critic's honest gaps)

1. **The tech/knowledge engine produced zero findings across all 23 reviewers** — the master driver of era, reach, and capacity is the strongest thin-coverage signal in the audit; it deserves a dedicated pass (tech.js in full + `updateKnowledge` in settlement.js).
2. **armies.js combat math** (battle resolution, casualties, conscription accounting) got described but not audited — all war-shocks findings landed in shocks.js.
3. **The real-NCEP-wind mode** exists only on the main thread, invisible to the worker, persist.js, and the tools harness — its parity/save story was never examined (and is likely broken: saves don't record the flag).
4. **Multiplicative stacking**: agri knowledge enters land food through at least four multiplicative channels and river advantage through ~five systems; nobody audited the composed product.
5. **Granularity/resolution A/B experiments**: five reviewers flagged invariance breaks (§4); nobody ran the end-to-end runs to quantify how much history shape actually diverges.
6. Tooling/data provenance: `convert_wind_data.py` sign conventions, ~5 MB of `data/`, no regeneration script for the 2.4 MB `earthData.js`.

## 11. Suggested order of attack

1. `deploy.yml` branch filter (1 line, production safety).
2. Save/load overhaul + post-load divergence test (§1 — biggest correctness win per effort; it protects everything else).
3. The two critical bugs: base-cache corruption (WorldSim.jsx:1670) and the COVERAGE_RAMP time gate (crystallize.js:278).
4. Sim-logic batch (§4): logistic clamp, `blocHasCity` tier, cross-water release, language seeds, `ensurePolity` gate, the `_dt`/granularity sweep.
5. Climate signs + seasonal solve on the tectonic path, then re-calibrate and shrink the earth_sim hand patches (§2).
6. UI batch (§5), then perf (§6), then test hardening (§7), docs (§8), tool culling.

## 12. Questions for the owner

1. **`EARTH_HEARTH_SITES`** — scripted Nile/Mesopotamia/Yellow-River cradles are ON by default for Earth presets. Keep (Earth presets are calibration targets, replaying real geography), or make them emergent and accept that Earth may not reproduce history's cradles? The README's "nothing is scripted" currently isn't true for Earth worlds. A middle path: keep as an explicitly-labelled lever, default OFF, and surface it in New World.
2. **Is granularity-invariance a contract?** The levers panel implies SIM_GRANULARITY is a safe performance dial; ~8 findings show it currently changes history's shape. Either fix the `_dt` scaling everywhere or label the lever as history-altering.
3. **The outcome-tuned territory constants** (country count, urbanisation targets in countryTerritory.js comments) — accepted calibration or debt to be replaced by mechanism?
4. **`POP_ANCHORS`** — the legacy demographic pin (world population dialed toward Earth's historical curve) still ships as an opt-in lever despite being the archetype of the two-clock bug documented in CLAUDE.md. Remove?
5. **Slavery stock** — captives are currently an inert, immortal, costless pool (never eat, never die, no upkeep). Intended placeholder or should they enter the demographic/food loops (docs/coerced-labor.md suggests the latter)?

---

_Method note: findings marked CONFIRMED survived independent adversarial verification (1–2 skeptic agents each, instructed to refute). Three claims were killed in verification and are listed at the end of [Findings II](docs/review/findings-medium-low.md) — including a plausible-sounding "floodplain moisture puts the Nile in the malaria belt" claim that turned out to be wrong. Advisory items (recommendations, perf, UI/UX, design questions) were spot-checked but not formally verified._
