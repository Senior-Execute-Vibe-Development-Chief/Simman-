# 05 — The physics of power  `[DESIGN DETAIL]`

The political layer, micro-founded (DECISIONS 6–7). Primitives and
mechanisms here are fixed; functional forms and constants marked `[DERIVE]`
are settled during M4–M5 against the reality tables, never by outcome
(R2). Sections 5.6+ are `[SKETCH]` pending the M4 gate.

## 5.0 Doctrine

- Behavior is **pressure and selection** (P1): rates drift under local
  gradients; ruler traits/dynasties supply variation; polity death supplies
  selection. Discrete acts are hazard rates driven by the same pressures.
- The **community** is the atom of the ruled (P2); **centers** condense at
  salience (P3); polities are **queries over the obligation graph**, and
  the graph is **not a tree**.
- There is no "organisation" scalar. There is an institution portfolio
  (5.5) and there are the seven primitives.

## 5.1 The seven primitives

1. **Appropriable surplus** — per-community: surplus × storability ×
   legibility (visible, concentrated, ripens-at-once). The tax base.
   States are grain-shaped because only grain-shaped surplus can be taken.
2. **Coercion as a fed stock** — retinues: full-time fighters fed from
   appropriated surplus (upkeep in tonnes/yr), plus weapons capital and
   fortification (stored violence; cheapens holding, raises assault cost).
   Projects over the travel field with per-day supply costs — force decays
   with distance exponentially (v1's validated war-reach law, now derived).
3. **Exit** — per community: value of best reachable un-ruled or
   rival-ruled land ÷ moving cost. High exit caps extraction near zero and
   voids subjugation (Carneiro; v1's CAGE_FILL — measured as "the entire
   pre-urban org engine" — is this primitive and ports as its seed).
4. **The extraction bargain** — a ruler's take vs a community's compliance:
   comply while protection-value + legitimacy > extraction − exit −
   coordination. Rates drift (5.0); over-squeezing feeds unrest.
5. **Legitimacy** — a slow stock per (ruler, community): built by delivered
   protection, famine relief (granary opened), adjudication, shared
   faith/ritual; destroyed fast by atrocity and failure. Function: a
   multiplier discounting enforcement cost — believers are cheap to rule,
   the freshly conquered ruinously expensive. (v1's loyalty-field
   habituation is the ported substrate.)
6. **Monitoring cost** — ruling at travel-time distance d costs
   information/agency overhead rising with d and falling with information
   institutions (writing, coin, roads/posts, agent recruitment). Below
   threshold: direct administration. Above: **delegation** — an obligation
   edge to a local power-holder who keeps a share and may defect. The
   moving monitoring-cost frontier is the arc of political history.
7. **War economics** — raid / conquer / trade as one ledger: raiding takes
   movables cheaply (the default); conquest pays assault-vs-fortification
   and the zero-legitimacy holding cost, and pays off only where a tribute
   stream exceeds it; trade dominates where protection rents price plunder
   out. Slow variable: military capital intensity rises with technique →
   the minimum viable independent polity grows era by era.

## 5.2 From fields to the first rule (M4 — the bet)

- Communities raid where surplus is appropriable and defense weak
  (hazard-rated). Where the loser's exit is cheap: plunder only, nothing
  sticks. Where exit is blocked (caged basins): the cheapest stable outcome
  is **tribute subordination** — loser keeps land and headman, pays a
  share. First obligation edge; no map color changes.
- **M4 acceptance**: subjugation sticks in the caged river valleys and
  fails to stick in open country, with the right world-geography of first
  politics (Nile/Mesopotamia/Indus/Yellow River early; rainfed Europe
  late; highlands never) — emergent from the exit term, not placed.

## 5.3 Centers

Where tribute concentrates, a **center** condenses (P3): seat, retinue,
store, treasury, dynasty, legitimacy books, institution portfolio.
Dynamics: extraction feeds retinue; retinue enables extraction (the loop
closes only above a surplus threshold — chiefs are rare); services build
legitimacy; reach is a day's-ride disk growing with mounts/roads;
fortification accumulates. Selection: centers whose bargain fails (unrest
coordination, 5.7) or whose retinue starves, fall. Two condensation paths,
both from the same books: the war-leader (captures the store) and the
temple-manager (runs the store) — texture, not types. Centers also
condense on *gravity* (market/temple towns, 06): authority without
conquest, edges formed by service dependence (the city-over-lords path).

## 5.4 The obligation graph

Edges: (from, to, kind ∈ {tribute, levy, fealty, charter, alliance, debt},
strength, binding ∈ {person, office}). Rules:

- **Person-bound edges die with the person** — successions re-negotiate
  every personal edge (hazard of defection scaled by the heir's legitimacy
  and the delegate's own strength). The chain polity's half-life ≈ a reign,
  by construction. The *impersonal office* institution (5.5) rebinds edges
  to the crown — polities begin outliving founders when it exists.
- **Two growth modes, in tension:** EXTEND (add a link — cheap, fast,
  leaky: delegate keeps most revenue, accrues own coercion+legitimacy) vs
  DEEPEN (convert a link into direct administration — expensive, gated by
  monitoring cost, agent supply, and revenue; durable, high-yield). Both
  are pressure-driven flows, not decisions. Every polity is a mix; the
  chain-vs-bureau tension *is* the consolidation-fragmentation rhythm.
- **Not a tree:** peer edges (alliances, leagues — collective actors with
  pooled obligations), cross-cutting edges (a crown chartering a town over
  its duke's head — centers under monitoring pressure generate bypass
  edges), and multi-suzerainty are legal and expected.
- **Authority rendering:** per-tile top-K weights from centers via the
  travel field, weighted by coercion, legitimacy, and edge strength.
  Derived, never authored (02). Marches, frontiers, and stateless zones
  are where weights are low or contested — free, from the cost field.

## 5.5 The institution portfolio (P5)

A catalog (~12 at Phase-1 scope), each: emergence conditions (from world
state), upkeep (paid from extraction), the specific cost term it lowers,
decay when unfed, and mortality (can die with its host — collapse scars,
palace-dependence weighted). Initial catalog: tallies/seals → extraction
accounting; writing → monitoring at distance (the province door); law code
→ coordination/legitimacy (adjudication as a service); coinage → tax
without haulage; roads/posts → information lag; agent recruitment
(priesthood / examination / slave-administrator variants) → the
principal-agent leak; census/survey → legibility; the impersonal
crown/office → succession survival; standing army → coercion independent
of levies; credit/fisc instruments → war finance `[DERIVE: exact list,
conditions, magnitudes — against Seshat administrative variables]`.
Implementation pattern: v1's tech DAG (condition-derived, effect channels,
memoized) — proven — but per-center, decaying, and upkeep-costing.

## 5.6 Consolidation `[SKETCH — hardened after M4/M6 gates]`

Four pathways, all graph dynamics, all expected across seeds: hegemonic
leagues hardening into administration; marcher powers conquering exhausted
cores; dynastic merger of obligation bundles (unions at successions —
v1's validated machinery re-homed); defensive consolidation as military
capital intensity prices small polities out. Empires are rings: an
administered core, a sworn ring, a gift-giving fringe, fading to no-rule —
the ring boundary is where monitoring cost exceeds take. Non-territorial
networks (faith hierarchies; later leagues) per P6.

## 5.7 Unrest, rebellion, collapse `[SKETCH]`

Unrest is a community stock fed by extraction beyond the bargain, famine
under a full granary, conscription, atrocity memory (grievance ledger,
ported); rebellion is unrest × coordination (shared identity, density,
communication) ignited by focal events (famine year, lost war, succession)
— rare, synchronized, historically shaped. Collapse: succession snaps
person-bound rings; institutions unfed by falling extraction decay;
palace-dependent portfolios die with the palace (dark age); land memory
(ported) seeds restorations under the old name.

## 5.8 Reality tables (M4–M6 gates; fuller set in 08)

| Quantity | Target | Source |
|---|---|---|
| Geography/order of first subjugation | caged valleys first, in archaeological order | archaeology (v1 genesis suite) |
| Extraction rates | ~10% floor, ~20% strong states | tribute literature (v1-cited) |
| Violence specialists | ~1–2% of population | standard estimates |
| Chiefdom scale | complex-chiefdom bands | anthropology (v1's TRIBAL_CENSUS grounding) |
| Polity size dispersion | lnσ ≈ 2.0–2.6, heavy tail; median ~0.03M km² | Taagepera + v1 research |
| Polity lifespans | median 50–2000 y, heavy tail; chain polities ≈ reign-scale | Seshat, v1 gate bands |
| Administrative depth vs durability | deep-chain polities fragment more; admin levels grow with information institutions | Seshat |
| Timing | farming → cities ~6 ky; cities & writing co-arrive; states after | v1 genesis chronology (~70% error closed — keep or beat) |
