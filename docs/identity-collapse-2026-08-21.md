# The identity collapse — diagnosed (2026-08-21)

Owner: "faith, peoples, and language appear to be entirely unified now,
globally? everyone is the same?" — and, on timeline: "not foundation, but
also not recent. Last week or 2?" That timeline was the decisive clue.

## The measurement (probe_identity, tw=240, seed 8817, 24k steps)

Population-weighted top-1 share per layer, identities holding ≥1% of world
population, and the genesis event flow per 4k window:

| arm | levers | cultures born | culture top1 @24k | ids ≥1% | verdict |
|---|---|---|---|---|---|
| control | none (the pre-wave world) | 50 | **19%** | 21 | history-shaped: diversity GROWS |
| live | DAWN_LIVE + STATE_RECORDS + LAND_KNOW + PEER_SEATS | 7 | **100%** | 1 | one people on earth |
| bisect | live minus DAWN_LIVE | healthy arc (8 by 8k, top1 36% falling) | — | — | **DAWN_LIVE isolated as the cause** |

Faith follows culture down (top1 99% in the live arm — with one people,
conversion affinity is uniform and one creed sweeps the world). Language
collapses least (top1 91%, 5 tongues ≥1%): the national-language machinery
keeps minting state standards regardless.

The control world's arc is worth recording as the target: top-1 falls
32% → 19% across the run while genesis fires every window (born /
diverged / founded / schism / faded) — diversity INCREASES through the
ancient world, which is the real arrow (maximum linguistic diversity
precedes the consolidating empires).

No commits touched cultures.js / faiths.js / identityField.js in the
window — the identity CODE is unchanged. The dawn wave changed its INPUTS.

## The mechanism

Culture genesis at founding (crystallize.js) branches on HOW a settlement
relates to its donor:

* **disconnected** (beyond INDEPENDENT_DIST, across water) → a fresh ROOT
  people — own family, tongue, gods;
* **foreign ancestral soil** → the local stock's people (one per deep
  ancestry — 36 stocks on the map);
* **connected far / across a climate divide** (`isBranch`: td > 70, or
  > 38 + climate delta) → a divergent daughter;
* **connected near** → the donor's people simply extends.

The pre-dawn world crystallized settlements all over the map, so the
first branch fired constantly — 24 root peoples by step 4k in the control
arm. The dawn wave (2026-08-07 — the owner's "week or two" exactly) made
civilization radiate from ~10 hearth cradles by SHORT CONNECTED HOPS: every
new town is a few transport-units from its frontier donor, so `isBranch`
(a SINGLE-HOP distance test) never trips, `disconnected` almost never
happens, and the cradle's one people flows outward indefinitely — the
exact "cradle peoples flood the world" failure the ancestry check was
built to stop, arriving through the connected lane that check does not
guard.

The secondary differentiators were designed as trims, not the main
engine, and cannot carry the load:

* **Isolation divergence** requires losing ALL same-culture trade/sea
  contact — impossible in a chain-connected radial world.
* **Distance drift** (beyond the people's cohesion radius from its core
  for DRIFT_AFTER) does fire — but seeds the daughter as one settlement
  plus a small near-ring, which the parent's mass and state assimilation
  then reabsorb or dwarf (measured: daughters exist at <1% share in the
  live arm — `touched=2, ids≥1%=1`).
* **Political ethnogenesis** needs a durable language-shifted state away
  from the people's core — rare while statehood itself is sparse.

## The fix design (recorded, NOT applied — owner directive)

The honest generalization, no new scripts: **divergence at founding must
measure the accumulated distance from the PEOPLE'S CORE, not the single
hop from the donor.** Stepwise expansion covering 300 tiles must diverge
exactly as much as one 300-tile leap — history's proof is the Bantu
expansion: fully connected, stepwise, and it produced hundreds of daughter
languages. Concretely: at founding, when the new site lies beyond the
culture's cohesion radius from its demographic core (the SAME
`cohesionRadius` the drift pass already uses — stone-age small, growing
with connectivity tech, so it self-calibrates by era with zero new
constants), seed a BRANCH people (the existing daughter path) instead of
extending the parent. Near the core, extension is correct (a people IS
cohesive within its era's reach).

Expected consequences, to verify by the same probe when built:
* the live arc recovers the control shape (top-1 falling, genesis every
  window) while keeping the dawn's hearth-radial civilization;
* faith diversity returns with people diversity (affinity re-fragments);
* the drift/ethnogenesis passes go back to being trims on a working base;
* anchors stay byte-identical (DAWN_LIVE is pinned 0 in the harness; the
  change rides inside the dawn lane) and the stylized gates hold.

Follow-ups seen while diagnosing, parked: (a) drift daughters claim only a
16-tile near-ring — once founding genesis works, check whether daughters
should instead claim the whole beyond-reach region; (b) the per-stock
mega-culture (`ancestryCulture`) makes one people per deep stock — right
as a floor, but check that stock-interior founding divergence (the fix
above) fragments it on schedule.

## BUILT AND VERIFIED (same day, owner's go) — with a wrong-lane erratum

**Erratum first.** The fix as designed above was applied to the
culture-by-connection block in the crystallize lane — and the verdict probe
came back BYTE-IDENTICAL to the broken world, twice. The dawn world's
cities are not born through that lane: they are minted by `mintCityAt`
(genesis anchors + peer seats), whose culture logic was one line — the
donor's people, unconditionally. No distance test, no branch test, and not
even the ancestry-soil floor. The collapse was not a threshold that never
tripped; it was a lane with NO identity physics at all. The diagnosis
above stands (founding-time genesis starved), but the mechanism's true
address was the mint lane. (`T.FOUND_DRIFT`, def 1, harness pins 0; the
crystallize-lane generalization kept too — correct for its lane.)

**Verdict (probe_identity, tw=240, live set + FOUND_DRIFT=1, vs broken and
control):**

| @24k | broken live | FIXED live | control |
|---|---|---|---|
| cultures born | 7 | **51** | 50 |
| culture top-1 share | 100% | **30%, falling** | 19% |
| peoples ≥1% | 1 | **15** | 21 |
| faith top-1 | 99% | **46%** | 21% |
| language top-1 | 91% | **31%** | 10% |

Genesis is alive and scales with the register (44 births in the last
window as the dawn world's cities multiply); faith diversity recovers as
predicted (affinity re-fragments with the peoples). The arc is the
control's shape, shifted by the dawn's later start — the dawn keeps its
hearth-radial civilization and the peoples fragment as they spread.

**tw=480 confirm (full live set incl. WAR_FINISH, 28k): PASSED.** Culture
top-1 falls 22% → 13% → **9%** across 20-28k with 23 peoples ≥1% (control
band: ~19-21%, 21 ids — matched at scale, not over-fragmented in share
terms; the 115-strong long tail of small peoples is the historically
right shape). Language top-1 8%, 23 tongues ≥1%. Faith: top-1 22% at 24k
then a late surge to 60% at 28k — ONE organized creed sweeping the
connected world, 12 rivals still ≥1%. That profile is roughly history's
own (the top two real faiths hold ~55% today), so it is recorded as a
WATCH ITEM, not tuned: if future arcs show every seed converging on a
single-creed world by the classical era, the conversion physics gets
measured then. Wave CLOSED (task #16).
