# Flag design principles — the theory, and where the engine stands

Working notes on *why real flags read the way they do*, and an honest audit of
how the emblem engine already aligns or still diverges. Written after a pass of
proper vexillological + colour theory, cross-checked against **measured** output
of the live engine (`node tools/measure-colour-economy.mjs`, 8 000 heraldic
flags from the same space the rating tool samples).

This is a *reference*, not a spec. Nothing here is a target to dial in — per the
second cardinal rule, every number below describes a **mechanism's consequence**,
and the fixes proposed are mechanisms, never country look-ups.

---

## The five principles (NAVA, *Good Flag, Bad Flag*, Ted Kaye 2006)

The canonical design brief, distilled from a survey of vexillologists. Each is a
legibility argument — a flag is read **small, moving, at distance, from memory**.

1. **Keep it simple.** A child should be able to draw it from memory.
2. **Use meaningful symbolism.** Images/colours should relate to what they stand for.
3. **Use two or three basic colours.** Limit to a small, well-contrasting set.
4. **No lettering or seals.** Never use writing or an organisation's seal.
5. **Be distinctive, or be related.** Avoid duplicating; use similarities to show connections.

### How the engine stands on each

| Principle | Engine | Evidence / note |
|---|---|---|
| 1 · Simple | **Held** *(visual-economy budget added)* | Was the clearest gap (44.5% stacked ≥3 features); the crowding mechanism below thinned it — mean load 2.40 → 2.14, load-2 now the mode (53%), load-4+ down from 9.5% to 3.4%. |
| 2 · Meaningful | **N/A by design** | Symbolism is emergent in the sim (a civ's genome carries its meaning); the standalone engine can't and shouldn't fake semantics. |
| 3 · 2–3 colours | **Strong** | Mean **3.07** distinct tinctures; **88.5%** at 2–3. Bang on the principle. |
| 4 · No lettering/seals | **Held** | The engine renders no text and no photo-real seals; the bespoke-flag exclusion list owns the seal-bearing outliers. |
| 5 · Distinctive/related | **Structural** | One shared evolvable genome ⇒ related emblems drift from a common ancestor (families), distant seeds diverge. This is exactly principle 5, for free. |

---

## Colour theory for flags

Flags are the extreme case of colour-at-distance: no fine detail survives, so
**colour contrast does nearly all the legibility work**. Four ideas matter.

### 1. Contrast is the whole game — the rule of tincture

Heraldry's oldest rule: **never metal-on-metal, never colour-on-colour.** Tinctures
split into *metals* (or/gold, argent/white — the light class) and *colours*
(gules/red, azure/blue, vert/green, sable/black, purpure — the dark class). Every
adjacency must cross the boundary, so every edge carries a light/dark step that
survives shrinking, movement and low light. This *is* colour theory for flags:
value contrast over hue contrast.

> **Engine:** enforced *constructively*, not checked after the fact. `tinctureOn()`
> picks a mark's colour as the opposite class of its ground (or, off a partitioned
> ground, the pole at maximum OKLab distance). Contrast can't fail because the
> illegal pick is never in the candidate set. `npm test` proves it: ~9 000
> tincture adjacencies, min ΔE ≈ 0.19, zero same-class-on-same-class. This is the
> engine's strongest colour-theory alignment.

### 2. Economy — two or three basic colours

Real national flags cluster hard at 2–3 colours; four is already busy, five rare
(and usually a coat-of-arms flag). The economy isn't austerity — it's that each
added colour costs a legibility step and a memory slot.

> **Engine:** mean 3.07, 88.5% at 2–3 — correct. One honest wrinkle: the engine
> **under-produces the clean bicolour** (only 7.8% at exactly 2 vs ~20–25% of real
> flags) and over-clusters at exactly 3 (80.7%). Real vexillology has more
> two-colour flags (Poland, Ukraine, Indonesia, Japan-as-two). Candidate mechanism
> below — and note this is a *companion-gate* question, not a palette one.

### 3. The warm/cool + metal/colour structure

Beyond raw contrast, flags lean on a small warm accent against a cooler field (gold
device on azure; red charge on white), which is *simultaneous contrast* doing
aesthetic work. Gold specifically behaves as a **charge-and-stripe metal**, not a
ground — a whole flag of gold reads weak and washed at distance.

> **Engine:** already modelled. `groundGold()` demotes a solid-gold *field* to
> undyed cloth below a high saturation intent, while gold as stripe/charge/canton
> is untouched (Germany, Colombia, Lithuania keep their gold band). Gold-on-silk
> and ink-if-light fall out of the imperial palette's `farPole`.

### 4. Colour families & frequency (principle 5, in pigment)

Real flags are not random contrast pairs — they cluster into recognisable
**regional/ideological palettes**:

- **Pan-Slavic** red · white · blue (Russia, Slovakia, Slovenia…)
- **Pan-African** red · gold · green (+ black) (Ghana, Mali, Guinea…) — ~81% of
  African flags draw from this set
- **Pan-Arab** red · white · black · green (Egypt, Iraq, Jordan, Kuwait…)
- **Nordic** a cross, usually two colours + a fimbriation

Frequency across all national flags (approximate, CRW Flags / vexillology
surveys): **red ~74%, white ~71%, blue ~50%, gold/yellow ~45%, green ~40%, black
~25%**; orange and especially purple are genuine rarities (purple on ~2 flags).
Symbolic families: red = valour/blood, white = peace/purity, blue =
justice/sky/sea, green = land/Islam/hope, gold = wealth/sun, black = the people/
resolve.

> **Engine:** the *frequencies* emerge correctly from the dyer's-wheel + bunting
> shelf (bright bolts dominate, purpure is excluded from bunting, stains are rare).
> What the engine does **not** model is family *co-occurrence* — colours are chosen
> by contrast alone, so the specific red-gold-green or red-white-blue *triads*
> arise only by chance, not as attractors. This is deliberately left alone: the
> user has scoped the palette out of bounds, and a "make it pan-African" attractor
> risks fitting an outcome (cardinal rule 2). Noted here as theory, not a to-do.

---

## Element composition

### Simplicity / visual load (principle 1, restated structurally)

A flag is a **small budget of ink**. Real flags spend it on *one* dominant idea:
a division, or a cross, or a canton-and-field, or a single central charge — rarely
two of those together, almost never three. The engine's features *used to* gate
**independently** (each on its own gene threshold), so on a lucky genome a
partition *and* an ordinary *and* a device *and* a canton *and* a bordure all fired
at once — nothing accounted for what the field already carried, and a bordure
alone landed on 37.6% of flags.

> **The visual-economy budget (`expressGenome`, "VISUAL ECONOMY" block).** The field
> now carries an attention budget seeded by its own structure (a plain field 0, a
> simple division 0.15, a heavy rotational cut 0.32; an ordinary or hoist band adds
> 0.22). Every *secondary* layer — bordure, counterchange, the union overlay, a
> hoist device, stripe seams, the canton — must clear a gene bar **raised by the
> load already committed** (`gene > base + load·CROWD`), and committing spends its
> own weight so the next bar is higher. The dominant idea (the partition, and one
> main overlay — an ordinary or a central device) is never crowded. This is a
> *cost the field pays*, not a cap: a genome with its genes near 1 still stacks
> everything (the coat-of-arms flags), but the average genome settles on one or two
> ideas. Self-calibrating on any seed — a plain field admits more, a quartered field
> under a cross admits almost nothing. Cloth pays; a shield (a full achievement of
> arms) does not (`CROWD = 0`).
>
> **Measured effect** (8000 flags): mean load **2.40 → 2.14**; load-1 14.7 → 18.2%,
> load-2 40.8 → **53.2%** (the mode), load-3 35.1 → 25.2%, load-4 8.6 → 3.3%, load-5
> 0.9 → 0.1%. Bordure 37.6 → 21.4%, canton 12.1 → 8.0%, counterchange 9.9 → 5.6%.
> Colour economy (mean 3.06) and device rate (33%) untouched — the palette and the
> one dominant idea are never crowded.

### Placement — the positions of honour

Real flags place charges in a small vocabulary of honoured spots: **centre** (the
commonest — a lone device on the field), **canton** (top-hoist, the position of
honour — stars, a cross, a union), **hoist band** (a vertical stripe bearing a
device — the Arab/African hoist), and **fly** (rare). A charge is centred *or*
cantoned, never both.

> **Engine:** modelled well. The canton *houses* the device (a device moves into
> the canton rather than a second device appearing beside it); the hoist band owns
> the hoist and suppresses a competing canton; `panel`/`fimbriation` give a lone
> central figure its own ground. These are the right rules.

### Proportion — stripe ratios & the field split

Tricolours are usually **1:1:1**, but the Spanish-fess family doubles the centre
(**1:2:1**, Canada, Thailand-ish) or the first band (**2:1:1**), and the quintband
runs **1:1:2:1:1** (Thailand, Costa Rica). Overall flag ratio clusters at **1:2**
and **3:5**, with square (Switzerland, Vatican) and very-long (Qatar) as rare
outliers.

> **Engine:** `tiercedWide` (1:2:1 / 2:1:1) and `stripeWeights` (quintband) are
> built; `flagRatio` spans 11:28 → 1:1 with the common 1:2…2:3 in the fat middle
> of the substrate-gene window and the outliers at the rare ends. Aligned.

### Symmetry & balance

Most flags are symmetric about at least one axis (horizontal stripes, vertical
bands, a centred cross/charge) — asymmetry (a canton, a hoist device) is a
deliberate, honoured exception, not the norm. Balance is what makes a flag feel
"designed."

> **Engine:** partitions are axis-symmetric by construction; the asymmetric
> features (canton, hoist band) are the rarer, gated exceptions — the right shape.

---

## Divergences (mechanisms, not fits)

Each expressed as a **system** so it self-calibrates on any seed (cardinal rule 2):

1. **Visual-economy budget (principle 1) — ✅ BUILT.** *Was the top gap.* The
   crowding mechanism above replaced independent per-feature gating with an
   accumulating attention budget: secondary layers stand down as the field fills.
   Load fell toward 1–2 as a *consequence* (see measured effect), no cap hard-coded.

2. **Bordure still over-produced (principle 1) — candidate.** Even after crowding,
   a bordure lands on **21.4%** of flags vs ~5–10% of real ones. Crowding fixed the
   *co-occurrence* (bordure-on-busy-field); the residual is the bordure's own base
   commonness (its `0.62` gate is a leftover from when a bordure was chiefly a
   shield feature). Raising that base is a clean, independent commonness tweak — a
   candidate for the rating pass.

3. **Fatter bicolour tail (principle 3) — candidate.** The clean 2-colour flag is
   under-produced (7.8% vs ~20–25% real). This is the *companion* gate, not the
   palette: a dark field reaches for a second dark companion fairly readily; asking
   a stronger intent for the third colour would let more flags settle as true
   bicolours. Squarely inside "leave the palette alone" — it changes *how many*
   tinctures show, not *which* bolts exist.

4. *(Theory only, not scoped)* colour-family co-occurrence — left out on purpose;
   it risks fitting outcomes and the palette is out of bounds.

Candidates (2) and (3) are what the **rating tool** is meant to settle: the
`flag-ratings.json` export will show whether raters actually mark the bordured and
the exactly-3-colour flags down. Build the tweak the data points to — don't pre-tune.

---

## Sources

- NAVA, **[*Good Flag, Bad Flag*](https://portlandflag.org/wp-content/uploads/2015/08/GFBF_English.pdf)** (Ted Kaye, 2006) — the five principles.
- **[Rule of tincture](https://en.wikipedia.org/wiki/Rule_of_tincture)** — metal/colour contrast.
- **[National colours & flag colour frequency](https://en.wikipedia.org/wiki/National_colours)** and CRW Flags statistics — the ~74/71/50% figures and the regional palette families.
- Ohio State, **["Principles of flag design"](https://u.osu.edu/vexillology/)** — restatement of NAVA for design courses.
- Colour-at-distance / simultaneous contrast — standard colour theory (Itten/Albers), applied to the flag's read-small constraint.

*Measured against the live engine on 2026-07-14 with `tools/measure-colour-economy.mjs`.*
