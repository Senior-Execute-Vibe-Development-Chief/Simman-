# Simman v2 — M0 instrument bench

M0 is deliberately boring scaffolding. It contains no terrain, population,
politics, or other simulation physics. The placeholder tick only exercises
the deterministic RNG, deterministic math, typed-array field declaration,
world hash, save/load, and conservation instrumentation that later milestones
must use.

## Setup and commands

Requires Node 20+ and Rust with the `wasm32-unknown-unknown` target. From this
directory:

```bash
npm ci
npm run lint       # ESLint restrictions plus constants-ledger lint
npm run test       # smoke gate plus unit checks
npm run smoke      # determinism, save/load, conservation, provenance, WASM
npm run bench      # JSON ms/tick report at both grid presets
npm run build      # WASM build, strict TypeScript check, Vite production build
npm run browser    # Chromium, Firefox, and WebKit cross-engine checks
npm run dev        # Vite development server
```

`npm run smoke` builds the Rust fixture first. `npm run browser` launches its
own Vite server and compares all browser results with the Node result.

## Layout

```text
src/sim/       world, declared fields, placeholder tick, dmath, worker
src/ported/    byte-compatible v1 RNG port
src/shell/     M0 HTML placeholder
rust/router/   wasm-bindgen Dijkstra toolchain proof
data/reality/  empty M0 dataset shelf
tools/         smoke, bench, browser runner, collector, ledger lint
```

The world has `dev` and `target` presets. Their dimensions and other unresolved
choices are recorded in `QUESTIONS.md`. The target is the documented v2
simulation-width convention, not a terrain implementation.

## M0 guarantees

- A fixed seed produces the same world hash after 500 placeholder ticks on
  both presets.
- Save → load → save is byte-identical, and continuation remains identical.
- Every placeholder field write passes through a named source/sink balance sheet.
- `collect()` measures numeric leaves and distributions by default; its
  fail-open scratch list is exported from the collector.
- Node, Chromium, Firefox, and WebKit agree on the world hashes, math bit
  goldens, and WASM distances.
- `eslint` forbids standard-library transcendental functions in `src/sim`.

