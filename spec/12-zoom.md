# 12 — The living zoom  `[FULL DETAIL — ratified DECISIONS 9; street band builds later]`

One continuous camera from orbit to a person. Everything visible at every
altitude is true — derived from the sim, never decoration. The sim runs at
tile + register scale (02); everything below is **rendered condensation**
(R8): deterministic, cached, viewport-only, read-only over sim state.

## 12.1 Altitude bands

| Band | ~Scale | You see |
|---|---|---|
| Orbit | 10,000 km | globe, climate, lenses, civilization as glow; centuries feel natural |
| Continent | 2,000 km | the atlas: authority fading per P4, trade arteries, wars as burning frontiers, cities as points, heraldry by power |
| Region | 300 km | centers with halos, obligation arrows on demand, roads, market catchments — the graph as geometry |
| Valley | 50 km | villages (condensed from the people field), land-use texture from worked area, halls/shrines, carts where flow runs |
| Settlement | 5 km | the town plan: walls at real fortification grade, market sized to real volume, the actual majority faith's temple, harbor iff it ships — a deterministic planner reads the books + the culture's building tradition |
| Street | 100 m | people: sampled from real demography/labor/identity state, doing season-true work; named by the language engine; biographies on click |

## 12.2 The four laws

1. **No lies** (9b). Every detail traces to a sim quantity (houses ↔
   population, granary render ↔ the book, ruins ↔ memory field, walls ↔
   fortification, fields ↔ worked area). Permitted middle category:
   *cosmetic-but-derived* — deterministic elaboration of real coarse truth
   (daily weather from monthly climate + the year's real anomaly; the
   day/night cycle, 9c, flagged cosmetic). Pure invention forbidden; where
   the sim is silent, the renderer is quiet.
2. **Deterministic persistence** (9a). Same seed, same place, same date ⇒
   same village, layout, families — every visit, every machine. All
   sub-sim detail derives from hashed streams keyed (seed, site), advanced
   by local sim history. **Persistent micro-genealogy**: per-site family
   streams age at the community's real birth/death rates; recorded events
   leave marks (the famine grew the graveyard; the levy took the sons).
   The biography sampler is pure, testable like the language engine.
3. **Time-zoom degradation, not coupling.** Time speed is free at every
   altitude; rendering degrades gracefully — individuals at slow speed,
   dissolving into flows as speed rises; at high speed close-in, the view
   becomes **time-lapse morphology** (houses accrete, fields creep, walls
   rise, ruins green over).
4. **Follow the grain.** Every deep object is a door into the causal
   chain: field → the market whose bid won it → rent → lord → fealty →
   king; same walk for a coin, a technique, a recruit. The signature
   interaction — possible only because the chain is real.

## 12.3 Implementation shape

Render pyramid; condensation cache keyed (site, band, local-history
digest); planners (village layout, town plan, biography sampler) as pure
deterministic functions with their own property tests; conservation of
appearance (rendered people sum to tile truth; rendered roads connect
where flow exists; village count matches field mass). Valley band lands
with M3; settlement and street bands are renderer-track work trailing the
milestones (9d) — they read the sim and never block it.

## 12.4 Checks

- Determinism: revisit-identity property tests on planners and sampler.
- Conservation of appearance: rendered sums vs field truth (hard).
- No-lies audit: every renderer input enumerable to a sim path; the
  cosmetic-but-derived set is a named, fail-open list (08 conventions).
- Genealogy consistency: sampled biographies never contradict recorded
  local history (age pyramids, mortality events, occupational shares).
