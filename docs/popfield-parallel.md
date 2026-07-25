# Worker-parallel stepPopField — design (W6-G perf arc, mission 3)

**Status: SHIPPED (Stages A + B, 2026-07-25) — identity contracts met, perf
partial (§0.4 status, §8.4 headroom); browser leg pending.**
Owner decision 2026-07-25: **960×480 tiles (the "1920" build) is the product
resolution.** That makes the population field the sim's #1 cost worth
engineering: `stepPopField` is the largest single function in every mature-era
profile — 19.7–20.5 ms/tick self on the fresh 30k/1920 snapshot (Renaissance,
155 settlements; measured twice, `--cpu-prof` and phase brackets, quiet
machine), 43–45 ms/tick on the prior session's deeper-maturity snapshots. The
cost grows with maturity (spikes, owners, works), i.e. exactly when the player
is most invested. Everything below is designed against the project's QA
bedrock: **the parallel field must be bit-identical to today's serial field,
at any worker count, on every platform we ship.** No GPU — GPU floats are not
bit-reproducible across devices, and the hash-based QA (probe_hashbase, the
battery fingerprints, save/load roundtrips) is worth more than any speedup.

## 0. The contract (what "done" means)

1. `T.POP_FIELD_WORKERS = 0` (default) runs literally today's code path —
   byte-identical, no SAB, no workers, nothing to prove.
2. `T.POP_FIELD_WORKERS = N > 0` produces a **bit-identical trajectory to
   N = 0** — same `probe_hashbase` pair, same full-serialize sha256 — for
   every N, on node and in the browser. Not "deterministic per N":
   **identical across N**. Worker count is a wall-clock dial, never a seed.
3. All existing gates stay green untouched: hashbase `4dbe3ec3`/`fe5627fe`
   (2500 × seeds 8817/31337), reference-grid byte-identity, smoke, validate,
   save/load roundtrip.
4. Perf target (the reason to bother): ≥ 1.8× on the pass at 4 workers on the
   30k/1920 snapshot (Amdahl bound ~2.3× — see §2), i.e. ~20.5 → ≤ 11 ms/tick
   at Renaissance maturity, proportionally more at Modern.
   **STATUS 2026-07-25: 1.2× shipped (sound barrier); the gap is §8.4's
   band-balance + wake-latency headroom — contracts 1-3 are all met.**

## 1. Why this pass, and why it CAN be exact

`stepPopField` (popField.js) is uniquely suited among the mature-era rocks:

- **It is RNG-free.** `grep -nE "rand|rng|Math.random"` over popField.js: zero
  hits in the pass (verified 2026-07-25). No draw-order to preserve — the
  entire bit-determinism problem reduces to floating-point **operation
  order**, which we can fix by construction.
- **It is per-tile local.** Growth and capacity are pure per-tile maps;
  migration is a 4-neighbour stencil, already double-buffered
  (`pop` → `_popNext`, swap per substep) precisely "→ deterministic" (the
  code's own comment). Neighbour reads come from the immutable previous
  buffer; there are no long-range dependencies inside a firing.
- **Its inputs are frozen during the firing.** The settlement-side values it
  reads (leadAgri, `_indCap`/`_indGate`, `_k`/`_foodNet`/`_landFood`, urban
  spikes) are written by earlier passes in the tick; nothing else runs
  concurrently with the field inside `stepPeopleSim`.

By contrast the other rocks are closed or blocked: settlements = I82 (closed,
integration arithmetic), the polity/territory Dijkstras have per-tick-drifting
inputs and global frontier competition (audited 2026-07-25, roadmap W6-G
item 4).

## 2. Anatomy of one firing (measured phase split)

Phase brackets over 600 firings on the 30k/1920 snapshot (temporary
instrumentation, reverted; total 20.5 ms/firing):

| # | phase | ms/firing | share | dependency class |
|---|-------|-----------|-------|------------------|
| 1 | setup: leadAgri scan, DEV_FIELD wave upkeep | 0.26 | 1.3% | serial (cheap) |
| 2 | capacity loop (fert × technique × access × relief × works) | 4.33 | 21.2% | **pure per-tile** |
| 3 | FOOD_K ledger blend (per-owner ΣW, then per-tile rewrite) | 4.75 | 23.3% | serial in v1 (order-sensitive reduction) |
| 4 | urban spikes + ONE_POP activation seed + corePre save | ~0 | — | serial (tiny Maps) |
| 5 | logistic growth (+ core re-integration) | 1.50 | 7.4% | **pure per-tile** (cores: tiny serial tail) |
| 6 | migration substeps (4-neighbour stencil, double-buffered) | 8.06 | 39.5% | **stencil — the crux, see §3** |
| 7 | LAND_WORKS build/rot | 1.58 | 7.7% | **pure per-tile** |

Parallelizable share ≈ 76% → Amdahl at 4 workers ≈ 2.3× for the pass. At
current defaults the migration loop runs **nSub = 1 substep per firing**
(migT = POP_MIGRATE 0.01 × dt 1 × rn² 16 = 0.16 < MIG_SHARE_MAX 0.5;
measured nSubSum = 600 over 600 firings), so a firing needs only ~5 worker
barriers (cap / growth / per-substep mig / works). Sub-stepping grows only
with POP_FIELD_STRIDE (stride 8 → dt 8 → migT 1.28 → 3 substeps): barrier
count stays single-digit per firing in every configuration we ship.

FOOD_K (23%) stays serial in v1 **on principle, not laziness**: its ΣW pass
accumulates `sumW[sid] += cap[i]` in ascending-land-tile order — float sums
whose grouping IS the bits. Parallel per-band partials would re-associate the
adds; that is a different (still deterministic, but different) trajectory —
i.e. a product change needing full re-validation, exactly the I82 class. If
v2 wants it, the honest route is a serial refactor FIRST (band-blocked fold
order, hashbase re-keyed, full validate), then banding falls out. Out of
scope here.

## 3. The migration lemma (the one real proof obligation)

Today's inner loop is a **scatter**: visiting source tiles `i` in ascending
land order, it does `nxt[i] -= move` and `nxt[nbr] += move·share(d)` into a
Float32 buffer, after `nxt.set(pop)`. Each `+=`/`-=` loads f32, adds in f64,
rounds to f32 on store — so a target's final bits depend on the ORDER its
contributions arrive, which today is the order its contributing sources are
visited.

Reformulate as an **index-ordered gather**. For target `j`, the serial ops on
`nxt[j]` are, in order of source visit: contributions from sources
`i ∈ {j−tw, west(j), j, east(j), j+tw}` (those that migrate), each applied
when `i` is visited — i.e. **sorted by source tile index** (with x-wrap,
west(j) may have a HIGHER index than j and east(j) a lower one, so sort by
actual index, never by direction). A gather that computes the same five
candidate contributions and applies them to `nxt[j]` in ascending source
index performs the **identical IEEE op sequence** on the identical starting
value — bit-equality is by construction, not by test. (Tests still run; see
§6.)

Two-pass shape so outflow work isn't recomputed 5×:

- **Pass 6a (pure per-tile):** for each source `i`, compute and store its
  outflow record — `move` and the four `move·share(d)` — into preallocated
  scratch (5 × Float64Array(N), SAB): reads only `pop`/`cap` (previous
  buffer), writes only slot `i`. Bandable.
- **Pass 6b (pure per-target):** `nxt[j] = pop[j]`, then apply the ≤5
  incident records in ascending source-index order (a fixed 5-way index sort;
  wrap columns handled by comparison). Reads records + pop, writes only
  `nxt[j]`. Bandable.

The share weights themselves (`spare/sumSpare`) are computed today in f64
from `cap`/`pop` reads — pass 6a reproduces them with the same expressions in
the same per-source order. `nxt.set(pop)` becomes each band setting its own
range. Buffer swap stays on the coordinator.

**Stage A ships this gather SERIALLY first** and must reproduce
`4dbe3ec3`/`fe5627fe` plus the reference-grid pair. That gate catches any
error in the lemma (wrap ordering, f32 rounding points) while the code is
still single-threaded and debuggable. Only then does banding land — and
banding a gather is trivially order-free: every target's op sequence is fixed
regardless of which worker executes it.

## 4. Execution model

- **Banding:** contiguous ranges of the static ascending `land[]` list, split
  by equal land-tile count into N bands (row-contiguous automatically; no
  row alignment needed — gathers only read neighbours, they never write
  outside their own targets). Bands are a pure function of (world, N); N
  changes wall-clock scheduling, never results (§0.2).
- **Memory:** an SAB arena allocated when the lever first goes >0:
  `popField`, `capField`, `_popNext`, the 5 outflow arrays, plus read-only
  mirrors of the static inputs the loops touch (`elev fert riverMag relief
  coast temp moist tArrival` slices, `land[]`) and the live layers (`devF`,
  `_tfFade`, `worksField`, `_tropicBurden`, `_pastureCap`, `_irrigable`).
  Typed-array views over SAB behave identically for persist/hash (same
  reads), so serialization code does not change. Per-owner scalars used in
  the capacity loop (`_indCap`, `_indGate`) are packed each firing by the
  coordinator into a dense sid-remapped table (two Float64Arrays + an
  Int32 remap) — Maps don't cross threads, and the pack is O(settlements).
- **Sync:** persistent workers (spawned once per world), one
  `Int32Array(SAB)` barrier via `Atomics.wait/notify`; coordinator posts a
  tiny per-firing header (dt, migShare, nSub, lever values, table lengths).
  ~5 barriers/firing (§2) at ~µs each vs a 20 ms pass: noise. Workers run
  zero-alloc after warmup (everything preallocated in the arena).
  **The barrier must be EPOCH-STAMPED, never counted** (learned the hard
  way, §5): worker k stamps its own ctrl slot with the phase seq it just
  ran; the coordinator waits for all slots == current seq. A shared done
  COUNTER is wake-anomaly-fragile — the first implementation intermittently
  double-counted (measured `C_DONE 4 > 3`) and, worse, silently corrupted
  runs when the anomaly hit the in-place phases (three different hashes from
  three identical runs). Stamps are idempotent under duplicate wakes, stale
  threads stamp old epochs (ignored), and a worker that observes a seq it
  cannot replay stamps POISON → dispose → throw. Each pool also owns a
  FRESH ctrl/hdr SAB pair, so threads of a disposed pool can never touch a
  successor's barrier regardless of termination latency. Verified: 5/5
  correct hashes under deliberate CPU contention where the counter version
  failed 2/3.
- **Phase order preserved exactly** as today: setup → [cap ∥] → FOOD_K →
  spikes/seed/corePre → [growth ∥] → core re-integrate → per-substep
  ([6a ∥] barrier [6b ∥] barrier, swap) → [works ∥] → publish.
- **Node:** `worker_threads`, available everywhere the QA runs (batteries,
  probes, smoke). **Browser:** the sim already lives in a Web Worker; band
  workers are nested workers + SAB, which require cross-origin isolation
  (COOP/COEP — vite dev/preview config + hosting headers). Where
  `crossOriginIsolated` is false, the lever silently resolves to 0 — results
  are identical either way (§0.2), only wall-clock differs, so the fallback
  is invisible to QA. Safari's nested-worker/SAB support must be smoke-tested
  before the browser default ever flips (node-side value is independent).

## 5. Lever & rollout

`T.POP_FIELD_WORKERS` (runtime lever, default **0**): 0 = today's serial
scatter, byte-path untouched (contract §0.1 kept literally — the scatter is
not rewritten); **1 = the index-ordered gather on the sim thread** (the
serially-testable Stage-A config, and the form banding requires); ≥2 = N band
workers (until Stage B lands, resolves to the one-thread gather). Ship order:

1. **Stage A — SHIPPED 2026-07-25**: the gather substep behind lever ≥1, plus
   `tools/probe_popfield_par.mjs` (cross-lever identity: hashWorld + sha256 of
   both field buffers, genesis 2500×2-seeds and 30k/1920-snapshot 200-tick
   modes). Gates: snapshot L0≡L1 (hash 5bc2cc6c, fields byte-equal — the
   rn=4 wrap/spike/FOOD_K/works paths), genesis L0≡L1 with L1 reproducing the
   canonical hashbase pair, smoke, validate.
2. **Stage B — SHIPPED 2026-07-25**: the SAB arena + persistent worker pool
   (popFieldPool.js / popFieldWorker.js), banding capacity, growth, both
   migration passes and works across `lever` bands (coordinator computes band
   0; workers 1..N−1). **Measured on the 30k/1920 snapshot, 600 ticks, 4-core
   container, with the SOUND (epoch-stamped) barrier, bit-identical output:**
   settlements bracket 38.3 → 34.7 ms/tick (−9%), whole tick 70.9 → 69.1
   (−3%); band sweep L2/L3/L4 = 35.5/36.2/34.7 (4 bands best). The field
   pass itself ≈20.5 → ≈17 ms — **1.2×, short of the §0.4 ≥1.8× target;
   recorded honestly as PARTIAL.** (An earlier build measured 31.4/−18% —
   on the racy counted barrier, i.e. an unsound number; it is NOT the
   baseline for future work.) The shortfall is attributable and listed as
   headroom in §8.4: worker wake latency on 1–4 ms phases (5 barriers ×
   2 wakes/firing) and land-count-equal bands not being work-equal. The
   lever ships default 0 either way. Identity: snapshot 200-tick
   L0=L1=L2=L4 (hash 5bc2cc6c, fields byte-equal), genesis 2500×2-seeds
   L0=L4 = the canonical hashbase pair, and 5/5 correct hashes under
   deliberate CPU contention (where the counter barrier failed 2/3).
   Three findings future work must respect:
   - **Synchronous drivers never run the event loop** (probes/batteries/the
     profiler step in one sync block), so pool SPAWN uses
     `process.getBuiltinModule` (no await) and READINESS rides a ctrl-SAB
     Atomics counter — a postMessage-based ready flag left the pool in
     fallback for an entire window (measured: zero speedup, silently). For
     the same reason `awaitPhase` carries a wall-clock timeout: a worker
     crash mid-phase can't fire its 'error' event mid-window, and growth/
     works are in-place (non-idempotent), so the only honest outcome is
     dispose + THROW, never a silent partial phase.
   - **popField/_popNext are a swap pair over two fixed SABs** — the publish
     re-points the KEYS every firing, so arena identity is the unordered
     pair {popA, popB} + parity, never key→buffer (keying them respawned
     the pool every tick).
   - **loadWorld restores the SAVE's tuning** (persist.js resets + applies
     saved non-defaults), silently clobbering pre-load lever overrides —
     snapshot-based lever A/Bs must re-apply AFTER load (probe_popfield_par
     and profile_window now do; _harness exports SIM_TUNE_OVERRIDES). This
     ALSO made the first "identity across levers" snapshot run vacuous
     (every leg silently ran lever 0 and of course matched) — a gate that
     passes must be checked for whether it MEASURED anything.
   - **Counted barriers corrupt silently; epoch-stamped barriers fail loudly
     or not at all** (§4 Sync). The counter version passed a 2500-tick
     interleaved bisect and still produced three different hashes from three
     identical runs under contention — wake anomalies are too rare to catch
     by staring and too frequent to ship. The genesis identity gate (a seed
     the snapshot gate didn't cover) is what caught it; keep BOTH horizons
     in the probe forever.
3. **Battery** — full gate set (§6) + perf A/B; only then discuss flipping
   the node-side default for the heavy tools (batteries run 4-core
   containers) and, separately and later, the browser default.

## 6. Proof battery (all must pass before any default moves)

- `probe_hashbase 2500` (or the probe below's genesis mode) with the gather
  FORCED ON (`SIM_TUNE="POP_FIELD_WORKERS=1"`): `4dbe3ec3`/`fe5627fe`
  unchanged — the lemma's gate. Lever 0 is the untouched scatter and holds
  trivially.
- **New `tools/probe_popfield_par.mjs`:** same build, same seed, run K steps
  with WORKERS ∈ {0, 2, 3, 4} → `hashWorld` AND full-serialize sha256 must be
  identical across the set. Two horizons: 2500 steps from genesis at 320
  (cheap, covers activation/seed paths) and 200 ticks resumed from the
  30k/1920 snapshot (covers spikes, FOOD_K, works, industrial fade at
  maturity). Bit-diff `popField`/`capField` buffers directly on mismatch so a
  failure names the first divergent tile.
- Smoke (includes determinism + save/load) and 3-seed validate, lever 0 and
  lever 4.
- Perf A/B via `tools/profile_window.mjs` on the 30k snapshot: pass mean,
  tick mean, and the barrier overhead visible in the gap between them.

## 7. Non-goals & honest limits

- **No GPU compute, ever, for sim state** — reproducibility outranks speed.
- **No trajectory changes smuggled in**: FOOD_K stays serial (§2); any future
  re-association of its sums is a product decision with full re-validation.
- **deriveOnePop stays serial** (2.6 ms/tick measured; not worth the arena).
- This buys a constant factor (~2.3× on the pass at 4 workers, more with
  cores). It does not change the asymptotics of maturity cost — the field is
  O(land) per firing and stays so; the stride lever remains the blunt
  fallback for weak hardware.

## 8. Open questions (Stage B outcomes)

1. **Node topology SETTLED**: a flat pool spawned synchronously from the sim
   thread via `process.getBuiltinModule("node:worker_threads")`, barrier over
   a ctrl SAB. **Browser topology still open** — the browser leg currently
   resolves to the lever-1 one-thread kernel path (identical results); when
   built it needs COOP/COEP + a worker-spawn path that doesn't rely on the
   event loop mid-run, and the §5 Stage B findings apply verbatim.
2. Render-mirror audit: still open, but lower-stakes than feared — SAB-backed
   views serialize/hash identically and the sim's own consumers all read
   through `world.*` references (the conversion replaces them in place).
   Verify the app shell's snapshot path before flipping any browser default.
3. Warmup SETTLED for tools: lazy spawn on the first lever ≥2 firing; the
   pool is ready by the next firing (workers boot on their own threads while
   the sim steps), and the interim firings take the identical-result fallback
   — no eager path needed anywhere.
4. NEW (measured, open): band balance — bands split by land-tile COUNT, but
   work per tile varies (spikes, owners, works hotspots). A cost-weighted
   split (e.g. by last firing's per-band wall time) could close part of the
   1.5×→2.1× gap; only worth it if the pass grows again at Modern maturity.
