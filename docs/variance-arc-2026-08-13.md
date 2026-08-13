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

**WAVE 3 (FISSION, 8369fb1, v15) — BINDING at tw=240, ZERO firings at
tw=960.** The stylized world moved for the first time in the arc (31→27
polities, 1955→2136 events, the standing state-lifespan soft warning
cleared to 0) — the mechanism is alive. At the app grid: polity.seceded
2 = baseline exactly; zero fissions in 26k. Attribution: there is
almost no tribal fabric TO split at tw=960 (4 land nations all run,
materializing fast), because cities mint quickly in dense basins and
claim the cells first — and every seat channel, city AND tribal, draws
from the SAME one-seat-per-cell site lattice. **THE SINGLE ROOT, now
measured three independent ways: the site lattice caps urban density,
tribal density, fission fuel, adjacency, wars, and the cascade at
once.** The unlock is the peer-seat candidate generation the peerlat
funnel demanded — applied at BOTH bars: city seats against the city
basin bar (the labelBasinFree capacity law already shipped), and
TRIBAL seats against the tribal bar (TRIBAL_CENSUS — 20× denser), so a
cradle valley fills with adjacent chiefdoms long before its first city,
exactly as history's cradles did. All three shipped waves stay on as
the receiving structure.

**THE COMBINED VERDICT (polrec_wave5, tw=960/8817/26k — tribal peer
lattice + fission + cascade + REACH_GROUND together): THE MAP
TRANSFORMED.** Polities 73 → 321; nearest-neighbour capitals min 416km →
25km (median 736 → 244, p10 462 → 82 — the Sumer packing regime); size
Gini 0.44-flat → 0.71-rising; max/median 4.5:1 → 51:1 with 2k-km²
microstates persisting beside 560k majors; foundings 9 → 294; breakaways
2 → 9 (fission fires at the app grid); deaths 6 → 14 fallen + 22 ended;
top-realm identity changes 3 → 5. The owner's "ultra dense areas",
"micro state" and regional fit are delivered; "ancient nations" holds
(oldest living realm spans the whole run). THE REMAINING GAP: the
hegemon/boom lane — top share still 4-7% (no runaway winner), and
submissions FELL 46 → 21 because the grounded reach rightly cut
long-range overawing; consolidation must now run at the local scale on
the new adjacency (wars between touching statelets → momentum → the
cascade, all shipped and armed). Next lap: measure WAR IGNITION on the
dense map (the recorder must add war events); if wars fire, the cascade
chain gets its first live test; if not, attribute the war gate.

**THE WAR PULSE (probe_warpulse, tw=480/26k, all waves on): the dense
map is ALIVE — and the boom lane is ONE GATE from complete.** Wars
ignite and accelerate with density (war.began 1 → 4 → 19 per 4k era;
ended 6 → 12), the slow-burn absorb lane runs (settlement.annexed 29 per
era — steady large-nation growth by digestion), submissions pass (8/era
at the local scale), unions fire, fission churns (5/era), tribal fabric
414 + 65 realms by 24k. THE BLOCKER, measured exactly: ZERO
settlement.captured across the entire run — wars end by indemnity and
annexation but NO CAPITAL EVER FALLS, so fragmentRealm(how="conquest")
never fires, the cascade's network-inheritance never triggers, and
momentum (MOMENTUM_PER_STORM) never banks — the witness-collapse
divisor stays at 1 and the overawe bar never drops. Boom-bust's next
lap is therefore singular: make SOME wars decisive — attribute the
storm gate in armies.js (siege mechanics vs early-era capitals, truce
hazard ending wars first, or WAR_REACH), and consider banking momentum
on war-won annexations (victory demonstrated is victory banked). The
slow-burn lane needs no new mechanism — annexation + adoption + the
grounded reach growing with logistics IS the Rome archetype; measure
its long-horizon size curve on the 45k overnight config next.

**THE STORM GATE, ATTRIBUTED (storm funnel in armies.js, tw=480/26k):
370 fronts reached the heartland, 370/370 failed `assaultTooWeak` —
advCity NEVER reaches CITY_STORM_RATIO (1.6). The mechanism gap: the
break test is floored at the CITIZEN MILITIA (homeMight), which is
population-proportional and UNGRINDABLE — the siege bombard wears the
garrison, but defNow re-floors at the militia every pass, so a populous
capital can never fall regardless of siege duration, and among the
dense map's near-peers the attacker never owns a 1.6× edge over relief
+ an intact militia. History's sieges ended by STARVATION: the supply
line cut, the granaries draining, the militia withering — a stocked
city holds for years (Troy), an empty one for weeks. The sim already
holds every needed quantity: def._siegeAt is stamped at true siege
(armies.js), per-settlement stores/supply (s.food, _foodSupply) and the
famine machinery exist. NEXT WAVE (SIEGE_STARVE): while besieged, the
seat's food flow chokes and stores drain at demand; homeMight's militia
term scales with nutrition — the fall clock becomes the granary, siege
duration becomes emergent, and the cascade (shatter → inherit →
momentum → witness collapse) gets its trigger. Scope the consequence to
the besieged seat only, while _siegeAt is fresh (the FED_FAMINE /
FOOD_REACH scars demand it).**

**WAVE 2 VERDICT: ALSO INERT at tw=960 — byte-identical after-run.** The
attribution goes one level deeper than either wave: momentum needs
conquest, conquest needs WARS, and no war ever ignites at the app grid
(zero war activity across 26k; the 12 polity.ended are land-nation
retirements). Both wave-2 transfers are correctly built doors on a
corridor where armies never march. The full causal chain of the owner's
"too stable and clean," now measured at every link: SITE LATTICE (one
seat per cell) → capitals born ≥416km apart → NO FRONTS → no wars → no
momentum, no storms, no network inheritance → no cascade → uniform,
immortal, evenly-spaced blobs. Next lap, in order: (1) instrument war
ignition at tw=960 (why no front ever forms: reach, motive, or
adjacency), (2) build the upstream PEER-SEAT MINT (the second-seat
candidate generation the peerlat funnel demanded) — restoring adjacency
in dense basins feeds wars, wars feed momentum, and both shipped waves
arm on contact. The levers stay ON: they are the receiving structure.

## 6. SIEGE_STARVE verdict (tw=960/8817/26k) and the arc's standing state

Churn rose across every channel with capitals now stormable: polity.ended
22 → 29, seceded 9 → 14, RESTORED 4 → 7 (fallen nations reborn — the
ancient-nation lane live), submitted 21 → 29; fallen states die YOUNGER
(median lifespan 8,500 → 6,500) while the oldest realm still spans the
run. Density and the heavy tail held (321 → 318 polities, Gini 0.70, 2k
microstates beside 580k majors). NOT yet observed in 26k: a runaway
hegemon (top share 4-7%) — realms only begin ~10k at this grid, so the
boom machinery gets ~16k steps; the 45k overnight horizon is the right
measurement, queued. The chain itself is verified firing at tw=480 (6
storms, shatters 2 → 4/era) and the bust side at tw=960.
