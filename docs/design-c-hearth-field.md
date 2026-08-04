# TIER C PHASE 1 v4 — THE HEARTH FIELD: agriculture has more than one origin

**Status: DESIGN, measured on HEAD 926381a (branch claude/civ-simulation-balance-ysrx3v). Probes: `/tmp/claude-0/-home-user-Simman-/85150cac-b1ce-5215-a2a1-aa8eb6eca827/scratchpad/probe_merge.mjs`, `probe_viable.mjs`, `probe_reach.mjs`, `probe_hearth.mjs`, `probe_hearthrun.mjs` — to be committed as `tools/probe_hearthsupply.mjs` + folded into `tools/probe_sitesupply.mjs`. Every number below was produced by me on this HEAD, not projected.**

---

## 0. THE FINDING THAT REDIRECTS THE LANE

The v3 verdict said the ledger was "invariant but unreachable" and sent the lane to frontier act economics. Lane M corrected the cause to water. **Both are downstream of a single upstream fact I measured, and it is not a Tier-C problem at all.**

`world.devField` — the agricultural technique field, which sets `capField`, which sets how densely land peoples — is seeded by exactly one function: `ensureDevField` (popField.js:376) calls `stampDevSources` (popField.js:224), which stamps **settlements only**, then runs a **land-only** wave (`relaxDevWave`, popField.js:272, iterates the `land` list). So farming in this sim has exactly as many origins as the world has *cradle settlements*, and it can never cross one water tile.

And the cradles are pinned by name. `seedCradleVillage` (state.js:451) short-circuits at state.js:456 into `seedEarthHearths` (state.js:403), which seeds four hard-coded fractional map positions (`EARTH_HEARTH_SITES`, state.js:371 — Nile, Mesopotamia, Indus, Yellow River) under `T.EARTH_HEARTHS` (tuning.js:431, **default 1**). The in-code rationale states the outcome directly:

> *"Seeding ONLY these three means civilisation radiates from the Old-World cradles while the New World and Australia stay wild until sea-borne colonisation reaches them — the 'ungoverned until colonisation' look."*

That is a named-region hard-code whose justification is a desired result. It is the second cardinal rule's exact prohibition, and it sits upstream of every symptom the last three attempts fought:

- 60% of the planet's land has `devField ≡ 0.000` forever → it saturates at forager density (78 people/tile vs 1290 on farmed ground) → Design A's coalescence law is inert there **by construction**;
- 109 of 207 ledger sites stand on landmasses with no hearth and therefore no donor → the sweep's `extension` gate (crystallize.js:1249, :1288) vetoes them → "128 free sites, permanently";
- the home continent is the *only* one that ever got farming, so it filled to 100% of its viable ledger (98 sites, 78 viable, 78 claimed) → "supply-exhausted", which every design measured and mis-attributed;
- `OVERSEAS_INDEPENDENT_RATE = 0.02` (crystallize.js:168, read at :1152) — the sim's own rate for *independent origins on another landmass* — is **dead code**: the sweep computes it and then unconditionally vetoes the founding two hundred lines later.

The codebase already names the fix. state.js:365-370: *"Extend this list (Indus, Mesoamerica, Andes) for more independent hearths. NB this is a deliberate, preset-gated diorama INPUT: the emergent cradle scorer below (seedCradleVillage — temp×moist×fert×river×circumscription) is **the real mechanism** and runs for every procedural map, and for Earth when the lever is off."*

### 0a. MEASURED — let the real mechanism run and the lane's whole problem dissolves

Head-to-head, `buildSim` 480×240, seed 8817, 12 000 steps, `LABEL_BIRTH=1` (the **shipped v3 ledger, byte-unchanged**) in both arms, foreground/serial:

| channel @12k | pinned hearths (shipped) | algorithmic hearths |
|---|---|---|
| **labels** | **78** (frozen from step 2000) | **139** — **1.78× the pin** |
| land components carrying labels | **1** | **5** (77 / 31 / 21 / 9 / 1) |
| farmed land, devField ≥ 0.45 | 29.5% → **37.1%** | 47.4% → **61.1%** |
| field population (pfTot) | 8.32M | 7.38M (−11%) |
| realms | 32 | **51** |
| census p50 | 69.1 | 43.8 |
| `_onePopScale` | 1.280e-3 | 2.590e-3 |
| `world._townBar` | 69.1 (percentile released the floor) | **60 (FLOOR BINDING)** |
| ms/tick | 9.06 | 14.88 (+64%) |

The control arm reproduces the recorded v3 numbers exactly (78 from step 2000, pfTot 8.3M, `_onePopScale` 1.28e-3, census p50 69) — the harness is sound. The treatment arm was run with `EARTH_HEARTHS=0` (pins *removed*); the shipped design below **retains the pins and adds the algorithmic fill on top**, so 139 is a measured **lower bound**, and the −11% pfTot (the Nile/Mesopotamia engines not seeded) is the specific thing retention is there to recover.

### 0b. Where the scorer puts hearths on Earth (t=0, `EARTH_HEARTHS=0`, 480, 8817)

Six cradles across **five** land components: comp 11 Afro-Eurasia ×2 (3858 tiles), comp 0 ×1 (1605 — the Americas), comp 44 ×1 (676 — South America), comp 66 ×1 (297 — Australia), comp 23 ×1 (a 4-tile islet, the low-score tail). The polar mass (comp 81, 2855 tiles) correctly gets none — the temperature filter excludes it. **Multiple independent origins of agriculture fall out of the existing scorer with nothing named.** That is the cardinal-rule-2 vindication: build the cause and the New World civilisations appear without any code knowing what the New World is.

### 0c. MEASURED — a resolution leak in the cradle layer, which this design must fix first

`CRADLE_MIN_SEP = 60` (state.js:333) is in **raw tiles, not ×rn**. Measured hearth count with the scorer running: **2 at 240, 6 at 480** — the number of agricultural origins on Earth scales with grid resolution. It is masked today only because `EARTH_HEARTHS` pins exactly four. Making this supply lever load-bearing without fixing the unit would install a fresh W4-class bug at the genesis layer.

### 0d. MEASURED — Design C's quantizer deletion is a v2 relapse, and it is on 56% of the map

Judge 2 named this as C's unmeasured risk. I measured it. Raw Class-H anchorage maxima (`buildSiteLedger` `raw.bay`), 240/480/960, seed 8817:

| candidate source | 240 | 480 | 960 | 480↔960 |
|---|---|---|---|---|
| raw Class N (flow-tree nodes at CATCH_TRIB) | 634 | 565 | 588 | **+4.1%** |
| **raw Class H (shelter local maxima)** | **147** | **279** | **529** | **+90%** |

Class H raw maxima are pure grid texture — ×1.9 per doubling, v2's exact signature. **Design C's "delete the greedy quantizer" would have shipped a resolution leak governing the coastal remainder.** Full merge-scheme comparison (accepted-site counts):

| scheme | 240 | 480 | 960 | 480↔960 | home-continent sites |
|---|---|---|---|---|---|
| shipped (`SITE_MERGE_D` on both classes) | 177 | 207 | 205 | −1.0% | 98 |
| **rank-D on Class N, horizon-D on Class H** | 292 | **257** | 268 | **+4.3%** | **124** |
| rank-D on both classes | 333 | 361 | 492 | **+36%** | 155 |
| no quantizer at all | 781 | 844 | 1117 | **+32%** | 405 |

So: a rank-scaled exclusion is legitimate **for the river class only** (where a real commanded area exists and the raw candidate set is already invariant); Class H must keep a real-length quantizer, because "best anchorage per horizon of coast" is the only invariant statement available about a coastline. Design C's central move is half right and its own writeup does not know which half.

### 0e. Viable-site ceilings (480, 8817) — what each mechanism can actually supply

`homeViable` = home-continent sites passing the sweep's own `MIN_FERT`/`MIN_AREA_FERT` gates; v3's measured uptake of viable home sites is 100% (78 of 78).

| ledger | home sites | home viable | viable at excursion budget B=2 (all reachable land) | viable, all components |
|---|---|---|---|---|
| shipped | 98 | **78** ( = the pin, exactly) | 143 | 143 |
| rank-D Class N | 124 | **104** | 181 | 181 |

The reach table independently reproduces lane M's T4 to the tile (B=0 → 40.1% of land, B=1 → 44.9%, B=2 → 69.8%, B=6 → 99.8%; shipped viable at B=2 = 143 = lane M's "labels would be 143"). Two consequences the design is built on:

1. **The ledger repair alone cannot clear the bar.** 104 viable home sites = 1.33× the pin. It is a genuine rule-2 repair and it is *not* a flip.
2. **The hearth repair alone does clear it, measured: 139.** It needs no ledger change, no boat, no new constant, and — decisively — **it fires from step 0**, so the standing 12k battery is a valid horizon. Design B's crossing cannot fire before nav 0.10 (~step 10k) and dies on the horizon; that is Judge 2's "Death 1" and it is unavoidable for any water mechanism.

---

## 1. THE LAW — `T.MULTI_HEARTH` (new lever, default 0, byte-identical off)

**One sentence: the scenario pins say where Earth's *known* hearths were; they must not also say where hearths *cannot* be. The emergent scorer runs everywhere the pins are silent.**

### 1a. Seeding (state.js:451 `seedCradleVillage`)

Today: `if (T.EARTH_HEARTHS && earthPreset) { if (seedEarthHearths(world)) return; }` — an early **return** that makes the pin list exclusive.

Under `T.MULTI_HEARTH >= 1` the early return becomes a **pre-load**:

```
let picked = [];                                   // now hoisted out of the algorithmic block
if (T.EARTH_HEARTHS && earthPreset) picked = seedEarthHearths(world) || [];   // returns its seated {tx,ty,ti} list
// …algorithmic scoring block runs UNCHANGED, with `picked` non-empty…
```

`seedEarthHearths` (state.js:403) gains one line: it already builds a local `picked` array (state.js:406, pushed at :440) — it returns it instead of a boolean. The algorithmic greedy (state.js:500-511) is otherwise **verbatim**: same candidate filters, same score (`f*2 + riverBonus + landBarrier*2.5 + tempFit + elevFit − max(0, seaFrac−0.30)*5`), same `CRADLE_MIN_SEP` rejection, same `MAX_CRADLES` cap, same fixed sort order. The pinned hearths simply occupy their own separation discs, so the scorer fills the *rest* of the planet.

Nothing detects a continent. Nothing counts landmasses. Nothing names a region. The only change is that a scenario input stops being a cap on a mechanism.

### 1b. The units fix that must ride with it (state.js:502)

```
const minSep  = CRADLE_MIN_SEP * rNormPop(world);      // REAL distance (RES_INVARIANT_POP), as every reach quantity already is
const minSepSq = minSep * minSep;
```

`CRADLE_MIN_SEP = 60` reference-tiles ≈ 8 000 km — "far enough that one continent gets at most one or two independent origins" (its own comment). Measured today: 2 hearths at 240, 6 at 480. Behind the lever only, so arm 0 stays byte-identical. This is a **unit correction**, not a value change: the number and its meaning are untouched.

### 1c. What then happens, entirely through shipped machinery

A hearth is a settled town, so it stamps `devField` (`stampDevSources`, popField.js:224); the wave relaxes over *its* landmass (`relaxDevWave`, popField.js:272) at DEV_WAVE_KMPY = 1 km/year with the DIFF_CLIM toll; `capField` rises with local technique; `stepPopField` densifies the countryside; the ledger's cells there cross `T.LABEL_BAR`; and the sweep founds on them through the ordinary `extension`/donor chain (crystallize.js:1249-1288) with **no gate touched and no teleport anywhere** — every new label is still a connected extension of a real donor within `FRONTIER_EXTEND_DIST`. Measured outcome: 31 labels on the Americas, 21 on South America, 9 on Australia, farmed land 37% → 61%, realms 32 → 51.

That is the point of the design: it changes an **initial condition**, and every mechanism downstream is the one already shipped and already validated.

### 1d. Deflation guard — rides with this lever (blocking)

Measured: census p50 69.1 → 43.8, and `world._townBar` (settlement.js:3270) reads `Math.max(TIER_TOWN_FLOOR /*60*/, pAt(0.50))` → the **floor binds** in the treatment arm (60 > 43.8) where in the control it had just been released (69.1). Left alone, every label pins to tier 0/1 and the urban hierarchy — and with it the Zipf/urbanisation stylized gates, `CORE_BY_TIER`/`HINTERLAND_BY_TIER` (territory.js:243-290), `foodHierarchy`'s tier-keyed haul ranges and `ARMY_TIER_FRAC × s.people` — collapses.

Under `T.MULTI_HEARTH >= 1`, settlement.js:3270-3271 drops the absolute floors and runs pure rank percentiles:

```
world._townBar = pAt(0.50);
world._cityBar = pAt(0.85);
```

Justification is the code's own (settlement.js:50-57): the floors are *"a documented measured-floor shortcut… not first-principles census minima"*, derived as `TIER_THRESHOLD × 0.4` from a retired scale. Central-place rank structure is scale-free by construction, so percentiles are the mechanism-honest bar and they self-calibrate at any label supply — the B3 pattern, verify-don't-re-anchor.

`_onePopScale` (popField.js:1470-1486) stays **frozen and is correct to stay frozen**: a person is a person; what legitimately changed is that each label's catchment holds fewer of them (and note the measured scale *rose*, 1.28e-3 → 2.59e-3, because it freezes at activation with the new label set — it is a pure unit conversion either way). The guard's job is only to ensure no bar reads *a label's share of a partition* as if it were a physical quantity.

---

## 2. THE LEDGER REPAIR — `T.LABEL_BIRTH = 2` (separate arm, separately measured)

Not required for the flip; it is an independent cardinal-rule-2 repair of a constant already shipped, and it is the packet's best finding. **It is a superset of arm 1, so a failure is attributable to it alone.**

`SITE_MERGE_D = TOWN_BASIN_R / 2` (crystallize.js:337), consumed at crystallize.js:613 as `const D = SITE_MERGE_D * rn` and applied uniformly at :623-624 to **every** candidate regardless of the countryside it commands, is v1's spacing constant surviving inside v3. Its in-code defence — *"DERIVED, not free… invariance does not ride on the choice"* — is true and beside the point: invariance does not ride on it, but the **count** does (565 raw river candidates → 154 kept at 480).

Replacement, Class N only:

```
// A market node's exclusion is the linear scale of the countryside it commands:
// the equivalent radius of its own catchment. A great mouth is the market for a
// whole basin; a headwater junction is the market for its valley. No length is
// chosen — the drainage tree measures it.
const Drank = (a) => Math.sqrt(a.v / Math.PI) / kmPerTile;   // a.v = discharge-equivalent km²
```

`kmPerTile = sqrt(world.worldRef.rivers.km2PerTile * tileRes²)` — the world's own real-scale conversion (riverGen.js:619-626). Class H keeps `SITE_MERGE_D * rn` **because §0d measured that it must**: an anchorage has no commanded catchment in km², and a rank-scaled or absent exclusion on the coast leaks resolution at +36% / +90%. The honest statement to carry in-code: *the river class retires the horizon quantizer because it has a physical rank; the coast keeps it because "the best anchorage per horizon of coast" is the only invariant claim a coastline supports at this grid.*

Measured (§0d, §0e): 207 → 257 sites, 480↔960 +4.3% (vs +4.1% for the raw candidates — the rank-D is transparent to resolution), home-continent viable 78 → 104. `nn` p50 717 km → 549 km, cv 0.20 → 0.43 (geography-following, away from the covering-law signature).

**Commit M4's falsification row in the same commit** (Design C's best methodological idea): raw node counts at 30e3 / 15e3 / 10e3 / 5e3 km² degrade to −16 / −22 / −25% at 480↔960 because one accumulation unit at 480 is 18 468 km² (measured: `km2PerAccum` = 72 190 / 18 047 / ~4 512 at 240/480/960, so `CATCH_TRIB` is *below one accumulation unit* at 240). `CATCH_TRIB = 60e3` is the deepest rung a product grid resolves; it is contractually immovable and may only ever be changed for hydrological reasons.

---

## 3. THE ACT-BAR UNIT CORRECTION — `T.ACT_FIELD_POP` (separate lever, default 0, not required for the flip)

Both judges call this the packet's best idea and it is a present-tense bug, so it ships — **on its own lever, measured on its own**, because it is a correctness fix and not a supply mechanism (supply is the ledger; uptake of viable home sites is already 100%).

The ruling, stated once: **an act that moves real people is priced in real people, in dimensionless field ratios, or in transport-cost units — never in a label's share of a census partition.**

| site | today | under the lever |
|---|---|---|
| crystallize.js:798 / :1642 `COLONY_MIN_POP = 200` vs `parent.people` | census | parent's cell mass ≥ `T.LABEL_BAR` + the party (`labelBasinMass`) |
| tuning.js:367 `COLONY_MIN_POP = 400`, tested sea.js:314 | census | same read on the port's cell |
| crystallize.js:1816 / :1844 `PLANT_CAP_MIN_POP = 500` | census | same read on the capital's cell |

Evidence it is broken now (lane M T8, reproduced by my control arm): `_onePopScale` = 1.28e-3, so a "400-person" colonising port is ~312 000 field people; 1 of 78 labels qualifies at 12k, 7 of 79 at 24k, and `maybeSendSettlers` fires roughly once per 24 000 steps. `COLONY_MIN_NAV`, `CHARTER_ORG_MIN`, `CHARTER_ENDOW` are **untouched** — they price ships and statecraft, which are not census quantities. Take Design B's framing wholesale: *a charter changes who chooses and what coin arrives; it never changes whether the demography is allowed.*

---

## 4. GRAFTS TAKEN AND DROPPED — explicitly

**Taken:**
- *From C:* the rank-scaled river quantizer (§2) and the committed falsification row. C's diagnosis of `SITE_MERGE_D` is correct and is the packet's most valuable finding.
- *From B:* the act-bar unit doctrine (§3), and its two latent-defect findings, both verified and both to be fixed **on their own, byte-identical-off**: `fieldShift` (popField.js:1649-1678) can exit with `need > 0` and silently drop the shortfall, and takes no cascade radius (`FIELD_SHIFT_R = 6` raw tiles, unscaled). Add B's conservation audit — Σ debited − Σ credited ≡ Σ logged deaths, to the person, over a whole run — to the invariant suite.
- *From A:* the correctness line `bornKnow.agriculture = Math.max(bornKnow.agriculture, world.devField[ti])` after the `NATION_TECH_FLOOR` clause (crystallize.js:1338-1343) — a town founded on ground where farming is already practised is not born pre-agricultural. **Honest caveat: under this design it is near-inert** (`stampDevSources` already takes a max, so the field cannot be lowered, and every birth here has a donor). Ship it as correctness, do not claim a feedback loop for it.
- *From A / Judge 2:* the **fraud-control pattern** — run a load-bearing gate disabled, once, labelled, published, never shipped. Adopted as a standing practice (§ validation arm 8).
- *From Judge 1 / lane M:* the flip bar's provenance is broken (the ~218-222 disjoint-disk census is 62% sea-centred; the home continent's honest count is 38). **Report the census channel, never gate on it.**

**Dropped, with the reason:**
- **Design A as a lane.** Its activatable set is measured empty (0 at 6k and 12k), and its own self-critique names the failure mode: an implementer sees zero and reaches for the one knob that makes a number. Worse, A's hard `cellDev ≥ NEOLITHIC_AGRI` gate would have **blocked this design's entire yield** — the new-world labels are founded on ground the wave has not yet reached, from a local hearth donor that carries the package. A's brake is the right brake for *donorless* births; this design has none, so it is not needed and would be actively wrong.
- **Design B as the primary lane.** It is right about the sea and its economics are the best causal story in the packet, but its yield rides on `TREK_LEG` (2.4× swing on a factor-2 error), an undefended `TREK_PACK`, and a 5.3× port-tax waiver — and its crossing half cannot fire inside the 12k battery. Deferred to §7 with a constant-free reformulation.
- **Design C's cell partition and its Class-H quantizer deletion.** Measured relapse (§0d); the sub-catchment partition is deferred as its own lane, and C's projected 6× count is not attempted — Judge 2 is right that six simultaneous re-pricings make every subsequent failure unattributable.

---

## 5. EXACT CODE SITES (HEAD 926381a)

| what | where |
|---|---|
| lever `T.MULTI_HEARTH` (def 0) | tuning.js, beside `EARTH_HEARTHS` (:431) and `LABEL_BIRTH` (:408) |
| pins become a pre-load, not a return | state.js:456-459 (`if (T.EARTH_HEARTHS && …) { … return; }`) |
| `seedEarthHearths` returns its seated list | state.js:403, local `picked` at :406, pushed :440 |
| algorithmic greedy runs with `picked` pre-loaded | state.js:500-511 (unchanged body) |
| `CRADLE_MIN_SEP` → real distance | state.js:333 (def), :502 (use) — `× rNormPop(world)` |
| genesis call site (unchanged) | state.js:102 |
| tier floors → pure percentiles under the lever | settlement.js:56-57 (defs), :3270-3271 (`_townBar`/`_cityBar`) |
| **arm 2:** rank-scaled Class-N exclusion | crystallize.js:337 (`SITE_MERGE_D`), :613 (`const D`), :623 (`for (const c of candN) accept(c)`); Class H at :624 keeps `SITE_MERGE_D * rn` |
| real-scale conversion for the rank radius | `world.worldRef.rivers.km2PerTile`, `tileRes` (riverGen.js:619-626) |
| **arm 3:** act bars in field mass | crystallize.js:798/:1642, :1816/:1844; sea.js:314; read via `labelBasinMass` (crystallize.js:689) |
| A's knowledge floor | crystallize.js:1338-1343, after the `NATION_TECH_FLOOR` loop |
| `fieldShift` returns-taken + cascade radius (standalone fix) | popField.js:1649-1678 |
| persist regime guard — extend the v<5 clause | persist.js:369-371 (`if (data.v < 5) { … if (!("LABEL_BIRTH" in tn)) T.LABEL_BIRTH = 0; }`) → add `MULTI_HEARTH`, `ACT_FIELD_POP`; `SAVE_VERSION = 4` at persist.js:53 |
| **prerequisite bug, belongs to no lane** | crystallize.js:987 (`const nSweep = labelBirth ? siteCand.length : CANDIDATES_PER_SWEEP`) + :998 (`if (f < MIN_FERT) continue`): under `LABEL_BIRTH ≥ 1` the sweep's candidates are ledger sites only, filtered on fertility first, so the rode-away steppe-camp path (:1280-1287 — which needs a **dry, open, low-fertility** candidate) has lost its candidate stream. Confirmed in shipped code by Design A and by Judge 2. Carve out a small random-tile candidate stream for camps (ordu are not markets and have no business on a market ledger) **before the next stylized pass**, or every arm-1 war-density soft will keep being misattributed. |

---

## 6. DETERMINISM · RESOLUTION · PERF · SAVE

- **Determinism.** Cradle seeding is a fixed-order scan (`for ti = 0..N`), a strict sort (`score` desc), and a greedy with a deterministic rejection test — **no rng anywhere** in either the pin path or the scorer. Pre-loading `picked` changes which candidates are rejected, never the order in which they are considered. Arm 2's rank-D is a per-site pure function of `v`; the greedy keeps its strict total order (`v` desc, `x` asc, `y` asc).
- **Resolution invariance.** Two claims, one measured, one predicted-and-gated:
  - *Arm 2 (measured):* 292 / **257** / **268** at 240/480/960, 480↔960 **+4.3%**, against the ±10% bar, with the raw candidate set at +4.1% — the exclusion is transparent to resolution. Class H's residual leak (48 → 61 accepted at 480↔960, +27%) is **pre-existing in the shipped law** (it has it too) and bounded at +5.6% of the union; report it, do not pretend it is new or absent.
  - *Arm 1 (predicted, gated):* with `CRADLE_MIN_SEP` as a real distance, hearth count is a geographic count at an absolute real separation — structurally the same construction that made the ledger invariant. **The battery must measure it and it is a blocking bar** (§validation arm 3). Today, unfixed, it is measured to fail (2 vs 6).
- **Perf.** Measured 9.06 → **14.88 ms/tick** at 480/12k (+64%) for 78 → 139 labels — sub-linear in label count, as expected (the popField/territory passes are O(N), not O(labels)). Must be re-measured at 960 before any default flip; if it exceeds the standing budget, C3 lands first. Cradle seeding itself is one extra O(N) scan at genesis.
- **Save-compat.** No schema change: cradles are seeded at world init only, so a loaded save carries its own settlements and is unaffected. `SAVE_VERSION` stays 4; the persist.js:369-371 regime guard is extended so a v<4 save that stores no delta keeps the lever off if the default ever flips. `devField`/`_devWaveAt` are already persisted and hashed. Arm 2's ledger rebuilds deterministically at load (the shipped v3 contract, proven by `probe_roundtrip_deep`).

---

## 7. WHAT IS DEFERRED, AND THE HONEST STATE OF IT

**C1 is not deferred — it flips on arm 1.** But two real mechanisms are consciously left for the next lane, and I found the constant-free formulation for both, so the next generation does not have to re-derive it:

1. **The maritime lane (the "unreachable" 30% of land, and every island).** Two verified structural bugs, neither of which needs a new constant:
   - `computeTransport` (transport.js:321) prices edges with `baseEdgeCost` (transport.js:309) → `_paramsFor(world, null)` → **zero knowledge** → `water: nav < T.NAV_EMBARK_THRESH ? Infinity` (transport.js:184). **`world.transportDist` is land-only at any development, forever, by construction.** The sweep's connectivity (crystallize.js:1150 → :1202 → :1249 → :1288) reads exactly this map. The fix is to carry each source's own knowledge on the wave and bound water runs by the **excursion budget the realm-admin walk already ships** — `Math.round((1 + NAVAL_HOP_PER_NAV·nav) · resScale)` consecutive water tiles, `NAVAL_HOP_PER_NAV = 7` (countryTerritory.js:94, used :542 and :1359), default ON, resolution-scaled by construction. Zero new constants. Measured reach: B=2 (reached at nav 0.125, ~step 12k) opens 69.8% of land; B=6 opens 99.8%.
   - `params.coast` (transport.js:186), the "coastal hop floor", is applied to coastal **water** at transport.js:234 — one line *after* the open-ocean `Infinity` gate at :232 vetoes it. So the shelf discount is dead code below the embark threshold, and the cost core asserts that no one may cross a channel without ocean-going ships. The repo's **own peopling model contradicts it**: pipeline.js:47-63 prices water as `ANC_OCEAN_STEP · ANC_OCEAN_DEEP^(shoreDist − ANC_HOP_FREE)` — *"coastal hops and narrow straits pass while open oceans don't"* — and that is the model that put people on every continent at genesis. Reconciling the two (shelf water finite, open water nav-gated, discriminated by distance-from-shore, not by a tech flag) is a mechanism repair, not a new mechanism. Note the representation limit it must carry: at 480 one tile is ~133 km, so **every real strait is inflated to ≥133 km of open water** — Gibraltar (14 km) and Sunda (24 km) are sub-tile.
   - `OVERSEAS_INDEPENDENT_RATE = 0.02` (crystallize.js:168, read :1152) is dead code the maritime lane should either revive or delete.
2. **Design B's expedition proper** (provisioned migration, `rations ÷ unforaged route`, thin-out-into-the-field as the dominant outcome). Build it after arm 1, on a 21k battery, with the port tax **kept**, `TREK_LEG` published as a sensitivity curve with the derivation frozen, `TREK_PACK` re-derived or dropped, an O(1) `landComp8`+nav pre-check before spending `findPath`'s node budget (roads.js:1792), and a **global** per-tick probe budget rather than `TREK_CAND` per sponsor.
3. **Design C's residual sub-catchment cell partition** — elegant, probably right, and it arrives bundled with a coastal-attachment risk on 56% of land. Its own lane, after arm 2 has been measured.

**One bar to retire before any of this is scored.** "≥117 labels" is 1.5× a pin of 78 that is itself **one town per ~1.9M km²** of land (9 616 land tiles × ~17 700 km²). Pre-industrial Earth carried thousands of market towns; even 139 is one per ~1.1M km². No honest anchor supports 117 as a ceiling — every honest anchor says the world is still far too empty. This design **clears the standing bar as written** (139 = 1.78×) so the process is not changed under it, but the bar should be re-derived as towns per real land area against a historical anchor before the next lane, and never against the disjoint-disk census, 62% of whose disks are centred on the sea.

## Constants

**NEW CONSTANTS: none. In any arm.**

**LEVERS (all default 0, byte-identical off, repo discipline):**
- `T.MULTI_HEARTH` — 1 = the emergent cradle scorer runs *in addition to* any scenario-pinned hearths (which become a pre-load, not a cap), and `CRADLE_MIN_SEP` is read as a real distance. The deflation guard (tier floors → pure percentiles) rides with it, matching the precedent by which `T.LABEL_BIRTH` re-keys state birth.
- `T.LABEL_BIRTH = 2` — the v3 ledger with a rank-scaled exclusion on Class N. Values 0 and 1 keep their shipped code paths untouched, so the recorded v3 numbers stay bit-reproducible.
- `T.ACT_FIELD_POP` — the act-bar unit correction. Independent of both.

**REUSED, MEANING UNCHANGED:**
- `MAX_CRADLES = 10` (state.js:332) — how many independent agricultural origins a planet has. Real Earth had ~7-11 (Fertile Crescent, China ×2, New Guinea, Mesoamerica, Andes, Amazonia, eastern N. America, West Africa/Sahel, Ethiopia). **Now load-bearing for label supply — flag it in-code as one constant with two consequences**, exactly as Judge 1 required of `WORKS_PRESS`. It was never chosen against a settlement count and must never be moved toward one.
- `CRADLE_MIN_SEP = 60` reference-tiles ≈ 8 000 km (state.js:333) — "far enough that one continent gets at most one or two origins, but separated landmasses each get one if they have a viable site" (its own comment). **Value and meaning untouched; only the UNIT is corrected** (raw tiles → ×`rNormPop`). Measured defect it repairs: 2 hearths at 240 vs 6 at 480.
- The cradle score itself (state.js:474-484): `f*2 + riverBonus + landBarrier*2.5 + tempFit + elevFit − max(0, seaFrac−0.30)*5`, with the warm-valley / fertility / major-river filters. Carneiro circumscription, unchanged, not re-weighted.
- `CATCH_TRIB = 60e3 km²` (riverGen.js:61) — riverGen's own Tributary class boundary and `transport.js:209`'s navigable-river bar. **Contractually immovable**, with the falsification row committed beside it (30e3/15e3/10e3/5e3 lose cross-grid invariance at −16/−22/−25%; at 480 one accumulation unit is 18 468 km², at 240 it is 72 190 — above the bar itself).
- `SHELTER_MIN = 0.30`, `TOWN_BASIN_R = 10`, `T.LABEL_BAR = 360`, `TOWN_FOUND_MIN = 90`, `CRYSTAL_INTERVAL = CLAIM_REFRESH = 24` (a perf cadence), `FRONTIER_EXTEND_DIST = 28`, `NEOLITHIC_AGRI = 0.45` (crystallize.js:872), `NATION_TECH_FLOOR`, `T.ORG_STATE_MIN`, `T.FISC_ADOPT` — all untouched.
- The devField physics: `DEV_WAVE_KMPY = 1.0`, `DEV_WAVE_LOSS_PLANET = 1.0`, `DEV_INIT_YEARS = 6000` (an initial condition, popField.js:376-384), `T.DIFF_CLIM`, `DEV_CLIM_ZONE_REF` — untouched. This design changes only **how many places the wave starts from**.
- `NAVAL_HOP_PER_NAV = 7`, `T.NAV_EMBARK_THRESH = 0.10`, `resScaleFor` — cited for the deferred maritime lane; untouched here.

**DERIVED, arm 2, replacing a fitted length:**
- `Drank(site) = sqrt(commanded_km² / π) / kmPerTile` — the equivalent radius of the catchment the market node already commands, in the world's own `km2PerTile` units (riverGen.js:619-626). **No free coefficient**: √(A/π) is the circular-equivalent radius, geometry, not a dial. Both judges flagged Design C's bare `½`; this removes it (and lands within 13% of it: 0.564 vs 0.5).

**RETIRED, each because it is fitted or vestigial:**
- The **exclusivity of `EARTH_HEARTH_SITES`** (state.js:371-402) — a named-region hard-code whose own comment states an outcome ("so the New World and Australia stay wild"). The *sites* survive as a scenario input; only their status as a cap is retired.
- `SITE_MERGE_D = TOWN_BASIN_R/2` (crystallize.js:337) **on Class N only** — measured to discard 411 of 565 river candidates at 480 by a uniform distance rule. **KEPT on Class H**, because §0d measured that removing or rank-scaling it there leaks resolution (+90% raw, +36% rank-scaled, at 480↔960). The design does not claim to have retired the length everywhere; it retires it where a physical rank exists and says plainly why it cannot on the coast.
- `TIER_TOWN_FLOOR = 60` / `TIER_CITY_FLOOR = 240` (settlement.js:56-57) under `MULTI_HEARTH` — their own comment concedes they are "a documented measured-floor shortcut… not first-principles census minima". Measured to bind at the new census distribution (`_townBar` = 60 vs census p50 43.8).
- The **census reads** in `COLONY_MIN_POP = 200` (crystallize.js:798), `T.COLONY_MIN_POP = 400` (tuning.js:367 → sea.js:314), `PLANT_CAP_MIN_POP = 500` (crystallize.js:1816) under `ACT_FIELD_POP`. The bars survive in field units; what is retired is pricing a demographic act in a partition-share unit that deflates with label supply.

**EXPLICIT NON-CONSTANTS:** no hearth count per continent, no site count, no spacing target, no target label count, no per-region or per-landmass term, no quota, no founding-rate dial, nothing keyed to the 78 pin, the ≥117 bar, or the ~220 disk census. Every count in this document is an **output that was measured**, never an input that was set.

## Validation plan

Same arms and the same bars C1 has been held to for three attempts. **Every prediction below is recorded before the arm runs; a miss is a finding, never a reason to move a bar.**

**1. Byte-identity + smoke (gate).** `probe_hashbase` at 320 and 480 with all three levers at 0 must reproduce `18ad7c15/256a490b` and `3811ccd8/43a9f644`; **and with `LABEL_BIRTH=1, MULTI_HEARTH=0`** the arm must reproduce the shipped v3 numbers — which I have already re-measured on HEAD as the control and which the implementation must match exactly: **78 labels frozen from step 2000, all on one land component, pfTot 8.32M, devLand 37.1%, `_onePopScale` 1.280e-3, census p50 69.1, realms 32, 9.06 ms/tick**. `npm test` green (determinism, invariants, save/load).

**2. `probe_entitysupply` 480×12k, OFF vs ON, 3 seeds (8817/4242/777), `MULTI_HEARTH=1 LABEL_BIRTH=1`.** The flip criterion verbatim: materially exceeds the 78 pin, ≥1.5×, census channel **reported not gated** (lane M: 62% of those disks are sea-centred). **Prediction: 139-150 labels on 8817** — my measured pins-removed arm gives 139 and the shipped design is a superset of hearths — spread over ≥4 land components, farmed-land share 55-62%, realms 45-55. **Falsification: <117, or labels still confined to one component, and the design is dead — do not rescue it by adding hearth sites to a list.** Report label count *per land component* at every 2k checkpoint; acceptance is a FLOW (monotone, no >2× jump in any 2k window), not an endpoint, and report founding/death flow, not just the instant count (lane M measured 258 foundings behind a frozen count of 78 — instant counts hide everything).

**3. HEARTH INVARIANCE — the new blocking arm, and the one I would fail this design on.** `probe_hearthsupply` at 240/480/960 × 2 seeds: hearth count, positions, and the land components they occupy. **Bar: hearth count within ±20% at 480↔960 and ≥80% position match at `CRADLE_MIN_SEP`/2.** Measured today, unfixed, it is 2 at 240 vs 6 at 480 — a real-distance `CRADLE_MIN_SEP` must repair that. **Falsification: if hearth count still tracks grid resolution after the unit fix, the genesis layer is grid-textured and this design has installed a fresh W4 bug at the foundation — reject it outright.** Also publish the *pins-removed* diagnostic row (2/6/…) so nobody re-tries the raw constant.

**4. Resolution, downstream.** `probe_entitysupply` 960×6k, `MULTI_HEARTH=1`: label count within ±20% of 480 **at matched pfTot AND matched hearth count AND matched farmed-land share** — three matched channels, not one, because this design's supply now rides on all three. Re-measure ms/tick at 960 (480 measured 9.06 → 14.88, +64%); if it breaks the standing budget, C3 lands before the default flip.

**5. DEFLATION BATTERY — blocking.** At every ON checkpoint: median/p10/p90 `s.people`; tier composition; `_onePopScale × field-in-catchments ≡ Σ census` residual; and an explicit before/after table for `ARMY_TIER_FRAC × s.people` → garrison strength → storm bars, `SIZE_REF = 1000`, `fortRef` (85th percentile — verify self-calibration, do not re-anchor), `foodHierarchy`'s tier-keyed SHIP_FRAC/haul ranges, `CORE_BY_TIER`/`HINTERLAND_BY_TIER`. **Prediction: census p50 69 → ~44 (measured), a real city and metropolis tier survives once the floors are retired to pure percentiles.** **Falsification: if the urban hierarchy cannot be kept alive at 139 labels without re-anchoring any constant to an outcome, the design is not ready regardless of the label count.**

**6. Stylized, 3 seeds, `MULTI_HEARTH=1`, all hard gates, soft budget 2**, with the standing canaries (8817 market-integration, 31337 clustering at its 0.5 boundary, the Tier-B fish band) and one new, design-specific watch: **the Earth diorama must survive** — the pins are retained, so the Fertile Crescent, Nile, Indus and Yellow River must still be hearths and still be the leading civilisations early. My measured arm removed them and lost 11% of world population (pfTot 8.32M → 7.38M); **prediction with pins retained: pfTot within ±5% of the control.** If it is not, hearth fill is stealing capacity from the Old-World engines and the mechanism needs diagnosis, not a hearth-count cap.

**7. `probe_empires` 480×12k lean, ON.** Realm count rising with label supply (measured 32 → 51 in the pins-removed arm); birth/death FLOW reported; no shatters/confetti; 1-member share on the young-realm trajectory; successor events > 0 after shatters (the R1 payoff). New channel: realms per land component — do the New World realms form and persist, or found and wither?

**8. THE FRAUD CONTROLS — run once, labelled, never shipped.** (a) `MULTI_HEARTH=1` with the tier-floor retirement disabled: expect every label pinned to tier 0/1 and the Zipf gate to fail, proving the retirement is load-bearing rather than cosmetic. (b) `EARTH_HEARTHS=0` alone (the arm I measured): publish it as the design's honest lower bound *and* as the demonstration that hearth placement is doing the work, not some incidental change.

**9. `probe_sitesupply` table unchanged** under `LABEL_BIRTH=1` (the ledger is untouched by arm 1) — and extended under `LABEL_BIRTH=2` with my §0d rows at 240/480/960 × 2 seeds: raw Class N (634/565/588), **raw Class H (147/279/529 — the committed refutation of the quantizer deletion)**, shipped scheme (177/207/205), rank-D-N (292/257/268), rank-D-both (333/361/492, FAIL), no-quantizer (781/844/1117, FAIL). Bars: union 480↔960 within ±10%, position match ≥90%. **The failing rows must be committed with the passing one.**

**10. `probe_roundtrip_deep`** on the ON path (ledger/cell/claim rebuild exact across save→load→save) and the persist.js:369-371 regime guard extended to both new levers.

**11. Prerequisite, blocking arm 6.** The rode-away camp candidate stream (crystallize.js:987/:998) must be restored **before** any stylized pass, with a camp-count/horde/raid canary under arms 0/1/2. Until it is, no war-density soft on a `LABEL_BIRTH ≥ 1` arm can be attributed to anything.

**12. Standalone, byte-identical-off, before any lever amplifies it.** `fieldShift` returns the amount actually taken and accepts a cascade radius (popField.js:1649-1678), with the conservation audit (Σ debited − Σ credited ≡ Σ logged deaths, to the person, over a whole run) added to the invariant suite.

**STOP CONDITIONS I would honour literally:** if arm 3 shows hearth count riding on grid, stop — the foundation is textured. If arm 5 cannot keep a city tier alive without re-anchoring, stop. If arm 6's misses trace to the Earth diorama losing its historical hearths, the pin-retention is not working and the design goes back, not the bar.

## Risks

**1. The one I would bet on: "you changed history, not a mechanism."** This design's yield comes from putting agricultural hearths on continents that today have none. That is precisely how a fitted outcome looks from the outside — *"they wanted New World towns, so they made New World hearths."* My defence is that I did not add a site to a list: I **deleted an early `return`** so the mechanism the codebase itself calls "the real mechanism" (state.js:368) runs where a diorama input was silencing it, and the scorer — with nothing named, nothing about continents in it — put hearths on comps 0, 44 and 66 on its own (§0b). But the defence rests entirely on that: **if an implementer under pressure ever edits `EARTH_HEARTH_SITES` or `MAX_CRADLES` to move a label count, the design has been corrupted into exactly what it claims to repair.** `MAX_CRADLES` is now load-bearing for label supply and sits one keystroke from the flip bar. It must be annotated as such and only ever changed for an argument about how many times humans invented farming.

**2. The Earth diorama moves, and that is the design's real cost.** With the pins retained the four Old-World hearths survive, but the world they radiate into no longer has an empty New World to colonise: sea.js's colony expeditions will arrive at continents that already have realms. The "ungoverned until colonisation" look — an explicit product goal in the code — is *gone by design*. Historically that is the correction (Norte Chico predates the map's 3000 BC start; the Aztecs and Inca were not wilderness), but it is a visible product change, it will move Earth-calibrated stylized canaries, and the owner should decide it with the pictures in hand. Measured cost in the pins-removed arm: pfTot −11%, because the highest-fertility valleys were not seeded; retention should recover it, and arm 6 gates on ±5%.

**3. Census deflation is real, measured, and only half-guarded.** 78 → 139 labels drove census p50 69.1 → 43.8 and put `world._townBar` back on its absolute floor (60). Retiring the floors to pure percentiles is easy and conceded in-code. What is *not* easy is that the same shift re-prices `ARMY_TIER_FRAC × s.people` → garrison strength → storm bars → whether wars resolve, `SIZE_REF`, `foodHierarchy`'s tier-keyed haul ranges, `CORE_BY_TIER`/`HINTERLAND_BY_TIER`, and sack/levy/plague magnitudes — simultaneously. This is a milder version of Design C's reckoning (1.8× rather than 6×), which is why it is buildable at all, but if any of that battery is *tuned back* rather than re-derived, cardinal rule 2 is broken and the design is worth nothing.

**4. Perf: +64% measured, and it lands before C3.** 9.06 → 14.88 ms/tick at 480 for 78 → 139 labels. Sub-linear, affordable at 480, unmeasured at 960 where `rn²` bites the per-entity passes. The C3 perf inversion is the standing risk and this arm arrives ahead of it; the 960 measurement must be an explicit gate at the flip, never assumed.

**5. The hearth-count invariance is predicted, not yet measured.** Arm 1 makes the number of agricultural origins load-bearing for planetary label supply, and today that number is measured to be **grid-dependent** (2 at 240, 6 at 480). The real-distance `CRADLE_MIN_SEP` should fix it by the same construction that made the ledger invariant — but the score field it quantizes (`fert`, `riverMag`, `landBarrier`) is a smoothed worldgen field, and every smoothed worldgen field this repo has measured has carried grid texture (v3 §1a: fert maxima 36/35/**63**). **If the hearth count grows with resolution after the unit fix, this design has moved v2's failure from the siting layer to the genesis layer, where it is worse.** That is why it is a blocking arm with a hard bar, and it is the single thing most likely to kill the design.

**6. Marginal new-world realms may found and wither.** 51 realms measured, up from 32, many of them young and on continents whose development is centuries behind. Expect birth/death churn and a confetti risk — the "hollow husk" and "confetti" scars arriving together. Gate on FLOW, not instant count.

**7. Arm 2's honest asymmetry.** The rank-scaled exclusion retires the spacing constant for the river class and **keeps** it for the coast, because I measured that deleting or rank-scaling it there leaks resolution at +90%/+36%. So the design does not fully deliver "supply is never rationed by a length" — 56% of the map's candidate class is still quantized at half the market horizon. That is an honest partial, and it must be written as one; the market-shed cost partition (C1 §1) remains the mechanism that would retire it properly.

**8. `TOWN_BASIN_R`'s stated meaning does not survive its own arithmetic — a finding I am not fixing here.** One reference tile is ~133 km on a side (`km2PerTile` × `tileRes²`, measured). `TOWN_BASIN_R = 10` ref-tiles is therefore a **1 330 km** "market horizon" and "day's walk" — off by roughly fifty times. A real market catchment (~25 km) is *sub-tile at every grid the product uses*, which is why `T.LABEL_BAR = 360` is inert by ~200× and why "205 of 206 sites clear the bar" says nothing. The horizon is really the granularity at which the sim represents urban places, not a walk. Nothing in this design depends on the false reading, but the constant's comment is wrong and the next lane that leans on it will be misled.

**9. The maritime lane is still open and still needed.** Arm 1 reaches every landmass that can support a hearth; it reaches **nothing** that cannot — small islands, archipelagos, and the polar mass stay dark, and no label can still cross a single water tile at any development. The two structural bugs are located and priced (§7); they are not fixed here, and any future flip that claims maritime history without fixing them is claiming something the code cannot do.

## Open questions

**1. Should the Earth pins be retained at all?** The design retains them (scenario input + emergent fill) because that preserves the Fertile Crescent diorama and, I predict, the world's population level. But the purer reading of cardinal rule 2 is that the scorer should simply run — and my *measured* arm is the pure one (139 labels, five continents, pfTot −11%). Retention is the conservative choice and the one I recommend; the alternative is defensible and should be a recorded owner call, not an engineer's default.

**2. Is `MAX_CRADLES = 10` the right cap, and how do we keep it honest?** It has a genuine independent anchor (~7-11 independent Neolithic origins on Earth) and it was never chosen against a settlement count. But under this design it caps planetary label supply. Options: leave it (recommended, annotated as load-bearing), or replace the cap with pure `CRADLE_MIN_SEP` exclusion so the count falls out of geography alone. The second is purer and untested — it should be measured as a diagnostic arm before anyone touches the first.

**3. Does the cradle scorer need a habitability/population floor?** It picked a hearth on a **4-tile islet** (comp 23, score 1.64 — the low-score tail after the good sites were taken). An islet hearth is a one-label civilisation that will never matter, but it is also 1/6 of the hearths and it is noise in the invariance count. Is the right answer a minimum landmass/population support (a new gate — resisted), or is it simply what the mechanism says and therefore fine?

**4. What is the flip bar, actually?** 78 labels is one town per ~1.9M km²; 139 is one per ~1.1M km². Both are 10-50× sparser than any pre-industrial anchor. "≥1.5× the pin" is a multiple of a known-broken baseline and the alternative in circulation (the ~220 disjoint-disk census) is 62% sea-centred instrument artifact. The bar should be re-derived as towns per real land area against a historical anchor — but that re-derivation would likely say the world needs ~10× more labels than any of these designs supply, which is a Tier-C-wide finding, not a C1 one. Whose call, and when?

**5. Does the maritime lane land before or after C2?** C2 (SEAT_FIELD) needs label density to express, which arm 1 supplies on four continents. The maritime lane supplies islands and archipelagos and unlocks colonial history. Arm 1 makes C2 buildable now; the maritime lane makes the *colonial* half of history possible. My reading is C2 next, maritime after — but the maritime bugs (`transportDist` land-locked at any tech; `OVERSEAS_INDEPENDENT_RATE` dead) are real defects sitting in shipped code today, and leaving known-dead code in place has its own cost.

**6. Should the shelf/open-ocean reconciliation be a bug fix or a lever?** `params.coast` being unreachable below `NAV_EMBARK_THRESH` (transport.js:232-234) reads as an ordering bug, and the repo's own peopling model (pipeline.js:47-63) already asserts the opposite physics. But fixing it changes the cost core that claims, admin reach, armies and trade all route through — a regime change wearing a one-line costume. Lever, almost certainly; but it wants its own design, not a footnote.

**7. `TOWN_BASIN_R`'s comment is wrong (risk 8). Does the horizon want re-deriving, or just re-documenting?** If it is honestly "the granularity at which the sim represents urban places", it should be named that and its relationship to `REGION_SPACING` made explicit — at which point `T.LABEL_BAR = 360`, measured inert by 200×, is also revealed as decorative and should either be re-derived against the cell it actually reads or retired.

**8. Do the New World realms need anything C2 does not already give them?** 51 realms were measured, many young and on late-developing continents. If they churn, is that the honest shape of a frontier (and therefore a finding), or is it the confetti scar in a new costume? Arm 7's flow channels should answer it, but the acceptance criterion for "healthy frontier churn" versus "confetti" is not currently written down anywhere, and this design will be the first to need it.
---

# IMPLEMENTATION ADDENDUM — arm 1 built and measured (branch `tierC/hearth-field`)

**Status: BUILT, default OFF, byte-identical off. Scope = §1 only (`T.MULTI_HEARTH`:
the pin pre-load, the `CRADLE_MIN_SEP` unit correction, the tier-floor deflation
guard). §2 (`LABEL_BIRTH=2`) and §3 (`ACT_FIELD_POP`) are NOT built — the ledger is
byte-untouched and `probe_sitesupply` re-runs identical. New instrument:
`tools/probe_hearthsupply.mjs`; `tools/probe_entitysupply.mjs` gains the
per-land-component / devField / census / flow channels the validation plan asks for.
Every number below was produced on this branch, foreground and serial.**

## The gate — byte-identity and smoke

`probe_hashbase` 320 = **18ad7c15 / 256a490b**, `probe_hash480` = **3811ccd8 /
43a9f644** — the expected pairs, exactly. `npm test` green. The control arm
(`LABEL_BIRTH=1, MULTI_HEARTH=0`, 480/12k/8817) reproduces every recorded v3 number:
**78 labels frozen from step 2000, 1 land component, pfTot 8.32M, devLand 37.1%,
`_onePopScale` 1.280e-3, census p50 69.1, realms 32**; and its disjoint-disk census
reads **225 = sea 140 (62%) + home 38 + overseas 47**, reproducing lane M's T9 to the
tile. The harness is sound.

## Arm 2 — the C1 bar (480/12k, `LABEL_BIRTH=1`)

| channel @12k | OFF 8817 | **ON 8817** | OFF 4242 | **ON 4242** |
|---|---|---|---|---|
| labels | 78 | **131 (×1.68)** | 78 | **129 (×1.65)** |
| land components carrying labels | 1 | **4** (home 78 / 31 / 21 / 1) | 1 | **4** |
| farmed land, devField ≥ 0.45 | 37.1% | **56.2%** | 38.5% | 56.7% |
| realms | 32 | 105 | 37 | 103 |
| field population (pfTot) | 8.32M | 6.36M | 6.35M | — |
| census p50 | 69.1 | 22.2 | 48.6 | 25.3 |
| `_townBar` / `_cityBar` | 69.1 / 240 | 22.2 / 63.7 | — | — |
| ms/tick | 10.01 | 14.57 | 9.54 | — |

**≥1.5× the 78 pin: MET (1.68×/1.65×), on 4 components (bar ≥4).** Label count is
flat from step 2000 with a live founding/death flow underneath it (+251/−120 at 2k,
+68/−68 at 12k), so the trajectory is monotone with no >2× window jump.
**Census channel, reported not gated:** the disjoint-disk census does not move with
the lever (225 → 223) and is **61–62% sea-centred instrument artifact in both arms**;
on-continent it reads home 37 + overseas 50 = **87 land disks against 131 standing
labels**. It was never the supply and this design does not claim it.

## The attribution that matters — the two halves measured apart

Fraud control (a), run once, **never shipped**: `MULTI_HEARTH=1` with the tier-floor
retirement disabled (one-line local edit, reverted; byte-identity re-verified after).

| channel @12k/480/8817 | OFF | **ON, floors KEPT** | **ON, full design** |
|---|---|---|---|
| labels / components | 78 / 1 | 131 / 4 | 131 / 4 |
| farmed land | 37.1% | 58.4% | 56.2% |
| field population | 8.32M | **8.82M (+6.0%)** | 6.36M (−23.6%) |
| census p50 | 69.1 | 49.5 | 22.2 |
| **cities (tier 2)** | 2 | **0** | **22** |
| realms | 32 | 57 | 105 |
| polities ended over 12k | 3 | **3** | **473** |
| shattered / seceded | 0 / 0 | 0 / 1 | 4 / 21 |
| claimed land | 1.2% | 1.7% | 5.2% |

1. **The hearth half delivers the whole supply and costs nothing in churn.** All 131
   labels, all 4 components and all of the farmed-land gain are already present with
   the floors kept; polity turnover is *unchanged* from the control (3 ended, 0
   shattered). Realms 32 → 57 — in line with the 51 the pins-removed arm measured.
2. **Pin retention recovers the population, as predicted.** pfTot **+6.0%** against
   the control where the pins-removed arm lost 11%. The design's ±5% prediction is
   missed by 1 point, in the *favourable* direction; the Old-World engines are not
   being cannibalised. The home component still carries **exactly 78** labels — the
   control's number — and every one of the 53 new labels stands on ground that had
   no farming at all before.
3. **The deflation guard is load-bearing, exactly as claimed — and it is expensive.**
   Fraud control (a) confirms the design's own prediction verbatim: with the floors
   kept, **tier 2 is empty (0 cities)** and every label is pinned to tier 0/1. Retiring
   them restores 22 cities. But the same change drives realms 57 → 105, polity
   turnover 3 → 473, census p50 49.5 → 22.2 and pfTot −28%: a pure rank bar makes
   "town" and "city" fixed *quotas* (50% / 15% of labels at every instant, from step
   2000 in a stone-age world), which promotes labels early, forms states early, and
   fills the map with small low-organisation realms. **§ risk 3 lands harder than
   predicted.** It is written down, not tuned back.

Fraud control (b), `EARTH_HEARTHS=0` alone (the design's own measured arm):
**139 labels, 5 components (77/31/21/9/1), devLand 61.1%, pfTot 7.38M, realms 51,
`_onePopScale` 2.590e-3, census p50 43.8** — the §0a table reproduced to the digit,
including `_townBar` = 60 with p50 43.8 (the floor binding).

## Arm 3 — HEARTH INVARIANCE (the blocking arm): PASS

`probe_hearthsupply` at 240/480/960 × seeds 8817/4242 (identical on both seeds — the
Earth heightmap is seed-invariant; only the sim stochastics differ):

| arm | 240 | 480 | 960 | 480↔960 count | 480↔960 position |
|---|---|---|---|---|---|
| shipped (pins exclusive) | 4 / 1 comp | 4 / 1 | 4 / 1 | +0% | 100% |
| **`MULTI_HEARTH=1` (pins + scorer)** | **7 / 4 comp** | **7 / 4** | **7 / 4** | **+0%** | **100%** |
| diagnostic: pins removed, **RAW-tile** sep | 2 / 2 | 6 / 5 | 10 / 6 | **+67%** | 100% |
| diagnostic: pins removed, real-distance sep | 4 / 4 | 6 / 5 | 4 / 4 | −33% | 100% |

The shipped arm clears both bars (±20% count, ≥80% position) with no margin used.
The **raw-tile row is committed as the refutation**: §0c's 2-at-240 / 6-at-480 defect
reproduces and continues to **10 at 960** — the number of times a planet invented
farming would have tracked the render grid. Two honest riders:

- The unit correction damps the leak but does not by itself remove it: pins-removed
  with a real-distance separation still reads 4 / 6 / 4, because the *low-score tail*
  (the 4-tile islet, the small components) enters and leaves the greedy with grid.
  **What makes the shipped arm invariant is pin retention** — the four pins take the
  top of the greedy, so the three remaining picks are the geographically-forced ones.
  That was not foreseen and it is the strongest argument for retention there is.
- **The pins are exempt from the separation they impose.** Pinned hearths are seated
  under `HEARTH_MIN_SEP_FRAC` (≈800 km) but, once pre-loaded, each projects a
  `CRADLE_MIN_SEP` (≈8 000 km) exclusion disc over the scorer. At 480 the scorer's
  best Australian site (215,81) is 46 tiles from the Yellow-River pin, inside its disc
  — so Australia carries a hearth in the pins-removed arm (5 components) and not in
  the shipped one (4). **Left alone.** Moving `CRADLE_MIN_SEP` to recover Australia
  would be dialling a constant to produce a named region's result — the exact
  violation this design exists to repair.

## Arm 4 — resolution downstream (960/6k ON vs 480/6k ON)

Labels **124 vs 131 = −5.3%** (bar ±20%) ✓, at **matched hearth count (7 = 7)**;
farmed land 41.6% vs 52.3% and pfTot 3.13M vs 3.79M — the two weaker matched
channels, both inside 20%. Components 3 vs 4 (the islet's single label lapses by 4k
at 960). **Perf: 17.92 ms/tick at 960 vs 14.57 at 480, +23%** — the flip's 960
measurement the design demanded is taken and it is cheap; the sub-linear reading
holds.

## Arms 6, 7, 9, 10

- **Stylized, `MULTI_HEARTH=1`, 21k/480, seeds 8817/4242/777: 3/3 pass** (bar ≥2/3).
  All hard gates green on every seed; soft warnings 1 / 1 / 2, all inside budget 2 —
  the standing owner-accepted Zipf canary (−0.21 / −0.23 / −0.17) and, on 777, the
  culture~area soft. 130 / 128 / 122 settlements alive, 115 / 115 / 103 polities.
  **The Earth diorama survives: all four Old-World pins seat and log on every run.**
- **`probe_empires` 12k ON:** realm count rises with label supply (32 → 106) and
  multi-member realms appear for the first time on this arm (3 of 106 vs 0 of 32);
  claimed land 1.2% → 5.2%; 21 secessions and 4 shatters where the control had none.
  **The churn is the guard's, not the hearths' (see the attribution table).** Whether
  473 endings over 12k is honest frontier mortality or confetti is exactly the design's
  own open question 8, and the criterion still is not written down anywhere.
- **`probe_sitesupply`: unchanged, PASS.** 8817 = 177/207/205, union 480↔960 −1.0%,
  position 94.1%; 4242 = 170/205/208, +1.5%, 96.6%. The shipped v3 table byte-for-byte.
- **`probe_roundtrip_deep` on the ON path at 12k: PASS** (8817 34215903 == 34215903,
  31337 3eac56fd == 3eac56fd, kin graph populated). At the probe's 8 000-step default
  **both** the ON path and the untouched default report the pre-existing "kin graph
  empty — raise steps" FAIL; that is not this change.
- **`tools/smoke.mjs` under the lever ON (extra, not a required arm): 1 FAIL.** The
  save/load hash roundtrip is exact and invariant hits are zero; continuation drift is
  pop 1.2% / wealth 1.0% against bars of 10% / 25%. What trips is the check's
  **absolute ±3-country tolerance** on 80 vs 75 realms — a bound that does not scale
  with realm supply (±3 was ~30% relative at 10 realms and is 4% at 80). Reported,
  **not widened**.

## What the owner is actually deciding

**FLIPPED ON 2026-08-03 (owner decision)** — with `TIER_BRANCH=4` supplying the derived tier bar this design's guard analysis asked for, and `BRIDGE_GLOBAL=1` making the dawn census grid-invariant (docs/tier-bar-derivation.md carries the full battery). The paragraph below is the pre-flip record. The lever was default OFF and the flip was not that branch's call. In plain terms, ON:

- **The New World and Australia stop being wilderness.** Agriculture is invented
  independently on the Americas, South America and one small island; they develop
  their own towns and their own realms from step 0. The "ungoverned until
  colonisation" look — an explicit product goal in `EARTH_HEARTH_SITES`' own comment
  — is gone by design, and sea colonisation will arrive at continents that already
  have states. Historically that is the correction; visually it is a different Earth.
- **The Old World is unharmed.** All four pins seat, the home continent carries the
  same 78 labels, and world population is *higher* than the control (+6.0% before the
  guard, −24% after it).
- **The urban hierarchy cannot survive the new label density on its absolute floors**
  — measured, not argued — so the guard rides along; and the guard is what turns a
  quiet 57-realm world into a 105-realm one with 150× the polity turnover. If the
  owner wants the hearths without that, the honest next step is to *derive* a tier bar
  that is neither an absolute census floor nor a fixed rank quota, not to re-anchor
  either one.

**Nothing in `EARTH_HEARTH_SITES`, `MAX_CRADLES` or `CRADLE_MIN_SEP` was edited to move
a count.** `MAX_CRADLES` never binds in the shipped arm (7 of 10 used); the separation
constant does. Both are now annotated in-code as load-bearing for label supply.
