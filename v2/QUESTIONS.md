# M0 questions log

M0 records unresolved specification choices here instead of turning them into
simulation assumptions.

1. `spec/02-architecture.md` describes dev and target grids but does not give
   exact dimensions. M0 uses `240×120` for `dev` and `960×480` for `target`,
   matching the documented simulation-width conventions in the research notes.
   Please confirm the dimensions and whether width/height refer to simulation
   cells or render pixels before the first terrain field lands.
2. The M0 math contract gives an approximate accuracy and cross-engine
   requirement, but no required approximation family or complete input domain.
   M0 uses explicit range reduction and Taylor/atanh series. The coefficients
   are implementation scaffolding, not physical constants, and should be
   replaced or ratified if a later gate requires a different domain.
3. The WASM bootstrap specifies one deterministic Dijkstra function and a
   hardcoded test graph but does not specify the graph topology or expected
   distances. M0 uses a five-node graph with distances `[0, 2, 3, 4, 6]`;
   this is a toolchain fixture only and must not become routing physics.
---

## Review answers (2026-08-31, spec-session review)

1. **Grid dimensions**: width/height are SIMULATION CELLS, never render
   pixels. `dev` 240×120 is confirmed. `target` 960×480 is accepted as an
   M0 stand-in only: per spec/02 the target grid is 10–20 km, so at M1 —
   when real fields land — `target` becomes **1800×900** (~22 km at the
   equator) and all bench baselines are re-set there. Planned, not silent.
   Related M1 note: the per-write conservation attribution (a function
   call per cell per pass; measured 6.2 ms/tick for ONE trivial field at
   460k cells) must become per-pass aggregated accounting before real
   field counts arrive.
2. **dmath coefficients**: ratified as implementation scaffolding — they
   are representation, not physical constants, and stay OUT of the
   spec/09 world-constants ledger. The bit-golden suite is the binding
   contract; any domain/accuracy revision changes coefficients and
   goldens together in one commit.
3. **Wasm fixture graph**: ratified as a toolchain fixture only; it is
   deleted when the real CRP routing engine lands at M1.

## M1 findings

4. M1 adopts the ratified target grid of `1800×900` simulation cells. The
   copied v1 supplier is sampled at that grid and the substrate owns monthly
   arrays (`cell × 12`); v1 exposes annual temperature/moisture plus seasonal
   amplitude rather than twelve monthly fields, so the adapter expands those
   seasonal fields into monthly values. This is marked `M1-PLACEHOLDER` in
   `substrate.ts` and should be replaced by a directly supplied monthly
   observation/solver contract if the M1 climate review requires it.
5. The M1 Rust API implements the ratified three phases and the layered,
   directed graph, with deterministic Dijkstra workspaces behind the API.
   Nested partition labels are present, but shortcut customization is not
   yet materially faster than the baseline at this milestone; a later CRP
   optimization must remain invisible to the TypeScript caller.
6. The initial target-grid measurements miss the provisional `≤5 ms` point
   query and `≤500 ms` full distance-map budgets on the current Earth
   substrate. Query early termination and pooled workspaces are in place;
   the measured values remain in `bench-baselines.json` and are a performance
   finding, not a relaxed gate.
7. The first travel reality run at seed `42042` exposes real cross-grid
   findings: several long ORBIS routes differ by 12–50% between `dev` and
   `target`, and the coarse raster can lose a land or sea connection. The
   gate remains hard and reports these rows rather than adding route-specific
   corrections; the correct next change is a resolution-invariant topology
   mechanism.
8. The same first gate run passes the fixed freight and daily-speed anchors
   and now produces a measurable Indian Ocean seasonal difference from the
   observed monthly climate. Several ORBIS route rows remain outside their
   25% bands, so `npm run gate` exits nonzero as an explicit M1 calibration
   finding; expected values and route factors were not changed to make this
   first substrate pass.

---

## Review answers (2026-09-01, spec-session review)

4. **Monthly climate contract — resolved, the placeholder is retired for
   Earth worlds.** The observed NCEP monthly climatology (already in
   `data/reality/`) is now sampled directly: each cell's months are the
   sim's own annual fields (keeping worldgen's lapse/orography detail)
   plus the observed monthly anomaly — additive °C for temperature,
   mean-preserving precipitation ratio for moisture. The substrate also
   exposes **monthly wind** (u/v, m/s) — the hemisphere-sine synthesis
   could never carry a monsoon and survives only as the procedural-preset
   fallback, still marked `M1-PLACEHOLDER`.
5. **Accepted.** The three-phase API + layered directed graph stand; CRP
   shortcut customization stays future work behind the same caller
   contract. The engine gained real per-edge geometry in review (per-row
   cos-latitude east–west lengths, precomputed diagonals) — the previous
   per-cell average distorted real km by up to ±20% at mid-latitudes.
6. **Still missed, values updated.** After the physics fixes the target
   grid measures ~47 s substrate, 1.9 s init, 1.7 s customize, 2.4 s
   query, 2.6 s distance-map (the substrate grew honestly: real monthly
   climate + wind sampling). Baselines re-set with headroom; the 5 ms /
   500 ms working targets remain open CRP work, not a widened gate.
7. **Ratcheted into `data/reality/known-misses.json`.** Cross-grid parity
   misses (and dev-only route misses on routes that pass at the shipped
   grid) are acknowledged there as dev-raster geometry, each with its
   reason — including dev land-bridging the Channel. The gate now fails
   on any UNEXPECTED failure and on any STALE manifest entry, so the
   list can only shrink honestly.
8. **The gate now passes with 21 acknowledged misses.** Review replaced
   the constant-echo checks with engine-measured ones (foot/ride speed
   and the 1:5:28 freight ratio on reference terrain, the 3000-km-sea ≡
   ~107-km-land grain-shed anchor) and made the monsoon check
   directional. The remaining acknowledged misses are one physical
   story: land routes run ~2× ORBIS without road/relay infrastructure
   (the neutral slot fills at M7), plus dev-raster geometry per (7).

Review corrections to the M1 build (all validated before merge):

- **`datan2` was mathematically wrong** (artanh series pasted where the
  alternating arctan series belongs — `datan2(1,2)` returned 0.092 for
  0.464). Rewritten with tan(π/8) range reduction; five bit-goldens
  added (the golden suite now covers 26 values). The oracle confirms the
  worldgen fields it feeds now sit within 2e-6 of v1.
- **The sea "monsoon storm" tax removed**: `|moisture−0.4|×6` slowed all
  tropical sea travel ~2.9× in both directions year-round. Replaced by
  the wind-alignment mechanism (`WIND_GAIN`/`WIND_REF_MS`) reading the
  observed monthly wind per directed edge — Calicut→Aden now measures
  39.6 days against the SW monsoon vs 24.9 with the NE, from data.
- **`baseEdgeCost` coast term** was a `min()` clamp (every coast ≤0.8
  regardless of terrain); restored to v1's multiplicative 0.8.
- **River per-magnitude speed discount removed** (no grounding; it made
  great rivers 112 km/day highways and broke the emergent freight ratio).
- **Oracle hardened**: the `annualMoisture` tolerance assert was dead
  (the field sat in the cleanup-exemption list); now live, with a
  scale-floored error metric and a justified 5e-4 bar for f32 iterative
  solver fields (measured drift 1.8e-7 absolute).
- Fixture corrections from sources: Rome→London gains the Channel boat
  crossing (land-only Britain is honestly unreachable) and cites ORBIS's
  ~27-day figure; Athens→Corinth 8→3 days (transcription), target-only
  (below dev resolution); the Calicut⇄Aden expectations follow the
  monsoon direction; London→Bordeaux is the coastal wine run (no
  open-sea Biscay shortcut).
- Duplicate/unused constants deleted; dead `mapImport.js` removed; the
  shell now draws the route path; bench times the placeholder tick
  again; wind sampling bulk-indexed (~10 s off the target substrate).
