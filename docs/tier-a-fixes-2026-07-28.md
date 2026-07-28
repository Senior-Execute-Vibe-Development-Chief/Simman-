# Tier A — the broken-as-built fix wave (2026-07-28)

Companion to `user-report-diagnosis-2026-07-28.md`. That doc diagnosed twelve
player-reported symptoms; this one records the **Tier A** wave — fixes to
mechanisms that were broken *as built* (inert gates, mis-scaled constants,
double-counts, code contradicting its own documented intent) — plus the
adversarial verification pass over the integrated result and what it caught.
Tier B (mechanism design: successor states, `_sizePopK` re-grounding, land-food
`eraProd` maturity, realm-level colonization, slave-market distance pricing,
tech-power steepening, a second realm-death channel) is deliberately NOT here.

Process: seven implementation agents in isolated worktrees (file-disjoint),
serial integration with smoke between picks, then an adversarial verification
workflow (three review lenses + two integrated re-measurement agents + the
3-seed stylized battery), then a follow-up wave for the two MAJOR findings the
reviewers confirmed. All numbers 480×240 seed 8817 unless noted.

## The seven clusters

1. **Fish — the sea feeds only the need the land leaves unfilled**
   (settlement.js, foodHierarchy.js). The `poor` containment gate was a no-op:
   `FISH_LAND_REF = 8.0` sat ~100× above the per-tile land food it was compared
   against (measured 0.026–0.110 all run), so every coast on the planet read
   land-poor forever and fish ran 84–92% of world food production. The fitted
   constant is deleted; the gate is now the demand gap itself —
   `poor = clamp01(1 − retainedLandFood/foodDemand)` — constant-free, both
   sides emergent same-unit quantities. Fish at step 1500: 77.8% → **0.0%**
   (the early cradles feed entirely from land); at the 21k stylized horizon:
   ~84% → **10.9–27.6%** (seed 8817). `_foodImportRate` is now actually
   written (the panel row was dead), and decays when a settlement leaves the
   hierarchy.
   - Follow-up (review MAJOR): the gate initially read GROSS land production;
     a coastal exporter whose liege levied its grain could read "rich" while
     starving. Re-based on RETAINED food (last tick's `_foodNet`, the same
     basis `_foodSupply` uses) — verified feedback-free (fish never enters
     `_storableSupply`). The feared starvation band measured **zero occupancy**
     at the reference seed (haul losses keep levies small); the fix is the
     correct basis that self-protects where org + haul tech do open the gap.

2. **Territory — the coast is a border; the forest bar keeps to the temperate
   band** (countryTerritory.js). (a) The `STATE_FOREST` founding bar had no
   temperature band, so on warm monsoon land it multiplied with
   `STATE_DISEASE` — the two levers' own descriptions define them as temperate
   vs tropical mechanisms. Now `forest ×= 1 − malariaSignal(t, 1)` (reuses the
   existing tropical-warmth ramp; zero new constants): SE Asia's founding bar
   **11.75× → 3.04×** with 0 of 6714 temperate-band tiles changed. (b) Border
   smoothing required 5 of 8 *land* neighbours with sea abstaining — dead on
   every coastal tile; the bar is now the same majority fraction of the land
   electorate present (`ceil(5·landN/8)`, inland byte-identical). (c) Gap-fill
   required all four cardinal rays to hit realms and a sea-terminated ray read
   as open — coastal no-man's-land never filled; a sea-terminated ray now
   counts as enclosed-by-sea (≥2 rays must still hit actual realms).
   Coastal smoothing flips 123 → 969 per 10k; coastal gap-fills 0 → 2604.
   (d) The diagnosed "colony free-annexation" did NOT reproduce (a planted
   sovereign colony kept its flag through 1500 ticks and 3 direct passes —
   anchors re-stamp seats before derivation); code left alone, note added.
   - Follow-up (review MAJOR): the new coastal gap-fill formed a fill-and-
     revert cycle with the shed/connectivity release (≥77% of fills were
     re-fills; the anti-overextension shed valve was neutralized on coasts —
     compounding diagnosis #6). Fixed with two ledger rules, no new constants:
     a released-by mask (cartography refuses to hand a tile straight back to
     the realm that shed it this pass) and fill headroom (cartographic fills
     charge the same capacity ledger as growth). Churn **~35× down**; the
     worst over-target coastal realm now genuinely recedes (held tracks its
     falling target 52→31 over 8k steps); claimed land and realm count intact.

3. **Dev wave — the technique wave reads climate at the zone scale, not the
   wiggle** (popField.js). The `DIFF_CLIM` toll summed per-hop |Δclimate| —
   total variation, not the net climate distance its comment claimed — so
   climatically textured SE Asia overpaid massively (and the toll was
   resolution-dependent: 3.6× at tw=480 vs tw=240) while the uniform Sahara
   crossed easily. The toll now reads land-only box-smoothed climate at
   `DEV_CLIM_ZONE_REF = 2` reference tiles (~330 km — the scale at which a
   farming package must genuinely re-adapt; × rNormPop). Genesis SE Asia wave
   ×2.7; transect tolls near resolution-invariant; the Sahara got *harder*
   (0.394 → 0.356 — its gradient is zone-scale and survives smoothing);
   tech~cradle-distance correlation preserved (−0.529 → −0.537).

4. **Slavery — the market prices its own demand; the ledger meters the take**
   (slavery.js, money.js, WorldSim.jsx, chronicle.js). `buildScarcity` backed
   cash demand at the BASE price while clearing charged the marked-up price —
   up to 4× phantom demand, pinning the multiplier at cap permanently
   (measured r = 44.4 at clearing). Demand is now backed at each market's
   lagged clearing price: **r 44.4 → 3.5, the cap pin gone**. Slave income is
   metered over the pass interval (the army-wage pattern) instead of booking
   50 ticks in one EMA lump (display read up to 2.5× true rate); the
   archetype label chain no longer checks "Slaver city" first (one basis, 25%
   income minimum); the chronicle slaver bar aligns with the entrepôt's. The
   false "bounded by military reach/logistics" comment now tells the truth.
   Honest residual: top-3 realm count barely moved (~17/46 window mean) — the
   near-empty ranking taxonomy (crafts bundled into IN_GOODS) is the Tier-B
   remainder, as the diagnosis said.

5. **Conquest — the slave society pays in politics; the colony keeps its
   metropole and its reach** (conquest.js, tuning.js). (a) The coerced-labor
   design doc's political unrest term existed nowhere; now
   `gSlave = SLAVE_UNREST_W(0.6) × unfree share` joins the realm unrest sum
   (a wholly-enslaved settlement seethes at 60% of total-famine intensity;
   distinct from the pre-existing local estate-revolt roll). Measured: a
   plantation belt's unrest 0.030 → 0.052 standing pressure; no world melt;
   byte-identical at `SLAVE_UNREST_W=0`. (b) The colony `_overlordCC` marker
   was consumed unconditionally at the first polity pass — a voyage racing a
   founder-realm change orphaned the colony forever; it is now retried while
   pending and dropped only when the founder polity is recorded ENDED.
   (c) `navalReach` was raw tiles against res-scaled distances — at the
   shipped grid a colony sat at ~⅓ its tuned projection (starved supply,
   early independence). Now res-scaled like holdReach, both arms of the
   sea/land comparison consistent; byte-identical at the 240 reference
   (probe-hash proven).

6. **Roads — the horizon caps the road as walked** (roads.js). The segment
   cap bounded only the Euclidean endpoint distance; painted A* routes wound
   up to 6× longer, and the ungated kin-path pass never consulted the cap at
   all. Both passes now reject routes whose WALKED length exceeds the
   builder's horizon × `PATH_WINDING_MAX = 1.5`; longest painted early path
   **63.7–72.6 → 17.6 ref-tiles (−76%)**. The known disconnection trap is
   closed by a relay guard (a singleton-component settlement may keep its
   single least-winding link — rare, 9 builds by 8k, separately tallied).
   Telemetry now records walked path length (`maxBuildPathLen`).

7. **Sea — a port surveys the same real coastline at any grid** (sea.js).
   Colony shore candidates deduplicate by land tile (was up to 4× duplication
   on crenellated coasts) and the 400-tile budget scales × rNormPop
   (coastline is 1-D) — at the shipped tw=960 the old raw budget covered ~¼
   the real coastline its exclusion radius assumed, locking dense realms out
   of colonization entirely. Byte-identical at the 240 reference (candidate
   hash + full state hash proven); at tw=480 the cap-saturated port-passes
   fall 13 → 0 and unique surveyed sites rise 2.5× at the worst port.

Integration extras: the panel's food Balance line no longer double-counts
imports; the dead global `identityWeightsNow` is removed; `gSlave`/`gSerf`
carry their own "servile unrest" cause label; `_overlordCC` joined the
settlement determinism hash; two overstated comments corrected.

## Verification (adversarial, on the integrated branch)

Three review lenses + two integrated re-measurement agents + the battery.
Both measurement agents: **faithful integration** — every per-fix signature
reproduces (fish 0.0/15.6 at 1500/3000 exact; winding cap binds identically;
slave metering flat; SE Asia bar and coastal cartography exact). The reviews
produced 4 MAJOR findings: two were fixed in the follow-up wave (retained-food
basis; gap-fill churn — above); two are **recorded Tier-B constraints**:

- `TIER_SCALE_REF = 29000` is calibrated to the phantom-fish population scale:
  in the honest-food world the relative city-tier bar sits at its 0.4 floor
  all run (fixed absolute bars). Re-derive or replace with a percentile-
  anchored bar WHEN the land-food fix lands.
- The fish gate is bistable in practice (settlements split ~fish-less inland
  vs 90%+ fish ports; the proportional middle band is nearly empty) because
  pre-modern land food never matures (`eraProd = 1 + 260·agri⁶·devGate` stays
  ~1 for the whole early run). **Coupled constraint: the Tier-B eraProd fix
  and a reachability re-check of COLONY_MIN_POP / TIER_THRESHOLD must ship
  together** — today the upper urban hierarchy is fish-fed, and cutting the
  residual fish without maturing land food would strand every bar above ~150
  people.

MINOR findings (relay guard unbounded by design — separately audited; slave
market still honestly cap-pinned very early when captive stock ≈ 0; corridor-
tile smoothing flicker; cobweb convergence slower than first commented) are
recorded in the review transcripts and the comments now tell the truth.

## Validation

- `npm test` green at every integration step (determinism, invariants,
  save/load roundtrip identity, functional resume, dissolve suite).
- Stylized battery on the integrated pre-follow-up branch: **3/3 seeds, all
  hard gates, soft warnings 2/1/0 (budget 2)** — and the two chronic
  pre-change warnings (growth-acceleration, water-clustering) are GONE.
- Final battery on the assembled HEAD (with both follow-up fixes): 8817 and
  4242 pass (2 warnings each); seed 777's re-rolled trajectory trips 3 soft
  warnings — two count-sensitive war statistics (12–17 wars reckoned) plus
  the new fish gate itself; see the calibration note below.
- **New standing gate:** `stylized.mjs` now scores world fish share of food
  supply (the R5 blind spot — the original 6% → 84% regression shipped with
  every gate green because nothing watched food composition).

### Fish-gate calibration (pre-Tier-B band)

PLACEHOLDER — filled from the 5-seed evidence below.

## Residuals going into Tier B

The diagnosis's Tier-B list stands, now with three additions from this wave's
verification: the eraProd/tier-bar coupled constraint (above), the war-count
sensitivity of the deadliness/succession soft gates in the post-fix regime
(12–17 wars reckoned per 21k run vs ~42 before — watch, and re-derive the
bands if the quieter war regime is the honest one), and the unscored
empire-mortality context (back-half top-3 union 6–11 realms, 0 secessions on
all seeds) confirming that diagnosis #1/#6 (successor-blind shrink, thin
death channels) remain THE structural Tier-B target.
