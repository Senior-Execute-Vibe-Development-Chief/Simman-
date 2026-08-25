# 2026-08-22 — the nationless-cities wave

Owner report: *"the majority of cities spawn early game, nationless, and then
start minting nations of their own accord ... the truly nation sized nations
generally come out of areas with low early city density."*

Findings and the mechanism built from them: `docs/nationless-cities-2026-08-22.md`.

| log | what it is |
|---|---|
| `owner-run-t34537-levy.txt`, `owner-run-t36312.txt` | the owner's own run journals, tw=960 (the shipping grid) — the arc that started this |
| `natdensity240.log`, `natdensity480.log` | the diagnosis, reference and shipping-proxy grids, `WIN=250` |
| `natdensity240_why.log`, `natdensity480_why.log` | + the attribution of each self-founding on claimed ground |
| `natdensity240_tight.log`, `natdensity480_tight.log` | `WIN=25` — kills the sampling-staleness and secession confounds |
| `natdensity240_norecords.log` | the falsification arm: `STATE_RECORDS=0` collapses the stateless window to 0% |
| `natdensity_960_8817_30000.csv` | per-realm rows (birth neighbourhood joined to final territory) |
| `bornofland_gates.log` | `T.BORN_OF_LAND` lever-ON battery: smoke, stylized, resgate (seed 8817) |
| `bornofland_ab.log` | the 3-seed A/B against the same tree lever-OFF, plus baseline resgate |
| `bornofland_4242_full.log` | seed 4242 lever-ON in full — names the one added soft warning (tech ~ cradle-distance +0.22) |
| `bornofland_flip.log` | the flip itself: hash guards, their recovery pair, smoke at the new defaults |
| `owner-run-t37123-bornofland.txt` | the owner's own tw=960 run with the lever ON — see the build caveat below |
| `natdensity480_bornofland.log` | the CLEAN same-tree lever-ON arm at the shipping proxy (pairs with `natdensity480_tight.log`) |
| `owner-run-t35572-defaulton.txt` | the owner's run at build `f25f339` with the lever as DEFAULT — byte-identical to `t37123` at all 143 common checkpoints, so the flip commit changed only the default |

**Build caveat on the owner pair.** `owner-run-t36312.txt` (lever off) carries no
`build=` stamp and no `subCity` column, so it predates `31a1f6c` — the whole
"towns must not exist" mint change. Comparing it against `owner-run-t37123` reads
BORN_OF_LAND *plus* that stack, not the lever alone: painted nations 465 -> 374,
biggest bloc 24 realms/2.38M km2 -> 64 realms/4.39M km2, singleton share 81% ->
81%. Cite it as a regime comparison, never as this lever's effect. The clean
attribution is `natdensity480_tight.log` (off) vs `natdensity480_bornofland.log`
(on), same tree, same grid, same window.

Instrument: `tools/probe_natdensity.mjs`. Every arm names its lever set at the
top of its log; the live app arm is the one in the probe's header comment.
