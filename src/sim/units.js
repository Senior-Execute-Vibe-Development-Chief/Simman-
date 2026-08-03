// ── DISPLAY UNITS — the one true scale between sim numbers and human numbers ──
//
// The sim runs on compact internal units; these scale them to realistic figures.
// They live HERE, in a plain module with no JSX and no React, rather than in
// src/ui/bits.jsx where they used to, for one reason: THE MEASUREMENT TOOLS COULD
// NOT IMPORT THEM. A node script cannot parse a .jsx file, so every instrument in
// tools/ reported raw sim units while the game reported people, and the two were
// silently a thousand-fold apart.
//
// That cost real work. A 50,000-step analysis was published claiming the world held
// 32M people at a density last seen on Earth in 3000 BC, and that its largest city
// was "smaller than Çatalhöyük". The true figures are 135M, ~1 AD density, and a
// 4.4-million-person metropolis. Wrong by 4x on population and by a THOUSAND on the
// city — and wrong in the direction that made the simulation look far worse than it
// is. The numbers were all correct; they were being read in the wrong unit.
//
// So: one definition, imported by both the UI and the metric collector, and every
// population figure a human reads is in REAL PEOPLE.
export const POP_SCALE        = 1000;   // sim pop → people: metropolis ~3.4M, city ~1.2M, town ~250k, village ~25k
export const FOOD_KG_PER_UNIT = 1000;   // one sim food unit → kg of grain (1 unit = 1 tonne)
export const GOLD_G_PER_COIN  = 8;      // one sim coin → grams of gold (a gold ducat ≈ 3.5g; 8g keeps treasuries legible)

// ── WHAT A SETTLEMENT IS ─────────────────────────────────────────────────────
// A settlement in this model is a CITY OR LARGE TOWN — never a village. The
// village and hamlet tier is not represented as entities at all: it is IMPLIED IN
// THE LAND, carried by `popField` (people-on-land) and by each settlement's rural
// belt (`_ruralPop`), which together hold the countryside population.
//
// Read that before judging any settlement count. ~230 settlements on an
// Earth-sized world is not "a planet with 230 towns" — it is a planet with 230
// cities and large towns, which is the right ORDER for a pre-industrial world, and
// the villages beneath them live in the field. Likewise a realm holding 2M km²
// with four members is administering four PROVINCIAL CENTRES, which is the register
// real empires actually used: ~20-30 Achaemenid satrapies over 5.5M km², ~10 Roman
// provinces rising to ~50 under Diocletian, ~100 Han commanderies.
//
// Two separate analyses in one session drew wrong conclusions from forgetting this
// ("the world has 1000x too few towns", "territory is administratively free because
// load counts only settlements"). Both were retracted.
//
// ── AND `s.people` IS NOT THE CITY — IT IS THE CATCHMENT ─────────────────────
// The half of the above that is easy to miss, because it reads like a headcount.
// Under T.ONE_POP the census is derived from the FIELD over the settlement's worked
// catchment (popField.js deriveOnePop):
//
//     s.people    = Σ popField(catchment) × _onePopScale     city AND its villages
//     s._urbanPop = Σ popField(urban footprint) × _onePopScale       the city alone
//     s._ruralPop = s.people − s._urbanPop                    the villages it farms
//
// So a settlement showing people = 4422 stands at the centre of 4.4 million people —
// it does not house them. Consequences:
//   • Σ s.people is the population of the catchment-COVERED world (settled, worked
//     land), not the urban population and not world population.
//   • URBANISATION must be read off _urbanPop. Reading it as Σs.people over the field
//     converted at the global census/field ratio returns 100% — a tautology, since
//     that ratio is defined to make the two equal.
//   • A census bar on a settlement is a bar on its CATCHMENT. NUCLEATE_SEAT_POP = 160
//     means "the seat's city and countryside together hold 160,000", which is the
//     right thing to compare against a REGION's population, not against Uruk's 40,000
//     residents. The bar is still measurably unreachable — no stateless city clears it
//     at any checkpoint — but say what it is a bar ON.
