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

Instrument: `tools/probe_natdensity.mjs`. Every arm names its lever set at the
top of its log; the live app arm is the one in the probe's header comment.
