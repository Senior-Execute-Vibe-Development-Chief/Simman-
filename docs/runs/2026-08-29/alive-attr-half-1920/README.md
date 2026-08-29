# Alive-debt attribution — app Half (W=1920, tw=960)

Correct grid for the owner's "960 / Half" play setting.

| label | map W | sim `tw` |
|---|---:|---:|
| **This panel (correct)** | **1920** | **960** |
| Prior mistaken panel (`alive-attr-960`) | 960 | 480 |

## Verdict (seed 8817, 24k, harness pins)

**Every arm is dead by step 4000.** Nine cradle settlements at t=0; zero from 4k–24k.

| Arm | setts @ 24k |
|---|---:|
| harness_current | 0 |
| harness_pre_v58 | 0 |
| harness_pre_v57 | 0 |
| harness_city_store_off | 0 |
| harness_mint_bars_off | 0 |

Rolling back the v57 mint stack — which restored the register at **tw=480** (10→36) — does **nothing** at **tw=960**. Kind difference, not degree.

Overnight `shape_1920_8817` on an earlier tree also read 0 realms under harness (no live gates) — same signature.

## Implication

Gate-harness attribution at Half cannot separate mint levers: the cradles dissolve and nothing remints. Next useful arm is the **LIVE** play stack at W=1920 (`DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1,PEER_SEATS=1,…`), which is what the app actually runs.
