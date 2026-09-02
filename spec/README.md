# Simman v2 — Design Specification Suite

This directory is the constitution and design spec for the v2 rebuild: a
comprehensive, utterly realistic global history simulator running on real
Earth (Phase 1), in which everything — economies, polities, cities,
technology, exploration, peoples — emerges from core physics and principles.
Nothing is staged or propped up.

## How to read

| Doc | Contents |
|---|---|
| `DECISIONS.md` | Ratified owner rulings (binding) + proposals awaiting explicit ratification |
| `00-vision.md` | What the product is, phases, what makes it different |
| `01-constitution.md` | The inviolable rules — v1's three cardinal rules plus the new ones v1's failures taught |
| `02-architecture.md` | Substrate: fields, condensation, the obligation graph, scheduling, determinism, grids, persistence |
| `03-earth-and-travel.md` | Layer 1: the Earth substrate and the universal travel-time field |
| `04-people-and-food.md` | Layers 2–3: population, food as conserved mass, harvest years |
| `05-politics.md` | The physics of power: seven primitives, communities, centers, obligations, institutions |
| `06-economy.md` | Markets (bid-to-eat), money, goods, labor — largely inherited from v1's validated designs |
| `07-culture-language-faith.md` | The identity layers and the ported verticals (language, emblems) |
| `08-validation.md` | The gate suite: determinism, invariants, cross-grid, reality tables, pathology regressions, play-experience gates |
| `09-constants-ledger.md` | Every free constant: value, unit, citation. The mechanism-budget enforcement point |
| `10-build-plan.md` | Milestones M0–M8+, porting plan, repo layout |
| `11-knowledge.md` | Knowledge & technology: techniques as living populations (carriers, practice, transmission, loss, blocking) |
| `12-zoom.md` | The living zoom: altitude bands, the no-lies rule, persistent micro-genealogy, follow-the-grain |
| `13-war.md` | War in the concrete: armies as supplied columns, devastation, two-clock sieges, assessment-convergence endings |
| `14-discovery.md` | Discovery & colonization: the known world, the mappa mundi lens, first contact, colonies as outcomes |
| `15-pastoral.md` | Herds and the emergent steppe: grass physics, the feeding continuum, mirror-empires, the dismount dilemma |
| `16-plagues.md` | Plagues: disease pools, immunity gaps, emergence from density × livestock, quarantine |
| `17-observatory.md` | The observatory: lenses, codex, chronicles, the almanac, the sharing loop |
| `18-foundations.md` | The reduction audit: the primitive stack, the ten mental stocks, the label law, representation invariance |
| `research/` | The distilled v1 learnings corpus (five dossiers) — the evidence base these specs cite |

## Spec depth rule

Detail is **graded by certainty**, deliberately:

- **Full detail** — layers that are validated v1 ports or foundational physics
  (03, 04, most of 06, 07): these can be built from the spec as written.
- **Design detail** — the political physics (05): primitives and mechanisms are
  fixed; exact functional forms and constants carry `[DERIVE]` markers to be
  settled during M4–M5 against their reality tables.
- **Sketch** — layers above the M4 bet (late-game consolidation dynamics,
  collapse texture): direction fixed, mechanics to be hardened only after the
  foundation passes its checks. Marked `[SKETCH]`.

A section may only be promoted a level when the layer below it has passed its
milestone gate (10-build-plan.md). Hardening spec text above an unvalidated
foundation is forbidden — that is speculation wearing a spec's clothes.

## Living-document rules

- Owner rulings land in `DECISIONS.md` first; specs conform to it.
- Every constant introduced anywhere must have a row in `09-constants-ledger.md`
  the same day. No row, no constant.
- When a milestone's measurements contradict a spec section, the spec is
  updated in the same change as the finding — a spec that disagrees with the
  measured sim is a bug in one of them, and the change must say which.
