# v2 rebuild — research corpus

Distilled 2026-08-31 from the entire v1 codebase and docs corpus (94 design
docs, the 430-lever tuning registry, ~98k lines of source, the validation
harness) by five parallel deep-read passes. These dossiers are the **evidence
base** for the v2 design spec suite that will live in `spec/`.

They are extraction, not opinion: what shipped and why, what was tried and
measured dead, every grounded constant with its citation, every named
pathology with its detection signature, and the methodology laws the project
paid to learn.

| File | Scope |
|---|---|
| `01-design-docs-dossier.md` | The design-doc corpus: final winning designs per system, abandoned approaches with measured reasons, grounded constants, open problems, lever-interference cases |
| `02-investigations-dossier.md` | The autopsies/investigations: 32 named pathologies (mechanism, status, detection signature), measurement-methodology laws, every retracted finding with root cause, chronology/pacing learnings, the owner play-report gate class |
| `03-tuning-registry-dossier.md` | The full audit of all 430 tuning levers: the ~85 physical constants worth carrying, 156 model-selection flags and which side won, perf cadences, confessed outcome-fits, harness pins, the complete units story |
| `04-core-sim-dossier.md` | The core sim inventory: complete state inventory (all 8 dual representations), the tick/pass structure, every mechanism stated as a rule, the hacks-and-bridges tissue, port-vs-redesign verdicts, determinism architecture |
| `05-periphery-harness-dossier.md` | The portable periphery: worldgen stage table with portability verdicts, language/heraldry interfaces, the complete gate catalog (smoke/stylized/resgate/coverage/monotone/livegate), the metric-map conventions, UI shell salvage list |

Reading order for a newcomer: 02 (what went wrong and how we learned to
measure), then 01 (what won), then 04 (what exists), then 03 (what the
numbers mean), then 05 (what transfers).
