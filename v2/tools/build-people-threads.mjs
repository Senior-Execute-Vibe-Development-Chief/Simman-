import { spawnSync } from "node:child_process";

const toolchain = "nightly-2025-02-01";
const rustup = process.platform === "win32" ? "rustup.exe" : "rustup";
const wasmPack = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const installed = spawnSync(rustup, ["toolchain", "list"], { encoding: "utf8" });
if (installed.status !== 0 || !installed.stdout.includes(toolchain)) {
  run(rustup, [
    "toolchain",
    "install",
    toolchain,
    "--profile",
    "minimal",
    "--component",
    "rust-src",
    "--target",
    "wasm32-unknown-unknown",
  ]);
}

run(wasmPack, [
  "wasm-pack",
  "build",
  "rust/people",
  "--target",
  "web",
  "--out-dir",
  "../../src/wasm/people-threads",
  "--release",
  "--",
  "-Z",
  "build-std=std,panic_abort",
], {
  env: {
    ...process.env,
    RUSTUP_TOOLCHAIN: toolchain,
    RUSTFLAGS: [
      "-C",
      "target-feature=+atomics,+bulk-memory,+mutable-globals",
      "-C",
      "link-arg=--shared-memory",
      "-C",
      "link-arg=--import-memory",
      "-C",
      "link-arg=--max-memory=2147483648",
    ].join(" "),
  },
});
