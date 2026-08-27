# Recorded instrument bank

`assets/instr-audio/` holds one real recording per instrument **family**, used by
the Music Lab's "recorded bodies" path. It is built by `tools/build_samples.mjs`,
which fetches from three sample libraries and re-encodes what it needs.

## Two banks, three licences

There are two banks here and they are NOT under the same terms. The family bank
is CC0 and needs nothing; the named bench bank is mostly CC BY, and that credit
is a genuine obligation rather than a courtesy — except for the two named
bodies that come from CC0 recordings, listed under their own heading below.

## The family bank — CC0

Both are by **Versilian Studios LLC** and both are released **CC0 1.0
Universal** (public domain dedication) — no attribution is required, and
redistribution, modification and commercial use are all permitted. That licence
is why this bank can be committed here and inlined into a single-file artifact
at all.

| library | url |
|---|---|
| Versilian Community Sample Library (VCSL) | https://github.com/sgossner/VCSL |
| VSCO 2 Community Edition | https://github.com/sgossner/VSCO-2-CE |

The credit below is courtesy, not obligation.

> Recorded instruments: Versilian Community Sample Library and VSCO 2 Community
> Edition, by Versilian Studios LLC — released CC0 (public domain).

## What is mapped, and why by family

The engine derives an instrument from what a people had to build with, so most
of what it invents has no name and no recording anywhere. A bank of *named*
instruments could therefore never play for it. What is mapped instead is the
FAMILY — the thing that actually vibrates and how it is driven — which is also
how VCSL is organised (Hornbostel–Sachs), so the mapping needs no judgement
calls.

| engine family | recording | why |
|---|---|---|
| `luteNeck` | Strumstick | a fretted, necked, plucked string |
| `lyre` | Dan Tranh | open strings, one per pitch, plucked |
| `bowed` | Solo Violin | a bow keeping the mode driven |
| `fluteOpen` | Flute | open tube, edge-blown, full harmonic series |
| `pipeStopped` | Ocarina | a stopped vessel — odd-harmonic, hollow |
| `reedPipe` | Oboe | a conical reed, full series, buzzing |
| `horn` | F Horn | lip-driven, sounds its own harmonic series |
| `barSet` | Balafon | tuned bars over gourd resonators |
| `lamella` | Mbira dzaVadzimu | a plucked clamped tongue |
| `bell` | Tubular Bells | a cast profile with tuned partials |
| `gong` | Gong | a flat plate, dense inharmonic modes |
| `drum` | Darbuka | a single-headed struck membrane |
| `frameDrum` | Frame Drum | a hand-struck frame membrane |
| `claps` | Claps | hands |

## The named bench bank — CC BY 3.0, attribution REQUIRED

`assets/instr-audio/named/` holds the actual instruments five real traditions
use, for the traditions bench only. Nothing a derived people can reach ever
looks these up: an instrument gets a `sampleName` in `musicTraditions.js` and
nowhere else, which is the same wall that already keeps the pinned scales away
from the generator.

Source: **FluidR3_GM** by **Frank Wen**, taken as pre-rendered per-note MP3 from
[midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts), released
under **Creative Commons Attribution 3.0**. Redistribution is permitted *with
credit*, which is discharged here and in the Lab's footer.

> Named bench instruments from FluidR3_GM by Frank Wen, via midi-js-soundfonts
> — CC BY 3.0.

An openly-licensed **oud** exists (MFA Oud by Mr Fuzzywump, CC BY 3.0, on
musical-artifacts.com) and is not used here: that site serves its file
downloads behind a bot challenge, and working around one is not something this
build does. The oud stays on the nylon-guitar substitute until the file can be
fetched the way it is meant to be.

Its sibling font **MusyngKite is deliberately not used**: it is
Attribution-**ShareAlike**, and a share-alike asset would reach back into this
repository's own licensing.

## Two named bodies from a CC0 recording

General MIDI's instrument list was drawn up in 1991 around a Western keyboard.
It has a sitar and a koto and a shakuhachi in it, and nothing whatever for a
bowed fiddle with a snakeskin membrane or a plucked box zither with movable
bridges — so those two come from real recordings instead, through the same path
the family bank uses.

| named | recording | licence |
|---|---|---|
| `erhu` | [AliExpress Erhu](https://github.com/sfzinstruments/aliexpress-erhu) — a cheap erhu, close-miked in stereo | CC0 1.0 |
| `qānūn` | VCSL **Dan Tranh** — a plucked box zither with movable bridges under metal strings | CC0 1.0 |

Neither requires attribution. The erhu's own readme says it was played by
"someone who's more of a violinist", which is audible and is still an erhu.

### Exact, and by acoustic class

Twelve of these are the instrument itself — erhu, sitar, koto, shamisen,
shakuhachi, taiko, bagpipe, fiddle. The rest are the nearest thing in the same
acoustic class, and each one says so in the table so the substitution is never
invisible: a sheng and a reed organ are both free reeds; a nāy and a shakuhachi
are both end-blown rim flutes with open holes in a bamboo tube; an oud and a
nylon-strung guitar are both gut-ish short-necked lutes. Where no honest
neighbour exists the entry is simply left out and the family bank plays — a
wrong instrument is worse than a generic one.

Two substitutions were replaced rather than kept, because they were wrong in
the BODY and not merely in the name. The nāy and the bānsurī used to borrow a
**pan flute**, which is a bundle of stopped pipes with one pitch each and no
finger holes: it cannot bend, and bending is most of what those two do. The
qānūn used to borrow a **hammered dulcimer**, which is struck where a qānūn is
plucked.

Three of the bench's percussion parts deliberately stay on the CC0 family bank
rather than take a General MIDI substitute, because VCSL's **Darbuka** and
**Frame Drum** are real recordings of exactly those instruments and better than
any stand-in would be.

## The cost, stated plainly

Sampling a family means material and frame stop being separate SOUNDS. A bronze
bar set on a stone frame and a wooden one on gourds both begin life here as the
same recorded balafon, tilted apart by brightness rather than resynthesised —
so the emergent instrumentarium becomes less audible on this path than on the
modelled one. That is exactly why the Lab keeps both and lets you switch: the
cost is meant to be heard, not argued about.
