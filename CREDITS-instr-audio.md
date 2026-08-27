# Recorded instrument bank

`assets/instr-audio/` holds one real recording per instrument **family**, used by
the Music Lab's "recorded bodies" path. It is built by `tools/build_samples.mjs`,
which fetches from two sample libraries and re-encodes what it needs.

## Sources

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

## The cost, stated plainly

Sampling a family means material and frame stop being separate SOUNDS. A bronze
bar set on a stone frame and a wooden one on gourds both begin life here as the
same recorded balafon, tilted apart by brightness rather than resynthesised —
so the emergent instrumentarium becomes less audible on this path than on the
modelled one. That is exactly why the Lab keeps both and lets you switch: the
cost is meant to be heard, not argued about.
