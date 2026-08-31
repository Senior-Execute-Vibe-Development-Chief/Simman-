# IDEA_FIELD flip battery (2026-08-29)

Re-measure phase 1 (“the land can forget”) on SAVE_VERSION 58 defaults
before any flip. Tree `75a3d421`.

## Verdict: **HOLD — do not flip**

Mechanism works. Gates do not. Compound lean on an already-thin register.

| gate | OFF (control) | ON | unique to ON? |
|---|---|---|---|
| smoke | pass (pop 770→778) | **FAIL** pop 770→708 | **yes** |
| stylized 8817/24k | hard FAIL alive 11 setts / pop 8566; 4 softs | hard FAIL alive **9** / pop **5652**; 4 softs; cities>10k **5→1** | worsens |
| resgate 8817/6k | FAIL realm count 2; claimed ratio 0.65 | FAIL realm count 2; claimed ratio **0.56** (floor 0.53) | worsens |
| abtest 9k×4 @W=480 | — | `_devSrc` live; `devField` **−9.4%** CONSISTENT; pop max −3.9% mixed | mechanism |

Branch already fails stylized alive (≥20 setts) and resgate realm-count **without** the lever — mint/politics stack debt. IDEA_FIELD is not the root of that red, but it is not green enough to ship on top of it.

## Arms

| arm | log |
|---|---|
| smoke ON | `smoke_on.log` |
| `probe_ideas` 6k OFF/ON @ W=480 (`tw=240`) and W=960 (`tw=480`), seed 8817 | `ideas*.log` |
| abtest 9k × 4 seeds | `abtest_9000.log` |
| validate / resgate ON + OFF control | `validate_*.log`, `resgate_*.log` |

## `probe_ideas` — mechanism green, farmed lean

| arm | farmed@1k | @2k | @6k | FELL@6k | setts@6k |
|---|---|---|---|---|---|
| 240 OFF | 4.7% | 7.4% | 9.9% | 0 | 3 |
| 240 ON | 3.2% | 5.8% | 6.8% | 169 | 3 |
| 480 OFF | 1.6% | 2.5% | 3.1% | 0 | 4 |
| 480 ON | 1.2% | 1.6% | 2.3% | 2466 | 3 |

Land forgets on both grids. Farmed cut at shipping proxy still open at 6k
(−0.8 pp). Matches the 2026-08-03 qualitative lean; now compounds with
default `INDEP_TECH`.

## abtest (field layer)

Consistent movers: `_devSrc` appears; `_devNext` −13.9%; `devField` −9.4%.
Harness headline realm/pop are 0/0 both arms at this horizon (DAWN pins) —
trust field rows only.

## Why not flip

1. Smoke demographic reverse is a hard unique fail.
2. Already-sub-floor city register gets thinner (11→9; Zipf cities 5→1).
3. Resgate claimed ratio moves toward the floor.
4. No owner mandate to re-derive smoke/alive floors in this wave.

## Next

- Park `IDEA_FIELD` until the register-alive debt on this branch is
  separately understood (or owner re-derives floors with a designed wave).
- Optional hygiene: delete `INVENT_FIELD`; absorb/delete `LABEL_BIRTH` lever
  after residual-delta check; leave `MARGINAL_HOLD` rejected.
