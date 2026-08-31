# 02 — Architecture

## Stack and home

- **TypeScript, browser-first**, in `v2/` of this repository; v1 stays
  runnable beside it as reference oracle and parts shop. Vite build; the
  product remains a self-contained static page (single-file deploy,
  preview channels).
- **Sim in a Web Worker from day one**; the same sim core runs headless in
  Node for the harness (v1's isomorphic-pipeline pattern, proven).
- **CPU typed arrays** (SoA) for all fields; the popField worker-pool
  banding pattern (proven bit-identical in v1) is the parallelism story.
  GPU compute is a Phase-3 question — it trades away cross-machine
  determinism, which seed-sharing depends on. Data layouts are kept
  GPU-friendly (flat arrays, no object graphs in the hot path) so the
  option stays open.

## Grids

- Dev grid: coarse (fast iteration, seconds/run). Target grid: **10–20 km
  tiles** (~0.4–1.5M land cells) — finer-grained than v1's shipped grid.
- Per R3 there is one calibrated *reference* grid for byte-identity
  baselines, and every milestone gate runs dev + target. All constants are
  expressed in real units (km, people, tonnes, years) and converted at the
  world's own km-per-tile — never per-tile constants (research/02 §1.9).
- 1-D features (rivers, coasts) integrate per real area via the band
  convention (v1's ACCESS_BAND/BAND_SUM fix, ported as doctrine).

## The state, in five boxes (R4: one representation each)

1. **Static substrate** (from worldgen, immutable): elevation, climate
   (monthly), rivers/lakes, soils/fertility, wild-crop ranges, resources,
   relief, coasts. Rebuilt deterministically from seed + data; never saved.
2. **Fields** (typed arrays, the authoritative dynamic state):
   - `people` — persons per tile (one population scale, real units ×
     POP_SCALE; there is no census copy and no bridge scalar).
   - `food` stocks and flows enter through community books (see 4), not a
     parallel field; land productivity is derived each pass.
   - `technique` — what farming/craft knowledge has reached each tile
     (wave-of-advance ratchet; v1's devField, ported).
   - `works` — built land capital (irrigation, clearing; decays unfed).
   - `memory` — allegiance/homeland/grievance (v1's loyalty field family,
     ported land-anchored as designed).
   - slow environmental stocks: soil fatigue, deforestation.
   - seasonal pasture productivity and grazing depletion (15).
   - **`authority` — per-tile top-K (K=4) slots of (centerId, weight)**,
     recomputed from centers over the travel-cost field. A derived view,
     never authored; there is no `_countryOwner`. (05-politics.)
3. **The travel-time cost field** (03): one edge-cost model, seasonal and
   technique-dependent, consumed by *everything* that moves or reaches —
   trade, war, administration, information, migration, disease. Single
   source of truth; v1's `transport.js` core ports as its seed.
4. **The register** (bounded, condensed objects — R8):
   - **Communities**: village-scale aggregates condensed from `people`;
     the atom of compliance, unrest, legitimacy, and food books (P2).
     Books include herd stocks (15) and disease pools/immunity (16);
     the standing rule: communities drift toward their food source
     (DECISIONS 12a).
   - **Armies**: moving, supplied columns on the travel field
     (DECISIONS 10a; 13) — position, composition, supply state,
     commander.
   - **Known-world frontiers**: coarse per-tradition geographic-knowledge
     state (DECISIONS 11a; 14).
   - **Centers**: courts/lords/temples/markets past the salience bar (P3);
     hold retinue, stores, treasury, institution portfolio, dynasty ref.
   - **Obligation edges**: directed (from, to, kind, strength, binding:
     person|office); kinds: tribute, levy, fealty, charter, alliance,
     debt. Not a tree; peer and cross-cutting edges are legal (05).
   - **Polities are queries** over the graph (e.g. transitive closure from
     a center), not records — though named, persistent identity records
     (name, chronicle, heraldry, succession) attach to centers and
     survive them (v1's polity-registry ontology, ported).
   - Identity registries: cultures, languages, faiths, dynasties, persons
     (load-bearing individuals only).
   - The append-only event log with permanent ids (ported).
5. **Rendering condensations** (not state): villages, minor lords,
   individual people — derived deterministically from (fields, seed) on
   demand at zoom. Cached, evictable, never authoritative.

## Scheduling

- Fixed timestep; explicit pass list with declared cadences and phase
  offsets (v1's `_at`/`passWindow` lessons ported: no naive `step % N`
  inside phase-offset passes; inner cadences snap to stride grids).
- Cadences are performance scheduling only (R1); any pass whose stride
  measurably changes trajectory (v1's POP_FIELD_STRIDE scar) declares
  stride=1 as its contract.
- Double-buffer every relaxation (in-place sweeps give infinite wave
  speeds — v1 scar).

## Determinism (non-negotiable, day one)

Ported wholesale from v1 (research/04 §6): no shared RNG stream ever —
`hash32(seed, systemName, step|entityId)` substreams so adding a system
never perturbs another; fixed iteration orders with explicit tiebreaks;
scan-then-apply for order independence; caches computed from bucketed
inputs; world hash + save/load/continuation checks in the smoke suite from
M0. Saves carry no RNG state. Parallel banding must be provably
bit-identical (v1's kernel contract).

## Persistence

v1's persist architecture minus its 67-version compatibility ladder:
declared field lists drive save + load + hash from one place; sparse
serialization; terrain never stored (rebuilt from seed + config — config
identity is part of world identity); warm-up rollback so save→load→save is
byte-identical. Save format versioned from 1 with no legacy pins — v2 does
not carry v1 saves.

## The shell

Grows with the sim (10-build-plan): worker snapshot protocol with pooled
transferable buffers and error containment (ported patterns), a declarative
overlay/lens registry (replacing v1's hand-rolled per-lens code), the
emergent lens-availability rule (a lens lights when its phenomenon exists),
the atlas two-surface design system, labels/collision, GlobeView, and the
almanac (validation dashboards as a product surface). Map rendering per P4:
authority gradients, not filled partitions, until state capacity sharpens
them.
