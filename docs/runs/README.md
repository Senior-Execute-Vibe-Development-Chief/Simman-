# docs/runs — the durable measurement store

The remote container's scratchpad is WIPED by resets (it has happened 13+
times), and with it every probe script and run log that only lived there.
The repo is the only durable store. Convention, from 2026-08-21:

- **Probe scripts are committed instruments** — they live in `tools/`
  (relative imports, `node tools/probe_*.mjs`), never only in a scratchpad.
- **Verdict-run logs are committed evidence** — copy the log of any run a
  decision was based on into `docs/runs/<date>/` in the same commit as the
  code or doc that cites it. They are small text files; the cost is nothing
  and re-running a 2-hour arm to re-learn a number is everything.
- The headline numbers STILL go into the campaign docs (`docs/*.md`) — a
  table in a doc survives context loss better than a log survives a reset,
  and the doc says what the numbers MEANT. The raw log backs it.

2026-08-21 note: the raw logs of that day's consolidation/predation verdict
arms (fear_verdict, relief_verdict, predation480*, funnel_predstack) were
lost to a mid-session container reset — the convention exists because of
that loss. Their verdict tables survive in
`docs/consolidation-2026-08-20.md` (addenda II-III); the probes that
produced them are now committed (`tools/probe_statefunnel.mjs`,
`tools/probe_predation.mjs`, `tools/probe_cityage.mjs`) and any number can
be reproduced from SIM_TUNE lines recorded in the probe headers.
