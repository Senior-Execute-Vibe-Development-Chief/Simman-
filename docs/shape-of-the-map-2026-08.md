# The shape of the map — count, sizes, spread (2026-08)

Owner report: *"the sim's shape, throughout, is slightly off. The country counts,
sizes, spread, differences… is just a bit off, unrealistic. Too blunt, not enough
tiny countries, nuanced stuff."* Owner plays at **Half sim** on the 1920 map —
sim `tw = 960`, one grid FINER than even the resgate app arm. So the complaint
lives at a grid nothing measured; everything below is measured at the reference
(tw=240), the app arm (tw=480) and spot-checked beyond.

## The instrument

`tools/probe_shape.mjs` — the full realm-size distribution, not the top-5:
log-decade histogram, P10/median/P90, largest/median, top-1 share, Gini, and
**lnσ** (the std-dev of ln(area)) — plus the smallest realms with their age/org
context, per checkpoint. Every prior size gate read the TOP of the distribution
(largest share, tail ratio) or the middle (median); none read the BOTTOM —
whether small states EXIST at all.

The real-world anchor for lnσ: country areas at any documented era are roughly
log-normal with **σ ≈ 2.0–2.6** (the modern 195-state map ≈ 2.4 across seven
orders of magnitude; the 1500 CE map similar across its hundreds of polities).
The share of states below 100k km²: **~47% of the modern map**; far higher on
any early-modern European map (the HRE alone carried hundreds of statelets).
These are DIAGNOSTIC anchors for reading the measurement — never targets to
tune toward (second cardinal rule); the fix below is mechanism work, and the
numbers it produces are whatever the mechanisms imply.

## The measured defect (baseline, seed 8817)

| grid | step | realms | lnσ | <100k km² share | one-decade concentration |
|---|---|---|---|---|---|
| tw=240 | 4000 | 48 | — | **46%** | — |
| tw=240 | 8000 | 50 | **0.80** | **2%** | 35/50 in 200k–1M |
| tw=240 | 16000 | 63 | 0.85 | 3% | 39/63 in 200k–1M |
| tw=480 | 8000 | 49 | 1.10 | 14% | 29/49 in 200k–1M |
| tw=480 | 16000 | 56 | 0.89 | 5% | 38/56 in 200k–1M |

Two readings, both exactly the owner's words:

1. **The spread is one-third of history's, on the log scale.** lnσ 0.8–1.1
   against ≈2.0–2.6. Two-thirds of the world's realms sit in ONE size decade —
   the "too blunt" uniform band.
2. **Smallness is a transient of youth, not a niche.** At step 4000 nearly half
   the map's realms are small — every one of them a low-org newborn still
   growing. By 8000 they have all grown into the band: **2%**. The tiny-realm
   list at every checkpoint is just the youngest cohort, aging out. No mechanism
   lets a state BE small; there are no persistent city-states, no mountain
   statelets, no packed peers.

## Why — three mechanism findings

**1. The founding channel forbids the packed-peer regime.** `NUCLEATE_CAP_DIST
= 8` reference-tiles (~1,000 km): no state may be born within that disc of ANY
existing capital. Real cradles were the OPPOSITE regime — dozens of Sumerian
city-states 30–50 km apart, the Aegean poleis, the Maya ajawil — peers packed
into one dense valley, hemming each other small for millennia. The disc was
honest under the ENTITY model, where a realm's "claim" was a projected
reach-bubble far beyond its administration (a founding inside the bubble's
shadow was a founding inside a state); under the field model control is
explicit (claimed tiles) and the founding test already prices it — the basin
viability bar counts ONLY unclaimed land. The disc had become a redundant veto
whose sole remaining effect was one-state-per-valley.

**2. The realm-killer had no terrain.** The capital STORM — the only way tile
war kills a realm — priced garrison, militia, walls, relief armies, distance…
and not the ground: a lagoon city, an alpine eyrie and a plains town stormed
identically. The countryside tile-defence DID price terrain, but by cell-MEAN
altitude (`elev > 0.5`) — the exact blindness the ridge-relief work measured
(the Alps average ~0.31 and slip under every altitude threshold) and fixed for
CLAIM cost, but never for war. And peaceful absorption — the statelet-eater —
had no terrain term anywhere: a mountain community defected into the lowland
empire's orbit at plains rate. Between the three, the map could not keep an
Andorra, a Nepal, a Montenegro, a Venice — the enclave gate's own comment names
Andorra and San Marino as what it was wrongly vacuuming.

**3. Every size target converges.** `target = govPop/RURAL_BIND_DENS + march`:
one world-wide density constant, `spanTechMul = 1` (SPAN_TECH def 0, owner
2026-07-30), `POP_FILL = 12` reaching target in a few passes. All mature realms
relax toward the same characteristic regional scale — the one-decade band.
(Recorded context: SPAN_TECH's own retraction doc says the mechanism is right
and its 0.85 magnitude was stale against the corrected food model — "must be
re-derived". This wave does not touch it; see "what was measured but not
changed" below.)

## What was built

**`T.PEER_POLITY` (def 1) — control gates founding, not distance.** The
capital-distance disc is retired; the only spatial veto left is the ground
under the seat itself (administered ground cannot seat a NEW state — its
people already have one). The org bar, basin-mass bar (which already counts
only unclaimed land — the true control test), leadership, per-pass spacing and
per-pass cap all stand. States are born in the gaps BETWEEN realms — marches,
deltas, refuge pockets — which is where history put them. 0 = the disc,
byte-identical (hashbase 442a119f/e1611e5c with both levers 0 = HEAD).

**`T.REFUGE` (def 1) — defensible ground shields statelets.** One shared
physics — `transport.js terrainHoldAt`: high-ground × RIDGE (world.relief past
the movement cost's own 0.07 floor, full at the measured Himalaya-front class
0.25), each term easing with the defender's construction (engineering roads
the pass — refuges are strongest when statecraft is young and erode as the
world matures, never a clock), capped at the war pass's own ×6. Three consumers:
- war tile-defence gains the ridge term (river/alpine terms unchanged —
  extracted to shared constants, values identical; the RIVER keeps defending
  exactly where it always did, the countryside front);
- the capital storm multiplies the fortress (and siege attrition, and the
  break check) by the seat tile's hold — a defensible seat holds out, and is
  starved or overawed into VASSALAGE instead (channels that already exist and
  are terrain-free);
- peaceful absorption divides the defection pull by the member's hold, and a
  city-enclave's seat hold raises the power dominance its engulfer needs.

Design correction, measured mid-build: the seat hold's first cut included the
river-moat term, and realm-kills fell 4 → 1 per 8k — because ~85% of seats are
river-sited (probe_siting), a seat moat is not a refuge differentiator but a
global war re-balance, the immortal-giants regime returning through a new
door. The seat hold is high-ground/ridge only; rivers defend the countryside
tile war as before.

## Results

(filled in after the A/B battery — see the session measurements)

## What was measured but NOT changed

- `SPAN_TECH` stays 0 (owner decision 2026-07-30 recorded in
  docs/resolution-collapse-2026-07-29.md, with the re-derivation invitation).
  Whether a re-derived moderate value belongs on top of PEER_POLITY/REFUGE is
  measured in this session's sweep and recorded below, but the default is the
  owner's call, not this wave's.
