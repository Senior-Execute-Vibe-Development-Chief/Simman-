# Recorded instrument bank

`assets/instr-audio/` holds one real recording per instrument **family**, used by
the Music Lab's "recorded bodies" path. It is built by `tools/build_samples.mjs`,
which fetches from two sample libraries and re-encodes what it needs.

## Two banks, two licences

There are two banks here and they are NOT under the same terms. The family bank
is CC0 and needs nothing; the named bench bank is CC BY and the credit below is
a genuine obligation, not a courtesy.

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
| `clappers` | Claves | two solid bodies struck together |
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

Its sibling font **MusyngKite is deliberately not used**: it is
Attribution-**ShareAlike**, and a share-alike asset would reach back into this
repository's own licensing.

### Exact, and by acoustic class

Ten of these are the instrument itself — sitar, koto, shamisen, shakuhachi,
taiko, bagpipe, fiddle. The rest are the nearest thing in the same acoustic
class, and each one says so in the table so the substitution is never invisible:
a sheng and a reed organ are both free reeds; a nāy and a pan pipe are both
end-blown rim flutes; an oud and a nylon-strung guitar are both gut-ish
short-necked lutes. Where no honest neighbour exists the entry is simply left
out and the family bank plays — a wrong instrument is worse than a generic one.

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
