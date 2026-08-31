# SIMMAN RUNTIME TUNING REGISTRY — v2 REBUILD AUDIT DOSSIER

**Sources read in full:** `CLAUDE.md`, `src/sim/peopleSim/tuning.js` (1,001 lines, 529 KB), `src/sim/units.js`, `src/paramDefs.js` (75 worldgen params), `tools/_harness.mjs`.

**Registry mechanics.** `TUNING_SCHEMA` is one array of 10 categories; `T` is the live mutable value object every sim module reads at use time (slider changes apply next pass, no restart). `applyTuning()` accepts only known keys and finite numbers; `TUNING_VERSION.v` bumps on every change to invalidate per-tick caches; `resetTuning()` restores defaults. The file also exports `passWindow()` (amortized-cadence check safe under phase-offset passes — added because naive `step % EVERY === 0` inside a phase-offset pass is dead and "silently froze the alliance map at its first build"), and `POP_REF_W = 240` / `rNormPop(world) = world.tw/240` (the resolution-invariance normalizer). The header records that defaults reproduce the hand-tuned behaviour byte-identically *except* the four knowledge-realism levers (SCI_SPREAD, AXIS_BIAS, KNOW_DECAY, ENV_SPEC), which default to their ACTIVE settings.

**Headline count:** exactly **430 levers** (the oft-quoted 431 comes from `grep -c 'key:'`, which also matches the phrase "the re-key:" inside ONE_BOOK's description). Category sizes: Pacing **135** (this category label is a fossil — it holds the entire model-flag registry, the field-ontology flags, the food-economy waves and the goods vector, not just cadences), Empire size & cohesion **70**, Military & conquest **36**, Movement & water crossing **6**, Sea & colonisation **12**, Settlements & demographics **50**, Knowledge & tech **58**, Economy & state **52**, Shocks **8**, Dynastic politics **3**.

**A caveat that matters for v2:** description text is append-only history. At least 20 levers carry stale verdict tails — "0 (DEFAULT)" or "SHIPS 0 / SHIPS OFF / MEASURED RED / REFUTED" — while their schema `def` is 1, because later flip waves (SAVE_VERSION 45–67, especially the v55 "12k abolish stack", the v57 "mint/packing + city-hold stack" and the v58 "Tier-2 politics" stack) flipped them without rewriting the earlier verdict text. Section 4f enumerates these; do not trust any single sentence of a desc for the current default — trust `def`.

---

## 1. PHYSICAL CONSTANTS WORTH CARRYING TO V2

These are the levers/constants whose values have independent physical meaning or an explicit real-world citation in their own description. They seed v2's constants ledger. (Unit notes: 1 sim-person = 1,000 people; 1 food unit = 1 t grain; 1 tick = 0.25 dyn-years on the settlement clock; 1 reference tile ≈ 167 km across at the equator ≈ 17,700 km² mean spherical area — see Section 6.)

### 1.1 Display/unit anchors (src/sim/units.js)

| Constant | Value | Unit | Grounding |
|---|---|---|---|
| `POP_SCALE` | 1000 | people per sim-pop unit | Definitional bridge; calibrated so "metropolis ~3.4M, city ~1.2M, town ~250k, village ~25k" |
| `FOOD_KG_PER_UNIT` | 1000 | kg grain per food unit | "1 unit = 1 tonne" |
| `GOLD_G_PER_COIN` | 8 | g gold per coin | "a gold ducat ≈ 3.5 g; 8 g keeps treasuries legible" — deliberately 2.3× the ducat for legibility, i.e. only half-grounded |

### 1.2 Transport, freight and the grain shed

| Lever | Default | Unit / meaning | Grounding |
|---|---|---|---|
| HAUL_PHYS (constants inside) | on | land haul e-folds at **340 km**; water ×**12** | **Diocletian's Price Edict (301 CE)**: ox-wagon carriage raised wheat ~55% per 100 Roman miles (~148 km) → 148/ln(1.55) = 340 km; 12 = the edict's land:water freight ratio |
| GRAIN_FREIGHT | 1 | buyer pays for the whole consignment, road eats the loss | "Diocletian's edict: a wagon of wheat doubling in price every ~50-100 miles"; history's overland grain shed 20–100 km |
| FOOD_HAUL_WATER | 3.0 | × haul range on river/coast | barge/ship vs ox-cart (Nile, Rhine, Baltic grain trades) |
| SEA_TRADE_MULT | 8.0 | × sea-lane trade volume | "ships moved bulk goods 10-20× cheaper per ton than ox-carts" |
| RIVER_TRADE_MULT | 3.5 | × river trade volume | below sea because rivers are shorter-range |
| OPEN_RIDE | 0.62 | mobility discount on open flat land | full-mobility realm crosses grassland at ~⅓ foot cost (steppe empires) |
| PORTER_BOUND (floor) | 0.30 | transport-availability floor on reach | "porterage achieves about a third of animal-transport logistics radius" — Aztec tlameme radius, Maya scale; full at mobility 0.45 (the chariot gate) |
| SEA_ICE_LAT0 / LAT1 | 60° / 72° | latitude of pack-ice onset/saturation | set poleward of real trade lanes: "the Cape route tops out near 35°S and North Atlantic shipping stays below ~57°N" |
| WIND_TAIL_FLOOR | 0.7 | floor on tailwind cost discount | cap on wind subsidy so detours must be ≤1/0.7× longer to pay (fixes "sail to Antarctica on the way to Canberra") — half patch, half physics |
| ADMIN_HALF | 15 | travel-cost units at which admin load doubles | "~15 means a classical realm administers a ~2-week-march radius at roughly face value" |
| REACH_GROUND (base) | on (~1 cost-unit) | zero-tech direct administration | "history's pre-road, pre-horse court directly administered ~50-150 km — days of donkey round-trip"; replaces a base that bought ~800 km |
| WAR_REACH | 15 | ref-tiles force-projection half-distance | exponential because "supply loss is per-march-day multiplicative"; value swept 8/15 (measured, not derived) |
| AMPHIB_BAR | 1.8 | × attack threshold for beachheads | "opposed landings were historically brutal, so the default demands near-2× the land advantage" |

### 1.3 Harvest, famine, granaries

| Lever | Default | Meaning | Grounding |
|---|---|---|---|
| HARVEST_YEARS (internals) | on | AR(1) ρ = **0.30** annual z per ~12° weather cell; famine = z<−1.28 (p10 year) AND mul<0.65 | yield-variance map validated "11/12 literature regions in-band at both grids" (England ±10-14%, Sahel ±40%, Nile flood regime ±20%); "England famines ~twice a millennium, the Sahel chronically, by physics" |
| LEAN_YEAR (margin law) | on | founding margin = 1/(1−2.33·cv), clamp ≤5× | 2.33 = z of the century harvest; yields England ~1.4×, Nile ~1.9×, Mesopotamia ~2.3×, Sahel ~5×; "real cities held 2-4× subsistence minimum" (the granary law) |
| GRANARY_SPOIL | 1 | ~1%/yr base store loss | "historically ~2–15%/yr depending on climate and management" |
| CLIMATE_SPOIL | 1 | hot+wet ~2.5×, cool ~1×, hot+dry ~0.5× | "dry heat preserves — Egypt's central stores" |
| SEASON_STORE | 0.6 | seasonality deepens granaries | storage-economy proxy for the missing intra-year cycle |
| FAMINE_SEVERITY (retired, referenced) | 0.35 | harvest loss of a scripted famine | its 0.65 loss bar survives as HARVEST_YEARS' emergent famine criterion |

### 1.4 Demography and population

| Lever | Default | Meaning | Grounding |
|---|---|---|---|
| SETT_GROWTH | 0.0007/tick | ≈0.28%/yr intrinsic growth | "the HISTORICAL healthy-times band (real pre-modern natural increase averaged 0.04-0.1%/yr only because crises kept knocking it down; recovery ran 0.2-0.6%/yr)"; old 0.0018 ≈ 0.72%/yr kept the field pinned to capacity |
| POP_MIGRATE | 0.01 | per-tick migration share (diffusion coeff.) | at 0.06 it is "50-100× real pre-modern mobility" and the landmass becomes one fluid; default set by measurement (docs/land-works.md addendum 3) |
| GROWTH_LOCAL | 1 | forager ×0.35 / advanced ×1.65 of base r | "the ~3-5× differential natural increase that historically DROVE the Neolithic expansion"; wet-tropic disease cut up to ~−26% |
| URBAN_AGGLOM | 0.13 | share of a region's capacity standing in its city | under AGGLOM_LOCAL this becomes "an URBANISATION RATE, and 0.13 sits inside history's 5-15% agrarian band" |
| URBAN_GAMMA | 0.5 | urban-graveyard density-mortality exponent | "great pre-modern cities grew only by in-migration because crowd disease outpaced births"; size ∝ capacity^(1/(1+γ)) |
| URBAN_BETA | 0.65 | β = 1/γ congestion elasticity | superseded when URBAN_GAMMA > 0 |
| RURAL_BIND_DENS | 5500 | sim-people per ref-tile a state can bind | "historical early empires averaged 3–12 people/km² over their full extent (Achaemenid ~3, Han ~10, Rome ~12) × the sim's demographic scale (~0.07× Earth) → a 3,700–12,400 band"; 5,500 = ratified 8,000 × 0.69 post-B3 demographic rescale |
| MARGIN_FRAC | 0.33 | marginal-tile break-even as fraction of bind density | "the thinnest ground a state bothers to govern carries about a third of the density it averages"; a ratio on purpose so it rides re-derivations |
| MARCH_FUNDED | 2 | march ≤ 2× people-funded extent at full logistics | "Russia/Qing at rail held ~3× the extent their bind-density people funded — an anchor with independent physical meaning" |
| TROPICAL_DISEASE | 0.6 | capacity cut in the malaria belt | falciparum/sleeping-sickness signal (warm + ≥sub-humid), Diamond |
| TSETSE | 0.85 | strips livestock lift in the fly belt | "the single biggest reason most of sub-Saharan Africa had no plough, no manure, no cavalry" |
| TIER_CORE (referenced) | 2/10/40 census | town/city/metropolis definitions on the urban core | "a town is ~2,000 urban people — the smallest agglomerations the literature calls towns; a city ~10,000 — the classic threshold; metropolis floored at 40,000 — Uruk at its height" |
| TIER_BRANCH | 4 | city bar = K × median settled census | "each city serves ~3-5 towns (the Christaller branching band), use 4 — a structural constant of market geometry" |
| URBAN_SHARE_REF (referenced) | ~5% | pre-industrial urban share in the city-mint bar | "measured in this sim (core share p50 4.6-5.6%…) and historically (~3-8% urban before industry)" |
| TRIBAL_CENSUS (referenced) | 10 census (~10,000 people) | land-nation formation bar | "the complex-chiefdom band from the anthropology literature" |
| DISSOLVE_CORE | 0.2 | dissolve bar as fraction of city bar | owner hysteresis: mint at 10k, dissolve at 2k = TIER_CORE[1]; post-Roman Britain cited (Silchester, Wroxeter) |

### 1.5 Agronomy, crops, land

| Lever | Default | Meaning | Grounding |
|---|---|---|---|
| DEV_FIELD wave speed (internal) | on | technique wave-of-advance **~1 km/year** | "the measured Neolithic rate, resolution- and granularity-invariant" |
| DIFF_CLIM | 0.8 | climate toll per hop on the farming wave | "~0.8 ≈ crossing the Sahara costs ~a third of a full package" — Diamond's axes emerge |
| INVENT_EPOCH_Y (referenced) | 6,500 y | span of independent farming origins | "real origins span ~6,500 years, Fertile Crescent ~9500 BC to the Sahel ~3000 BC" |
| EPOCH_YD | 1 | t=0 = **9700 BCE** | "the end of the Younger Dryas… the Holocene's opening"; cosmetic only (audited: no mechanic reads any epoch) |
| CROP_MILLET (package values) | 1 | millet tOpt 0.84, mOpt 0.32, storability 1.00, domLag ~1,500 y | "THE ancient Chinese granary/tax staple… archaeobotany-class values"; Cishan/Xinglonggou |
| CROP_PHOTOPERIOD | 1 | prehistoric maize tTolEarly = 0.055 (< wheat) | maize's day-length binding — "reached productive cultivation in eastern North America only ~900 AD"; direction evidence-backed, exact figure explicitly not asserted |
| GROW_SEASON | 1 | cool/warm-season split at tOpt 0.80 ≈ 18 °C | "the one new constant, a real agronomic boundary"; NCEP monthly temps already loaded |
| MOIST_FLOOD_FED (referenced) | 0.5 | moisture floor on arid floodplains | basin irrigation stores the flood (Egypt's winter wheat on the summer flood) |
| IRRIG_ARID0 | 0.52 | aridity threshold for irrigation lift | "Nile ~0.34, Euphrates ~0.45 sit below it; the rainy Mediterranean belt (~0.50+) doesn't" |
| ALLUVIUM | 2.0 | floodplain silt grain multiplier | the black land; every first cradle |
| IRRIG_BOOST | 1.5 | arid-river irrigation head-start | managed-river productivity per acre |
| FIELD_CRADLE (internal ratios) | 1 | arid-river maturity ×7.5, wet-river ×3, dry inland ×1 | "×7.5 = the settlement stack at parity… the regional peak inequality history had" |
| LAND_WORKS | 2 | max works multiplier on crop capacity | "2 ≈ the historical irrigation premium of fully-improved over rain-fed land; wet-rice systems ran higher"; works rot on ~2-century half-life when unstaffed |
| MIXED_FARM | 1 | manure+traction channel | "fields carrying animals out-yielded animal-less cultivation by roughly a factor of two" |
| LIVESTOCK / LIVESTOCK_FOOD | 0.35 / 0.012 | husbandry lift / pastoral calories | Diamond domesticate geography; herd as famine hedge |
| TILL_HEAVY / TILL_TROPIC | 0.55 / 0.40 | pre-plough workability floors | LBK on the loess vs cage-grade surplus waiting; "lower… because the constraint bound longer (Bantu iron-age expansion vs the medieval plough)" |
| LAND_CLEAR_METAL | 0.55 | metallurgy to clear hardwood | bronze/iron axes |
| SOIL_* family (EXHAUST 0.5, ARID_FRAG 2.0, BASE_FRAG 0.06, GAIN 0.1, RECOVER 0.99, ROTATION 0.7) | — | salinisation gradient | "southern Mesopotamia never recovered"; rotation ≈ 3× slower exhaustion; calibrated to the Bronze–Classical span |
| AGRI_FORAGE_YIELD | 0.15 | hunter-gatherer fraction of farm yield | ~1/7 of developed density |
| FISH_PER_CAP | 0.012 | one fisher's virgin-water catch | feeds 4 at the civilian ration; "the ~1.5-2.5 t/yr the richest real inshore fisheries landed per man" with sail-era technique; re-anchored from 0.024 (first spec was 5× the historical anchor) |
| FISH_MSY | 12 | MSY per rich ref coastal tile | "~167 km of the world's richest coast feeding ~4,000 people at MSY: the Lofoten-cod / North-Sea-herring scale"; physical band 8–16 |
| FISH_REGEN | 0.10/tick | ≈0.40/yr logistic regrowth | "surplus-production r ≈ 0.3-0.5/yr"; virgin capacity C = 4·MSY/r — "the two constants are one fishery, not two dials" |
| FISHER_MAX | 0.25 | max boat-labor share of population | full fishing village's adult boat labor |
| COLD_FISH | 0.6 | sea-ice catch cut, 0 °C → −10 °C ramp | ice-free season length |

### 1.6 State, tribute, war

| Lever | Default | Meaning | Grounding |
|---|---|---|---|
| TRIBUTE_RATE (referenced) | 0.10 | field-tribute tithe | "the historical floor of harvest taxation; Egypt ran ~0.20"; extraction 0.3 flat chiefdom → 0.3+0.7·org realm ("bureaucratisation TRIPLES the take") |
| TRIBUTE_UP | 0.33 | in-kind share remitted up the pyramid | "Ur III's bala rotation, the Achaemenid grain levies — roughly a third of the provincial take went to the center. Def 0.33 = the historical third" |
| COURT_REACH_REF (referenced) | 12 ref-tiles ≈ 2,000 km | court-exchange expedition reach | "the Byblos run" |
| COURT_RATIO_METAL / PRESTIGE (referenced) | 80 / 240 grain per unit | customary court-exchange ratios | "the Mesopotamian barley-metal equivalency band, order-of-magnitude" |
| CRAFT_FLOW (referenced) | ~1/6 of subsistence flow | village craft output | "village specialisation is part-time and seasonal"; Vinca smelting ~5000 BCE, Varna ~4500 BCE, Uluburun cited |
| RECORDS_ORG (referenced) | 0.35 | writing bar = statehood bar | "the Writing tech's organization gate ('record law, tax and myth')… asserted equal to the tree so they can never drift"; Uruk ~3200 BC arrives with the tablet |
| URBAN_ORG (referenced) | 0.28 | Tallies & Seals bar for city mint / land-nation declaration | "token accounting, the institution that ran Uruk's granaries before script" |
| ORG_STATE_MIN | 0.15 | statecraft to mint a territorial state | band/tribe/chiefdom worlds below it |
| MIL_REVOLUTIONS (multiples) | 1 | bronze→iron 1.84×, iron→pike-and-shot 1.97×, musket→rifled 1.75×, full gunpowder over iron 2.7×, iron→rifled 4.8× | "each armament REVOLUTION… multiplies… by its characteristic battlefield dominance (~1.5-2.5× per full revolution, compounding)"; Plassey-class asymmetries |
| SMALL_WAR | 8 | police-action power ratio | "derived, not tuned: a detachment of ~1/4 of your forces at ~2× storm superiority handles any foe ≤ 1/8 your weight" |
| COLLAPSE_SCAR | 0.7 | org lost per palace-dependence on shatter | "the Late Bronze Age reference severity — Linear B literacy died with the Mycenaean palaces"; 0.35 measured under-dosed |
| GRIEV_LEDGER (half-life) | on | ~120 dyn-years (~two long generations), ~3× faster between allies | reconciliation |
| LOYAL_FIELD (rates) | on | foreign ruler habituation ×0.15; assimilation completes at attachment ≥0.9, ~1000–1500 dyn-years median | replaces the flat HOMELAND_MEMORY timer with the same median band and real tails |
| CONSCRIPT_FRAC | 0.12 | max war levy | "~an eighth of its people under arms" |
| ARMY_LABOR_FOOD | 1.0 | harvest loss ∝ mobilized share | "mobilise 15% of your people and lose ~15% of your harvest" |
| MANPOWER_FRAC / MANPOWER_REGEN | 0.15 / 0.03 | trained-reserve ceiling / ~a generation to refill | demographic war-weariness |
| CAGE_FLIGHT_FREE (referenced) | knee at ~20% free capacity | Carneiro pressure knee | "the knee is Carneiro's own text ('all the readily arable land was occupied')"; bracketed by a measured ladder (chronology error 70% closed) |
| ABSORB_STEP | 0.15 | contact absorption window (~one tech rung) | Meiji-Japan literate catch-up ×3 |
| K_MIN_VIABLE (referenced, via VIABLE_UNITS) | 8 **people** | viability floor | re-grounded from a unit-stale 8,000; the 2,000-person borough and the polis become possible |

### 1.7 Money and fiscality

| Lever | Default | Meaning | Grounding |
|---|---|---|---|
| SEIGNIORAGE_RATE | 0.05 | state's cut of coined specie | minting as a state act |
| CREDIT_MAX_MULT | 2.0 | fractional-reserve ceiling | Venice/Amsterdam bills-of-exchange |
| MODERN_FISC | 0.15 | income-tax rate at full industrial gate | "lifting extraction from the medieval few-% of output toward the ~40-50% of GDP a modern state commands" (rate itself calibrated) |
| COIN_LOSS_RATE | 0.0004 | wear/shipwreck/hoard drain | "calibrated so the total supply ≈ its old level" — honest micro-sink but calibrated |
| GT_BULK (referenced, GOODS_FREIGHT) | ore 3×, materials 2.5×, cloth 0.5×, luxury 1/15 | freight by value density | von Thünen; "kept stone local, grain regional, and sent silk across the world" |

### 1.8 Worldgen physical parameters (src/paramDefs.js — carry the grounded subset)

paramDefs.js holds **75 params** in 7 groups (Plate Layout 8, Continent Shape 16, Mountains 12, Moisture 10, Hydraulic Erosion 8, Wind & Pressure 18, Land/Ocean 3), with the contract that `def` MUST match the code defaults in tectonicGen/windSolver/moistureSolver ("a mismatch means touching a slider at its shown default silently changes the world"). Most are shape dials; the physically grounded ones:

| Param | Default | Grounding |
|---|---|---|
| moistSubsidenceLat | 28 | "Earth's deserts cluster at ~28°" (Hadley descent) |
| moistRecycling | 0.25 | "Amazon recycles ~40% of its rainfall" |
| coriolisStrength | 0.406 | 2Ω·sin(φ) planetary deflection |
| oceanDrag | 0.018 | "sets the cross-isobar angle (~15° at default)" |
| landDrag | 0.102 | "Real Earth: land drag is ~3-5× ocean drag" |
| contContMaxDist | 60 cells | "60 ≈ 1300 km" (Himalaya-class plateau extent) |
| contOceanMaxDist | 25 cells | "25 ≈ 550 km" (Andes-type coastal ranges) |
| windAltitude | 0.045 | elevation-to-metres mapping documented (0.02 ≈ 175 m, 0.10 ≈ 885 m, 0.50 ≈ 4,400 m) |
| gustThreshold | 0.095 | "at 0.15 ≈ 15 km/h" |
| seaLevel | 0.67 | ocean fraction percentile (Earth ~0.71) |

---

## 2. MODEL-SELECTION FLAGS

**156 strict binary [0/1, step 1] flags: 151 default ON, 5 default OFF** (URBAN_PRINT, FISH, IDEA_FIELD, MARGINAL_HOLD, LABEL_BIRTH). Beyond those, ~30 graded levers are master-weights of a whole mechanism family whose 0 recovers the legacy model byte-identically (listed in 2.11). 70 descriptions carry an explicit "FLIPPED ON/DEFAULT" record; 183 state a byte-identical off-path; 128 record measurements. Column key: **Winner** = current default side; **Loser** = what 0 (or the legacy value) recovers; **Evid** = measured evidence recorded in the desc (Y = quantified A/B or battery; part = directional/partial; N = none recorded).

### 2.1 Field ontology (the architecture selectors)

| Flag | Winner (def) | Loser | Evid |
|---|---|---|---|
| FIELD_POLITY | 1 — political map (_countryOwner) is authored persistent state; countries expand tile-by-tile; settlement countryId derived from ground | entity model: countries = settlement sets projecting claim bubbles | Y — fixes "settlement-quantized politics" class (docs/field-polity-spec.md) |
| POP_FIELD | 1 — per-tile capField/popField, logistic growth, capacity-gradient migration, hold-capacity from governed field | legacy settlement model (byte-identical recovery) | Y — "runaway megastate is gone (top empire ~halved), more countries in a tighter band, Europe fractures"; stylized 3/3 |
| DEV_FIELD | 1 — capacity reads technique that REACHED each tile (Neolithic wave ~1 km/yr) | one global scalar ("population map read as livability") | Y — civilized-vs-frontier contrast emerges |
| FIELD_DEMOG | 1 — plague/famine/sack/captive events mirror onto the land field | field only grows and migrates | part — honest limit recorded: one-off dents refill in a few dyn-years at phase-1 rates |
| ONE_POP | 1 — field owns demography; census a derived read; urban spike = economy beyond land; frozen unit bridge | census keeps its own logistic | Y — owner ruling; shipped with URBAN_AGGLOM 0.13/URBAN_GAMMA 0.5 |
| ONE_BOOK | 1 — market ledger bills market-fed core (min(people,_urbanPop)) | whole-catchment billing (1/6–1/8 production:demand planet-wide, permanent pseudo-famine) | Y — v45 battery 0/0/1 warnings |
| SHIP_SURPLUS | 1 — farm gate offers pool − own need | SHIP_FRAC_BY_TIER tier slices (offers "two orders short") | Y — v45 |
| FOOD_K (graded 0..1) | 1 — worked-land capacity from the real food ledger | proxy formula (0.5 = the 2026-07-24 half-blend) | Y — "best urban rank-size structure on record" |
| TILE_POLITY | 1 — only the capital anchors territory | every settled tile anchors | Y — stylized 3/3, largest-share 8–14% |
| CITY_HOLD | 1 (v57) — every settled member anchors like a capital | capital-only anchoring | Y but **adverse**: 2026-08-24 arms measured RED (anchor deaths 19→34, churn 49→99); flip order held, then flipped in v57 after LEAN_YEAR fixed the overmint base |
| CATCH_GRACE (600) | worked tiles survive border mismatch ~4 territory passes | instant release | Y — same red-then-v57 history as CITY_HOLD |
| CATCHMENT_CLIP | 1 — economic catchment clipped to own borders, purely reactive | catchment floods freely and creates borders | N (design argument) |
| CATCH_WILD | 1 — a realm's villages farm adjacent wilderness | statehood confiscates the village's wild fields (an encoding accident) | Y — cuts the measured size death-loop |
| FIELD_ADMIN | 1 — territory priced in admin units, 1 + d/ADMIN_HALF | flat tile pricing | Y — compactness 0.3→0.05 pathology without it |
| FIELD_NAVAL | 1 — admin walk traverses sailed water at nav-gated cost | water is a wall | N (mechanism argument; requires FIELD_ADMIN) |
| POW_FIELD | 1 — coercive power = governed field people × court tech | Σ settlementPower over roster | part — median-anchored swap |
| PROV_FIELD | 1 — provinces weigh governed people | city census | part — "realm counts/coverage healthy on both probe seeds" |
| MUSTER_FIELD | 1 — manpower from governed people | census sum | part — validated with PROV/BIRTH_FIELD |
| BIRTH_FIELD | 1 — founding viability = stateless basin field mass | summed censuses of nearby towns | part |
| NOMAD_FIELD | 1 — nomad = court rides + majority of governed people on saddle-country | seat-tile test | Y — old test measured dead ("0 hordes in 24k steps on 2 seeds") |
| LOYAL_FIELD | 1 — allegiance/homeland memory on tiles; emergent assimilation | roster-anchored, flat HOMELAND_MEMORY timer | N (design) |
| GRIEV_LEDGER | 1 — national grievance ledger with ~120-dyn-yr half-life | no ledger | N |
| CONTROL_FIELD | 1 — render-only control-field borders | recompute crawl drawing | N (render-only) |
| URBAN_FOOTPRINT | 1 — fixed real-area urban core disk | single-tile core (urban share resolution-dependent 33% vs 10%) | Y |
| ORGANIC_TAKE | 1 — territorial takes gather people nearest-first | FIFO tile BFS (diamond borders) | Y — owner screenshot diagnosis |
| URBAN_PRINT | **0** — conservation (cores drain the countryside) | 1 = diagnostic: cores printed, not drained | N — explicitly "NOT SHIPPED PHYSICS", an A/B instrument |

### 2.2 Register / city ontology

| Flag | Winner (def) | Loser | Evid |
|---|---|---|---|
| DISSOLVE_FARMS | 1 — no tier-0 farm-region entities; towns smallest, auto-farmed countryside | legacy farming-region entities | part (docs/farming-region-dissolution.md) |
| DISSOLVE_TOWNS | 1 — entities mint only where basin feeds a ~10k core at ~5% urban share (~200-census basin); thinned basins fade back | pre-flip "230 cities and large towns" register | Y — register 76→42 at 6k, first city same emergent moment, 16k arc keeps statehood shape; first build measured inert (TOWN_BASIN_MIN a fossil floor 143–3300× below real basins) |
| DISSOLVE_CORE (0.2 graded) | core sustained under 0.2× city bar dissolves (2k floor) | basin-only dissolution law (husk cities immortal) | Y — core p50 117k vs fedM p50 0.33 measured; 1.0 was the churn engine (v55 hysteresis) |
| CITY_AT_BIRTH | 1 — no entity below the city definition; proto-urban stage in the land (URBAN_DRIFT) | mint at city-capable basins wearing village/town labels | Y (Uruk village-to-40k over ~900y argument, measured arcs) |
| CITY_CORE | 1 — tier ranks _urbanPop against absolute core definitions 2/10/40 | catchment ranking + percentile bars | Y — re-rank alone measured insufficient (26 hamlet-cored "cities") |
| CROWD_FOUND (graded 0..2) | 1 — founding rate × √(basin people / age-typical basin), cap CROWD_CAP | flat rate (threshold only) | Y — first build measured degenerate (normalized by the fossil bar; foundings +85% purely by infill) |
| MINT_RESIDUAL | 1 (v57) — mint bars read unmarketed countryside only | gross basin disks | Y but **near-inert**: "turnover 385→342… the exclusion is huge… and STILL passes the bar everywhere" |
| MINT_REACH | 1 (v57) — city bar must hold within newborn's day-one reach | subcontinental pricing only | Y but **inert**: "this bar is a SATURATION DETECTOR… The register equilibrates at pie/bar with or without it" |
| LEAN_YEAR | 1 — founding priced at the basin's own bad-year margin; dissolve stays 1× | good-year founding (Malthusian-minimum packing: "~50 clone cities in bronze Egypt where history held 5-10") | Y — flat-margin regime won the Egypt referendum (turnover 375→93) but hard-failed seed 777; per-basin form released 777 "by physics" |
| HARVEST_YEARS | 1 — AR(1) annual regional harvest layer; famine derived from the tail | scripted famine dice (FAMINE_CHANCE roll, aimed seed, flat severity) | Y — full battery, 11/12 regions in band |
| ARID_SECURE | 1 (v57) — water-fed arid land priced by the mixture (both halves) | composite cv everywhere ("Mesopotamia p50 5.0× — priced out of civilization") | Y but **gate-red at flip time**: "777 reads 19 settlements vs the alive floor… NOT default-able as-is"; flipped v57 regardless |
| CITY_STORE | 1 (v58) — mint requires city-basin of people on storable-capable tiles | census+technique only | Y — three dead forms recorded; measured-and-blocked earlier ("prophylaxis, not the cure"), flipped v58 "on-or-gone" |
| VIABLE_UNITS | 1 — K_MIN_VIABLE read as 8 people | 8,000 people (unit-stale pair; "8.00su mode holding 36.5% of the register") | Y — mode replicated to a tenth of a point in the float-epsilon twin |
| STAMP_RETIRE | 1 — no 12k founding floor; city worth what its economy holds | _coreHoldCapF floors capacity and size forever (37–45% of register at exactly 12.00su) | Y — hard dependency on AGGLOM_LOCAL (else re-opens the birth crater, census 457→20) |
| CORE_LOCAL | 1 — a city may eat its own hinterland's surplus (size read gains kLocal) | imports the only door to being urban (the "12k sludge" closed loop) | Y — urbanisation 2.26%→5.55%, metropolises 7→46; **`npm run validate` is a literal no-op for this lever** |
| AGGLOM_LOCAL | 1 — concentration pull on whole economy s._k | import-fed slice only (self-fed city gets uTarget 0) | Y — makes URBAN_AGGLOM 0.13 physically meaningful |
| URBAN_LABOR | 1 — farm output scales with the rural share (no constant) | urbanites farm as if in the fields (28.21% urban runaway vs 6.06%) | Y — pre-registered prediction honored |
| URBAN_FOOD_GATE | 1 — agglomeration flux capped by projected food coverage | pull regardless of food | N (zero-new-constants design) |
| HOLD_SEAM | 1 — mint hands the capacity spike over; floor engages pre-catchment | two measured leaks (65-tick floorless window) | Y |
| CORE_HOLD | 1 — mint stashes site-law bound; capacity holds what arrived | handoff drops pile to bare terrain (census 457→20 crater) | Y — found by probe after two suspects measured inert |
| STARVE_SHED | 1 — hold floor scales with sustained fed-ness | food-blind floor (starving stone-age "metropolis" growing past 100k) | Y |
| FED_FAMINE | 1 — famine base = min(census, urban core) | whole-census famine (killed subsistence villagers; basins to 0.25–0.27×) | Y — v1 (_fedPeak ratchet) measured defeated and recorded |
| FOOD_REACH | 1 — ledger's writ over countryside = administrative reach (levy org ramp) | border-is-economy (tile capacity −45% in one tick at annexation) | Y — famine channel proven inert first |
| SEED_EXCLUSIVE | 1 (v57) — newborn seed box skips owned tiles | ownership-blind seed box (9.8% world harvest inflation) | Y but **refuted at tw=960 twice** (small-state tier 36%→0%/9%, lnσ 2.68→0.92/1.12) and held at 0; flipped v57 with the stack |
| LABEL_BIRTH | **0** — spacing-quantum label supply | 1 = market-site ledger from the drainage/coast skeleton (resolution-invariant candidates ±5% across grids) | Y — known limit: "~47% of the mature demand texture is diffuse rain-fed interior the skeleton does not host" |
| PEER_LATTICE | 1 — a claimed cell stays open while its people could feed another core | one label per cell forever (capitals never <416 km apart) | Y |
| PEER_SEATS | 1 (pinned 0 in harness) — peer gathering sites inside claimed cells | one court per cell | Y — 66 seats over 1,225 justified slots measured |
| FISH | **0** — no fish calories at all (owner directive 2026-08-14) | 1 = full fishery physics (pre-v19 saves pin 1) | N — directive, not measurement |
| FISH_LABOR | 1 — Schaefer/Graham labor+stock fishery | Tier-A flat-cap formula | Y (docs/design-food-economy-wave.md) |

### 2.3 Food market and haulage

| Flag | Winner (def) | Loser | Evid |
|---|---|---|---|
| GRAIN_MARKET | 1 — open cross-border peer grain market, coin-gated, seller price, spoilage physics | tree-only (child→liege) grain; importShare 0.00 planet-wide | Y — importers 3→175, fed(leaf) p50 0.08→0.58 |
| GRAIN_BID | 1 — buyers ranked by scarcity price | founding-order queue ("oldest city served in full first"; top 3 importers 42% of landed grain) | Y |
| GRAIN_PROVISION | 1 — annona: buy deficit + granary refill at own-mouth pace | deficit-only buying (self-sufficiency trap) | Y — peer-buyers 272/482, Egypt fed 0.24→0.58 |
| GRAIN_FREIGHT | 1 — buy at the farm gate, road eats the loss | free road (median market haul 965 km vs history 20–100 km) | Y |
| HAUL_PHYS | 1 — 340 km land e-fold, ×12 water (real km) | FOOD_HAUL_RANGE=14 tiles = 2,338 km e-fold ("arrive ≈ 1 between any two points on the planet") | Y |
| HAUL_PAID | 1 — deletes FOOD_RANGE_BY_TIER destination-label multiplier | tier ratchet leg 1 | Y — mean core crossed the metro bar and urban share 8.79%→15.57% in one window under CORE_LOCAL |
| MARKET_PULL | 1 — catchment is the outcome of a bid (hunger × ability), Dijkstra with bid seeds, roads price carriage, owned land re-contested | area allowance + straight-line geometry (reachBudget max/p50 1.02–1.05: "no live size term at all") | Y — three named defects each verified; retires reachBudget/ORG_REACH/TERRITORY_BASE/CORE_BY_TIER/HINTERLAND_BY_TIER/GRAIN_PRICE_BY_TIER/FARM_RES |
| MARKET_PAY | 1 — offer = min(willingness, ability) | hunger-only ("a broke starving city yanked farms it could not buy") | N (calibration argument) |
| MARKET_FARM_HOLD | 1 — incumbent tiles keep last haul cost until a rival wins | instant cost reset (granary-death chain: landFood cliffs to 0) | part |
| LAND_SURPLUS | 1 — implied countryside eats first; only surplus enters the bid pool | gross harvest credited | N (same subsistence constant reused) |
| TILE_MONEY | 1 — grain coin lands on the selling tile; land tax/rent/tithe on tiles; tile coin boosts founding | seller.wealth + settlement levy | N (phase record only) |
| PRICE_GROSS | 1 — scarcity price denominates supply + prev exports (books agree) | retained-net price (exporter reads as short — would runaway under the bid rule) | part |
| GRANARY_SPOIL / CLIMATE_SPOIL | 1/1 — stores rot; climate scales all grain-loss channels | infinite buffers / climate-blind | N (historical bands cited) |

### 2.4 Genesis, dawn, agronomy

| Flag | Winner (def) | Loser | Evid |
|---|---|---|---|
| DAWN_LIVE | 1 (pinned 0 in harness) — open at the true dawn, farming invented live | DEV_INIT_YEARS 6000y pre-run with seeded hearth settlements | part — genesis suite is its battery |
| INVENT_JUMP | 1 — genesis solves the invent clock, opens at first city held to live mint bars | watch invent on camera (0) | N (no calendar enters; v63 extension) |
| DAWN (0.35 graded) | genesis field at 0.35 of Malthusian equilibrium ("≈ the 3000 BC condition") | 1.0-equivalent cold start at threshold (universal early boom-bust = cohort effect) | Y — realm ramp / deaths / abandonment ladder measured |
| STATE_OF_LAND | 1 — tribal land-nations without cities (TRIBAL_CENSUS 10) | nations require settlements | part — audit found 25+ court-presupposing reads, hence out of world.countries |
| STATE_RECORDS | 1 (pinned 0) — de-novo statehood needs RECORDS_ORG 0.35 | nations at any knowledge ("full nations… in the STONE age") | Y — falsification arm run |
| LAND_KNOW | 1 (pinned 0) — pre-urban knowledge ledger on the land; URBAN_ORG 0.28 mint/declare bar | knowledge grows on entities from birth | part |
| BASIN_IGNITE | 1 — invention seeds the whole peopled clock-disk | single-tile ignition (China state lag ~2,750y, 2–4× history) | Y — per-predicate probe |
| INVENT_STAGGER | 1 — hearth maturity T = 6500y/cradleScore | all hearths seed at t=0 equally old | Y — but the 2026-08-03 defaults-flip attempt reverted (resgate 0.40 vs 0.42) — flag on but EARTH pins still active |
| CAGE_FILL | 1 — cage drive × Carneiro pressure (fill through the flight knee) | pressure-blind drive (Neolithic compressed 3.4×) | Y — ablations convict the cage drive as the entire pre-urban org engine; knee ladder measured |
| EPOCH_YD | 1 — epoch −9700 | −5250 legacy epoch | Y — cosmetic both directions, audited |
| CROP_AXIS | 1 — concrete crop packages, emergent continental axis | AXIS_BIAS proxy on agriculture | part (Wave 3 screen) |
| CROP_BIOGEO | 1 — packages compete only where they have REACHED (climate-tolled geodesic from origins) | climate-only competition (maize domesticable in Egypt) | Y — flip WITH IRRIG_CROP |
| IRRIG_CROP | 1 — flood-fed fields read the river (moisture floored at MOIST_FLOOD_FED) | rain-only crop moisture (Mesopotamia wheat ~0) | Y — "the two levers flip TOGETHER or not at all" |
| CROP_MILLET | 1 — millet its own package, N-China origin | combined sorghum-millet Sahel bell (China last Old-World cradle) | Y |
| CROP_PHOTOPERIOD | 1 — prehistoric maize latitude-bound | modern maize envelope (maize took 7 of 10 hearths) | Y (direction) |
| GROW_SEASON | 1 — packages evaluated on their growing season | annual means (every cereal cradle read as maize land) | Y — Mesopotamia wheat 0.23→0.48; honest limit recorded (sorghum wins raw suit) |
| CRADLE_PACKAGE | 1 — cradle placement × suit·storability | package-blind placement (Tarim outscored the Nile) | Y |
| INDEP_TECH | 1 — founding channel scaled by devField arrival | ungated diffusion gradient (steppe town at step 24, 61°N by 144) | Y — three measured failures aimed it |
| IDEA_FIELD | **0** — devField stays a max-ratchet | 1 = the land can forget (dark ages visible to capacity) | Y — measured ON, but seed panel found only abandonment-timing consistent; trend inverts across grids; **settled by the panel: stays 0** |
| EARTH_HEARTHS | 1 — historical Old-World pins on Earth maps | algorithmic top-10 scorer | N (product choice) |
| MULTI_HEARTH | 1 — pins pre-load the scorer instead of capping it; scorer fills the rest of the planet | pins exclusive (~60% of land devField 0.000 forever) | Y — rides CRADLE_MIN_SEP real-distance fix + deflation guard |
| TILLAGE | 1 — workability gate (light/dry+flood free; heavy/tropic ramp with devField), lap 2 in the capacity kernel | climate-only suitability (−1500 states on Scotland/Gabon) | Y — lap 1 ships-at-0 resgate red recorded, lap 2 shipped |
| CANOPY_CLASS | 1 — mechanics read the Köppen-calibrated canopy mask | raw moisture ramp (Britain 0.46 vs Mesopotamia 0.45 on one scale) | Y — one replicated effect (temperate Europe thins both seeds), rest recorded as noise |
| FLOOD_OPT | 1 — managed water clamps to the crop optimum on arid floodplains | symmetric bell punishes irrigation as overwatering (suit 0.27–0.37 at a perfect winter temp) | Y — two dead alternative forms recorded |
| ACCESS_BAND | 1 — waterside premium over one reference tile of real width | per-tile 1-D read (the 1.3–2.2× resolution dilution) | Y — +2.9%/+16.6% repair measured; ratchet re-baselined |
| BAND_SUM | 1 — band overlap sums under a saturation cap | max-over-sources (deleted 27% river / 10% coast mass) | Y — capacity dilution 0.705→0.953 |
| IRR_BAND | 1 — works stock reads banded rmEff | raw 1-tile river line | Y — lap-1 ships-at-0, then floors re-derived blind and re-fired at def 1 |
| FIELD_CRADLE (graded) | 1 — capacity field gets the irrigation+alluvium stack | road-only access premium (the flat field: "28% of people on the worked 9% of land where history put ~80% on ~10%") | Y — pre-registered win metrics |
| FOREST_LOCK (graded 0.8) | canopy locks agrarian capacity until axes | canopy-blind capacity (stone-age Europe at half-mature farm density) | Y — re-measured, replicated effect is its claim |
| RES_INVARIANT_POP | 1 — distances ×rNorm, area sums ÷rNorm² | tile-unit behaviour (~2.1× pop inflation per 2× resolution; 18B at Medieval) | Y |
| BRIDGE_GLOBAL | 1 — census↔field bridge measured on global totals | per-catchment median (bridge inflates 3.15× across grids via feedback) | Y — "Do not run this lever without TIER_BRANCH" |
| RES_INV_RIVERCOST | 1 — river travel classified over real distance | tile-line classification (cost field dearer on finer grids) | Y |
| RES_INV_RIVER | 1 — water-access scan over real distance | fixed 3×3 (at 1920: realms 12→22 recovery) | Y — 30k windowed 4-way battery |
| TECH_USE | 1 (pinned 0) — 13 techs carry ecological enablers (draft/water/river); known ≠ used | discovery is use ("a tsetse-belt court ploughed like France") | N (historical argument) |
| TECH_EFFECTS (graded) | 1 — discrete techs grant the bonuses | continuous-knowledge formulas | N ("calibrated so the two match at full tech") |
| ORG_APTITUDE | 1 — heritable winter-aptitude trait | off | N |
| PEER_COMPETE | 1 — competition counts independent peers, network members zero | any-flag count (hegemony invisible to the learning law) | N (structural argument) |

### 2.5 Politics: birth, absorption, consolidation

| Flag | Winner (def) | Loser | Evid |
|---|---|---|---|
| BORN_OF_LAND | 1 — birth on realm ground joins the realm | sovereignty as the `??` birth fallback (0% joined; 1,352 cities → 1,186 realms) | Y — live arm 96% join |
| SEAT_FIELD (0..2, def 1) | 1 — seat-size bars retired; basin decides (NUCLEATE_SEAT_POP unreachable) | 0 = city-earns-statehood bars; 2 = re-ground the self-founding path too (measured worse: realms 32→26) | Y — re-measured ladder, flip at rung 1 |
| PEER_POLITY | 1 — control (claimed tiles) is the whole exclusion | NUCLEATE_CAP_DIST 1,000-km isolation disc (lnσ 0.85 vs real 2.0–2.6) | Y |
| PLANT_EARLY | 1 — plantation bar relative (≥2.5× townBar) | absolute 500-census metropolis gate (channel dormant to ~25k) | Y |
| FRONTIER_FOUNDING (graded) | 1.0 — frontier crystallisation on | 0 = secession-only births | N |
| VALLEY_UNION | 1 — kin corridor courts merge crowns (personal union) on succession crisis | frozen confetti (multiCityRealms=0 whole run) | Y — crisis gate measured in (wars 7→23 ungated) |
| SATRAPIZE | 1 — mature suzerain integrates aged vassals as provinces | bonds are forever (blocs cap at 4–5; top share 38%→4–6%) | Y |
| VASSAL_SHIELD | 1 — bond gates peaceful absorption + enclave vacuum | overlord digests its own vassals | N (historical mosaic argument) |
| ABSORB_ORG_ERA | 1 (pinned 0) — bar = era's upper-third org quantile | absolute ABSORB_ORG_MIN floor ("a TIME-GATE BY PROXY… above the world MAXIMUM" at first statehood; 66/66 rejects) | Y |
| ABSORB_PEER | 1 — bar = does the client court out-organize yours (stateOrgBar floor) | 67th-percentile bar in a converged world ("a float-dust lottery"; spread 0.001) | Y |
| SEAT_ADMIN | 1 — satrapy law: self-governing city members price distance ≤ SUBMIT_REACH; + the hasAbsorbHeadroom ordering fix | projection-priced provinces (bimodal DIST; "a WALL at ~5 members") and an unevaluated fiscal gate (0 evaluations in ~10,000 candidates) | Y — two halves ship as one lever by measurement |
| COURT_SPHERE | 1 (v58) — only flagged settlements radiate the caravan sphere | every dot radiates (urban contagion with no polity) | part — "on-or-gone despite a null A/B at tw=480" |
| FEAR_REACH | 1 (pinned 0) — top-24 powers cast threat over SUBMIT_REACH radius | border-adjacent fear only (interior statelets never candidates) | N (diagnosis argument) |
| ENGULF (graded 8) | encirclement × share² multiplies submission hazard | encirclement invisible | N (San Marino/Andorra argument) |
| ENGULF_BAR (graded 8, pinned 0) | encirclement lowers the submission BAR too | bar ignores encirclement (11 of 20 interior blocs held free at 1.4–4.9× vs the 5× bar) | Y |
| SUCCESSOR_STATES | 1 — restoration/successors/witnessed shed | silent lapse to wilderness (99.86% of released land, 0 secessions/24k) | Y — including the third-rule scar (validated where it does nothing) |
| SIZE_BY_POP | 1 — population-core + logistics-march target | COVER_BASE+COVER_ORG floor ("nothing smaller than Egypt can exist") | Y — B2 re-grounding deleted the world._sizePopK planetary anchor (×8–11 oscillation) |
| SIZE_WORKED | 1 — base includes people the economy reaches beyond the border (stable fixed point) | held-tiles base (pure proportional feedback, "bistable at every setting") | Y — k trajectory measured |
| MARGINAL_HOLD | **0** — quota model | 1 = per-tile viability test at the margin | N — built, unflipped; MARGIN_FRAC waits on it |
| CAP_MODEL | 1 — grounded fiscal-logistic dominance | "the FITTED great-power-tail shape — CAP_DOM_W·(relPower−1)^CAP_DOM_P (W=0.9, P=1.5, a curve-fit exponent)" | Y — 3-seed validation; hegemon share 23%→33% |
| CAP_RELATIVE | 1 — capacity vs the era's median capital | fixed absolute base (global inflation raised every capacity ×20–40) | Y |
| HOLD_ARMY | 1 — provinces held by military suppression | economic outweighing (late-game honeycomb) | N |
| PERSISTENT_TERRITORY | 1 — **UNREAD under default FIELD_POLITY** (legacy-only) | stateless reach-Voronoi | — audit 2026-07 |
| TRUCE_TRADE_OWN | 1 — interdependence = pair's share of its own commerce | median-referenced tautology (median pair = 0.500 exactly, every era, by construction) | Y — halving truce length nearly doubles conquest |
| CAPITULATE | 1 — deditio: lost wars end in tributary dependency | pure truce table ("victory reset the board and no serial conqueror could exist") | Y |
| WAR_FINISH | 1 (pinned 0) — fed garrisons via the field, urban walls/cores, relative seat grade, siege lift/storm laps 5–7 | ledger-fed armies ("90-97% of settlements 'starving'… every garrison on Earth melted"; storm 7 falls in 11,597 attempts) | Y — shipped after laps 5–7 with four-world battery |
| SMALL_WAR (graded 8, pinned 0) | police actions bypass command slots below pow/8 | every war a command slot (giants refuse 61% of attack-capable moments) | Y |
| RELIEF_REACH | 1 (pinned 0) — coalition backing weighted by relief reach | pooled-scalar deterrence (paper coalitions braked 10,697 pair-passes/window) | Y |
| VASSAL_LEVY (graded 0.5, pinned 0) | dependencies march (reach- and loyalty-decayed, debited) | metropole fights alone (4,018/4,318 sieges assaultTooWeak) | Y |
| MIL_REVOLUTIONS | 1 — multiplicative armament transitions | flat additive channel (whole Stone→Modern span 1.0→3.35×; gunpowder below the attack bar) | Y |
| SIEGE_STARVE | 1 — sieges won by hunger (granary is the clock) | unstormable citizen-militia floor (370/370 failed) | Y |
| REACH_GROUND | 1 — zero-tech reach ≈ a day's country | ~800-km no-tech hold radius (median newborn realm 440–565k km²) | Y |
| FISSION | 1 — polities reproduce by splitting | no early fission (nobody born touching) | N (structural starvation argument) |
| CONQUEST_CASCADE | 1 — witness collapse + network inheritance | single-speed crawl (submission bar rejected 63% of pairs) | Y |
| STATE_CAGE | 1 — cage field drives formation | mass-gated statehood ("this sim's Mesopotamia was its WEAKEST cradle") | Y |
| ORG_CONTACT (graded 8) | pre-state statecraft compounds only under pressure/contact | planetary one-cohort statehood (48 formations at ~3 km/y frontier, contact-blind) | Y |
| EXCH_WAVE (graded 3, pinned 0) | exchange sphere rides logistics (500 km → ~4×) | fixed neolithic disk (31/40 proto-cities frozen at org p50 0.12) | Y |
| ORG_PRESSURE / ORG_BIRTH_VAR / CONFINE (graded) | pressure/site-graded org rates and birth values | uniform rate and birth 0.1 exactly (statehood as a global switch) | Y (cohort measurements) |
| FOUND_DRIFT | 1 (pinned 0) — connected-but-beyond-cohesion foundings branch daughter peoples | single-hop tests (7 cultures born, top-1 = 100% of humanity vs control 50/19%) | Y |
| GROW_STATECRAFT (graded 0.85) | integration rate earned by org | flat rate (smallness a two-pass transient) | Y — "the one lever of the battery that moved COUNT without any cost anywhere" |
| PORTER_BOUND | 1 — reach realized through transport availability | transport-blind reach (late belts sweep continents) | Y |
| PROTECTORATE | 1 — gunboat subjugation of existing far courts | empty-beach planting only (foundings frozen; noClearSite 400–530/window) | Y — pre-registered win metric |
| SEA_DEMAND / SEA_PRACTICE / ADMIRALTY | 1/1/1 — induced sea demand; learned-by-sailing fleet factor; best-port navigation | demand-blind, dock-bound, court-read (nav 0.57 at 50k, "flight before the compass") | Y — probe chain exonerating/convicting each term |
| APPARATUS / APPARATUS_LOOT / WORKS_CEIL | 1 / 1 / 1.2 — total-revenue works stock; fed by conquest income; bounded | per-member-only tail; general-revenue feed | Y — "capability levers lift FIELDS" law measured three times |
| ELITE_FRACTURE (graded 1.5) | four internal-fracture mechanisms | inert governor channel (ambition 0.00 every sample) | Y |
| REFUGE (graded 1) | ridge-field defense at war/storm/absorption | mean-altitude test (Alps average ~0.31, slipped under 0.5) | Y — seat-moat variant measured and rejected (realm-kills 4→1) |
| NOMAD_MIL (graded) | steppe cavalry punch | none | N |

### 2.6 Economy and goods (the 2026-07 default-flip campaign block)

All of these carry the same header: "FLIPPED ON 2026-07 (default-flip campaign; the multi-seed battery record is docs/premerge-review-2026-07.md + the spec). Set 0 to A/B."

| Flag | Winner (def) | Loser | Evid |
|---|---|---|---|
| RES_SCARCITY | 1 — endowment = grade × substantiality (1−exp(−S/K)) | per-tile MAX ("one stray copper tile… reads as 'rich in copper'") | Y — saturated-SUM first cut measured to erase grading |
| SPEC_RELATIVE | 1 — Ricardian pick vs lag-1 world-typical | CRAFT_REF scoring (50–65% of towns lock into Crafted wares) | Y |
| GOODS_PRICES | 1 — 8-good local scarcity prices | scalar economy | part |
| GOODS_TRADE | 1 — per-good flows down price gradients | scalar both-sell exchange | part — "Hume price-specie-flow EMERGES… instead of being imposed" |
| GOODS_CHAIN | 1 — forge consumes ore (Sheffield possible) | no consumption coupling | part |
| GOODS_CLOTHQ | 1 — market cloth is fine cloth (skill-gated supply, wealth-elastic demand) | homespun counts as market supply | part — Stage-2 textile-collapse artifact reverses |
| GOODS_UNIFY | 1 — exportValue IS the goods economy | parallel layers (sacked towns kept exporting crafts) | part |
| GOODS_STOCKS (graded) | 1 — entrepôt buy-cheap/hold/resell | no stocks | part |
| GOODS_INVEST (graded 0.5) | wealth buys capacity, conserved | no investment | part |
| GOODS_FREIGHT (graded 1) | per-good value-density freight | flat freight | part |
| ARMY_PROCURE (graded 1) | war burns kit → metal demand | peacetime demand always | part |
| INDUCED_INNOV (graded 0.25) | dear goods pull invention (one-sided) | price-blind learning | part |
| RESOURCE_WARS (graded 0.5) | price gaps bias absorption targeting | resource-blind | part |
| GOODS_TEMPER (graded 0.5) | temperament colours demand | temperament-blind | part |
| OUTPUT_TOTAL | 1 — money prices total output (pop × _eraProd) | traded-slice proxy (modern T collapses, deflation floor) | Y |
| MONETIZE | 1 — levy in the harvest; only the monetized fraction coins | every state a cash state from genesis | N |
| STATE_DEBT | 1 — war loans from the financier city, debt-trap spiral | debase-and-arrears only | N |
| SLAVERY / SERFDOM / LATIFUNDIA | 1 — full coerced-labour complex (production niche, plague fork, conquest-estates demand engine) | off | part (LATIFUNDIA: "the classical coerced share stays ~10%" without it) |
| SLAVE_PULL (graded 1) | price-elastic slaving effort | fixed price/rate ("supply-starved ~10:1") | Y (probe_latifundia) |
| SLAVE_FREIGHT | 1 — captives clear pairwise over the network with freight/tolls/duties | pooled clearing ("paid every seller the same price at any distance") | Y (review I13/D9) |
| SLAVE_PEOPLE | 1 — captives are people (demographic conservation, admixture) | bodiless workforce stat ("twelve million people could vanish… without a trace") | N |
| FREE_LABOUR (graded 4) | industrialization erodes coercion demand | no substitution (unfree share still rising at 24k) | Y |
| FIAT_OUTPUT / MODERN_FISC / FIAT_SMOOTH / INDUSTRIAL_REACH (graded) | industrial monetary/fiscal transition family | specie-anchored money, tithe-only fisc, spot backing, relative-only reach (each with a measured collapse mode) | Y (industrial-transition doc battery) |
| PILGRIM_SPEND / PILGRIM_RANGE | 0.85 / 60 — sees spend; offerings decay with distance | pure hoard ("one see accumulating ~28% of world wealth by 12k"); flat world-tithe | Y |
| HUME_ELASTICITY / CREDIT_RATE / DEBASE_AGGRO (graded) | currency phases 2/5/3 | off | N |
| CLIMATE_VAR | 1 — deep-time climate drift + volcanic winters | frozen worldgen climate | N |

### 2.7 Knowledge-shape flags

| Flag | Winner (def) | Loser | Evid |
|---|---|---|---|
| KNOW_DECAY (graded 1.0) | dark-age forgetting on collapse/isolation | knowledge never regresses | N |
| FAITH_FRONTIER (graded 1) | cross-family conversion discount + state-church suppression | winner-take-all (95–98% single-faith every seed) | Y — HHI 0.92→0.40 |
| COLLAPSE_SCAR (graded 0.7) | shatter scars org ∝ palace-dependence | immortal institutions | Y |
| LABOR_INNOV (graded 0.6) | coerced labor suppresses learning (Finley) | off | N |
| SCI_COMPOUND (graded 1.5) | compounding returns to knowledge | flat era pace (Modern era ~38× its historical length) | Y (probe_erapace, calibrated at 1.5) |
| HEGEMONY_STAG (graded 0.75) | loss of once-felt peer pressure slows learning (Scheidel) | off | Y — pressure 0.7→2.2→0.34 measured in the iron window |
| CLAIMANT_WARS / CROSS_REALM_HEIRS / CLAIM_POWER_WIN | 1/1/1 — cross-realm dynastic politics (inherited thrones, unions, succession CB) | throne-siloed houses; capital-siege-only resolution | Y — 3-seed validation; ~2× union flow |

### 2.8 The five default-OFF flags (deliberate)

- **URBAN_PRINT 0** — a diagnostic A/B, "NOT SHIPPED PHYSICS".
- **FISH 0** — owner directive removing fish calories entirely; pre-v19 saves pin 1.
- **IDEA_FIELD 0** — measured and settled by the 4-seed panel: only abandonment-timing was consistent; grid-trend inverts.
- **MARGINAL_HOLD 0** — built alternative to the quota model, never flipped.
- **LABEL_BIRTH 0** — site-ledger supply blocked on its own known limit (47% diffuse-interior demand unhosted).

### 2.11 Graded master-weights whose 0 is a byte-identical legacy model

TERRAIN_FADE, FOOD_K, DIFF_CLIM, TIER_BRANCH, CROWD_FOUND, DAWN, DISSOLVE_CORE, TRIBUTE_UP, SEAT_FIELD, MARKET_PULL_HYST (1.0 = strict), ELITE_FRACTURE, SEA_PRACTICE, APPARATUS, ENGULF, ENGULF_BAR, MARCH_FUNDED, GROW_STATECRAFT, FIELD_CRADLE, FOREST_LOCK, ORG_CONTACT, EXCH_WAVE, ORG_PRESSURE, ORG_BIRTH_VAR, CONFINE, REFUGE, ALLY_FRONT, SMALL_WAR, VASSAL_LEVY, KNOW_DECAY, FREE_LABOUR, FAITH_FRONTIER, COLLAPSE_SCAR, LABOR_INNOV, SCI_COMPOUND, HEGEMONY_STAG, SLAVE_PULL, FIAT_OUTPUT, MODERN_FISC, FIAT_SMOOTH, INDUSTRIAL_REACH, INDUCED_INNOV, GOODS_TEMPER, GOODS_FREIGHT, GOODS_STOCKS, GOODS_INVEST, ARMY_PROCURE, RESOURCE_WARS, TECH_EFFECTS, MIXED_FARM.

---

## 3. PERFORMANCE CADENCES

Fine in v2 as scheduling, never as content gates (the CLAUDE.md distinction is quoted verbatim inside SETT_STRIDE's own desc: "it moves how often code runs, never whether history may happen").

| Lever | Default | Notes |
|---|---|---|
| SIM_GRANULARITY | 1 | Re-times the whole sim (G× ticks per history). Validated G=2 vs G=1: stocks reproduce; **known drift: total wealth ~20% low at G=2** (unscaled second-order flows: granary accrual, construction bursts, polity-pass windows); per-tick rate readouts read ~1/G. |
| CONQUEST_INTERVAL / POLITY_INTERVAL / TERRITORY_INTERVAL | 50 / 150 / 144 | Pass intervals; stretch with G. |
| SETT_STRIDE | 3 | "THE 20× SLOWDOWN FIX" (owner 2026-08-20; 65% of a dense tick was the per-settlement loop; 0.2 ms/city/tick). dt×K rescaling keeps averages; consumers read ≤K−1 ticks stale. **Harness pins 1**; app ships 3. |
| TRADE_STRIDE | 5 | N-tick sweep at N× volume, "same AVERAGE flows". Dense-register recalibration 3→5 (33.3→18.6 ms/tick at 589 cities). **Harness pins 3**. |
| DEV_STRIDE | 3 | Construction every N ticks at N× rate. |
| POP_FIELD_STRIDE | 1 | **Explicitly NOT free perf**: striding by 4 gives "a measurably different country-size distribution" (coarser Euler dt) — default stays 1; a scar worth carrying to v2's scheduler design. |
| POP_FIELD_WORKERS | −1 (auto) | Pure parallelism; "results are identical at EVERY setting — proven" (probe + headless chromium); field pass ~2.2×, tick −22% at 4 bands. |
| MARKET_PULL_CACHE | 1 | Skip the bid Dijkstra when fingerprinted inputs unchanged; retally only. "PERF CADENCE in the blessed sense." v<60 pins OFF. |
| MARKET_PULL_HYST | 1.15 | Hybrid: perf + flicker damper; claims independent meaning ("marketing habit / standing relationship") — borderline. |
| VILLAGE_PARTNERS | 12 | Hybrid perf/realism (villages trade locally = cheaper AND "arguably more realistic"). |
| ROAD_MIN_TIER | 1 | Hybrid: perf + the huge-early-road-webs fix. |
| SEA_MAX_PEERS | 64 | CPU ~flat; the real ceiling is route-tile memory past ~96. |
| passWindow() helper | — | The amortized-cadence infrastructure; carries the phase-offset dead-check lesson. |
| paramDefs: moistSteps 140, windSolverIter 500, erosion drops | — | Worldgen-side iteration budgets. |

---

## 4. OUTCOME-FIT PATCHES AND INTERFERENCE

### 4a. Confessed fitted constants — retired, with the confession preserved

- **The 260× overlay** (retired; recorded in MIXED_FARM): "the 260 and the exponent 6 had no independent physical meaning, they existed to land the modern boom at a target scale, and the devGate keyed food productivity on political organisation (a state grows no wheat)." Its deletion removed 43% of world carrying capacity (Scap 13.93M → 7.89M) — the hole MIXED_FARM/LAND_WORKS/INDUSTRIAL_CAP now fill with named channels.
- **CAP_DOM_W/P curve** (retired behind CAP_MODEL=0): "Replaces the FITTED great-power-tail shape — the dominance multiplier's `1 + CAP_DOM_W·(relPower−1)^CAP_DOM_P` (W=0.9, P=1.5, a curve-fit exponent the review flagged as the clearest fitted constant)."
- **CAP_LOG's predecessor**: "the earlier ∝ surplus² compounding double-counted the surplus (no physical derivation)… (It also never actually ran: it read a field techEffects doesn't return, so logistics was silently 0 — this lever was dead until the wiring fix.)"
- **The tier-ratchet tables** (HAUL_PAID and MARKET_PULL descs): FOOD_RANGE_BY_TIER [1.0, 1.0, 2.2, 3.6] — "a second, unphysical copy of terms the curve already carries, attached to a label"; GRAIN_PRICE_BY_TIER [2, 8, 14, 22] — "load-bearing… must NOT simply be deleted"; HINTERLAND_BY_TIER 6→8 and CORE_BY_TIER 3→4 — "whose own comments justify themselves by the map they want to see"; SHIP_FRAC_BY_TIER [0.8, 0.5, 0.2, 0.05] — retired ("the fractions were the village world's proxy for need").
- **FORT_GARRISON_REF**: "The absolute 40 was tuned to the pre-Tier-B3 phantom-fish population (~5× today's honest scale)… the same TIER_SCALE_REF class of stale absolute." Now 0 = self-derived p85.
- **Fossil absolute bars** repeatedly flagged: TOWN_BASIN_MIN ("a FOSSIL two orders below real settled basins — founding sites measured 143-3300× it"); NUCLEATE_SEAT_POP=160 ("measurably unreachable — no stateless city clears it at any checkpoint"); tier floor 240 ("a documented measured-floor shortcut, not first-principles census minima"); K_MIN_VIABLE=8 read in the wrong unit ("the pair was written for a headcount scale and never re-grounded"); `_coreHoldCapF` 12k stamp ("designed as a birth-handoff transient… became a permanent floor" — 37–45% of the register at exactly 12.00su).
- **FOOD_HAUL_RANGE = 14 tiles** (superseded by HAUL_PHYS): "ONE TILE IS ~167 km at the reference grid, so the default 14 is a 2,338 km e-folding distance… which take the top of the range past Earth's circumference."
- **The era-ladder calibration quartet** — LEARN_BASE, ORG_LIT_BRANCH, SCI_SPREAD, ORG_APT_LEARN (plus SCI_POP_REF 45→28): openly "Calibrated… so the era ladder tracks the displayed calendar — the leading civilisation reaches the Bronze era around 2700 BC, Classical antiquity around 200 BC, Medieval around 500 AD, Industrial around 1600 and the Modern frontier near 1950." This is a fit of emergent pace to the cosmetic calendar — the one place the registry knowingly tunes toward a timeline rather than a mechanism; LEARN_BASE records secondary re-trims.
- **LUX_SUPPLY_RATE 4.0**: "Was a hard-coded 4.0; exposed unchanged… the analysis measured luxury as the #1 income line in most big cities (~16% of world income), where history's luxury trade was a thin high-margin sliver" — a flagged, unresolved suspect.
- **GOLD_G_PER_COIN 8**: half-fitted by admission — "a gold ducat ≈ 3.5g; 8g keeps treasuries legible."
- **ATTACK_MIN_RATIO 1.176** — a three-decimal tuned threshold with no grounding text.
- **GOODS_VALUE_UNIT 10** — a legitimate units calibration but derived by sweep-to-knee ("1/10/25/50 at 12k… 10 is the knee").
- **COIN_LOSS_RATE**: "Calibrated so the total supply ≈ its old level" — an honest sink whose value is a fit to the prior equilibrium.

### 4b. "Was X, now Y" moves and their status

| Lever | Move | Status per its own desc |
|---|---|---|
| EXPAND_RATE | 1.5 → 8 | comboE member: "raising it ALONE makes consolidation worse (the hegemon grabs the fill)" |
| FIELD_SPAN | hidden 12 → 6 | comboE member; shed-to-wilderness caveat recorded |
| COVER_ORG | 150 → 260 | comboE member: "THE map-filling lever that doesn't feed the giants" |
| REGION_SPACING | 1.2 → 1.0 | "since the comboE empire-consolidation fix" |
| RURAL_BIND_DENS | 8,000 → 5,500 | "= 8,000 × 0.69, the demographic rescale itself, NOT a dialed size"; the ratified 9,000 re-grounding then BLOCKED by the third-rule gate: "No single honest value exists across grids until the wave-lag debt is fixed; bisecting toward the gate would be tuning to the gate" |
| SETT_GROWTH | 0.0018 → 0.0007 | re-grounded to the historical band (mechanism-based) |
| POP_MIGRATE | 0.06 → 0.01 | "default set by measurement" |
| TAX_BASE | 0.06 → 0.03 | outcome-motivated ("a uniform, statist-looking economy") with a stated mechanism |
| WIND_TAIL_FLOOR | 0.45 → 0.7 | artifact patch ("sail to Antarctica…"), given a subsidy-cap rationale |
| SCI_SPREAD | 1.0 → 0.45 | era-ladder calibration |
| ORG_APT_LEARN | 0.5 → 0.35 | era-ladder calibration ("major late-game accelerator") |
| COLLAPSE_SCAR | 0.35 → 0.7 | "0.35 measured under-dosed (directionally right, cycle unmoved)" |
| CAP_DOM_MAX | 8 → 20 | raised to let the new heavy tail express |
| FISH_PER_CAP | 0.024 → 0.012 | re-anchored to the historical per-fisher yield after the first spec measured 5× it |
| TRADE_STRIDE | 3 → 5 | perf recalibration; harness keeps 3 |
| DISSOLVE_CORE | 1.0 → 0.2 (v55) | "with STAMP_RETIRE the mint/dissolve identity at 1.0 was the churn engine" — hysteresis by owner decision |
| MARCH_FUNDED | flat 150·logi²·r2 → funded multiple 2 | re-grounded to Russia/Qing anchor |
| WAR_REACH | off → 15 | swept {8, 15}; 8 rejected on measured side-effects |
| ALLY_FRONT | offensive half built → removed | "measured HARMFUL (blocs dogpiled… biggest realm 9.7→12.3 Mkm²)" — defensive-only shipped |

### 4c. Tautologies and self-reference caught and named

- **TRUCE_TRADE_OWN**: "Its reference is a TAUTOLOGY: tradeRef = 2 × the live MEDIAN pair-trade, so the median pair reads tradeW = 0.500 EXACTLY in every era, by construction… Same defect class as the removed world._sizePopK size anchor: a live cross-realm median as the reference normalizes away the very quantity it is meant to detect."
- **world._sizePopK** (deleted, recorded in SIZE_BY_POP): "with 1–8 realms in sample WAS the leader cohort — one realm reaching Bronze re-sized every Stone-Age realm ×8–11 planet-wide with a 13–20× oscillation band."
- **SIZE_WORKED's target**: "target = h·d/RURAL_BIND_DENS = k·h, a pure proportional feedback with NO interior fixed point… bistable at every setting, which is also why the same code is empires at one resolution and dots at another."
- **CLAUDE.md's urbanisation tautology** (repeated in units.js): converting Σ s.people at the global census/field ratio "returns exactly 100% — a tautology, since that ratio is defined to make the two equal."
- **ABSORB_ORG_ERA on the absolute floor**: "the gate discriminated early-vs-late, never capable-vs-not" — an absolute constant acting as "a TIME-GATE BY PROXY" (a first-cardinal-rule violation smuggled in through a constant).

### 4d. Documented interference webs (calibrated-as-pairs; do not move singly)

- **comboE**: EXPAND_RATE + FIELD_SPAN + COVER_ORG + REGION_SPACING — two of the four warn that moving them alone inverts the intended effect.
- **RURAL_BIND_DENS ↔ FIELD_CRADLE** (v34): "the pair is what is calibrated, never one alone"; also "COUPLED to the demographic scale (CAP_PER_FERT…): recalibrate together if that ever moves."
- **CROP_BIOGEO ↔ IRRIG_CROP**: "The two levers flip TOGETHER or not at all."
- **BRIDGE_GLOBAL ↔ TIER_BRANCH**: "Do not run this lever without TIER_BRANCH; alone it re-creates the vetoed regression."
- **STAMP_RETIRE ↔ AGGLOM_LOCAL**: "HARD DEPENDENCY… The stamp is load-bearing TODAY; AGGLOM_LOCAL is what makes it retirable."
- **VIABLE_UNITS pair**: "THE PAIR MUST MOVE TOGETHER… lowering the capacity floor alone would let settlements fall under an UNCHANGED cull threshold and kill them wholesale."
- **LEAN_YEAR ↔ HARVEST_YEARS**: flipped "as one act" (v46); LEAN_YEAR's margin reads HARVEST_YEARS' cv map.
- **ARID_SECURE**: "THE PAIR IS THE LEVER (four-round elimination…): every unpaired variant… bled seed 777's register to 15-17 settlements (hard fail)."
- **MARKET_PULL ↔ PRICE_GROSS**: "PREREQUISITE… Run them together."
- **SIZE_WORKED ↔ CATCH_WILD**: "WITHOUT that lever the worked ground is clipped back to the border and this one is a near-no-op."
- **FIELD_NAVAL ← FIELD_ADMIN** ("inert without it"); **CLAIM_POWER_WIN ← CLAIMANT_WARS ← CROSS_REALM_HEIRS**; **SEAT_ADMIN's two halves** ("each alone makes the world worse"); **URBAN_LABOR ↔ AGGLOM_LOCAL** ("Measure the pair"); **CITY_HOLD ↔ CATCH_GRACE** (measured red as a pair, re-flip condition shared); **HOLD_SEAM/CORE_HOLD/STARVE_SHED/FED_FAMINE** (one birth-crater law in four slices); **DAWN ← ONE_POP activation** (inert on frozen-bridge saves).
- **Gate-visibility interference**: CORE_LOCAL and AGGLOM_LOCAL both record that "`npm run validate` is a LITERAL NO-OP for this lever — at its arm urbanCoreR returns 0 and the harness pins LAND_KNOW=0… A green battery is NOT evidence."

### 4e. Dead, inert, or measured-no-effect levers still in the registry

- **ENCIRCLE_PENALTY** — "under the default tile-war the octant scan was dropped in v1… so encMulOf returns 1 and this lever does NOTHING at any setting."
- **PERSISTENT_TERRITORY** — "under the default field polity this lever is UNREAD."
- **CAPITAL_ANCHOR** — "HEADLESS A/B ONLY… in the browser… the lever does nothing there."
- **MINT_RESIDUAL / MINT_REACH** — flipped on in v57 yet self-documented as structurally inert saturation detectors at the live arm.
- **EPOCH_YD** — cosmetic by construction (and audited so).
- **NOMAD_FIELD=0 branch** — "in practice: no hordes ever."
- **INVENT_STAGGER's flip partner** — the un-pinned scorer "crowns the wrong sites anyway (the Tarim outscores the Nile)."

### 4f. Stale-text contradictions (defaults vs verdict tails) — read `def`, not the prose

Levers whose desc still says "0 (DEFAULT)" or "ships 0/OFF" while `def` = on: ONE_BOOK, SHIP_SURPLUS, PRICE_GROSS, URBAN_LABOR, HAUL_PAID, GRAIN_BID, HAUL_PHYS, GRAIN_FREIGHT, ABSORB_PEER, CROP_PHOTOPERIOD, GROW_SEASON, CRADLE_PACKAGE, CITY_STORE, ARID_SECURE, MINT_RESIDUAL, MINT_REACH, SEED_EXCLUSIVE, CITY_HOLD, CATCH_GRACE, TILLAGE (lap-1 verdict), IRR_BAND (lap-1 verdict), WAR_FINISH (first-arm verdict), COURT_SPHERE, SEAT_FIELD, ALLY_FRONT. The **v57 stack** is the sharpest case: CITY_HOLD, CATCH_GRACE, SEED_EXCLUSIVE, MINT_RESIDUAL, ARID_SECURE and MINT_REACH each carry a recorded RED/refuted/inert verdict *and* a v57 flip line — the stack was flipped as a unit once LEAN_YEAR removed the overmint fuel those verdicts were measured against, but the entries were not rewritten. v2's registry should make "current default + current verdict" a single structured field, not an append-only prose trail.

---

## 5. HARNESS PINS (tools/_harness.mjs — reference-trajectory discipline)

`applyToolTuning()` runs at import for every tool/gate and applies, in order: the pin set, then `SIM_TUNE` env overrides (spread last, so an explicit override always wins). `SIM_TUNE_OVERRIDES` is exported because **persist.js restores the save's tuning on load** (reset + saved non-defaults), "which silently clobbers any pre-load lever" — snapshot tools must re-apply. The harness also prints a **provenance stamp** (`[harness] tree <git-HEAD>`) because "this session's container has silently reset its checkout to a pre-session commit THREE times (2026-08-06)… probe outputs from the stale tree were nearly published as findings both times."

**The pin set:**

| Pin | Value | Why |
|---|---|---|
| POP_FIELD_WORKERS | −1 | tools run the pool at AUTO — "proven bit-identical at every setting"; the app default deliberately stays 0 until production sends COOP/COEP headers |
| DAWN_LIVE | 0 | gates measure "MATURE-REGIME properties" at fixed horizons |
| STATE_RECORDS | 0 | "re-times GENESIS (states wait for the writing bar)" |
| LAND_KNOW | 0 | "re-times genesis (cities and tribal nations wait for the tallies bar)" |
| PEER_SEATS | 0 | "multiplies the genesis register… the fixed-horizon gates would measure a different world" |
| WAR_FINISH | 0 | "re-arms the whole world… the mature-regime gates were calibrated on the old military balance" |
| FOUND_DRIFT, ABSORB_ORG_ERA, TRIBUTE_UP, ENGULF, FEAR_REACH, SMALL_WAR, RELIEF_REACH, EXCH_WAVE, TECH_USE, VASSAL_LEVY, DISSOLVE_CORE | all 0 | same reference-trajectory class |
| SETT_STRIDE | 1 | byte-identical reference ("the app ships the default" 3) |
| TRADE_STRIDE | 3 | "so every gate keeps the calibrated reference trajectory — the app ships the new default" 5 |

**The documented live arm:** `SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1,PEER_SEATS=1,WAR_FINISH=1"` — and the standing rule: "any verdict about genesis geography or timing MUST name its dawn regime and run the live arm explicitly — the app ships BOTH levers ON."

**The v2-relevant consequence, stated plainly:** the gate battery and the shipped app run **materially different configurations** — 17 levers (plus two strides) diverge, several of them first-order (WAR_FINISH, DISSOLVE_CORE, TRIBUTE_UP, EXCH_WAVE, VASSAL_LEVY). Two lever descs (CORE_LOCAL, AGGLOM_LOCAL) explicitly record that this makes `npm run validate` blind to their code path. Additional env force-overrides scattered through descs: SIM_COVER_BASE, SIM_COVER_ORG, SIM_BIND_DENS, MARCH_TILES_ENV, SIM_PERSIST_TERR, SIM_SUCCESSORS, SIM_CAPITAL_ONLY, SIM_CTRL_*.

---

## 6. UNITS — the full story

**src/sim/units.js** exists where it does for one reason, recorded in its header: the scales used to live in `src/ui/bits.jsx`, which node tools cannot parse, so "every instrument in tools/ reported raw sim units while the game reported people, and the two were silently a thousand-fold apart" — producing the published-then-retracted "32M people / smaller than Çatalhöyük" finding (true figures: 135M, ~1 AD density, a 4.4M metropolis). One definition, imported by UI and metric collector both.

**The three exported constants:** `POP_SCALE = 1000` (sim pop → people); `FOOD_KG_PER_UNIT = 1000` (1 food unit = 1 tonne grain); `GOLD_G_PER_COIN = 8` (g gold per coin).

**The three population scales** (CLAUDE.md's "single most repeated mistake"):
1. `settlement.people` — census sim units (× POP_SCALE for people). **And it is the CATCHMENT, not the city**: under ONE_POP, `s.people = Σ popField(catchment) × _onePopScale`; `s._urbanPop` is the city alone; `s._ruralPop = s.people − s._urbanPop`. Σ s.people = the catchment-covered world, not urban and not world population; urbanisation must be read off `_urbanPop` (the ratio conversion is a tautology returning 100%); a census bar (NUCLEATE_SEAT_POP = 160 ⇒ "the seat's city and countryside together hold 160,000") is a bar on a region.
2. `popField` — people-on-land, a different internal scale, stored **per real area** (÷rn², per URBAN_FOOTPRINT's desc), which is why the field is grid-comparable and entities are not.
3. `_onePopScale` — the census↔field bridge, "≈0.001-0.003, drifting". Under ONE_POP it is **frozen at activation** ("median census / median field-region — a unit conversion, persisted, never a second dynamic"). Pre-census worlds use `BRIDGE_REF`, "the measured mid-band of _onePopScale, 0.001-0.003 — a unit choice" (CITY_AT_BIRTH). `BRIDGE_GLOBAL` (def 1) changes how the bridge is *measured* — global totals rather than a per-settlement-catchment median, because catchment tile-geometry made the bridge resolution-dependent (0.0013 → 0.0041, 3.15×, with a documented feedback loop) — and is explicitly "NOT byte-identical at the reference." LABEL_BIRTH additionally re-keys the state-birth exchange rate to the frozen bridge to make it immune to label supply.

**Space:** the sim tile grid is half the pixel width (`tileRes 2`): W=480 px ⇒ tw=240 (the calibrated reference, `POP_REF_W = 240`); the app ships W=1920, simDiv 2 ⇒ tw=960. One reference tile ≈ **167 km** across at the equator (HAUL_PHYS, FISH_MSY) and ≈ **17,700 km²** mean spherical area (RURAL_BIND_DENS, SIZE_BY_POP — the two figures reconcile as equatorial width vs sphere-mean area; ~70,000 km² at quarter res). Resolution conversions appear as `rNormPop = tw/240` for distances, `1/rn²` for areas, `resScale²` for the war capture cap, `resScale³` for EXPAND_RATE's per-pass fill, and the "band" convention (ACCESS_BAND/BAND_SUM/IRR_BAND) for 1-D features that must integrate per real area. The third cardinal rule exists because these conversions "assume the underlying field is exactly per-real-area invariant — verify that it is (it measurably is not for coast- and river-derived terms)."

**Time:** 1 tick = **0.25 dyn-years** (SETT_GROWTH: 0.0007/tick ≈ 0.28%/yr; GRANARY_SPOIL: "~4 steps/yr"). Note one internal tension to resolve in v2: HARVEST_YEARS states "HARVEST_INTERVAL=2 ticks = 1 yr" — the harvest layer runs on a 2-tick year while the demographic commentary uses 4-tick years. Pass cadences are tick-denominated (POLITY 150, TERRITORY 144; CATCH_GRACE 600 ≈ four territory passes); dyn-year quantities appear in dynastic/loyalty half-lives (GRIEV_LEDGER ~120 dyn-yr; assimilation ~1000–1500 dyn-yr). The display/dynasty calendar anchors at −9700 under EPOCH_YD (−5250 legacy) and is read-only by audit.

**Food/money:** civilian ration = **0.0030 food/tick per sim-person** (cited in TRIBUTE_OF_LAND, LAND_SURPLUS, FISH_PER_CAP); 1 food unit = 1 t; granary cap ≈ 2 years of tribute take. `GOODS_VALUE_UNIT = 10` coin per goods-unit at price 1 (the F8 unit calibration); coin = 8 g gold.

---

## 7. STATISTICS

| Measure | Count |
|---|---|
| Total levers in TUNING_SCHEMA | **430** (the "431" figure counts a false grep hit inside ONE_BOOK's desc) |
| Categories | 10 (Pacing 135 — actually the model-flag registry; Empire 70; Military 36; Movement 6; Sea 12; Settlements 50; Knowledge 58; Economy 52; Shocks 8; Dynastic 3) |
| Strict binary [0/1] model flags | **156** (151 ON, 5 OFF: URBAN_PRINT, FISH, IDEA_FIELD, MARGINAL_HOLD, LABEL_BIRTH) |
| Graded master-weights where 0 recovers a legacy model byte-identically | **~49** (list in §2.11) — i.e. ~205 of 430 levers are model selectors of some kind |
| Pure performance cadences | **9** + 4 perf/content hybrids |
| Levers/embedded constants with independent physical meaning or a real-world citation | **~85** in tuning.js (+10 grounded worldgen params from paramDefs.js) |
| Confessed fitted/outcome-tuned constants (standing or preserved-as-history) | **~25** (§4a–4b), largest standing: the era-ladder quartet, ATTACK_MIN_RATIO, LUX_SUPPLY_RATE, WIND_TAIL_FLOOR, TAX_BASE, and the not-yet-deleted tier tables |
| Descriptions recording an explicit FLIPPED-ON/DEFAULT event | 70 |
| Descriptions claiming a byte-identical off-path | 183 |
| Descriptions containing measured evidence | 128 |
| Descriptions recording a save-regime guard / version pin | 65 |
| Descriptions claiming "zero new constants" | 39 |
| Dead/inert-under-defaults levers still present | 7 (§4e) |
| Levers with stale default-vs-verdict text | ≥20 (§4f) |
| Harness pins diverging gates from the shipped app | 17 levers + 2 strides (§5) |
| Worldgen params (paramDefs.js, separate registry) | 75 in 7 groups |

**File paths:** `src/sim/peopleSim/tuning.js` (registry), `src/sim/units.js` (display units), `src/paramDefs.js` (worldgen params), `tools/_harness.mjs` (pins), `CLAUDE.md` (cardinal rules, population scales).
