# DESIGN 2 — Re-ground the size target: the population a realm binds is ITS OWN, at a fixed physical density

HEAD measured against: `713c766` (branch claude/civ-simulation-balance-ysrx3v). All line numbers below verified on this commit.

## 1. Why SIZE_BY_POP exists (virtues that MUST survive)

From `docs/empire-consolidation-2026-07.md` ("THE MINIMUM-EGYPT FIX") and the comment block at `src/sim/peopleSim/countryTerritory.js:705-712`: capacity-only targets plateaued the map at 23–32% (median-anchored log2 means nobody pulls ahead) and the COVER floor filled it EARLY at Egypt-size-minimum; the catchment stamp made size a settlement artifact. SIZE_BY_POP's virtues: (1) extent tracks the people a realm actually governs; (2) the map fills LATE, with development, via the logistics march; (3) capless solo realms are sized by their people instead of freezing; (4) sub-Egypt realms exist. All four are preserved below.

## 2. The defect, re-measured on HEAD (baseline the design must beat)

Probe: `probe_sizepopk_baseline.mjs` (scratchpad), harness buildSim worldgen 480×240 → sim tw=240 (resScale=1, rNormPop=1 — the reference grid), seed 8817, 12k steps, sampled every 250:

- `world._sizePopK` trajectory: 0 until ~3.2k → seeds at 7.94e-5 → FROZEN 3.5k–7.5k (no capacity-bearing realm gives a fresh median) → decays to 1.87e-5 by 10.75k → **jumps ×8.7 in one 250-step window to 1.62e-4 at step 11000** → decays to 4.7e-5 by 12k. Band ×8.7 inside the 12k horizon (diagnosis measured ×11.2 jump / ×20 band on its longer run — same defect, same shape).
- **The "median" is a sample of n=1 for steps 8000–10500, and n=6 after 11000.** The anchor is literally ONE realm's tiles-per-person ratio for a third of the run; the "Bronze jump" is the sample switching to the newly-crowned leading cohort (median govPop of the sample churns 895,994 → 575,814 across the jump). This sharpens diagnosis R2: it is not even a median — it is whichever realm happens to bear capacity.
- Coverage breathes in lockstep: 1.6 → 1.7 → **8.4** → 5.2 → 3.4% over 8k–12k.
- Per-realm demonstration (the Bronze-jump test, live): realm #10, org 0.174→0.177, NOTHING local changed — its live target went **4 → 48 tiles (×12) in one window**; under the design formula (own-grounded): 8 → 11.
- Aggregate world target, max window-to-window ratio over 8k–12k: **live ×11.09; design counterfactual (from the same per-realm data) ×1.33.**
- Bonus defect found: at the anchor's FIRST seeding (~3.2k) the regime switches from the COVER-floor path to popCap and the cradle realms' heldMed collapses 33 → 4 tiles in a few passes — a structural discontinuity the redesign removes (the formula below is defined from tick 0).
- Scale facts for calibration: world popField total 13.7M at 12k (≈0.07× real Earth at matched development, ~200M); 77% of land carries ≥30 people/ref-tile from genesis (deep-ancestry seeding); the state-relevant density contour lives at 10k–100k people/ref-tile.

## 3. Candidate evaluation (honest)

**(a) OCCUPIED-LAND TARGET — rejected, but its soul survives as the equilibrium of (b).** Three measured/structural failures: (i) *circular region definition* — "owned + frontier" makes the target a function of ownership, which is a function of the target; an admin-reach candidate set needs its own bound, which is again the target; a 1-ring frontier makes growth crawl at ring speed independent of the rate-cap machinery. (ii) *The subsistence threshold is the coverage dial wearing a physical costume*: measured, ANY forager-scale threshold (≤3k/ref-tile) counts 77–100% of a realm's land and most of the planet (median realm's owned tiles: 100% above 3k/ref-tile, 37% above 30k) — the discriminating value must sit in the 10⁴–10⁵ band where it is doing exactly the outcome-fitting work the second cardinal rule bans. (iii) *Not conserved under grid refinement*: an above-threshold tile COUNT splits asymmetrically when a finer grid resolves peaks and voids around the contour (Jensen), where an integral (govPop) is exactly conserved (popField is per-real-area, popField.js:39-46). Also (iv) it compresses dense-valley realms (Egypt-class) to their inhabited strip — a structural size-distribution change far beyond this defect's scope.

**(b) FIXED PHYSICAL DENSITY ANCHOR — chosen.** One frozen, unit-ful constant; every other term already exists per-realm. Development is carried by three per-realm emergent channels, not by the constant: `spanTechMul` (statecraft, ×6.7 dynamic range 0.15→1.0 under SPAN_TECH=0.85, countryTerritory.js:444-449), the logistics march (:764-765, unchanged), and demography itself (govPop grows as the world peoples). Crucially, (b) *contains* (a) as its emergent equilibrium: expansion is self-funding exactly while the marginal frontier tile carries `popField[ni] ≥ (DENS/r2) · loadOfD(d) / (spanTechMul · ADMIN_LOAD_RECAL)` — the border comes to rest where the governable people end, inflated by distance-load and deflated by statecraft, with NO threshold count anywhere. A dense core still funds sparse peripheries (Egypt's deserts) through the aggregate, priced by the admin-load Dijkstra.

**(c) Marginal-density-gated growth/shed (no aggregate target at all)** — the deepest version of the same idea: claim a wild tile iff its density clears the bind contour; shed tiles below it beyond the march allowance. Rejected HERE because it rewrites the whole step 4–6 target/grow/shed ledger (held/target/budget plumbing, the step-7 fill-headroom coupling from the Tier-A follow-up) and structurally changes equilibrium sizes like (a). Recorded as the future mechanism if densification inflation (risk 1) ever bites.

## 4. The mechanism (spec)

**Formula.** For every non-nomadic realm cid in `capOf`:

```
popCap = round( govPop(cid) · spanTechMul(cid) · (adminOn ? ADMIN_LOAD_RECAL : 1) · r2 / RURAL_BIND_DENS )
march  = round( MARCH_LOG_TILES · logiOf(cid)^MARCH_POW · r2 )          // unchanged, :764-765
t      = popCap + march
```

- `govPop(cid)` — Σ popField over the realm's owned land tiles, exactly the existing accumulation at countryTerritory.js:715-717 (kept verbatim). Resolution-invariant by construction (popField stores people per real area).
- `spanTechMul(cid)` — the existing earned-span statecraft factor (:444-449). This is the term line :756 currently DISCARDS; re-attaching it is what makes a Stone-Age realm sized by its own statecraft instead of the leader cohort's.
- `ADMIN_LOAD_RECAL` (1.18, :86) — the existing tiles→load-units recalibration, same convention as spanEff (:522) and the COVER floor (:780). Applied only under adminOn.
- `r2 / RURAL_BIND_DENS` — RURAL_BIND_DENS is people per REFERENCE tile (240-grid tile ≈ 17,700 km²); ÷r2 gives people per sim tile; the quotient govPop/(DENS/r2) is sim tiles. Exactly res-invariant: govPop invariant, target scales ×r2, and the marginal-contour condition compares popField-per-sim-tile against DENS/r2 — the same ratio at any grid.
- No live cross-realm aggregate anywhere in the target. `world._sizePopK`, the median block, and SIZE_POPK_SMOOTH are deleted.

**Data model.** No new state. `world._sizePopK` becomes a dead persisted field (see save-compat). `govPopOf` stays a per-pass scratch Map. RURAL_BIND_DENS is a tuning lever + module constant + env sweep knob (repo pattern, mirrors MARCH_TILES_ENV at :397).

**Trigger conditions.** Same as today: the block runs inside `fieldPolityTerritory` step 4, gated `T.SIZE_BY_POP && world.popField` — but with NO `popCapK > 0` warm-up gate, so it is defined from tick 0 and from the first post-load pass (memoryless), removing both the seeding-crush discontinuity (§2) and the entire class of save/load anchor-drift bugs the low-pass was built to patch (empire-consolidation doc, "The save/load bug").

## 5. Exact code sites (HEAD 713c766)

`src/sim/peopleSim/countryTerritory.js`:
1. **:393** — DELETE `const SIZE_POPK_SMOOTH = 0.25;`. In its place add:
   ```js
   // SIZE_BY_POP: the average population density over a pre-modern state's WHOLE
   // territory below which there is nobody to govern — people per REFERENCE tile
   // (≈17,700 km²), in SIM-population units (the CAP_PER_FERT scale; recalibrate
   // together if the demographic scale ever moves). Historical early empires
   // averaged 3–12 people/km² over their full extent (Achaemenid ~3, Han/Rome
   // ~10–12); × the sim's population scale (~0.07× Earth at matched development)
   // → 3,700–12,400 per reference tile. Frozen ONE-TIME at design (2026-07-28);
   // never a live statistic. Env-overridable for sweeps (SIM_BIND_DENS).
   const RURAL_BIND_DENS_DEF = 8000;
   const BIND_DENS_ENV = (typeof process !== "undefined" && process.env && +process.env.SIM_BIND_DENS) || 0;
   ```
2. **:713-743** — REPLACE the whole block with only the govPop accumulation (:715-717 kept verbatim):
   ```js
   let govPopOf = null;
   if (T.SIZE_BY_POP && world.popField) {
     govPopOf = new Map();
     const pf = world.popField;
     for (let ti = 0; ti < N; ti++) { const c = co[ti]; if (c < 0 || !(elev[ti] > 0)) continue; govPopOf.set(c, (govPopOf.get(c) || 0) + pf[ti]); }
   }
   ```
   (deletes: gps/tgs collection :718-723, the median + low-pass + persisted-anchor logic :724-742, and the `popCapK` local.)
3. **:746** — condition `if (T.SIZE_BY_POP && popCapK > 0)` → `if (T.SIZE_BY_POP && govPopOf)`.
4. **:752-754** — nomad exemption KEPT VERBATIM (`const c = world.countries && world.countries.get(cid); if (c && c._nomadic) { /* keep capacity target */ }`).
5. **:763** — REPLACE `const popCap = Math.round((govPopOf.get(cid) || 0) * popCapK);` with:
   ```js
   const bindDens = (BIND_DENS_ENV > 0 ? BIND_DENS_ENV : (T.RURAL_BIND_DENS ?? RURAL_BIND_DENS_DEF)) / r2;   // people per SIM tile
   const popCap = Math.round((govPopOf.get(cid) || 0) * spanTechMul(cid) * (adminOn ? ADMIN_LOAD_RECAL : 1) / bindDens);
   ```
   :764-766 (march + `t = popCap + march`) unchanged. :768 cold-start guard unchanged (`if (t <= 0) { if (cp <= 0 && (govPopOf.get(cid) || 0) <= 0) continue; }`).
6. Rewrite the comment block :705-712 and :747-762 to describe the fixed-density grounding and the emergent border contour (keep the "capacity is NOT the ceiling" rationale at :756-762 — it is still correct and still guards against re-importing the median-anchored capacity).

`src/sim/peopleSim/tuning.js`:
7. **:197-198** — rewrite the SIZE_BY_POP lever desc (it currently documents the median anchor + SIZE_POPK_SMOOTH). Add a `RURAL_BIND_DENS` lever entry beside it (def 8000, min ~2000, max ~40000, step 500) with the physical meaning above.

`src/sim/persist.js`:
8. **:250** — keep the field for format stability but write `sizePopK: 0` (or drop the line; loader is already tolerant). **:381** — keep the tolerant read (`data.sizePopK ?? 0`) so old saves load cleanly; the value is never read by the sim any more (grep-verified: only countryTerritory.js and persist.js touch `_sizePopK`). Old-code-loads-new-save also safe (reads 0 → its reseed path).

`docs/empire-consolidation-2026-07.md` — append a dated section recording the re-grounding (the SIZE_BY_POP mechanism description there documents the median anchor).

## 6. How existing state feeds it
- `co` (`world._countryOwner`) + `world.popField` → govPop (:715-717, existing).
- `knOf` → org → spanTechMul (:444-449, existing; capless newborns not yet in world.countries fall back to org 0 → stm 0.15, the correct "runner-and-kin" span).
- `logiOf` (:426-427) → march (existing).
- `capOf` iteration (:744) unchanged — nomads and the lever-off/TILE_POLITY/legacy branches (:769-789) byte-identical.
- Downstream consumers (target→grow/shed budgets, step-5 Dijkstra, step-6 shed, step-7 fill headroom) read `target`/`grow` Maps exactly as today — zero plumbing changes.

## 7. Global-anchor audit (LIST, one-line verdicts — no redesign here)
- `world._refCapPower` (conquest.js:1960; read :2025, :2195): live raw median capital power — SAME DEFECT CLASS (cross-realm order statistic in local capacity) but deliberately the "era-relative capacity" ruler, log2-compressed at every read; bounded impact, watch.
- `world._refCapPowerS` (conquest.js:1964-65; read :2267 as the capacity ruler base): smoothed copy of the above — same class; it is WHY realms cluster at "standard size" (diagnosis #8); a Tier-B candidate of its own, out of scope here.
- `world._refRevenue` (conquest.js:1992-1997; read :2216): member-weighted MEAN system extraction (a whole-system sum, not an order statistic), floored at 1, smoothed, self-limiting (the hegemon lifts its own baseline) — BENIGN unit anchor.
- `f2c` (countryTerritory.js:1983-1989): whole-world totals ratio (census ÷ popField) used as a unit conversion in nucleation viability — BENIGN (two representations of the same total, whole-world sample), with the diagnosis's own "latent drift" watch if census/field ratios diverge with development.
- Adjacent, same family (for completeness): `world._provRatio` (conquest.js:2052-2058) — median census ÷ median governed-people, low-passed, n≥8 guarded — benign-ish unit anchor, watch; `regionScale` (conquest.js:2025) — median-to-median power re-anchoring, deliberate backward-comparability shim, same class as `_refCapPowerS`.

## Constants

NEW:
- RURAL_BIND_DENS (default 8,000 people per reference tile; lever T.RURAL_BIND_DENS + env SIM_BIND_DENS): the average population density over a pre-modern state's WHOLE territory below which there is nobody to govern. Independent physical meaning: historical early empires averaged 3–12 people/km² over their full extent (Achaemenid ~17M/5.5M km² ≈ 3, Han ~10, Rome ~12); one reference tile ≈ 17,700 km², and the sim's demographic scale is ~0.07× Earth at matched development (measured pfTot 13.7M at 12k vs ~200M historical), giving a derived band of 3,700–12,400 people/ref-tile. 8,000 is the mid-band value, which also reproduces the baseline's time-mean coverage with the defect spikes excluded (counterfactual aggregate 0.9→3.2% over 8k–12k vs live time-mean ~3.1% including spikes). Denominated in SIM-population units (the CAP_PER_FERT scale, popField.js) — the two must be recalibrated together if the demographic scale ever moves; this coupling is documented at both constants. Frozen one-time at design; NEVER a live statistic.

DELETED:
- SIZE_POPK_SMOOTH (countryTerritory.js:393) — no anchor left to smooth.
- world._sizePopK — no longer computed or read; persisted field kept dead for save-format stability.

REUSED (no change, each already unit-ful):
- SPAN_TECH 0.85 via spanTechMul (share of administrative span requiring mature statecraft — now actually applied to the pop core instead of being computed and discarded at :745 vs :756).
- ADMIN_LOAD_RECAL 1.18 (mean admin load per tile; tiles→load-unit conversion, same convention as spanEff :522 and the COVER floor :780).
- MARCH_LOG_TILES 150 / MARCH_POW 2 (sparse-frontier reach of a fully-logistic state; unchanged).

## Validation plan

Baseline numbers to beat (measured on HEAD 713c766, worldgen 480×240 → sim 240, seed 8817, 12k steps): _sizePopK band ×8.7 with a ×8.7 single-window (250-step) jump at step 11000; the "median" sample is n=1 for steps 8000–10500 and n=6 after; coverage breathing 1.6→8.4→3.4%; realm #10's target ×12 in one window with no local change; max window-to-window aggregate-target ratio ×11.09 (design counterfactual from the same data: ×1.33).

1. BRONZE-JUMP GATE: re-run the baseline probe on the implemented branch, same seed/grid/horizon. At the leader-crowning window (~step 11000 here), assert every realm whose own membership/gov did not change moves its target < 10% window-to-window (baseline: ×8.7–×12 for all). This is structural (no cross-realm term) but must be measured to catch accidental couplings.
2. OSCILLATION GATE: max window-to-window ratio of Σ targets over 8k–12k ≤ 1.5 (baseline 11.09; counterfactual predicts ~1.3); coverage max/min band over any 2k post-8k window ≤ 2 (baseline 5.3).
3. CALIBRATION SWEEP (one-time, then freeze): SIM_BIND_DENS ∈ {5000, 8000, 12000} at 480/24k, 2 seeds (8817, 31337). Choose the value whose arc best matches the documented healthy shape — sparse antiquity (single-digit % coverage at 8k), coverage rising with development, median realm in the ~300k–1.4M km² band, sub-Egypt realms at every step, biggest realm ≤ ~13M km² and mortal. Freeze that value as RURAL_BIND_DENS_DEF and record the sweep in the doc. Counterfactual predicts 8000 lands slightly sparser than live early — acceptable and more honest (the live early level includes the defect's inflation windows).
4. RESOLUTION INVARIANCE: same seed at worldgen 480 (sim 240, r2=1) vs 960 (sim 480, r2=4): claimed% and median realm size in real km² within the repo's score_resinv tolerances. The formula is exactly invariant (govPop conserved, ×r2 explicit, contour ratio grid-free); the trajectory should now be MORE invariant than baseline (no median whose sample composition differs by grid).
5. SAVE/LOAD: npm test smoke continuation gate — the target is memoryless, so the first post-load pass computes byte-identical targets with no anchor at all; specifically assert the original 3.7pp drift-class failure cannot recur (no persisted quantity feeds the target). Old-save load (sizePopK present) and new-save-on-old-code both tolerated.
6. FULL BATTERY: npm test green at every step; stylized battery ≥3 seeds all hard gates within the soft budget. Gates that could legitimately MOVE and may need re-derivation: coverage-by-development soft facts and the empire-area Zipf/largest-share bands (re-baselined to the un-coupled trajectory), realm-count band (statelet minting no longer surges when the anchor dips). Reference hash pairs (probe_hash480 / probe_hashbase 320) MUST be re-minted — this is a deliberate default behaviour change, exactly like the SIZE_BY_POP flip that minted 6c46c2d1/9262bb95. `SIM_TUNE="SIZE_BY_POP=0"` must still recover the legacy floor world byte-identically (that path is untouched).
7. NEW STANDING GATE (R5 lesson — nothing watched this defect): stylized.mjs adds a coverage-breathing check (max/min claimed% over any rolling 2k-step window post-8k ≤ 2×), so a re-coupling regression cannot ship green.
8. WATCH METRICS across the battery: top-realm size trajectory (densification-inflation risk), genesis-window (0–3.5k) cradle sizes (the floor→popCap regime switch is gone; cradles now get pop-targets from tick 0 — expect basin-scale ~3–16 tiles instead of floor-33-then-crush-to-4), and war-annexation snowballing (largest-empire share gate).

## Risks

1. DENSIFICATION INFLATION (the one virtue candidate (a) had): late-game population densifying on unchanged land raises govPop → raises the target without new peopled land, so mature realms expand over emptier margins. Partly intended (this is the "map fills late by population" goal, now driven by real demography instead of anchor drift) and priced (remote/sparse tiles cost multiple load units via loadOfD + claim hostility), but the giant's ceiling now scales with its demography where the live anchor diluted it. Watch top-realm size and largest-share gate; if it bites, the recorded next mechanism is the marginal-density contour (candidate (c)), not a re-coupling.
2. WAR FEEDBACK: annexing peopled land raises the victor's target immediately (govPop jumps stepwise). Realistic, but strengthens conquest snowballing slightly vs the live rule; interacts with diagnosis #6 (eternal nations). Watched in validation 8.
3. SIM-POP SCALE COUPLING: RURAL_BIND_DENS is denominated in sim-people; any future recalibration of CAP_PER_FERT / demographic scale (e.g. the Tier-B eraProd land-food maturity fix, which will grow late populations) shifts the effective bind density. Document the coupling at both constants; re-run validation 3 if the Tier-B food work materially moves pfTot.
4. TRAJECTORY SHIFT AT GENESIS: cradle realms no longer ride the COVER floor until the anchor seeds (heldMed 33 → pop-targets ~3–16 tiles at 0–3.5k). More honest, but every doc number calibrated on the old genesis window (and the 480 reference hashes) moves; re-baseline deliberately, per validation 6.
5. EARLY-COVERAGE UNDERSHOOT: counterfactual aggregate targets at DENS 8000 run ~1–3% over 8k–12k vs live 1.6–8.4% — the live figure includes the defect's inflation spikes, but if the honest level proves too sparse against the stylized coverage facts, the calibration sweep (validation 3) resolves it INSIDE the physical band, not by re-coupling.
6. COUNTERFACTUAL LIMITS: all design-b numbers were computed from realms that existed under the BASELINE trajectory; birth/growth dynamics will differ on the implemented branch (realm count, statelet minting no longer surges when the anchor dips). Precision beyond ~×1.5 on aggregate predictions is spurious — hence the sweep-then-freeze procedure rather than a computed constant.

## Open questions

1. FINAL RURAL_BIND_DENS VALUE: 8,000/ref-tile is the proposed mid-band default; the owner should ratify after the validation-3 sweep — and decide whether the sweep also needs a cell at the shipped app grid (worldgen 1920 → sim 960), given the repo's R4 history of constants tuned only at the reference.
2. PERSISTED FIELD RETIREMENT: keep writing `sizePopK: 0` for one format generation (old code loading new saves reseeds cleanly) vs dropping the line now. Recommend keep-dead one generation; owner's call on format hygiene.
3. STYLIZED RE-BASELINE SCOPE: which soft facts get re-derived bands vs held (coverage-by-development, empire-area tail, realm count) — needs the integrator's judgment against the post-change 3-seed battery, same procedure as the SPAN_TECH flip re-baseline.
4. NOMAD EXEMPTION: kept verbatim (:752-754) per the brief; longer-term, should steppe confederation extent also become emergent (momentum + herd-carrying-capacity) instead of the capacity target? Out of scope, flagging.
5. _refCapPowerS AS ITS OWN TIER-B ITEM: the audit confirms it is the remaining "every realm clusters at standard size" driver (diagnosis #8) — same defect family, deliberately not touched here because capacity's era-relativity is load-bearing for turnover. Does the owner want it queued?
6. NEWBORN JUMP-START: a newborn's govPop counts only its stamped core, so dense-basin newborns take a few passes for the target↔claim feedback to reach basin scale (rate-capped, same as today). Acceptable, or should popCap read the founding basin mass (the nucleation viability integral) for the first pass? Recommend as-is — the feedback converges in ~3–5 passes and adding a second pop integral is more surface for drift.