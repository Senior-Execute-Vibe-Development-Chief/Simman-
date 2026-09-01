#!/usr/bin/env bash
# Idempotent Cloud Agent setup for Simman v2 (the v2/ subdirectory).
# Rust + wasm32 target build the routing engine; npm provides wasm-pack, tsx,
# vite and Playwright; the three Playwright engines back the cross-engine
# identity check (npm run browser).
set -euo pipefail

# Rust wasm target for the wasm-pack routing build (rustc/cargo are preinstalled).
rustup target add wasm32-unknown-unknown

cd "$(dirname "$0")/../v2"

# Node deps (includes wasm-pack, tsx, vite, @playwright/test).
npm ci

# Browser engines for the cross-engine identity gate.
npx --yes playwright install --with-deps chromium firefox webkit

# Prebuild the Rust/WASM router so the first smoke/dev run is fast.
npm run wasm:build
