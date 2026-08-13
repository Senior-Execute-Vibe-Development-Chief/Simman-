# The variance arc (2026-08-13): "micro states, 50-year empires, vast empires, ancient nations, ultra dense areas"

The owner's order, on confirming the caging-law dawn (§10 of
docs/dawn-cradles-2026-08-07.md) looks right: *"now we need to work on
nation size, density, boom bust etc. currently it is far too stable and
clean, there needs to be micro state, 50 year empires, vast empires,
ancient nations, ultra dense areas, etc."*

The complaint is about DISTRIBUTIONS. History's political world is
heavy-tailed on every axis — size (a Rome and a polis, five orders of
magnitude apart, at the same moment), lifespan (Alexander's decade, Egypt's
thirty centuries), spatial density (Sumer packed a dozen sovereign courts
into 400 km while the marches ran empty for thousands). The sim's is
narrow on all three.

## 1. The measured state (probe_overnight instrument + analyze_polrec, tw=960/8817, 26k, current physics)

| axis | measured | history wants |
|---|---|---|
| size | max realm 535k km²; max/median 4.5:1; Gini 0.44-0.47 flat | 100-1000:1 tails, Gini ≫ 0.7 |
| top realm | share of claimed land 56% → 4%, FALLING as the world fills | hegemons repeatedly take 30-60% of their world |
| lifespan | 6 fallen in 26k steps, 83 living; median fallen 8,500 | flash empires (~200 steps) AND kilo-step ancients, together |
| spacing | nearest-neighbour capitals: median 736-850 km, MINIMUM 416 km | Sumer/Aegean: 30-80 km between sovereign seats |
| events/26k | 39 submissions, 7 unions, 2 secessions, 12 ended | consolidation cascades, partitions, restorations every era |

Suzerainty blocs DO form (bloc-aggregated: top bloc 5 realms / 1.35M km²
by 26k; 29 of 83 realms bonded) — but they cap at 4-5 members, the top
three blocs sit within 20% of each other (1.35/1.17/1.11M — symmetry
again, one level up), and the map paints each vassal separately, so the
owner sees 83 mid-sized blobs.

Resolution note (Third Rule): the tw=240 stylized world is CHURNED —
87 fallen states, median lifespan 150 steps, the "revolt-churn mode"
soft-warning — while tw=960 is immortal. Political stability is currently
resolution-DEPENDENT; whatever ships must be measured at the app grid.

## 2. The funnel (probe_nucfunnel, telemetry.js layer, tw=480/8817, 22k)

Attribution, not guesswork:

- **nucleate** (frontier founding): CANDIDATE 7-8 per 4k-step era — the
  channel is candidate-STARVED, not veto-blocked (`notBasinLeader` never
  fired; rejections were seatPop/org). There is nothing for the founding
  law to reject: stateless settled settlements barely exist, because
  cities mint one-per-site-cell off the ledger and each city self-anchors
  a realm at birth (CITY_AT_BIRTH). **State spacing IS city spacing, and
  the urban lattice is uniform at the market-cell scale by construction.**
  Sumer-packing is impossible at any political setting until the URBAN
  law can put several cities in one basin.
- **submit** (the primary consolidation channel): 715 candidate pairs over
  8k steps → 10 PASSED. `resistanceNotHopeless` rejects 63% (the
  SUBMIT_RATIO 5× bar in a near-equal world); `alreadyADependency` locks
  another 16% once early blocs form. The §8 trap ("consolidation needs
  asymmetry, the dawn produces near-equals"), measured end-to-end — and it
  re-arises at BLOC level: blocs of 4-5 face blocs of 4-5 and the 5× bar
  never clears again.
- **union** (VALLEY_UNION, the §8 peer channel): 2 PASSED in 20k — real
  but rare (succession-crisis + corridor + kin gated).

## 3. The two structural roots

1. **The urban lattice bounds the political lattice.** One city per
   market cell, one realm per city: the map can never be politically
   denser than TOWN_BASIN_R. Every downstream channel starves — no
   neighbours within reach, no cascades, no packing, no microstates.
2. **Asymmetry-gated consolidation in a symmetric world self-arrests at
   every scale.** Singles vs singles, then blocs vs blocs. History's
   consolidation ran on DECISIVE EVENTS that create asymmetry rather than
   require it: the battle that transfers a whole network (Cyrus takes
   Media's empire in one stroke), the marriage/union of near-equal crowns,
   the partition that feeds neighbours.

## 4. The wave plan

- **Wave 1 — THE PEER LATTICE.** City density priced by what the land's
  catchments can feed (the CITY_STORE/core-bar physics the mint already
  runs), not one-per-cell: a basin whose storable economy can fund N urban
  cores at catchment scale mints N cities on the existing cadence. Dense
  cradles then carry peer clusters of courts; sparse country still funds
  one or none. This is the fuel for every consolidation channel.
- **Wave 2 — DECISIVE CONSOLIDATION.** Victory creates asymmetry instead
  of requiring it: decisive war outcomes transfer suzerainty networks
  whole; peer-union frequency scales with contact density; the 5× hazard
  stays for the overawing lane it correctly models.
- **Wave 3 — MORTALITY.** With cascades running, conquest and partition
  (ELITE_FRACTURE already ships) generate the boom-bust tails; internal
  collapse hazards separate the 50-year overextended blob from the caged
  ancient core (STATE_CAGE gives the durable-core structure for free).

Each wave gates at tw=240 AND tw=480 (resgate) with tw=960 spot-checks,
per the Third Rule; the polrec/analyze_polrec pair is the arc's standing
instrument, run before and after each wave.

## 5. Wave 1 spec — the peer lattice (grounded in the mint law's own objects)

The one-per-cell rule lives in `_siteClaims.claimed[k]` (crystallize.js):
a cell (the Voronoi basin of a quantized hydrological anchor — confluence,
mouth, sink, bay — within TOWN_BASIN_R) is claimed by the FIRST settled
label forever, and `labelBasinFree` — "the one siting law every
label-minting act reads" (sweep, daughters, sea landings) — refuses the
cell thereafter. One court per hydro-anchor basin, planet-wide, by
construction.

The mechanism: **a cell's capacity is what its people can feed, not 1.**
`claimed[k]` (Uint8 flag) becomes `count[k]`, and the cell is open while
`count[k] < max(1, floor(mass[k] / basinBarF))` — the SAME city-basin bar
(`TIER_CORE[2]/URBAN_SHARE_REF/bridge`) the mint's eligibility already
reads, so a basin holding people for N urban cores seats up to N courts,
one per bar-multiple. In-cell spacing is the core's own scale: a new label
must stand ≥ 2 × urbanCoreR from every existing label in the cell (cores
must not overlap — the walkable-core radius the spike law already uses).
Zero new constants; the two quantities are the mint's own. Sumer: an
alluvial cell holding 5-6 bar-multiples seats its peer cluster 50-80 km
apart; a thin-country cell holds one court or none, exactly as now. All
other mint gates (farming arrival, CITY_STORE storable ground, coreBar
spike, CITY_AT_BIRTH anchoring) apply per candidate unchanged.

Blast radius: the siting law is shared by the crystallization sweep,
daughter foundings and sea landings — the capacity form must be measured
against each (the birth-crater scars live here; HOLD_SEAM interactions
re-checked). Lever + v13 save guard; full battery + resgate ×2; the
polrec before/after pair decides — success = NN capital spacing's p10
falls toward the core scale in cradle basins while sparse country is
byte-similar, and submissions/unions rise on the new contact density.

**VERDICT (polrec after-run, tw=960/8817/26k): INERT — byte-identical to
the baseline in every snapshot.** The lever as shipped (287e511) never
fires in its own target regime; the battery's tw=240 pass proved only
harmlessness, and the after-instrument caught the b859db7 mode before it
shipped as a false success. Attribution hypotheses for the next lap, in
order: (a) CELL EXTENT — capacity = floor(cellMass/basinBar) with cells
the Voronoi basins of QUANTIZED hydro-anchors; in confluence-dense
country the cells may be far smaller than the market horizon, so no cell
ever holds 2× the bar and capacity sticks at 1 — the anchor quantization
(SITE_MERGE_D), not the claim flag, would then be the real lattice; (b)
SWEEP RATE — labelBasinFree opening a cell ≠ a founding: the
crystallization sweep may propose no candidates in settled-era cells at
all (its own gates or era-rate), so the opened door is never walked
through. Next lap: tel() the peer branch of labelBasinFree
(peerOpen/peerCapacityFull/peerSpacingBlocked) and the sweep's candidate
funnel; fix whichever binds; re-run the after-instrument. The wave is
not done until the instrument moves.

**ATTRIBUTED (peerlat funnel, tw=480/22k): hypothesis (b) — NOBODY
KNOCKS.** Zero `peerlat` counters over the entire run: labelBasinFree is
never queried on a claimed cell, because every founding channel draws
its candidates from the ledger's SITE LIST — one site per cell, standing
exactly where the first city already is. Opening the door changed
nothing because no channel generates a candidate LOCATION inside a
claimed cell. The fix moves upstream: the site-city pass must propose a
SECOND SEAT in cells whose capacity exceeds their count — the best
popField peak ≥ 2×urbanCoreR from every seated label, through the same
eligibility gates (farming, storable ground, core bar). That is a real
siting decision inside the mint law (the birth-crater scars live there)
— the next lap's work, with the capacity/spacing law already in place to
receive it.

**Wave 2 shipped meanwhile (CONQUEST_CASCADE, 0b86e70, v14):** the fast
lane — the submission bar reads the hegemon's banked conquest momentum
(effective ratio SUBMIT_RATIO/(1+storm-equivalents), floored at parity:
witness collapse), and a decisive conquest inherits the fallen realm's
whole vassal network (Cyrus takes Media). Battery green; byte-identical
at tw=240 (no hegemon ever runs hot there); the tw=960 polrec
after-measurement is running as its existence proof.
