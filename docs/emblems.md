# The Emblem Engine — a heritable design-genetics for every banner

*Working notes for future generations. Status: standalone — deliberately **not**
wired into the simulation yet. Everything here is engine + tools + lab.*

The emblem engine turns a small **gene vector** into a flat 2D banner design —
European-style heraldry, an imperial silk, a monochrome mon, a calligraphic
banner, a steppe tamga, geometric tilework, a sacred sigil — and makes that
design **evolvable**: it drifts under mutation, passes to successors with
cadency, and recombines under unions with true accumulating marshalling.

```
genome {genes[26], seed, gen, quarters?, cadency?}
   │  expressGenome()            (pure, deterministic)
   ▼
phenotype {substrate, composition, colors, field, motif, cadency, …}
   │  emblemSVG() / drawEmblem() (pure, deterministic)
   ▼
flat SVG
```

## The six hard constraints

1. **Emergent** — nothing gates on time/step/year; only on state (CLAUDE.md
   cardinal rule 1).
2. **Build the system, never fit the outcome** — no constant tuned to a
   specific result (cardinal rule 2). Where a pick must be made, it is a
   uniform mechanism (class opposition, argmax distance), never a special case.
3. **Flat 2D only** — no physical standards or 3D; subtle 2D shading is fine.
4. **Decoupled** — no pattern or charge is tied to a "kind of realm" or a real
   culture. Every pattern is reachable by any genome. The lab's style presets
   are UI bookmarks into gene-space, nothing more.
5. **No real religious iconography** — faiths get procedural *sacred sigils*
   (an original symmetry-grammar), never a real symbol.
6. **Deterministic** — all randomness is seeded mulberry32; no `Math.random`
   in engine code. A genome and its whole evolutionary tree replay identically.

## Files

| file | role |
|---|---|
| `src/sim/emblemGenome.js` | genes, evolution operators, tinctures, expression, blazon, distance |
| `src/sim/emblemRender.js` | **all** drawing — the single source of truth for rendering |
| `src/sim/heraldryChargesDetailed.js` | generated: 186 recoloured charge silhouettes (~4 MB; grep, don't read) |
| `tools/build_charges.mjs` | builds the charge module from `assets/charges-src/*.svg` |
| `tools/measure_charges.mjs` | **run after build_charges**: re-anchors every charge viewBox to its measured artwork bounds (headless Chromium) |
| `tools/render_emblems.mjs` | static preview sheets (`node tools/render_emblems.mjs both out.svg`) |
| `tools/build_lab.mjs` + `tools/lab_template.html` | builds the interactive lab by inlining the two src modules + a size-capped charge subset |
| `tools/emblem.test.mjs` | property harness — runs as part of `npm test` |

## The genome

26 genes, all in [0,1]; order is the crossover backbone. Enum-valued genes
decode by `pickEnum` (equal windows). Genes not expressed by the chosen
composition still ride along and can surface in a descendant.

Beyond `genes`, a genome may carry **`quarters[]`** (accumulated marshalling,
see below) and **`cadency`** (an integer, the mark of difference).

Several genes are deliberately *overloaded* so the vector never grows: e.g.
`hueC` picks the ordinary, `crescent`'s high window picks a field treatment,
`stripes` counts barry/paly *or* splits an ordinary into diminutives,
`brandSeed` seeds tamga/tilework *or* picks a shield outline, `sunDisc`'s
tails set a charge's attitude. The depth is latent in the vector.

### Evolution operators

- `foundGenome(seed, axes)` — a genome from a seed, optionally biased by
  **abstract visual axes** (figuration, ornateness, boldness, saturation,
  symmetry, tone, hue, format). Deliberately no axis picks a composition or a
  charge category — that's how decoupling is enforced at the API.
- `mutateGenome(g, seed, strength)` — drift + rare macro-mutations. The same
  bearer: cadency is preserved; quarters drift gently and rarely simplify.
- `inheritGenome(parent, seed, strength)` — a successor. **Cadency**: the heir
  bears the next mark of difference (label → crescent → mullet → martlet →
  annulet → fleur, capped); with p=0.3 the heir takes the house outright and
  the marks clear.
- `crossGenome(a, b, seed)` — uniform crossover of the house *style*, plus
  **accumulating marshalling**: each parent contributes its quarter list
  (itself, if simple), duplicates collapse (dedup by `genomeDistance < 0.02`),
  the four most senior survive. A union founds a new house: cadency clears.
- `genomeDistance(a, b)` — cheap one-pass metric, circular on the hue genes.
  Used for dedup, measured fitness, and the lab's kinship tree.

## The tincture system

Tinctures are **typed**: metals (or, argent — the light class), colours
(gules, azure, vert, sable, purpure — dark), stains (murrey, sanguine, tenné —
dark off-hues). The genome's continuous colour intent is quantised to the
nearest named tincture in **OKLab**; metal fields and rare stains emerge from
the geometry of colour space, not from weights.

**The rule of tincture is constructed, not checked.** What a mark wears
follows from what it lies on (`tinctureOn`):

- uniform-class ground of genuine named tinctures → pick from the *opposite*
  class (the hue gene chooses freely inside the pool — opposition alone
  guarantees it reads);
- anything else (mixed colour-and-metal parties, continuous silk/clay fields)
  → threshold-free **argmax of min OKLab distance** over the named palette,
  with a two-pole mode's own poles as first-preference candidates.

Charges **on** an ordinary derive against the band, not the field — the same
rule applied one layer up. Over a mixed two-region party a charge or ordinary
may instead be **counterchanged** (the field's tinctures swapped across the
line). Monochrome heraldic coats engrave the hues their genes imply as
**petra sancta hatching** (dots or, vertical gules, horizontal azure, …).

## The grammar (what can be expressed)

- **Substrates**: shield (heater / Iberian / French / kite outlines), banner,
  roundel, pennon, gonfalon, lozenge. Flag substrates get vexillological
  grammar: Nordic cross toward the hoist, hoist-pointing pile, true
  rectangular canton.
- **Partitions**: per pale/fess/bend, quarterly, gyronny, per saltire, per
  chevron, barry, paly, **chequy**, **lozengy** — edges in line-styles
  (wavy, engrailed, embattled, indented).
- **Field treatments**: ermine, vair (real grounds — marks pick against
  argent / argent+azure), **fretty**, **masoned**.
- **Ordinaries**: fess, pale, bend, bend sinister, chevron, cross, saltire,
  pile, pall — plus chief and bordure; **diminutives** (bars, pallets,
  bendlets, scarpes, chevronels ×2–3); optional counterchange.
- **Company**: an ordinary may stand alone, carry charges **between** it, or
  bear charges **on** the band; or a semé field lies beneath it. Placement
  slots live in the phenotype (`motif.slots`) — one source for renderer and
  blazon.
- **Charges**: 186 recoloured silhouettes in 11 categories + 17 vector
  primitives (mullets, roundel, annulet, lozenge, fusil, mascle, billet,
  delf, crosses, goutte, …) that counterchange and semé crisply. Aniconism
  (low `iconism`) remaps living categories to non-living ones. Rare
  **attitudes**: inverted / contourné.
- **Non-heraldic compositions**: central device, radial badge, calligraphy
  (procedural pseudo-script; `scriptDensity` sets rows/packing), tamga,
  geometric tilework, semé, sacred sigil.
- **Marshalling**: `quarters[]` renders as a recursive quartered shield
  (2 coats sit 1&4/2&3; 3 repeat the senior in IV; each quarter is a full
  coat through the same pipeline).
- **Cadency**: the mark of difference rides in chief, over everything —
  including a marshalled display.

## Blazon

`blazonGenome(genome)` emits the formal sentence — *"Chequy Azure and Or, a
lion Gules"*, *"Azure, two bars Or between three mullets Or"*, *"Ermine, a
fess Gules, a label Or for difference"*, *"Quarterly: I. …; II. …"* — and an
honest plain-language line for the non-blazonable traditions.
`describeGenome` is the terse debug line.

## Invariants (enforced by `tools/emblem.test.mjs`, part of `npm test`)

1. Rule of tincture holds for every mark on every ground (strict class
   opposition on genuine named grounds; measured min-dE bound ≥ 0.1 on mixed
   or continuous grounds — observed minimum ≈ 0.21).
2. Every motif id in every pool resolves to art (primitive or raster).
3. express/mutate/inherit/cross replay deterministically.
4. Marshalling: self-cross stays simple; unions accumulate deduped quarters
   capped at 4; quarters persist under drift; marshalled coats render.
5. Cadency: appears down inherit chains, clears eventually, caps at six,
   survives mutation, clears on cross; blazoned "for difference".
6. Reachability: all ten tinctures appear as fields; chequy/lozengy/fretty/
   masoned/diminutives/attitudes all expressed in an 8k sample.

## The lab

`node tools/build_lab.mjs` → `tools/emblem-genome-lab.html` (gitignored;
deployed as a claude.ai artifact). Everything runs the *real* inlined engine.
Features: style presets (UI bookmarks), design axes, seed load, gene
inspector with precision editor, mutate/inherit/cross with strength control,
copy/paste genome, shareable URL-hash links, SVG/PNG export, a living
population under drift or measured-fitness selection (distance to a pinned
target), a kinship dendrogram over `genomeDistance`, and ancestry tracing.

## Charge art pipeline

`assets/charges-src/*.svg` (sources not committed) → `build_charges.mjs`
(strip backgrounds, detect recolour slots, minify) → **`measure_charges.mjs`**
(render each charge in headless Chromium, measure the painted leaves, keep
the dominant cluster, drop stray crop-marks, strip zero-scale matrices, and
re-anchor `vb` to true bounds + 2% pad). Never trust a source viewBox.

## What's deliberately NOT here yet

Sim integration. When it happens: realms found genomes from emergent state
via the abstract axes; successions call `inheritGenome`; unions/conquests
call `crossGenome`; schisms re-seed sigils. The engine primitives all exist —
the delicate part is mapping emergent realm state → axes without violating
the cardinal rules. That work deserves its own session.
